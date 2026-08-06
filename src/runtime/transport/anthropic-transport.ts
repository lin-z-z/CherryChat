import { z } from "zod";

import type {
  ChatCompletionImagePart,
  ChatCompletionsRequest,
} from "@/runtime/chat/chat-completions-contract";
import { resolveAnthropicRequestSettings } from "@/runtime/transport/anthropic-reasoning";
import { ChatTransportError } from "@/runtime/transport/chat-errors";
import type { ChatTransport } from "@/runtime/transport/chat-transport";
import {
  chatTimeouts,
  DEFAULT_REQUEST_TIMEOUT_POLICY,
  modelListTimeouts,
  type RequestTimeoutPolicy,
} from "@/runtime/transport/request-timeout-policy";
import {
  assertSuccessful,
  fetchUpstream,
  isMixedContentUrl,
  normalizeHttpBaseUrl,
  type FetchLike,
} from "@/runtime/transport/transport-http";
import { parseNativeJson } from "@/runtime/transport/native-response";
import {
  MAX_MODEL_LIST_ITEMS,
  MODEL_LIST_RESPONSE_MAX_BYTES,
} from "@/runtime/transport/response-reader";
import { parseToolArguments } from "@/runtime/transport/tool-wire";

const anthropicModelsSchema = z
  .object({
    data: z
      .array(z.object({ id: z.string().min(1) }).passthrough())
      .max(MAX_MODEL_LIST_ITEMS),
  })
  .passthrough();

const anthropicResponseSchema = z
  .object({
    content: z
      .array(
        z
          .object({
            type: z.string(),
            id: z.string().optional(),
            name: z.string().optional(),
            input: z.record(z.string(), z.unknown()).optional(),
            text: z.string().optional(),
            thinking: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    usage: z
      .object({
        input_tokens: z.number().int().nonnegative().optional(),
        output_tokens: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export function createAnthropicDirectTransport(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  fetchImplementation: FetchLike = fetch,
  timeoutPolicy: RequestTimeoutPolicy = DEFAULT_REQUEST_TIMEOUT_POLICY,
  options: { includeBearerAuthorization?: boolean } = {},
): ChatTransport {
  const normalizedBaseUrl = normalizeAnthropicBaseUrl(baseUrl);
  const configuration = {
    isMixedContent: () => isMixedContentUrl(normalizedBaseUrl),
  };

  return {
    async listModels(signal) {
      const response = await fetchUpstream(
        `${normalizedBaseUrl}/v1/models`,
        {
          method: "GET",
          headers: anthropicHeaders(apiKey, options),
          cache: "no-store",
          ...(signal ? { signal } : {}),
        },
        fetchImplementation,
        configuration.isMixedContent,
        modelListTimeouts(timeoutPolicy),
      );
      if (response.status === 404) return { data: [{ id: modelId }] };
      await assertSuccessful(response);
      return parseNativeJson(
        response,
        anthropicModelsSchema,
        "Anthropic model list",
        MODEL_LIST_RESPONSE_MAX_BYTES,
      );
    },

    async createChatCompletion(request, signal) {
      const response = await fetchUpstream(
        `${normalizedBaseUrl}/v1/messages`,
        {
          method: "POST",
          headers: {
            ...anthropicHeaders(apiKey, options),
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(toAnthropicRequest(request)),
          cache: "no-store",
          ...(signal ? { signal } : {}),
        },
        fetchImplementation,
        configuration.isMixedContent,
        chatTimeouts(timeoutPolicy),
      );
      await assertSuccessful(response);
      return normalizeAnthropicCompletionResponse(response);
    },
  };
}

export function normalizeAnthropicBaseUrl(value: string): string {
  return normalizeHttpBaseUrl(value, ["/v1"]);
}

function anthropicHeaders(
  apiKey: string,
  options: { includeBearerAuthorization?: boolean },
): Record<string, string> {
  return {
    ...(options.includeBearerAuthorization
      ? { Authorization: `Bearer ${apiKey}` }
      : {}),
    "anthropic-version": "2023-06-01",
    "x-api-key": apiKey,
  };
}

function toAnthropicRequest(request: ChatCompletionsRequest) {
  const system = request.messages.find(({ role }) => role === "system");
  const settings = resolveAnthropicRequestSettings(request);
  return {
    model: request.model,
    max_tokens: settings.wireMaxTokens,
    stream: request.stream,
    messages: request.messages.flatMap((message) =>
      message.role === "system" ? [] : [toAnthropicMessage(message)],
    ),
    ...(request.tools
      ? {
          tools: request.tools.map(({ function: definition }) => ({
            name: definition.name,
            description: definition.description,
            input_schema: definition.parameters,
          })),
          tool_choice: { type: "auto" },
        }
      : {}),
    ...(system ? { system: system.content } : {}),
    ...(settings.temperature === undefined
      ? {}
      : { temperature: settings.temperature }),
    ...(settings.topP === undefined ? {} : { top_p: settings.topP }),
    ...(settings.thinking
      ? {
          thinking:
            settings.thinking.type === "enabled"
              ? {
                  type: "enabled",
                  budget_tokens: settings.thinking.budgetTokens,
                }
              : { type: settings.thinking.type },
        }
      : {}),
    ...(settings.effort ? { output_config: { effort: settings.effort } } : {}),
  };
}

function toAnthropicMessage(
  message: Exclude<
    ChatCompletionsRequest["messages"][number],
    { role: "system" }
  >,
) {
  if (message.role === "tool") {
    return {
      role: "user" as const,
      content: [
        {
          type: "tool_result" as const,
          tool_use_id: message.tool_call_id,
          content: message.content,
        },
      ],
    };
  }
  if (message.role === "assistant" && message.tool_calls?.length) {
    return {
      role: "assistant" as const,
      content: [
        ...(message.content
          ? [{ type: "text" as const, text: message.content }]
          : []),
        ...message.tool_calls.map((toolCall) => ({
          type: "tool_use" as const,
          id: toolCall.id,
          name: toolCall.function.name,
          input: parseToolArguments(toolCall.function.arguments),
        })),
      ],
    };
  }
  return {
    role: message.role,
    content: toAnthropicContent(message.content),
  };
}

function toAnthropicContent(
  content: ChatCompletionsRequest["messages"][number]["content"],
):
  | string
  | Array<
      | { type: "text"; text: string }
      | {
          type: "image";
          source: {
            type: "base64";
            media_type: string;
            data: string;
          };
        }
    > {
  if (content === null) return "";
  if (typeof content === "string") return content;
  const parts: Array<
    | { type: "text"; text: string }
    | {
        type: "image";
        source: { type: "base64"; media_type: string; data: string };
      }
  > = [];
  for (const part of content) {
    if (part.type === "text") {
      parts.push({ type: "text", text: part.text });
      continue;
    }
    const source = toImageSource(part);
    if (source) parts.push({ type: "image", source });
  }
  return parts;
}

function toImageSource(part: ChatCompletionImagePart) {
  const match = /^data:([^;,]+);base64,(.+)$/u.exec(part.image_url.url);
  return match
    ? {
        type: "base64" as const,
        media_type: match[1] ?? "application/octet-stream",
        data: match[2] ?? "",
      }
    : null;
}

async function normalizeAnthropicCompletionResponse(
  response: Response,
): Promise<Response> {
  const parsed = await parseNativeJson(
    response,
    anthropicResponseSchema,
    "Anthropic completion response",
  );
  const content = (parsed.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
  const reasoningContent = (parsed.content ?? [])
    .filter((part) => part.type === "thinking")
    .map((part) => part.thinking ?? "")
    .join("");
  const toolCalls = (parsed.content ?? [])
    .filter((part) => part.type === "tool_use")
    .map((part) => {
      if (!part.id || !part.name) {
        throw new ChatTransportError(
          "STREAM_PROTOCOL_ERROR",
          "Anthropic completion response has an incomplete tool call",
          response.status,
        );
      }
      return {
        id: part.id,
        type: "function" as const,
        function: {
          name: part.name,
          arguments: JSON.stringify(part.input ?? {}),
        },
      };
    });
  return Response.json({
    choices: [
      {
        message: {
          content,
          reasoning_content: reasoningContent,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    ...(parsed.usage
      ? {
          usage: {
            ...(parsed.usage.input_tokens === undefined
              ? {}
              : { prompt_tokens: parsed.usage.input_tokens }),
            ...(parsed.usage.output_tokens === undefined
              ? {}
              : { completion_tokens: parsed.usage.output_tokens }),
            ...(parsed.usage.input_tokens === undefined ||
            parsed.usage.output_tokens === undefined
              ? {}
              : {
                  total_tokens:
                    parsed.usage.input_tokens + parsed.usage.output_tokens,
                }),
          },
        }
      : {}),
  });
}
