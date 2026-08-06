import {
  canAppendAnthropicThinkingContext,
  parseAnthropicReasoningMetadata,
  parseAnthropicThinkingContext,
} from "@/runtime/agent/ai-sdk/anthropic-provider-context";
import {
  canAppendOpenAIResponsesProviderContext,
  parseOpenAIResponsesProviderContext,
} from "@/runtime/agent/ai-sdk/openai-responses-provider-context";
import {
  canAppendGeminiThoughtSignatureContext,
  parseGeminiThoughtSignatureContext,
} from "@/runtime/agent/ai-sdk/gemini-provider-context";
import {
  canAppendOpenAIChatReasoningContext,
  createOpenAIChatReasoningContext,
} from "@/runtime/agent/ai-sdk/deepseek-provider-context";
import type {
  AnthropicThinkingContextPart,
  GeminiThoughtSignatureContextPart,
  OpenAIChatReasoningContextBehavior,
  OpenAIChatReasoningContextPart,
  OpenAIResponsesContextPart,
  ProviderContextPart,
  TokenUsage,
  ToolCallPart,
} from "@/runtime/chat/types";
import {
  ReasoningParser,
  type ReasoningSnapshot,
} from "@/runtime/streaming/reasoning-parser";
import type {
  StreamResult,
  StreamSnapshot,
  ThrottledStreamPersistence,
} from "@/runtime/streaming/stream-state";
import type { ChatTransportError } from "@/runtime/transport/chat-errors";

interface ProjectedStep {
  parser: ReasoningParser;
  parsed: ReasoningSnapshot;
  tools: Map<string, { part: ToolCallPart; order: number }>;
  providerContext: Map<string, ProviderContextPart>;
  anthropicReasoningDrafts: Map<string, AnthropicReasoningDraft>;
  nextAnthropicBlockIndex: number;
  usage: TokenUsage | null;
  reasoningStartedAt: number | null;
  answerStartedAt: number | null;
  finishedAt: number | null;
}

interface AnthropicReasoningDraft {
  blockIndex: number;
  text: string;
  signature: string;
  redactedData: string | null;
}

interface StreamProjectorOptions {
  persistence: ThrottledStreamPersistence;
  onSnapshot?: (snapshot: StreamSnapshot) => void;
  estimateUsage?: (snapshot: {
    reasoningText: string;
    finalText: string;
  }) => TokenUsage;
  now?: () => number;
  captureReasoningContent?: OpenAIChatReasoningContextBehavior;
}

export class AiSdkStreamProjector {
  private readonly steps = new Map<number, ProjectedStep>();
  private readonly startedAt: number;
  private activeStep = 0;
  private totalUsage: TokenUsage | null = null;

  constructor(private readonly options: StreamProjectorOptions) {
    this.startedAt = this.now();
  }

  startStep(step?: number): void {
    this.activeStep = step ?? this.activeStep + (this.steps.size > 0 ? 1 : 0);
    this.ensureStep(this.activeStep);
    this.emitDraft();
  }

  pushText(text: string): void {
    if (!text) return;
    const step = this.ensureStep(this.activeStep);
    step.parsed = step.parser.push(text, "");
    this.updateStepTiming(step);
    this.emitDraft();
  }

  pushReasoning(text: string): void {
    if (!text) return;
    const step = this.ensureStep(this.activeStep);
    step.parsed = step.parser.push("", text);
    this.updateStepTiming(step);
    this.emitDraft();
  }

  async captureProviderContext(providerMetadata: unknown): Promise<void> {
    const candidate = parseOpenAIResponsesProviderContext(
      providerMetadata,
      this.activeStep,
    );
    if (!candidate) return;
    const current = this.providerContextParts().filter(
      (part): part is OpenAIResponsesContextPart =>
        part.provider === "openai-responses",
    );
    if (!canAppendOpenAIResponsesProviderContext(current, candidate)) return;
    const step = this.ensureStep(this.activeStep);
    step.providerContext.set(`openai:${candidate.itemId}`, candidate);
    const snapshot = this.snapshot(this.draftState());
    await this.options.persistence.checkpoint(snapshot);
    this.options.onSnapshot?.(snapshot);
  }

  captureToolProviderContext(
    providerMetadata: unknown,
    stepNumber: number,
    toolCallId: string,
  ): void {
    const candidate = parseGeminiThoughtSignatureContext(
      providerMetadata,
      stepNumber,
      toolCallId,
    );
    if (!candidate) return;
    const current = this.providerContextParts().filter(
      (part): part is GeminiThoughtSignatureContextPart =>
        part.provider === "gemini",
    );
    if (!canAppendGeminiThoughtSignatureContext(current, candidate)) return;
    const step = this.ensureStep(stepNumber);
    step.providerContext.set(
      `gemini:${candidate.step}:${candidate.toolCallId}`,
      candidate,
    );
    this.emitDraft();
  }

  async captureAnthropicReasoningStart(
    reasoningId: string,
    providerMetadata: unknown,
  ): Promise<void> {
    const draft = this.anthropicDraft(reasoningId);
    mergeAnthropicMetadata(draft, providerMetadata);
    if (draft.redactedData) await this.checkpointAnthropicDraft(draft);
  }

  async captureAnthropicReasoningDelta(
    reasoningId: string,
    text: string,
    providerMetadata: unknown,
  ): Promise<void> {
    const draft = this.anthropicDraft(reasoningId);
    draft.text += text;
    mergeAnthropicMetadata(draft, providerMetadata);
    if (draft.redactedData) await this.checkpointAnthropicDraft(draft);
  }

  async captureAnthropicReasoningEnd(
    reasoningId: string,
    providerMetadata: unknown,
  ): Promise<void> {
    const draft = this.anthropicDraft(reasoningId);
    mergeAnthropicMetadata(draft, providerMetadata);
    await this.checkpointAnthropicDraft(draft);
  }

  async captureGeneratedAnthropicReasoning(
    blockIndex: number,
    text: string,
    providerMetadata: unknown,
  ): Promise<void> {
    const step = this.ensureStep(this.activeStep);
    const reasoningId = `generated:${blockIndex}`;
    const draft: AnthropicReasoningDraft = {
      blockIndex,
      text,
      signature: "",
      redactedData: null,
    };
    step.anthropicReasoningDrafts.set(reasoningId, draft);
    step.nextAnthropicBlockIndex = Math.max(
      step.nextAnthropicBlockIndex,
      blockIndex + 1,
    );
    mergeAnthropicMetadata(draft, providerMetadata);
    await this.checkpointAnthropicDraft(draft);
  }

  finishStep(usage: TokenUsage | null): void {
    const step = this.ensureStep(this.activeStep);
    step.parsed = step.parser.finish();
    step.finishedAt = this.now();
    step.usage = usage;
    assignReasoningTokens(step, usage?.reasoningTokens ?? null);
    this.emitDraft();
  }

  setTotalUsage(usage: TokenUsage | null): void {
    this.totalUsage = usage;
  }

  async checkpointTool(part: ToolCallPart, order: number): Promise<void> {
    const step = this.ensureStep(part.step);
    step.tools.set(part.id, { part, order });
    const snapshot = this.snapshot("connecting");
    await this.options.persistence.checkpoint(snapshot);
    this.options.onSnapshot?.(snapshot);
  }

  currentSnapshot(): StreamSnapshot {
    return this.snapshot(this.draftState());
  }

  async complete(): Promise<StreamResult> {
    this.finishParsers();
    const snapshot = this.snapshot("completed");
    const usage =
      snapshot.usage ?? this.options.estimateUsage?.(snapshot) ?? null;
    const terminal = {
      ...snapshot,
      usage,
      state: "completed",
      error: null,
    } satisfies StreamResult;
    await this.options.persistence.finish(terminal);
    this.options.onSnapshot?.(terminal);
    return terminal;
  }

  async fail(
    error: ChatTransportError | null,
    stopped: boolean,
  ): Promise<StreamResult> {
    this.finishParsers();
    if (stopped) this.interruptRunningTools();
    const snapshot = this.snapshot(stopped ? "stopped" : "error");
    const usage =
      snapshot.usage ?? this.options.estimateUsage?.(snapshot) ?? null;
    const terminal = {
      ...snapshot,
      usage,
      state: stopped ? "stopped" : "error",
      error: stopped ? null : error,
    } satisfies StreamResult;
    await this.options.persistence.finish(terminal);
    this.options.onSnapshot?.(terminal);
    return terminal;
  }

  private ensureStep(stepNumber: number): ProjectedStep {
    const existing = this.steps.get(stepNumber);
    if (existing) return existing;
    const parser = new ReasoningParser();
    const created: ProjectedStep = {
      parser,
      parsed: parser.snapshot(),
      tools: new Map(),
      providerContext: new Map(),
      anthropicReasoningDrafts: new Map(),
      nextAnthropicBlockIndex: 0,
      usage: null,
      reasoningStartedAt: null,
      answerStartedAt: null,
      finishedAt: null,
    };
    this.steps.set(stepNumber, created);
    return created;
  }

  private updateStepTiming(step: ProjectedStep): void {
    const timestamp = this.now();
    if (step.parsed.reasoningText && step.reasoningStartedAt === null) {
      step.reasoningStartedAt = timestamp;
    }
    if (step.parsed.finalText && step.answerStartedAt === null) {
      step.answerStartedAt = timestamp;
    }
  }

  private emitDraft(): void {
    const snapshot = this.snapshot(this.draftState());
    this.options.persistence.record(snapshot);
    this.options.onSnapshot?.(snapshot);
  }

  private snapshot(state: StreamSnapshot["state"]): StreamSnapshot {
    const orderedSteps = [...this.steps.entries()].sort(
      ([left], [right]) => left - right,
    );
    const reasoning = orderedSteps.flatMap(([, step]) =>
      step.parsed.reasoningText ? [step.parsed.reasoningText] : [],
    );
    const answers = orderedSteps.flatMap(([, step]) =>
      step.parsed.finalText ? [step.parsed.finalText] : [],
    );
    const sources = orderedSteps.flatMap(([, step]) =>
      step.parsed.reasoningSource ? [step.parsed.reasoningSource] : [],
    );
    const current = orderedSteps.at(-1)?.[1];
    return {
      state,
      reasoningText: reasoning.join("\n\n"),
      finalText: answers.join("\n\n"),
      reasoningSource: sources.at(-1) ?? null,
      tagState: current?.parsed.tagState ?? "before-content",
      usage:
        this.totalUsage ??
        mergeStepUsage(orderedSteps.map(([, step]) => step.usage)),
      reasoningDurationMs: reasoningDuration(
        orderedSteps.map(([, step]) => step),
        this.now(),
      ),
      startedAt: this.startedAt,
      updatedAt: this.now(),
      toolCalls: [],
      providerContextParts: this.providerContextParts(),
      contentParts: orderedSteps.flatMap(([, step]) => [
        ...(step.parsed.finalText
          ? [{ type: "text" as const, text: step.parsed.finalText }]
          : []),
        ...[...step.tools.values()]
          .sort((left, right) => left.order - right.order)
          .map(({ part }) => part),
      ]),
    };
  }

  private draftState(): StreamSnapshot["state"] {
    const snapshot = this.snapshot("connecting");
    if (snapshot.finalText) return "answering";
    if (snapshot.reasoningText) return "reasoning";
    return "connecting";
  }

  private finishParsers(): void {
    for (const step of this.steps.values()) {
      step.parsed = step.parser.finish();
      step.finishedAt ??= this.now();
    }
  }

  private interruptRunningTools(): void {
    for (const step of this.steps.values()) {
      for (const [id, entry] of step.tools) {
        if (entry.part.status !== "running") continue;
        step.tools.set(id, {
          ...entry,
          part: {
            ...entry.part,
            status: "error",
            errorCode: "TOOL_REQUEST_ABORTED",
            errorStatus: null,
            retryable: true,
          },
        });
      }
    }
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private providerContextParts(): ProviderContextPart[] {
    const stored = [...this.steps.entries()]
      .sort(([left], [right]) => left - right)
      .flatMap(([, step]) => [...step.providerContext.values()]);
    if (
      !this.options.captureReasoningContent ||
      (this.options.captureReasoningContent.capture === "tool-call" &&
        ![...this.steps.values()].some(({ tools }) => tools.size > 0))
    ) {
      return stored;
    }

    const reasoningContext: OpenAIChatReasoningContextPart[] = [];
    for (const [stepNumber, step] of [...this.steps.entries()].sort(
      ([left], [right]) => left - right,
    )) {
      if (
        step.parsed.reasoningSource !== "reasoning_content" ||
        !step.parsed.reasoningText
      ) {
        continue;
      }
      const candidate = createOpenAIChatReasoningContext(
        this.options.captureReasoningContent.provider,
        stepNumber,
        step.parsed.reasoningText,
      );
      if (
        candidate &&
        canAppendOpenAIChatReasoningContext(reasoningContext, candidate)
      ) {
        reasoningContext.push(candidate);
      }
    }
    return [...stored, ...reasoningContext];
  }

  private anthropicDraft(reasoningId: string): AnthropicReasoningDraft {
    const step = this.ensureStep(this.activeStep);
    const existing = step.anthropicReasoningDrafts.get(reasoningId);
    if (existing) return existing;
    const created: AnthropicReasoningDraft = {
      blockIndex: step.nextAnthropicBlockIndex,
      text: "",
      signature: "",
      redactedData: null,
    };
    step.nextAnthropicBlockIndex += 1;
    step.anthropicReasoningDrafts.set(reasoningId, created);
    return created;
  }

  private async checkpointAnthropicDraft(
    draft: AnthropicReasoningDraft,
  ): Promise<void> {
    const candidate = parseAnthropicThinkingContext(
      draft.redactedData
        ? {
            type: "provider_context",
            provider: "anthropic",
            contextType: "redacted_thinking",
            step: this.activeStep,
            blockIndex: draft.blockIndex,
            redactedData: draft.redactedData,
          }
        : draft.signature
          ? {
              type: "provider_context",
              provider: "anthropic",
              contextType: "thinking",
              step: this.activeStep,
              blockIndex: draft.blockIndex,
              text: draft.text,
              signature: draft.signature,
            }
          : null,
    );
    if (!candidate) return;
    const key = `anthropic:${candidate.step}:${candidate.blockIndex}`;
    const step = this.ensureStep(this.activeStep);
    if (step.providerContext.has(key)) return;
    const current = this.providerContextParts().filter(
      (part): part is AnthropicThinkingContextPart =>
        part.provider === "anthropic",
    );
    if (!canAppendAnthropicThinkingContext(current, candidate)) return;
    step.providerContext.set(key, candidate);
    const snapshot = this.snapshot(this.draftState());
    await this.options.persistence.checkpoint(snapshot);
    this.options.onSnapshot?.(snapshot);
  }
}

function mergeAnthropicMetadata(
  draft: AnthropicReasoningDraft,
  providerMetadata: unknown,
): void {
  const metadata = parseAnthropicReasoningMetadata(providerMetadata);
  if (!metadata) return;
  if (metadata.redactedData) {
    draft.redactedData ??= metadata.redactedData;
    return;
  }
  if (metadata.signature) {
    draft.signature = appendMetadataFragment(
      draft.signature,
      metadata.signature,
    );
  }
}

function appendMetadataFragment(current: string, fragment: string): string {
  if (!current) return fragment;
  if (current === fragment || current.endsWith(fragment)) return current;
  if (fragment.startsWith(current)) return fragment;
  return `${current}${fragment}`;
}

function assignReasoningTokens(
  step: ProjectedStep,
  reasoningTokens: number | null,
): void {
  if (reasoningTokens === null || step.providerContext.size === 0) return;
  let allocated = false;
  for (const [itemId, part] of step.providerContext) {
    if (part.provider !== "openai-responses") continue;
    step.providerContext.set(itemId, {
      ...part,
      reasoningTokens: allocated ? 0 : reasoningTokens,
    });
    allocated = true;
  }
}

function mergeStepUsage(
  usages: readonly (TokenUsage | null)[],
): TokenUsage | null {
  let merged: TokenUsage | null = null;
  for (const usage of usages) {
    if (!usage) continue;
    merged = merged ? addUsage(merged, usage) : usage;
  }
  return merged;
}

function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    promptTokens: addOptional(left.promptTokens, right.promptTokens),
    completionTokens: addOptional(
      left.completionTokens,
      right.completionTokens,
    ),
    reasoningTokens: addOptional(left.reasoningTokens, right.reasoningTokens),
    totalTokens: addOptional(left.totalTokens, right.totalTokens),
    estimated: left.estimated || right.estimated,
  };
}

function addOptional(left: number | null, right: number | null): number | null {
  return left === null && right === null ? null : (left ?? 0) + (right ?? 0);
}

function reasoningDuration(
  steps: readonly ProjectedStep[],
  now: number,
): number | null {
  let duration = 0;
  let hasReasoning = false;
  for (const step of steps) {
    if (step.reasoningStartedAt === null) continue;
    hasReasoning = true;
    duration +=
      (step.answerStartedAt ?? step.finishedAt ?? now) -
      step.reasoningStartedAt;
  }
  return hasReasoning ? duration : null;
}
