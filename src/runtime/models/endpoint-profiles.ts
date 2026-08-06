import type {
  ChatApiType,
  ChatEndpointType,
  ConnectionMode,
  EndpointProfile,
  ModelDescriptor,
} from "@/runtime/chat/types";

const ENDPOINT_PROFILES = {
  openai: {
    apiType: "openai",
    reasoningFormat: "openai-chat",
    reasoning: "supported",
    vision: "supported",
    streaming: "supported",
    temperature: "supported",
    topP: "supported",
    tools: "supported",
  },
  "openai-responses": {
    apiType: "openai-responses",
    reasoningFormat: "openai-responses",
    reasoning: "supported",
    vision: "supported",
    streaming: "supported",
    temperature: "supported",
    topP: "supported",
    tools: "supported",
  },
  anthropic: {
    apiType: "anthropic",
    reasoningFormat: "anthropic",
    reasoning: "supported",
    vision: "supported",
    streaming: "supported",
    temperature: "supported",
    topP: "supported",
    tools: "supported",
  },
  gemini: {
    apiType: "gemini",
    reasoningFormat: "gemini",
    reasoning: "supported",
    vision: "supported",
    streaming: "supported",
    temperature: "supported",
    topP: "supported",
    tools: "supported",
  },
  "new-api": {
    apiType: "new-api",
    reasoningFormat: "openai-chat",
    reasoning: "supported",
    vision: "supported",
    streaming: "supported",
    temperature: "supported",
    topP: "supported",
    tools: "supported",
  },
  "openai-compatible": {
    apiType: "openai-compatible",
    reasoningFormat: "openai-chat",
    reasoning: "supported",
    vision: "supported",
    streaming: "supported",
    temperature: "supported",
    topP: "supported",
    tools: "supported",
  },
} as const satisfies Record<ChatApiType, EndpointProfile>;

export function getEndpointProfile(apiType: ChatApiType): EndpointProfile {
  return ENDPOINT_PROFILES[apiType];
}

export function getConnectionEndpointProfile(connection: {
  mode: ConnectionMode;
  apiType: ChatApiType;
  endpointType?: ChatEndpointType | undefined;
}): EndpointProfile {
  if (connection.mode === "hosted") return getEndpointProfile("openai");
  if (connection.apiType !== "new-api" || !connection.endpointType) {
    return getEndpointProfile(connection.apiType);
  }

  const nativeApiType = {
    "openai-chat": "openai",
    "openai-responses": "openai-responses",
    anthropic: "anthropic",
    gemini: "gemini",
  } as const satisfies Record<ChatEndpointType, ChatApiType>;
  return {
    ...getEndpointProfile(nativeApiType[connection.endpointType]),
    apiType: "new-api",
  };
}

export function resolveModelEndpointType(
  connection: Pick<
    Parameters<typeof getConnectionEndpointProfile>[0],
    "mode" | "apiType"
  >,
  modelId: string,
  descriptors: readonly ModelDescriptor[],
): ChatEndpointType | undefined {
  if (connection.mode === "hosted" || connection.apiType !== "new-api") {
    return undefined;
  }
  return descriptors.find(({ id }) => id === modelId)?.endpointTypes[0];
}
