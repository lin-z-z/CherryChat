import { describe, expect, it } from "vitest";

import type { EndpointProfile, ReasoningChoice } from "@/runtime/chat/types";
import { getEndpointProfile } from "@/runtime/models/endpoint-profiles";
import { getConnectionEndpointProfile } from "@/runtime/models/endpoint-profiles";
import {
  isReasoningChoiceSupported,
  resolveEffectiveModelCapability,
} from "@/runtime/models/effective-model-capabilities";
import { resolveModelCapability } from "@/runtime/models/model-capabilities";

describe("effective model capabilities", () => {
  it("keeps Gemini 3.1 Pro levels and selects the native level encoder", () => {
    const effective = resolve("gemini-3.1-pro", "gemini");

    expect(effective).toMatchObject({
      reasoning: true,
      reasoningWireFormat: "gemini-level",
      supportedEfforts: ["low", "medium", "high"],
      reasoningControl: {
        kind: "effort",
        options: [
          { mode: "default" },
          { mode: "effort", effort: "low" },
          { mode: "effort", effort: "medium" },
          { mode: "effort", effort: "high" },
        ],
      },
    });
  });

  it("uses Gemini 2.5 budget controls without fabricating Pro off support", () => {
    const flash = resolve("gemini-2.5-flash", "gemini");
    const pro = resolve("gemini-2.5-pro", "gemini");

    expect(flash.reasoningWireFormat).toBe("gemini-budget");
    expect(flash.reasoningControl).toMatchObject({
      kind: "effort",
      options: [
        { mode: "default" },
        { mode: "off" },
        { mode: "auto" },
        { mode: "effort", effort: "low" },
        { mode: "effort", effort: "medium" },
        { mode: "effort", effort: "high" },
      ],
    });
    expect(pro.reasoningControl).toMatchObject({
      kind: "effort",
      options: expect.not.arrayContaining([{ mode: "off" }]),
    });
    expect(
      isReasoningChoiceSupported(pro.reasoningControl, { mode: "auto" }),
    ).toBe(true);
    expect(
      isReasoningChoiceSupported(pro.reasoningControl, { mode: "off" }),
    ).toBe(false);
  });

  it("uses only standard OpenAI reasoning fields through generic gateways", () => {
    const effective = resolve("gemini-2.5-flash", "new-api");

    expect(effective.reasoningWireFormat).toBe("openai-chat");
    expect(effective.reasoningControl).toMatchObject({
      kind: "effort",
      options: expect.not.arrayContaining([{ mode: "auto" }]),
    });
    expect(
      isReasoningChoiceSupported(effective.reasoningControl, {
        mode: "effort",
        effort: "high",
      }),
    ).toBe(true);
  });

  it("does not claim native Gemini reasoning for an unrelated model", () => {
    const effective = resolve("custom-reasoner", "gemini", {
      reasoning: true,
      supportedEfforts: ["low"],
    });

    expect(effective.reasoning).toBe(false);
    expect(effective.reasoningControl).toEqual({ kind: "none" });
    expect(effective.reasoningWireFormat).toBe("none");
  });

  it("keeps hosted mode on the same-origin OpenAI Chat capability profile", () => {
    expect(
      getConnectionEndpointProfile({ mode: "hosted", apiType: "gemini" }),
    ).toMatchObject({
      apiType: "openai",
      reasoningFormat: "openai-chat",
    });
  });

  it.each([
    ["Flash", "deepseek-v4-flash", ["low", "high", "max"]],
    ["Pro", "deepseek-v4-pro", ["high", "max"]],
  ] as const)(
    "exposes DeepSeek V4 %s controls on every OpenAI Chat compatible connection",
    (_variant, modelId, efforts) => {
      const endpointProfiles = [
        getConnectionEndpointProfile({ mode: "hosted", apiType: "gemini" }),
        getEndpointProfile("openai"),
        getConnectionEndpointProfile({
          mode: "byok",
          apiType: "new-api",
          endpointType: "openai-chat",
        }),
        getEndpointProfile("openai-compatible"),
      ];

      for (const endpointProfile of endpointProfiles) {
        const effective = resolveEffectiveModelCapability({
          modelCapability: resolveModelCapability(modelId),
          endpointProfile,
        });
        expect(effective.reasoningWireFormat).toBe("openai-chat");
        expect(effective.reasoningControl).toEqual({
          kind: "effort",
          options: [
            { mode: "default" },
            { mode: "off" },
            ...efforts.map((effort) => ({ mode: "effort", effort })),
          ],
        });
      }
    },
  );

  it.each(["openai-responses", "anthropic"] as const)(
    "does not expose DeepSeek V4 Chat controls through %s",
    (apiType) => {
      const effective = resolve("deepseek-v4-flash", apiType);

      expect(effective.reasoning).toBe(true);
      expect(effective.reasoningControl).toEqual({ kind: "fixed" });
      expect(effective.supportedEfforts).toEqual([]);
    },
  );

  it.each([
    ["GLM 5.2", "glm-5.2", ["high", "max"]],
    ["GLM switch", "glm-4.7", []],
  ] as const)(
    "exposes %s controls on every OpenAI Chat compatible connection",
    (_variant, modelId, efforts) => {
      const endpointProfiles = [
        getConnectionEndpointProfile({ mode: "hosted", apiType: "gemini" }),
        getEndpointProfile("openai"),
        getConnectionEndpointProfile({
          mode: "byok",
          apiType: "new-api",
          endpointType: "openai-chat",
        }),
        getEndpointProfile("openai-compatible"),
      ];

      for (const endpointProfile of endpointProfiles) {
        const effective = resolveEffectiveModelCapability({
          modelCapability: resolveModelCapability(modelId),
          endpointProfile,
        });
        expect(effective.reasoningWireFormat).toBe("openai-chat");
        expect(effective.reasoningControl).toEqual(
          efforts.length > 0
            ? {
                kind: "effort",
                options: [
                  { mode: "default" },
                  { mode: "off" },
                  ...efforts.map((effort) => ({ mode: "effort", effort })),
                ],
              }
            : {
                kind: "switch",
                options: ["off", "on"],
              },
        );
      }
    },
  );

  it.each(["openai-responses", "anthropic", "gemini"] as const)(
    "does not expose GLM Chat controls through %s",
    (apiType) => {
      const effective = resolve("glm-5.2", apiType);

      expect(effective.reasoningControl).not.toMatchObject({ kind: "effort" });
      expect(effective.supportedEfforts).toEqual([]);
    },
  );

  it.each([
    [
      "qwen3.8-max",
      [
        { mode: "default" },
        { mode: "off" },
        { mode: "effort", effort: "low" },
        { mode: "effort", effort: "medium" },
        { mode: "effort", effort: "xhigh" },
      ],
    ],
    [
      "qwen3.8-max-preview",
      [
        { mode: "default" },
        { mode: "effort", effort: "low" },
        { mode: "effort", effort: "medium" },
        { mode: "effort", effort: "xhigh" },
      ],
    ],
  ] as const)(
    "exposes reviewed Qwen3.8 controls for %s",
    (modelId, options) => {
      expect(resolve(modelId, "openai-compatible").reasoningControl).toEqual({
        kind: "effort",
        options,
      });
    },
  );

  it.each(["qwen3.5-plus", "qwen3-32b", "qwen3-max", "qwen-plus"])(
    "uses a binary Chat switch for mixed Qwen model %s",
    (modelId) => {
      expect(resolve(modelId, "openai-compatible").reasoningControl).toEqual({
        kind: "switch",
        options: ["off", "on"],
      });
    },
  );

  it("exposes Kimi K3 Low/High/Max and suppresses sampling capability", () => {
    expect(resolve("kimi-k3", "openai-compatible")).toMatchObject({
      reasoningControl: {
        kind: "effort",
        options: [
          { mode: "default" },
          { mode: "effort", effort: "low" },
          { mode: "effort", effort: "high" },
          { mode: "effort", effort: "max" },
        ],
      },
      temperature: "unsupported",
      topP: "unsupported",
    });
  });

  it.each([
    ["qwen3.8-max", "openai-responses"],
    ["qwen3.5-plus", "anthropic"],
    ["kimi-k3", "openai-responses"],
  ] as const)(
    "does not expose %s Chat controls through %s",
    (modelId, apiType) => {
      const effective = resolve(modelId, apiType);

      expect(effective.reasoningControl).toEqual({ kind: "fixed" });
      expect(effective.supportedEfforts).toEqual([]);
    },
  );

  it("keeps explicit GLM On distinct from Auto", () => {
    const effective = resolve("glm-4.7", "openai-compatible");

    expect(
      isReasoningChoiceSupported(effective.reasoningControl, { mode: "on" }),
    ).toBe(true);
    expect(
      isReasoningChoiceSupported(effective.reasoningControl, { mode: "auto" }),
    ).toBe(false);
  });

  it("does not expose DeepSeek V4 controls through a Gemini endpoint", () => {
    const effective = resolve("deepseek-v4-flash", "gemini");

    expect(effective.reasoning).toBe(false);
    expect(effective.reasoningControl).toEqual({ kind: "none" });
  });

  it.each([
    ["gemini-pro-latest", ["low", "medium", "high"]],
    ["gemini-flash-latest", ["minimal", "low", "medium", "high"]],
  ] as const)("uses native Gemini levels for alias %s", (modelId, efforts) => {
    const effective = resolve(modelId, "gemini");

    expect(effective).toMatchObject({
      reasoningWireFormat: "gemini-level",
      supportedEfforts: efforts,
    });
  });

  it("applies endpoint hard limits after user model overrides", () => {
    const endpoint = {
      ...getEndpointProfile("openai"),
      reasoning: "unsupported",
      vision: "unsupported",
      temperature: "unsupported",
    } satisfies EndpointProfile;
    const effective = resolveEffectiveModelCapability({
      modelCapability: resolveModelCapability("custom-chat", {
        reasoning: true,
        supportedEfforts: ["high"],
        vision: true,
        temperature: "supported",
      }),
      endpointProfile: endpoint,
    });

    expect(effective).toMatchObject({
      reasoning: false,
      vision: false,
      temperature: "unsupported",
    });
  });

  it.each([
    [{ mode: "default" }, true],
    [{ mode: "effort", effort: "medium" }, true],
    [{ mode: "effort", effort: "max" }, false],
    [{ mode: "off" }, false],
  ] as const)("validates reasoning choice %j", (choice, supported) => {
    const effective = resolve("gemini-3.1-pro", "gemini");
    expect(
      isReasoningChoiceSupported(
        effective.reasoningControl,
        choice as ReasoningChoice,
      ),
    ).toBe(supported);
  });
});

function resolve(
  modelId: string,
  apiType: Parameters<typeof getEndpointProfile>[0],
  override?: Parameters<typeof resolveModelCapability>[1],
) {
  return resolveEffectiveModelCapability({
    modelCapability: resolveModelCapability(modelId, override),
    endpointProfile: getEndpointProfile(apiType),
  });
}
