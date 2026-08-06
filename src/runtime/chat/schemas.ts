import { z } from "zod";

import {
  ASSISTANT_ICONS,
  CHAT_API_TYPES,
  REASONING_EFFORTS,
  type JsonValue,
  type OpenAIChatReasoningContextPart,
} from "@/runtime/chat/types";
import { CHAT_ERROR_CODES } from "@/runtime/transport/chat-errors";
import { MAX_MODEL_LIST_ITEMS } from "@/runtime/transport/response-reader";

const isoDateSchema = z.string().datetime({ offset: true });

export const JSON_VALUE_LIMITS = {
  maximumDepth: 32,
  maximumNodes: 10_000,
} as const;

export const jsonValueSchema: z.ZodType<JsonValue> = z.custom<JsonValue>(
  (value) => isBoundedJsonValue(value),
  "Value must be bounded JSON data",
);

export const OPENAI_RESPONSES_CONTEXT_LIMITS = {
  maxItemsPerMessage: 32,
  maxItemIdLength: 512,
  maxEncryptedContentBytes: 524_288,
  maxTotalEncryptedContentBytes: 1_048_576,
  maxReasoningTokens: 10_000_000,
} as const;

export const GEMINI_THOUGHT_SIGNATURE_CONTEXT_LIMITS = {
  maxItemsPerMessage: 32,
  maxThoughtSignatureBytes: 524_288,
  maxTotalThoughtSignatureBytes: 1_048_576,
} as const;

export const OPENAI_CHAT_REASONING_CONTEXT_LIMITS = {
  maxItemsPerMessage: 5,
  maxTextBytes: 1_048_576,
  maxTotalTextBytes: 4_194_304,
} as const;

export const DEEPSEEK_REASONING_CONTEXT_LIMITS =
  OPENAI_CHAT_REASONING_CONTEXT_LIMITS;

export const ANTHROPIC_THINKING_CONTEXT_LIMITS = {
  maxItemsPerMessage: 32,
  maxFieldBytes: 524_288,
  maxTotalBytes: 2_097_152,
} as const;

export const openAIResponsesContextPartSchema = z
  .object({
    type: z.literal("provider_context"),
    provider: z.literal("openai-responses"),
    contextType: z.literal("reasoning"),
    step: z.number().int().nonnegative().max(4),
    itemId: z
      .string()
      .min(1)
      .max(OPENAI_RESPONSES_CONTEXT_LIMITS.maxItemIdLength),
    encryptedContent: z
      .string()
      .min(1)
      .refine(
        (value) =>
          utf8ByteLength(value) <=
          OPENAI_RESPONSES_CONTEXT_LIMITS.maxEncryptedContentBytes,
        "Encrypted provider context is too large",
      ),
    reasoningTokens: z
      .number()
      .int()
      .nonnegative()
      .max(OPENAI_RESPONSES_CONTEXT_LIMITS.maxReasoningTokens)
      .nullable(),
  })
  .strict();

export const geminiThoughtSignatureContextPartSchema = z
  .object({
    type: z.literal("provider_context"),
    provider: z.literal("gemini"),
    contextType: z.literal("thought_signature"),
    step: z.number().int().nonnegative().max(4),
    toolCallId: z.string().min(1).max(512),
    thoughtSignature: z
      .string()
      .min(1)
      .refine(
        (value) =>
          utf8ByteLength(value) <=
          GEMINI_THOUGHT_SIGNATURE_CONTEXT_LIMITS.maxThoughtSignatureBytes,
        "Gemini thought signature is too large",
      ),
  })
  .strict();

function createOpenAIChatReasoningContextPartSchema<
  const TProvider extends OpenAIChatReasoningContextPart["provider"],
>(provider: TProvider, label: string) {
  return z
    .object({
      type: z.literal("provider_context"),
      provider: z.literal(provider),
      contextType: z.literal("reasoning_content"),
      step: z.number().int().nonnegative().max(4),
      text: z
        .string()
        .min(1)
        .refine(
          (value) =>
            utf8ByteLength(value) <=
            OPENAI_CHAT_REASONING_CONTEXT_LIMITS.maxTextBytes,
          `${label} reasoning content is too large`,
        ),
    })
    .strict();
}

export const deepSeekReasoningContextPartSchema =
  createOpenAIChatReasoningContextPartSchema("deepseek-chat", "DeepSeek");

export const glmReasoningContextPartSchema =
  createOpenAIChatReasoningContextPartSchema("glm-chat", "GLM");

export const qwenReasoningContextPartSchema =
  createOpenAIChatReasoningContextPartSchema("qwen-chat", "Qwen");

export const kimiReasoningContextPartSchema =
  createOpenAIChatReasoningContextPartSchema("kimi-chat", "Kimi");

const anthropicContextBase = {
  type: z.literal("provider_context"),
  provider: z.literal("anthropic"),
  step: z.number().int().nonnegative().max(4),
  blockIndex: z.number().int().nonnegative().max(31),
} as const;

export const anthropicThinkingContextPartSchema = z.discriminatedUnion(
  "contextType",
  [
    z
      .object({
        ...anthropicContextBase,
        contextType: z.literal("thinking"),
        text: boundedAnthropicContextField("Anthropic thinking text", true),
        signature: boundedAnthropicContextField("Anthropic thinking signature"),
      })
      .strict(),
    z
      .object({
        ...anthropicContextBase,
        contextType: z.literal("redacted_thinking"),
        redactedData: boundedAnthropicContextField(
          "Anthropic redacted thinking data",
        ),
      })
      .strict(),
  ],
);

const visibleMessagePartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }).strict(),
  z
    .object({
      type: z.literal("image_ref"),
      attachmentId: z.string().min(1),
      alt: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("reasoning"),
      text: z.string(),
      source: z.enum(["reasoning_content", "think_tag"]),
      durationMs: z.number().int().nonnegative().nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_call"),
      id: z.string().min(1).max(512),
      name: z.string().min(1).max(128),
      step: z.number().int().nonnegative().max(4),
      input: jsonValueSchema,
      output: jsonValueSchema.nullable(),
      status: z.enum(["running", "completed", "error"]),
      errorCode: z.string().min(1).max(128).nullable(),
      errorStatus: z.number().int().min(100).max(599).nullable(),
      retryable: z.boolean(),
    })
    .strict(),
]);

export const providerContextPartSchema = z.union([
  openAIResponsesContextPartSchema,
  geminiThoughtSignatureContextPartSchema,
  deepSeekReasoningContextPartSchema,
  glmReasoningContextPartSchema,
  qwenReasoningContextPartSchema,
  kimiReasoningContextPartSchema,
  anthropicThinkingContextPartSchema,
]);

export const messagePartSchema = z.union([
  visibleMessagePartSchema,
  providerContextPartSchema,
]);

const messagePartsSchema = z
  .array(messagePartSchema)
  .superRefine((parts, ctx) => {
    const openAIContext = parts.filter(
      (part) =>
        part.type === "provider_context" &&
        part.provider === "openai-responses",
    );
    if (
      openAIContext.length > OPENAI_RESPONSES_CONTEXT_LIMITS.maxItemsPerMessage
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        type: "array",
        maximum: OPENAI_RESPONSES_CONTEXT_LIMITS.maxItemsPerMessage,
        inclusive: true,
        message: "Too many provider context items",
      });
    }
    const itemIds = new Set<string>();
    for (const part of openAIContext) {
      if (itemIds.has(part.itemId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Provider context item IDs must be unique per message",
        });
      }
      itemIds.add(part.itemId);
    }
    const totalEncryptedContentBytes = openAIContext.reduce(
      (total, part) => total + utf8ByteLength(part.encryptedContent),
      0,
    );
    if (
      totalEncryptedContentBytes >
      OPENAI_RESPONSES_CONTEXT_LIMITS.maxTotalEncryptedContentBytes
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provider context exceeds the per-message size limit",
      });
    }

    const geminiContext = parts.filter(
      (part) => part.type === "provider_context" && part.provider === "gemini",
    );
    if (
      geminiContext.length >
      GEMINI_THOUGHT_SIGNATURE_CONTEXT_LIMITS.maxItemsPerMessage
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        type: "array",
        maximum: GEMINI_THOUGHT_SIGNATURE_CONTEXT_LIMITS.maxItemsPerMessage,
        inclusive: true,
        message: "Too many Gemini thought signatures",
      });
    }
    const geminiTargets = new Set<string>();
    for (const part of geminiContext) {
      const target = `${part.step}:${part.toolCallId}`;
      if (geminiTargets.has(target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Gemini thought signatures must be unique per tool call and step",
        });
      }
      geminiTargets.add(target);
    }
    const totalThoughtSignatureBytes = geminiContext.reduce(
      (total, part) => total + utf8ByteLength(part.thoughtSignature),
      0,
    );
    if (
      totalThoughtSignatureBytes >
      GEMINI_THOUGHT_SIGNATURE_CONTEXT_LIMITS.maxTotalThoughtSignatureBytes
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Gemini thought signatures exceed the per-message size limit",
      });
    }

    const chatReasoningProviders = [
      ["deepseek-chat", "DeepSeek", true],
      ["glm-chat", "GLM", true],
      ["qwen-chat", "Qwen", false],
      ["kimi-chat", "Kimi", false],
    ] as const;
    for (const [provider, label, requiresToolCall] of chatReasoningProviders) {
      const reasoningContext = parts.filter(
        (part): part is OpenAIChatReasoningContextPart =>
          part.type === "provider_context" && part.provider === provider,
      );
      if (
        reasoningContext.length >
        OPENAI_CHAT_REASONING_CONTEXT_LIMITS.maxItemsPerMessage
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_big,
          type: "array",
          maximum: OPENAI_CHAT_REASONING_CONTEXT_LIMITS.maxItemsPerMessage,
          inclusive: true,
          message: `Too many ${label} reasoning steps`,
        });
      }
      const reasoningSteps = new Set<number>();
      for (const part of reasoningContext) {
        if (reasoningSteps.has(part.step)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${label} reasoning steps must be unique per message`,
          });
        }
        reasoningSteps.add(part.step);
      }
      if (
        requiresToolCall &&
        reasoningContext.length > 0 &&
        !parts.some((part) => part.type === "tool_call")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} reasoning context requires tool-call history`,
        });
      }
      const totalReasoningTextBytes = reasoningContext.reduce(
        (total, part) => total + utf8ByteLength(part.text),
        0,
      );
      if (
        totalReasoningTextBytes >
        OPENAI_CHAT_REASONING_CONTEXT_LIMITS.maxTotalTextBytes
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} reasoning context exceeds the per-message size limit`,
        });
      }
    }

    const anthropicContext = parts.filter(
      (part) =>
        part.type === "provider_context" && part.provider === "anthropic",
    );
    if (
      anthropicContext.length >
      ANTHROPIC_THINKING_CONTEXT_LIMITS.maxItemsPerMessage
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        type: "array",
        maximum: ANTHROPIC_THINKING_CONTEXT_LIMITS.maxItemsPerMessage,
        inclusive: true,
        message: "Too many Anthropic thinking blocks",
      });
    }
    const anthropicTargets = new Set<string>();
    for (const part of anthropicContext) {
      const target = `${part.step}:${part.blockIndex}`;
      if (anthropicTargets.has(target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Anthropic thinking blocks must have unique positions",
        });
      }
      anthropicTargets.add(target);
    }
    const totalAnthropicBytes = anthropicContext.reduce(
      (total, part) =>
        total +
        (part.contextType === "thinking"
          ? utf8ByteLength(part.text) + utf8ByteLength(part.signature)
          : utf8ByteLength(part.redactedData)),
      0,
    );
    if (totalAnthropicBytes > ANTHROPIC_THINKING_CONTEXT_LIMITS.maxTotalBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Anthropic thinking context exceeds the per-message size limit",
      });
    }
  });

export const tokenUsageSchema = z
  .object({
    promptTokens: z.number().int().nonnegative().nullable(),
    completionTokens: z.number().int().nonnegative().nullable(),
    reasoningTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable(),
    estimated: z.boolean(),
  })
  .strict();

export const messageErrorSchema = z
  .object({
    code: z.enum(CHAT_ERROR_CODES),
    status: z.number().int().min(100).max(599).nullable(),
    retryable: z.boolean(),
  })
  .strict();

export const messageNodeSchema = z
  .object({
    id: z.string().min(1),
    conversationId: z.string().min(1),
    parentId: z.string().min(1).nullable(),
    role: z.enum(["user", "assistant"]),
    parts: messagePartsSchema,
    status: z.enum(["pending", "streaming", "completed", "stopped", "error"]),
    modelSnapshot: z
      .object({
        modelId: z.string().min(1),
        connectionScope: z.string().min(1),
      })
      .strict()
      .nullable(),
    usage: tokenUsageSchema.nullable(),
    error: messageErrorSchema.nullable().default(null),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict()
  .superRefine((message, ctx) => {
    if (
      message.role === "user" &&
      message.parts.some((part) => part.type === "provider_context")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parts"],
        message: "Provider context is only valid on Assistant messages",
      });
    }
  });

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isBoundedJsonValue(value: unknown): value is JsonValue {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > JSON_VALUE_LIMITS.maximumNodes) return false;
    const item = current.value;
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "boolean"
    ) {
      continue;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) return false;
      continue;
    }
    if (typeof item !== "object") return false;
    if (current.depth >= JSON_VALUE_LIMITS.maximumDepth) return false;
    if (seen.has(item)) return false;
    seen.add(item);

    if (Array.isArray(item)) {
      for (let index = item.length - 1; index >= 0; index -= 1) {
        stack.push({ value: item[index], depth: current.depth + 1 });
      }
      continue;
    }
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const child of Object.values(item)) {
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }

  return true;
}

function boundedAnthropicContextField(label: string, allowEmpty = false) {
  return z
    .string()
    .min(allowEmpty ? 0 : 1)
    .refine(
      (value) =>
        utf8ByteLength(value) <=
        ANTHROPIC_THINKING_CONTEXT_LIMITS.maxFieldBytes,
      `${label} is too large`,
    );
}

const optionalNumberSettingSchema = z
  .object({ enabled: z.boolean(), value: z.number().finite() })
  .strict();

export const assistantSnapshotSchema = z
  .object({
    name: z.string().min(1).max(80),
    icon: z.enum(ASSISTANT_ICONS),
    systemPrompt: z.string().max(20_000),
  })
  .strict();

export const assistantSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["default", "custom"]),
    name: z.string().min(1).max(80),
    icon: z.enum(ASSISTANT_ICONS),
    systemPrompt: z.string().max(20_000),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict();

export const conversationSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    titleSource: z.enum(["local", "ai", "user"]),
    archived: z.boolean(),
    activeLeafId: z.string().min(1).nullable(),
    activeModelId: z.string().trim().min(1).nullable().default(null),
    contextCutoffId: z.string().min(1).nullable(),
    contextMessageLimit: z.number().int().min(0).max(20).optional(),
    assistantId: z.string().min(1),
    assistantSnapshot: assistantSnapshotSchema,
    autoTitle: z.boolean(),
    webSearchEnabled: z.boolean().default(false),
    advancedSettings: z
      .object({
        temperature: optionalNumberSettingSchema,
        topP: optionalNumberSettingSchema,
        maxTokens: optionalNumberSettingSchema,
        customParameters: z.record(z.string(), jsonValueSchema),
      })
      .strict()
      .optional(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict()
  .transform(
    ({
      contextMessageLimit: _contextMessageLimit,
      advancedSettings: _advancedSettings,
      ...conversation
    }) => {
      void _contextMessageLimit;
      void _advancedSettings;
      return conversation;
    },
  );

export const connectionBundleSchema = z
  .object({
    connection: z
      .object({
        id: z.literal("current"),
        mode: z.enum(["byok", "hosted"]),
        baseUrl: z.string(),
        modelId: z.string(),
        apiType: z.enum(CHAT_API_TYPES),
        updatedAt: isoDateSchema,
      })
      .strict(),
    credential: z
      .object({
        id: z.literal("current"),
        apiKey: z.string(),
        accessCode: z.string(),
        encrypted: z.literal(false),
        updatedAt: isoDateSchema,
      })
      .strict(),
  })
  .strict();

export const modelCapabilityOverrideSchema = z
  .object({
    reasoning: z.boolean().optional(),
    supportedEfforts: z
      .array(z.enum(REASONING_EFFORTS))
      .max(REASONING_EFFORTS.length)
      .optional(),
    vision: z.boolean().optional(),
    tools: z.boolean().optional(),
    contextWindow: z.number().int().min(1024).max(10_000_000).optional(),
    streamUsage: z.enum(["supported", "unsupported", "unknown"]).optional(),
    temperature: z.enum(["supported", "unsupported", "unknown"]).optional(),
    topP: z.enum(["supported", "unsupported", "unknown"]).optional(),
  })
  .strict();

export const modelPreferencesSchema = z
  .object({
    streaming: z.boolean(),
    temperature: z
      .object({
        enabled: z.boolean(),
        value: z.number().finite().min(0).max(2),
      })
      .strict(),
    topP: z
      .object({
        enabled: z.boolean(),
        value: z.number().finite().min(0).max(1),
      })
      .strict(),
  })
  .strict();

const openAIModelSchema = z
  .object({
    id: z.string().trim().min(1),
    object: z.string().optional(),
    owned_by: z.string().optional(),
    supported_endpoint_types: z.array(z.string()).nullable().optional(),
  })
  .passthrough();

export const openAIModelsResponseSchema = z
  .object({
    data: z.array(openAIModelSchema).max(MAX_MODEL_LIST_ITEMS),
    object: z.string().optional(),
  })
  .passthrough();
