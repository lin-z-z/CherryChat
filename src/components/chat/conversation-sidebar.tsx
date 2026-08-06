"use client";

import {
  Archive,
  ArrowLeft,
  LoaderCircle,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeft,
  PanelLeftClose,
  RotateCcw,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import { clsx } from "clsx";
import { DropdownMenu } from "radix-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { BrandIcon } from "@/components/chat/brand-icon";
import { ConfirmDialog } from "@/components/chat/confirm-dialog";
import {
  groupConversationsByDate,
  projectRelativeConversationTime,
  type ConversationDateGroup,
  type ConversationDateGroupKey,
} from "@/components/chat/conversation-projections";
import type { ChatController } from "@/features/chat/use-chat-controller";
import { formatUserFacingError } from "@/lib/user-facing-error";
import type { ConversationRecord } from "@/runtime/chat/types";
import { TextTooltip } from "@/components/chat/text-tooltip";
import { TextEditDialog } from "@/components/chat/text-edit-dialog";
import { useNotifications } from "@/components/notifications/notification-provider";

interface ConversationSidebarProps {
  chat: ChatController;
  expanded: boolean;
  mobileOpen: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onMobileOpenChange: (open: boolean) => void;
  onOpenSettings: () => void;
}

interface PendingConversationAction {
  kind: "rename" | "delete";
  conversation: ConversationRecord;
}

export function ConversationSidebar({
  chat,
  expanded,
  mobileOpen,
  onExpandedChange,
  onMobileOpenChange,
  onOpenSettings,
}: ConversationSidebarProps) {
  const { i18n, t } = useTranslation();
  const { notify } = useNotifications();
  const [view, setView] = useState<"active" | "archived">("active");
  const [pendingAction, setPendingAction] =
    useState<PendingConversationAction | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const mobileReturnFocusRef = useRef<HTMLElement | null>(null);
  const previousMobileOpenRef = useRef(mobileOpen);
  const conversationListRef = useRef<HTMLElement>(null);
  const [listEdges, setListEdges] = useState({ top: false, bottom: false });
  const conversations =
    view === "active" ? chat.conversations : chat.archivedConversations;
  const showExpanded = expanded || mobileOpen;
  const now = new Date();
  const conversationGroups = groupConversationsByDate(conversations, now);
  const locale = i18n.resolvedLanguage?.startsWith("zh") ? "zh-CN" : "en";

  const updateListEdges = useCallback(() => {
    const list = conversationListRef.current;
    if (!list) return;
    const next = {
      top: list.scrollTop > 2,
      bottom: list.scrollHeight - list.clientHeight - list.scrollTop > 2,
    };
    setListEdges((current) =>
      current.top === next.top && current.bottom === next.bottom
        ? current
        : next,
    );
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateListEdges);
    window.addEventListener("resize", updateListEdges);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateListEdges);
    };
  }, [conversations, expanded, mobileOpen, updateListEdges, view]);

  useEffect(() => {
    const list = conversationListRef.current;
    if (list) list.scrollTop = 0;
    updateListEdges();
  }, [updateListEdges, view]);

  useEffect(() => {
    const wasOpen = previousMobileOpenRef.current;
    previousMobileOpenRef.current = mobileOpen;
    if (!wasOpen && mobileOpen) setView("active");
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    mobileReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusFrame = window.requestAnimationFrame(() => {
      mobileCloseRef.current?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onMobileOpenChange(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      const target = mobileReturnFocusRef.current;
      window.requestAnimationFrame(() => {
        if (target?.isConnected) target.focus();
      });
    };
  }, [mobileOpen, onMobileOpenChange]);

  const closeMobile = () => onMobileOpenChange(false);
  const run = async (action: () => Promise<void>) => {
    setActionError(null);
    setActionPending(true);
    try {
      await action();
      setPendingAction(null);
      closeMobile();
    } catch (cause) {
      setActionError(formatUserFacingError(cause, t));
    } finally {
      setActionPending(false);
    }
  };

  const createConversation = () => {
    void chat
      .createConversation()
      .then(closeMobile)
      .catch((cause: unknown) =>
        notify({ message: formatUserFacingError(cause, t), tone: "error" }),
      );
  };

  return (
    <>
      {mobileOpen ? (
        <button
          aria-label={t("closeSidebar")}
          className="sidebar-mobile-backdrop"
          onClick={closeMobile}
          type="button"
        />
      ) : null}

      <aside
        aria-label={t("chatHistory")}
        className={clsx("conversation-drawer", {
          collapsed: !showExpanded,
          expanded: showExpanded,
          "mobile-open": mobileOpen,
        })}
      >
        {showExpanded ? (
          <>
            <header className="conversation-drawer-header">
              <div className="conversation-drawer-brand">
                <span className="sidebar-brand-mark">
                  <BrandIcon size={28} />
                </span>
                <h1>{t("appName")}</h1>
              </div>
              <div className="conversation-drawer-header-actions">
                <button
                  aria-label={t("closeSidebar")}
                  className="icon-button conversation-sidebar-toggle"
                  onClick={() => {
                    if (mobileOpen) closeMobile();
                    else onExpandedChange(false);
                  }}
                  ref={mobileCloseRef}
                  type="button"
                >
                  <PanelLeftClose aria-hidden="true" className="size-5" />
                </button>
              </div>
            </header>

            {view === "active" ? (
              <div className="conversation-drawer-actions">
                <button
                  className="drawer-action-button new-chat-button"
                  disabled={!chat.ready}
                  onClick={createConversation}
                  type="button"
                >
                  <MessageSquarePlus aria-hidden="true" className="size-4" />
                  <span className="new-chat-button-label">{t("newChat")}</span>
                </button>
              </div>
            ) : (
              <div className="conversation-subview-header">
                <button
                  aria-label={t("backToChats")}
                  className="icon-button conversation-subview-back"
                  onClick={() => setView("active")}
                  title={t("backToChats")}
                  type="button"
                >
                  <ArrowLeft aria-hidden="true" className="size-4" />
                </button>
                <h2>{t("archivedChats")}</h2>
              </div>
            )}

            {view === "active" ? (
              <div className="conversation-history-heading">
                <span>{t("chatHistory")}</span>
                <TextTooltip content={t("search")}>
                  <button
                    aria-label={t("search")}
                    className="icon-button conversation-history-search"
                    disabled={!chat.ready}
                    onClick={() => chat.setSearchOpen(true)}
                    type="button"
                  >
                    <Search aria-hidden="true" className="size-4" />
                  </button>
                </TextTooltip>
              </div>
            ) : null}

            <div
              className={clsx("conversation-list-shell", {
                "can-scroll-up": listEdges.top,
                "can-scroll-down": listEdges.bottom,
              })}
            >
              <nav
                className="conversation-list"
                onScroll={updateListEdges}
                ref={conversationListRef}
              >
                {conversations.length === 0 ? (
                  <p className="conversation-list-empty">
                    {view === "active"
                      ? t("emptyHistory")
                      : t("emptyArchivedChats")}
                  </p>
                ) : (
                  conversationGroups.map((group, groupIndex) => (
                    <section className="conversation-group" key={group.key}>
                      <h2>{formatConversationGroup(group, locale, t)}</h2>
                      {group.conversations.map((conversation) => (
                        <ConversationItem
                          archived={view === "archived"}
                          conversation={conversation}
                          current={
                            chat.currentConversation?.id === conversation.id
                          }
                          generating={
                            chat.activeGeneration?.conversationId ===
                              conversation.id ||
                            (chat.generationStarting &&
                              chat.currentConversation?.id === conversation.id)
                          }
                          key={conversation.id}
                          locale={locale}
                          now={now}
                          onArchive={() =>
                            void run(() =>
                              chat.archiveConversation(conversation.id),
                            )
                          }
                          onDelete={() => {
                            setActionError(null);
                            setPendingAction({ kind: "delete", conversation });
                          }}
                          onOpen={() =>
                            void chat
                              .loadConversation(conversation.id)
                              .then(closeMobile)
                              .catch((cause: unknown) =>
                                notify({
                                  message: formatUserFacingError(cause, t),
                                  tone: "error",
                                }),
                              )
                          }
                          onRename={() => {
                            setActionError(null);
                            setPendingAction({ kind: "rename", conversation });
                          }}
                          onRestore={() =>
                            void run(() =>
                              chat.restoreConversation(conversation.id),
                            )
                          }
                        />
                      ))}
                      {groupIndex < conversationGroups.length - 1 ? (
                        <span
                          aria-hidden="true"
                          className="conversation-group-gap"
                        />
                      ) : null}
                    </section>
                  ))
                )}
              </nav>
            </div>

            {view === "active" ? (
              <div className="conversation-drawer-secondary-actions">
                <button
                  className="drawer-action-button"
                  disabled={!chat.ready}
                  onClick={() => setView("archived")}
                  type="button"
                >
                  <Archive aria-hidden="true" className="size-4" />
                  <span>{t("archivedChats")}</span>
                </button>
              </div>
            ) : null}

            <footer className="conversation-drawer-footer">
              <button
                className="drawer-settings-button"
                data-settings-trigger
                disabled={!chat.ready}
                onClick={onOpenSettings}
                type="button"
              >
                <Settings aria-hidden="true" className="size-4" />
                <span>{t("settings")}</span>
              </button>
            </footer>
          </>
        ) : (
          <div className="conversation-sidebar-collapsed">
            <TextTooltip content={t("showConversations")}>
              <button
                aria-label={t("showConversations")}
                className="collapsed-sidebar-brand"
                onClick={() => onExpandedChange(true)}
                type="button"
              >
                <span className="sidebar-brand-mark">
                  <BrandIcon size={28} />
                </span>
              </button>
            </TextTooltip>
            <SidebarIconButton
              icon={MessageSquarePlus}
              label={t("newChat")}
              onClick={createConversation}
            />
            <SidebarIconButton
              icon={Search}
              label={t("search")}
              onClick={() => chat.setSearchOpen(true)}
            />
            <div className="collapsed-sidebar-spacer" />
            <SidebarIconButton
              disabled={!chat.ready}
              icon={Settings}
              label={t("settings")}
              onClick={onOpenSettings}
              settingsTrigger
            />
          </div>
        )}
      </aside>

      <TextEditDialog
        cancelLabel={t("cancel")}
        confirmLabel={t("save")}
        description={t("renameConversationPrompt")}
        error={actionError}
        initialValue={pendingAction?.conversation.title ?? ""}
        key={pendingAction?.conversation.id ?? "rename-closed"}
        label={t("chatTitle")}
        onOpenChange={(open) => {
          if (!open && !actionPending) {
            setPendingAction(null);
            setActionError(null);
          }
        }}
        onSubmit={(title) => {
          const target = pendingAction?.conversation;
          if (target) {
            void run(() => chat.renameConversation(target.id, title));
          }
        }}
        open={pendingAction?.kind === "rename"}
        pending={actionPending}
        title={t("rename")}
      />

      <ConfirmDialog
        cancelLabel={t("cancel")}
        confirmLabel={t("delete")}
        description={t("deleteConversationConfirm")}
        destructive
        error={actionError}
        onConfirm={() => {
          const target = pendingAction?.conversation;
          if (target) {
            void run(() => chat.deleteConversation(target.id));
          }
        }}
        onOpenChange={(open) => {
          if (!open && !actionPending) {
            setPendingAction(null);
            setActionError(null);
          }
        }}
        open={pendingAction?.kind === "delete"}
        pending={actionPending}
        title={t("deleteConversationTitle", {
          title: pendingAction?.conversation.title ?? "",
        })}
      />
    </>
  );
}

function ConversationItem({
  conversation,
  current,
  archived,
  generating,
  locale,
  now,
  onOpen,
  onRename,
  onArchive,
  onRestore,
  onDelete,
}: {
  conversation: ConversationRecord;
  current: boolean;
  archived: boolean;
  generating: boolean;
  locale: string;
  now: Date;
  onOpen: () => void;
  onRename: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={clsx("conversation-item", { current })}>
      <button
        aria-label={conversation.title}
        aria-current={current ? "page" : undefined}
        className="conversation-open-button"
        onClick={onOpen}
        type="button"
      >
        <span className="conversation-title">{conversation.title}</span>
        <span aria-hidden="true" className="conversation-row-meta">
          {generating ? (
            <LoaderCircle className="conversation-generation-indicator size-3.5" />
          ) : null}
          <span className="conversation-relative-time">
            {formatConversationRelativeTime(
              conversation.updatedAt,
              now,
              locale,
              t,
            )}
          </span>
        </span>
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            aria-label={t("conversationActions", {
              title: conversation.title,
            })}
            className="conversation-menu-trigger"
            type="button"
          >
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            className="conversation-menu-content"
            sideOffset={6}
          >
            {archived ? (
              <DropdownMenu.Item
                className="conversation-menu-item"
                onSelect={onRestore}
              >
                <RotateCcw aria-hidden="true" className="size-4" />
                {t("restore")}
              </DropdownMenu.Item>
            ) : (
              <>
                <DropdownMenu.Item
                  className="conversation-menu-item"
                  onSelect={onRename}
                >
                  <PanelLeft aria-hidden="true" className="size-4" />
                  {t("rename")}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="conversation-menu-item"
                  onSelect={onArchive}
                >
                  <Archive aria-hidden="true" className="size-4" />
                  {t("archive")}
                </DropdownMenu.Item>
              </>
            )}
            <DropdownMenu.Separator className="conversation-menu-separator" />
            <DropdownMenu.Item
              className="conversation-menu-item danger"
              onSelect={onDelete}
            >
              <Trash2 aria-hidden="true" className="size-4" />
              {t("delete")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

function formatConversationGroup(
  group: ConversationDateGroup,
  locale: string,
  t: TFunction,
): string {
  const labels: Partial<Record<ConversationDateGroupKey, string>> = {
    today: t("conversationGroupToday"),
    yesterday: t("conversationGroupYesterday"),
    previous7Days: t("conversationGroupPrevious7Days"),
    previous30Days: t("conversationGroupPrevious30Days"),
    earlier: t("conversationGroupEarlier"),
  };
  const fixedLabel = labels[group.key];
  if (fixedLabel) return fixedLabel;
  const updatedAt = group.conversations[0]?.updatedAt;
  if (!updatedAt) return t("conversationGroupEarlier");
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
  }).format(new Date(updatedAt));
}

function formatConversationRelativeTime(
  updatedAt: string,
  now: Date,
  locale: string,
  t: TFunction,
): string {
  const projection = projectRelativeConversationTime(new Date(updatedAt), now);
  if (projection.kind === "justNow") return t("conversationUpdatedJustNow");
  if (projection.kind === "minutes") {
    return t("conversationUpdatedMinutes", { count: projection.value });
  }
  if (projection.kind === "hours") {
    return t("conversationUpdatedHours", { count: projection.value });
  }
  if (projection.kind === "days") {
    return t("conversationUpdatedDays", { count: projection.value });
  }
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(projection.date);
}

function SidebarIconButton({
  label,
  icon: Icon,
  onClick,
  disabled = false,
  settingsTrigger = false,
}: {
  label: string;
  icon: typeof Search;
  onClick: () => void;
  disabled?: boolean;
  settingsTrigger?: boolean;
}) {
  return (
    <TextTooltip content={label}>
      <button
        aria-label={label}
        className="collapsed-sidebar-button"
        disabled={disabled}
        {...(settingsTrigger ? { "data-settings-trigger": true } : {})}
        onClick={onClick}
        type="button"
      >
        <Icon aria-hidden="true" className="size-5" />
      </button>
    </TextTooltip>
  );
}
