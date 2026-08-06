import type {
  JsonValue,
  ProviderContextPart,
  ReasoningChoice,
} from "@/runtime/chat/types";

export type ChatCompletionTextPart = {
  type: "text";
  text: string;
};

export type ChatCompletionImagePart = {
  type: "image_url";
  image_url: { url: string };
};

export type ChatCompletionContentPart =
  ChatCompletionTextPart | ChatCompletionImagePart;

export type ChatCompletionToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatCompletionToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, JsonValue>;
    strict?: boolean;
  };
};

export type ChatCompletionMessage =
  | { role: "system"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: ChatCompletionToolCall[];
      /** CherryChat-internal metadata. Only its owning provider may serialize it. */
      providerContext?: ProviderContextPart[];
    }
  | { role: "user"; content: string | ChatCompletionContentPart[] }
  | {
      role: "tool";
      content: string;
      tool_call_id: string;
      name: string;
    };

export type ChatCompletionsRequest = Record<string, JsonValue> & {
  model: string;
  messages: ChatCompletionMessage[];
  stream: boolean;
  /** Internal normalized choice. Endpoint transports serialize this field. */
  reasoning?: ReasoningChoice;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  tools?: ChatCompletionToolDefinition[];
  tool_choice?: "auto";
};
