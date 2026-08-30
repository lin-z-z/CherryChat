import { describe, expect, it, vi } from "vitest";

import { createOpenAICompatibleAgentProviderOptions } from "@/runtime/agent/ai-sdk/openai-compatible-provider-fetch";
import { OpenAICompatibleImageTransport } from "@/runtime/image-generation/openai-compatible-image-transport";
import {
  HOSTED_ACCESS_CODE_HEADER,
  hostedAccessCodeHeaders,
} from "@/runtime/transport/hosted-auth";
import { createChatTransport } from "@/runtime/transport/chat-transport-factory";
import { DEFAULT_REQUEST_TIMEOUT_POLICY } from "@/runtime/transport/request-timeout-policy";
import { createWebSearchProviderExecutor } from "@/runtime/tools/web-search-provider";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("hosted access code header", () => {
  it("percent-encodes the code and omits it for BYOK or empty values", () => {
    expect(
      hostedAccessCodeHeaders({ mode: "hosted", accessCode: " 访问码-1 " }),
    ).toEqual({ [HOSTED_ACCESS_CODE_HEADER]: encodeURIComponent("访问码-1") });
    expect(
      hostedAccessCodeHeaders({ mode: "hosted", accessCode: "plain-code" }),
    ).toEqual({ [HOSTED_ACCESS_CODE_HEADER]: "plain-code" });
    expect(
      hostedAccessCodeHeaders({ mode: "byok", accessCode: "plain-code" }),
    ).toEqual({});
    expect(
      hostedAccessCodeHeaders({ mode: "hosted", accessCode: "  " }),
    ).toEqual({});
    expect(hostedAccessCodeHeaders({ mode: "hosted" })).toEqual({});
  });

  it("sends the code with hosted model list and chat requests", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const fetchMock: typeof fetch = async (target, init) => {
      calls.push({
        url: String(target),
        headers: new Headers(init?.headers),
      });
      return Response.json({ object: "list", data: [] });
    };
    const transport = createChatTransport(
      {
        mode: "hosted",
        baseUrl: "",
        apiKey: "",
        accessCode: "saved-code",
        modelId: "model-a",
        apiType: "openai",
      },
      fetchMock,
    );

    await transport.listModels();
    await transport.createChatCompletion({
      model: "model-a",
      messages: [{ role: "user", content: "Hi" }],
      stream: false,
    });

    expect(calls.map(({ url }) => url)).toEqual(["/api/models", "/api/chat"]);
    for (const { headers } of calls) {
      expect(headers.get(HOSTED_ACCESS_CODE_HEADER)).toBe("saved-code");
      expect(headers.get("X-CherryChat-Mode")).toBe("hosted");
    }
  });

  it("never sends the code on a BYOK same-origin request", async () => {
    let headers = new Headers();
    const fetchMock: typeof fetch = async (_target, init) => {
      headers = new Headers(init?.headers);
      return Response.json({ object: "list", data: [] });
    };
    const transport = createChatTransport(
      {
        mode: "byok",
        baseUrl: "",
        apiKey: "sk-personal",
        accessCode: "saved-code",
        modelId: "model-a",
        apiType: "openai",
      },
      fetchMock,
    );

    await transport.listModels();

    expect(headers.get(HOSTED_ACCESS_CODE_HEADER)).toBeNull();
    expect(headers.get("Authorization")).toBe("Bearer sk-personal");
  });

  it("never sends the code to a browser-direct BYOK upstream", async () => {
    let headers = new Headers();
    const fetchMock: typeof fetch = async (_target, init) => {
      headers = new Headers(init?.headers);
      return Response.json({ object: "list", data: [] });
    };
    const transport = createChatTransport(
      {
        mode: "byok",
        baseUrl: "https://api.example.test",
        apiKey: "sk-personal",
        accessCode: "saved-code",
        modelId: "model-a",
        apiType: "openai",
      },
      fetchMock,
    );

    await transport.listModels();

    expect(headers.get(HOSTED_ACCESS_CODE_HEADER)).toBeNull();
  });

  it("sends the code through the AI SDK hosted provider only", async () => {
    const upstream = vi.fn(async () => new Response("data: [DONE]\n\n"));
    const hosted = createOpenAICompatibleAgentProviderOptions(
      {
        mode: "hosted",
        baseUrl: "",
        apiKey: "",
        accessCode: "saved-code",
        modelId: "model-a",
        apiType: "openai",
      },
      DEFAULT_REQUEST_TIMEOUT_POLICY,
      upstream,
    );
    const byok = createOpenAICompatibleAgentProviderOptions(
      {
        mode: "byok",
        baseUrl: "https://api.example.test/v1",
        apiKey: "sk-personal",
        accessCode: "saved-code",
        modelId: "model-a",
        apiType: "openai",
      },
      DEFAULT_REQUEST_TIMEOUT_POLICY,
      upstream,
    );

    expect(hosted.headers[HOSTED_ACCESS_CODE_HEADER]).toBe("saved-code");
    expect(byok.headers[HOSTED_ACCESS_CODE_HEADER]).toBeUndefined();
  });

  it("sends the code with hosted web search and not with browser search", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const fetchMock = (async (
      target: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      calls.push({ url: String(target), headers: new Headers(init?.headers) });
      return Response.json({ query: "q", results: [] });
    }) as typeof fetch;

    await createWebSearchProviderExecutor({
      source: { kind: "hosted", provider: "tavily", accessCode: "saved-code" },
      maxResults: 5,
      fetchImplementation: fetchMock,
    }).execute({ query: "q" }, new AbortController().signal);

    await createWebSearchProviderExecutor({
      source: {
        kind: "browser",
        provider: "tavily",
        apiKey: "tvly-personal-key",
        baseUrl: "https://search.example/tavily",
      },
      maxResults: 5,
      fetchImplementation: fetchMock,
    }).execute({ query: "q" }, new AbortController().signal);

    expect(calls[0]?.url).toBe("/api/web-search");
    expect(calls[0]?.headers.get(HOSTED_ACCESS_CODE_HEADER)).toBe("saved-code");
    expect(calls[1]?.url).toContain("search.example");
    expect(calls[1]?.headers.get(HOSTED_ACCESS_CODE_HEADER)).toBeNull();
  });

  it("sends the code with hosted image generation and not with BYOK", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const fetchMock = (async (
      target: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      calls.push({ url: String(target), headers: new Headers(init?.headers) });
      return Response.json({ data: [{ b64_json: PNG_BASE64 }] });
    }) as typeof fetch;
    const request = {
      modelId: "gpt-image-2",
      prompt: "a cherry",
      size: "1024x1024",
      quality: "high" as const,
      references: [],
    };

    await new OpenAICompatibleImageTransport({
      endpoint: {
        mode: "hosted",
        baseUrl: "",
        apiKey: "",
        accessCode: "saved-code",
      },
      fetchImplementation: fetchMock,
    }).generate(request);

    await new OpenAICompatibleImageTransport({
      endpoint: {
        mode: "byok",
        baseUrl: "https://images.example",
        apiKey: "sk-personal",
        accessCode: "saved-code",
      },
      fetchImplementation: fetchMock,
    }).generate(request);

    expect(calls[0]?.url).toBe("/api/image-generation");
    expect(calls[0]?.headers.get(HOSTED_ACCESS_CODE_HEADER)).toBe("saved-code");
    expect(calls[1]?.url).toContain("images.example");
    expect(calls[1]?.headers.get(HOSTED_ACCESS_CODE_HEADER)).toBeNull();
  });
});
