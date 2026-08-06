import type { ChatCompletionToolDefinition } from "@/runtime/chat/chat-completions-contract";
import type { JsonValue, ToolCallPart } from "@/runtime/chat/types";
import { parseToolArguments } from "@/runtime/transport/tool-wire";

export type ToolErrorCode =
  | "TOOL_NOT_AVAILABLE"
  | "INVALID_TOOL_INPUT"
  | "TOOL_AUTH_FAILED"
  | "TOOL_RATE_LIMITED"
  | "TOOL_REQUEST_FAILED"
  | "TOOL_REQUEST_TIMEOUT"
  | "TOOL_SERVICE_UNAVAILABLE"
  | "TOOL_REQUEST_ABORTED";

export class ToolExecutionError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    readonly status: number | null = null,
    readonly retryable: boolean = isRetryableToolError(code, status),
  ) {
    super(code);
    this.name = "ToolExecutionError";
  }
}

export interface ToolExecutor {
  definition: ChatCompletionToolDefinition;
  dedupeKey?(input: Record<string, JsonValue>): string | null;
  execute(
    input: Record<string, JsonValue>,
    signal: AbortSignal,
  ): Promise<JsonValue>;
}

export interface NormalizedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export class ToolRegistry {
  private readonly executors: ReadonlyMap<string, ToolExecutor>;

  constructor(executors: readonly ToolExecutor[]) {
    this.executors = new Map(
      executors.map((executor) => [
        executor.definition.function.name,
        executor,
      ]),
    );
  }

  definitions(): ChatCompletionToolDefinition[] {
    return [...this.executors.values()].map(({ definition }) =>
      structuredClone(definition),
    );
  }

  deduplicateCalls(calls: readonly NormalizedToolCall[]): NormalizedToolCall[] {
    const seenIds = new Set<string>();
    const seenDedupeKeys = new Map<string, Set<string>>();
    const uniqueCalls: NormalizedToolCall[] = [];
    for (const call of calls) {
      if (call.id) {
        if (seenIds.has(call.id)) continue;
        seenIds.add(call.id);
      }

      const dedupeKey = this.dedupeKey(call);
      if (dedupeKey !== null) {
        const toolKeys = seenDedupeKeys.get(call.name) ?? new Set<string>();
        if (toolKeys.has(dedupeKey)) continue;
        toolKeys.add(dedupeKey);
        seenDedupeKeys.set(call.name, toolKeys);
      }
      uniqueCalls.push(call);
    }
    return uniqueCalls;
  }

  prepare(call: NormalizedToolCall, step: number): ToolCallPart {
    try {
      return {
        type: "tool_call",
        id: call.id,
        name: call.name,
        step,
        input: parseToolArguments(call.arguments),
        output: null,
        status: "running",
        errorCode: null,
        errorStatus: null,
        retryable: false,
      };
    } catch {
      return failedPart(call, {}, "INVALID_TOOL_INPUT", step);
    }
  }

  async execute(
    call: NormalizedToolCall,
    signal: AbortSignal,
    step = 0,
  ): Promise<ToolCallPart> {
    if (signal.aborted) throw signal.reason;
    const executor = this.executors.get(call.name);
    if (!executor) {
      return failedPart(call, {}, "TOOL_NOT_AVAILABLE", step);
    }

    let input: Record<string, JsonValue>;
    try {
      input = parseToolArguments(call.arguments);
    } catch {
      return failedPart(call, {}, "INVALID_TOOL_INPUT", step);
    }

    try {
      const output = await executor.execute(input, signal);
      return {
        type: "tool_call",
        id: call.id,
        name: call.name,
        step,
        input,
        output,
        status: "completed",
        errorCode: null,
        errorStatus: null,
        retryable: false,
      };
    } catch (cause) {
      if (signal.aborted) throw signal.reason;
      return cause instanceof ToolExecutionError
        ? failedPart(
            call,
            input,
            cause.code,
            step,
            cause.status,
            cause.retryable,
          )
        : failedPart(call, input, "TOOL_REQUEST_FAILED", step);
    }
  }

  private dedupeKey(call: NormalizedToolCall): string | null {
    const executor = this.executors.get(call.name);
    if (!executor?.dedupeKey) return null;
    try {
      return executor.dedupeKey(parseToolArguments(call.arguments));
    } catch {
      return null;
    }
  }
}

function failedPart(
  call: NormalizedToolCall,
  input: Record<string, JsonValue>,
  code: ToolErrorCode,
  step: number,
  errorStatus: number | null = null,
  retryable = isRetryableToolError(code, errorStatus),
): ToolCallPart {
  return {
    type: "tool_call",
    id: call.id,
    name: call.name,
    step,
    input,
    output: null,
    status: "error",
    errorCode: code,
    errorStatus,
    retryable,
  };
}

function isRetryableToolError(
  code: ToolErrorCode,
  status: number | null,
): boolean {
  return (
    code === "TOOL_REQUEST_TIMEOUT" ||
    code === "TOOL_RATE_LIMITED" ||
    code === "TOOL_SERVICE_UNAVAILABLE" ||
    code === "TOOL_REQUEST_ABORTED" ||
    (status !== null && status >= 500)
  );
}
