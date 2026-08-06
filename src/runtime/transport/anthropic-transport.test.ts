import { describe, expect, it } from "vitest";

import type { ChatCompletionsRequest } from "@/runtime/chat/chat-completions-contract";
import { createAnthropicDirectTransport } from "@/runtime/transport/anthropic-transport";
import type { NonStreamingChatCompletionsRequest } from "@/runtime/transport/chat-transport";

describe("Anthropic direct transport", () => {
  it("discovers models through the Anthropic models endpoint", async () => {
    const calls: Array<{ target: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchMock: typeof fetch = async (target, init) => {
      calls.push({ target, ...(init ? { init } : {}) });
      return Response.json({ data: [{ id: "claude-sonnet-4-6" }] });
    };

    const transport = createAnthropicDirectTransport(
      "https://api.anthropic.com/v1/",
      "anthropic-key",
      "claude-sonnet-4-6",
      fetchMock,
    );

    await expect(transport.listModels()).resolves.toEqual({
      data: [{ id: "claude-sonnet-4-6" }],
    });
    expect(calls[0]?.target).toBe("https://api.anthropic.com/v1/models");
    expect(new Headers(calls[0]?.init?.headers).get("x-api-key")).toBe(
      "anthropic-key",
    );
    expect(new Headers(calls[0]?.init?.headers).get("anthropic-version")).toBe(
      "2023-06-01",
    );
  });

  it("maps adaptive reasoning in a non-streaming Messages request", async () => {
    const calls: Array<{ target: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchMock: typeof fetch = async (target, init) => {
      calls.push({ target, ...(init ? { init } : {}) });
      return Response.json({
        content: [
          { type: "thinking", thinking: "plan" },
          { type: "text", text: "answer" },
        ],
        usage: { input_tokens: 13, output_tokens: 8 },
      });
    };
    const request = {
      model: "claude-opus-4-6",
      messages: [
        { role: "system", content: "Be precise." },
        {
          role: "user",
          content: [
            { type: "text", text: "Inspect this." },
            {
              type: "image_url",
              image_url: { url: "data:image/jpeg;base64,jpegdata" },
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
              toolCallId: "gemini-anthropic-call",
              thoughtSignature: "gemini-anthropic-wire-signature",
            },
            {
              type: "provider_context",
              provider: "anthropic",
              contextType: "thinking",
              step: 0,
              blockIndex: 0,
              text: "anthropic private plan",
              signature: "anthropic-legacy-wire-signature",
            },
          ],
        },
      ],
      reasoning: { mode: "effort", effort: "xhigh" },
      temperature: 0.3,
      top_p: 0.9,
      stream: false,
    } satisfies ChatCompletionsRequest;

    const transport = createAnthropicDirectTransport(
      "https://api.anthropic.com",
      "anthropic-key",
      request.model,
      fetchMock,
    );
    const response = await transport.createChatCompletion(request);
    const body = JSON.parse(await response.text());

    expect(calls[0]?.target).toBe("https://api.anthropic.com/v1/messages");
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      model: "claude-opus-4-6",
      max_tokens: 8192,
      stream: false,
      system: "Be precise.",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Inspect this." },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: "jpegdata",
              },
            },
          ],
        },
        {
          role: "assistant",
          content: "Previous answer",
        },
      ],
      thinking: { type: "adaptive" },
      output_config: { effort: "max" },
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).not.toHaveProperty(
      "temperature",
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).not.toHaveProperty(
      "top_p",
    );
    expect(String(calls[0]?.init?.body)).not.toContain("must-not-leak");
    expect(String(calls[0]?.init?.body)).not.toContain(
      "gemini-anthropic-wire-signature",
    );
    expect(String(calls[0]?.init?.body)).not.toContain(
      "anthropic-legacy-wire-signature",
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
        prompt_tokens: 13,
        completion_tokens: 8,
        total_tokens: 21,
      },
    });
  });

  it.each([
    [{ mode: "default" }, undefined, undefined],
    [{ mode: "off" }, { type: "disabled" }, undefined],
    [{ mode: "auto" }, { type: "adaptive" }, undefined],
    [
      { mode: "effort", effort: "high" },
      { type: "adaptive" },
      { effort: "high" },
    ],
  ] as const)(
    "keeps Anthropic reasoning choice %j distinct",
    async (reasoning, expectedThinking, expectedOutputConfig) => {
      let capturedBody: Record<string, unknown> = {};
      const transport = createAnthropicDirectTransport(
        "https://api.anthropic.com",
        "anthropic-key",
        "claude-opus-4-6",
        async (_target, init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          return Response.json({ content: [] });
        },
      );

      await transport.createChatCompletion({
        model: "claude-opus-4-6",
        messages: [{ role: "user", content: "Hello" }],
        reasoning,
        stream: false,
      } satisfies NonStreamingChatCompletionsRequest);

      if (expectedThinking === undefined) {
        expect(capturedBody).not.toHaveProperty("thinking");
      } else {
        expect(capturedBody).toHaveProperty("thinking", expectedThinking);
      }
      if (expectedOutputConfig === undefined) {
        expect(capturedBody).not.toHaveProperty("output_config");
      } else {
        expect(capturedBody).toHaveProperty(
          "output_config",
          expectedOutputConfig,
        );
      }
    },
  );

  it("maps Anthropic tool use and tool results", async () => {
    let capturedBody: Record<string, unknown> = {};
    const transport = createAnthropicDirectTransport(
      "https://api.anthropic.com",
      "anthropic-key",
      "claude-sonnet-4-6",
      async (_target, init) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        return Response.json({
          content: [
            {
              type: "tool_use",
              id: "call-next",
              name: "web_search",
              input: { query: "next" },
            },
          ],
        });
      },
    );
    const response = await transport.createChatCompletion({
      model: "claude-sonnet-4-6",
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
      messages: [
        {
          role: "assistant",
          content: [
            expect.objectContaining({ type: "tool_use", id: "call-old" }),
          ],
        },
        {
          role: "user",
          content: [
            expect.objectContaining({
              type: "tool_result",
              tool_use_id: "call-old",
            }),
          ],
        },
      ],
      tools: [expect.objectContaining({ name: "web_search" })],
    });
    await expect(response.json()).resolves.toMatchObject({
      choices: [
        {
          message: {
            tool_calls: [
              expect.objectContaining({
                id: "call-next",
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

  it("rejects malformed native model lists as protocol errors", async () => {
    const transport = createAnthropicDirectTransport(
      "https://api.anthropic.com",
      "anthropic-key",
      "claude-opus-4-6",
      async () => Response.json({ data: [{ name: "missing-id" }] }),
    );

    await expect(transport.listModels()).rejects.toMatchObject({
      code: "STREAM_PROTOCOL_ERROR",
    });
  });

  it("projects incomplete completion tool calls as safe protocol errors", async () => {
    const transport = createAnthropicDirectTransport(
      "https://api.anthropic.com",
      "anthropic-key",
      "claude-sonnet-4-6",
      async () =>
        Response.json({
          content: [{ type: "tool_use", id: "call-without-name" }],
        }),
    );

    await expect(
      transport.createChatCompletion({
        model: "claude-sonnet-4-6",
        messages: [{ role: "user", content: "Search" }],
        stream: false,
      }),
    ).rejects.toMatchObject({
      code: "STREAM_PROTOCOL_ERROR",
      status: 200,
      message: "Anthropic completion response has an incomplete tool call",
    });
  });
});
