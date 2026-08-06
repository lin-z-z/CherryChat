"use client";

import { cjk } from "@streamdown/cjk";
import { code as codeHighlighter } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import remarkBreaks from "remark-breaks";
import { remarkAlert } from "remark-github-blockquote-alert";
import {
  CodeBlock,
  Streamdown,
  defaultRemarkPlugins,
  type Components,
  type CustomRenderer,
  type CustomRendererProps,
  type DiagramPlugin,
  type MermaidErrorComponentProps,
} from "streamdown";

const math = createMathPlugin({ singleDollarTextMath: true });
const LONG_CODE_LINE_THRESHOLD = 24;
export const MAX_MERMAID_SOURCE_LENGTH = 20_000;
const blockedRawElements = [
  "script",
  "iframe",
  "object",
  "embed",
  "form",
  "style",
] as const;

export interface MessageMarkdownProps {
  content: string;
  streaming: boolean;
}

export function hasClosedMermaidFence(markdown: string): boolean {
  return readClosedMermaidSources(markdown).length > 0;
}

export function readClosedMermaidSources(markdown: string): string[] {
  return Array.from(
    markdown.matchAll(
      /(?:^|\n)[\t ]*(`{3,}|~{3,})[\t ]*(?:mermaid|mmd)[^\n]*\n([\s\S]*?)\n[\t ]*\1[\t ]*(?=\n|$)/giu,
    ),
    (match) => match[2] ?? "",
  );
}

export function normalizeAlternateMathDelimiters(markdown: string): string {
  let fenceCharacter: "`" | "~" | null = null;
  let fenceLength = 0;
  let displayMathOpen = false;

  return markdown
    .split("\n")
    .map((line) => {
      const fence = line.match(/^[\t ]*(`{3,}|~{3,})/u)?.[1];
      if (fence) {
        const character = fence.startsWith("`") ? "`" : "~";
        if (!fenceCharacter) {
          fenceCharacter = character;
          fenceLength = fence.length;
        } else if (
          character === fenceCharacter &&
          fence.length >= fenceLength
        ) {
          fenceCharacter = null;
          fenceLength = 0;
        }
        return line;
      }
      if (fenceCharacter) return line;

      let normalized = line;
      if (displayMathOpen) {
        if (normalized.includes("\\]")) {
          normalized = normalized.replace("\\]", () => "$$");
          displayMathOpen = false;
        }
      } else if (normalized.includes("\\[")) {
        normalized = normalized.replace("\\[", () => "$$");
        if (normalized.includes("\\]")) {
          normalized = normalized.replace("\\]", () => "$$");
        } else {
          displayMathOpen = true;
        }
      }

      if (!displayMathOpen) {
        normalized = normalized.replace(
          /\\\((.*?)\\\)/gu,
          (_match, value) => `$${String(value)}$`,
        );
      }
      return normalized;
    })
    .join("\n");
}

export function safeMarkdownUrl(url: string, key: string): string {
  const normalized = url.trim();
  if (key === "href" && normalized.startsWith("#")) return normalized;
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (key === "href" && /^mailto:/i.test(normalized)) return normalized;
  return "";
}

interface RemoteMarkdownImageProps extends ComponentPropsWithoutRef<"img"> {
  node?: unknown;
}

function RemoteMarkdownImage({
  alt = "",
  className,
  node,
  src,
  ...props
}: RemoteMarkdownImageProps) {
  void node;
  const { t } = useTranslation();
  const safeSrc = typeof src === "string" ? safeMarkdownUrl(src, "src") : "";
  const [approvedSrc, setApprovedSrc] = useState<string | null>(null);
  const normalizedAlt = alt.trim();

  if (!safeSrc) {
    return normalizedAlt ? (
      <span className="remote-markdown-image-blocked">{normalizedAlt}</span>
    ) : null;
  }
  if (approvedSrc !== safeSrc) {
    const label = normalizedAlt
      ? t("loadRemoteImageWithAlt", { alt: normalizedAlt })
      : t("loadRemoteImage");
    return (
      <span className="remote-markdown-image-placeholder">
        <button
          aria-label={label}
          className="remote-markdown-image-load"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setApprovedSrc(safeSrc);
          }}
          type="button"
        >
          {label}
        </button>
      </span>
    );
  }

  return (
    // 点击确认后才创建原生图片，避免 Next Image 在确认前代理或预取第三方资源。
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      alt={alt}
      className={`remote-markdown-image ${className ?? ""}`.trim()}
      loading="lazy"
      referrerPolicy="no-referrer"
      src={safeSrc}
    />
  );
}

function CollapsibleCodeBlock({
  code,
  isIncomplete,
  language,
}: CustomRendererProps) {
  const { t } = useTranslation();
  const lineCount = code.replace(/\n$/u, "").split("\n").length;
  if (isIncomplete || lineCount <= LONG_CODE_LINE_THRESHOLD) {
    return (
      <CodeBlock code={code} isIncomplete={isIncomplete} language={language} />
    );
  }

  return (
    <details className="long-code-block">
      <summary>{t("codeLines", { count: lineCount })}</summary>
      <CodeBlock code={code} language={language} />
    </details>
  );
}

const collapsibleCodeRenderer: CustomRenderer = {
  component: CollapsibleCodeBlock,
  language: codeHighlighter
    .getSupportedLanguages()
    .filter((language) => language !== "mermaid" && language !== "mmd"),
};

const alertTypes = new Set(["note", "tip", "important", "warning", "caution"]);

function readReactText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(readReactText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return readReactText(node.props.children);
  }
  return "";
}

function MermaidErrorFallback({
  chart,
  error,
  retry,
}: MermaidErrorComponentProps) {
  const { t } = useTranslation();
  return (
    <div className="mermaid-error" role="alert">
      <strong>{t("mermaidError")}</strong>
      <span>{error}</span>
      <pre>
        <code>{chart}</code>
      </pre>
      <button onClick={retry} type="button">
        {t("retryMermaid")}
      </button>
    </div>
  );
}

const markdownComponents: Components = {
  a: ({ children, href, node, ...props }) => {
    void node;
    const external = Boolean(href && /^https?:\/\//i.test(href));
    return (
      <a
        {...props}
        href={href}
        rel={external ? "noopener noreferrer" : undefined}
        target={external ? "_blank" : undefined}
      >
        {children}
      </a>
    );
  },
  blockquote: ({ children, className, node, ...props }) => {
    void node;
    const childNodes = Children.toArray(children);
    const alertIndex = childNodes.findIndex((child) => {
      if (!isValidElement(child)) return false;
      return alertTypes.has(readReactText(child).trim().toLowerCase());
    });
    const alertType =
      alertIndex >= 0
        ? readReactText(childNodes[alertIndex]).trim().toLowerCase()
        : null;
    const renderedChildren = childNodes.map((child, index) => {
      if (
        index !== alertIndex ||
        !isValidElement<{ className?: string }>(child)
      ) {
        return child;
      }
      return cloneElement(child, {
        className: `${child.props.className ?? ""} markdown-alert-title`.trim(),
      });
    });
    return (
      <blockquote
        {...props}
        className={`my-4 border-l-4 pl-4 ${
          alertType ? `markdown-alert markdown-alert-${alertType}` : ""
        } ${className ?? ""}`.trim()}
      >
        {renderedChildren}
      </blockquote>
    );
  },
  img: RemoteMarkdownImage,
};

export function MessageMarkdown({ content, streaming }: MessageMarkdownProps) {
  const { t } = useTranslation();
  const [mermaidPlugin, setMermaidPlugin] = useState<DiagramPlugin | null>(
    null,
  );
  const [mermaidLoadFailed, setMermaidLoadFailed] = useState(false);
  const normalizedContent = useMemo(
    () => normalizeAlternateMathDelimiters(content),
    [content],
  );
  const mermaidTooLarge = readClosedMermaidSources(normalizedContent).some(
    (source) => source.length > MAX_MERMAID_SOURCE_LENGTH,
  );
  const shouldLoadMermaid =
    !streaming &&
    !mermaidTooLarge &&
    hasClosedMermaidFence(normalizedContent) &&
    !mermaidPlugin;

  useEffect(() => {
    if (!shouldLoadMermaid) return;
    let cancelled = false;
    void import("@streamdown/mermaid")
      .then(({ createMermaidPlugin }) => {
        if (!cancelled) {
          setMermaidPlugin(
            createMermaidPlugin({ config: { securityLevel: "strict" } }),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setMermaidLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [shouldLoadMermaid]);

  const plugins = useMemo(
    () => ({
      cjk,
      code: codeHighlighter,
      math,
      renderers: [collapsibleCodeRenderer],
      ...(mermaidPlugin ? { mermaid: mermaidPlugin } : {}),
    }),
    [mermaidPlugin],
  );

  return (
    <div className="message-markdown">
      {mermaidLoadFailed ? (
        <p className="mermaid-load-error" role="alert">
          {t("mermaidLoadError")}
        </p>
      ) : null}
      {mermaidTooLarge ? (
        <p className="mermaid-load-error" role="alert">
          {t("mermaidTooLarge", { count: MAX_MERMAID_SOURCE_LENGTH })}
        </p>
      ) : null}
      <Streamdown
        components={markdownComponents}
        controls={{
          code: { copy: true, download: false },
          mermaid: false,
          table: false,
        }}
        disallowedElements={blockedRawElements}
        isAnimating={streaming}
        lineNumbers
        mermaid={{ errorComponent: MermaidErrorFallback }}
        mode={streaming ? "streaming" : "static"}
        parseIncompleteMarkdown={streaming}
        plugins={plugins}
        remarkPlugins={[
          ...Object.values(defaultRemarkPlugins),
          remarkBreaks,
          [remarkAlert, { tagName: "blockquote" }],
        ]}
        skipHtml
        translations={{
          copied: t("copied"),
          copyCode: t("copyCode"),
        }}
        urlTransform={safeMarkdownUrl}
      >
        {normalizedContent}
      </Streamdown>
    </div>
  );
}
