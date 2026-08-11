import { describe, expect, it } from "vitest";

import { createExaToolExecutor } from "@/runtime/tools/exa-client";

describe("Exa tool", () => {
  it("sends the bounded agent search request and normalizes highlights", async () => {
    let target = "";
    let request: RequestInit | undefined;
    const executor = createExaToolExecutor({
      apiKey: "exa-test-secret",
      baseUrl: "https://search.example/exa",
      maxResults: 2,
      fetchImplementation: async (input, init) => {
        target = String(input);
        request = init;
        return Response.json({
          results: [
            {
              title: " Exa result ",
              url: "https://example.com/exa",
              highlights: ["First highlight", "Second highlight"],
            },
            {
              title: "Text fallback",
              url: "https://example.com/text",
              text: "Fallback text",
            },
          ],
        });
      },
    });

    await expect(
      executor.execute({ query: "CherryChat" }, new AbortController().signal),
    ).resolves.toEqual({
      query: "CherryChat",
      results: [
        {
          title: "Exa result",
          url: "https://example.com/exa",
          content: "First highlight\nSecond highlight",
        },
        {
          title: "Text fallback",
          url: "https://example.com/text",
          content: "Fallback text",
        },
      ],
    });
    expect(target).toBe("https://search.example/exa/search");
    expect(new Headers(request?.headers).get("authorization")).toBe(
      "Bearer exa-test-secret",
    );
    expect(JSON.parse(String(request?.body))).toEqual({
      query: "CherryChat",
      type: "auto",
      numResults: 2,
      contents: { highlights: true },
    });
  });

  it("drops unsafe URLs and maps upstream rate limits", async () => {
    const executor = createExaToolExecutor({
      apiKey: "exa-test-secret",
      baseUrl: "https://api.exa.ai",
      maxResults: 5,
      fetchImplementation: async () =>
        Response.json(
          {
            results: [
              { title: "Unsafe", url: "javascript:alert(1)" },
              { title: "Safe", url: "https://example.com" },
            ],
          },
          { status: 200 },
        ),
    });
    await expect(
      executor.execute({ query: "sources" }, new AbortController().signal),
    ).resolves.toMatchObject({ results: [{ title: "Safe" }] });

    const limited = createExaToolExecutor({
      apiKey: "exa-test-secret",
      baseUrl: "https://api.exa.ai",
      maxResults: 5,
      fetchImplementation: async () => new Response(null, { status: 429 }),
    });
    await expect(
      limited.execute({ query: "rate" }, new AbortController().signal),
    ).rejects.toMatchObject({ code: "TOOL_RATE_LIMITED", retryable: true });
  });
});
