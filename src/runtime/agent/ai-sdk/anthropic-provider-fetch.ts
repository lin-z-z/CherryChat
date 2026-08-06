import type { ChatTransportConnection } from "@/runtime/transport/chat-transport-factory";
import { ChatTransportError } from "@/runtime/transport/chat-errors";
import { normalizeAnthropicBaseUrl } from "@/runtime/transport/anthropic-transport";
import {
  chatTimeouts,
  type RequestTimeoutPolicy,
} from "@/runtime/transport/request-timeout-policy";
import {
  fetchUpstream,
  isMixedContentUrl,
  type FetchLike,
} from "@/runtime/transport/transport-http";

export interface AnthropicAgentProviderOptions {
  name: "anthropic";
  baseURL: string;
  apiKey: string;
  headers?: Record<string, string>;
  fetch: FetchLike;
}

export function createAnthropicAgentProviderOptions(
  connection: ChatTransportConnection,
  modelId: string,
  timeoutPolicy: RequestTimeoutPolicy,
  disabledThinking: boolean,
  fetchImplementation: FetchLike = fetch,
): AnthropicAgentProviderOptions {
  if (connection.mode !== "byok" || !connection.baseUrl.trim()) {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "Anthropic requires a direct Custom API URL",
      null,
    );
  }
  if (!connection.apiKey.trim()) {
    throw new ChatTransportError(
      "UNAUTHORIZED",
      "A BYOK API key is required",
      null,
    );
  }
  if (
    connection.apiType !== "anthropic" &&
    !(
      connection.apiType === "new-api" &&
      connection.endpointType === "anthropic"
    )
  ) {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "The selected endpoint is not Anthropic",
      null,
    );
  }

  const normalizedBaseUrl = normalizeAnthropicBaseUrl(connection.baseUrl);
  const baseURL = `${normalizedBaseUrl}/v1`;
  return {
    name: "anthropic",
    baseURL,
    apiKey: connection.apiKey,
    ...(connection.apiType === "new-api"
      ? { headers: { Authorization: `Bearer ${connection.apiKey}` } }
      : {}),
    fetch: createControlledAnthropicFetch({
      baseURL,
      modelId,
      disabledThinking,
      timeoutPolicy,
      fetchImplementation,
      isMixedContent: () => isMixedContentUrl(normalizedBaseUrl),
    }),
  };
}

interface ControlledAnthropicFetchOptions {
  baseURL: string;
  modelId: string;
  disabledThinking: boolean;
  timeoutPolicy: RequestTimeoutPolicy;
  fetchImplementation: FetchLike;
  isMixedContent: () => boolean;
}

function createControlledAnthropicFetch(
  options: ControlledAnthropicFetchOptions,
): FetchLike {
  const baseUrl = new URL(options.baseURL);
  const expectedPath = `${baseUrl.pathname.replace(/\/$/u, "")}/messages`;
  return async (input, init = {}) => {
    const requestedUrl = parseRequestedUrl(input);
    if (
      requestedUrl.origin !== baseUrl.origin ||
      requestedUrl.pathname !== expectedPath ||
      requestedUrl.search ||
      requestedUrl.hash ||
      requestMethod(input, init) !== "POST"
    ) {
      throw invalidRequest();
    }
    const body = parseRequestBody(init.body);
    if (body.model !== options.modelId) throw invalidRequest();
    assertFunctionToolsOnly(body.tools);
    const wireBody = options.disabledThinking
      ? { ...body, thinking: { type: "disabled" } }
      : body;
    const headers = new Headers(init.headers);
    headers.set(
      "Accept",
      body.stream === true ? "text/event-stream" : "application/json",
    );
    return fetchUpstream(
      requestedUrl.toString(),
      {
        ...init,
        method: "POST",
        headers,
        body: JSON.stringify(wireBody),
        cache: "no-store",
      },
      options.fetchImplementation,
      options.isMixedContent,
      chatTimeouts(options.timeoutPolicy),
    );
  };
}

function assertFunctionToolsOnly(tools: unknown): void {
  if (tools === undefined) return;
  if (!Array.isArray(tools)) throw invalidRequest();
  for (const tool of tools) {
    if (
      typeof tool !== "object" ||
      tool === null ||
      Array.isArray(tool) ||
      "type" in tool ||
      !("name" in tool) ||
      typeof tool.name !== "string" ||
      !("input_schema" in tool) ||
      typeof tool.input_schema !== "object" ||
      tool.input_schema === null ||
      Array.isArray(tool.input_schema)
    ) {
      throw invalidRequest();
    }
  }
}

function parseRequestBody(
  body: BodyInit | null | undefined,
): Record<string, unknown> {
  if (typeof body !== "string") throw invalidRequest();
  try {
    const value: unknown = JSON.parse(body);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // Fall through to one stable boundary error.
  }
  throw invalidRequest();
}

function requestMethod(input: RequestInfo | URL, init: RequestInit): string {
  return (init.method ?? (input instanceof Request ? input.method : "GET"))
    .toUpperCase()
    .trim();
}

function parseRequestedUrl(input: RequestInfo | URL): URL {
  try {
    if (input instanceof Request) return new URL(input.url);
    return new URL(input.toString());
  } catch {
    throw invalidRequest();
  }
}

function invalidRequest(): ChatTransportError {
  return new ChatTransportError(
    "INVALID_REQUEST",
    "The AI runtime generated an invalid Anthropic request",
    null,
  );
}
