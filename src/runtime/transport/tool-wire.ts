import { z } from "zod";

import { jsonValueSchema } from "@/runtime/chat/schemas";
import type { JsonValue, ToolCallPart } from "@/runtime/chat/types";
import { ChatTransportError } from "@/runtime/transport/chat-errors";

const toolArgumentsSchema = z.record(z.string(), jsonValueSchema);

export function parseToolArguments(value: string): Record<string, JsonValue> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || "{}");
  } catch {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "Tool arguments are not valid JSON",
      null,
    );
  }
  const result = toolArgumentsSchema.safeParse(parsed);
  if (!result.success) {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "Tool arguments must be a JSON object",
      null,
    );
  }
  return result.data;
}

export function parseToolResult(value: string): JsonValue {
  try {
    const result = jsonValueSchema.safeParse(JSON.parse(value));
    return result.success ? result.data : value;
  } catch {
    return value;
  }
}

export function serializeToolResultForModel(
  part: Pick<ToolCallPart, "name" | "output" | "status" | "errorCode">,
): string {
  const output =
    part.status === "completed"
      ? projectToolOutput(part.name, part.output)
      : { error: part.errorCode };
  return JSON.stringify(output);
}

function projectToolOutput(name: string, output: JsonValue | null): JsonValue {
  if (name !== "web_search" || !isJsonObject(output)) return output;
  const results = output.results;
  if (!Array.isArray(results)) return output;
  return results.flatMap((result, index) => {
    if (!isJsonObject(result)) return [];
    return [
      {
        id: index + 1,
        title: typeof result.title === "string" ? result.title : "",
        url: typeof result.url === "string" ? result.url : "",
        content: typeof result.content === "string" ? result.content : "",
      },
    ];
  });
}

function isJsonObject(
  value: JsonValue | null,
): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
