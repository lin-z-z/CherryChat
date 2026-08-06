import { describe, expect, it } from "vitest";

import type { ChatCompletionsRequest } from "@/runtime/chat/chat-completions-contract";
import type { NonStreamingChatCompletionsRequest } from "@/runtime/transport/chat-transport";
import { createOpenAIResponsesTransport } from "@/runtime/transport/openai-responses-transport";

const request = {
  model: "gpt-5.4",
  messages: [
    { role: "system", content: "Be concise." },
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
          toolCallId: "gemini-responses-call",
          thoughtSignature: "gemini-responses-wire-signature",
        },
        {
          type: "provider_context",
          provider: "anthropic",
          contextType: "thinking",
          step: 0,
          blockIndex: 0,
          text: "anthropic private plan",
          signature: "anthropic-responses-wire-signature",
        },
      ],
    },
  ],
  reasoning: { mode: "effort", effort: "high" },
  temperature: 0.4,
  top_p: 0.8,
  max_tokens: 4096,
  stream: false,
} satisfies ChatCompletionsRequest;

describe("OpenAI Responses transport", () => {
  it("discovers models through /v1/models with bearer authentication", async () => {
    const calls: Array<{ target: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchMock: typeof fetch = async (target, init) => {
      calls.push({ target, ...(init ? { init } : {}) });
      return Response.json({
        object: "list",
        data: [{ id: "gpt-5.4", object: "model" }],
      });
    };
    const transport = createOpenAIResponsesTransport(
      "https://api.openai.com/v1/",
      "responses-key",
      fetchMock,
    );

    await expect(transport.listModels()).resolves.toEqual({
      object: "list",
      data: [{ id: "gpt-5.4", object: "model" }],
    });
    expect(calls[0]?.target).toBe("https://api.openai.com/v1/models");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(
      "Bearer responses-key",
    );
  });

  it("maps instructions, input parts and generation parameters", async () => {
    const calls: Array<{ target: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchMock: typeof fetch = async (target, init) => {
      calls.push({ target, ...(init ? { init } : {}) });
      return Response.json({ output: [] });
    };
    const transport = createOpenAIResponsesTransport(
      "https://api.openai.com",
      "responses-key",
      fetchMock,
    );

    await transport.createChatCompletion(request);

    expect(calls[0]?.target).toBe("https://api.openai.com/v1/responses");
    expect(new Headers(calls[0]?.init?.headers).get("accept")).toBe(
      "application/json",
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      model: "gpt-5.4",
      instructions: "Be concise.",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Describe this image." },
            {
              type: "input_image",
              image_url: "data:image/png;base64,abc123",
            },
          ],
        },
        { role: "assistant", content: "Previous answer" },
      ],
      stream: false,
      store: false,
      max_output_tokens: 4096,
      temperature: 0.4,
      top_p: 0.8,
      reasoning: { effort: "high" },
    });
    expect(String(calls[0]?.init?.body)).not.toContain("must-not-leak");
    expect(String(calls[0]?.init?.body)).not.toContain(
      "gemini-responses-wire-signature",
    );
    expect(String(calls[0]?.init?.body)).not.toContain(
      "anthropic-responses-wire-signature",
    );
  });

  it.each([
    [{ mode: "default" }, undefined],
    [{ mode: "off" }, { effort: "none" }],
  ] as const)(
    "keeps Responses reasoning choice %j distinct",
    async (reasoning, expectedReasoning) => {
      let capturedBody: Record<string, unknown> = {};
      const transport = createOpenAIResponsesTransport(
        "https://api.openai.com",
        "responses-key",
        async (_target, init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          return Response.json({ output: [] });
        },
      );

      await transport.createChatCompletion({
        model: "gpt-5.4",
        messages: [{ role: "user", content: "Hello" }],
        reasoning,
        stream: false,
      } satisfies NonStreamingChatCompletionsRequest);

      if (expectedReasoning === undefined) {
        expect(capturedBody).not.toHaveProperty("reasoning");
      } else {
        expect(capturedBody).toHaveProperty("reasoning", expectedReasoning);
      }
    },
  );

  it("normalizes non-streaming reasoning, message output and usage", async () => {
    const fetchMock: typeof fetch = async () =>
      Response.json({
        output: [
          {
            type: "reasoning",
            summary: [
              { type: "summary_text", text: "plan " },
              { type: "summary_text", text: "carefully" },
            ],
          },
          {
            type: "message",
            content: [
              { type: "output_text", text: "final " },
              { type: "refusal", text: "ignored" },
              { type: "output_text", text: "answer" },
            ],
          },
        ],
        output_text: "fallback text",
        usage: {
          input_tokens: 15,
          output_tokens: 9,
          total_tokens: 24,
          output_tokens_details: { reasoning_tokens: 4 },
        },
      });
    const transport = createOpenAIResponsesTransport(
      "https://api.openai.com",
      "responses-key",
      fetchMock,
    );

    const response = await transport.createChatCompletion(request);

    await expect(response.json()).resolves.toEqual({
      choices: [
        {
          message: {
            content: "final answer",
            reasoning_content: "plan carefully",
          },
        },
      ],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 9,
        total_tokens: 24,
        completion_tokens_details: { reasoning_tokens: 4 },
      },
    });
  });

  it("maps upstream error JSON and invalid success JSON to stable errors", async () => {
    const upstreamFailure = createOpenAIResponsesTransport(
      "https://api.openai.com",
      "responses-key",
      async () =>
        Response.json(
          { error: { message: "Invalid request payload" } },
          { status: 400 },
        ),
    );

    await expect(
      upstreamFailure.createChatCompletion(request),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      status: 400,
      detail: expect.stringContaining("Invalid request payload"),
    });

    const invalidJson = createOpenAIResponsesTransport(
      "https://api.openai.com",
      "responses-key",
      async () =>
        new Response("{not-json", {
          headers: { "Content-Type": "application/json" },
        }),
    );

    await expect(
      invalidJson.createChatCompletion(request),
    ).rejects.toMatchObject({
      code: "STREAM_PROTOCOL_ERROR",
      status: 200,
    });

    const failedCompletion = createOpenAIResponsesTransport(
      "https://api.openai.com",
      "responses-key",
      async () =>
        Response.json({
          status: "failed",
          error: { message: "sk-sensitive-provider-detail" },
        }),
    );

    await expect(
      failedCompletion.createChatCompletion(request),
    ).rejects.toMatchObject({
      code: "STREAM_PROTOCOL_ERROR",
      status: 200,
      message: "OpenAI Responses completion reported failure",
    });
  });

  it("maps function tools, calls and outputs in both request directions", async () => {
    let capturedBody: Record<string, unknown> = {};
    const transport = createOpenAIResponsesTransport(
      "https://api.openai.com",
      "responses-key",
      async (_target, init) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        return Response.json({
          output: [
            {
              type: "function_call",
              call_id: "call-next",
              name: "web_search",
              arguments: '{"query":"next"}',
            },
          ],
        });
      },
    );
    const response = await transport.createChatCompletion({
      model: "gpt-5.4",
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-old",
              type: "function",
              function: { name: "web_search", arguments: "{}" },
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
      input: [
        expect.objectContaining({
          type: "function_call",
          call_id: "call-old",
        }),
        expect.objectContaining({
          type: "function_call_output",
          call_id: "call-old",
        }),
      ],
      tools: [expect.objectContaining({ name: "web_search", strict: true })],
    });
    await expect(response.json()).resolves.toMatchObject({
      choices: [
        {
          message: {
            tool_calls: [
              expect.objectContaining({
                id: "call-next",
                function: { name: "web_search", arguments: '{"query":"next"}' },
              }),
            ],
          },
        },
      ],
    });
  });
});
