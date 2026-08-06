import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentRuntimeOptions } from "@/runtime/agent/agent-runtime";
import { aiSdkGoogleRuntime } from "@/runtime/agent/ai-sdk/ai-sdk-google-runtime";
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

describe("AiSdkGoogleRuntime", () => {
  it("streams Gemini reasoning, answer, usage, and level settings", async () => {
    let requestBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return geminiStream([
          {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    { text: "Checked constraints.", thought: true },
                    { text: "Gemini native answer." },
                  ],
                },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 12,
              candidatesTokenCount: 7,
              thoughtsTokenCount: 3,
              totalTokenCount: 19,
            },
          },
        ]);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const persistence = new RecordingPersistence();
    const options = runtimeOptions(persistence);
    options.request.temperature = 0.4;
    options.request.top_p = 0.8;
    options.request.max_tokens = 2_048;

    const result = await aiSdkGoogleRuntime.run(options);

    expect(result.state).toBe("completed");
    expect(result.error).toBeNull();
    expect(result.reasoningText).toBe("Checked constraints.");
    expect(result.finalText).toBe("Gemini native answer.");
    expect(result.usage).toMatchObject({
      promptTokens: 12,
      completionTokens: 10,
      reasoningTokens: 3,
      totalTokens: 22,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestBody).toMatchObject({
      contents: [{ role: "user", parts: [{ text: "Explain this" }] }],
      generationConfig: {
        temperature: 0.4,
        topP: 0.8,
        maxOutputTokens: 2_048,
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: "high",
        },
      },
    });
    expect(persistence.results).toHaveLength(1);
  });

  it("preserves thought signatures through Tavily continuation and persistence", async () => {
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
          return geminiStream([
            {
              candidates: [
                {
                  content: {
                    role: "model",
                    parts: [
                      {
                        functionCall: {
                          name: "web_search",
                          args: { query: "latest storm" },
                        },
                        thoughtSignature: "gemini-signature-1",
                      },
                    ],
                  },
                  finishReason: "STOP",
                },
              ],
            },
          ]);
        }
        return geminiStream([
          {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "Search complete." }],
                },
                finishReason: "STOP",
              },
            ],
          },
        ]);
      }),
    );
    const persistence = new RecordingPersistence();
    const options = runtimeOptions(persistence);
    options.registry = registry;
    options.request = {
      model: "gemini-3.1-pro",
      stream: true,
      reasoning: { mode: "default" },
      messages: [{ role: "user", content: "Search the storm" }],
      tools: registry.definitions(),
      tool_choice: "auto",
    };

    const result = await aiSdkGoogleRuntime.run(options);

    expect(result.state).toBe("completed");
    expect(result.finalText).toBe("Search complete.");
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]?.tools).toEqual([
      expect.objectContaining({
        functionDeclarations: [expect.objectContaining({ name: "web_search" })],
      }),
    ]);
    expect(JSON.stringify(requestBodies[1])).toContain("gemini-signature-1");
    const completedTool = result.contentParts.find(
      (part) => part.type === "tool_call",
    );
    expect(completedTool).toMatchObject({
      name: "web_search",
      status: "completed",
    });
    expect(result.providerContextParts).toEqual([
      {
        type: "provider_context",
        provider: "gemini",
        contextType: "thought_signature",
        step: 0,
        toolCallId: completedTool?.type === "tool_call" ? completedTool.id : "",
        thoughtSignature: "gemini-signature-1",
      },
    ]);
  });

  it("preserves thought signatures through a non-streaming tool continuation", async () => {
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
          return Response.json({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      functionCall: {
                        name: "web_search",
                        args: { query: "recent Gemini release" },
                      },
                      thoughtSignature: "gemini-non-stream-signature",
                    },
                  ],
                },
                finishReason: "STOP",
              },
            ],
          });
        }
        return Response.json({
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: "Non-stream search complete." }],
              },
              finishReason: "STOP",
            },
          ],
        });
      }),
    );
    const options = runtimeOptions(new RecordingPersistence());
    options.registry = registry;
    options.request = {
      model: "gemini-3.1-pro",
      stream: false,
      reasoning: { mode: "default" },
      messages: [{ role: "user", content: "Check the recent Gemini release" }],
      tools: registry.definitions(),
      tool_choice: "auto",
    };

    const result = await aiSdkGoogleRuntime.run(options);

    expect(result.state).toBe("completed");
    expect(result.finalText).toBe("Non-stream search complete.");
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(requestBodies).toHaveLength(2);
    expect(JSON.stringify(requestBodies[1])).toContain(
      "gemini-non-stream-signature",
    );
    expect(result.providerContextParts).toEqual([
      expect.objectContaining({
        provider: "gemini",
        thoughtSignature: "gemini-non-stream-signature",
      }),
    ]);
  });

  it("uses non-streaming Gemini images and returns redacted errors without retry", async () => {
    const requests: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>,
        );
        if (requests.length === 1) {
          return Response.json({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    { text: "Inspected image.", thought: true },
                    { text: "Image accepted." },
                  ],
                },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 9,
              candidatesTokenCount: 5,
              totalTokenCount: 14,
            },
          });
        }
        return Response.json(
          { error: { message: "gemini-key must stay hidden" } },
          { status: 401 },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const firstPersistence = new RecordingPersistence();
    const first = runtimeOptions(firstPersistence);
    first.connection.modelId = "gemini-2.5-flash";
    first.request = {
      model: "gemini-2.5-flash",
      stream: false,
      reasoning: { mode: "auto" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Inspect" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,AA==" },
            },
          ],
        },
      ],
    };

    const success = await aiSdkGoogleRuntime.run(first);

    expect(success.error).toBeNull();
    expect(success.state).toBe("completed");
    expect(success.finalText).toBe("Image accepted.");
    expect(requests[0]?.contents).toEqual([
      {
        role: "user",
        parts: [
          { text: "Inspect" },
          { inlineData: { mimeType: "image/png", data: "AA==" } },
        ],
      },
    ]);
    expect(requests[0]?.generationConfig).toMatchObject({
      thinkingConfig: { includeThoughts: true, thinkingBudget: -1 },
    });

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const second = runtimeOptions(new RecordingPersistence());
    const failure = await aiSdkGoogleRuntime.run(second);

    expect(failure.state).toBe("error");
    expect(failure.error).toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
      detail: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(consoleError).not.toHaveBeenCalled();
    expect(JSON.stringify(failure)).not.toContain("gemini-key");
  });
});

function runtimeOptions(
  persistence: RecordingPersistence,
): AgentRuntimeOptions {
  return {
    request: {
      model: "gemini-3.1-pro",
      stream: true,
      reasoning: { mode: "effort", effort: "high" },
      messages: [{ role: "user", content: "Explain this" }],
    },
    connection: {
      mode: "byok",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "gemini-key",
      modelId: "gemini-3.1-pro",
      apiType: "gemini",
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

function geminiStream(events: readonly Record<string, unknown>[]): Response {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
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
