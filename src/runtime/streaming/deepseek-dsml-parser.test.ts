import { describe, expect, it } from "vitest";

import {
  DeepseekDsmlParser,
  isDeepseekModel,
} from "@/runtime/streaming/deepseek-dsml-parser";

const OPEN = "<｜｜DSML｜｜tool_calls>";
const CLOSE = "</｜｜DSML｜｜tool_calls>";

describe("DeepSeek DSML parser", () => {
  it("extracts split tool calls without exposing DSML as answer text", () => {
    const parser = new DeepseekDsmlParser(() => "dsml_1");
    const chunks = [
      "I will search.<｜｜DS",
      'ML｜｜tool_calls><｜｜DSML｜｜invoke name="web_search">',
      '<｜｜DSML｜｜parameter name="query" string="true">current docs',
      "</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke>",
      "</｜｜DSML｜｜tool_calls>After search.",
    ];
    const results = chunks.map((chunk) => parser.push(chunk));
    const finished = parser.finish();

    expect(results.map(({ text }) => text).join("") + finished.text).toBe(
      "I will search.After search.",
    );
    expect(results.flatMap(({ toolCalls }) => toolCalls)).toEqual([
      {
        id: "dsml_1",
        name: "web_search",
        arguments: '{"query":"current docs"}',
      },
    ]);
  });

  it("preserves malformed or unfinished DSML as text", () => {
    const malformed = new DeepseekDsmlParser();
    expect(malformed.push(`${OPEN}not an invoke${CLOSE}`).text).toBe(
      `${OPEN}not an invoke${CLOSE}`,
    );

    const unfinished = new DeepseekDsmlParser();
    unfinished.push(`${OPEN}<｜｜DSML｜｜invoke name="web_search">`);
    expect(unfinished.finish()).toEqual({
      text: `${OPEN}<｜｜DSML｜｜invoke name="web_search">`,
      toolCalls: [],
    });
  });

  it("gates the compatibility parser to DeepSeek model identities", () => {
    expect(isDeepseekModel("deepseek-v4-pro")).toBe(true);
    expect(isDeepseekModel("provider/deepseek_v4_flash")).toBe(true);
    expect(isDeepseekModel("grok-4.5")).toBe(false);
  });

  it("keeps tool call IDs unique across parser instances", () => {
    const parseCallId = () => {
      const parser = new DeepseekDsmlParser();
      return parser.push(
        `${OPEN}<｜｜DSML｜｜invoke name="web_search"><｜｜DSML｜｜parameter name="query">current</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke>${CLOSE}`,
      ).toolCalls[0]?.id;
    };

    const first = parseCallId();
    const second = parseCallId();
    expect(first).toMatch(/^dsml_[0-9a-f-]{36}$/u);
    expect(second).toMatch(/^dsml_[0-9a-f-]{36}$/u);
    expect(second).not.toBe(first);
  });
});
