import { describe, expect, it } from "vitest";

import {
  ContextBudgetExceededError,
  selectRequestContext,
  type ContextCandidate,
  type ContextTruncationReason,
  type SelectContextInput,
  type SelectedContext,
} from "@/runtime/chat/context-selection";
import type { ChatCompletionMessage } from "@/runtime/chat/chat-completions-contract";
import type { TokenEstimator } from "@/runtime/chat/token-estimator";

const estimator: TokenEstimator = {
  estimate: (messages) => ({
    tokens: messages.length * 10,
    estimated: false,
    method: "o200k_base",
  }),
};

function user(text: string) {
  return { role: "user", content: text } satisfies ChatCompletionMessage;
}

function assistant(text: string) {
  return { role: "assistant", content: text } satisfies ChatCompletionMessage;
}

function history(
  ...messages: Extract<ChatCompletionMessage, { role: "user" | "assistant" }>[]
): ContextCandidate[] {
  return messages.map((message, index) => ({
    id: `message-${index}`,
    messages: [message],
  }));
}

function roundHistory(roundCount: number): ContextCandidate[] {
  return history(
    ...Array.from({ length: roundCount }, (_, index) => [
      user(`user-${index}`),
      assistant(`assistant-${index}`),
    ]).flat(),
  );
}

function countingEstimator(
  countTokens: (messages: readonly ChatCompletionMessage[]) => number = (
    messages,
  ) => messages.length * 10,
) {
  let calls = 0;
  return {
    estimator: {
      estimate: (messages) => {
        calls += 1;
        return {
          tokens: countTokens(messages),
          estimated: false,
          method: "o200k_base" as const,
        };
      },
    } satisfies TokenEstimator,
    calls: () => calls,
  };
}

type TestRound = { messages: ContextCandidate["messages"] };

function selectRequestContextLinearly(
  input: SelectContextInput,
): SelectedContext {
  const referenceEstimator = input.estimator;
  if (!referenceEstimator) {
    throw new Error("The linear test oracle requires an injected estimator");
  }

  const reasons = new Set<ContextTruncationReason>();
  let eligible = [...input.history];
  if (input.contextCutoffId) {
    const cutoffIndex = eligible.findIndex(
      ({ id }) => id === input.contextCutoffId,
    );
    if (cutoffIndex >= 0) {
      eligible = eligible.slice(cutoffIndex + 1);
      reasons.add("cutoff");
    }
  }

  const rounds = toCompleteTestRounds(eligible);
  const limitedRounds =
    input.historyMessageLimit === undefined
      ? rounds
      : rounds.slice(
          Math.max(
            0,
            rounds.length - Math.floor(input.historyMessageLimit / 2),
          ),
        );
  if (limitedRounds.length < rounds.length) reasons.add("message_limit");

  const reservedOutputTokens =
    input.reservedOutputTokens ??
    Math.min(4096, Math.max(1024, Math.floor(input.contextWindow * 0.25)));
  const safetyMarginTokens = Math.max(
    256,
    Math.floor(input.contextWindow * 0.05),
  );
  const inputBudgetTokens =
    input.contextWindow - reservedOutputTokens - safetyMarginTokens;
  const baseMessages: ChatCompletionMessage[] = [
    ...(input.systemMessage ? [input.systemMessage] : []),
    input.currentUserMessage,
  ];
  const baseEstimate = referenceEstimator.estimate(baseMessages, input.modelId);
  if (baseEstimate.tokens > inputBudgetTokens) {
    throw new ContextBudgetExceededError(
      baseEstimate.tokens,
      inputBudgetTokens,
    );
  }

  const selectedNewestFirst: TestRound[] = [];
  for (let index = limitedRounds.length - 1; index >= 0; index -= 1) {
    const round = limitedRounds[index];
    if (!round) continue;
    const chronological = [round, ...selectedNewestFirst].flatMap(
      ({ messages }) => messages,
    );
    const candidateMessages: ChatCompletionMessage[] = [
      ...(input.systemMessage ? [input.systemMessage] : []),
      ...chronological,
      input.currentUserMessage,
    ];
    if (
      referenceEstimator.estimate(candidateMessages, input.modelId).tokens >
      inputBudgetTokens
    ) {
      reasons.add("token_budget");
      break;
    }
    selectedNewestFirst.unshift(round);
  }

  const selectedHistory = selectedNewestFirst.flatMap(
    ({ messages }) => messages,
  );
  const messages: ChatCompletionMessage[] = [
    ...(input.systemMessage ? [input.systemMessage] : []),
    ...selectedHistory,
    input.currentUserMessage,
  ];

  return {
    messages,
    configuredHistoryMessages:
      input.historyMessageLimit ?? limitedRounds.length * 2,
    actualHistoryMessages: selectedNewestFirst.length * 2,
    contextWindow: input.contextWindow,
    reservedOutputTokens,
    safetyMarginTokens,
    inputBudgetTokens,
    inputEstimate: referenceEstimator.estimate(messages, input.modelId),
    truncationReasons: [...reasons],
  };
}

function toCompleteTestRounds(
  candidates: readonly ContextCandidate[],
): TestRound[] {
  const rounds: TestRound[] = [];
  let pendingUser: Extract<ChatCompletionMessage, { role: "user" }> | null =
    null;

  for (const candidate of candidates) {
    const first = candidate.messages[0];
    if (!first) continue;
    if (first.role === "user") {
      pendingUser = first;
    } else if (first.role === "assistant" && pendingUser) {
      rounds.push({ messages: [pendingUser, ...candidate.messages] });
      pendingUser = null;
    }
  }
  return rounds;
}

describe("request context selection", () => {
  it("uses the token budget as the only history limit by default", () => {
    const result = selectRequestContext({
      modelId: "custom-model",
      contextWindow: 4096,
      contextCutoffId: null,
      systemMessage: null,
      history: history(
        user("u1"),
        assistant("a1"),
        user("u2"),
        assistant("a2"),
      ),
      currentUserMessage: user("current"),
      estimator,
    });

    expect(result.actualHistoryMessages).toBe(4);
    expect(result.truncationReasons).not.toContain("message_limit");
  });

  it("honors a context cutoff without restoring the legacy message limit", () => {
    const result = selectRequestContext({
      modelId: "custom-model",
      contextWindow: 4096,
      contextCutoffId: "message-1",
      systemMessage: null,
      history: history(
        user("u1"),
        assistant("a1"),
        user("u2"),
        assistant("a2"),
      ),
      currentUserMessage: user("current"),
      estimator,
    });

    expect(result.messages.map((message) => message.content)).toEqual([
      "u2",
      "a2",
      "current",
    ]);
    expect(result.truncationReasons).toContain("cutoff");
    expect(result.truncationReasons).not.toContain("message_limit");
  });

  it("sends only system and current user when the history limit is zero", () => {
    const result = selectRequestContext({
      modelId: "custom-model",
      contextWindow: 4096,
      historyMessageLimit: 0,
      contextCutoffId: null,
      systemMessage: { role: "system", content: "Rules" },
      history: history(user("old"), assistant("answer")),
      currentUserMessage: user("current"),
      estimator,
    });

    expect(result.messages).toEqual([
      { role: "system", content: "Rules" },
      { role: "user", content: "current" },
    ]);
    expect(result.actualHistoryMessages).toBe(0);
  });

  it("keeps complete rounds when the configured limit is odd", () => {
    const result = selectRequestContext({
      modelId: "custom-model",
      contextWindow: 4096,
      historyMessageLimit: 5,
      contextCutoffId: null,
      systemMessage: null,
      history: history(
        user("u1"),
        assistant("a1"),
        user("u2"),
        assistant("a2"),
        user("u3"),
        assistant("a3"),
      ),
      currentUserMessage: user("current"),
      estimator,
    });

    expect(result.messages.map((message) => message.content)).toEqual([
      "u2",
      "a2",
      "u3",
      "a3",
      "current",
    ]);
    expect(result.actualHistoryMessages).toBe(4);
    expect(result.truncationReasons).toContain("message_limit");
  });

  it("stops at the newest oversized round instead of splitting or skipping it", () => {
    const result = selectRequestContext({
      modelId: "custom-model",
      contextWindow: 4096,
      historyMessageLimit: 4,
      contextCutoffId: null,
      systemMessage: null,
      history: history(
        user("u1"),
        assistant("a1"),
        user("u2"),
        assistant("a2"),
      ),
      currentUserMessage: user("current"),
      estimator: {
        estimate: (messages) => ({
          tokens: messages.some((message) => message.content === "u2")
            ? 3000
            : messages.length * 10,
          estimated: false,
          method: "o200k_base",
        }),
      },
      reservedOutputTokens: 1024,
    });

    expect(result.messages.map((message) => message.content)).toEqual([
      "current",
    ]);
    expect(result.truncationReasons).toContain("token_budget");
  });

  it("counts encrypted provider context and drops its complete old round", () => {
    const oldAssistant = {
      role: "assistant" as const,
      content: "old answer",
      providerContext: [
        {
          type: "provider_context" as const,
          provider: "openai-responses" as const,
          contextType: "reasoning" as const,
          step: 0,
          itemId: "reasoning-old",
          encryptedContent: "encrypted-old",
          reasoningTokens: 3000,
        },
      ],
    };
    const result = selectRequestContext({
      modelId: "gpt-5",
      contextWindow: 4096,
      contextCutoffId: null,
      systemMessage: null,
      history: history(user("u1"), oldAssistant, user("u2"), assistant("a2")),
      currentUserMessage: user("current"),
    });

    expect(result.messages.map((message) => message.content)).toEqual([
      "u2",
      "a2",
      "current",
    ]);
    expect(JSON.stringify(result.messages)).not.toContain("encrypted-old");
    expect(result.truncationReasons).toContain("token_budget");
  });

  it("counts Gemini signatures and drops only their complete old round", () => {
    const oldAssistant = {
      role: "assistant" as const,
      content: "old Gemini answer",
      providerContext: [
        {
          type: "provider_context" as const,
          provider: "gemini" as const,
          contextType: "thought_signature" as const,
          step: 0,
          toolCallId: "old-call",
          thoughtSignature: "签名".repeat(1_500),
        },
      ],
    };
    const result = selectRequestContext({
      modelId: "gemini-3.1-pro",
      contextWindow: 4096,
      contextCutoffId: null,
      systemMessage: null,
      history: history(user("u1"), oldAssistant, user("u2"), assistant("a2")),
      currentUserMessage: user("current"),
    });

    expect(result.messages.map((message) => message.content)).toEqual([
      "u2",
      "a2",
      "current",
    ]);
    expect(JSON.stringify(result.messages)).not.toContain("old-call");
    expect(result.truncationReasons).toContain("token_budget");
  });

  it("counts Anthropic thinking replay and drops its complete old round", () => {
    const oldAssistant = {
      role: "assistant" as const,
      content: "old Claude answer",
      providerContext: [
        {
          type: "provider_context" as const,
          provider: "anthropic" as const,
          contextType: "thinking" as const,
          step: 0,
          blockIndex: 0,
          text: "思考".repeat(1_500),
          signature: "anthropic-old-signature",
        },
      ],
    };
    const result = selectRequestContext({
      modelId: "claude-sonnet-4-6",
      contextWindow: 4096,
      contextCutoffId: null,
      systemMessage: null,
      history: history(user("u1"), oldAssistant, user("u2"), assistant("a2")),
      currentUserMessage: user("current"),
    });

    expect(result.messages.map((message) => message.content)).toEqual([
      "u2",
      "a2",
      "current",
    ]);
    expect(JSON.stringify(result.messages)).not.toContain(
      "anthropic-old-signature",
    );
    expect(result.truncationReasons).toContain("token_budget");
  });

  it("rejects a system prompt and current message that already exceed the budget", () => {
    expect(() =>
      selectRequestContext({
        modelId: "custom-model",
        contextWindow: 4096,
        historyMessageLimit: 0,
        contextCutoffId: null,
        systemMessage: { role: "system", content: "Rules" },
        history: [],
        currentUserMessage: user("current"),
        estimator: {
          estimate: () => ({
            tokens: 9999,
            estimated: false,
            method: "o200k_base",
          }),
        },
      }),
    ).toThrow(ContextBudgetExceededError);
  });

  it("matches the previous linear selector across deterministic histories", () => {
    const weightedEstimator: TokenEstimator = {
      estimate: (messages) => ({
        tokens: messages.reduce((tokens, message) => {
          const contentTokens =
            typeof message.content === "string" ? message.content.length : 0;
          return tokens + 4 + contentTokens;
        }, 2),
        estimated: false,
        method: "o200k_base",
      }),
    };

    for (let sample = 0; sample < 48; sample += 1) {
      const roundCount = sample % 24;
      const historyMessageLimit =
        sample % 3 === 0 ? (sample * 7) % 21 : undefined;
      const generatedHistory = history(
        ...Array.from({ length: roundCount }, (_, index) => [
          user(`u${index}-${"x".repeat(((sample + index * 7) % 80) + 1)}`),
          assistant(
            `a${index}-${"y".repeat(((sample * 3 + index * 11) % 120) + 1)}`,
          ),
        ]).flat(),
      );
      const input = {
        modelId: "custom-model",
        contextWindow: 2048 + (sample % 8) * 256,
        ...(historyMessageLimit === undefined ? {} : { historyMessageLimit }),
        contextCutoffId:
          sample % 4 === 0 && generatedHistory.length > 0
            ? `message-${sample % generatedHistory.length}`
            : null,
        systemMessage:
          sample % 2 === 0
            ? ({ role: "system", content: `rules-${sample}` } as const)
            : null,
        history: generatedHistory,
        currentUserMessage: user(`current-${sample}`),
        reservedOutputTokens: 1024,
        estimator: weightedEstimator,
      } satisfies SelectContextInput;

      expect(selectRequestContext(input)).toEqual(
        selectRequestContextLinearly(input),
      );
    }
  });

  it("reuses the base estimate when there are no complete history rounds", () => {
    const counter = countingEstimator();

    const result = selectRequestContext({
      modelId: "custom-model",
      contextWindow: 4096,
      contextCutoffId: null,
      systemMessage: null,
      history: [],
      currentUserMessage: user("current"),
      estimator: counter.estimator,
    });

    expect(result.actualHistoryMessages).toBe(0);
    expect(counter.calls()).toBe(1);
  });

  it("estimates one fitting history round only once after the base", () => {
    const counter = countingEstimator();

    const result = selectRequestContext({
      modelId: "custom-model",
      contextWindow: 4096,
      contextCutoffId: null,
      systemMessage: null,
      history: roundHistory(1),
      currentUserMessage: user("current"),
      estimator: counter.estimator,
    });

    expect(result.actualHistoryMessages).toBe(2);
    expect(counter.calls()).toBe(2);
  });

  it("estimates 800 fully fitting rounds at most twice", () => {
    const counter = countingEstimator();

    const result = selectRequestContext({
      modelId: "custom-model",
      contextWindow: 100_000,
      contextCutoffId: null,
      systemMessage: null,
      history: roundHistory(800),
      currentUserMessage: user("current"),
      reservedOutputTokens: 1024,
      estimator: counter.estimator,
    });

    expect(result.actualHistoryMessages).toBe(1600);
    expect(counter.calls()).toBeLessThanOrEqual(2);
  });

  it("finds a partially fitting suffix with logarithmic estimates", () => {
    const roundCount = 800;
    const counter = countingEstimator();

    const result = selectRequestContext({
      modelId: "custom-model",
      contextWindow: 4096,
      contextCutoffId: null,
      systemMessage: null,
      history: roundHistory(roundCount),
      currentUserMessage: user("current"),
      reservedOutputTokens: 1024,
      estimator: counter.estimator,
    });

    expect(result.actualHistoryMessages).toBeGreaterThan(0);
    expect(result.actualHistoryMessages).toBeLessThan(roundCount * 2);
    expect(counter.calls()).toBeLessThanOrEqual(
      2 + Math.ceil(Math.log2(roundCount + 1)),
    );
  });

  it("drops all history when the newest round alone exceeds the budget", () => {
    const roundCount = 800;
    const counter = countingEstimator((messages) =>
      messages.some((message) => message.content === `user-${roundCount - 1}`)
        ? 9999
        : messages.length * 10,
    );

    const result = selectRequestContext({
      modelId: "custom-model",
      contextWindow: 4096,
      contextCutoffId: null,
      systemMessage: null,
      history: roundHistory(roundCount),
      currentUserMessage: user("current"),
      reservedOutputTokens: 1024,
      estimator: counter.estimator,
    });

    expect(result.messages).toEqual([user("current")]);
    expect(result.truncationReasons).toContain("token_budget");
    expect(counter.calls()).toBeLessThanOrEqual(
      2 + Math.ceil(Math.log2(roundCount + 1)),
    );
  });
});
