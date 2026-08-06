import type { ChatCompletionMessage } from "@/runtime/chat/chat-completions-contract";
import {
  DefaultTokenEstimator,
  type TokenEstimate,
  type TokenEstimator,
} from "@/runtime/chat/token-estimator";

export type ContextTruncationReason =
  "cutoff" | "message_limit" | "token_budget";

export interface ContextCandidate {
  id: string;
  messages: Array<
    Extract<ChatCompletionMessage, { role: "user" | "assistant" | "tool" }>
  >;
}

export interface SelectContextInput {
  modelId: string;
  contextWindow: number;
  historyMessageLimit?: number;
  contextCutoffId: string | null;
  systemMessage: Extract<ChatCompletionMessage, { role: "system" }> | null;
  history: readonly ContextCandidate[];
  currentUserMessage: Extract<ChatCompletionMessage, { role: "user" }>;
  reservedOutputTokens?: number;
  estimator?: TokenEstimator;
}

export interface SelectedContext {
  messages: ChatCompletionMessage[];
  configuredHistoryMessages: number;
  actualHistoryMessages: number;
  contextWindow: number;
  reservedOutputTokens: number;
  safetyMarginTokens: number;
  inputBudgetTokens: number;
  inputEstimate: TokenEstimate;
  truncationReasons: ContextTruncationReason[];
}

export class ContextBudgetExceededError extends Error {
  readonly code = "CONTEXT_TOO_LARGE";

  constructor(
    readonly requiredTokens: number,
    readonly inputBudgetTokens: number,
  ) {
    super(
      `System prompt and current message require ${requiredTokens} tokens, but the input budget is ${inputBudgetTokens}`,
    );
    this.name = "ContextBudgetExceededError";
  }
}

export function selectRequestContext(
  input: SelectContextInput,
): SelectedContext {
  validateContextInput(input);
  const estimator = input.estimator ?? new DefaultTokenEstimator();
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

  const rounds = toCompleteRounds(eligible);
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
    clamp(Math.floor(input.contextWindow * 0.25), 1024, 4096);
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
  const baseEstimate = estimator.estimate(baseMessages, input.modelId);
  if (baseEstimate.tokens > inputBudgetTokens) {
    throw new ContextBudgetExceededError(
      baseEstimate.tokens,
      inputBudgetTokens,
    );
  }

  let selectedStart = limitedRounds.length;
  let selectedEstimate = baseEstimate;

  if (limitedRounds.length > 0) {
    const allMessages = buildContextMessages(
      input.systemMessage,
      limitedRounds,
      input.currentUserMessage,
    );
    const allEstimate = estimator.estimate(allMessages, input.modelId);

    if (allEstimate.tokens <= inputBudgetTokens) {
      selectedStart = 0;
      selectedEstimate = allEstimate;
    } else {
      reasons.add("token_budget");
      let lower = 1;
      let upper = limitedRounds.length;

      while (lower < upper) {
        const middle = Math.floor((lower + upper) / 2);
        const candidateMessages = buildContextMessages(
          input.systemMessage,
          limitedRounds.slice(middle),
          input.currentUserMessage,
        );
        const candidateEstimate = estimator.estimate(
          candidateMessages,
          input.modelId,
        );

        if (candidateEstimate.tokens <= inputBudgetTokens) {
          upper = middle;
          selectedEstimate = candidateEstimate;
        } else {
          lower = middle + 1;
        }
      }

      selectedStart = lower;
    }
  }

  const selectedRounds = limitedRounds.slice(selectedStart);
  const messages = buildContextMessages(
    input.systemMessage,
    selectedRounds,
    input.currentUserMessage,
  );

  return {
    messages,
    configuredHistoryMessages:
      input.historyMessageLimit ?? limitedRounds.length * 2,
    actualHistoryMessages: selectedRounds.length * 2,
    contextWindow: input.contextWindow,
    reservedOutputTokens,
    safetyMarginTokens,
    inputBudgetTokens,
    inputEstimate: selectedEstimate,
    truncationReasons: [...reasons],
  };
}

interface CompleteRound {
  messages: Array<
    Extract<ChatCompletionMessage, { role: "user" | "assistant" | "tool" }>
  >;
}

function buildContextMessages(
  systemMessage: SelectContextInput["systemMessage"],
  rounds: readonly CompleteRound[],
  currentUserMessage: SelectContextInput["currentUserMessage"],
): ChatCompletionMessage[] {
  return [
    ...(systemMessage ? [systemMessage] : []),
    ...rounds.flatMap(({ messages }) => messages),
    currentUserMessage,
  ];
}

function toCompleteRounds(
  history: readonly ContextCandidate[],
): CompleteRound[] {
  const rounds: CompleteRound[] = [];
  let pendingUser: Extract<ChatCompletionMessage, { role: "user" }> | null =
    null;

  for (const candidate of history) {
    const first = candidate.messages[0];
    if (!first) continue;
    if (first.role === "user") {
      pendingUser = first;
      continue;
    }
    if (first.role === "assistant" && pendingUser) {
      rounds.push({ messages: [pendingUser, ...candidate.messages] });
      pendingUser = null;
    }
  }
  return rounds;
}

function validateContextInput(input: SelectContextInput): void {
  if (
    input.historyMessageLimit !== undefined &&
    (!Number.isInteger(input.historyMessageLimit) ||
      input.historyMessageLimit < 0 ||
      input.historyMessageLimit > 20)
  ) {
    throw new RangeError(
      "History message limit must be an integer from 0 to 20",
    );
  }
  if (!Number.isInteger(input.contextWindow) || input.contextWindow < 1024) {
    throw new RangeError("Context window must be an integer of at least 1024");
  }
  if (
    input.reservedOutputTokens !== undefined &&
    (!Number.isInteger(input.reservedOutputTokens) ||
      input.reservedOutputTokens <= 0)
  ) {
    throw new RangeError("Reserved output tokens must be a positive integer");
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
