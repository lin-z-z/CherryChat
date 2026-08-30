import {
  APICallError,
  InvalidResponseDataError,
  InvalidToolInputError,
  JSONParseError,
  NoSuchToolError,
  stepCountIs,
  ToolLoopAgent,
  TypeValidationError,
  wrapLanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolLoopAgentSettings,
} from "ai";

import type { AgentRuntimeOptions } from "@/runtime/agent/agent-runtime";
import {
  createCompatibilityMiddleware,
  ToolExecutionLedger,
  type ToolLedgerEntry,
} from "@/runtime/agent/ai-sdk/compatibility-middleware";
import { AiSdkStreamProjector } from "@/runtime/agent/ai-sdk/stream-projector";
import { createAgentTools } from "@/runtime/agent/ai-sdk/tool-adapter";
import type {
  OpenAIChatReasoningContextBehavior,
  TokenUsage,
  ToolCallPart,
} from "@/runtime/chat/types";
import {
  ChatTransportError,
  errorCodeForStatus,
  hostedAuthErrorCodeFromBody,
} from "@/runtime/transport/chat-errors";

const DEFAULT_MAX_STEPS = 5;
const DEFAULT_MAX_TOOL_CALLS = 3;

export interface AiSdkPreparedAgent {
  model: Parameters<typeof wrapLanguageModel>[0]["model"];
  messages: ModelMessage[];
  settings: Pick<
    ToolLoopAgentSettings,
    "temperature" | "topP" | "maxOutputTokens" | "providerOptions"
  >;
}

export async function runAiSdkAgent(
  options: AgentRuntimeOptions,
  prepare: () => AiSdkPreparedAgent,
  behavior: {
    captureProviderContext?: boolean;
    captureToolProviderContext?: boolean;
    captureAnthropicContext?: boolean;
    captureReasoningContent?: OpenAIChatReasoningContextBehavior;
  } = {},
) {
  const projector = new AiSdkStreamProjector({
    persistence: options.persistence,
    ...(options.onSnapshot ? { onSnapshot: options.onSnapshot } : {}),
    ...(options.estimateUsage ? { estimateUsage: options.estimateUsage } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(behavior.captureReasoningContent
      ? {
          captureReasoningContent: behavior.captureReasoningContent,
        }
      : {}),
  });
  const ledger = new ToolExecutionLedger();
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxToolCalls = options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;

  try {
    const prepared = prepare();
    const model = wrapLanguageModel({
      model: prepared.model,
      middleware: createCompatibilityMiddleware({
        modelId: options.request.model,
        registry: options.registry,
        ledger,
        maxSteps,
        maxToolCalls,
        includeToolChoice: options.request.tool_choice === "auto",
        ...(behavior.captureToolProviderContext
          ? {
              onToolCallProviderMetadata(providerMetadata, step, toolCallId) {
                projector.captureToolProviderContext(
                  providerMetadata,
                  step,
                  toolCallId,
                );
              },
            }
          : {}),
      }),
    });
    const tools = createAgentTools({
      registry: options.registry,
      ledger,
      projector,
      signal: options.signal,
    });
    // ToolLoopAgent forwards onError to streamText even though the current
    // settings type omits it. Suppress raw provider errors in browser logs.
    const toolLoopSettings = {
      model,
      tools,
      stopWhen: stepCountIs(maxSteps),
      maxRetries: 0,
      onError: () => undefined,
      ...(Object.keys(tools).length > 0 &&
      options.request.tool_choice === "auto"
        ? { toolChoice: "auto" as const }
        : {}),
      ...prepared.settings,
    };
    const agent = new ToolLoopAgent(toolLoopSettings);

    if (options.request.stream) {
      const result = await agent.stream({
        messages: prepared.messages,
        abortSignal: options.signal,
      });
      let step = -1;
      for await (const part of result.fullStream) {
        if (part.type === "start-step") {
          step += 1;
          projector.startStep(step);
        } else if (part.type === "text-delta") {
          projector.pushText(part.text);
        } else if (part.type === "reasoning-start") {
          if (behavior.captureAnthropicContext) {
            await projector.captureAnthropicReasoningStart(
              part.id,
              part.providerMetadata,
            );
          }
        } else if (part.type === "reasoning-delta") {
          projector.pushReasoning(part.text);
          if (behavior.captureAnthropicContext) {
            await projector.captureAnthropicReasoningDelta(
              part.id,
              part.text,
              part.providerMetadata,
            );
          }
        } else if (part.type === "reasoning-end") {
          if (behavior.captureProviderContext) {
            await projector.captureProviderContext(part.providerMetadata);
          }
          if (behavior.captureAnthropicContext) {
            await projector.captureAnthropicReasoningEnd(
              part.id,
              part.providerMetadata,
            );
          }
        } else if (part.type === "finish-step") {
          projector.finishStep(toTokenUsage(part.usage));
        } else if (part.type === "finish") {
          projector.setTotalUsage(toTokenUsage(part.totalUsage));
        } else if (part.type === "tool-error") {
          await checkpointToolError(
            part.toolCallId,
            part.toolName,
            part.error,
            ledger,
            projector,
            options.signal,
          );
        } else if (part.type === "error") {
          throw part.error;
        } else if (part.type === "abort") {
          throw new ChatTransportError(
            "ABORTED",
            part.reason ?? "Request was cancelled",
            null,
          );
        }
      }
    } else {
      const result = await agent.generate({
        messages: prepared.messages,
        abortSignal: options.signal,
      });
      for (const step of result.steps) {
        projector.startStep(step.stepNumber);
        let reasoningIndex = 0;
        for (const part of step.content) {
          if (part.type === "text") projector.pushText(part.text);
          else if (part.type === "reasoning") {
            projector.pushReasoning(part.text);
            if (behavior.captureProviderContext) {
              await projector.captureProviderContext(part.providerMetadata);
            }
            if (behavior.captureAnthropicContext) {
              await projector.captureGeneratedAnthropicReasoning(
                reasoningIndex,
                part.text,
                part.providerMetadata,
              );
            }
            reasoningIndex += 1;
          } else if (part.type === "tool-error") {
            await checkpointToolError(
              part.toolCallId,
              part.toolName,
              part.error,
              ledger,
              projector,
              options.signal,
            );
          }
        }
        projector.finishStep(toTokenUsage(step.usage));
      }
      projector.setTotalUsage(toTokenUsage(result.totalUsage));
    }

    return await projector.complete();
  } catch (cause) {
    const stopped = options.signal.aborted || isAbortError(cause);
    return projector.fail(stopped ? null : toTransportError(cause), stopped);
  }
}

async function checkpointToolError(
  toolCallId: string,
  toolName: string,
  error: unknown,
  ledger: ToolExecutionLedger,
  projector: AiSdkStreamProjector,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw signal.reason;
  if (
    !NoSuchToolError.isInstance(error) &&
    !InvalidToolInputError.isInstance(error)
  ) {
    throw error;
  }
  const entry =
    ledger.get(toolCallId) ??
    ({
      call: { id: toolCallId, name: toolName, arguments: "{}" },
      step: 0,
      order: Number.MAX_SAFE_INTEGER,
    } satisfies ToolLedgerEntry);
  const part = {
    type: "tool_call",
    id: entry.call.id,
    name: entry.call.name,
    step: entry.step,
    input: {},
    output: null,
    status: "error",
    errorCode: NoSuchToolError.isInstance(error)
      ? "TOOL_NOT_AVAILABLE"
      : "INVALID_TOOL_INPUT",
    errorStatus: null,
    retryable: false,
  } satisfies ToolCallPart;
  ledger.recordResult(part);
  await projector.checkpointTool(part, entry.order);
}

function toTokenUsage(usage: LanguageModelUsage): TokenUsage | null {
  const promptTokens = usage.inputTokens ?? null;
  const completionTokens = usage.outputTokens ?? null;
  const reasoningTokens = usage.outputTokenDetails.reasoningTokens ?? null;
  const totalTokens = usage.totalTokens ?? null;
  if (
    promptTokens === null &&
    completionTokens === null &&
    reasoningTokens === null &&
    totalTokens === null
  ) {
    return null;
  }
  return {
    promptTokens,
    completionTokens,
    reasoningTokens,
    totalTokens,
    estimated: false,
  };
}

function toTransportError(cause: unknown): ChatTransportError {
  if (cause instanceof ChatTransportError) return cause;
  if (APICallError.isInstance(cause)) {
    const status = cause.statusCode ?? null;
    const hostedAuthCode = hostedAuthErrorCodeFromBody(cause.responseBody);
    return new ChatTransportError(
      hostedAuthCode ??
        (status === null ? "UPSTREAM_ERROR" : errorCodeForStatus(status)),
      "Upstream request failed",
      status,
    );
  }
  if (
    InvalidResponseDataError.isInstance(cause) ||
    JSONParseError.isInstance(cause) ||
    TypeValidationError.isInstance(cause)
  ) {
    return new ChatTransportError(
      "STREAM_PROTOCOL_ERROR",
      "Model response could not be parsed",
      null,
    );
  }
  if (
    InvalidToolInputError.isInstance(cause) ||
    NoSuchToolError.isInstance(cause)
  ) {
    return new ChatTransportError(
      "INVALID_REQUEST",
      "Model returned an invalid tool call",
      null,
    );
  }
  return new ChatTransportError(
    "UPSTREAM_ERROR",
    "Upstream request failed",
    null,
  );
}

function isAbortError(cause: unknown): boolean {
  return (
    (cause instanceof DOMException && cause.name === "AbortError") ||
    (cause instanceof ChatTransportError && cause.code === "ABORTED")
  );
}
