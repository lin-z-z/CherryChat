"use client";

import {
  Check,
  ChevronDown,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Popover } from "radix-ui";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { AssistantEditorDialog } from "@/components/chat/assistant-editor-dialog";
import { AssistantIcon } from "@/components/chat/assistant-icon";
import { ConfirmDialog } from "@/components/chat/confirm-dialog";
import { TextTooltip } from "@/components/chat/text-tooltip";
import type { ChatController } from "@/features/chat/use-chat-controller";
import {
  createDefaultAssistantSnapshot,
  DEFAULT_ASSISTANT_ID,
  type AssistantRecord,
} from "@/runtime/chat/types";
import type { AssistantInput } from "@/storage/assistant-repository";

interface AssistantSelectorProps {
  chat: Pick<
    ChatController,
    | "assistants"
    | "currentConversation"
    | "selectAssistant"
    | "saveAssistant"
    | "deleteAssistant"
  >;
  disabled: boolean;
}

export function AssistantSelector({ chat, disabled }: AssistantSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AssistantRecord | null | undefined>();
  const [deleting, setDeleting] = useState<AssistantRecord | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const defaultAssistant = chat.assistants.find(
    ({ id }) => id === DEFAULT_ASSISTANT_ID,
  );
  const currentSource = chat.currentConversation
    ? chat.assistants.find(
        ({ id }) => id === chat.currentConversation?.assistantId,
      )
    : defaultAssistant;
  const currentSnapshot =
    chat.currentConversation?.assistantSnapshot ??
    (defaultAssistant
      ? chat.assistants.length > 0
        ? {
            name: defaultAssistant.name,
            icon: defaultAssistant.icon,
            systemPrompt: defaultAssistant.systemPrompt,
          }
        : createDefaultAssistantSnapshot()
      : createDefaultAssistantSnapshot());
  const sourceDeleted = Boolean(chat.currentConversation && !currentSource);
  const triggerLabel = sourceDeleted
    ? t("deletedAssistantLabel", { name: currentSnapshot.name })
    : currentSource?.kind === "default"
      ? t("defaultAssistant")
      : currentSnapshot.name;

  const orderedAssistants = useMemo(
    () => [
      ...chat.assistants.filter(({ kind }) => kind === "default"),
      ...chat.assistants.filter(({ kind }) => kind === "custom"),
    ],
    [chat.assistants],
  );

  const selectAssistant = async (assistantId: string) => {
    setActionError(null);
    setPendingId(assistantId);
    try {
      await chat.selectAssistant(assistantId);
      setOpen(false);
    } catch {
      setActionError(t("assistantSelectError"));
    } finally {
      setPendingId(null);
    }
  };

  const handleOptionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (orderedAssistants.length === 0) return;
    let nextIndex: number | null = null;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = (index + 1) % orderedAssistants.length;
        break;
      case "ArrowUp":
        nextIndex =
          (index - 1 + orderedAssistants.length) % orderedAssistants.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = orderedAssistants.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    optionRefs.current[nextIndex]?.focus();
  };

  const saveAssistant = async (input: AssistantInput) => {
    await chat.saveAssistant(editing?.id ?? null, input);
    setEditing(undefined);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setActionError(null);
    setPendingId(deleting.id);
    try {
      await chat.deleteAssistant(deleting.id);
      setDeleting(null);
    } catch {
      setActionError(t("assistantDeleteError"));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            aria-label={t("selectedAssistant", { assistant: triggerLabel })}
            className="assistant-selector-trigger"
            disabled={disabled}
            type="button"
          >
            <AssistantIcon icon={currentSnapshot.icon} size={16} />
            <span className="assistant-selector-trigger-label">
              {triggerLabel}
            </span>
            <ChevronDown
              aria-hidden="true"
              className="assistant-selector-trigger-chevron"
              size={12}
              strokeWidth={2.5}
            />
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            align="start"
            className="assistant-selector-popover"
            collisionPadding={8}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              optionRefs.current[0]?.focus();
            }}
            sideOffset={4}
          >
            <div className="assistant-selector-heading">
              <span>{t("assistants")}</span>
              <TextTooltip content={t("createAssistant")}>
                <button
                  aria-label={t("createAssistant")}
                  className="icon-button assistant-selector-add"
                  onClick={() => {
                    setEditing(null);
                    setOpen(false);
                  }}
                  type="button"
                >
                  <Plus aria-hidden="true" size={16} />
                </button>
              </TextTooltip>
            </div>

            <div
              aria-label={t("assistants")}
              className="assistant-selector-list"
              role="listbox"
            >
              {orderedAssistants.map((assistant, index) => {
                const selected =
                  assistant.id ===
                  (chat.currentConversation?.assistantId ??
                    DEFAULT_ASSISTANT_ID);
                const label =
                  assistant.kind === "default"
                    ? t("defaultAssistant")
                    : assistant.name;
                return (
                  <div className="assistant-selector-row" key={assistant.id}>
                    <button
                      aria-selected={selected}
                      className="assistant-selector-option"
                      disabled={pendingId !== null}
                      onClick={() => void selectAssistant(assistant.id)}
                      onKeyDown={(event) => handleOptionKeyDown(event, index)}
                      ref={(element) => {
                        optionRefs.current[index] = element;
                      }}
                      role="option"
                      type="button"
                    >
                      <span className="assistant-selector-option-icon">
                        <AssistantIcon icon={assistant.icon} size={16} />
                      </span>
                      <span className="assistant-selector-option-label">
                        {label}
                      </span>
                      {pendingId === assistant.id ? (
                        <LoaderCircle
                          aria-hidden="true"
                          className="pending-spinner size-3.5"
                        />
                      ) : selected ? (
                        <Check aria-hidden="true" size={14} />
                      ) : null}
                    </button>
                    <TextTooltip content={t("editAssistant")}>
                      <button
                        aria-label={t("editAssistantNamed", { name: label })}
                        className="icon-button assistant-selector-action"
                        disabled={pendingId !== null}
                        onClick={() => {
                          setEditing(assistant);
                          setOpen(false);
                        }}
                        type="button"
                      >
                        <Pencil aria-hidden="true" size={14} />
                      </button>
                    </TextTooltip>
                    {assistant.kind === "custom" ? (
                      <TextTooltip content={t("deleteAssistant")}>
                        <button
                          aria-label={t("deleteAssistantNamed", {
                            name: label,
                          })}
                          className="icon-button assistant-selector-action"
                          disabled={pendingId !== null}
                          onClick={() => {
                            setDeleting(assistant);
                            setOpen(false);
                          }}
                          type="button"
                        >
                          <Trash2 aria-hidden="true" size={14} />
                        </button>
                      </TextTooltip>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {actionError ? (
              <p className="form-error assistant-selector-error" role="alert">
                {actionError}
              </p>
            ) : null}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {editing !== undefined ? (
        <AssistantEditorDialog
          assistant={editing}
          key={editing?.id ?? "new-assistant"}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setEditing(undefined);
          }}
          onSave={saveAssistant}
          open
        />
      ) : null}

      <ConfirmDialog
        cancelLabel={t("cancel")}
        confirmLabel={t("deleteAssistant")}
        description={t("deleteAssistantDescription", {
          name: deleting?.name ?? "",
        })}
        destructive
        error={actionError}
        onConfirm={() => void confirmDelete()}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && pendingId === null) setDeleting(null);
        }}
        open={deleting !== null}
        pending={pendingId === deleting?.id}
        title={t("deleteAssistantTitle", { name: deleting?.name ?? "" })}
      />
    </>
  );
}
