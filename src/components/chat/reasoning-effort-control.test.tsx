import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ReasoningEffortControl,
  type ReasoningEffortControlProps,
} from "@/components/chat/reasoning-effort-control";
import { Providers } from "@/components/providers";
import type { EffectiveModelCapability } from "@/runtime/chat/types";
import { getEndpointProfile } from "@/runtime/models/endpoint-profiles";
import { resolveEffectiveModelCapability } from "@/runtime/models/effective-model-capabilities";
import { resolveModelCapability } from "@/runtime/models/model-capabilities";

const adjustableCapability: EffectiveModelCapability = {
  modelId: "gpt-5-mini",
  reasoning: true,
  supportedEfforts: ["low", "medium", "high"],
  vision: true,
  tools: true,
  contextWindow: 400_000,
  temperature: "unsupported",
  topP: "unsupported",
  source: "builtin",
  endpoint: getEndpointProfile("openai"),
  reasoningControl: {
    kind: "effort",
    options: [
      { mode: "default" },
      { mode: "effort", effort: "low" },
      { mode: "effort", effort: "medium" },
      { mode: "effort", effort: "high" },
    ],
  },
  reasoningWireFormat: "openai-chat",
  streaming: "supported",
};

function renderControl(overrides: Partial<ReasoningEffortControlProps> = {}) {
  const props: ReasoningEffortControlProps = {
    capability: adjustableCapability,
    modelId: adjustableCapability.modelId,
    value: { mode: "default" },
    disabled: false,
    onValueChange: vi.fn(),
    ...overrides,
  };

  return {
    ...render(
      <Providers initialLanguage="en">
        <ReasoningEffortControl {...props} />
      </Providers>,
    ),
    props,
  };
}

describe("ReasoningEffortControl", () => {
  afterEach(() => cleanup());

  it("offers provider default and only the supported adjustable efforts", () => {
    const onValueChange = vi.fn();
    renderControl({
      onValueChange,
      value: { mode: "effort", effort: "medium" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Reasoning effort: Medium" }),
    );

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(4);
    expect(options.map((option) => option.textContent)).toEqual([
      "Model default",
      "Low",
      "Medium",
      "High",
    ]);
    expect(screen.getByRole("option", { name: "Medium" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByRole("option", { name: "High" }));
    expect(onValueChange).toHaveBeenCalledWith({
      mode: "effort",
      effort: "high",
    });
  });

  it("allows the provider default without emitting an unsupported value", () => {
    const onValueChange = vi.fn();
    renderControl({
      onValueChange,
      value: { mode: "effort", effort: "max" },
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Reasoning effort: Model default",
      }),
    );
    fireEvent.click(screen.getByRole("option", { name: "Model default" }));

    expect(onValueChange).toHaveBeenCalledWith({ mode: "default" });
    expect(
      screen.queryByRole("option", { name: "Maximum" }),
    ).not.toBeInTheDocument();
  });

  it("keeps inferred reasoning efforts adjustable when the heuristic has legal options", () => {
    const onValueChange = vi.fn();
    renderControl({
      capability: {
        ...adjustableCapability,
        source: "inferred",
      },
      onValueChange,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Reasoning effort: Model default",
      }),
    );
    fireEvent.click(screen.getByRole("option", { name: "Low" }));

    expect(onValueChange).toHaveBeenCalledWith({
      mode: "effort",
      effort: "low",
    });
  });

  it("keeps Auto and Off distinct from the model default", () => {
    const onValueChange = vi.fn();
    renderControl({
      capability: {
        ...adjustableCapability,
        reasoningControl: {
          kind: "effort",
          options: [
            { mode: "default" },
            { mode: "off" },
            { mode: "auto" },
            { mode: "effort", effort: "high" },
          ],
        },
      },
      onValueChange,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Reasoning effort: Model default",
      }),
    );
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Model default", "Off", "Auto", "High"]);
    fireEvent.click(screen.getByRole("option", { name: "Auto" }));

    expect(onValueChange).toHaveBeenCalledWith({ mode: "auto" });
  });

  it.each([
    [
      "deepseek-v4-flash",
      [
        "Model default (DeepSeek official: thinking on · High)",
        "Off",
        "Low",
        "High",
        "Maximum",
      ],
    ],
    [
      "deepseek-v4-pro",
      [
        "Model default (DeepSeek official: thinking on · High)",
        "Off",
        "High",
        "Maximum",
      ],
    ],
  ] as const)(
    "shows the reviewed DeepSeek controls for %s",
    (modelId, labels) => {
      const capability = resolveEffectiveModelCapability({
        modelCapability: resolveModelCapability(modelId),
        endpointProfile: getEndpointProfile("openai-compatible"),
      });
      renderControl({ capability, modelId });

      fireEvent.click(
        screen.getByRole("button", {
          name: `Reasoning effort: ${labels[0]}`,
        }),
      );

      expect(
        screen.getAllByRole("option").map((option) => option.textContent),
      ).toEqual(labels);
    },
  );

  it.each([
    [
      "glm-5.2",
      [
        "Model default (GLM official: thinking mode on · Max)",
        "Off",
        "High",
        "Maximum",
      ],
    ],
    [
      "glm-4.7",
      ["Model default (GLM official: thinking mode on)", "Off", "On"],
    ],
  ] as const)("shows the reviewed GLM controls for %s", (modelId, labels) => {
    const capability = resolveEffectiveModelCapability({
      modelCapability: resolveModelCapability(modelId),
      endpointProfile: getEndpointProfile("openai-compatible"),
    });
    renderControl({ capability, modelId });

    fireEvent.click(
      screen.getByRole("button", {
        name: `Reasoning effort: ${labels[0]}`,
      }),
    );

    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(labels);
  });

  it.each([
    [
      "qwen3.8-max",
      [
        "Model default (Qwen official: XHigh)",
        "Off",
        "Low",
        "Medium",
        "Extra high",
      ],
    ],
    [
      "qwen3.8-max-preview",
      ["Model default (Qwen official: XHigh)", "Low", "Medium", "Extra high"],
    ],
    [
      "qwen3.5-plus",
      ["Model default (Qwen official: thinking mode on)", "Off", "On"],
    ],
    [
      "qwen-plus",
      ["Model default (Qwen official: thinking mode off)", "Off", "On"],
    ],
    [
      "kimi-k3",
      ["Model default (Kimi official: Max)", "Low", "High", "Maximum"],
    ],
  ] as const)("shows reviewed Qwen/Kimi controls for %s", (modelId, labels) => {
    const capability = resolveEffectiveModelCapability({
      modelCapability: resolveModelCapability(modelId),
      endpointProfile: getEndpointProfile("openai-compatible"),
    });
    renderControl({ capability, modelId });

    fireEvent.click(
      screen.getByRole("button", {
        name: `Reasoning effort: ${labels[0]}`,
      }),
    );

    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(labels);
  });

  it("shows automatic reasoning when the provider has no effort selector", () => {
    const onValueChange = vi.fn();
    const { container } = renderControl({
      capability: {
        ...adjustableCapability,
        supportedEfforts: [],
        reasoningControl: { kind: "fixed" },
      },
      onValueChange,
    });

    expect(
      screen.getByRole("status", { name: "Automatic reasoning" }),
    ).toBeInTheDocument();
    expect(container.querySelector(".reasoning-control-root")).toHaveAttribute(
      "data-availability",
      "automatic",
    );
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it.each(["builtin", "user"] as const)(
    "hides an explicitly unsupported %s capability",
    (source) => {
      const onValueChange = vi.fn();
      const { container } = renderControl({
        capability: {
          ...adjustableCapability,
          reasoning: false,
          source,
          supportedEfforts: [],
          reasoningControl: { kind: "none" },
        },
        onValueChange,
      });

      expect(container.querySelector(".reasoning-control-root")).toBeNull();
      expect(onValueChange).not.toHaveBeenCalled();
    },
  );

  it("hides an inferred non-reasoning model", () => {
    const onValueChange = vi.fn();
    const { container } = renderControl({
      capability: {
        ...adjustableCapability,
        reasoning: false,
        source: "inferred",
        supportedEfforts: [],
        reasoningControl: { kind: "none" },
      },
      onValueChange,
    });

    expect(container.querySelector(".reasoning-control-root")).toBeNull();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it.each([
    ["no capability", null],
    [
      "a stale capability",
      { ...adjustableCapability, modelId: "previous-model" },
    ],
  ] as const)("hides the control for %s", (_case, capability) => {
    const onValueChange = vi.fn();
    const { container } = renderControl({ capability, onValueChange });

    expect(container.querySelector(".reasoning-control-root")).toBeNull();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("keeps the adjustable slot visible but blocks changes while busy", () => {
    const onValueChange = vi.fn();
    renderControl({
      disabled: true,
      onValueChange,
      value: { mode: "effort", effort: "low" },
    });

    const trigger = screen.getByRole("button", {
      name: "Reasoning effort: Low",
    });
    expect(trigger).toBeDisabled();
    expect(trigger.closest(".reasoning-control-root")).toHaveAttribute(
      "data-availability",
      "adjustable",
    );
    fireEvent.click(trigger);

    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
