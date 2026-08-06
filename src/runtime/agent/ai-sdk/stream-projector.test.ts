import { describe, expect, it } from "vitest";

import { AiSdkStreamProjector } from "@/runtime/agent/ai-sdk/stream-projector";
import {
  ThrottledStreamPersistence,
  type StreamPersistencePort,
  type StreamResult,
  type StreamSnapshot,
} from "@/runtime/streaming/stream-state";

class RecordingPersistence implements StreamPersistencePort {
  drafts: StreamSnapshot[] = [];
  results: StreamResult[] = [];

  async saveDraft(snapshot: StreamSnapshot): Promise<void> {
    this.drafts.push(structuredClone(snapshot));
  }

  async finalize(result: StreamResult): Promise<void> {
    this.results.push({ ...structuredClone(result), error: result.error });
  }
}

function metadata(itemId: string, encryptedContent: unknown) {
  return {
    openai: {
      itemId,
      reasoningEncryptedContent: encryptedContent,
      ignored: "provider-field",
    },
  };
}

describe("AiSdkStreamProjector provider context", () => {
  it("deduplicates validated encrypted reasoning metadata and allocates usage once", async () => {
    const persistence = new RecordingPersistence();
    const projector = new AiSdkStreamProjector({
      persistence: new ThrottledStreamPersistence(persistence, 0),
      now: () => 100,
    });

    projector.startStep(0);
    projector.pushReasoning("summary");
    await projector.captureProviderContext(
      metadata("reasoning-1", "encrypted-1"),
    );
    await projector.captureProviderContext(
      metadata("reasoning-1", "encrypted-1"),
    );
    await projector.captureProviderContext(
      metadata("reasoning-2", "encrypted-2"),
    );
    await projector.captureProviderContext(metadata("invalid", null));
    projector.finishStep({
      promptTokens: 10,
      completionTokens: 8,
      reasoningTokens: 6,
      totalTokens: 18,
      estimated: false,
    });

    const result = await projector.complete();

    expect(result.providerContextParts).toEqual([
      expect.objectContaining({
        itemId: "reasoning-1",
        encryptedContent: "encrypted-1",
        reasoningTokens: 6,
      }),
      expect.objectContaining({
        itemId: "reasoning-2",
        encryptedContent: "encrypted-2",
        reasoningTokens: 0,
      }),
    ]);
    expect(
      result.providerContextParts.reduce(
        (total, part) =>
          total +
          (part.provider === "openai-responses"
            ? (part.reasoningTokens ?? 0)
            : 0),
        0,
      ),
    ).toBe(6);
    expect(JSON.stringify(result)).not.toContain("provider-field");
    expect(persistence.drafts.at(-1)?.providerContextParts).toHaveLength(2);
    expect(persistence.results).toHaveLength(1);
  });

  it("drops malformed or oversized metadata without losing visible output", async () => {
    const persistence = new RecordingPersistence();
    const projector = new AiSdkStreamProjector({
      persistence: new ThrottledStreamPersistence(persistence, 0),
    });

    projector.startStep(0);
    await projector.captureProviderContext({ openai: { itemId: 12 } });
    await projector.captureProviderContext(
      metadata("oversized", "x".repeat(524_289)),
    );
    projector.pushText("Visible answer");

    const result = await projector.complete();

    expect(result.state).toBe("completed");
    expect(result.finalText).toBe("Visible answer");
    expect(result.providerContextParts).toEqual([]);
  });

  it("keeps captured context with unknown usage when generation stops", async () => {
    const persistence = new RecordingPersistence();
    const projector = new AiSdkStreamProjector({
      persistence: new ThrottledStreamPersistence(persistence, 0),
    });
    projector.startStep(0);
    await projector.captureProviderContext(
      metadata("reasoning-stop", "encrypted-stop"),
    );
    projector.pushReasoning("Partial summary");

    const result = await projector.fail(null, true);

    expect(result.state).toBe("stopped");
    expect(result.providerContextParts).toEqual([
      expect.objectContaining({
        itemId: "reasoning-stop",
        encryptedContent: "encrypted-stop",
        reasoningTokens: null,
      }),
    ]);
    expect(persistence.results[0]?.providerContextParts).toEqual(
      result.providerContextParts,
    );
  });

  it("validates and deduplicates Gemini thought signatures by tool call", async () => {
    const persistence = new RecordingPersistence();
    const projector = new AiSdkStreamProjector({
      persistence: new ThrottledStreamPersistence(persistence, 0),
    });
    projector.startStep(0);
    projector.captureToolProviderContext(
      { google: { thoughtSignature: "signature-1", ignored: "field" } },
      0,
      "call-1",
    );
    projector.captureToolProviderContext(
      { google: { thoughtSignature: "signature-repeat" } },
      0,
      "call-1",
    );
    projector.captureToolProviderContext(
      { google: { thoughtSignature: 42 } },
      0,
      "call-invalid",
    );

    const result = await projector.complete();

    expect(result.providerContextParts).toEqual([
      {
        type: "provider_context",
        provider: "gemini",
        contextType: "thought_signature",
        step: 0,
        toolCallId: "call-1",
        thoughtSignature: "signature-1",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("ignored");
  });

  it("checkpoints a complete split Anthropic signature at reasoning end", async () => {
    const persistence = new RecordingPersistence();
    const projector = new AiSdkStreamProjector({
      persistence: new ThrottledStreamPersistence(persistence, 0),
    });
    projector.startStep(0);
    await projector.captureAnthropicReasoningStart("reasoning-0", undefined);
    projector.pushReasoning("Private plan");
    await projector.captureAnthropicReasoningDelta(
      "reasoning-0",
      "Private ",
      undefined,
    );
    await projector.captureAnthropicReasoningDelta("reasoning-0", "plan", {
      anthropic: { signature: "signature-" },
    });
    expect(projector.currentSnapshot().providerContextParts).toEqual([]);
    await projector.captureAnthropicReasoningDelta("reasoning-0", "", {
      anthropic: { signature: "complete" },
    });
    await projector.captureAnthropicReasoningEnd("reasoning-0", undefined);

    const result = await projector.complete();

    expect(result.providerContextParts).toEqual([
      {
        type: "provider_context",
        provider: "anthropic",
        contextType: "thinking",
        step: 0,
        blockIndex: 0,
        text: "Private plan",
        signature: "signature-complete",
      },
    ]);
    expect(persistence.drafts.at(-1)?.providerContextParts).toEqual(
      result.providerContextParts,
    );
  });

  it("durably captures redacted Anthropic thinking at block start", async () => {
    const persistence = new RecordingPersistence();
    const projector = new AiSdkStreamProjector({
      persistence: new ThrottledStreamPersistence(persistence, 0),
    });
    projector.startStep(0);
    await projector.captureAnthropicReasoningStart("reasoning-redacted", {
      anthropic: { redactedData: "encrypted-redacted", ignored: "field" },
    });
    await projector.captureAnthropicReasoningStart("reasoning-invalid", {
      anthropic: { signature: 42 },
    });

    const result = await projector.complete();

    expect(result.providerContextParts).toEqual([
      {
        type: "provider_context",
        provider: "anthropic",
        contextType: "redacted_thinking",
        step: 0,
        blockIndex: 0,
        redactedData: "encrypted-redacted",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("ignored");
    expect(persistence.drafts.at(-1)?.providerContextParts).toEqual(
      result.providerContextParts,
    );
  });

  it.each(["deepseek-chat", "glm-chat"] as const)(
    "persists complete %s reasoning steps only after a tool call exists",
    async (provider) => {
      const withoutToolPersistence = new RecordingPersistence();
      const withoutTool = new AiSdkStreamProjector({
        persistence: new ThrottledStreamPersistence(withoutToolPersistence, 0),
        captureReasoningContent: { provider, capture: "tool-call" },
      });
      withoutTool.startStep(0);
      withoutTool.pushReasoning("No tool plan");
      expect((await withoutTool.complete()).providerContextParts).toEqual([]);

      const persistence = new RecordingPersistence();
      const projector = new AiSdkStreamProjector({
        persistence: new ThrottledStreamPersistence(persistence, 0),
        captureReasoningContent: { provider, capture: "tool-call" },
      });
      projector.startStep(0);
      projector.pushReasoning("Search first");
      await projector.checkpointTool(
        {
          type: "tool_call",
          id: "call-1",
          name: "web_search",
          step: 0,
          input: { query: "storm" },
          output: null,
          status: "running",
          errorCode: null,
          errorStatus: null,
          retryable: false,
        },
        0,
      );
      projector.finishStep(null);
      projector.startStep(1);
      projector.pushReasoning("Summarize sources");
      projector.pushText("Final answer");

      const result = await projector.complete();

      expect(result.providerContextParts).toEqual([
        {
          type: "provider_context",
          provider,
          contextType: "reasoning_content",
          step: 0,
          text: "Search first",
        },
        {
          type: "provider_context",
          provider,
          contextType: "reasoning_content",
          step: 1,
          text: "Summarize sources",
        },
      ]);
      expect(persistence.drafts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            providerContextParts: [
              expect.objectContaining({
                provider,
                step: 0,
                text: "Search first",
              }),
            ],
          }),
        ]),
      );
    },
  );

  it.each(["qwen-chat", "kimi-chat"] as const)(
    "persists complete %s reasoning without requiring a tool call",
    async (provider) => {
      const persistence = new RecordingPersistence();
      const projector = new AiSdkStreamProjector({
        persistence: new ThrottledStreamPersistence(persistence, 0),
        captureReasoningContent: { provider, capture: "always" },
      });
      projector.startStep(0);
      projector.pushReasoning("Private plan");
      projector.pushText("Final answer");

      const result = await projector.complete();

      expect(result.providerContextParts).toEqual([
        {
          type: "provider_context",
          provider,
          contextType: "reasoning_content",
          step: 0,
          text: "Private plan",
        },
      ]);
      expect(persistence.results.at(-1)?.providerContextParts).toEqual(
        result.providerContextParts,
      );
    },
  );
});
