import { ChatTransportError } from "@/runtime/transport/chat-errors";
import { openAIModelsResponseSchema } from "@/runtime/chat/schemas";
import type { ChatTransport } from "@/runtime/transport/chat-transport";
import type { ChatCompletionsRequest } from "@/runtime/chat/chat-completions-contract";
import type { OpenAIChatReasoningContextPart } from "@/runtime/chat/types";
import {
  chatTimeouts,
  DEFAULT_REQUEST_TIMEOUT_POLICY,
  modelListTimeouts,
  type RequestTimeoutPolicy,
} from "@/runtime/transport/request-timeout-policy";
import {
  encodeOpenAIChatReasoning,
  getOpenAIChatReasoningContextProvider,
} from "@/runtime/transport/reasoning-wire";
import { hostedAccessCodeHeaders } from "@/runtime/transport/hosted-auth";
import { parseNativeJson } from "@/runtime/transport/native-response";
import { MODEL_LIST_RESPONSE_MAX_BYTES } from "@/runtime/transport/response-reader";
import {
  assertSuccessful,
  fetchUpstream,
  isMixedContentUrl,
  normalizeHttpBaseUrl,
  type FetchLike,
} from "@/runtime/transport/transport-http";

export type OpenAICompatibleTransport = ChatTransport;

export function createByokDirectTransport(
  baseUrl: string,
  apiKey: string,
  fetchImplementation: FetchLike = fetch,
  timeoutPolicy: RequestTimeoutPolicy = DEFAULT_REQUEST_TIMEOUT_POLICY,
): OpenAICompatibleTransport {
  const normalizedBaseUrl = normalizeDirectBaseUrl(baseUrl);
  return createTransport(
    {
      modelsUrl: `${normalizedBaseUrl}/v1/models`,
      chatUrl: `${normalizedBaseUrl}/v1/chat/completions`,
      headers: () => ({ Authorization: `Bearer ${apiKey}` }),
      isMixedContent: () => isMixedContentUrl(normalizedBaseUrl),
    },
    fetchImplementation,
    timeoutPolicy,
  );
}

export interface SameOriginTransportCredentials {
  mode: "byok" | "hosted";
  apiKey: string | null;
  accessCode?: string | null | undefined;
}

export function createSameOriginTransport(
  credentials: SameOriginTransportCredentials,
  fetchImplementation: FetchLike = fetch,
  timeoutPolicy: RequestTimeoutPolicy = DEFAULT_REQUEST_TIMEOUT_POLICY,
): OpenAICompatibleTransport {
  const { mode, apiKey } = credentials;
  if (mode === "byok" && !apiKey) {
    throw new ChatTransportError(
      "UNAUTHORIZED",
      "A BYOK API key is required",
      null,
    );
  }
  return createTransport(
    {
      modelsUrl: "/api/models",
      chatUrl: "/api/chat",
      headers: () => ({
        "X-CherryChat-Mode": mode,
        ...(mode === "byok" ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...hostedAccessCodeHeaders(credentials),
      }),
      isMixedContent: () => false,
    },
    fetchImplementation,
    timeoutPolicy,
  );
}

interface TransportConfiguration {
  modelsUrl: string;
  chatUrl: string;
  headers: () => Record<string, string>;
  isMixedContent: () => boolean;
}

function createTransport(
  configuration: TransportConfiguration,
  fetchImplementation: FetchLike,
  timeoutPolicy: RequestTimeoutPolicy,
): OpenAICompatibleTransport {
  return {
    async listModels(signal) {
      const response = await fetchUpstream(
        configuration.modelsUrl,
        {
          method: "GET",
          headers: configuration.headers(),
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
        configuration.chatUrl,
        {
          method: "POST",
          headers: {
            ...configuration.headers(),
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(toOpenAIChatRequest(request)),
          cache: "no-store",
          ...(signal ? { signal } : {}),
        },
        fetchImplementation,
        configuration.isMixedContent,
        chatTimeouts(timeoutPolicy),
      );
      await assertSuccessful(response);
      return response;
    },
  };
}

function toOpenAIChatRequest(request: ChatCompletionsRequest) {
  const {
    reasoning,
    messages,
    temperature,
    top_p,
    thinking: _thinking,
    enable_thinking: _enableThinking,
    reasoning_effort: _reasoningEffort,
    ...wireRequest
  } = request;
  void _thinking;
  void _enableThinking;
  void _reasoningEffort;
  const reasoningWire = encodeOpenAIChatReasoning(request.model, reasoning);
  const reasoningContentProvider = getOpenAIChatReasoningContextProvider(
    request.model,
    reasoning,
  );
  return {
    ...wireRequest,
    ...(!reasoningWire.suppressSampling && temperature !== undefined
      ? { temperature }
      : {}),
    ...(!reasoningWire.suppressSampling && top_p !== undefined
      ? { top_p }
      : {}),
    messages: messages.map((message) => {
      if (message.role === "tool") {
        return {
          role: message.role,
          content: message.content,
          tool_call_id: message.tool_call_id,
        };
      }
      if (message.role === "assistant") {
        const reasoningContent = reasoningContentProvider
          ? (message.providerContext ?? [])
              .filter(
                (context): context is OpenAIChatReasoningContextPart =>
                  context.provider === reasoningContentProvider,
              )
              .sort((left, right) => left.step - right.step)
              .map(({ text }) => text)
              .join("\n\n")
          : "";
        return {
          role: message.role,
          content: message.content,
          ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
          ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
        };
      }
      return message;
    }),
    ...(reasoningWire.thinking ? { thinking: reasoningWire.thinking } : {}),
    ...(reasoningWire.enableThinking === undefined
      ? {}
      : { enable_thinking: reasoningWire.enableThinking }),
    ...(reasoningWire.reasoningEffort === undefined
      ? {}
      : { reasoning_effort: reasoningWire.reasoningEffort }),
  };
}

export function normalizeDirectBaseUrl(value: string): string {
  return normalizeHttpBaseUrl(value, ["/v1"]);
}
