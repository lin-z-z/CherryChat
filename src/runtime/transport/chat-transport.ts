import type { ChatCompletionsRequest } from "@/runtime/chat/chat-completions-contract";

export type NonStreamingChatCompletionsRequest = ChatCompletionsRequest & {
  stream: false;
};

export interface ChatTransport {
  listModels(signal?: AbortSignal): Promise<unknown>;
  createChatCompletion(
    request: NonStreamingChatCompletionsRequest,
    signal?: AbortSignal,
  ): Promise<Response>;
}
