"use client";

import { LoaderCircle } from "lucide-react";
import { Dialog } from "radix-ui";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";

interface TextEditDialogProps {
  open: boolean;
  title: string;
  description: string;
  label: string;
  initialValue: string;
  confirmLabel: string;
  secondaryLabel?: string;
  cancelLabel: string;
  pending: boolean;
  error: string | null;
  multiline?: boolean;
  onSubmit: (value: string) => void;
  onSecondarySubmit?: (value: string) => void;
  onOpenChange: (open: boolean) => void;
}

export function TextEditDialog({
  open,
  title,
  description,
  label,
  initialValue,
  confirmLabel,
  secondaryLabel,
  cancelLabel,
  pending,
  error,
  multiline = false,
  onSubmit,
  onSecondarySubmit,
  onOpenChange,
}: TextEditDialogProps) {
  const [value, setValue] = useState(initialValue);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const fieldId = multiline ? "edit-message-content" : "edit-chat-title";
  const fieldProps = {
    autoFocus: true,
    className: "field text-edit-dialog-input",
    disabled: pending,
    id: fieldId,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValue(event.target.value),
    value,
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (pending) return;
        if (!nextOpen) setValue(initialValue);
        onOpenChange(nextOpen);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content
          className="confirm-dialog-panel text-edit-dialog-panel"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = returnFocusRef.current;
            window.requestAnimationFrame(() => {
              if (target?.isConnected) target.focus();
            });
          }}
          onOpenAutoFocus={() => {
            returnFocusRef.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
        >
          <Dialog.Title className="confirm-dialog-title">{title}</Dialog.Title>
          <Dialog.Description className="confirm-dialog-description">
            {description}
          </Dialog.Description>
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (value.trim()) onSubmit(value);
            }}
          >
            <label className="settings-field" htmlFor={fieldId}>
              <span>{label}</span>
              {multiline ? (
                <textarea {...fieldProps} rows={6} />
              ) : (
                <input {...fieldProps} />
              )}
            </label>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="confirm-dialog-actions">
              <Dialog.Close asChild>
                <button
                  className="secondary-button"
                  disabled={pending}
                  type="button"
                >
                  {cancelLabel}
                </button>
              </Dialog.Close>
              {secondaryLabel && onSecondarySubmit ? (
                <button
                  className="secondary-button"
                  disabled={pending || !value.trim()}
                  onClick={() => onSecondarySubmit(value)}
                  type="button"
                >
                  {secondaryLabel}
                </button>
              ) : null}
              <button
                aria-busy={pending}
                className="primary-button"
                disabled={pending || !value.trim()}
                type="submit"
              >
                {pending ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="pending-spinner size-4"
                  />
                ) : null}
                <span>{confirmLabel}</span>
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
