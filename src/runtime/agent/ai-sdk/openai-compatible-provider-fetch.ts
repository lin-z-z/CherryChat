import type { ChatTransportConnection } from "@/runtime/transport/chat-transport-factory";
import {
  hasChatCompletionTerminalEvent,
  TRUNCATED_CHAT_COMPLETION_FINISH_REASON,
} from "@/runtime/agent/ai-sdk/openai-compatible-stream-contract";
import { ChatTransportError } from "@/runtime/transport/chat-errors";
import { hostedAccessCodeHeaders } from "@/runtime/transport/hosted-auth";
import { normalizeDirectBaseUrl } from "@/runtime/transport/openai-transport";
import {
  chatTimeouts,
  type RequestTimeoutPolicy,
} from "@/runtime/transport/request-timeout-policy";
import {
  fetchUpstream,
  isMixedContentUrl,
  type FetchLike,
} from "@/runtime/transport/transport-http";

const SAME_ORIGIN_PROVIDER_BASE_URL = "https://cherrychat.invalid/v1";
const textEncoder = new TextEncoder();

export interface ChatCompletionSseLimits {
  maximumTotalBytes: number;
  maximumLineBytes: number;
  maximumEventBytes: number;
  maximumDataLinesPerEvent: number;
  maximumEvents: number;
}

export const DEFAULT_CHAT_COMPLETION_SSE_LIMITS = {
  maximumTotalBytes: 64 * 1024 * 1024,
  maximumLineBytes: 1024 * 1024,
  maximumEventBytes: 2 * 1024 * 1024,
  maximumDataLinesPerEvent: 256,
  maximumEvents: 100_000,
} as const satisfies ChatCompletionSseLimits;

export interface OpenAICompatibleAgentProviderOptions {
  baseURL: string;
  apiKey?: string;
  headers: Record<string, string>;
  fetch: FetchLike;
}

export function createOpenAICompatibleAgentProviderOptions(
  connection: ChatTransportConnection,
  timeoutPolicy: RequestTimeoutPolicy,
  fetchImplementation: FetchLike = fetch,
): OpenAICompatibleAgentProviderOptions {
  if (connection.mode === "byok" && connection.baseUrl.trim()) {
    const normalizedBaseUrl = normalizeDirectBaseUrl(connection.baseUrl);
    const baseURL = `${normalizedBaseUrl}/v1`;
    return {
      baseURL,
      apiKey: connection.apiKey,
      headers: {},
      fetch: createControlledChatFetch({
        providerBaseUrl: baseURL,
        targetUrl: `${baseURL}/chat/completions`,
        sameOrigin: false,
        timeoutPolicy,
        fetchImplementation,
        isMixedContent: () => isMixedContentUrl(normalizedBaseUrl),
      }),
    };
  }

  if (connection.mode === "byok" && !connection.apiKey) {
    throw new ChatTransportError(
      "UNAUTHORIZED",
      "A BYOK API key is required",
      null,
    );
  }

  return {
    baseURL: SAME_ORIGIN_PROVIDER_BASE_URL,
    ...(connection.mode === "byok" ? { apiKey: connection.apiKey } : {}),
    headers: {
      "X-CherryChat-Mode": connection.mode,
      ...hostedAccessCodeHeaders(connection),
    },
    fetch: createControlledChatFetch({
      providerBaseUrl: SAME_ORIGIN_PROVIDER_BASE_URL,
      targetUrl: "/api/chat",
      sameOrigin: true,
      timeoutPolicy,
      fetchImplementation,
      isMixedContent: () => false,
    }),
  };
}

interface ControlledChatFetchOptions {
  providerBaseUrl: string;
  targetUrl: string;
  sameOrigin: boolean;
  timeoutPolicy: RequestTimeoutPolicy;
  fetchImplementation: FetchLike;
  isMixedContent: () => boolean;
}

function createControlledChatFetch(
  options: ControlledChatFetchOptions,
): FetchLike {
  const expectedProviderUrl = new URL(
    `${options.providerBaseUrl}/chat/completions`,
  );
  return async (input, init = {}) => {
    const requestedUrl = parseRequestedUrl(input);
    if (
      requestedUrl.origin !== expectedProviderUrl.origin ||
      requestedUrl.pathname !== expectedProviderUrl.pathname ||
      requestedUrl.search ||
      requestedUrl.hash
    ) {
      throw new ChatTransportError(
        "INVALID_REQUEST",
        "The AI runtime may only call Chat Completions",
        null,
      );
    }

    const streaming = requestUsesStreaming(init.body);
    const headers = new Headers(init.headers);
    headers.set("Accept", streaming ? "text/event-stream" : "application/json");
    const response = await fetchUpstream(
      options.targetUrl,
      {
        ...init,
        headers,
        cache: "no-store",
        ...(options.sameOrigin ? { credentials: "same-origin" } : {}),
      },
      options.fetchImplementation,
      options.isMixedContent,
      chatTimeouts(options.timeoutPolicy),
    );
    return streaming ? validateChatCompletionStream(response) : response;
  };
}

export function validateChatCompletionStream(
  response: Response,
  limits: ChatCompletionSseLimits = DEFAULT_CHAT_COMPLETION_SSE_LIMITS,
): Response {
  if (!response.ok || !response.body) return response;
  const inspector = new ChatCompletionTerminalInspector(limits);
  const reader = response.body.getReader();
  let released = false;
  const releaseReader = () => {
    if (released) return;
    released = true;
    reader.releaseLock();
  };
  const cancelReader = async (reason?: unknown) => {
    if (released) return;
    try {
      await reader.cancel(reason);
    } catch {
      // Preserve the original protocol/consumer error.
    } finally {
      releaseReader();
    }
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          inspector.finish();
          if (!inspector.hasTerminalEvent()) {
            controller.enqueue(truncatedTerminalEvent());
          }
          releaseReader();
          controller.close();
          return;
        }
        inspector.push(value);
        controller.enqueue(value);
      } catch (error) {
        await cancelReader(error);
        controller.error(error);
      }
    },
    cancel: cancelReader,
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

class ChatCompletionTerminalInspector {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private buffer = "";
  private dataLines: string[] = [];
  private totalBytes = 0;
  private eventBytes = 0;
  private eventCount = 0;
  private currentLineBytes = 0;
  private currentLineEndsWithCarriageReturn = false;
  private terminal = false;

  constructor(private readonly limits: ChatCompletionSseLimits) {}

  push(chunk: Uint8Array): void {
    this.totalBytes += chunk.byteLength;
    if (this.totalBytes > this.limits.maximumTotalBytes) {
      throw streamLimitError("total byte");
    }
    this.trackLineBytes(chunk);
    try {
      this.buffer += this.decoder.decode(chunk, { stream: true });
    } catch {
      throw new ChatTransportError(
        "STREAM_PROTOCOL_ERROR",
        "Chat Completions stream contains invalid UTF-8",
        null,
      );
    }
    this.drainLines();
  }

  finish(): void {
    try {
      this.buffer += this.decoder.decode();
    } catch {
      throw new ChatTransportError(
        "STREAM_PROTOCOL_ERROR",
        "Chat Completions stream ended with invalid UTF-8",
        null,
      );
    }
    if (this.buffer) {
      this.processLine(stripCarriageReturn(this.buffer));
      this.buffer = "";
    }
    this.processLine("");
  }

  hasTerminalEvent(): boolean {
    return this.terminal;
  }

  private drainLines(): void {
    let start = 0;
    while (true) {
      const newline = this.buffer.indexOf("\n", start);
      if (newline < 0) break;
      const line = this.buffer.slice(start, newline);
      this.processLine(stripCarriageReturn(line));
      start = newline + 1;
    }
    if (start > 0) this.buffer = this.buffer.slice(start);
  }

  private trackLineBytes(chunk: Uint8Array): void {
    for (const byte of chunk) {
      if (byte === 0x0a) {
        this.assertCurrentLineBytes();
        this.currentLineBytes = 0;
        this.currentLineEndsWithCarriageReturn = false;
        continue;
      }
      this.currentLineBytes += 1;
      this.currentLineEndsWithCarriageReturn = byte === 0x0d;
      this.assertCurrentLineBytes();
    }
  }

  private assertCurrentLineBytes(): void {
    const contentBytes =
      this.currentLineBytes - (this.currentLineEndsWithCarriageReturn ? 1 : 0);
    if (contentBytes > this.limits.maximumLineBytes) {
      throw streamLimitError("line byte");
    }
  }

  private processLine(line: string): void {
    const lineBytes = utf8ByteLength(line);
    if (lineBytes > this.limits.maximumLineBytes) {
      throw streamLimitError("line byte");
    }
    if (line === "") {
      if (this.dataLines.length === 0) {
        this.eventBytes = 0;
        return;
      }
      this.eventCount += 1;
      if (this.eventCount > this.limits.maximumEvents) {
        throw streamLimitError("event count");
      }
      this.inspectEvent(this.dataLines.join("\n"));
      this.dataLines = [];
      this.eventBytes = 0;
      return;
    }
    this.eventBytes += lineBytes + 1;
    if (this.eventBytes > this.limits.maximumEventBytes) {
      throw streamLimitError("event byte");
    }
    if (line.startsWith(":")) return;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") {
      this.dataLines.push(value);
      if (this.dataLines.length > this.limits.maximumDataLinesPerEvent) {
        throw streamLimitError("data line count");
      }
    }
  }

  private inspectEvent(data: string): void {
    if (data.trim() === "[DONE]") {
      this.terminal = true;
      return;
    }
    if (hasChatCompletionTerminalEvent(data)) this.terminal = true;
  }
}

function truncatedTerminalEvent(): Uint8Array {
  return textEncoder.encode(
    `data: ${JSON.stringify({
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: TRUNCATED_CHAT_COMPLETION_FINISH_REASON,
        },
      ],
    })}\n\ndata: [DONE]\n\n`,
  );
}

function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function streamLimitError(boundary: string): ChatTransportError {
  return new ChatTransportError(
    "STREAM_PROTOCOL_ERROR",
    `Chat Completions stream exceeded its ${boundary} limit`,
    null,
  );
}

function stripCarriageReturn(value: string): string {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}

function requestUsesStreaming(body: BodyInit | null | undefined): boolean {
  if (typeof body !== "string") return false;
  try {
    const payload: unknown = JSON.parse(body);
    return (
      typeof payload === "object" &&
      payload !== null &&
      !Array.isArray(payload) &&
      "stream" in payload &&
      payload.stream === true
    );
  } catch {
    return false;
  }
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
