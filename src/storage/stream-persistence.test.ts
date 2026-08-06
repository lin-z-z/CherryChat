import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChatDatabase } from "@/storage/database";
import { MessageStreamPersistence } from "@/storage/stream-persistence";
import {
  ThrottledStreamPersistence,
  type StreamResult,
} from "@/runtime/streaming/stream-state";
import { ChatTransportError } from "@/runtime/transport/chat-errors";
import {
  createDefaultAssistantSnapshot,
  DEFAULT_ASSISTANT_ID,
} from "@/runtime/chat/types";

describe("MessageStreamPersistence", () => {
  let database: ChatDatabase;

  beforeEach(async () => {
    database = new ChatDatabase(`stream-persistence-${crypto.randomUUID()}`);
    await database.conversations.add({
      id: "conversation-1",
      title: "Chat",
      titleSource: "local",
      archived: false,
      activeLeafId: "assistant-1",
      activeModelId: "gpt-4.1-mini",
      contextCutoffId: null,
      assistantId: DEFAULT_ASSISTANT_ID,
      assistantSnapshot: createDefaultAssistantSnapshot(),
      autoTitle: true,
      webSearchEnabled: false,
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    });
    await database.messages.add({
      id: "assistant-1",
      conversationId: "conversation-1",
      parentId: null,
      role: "assistant",
      parts: [],
      status: "pending",
      modelSnapshot: null,
      usage: null,
      error: null,
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    });
  });

  afterEach(async () => {
    await database.delete();
  });

  it("writes drafts and atomically finalizes parts, usage and status", async () => {
    const persistence = new MessageStreamPersistence(
      database,
      "assistant-1",
      () => "2026-07-17T00:00:01.000Z",
    );
    const result: StreamResult = {
      state: "completed",
      reasoningText: "thought",
      finalText: "answer",
      reasoningSource: "reasoning_content",
      tagState: "final",
      usage: {
        promptTokens: 2,
        completionTokens: 3,
        reasoningTokens: 1,
        totalTokens: 5,
        estimated: false,
      },
      toolCalls: [],
      contentParts: [
        {
          type: "tool_call",
          id: "call-1",
          name: "web_search",
          step: 0,
          input: { query: "current" },
          output: { query: "current", results: [] },
          status: "completed",
          errorCode: null,
          errorStatus: null,
          retryable: false,
        },
        { type: "text", text: "answer" },
      ],
      providerContextParts: [
        {
          type: "provider_context",
          provider: "openai-responses",
          contextType: "reasoning",
          step: 0,
          itemId: "reasoning-item",
          encryptedContent: "encrypted-context",
          reasoningTokens: 1,
        },
        {
          type: "provider_context",
          provider: "gemini",
          contextType: "thought_signature",
          step: 0,
          toolCallId: "call-1",
          thoughtSignature: "gemini-durable-signature",
        },
        {
          type: "provider_context",
          provider: "deepseek-chat",
          contextType: "reasoning_content",
          step: 0,
          text: "deepseek durable plan",
        },
        {
          type: "provider_context",
          provider: "glm-chat",
          contextType: "reasoning_content",
          step: 0,
          text: "glm durable plan",
        },
        {
          type: "provider_context",
          provider: "qwen-chat",
          contextType: "reasoning_content",
          step: 0,
          text: "qwen durable plan",
        },
        {
          type: "provider_context",
          provider: "kimi-chat",
          contextType: "reasoning_content",
          step: 0,
          text: "kimi durable plan",
        },
        {
          type: "provider_context",
          provider: "anthropic",
          contextType: "thinking",
          step: 0,
          blockIndex: 0,
          text: "anthropic private plan",
          signature: "anthropic-durable-signature",
        },
      ],
      reasoningDurationMs: 400,
      startedAt: 0,
      updatedAt: 500,
      error: null,
    };

    await persistence.saveDraft({ ...result, state: "answering" });
    expect(await database.messages.get("assistant-1")).toMatchObject({
      status: "streaming",
      parts: expect.arrayContaining([
        expect.objectContaining({
          type: "provider_context",
          itemId: "reasoning-item",
        }),
      ]),
    });

    await new ThrottledStreamPersistence(persistence).finish(result);
    expect(await database.messages.get("assistant-1")).toMatchObject({
      status: "completed",
      parts: [
        {
          type: "reasoning",
          text: "thought",
          source: "reasoning_content",
          durationMs: 400,
        },
        {
          type: "provider_context",
          itemId: "reasoning-item",
          encryptedContent: "encrypted-context",
          reasoningTokens: 1,
        },
        {
          type: "provider_context",
          provider: "gemini",
          toolCallId: "call-1",
          thoughtSignature: "gemini-durable-signature",
        },
        {
          type: "provider_context",
          provider: "deepseek-chat",
          contextType: "reasoning_content",
          step: 0,
          text: "deepseek durable plan",
        },
        {
          type: "provider_context",
          provider: "glm-chat",
          contextType: "reasoning_content",
          step: 0,
          text: "glm durable plan",
        },
        {
          type: "provider_context",
          provider: "qwen-chat",
          contextType: "reasoning_content",
          step: 0,
          text: "qwen durable plan",
        },
        {
          type: "provider_context",
          provider: "kimi-chat",
          contextType: "reasoning_content",
          step: 0,
          text: "kimi durable plan",
        },
        {
          type: "provider_context",
          provider: "anthropic",
          contextType: "thinking",
          blockIndex: 0,
          text: "anthropic private plan",
          signature: "anthropic-durable-signature",
        },
        {
          type: "tool_call",
          id: "call-1",
          name: "web_search",
          step: 0,
          status: "completed",
        },
        { type: "text", text: "answer" },
      ],
      usage: { totalTokens: 5, estimated: false },
      error: null,
    });
  });

  it("persists a safe transport error while preserving partial output", async () => {
    const persistence = new MessageStreamPersistence(
      database,
      "assistant-1",
      () => "2026-07-17T00:00:02.000Z",
    );
    const result: StreamResult = {
      state: "error",
      reasoningText: "partial thought",
      finalText: "partial answer",
      reasoningSource: "reasoning_content",
      tagState: "final",
      usage: null,
      toolCalls: [],
      contentParts: [{ type: "text", text: "partial answer" }],
      providerContextParts: [],
      reasoningDurationMs: 250,
      startedAt: 0,
      updatedAt: 500,
      error: new ChatTransportError(
        "RATE_LIMITED",
        "raw upstream text must not be stored",
        429,
        "Bearer secret-token",
      ),
    };

    await new ThrottledStreamPersistence(persistence).finish(result);

    const message = await database.messages.get("assistant-1");
    expect(message).toMatchObject({
      status: "error",
      parts: [
        { type: "reasoning", text: "partial thought" },
        { type: "text", text: "partial answer" },
      ],
      error: { code: "RATE_LIMITED", status: 429, retryable: true },
    });
    expect(JSON.stringify(message)).not.toContain("raw upstream text");
    expect(JSON.stringify(message)).not.toContain("secret-token");
  });
});
