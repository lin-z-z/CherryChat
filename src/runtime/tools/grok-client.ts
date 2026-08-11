import { z } from "zod";

import type { WebSearchToolOutput } from "@/runtime/chat/types";
import type { FetchLike } from "@/runtime/transport/transport-http";
import { normalizeGrokResponsesUrl } from "@/runtime/tools/grok-url";
import { ToolExecutionError } from "@/runtime/tools/tool-registry";
import {
  createWebSearchToolExecutor,
  parseHttpUrl,
  requestWebSearchJson,
  WEB_SEARCH_DEFAULT_TIMEOUT_MS,
} from "@/runtime/tools/web-search-client";
import { WEB_SEARCH_RESULT_COUNT } from "@/runtime/tools/web-search-settings";

const MAX_ANSWER_LENGTH = 12_000;
const annotationSchema = z
  .object({
    type: z.literal("url_citation"),
    url: z.string(),
    title: z.string().optional(),
    start_index: z.number().int().nonnegative().optional(),
    end_index: z.number().int().nonnegative().optional(),
  })
  .passthrough();
const outputTextSchema = z
  .object({
    type: z.literal("output_text"),
    text: z.string(),
    annotations: z.array(z.unknown()).default([]),
  })
  .passthrough();
const responseSchema = z
  .object({
    output_text: z.string().optional(),
    output: z
      .array(
        z
          .object({
            content: z.array(z.unknown()).default([]),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export interface GrokClientOptions {
  apiKey: string;
  responsesUrl: string;
  model: string;
  xSearch: boolean;
  maxResults: number;
  fetchImplementation?: FetchLike;
  timeoutMs?: number;
}

export function createGrokToolExecutor(options: GrokClientOptions) {
  const apiKey = z.string().trim().min(8).max(2_048).parse(options.apiKey);
  const responsesUrl = normalizeGrokResponsesUrl(options.responsesUrl);
  const model = z.string().trim().min(1).max(512).parse(options.model);
  const maxResults = z
    .number()
    .int()
    .min(WEB_SEARCH_RESULT_COUNT.min)
    .max(WEB_SEARCH_RESULT_COUNT.max)
    .parse(options.maxResults);
  const xSearch = z.boolean().parse(options.xSearch);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const timeoutMs = options.timeoutMs ?? WEB_SEARCH_DEFAULT_TIMEOUT_MS;

  return createWebSearchToolExecutor(async (query, signal) => {
    const { payload, status } = await requestWebSearchJson({
      access: { kind: "direct", apiKey, url: responsesUrl },
      body: {
        model,
        input: query,
        tools: [
          { type: "web_search" },
          ...(xSearch ? [{ type: "x_search" as const }] : []),
        ],
        store: false,
      },
      fetchImplementation,
      signal,
      timeoutMs,
    });
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ToolExecutionError("TOOL_REQUEST_FAILED", status);
    }
    const textParts = parsed.data.output.flatMap((item) =>
      item.content.flatMap((content) => {
        const parsedContent = outputTextSchema.safeParse(content);
        return parsedContent.success ? [parsedContent.data] : [];
      }),
    );
    const rawAnswer =
      textParts
        .map((part) => part.text.trim())
        .filter(Boolean)
        .join("\n") ||
      parsed.data.output_text?.trim() ||
      "";
    const answer = stripInlineCitationUrls(rawAnswer).slice(
      0,
      MAX_ANSWER_LENGTH,
    );
    const seenUrls = new Set<string>();
    const results = textParts
      .flatMap((part) =>
        part.annotations.flatMap((annotation) => {
          const parsedAnnotation = annotationSchema.safeParse(annotation);
          if (!parsedAnnotation.success) return [];
          const url = parseHttpUrl(parsedAnnotation.data.url);
          if (!url || seenUrls.has(url)) return [];
          seenUrls.add(url);
          return [
            {
              title:
                parsedAnnotation.data.title?.trim().slice(0, 300) ||
                new URL(url).hostname,
              url,
              content: citationContext(
                rawAnswer,
                parsedAnnotation.data.start_index,
                parsedAnnotation.data.end_index,
              ),
            },
          ];
        }),
      )
      .slice(0, maxResults);
    return {
      query,
      ...(answer ? { answer } : {}),
      results,
    } satisfies WebSearchToolOutput;
  });
}

function stripInlineCitationUrls(value: string): string {
  return value.replace(/\[\[(\d+)\]\]\(https?:\/\/[^\s)]+\)/giu, "[$1]");
}

function citationContext(
  answer: string,
  startIndex: number | undefined,
  endIndex: number | undefined,
): string {
  if (
    startIndex === undefined ||
    endIndex === undefined ||
    startIndex > endIndex ||
    startIndex > answer.length
  ) {
    return "Referenced by the Grok search response.";
  }
  const start = Math.max(0, startIndex - 160);
  const end = Math.min(answer.length, endIndex + 160);
  return stripInlineCitationUrls(answer.slice(start, end).trim()).slice(
    0,
    4_000,
  );
}
