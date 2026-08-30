import { afterEach, describe, expect, it, vi } from "vitest";

import { aiSdkOpenAICompatibleRuntime } from "@/runtime/agent/ai-sdk/ai-sdk-openai-compatible-runtime";
import type { AgentRuntimeOptions } from "@/runtime/agent/agent-runtime";
import type { JsonValue } from "@/runtime/chat/types";
import {
  ThrottledStreamPersistence,
  type StreamPersistencePort,
  type StreamResult,
  type StreamSnapshot,
} from "@/runtime/streaming/stream-state";
import { DEFAULT_REQUEST_TIMEOUT_POLICY } from "@/runtime/transport/request-timeout-policy";
import { ToolRegistry, type ToolExecutor } from "@/runtime/tools/tool-registry";
import { hostedChatRequestSchema } from "@/server/hosted-chat-request";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AiSdkOpenAICompatibleRuntime", () => {
  it("runs a deduplicated Tavily step and continues with the tool result", async () => {
    const executor = createSearchExecutor();
    const registry = new ToolRegistry([executor]);
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: input.toString(),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return requests.length === 1
          ? sseResponse([
              chunk({ content: "I will check." }),
              chunk(
                {
                  tool_calls: [
                    toolDelta(0, "call-native", '{"query":"latest storm"}'),
                    toolDelta(1, "call-repeat", '{"query":"latest storm"}'),
                  ],
                },
                "tool_calls",
              ),
            ])
          : sseResponse([
              chunk({ reasoning_content: "Reviewing sources." }),
              chunk({ content: "The storm update is ready." }, "stop", {
                prompt_tokens: 12,
                completion_tokens: 7,
                total_tokens: 19,
              }),
            ]);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const persistencePort = new RecordingPersistencePort();
    const snapshots: StreamSnapshot[] = [];

    const result = await aiSdkOpenAICompatibleRuntime.run({
      request: {
        model: "grok-4.5",
        stream: true,
        messages: [{ role: "user", content: "What changed in the storm?" }],
        tools: registry.definitions(),
        tool_choice: "auto",
      },
      connection: {
        mode: "byok",
        baseUrl: "https://api.example.test/v1",
        apiKey: "sk-test",
        modelId: "grok-4.5",
        apiType: "openai-compatible",
      },
      timeoutPolicy: DEFAULT_REQUEST_TIMEOUT_POLICY,
      registry,
      signal: new AbortController().signal,
      persistence: new ThrottledStreamPersistence(persistencePort, 0),
      supportsReasoning: false,
      onSnapshot: (snapshot) => snapshots.push(structuredClone(snapshot)),
    });

    expect(result.state).toBe("completed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(requests[0]?.body).toMatchObject({
      model: "grok-4.5",
      stream: true,
      tool_choice: "auto",
      tools: [
        {
          type: "function",
          function: { name: "web_search", strict: true },
        },
      ],
    });
    expect(requests[0]?.body.stream_options).toBeUndefined();
    expect(
      requests.every(
        ({ body }) => hostedChatRequestSchema.safeParse(body).success,
      ),
    ).toBe(true);
    expect(result.finalText).toBe(
      "I will check.\n\nThe storm update is ready.",
    );
    expect(result.reasoningText).toBe("Reviewing sources.");
    expect(result.contentParts).toMatchObject([
      { type: "text", text: "I will check." },
      {
        type: "tool_call",
        id: "call-native",
        status: "completed",
        step: 0,
      },
      { type: "text", text: "The storm update is ready." },
    ]);
    expect(persistencePort.finalized).toHaveLength(1);
    expect(
      snapshots.some(({ contentParts }) =>
        contentParts.some(
          (part) => part.type === "tool_call" && part.status === "running",
        ),
      ),
    ).toBe(true);

    const continuation = requests[1]?.body;
    expect(continuation?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          tool_calls: [expect.objectContaining({ id: "call-native" })],
        }),
        expect.objectContaining({
          role: "tool",
          tool_call_id: "call-native",
        }),
      ]),
    );
  });

  it("deduplicates native and DSML calls per step but allows a later re-search", async () => {
    const executor = createSearchExecutor();
    const registry = new ToolRegistry([executor]);
    let requestCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        requestCount += 1;
        if (requestCount === 1) {
          return sseResponse([
            chunk({
              content:
                'Checking.<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="web_search"><｜｜DSML｜｜parameter name="query">latest typhoon</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>',
            }),
            chunk(
              {
                tool_calls: [
                  toolDelta(0, "call-native", '{"query":"latest typhoon"}'),
                ],
              },
              "tool_calls",
            ),
          ]);
        }
        if (requestCount === 2) {
          return sseResponse([
            chunk(
              {
                tool_calls: [
                  toolDelta(0, "call-native", '{"query":"latest typhoon"}'),
                ],
              },
              "tool_calls",
            ),
          ]);
        }
        return sseResponse([chunk({ content: "Updated twice." }, "stop")]);
      }),
    );

    const result = await aiSdkOpenAICompatibleRuntime.run(
      runtimeOptions({
        modelId: "deepseek-v4-pro",
        registry,
        stream: true,
      }),
    );

    expect(result.state).toBe("completed");
    expect(requestCount).toBe(3);
    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(result.finalText).toBe("Checking.\n\nUpdated twice.");
    expect(
      result.contentParts
        .filter((part) => part.type === "tool_call")
        .map((part) => part.id),
    ).toEqual(["call-native", "call-native__step_1"]);
  });

  it("sends DeepSeek native effort fields and replays reasoning_content across a tool loop", async () => {
    const executor = createSearchExecutor();
    const registry = new ToolRegistry([executor]);
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return bodies.length === 1
          ? sseResponse([
              chunk({ reasoning_content: "Need fresh sources." }),
              chunk(
                {
                  tool_calls: [
                    toolDelta(0, "call-deepseek", '{"query":"storm"}'),
                  ],
                },
                "tool_calls",
              ),
            ])
          : sseResponse([
              chunk({ reasoning_content: "Use the returned source." }),
              chunk({ content: "DeepSeek answer." }, "stop"),
            ]);
      }),
    );
    const options = runtimeOptions({
      modelId: "deepseek-v4-flash",
      registry,
      stream: true,
    });
    options.request = {
      ...options.request,
      reasoning: { mode: "effort", effort: "high" },
      temperature: 0.7,
      top_p: 0.8,
    };

    const result = await aiSdkOpenAICompatibleRuntime.run(options);

    expect(result.state).toBe("completed");
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body).toMatchObject({
        thinking: { type: "enabled" },
        reasoning_effort: "high",
      });
      expect(body).not.toHaveProperty("temperature");
      expect(body).not.toHaveProperty("top_p");
      expect(hostedChatRequestSchema.safeParse(body).success).toBe(true);
    }
    expect(bodies[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          reasoning_content: "Need fresh sources.",
          tool_calls: [expect.objectContaining({ id: "call-deepseek" })],
        }),
      ]),
    );
    expect(result.providerContextParts).toEqual([
      expect.objectContaining({
        provider: "deepseek-chat",
        step: 0,
        text: "Need fresh sources.",
      }),
      expect.objectContaining({
        provider: "deepseek-chat",
        step: 1,
        text: "Use the returned source.",
      }),
    ]);
  });

  it.each([
    [
      "GLM-5.2 High",
      "glm-5.2",
      { mode: "effort", effort: "high" },
      {
        thinking: { type: "enabled", clear_thinking: false },
        reasoning_effort: "high",
      },
    ],
    [
      "GLM-4.7 On",
      "glm-4.7",
      { mode: "on" },
      { thinking: { type: "enabled", clear_thinking: false } },
    ],
  ] as const)(
    "sends %s through the compatible provider without suppressing sampling",
    async (_name, modelId, reasoning, expected) => {
      let body: Record<string, unknown> = {};
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return sseResponse([chunk({ content: "GLM answer." }, "stop")]);
        }),
      );
      const options = runtimeOptions({
        modelId,
        registry: new ToolRegistry([]),
        stream: true,
      });
      options.request = {
        ...options.request,
        reasoning,
        temperature: 0.7,
        top_p: 0.8,
      };

      const result = await aiSdkOpenAICompatibleRuntime.run(options);

      expect(result.state).toBe("completed");
      expect(body).toMatchObject({
        ...expected,
        temperature: 0.7,
        top_p: 0.8,
      });
      if (modelId === "glm-4.7") {
        expect(body).not.toHaveProperty("reasoning_effort");
      }
      expect(body).not.toHaveProperty("reasoning");
    },
  );

  it.each([
    ["qwen3.8-max", { mode: "off" }, { enable_thinking: false }, true],
    ["qwen3.5-plus", { mode: "on" }, { enable_thinking: true }, true],
    [
      "kimi-k3",
      { mode: "effort", effort: "high" },
      { reasoning_effort: "high" },
      false,
    ],
  ] as const)(
    "sends reviewed %s Chat controls through AI SDK",
    async (modelId, reasoning, expected, keepsSampling) => {
      let body: Record<string, unknown> = {};
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return sseResponse([chunk({ content: "Answer." }, "stop")]);
        }),
      );
      const options = runtimeOptions({
        modelId,
        registry: new ToolRegistry([]),
        stream: true,
      });
      options.request = {
        ...options.request,
        reasoning,
        temperature: 0.7,
        top_p: 0.8,
        enable_thinking: "caller-value",
        thinking: { type: "caller-value" },
        reasoning_effort: "caller-value",
      };

      const result = await aiSdkOpenAICompatibleRuntime.run(options);

      expect(result.state).toBe("completed");
      expect(body).toMatchObject(expected);
      expect(hostedChatRequestSchema.safeParse(body).success).toBe(true);
      expect(body).not.toHaveProperty("reasoning");
      expect(body).not.toHaveProperty("thinking");
      if (!("enable_thinking" in expected)) {
        expect(body).not.toHaveProperty("enable_thinking");
      }
      if (!("reasoning_effort" in expected)) {
        expect(body).not.toHaveProperty("reasoning_effort");
      }
      if (keepsSampling) {
        expect(body).toMatchObject({ temperature: 0.7, top_p: 0.8 });
      } else {
        expect(body).not.toHaveProperty("temperature");
        expect(body).not.toHaveProperty("top_p");
      }
    },
  );

  it.each([
    ["qwen3.8-max", "qwen-chat"],
    ["kimi-k3", "kimi-chat"],
  ] as const)(
    "captures and replays no-tool %s reasoning_content",
    async (modelId, provider) => {
      const bodies: Record<string, unknown>[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          bodies.push(
            JSON.parse(String(init?.body)) as Record<string, unknown>,
          );
          return bodies.length === 1
            ? sseResponse([
                chunk({ reasoning_content: `${provider} private plan` }),
                chunk({ content: "First answer." }, "stop"),
              ])
            : sseResponse([chunk({ content: "Second answer." }, "stop")]);
        }),
      );
      const first = runtimeOptions({
        modelId,
        registry: new ToolRegistry([]),
        stream: true,
      });
      first.request = {
        ...first.request,
        reasoning: { mode: "default" },
      };

      const firstResult = await aiSdkOpenAICompatibleRuntime.run(first);
      expect(firstResult.providerContextParts).toEqual([
        {
          type: "provider_context",
          provider,
          contextType: "reasoning_content",
          step: 0,
          text: `${provider} private plan`,
        },
      ]);

      const second = runtimeOptions({
        modelId,
        registry: new ToolRegistry([]),
        stream: true,
      });
      second.request = {
        ...second.request,
        reasoning: { mode: "default" },
        messages: [
          {
            role: "assistant",
            content: firstResult.finalText,
            providerContext: firstResult.providerContextParts,
          },
          { role: "user", content: "Continue" },
        ],
      };

      const secondResult = await aiSdkOpenAICompatibleRuntime.run(second);

      expect(secondResult.state).toBe("completed");
      expect(bodies[1]?.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            reasoning_content: `${provider} private plan`,
          }),
        ]),
      );
    },
  );

  it("does not capture Qwen3.8 reasoning_content when thinking is off", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          chunk({ reasoning_content: "must not persist" }),
          chunk({ content: "Answer." }, "stop"),
        ]),
      ),
    );
    const options = runtimeOptions({
      modelId: "qwen3.8-max",
      registry: new ToolRegistry([]),
      stream: true,
    });
    options.request = { ...options.request, reasoning: { mode: "off" } };

    const result = await aiSdkOpenAICompatibleRuntime.run(options);

    expect(result.providerContextParts).toEqual([]);
  });

  it("captures no-tool Kimi reasoning_content in non-streaming mode", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                reasoning_content: "Kimi non-streaming plan",
                content: "Kimi answer",
              },
              finish_reason: "stop",
            },
          ],
        }),
      ),
    );

    const result = await aiSdkOpenAICompatibleRuntime.run(
      runtimeOptions({
        modelId: "kimi-k3",
        registry: new ToolRegistry([]),
        stream: false,
      }),
    );

    expect(result.providerContextParts).toEqual([
      expect.objectContaining({
        provider: "kimi-chat",
        text: "Kimi non-streaming plan",
      }),
    ]);
  });

  it("replays and persists GLM-5.2 reasoning_content in a streaming tool loop", async () => {
    const executor = createSearchExecutor();
    const registry = new ToolRegistry([executor]);
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return bodies.length === 1
          ? sseResponse([
              chunk({ reasoning_content: "GLM search plan" }),
              chunk(
                {
                  tool_calls: [toolDelta(0, "call-glm", '{"query":"storm"}')],
                },
                "tool_calls",
              ),
            ])
          : sseResponse([
              chunk({ reasoning_content: "GLM answer plan" }),
              chunk({ content: "GLM answer." }, "stop"),
            ]);
      }),
    );
    const options = runtimeOptions({
      modelId: "glm-5.2",
      registry,
      stream: true,
    });
    options.request = {
      ...options.request,
      reasoning: { mode: "effort", effort: "high" },
      temperature: 0.7,
      top_p: 0.8,
    };

    const result = await aiSdkOpenAICompatibleRuntime.run(options);

    expect(result.state).toBe("completed");
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body).toMatchObject({
        thinking: { type: "enabled", clear_thinking: false },
        reasoning_effort: "high",
        temperature: 0.7,
        top_p: 0.8,
      });
    }
    expect(bodies[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          reasoning_content: "GLM search plan",
          tool_calls: [expect.objectContaining({ id: "call-glm" })],
        }),
      ]),
    );
    expect(result.providerContextParts).toEqual([
      expect.objectContaining({
        provider: "glm-chat",
        step: 0,
        text: "GLM search plan",
      }),
      expect.objectContaining({
        provider: "glm-chat",
        step: 1,
        text: "GLM answer plan",
      }),
    ]);
  });

  it("replays and persists switch-style GLM reasoning_content in a non-streaming tool loop", async () => {
    const executor = createSearchExecutor();
    const registry = new ToolRegistry([executor]);
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return bodies.length === 1
          ? jsonResponse({
              choices: [
                {
                  message: {
                    role: "assistant",
                    reasoning_content: "GLM switch search plan",
                    tool_calls: [
                      {
                        id: "call-glm-json",
                        type: "function",
                        function: {
                          name: "web_search",
                          arguments: '{"query":"glm json"}',
                        },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            })
          : jsonResponse({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "GLM JSON answer.",
                    reasoning_content: "GLM switch answer plan",
                  },
                  finish_reason: "stop",
                },
              ],
            });
      }),
    );
    const options = runtimeOptions({
      modelId: "glm-4.7",
      registry,
      stream: false,
    });
    options.request = {
      ...options.request,
      reasoning: { mode: "on" },
    };

    const result = await aiSdkOpenAICompatibleRuntime.run(options);

    expect(result.state).toBe("completed");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({
      thinking: { type: "enabled", clear_thinking: false },
    });
    expect(bodies[0]).not.toHaveProperty("reasoning_effort");
    expect(bodies[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          reasoning_content: "GLM switch search plan",
        }),
      ]),
    );
    expect(result.providerContextParts).toEqual([
      expect.objectContaining({
        provider: "glm-chat",
        step: 0,
        text: "GLM switch search plan",
      }),
      expect.objectContaining({
        provider: "glm-chat",
        step: 1,
        text: "GLM switch answer plan",
      }),
    ]);
  });

  it.each([{ mode: "default" }, { mode: "off" }] as const)(
    "does not replay or persist GLM context for choice %j",
    async (reasoning) => {
      let body: Record<string, unknown> = {};
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return sseResponse([chunk({ content: "Follow-up." }, "stop")]);
        }),
      );
      const options = runtimeOptions({
        modelId: "glm-5.2",
        registry: new ToolRegistry([]),
        stream: true,
      });
      options.request = {
        ...options.request,
        reasoning,
        messages: [
          { role: "user", content: "Search first" },
          {
            role: "assistant",
            content: "Checking",
            providerContext: [
              {
                type: "provider_context",
                provider: "glm-chat",
                contextType: "reasoning_content",
                step: 0,
                text: "Persisted GLM plan",
              },
            ],
            tool_calls: [
              {
                id: "call-history",
                type: "function",
                function: {
                  name: "web_search",
                  arguments: '{"query":"storm"}',
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call-history",
            name: "web_search",
            content: "[]",
          },
          { role: "user", content: "What next?" },
        ],
      };

      const result = await aiSdkOpenAICompatibleRuntime.run(options);

      expect(result.state).toBe("completed");
      expect(JSON.stringify(body)).not.toContain("Persisted GLM plan");
      expect(result.providerContextParts).toEqual([]);
    },
  );

  it("replays persisted DeepSeek reasoning_content on the next user turn", async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return sseResponse([chunk({ content: "Follow-up answer." }, "stop")]);
      }),
    );
    const options = runtimeOptions({
      modelId: "deepseek-v4-pro",
      registry: new ToolRegistry([]),
      stream: true,
    });
    options.request.messages = [
      { role: "user", content: "Search first" },
      {
        role: "assistant",
        content: "I will search",
        providerContext: [
          {
            type: "provider_context",
            provider: "deepseek-chat",
            contextType: "reasoning_content",
            step: 0,
            text: "Persisted tool plan",
          },
        ],
        tool_calls: [
          {
            id: "call-history",
            type: "function",
            function: {
              name: "web_search",
              arguments: '{"query":"storm"}',
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call-history",
        name: "web_search",
        content: "[]",
      },
      { role: "assistant", content: "Previous answer" },
      { role: "user", content: "What next?" },
    ];

    const result = await aiSdkOpenAICompatibleRuntime.run(options);

    expect(result.state).toBe("completed");
    expect(body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          reasoning_content: "Persisted tool plan",
          tool_calls: [expect.objectContaining({ id: "call-history" })],
        }),
      ]),
    );
    expect(hostedChatRequestSchema.safeParse(body).success).toBe(true);
    expect(result.providerContextParts).toEqual([]);
  });

  it("replays and persists DeepSeek reasoning_content in non-streaming tool loops", async () => {
    const executor = createSearchExecutor();
    const registry = new ToolRegistry([executor]);
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return bodies.length === 1
          ? jsonResponse({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "One lookup.",
                    reasoning_content: "Plan the non-streaming lookup.",
                    tool_calls: [
                      {
                        id: "call-deepseek-json",
                        type: "function",
                        function: {
                          name: "web_search",
                          arguments: '{"query":"json deepseek"}',
                        },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            })
          : jsonResponse({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "JSON DeepSeek complete.",
                    reasoning_content: "Summarize the non-streaming source.",
                  },
                  finish_reason: "stop",
                },
              ],
            });
      }),
    );
    const options = runtimeOptions({
      modelId: "deepseek-v4-flash",
      registry,
      stream: false,
    });
    options.request = {
      ...options.request,
      reasoning: { mode: "effort", effort: "high" },
    };

    const result = await aiSdkOpenAICompatibleRuntime.run(options);

    expect(result.state).toBe("completed");
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          reasoning_content: "Plan the non-streaming lookup.",
          tool_calls: [expect.objectContaining({ id: "call-deepseek-json" })],
        }),
      ]),
    );
    expect(result.providerContextParts).toEqual([
      expect.objectContaining({
        provider: "deepseek-chat",
        step: 0,
        text: "Plan the non-streaming lookup.",
      }),
      expect.objectContaining({
        provider: "deepseek-chat",
        step: 1,
        text: "Summarize the non-streaming source.",
      }),
    ]);
    expect(
      bodies.every((body) => hostedChatRequestSchema.safeParse(body).success),
    ).toBe(true);
  });

  it("uses non-streaming provider calls when streaming is disabled", async () => {
    const executor = createSearchExecutor();
    const registry = new ToolRegistry([executor]);
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return bodies.length === 1
          ? jsonResponse({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "One lookup.",
                    tool_calls: [
                      {
                        id: "call-json",
                        type: "function",
                        function: {
                          name: "web_search",
                          arguments: '{"query":"json mode"}',
                        },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            })
          : jsonResponse({
              choices: [
                {
                  message: { role: "assistant", content: "JSON complete." },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 8,
                completion_tokens: 3,
                total_tokens: 11,
              },
            });
      }),
    );

    const result = await aiSdkOpenAICompatibleRuntime.run(
      runtimeOptions({ modelId: "grok-4.5", registry, stream: false }),
    );

    expect(result.state).toBe("completed");
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(bodies).toHaveLength(2);
    expect(bodies.every((body) => body.stream === undefined)).toBe(true);
    expect(bodies.every((body) => body.tool_choice === undefined)).toBe(true);
    expect(result.finalText).toBe("One lookup.\n\nJSON complete.");
    expect(result.usage).toMatchObject({
      promptTokens: 8,
      completionTokens: 3,
      totalTokens: 11,
      estimated: false,
    });
  });

  it("keeps hosted execution on the same-origin chat route without Authorization", async () => {
    const calls: Array<{
      input: RequestInfo | URL;
      init?: RequestInit;
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ input, ...(init ? { init } : {}) });
        return sseResponse([chunk({ content: "Hosted answer." }, "stop")]);
      }),
    );

    const options = runtimeOptions({
      modelId: "grok-4.5",
      registry: new ToolRegistry([]),
      stream: true,
    });
    options.connection = {
      ...options.connection,
      mode: "hosted",
      baseUrl: "https://ignored.invalid",
      apiKey: "must-not-leak",
      accessCode: "visitor-code",
    };
    const result = await aiSdkOpenAICompatibleRuntime.run(options);

    expect(result.state).toBe("completed");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("/api/chat");
    expect(calls[0]?.init?.credentials).toBe("same-origin");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("X-CherryChat-Mode")).toBe("hosted");
    expect(headers.get("X-CherryChat-Access-Code")).toBe("visitor-code");
    expect(headers.get("Authorization")).toBeNull();
    expect(
      hostedChatRequestSchema.safeParse(
        JSON.parse(String(calls[0]?.init?.body)) as unknown,
      ).success,
    ).toBe(true);
    expect(JSON.stringify(calls)).not.toContain("must-not-leak");
  });

  it("never sends a stored access code to a browser-direct BYOK upstream", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ input, ...(init ? { init } : {}) });
        return sseResponse([chunk({ content: "BYOK answer." }, "stop")]);
      }),
    );

    const options = runtimeOptions({
      modelId: "grok-4.5",
      registry: new ToolRegistry([]),
      stream: true,
    });
    options.connection = {
      ...options.connection,
      mode: "byok",
      baseUrl: "https://api.example.test/v1",
      apiKey: "sk-personal",
      accessCode: "visitor-code",
    };
    const result = await aiSdkOpenAICompatibleRuntime.run(options);

    expect(result.state).toBe("completed");
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toContain("api.example.test");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("X-CherryChat-Access-Code")).toBeNull();
    expect(JSON.stringify(calls)).not.toContain("visitor-code");
  });

  it("persists a running tool as interrupted when the user stops", async () => {
    const controller = new AbortController();
    const execute = vi.fn(
      async (_input: Record<string, JsonValue>, signal: AbortSignal) => {
        if (signal.aborted) throw signal.reason;
        return new Promise<JsonValue>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
    );
    const base = createSearchExecutor();
    const registry = new ToolRegistry([{ ...base, execute }]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          chunk({ content: "Starting search." }),
          chunk(
            {
              tool_calls: [toolDelta(0, "call-stop", '{"query":"stop test"}')],
            },
            "tool_calls",
          ),
        ]),
      ),
    );
    const options = runtimeOptions({
      modelId: "grok-4.5",
      registry,
      stream: true,
    });
    options.signal = controller.signal;
    options.onSnapshot = (snapshot) => {
      if (
        snapshot.contentParts.some(
          (part) => part.type === "tool_call" && part.status === "running",
        )
      ) {
        controller.abort(new DOMException("Stopped", "AbortError"));
      }
    };

    const result = await aiSdkOpenAICompatibleRuntime.run(options);

    expect(result.state).toBe("stopped");
    expect(result.error).toBeNull();
    expect(result.contentParts).toMatchObject([
      { type: "text", text: "Starting search." },
      {
        type: "tool_call",
        id: "call-stop",
        status: "error",
        errorCode: "TOOL_REQUEST_ABORTED",
      },
    ]);
  });

  it("keeps upstream authentication errors stable without replaying legacy", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { message: "invalid sk-super-secret-value" } },
        { status: 401 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const options = runtimeOptions({
      modelId: "grok-4.5",
      registry: new ToolRegistry([]),
      stream: true,
    });

    const result = await aiSdkOpenAICompatibleRuntime.run(options);

    expect(result.state).toBe("error");
    expect(result.error).toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    expect(result.error?.detail).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("enforces the tool limit after dedupe and before execution", async () => {
    const executor = createSearchExecutor();
    const registry = new ToolRegistry([executor]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          chunk(
            {
              tool_calls: [
                toolDelta(0, "call-1", '{"query":"one"}'),
                toolDelta(1, "call-2", '{"query":"two"}'),
                toolDelta(2, "call-3", '{"query":"three"}'),
                toolDelta(3, "call-4", '{"query":"four"}'),
              ],
            },
            "tool_calls",
          ),
        ]),
      ),
    );

    const result = await aiSdkOpenAICompatibleRuntime.run(
      runtimeOptions({ modelId: "grok-4.5", registry, stream: true }),
    );

    expect(result.state).toBe("error");
    expect(result.error).toMatchObject({ code: "INVALID_REQUEST" });
    expect(executor.execute).not.toHaveBeenCalled();
    expect(result.contentParts).toEqual([]);
  });
});

function runtimeOptions(options: {
  modelId: string;
  registry: ToolRegistry;
  stream: boolean;
}): AgentRuntimeOptions {
  return {
    request: {
      model: options.modelId,
      stream: options.stream,
      messages: [{ role: "user" as const, content: "Run the test" }],
      ...(options.registry.definitions().length > 0
        ? {
            tools: options.registry.definitions(),
          }
        : {}),
    },
    connection: {
      mode: "byok" as const,
      baseUrl: "https://api.example.test/v1",
      apiKey: "sk-test",
      modelId: options.modelId,
      apiType: "openai-compatible" as const,
    },
    timeoutPolicy: DEFAULT_REQUEST_TIMEOUT_POLICY,
    registry: options.registry,
    signal: new AbortController().signal,
    persistence: new ThrottledStreamPersistence(
      new RecordingPersistencePort(),
      0,
    ),
    supportsReasoning: false,
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

class RecordingPersistencePort implements StreamPersistencePort {
  drafts: StreamSnapshot[] = [];
  finalized: StreamResult[] = [];

  async saveDraft(snapshot: StreamSnapshot): Promise<void> {
    this.drafts.push(structuredClone(snapshot));
  }

  async finalize(result: StreamResult): Promise<void> {
    this.finalized.push({ ...structuredClone(result), error: result.error });
  }
}

function sseResponse(chunks: readonly Record<string, unknown>[]): Response {
  const body = [
    ...chunks.map((value) => `data: ${JSON.stringify(value)}\n\n`),
    "data: [DONE]\n\n",
  ].join("");
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

function jsonResponse(body: Record<string, unknown>): Response {
  return Response.json(body);
}

function chunk(
  delta: Record<string, unknown>,
  finishReason: string | null = null,
  usage?: Record<string, number>,
): Record<string, unknown> {
  return {
    id: "chatcmpl-test",
    model: "grok-4.5",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  };
}

function toolDelta(index: number, id: string, argumentsValue: string) {
  return {
    index,
    id,
    type: "function",
    function: { name: "web_search", arguments: argumentsValue },
  };
}
