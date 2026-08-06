import { describe, expect, it } from "vitest";

import type { ChatCompletionsRequest } from "@/runtime/chat/chat-completions-contract";
import type { ReasoningChoice } from "@/runtime/chat/types";
import { createGeminiDirectTransport } from "@/runtime/transport/gemini-transport";

const request = {
  model: "models/gemini-3-pro-preview",
  messages: [
    { role: "system", content: "You are concise." },
    {
      role: "user",
      content: [
        { type: "text", text: "Describe this image." },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,abc123" },
        },
      ],
    },
    {
      role: "assistant",
      content: "Previous answer",
      providerContext: [
        {
          type: "provider_context",
          provider: "openai-responses",
          contextType: "reasoning",
          step: 0,
          itemId: "must-not-leak",
          encryptedContent: "encrypted-must-not-leak",
          reasoningTokens: 1,
        },
        {
          type: "provider_context",
          provider: "gemini",
          contextType: "thought_signature",
          step: 0,
          toolCallId: "gemini-legacy-call",
          thoughtSignature: "gemini-legacy-wire-signature",
        },
        {
          type: "provider_context",
          provider: "anthropic",
          contextType: "thinking",
          step: 0,
          blockIndex: 0,
          text: "anthropic private plan",
          signature: "anthropic-gemini-wire-signature",
        },
      ],
    },
  ],
  reasoning: { mode: "effort", effort: "high" },
  temperature: 0.4,
  top_p: 0.8,
  stream: false,
} satisfies ChatCompletionsRequest;

describe("Gemini direct transport", () => {
  it("discovers only models that support generateContent", async () => {
    const calls: Array<{ target: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchMock: typeof fetch = async (target, init) => {
      calls.push({ target, ...(init ? { init } : {}) });
      return Response.json({
        models: [
          {
            name: "models/gemini-2.5-pro",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/text-embedding-005",
            supportedGenerationMethods: ["embedContent"],
          },
          { name: "models/gemini-2.5-flash" },
        ],
      });
    };

    const transport = createGeminiDirectTransport(
      "https://generativelanguage.googleapis.com/v1beta/",
      "gemini-key",
      fetchMock,
    );

    await expect(transport.listModels()).resolves.toEqual({
      data: [{ id: "gemini-2.5-pro" }],
    });
    expect(calls[0]?.target).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
    );
    expect(new Headers(calls[0]?.init?.headers).get("x-goog-api-key")).toBe(
      "gemini-key",
    );
  });

  it("maps a non-streaming request and normalizes reasoning and usage", async () => {
    const calls: Array<{ target: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchMock: typeof fetch = async (target, init) => {
      calls.push({ target, ...(init ? { init } : {}) });
      return Response.json({
        candidates: [
          {
            content: {
              parts: [{ text: "plan", thought: true }, { text: "answer" }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 11,
          candidatesTokenCount: 7,
          thoughtsTokenCount: 3,
          totalTokenCount: 21,
        },
      });
    };

    const transport = createGeminiDirectTransport(
      "https://generativelanguage.googleapis.com",
      "gemini-key",
      fetchMock,
    );
    const response = await transport.createChatCompletion(request);
    const body = JSON.parse(await response.text());

    expect(calls[0]?.target).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent",
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      systemInstruction: { parts: [{ text: "You are concise." }] },
      contents: [
        {
          role: "user",
          parts: [
            { text: "Describe this image." },
            { inlineData: { mimeType: "image/png", data: "abc123" } },
          ],
        },
        { role: "model", parts: [{ text: "Previous answer" }] },
      ],
      generationConfig: {
        temperature: 0.4,
        topP: 0.8,
        thinkingConfig: { includeThoughts: true, thinkingLevel: "HIGH" },
      },
    });
    expect(String(calls[0]?.init?.body)).not.toContain("must-not-leak");
    expect(String(calls[0]?.init?.body)).not.toContain(
      "gemini-legacy-wire-signature",
    );
    expect(String(calls[0]?.init?.body)).not.toContain(
      "anthropic-gemini-wire-signature",
    );
    expect(body).toEqual({
      choices: [
        {
          message: {
            content: "answer",
            reasoning_content: "plan",
          },
        },
      ],
      usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
        completion_tokens_details: { reasoning_tokens: 3 },
        total_tokens: 21,
      },
    });
  });

  it("sends Gemini 3.1 Pro effort as a native thinking level", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const transport = createGeminiDirectTransport(
      "https://generativelanguage.googleapis.com",
      "gemini-key",
      async (_target, init) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        return Response.json({ candidates: [] });
      },
    );

    await transport.createChatCompletion({
      model: "gemini-3.1-pro",
      messages: [{ role: "user", content: "Hello" }],
      reasoning: { mode: "effort", effort: "medium" },
      stream: false,
    });

    expect(capturedBody).toMatchObject({
      generationConfig: {
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: "MEDIUM",
        },
      },
    });
  });

  it("maps the Gemini latest alias through the reviewed native level profile", async () => {
    let capturedBody: Record<string, unknown> = {};
    const transport = createGeminiDirectTransport(
      "https://generativelanguage.googleapis.com",
      "gemini-key",
      async (_target, init) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        return Response.json({ candidates: [] });
      },
    );

    await transport.createChatCompletion({
      model: "gemini-pro-latest",
      messages: [{ role: "user", content: "Hello" }],
      reasoning: { mode: "effort", effort: "medium" },
      stream: false,
    });

    expect(capturedBody).toMatchObject({
      generationConfig: {
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: "MEDIUM",
        },
      },
    });
  });

  it.each([
    ["default", { mode: "default" }, undefined],
    ["auto", { mode: "auto" }, { includeThoughts: true, thinkingBudget: -1 }],
    ["off", { mode: "off" }, { includeThoughts: false, thinkingBudget: 0 }],
    [
      "low",
      { mode: "effort", effort: "low" },
      { includeThoughts: true, thinkingBudget: 1_228 },
    ],
    [
      "medium",
      { mode: "effort", effort: "medium" },
      { includeThoughts: true, thinkingBudget: 12_288 },
    ],
    [
      "high",
      { mode: "effort", effort: "high" },
      { includeThoughts: true, thinkingBudget: 19_660 },
    ],
  ] as const)(
    "maps Gemini 2.5 Flash %s to its native thinking budget",
    async (_name, reasoning, expectedThinkingConfig) => {
      let capturedBody: Record<string, unknown> = {};
      const transport = createGeminiDirectTransport(
        "https://generativelanguage.googleapis.com",
        "gemini-key",
        async (_target, init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          return Response.json({ candidates: [] });
        },
      );

      await transport.createChatCompletion({
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "Hello" }],
        reasoning: reasoning as ReasoningChoice,
        stream: false,
      });

      const generationConfig = capturedBody?.generationConfig as
        Record<string, unknown> | undefined;
      if (expectedThinkingConfig === undefined) {
        expect(generationConfig).not.toHaveProperty("thinkingConfig");
      } else {
        expect(generationConfig).toHaveProperty(
          "thinkingConfig",
          expectedThinkingConfig,
        );
      }
    },
  );

  it("uses the reviewed Gemini 2.5 Pro budget and rejects an unsupported off choice", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const transport = createGeminiDirectTransport(
      "https://generativelanguage.googleapis.com",
      "gemini-key",
      async (_target, init) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        return Response.json({ candidates: [] });
      },
    );

    await transport.createChatCompletion({
      model: "gemini-2.5-pro",
      messages: [{ role: "user", content: "Hello" }],
      reasoning: { mode: "effort", effort: "low" },
      stream: false,
    });
    expect(capturedBody).toMatchObject({
      generationConfig: {
        thinkingConfig: { includeThoughts: true, thinkingBudget: 1_760 },
      },
    });

    await expect(
      transport.createChatCompletion({
        model: "gemini-2.5-pro",
        messages: [{ role: "user", content: "Hello" }],
        reasoning: { mode: "off" },
        stream: false,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("maps Gemini function calls and function responses", async () => {
    let capturedBody: Record<string, unknown> = {};
    const transport = createGeminiDirectTransport(
      "https://generativelanguage.googleapis.com",
      "gemini-key",
      async (_target, init) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        return Response.json({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: "web_search",
                      args: { query: "next" },
                    },
                  },
                ],
              },
            },
          ],
        });
      },
    );
    const response = await transport.createChatCompletion({
      model: "gemini-3.1-pro",
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-old",
              type: "function",
              function: {
                name: "web_search",
                arguments: '{"query":"old"}',
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call-old",
          name: "web_search",
          content: '{"results":[]}',
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "web_search",
            description: "Search",
            parameters: { type: "object" },
          },
        },
      ],
      stream: false,
    });

    expect(capturedBody).toMatchObject({
      contents: [
        {
          role: "model",
          parts: [
            expect.objectContaining({
              functionCall: { name: "web_search", args: { query: "old" } },
            }),
          ],
        },
        {
          role: "user",
          parts: [
            expect.objectContaining({
              functionResponse: expect.objectContaining({ name: "web_search" }),
            }),
          ],
        },
      ],
      tools: [
        {
          functionDeclarations: [
            expect.objectContaining({ name: "web_search" }),
          ],
        },
      ],
    });
    await expect(response.json()).resolves.toMatchObject({
      choices: [
        {
          message: {
            tool_calls: [
              expect.objectContaining({
                id: "gemini-tool-0",
                function: {
                  name: "web_search",
                  arguments: '{"query":"next"}',
                },
              }),
            ],
          },
        },
      ],
    });
  });

  it("projects malformed native JSON as a stable protocol error", async () => {
    const transport = createGeminiDirectTransport(
      "https://generativelanguage.googleapis.com",
      "gemini-key",
      async () => Response.json({ candidates: "invalid" }),
    );

    await expect(
      transport.createChatCompletion({
        model: "gemini-3-pro-preview",
        messages: [{ role: "user", content: "Hello" }],
        stream: false,
      }),
    ).rejects.toMatchObject({ code: "STREAM_PROTOCOL_ERROR" });
  });
});
