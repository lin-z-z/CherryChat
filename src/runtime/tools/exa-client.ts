import { z } from "zod";

import type { WebSearchToolOutput } from "@/runtime/chat/types";
import type { FetchLike } from "@/runtime/transport/transport-http";
import {
  buildExaSearchUrl,
  normalizeExaBaseUrl,
} from "@/runtime/tools/exa-url";
import { ToolExecutionError } from "@/runtime/tools/tool-registry";
import {
  createWebSearchToolExecutor,
  parseHttpUrl,
  requestWebSearchJson,
  WEB_SEARCH_DEFAULT_TIMEOUT_MS,
} from "@/runtime/tools/web-search-client";
import { WEB_SEARCH_RESULT_COUNT } from "@/runtime/tools/web-search-settings";

const responseSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            title: z.string().optional(),
            url: z.string().optional(),
            highlights: z.array(z.string()).optional(),
            text: z.string().optional(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export interface ExaClientOptions {
  apiKey: string;
  baseUrl: string;
  maxResults: number;
  fetchImplementation?: FetchLike;
  timeoutMs?: number;
}

export function createExaToolExecutor(options: ExaClientOptions) {
  const apiKey = z.string().trim().min(8).max(2_048).parse(options.apiKey);
  const baseUrl = normalizeExaBaseUrl(options.baseUrl);
  const maxResults = z
    .number()
    .int()
    .min(WEB_SEARCH_RESULT_COUNT.min)
    .max(WEB_SEARCH_RESULT_COUNT.max)
    .parse(options.maxResults);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const timeoutMs = options.timeoutMs ?? WEB_SEARCH_DEFAULT_TIMEOUT_MS;

  return createWebSearchToolExecutor(async (query, signal) => {
    const { payload, status } = await requestWebSearchJson({
      access: {
        kind: "direct",
        apiKey,
        url: buildExaSearchUrl(baseUrl),
      },
      body: {
        query,
        type: "auto",
        numResults: maxResults,
        contents: { highlights: true },
      },
      fetchImplementation,
      signal,
      timeoutMs,
    });
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ToolExecutionError("TOOL_REQUEST_FAILED", status);
    }
    return {
      query,
      results: parsed.data.results
        .flatMap((result) => {
          const url = parseHttpUrl(result.url);
          if (!url) return [];
          const highlights = result.highlights
            ?.map((highlight) => highlight.trim())
            .filter(Boolean)
            .join("\n");
          return [
            {
              title: result.title?.trim().slice(0, 300) ?? "",
              url,
              content: (highlights || result.text?.trim() || "").slice(
                0,
                4_000,
              ),
            },
          ];
        })
        .slice(0, maxResults),
    } satisfies WebSearchToolOutput;
  });
}
