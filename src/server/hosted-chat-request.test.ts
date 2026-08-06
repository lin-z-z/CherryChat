import { describe, expect, it } from "vitest";

import {
  HOSTED_MAX_IMAGE_DATA_URL_CHARACTERS,
  HOSTED_MAX_MESSAGES,
  HOSTED_MAX_OUTPUT_TOKENS,
  HOSTED_MAX_TEXT_CHARACTERS,
  HOSTED_MAX_TOOL_JSON_BYTES,
  HOSTED_MAX_TOOLS,
  hostedChatRequestSchema,
} from "@/server/hosted-chat-request";

describe("hosted chat request contract", () => {
  it("normalizes an omitted non-streaming flag to false", () => {
    const parsed = hostedChatRequestSchema.safeParse({
      model: "gpt-5",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.stream).toBe(false);
  });

  it("accepts the complete CherryChat wire shape", () => {
    const parsed = hostedChatRequestSchema.safeParse({
      model: " model-a ",
      messages: [
        { role: "system", content: "Be concise" },
        {
          role: "user",
          content: [
            { type: "text", text: "Inspect this image" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,AA==" },
            },
          ],
        },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "web_search",
                arguments: '{"query":"CherryChat"}',
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call-1",
          content: '{"results":[]}',
        },
      ],
      stream: true,
      temperature: 0.4,
      top_p: 0.8,
      max_tokens: 8192,
      reasoning_effort: "high",
      tools: [
        {
          type: "function",
          function: {
            name: "web_search",
            description: "Search the web",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", maxLength: 1000 },
              },
              required: ["query"],
              additionalProperties: false,
            },
            strict: true,
          },
        },
      ],
      tool_choice: "auto",
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.model).toBe("model-a");
  });

  it.each([
    [
      "unknown top-level fields",
      {
        model: "model-a",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
        n: 2,
      },
    ],
    [
      "provider metadata inside a message",
      {
        model: "model-a",
        messages: [
          {
            role: "assistant",
            content: "hello",
            providerContext: [{ secret: "internal" }],
          },
        ],
        stream: true,
      },
    ],
    [
      "too many messages",
      {
        model: "model-a",
        messages: Array.from({ length: HOSTED_MAX_MESSAGES + 1 }, () => ({
          role: "user",
          content: "hello",
        })),
        stream: true,
      },
    ],
    [
      "oversized text",
      {
        model: "model-a",
        messages: [
          { role: "user", content: "x".repeat(HOSTED_MAX_TEXT_CHARACTERS + 1) },
        ],
        stream: true,
      },
    ],
    [
      "too many images",
      {
        model: "model-a",
        messages: [
          {
            role: "user",
            content: Array.from({ length: 4 }, () => ({
              type: "image_url",
              image_url: { url: "data:image/webp;base64,AA==" },
            })),
          },
        ],
        stream: true,
      },
    ],
    [
      "remote image URL",
      {
        model: "model-a",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: "https://tracker.example/pixel.png" },
              },
            ],
          },
        ],
        stream: true,
      },
    ],
    [
      "oversized image data URL",
      {
        model: "model-a",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${"A".repeat(HOSTED_MAX_IMAGE_DATA_URL_CHARACTERS)}`,
                },
              },
            ],
          },
        ],
        stream: true,
      },
    ],
    [
      "too many tools",
      {
        model: "model-a",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
        tools: Array.from({ length: HOSTED_MAX_TOOLS + 1 }, (_, index) =>
          toolDefinition(`tool-${index}`, {}),
        ),
      },
    ],
    [
      "oversized tool parameters",
      {
        model: "model-a",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
        tools: [
          toolDefinition("large_tool", {
            description: "x".repeat(HOSTED_MAX_TOOL_JSON_BYTES),
          }),
        ],
      },
    ],
    [
      "oversized UTF-8 tool arguments",
      {
        model: "model-a",
        messages: [
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-large",
                type: "function",
                function: {
                  name: "large_tool",
                  arguments: "界".repeat(
                    Math.floor(HOSTED_MAX_TOOL_JSON_BYTES / 2),
                  ),
                },
              },
            ],
          },
        ],
        stream: true,
      },
    ],
    [
      "excessive tool parameter depth",
      {
        model: "model-a",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
        tools: [toolDefinition("deep_tool", deeplyNestedParameters())],
      },
    ],
    [
      "excessive output tokens",
      {
        model: "model-a",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
        max_tokens: HOSTED_MAX_OUTPUT_TOKENS + 1,
      },
    ],
  ])("rejects %s", (_name, value) => {
    expect(hostedChatRequestSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    ["default", {}],
    ["off", { thinking: { type: "disabled" } }],
    ["low", { thinking: { type: "enabled" }, reasoning_effort: "low" }],
    ["high", { thinking: { type: "enabled" }, reasoning_effort: "high" }],
    ["max", { thinking: { type: "enabled" }, reasoning_effort: "max" }],
  ] as const)("accepts DeepSeek V4 Flash %s", (_name, fields) => {
    expect(
      hostedChatRequestSchema.safeParse({
        model: "deepseek-v4-flash",
        messages: deepSeekToolHistory(),
        stream: true,
        ...fields,
      }).success,
    ).toBe(true);
  });

  it("accepts DeepSeek sampling controls only when thinking is disabled", () => {
    expect(
      hostedChatRequestSchema.safeParse({
        model: "deepseek-v4-flash",
        messages: deepSeekToolHistory(),
        stream: true,
        thinking: { type: "disabled" },
        temperature: 0.7,
        top_p: 0.8,
      }).success,
    ).toBe(true);
  });

  it("accepts DeepSeek V4 Pro High/Max but rejects Low", () => {
    for (const effort of ["high", "max"] as const) {
      expect(
        hostedChatRequestSchema.safeParse({
          model: "deepseek/deepseek-v4-pro",
          messages: deepSeekToolHistory(),
          stream: true,
          thinking: { type: "enabled" },
          reasoning_effort: effort,
        }).success,
      ).toBe(true);
    }
    expect(
      hostedChatRequestSchema.safeParse({
        model: "deepseek-v4-pro",
        messages: deepSeekToolHistory(),
        stream: true,
        thinking: { type: "enabled" },
        reasoning_effort: "low",
      }).success,
    ).toBe(false);
  });

  it.each([
    ["default", {}, false],
    ["off", { thinking: { type: "disabled" } }, false],
    [
      "high",
      {
        thinking: { type: "enabled", clear_thinking: false },
        reasoning_effort: "high",
      },
      true,
    ],
    [
      "max",
      {
        thinking: { type: "enabled", clear_thinking: false },
        reasoning_effort: "max",
      },
      true,
    ],
  ] as const)("accepts GLM-5.2 %s with sampling", (_name, fields, retained) => {
    expect(
      hostedChatRequestSchema.safeParse({
        model: "glm-5.2",
        messages: retained ? glmToolHistory() : toolHistory(),
        stream: true,
        temperature: 0.7,
        top_p: 0.8,
        ...fields,
      }).success,
    ).toBe(true);
  });

  it.each([
    ["default", {}, false],
    ["off", { thinking: { type: "disabled" } }, false],
    ["on", { thinking: { type: "enabled", clear_thinking: false } }, true],
  ] as const)(
    "accepts switch-style GLM %s without an effort",
    (_name, fields, retained) => {
      expect(
        hostedChatRequestSchema.safeParse({
          model: "zhipuai/glm-4.7-flash",
          messages: retained ? glmToolHistory() : toolHistory(),
          stream: true,
          temperature: 0.6,
          top_p: 0.9,
          ...fields,
        }).success,
      ).toBe(true);
    },
  );

  it.each([
    ["qwen3.8-max", "default", {}, true],
    ["qwen3.8-max", "off", { enable_thinking: false }, false],
    ["qwen3.8-max", "low", { reasoning_effort: "low" }, true],
    ["qwen3.8-max", "medium", { reasoning_effort: "medium" }, true],
    ["qwen3.8-max", "xhigh", { reasoning_effort: "xhigh" }, true],
    ["qwen3.8-max-preview", "default", {}, true],
    ["qwen3.8-max-preview", "low", { reasoning_effort: "low" }, true],
    ["qwen3.8-max-preview", "medium", { reasoning_effort: "medium" }, true],
    ["qwen3.8-max-preview", "xhigh", { reasoning_effort: "xhigh" }, true],
  ] as const)("accepts %s %s", (model, _name, fields, retained) => {
    expect(
      hostedChatRequestSchema.safeParse({
        model,
        messages: retained
          ? retainedReasoningHistory("Qwen private plan")
          : [{ role: "user", content: "Hello" }],
        stream: true,
        temperature: 0.7,
        top_p: 0.8,
        ...fields,
      }).success,
    ).toBe(true);
  });

  it.each([
    ["default", {}],
    ["off", { enable_thinking: false }],
    ["on", { enable_thinking: true }],
  ] as const)("accepts mixed Qwen %s", (_name, fields) => {
    expect(
      hostedChatRequestSchema.safeParse({
        model: "qwen3.5-plus",
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
        temperature: 0.7,
        top_p: 0.8,
        ...fields,
      }).success,
    ).toBe(true);
  });

  it.each([
    ["default", {}],
    ["low", { reasoning_effort: "low" }],
    ["high", { reasoning_effort: "high" }],
    ["max", { reasoning_effort: "max" }],
  ] as const)("accepts Kimi K3 %s with retained context", (_name, fields) => {
    expect(
      hostedChatRequestSchema.safeParse({
        model: "kimi-k3",
        messages: retainedReasoningHistory("Kimi private plan"),
        stream: true,
        ...fields,
      }).success,
    ).toBe(true);
  });

  it.each([
    ["Qwen3.8 preview Off", "qwen3.8-max-preview", { enable_thinking: false }],
    ["Qwen3.8 injected On", "qwen3.8-max", { enable_thinking: true }],
    ["Qwen3.8 High", "qwen3.8-max", { reasoning_effort: "high" }],
    [
      "Qwen3.8 Off with effort",
      "qwen3.8-max",
      { enable_thinking: false, reasoning_effort: "low" },
    ],
    ["mixed Qwen effort", "qwen3.5-plus", { reasoning_effort: "low" }],
    ["Kimi enable_thinking", "kimi-k3", { enable_thinking: true }],
    ["Kimi thinking", "kimi-k3", { thinking: { type: "enabled" } }],
    ["Kimi sampling", "kimi-k3", { temperature: 1 }],
    ["Kimi Medium", "kimi-k3", { reasoning_effort: "medium" }],
    ["GPT enable_thinking", "gpt-5", { enable_thinking: true }],
    [
      "DeepSeek enable_thinking",
      "deepseek-v4-flash",
      { enable_thinking: false },
    ],
  ] as const)("rejects %s", (_name, model, fields) => {
    expect(
      hostedChatRequestSchema.safeParse({
        model,
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
        ...fields,
      }).success,
    ).toBe(false);
  });

  it.each([
    ["mixed Qwen", "qwen3.5-plus", {}],
    ["disabled Qwen3.8", "qwen3.8-max", { enable_thinking: false }],
    ["GPT", "gpt-5", {}],
  ] as const)("rejects reasoning_content for %s", (_name, model, fields) => {
    expect(
      hostedChatRequestSchema.safeParse({
        model,
        messages: retainedReasoningHistory("Cross-family private plan"),
        stream: true,
        ...fields,
      }).success,
    ).toBe(false);
  });

  it.each([
    [
      "GLM-5.2 enabled thinking without clear_thinking",
      {
        model: "glm-5.2",
        thinking: { type: "enabled" },
        reasoning_effort: "high",
        messages: toolHistory(),
      },
    ],
    [
      "GLM-5.2 enabled thinking without an effort",
      {
        model: "glm-5.2",
        thinking: { type: "enabled", clear_thinking: false },
        messages: glmToolHistory(),
      },
    ],
    [
      "GLM-5.2 Low",
      {
        model: "glm-5.2",
        thinking: { type: "enabled", clear_thinking: false },
        reasoning_effort: "low",
        messages: glmToolHistory(),
      },
    ],
    [
      "GLM-5.2 effort without thinking",
      {
        model: "glm-5.2",
        reasoning_effort: "high",
        messages: toolHistory(),
      },
    ],
    [
      "switch-style GLM effort",
      {
        model: "glm-4.7",
        thinking: { type: "enabled", clear_thinking: false },
        reasoning_effort: "high",
        messages: glmToolHistory(),
      },
    ],
    [
      "disabled GLM clear_thinking",
      {
        model: "glm-4.7",
        thinking: { type: "disabled", clear_thinking: false },
        messages: toolHistory(),
      },
    ],
    [
      "GLM reasoning content in model-default mode",
      {
        model: "glm-5.2",
        messages: glmToolHistory(),
      },
    ],
    [
      "GLM reasoning content with disabled thinking",
      {
        model: "glm-5.2",
        thinking: { type: "disabled" },
        messages: glmToolHistory(),
      },
    ],
    [
      "GLM fields on a Vision model",
      {
        model: "glm-4.6v",
        thinking: { type: "enabled", clear_thinking: false },
        messages: glmToolHistory(),
      },
    ],
    [
      "clear_thinking on DeepSeek",
      {
        model: "deepseek-v4-flash",
        thinking: { type: "enabled", clear_thinking: false },
        reasoning_effort: "high",
        messages: deepSeekToolHistory(),
      },
    ],
    [
      "clear_thinking=true",
      {
        model: "glm-5.2",
        thinking: { type: "enabled", clear_thinking: true },
        reasoning_effort: "high",
        messages: glmToolHistory(),
      },
    ],
    [
      "an unknown thinking field",
      {
        model: "glm-5.2",
        thinking: {
          type: "enabled",
          clear_thinking: false,
          budget_tokens: 1024,
        },
        reasoning_effort: "high",
        messages: glmToolHistory(),
      },
    ],
  ])("rejects %s", (_name, fields) => {
    expect(
      hostedChatRequestSchema.safeParse({ stream: true, ...fields }).success,
    ).toBe(false);
  });

  it.each([
    [
      "disabled thinking with an effort",
      {
        model: "deepseek-v4-flash",
        thinking: { type: "disabled" },
        reasoning_effort: "high",
        messages: deepSeekToolHistory(),
      },
    ],
    [
      "an effort without enabled thinking",
      {
        model: "deepseek-v4-flash",
        reasoning_effort: "high",
        messages: deepSeekToolHistory(),
      },
    ],
    [
      "enabled thinking without an effort",
      {
        model: "deepseek-v4-flash",
        thinking: { type: "enabled" },
        messages: deepSeekToolHistory(),
      },
    ],
    [
      "sampling controls with model-default thinking",
      {
        model: "deepseek-v4-flash",
        temperature: 0.7,
        messages: deepSeekToolHistory(),
      },
    ],
    [
      "sampling controls with enabled thinking",
      {
        model: "deepseek-v4-flash",
        thinking: { type: "enabled" },
        reasoning_effort: "high",
        top_p: 0.8,
        messages: deepSeekToolHistory(),
      },
    ],
    [
      "DeepSeek fields on another model",
      {
        model: "gpt-5",
        thinking: { type: "enabled" },
        messages: deepSeekToolHistory(),
      },
    ],
    [
      "reasoning content without tool-call history",
      {
        model: "deepseek-v4-flash",
        messages: [
          {
            role: "assistant",
            content: "Answer",
            reasoning_content: "Private plan",
          },
        ],
      },
    ],
    [
      "oversized reasoning content",
      {
        model: "deepseek-v4-flash",
        messages: [
          {
            role: "assistant",
            content: null,
            reasoning_content: "x".repeat(HOSTED_MAX_TEXT_CHARACTERS + 1),
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "web_search", arguments: "{}" },
              },
            ],
          },
        ],
      },
    ],
  ])("rejects %s", (_name, fields) => {
    expect(
      hostedChatRequestSchema.safeParse({
        stream: true,
        ...fields,
      }).success,
    ).toBe(false);
  });

  it("keeps existing non-DeepSeek reasoning_effort valid", () => {
    expect(
      hostedChatRequestSchema.safeParse({
        model: "gpt-5",
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
        reasoning_effort: "xhigh",
      }).success,
    ).toBe(true);
  });
});

function toolDefinition(name: string, parameters: Record<string, unknown>) {
  return {
    type: "function",
    function: {
      name,
      description: "Tool",
      parameters,
    },
  };
}

function deeplyNestedParameters(): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let current = root;
  for (let index = 0; index < 20; index += 1) {
    const child: Record<string, unknown> = {};
    current.next = child;
    current = child;
  }
  return root;
}

function deepSeekToolHistory() {
  return toolHistory("Need current sources");
}

function glmToolHistory() {
  return toolHistory("GLM current sources");
}

function retainedReasoningHistory(reasoningContent: string) {
  return [
    { role: "user", content: "Previous question" },
    {
      role: "assistant",
      content: "Previous answer",
      reasoning_content: reasoningContent,
    },
    { role: "user", content: "Continue" },
  ];
}

function toolHistory(reasoningContent?: string) {
  return [
    { role: "user", content: "Search" },
    {
      role: "assistant",
      content: null,
      ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: {
            name: "web_search",
            arguments: '{"query":"storm"}',
          },
        },
      ],
    },
    { role: "tool", content: "[]", tool_call_id: "call-1" },
  ];
}
