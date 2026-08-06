import type {
  EffectiveModelCapability,
  EffectiveReasoningWireFormat,
  EndpointProfile,
  ModelReasoningControl,
  ReasoningChoice,
  ResolvedModelCapability,
  SupportState,
} from "@/runtime/chat/types";
import {
  getDeepSeekV4Variant,
  getGlmReasoningVariant,
  type GlmReasoningVariant,
  getModelFamilyProfile,
  getQwenChatReasoningVariant,
  type QwenChatReasoningVariant,
  isKimiK3Model,
  reasoningControlFromCapability,
} from "@/runtime/models/model-family-profiles";

export const DEFAULT_REASONING_CHOICE = {
  mode: "default",
} as const satisfies ReasoningChoice;

export function resolveEffectiveModelCapability({
  modelCapability,
  endpointProfile,
}: {
  modelCapability: ResolvedModelCapability;
  endpointProfile: EndpointProfile;
}): EffectiveModelCapability {
  const modelControl = reasoningControlFromCapability(modelCapability);
  const modelProfile = getModelFamilyProfile(modelCapability.modelId);
  const deepSeekV4Variant = getDeepSeekV4Variant(modelCapability.modelId);
  const glmReasoningVariant = getGlmReasoningVariant(modelCapability.modelId);
  const qwenReasoningVariant = getQwenChatReasoningVariant(
    modelCapability.modelId,
  );
  const kimiK3 = isKimiK3Model(modelCapability.modelId);
  const reasoningWireFormat = resolveReasoningWireFormat(
    modelCapability.modelId,
    endpointProfile,
  );
  const reasoningControl =
    endpointProfile.reasoning === "unsupported" ||
    reasoningWireFormat === "none"
      ? ({ kind: "none" } as const)
      : (deepSeekV4Variant ||
            glmReasoningVariant ||
            qwenReasoningVariant ||
            kimiK3) &&
          reasoningWireFormat !== "openai-chat" &&
          modelControl.kind !== "none"
        ? ({ kind: "fixed" } as const)
        : modelProfile?.nativeReasoningOnly && modelControl.kind !== "none"
          ? ({ kind: "fixed" } as const)
          : intersectReasoningControl(modelControl, reasoningWireFormat);

  return {
    ...modelCapability,
    reasoning: reasoningControl.kind !== "none",
    supportedEfforts:
      reasoningControl.kind === "effort"
        ? reasoningControl.options.flatMap((choice) =>
            choice.mode === "effort" ? [choice.effort] : [],
          )
        : [],
    vision: modelCapability.vision && endpointProfile.vision !== "unsupported",
    tools: modelCapability.tools && endpointProfile.tools !== "unsupported",
    temperature: intersectSupport(
      modelCapability.temperature,
      endpointProfile.temperature,
    ),
    topP: intersectSupport(modelCapability.topP, endpointProfile.topP),
    endpoint: endpointProfile,
    reasoningControl,
    reasoningWireFormat,
    streaming: endpointProfile.streaming,
  };
}

export function isReasoningChoiceSupported(
  control: ModelReasoningControl,
  choice: ReasoningChoice,
): boolean {
  if (choice.mode === "default") return true;
  if (control.kind === "none" || control.kind === "fixed") return false;
  if (control.kind === "switch") {
    return (
      (choice.mode === "on" ||
        choice.mode === "auto" ||
        choice.mode === "off") &&
      control.options.includes(choice.mode)
    );
  }
  return control.options.some((option) => sameReasoningChoice(option, choice));
}

export function sameReasoningChoice(
  left: ReasoningChoice,
  right: ReasoningChoice,
): boolean {
  return (
    left.mode === right.mode &&
    (left.mode !== "effort" ||
      (right.mode === "effort" && left.effort === right.effort))
  );
}

export function isDeepSeekV4OpenAIChatCapability(
  capability: Pick<EffectiveModelCapability, "modelId" | "reasoningWireFormat">,
): boolean {
  return (
    capability.reasoningWireFormat === "openai-chat" &&
    getDeepSeekV4Variant(capability.modelId) !== null
  );
}

export function getGlmOpenAIChatReasoningVariant(
  capability: Pick<EffectiveModelCapability, "modelId" | "reasoningWireFormat">,
): GlmReasoningVariant | null {
  if (capability.reasoningWireFormat !== "openai-chat") return null;
  return getGlmReasoningVariant(capability.modelId);
}

export function getQwenOpenAIChatReasoningVariant(
  capability: Pick<EffectiveModelCapability, "modelId" | "reasoningWireFormat">,
): QwenChatReasoningVariant | null {
  if (capability.reasoningWireFormat !== "openai-chat") return null;
  return getQwenChatReasoningVariant(capability.modelId);
}

export function isKimiK3OpenAIChatCapability(
  capability: Pick<EffectiveModelCapability, "modelId" | "reasoningWireFormat">,
): boolean {
  return (
    capability.reasoningWireFormat === "openai-chat" &&
    isKimiK3Model(capability.modelId)
  );
}

function resolveReasoningWireFormat(
  modelId: string,
  endpointProfile: EndpointProfile,
): EffectiveReasoningWireFormat {
  if (endpointProfile.reasoningFormat !== "gemini") {
    return endpointProfile.reasoningFormat;
  }
  const geminiFormat = getModelFamilyProfile(modelId)?.geminiReasoningFormat;
  return geminiFormat ? `gemini-${geminiFormat}` : "none";
}

function intersectReasoningControl(
  control: ModelReasoningControl,
  wireFormat: EffectiveReasoningWireFormat,
): ModelReasoningControl {
  if (control.kind !== "effort") return control;

  const options = control.options.filter((choice) => {
    if (choice.mode !== "auto") return true;
    return wireFormat === "gemini-budget" || wireFormat === "anthropic";
  });
  if (options.every(({ mode }) => mode === "default")) {
    return { kind: "fixed" };
  }
  return { kind: "effort", options };
}

function intersectSupport(
  model: SupportState,
  endpoint: SupportState,
): SupportState {
  if (model === "unsupported" || endpoint === "unsupported") {
    return "unsupported";
  }
  if (model === "supported" && endpoint === "supported") return "supported";
  return "unknown";
}
