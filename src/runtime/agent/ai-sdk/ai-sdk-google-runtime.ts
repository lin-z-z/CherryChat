import { createGoogleGenerativeAI } from "@ai-sdk/google";

import type { AgentRuntime } from "@/runtime/agent/agent-runtime";
import { runAiSdkAgent } from "@/runtime/agent/ai-sdk/agent-core";
import { createGoogleAgentProviderOptions } from "@/runtime/agent/ai-sdk/google-provider-fetch";
import { toGoogleModelMessages } from "@/runtime/agent/ai-sdk/model-message-converter";
import type { ChatCompletionsRequest } from "@/runtime/chat/chat-completions-contract";
import { resolveGeminiThinkingConfig } from "@/runtime/transport/gemini-reasoning";

export const aiSdkGoogleRuntime: AgentRuntime = {
  run(options) {
    return runAiSdkAgent(
      options,
      () => {
        const provider = createGoogleGenerativeAI(
          createGoogleAgentProviderOptions(
            options.connection,
            options.request.model,
            options.timeoutPolicy,
          ),
        );
        return {
          model: provider(options.request.model),
          messages: toGoogleModelMessages(options.request.messages),
          settings: agentSettings(options.request),
        };
      },
      { captureToolProviderContext: true },
    );
  },
};

function agentSettings(request: ChatCompletionsRequest) {
  const thinkingConfig = resolveGeminiThinkingConfig(
    request.model,
    request.reasoning,
  );
  return {
    ...(request.temperature === undefined
      ? {}
      : { temperature: request.temperature }),
    ...(request.top_p === undefined ? {} : { topP: request.top_p }),
    ...(request.max_tokens === undefined
      ? {}
      : { maxOutputTokens: request.max_tokens }),
    ...(thinkingConfig
      ? { providerOptions: { google: { thinkingConfig } } }
      : {}),
  };
}
