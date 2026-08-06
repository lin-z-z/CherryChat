import { countTokens as countCl100kTokens } from "gpt-tokenizer/encoding/cl100k_base";
import { countTokens as countO200kTokens } from "gpt-tokenizer/encoding/o200k_base";

import type {
  ChatCompletionContentPart,
  ChatCompletionMessage,
} from "@/runtime/chat/chat-completions-contract";

export interface TokenEstimate {
  tokens: number;
  estimated: boolean;
  method: "o200k_base" | "cl100k_base" | "utf8-conservative";
}

export interface TokenEstimator {
  /** Appending messages must not reduce the returned token count. */
  estimate(
    messages: readonly ChatCompletionMessage[],
    modelId: string,
  ): TokenEstimate;
}

const IMAGE_TOKEN_BUDGET = 1024;
const MESSAGE_OVERHEAD = 4;
const REPLY_OVERHEAD = 2;

export class DefaultTokenEstimator implements TokenEstimator {
  estimate(
    messages: readonly ChatCompletionMessage[],
    modelId: string,
  ): TokenEstimate {
    const method = tokenizerForModel(modelId);
    let tokens = REPLY_OVERHEAD;
    let includesImage = false;
    let includesEstimatedProviderContext = false;

    for (const message of messages) {
      tokens += MESSAGE_OVERHEAD;
      if (message.role === "assistant") {
        for (const context of message.providerContext ?? []) {
          if (
            context.provider === "openai-responses" &&
            context.reasoningTokens !== null
          ) {
            tokens += context.reasoningTokens;
          } else if (context.provider === "openai-responses") {
            tokens += new TextEncoder().encode(
              context.encryptedContent,
            ).byteLength;
            includesEstimatedProviderContext = true;
          } else if (context.provider === "gemini") {
            tokens += new TextEncoder().encode(
              context.thoughtSignature,
            ).byteLength;
            includesEstimatedProviderContext = true;
          } else if (context.contextType === "reasoning_content") {
            tokens += countText(context.text, method);
            includesEstimatedProviderContext = true;
          } else {
            tokens += new TextEncoder().encode(
              context.contextType === "thinking"
                ? `${context.text}${context.signature}`
                : context.redactedData,
            ).byteLength;
            includesEstimatedProviderContext = true;
          }
        }
      }
      if (typeof message.content === "string") {
        tokens += countText(message.content, method);
        continue;
      }
      if (message.content === null) continue;
      for (const part of message.content) {
        if (part.type === "image_url") {
          tokens += IMAGE_TOKEN_BUDGET;
          includesImage = true;
        } else {
          tokens += countText(part.text, method);
        }
      }
    }

    return {
      tokens,
      estimated:
        includesImage ||
        includesEstimatedProviderContext ||
        method === "utf8-conservative",
      method,
    };
  }
}

function tokenizerForModel(modelId: string): TokenEstimate["method"] {
  const normalized = modelId.toLocaleLowerCase();
  if (/^(?:gpt-4o|gpt-4\.1|gpt-5|o1|o3|o4)(?:-|$)/u.test(normalized)) {
    return "o200k_base";
  }
  if (/^(?:gpt-3\.5|gpt-4)(?:-|$)/u.test(normalized)) {
    return "cl100k_base";
  }
  return "utf8-conservative";
}

function countText(text: string, method: TokenEstimate["method"]): number {
  switch (method) {
    case "o200k_base":
      return countO200kTokens(text);
    case "cl100k_base":
      return countCl100kTokens(text);
    case "utf8-conservative":
      return new TextEncoder().encode(text).byteLength;
  }
}

export function hasImageParts(
  message: ChatCompletionMessage,
): message is Extract<ChatCompletionMessage, { role: "user" }> & {
  content: ChatCompletionContentPart[];
} {
  return (
    Array.isArray(message.content) &&
    message.content.some((part) => part.type === "image_url")
  );
}
