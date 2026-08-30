import type {
  ChatApiType,
  ChatEndpointType,
  ConnectionMode,
} from "@/runtime/chat/types";
import {
  createAnthropicDirectTransport,
  normalizeAnthropicBaseUrl,
} from "@/runtime/transport/anthropic-transport";
import type { ChatTransport } from "@/runtime/transport/chat-transport";
import {
  createGeminiDirectTransport,
  normalizeGeminiBaseUrl,
} from "@/runtime/transport/gemini-transport";
import {
  createByokDirectTransport,
  createSameOriginTransport,
  normalizeDirectBaseUrl,
} from "@/runtime/transport/openai-transport";
import {
  createOpenAIResponsesTransport,
  normalizeOpenAIResponsesBaseUrl,
} from "@/runtime/transport/openai-responses-transport";
import type { FetchLike } from "@/runtime/transport/transport-http";
import {
  DEFAULT_REQUEST_TIMEOUT_POLICY,
  type RequestTimeoutPolicy,
} from "@/runtime/transport/request-timeout-policy";

export interface ChatTransportConnection {
  mode: ConnectionMode;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  apiType: ChatApiType;
  endpointType?: ChatEndpointType | undefined;
  /** Hosted credential sent only to same-origin CherryChat routes. */
  accessCode?: string | undefined;
}

export function createChatTransport(
  connection: ChatTransportConnection,
  fetchImplementation: FetchLike = fetch,
  timeoutPolicy: RequestTimeoutPolicy = DEFAULT_REQUEST_TIMEOUT_POLICY,
): ChatTransport {
  if (connection.mode === "hosted") {
    return createSameOriginTransport(
      { mode: "hosted", apiKey: null, accessCode: connection.accessCode },
      fetchImplementation,
      timeoutPolicy,
    );
  }

  if (connection.apiType === "new-api") {
    return createNewApiTransport(
      connection,
      fetchImplementation,
      timeoutPolicy,
    );
  }

  if (connection.apiType === "gemini") {
    return createGeminiDirectTransport(
      connection.baseUrl,
      connection.apiKey,
      fetchImplementation,
      timeoutPolicy,
    );
  }

  if (connection.apiType === "anthropic") {
    return createAnthropicDirectTransport(
      connection.baseUrl,
      connection.apiKey,
      connection.modelId,
      fetchImplementation,
      timeoutPolicy,
    );
  }

  if (connection.apiType === "openai-responses") {
    return createOpenAIResponsesTransport(
      connection.baseUrl,
      connection.apiKey,
      fetchImplementation,
      timeoutPolicy,
    );
  }

  if (!connection.baseUrl.trim()) {
    return createSameOriginTransport(
      { mode: "byok", apiKey: connection.apiKey },
      fetchImplementation,
      timeoutPolicy,
    );
  }

  return createByokDirectTransport(
    connection.baseUrl,
    connection.apiKey,
    fetchImplementation,
    timeoutPolicy,
  );
}

function createNewApiTransport(
  connection: ChatTransportConnection,
  fetchImplementation: FetchLike,
  timeoutPolicy: RequestTimeoutPolicy,
): ChatTransport {
  const discovery = createByokDirectTransport(
    connection.baseUrl,
    connection.apiKey,
    fetchImplementation,
    timeoutPolicy,
  );
  let execution: ChatTransport = discovery;
  if (connection.endpointType === "openai-responses") {
    execution = createOpenAIResponsesTransport(
      connection.baseUrl,
      connection.apiKey,
      fetchImplementation,
      timeoutPolicy,
    );
  } else if (connection.endpointType === "anthropic") {
    execution = createAnthropicDirectTransport(
      connection.baseUrl,
      connection.apiKey,
      connection.modelId,
      fetchImplementation,
      timeoutPolicy,
      { includeBearerAuthorization: true },
    );
  } else if (connection.endpointType === "gemini") {
    execution = createGeminiDirectTransport(
      connection.baseUrl,
      connection.apiKey,
      fetchImplementation,
      timeoutPolicy,
      { includeBearerAuthorization: true },
    );
  }
  return {
    listModels: (signal) => discovery.listModels(signal),
    createChatCompletion: (request, signal) =>
      execution.createChatCompletion(request, signal),
  };
}

export function normalizeApiBaseUrl(
  apiType: ChatApiType,
  value: string,
): string {
  if (apiType === "gemini") {
    return normalizeGeminiBaseUrl(value);
  }
  if (apiType === "anthropic") {
    return normalizeAnthropicBaseUrl(value);
  }
  if (apiType === "openai-responses") {
    return normalizeOpenAIResponsesBaseUrl(value);
  }
  return normalizeDirectBaseUrl(value);
}
