import { describe, expect, it } from "vitest";

import {
  capabilityFormToOverride,
  capabilityToForm,
} from "@/components/chat/model-settings-form";
import { createDefaultModelPreferences } from "@/runtime/chat/types";
import { getEndpointProfile } from "@/runtime/models/endpoint-profiles";
import { resolveEffectiveModelCapability } from "@/runtime/models/effective-model-capabilities";
import { resolveModelCapability } from "@/runtime/models/model-capabilities";

describe("model settings form projections", () => {
  it("projects intrinsic and endpoint capability without changing preferences", () => {
    const capability = resolveModelCapability("deepseek-v4-flash");
    const effective = resolveEffectiveModelCapability({
      modelCapability: capability,
      endpointProfile: getEndpointProfile("openai"),
    });
    const preferences = createDefaultModelPreferences();

    const form = capabilityToForm(capability, effective, preferences);

    expect(form).toMatchObject({
      reasoning: true,
      supportedEfforts: "none, low, high, max",
      reasoningParameterAvailable: true,
      endpointLimited: false,
      preferences,
    });
  });

  it("trims the editable effort list and compacts unchanged fields", () => {
    const capability = resolveModelCapability("custom-reasoner", {
      reasoning: true,
      supportedEfforts: ["low"],
    });
    const effective = resolveEffectiveModelCapability({
      modelCapability: capability,
      endpointProfile: getEndpointProfile("openai-compatible"),
    });
    const form = capabilityToForm(
      capability,
      effective,
      createDefaultModelPreferences(),
    );

    expect(
      capabilityFormToOverride(" custom-reasoner ", {
        ...form,
        supportedEfforts: " low, high, low ",
      }),
    ).toEqual({
      supportedEfforts: ["low", "high", "low"],
    });
  });
});
