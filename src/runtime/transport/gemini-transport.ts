import { z } from "zod";

import type {
  ChatCompletionImagePart,
  ChatCompletionsRequest,
} from "@/runtime/chat/chat-completions-contract";
import {
  resolveGeminiThinkingConfig,
  type GeminiThinkingConfig,
} from "@/runtime/transport/gemini-reasoning";
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
import {
  parseToolArguments,
  parseToolResult,
} from "@/runtime/transport/tool-wire";

const geminiModelsSchema = z
  .object({
    models: z
      .array(
        z
          .object({
            name: z.string().min(1),
            supportedGenerationMethods: z.array(z.string()).optional(),
          })
          .passthrough(),
      )
      .max(MAX_MODEL_LIST_ITEMS),
  })
  .passthrough();

const geminiResponseSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            content: z
              .object({
                parts: z
                  .array(
                    z
                      .object({
                        text: z.string().optional(),
                        thought: z.boolean().optional(),
                        functionCall: z
                          .object({
                            name: z.string().min(1),
                            args: z.record(z.string(), z.unknown()).optional(),
                          })
                          .passthrough()
                          .optional(),
                      })
                      .passthrough(),
                  )
                  .optional(),
              })
              .passthrough()
              .optional(),
            finishReason: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    usageMetadata: z
      .object({
        promptTokenCount: z.number().int().nonnegative().optional(),
        candidatesTokenCount: z.number().int().nonnegative().optional(),
        thoughtsTokenCount: z.number().int().nonnegative().optional(),
        totalTokenCount: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export function createGeminiDirectTransport(
  baseUrl: string,
  apiKey: string,
  fetchImplementation: FetchLike = fetch,
  timeoutPolicy: RequestTimeoutPolicy = DEFAULT_REQUEST_TIMEOUT_POLICY,
  options: { includeBearerAuthorization?: boolean } = {},
): ChatTransport {
  const normalizedBaseUrl = normalizeGeminiBaseUrl(baseUrl);
  const configuration = {
    isMixedContent: () => isMixedContentUrl(normalizedBaseUrl),
  };

  return {
    async listModels(signal) {
      const response = await fetchUpstream(
        `${normalizedBaseUrl}/v1beta/models?pageSize=1000`,
        {
          method: "GET",
          headers: geminiHeaders(apiKey, options),
          cache: "no-store",
          ...(signal ? { signal } : {}),
        },
        fetchImplementation,
        configuration.isMixedContent,
        modelListTimeouts(timeoutPolicy),
      );
      await assertSuccessful(response);
      const parsed = await parseNativeJson(
        response,
        geminiModelsSchema,
        "Gemini model list",
        MODEL_LIST_RESPONSE_MAX_BYTES,
      );
      return {
        data: parsed.models
          .filter((model) =>
            model.supportedGenerationMethods?.includes("generateContent"),
          )
          .map(({ name }) => ({ id: stripGeminiModelPrefix(name) })),
      };
    },

    async createChatCompletion(request, signal) {
      const model = stripGeminiModelPrefix(request.model);
      const response = await fetchUpstream(
        `${normalizedBaseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            ...geminiHeaders(apiKey, options),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(toGeminiRequest(request)),
          cache: "no-store",
          ...(signal ? { signal } : {}),
        },
        fetchImplementation,
        configuration.isMixedContent,
        chatTimeouts(timeoutPolicy),
      );
      await assertSuccessful(response);
      return normalizeGeminiCompletionResponse(response);
    },
  };
}

function geminiHeaders(
  apiKey: string,
  options: { includeBearerAuthorization?: boolean },
): Record<string, string> {
  return {
    ...(options.includeBearerAuthorization
      ? { Authorization: `Bearer ${apiKey}` }
      : {}),
    "x-goog-api-key": apiKey,
  };
}

export function normalizeGeminiBaseUrl(value: string): string {
  return normalizeHttpBaseUrl(value, ["/v1beta", "/v1"]);
}

function toGeminiRequest(request: ChatCompletionsRequest) {
  const system = request.messages.find(({ role }) => role === "system");
  const contents = request.messages.flatMap((message) =>
    message.role === "system" ? [] : [toGeminiContent(message)],
  );

  const thinkingChoice = request.reasoning;
  const thinkingConfig = resolveGeminiThinkingConfig(
    request.model,
    thinkingChoice,
  );
  return {
    ...(system
      ? { systemInstruction: { parts: [{ text: system.content }] } }
      : {}),
    contents,
    generationConfig: {
      ...(request.temperature === undefined
        ? {}
        : { temperature: request.temperature }),
      ...(request.top_p === undefined ? {} : { topP: request.top_p }),
      ...(thinkingConfig
        ? { thinkingConfig: toGeminiWireThinkingConfig(thinkingConfig) }
        : {}),
    },
    ...(request.tools
      ? {
          tools: [
            {
              functionDeclarations: request.tools.map(
                ({ function: definition }) => ({
                  name: definition.name,
                  description: definition.description,
                  parameters: definition.parameters,
                }),
              ),
            },
          ],
          toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        }
      : {}),
  };
}

function toGeminiContent(
  message: Exclude<
    ChatCompletionsRequest["messages"][number],
    { role: "system" }
  >,
) {
  if (message.role === "tool") {
    return {
      role: "user" as const,
      parts: [
        {
          functionResponse: {
            name: message.name,
            response: { output: parseToolResult(message.content) },
          },
        },
      ],
    };
  }
  if (message.role === "assistant" && message.tool_calls?.length) {
    return {
      role: "model" as const,
      parts: [
        ...(message.content ? [{ text: message.content }] : []),
        ...message.tool_calls.map((toolCall) => ({
          functionCall: {
            name: toolCall.function.name,
            args: parseToolArguments(toolCall.function.arguments),
          },
        })),
      ],
    };
  }
  return {
    role: message.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: toGeminiParts(message.content),
  };
}

function toGeminiWireThinkingConfig(config: GeminiThinkingConfig) {
  return {
    ...config,
    ...(config.thinkingLevel
      ? { thinkingLevel: config.thinkingLevel.toUpperCase() }
      : {}),
  };
}

function toGeminiParts(
  content: ChatCompletionsRequest["messages"][number]["content"],
): Array<
  { text: string } | { inlineData: { mimeType: string; data: string } }
> {
  if (content === null) return [];
  if (typeof content === "string") return [{ text: content }];
  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [];
  for (const part of content) {
    if (part.type === "text") {
      parts.push({ text: part.text });
      continue;
    }
    const inlineData = toInlineData(part);
    if (inlineData) parts.push({ inlineData });
  }
  return parts;
}

function toInlineData(part: ChatCompletionImagePart) {
  const url = part.image_url.url;
  const match = /^data:([^;,]+);base64,(.+)$/u.exec(url);
  return match
    ? { mimeType: match[1] ?? "application/octet-stream", data: match[2] ?? "" }
    : null;
}

async function normalizeGeminiCompletionResponse(
  response: Response,
): Promise<Response> {
  const parsed = await parseNativeJson(
    response,
    geminiResponseSchema,
    "Gemini completion response",
  );
  let content = "";
  let reasoningContent = "";
  const toolCalls: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }> = [];
  for (const part of parsed.candidates?.[0]?.content?.parts ?? []) {
    if (part.functionCall) {
      const index = toolCalls.length;
      toolCalls.push({
        id: `gemini-tool-${index}`,
        type: "function",
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        },
      });
      continue;
    }
    if (part.thought) reasoningContent += part.text ?? "";
    else content += part.text ?? "";
  }
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
    ...(parsed.usageMetadata
      ? { usage: toOpenAIUsage(parsed.usageMetadata) }
      : {}),
  });
}

function toOpenAIUsage(usage: {
  promptTokenCount?: number | undefined;
  candidatesTokenCount?: number | undefined;
  thoughtsTokenCount?: number | undefined;
  totalTokenCount?: number | undefined;
}) {
  return {
    ...(usage.promptTokenCount === undefined
      ? {}
      : { prompt_tokens: usage.promptTokenCount }),
    ...(usage.candidatesTokenCount === undefined
      ? {}
      : { completion_tokens: usage.candidatesTokenCount }),
    ...(usage.thoughtsTokenCount === undefined
      ? {}
      : {
          completion_tokens_details: {
            reasoning_tokens: usage.thoughtsTokenCount,
          },
        }),
    ...(usage.totalTokenCount === undefined
      ? {}
      : { total_tokens: usage.totalTokenCount }),
  };
}

function stripGeminiModelPrefix(value: string): string {
  return value.replace(/^models\//u, "");
}
