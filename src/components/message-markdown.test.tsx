import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import {
  hasClosedMermaidFence,
  MAX_MERMAID_SOURCE_LENGTH,
  MessageMarkdown,
  normalizeAlternateMathDelimiters,
  safeMarkdownUrl,
} from "@/components/message-markdown";
import { Providers } from "@/components/providers";
import type { AppLanguage } from "@/i18n/resources";

afterEach(cleanup);

function renderMarkdown(
  content: string,
  streaming = false,
  initialLanguage: AppLanguage = "en",
) {
  return render(
    <Providers initialLanguage={initialLanguage}>
      <MessageMarkdown content={content} streaming={streaming} />
    </Providers>,
  );
}

describe("MessageMarkdown", () => {
  it("renders GFM, hard breaks, alerts, footnotes, and math", async () => {
    const { container } = renderMarkdown(`# Heading

first line
second line

| A | B |
| - | - |
| 1 | 2 |

- [x] done

> [!NOTE]
> Keep this in mind.

Footnote[^1]

[^1]: Detail

Inline $x^2$ and display:

\\[y = mx + b\\]`);

    expect(
      screen.getByRole("heading", { name: "Heading" }),
    ).toBeInTheDocument();
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector('input[type="checkbox"]')).toBeChecked();
    expect(container.querySelector(".markdown-alert-note")).not.toBeNull();
    expect(container.querySelector("br")).not.toBeNull();
    expect(container.querySelector(".katex")).not.toBeNull();
    await waitFor(() =>
      expect(container.querySelector("[data-footnote-ref]")).not.toBeNull(),
    );
  });

  it("drops executable HTML and unsafe URL protocols", () => {
    const { container } = renderMarkdown(`<script>window.pwned = true</script>
<iframe src="https://evil.example"></iframe>
<object data="https://evil.example"></object>
<svg onload="window.pwned = true"><script>alert(1)</script></svg>
<img src="x" onerror="window.pwned = true">

[unsafe](javascript:alert(1))
![unsafe image](data:text/html;base64,PHNjcmlwdD4=)
[safe](https://example.com/path)`);
    const markdownRoot = container.querySelector(".message-markdown");
    expect(markdownRoot).not.toBeNull();

    expect(markdownRoot?.querySelector("script")).toBeNull();
    expect(markdownRoot?.querySelector("iframe")).toBeNull();
    expect(markdownRoot?.querySelector("object")).toBeNull();
    expect(markdownRoot?.querySelector("svg")).toBeNull();
    expect(markdownRoot?.querySelector("[onerror]")).toBeNull();
    expect(markdownRoot?.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(markdownRoot?.querySelector('[src^="data:"]')).toBeNull();

    const safeLink = screen.getByRole("link", { name: "safe" });
    expect(safeLink).toHaveAttribute("href", "https://example.com/path");
    expect(safeLink).toHaveAttribute("target", "_blank");
    expect(safeLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("loads a remote image only after keyboard confirmation", async () => {
    const user = userEvent.setup();
    const remoteUrl = "https://images.example.test/diagram.png";
    const { container } = renderMarkdown(
      `![Architecture diagram](${remoteUrl})`,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(`[src="${remoteUrl}"]`)).toBeNull();
    const loadButton = screen.getByRole("button", {
      name: "Load remote image: Architecture diagram",
    });
    loadButton.focus();
    await user.keyboard("{Enter}");

    const image = screen.getByRole("img", { name: "Architecture diagram" });
    expect(image).toHaveAttribute("src", remoteUrl);
    expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(image).toHaveAttribute("loading", "lazy");
  });

  it("requires confirmation again when the remote image URL changes", async () => {
    const user = userEvent.setup();
    const view = renderMarkdown(
      "![First diagram](https://images.example.test/first.png)",
    );
    await user.click(
      screen.getByRole("button", {
        name: "Load remote image: First diagram",
      }),
    );
    expect(screen.getByRole("img", { name: "First diagram" })).toBeVisible();

    view.rerender(
      <Providers initialLanguage="en">
        <MessageMarkdown
          content="![Second diagram](https://images.example.test/second.png)"
          streaming={false}
        />
      </Providers>,
    );

    expect(screen.queryByRole("img")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Load remote image: Second diagram",
      }),
    ).toBeVisible();
  });

  it("localizes the remote image confirmation", () => {
    renderMarkdown(
      "![架构图](https://images.example.test/diagram.png)",
      false,
      "zh-CN",
    );
    expect(
      screen.getByRole("button", { name: "加载远程图片：架构图" }),
    ).toBeVisible();
  });

  it("keeps incomplete streamed Markdown renderable", () => {
    renderMarkdown("Before\n\n```ts\nconst value =", true);
    expect(screen.getByText("Before")).toBeInTheDocument();
    expect(screen.getByText(/const value/)).toBeInTheDocument();
  });

  it("stabilizes CJK tables, formulas, and multilingual code after streaming", () => {
    const view = renderMarkdown(
      "中文，标点\n下一行\n\n| 列 | 值 |\n| --- |\n\n\\(x^2\n\n```python\nprint('你好')",
      true,
    );
    expect(screen.getByText(/中文，标点/)).toBeInTheDocument();
    expect(screen.getByText(/print\('你好'\)/)).toBeInTheDocument();

    view.rerender(
      <Providers initialLanguage="en">
        <MessageMarkdown
          content={
            "中文，标点\n下一行\n\n| 列 | 值 |\n| --- | --- |\n| A | B |\n\n\\(x^2\\)\n\n```python\nprint('你好')\n```"
          }
          streaming={false}
        />
      </Providers>,
    );
    expect(view.container.querySelector("table")).not.toBeNull();
    expect(view.container.querySelector(".katex")).not.toBeNull();
    expect(screen.getByText(/print\('你好'\)/)).toBeInTheDocument();
  });

  it("collapses long highlighted code blocks", async () => {
    const longCode = Array.from(
      { length: 30 },
      (_, index) => `const line${index} = ${index};`,
    ).join("\n");
    const { container } = renderMarkdown(`\`\`\`ts\n${longCode}\n\`\`\``);

    await waitFor(() =>
      expect(container.querySelector("details.long-code-block")).not.toBeNull(),
    );
    expect(
      screen.getByText("Code (30 lines, click to expand)"),
    ).toBeInTheDocument();
  });

  it("loads Mermaid only for a completed, closed diagram fence", () => {
    expect(hasClosedMermaidFence("```mermaid\ngraph TD\nA-->B")).toBe(false);
    expect(hasClosedMermaidFence("```mermaid\ngraph TD\nA-->B\n```")).toBe(
      true,
    );
    expect(hasClosedMermaidFence("~~~mmd\ngraph LR\nA-->B\n~~~")).toBe(true);
  });

  it("keeps oversized Mermaid as source without loading the renderer", () => {
    renderMarkdown(
      `\`\`\`mermaid\n${"A".repeat(MAX_MERMAID_SOURCE_LENGTH + 1)}\n\`\`\``,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /The diagram is too large to display/i,
    );
    expect(screen.getByText(/A{100}/)).toBeInTheDocument();
  });

  it("allows only approved Markdown URL forms", () => {
    expect(safeMarkdownUrl("https://example.com", "href")).toBe(
      "https://example.com",
    );
    expect(safeMarkdownUrl("mailto:user@example.com", "href")).toBe(
      "mailto:user@example.com",
    );
    expect(safeMarkdownUrl("#footnote", "href")).toBe("#footnote");
    expect(safeMarkdownUrl("javascript:alert(1)", "href")).toBe("");
    expect(safeMarkdownUrl("data:text/html,test", "src")).toBe("");
  });

  it("normalizes alternate math delimiters outside code fences", () => {
    expect(
      normalizeAlternateMathDelimiters(
        "Inline \\(x + 1\\)\n\\[\ny = 2\n\\]\n```txt\n\\(keep\\)\n```",
      ),
    ).toBe("Inline $x + 1$\n$$\ny = 2\n$$\n```txt\n\\(keep\\)\n```");
  });
});
