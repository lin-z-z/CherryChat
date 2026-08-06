import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentRuntimeOptions } from "@/runtime/agent/agent-runtime";
import { aiSdkAnthropicRuntime } from "@/runtime/agent/ai-sdk/ai-sdk-anthropic-runtime";
import type { JsonValue } from "@/runtime/chat/types";
import {
  ThrottledStreamPersistence,
  type StreamPersistencePort,
  type StreamResult,
  type StreamSnapshot,
} from "@/runtime/streaming/stream-state";
import { DEFAULT_REQUEST_TIMEOUT_POLICY } from "@/runtime/transport/request-timeout-policy";
import { ToolRegistry, type ToolExecutor } from "@/runtime/tools/tool-registry";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AiSdkAnthropicRuntime", () => {
  it("streams signed reasoning, answer, usage, replay, and adaptive effort", async () => {
    let requestBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return anthropicStream([
          messageStart(12),
          contentBlockStart(0, { type: "thinking", thinking: "" }),
          contentBlockDelta(0, {
            type: "thinking_delta",
            thinking: "Checked constraints.",
          }),
          contentBlockDelta(0, {
            type: "signature_delta",
            signature: "anthropic-stream-signature",
          }),
          contentBlockStop(0),
          contentBlockStart(1, { type: "text", text: "" }),
          contentBlockDelta(1, {
            type: "text_delta",
            text: "Anthropic native answer.",
          }),
          contentBlockStop(1),
          messageDelta("end_turn", 10),
          { type: "message_stop" },
        ]);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const persistence = new RecordingPersistence();
    const options = runtimeOptions(persistence);

    const result = await aiSdkAnthropicRuntime.run(options);

    expect(result.state).toBe("completed");
    expect(result.error).toBeNull();
    expect(result.reasoningText).toBe("Checked constraints.");
    expect(result.finalText).toBe("Anthropic native answer.");
    expect(result.usage).toMatchObject({
      promptTokens: 12,
      completionTokens: 10,
      reasoningTokens: null,
      totalTokens: 22,
    });
    expect(result.providerContextParts).toEqual([
      {
        type: "provider_context",
        provider: "anthropic",
        contextType: "thinking",
        step: 0,
        blockIndex: 0,
        text: "Checked constraints.",
        signature: "anthropic-stream-signature",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestBody).toMatchObject({
      model: "claude-opus-4-6",
      stream: true,
      max_tokens: 16_384,
      thinking: { type: "adaptive" },
      output_config: { effort: "max" },
    });
    expect(requestBody).not.toHaveProperty("temperature");
    expect(requestBody).not.toHaveProperty("top_p");
    expect(JSON.stringify(requestBody.messages)).toContain(
      "anthropic-old-signature",
    );
    expect(persistence.results).toHaveLength(1);
  });

  it("preserves signed thinking through a deduplicated Tavily continuation", async () => {
    const executor = createSearchExecutor();
    const registry = new ToolRegistry([executor]);
    const requestBodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBodies.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>,
        );
        if (requestBodies.length === 1) {
          return anthropicStream([
            messageStart(10),
            contentBlockStart(0, { type: "thinking", thinking: "" }),
            contentBlockDelta(0, {
              type: "thinking_delta",
              thinking: "I should search.",
            }),
            contentBlockDelta(0, {
              type: "signature_delta",
              signature: "anthropic-tool-signature",
            }),
            contentBlockStop(0),
            ...toolCallEvents(1, "call-1", "latest storm"),
            ...toolCallEvents(2, "call-repeat", "latest storm"),
            messageDelta("tool_use", 8),
            { type: "message_stop" },
          ]);
        }
        return anthropicStream([
          messageStart(20),
          contentBlockStart(0, { type: "text", text: "" }),
          contentBlockDelta(0, {
            type: "text_delta",
            text: "Search complete.",
          }),
          contentBlockStop(0),
          messageDelta("end_turn", 4),
          { type: "message_stop" },
        ]);
      }),
    );
    const options = runtimeOptions(new RecordingPersistence());
    options.registry = registry;
    options.request = {
      model: "claude-sonnet-4-6",
      stream: true,
      reasoning: { mode: "auto" },
      messages: [{ role: "user", content: "Search the storm" }],
      tools: registry.definitions(),
      tool_choice: "auto",
    };

    const result = await aiSdkAnthropicRuntime.run(options);

    expect(result.state).toBe("completed");
    expect(result.finalText).toBe("Search complete.");
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]?.tools).toEqual([
      expect.objectContaining({ name: "web_search" }),
    ]);
    expect(JSON.stringify(requestBodies[1])).toContain(
      "anthropic-tool-signature",
    );
    expect(JSON.stringify(requestBodies[1])).toContain("tool_result");
    expect(JSON.stringify(requestBodies[1])).not.toContain("call-repeat");
    expect(
      result.contentParts.filter((part) => part.type === "tool_call"),
    ).toEqual([
      expect.objectContaining({
        id: "call-1",
        name: "web_search",
        status: "completed",
      }),
    ]);
    expect(result.providerContextParts).toEqual([
      expect.objectContaining({
        provider: "anthropic",
        contextType: "thinking",
        text: "I should search.",
        signature: "anthropic-tool-signature",
      }),
    ]);
  });

  it("uses budget thinking for a non-streaming image and captures redacted context", async () => {
    let requestBody: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          type: "message",
          id: "message-json",
          model: "claude-sonnet-4-5",
          content: [
            {
              type: "thinking",
              thinking: "Inspected the image.",
              signature: "anthropic-json-signature",
            },
            {
              type: "redacted_thinking",
              data: "anthropic-redacted-data",
            },
            { type: "text", text: "Image accepted." },
          ],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 9, output_tokens: 8 },
        });
      }),
    );
    const options = runtimeOptions(new RecordingPersistence());
    options.connection.modelId = "claude-sonnet-4-5";
    options.request = {
      model: "claude-sonnet-4-5",
      stream: false,
      reasoning: { mode: "effort", effort: "low" },
      max_tokens: 8_192,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Inspect this image" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,AA==" },
            },
          ],
        },
      ],
    };

    const result = await aiSdkAnthropicRuntime.run(options);

    expect(result.state).toBe("completed");
    expect(result.error).toBeNull();
    expect(result.reasoningText).toBe("Inspected the image.");
    expect(result.finalText).toBe("Image accepted.");
    expect(result.providerContextParts).toEqual([
      expect.objectContaining({
        contextType: "thinking",
        text: "Inspected the image.",
        signature: "anthropic-json-signature",
      }),
      expect.objectContaining({
        contextType: "redacted_thinking",
        redactedData: "anthropic-redacted-data",
      }),
    ]);
    expect(requestBody).not.toHaveProperty("stream");
    expect(requestBody).toMatchObject({
      max_tokens: 8_192,
      thinking: { type: "enabled", budget_tokens: 4_172 },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Inspect this image" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "AA==",
              },
            },
          ],
        },
      ],
    });
  });

  it("returns one redacted error without retry or legacy fallback", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          type: "error",
          error: {
            type: "authentication_error",
            message: "anthropic-key and private prompt must stay hidden",
          },
        },
        { status: 401 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const options = runtimeOptions(new RecordingPersistence());

    const result = await aiSdkAnthropicRuntime.run(options);

    expect(result.state).toBe("error");
    expect(result.error).toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
      detail: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("anthropic-key");
    expect(JSON.stringify(result)).not.toContain("private prompt");
  });
});

function runtimeOptions(
  persistence: RecordingPersistence,
): AgentRuntimeOptions {
  return {
    request: {
      model: "claude-opus-4-6",
      stream: true,
      reasoning: { mode: "effort", effort: "xhigh" },
      temperature: 0.4,
      top_p: 0.8,
      max_tokens: 16_384,
      messages: [
        { role: "user", content: "Earlier question" },
        {
          role: "assistant",
          content: "Earlier answer",
          providerContext: [
            {
              type: "provider_context",
              provider: "anthropic",
              contextType: "thinking",
              step: 0,
              blockIndex: 0,
              text: "Earlier private plan",
              signature: "anthropic-old-signature",
            },
          ],
        },
        { role: "user", content: "Explain this" },
      ],
    },
    connection: {
      mode: "byok",
      baseUrl: "https://api.anthropic.test/v1",
      apiKey: "anthropic-key",
      modelId: "claude-opus-4-6",
      apiType: "anthropic",
    },
    timeoutPolicy: DEFAULT_REQUEST_TIMEOUT_POLICY,
    registry: new ToolRegistry([]),
    signal: new AbortController().signal,
    persistence: new ThrottledStreamPersistence(persistence, 0),
    supportsReasoning: true,
  };
}

class RecordingPersistence implements StreamPersistencePort {
  drafts: StreamSnapshot[] = [];
  results: StreamResult[] = [];

  async saveDraft(snapshot: StreamSnapshot): Promise<void> {
    this.drafts.push(structuredClone(snapshot));
  }

  async finalize(result: StreamResult): Promise<void> {
    this.results.push({ ...structuredClone(result), error: result.error });
  }
}

function anthropicStream(events: readonly Record<string, unknown>[]): Response {
  return new Response(
    events
      .map(
        (event) =>
          `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

function messageStart(inputTokens: number) {
  return {
    type: "message_start",
    message: {
      id: "message-stream",
      model: "claude-opus-4-6",
      role: "assistant",
      usage: { input_tokens: inputTokens },
      content: [],
      stop_reason: null,
    },
  };
}

function contentBlockStart(
  index: number,
  contentBlock: Record<string, unknown>,
) {
  return { type: "content_block_start", index, content_block: contentBlock };
}

function contentBlockDelta(index: number, delta: Record<string, unknown>) {
  return { type: "content_block_delta", index, delta };
}

function contentBlockStop(index: number) {
  return { type: "content_block_stop", index };
}

function messageDelta(stopReason: string, outputTokens: number) {
  return {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  };
}

function toolCallEvents(index: number, id: string, query: string) {
  return [
    contentBlockStart(index, {
      type: "tool_use",
      id,
      name: "web_search",
      input: {},
    }),
    contentBlockDelta(index, {
      type: "input_json_delta",
      partial_json: JSON.stringify({ query }),
    }),
    contentBlockStop(index),
  ];
}

function createSearchExecutor(): ToolExecutor & {
  execute: ReturnType<typeof vi.fn>;
} {
  return {
    definition: {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", maxLength: 200 },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
    },
    dedupeKey(input) {
      return typeof input.query === "string" ? input.query.trim() : null;
    },
    execute: vi.fn(async (input: Record<string, JsonValue>) => ({
      query: input.query ?? "",
      results: [
        {
          title: "Storm update",
          url: "https://example.test/storm",
          content: "Latest bulletin",
        },
      ],
    })),
  };
}
