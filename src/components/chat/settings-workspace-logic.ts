import type { TFunction } from "i18next";

import type { ChatController } from "@/features/chat/use-chat-controller";

export type PendingConfirmation =
  | { kind: "discard" }
  | { kind: "switchModel"; modelId: string }
  | { kind: "clearChats" }
  | { kind: "clearData" }
  | {
      kind: "import";
      prepared: Awaited<
        ReturnType<ChatController["inspectBackup"]>
      >["prepared"];
      summary: Awaited<ReturnType<ChatController["inspectBackup"]>>["summary"];
    };

export function uniqueModelIds(modelIds: readonly string[]): string[] {
  return Array.from(
    new Set(
      modelIds
        .map((modelId) => modelId.normalize("NFKC").trim())
        .filter(Boolean),
    ),
  );
}

export function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function getConfirmationCopy(
  pending: PendingConfirmation | null,
  t: TFunction,
) {
  switch (pending?.kind) {
    case "discard":
      return {
        title: t("discardChangesTitle"),
        description: t("discardSettingsDraftDescription"),
        confirmLabel: t("discard"),
      };
    case "switchModel":
      return {
        title: t("discardModelChangesTitle"),
        description: t("discardModelChangesDescription"),
        confirmLabel: t("discardAndSwitch"),
      };
    case "clearChats":
      return {
        title: t("clearAllConversations"),
        description: t("clearAllConversationsConfirm"),
        confirmLabel: t("clearAllConversations"),
      };
    case "clearData":
      return {
        title: t("clearLocalData"),
        description: t("clearLocalDataConfirm"),
        confirmLabel: t("clearLocalData"),
      };
    case "import":
      return {
        title: t("importBackup"),
        description: t("importBackupConfirm", {
          conversations: pending.summary.conversations,
          messages: pending.summary.messages,
          attachments: pending.summary.attachments,
        }),
        confirmLabel: t("importBackup"),
      };
    default:
      return {
        title: t("settings"),
        description: "",
        confirmLabel: t("close"),
      };
  }
}
