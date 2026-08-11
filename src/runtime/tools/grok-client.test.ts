import { describe, expect, it } from "vitest";

import { createGrokToolExecutor } from "@/runtime/tools/grok-client";

describe("Grok tool", () => {
  it("uses web search by default and converts output text citations", async () => {
    let request: RequestInit | undefined;
    const executor = createGrokToolExecutor({
      apiKey: "xai-test-secret",
      responsesUrl: "https://proxy.example/v1/responses",
      model: "grok-4.5",
      xSearch: false,
      maxResults: 5,
      fetchImplementation: async (_input, init) => {
        request = init;
        return Response.json({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "Answer [[1]](https://example.com/source)",
                  annotations: [
                    {
                      type: "url_citation",
                      url: "https://example.com/source",
                      title: "Example source",
                      start_index: 7,
                      end_index: 8,
                    },
                  ],
                },
              ],
            },
          ],
        });
      },
    });

    await expect(
      executor.execute({ query: "latest news" }, new AbortController().signal),
    ).resolves.toEqual({
      query: "latest news",
      answer: "Answer [1]",
      results: [
        {
          title: "Example source",
          url: "https://example.com/source",
          content: "Answer [1]",
        },
      ],
    });
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({
      model: "grok-4.5",
      input: "latest news",
      store: false,
      tools: [{ type: "web_search" }],
    });
    expect(body.tools).not.toContainEqual({ type: "x_search" });
  });

  it("adds X Search only when explicitly enabled and accepts a third-party URL", async () => {
    let target = "";
    let request: RequestInit | undefined;
    const executor = createGrokToolExecutor({
      apiKey: "xai-test-secret",
      responsesUrl: "https://proxy.example/responses",
      model: "custom-grok",
      xSearch: true,
      maxResults: 3,
      fetchImplementation: async (input, init) => {
        target = String(input);
        request = init;
        return Response.json({ output_text: "No citations" });
      },
    });

    await expect(
      executor.execute({ query: "social" }, new AbortController().signal),
    ).resolves.toEqual({
      query: "social",
      answer: "No citations",
      results: [],
    });
    expect(target).toBe("https://proxy.example/responses");
    expect(JSON.parse(String(request?.body)).tools).toEqual([
      { type: "web_search" },
      { type: "x_search" },
    ]);
  });
});
