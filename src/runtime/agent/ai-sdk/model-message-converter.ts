import type { ModelMessage } from "ai";

import type { ChatCompletionMessage } from "@/runtime/chat/chat-completions-contract";
import type {
  OpenAIChatReasoningContextPart,
  OpenAIChatReasoningContextProvider,
  ReasoningChoice,
} from "@/runtime/chat/types";
import { ChatTransportError } from "@/runtime/transport/chat-errors";
import { getOpenAIChatReasoningContextProvider } from "@/runtime/transport/reasoning-wire";
import {
  parseToolArguments,
  parseToolResult,
} from "@/runtime/transport/tool-wire";

export function toAiSdkModelMessages(
  messages: readonly ChatCompletionMessage[],
): ModelMessage[] {
  return messages.map((message) => toAiSdkModelMessage(message, "none"));
}

export function toOpenAICompatibleModelMessages(
  messages: readonly ChatCompletionMessage[],
  modelId: string,
  reasoning?: ReasoningChoice,
): ModelMessage[] {
  return messages.map((message) =>
    toAiSdkModelMessage(
      message,
      getOpenAIChatReasoningContextProvider(modelId, reasoning) ?? "none",
    ),
  );
}

export function toOpenAIResponsesModelMessages(
  messages: readonly ChatCompletionMessage[],
): ModelMessage[] {
  return messages.map((message) =>
    toAiSdkModelMessage(message, "openai-responses"),
  );
}

export function toGoogleModelMessages(
  messages: readonly ChatCompletionMessage[],
): ModelMessage[] {
  return messages.map((message) => toAiSdkModelMessage(message, "gemini"));
}

export function toAnthropicModelMessages(
  messages: readonly ChatCompletionMessage[],
): ModelMessage[] {
  return messages.map((message) => toAiSdkModelMessage(message, "anthropic"));
}

function toAiSdkModelMessage(
  message: ChatCompletionMessage,
  providerContextMode:
    | "none"
    | OpenAIChatReasoningContextProvider
    | "openai-responses"
    | "gemini"
    | "anthropic",
): ModelMessage {
  if (message.role === "system") return { ...message };
  if (message.role === "user") {
    return {
      role: "user",
      content:
        typeof message.content === "string"
          ? message.content
          : message.content.map((part) =>
              part.type === "text"
                ? part
                : {
                    type: "image" as const,
                    ...parseImageContent(part.image_url.url),
                  },
            ),
    };
  }
  if (message.role === "assistant") {
    const content: Extract<ModelMessage, { role: "assistant" }>["content"] = [];
    if (
      providerContextMode === "deepseek-chat" ||
      providerContextMode === "glm-chat" ||
      providerContextMode === "qwen-chat" ||
      providerContextMode === "kimi-chat"
    ) {
      const contexts = (message.providerContext ?? [])
        .filter(
          (context): context is OpenAIChatReasoningContextPart =>
            context.provider === providerContextMode,
        )
        .sort((left, right) => left.step - right.step);
      for (const context of contexts) {
        content.push({ type: "reasoning", text: context.text });
      }
    }
    if (providerContextMode === "openai-responses") {
      for (const context of message.providerContext ?? []) {
        if (context.provider !== "openai-responses") continue;
        content.push({
          type: "reasoning",
          text: "",
          providerOptions: {
            openai: {
              itemId: context.itemId,
              reasoningEncryptedContent: context.encryptedContent,
            },
          },
        });
      }
    }
    if (providerContextMode === "anthropic") {
      const contexts = (message.providerContext ?? [])
        .filter((context) => context.provider === "anthropic")
        .sort((left, right) => left.blockIndex - right.blockIndex);
      for (const context of contexts) {
        content.push({
          type: "reasoning",
          text: context.contextType === "thinking" ? context.text : "",
          providerOptions: {
            anthropic:
              context.contextType === "thinking"
                ? { signature: context.signature }
                : { redactedData: context.redactedData },
          },
        });
      }
    }
    if (message.content) content.push({ type: "text", text: message.content });
    const thoughtSignatures = new Map(
      (message.providerContext ?? [])
        .filter((context) => context.provider === "gemini")
        .map((context) => [context.toolCallId, context.thoughtSignature]),
    );
    for (const call of message.tool_calls ?? []) {
      const thoughtSignature = thoughtSignatures.get(call.id);
      content.push({
        type: "tool-call",
        toolCallId: call.id,
        toolName: call.function.name,
        input: parseToolArguments(call.function.arguments),
        ...(providerContextMode === "gemini" && thoughtSignature
          ? { providerOptions: { google: { thoughtSignature } } }
          : {}),
      });
    }
    return { role: "assistant", content };
  }
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: message.tool_call_id,
        toolName: message.name,
        output: { type: "json", value: parseToolResult(message.content) },
      },
    ],
  };
}

function parseImageContent(
  value: string,
): { image: string; mediaType: string } | { image: URL } {
  const dataUrl = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (dataUrl) {
    return {
      image: dataUrl[2] ?? "",
      mediaType: dataUrl[1] ?? "application/octet-stream",
    };
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new Error();
    return { image: url };
  } catch {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "Image content contains an invalid URL",
      null,
    );
  }
}
