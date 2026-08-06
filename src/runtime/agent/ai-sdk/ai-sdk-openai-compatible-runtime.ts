import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import type { AgentRuntime } from "@/runtime/agent/agent-runtime";
import { runAiSdkAgent } from "@/runtime/agent/ai-sdk/agent-core";
import { toOpenAICompatibleModelMessages } from "@/runtime/agent/ai-sdk/model-message-converter";
import { createOpenAICompatibleAgentProviderOptions } from "@/runtime/agent/ai-sdk/openai-compatible-provider-fetch";
import type { ChatCompletionsRequest } from "@/runtime/chat/chat-completions-contract";
import type { JsonValue } from "@/runtime/chat/types";
import {
  encodeOpenAIChatReasoning,
  getOpenAIChatReasoningContextBehavior,
} from "@/runtime/transport/reasoning-wire";

const PROVIDER_NAME = "cherrychat";
const AGENT_CONTROLLED_REQUEST_FIELDS = new Set([
  "model",
  "messages",
  "stream",
  "reasoning",
  "thinking",
  "enable_thinking",
  "reasoning_effort",
  "temperature",
  "top_p",
  "max_tokens",
  "tools",
  "tool_choice",
]);

export const aiSdkOpenAICompatibleRuntime: AgentRuntime = {
  run(options) {
    const reasoningContentBehavior = getOpenAIChatReasoningContextBehavior(
      options.request.model,
      options.request.reasoning,
    );
    return runAiSdkAgent(
      options,
      () => {
        const providerOptions = createOpenAICompatibleAgentProviderOptions(
          options.connection,
          options.timeoutPolicy,
        );
        const provider = createOpenAICompatible({
          name: PROVIDER_NAME,
          ...providerOptions,
          includeUsage: false,
        });
        return {
          model: provider(options.request.model),
          messages: toOpenAICompatibleModelMessages(
            options.request.messages,
            options.request.model,
            options.request.reasoning,
          ),
          settings: agentSettings(options.request),
        };
      },
      reasoningContentBehavior
        ? { captureReasoningContent: reasoningContentBehavior }
        : {},
    );
  },
};

function agentSettings(request: ChatCompletionsRequest) {
  const custom: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(request)) {
    if (!AGENT_CONTROLLED_REQUEST_FIELDS.has(key)) custom[key] = value;
  }
  const reasoningWire = encodeOpenAIChatReasoning(
    request.model,
    request.reasoning,
  );
  if (reasoningWire.thinking) custom.thinking = reasoningWire.thinking;
  if (reasoningWire.enableThinking !== undefined) {
    custom.enable_thinking = reasoningWire.enableThinking;
  }
  const providerOptions = {
    ...(Object.keys(custom).length > 0 ? { [PROVIDER_NAME]: custom } : {}),
    ...(reasoningWire.reasoningEffort
      ? {
          openaiCompatible: {
            reasoningEffort: reasoningWire.reasoningEffort,
          },
        }
      : {}),
  };
  return {
    ...(reasoningWire.suppressSampling || request.temperature === undefined
      ? {}
      : { temperature: request.temperature }),
    ...(reasoningWire.suppressSampling || request.top_p === undefined
      ? {}
      : { topP: request.top_p }),
    ...(request.max_tokens === undefined
      ? {}
      : { maxOutputTokens: request.max_tokens }),
    ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
  };
}
