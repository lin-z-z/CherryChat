import type {
  CapabilitySource,
  EffectiveModelCapability,
  ModelCapabilityOverride,
  ModelPreferences,
  ResolvedModelCapability,
} from "@/runtime/chat/types";
import {
  compactModelCapabilityOverride,
  getAutomaticModelCapability,
} from "@/runtime/models/model-capabilities";

export interface ModelSettingsForm {
  reasoning: boolean;
  supportedEfforts: string;
  automaticSupportedEfforts: string;
  vision: boolean;
  tools: boolean;
  contextWindow: number;
  temperatureAvailable: boolean;
  topPAvailable: boolean;
  streamingAvailable: boolean;
  reasoningParameterAvailable: boolean;
  endpointLimited: boolean;
  source: CapabilitySource;
  preferences: ModelPreferences;
}

export function capabilityToForm(
  capability: ResolvedModelCapability,
  effective: EffectiveModelCapability,
  preferences: ModelPreferences,
): ModelSettingsForm {
  const automatic = getAutomaticModelCapability(capability.modelId);
  const intrinsicHasReasoningParameter = capability.supportedEfforts.length > 0;
  const effectiveHasReasoningParameter =
    effective.reasoningControl.kind === "effort" ||
    effective.reasoningControl.kind === "switch";
  return {
    reasoning: capability.reasoning,
    supportedEfforts: capability.supportedEfforts.join(", "),
    automaticSupportedEfforts: automatic.supportedEfforts.join(", "),
    vision: capability.vision,
    tools: capability.tools,
    contextWindow: capability.contextWindow,
    temperatureAvailable: effective.temperature !== "unsupported",
    topPAvailable: effective.topP !== "unsupported",
    streamingAvailable: effective.streaming !== "unsupported",
    reasoningParameterAvailable: effectiveHasReasoningParameter,
    endpointLimited:
      (capability.vision && !effective.vision) ||
      (capability.tools && !effective.tools) ||
      (intrinsicHasReasoningParameter && !effectiveHasReasoningParameter) ||
      (capability.temperature !== "unsupported" &&
        effective.temperature === "unsupported") ||
      (capability.topP !== "unsupported" && effective.topP === "unsupported") ||
      effective.streaming === "unsupported",
    source: capability.source,
    preferences,
  };
}

export function capabilityFormToOverride(
  modelId: string,
  capability: ModelSettingsForm,
): ModelCapabilityOverride {
  return compactModelCapabilityOverride(modelId, {
    reasoning: capability.reasoning,
    supportedEfforts: capability.reasoning
      ? capability.supportedEfforts
          .split(",")
          .map((effort) => effort.trim())
          .filter(Boolean)
      : [],
    vision: capability.vision,
    tools: capability.tools,
    contextWindow: capability.contextWindow,
  });
}
