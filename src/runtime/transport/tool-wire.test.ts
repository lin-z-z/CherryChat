import { describe, expect, it } from "vitest";

import { serializeToolResultForModel } from "@/runtime/transport/tool-wire";

describe("tool wire projection", () => {
  it("projects web search results to a numbered source array", () => {
    expect(
      serializeToolResultForModel({
        name: "web_search",
        status: "completed",
        errorCode: null,
        output: {
          query: "current docs",
          results: [
            {
              title: "Source",
              url: "https://example.com",
              content: "Current information",
            },
          ],
        },
      }),
    ).toBe(
      '{"results":[{"id":1,"title":"Source","url":"https://example.com","content":"Current information"}]}',
    );
  });

  it("keeps non-search output and stable tool errors", () => {
    expect(
      serializeToolResultForModel({
        name: "other_tool",
        status: "completed",
        errorCode: null,
        output: { ok: true },
      }),
    ).toBe('{"ok":true}');
    expect(
      serializeToolResultForModel({
        name: "web_search",
        status: "error",
        errorCode: "TOOL_REQUEST_FAILED",
        output: null,
      }),
    ).toBe('{"error":"TOOL_REQUEST_FAILED"}');
  });
});
