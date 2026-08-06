import { describe, expect, it } from "vitest";

import { resolveAgentRuntimeKind } from "@/runtime/agent/agent-runtime-factory";

const runtimeCases = [
  [
    "Hosted",
    { mode: "hosted", apiType: "anthropic" },
    "ai-sdk-openai-compatible",
  ],
  [
    "OpenAI Chat",
    { mode: "byok", apiType: "openai" },
    "ai-sdk-openai-compatible",
  ],
  [
    "OpenAI Compatible",
    { mode: "byok", apiType: "openai-compatible" },
    "ai-sdk-openai-compatible",
  ],
  [
    "OpenAI Responses",
    { mode: "byok", apiType: "openai-responses" },
    "ai-sdk-openai-responses",
  ],
  ["Gemini", { mode: "byok", apiType: "gemini" }, "ai-sdk-google"],
  ["Anthropic", { mode: "byok", apiType: "anthropic" }, "ai-sdk-anthropic"],
  [
    "New API default",
    { mode: "byok", apiType: "new-api" },
    "ai-sdk-openai-compatible",
  ],
  [
    "New API Chat",
    { mode: "byok", apiType: "new-api", endpointType: "openai-chat" },
    "ai-sdk-openai-compatible",
  ],
  [
    "New API Responses",
    { mode: "byok", apiType: "new-api", endpointType: "openai-responses" },
    "ai-sdk-openai-responses",
  ],
  [
    "New API Gemini",
    { mode: "byok", apiType: "new-api", endpointType: "gemini" },
    "ai-sdk-google",
  ],
  [
    "New API Anthropic",
    { mode: "byok", apiType: "new-api", endpointType: "anthropic" },
    "ai-sdk-anthropic",
  ],
] as const;

describe("resolveAgentRuntimeKind", () => {
  it.each(runtimeCases)(
    "selects the %s AI SDK runtime",
    (_name, connection, expected) => {
      expect(resolveAgentRuntimeKind(connection)).toBe(expected);
    },
  );
});
