import { z } from "zod";

import { MAX_IMAGES_PER_MESSAGE } from "@/runtime/attachments/image-processor";
import { REASONING_EFFORTS } from "@/runtime/chat/types";
import {
  getDeepSeekV4Variant,
  getGlmReasoningVariant,
  getQwenChatReasoningVariant,
  isKimiK3Model,
} from "@/runtime/models/model-family-profiles";

export const HOSTED_MAX_MESSAGES = 128;
export const HOSTED_MAX_TEXT_CHARACTERS = 1024 * 1024;
export const HOSTED_MAX_CONTENT_PARTS = 8;
export const HOSTED_MAX_IMAGE_DATA_URL_CHARACTERS = 512 * 1024;
export const HOSTED_MAX_TOOLS = 16;
export const HOSTED_MAX_TOOL_CALLS_PER_MESSAGE = 16;
export const HOSTED_MAX_TOOL_JSON_BYTES = 128 * 1024;
export const HOSTED_MAX_TOOL_JSON_DEPTH = 16;
export const HOSTED_MAX_TOOL_JSON_NODES = 2048;
export const HOSTED_MAX_OUTPUT_TOKENS = 65_536;

const boundedTextSchema = z.string().max(HOSTED_MAX_TEXT_CHARACTERS);
const reasoningContentSchema = z
  .string()
  .min(1)
  .max(HOSTED_MAX_TEXT_CHARACTERS);
const identifierSchema = z.string().trim().min(1).max(256);
const toolNameSchema = z.string().trim().min(1).max(128);
const toolJsonStringSchema = boundedUtf8String(HOSTED_MAX_TOOL_JSON_BYTES);
const imageDataUrlSchema = z
  .string()
  .max(HOSTED_MAX_IMAGE_DATA_URL_CHARACTERS)
  .regex(
    /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/u,
    "Image content must be a supported Base64 data URL",
  );

const textPartSchema = z
  .object({
    type: z.literal("text"),
    text: boundedTextSchema,
  })
  .strict();

const imagePartSchema = z
  .object({
    type: z.literal("image_url"),
    image_url: z.object({ url: imageDataUrlSchema }).strict(),
  })
  .strict();

const systemMessageSchema = z
  .object({
    role: z.literal("system"),
    content: boundedTextSchema,
  })
  .strict();

const assistantToolCallSchema = z
  .object({
    id: identifierSchema,
    type: z.literal("function"),
    function: z
      .object({
        name: toolNameSchema,
        arguments: toolJsonStringSchema,
      })
      .strict(),
  })
  .strict();

const assistantMessageSchema = z
  .object({
    role: z.literal("assistant"),
    content: boundedTextSchema.nullable(),
    reasoning_content: reasoningContentSchema.optional(),
    tool_calls: z
      .array(assistantToolCallSchema)
      .max(HOSTED_MAX_TOOL_CALLS_PER_MESSAGE)
      .optional(),
  })
  .strict();

const userMessageSchema = z
  .object({
    role: z.literal("user"),
    content: z.union([
      boundedTextSchema,
      z
        .array(z.discriminatedUnion("type", [textPartSchema, imagePartSchema]))
        .min(1)
        .max(HOSTED_MAX_CONTENT_PARTS)
        .superRefine((parts, context) => {
          const imageCount = parts.filter(
            (part) => part.type === "image_url",
          ).length;
          if (imageCount > MAX_IMAGES_PER_MESSAGE) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: `A message can contain at most ${MAX_IMAGES_PER_MESSAGE} images`,
            });
          }
        }),
    ]),
  })
  .strict();

const toolMessageSchema = z
  .object({
    role: z.literal("tool"),
    content: boundedTextSchema,
    tool_call_id: identifierSchema,
  })
  .strict();

const boundedToolParametersSchema = z
  .record(z.string(), z.unknown())
  .superRefine((value, context) => {
    if (!isBoundedJsonObject(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tool parameters exceed the Hosted JSON limits",
      });
    }
  });

const toolDefinitionSchema = z
  .object({
    type: z.literal("function"),
    function: z
      .object({
        name: toolNameSchema,
        description: boundedUtf8String(16 * 1024),
        parameters: boundedToolParametersSchema,
        strict: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

export const hostedChatRequestSchema = z
  .object({
    model: z.string().trim().min(1).max(256),
    messages: z
      .array(
        z.discriminatedUnion("role", [
          systemMessageSchema,
          assistantMessageSchema,
          userMessageSchema,
          toolMessageSchema,
        ]),
      )
      .min(1)
      .max(HOSTED_MAX_MESSAGES),
    stream: z.boolean().optional().default(false),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    max_tokens: z
      .number()
      .int()
      .min(1)
      .max(HOSTED_MAX_OUTPUT_TOKENS)
      .optional(),
    tools: z.array(toolDefinitionSchema).max(HOSTED_MAX_TOOLS).optional(),
    tool_choice: z.literal("auto").optional(),
    thinking: z
      .object({
        type: z.enum(["enabled", "disabled"]),
        clear_thinking: z.literal(false).optional(),
      })
      .strict()
      .optional(),
    enable_thinking: z.boolean().optional(),
    reasoning_effort: z.enum(REASONING_EFFORTS).optional(),
  })
  .strict()
  .superRefine((request, context) => {
    const deepSeekVariant = getDeepSeekV4Variant(request.model);
    const glmVariant = getGlmReasoningVariant(request.model);
    const qwenVariant = getQwenChatReasoningVariant(request.model);
    const kimiK3 = isKimiK3Model(request.model);
    const assistantMessages = request.messages.filter(
      (message) => message.role === "assistant",
    );
    const hasReasoningContent = assistantMessages.some(
      (message) => message.reasoning_content !== undefined,
    );

    if (request.enable_thinking !== undefined && !qwenVariant) {
      addHostedIssue(
        context,
        ["enable_thinking"],
        "enable_thinking is only supported for reviewed Qwen Chat models",
      );
    }
    if (request.thinking && !deepSeekVariant && !glmVariant) {
      addHostedIssue(
        context,
        ["thinking"],
        "thinking is only supported for reviewed Chat models",
      );
    }

    if (qwenVariant) {
      if (
        hasReasoningContent &&
        (qwenVariant === "hybrid-default-on" ||
          qwenVariant === "hybrid-default-off" ||
          request.enable_thinking === false)
      ) {
        addHostedIssue(
          context,
          ["messages"],
          "Qwen reasoning_content requires retained Qwen3.8 thinking",
        );
      }

      if (
        qwenVariant === "hybrid-default-on" ||
        qwenVariant === "hybrid-default-off"
      ) {
        if (request.reasoning_effort !== undefined) {
          addHostedIssue(
            context,
            ["reasoning_effort"],
            "Mixed Qwen switch models cannot include reasoning_effort",
          );
        }
        return;
      }

      if (
        request.enable_thinking !== undefined &&
        !(qwenVariant === "qwen3.8-max" && request.enable_thinking === false)
      ) {
        addHostedIssue(
          context,
          ["enable_thinking"],
          "Qwen3.8 only accepts the reviewed Off shape",
        );
      }
      if (
        request.enable_thinking === false &&
        request.reasoning_effort !== undefined
      ) {
        addHostedIssue(
          context,
          ["reasoning_effort"],
          "Disabled Qwen3.8 thinking cannot include reasoning_effort",
        );
        return;
      }
      if (
        request.reasoning_effort !== undefined &&
        request.reasoning_effort !== "low" &&
        request.reasoning_effort !== "medium" &&
        request.reasoning_effort !== "xhigh"
      ) {
        addHostedIssue(
          context,
          ["reasoning_effort"],
          "Unsupported Qwen3.8 reasoning effort",
        );
      }
      return;
    }

    if (kimiK3) {
      if (request.temperature !== undefined || request.top_p !== undefined) {
        addHostedIssue(
          context,
          [request.temperature !== undefined ? "temperature" : "top_p"],
          "Kimi K3 does not accept sampling controls",
        );
      }
      if (
        request.reasoning_effort !== undefined &&
        request.reasoning_effort !== "low" &&
        request.reasoning_effort !== "high" &&
        request.reasoning_effort !== "max"
      ) {
        addHostedIssue(
          context,
          ["reasoning_effort"],
          "Unsupported Kimi K3 reasoning effort",
        );
      }
      return;
    }

    if (!deepSeekVariant && !glmVariant) {
      if (request.thinking) {
        addHostedIssue(
          context,
          ["thinking"],
          "thinking is only supported for reviewed Chat models",
        );
      }
      if (hasReasoningContent) {
        addHostedIssue(
          context,
          ["messages"],
          "reasoning_content is only supported for reviewed Chat models",
        );
      }
      return;
    }

    if (
      hasReasoningContent &&
      !assistantMessages.some(
        (message) => (message.tool_calls?.length ?? 0) > 0,
      )
    ) {
      addHostedIssue(
        context,
        ["messages"],
        "reasoning_content requires Assistant tool-call history",
      );
    }

    if (glmVariant) {
      const retainsReasoning =
        request.thinking?.type === "enabled" &&
        request.thinking.clear_thinking === false;
      if (hasReasoningContent && !retainsReasoning) {
        addHostedIssue(
          context,
          ["messages"],
          "GLM reasoning_content requires retained thinking",
        );
      }

      if (request.thinking?.type === "disabled") {
        if (request.thinking.clear_thinking !== undefined) {
          addHostedIssue(
            context,
            ["thinking", "clear_thinking"],
            "Disabled GLM thinking cannot include clear_thinking",
          );
        }
        if (request.reasoning_effort !== undefined) {
          addHostedIssue(
            context,
            ["reasoning_effort"],
            "Disabled GLM thinking cannot include reasoning_effort",
          );
        }
        return;
      }

      if (!request.thinking) {
        if (request.reasoning_effort !== undefined) {
          addHostedIssue(
            context,
            ["reasoning_effort"],
            "GLM reasoning_effort requires enabled thinking",
          );
        }
        return;
      }

      if (request.thinking.clear_thinking !== false) {
        addHostedIssue(
          context,
          ["thinking", "clear_thinking"],
          "Enabled GLM thinking requires clear_thinking=false",
        );
      }

      if (glmVariant === "switch") {
        if (request.reasoning_effort !== undefined) {
          addHostedIssue(
            context,
            ["reasoning_effort"],
            "Switch-style GLM thinking cannot include reasoning_effort",
          );
        }
        return;
      }

      if (
        request.reasoning_effort !== "high" &&
        request.reasoning_effort !== "max"
      ) {
        addHostedIssue(
          context,
          ["reasoning_effort"],
          "GLM-5.2 enabled thinking requires High or Max",
        );
      }
      return;
    }

    if (request.thinking?.clear_thinking !== undefined) {
      addHostedIssue(
        context,
        ["thinking", "clear_thinking"],
        "DeepSeek thinking cannot include clear_thinking",
      );
    }

    if (
      request.thinking?.type === "enabled" &&
      request.reasoning_effort === undefined
    ) {
      addHostedIssue(
        context,
        ["reasoning_effort"],
        "Enabled DeepSeek thinking requires reasoning_effort",
      );
    }

    if (
      request.thinking?.type !== "disabled" &&
      (request.temperature !== undefined || request.top_p !== undefined)
    ) {
      addHostedIssue(
        context,
        [request.temperature !== undefined ? "temperature" : "top_p"],
        "DeepSeek sampling controls require disabled thinking",
      );
    }

    if (
      request.thinking?.type === "disabled" &&
      request.reasoning_effort !== undefined
    ) {
      addHostedIssue(
        context,
        ["reasoning_effort"],
        "Disabled DeepSeek thinking cannot include reasoning_effort",
      );
      return;
    }
    if (
      request.reasoning_effort !== undefined &&
      request.thinking?.type !== "enabled"
    ) {
      addHostedIssue(
        context,
        ["reasoning_effort"],
        "DeepSeek reasoning_effort requires enabled thinking",
      );
      return;
    }
    if (request.reasoning_effort === undefined) return;

    const supportedEfforts =
      deepSeekVariant === "flash"
        ? (["low", "high", "max"] as const)
        : (["high", "max"] as const);
    if (
      !(supportedEfforts as readonly string[]).includes(
        request.reasoning_effort,
      )
    ) {
      addHostedIssue(
        context,
        ["reasoning_effort"],
        `Unsupported DeepSeek V4 ${deepSeekVariant} reasoning effort`,
      );
    }
  });

export type HostedChatRequest = z.infer<typeof hostedChatRequestSchema>;

function boundedUtf8String(maximumBytes: number) {
  return z
    .string()
    .refine(
      (value) => new TextEncoder().encode(value).byteLength <= maximumBytes,
      `Value must contain at most ${maximumBytes} UTF-8 bytes`,
    );
}

function addHostedIssue(
  context: z.RefinementCtx,
  path: Array<string | number>,
  message: string,
): void {
  context.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function isBoundedJsonObject(value: Record<string, unknown>): boolean {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return false;
  }
  if (
    new TextEncoder().encode(serialized).byteLength > HOSTED_MAX_TOOL_JSON_BYTES
  ) {
    return false;
  }

  const pending: Array<{ value: unknown; depth: number }> = [
    { value, depth: 1 },
  ];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    nodes += 1;
    if (
      nodes > HOSTED_MAX_TOOL_JSON_NODES ||
      current.depth > HOSTED_MAX_TOOL_JSON_DEPTH
    ) {
      return false;
    }

    if (current.value === null) continue;
    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        pending.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }
    if (typeof current.value === "object") {
      const prototype = Object.getPrototypeOf(current.value);
      if (prototype !== Object.prototype && prototype !== null) return false;
      for (const item of Object.values(
        current.value as Record<string, unknown>,
      )) {
        pending.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }
    if (
      typeof current.value === "string" ||
      typeof current.value === "boolean"
    ) {
      continue;
    }
    if (typeof current.value === "number" && Number.isFinite(current.value)) {
      continue;
    }
    return false;
  }
  return true;
}
