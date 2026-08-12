import { z } from "zod";

import type { ToolCallPart } from "@/runtime/chat/types";
import { WEB_SEARCH_TOOL_NAME } from "@/runtime/tools/web-search-client";

const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  });
const webSearchSourceSchema = z
  .object({
    title: z.string(),
    url: httpUrlSchema,
    content: z.string(),
  })
  .strict();
const webSearchOutputSchema = z
  .object({
    query: z.string(),
    answer: z.string().optional(),
    results: z.array(z.unknown()),
  })
  .strict();

export interface WebSearchResultProjection {
  title: string;
  url: string;
  content: string;
}

export interface WebSearchToolProjection {
  query: string;
  answer?: string;
  results: WebSearchResultProjection[];
}

export function projectWebSearchTool(
  part: ToolCallPart,
): WebSearchToolProjection | null {
  if (
    part.name !== WEB_SEARCH_TOOL_NAME ||
    part.status !== "completed" ||
    part.output === null
  ) {
    return null;
  }
  const parsed = webSearchOutputSchema.safeParse(part.output);
  if (!parsed.success) return null;
  return {
    query: parsed.data.query,
    ...(parsed.data.answer === undefined ? {} : { answer: parsed.data.answer }),
    results: parsed.data.results.flatMap((result) => {
      const source = webSearchSourceSchema.safeParse(result);
      return source.success ? [source.data] : [];
    }),
  };
}
