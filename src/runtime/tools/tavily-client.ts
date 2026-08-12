import { z } from "zod";

import type { WebSearchToolOutput } from "@/runtime/chat/types";
import type { FetchLike } from "@/runtime/transport/transport-http";
import {
  ToolExecutionError,
  type ToolExecutor,
} from "@/runtime/tools/tool-registry";
import {
  buildTavilySearchUrl,
  normalizeTavilyBaseUrl,
} from "@/runtime/tools/tavily-url";
import {
  createHostedWebSearchToolExecutor,
  createWebSearchToolExecutor,
  HOSTED_WEB_SEARCH_URL,
  parseHttpUrl,
  requestWebSearchJson,
  WEB_SEARCH_DEFAULT_TIMEOUT_MS,
} from "@/runtime/tools/web-search-client";
import { WEB_SEARCH_RESULT_COUNT } from "@/runtime/tools/web-search-settings";

export const HOSTED_TAVILY_SEARCH_URL = HOSTED_WEB_SEARCH_URL;
const responseSchema = z
  .object({
    query: z.string().optional(),
    results: z
      .array(
        z
          .object({
            title: z.string().optional(),
            url: z.string().optional(),
            content: z.string().optional(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();
interface SharedTavilyClientOptions {
  maxResults: number;
  fetchImplementation?: FetchLike;
  timeoutMs?: number;
}

export type TavilyClientOptions = SharedTavilyClientOptions &
  (
    | { mode?: "direct"; apiKey: string; baseUrl: string }
    | {
        mode: "hosted";
        apiKey?: never;
        onUnauthorized?: () => void;
      }
  );

export function createTavilyToolExecutor(
  options: TavilyClientOptions,
): ToolExecutor {
  const maxResults = z
    .number()
    .int()
    .min(WEB_SEARCH_RESULT_COUNT.min)
    .max(WEB_SEARCH_RESULT_COUNT.max)
    .parse(options.maxResults);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const timeoutMs = options.timeoutMs ?? WEB_SEARCH_DEFAULT_TIMEOUT_MS;
  if (options.mode === "hosted") {
    return createHostedWebSearchToolExecutor({
      maxResults,
      provider: "tavily",
      fetchImplementation,
      timeoutMs,
      ...(options.onUnauthorized
        ? { onUnauthorized: options.onUnauthorized }
        : {}),
    });
  }
  const apiKey = z.string().trim().min(8).max(2_048).parse(options.apiKey);
  const baseUrl = normalizeTavilyBaseUrl(options.baseUrl);
  return createWebSearchToolExecutor(async (query, signal) => {
    const { payload: responseBody, status } = await requestWebSearchJson({
      access: {
        kind: "direct",
        apiKey,
        url: buildTavilySearchUrl(baseUrl),
      },
      body: { query, max_results: maxResults },
      fetchImplementation,
      signal,
      timeoutMs,
    });
    const payload = responseSchema.safeParse(responseBody);
    if (!payload.success) {
      throw new ToolExecutionError("TOOL_REQUEST_FAILED", status);
    }
    return {
      query,
      results: payload.data.results
        .flatMap((result) => {
          const url = parseHttpUrl(result.url);
          return url
            ? [
                {
                  title: result.title?.trim().slice(0, 300) ?? "",
                  url,
                  content: result.content?.trim().slice(0, 4_000) ?? "",
                },
              ]
            : [];
        })
        .slice(0, maxResults),
    } satisfies WebSearchToolOutput;
  });
}
