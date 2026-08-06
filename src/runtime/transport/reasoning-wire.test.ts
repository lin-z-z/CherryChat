import { describe, expect, it } from "vitest";

import type { ReasoningChoice } from "@/runtime/chat/types";
import {
  encodeOpenAIChatReasoning,
  getOpenAIChatReasoningContextBehavior,
  getOpenAIChatReasoningContextProvider,
  reasoningChoiceToEffort,
} from "@/runtime/transport/reasoning-wire";

describe("OpenAI Chat reasoning wire", () => {
  it.each([
    [{ mode: "default" }, { suppressSampling: true }],
    [
      { mode: "off" },
      { thinking: { type: "disabled" }, suppressSampling: false },
    ],
    [
      { mode: "effort", effort: "low" },
      {
        thinking: { type: "enabled" },
        reasoningEffort: "low",
        suppressSampling: true,
      },
    ],
    [
      { mode: "effort", effort: "high" },
      {
        thinking: { type: "enabled" },
        reasoningEffort: "high",
        suppressSampling: true,
      },
    ],
    [
      { mode: "effort", effort: "max" },
      {
        thinking: { type: "enabled" },
        reasoningEffort: "max",
        suppressSampling: true,
      },
    ],
  ] as const)("encodes DeepSeek V4 Flash choice %j", (choice, expected) => {
    expect(encodeOpenAIChatReasoning("deepseek-v4-flash", choice)).toEqual(
      expected,
    );
  });

  it.each([
    { mode: "auto" },
    { mode: "effort", effort: "minimal" },
    { mode: "effort", effort: "medium" },
    { mode: "effort", effort: "xhigh" },
  ] as const)("rejects invalid DeepSeek V4 Flash choice %j", (choice) => {
    expect(() =>
      encodeOpenAIChatReasoning(
        "deepseek/deepseek-v4-flash",
        choice as ReasoningChoice,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });

  it("rejects Low for DeepSeek V4 Pro while preserving High and Max", () => {
    expect(() =>
      encodeOpenAIChatReasoning("deepseek-v4-pro", {
        mode: "effort",
        effort: "low",
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
    expect(
      encodeOpenAIChatReasoning("deepseek-v4-pro", {
        mode: "effort",
        effort: "max",
      }),
    ).toEqual({
      thinking: { type: "enabled" },
      reasoningEffort: "max",
      suppressSampling: true,
    });
  });

  it.each([
    [{ mode: "default" }, { suppressSampling: false }],
    [
      { mode: "off" },
      { thinking: { type: "disabled" }, suppressSampling: false },
    ],
    [
      { mode: "effort", effort: "high" },
      {
        thinking: { type: "enabled", clear_thinking: false },
        reasoningEffort: "high",
        suppressSampling: false,
      },
    ],
    [
      { mode: "effort", effort: "max" },
      {
        thinking: { type: "enabled", clear_thinking: false },
        reasoningEffort: "max",
        suppressSampling: false,
      },
    ],
  ] as const)("encodes GLM-5.2 choice %j", (choice, expected) => {
    expect(encodeOpenAIChatReasoning("zhipuai/glm-5.2", choice)).toEqual(
      expected,
    );
  });

  it.each([
    { mode: "on" },
    { mode: "auto" },
    { mode: "effort", effort: "minimal" },
    { mode: "effort", effort: "low" },
    { mode: "effort", effort: "medium" },
    { mode: "effort", effort: "xhigh" },
  ] as const)("rejects invalid GLM-5.2 choice %j", (choice) => {
    expect(() =>
      encodeOpenAIChatReasoning("glm-5.2", choice as ReasoningChoice),
    ).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });

  it.each([
    [{ mode: "default" }, { suppressSampling: false }],
    [
      { mode: "off" },
      { thinking: { type: "disabled" }, suppressSampling: false },
    ],
    [
      { mode: "on" },
      {
        thinking: { type: "enabled", clear_thinking: false },
        suppressSampling: false,
      },
    ],
  ] as const)("encodes switch-style GLM choice %j", (choice, expected) => {
    expect(encodeOpenAIChatReasoning("glm-4.7", choice)).toEqual(expected);
  });

  it.each([{ mode: "auto" }, { mode: "effort", effort: "high" }] as const)(
    "rejects invalid switch-style GLM choice %j",
    (choice) => {
      expect(() =>
        encodeOpenAIChatReasoning("glm-4.7", choice as ReasoningChoice),
      ).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
    },
  );

  it.each([
    [{ mode: "default" }, { suppressSampling: false }],
    [{ mode: "off" }, { enableThinking: false, suppressSampling: false }],
    [
      { mode: "effort", effort: "low" },
      { reasoningEffort: "low", suppressSampling: false },
    ],
    [
      { mode: "effort", effort: "medium" },
      { reasoningEffort: "medium", suppressSampling: false },
    ],
    [
      { mode: "effort", effort: "xhigh" },
      { reasoningEffort: "xhigh", suppressSampling: false },
    ],
  ] as const)("encodes Qwen3.8 Max choice %j", (choice, expected) => {
    expect(encodeOpenAIChatReasoning("qwen3.8-max", choice)).toEqual(expected);
  });

  it.each([
    { mode: "off" },
    { mode: "on" },
    { mode: "auto" },
    { mode: "effort", effort: "high" },
    { mode: "effort", effort: "max" },
  ] as const)("rejects invalid Qwen3.8 preview choice %j", (choice) => {
    expect(() =>
      encodeOpenAIChatReasoning(
        "qwen3.8-max-preview",
        choice as ReasoningChoice,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });

  it.each([
    [{ mode: "default" }, { suppressSampling: false }],
    [{ mode: "off" }, { enableThinking: false, suppressSampling: false }],
    [{ mode: "on" }, { enableThinking: true, suppressSampling: false }],
  ] as const)("encodes mixed Qwen choice %j", (choice, expected) => {
    expect(encodeOpenAIChatReasoning("qwen3.5-plus", choice)).toEqual(expected);
  });

  it.each([
    { mode: "auto" },
    { mode: "effort", effort: "low" },
    { mode: "effort", effort: "high" },
  ] as const)("rejects numeric or adaptive mixed Qwen choice %j", (choice) => {
    expect(() =>
      encodeOpenAIChatReasoning("qwen-plus", choice as ReasoningChoice),
    ).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });

  it.each([
    [{ mode: "default" }, { suppressSampling: true }],
    [
      { mode: "effort", effort: "low" },
      { reasoningEffort: "low", suppressSampling: true },
    ],
    [
      { mode: "effort", effort: "high" },
      { reasoningEffort: "high", suppressSampling: true },
    ],
    [
      { mode: "effort", effort: "max" },
      { reasoningEffort: "max", suppressSampling: true },
    ],
  ] as const)("encodes Kimi K3 choice %j", (choice, expected) => {
    expect(encodeOpenAIChatReasoning("kimi-k3", choice)).toEqual(expected);
  });

  it.each([
    { mode: "off" },
    { mode: "on" },
    { mode: "auto" },
    { mode: "effort", effort: "medium" },
    { mode: "effort", effort: "xhigh" },
  ] as const)("rejects invalid Kimi K3 choice %j", (choice) => {
    expect(() =>
      encodeOpenAIChatReasoning("kimi-k3", choice as ReasoningChoice),
    ).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });

  it.each([
    ["deepseek-v4-flash", { mode: "default" }, "deepseek-chat"],
    ["deepseek-v4-pro", { mode: "off" }, "deepseek-chat"],
    ["glm-5.2", { mode: "default" }, null],
    ["glm-5.2", { mode: "off" }, null],
    ["glm-5.2", { mode: "effort", effort: "high" }, "glm-chat"],
    ["glm-5.2", { mode: "effort", effort: "max" }, "glm-chat"],
    ["glm-4.7", { mode: "default" }, null],
    ["glm-4.7", { mode: "off" }, null],
    ["glm-4.7", { mode: "on" }, "glm-chat"],
    ["gpt-5.4", { mode: "effort", effort: "high" }, null],
    ["qwen3.8-max", { mode: "default" }, "qwen-chat"],
    ["qwen3.8-max", { mode: "off" }, null],
    ["qwen3.5-plus", { mode: "on" }, null],
    ["kimi-k3", { mode: "default" }, "kimi-chat"],
  ] as const)(
    "selects reasoning-content ownership for %s choice %j",
    (modelId, choice, expected) => {
      expect(
        getOpenAIChatReasoningContextProvider(
          modelId,
          choice as ReasoningChoice,
        ),
      ).toBe(expected);
    },
  );

  it.each([
    [
      "deepseek-v4-flash",
      { mode: "default" },
      { provider: "deepseek-chat", capture: "tool-call" },
    ],
    [
      "glm-5.2",
      { mode: "effort", effort: "high" },
      { provider: "glm-chat", capture: "tool-call" },
    ],
    [
      "qwen3.8-max-preview",
      { mode: "default" },
      { provider: "qwen-chat", capture: "always" },
    ],
    [
      "kimi-k3",
      { mode: "effort", effort: "max" },
      { provider: "kimi-chat", capture: "always" },
    ],
  ] as const)(
    "selects capture behavior for %s",
    (modelId, choice, expected) => {
      expect(
        getOpenAIChatReasoningContextBehavior(
          modelId,
          choice as ReasoningChoice,
        ),
      ).toEqual(expected);
    },
  );

  it("keeps the generic OpenAI effort encoding unchanged", () => {
    expect(encodeOpenAIChatReasoning("gpt-5.4", { mode: "off" })).toEqual({
      reasoningEffort: "none",
      suppressSampling: false,
    });
    expect(
      encodeOpenAIChatReasoning("gpt-5.4", {
        mode: "effort",
        effort: "xhigh",
      }),
    ).toEqual({ reasoningEffort: "xhigh", suppressSampling: false });
    expect(reasoningChoiceToEffort({ mode: "auto" })).toBe("auto");
    expect(() => reasoningChoiceToEffort({ mode: "on" })).toThrow(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  });
});
