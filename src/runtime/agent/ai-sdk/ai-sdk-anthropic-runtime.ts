import {
  createAnthropic,
  type AnthropicProviderOptions,
} from "@ai-sdk/anthropic";

import type { AgentRuntime } from "@/runtime/agent/agent-runtime";
import { runAiSdkAgent } from "@/runtime/agent/ai-sdk/agent-core";
import { createAnthropicAgentProviderOptions } from "@/runtime/agent/ai-sdk/anthropic-provider-fetch";
import { toAnthropicModelMessages } from "@/runtime/agent/ai-sdk/model-message-converter";
import { resolveAnthropicRequestSettings } from "@/runtime/transport/anthropic-reasoning";

export const aiSdkAnthropicRuntime: AgentRuntime = {
  run(options) {
    return runAiSdkAgent(
      options,
      () => {
        const settings = resolveAnthropicRequestSettings(options.request);
        const provider = createAnthropic(
          createAnthropicAgentProviderOptions(
            options.connection,
            options.request.model,
            options.timeoutPolicy,
            settings.thinking?.type === "disabled",
          ),
        );
        return {
          model: provider(options.request.model),
          messages: toAnthropicModelMessages(options.request.messages),
          settings: agentSettings(settings),
        };
      },
      { captureAnthropicContext: true },
    );
  },
};

function agentSettings(
  settings: ReturnType<typeof resolveAnthropicRequestSettings>,
) {
  const anthropicOptions = {
    ...(settings.thinking ? { thinking: settings.thinking } : {}),
    ...(settings.effort ? { effort: settings.effort } : {}),
  } satisfies AnthropicProviderOptions;
  return {
    ...(settings.temperature === undefined
      ? {}
      : { temperature: settings.temperature }),
    ...(settings.topP === undefined ? {} : { topP: settings.topP }),
    maxOutputTokens: settings.aiSdkMaxOutputTokens,
    ...(Object.keys(anthropicOptions).length > 0
      ? { providerOptions: { anthropic: anthropicOptions } }
      : {}),
  };
}
