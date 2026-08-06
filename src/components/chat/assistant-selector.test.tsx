import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantSelector } from "@/components/chat/assistant-selector";
import { Providers } from "@/components/providers";
import {
  createDefaultAssistantSnapshot,
  DEFAULT_ASSISTANT_ICON,
  DEFAULT_ASSISTANT_ID,
  DEFAULT_ASSISTANT_NAME,
  type AssistantRecord,
  type ConversationRecord,
} from "@/runtime/chat/types";

const timestamp = "2026-07-20T00:00:00.000Z";
const defaultAssistant: AssistantRecord = {
  id: DEFAULT_ASSISTANT_ID,
  kind: "default",
  name: DEFAULT_ASSISTANT_NAME,
  icon: DEFAULT_ASSISTANT_ICON,
  systemPrompt: "",
  createdAt: timestamp,
  updatedAt: timestamp,
};
const codeAssistant: AssistantRecord = {
  id: "assistant-code",
  kind: "custom",
  name: "Code helper",
  icon: "code",
  systemPrompt: "Review code.",
  createdAt: timestamp,
  updatedAt: timestamp,
};

function conversation(
  assistantId = DEFAULT_ASSISTANT_ID,
  assistantSnapshot = createDefaultAssistantSnapshot(),
): ConversationRecord {
  return {
    id: "conversation-1",
    title: "Chat",
    titleSource: "local",
    archived: false,
    activeLeafId: null,
    activeModelId: "gpt-4.1-mini",
    contextCutoffId: null,
    assistantId,
    assistantSnapshot,
    autoTitle: true,
    webSearchEnabled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function renderSelector(
  overrides: Partial<
    React.ComponentProps<typeof AssistantSelector>["chat"]
  > = {},
) {
  const chat: React.ComponentProps<typeof AssistantSelector>["chat"] = {
    assistants: [defaultAssistant, codeAssistant],
    currentConversation: null,
    selectAssistant: vi.fn(async () => conversation()),
    saveAssistant: vi.fn(async () => codeAssistant),
    deleteAssistant: vi.fn(async () => undefined),
    ...overrides,
  };
  render(
    <Providers initialLanguage="en">
      <AssistantSelector chat={chat} disabled={false} />
    </Providers>,
  );
  return chat;
}

describe("AssistantSelector", () => {
  afterEach(() => cleanup());

  it("shows Default Assistant and selects a custom Assistant", async () => {
    const chat = renderSelector();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Current assistant: Default Assistant",
      }),
    );

    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.click(screen.getByRole("option", { name: /Code helper/u }));

    await waitFor(() =>
      expect(chat.selectAssistant).toHaveBeenCalledWith("assistant-code"),
    );
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("keeps a deleted source identity inspectable from its snapshot", () => {
    renderSelector({
      currentConversation: conversation("deleted-assistant", {
        name: "Old reviewer",
        icon: "book",
        systemPrompt: "Historical prompt",
      }),
    });

    expect(
      screen.getByRole("button", {
        name: "Current assistant: Old reviewer (deleted)",
      }),
    ).toBeInTheDocument();
  });

  it("creates an Assistant through the editor", async () => {
    const chat = renderSelector();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Current assistant: Default Assistant",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create assistant" }));

    fireEvent.change(screen.getByLabelText("Assistant name"), {
      target: { value: "Research helper" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    fireEvent.change(screen.getByLabelText("Response instructions"), {
      target: { value: "Compare sources." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save assistant" }));

    await waitFor(() =>
      expect(chat.saveAssistant).toHaveBeenCalledWith(null, {
        name: "Research helper",
        icon: "code",
        systemPrompt: "Compare sources.",
      }),
    );
  });

  it("asks before discarding a dirty editor", () => {
    renderSelector();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Current assistant: Default Assistant",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create assistant" }));
    fireEvent.change(screen.getByLabelText("Assistant name"), {
      target: { value: "Unsaved" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "Discard assistant changes?",
    );
  });
});
