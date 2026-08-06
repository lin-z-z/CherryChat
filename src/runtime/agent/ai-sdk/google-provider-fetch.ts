import type { GoogleGenerativeAIProviderSettings } from "@ai-sdk/google";

import type { ChatTransportConnection } from "@/runtime/transport/chat-transport-factory";
import { ChatTransportError } from "@/runtime/transport/chat-errors";
import { normalizeGeminiBaseUrl } from "@/runtime/transport/gemini-transport";
import {
  chatTimeouts,
  type RequestTimeoutPolicy,
} from "@/runtime/transport/request-timeout-policy";
import {
  fetchUpstream,
  isMixedContentUrl,
  type FetchLike,
} from "@/runtime/transport/transport-http";

export function createGoogleAgentProviderOptions(
  connection: ChatTransportConnection,
  modelId: string,
  timeoutPolicy: RequestTimeoutPolicy,
  fetchImplementation: FetchLike = fetch,
): GoogleGenerativeAIProviderSettings {
  if (connection.mode !== "byok" || !connection.baseUrl.trim()) {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "Gemini requires a direct Custom API URL",
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
    connection.apiType !== "gemini" &&
    !(connection.apiType === "new-api" && connection.endpointType === "gemini")
  ) {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "The selected endpoint is not Gemini",
      null,
    );
  }

  const normalizedBaseUrl = normalizeGeminiBaseUrl(connection.baseUrl);
  const baseURL = `${normalizedBaseUrl}/v1beta`;
  const modelPath = googleModelPath(modelId);
  return {
    name: "google",
    baseURL,
    apiKey: connection.apiKey,
    ...(connection.apiType === "new-api"
      ? { headers: { Authorization: `Bearer ${connection.apiKey}` } }
      : {}),
    fetch: createControlledGoogleFetch({
      baseURL,
      modelPath,
      timeoutPolicy,
      fetchImplementation,
      isMixedContent: () => isMixedContentUrl(normalizedBaseUrl),
    }),
  };
}

interface ControlledGoogleFetchOptions {
  baseURL: string;
  modelPath: string;
  timeoutPolicy: RequestTimeoutPolicy;
  fetchImplementation: FetchLike;
  isMixedContent: () => boolean;
}

function createControlledGoogleFetch(
  options: ControlledGoogleFetchOptions,
): FetchLike {
  const baseUrl = new URL(options.baseURL);
  const expectedModelPath = `${baseUrl.pathname.replace(/\/$/u, "")}/${options.modelPath}`;
  return async (input, init = {}) => {
    const requestedUrl = parseRequestedUrl(input);
    const operation = googleOperation(requestedUrl, baseUrl, expectedModelPath);
    if (requestMethod(input, init) !== "POST") throw invalidRequest();
    const body = parseRequestBody(init.body);
    assertFunctionToolsOnly(body);
    const headers = new Headers(init.headers);
    headers.set(
      "Accept",
      operation === "streamGenerateContent"
        ? "text/event-stream"
        : "application/json",
    );
    return fetchUpstream(
      requestedUrl.toString(),
      { ...init, method: "POST", headers, cache: "no-store" },
      options.fetchImplementation,
      options.isMixedContent,
      chatTimeouts(options.timeoutPolicy),
    );
  };
}

function googleOperation(
  requestedUrl: URL,
  baseUrl: URL,
  expectedModelPath: string,
): "generateContent" | "streamGenerateContent" {
  if (requestedUrl.origin !== baseUrl.origin || requestedUrl.hash) {
    throw invalidRequest();
  }
  if (
    requestedUrl.pathname === `${expectedModelPath}:generateContent` &&
    !requestedUrl.search
  ) {
    return "generateContent";
  }
  if (
    requestedUrl.pathname === `${expectedModelPath}:streamGenerateContent` &&
    requestedUrl.searchParams.size === 1 &&
    requestedUrl.searchParams.get("alt") === "sse"
  ) {
    return "streamGenerateContent";
  }
  throw invalidRequest();
}

function googleModelPath(modelId: string): string {
  const trimmed = modelId.trim();
  const segments = trimmed.split("/");
  if (
    !trimmed ||
    trimmed !== modelId ||
    /[?#]/u.test(trimmed) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw invalidRequest();
  }
  return trimmed.includes("/") ? trimmed : `models/${trimmed}`;
}

function assertFunctionToolsOnly(body: Record<string, unknown>): void {
  if (body.tools === undefined) return;
  if (!Array.isArray(body.tools)) throw invalidRequest();
  for (const tool of body.tools) {
    if (
      typeof tool !== "object" ||
      tool === null ||
      Array.isArray(tool) ||
      !("functionDeclarations" in tool) ||
      !Array.isArray(tool.functionDeclarations) ||
      Object.keys(tool).some((key) => key !== "functionDeclarations")
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
    "The AI runtime generated an invalid Gemini request",
    null,
  );
}
