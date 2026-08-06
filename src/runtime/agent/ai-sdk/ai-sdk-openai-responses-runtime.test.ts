import { afterEach, describe, expect, it, vi } from "vitest";

import { aiSdkOpenAIResponsesRuntime } from "@/runtime/agent/ai-sdk/ai-sdk-openai-responses-runtime";
import type { AgentRuntimeOptions } from "@/runtime/agent/agent-runtime";
import {
  ThrottledStreamPersistence,
  type StreamPersistencePort,
  type StreamResult,
  type StreamSnapshot,
} from "@/runtime/streaming/stream-state";
import { DEFAULT_REQUEST_TIMEOUT_POLICY } from "@/runtime/transport/request-timeout-policy";
import type { JsonValue } from "@/runtime/chat/types";
import { ToolRegistry, type ToolExecutor } from "@/runtime/tools/tool-registry";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AiSdkOpenAIResponsesRuntime", () => {
  it("streams native Responses reasoning, usage, and encrypted context replay", async () => {
    let requestBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return responsesStream([
          {
            type: "response.created",
            response: {
              id: "response-1",
              created_at: 1,
              model: "gpt-5.5",
            },
          },
          {
            type: "response.output_item.added",
            output_index: 0,
            item: {
              type: "reasoning",
              id: "reasoning-new",
              encrypted_content: null,
            },
          },
          {
            type: "response.reasoning_summary_text.delta",
            item_id: "reasoning-new",
            summary_index: 0,
            delta: "Checked the constraints.",
          },
          {
            type: "response.output_item.done",
            output_index: 0,
            item: {
              type: "reasoning",
              id: "reasoning-new",
              encrypted_content: "encrypted-new",
            },
          },
          {
            type: "response.output_item.added",
            output_index: 1,
            item: { type: "message", id: "message-1", phase: "final_answer" },
          },
          {
            type: "response.output_text.delta",
            item_id: "message-1",
            delta: "Native Responses answer.",
          },
          {
            type: "response.output_item.done",
            output_index: 1,
            item: { type: "message", id: "message-1", phase: "final_answer" },
          },
          {
            type: "response.completed",
            response: {
              usage: {
                input_tokens: 21,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens: 9,
                output_tokens_details: { reasoning_tokens: 4 },
              },
              service_tier: "default",
              incomplete_details: null,
            },
          },
        ]);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const persistence = new RecordingPersistence();
    const options = runtimeOptions(persistence);

    const result = await aiSdkOpenAIResponsesRuntime.run(options);

    expect(result.error).toBeNull();
    expect(result.state).toBe("completed");
    expect(result.reasoningText).toBe("Checked the constraints.");
    expect(result.finalText).toBe("Native Responses answer.");
    expect(result.usage).toMatchObject({
      promptTokens: 21,
      completionTokens: 9,
      reasoningTokens: 4,
      totalTokens: 30,
      estimated: false,
    });
    expect(result.providerContextParts).toEqual([
      {
        type: "provider_context",
        provider: "openai-responses",
        contextType: "reasoning",
        step: 0,
        itemId: "reasoning-new",
        encryptedContent: "encrypted-new",
        reasoningTokens: 4,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestBody).toMatchObject({
      model: "gpt-5.5",
      stream: true,
      store: false,
      include: ["reasoning.encrypted_content"],
      reasoning: { effort: "high", summary: "auto" },
    });
    expect(requestBody).not.toHaveProperty("previous_response_id");
    expect(requestBody).not.toHaveProperty("conversation");
    expect(requestBody.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "reasoning",
          id: "reasoning-old",
          encrypted_content: "encrypted-old",
        }),
      ]),
    );
    expect(persistence.results).toHaveLength(1);
  });

  it("returns a redacted stable error without retry or legacy fallback", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { message: "encrypted-old and sk-secret must stay hidden" } },
        { status: 401 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const persistence = new RecordingPersistence();
    const options = runtimeOptions(persistence);

    const result = await aiSdkOpenAIResponsesRuntime.run(options);

    expect(result.state).toBe("error");
    expect(result.error).toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
      detail: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("encrypted-old");
    expect(JSON.stringify(result)).not.toContain("sk-secret");
  });

  it("uses native non-streaming Responses for text, image, and encrypted reasoning", async () => {
    let requestBody: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          id: "response-json",
          created_at: 1,
          model: "gpt-5.5",
          output: [
            {
              type: "reasoning",
              id: "reasoning-json",
              encrypted_content: "encrypted-json",
              summary: [{ type: "summary_text", text: "Inspected the image." }],
            },
            {
              type: "message",
              role: "assistant",
              id: "message-json",
              content: [
                {
                  type: "output_text",
                  text: "The image is valid.",
                  annotations: [],
                },
              ],
            },
          ],
          usage: {
            input_tokens: 15,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 7,
            output_tokens_details: { reasoning_tokens: 3 },
          },
        });
      }),
    );
    const persistence = new RecordingPersistence();
    const options = runtimeOptions(persistence);
    options.request = {
      model: "gpt-5.5",
      stream: false,
      reasoning: { mode: "auto" },
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

    const result = await aiSdkOpenAIResponsesRuntime.run(options);

    expect(result.error).toBeNull();
    expect(result.state).toBe("completed");
    expect(result.reasoningText).toBe("Inspected the image.");
    expect(result.finalText).toBe("The image is valid.");
    expect(result.providerContextParts).toEqual([
      expect.objectContaining({
        itemId: "reasoning-json",
        encryptedContent: "encrypted-json",
        reasoningTokens: 3,
      }),
    ]);
    expect(requestBody).not.toHaveProperty("stream");
    expect(requestBody).toMatchObject({
      store: false,
      reasoning: { effort: "auto", summary: "auto" },
    });
    expect(requestBody.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.arrayContaining([
            expect.objectContaining({
              type: "input_image",
              image_url: "data:image/png;base64,AA==",
            }),
          ]),
        }),
      ]),
    );
  });

  it("executes Tavily once and continues with a function_call_output", async () => {
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
          return responsesStream([
            createdEvent("response-tool-1"),
            {
              type: "response.output_item.added",
              output_index: 0,
              item: {
                type: "function_call",
                id: "function-item-1",
                call_id: "call-1",
                name: "web_search",
                arguments: "",
              },
            },
            {
              type: "response.function_call_arguments.delta",
              item_id: "function-item-1",
              output_index: 0,
              delta: '{"query":"latest storm"}',
            },
            {
              type: "response.output_item.done",
              output_index: 0,
              item: {
                type: "function_call",
                id: "function-item-1",
                call_id: "call-1",
                name: "web_search",
                arguments: '{"query":"latest storm"}',
                status: "completed",
              },
            },
            {
              type: "response.output_item.added",
              output_index: 1,
              item: {
                type: "function_call",
                id: "function-item-repeat",
                call_id: "call-repeat",
                name: "web_search",
                arguments: "",
              },
            },
            {
              type: "response.function_call_arguments.delta",
              item_id: "function-item-repeat",
              output_index: 1,
              delta: '{"query":"latest storm"}',
            },
            {
              type: "response.output_item.done",
              output_index: 1,
              item: {
                type: "function_call",
                id: "function-item-repeat",
                call_id: "call-repeat",
                name: "web_search",
                arguments: '{"query":"latest storm"}',
                status: "completed",
              },
            },
            completedEvent(12, 3, 0),
          ]);
        }
        return responsesStream([
          createdEvent("response-tool-2"),
          {
            type: "response.output_item.added",
            output_index: 0,
            item: { type: "message", id: "message-tool" },
          },
          {
            type: "response.output_text.delta",
            item_id: "message-tool",
            delta: "Search complete.",
          },
          {
            type: "response.output_item.done",
            output_index: 0,
            item: { type: "message", id: "message-tool" },
          },
          completedEvent(20, 4, 0),
        ]);
      }),
    );
    const persistence = new RecordingPersistence();
    const options = runtimeOptions(persistence);
    options.registry = registry;
    options.request = {
      model: "gpt-5.5",
      stream: true,
      reasoning: { mode: "default" },
      messages: [{ role: "user", content: "Search the storm" }],
      tools: registry.definitions(),
      tool_choice: "auto",
    };

    const result = await aiSdkOpenAIResponsesRuntime.run(options);

    expect(result.state).toBe("completed");
    expect(result.finalText).toBe("Search complete.");
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]?.tools).toEqual([
      expect.objectContaining({ type: "function", name: "web_search" }),
    ]);
    expect(requestBodies[1]?.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function_call_output",
          call_id: "call-1",
        }),
      ]),
    );
    expect(JSON.stringify(requestBodies[1]?.input)).not.toContain(
      "call-repeat",
    );
    expect(
      result.contentParts.filter((part) => part.type === "tool_call"),
    ).toEqual([
      expect.objectContaining({
        id: "call-1",
        name: "web_search",
        status: "completed",
      }),
    ]);
  });
});

function runtimeOptions(
  persistence: RecordingPersistence,
): AgentRuntimeOptions {
  return {
    request: {
      model: "gpt-5.5",
      stream: true,
      reasoning: { mode: "effort", effort: "high" },
      messages: [
        { role: "user", content: "Earlier question" },
        {
          role: "assistant",
          content: "Earlier answer",
          providerContext: [
            {
              type: "provider_context",
              provider: "openai-responses",
              contextType: "reasoning",
              step: 0,
              itemId: "reasoning-old",
              encryptedContent: "encrypted-old",
              reasoningTokens: 3,
            },
          ],
        },
        { role: "user", content: "Current question" },
      ],
    },
    connection: {
      mode: "byok",
      baseUrl: "https://api.example.test/v1",
      apiKey: "sk-test",
      modelId: "gpt-5.5",
      apiType: "openai-responses",
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

function responsesStream(events: readonly Record<string, unknown>[]): Response {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

function createdEvent(responseId: string) {
  return {
    type: "response.created",
    response: { id: responseId, created_at: 1, model: "gpt-5.5" },
  };
}

function completedEvent(
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number,
) {
  return {
    type: "response.completed",
    response: {
      usage: {
        input_tokens: inputTokens,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: outputTokens,
        output_tokens_details: { reasoning_tokens: reasoningTokens },
      },
      service_tier: "default",
      incomplete_details: null,
    },
  };
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
