import type { ChatCompletionsRequest } from "@/runtime/chat/chat-completions-contract";
import type { TokenUsage } from "@/runtime/chat/types";
import type {
  StreamResult,
  StreamSnapshot,
  ThrottledStreamPersistence,
} from "@/runtime/streaming/stream-state";
import type { ChatTransportConnection } from "@/runtime/transport/chat-transport-factory";
import type { RequestTimeoutPolicy } from "@/runtime/transport/request-timeout-policy";
import type { ToolRegistry } from "@/runtime/tools/tool-registry";

export const AGENT_RUNTIME_KINDS = [
  "ai-sdk-openai-compatible",
  "ai-sdk-openai-responses",
  "ai-sdk-google",
  "ai-sdk-anthropic",
] as const;

export type AgentRuntimeKind = (typeof AGENT_RUNTIME_KINDS)[number];

export interface AgentRuntimeOptions {
  request: ChatCompletionsRequest;
  connection: ChatTransportConnection;
  timeoutPolicy: RequestTimeoutPolicy;
  registry: ToolRegistry;
  signal: AbortSignal;
  persistence: ThrottledStreamPersistence;
  onSnapshot?: (snapshot: StreamSnapshot) => void;
  estimateUsage?: (snapshot: {
    reasoningText: string;
    finalText: string;
  }) => TokenUsage;
  now?: () => number;
  maxSteps?: number;
  maxToolCalls?: number;
  supportsReasoning: boolean;
}

export interface AgentRuntime {
  run(options: AgentRuntimeOptions): Promise<StreamResult>;
}
