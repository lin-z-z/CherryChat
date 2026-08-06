import { createOpenAI } from "@ai-sdk/openai";

import type { AgentRuntime } from "@/runtime/agent/agent-runtime";
import { runAiSdkAgent } from "@/runtime/agent/ai-sdk/agent-core";
import { toOpenAIResponsesModelMessages } from "@/runtime/agent/ai-sdk/model-message-converter";
import { createOpenAIResponsesAgentProviderOptions } from "@/runtime/agent/ai-sdk/openai-responses-provider-fetch";
import type { ChatCompletionsRequest } from "@/runtime/chat/chat-completions-contract";
import { reasoningChoiceToEffort } from "@/runtime/transport/reasoning-wire";

export const aiSdkOpenAIResponsesRuntime: AgentRuntime = {
  run(options) {
    return runAiSdkAgent(
      options,
      () => {
        const providerOptions = createOpenAIResponsesAgentProviderOptions(
          options.connection,
          options.timeoutPolicy,
        );
        const provider = createOpenAI(providerOptions);
        return {
          model: provider.responses(options.request.model),
          messages: toOpenAIResponsesModelMessages(options.request.messages),
          settings: agentSettings(options.request, options.supportsReasoning),
        };
      },
      { captureProviderContext: true },
    );
  },
};

function agentSettings(
  request: ChatCompletionsRequest,
  supportsReasoning: boolean,
) {
  const reasoningEffort = reasoningChoiceToEffort(request.reasoning);
  const reasoningEnabled = supportsReasoning && reasoningEffort !== "none";
  return {
    ...(request.temperature === undefined
      ? {}
      : { temperature: request.temperature }),
    ...(request.top_p === undefined ? {} : { topP: request.top_p }),
    ...(request.max_tokens === undefined
      ? {}
      : { maxOutputTokens: request.max_tokens }),
    providerOptions: {
      openai: {
        store: false,
        include: ["reasoning.encrypted_content"],
        ...(supportsReasoning ? { forceReasoning: true } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(reasoningEnabled ? { reasoningSummary: "auto" } : {}),
      },
    },
  };
}
