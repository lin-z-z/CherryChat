import type { LanguageModelMiddleware } from "ai";

import { TRUNCATED_CHAT_COMPLETION_FINISH_REASON } from "@/runtime/agent/ai-sdk/openai-compatible-stream-contract";
import type { ToolCallPart } from "@/runtime/chat/types";
import {
  DeepseekDsmlParser,
  isDeepseekModel,
} from "@/runtime/streaming/deepseek-dsml-parser";
import { ChatTransportError } from "@/runtime/transport/chat-errors";
import { parseToolArguments } from "@/runtime/transport/tool-wire";
import type {
  NormalizedToolCall,
  ToolRegistry,
} from "@/runtime/tools/tool-registry";

type WrapStream = NonNullable<LanguageModelMiddleware["wrapStream"]>;
type ModelStreamResult = Awaited<
  ReturnType<Parameters<WrapStream>[0]["doStream"]>
>;
type ModelStreamPart =
  ModelStreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;
type WrapGenerate = NonNullable<LanguageModelMiddleware["wrapGenerate"]>;
type ModelGenerateResult = Awaited<
  ReturnType<Parameters<WrapGenerate>[0]["doGenerate"]>
>;
type ModelGeneratePart = ModelGenerateResult["content"][number];
type ToolCallProviderMetadata = Extract<
  ModelStreamPart,
  { type: "tool-call" }
>["providerMetadata"];

interface CandidateToolCall extends NormalizedToolCall {
  source: "native" | "dsml";
  providerExecuted?: boolean;
  dynamic?: boolean;
  providerMetadata?: ToolCallProviderMetadata;
}

export interface ToolLedgerEntry {
  call: NormalizedToolCall;
  step: number;
  order: number;
}

export class ToolExecutionLedger {
  private readonly entries = new Map<string, ToolLedgerEntry>();
  private readonly results = new Map<string, ToolCallPart>();
  private nextOrder = 0;

  record(call: NormalizedToolCall, step: number): ToolLedgerEntry {
    const existing = this.entries.get(call.id);
    if (existing?.step === step) return existing;
    const uniqueCall = existing
      ? { ...call, id: this.uniqueId(call.id, step) }
      : call;
    const entry = { call: uniqueCall, step, order: this.nextOrder++ };
    this.entries.set(uniqueCall.id, entry);
    return entry;
  }

  get(toolCallId: string): ToolLedgerEntry | null {
    return this.entries.get(toolCallId) ?? null;
  }

  recordResult(part: ToolCallPart): void {
    this.results.set(part.id, part);
  }

  result(toolCallId: string): ToolCallPart | null {
    return this.results.get(toolCallId) ?? null;
  }

  private uniqueId(originalId: string, step: number): string {
    const base = `${originalId}__step_${step}`;
    let candidate = base;
    let suffix = 2;
    while (this.entries.has(candidate)) {
      candidate = `${base}_${suffix++}`;
    }
    return candidate;
  }
}

interface CompatibilityMiddlewareOptions {
  modelId: string;
  registry: ToolRegistry;
  ledger: ToolExecutionLedger;
  maxSteps: number;
  maxToolCalls: number;
  includeToolChoice: boolean;
  onToolCallProviderMetadata?: (
    providerMetadata: ToolCallProviderMetadata,
    step: number,
    toolCallId: string,
  ) => void;
}

export function createCompatibilityMiddleware(
  options: CompatibilityMiddlewareOptions,
): LanguageModelMiddleware {
  let nextStep = 0;
  let acceptedToolCalls = 0;

  const normalizeStepCalls = (
    step: number,
    candidates: readonly CandidateToolCall[],
  ): CandidateToolCall[] => {
    const merged = mergeReplayedCalls([
      ...candidates.filter(({ source }) => source === "native"),
      ...candidates.filter(({ source }) => source === "dsml"),
    ]);
    const unique = options.registry.deduplicateCalls(merged);
    if (unique.length === 0) return [];
    if (step >= options.maxSteps - 1) throw toolLimitError();
    if (acceptedToolCalls + unique.length > options.maxToolCalls) {
      throw toolLimitError();
    }
    acceptedToolCalls += unique.length;
    const candidatesById = new Map(merged.map((call) => [call.id, call]));
    return unique.map((call) => {
      const entry = options.ledger.record(call, step);
      const candidate = candidatesById.get(call.id) ?? {
        ...call,
        source: "native",
      };
      const normalized = { ...candidate, ...entry.call };
      if (normalized.providerMetadata) {
        options.onToolCallProviderMetadata?.(
          normalized.providerMetadata,
          step,
          normalized.id,
        );
      }
      return normalized;
    });
  };

  return {
    specificationVersion: "v3",
    transformParams({ params }) {
      if (options.includeToolChoice) return Promise.resolve(params);
      const transformed = { ...params };
      delete transformed.toolChoice;
      return Promise.resolve(transformed);
    },
    async wrapStream({ doStream }) {
      const step = nextStep++;
      if (step >= options.maxSteps) throw toolLimitError();
      const result = await doStream();
      const dsmlParser = isDeepseekModel(options.modelId)
        ? new DeepseekDsmlParser()
        : null;
      const candidates: CandidateToolCall[] = [];
      let lastTextId: string | null = null;
      let callsFlushed = false;

      const appendDsmlCalls = (calls: readonly NormalizedToolCall[]): void => {
        candidates.push(
          ...calls.map((call) => ({ ...call, source: "dsml" as const })),
        );
      };
      const flushDsml = (
        controller: TransformStreamDefaultController<ModelStreamPart>,
      ): void => {
        if (!dsmlParser) return;
        const remainder = dsmlParser.finish();
        appendDsmlCalls(remainder.toolCalls);
        if (remainder.text && lastTextId) {
          controller.enqueue({
            type: "text-delta",
            id: lastTextId,
            delta: remainder.text,
          });
        }
      };
      const flushCalls = (
        controller: TransformStreamDefaultController<ModelStreamPart>,
      ): CandidateToolCall[] => {
        if (callsFlushed) return [];
        callsFlushed = true;
        const normalized = normalizeStepCalls(step, candidates);
        for (const call of normalized) {
          controller.enqueue({
            type: "tool-input-start",
            id: call.id,
            toolName: call.name,
          });
          if (call.arguments) {
            controller.enqueue({
              type: "tool-input-delta",
              id: call.id,
              delta: call.arguments,
            });
          }
          controller.enqueue({ type: "tool-input-end", id: call.id });
          controller.enqueue({
            type: "tool-call",
            toolCallId: call.id,
            toolName: call.name,
            input: call.arguments,
            ...(call.providerExecuted
              ? { providerExecuted: call.providerExecuted }
              : {}),
            ...(call.dynamic ? { dynamic: call.dynamic } : {}),
            ...(call.providerMetadata
              ? { providerMetadata: call.providerMetadata }
              : {}),
          });
        }
        return normalized;
      };

      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream<ModelStreamPart, ModelStreamPart>({
            transform(part, controller) {
              if (part.type === "text-start") lastTextId = part.id;
              if (part.type === "text-delta" && dsmlParser) {
                lastTextId = part.id;
                const parsed = dsmlParser.push(part.delta);
                appendDsmlCalls(parsed.toolCalls);
                if (parsed.text) {
                  controller.enqueue({ ...part, delta: parsed.text });
                }
                return;
              }
              if (part.type === "text-end" && dsmlParser) {
                lastTextId = part.id;
                flushDsml(controller);
                controller.enqueue(part);
                return;
              }
              if (
                part.type === "tool-input-start" ||
                part.type === "tool-input-delta" ||
                part.type === "tool-input-end"
              ) {
                return;
              }
              if (part.type === "tool-call") {
                candidates.push({
                  id: part.toolCallId,
                  name: part.toolName,
                  arguments: part.input,
                  source: "native",
                  ...(part.providerExecuted
                    ? { providerExecuted: part.providerExecuted }
                    : {}),
                  ...(part.dynamic ? { dynamic: part.dynamic } : {}),
                  ...(part.providerMetadata
                    ? { providerMetadata: part.providerMetadata }
                    : {}),
                });
                return;
              }
              if (part.type === "finish") {
                if (
                  part.finishReason.raw ===
                  TRUNCATED_CHAT_COMPLETION_FINISH_REASON
                ) {
                  throw new ChatTransportError(
                    "STREAM_PROTOCOL_ERROR",
                    "Chat Completions stream ended without a terminal event",
                    null,
                  );
                }
                flushDsml(controller);
                const normalized = flushCalls(controller);
                controller.enqueue(
                  normalized.length > 0
                    ? {
                        ...part,
                        finishReason: {
                          unified: "tool-calls",
                          raw: part.finishReason.raw,
                        },
                      }
                    : part,
                );
                return;
              }
              controller.enqueue(part);
            },
            flush(controller) {
              flushDsml(controller);
              flushCalls(controller);
            },
          }),
        ),
      };
    },
    async wrapGenerate({ doGenerate }) {
      const step = nextStep++;
      if (step >= options.maxSteps) throw toolLimitError();
      const result = await doGenerate();
      const dsmlParser = isDeepseekModel(options.modelId)
        ? new DeepseekDsmlParser()
        : null;
      const preserved: ModelGeneratePart[] = [];
      const candidates: CandidateToolCall[] = [];
      for (const part of result.content) {
        if (part.type === "text" && dsmlParser) {
          const parsed = dsmlParser.push(part.text);
          if (parsed.text) preserved.push({ ...part, text: parsed.text });
          candidates.push(
            ...parsed.toolCalls.map((call) => ({
              ...call,
              source: "dsml" as const,
            })),
          );
        } else if (part.type === "tool-call") {
          candidates.push({
            id: part.toolCallId,
            name: part.toolName,
            arguments: part.input,
            source: "native",
            ...(part.providerExecuted
              ? { providerExecuted: part.providerExecuted }
              : {}),
            ...(part.dynamic ? { dynamic: part.dynamic } : {}),
            ...(part.providerMetadata
              ? { providerMetadata: part.providerMetadata }
              : {}),
          });
        } else {
          preserved.push(part);
        }
      }
      if (dsmlParser) {
        const remainder = dsmlParser.finish();
        if (remainder.text)
          preserved.push({ type: "text", text: remainder.text });
        candidates.push(
          ...remainder.toolCalls.map((call) => ({
            ...call,
            source: "dsml" as const,
          })),
        );
      }
      const normalized = normalizeStepCalls(step, candidates);
      return {
        ...result,
        content: [
          ...preserved,
          ...normalized.map((call): ModelGeneratePart => ({
            type: "tool-call",
            toolCallId: call.id,
            toolName: call.name,
            input: call.arguments,
            ...(call.providerExecuted
              ? { providerExecuted: call.providerExecuted }
              : {}),
            ...(call.dynamic ? { dynamic: call.dynamic } : {}),
            ...(call.providerMetadata
              ? { providerMetadata: call.providerMetadata }
              : {}),
          })),
        ],
        ...(normalized.length > 0
          ? {
              finishReason: {
                unified: "tool-calls" as const,
                raw: result.finishReason.raw,
              },
            }
          : {}),
      };
    },
  };
}

function mergeReplayedCalls(
  candidates: readonly CandidateToolCall[],
): CandidateToolCall[] {
  const merged: CandidateToolCall[] = [];
  const positions = new Map<string, number>();
  for (const candidate of candidates) {
    if (!candidate.id || !candidate.name) {
      throw new ChatTransportError(
        "STREAM_PROTOCOL_ERROR",
        "Tool call is missing an ID or name",
        null,
      );
    }
    const position = positions.get(candidate.id);
    if (position === undefined) {
      positions.set(candidate.id, merged.length);
      merged.push({ ...candidate });
      continue;
    }
    const existing = merged[position];
    if (!existing) continue;
    if (existing.name !== candidate.name) {
      throw new ChatTransportError(
        "STREAM_PROTOCOL_ERROR",
        "Tool call ID changed to a different tool name",
        null,
      );
    }
    merged[position] = {
      ...existing,
      arguments: preferCompleteArguments(
        existing.arguments,
        candidate.arguments,
      ),
      ...(existing.providerMetadata || candidate.providerMetadata
        ? {
            providerMetadata:
              existing.providerMetadata ?? candidate.providerMetadata,
          }
        : {}),
    };
  }
  return merged;
}

function preferCompleteArguments(existing: string, replay: string): string {
  if (!existing) return replay;
  if (!replay || existing === replay) return existing;
  if (isCompleteArguments(existing)) return existing;
  if (isCompleteArguments(replay)) return replay;
  return existing.length >= replay.length ? existing : replay;
}

function isCompleteArguments(value: string): boolean {
  try {
    parseToolArguments(value);
    return true;
  } catch {
    return false;
  }
}

function toolLimitError(): ChatTransportError {
  return new ChatTransportError(
    "INVALID_REQUEST",
    "Tool execution limit reached",
    null,
  );
}
