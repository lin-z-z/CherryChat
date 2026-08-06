import type {
  AgentRuntime,
  AgentRuntimeKind,
} from "@/runtime/agent/agent-runtime";
import type { ChatApiType, ChatEndpointType } from "@/runtime/chat/types";

interface RuntimeConnectionIdentity {
  mode: "byok" | "hosted";
  apiType: ChatApiType;
  endpointType?: ChatEndpointType | undefined;
}

export function resolveAgentRuntimeKind(
  connection: RuntimeConnectionIdentity,
): AgentRuntimeKind {
  if (connection.mode === "hosted") return "ai-sdk-openai-compatible";

  switch (connection.apiType) {
    case "openai":
    case "openai-compatible":
      return "ai-sdk-openai-compatible";
    case "openai-responses":
      return "ai-sdk-openai-responses";
    case "gemini":
      return "ai-sdk-google";
    case "anthropic":
      return "ai-sdk-anthropic";
    case "new-api":
      return resolveNewApiRuntimeKind(connection.endpointType);
    default:
      return assertNever(connection.apiType);
  }
}

export async function loadAgentRuntime(
  kind: AgentRuntimeKind,
): Promise<AgentRuntime> {
  switch (kind) {
    case "ai-sdk-openai-compatible": {
      const runtimeModule =
        await import("@/runtime/agent/ai-sdk/ai-sdk-openai-compatible-runtime");
      return runtimeModule.aiSdkOpenAICompatibleRuntime;
    }
    case "ai-sdk-openai-responses": {
      const runtimeModule =
        await import("@/runtime/agent/ai-sdk/ai-sdk-openai-responses-runtime");
      return runtimeModule.aiSdkOpenAIResponsesRuntime;
    }
    case "ai-sdk-google": {
      const runtimeModule =
        await import("@/runtime/agent/ai-sdk/ai-sdk-google-runtime");
      return runtimeModule.aiSdkGoogleRuntime;
    }
    case "ai-sdk-anthropic": {
      const runtimeModule =
        await import("@/runtime/agent/ai-sdk/ai-sdk-anthropic-runtime");
      return runtimeModule.aiSdkAnthropicRuntime;
    }
    default:
      return assertNever(kind);
  }
}

function resolveNewApiRuntimeKind(
  endpointType: ChatEndpointType | undefined,
): AgentRuntimeKind {
  switch (endpointType) {
    case undefined:
    case "openai-chat":
      return "ai-sdk-openai-compatible";
    case "openai-responses":
      return "ai-sdk-openai-responses";
    case "gemini":
      return "ai-sdk-google";
    case "anthropic":
      return "ai-sdk-anthropic";
    default:
      return assertNever(endpointType);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported runtime identity: ${String(value)}`);
}
