"use client";

import { LoaderCircle } from "lucide-react";
import { AlertDialog } from "radix-ui";
import { useRef, type ReactNode } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  pending?: boolean;
  error?: string | null;
  returnFocus?: HTMLElement | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  pending = false,
  error = null,
  returnFocus = null,
  onConfirm,
  onOpenChange,
}: ConfirmDialogProps) {
  const returnFocusRef = useRef<HTMLElement | null>(null);

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-backdrop" />
        <AlertDialog.Content
          className="confirm-dialog-panel"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = returnFocusRef.current;
            window.requestAnimationFrame(() => {
              if (target?.isConnected) target.focus();
            });
          }}
          onOpenAutoFocus={() => {
            returnFocusRef.current =
              returnFocus ??
              (document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null);
          }}
        >
          <AlertDialog.Title className="confirm-dialog-title">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="confirm-dialog-description">
            {description}
          </AlertDialog.Description>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="confirm-dialog-actions">
            <AlertDialog.Cancel asChild>
              <button
                autoFocus
                className="secondary-button"
                disabled={pending}
                type="button"
              >
                {cancelLabel}
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                aria-busy={pending}
                className={destructive ? "danger-button" : "primary-button"}
                disabled={pending}
                onClick={(event) => {
                  event.preventDefault();
                  onConfirm();
                }}
                type="button"
              >
                {pending ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="pending-spinner size-4"
                  />
                ) : null}
                <span>{confirmLabel}</span>
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
