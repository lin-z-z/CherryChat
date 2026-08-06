export type ThinkTagState = "before-content" | "in-think" | "final";

export interface ReasoningSnapshot {
  reasoningText: string;
  finalText: string;
  reasoningSource: "reasoning_content" | "think_tag" | null;
  tagState: ThinkTagState;
}

const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

export class ReasoningParser {
  private structuredReasoning = "";
  private tagReasoning = "";
  private finalText = "";
  private pending = "";
  private tagState: ThinkTagState = "before-content";

  push(content: string, reasoningContent: string): ReasoningSnapshot {
    if (reasoningContent) this.structuredReasoning += reasoningContent;
    if (content) this.consumeContent(content);
    return this.snapshot();
  }

  finish(): ReasoningSnapshot {
    if (this.tagState === "before-content" && this.pending) {
      this.finalText += this.pending;
      this.pending = "";
      this.tagState = "final";
    } else if (this.tagState === "in-think" && this.pending) {
      this.tagReasoning += this.pending;
      this.pending = "";
    }
    return this.snapshot();
  }

  snapshot(): ReasoningSnapshot {
    const hasStructured = this.structuredReasoning.length > 0;
    const reasoningText = hasStructured
      ? this.structuredReasoning
      : this.tagReasoning;
    return {
      reasoningText,
      finalText: this.finalText,
      reasoningSource: reasoningText
        ? hasStructured
          ? "reasoning_content"
          : "think_tag"
        : null,
      tagState: this.tagState,
    };
  }

  private consumeContent(content: string): void {
    if (this.tagState === "final") {
      this.finalText += content;
      return;
    }
    this.pending += content;
    if (this.tagState === "before-content") {
      if (OPEN_TAG.startsWith(this.pending)) return;
      if (this.pending.startsWith(OPEN_TAG)) {
        this.pending = this.pending.slice(OPEN_TAG.length);
        this.tagState = "in-think";
        this.consumeThinkBuffer();
        return;
      }
      this.finalText += this.pending;
      this.pending = "";
      this.tagState = "final";
      return;
    }
    this.consumeThinkBuffer();
  }

  private consumeThinkBuffer(): void {
    const closeIndex = this.pending.indexOf(CLOSE_TAG);
    if (closeIndex >= 0) {
      this.tagReasoning += this.pending.slice(0, closeIndex);
      this.finalText += this.pending.slice(closeIndex + CLOSE_TAG.length);
      this.pending = "";
      this.tagState = "final";
      return;
    }

    const retainedLength = longestClosingTagPrefixSuffix(this.pending);
    const safeLength = this.pending.length - retainedLength;
    this.tagReasoning += this.pending.slice(0, safeLength);
    this.pending = this.pending.slice(safeLength);
  }
}

function longestClosingTagPrefixSuffix(value: string): number {
  const maximum = Math.min(value.length, CLOSE_TAG.length - 1);
  for (let length = maximum; length > 0; length -= 1) {
    if (CLOSE_TAG.startsWith(value.slice(-length))) return length;
  }
  return 0;
}
