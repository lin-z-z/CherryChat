import { jsonSchema, tool, type JSONSchema7, type Tool } from "ai";

import type { JsonValue, ToolCallPart } from "@/runtime/chat/types";
import type {
  ToolExecutionLedger,
  ToolLedgerEntry,
} from "@/runtime/agent/ai-sdk/compatibility-middleware";
import type { AiSdkStreamProjector } from "@/runtime/agent/ai-sdk/stream-projector";
import {
  parseToolArguments,
  parseToolResult,
  serializeToolResultForModel,
} from "@/runtime/transport/tool-wire";
import type { ToolRegistry } from "@/runtime/tools/tool-registry";

type AgentTool = Tool<Record<string, JsonValue>, JsonValue>;
export type AgentToolSet = Record<string, AgentTool>;

interface ToolAdapterOptions {
  registry: ToolRegistry;
  ledger: ToolExecutionLedger;
  projector: AiSdkStreamProjector;
  signal: AbortSignal;
}

export function createAgentTools(options: ToolAdapterOptions): AgentToolSet {
  return Object.fromEntries(
    options.registry.definitions().map((definition) => {
      const name = definition.function.name;
      const adapted = tool<Record<string, JsonValue>, JsonValue>({
        description: definition.function.description,
        inputSchema: jsonSchema<Record<string, JsonValue>>(
          definition.function.parameters as JSONSchema7,
          {
            validate(value) {
              try {
                return {
                  success: true,
                  value: parseToolArguments(JSON.stringify(value)),
                };
              } catch (error) {
                return {
                  success: false,
                  error:
                    error instanceof Error
                      ? error
                      : new Error("Invalid tool input"),
                };
              }
            },
          },
        ),
        ...(definition.function.strict === undefined
          ? {}
          : { strict: definition.function.strict }),
        async execute(input, execution) {
          const entry =
            options.ledger.get(execution.toolCallId) ??
            fallbackEntry(execution.toolCallId, name, input);
          const running = options.registry.prepare(entry.call, entry.step);
          await options.projector.checkpointTool(running, entry.order);
          const part = await options.registry.execute(
            entry.call,
            execution.abortSignal ?? options.signal,
            entry.step,
          );
          options.ledger.recordResult(part);
          await options.projector.checkpointTool(part, entry.order);
          return toolOutput(part);
        },
        toModelOutput({ toolCallId, output }) {
          const part = options.ledger.result(toolCallId);
          return {
            type: "json",
            value: part
              ? parseToolResult(serializeToolResultForModel(part))
              : output,
          };
        },
      });
      return [name, adapted];
    }),
  );
}

function fallbackEntry(
  id: string,
  name: string,
  input: Record<string, JsonValue>,
): ToolLedgerEntry {
  return {
    call: { id, name, arguments: JSON.stringify(input) },
    step: 0,
    order: Number.MAX_SAFE_INTEGER,
  };
}

function toolOutput(part: ToolCallPart): JsonValue {
  return part.status === "completed"
    ? part.output
    : { error: part.errorCode ?? "TOOL_REQUEST_FAILED" };
}
