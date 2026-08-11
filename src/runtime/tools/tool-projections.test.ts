import { describe, expect, it } from "vitest";

import { projectWebSearchTool } from "@/runtime/tools/tool-projections";

describe("web search tool projection", () => {
  it("keeps a validated Grok answer and drops unsafe sources", () => {
    expect(
      projectWebSearchTool({
        type: "tool_call",
        id: "search-1",
        name: "web_search",
        step: 0,
        input: { query: "latest" },
        output: {
          query: "latest",
          answer: "A generated answer",
          results: [
            {
              title: "Safe",
              url: "https://example.com",
              content: "Summary",
            },
            {
              title: "Unsafe",
              url: "javascript:alert(1)",
              content: "Drop me",
            },
          ],
        },
        status: "completed",
        errorCode: null,
        errorStatus: null,
        retryable: false,
      }),
    ).toEqual({
      query: "latest",
      answer: "A generated answer",
      results: [
        {
          title: "Safe",
          url: "https://example.com",
          content: "Summary",
        },
      ],
    });
  });
});
