"use client";

import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useTranslation } from "react-i18next";

import { TextTooltip } from "@/components/chat/text-tooltip";

interface ImagePreviewDialogProps {
  alt: string;
  open: boolean;
  src: string;
  onOpenChange: (open: boolean) => void;
}

export function ImagePreviewDialog({
  alt,
  open,
  src,
  onOpenChange,
}: ImagePreviewDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop image-preview-backdrop" />
        <Dialog.Content className="image-preview-dialog">
          <Dialog.Title className="sr-only">
            {t("viewOriginalImage")}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            {t("imagePreviewDescription")}
          </Dialog.Description>
          <div className="image-preview-actions">
            <TextTooltip content={t("close")}>
              <Dialog.Close asChild>
                <button
                  aria-label={t("close")}
                  className="image-preview-action"
                  type="button"
                >
                  <X aria-hidden="true" className="size-5" />
                </button>
              </Dialog.Close>
            </TextTooltip>
          </div>
          <div className="image-preview-canvas">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={alt} className="image-preview-image" src={src} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
