import type {
  ChatCompletionContentPart,
  ChatCompletionMessage,
  ChatCompletionsRequest,
} from "@/runtime/chat/chat-completions-contract";
import {
  selectRequestContext,
  type ContextCandidate,
  type SelectedContext,
} from "@/runtime/chat/context-selection";
import type {
  AttachmentRecord,
  EffectiveModelCapability,
  MessageNode,
  ModelPreferences,
  ProviderContextPart,
  ReasoningChoice,
  ResolvedModelCapability,
} from "@/runtime/chat/types";
import { serializeToolResultForModel } from "@/runtime/transport/tool-wire";
import { isReasoningChoiceSupported } from "@/runtime/models/effective-model-capabilities";
import { reasoningControlFromCapability } from "@/runtime/models/model-family-profiles";
import { blobToDataUrl } from "@/runtime/attachments/blob-utils";
import type { TokenEstimator } from "@/runtime/chat/token-estimator";

const ATTACHMENT_URL_PREFIX = "cherrychat-attachment:";

export type RequestValidationCode =
  | "INVALID_MESSAGE"
  | "VISION_UNSUPPORTED"
  | "MISSING_ATTACHMENT"
  | "INVALID_REASONING_CHOICE"
  | "INVALID_PARAMETER";

export class RequestValidationError extends Error {
  constructor(
    readonly code: RequestValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "RequestValidationError";
  }
}

export interface BuildChatRequestInput {
  modelId: string;
  capability: ResolvedModelCapability | EffectiveModelCapability;
  preferences: ModelPreferences;
  reasoning: ReasoningChoice;
  systemPrompt: string;
  historyPath: readonly MessageNode[];
  currentUserMessage: MessageNode;
  contextCutoffId: string | null;
  loadAttachment: (attachmentId: string) => Promise<AttachmentRecord | null>;
  estimator?: TokenEstimator;
}

export interface BuiltChatRequest {
  request: ChatCompletionsRequest;
  context: SelectedContext;
}

export async function buildChatCompletionsRequest(
  input: BuildChatRequestInput,
): Promise<BuiltChatRequest> {
  if (input.capability.modelId !== input.modelId) {
    throw new RequestValidationError(
      "INVALID_PARAMETER",
      "The resolved capability belongs to a different model",
    );
  }

  const reasoning = validateReasoningChoice(input.reasoning, input.capability);

  let history = input.historyPath
    .map(projectHistoryMessage)
    .filter(
      (candidate) =>
        candidate !== null && candidate.id !== input.currentUserMessage.id,
    )
    .filter((candidate): candidate is ContextCandidate => candidate !== null);
  const currentUserMessage = projectCurrentUserMessage(
    input.currentUserMessage,
  );
  if (!input.capability.vision && messageHasImage(currentUserMessage)) {
    throw new RequestValidationError(
      "VISION_UNSUPPORTED",
      `Model ${input.modelId} is not configured for image input`,
    );
  }
  if (!input.capability.vision) {
    history = history
      .map(stripImageParts)
      .filter((candidate): candidate is ContextCandidate => candidate !== null);
  }

  const systemPrompt = input.systemPrompt.trim();
  const context = selectRequestContext({
    modelId: input.modelId,
    contextWindow: input.capability.contextWindow,
    contextCutoffId: input.contextCutoffId,
    systemMessage: systemPrompt
      ? { role: "system", content: systemPrompt }
      : null,
    history,
    currentUserMessage,
    ...(input.estimator ? { estimator: input.estimator } : {}),
  });
  const messages = await hydrateAttachmentUrls(
    context.messages,
    input.loadAttachment,
  );

  const request = {
    reasoning,
    ...(input.preferences.temperature.enabled &&
    input.capability.temperature !== "unsupported"
      ? { temperature: input.preferences.temperature.value }
      : {}),
    ...(input.preferences.topP.enabled &&
    input.capability.topP !== "unsupported"
      ? { top_p: input.preferences.topP.value }
      : {}),
    model: input.modelId,
    messages,
    stream: input.preferences.streaming,
  } satisfies ChatCompletionsRequest;

  return { request, context: { ...context, messages } };
}

function validateReasoningChoice(
  choice: ReasoningChoice,
  capability: ResolvedModelCapability | EffectiveModelCapability,
): ReasoningChoice {
  const control =
    "reasoningControl" in capability
      ? capability.reasoningControl
      : reasoningControlFromCapability(capability);
  if (!isReasoningChoiceSupported(control, choice)) {
    throw new RequestValidationError(
      "INVALID_REASONING_CHOICE",
      `Reasoning choice is not supported by ${capability.modelId}`,
    );
  }
  return choice;
}

function projectHistoryMessage(message: MessageNode): ContextCandidate | null {
  if (message.status !== "completed" && message.status !== "stopped")
    return null;
  if (message.role === "assistant") {
    const messages = projectAssistantMessages(message);
    return messages.length > 0 ? { id: message.id, messages } : null;
  }
  const projected = projectMessage(message);
  return projected ? { id: message.id, messages: [projected] } : null;
}

function projectAssistantMessages(
  message: MessageNode,
): Array<Extract<ChatCompletionMessage, { role: "assistant" | "tool" }>> {
  const messages: Array<
    Extract<ChatCompletionMessage, { role: "assistant" | "tool" }>
  > = [];
  let text: string[] = [];
  const providerContextByStep = groupProviderContextByStep(message.parts);
  for (let index = 0; index < message.parts.length; index += 1) {
    const part = message.parts[index];
    if (part?.type === "text") {
      text.push(part.text);
      continue;
    }
    if (part?.type !== "tool_call") continue;

    const group = [part];
    while (true) {
      const nextPart = message.parts[index + 1];
      if (nextPart?.type !== "tool_call" || nextPart.step !== part.step) break;
      group.push(nextPart);
      index += 1;
    }
    messages.push({
      role: "assistant",
      content: joinAssistantText(text),
      tool_calls: group.map((part) => ({
        id: part.id,
        type: "function",
        function: {
          name: part.name,
          arguments: JSON.stringify(part.input),
        },
      })),
      ...takeProviderContext(providerContextByStep, part.step),
    });
    messages.push(
      ...group.map((part) => ({
        role: "tool" as const,
        content: serializeToolResultForModel(part),
        tool_call_id: part.id,
        name: part.name,
      })),
    );
    text = [];
  }
  const finalText = joinAssistantText(text);
  const remainingProviderContext = [...providerContextByStep.values()].flat();
  if (finalText || remainingProviderContext.length > 0) {
    messages.push({
      role: "assistant",
      content: finalText,
      ...(remainingProviderContext.length > 0
        ? { providerContext: remainingProviderContext }
        : {}),
    });
  }
  return messages;
}

function groupProviderContextByStep(
  parts: readonly MessageNode["parts"][number][],
): Map<number, ProviderContextPart[]> {
  const grouped = new Map<number, ProviderContextPart[]>();
  for (const part of parts) {
    if (part.type !== "provider_context") continue;
    grouped.set(part.step, [...(grouped.get(part.step) ?? []), part]);
  }
  return grouped;
}

function takeProviderContext(
  grouped: Map<number, ProviderContextPart[]>,
  step: number,
): { providerContext?: ProviderContextPart[] } {
  const providerContext = grouped.get(step);
  grouped.delete(step);
  return providerContext && providerContext.length > 0
    ? { providerContext }
    : {};
}

function joinAssistantText(parts: readonly string[]): string | null {
  const text = parts.join("\n").trim();
  return text || null;
}

function projectCurrentUserMessage(
  message: MessageNode,
): Extract<ChatCompletionMessage, { role: "user" }> {
  if (message.role !== "user") {
    throw new RequestValidationError(
      "INVALID_MESSAGE",
      "Current message must have the user role",
    );
  }
  const projected = projectMessage(message);
  if (!projected || projected.role !== "user") {
    throw new RequestValidationError(
      "INVALID_MESSAGE",
      "Current user message cannot be empty",
    );
  }
  return projected;
}

function projectMessage(
  message: MessageNode,
): Extract<ChatCompletionMessage, { role: "user" | "assistant" }> | null {
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (message.role === "assistant") {
    return text ? { role: "assistant", content: text } : null;
  }

  const content: ChatCompletionContentPart[] = [];
  for (const part of message.parts) {
    if (part.type === "text" && part.text.trim()) {
      content.push({ type: "text", text: part.text });
    }
    if (part.type === "image_ref") {
      content.push({
        type: "image_url",
        image_url: { url: `${ATTACHMENT_URL_PREFIX}${part.attachmentId}` },
      });
    }
  }
  if (content.length === 0) return null;
  if (content.every((part) => part.type === "text")) {
    return { role: "user", content: text };
  }
  return { role: "user", content };
}

function messageHasImage(message: ChatCompletionMessage): boolean {
  return (
    Array.isArray(message.content) &&
    message.content.some((part) => part.type === "image_url")
  );
}

function stripImageParts(candidate: ContextCandidate): ContextCandidate | null {
  const messages = candidate.messages.flatMap((message) => {
    if (!Array.isArray(message.content)) return [message];
    const text = message.content
      .filter(
        (part): part is Extract<ChatCompletionContentPart, { type: "text" }> =>
          part.type === "text",
      )
      .map((part) => part.text)
      .join("\n")
      .trim();
    return text ? [{ ...message, content: text }] : [];
  });
  return messages.length > 0 ? { id: candidate.id, messages } : null;
}

async function hydrateAttachmentUrls(
  messages: readonly ChatCompletionMessage[],
  loadAttachment: BuildChatRequestInput["loadAttachment"],
): Promise<ChatCompletionMessage[]> {
  return Promise.all(
    messages.map(async (message): Promise<ChatCompletionMessage> => {
      if (!Array.isArray(message.content)) return message;
      const content = await Promise.all(
        message.content.map(
          async (part): Promise<ChatCompletionContentPart> => {
            if (part.type !== "image_url") return part;
            const attachmentId = part.image_url.url.startsWith(
              ATTACHMENT_URL_PREFIX,
            )
              ? part.image_url.url.slice(ATTACHMENT_URL_PREFIX.length)
              : null;
            if (!attachmentId) return part;
            const attachment = await loadAttachment(attachmentId);
            if (!attachment || attachment.id !== attachmentId) {
              throw new RequestValidationError(
                "MISSING_ATTACHMENT",
                `Attachment ${attachmentId} is unavailable`,
              );
            }
            return {
              type: "image_url",
              image_url: {
                url: await blobToDataUrl(attachment.blob, attachment.mimeType),
              },
            };
          },
        ),
      );
      return { role: "user", content };
    }),
  );
}
