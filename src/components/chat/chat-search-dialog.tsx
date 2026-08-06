"use client";

import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useTranslation } from "react-i18next";

import type { ChatController } from "@/features/chat/use-chat-controller";

export function SearchDialog({ chat }: { chat: ChatController }) {
  const { t } = useTranslation();
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => !open && chat.setSearchOpen(false)}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content className="search-dialog-panel">
          <header className="search-dialog-header">
            <Dialog.Title>{t("searchChats")}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label={t("close")}
                className="icon-button"
                type="button"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </Dialog.Close>
          </header>
          <input
            autoFocus
            className="field"
            id="chat-search"
            name="chatSearch"
            onChange={(event) => void chat.search(event.target.value)}
            placeholder={t("searchPlaceholder")}
            value={chat.searchQuery}
          />
          <div className="search-results">
            {chat.searchResults.map((result) => (
              <button
                className="search-result"
                key={`${result.conversationId}:${result.messageId ?? "title"}`}
                onClick={() =>
                  void chat.openSearchResult(
                    result.conversationId,
                    result.messageId,
                  )
                }
                type="button"
              >
                <strong>{result.title}</strong>
                <span>{result.snippet}</span>
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
