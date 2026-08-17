import type { ChatErrorCode } from "@/runtime/transport/chat-errors";

export type MessageRole = "user" | "assistant";
export type MessageStatus =
  "pending" | "streaming" | "completed" | "stopped" | "error";
export type ReasoningSource = "reasoning_content" | "think_tag";
export type ConnectionMode = "byok" | "hosted";
export const CHAT_API_TYPES = [
  "openai",
  "openai-responses",
  "anthropic",
  "gemini",
  "new-api",
  "openai-compatible",
] as const;
export type ChatApiType = (typeof CHAT_API_TYPES)[number];

export const CHAT_ENDPOINT_TYPES = [
  "openai-chat",
  "openai-responses",
  "anthropic",
  "gemini",
] as const;
export type ChatEndpointType = (typeof CHAT_ENDPOINT_TYPES)[number];

export type CapabilitySource = "builtin" | "catalog" | "inferred" | "user";
export type SupportState = "supported" | "unsupported" | "unknown";
export type TitleSource = "local" | "ai" | "user";
export type AssistantKind = "default" | "custom";

export const WEB_SEARCH_PROVIDER_IDS = ["tavily", "exa", "grok"] as const;
export type WebSearchProviderId = (typeof WEB_SEARCH_PROVIDER_IDS)[number];

export const ASSISTANT_ICONS = [
  "sparkles",
  "bot",
  "code",
  "pen",
  "book",
  "lightbulb",
] as const;
export type AssistantIcon = (typeof ASSISTANT_ICONS)[number];

export const DEFAULT_ASSISTANT_ID = "default-assistant";
export const DEFAULT_ASSISTANT_NAME = "Default Assistant";
export const DEFAULT_ASSISTANT_ICON: AssistantIcon = "sparkles";

export const REASONING_EFFORTS = [
  "none",
  "auto",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const REASONING_EFFORT_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReasoningEffortLevel = (typeof REASONING_EFFORT_LEVELS)[number];

export type ReasoningChoice =
  | { mode: "default" }
  | { mode: "on" }
  | { mode: "auto" }
  | { mode: "off" }
  | { mode: "effort"; effort: ReasoningEffortLevel };

export type ModelReasoningControl =
  | { kind: "none" }
  | { kind: "fixed" }
  | { kind: "switch"; options: readonly ("on" | "auto" | "off")[] }
  | { kind: "effort"; options: readonly ReasoningChoice[] };

export type ReasoningWireFormat =
  "openai-chat" | "openai-responses" | "anthropic" | "gemini";

export type EffectiveReasoningWireFormat =
  | Exclude<ReasoningWireFormat, "gemini">
  | "gemini-budget"
  | "gemini-level"
  | "none";

export interface ModelFamilyProfile {
  id: string;
  matches: (normalizedModelName: string) => boolean;
  reasoning: ModelReasoningControl;
  reasoningOverride?: "always" | "when-empty";
  /** Stage-one endpoints cannot encode this provider-native control. */
  nativeReasoningOnly?: boolean;
  anthropicReasoningFormat?: "adaptive" | "budget";
  geminiReasoningFormat?: "budget" | "level";
  vision?: SupportState;
  contextWindow?: number;
  temperature?: SupportState;
  topP?: SupportState;
}

export interface EndpointProfile {
  apiType: ChatApiType;
  reasoningFormat: ReasoningWireFormat;
  reasoning: SupportState;
  vision: SupportState;
  streaming: SupportState;
  temperature: SupportState;
  topP: SupportState;
  tools: SupportState;
}

export interface ModelDescriptor {
  id: string;
  ownedBy: string | null;
  endpointTypes: ChatEndpointType[];
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImageRefPart {
  type: "image_ref";
  attachmentId: string;
  alt: string | null;
}

export const IMAGE_GENERATION_SIZES = [
  "auto",
  "1024x1024",
  "1536x1024",
  "1024x1536",
] as const;
export type ImageGenerationSize = string;

export const IMAGE_GENERATION_RESOLUTION_TIERS = [
  "auto",
  "1K",
  "2K",
  "4K",
] as const;
export type ImageGenerationResolutionTier =
  (typeof IMAGE_GENERATION_RESOLUTION_TIERS)[number];

export const IMAGE_GENERATION_ASPECT_RATIOS = [
  "1:1",
  "3:2",
  "2:3",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "21:9",
] as const;
export type ImageGenerationAspectRatio =
  (typeof IMAGE_GENERATION_ASPECT_RATIOS)[number];

export const IMAGE_GENERATION_QUALITIES = [
  "auto",
  "low",
  "medium",
  "high",
] as const;
export type ImageGenerationQuality =
  (typeof IMAGE_GENERATION_QUALITIES)[number];

export const IMAGE_GENERATION_OUTPUT_FORMATS = ["png", "jpeg", "webp"] as const;
export type ImageGenerationOutputFormat =
  (typeof IMAGE_GENERATION_OUTPUT_FORMATS)[number];

export const IMAGE_GENERATION_SIZE_MODES = ["auto", "fixed", "custom"] as const;
export type ImageGenerationSizeMode =
  (typeof IMAGE_GENERATION_SIZE_MODES)[number];

export interface ImageGenerationParameters {
  resolutionTier: ImageGenerationResolutionTier;
  aspectRatio: ImageGenerationAspectRatio;
  size: ImageGenerationSize;
  quality: ImageGenerationQuality;
  outputFormat: ImageGenerationOutputFormat;
  outputCompression: number | null;
}

export interface ImageGenerationProfile {
  id: string;
  name: string;
  mode: "byok" | "hosted";
  baseUrl: string;
  apiKey: string;
  modelId: string;
  sizeMode: ImageGenerationSizeMode;
  hasApiKey: boolean;
}

export interface ImageGenerationPart {
  type: "image_generation";
  modelId: string;
  connectionScope: string;
  size: ImageGenerationSize;
  quality: ImageGenerationQuality;
  profileId?: string | undefined;
  profileName?: string | undefined;
  resolutionTier?: ImageGenerationResolutionTier | undefined;
  aspectRatio?: ImageGenerationAspectRatio | undefined;
  outputFormat?: ImageGenerationOutputFormat | undefined;
  outputCompression?: number | null | undefined;
  referenceAttachmentIds: string[];
}

export interface ReasoningPart {
  type: "reasoning";
  text: string;
  source: ReasoningSource;
  durationMs: number | null;
}

export type ToolCallStatus = "running" | "completed" | "error";

export interface ToolCallPart {
  type: "tool_call";
  id: string;
  name: string;
  step: number;
  input: JsonValue;
  output: JsonValue | null;
  status: ToolCallStatus;
  errorCode: string | null;
  errorStatus: number | null;
  retryable: boolean;
}

export type OpenAIResponsesContextPart = {
  type: "provider_context";
  provider: "openai-responses";
  contextType: "reasoning";
  step: number;
  itemId: string;
  encryptedContent: string;
  reasoningTokens: number | null;
};

export type GeminiThoughtSignatureContextPart = {
  type: "provider_context";
  provider: "gemini";
  contextType: "thought_signature";
  step: number;
  toolCallId: string;
  thoughtSignature: string;
};

export type DeepSeekReasoningContextPart = {
  type: "provider_context";
  provider: "deepseek-chat";
  contextType: "reasoning_content";
  step: number;
  text: string;
};

export type GlmReasoningContextPart = {
  type: "provider_context";
  provider: "glm-chat";
  contextType: "reasoning_content";
  step: number;
  text: string;
};

export type QwenReasoningContextPart = {
  type: "provider_context";
  provider: "qwen-chat";
  contextType: "reasoning_content";
  step: number;
  text: string;
};

export type KimiReasoningContextPart = {
  type: "provider_context";
  provider: "kimi-chat";
  contextType: "reasoning_content";
  step: number;
  text: string;
};

export type OpenAIChatReasoningContextPart =
  | DeepSeekReasoningContextPart
  | GlmReasoningContextPart
  | QwenReasoningContextPart
  | KimiReasoningContextPart;

export type OpenAIChatReasoningContextProvider =
  OpenAIChatReasoningContextPart["provider"];

export interface OpenAIChatReasoningContextBehavior {
  provider: OpenAIChatReasoningContextProvider;
  capture: "tool-call" | "always";
}

export type AnthropicThinkingContextPart =
  | {
      type: "provider_context";
      provider: "anthropic";
      contextType: "thinking";
      step: number;
      blockIndex: number;
      text: string;
      signature: string;
    }
  | {
      type: "provider_context";
      provider: "anthropic";
      contextType: "redacted_thinking";
      step: number;
      blockIndex: number;
      redactedData: string;
    };

export type ProviderContextPart =
  | OpenAIResponsesContextPart
  | GeminiThoughtSignatureContextPart
  | OpenAIChatReasoningContextPart
  | AnthropicThinkingContextPart;

export type MessagePart =
  | TextPart
  | ImageRefPart
  | ImageGenerationPart
  | ReasoningPart
  | ToolCallPart
  | ProviderContextPart;

export interface ImageGenerationConfiguration {
  profiles: ImageGenerationProfile[];
  defaultProfileId: string;
  activeProfileId: string;
  activeHostedProfileId: string | null;
  parametersByProfile: Record<string, ImageGenerationParameters>;
}

export interface ImageGenerationSaveInput {
  profiles: ImageGenerationProfile[];
  defaultProfileId: string;
}

export interface TokenUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  estimated: boolean;
}

export interface ModelSnapshot {
  modelId: string;
  connectionScope: string;
}

export interface MessageError {
  code: ChatErrorCode;
  status: number | null;
  retryable: boolean;
}

export interface MessageNode {
  id: string;
  conversationId: string;
  parentId: string | null;
  role: MessageRole;
  parts: MessagePart[];
  status: MessageStatus;
  modelSnapshot: ModelSnapshot | null;
  usage: TokenUsage | null;
  error: MessageError | null;
  createdAt: string;
  updatedAt: string;
}

export interface OptionalNumberSetting {
  enabled: boolean;
  value: number;
}

export interface ModelPreferences {
  streaming: boolean;
  temperature: OptionalNumberSetting;
  topP: OptionalNumberSetting;
}

export interface AssistantRecord {
  id: string;
  kind: AssistantKind;
  name: string;
  icon: AssistantIcon;
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantSnapshot {
  name: string;
  icon: AssistantIcon;
  systemPrompt: string;
}

export interface ConversationRecord {
  id: string;
  title: string;
  titleSource: TitleSource;
  archived: boolean;
  activeLeafId: string | null;
  activeModelId: string | null;
  contextCutoffId: string | null;
  assistantId: string;
  assistantSnapshot: AssistantSnapshot;
  autoTitle: boolean;
  webSearchEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebSearchSettings {
  enabled: boolean;
  maxResults: number;
  provider: WebSearchProviderId;
  hostedProvider: WebSearchProviderId | null;
}

export interface StandardWebSearchProviderConfiguration {
  apiKey: string;
  baseUrl: string;
  hasApiKey: boolean;
}

export interface GrokWebSearchProviderConfiguration {
  apiKey: string;
  responsesUrl: string;
  model: string;
  xSearch: boolean;
  hasApiKey: boolean;
}

export interface WebSearchProviderConfigurations {
  tavily: StandardWebSearchProviderConfiguration;
  exa: StandardWebSearchProviderConfiguration;
  grok: GrokWebSearchProviderConfiguration;
}

export interface WebSearchConfiguration extends WebSearchSettings {
  providers: WebSearchProviderConfigurations;
  hasApiKey: boolean;
}

export interface WebSearchSaveInput extends WebSearchSettings {
  providers: {
    tavily: Omit<StandardWebSearchProviderConfiguration, "hasApiKey">;
    exa: Omit<StandardWebSearchProviderConfiguration, "hasApiKey">;
    grok: Omit<GrokWebSearchProviderConfiguration, "hasApiKey">;
  };
}

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
}

export interface WebSearchToolOutput {
  query: string;
  answer?: string;
  results: WebSearchResult[];
}

interface WebSearchCredentialRecordBase {
  id: WebSearchProviderId;
  apiKey: string;
  encrypted: false;
  updatedAt: string;
}

export type WebSearchCredentialRecord =
  | (WebSearchCredentialRecordBase & {
      id: "tavily" | "exa";
      baseUrl: string;
    })
  | (WebSearchCredentialRecordBase & {
      id: "grok";
      responsesUrl: string;
      model: string;
      xSearch: boolean;
    });

export interface BranchSelectionRecord {
  conversationId: string;
  parentKey: string;
  selectedChildId: string;
}

export interface ConnectionRecord {
  id: "current";
  mode: ConnectionMode;
  baseUrl: string;
  modelId: string;
  apiType: ChatApiType;
  updatedAt: string;
}

export interface CredentialRecord {
  id: "current";
  apiKey: string;
  accessCode: string;
  encrypted: false;
  updatedAt: string;
}

export interface ConnectionBundle {
  connection: ConnectionRecord;
  credential: CredentialRecord;
}

export interface AttachmentRecord {
  id: string;
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
  createdAt: string;
}

export interface MessageAttachmentRecord {
  messageId: string;
  attachmentId: string;
  conversationId: string;
}

export interface ResolvedModelCapability {
  modelId: string;
  reasoning: boolean;
  supportedEfforts: string[];
  vision: boolean;
  tools: boolean;
  contextWindow: number;
  temperature: SupportState;
  topP: SupportState;
  source: CapabilitySource;
}

export interface EffectiveModelCapability extends ResolvedModelCapability {
  endpoint: EndpointProfile;
  reasoningControl: ModelReasoningControl;
  reasoningWireFormat: EffectiveReasoningWireFormat;
  streaming: SupportState;
}

export type ModelCapabilityOverride = Partial<
  Pick<
    ResolvedModelCapability,
    | "reasoning"
    | "supportedEfforts"
    | "vision"
    | "tools"
    | "contextWindow"
    | "temperature"
    | "topP"
  >
>;

export interface ModelOverrideRecord {
  connectionScope: string;
  modelId: string;
  override: ModelCapabilityOverride;
  capabilityVersion?: 1 | 2;
  preferences?: ModelPreferences;
  updatedAt: string;
}

export function createDefaultModelPreferences(): ModelPreferences {
  return {
    streaming: true,
    temperature: { enabled: false, value: 1 },
    topP: { enabled: false, value: 1 },
  };
}

export function createDefaultAssistantSnapshot(): AssistantSnapshot {
  return {
    name: DEFAULT_ASSISTANT_NAME,
    icon: DEFAULT_ASSISTANT_ICON,
    systemPrompt: "",
  };
}

export function createAssistantSnapshot(
  assistant: Pick<AssistantRecord, "name" | "icon" | "systemPrompt">,
): AssistantSnapshot {
  return {
    name: assistant.name,
    icon: assistant.icon,
    systemPrompt: assistant.systemPrompt,
  };
}
