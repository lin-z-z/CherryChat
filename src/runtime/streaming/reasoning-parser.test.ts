import { describe, expect, it } from "vitest";

import { ReasoningParser } from "@/runtime/streaming/reasoning-parser";

const tagged = "<think>reasoning</think>answer";

describe("ReasoningParser", () => {
  it("parses think tags at every two-chunk split point", () => {
    for (let split = 1; split < tagged.length; split += 1) {
      const parser = new ReasoningParser();
      parser.push(tagged.slice(0, split), "");
      parser.push(tagged.slice(split), "");
      expect(parser.finish()).toMatchObject({
        reasoningText: "reasoning",
        finalText: "answer",
        reasoningSource: "think_tag",
      });
    }
  });

  it("parses tags when every character arrives in its own chunk", () => {
    const parser = new ReasoningParser();
    for (const character of tagged) parser.push(character, "");

    expect(parser.finish()).toMatchObject({
      reasoningText: "reasoning",
      finalText: "answer",
    });
  });

  it("prefers structured reasoning while still removing duplicate think tags", () => {
    const parser = new ReasoningParser();
    parser.push("<think>tag copy</think>final", "structured");

    expect(parser.finish()).toMatchObject({
      reasoningText: "structured",
      finalText: "final",
      reasoningSource: "reasoning_content",
    });
  });

  it("treats an unclosed think block as reasoning at EOF", () => {
    const parser = new ReasoningParser();
    parser.push("<think>unfinished", "");

    expect(parser.finish()).toMatchObject({
      reasoningText: "unfinished",
      finalText: "",
    });
  });

  it("does not parse a think example after final text has started", () => {
    const parser = new ReasoningParser();
    parser.push("Example: <think>code</think>", "");

    expect(parser.finish()).toMatchObject({
      reasoningText: "",
      finalText: "Example: <think>code</think>",
    });
  });
});
