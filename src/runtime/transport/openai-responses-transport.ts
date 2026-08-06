import { z } from "zod";

import type {
  ChatCompletionImagePart,
  ChatCompletionsRequest,
} from "@/runtime/chat/chat-completions-contract";
import { openAIModelsResponseSchema } from "@/runtime/chat/schemas";
import { ChatTransportError } from "@/runtime/transport/chat-errors";
import { toOpenAIReasoningEffort } from "@/runtime/transport/reasoning-wire";
import type { ChatTransport } from "@/runtime/transport/chat-transport";
import {
  chatTimeouts,
  DEFAULT_REQUEST_TIMEOUT_POLICY,
  modelListTimeouts,
  type RequestTimeoutPolicy,
} from "@/runtime/transport/request-timeout-policy";
import { parseNativeJson } from "@/runtime/transport/native-response";
import { MODEL_LIST_RESPONSE_MAX_BYTES } from "@/runtime/transport/response-reader";
import {
  assertSuccessful,
  fetchUpstream,
  isMixedContentUrl,
  normalizeHttpBaseUrl,
  type FetchLike,
} from "@/runtime/transport/transport-http";

const responsesOutputPartSchema = z
  .object({
    type: z.string(),
    id: z.string().optional(),
    call_id: z.string().optional(),
    name: z.string().optional(),
    arguments: z.string().optional(),
    text: z.string().optional(),
    summary: z
      .array(z.object({ type: z.string(), text: z.string().optional() }))
      .optional(),
    content: z
      .array(z.object({ type: z.string(), text: z.string().optional() }))
      .optional(),
  })
  .passthrough();

const responsesResponseSchema = z
  .object({
    status: z.string().optional(),
    output: z.array(responsesOutputPartSchema).optional(),
    output_text: z.string().optional(),
    usage: z
      .object({
        input_tokens: z.number().int().nonnegative().optional(),
        output_tokens: z.number().int().nonnegative().optional(),
        total_tokens: z.number().int().nonnegative().optional(),
        output_tokens_details: z
          .object({
            reasoning_tokens: z.number().int().nonnegative().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

type ResponsesInputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };

export function createOpenAIResponsesTransport(
  baseUrl: string,
  apiKey: string,
  fetchImplementation: FetchLike = fetch,
  timeoutPolicy: RequestTimeoutPolicy = DEFAULT_REQUEST_TIMEOUT_POLICY,
): ChatTransport {
  const normalizedBaseUrl = normalizeOpenAIResponsesBaseUrl(baseUrl);
  const configuration = {
    isMixedContent: () => isMixedContentUrl(normalizedBaseUrl),
  };

  return {
    async listModels(signal) {
      const response = await fetchUpstream(
        `${normalizedBaseUrl}/v1/models`,
        {
          method: "GET",
          headers: authorizationHeaders(apiKey),
          cache: "no-store",
          ...(signal ? { signal } : {}),
        },
        fetchImplementation,
        configuration.isMixedContent,
        modelListTimeouts(timeoutPolicy),
      );
      await assertSuccessful(response);
      return parseNativeJson(
        response,
        openAIModelsResponseSchema,
        "OpenAI model list",
        MODEL_LIST_RESPONSE_MAX_BYTES,
      );
    },

    async createChatCompletion(request, signal) {
      const response = await fetchUpstream(
        `${normalizedBaseUrl}/v1/responses`,
        {
          method: "POST",
          headers: {
            ...authorizationHeaders(apiKey),
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(toResponsesRequest(request)),
          cache: "no-store",
          ...(signal ? { signal } : {}),
        },
        fetchImplementation,
        configuration.isMixedContent,
        chatTimeouts(timeoutPolicy),
      );
      await assertSuccessful(response);
      return normalizeResponsesCompletionResponse(response);
    },
  };
}

export function normalizeOpenAIResponsesBaseUrl(value: string): string {
  return normalizeHttpBaseUrl(value, ["/v1"]);
}

function authorizationHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

function toResponsesRequest(request: ChatCompletionsRequest) {
  const system = request.messages.find(({ role }) => role === "system");
  const reasoningEffort = toOpenAIReasoningEffort(request);
  const input = request.messages
    .filter(({ role }) => role !== "system")
    .flatMap((message) => toResponsesInput(message));

  return {
    model: request.model,
    ...(system ? { instructions: system.content } : {}),
    input,
    stream: request.stream,
    store: false,
    ...(request.max_tokens === undefined
      ? {}
      : { max_output_tokens: request.max_tokens }),
    ...(request.temperature === undefined
      ? {}
      : { temperature: request.temperature }),
    ...(request.top_p === undefined ? {} : { top_p: request.top_p }),
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    ...(request.tools
      ? {
          tools: request.tools.map(({ function: definition }) => ({
            type: "function",
            name: definition.name,
            description: definition.description,
            parameters: definition.parameters,
            strict: true,
          })),
          tool_choice: "auto",
        }
      : {}),
  };
}

function toResponsesInput(
  message: ChatCompletionsRequest["messages"][number],
): Array<Record<string, unknown>> {
  if (message.role === "tool") {
    return [
      {
        type: "function_call_output",
        call_id: message.tool_call_id,
        output: message.content,
      },
    ];
  }
  if (message.role === "assistant" && message.tool_calls?.length) {
    return [
      ...(message.content
        ? [{ role: "assistant", content: message.content }]
        : []),
      ...message.tool_calls.map((toolCall) => ({
        type: "function_call",
        call_id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      })),
    ];
  }
  return [
    {
      role: message.role,
      content: toResponsesContent(message.content),
    },
  ];
}

function toResponsesContent(
  content: ChatCompletionsRequest["messages"][number]["content"],
): string | ResponsesInputContent[] {
  if (content === null) return "";
  if (typeof content === "string") return content;
  const items: ResponsesInputContent[] = [];
  for (const part of content) {
    if (part.type === "text") {
      items.push({ type: "input_text", text: part.text });
      continue;
    }
    const image = toInputImage(part);
    if (image) items.push(image);
  }
  return items;
}

function toInputImage(part: ChatCompletionImagePart) {
  return {
    type: "input_image" as const,
    image_url: part.image_url.url,
  };
}

async function normalizeResponsesCompletionResponse(
  response: Response,
): Promise<Response> {
  const parsed = await parseNativeJson(
    response,
    responsesResponseSchema,
    "OpenAI Responses completion",
  );
  if (parsed.status === "failed") {
    throw new ChatTransportError(
      "STREAM_PROTOCOL_ERROR",
      "OpenAI Responses completion reported failure",
      response.status,
    );
  }
  let content = "";
  let reasoningContent = "";
  const toolCalls: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }> = [];
  for (const part of parsed.output ?? []) {
    if (part.type === "reasoning") {
      reasoningContent += (part.summary ?? [])
        .map(({ text }) => text ?? "")
        .join("");
      continue;
    }
    if (part.type === "message") {
      content += (part.content ?? [])
        .filter(({ type }) => type === "output_text")
        .map(({ text }) => text ?? "")
        .join("");
      continue;
    }
    if (part.type === "function_call") {
      const id = part.call_id ?? part.id;
      if (!id || !part.name) {
        throw new ChatTransportError(
          "STREAM_PROTOCOL_ERROR",
          "OpenAI Responses completion has an incomplete tool call",
          response.status,
        );
      }
      toolCalls.push({
        id,
        type: "function",
        function: {
          name: part.name,
          arguments: part.arguments ?? "{}",
        },
      });
    }
  }
  if (!content) content = parsed.output_text ?? "";
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
    ...(parsed.usage ? { usage: toOpenAIUsage(parsed.usage) } : {}),
  });
}

function toOpenAIUsage(usage: {
  input_tokens?: number | undefined;
  output_tokens?: number | undefined;
  total_tokens?: number | undefined;
  output_tokens_details?: { reasoning_tokens?: number | undefined } | undefined;
}) {
  return {
    ...(usage.input_tokens === undefined
      ? {}
      : { prompt_tokens: usage.input_tokens }),
    ...(usage.output_tokens === undefined
      ? {}
      : { completion_tokens: usage.output_tokens }),
    ...(usage.total_tokens === undefined
      ? {}
      : { total_tokens: usage.total_tokens }),
    ...(usage.output_tokens_details?.reasoning_tokens === undefined
      ? {}
      : {
          completion_tokens_details: {
            reasoning_tokens: usage.output_tokens_details.reasoning_tokens,
          },
        }),
  };
}
