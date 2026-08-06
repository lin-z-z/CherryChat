import type { ChatTransportConnection } from "@/runtime/transport/chat-transport-factory";
import { ChatTransportError } from "@/runtime/transport/chat-errors";
import { normalizeOpenAIResponsesBaseUrl } from "@/runtime/transport/openai-responses-transport";
import {
  chatTimeouts,
  type RequestTimeoutPolicy,
} from "@/runtime/transport/request-timeout-policy";
import {
  fetchUpstream,
  isMixedContentUrl,
  type FetchLike,
} from "@/runtime/transport/transport-http";

export interface OpenAIResponsesAgentProviderOptions {
  baseURL: string;
  apiKey: string;
  fetch: FetchLike;
}

export function createOpenAIResponsesAgentProviderOptions(
  connection: ChatTransportConnection,
  timeoutPolicy: RequestTimeoutPolicy,
  fetchImplementation: FetchLike = fetch,
): OpenAIResponsesAgentProviderOptions {
  if (connection.mode !== "byok" || !connection.baseUrl.trim()) {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "OpenAI Responses requires a direct Custom API URL",
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
  const normalizedBaseUrl = normalizeOpenAIResponsesBaseUrl(connection.baseUrl);
  const baseURL = `${normalizedBaseUrl}/v1`;
  return {
    baseURL,
    apiKey: connection.apiKey,
    fetch: createControlledResponsesFetch({
      baseURL,
      targetUrl: `${baseURL}/responses`,
      timeoutPolicy,
      fetchImplementation,
      isMixedContent: () => isMixedContentUrl(normalizedBaseUrl),
    }),
  };
}

interface ControlledResponsesFetchOptions {
  baseURL: string;
  targetUrl: string;
  timeoutPolicy: RequestTimeoutPolicy;
  fetchImplementation: FetchLike;
  isMixedContent: () => boolean;
}

function createControlledResponsesFetch(
  options: ControlledResponsesFetchOptions,
): FetchLike {
  const expectedUrl = new URL(`${options.baseURL}/responses`);
  return async (input, init = {}) => {
    const requestedUrl = parseRequestedUrl(input);
    if (
      requestedUrl.origin !== expectedUrl.origin ||
      requestedUrl.pathname !== expectedUrl.pathname ||
      requestedUrl.search ||
      requestedUrl.hash ||
      requestMethod(input, init) !== "POST"
    ) {
      throw new ChatTransportError(
        "INVALID_REQUEST",
        "The AI runtime may only POST to OpenAI Responses",
        null,
      );
    }
    const body = parseRequestBody(init.body);
    assertStatelessResponsesRequest(body);
    const headers = new Headers(init.headers);
    headers.set(
      "Accept",
      body.stream === true ? "text/event-stream" : "application/json",
    );
    return fetchUpstream(
      options.targetUrl,
      { ...init, method: "POST", headers, cache: "no-store" },
      options.fetchImplementation,
      options.isMixedContent,
      chatTimeouts(options.timeoutPolicy),
    );
  };
}

function assertStatelessResponsesRequest(body: Record<string, unknown>): void {
  const include = Array.isArray(body.include) ? body.include : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const hasUnsupportedTool = tools.some(
    (tool) =>
      typeof tool !== "object" ||
      tool === null ||
      Array.isArray(tool) ||
      !("type" in tool) ||
      tool.type !== "function",
  );
  if (
    body.store !== false ||
    "previous_response_id" in body ||
    "conversation" in body ||
    !include.includes("reasoning.encrypted_content") ||
    hasUnsupportedTool
  ) {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "The Responses request violates the stateless runtime contract",
      null,
    );
  }
}

function parseRequestBody(
  body: BodyInit | null | undefined,
): Record<string, unknown> {
  if (typeof body !== "string") return invalidRequestBody();
  try {
    const value: unknown = JSON.parse(body);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // Fall through to one stable validation error.
  }
  return invalidRequestBody();
}

function invalidRequestBody(): never {
  throw new ChatTransportError(
    "INVALID_REQUEST",
    "The AI runtime generated an invalid Responses request",
    null,
  );
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
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "The AI runtime generated an invalid request URL",
      null,
    );
  }
}
