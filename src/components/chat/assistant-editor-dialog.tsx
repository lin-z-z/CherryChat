"use client";

import { LoaderCircle, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { AssistantIcon } from "@/components/chat/assistant-icon";
import { ConfirmDialog } from "@/components/chat/confirm-dialog";
import {
  ASSISTANT_ICONS,
  DEFAULT_ASSISTANT_ICON,
  DEFAULT_ASSISTANT_NAME,
  type AssistantIcon as AssistantIconName,
  type AssistantRecord,
} from "@/runtime/chat/types";
import type { AssistantInput } from "@/storage/assistant-repository";

const EMPTY_DRAFT: AssistantInput = {
  name: "",
  icon: "sparkles",
  systemPrompt: "",
};

interface AssistantEditorDialogProps {
  open: boolean;
  assistant: AssistantRecord | null;
  onOpenChange: (open: boolean) => void;
  onSave: (input: AssistantInput) => Promise<void>;
}

export function AssistantEditorDialog({
  open,
  assistant,
  onOpenChange,
  onSave,
}: AssistantEditorDialogProps) {
  const { t } = useTranslation();
  const initialDraft: AssistantInput = assistant
    ? {
        name: assistant.name,
        icon: assistant.icon,
        systemPrompt: assistant.systemPrompt,
      }
    : EMPTY_DRAFT;
  const [draft, setDraft] = useState<AssistantInput>(initialDraft);
  const [baseline] = useState<AssistantInput>(initialDraft);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const isDefault = assistant?.kind === "default";
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseline),
    [baseline, draft],
  );

  const requestClose = () => {
    if (pending) return;
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onOpenChange(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) {
      setError(t("assistantNameRequired"));
      return;
    }
    setError(null);
    setPending(true);
    try {
      await onSave({
        name: isDefault ? DEFAULT_ASSISTANT_NAME : name,
        icon: isDefault ? DEFAULT_ASSISTANT_ICON : draft.icon,
        systemPrompt: draft.systemPrompt,
      });
      onOpenChange(false);
    } catch {
      setError(t("assistantSaveError"));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Dialog.Root
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) requestClose();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-backdrop" />
          <Dialog.Content
            className="assistant-editor-dialog"
            onOpenAutoFocus={(event) => {
              if (isDefault) {
                event.preventDefault();
                closeButtonRef.current?.focus();
              }
            }}
          >
            <header className="assistant-editor-header">
              <div>
                <Dialog.Title>
                  {assistant ? t("editAssistant") : t("createAssistant")}
                </Dialog.Title>
                <Dialog.Description>
                  {isDefault
                    ? t("defaultAssistantEditorDescription")
                    : t("assistantEditorDescription")}
                </Dialog.Description>
              </div>
              <button
                aria-label={t("close")}
                className="icon-button assistant-editor-close"
                onClick={requestClose}
                ref={closeButtonRef}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </header>

            <form className="assistant-editor-form" onSubmit={submit}>
              <label className="settings-field" htmlFor="assistant-name">
                <span>{t("assistantName")}</span>
                <input
                  autoFocus={!isDefault}
                  className="field"
                  id="assistant-name"
                  maxLength={80}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  readOnly={isDefault}
                  value={isDefault ? t("defaultAssistant") : draft.name}
                />
              </label>

              <fieldset
                className="assistant-icon-fieldset"
                disabled={isDefault}
              >
                <legend>{t("assistantIcon")}</legend>
                <div className="assistant-icon-options">
                  {ASSISTANT_ICONS.map((icon) => (
                    <button
                      aria-label={t(`assistantIconName.${icon}`)}
                      aria-pressed={draft.icon === icon}
                      className="assistant-icon-option"
                      key={icon}
                      onClick={() =>
                        setDraft((current) => ({ ...current, icon }))
                      }
                      type="button"
                    >
                      <AssistantIcon
                        icon={icon as AssistantIconName}
                        size={18}
                      />
                    </button>
                  ))}
                </div>
              </fieldset>

              <label
                className="settings-field"
                htmlFor="assistant-instructions"
              >
                <span>{t("assistantInstructions")}</span>
                <small>{t("assistantInstructionsDescription")}</small>
                <textarea
                  aria-label={t("assistantInstructions")}
                  className="field assistant-instructions-field"
                  id="assistant-instructions"
                  maxLength={20_000}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      systemPrompt: event.target.value,
                    }))
                  }
                  placeholder={t("assistantInstructionsPlaceholder")}
                  value={draft.systemPrompt}
                />
              </label>

              {error ? (
                <p className="form-error" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="assistant-editor-actions">
                <button
                  className="secondary-button"
                  disabled={pending}
                  onClick={requestClose}
                  type="button"
                >
                  {t("cancel")}
                </button>
                <button
                  aria-busy={pending}
                  className="primary-button"
                  disabled={pending}
                  type="submit"
                >
                  {pending ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="pending-spinner size-4"
                    />
                  ) : null}
                  <span>{t("saveAssistant")}</span>
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        cancelLabel={t("cancel")}
        confirmLabel={t("discard")}
        description={t("discardAssistantDescription")}
        onConfirm={() => {
          setDiscardOpen(false);
          onOpenChange(false);
        }}
        onOpenChange={setDiscardOpen}
        open={discardOpen}
        title={t("discardAssistantTitle")}
      />
    </>
  );
}
