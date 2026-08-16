"use client";

import {
  AlertCircle,
  Archive,
  ChevronLeft,
  ChevronRight,
  Copy,
  Globe2,
  ImagePlus,
  LoaderCircle,
  Pencil,
  RotateCcw,
  Save,
  SendHorizontal,
  UserRound,
  X,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { BrandIcon } from "@/components/chat/brand-icon";
import { TextTooltip } from "@/components/chat/text-tooltip";
import { MessageMarkdown } from "@/components/message-markdown";
import { useNotifications } from "@/components/notifications/notification-provider";
import type { ChatController } from "@/features/chat/use-chat-controller";
import { cn } from "@/lib/cn";
import { formatUserFacingError } from "@/lib/user-facing-error";
import { textFromMessage } from "@/runtime/chat/projections";
import type { ToolCallPart } from "@/runtime/chat/types";
import { WEB_SEARCH_TOOL_NAME } from "@/runtime/tools/web-search-client";
import { projectWebSearchTool } from "@/runtime/tools/tool-projections";

export function MessageView({
  chat,
  message,
}: {
  chat: ChatController;
  message: ChatController["path"][number];
}) {
  const { t } = useTranslation();
  const { notify } = useNotifications();
  const editFieldId = useId();
  const editTriggerRef = useRef<HTMLButtonElement>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const siblings = chat.allMessages
    .filter((candidate) => candidate.parentId === message.parentId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const versionIndex = siblings.findIndex(({ id }) => id === message.id);
  const text = textFromMessage(message);
  const reasoning = message.parts.find((part) => part.type === "reasoning");
  const imageGeneration = message.parts.find(
    (part) => part.type === "image_generation",
  );
  const generationBusy =
    chat.generationStarting ||
    Boolean(chat.stream) ||
    chat.imageGenerationStarting ||
    Boolean(chat.activeImageGeneration);
  const isLive = Boolean(
    message.role === "assistant" &&
    (message.status === "pending" || message.status === "streaming") &&
    chat.activeGeneration?.conversationId === message.conversationId &&
    chat.activeGeneration.assistantMessageId === message.id,
  );
  const visibleText = isLive ? (chat.stream?.finalText ?? "") : text;
  const visibleReasoning = isLive
    ? (chat.stream?.reasoningText ?? "")
    : (reasoning?.text ?? "");
  const duration = isLive
    ? chat.stream?.reasoningDurationMs
    : reasoning?.durationMs;
  const contentParts = isLive
    ? (chat.stream?.contentParts ?? [])
    : message.parts.filter(
        (part) => part.type === "text" || part.type === "tool_call",
      );
  const pendingToolCalls = isLive ? (chat.stream?.toolCalls ?? []) : [];

  const startEditing = () => {
    setEditDraft(text);
    setEditError(null);
    setEditOpen(true);
  };

  const closeEditor = () => {
    setEditOpen(false);
    window.requestAnimationFrame(() => {
      const trigger = editTriggerRef.current;
      if (trigger?.isConnected) trigger.focus();
    });
  };

  const cancelEditing = () => {
    if (editPending) return;
    setEditDraft(text);
    setEditError(null);
    closeEditor();
  };

  const submitEdit = async (regenerate: boolean) => {
    if (editPending || !editDraft.trim()) return;
    if (!regenerate && editDraft === text) {
      cancelEditing();
      return;
    }

    setEditError(null);
    setEditPending(true);
    try {
      if (regenerate) {
        await (editDraft === text
          ? chat.generateUserMessage(message.id)
          : chat.editAndRegenerate(message.id, editDraft));
      } else {
        await chat.editMessage(message.id, editDraft);
      }
      closeEditor();
    } catch (cause) {
      setEditError(formatUserFacingError(cause, t));
    } finally {
      setEditPending(false);
    }
  };

  return (
    <article
      className={cn(
        message.role === "user" ? "message-user" : "message-assistant",
        message.role === "user" && editOpen && "is-editing",
      )}
    >
      {message.role === "assistant" ? (
        <div className="assistant-mark">
          <BrandIcon size={32} />
        </div>
      ) : null}
      <div
        className={cn(
          "message-body",
          message.role === "user"
            ? "message-user-stack"
            : "message-assistant-stack",
        )}
      >
        <div
          className={cn(
            "message-bubble",
            message.role === "user" && editOpen && "message-bubble-editing",
          )}
        >
          {message.role === "user" && editOpen ? (
            <form
              className="message-inline-editor"
              onSubmit={(event) => {
                event.preventDefault();
                void submitEdit(true);
              }}
            >
              <label className="sr-only" htmlFor={editFieldId}>
                {t("messageContent")}
              </label>
              <textarea
                aria-invalid={Boolean(editError)}
                autoFocus
                className="field message-inline-editor-input"
                disabled={editPending}
                id={editFieldId}
                onChange={(event) => setEditDraft(event.target.value)}
                rows={4}
                value={editDraft}
              />
              {editError ? (
                <p
                  className="form-error message-inline-editor-error"
                  role="alert"
                >
                  {editError}
                </p>
              ) : null}
              <div className="message-inline-editor-actions">
                <button
                  className="secondary-button"
                  disabled={editPending}
                  onClick={cancelEditing}
                  type="button"
                >
                  <X aria-hidden="true" className="size-4" />
                  <span>{t("cancel")}</span>
                </button>
                <button
                  className="secondary-button"
                  disabled={editPending || !editDraft.trim()}
                  onClick={() => void submitEdit(false)}
                  type="button"
                >
                  <Save aria-hidden="true" className="size-4" />
                  <span>{t("saveOnly")}</span>
                </button>
                <button
                  aria-busy={editPending}
                  className="primary-button"
                  disabled={editPending || !editDraft.trim()}
                  type="submit"
                >
                  {editPending ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="pending-spinner size-4"
                    />
                  ) : (
                    <SendHorizontal aria-hidden="true" className="size-4" />
                  )}
                  <span>{t("saveAndSend")}</span>
                </button>
              </div>
            </form>
          ) : (
            <>
              {visibleReasoning ? (
                <details
                  className="reasoning-panel"
                  open={isLive && chat.stream?.state === "reasoning"}
                >
                  <summary>
                    {isLive
                      ? t("thinking")
                      : t("thoughtFor", {
                          seconds: Math.max(
                            0,
                            Math.round((duration ?? 0) / 1000),
                          ),
                        })}
                  </summary>
                  <p>{visibleReasoning}</p>
                </details>
              ) : null}
              {contentParts.map((part, index) =>
                part.type === "text" ? (
                  <MessageMarkdown
                    content={part.text}
                    key={`text-${index}`}
                    streaming={isLive && index === contentParts.length - 1}
                  />
                ) : (
                  <ToolActivity
                    key={part.id}
                    parts={[part]}
                    pendingNames={[]}
                  />
                ),
              )}
              <ToolActivity
                parts={[]}
                pendingNames={pendingToolCalls.map(({ name }) => name)}
              />
              {imageGeneration &&
              message.status === "pending" &&
              chat.activeImageGeneration?.assistantMessageId === message.id ? (
                <div
                  aria-label={t("generatingImage")}
                  className="image-generation-pending"
                  role="status"
                >
                  <LoaderCircle
                    aria-hidden="true"
                    className="pending-spinner size-4"
                  />
                  <span>{t("generatingImage")}</span>
                </div>
              ) : contentParts.length === 0 && isLive ? (
                <div aria-label={t("generating")} className="typing-indicator">
                  <span />
                  <span />
                  <span />
                </div>
              ) : contentParts.length === 0 &&
                message.role === "assistant" &&
                message.status !== "error" &&
                (!imageGeneration || message.status === "stopped") ? (
                <p className="terminal-message-state">
                  {message.status === "stopped"
                    ? t("generationStopped")
                    : t("emptyResponse")}
                </p>
              ) : null}
              {message.role === "assistant" && message.status === "error" ? (
                <div className="message-error-card" role="alert">
                  <AlertCircle aria-hidden="true" className="size-4" />
                  <div>
                    <strong>{t("generationFailed")}</strong>
                    <span>
                      {message.error
                        ? t(`chatError.${message.error.code}`)
                        : t("unknownError")}
                    </span>
                  </div>
                  <button
                    disabled={generationBusy}
                    onClick={() =>
                      void chat
                        .regenerateAssistant(message.id)
                        .catch((cause: unknown) =>
                          notify({
                            message: formatUserFacingError(cause, t),
                            tone: "error",
                          }),
                        )
                    }
                    type="button"
                  >
                    <RotateCcw aria-hidden="true" className="size-3.5" />
                    <span>{t("regenerate")}</span>
                  </button>
                </div>
              ) : null}
              <div className="message-attachments">
                {message.parts
                  .filter((part) => part.type === "image_ref")
                  .map((part) => (
                    <div className="message-image" key={part.attachmentId}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt={part.alt ?? t("attachedImage")}
                        src={chat.attachmentUrls[part.attachmentId]}
                      />
                      {message.role === "assistant" && imageGeneration ? (
                        <TextTooltip content={t("useAsImageReference")}>
                          <button
                            aria-label={t("useAsImageReference")}
                            className="message-image-reference-button"
                            disabled={generationBusy}
                            onClick={() =>
                              void chat
                                .addStoredImageReference(part.attachmentId)
                                .then(() =>
                                  notify({
                                    message: t("imageReferenceAdded"),
                                    tone: "success",
                                  }),
                                )
                                .catch((cause: unknown) =>
                                  notify({
                                    message: formatUserFacingError(cause, t),
                                    tone: "error",
                                  }),
                                )
                            }
                            type="button"
                          >
                            <ImagePlus aria-hidden="true" className="size-4" />
                          </button>
                        </TextTooltip>
                      ) : null}
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>
        {message.role === "assistant" && message.modelSnapshot ? (
          <p className="message-model-label">
            {t("responseModel", { model: message.modelSnapshot.modelId })}
          </p>
        ) : null}
        {message.role === "assistant" && imageGeneration ? (
          <p className="message-model-label">
            {t("imageGenerationSnapshot", {
              model: imageGeneration.profileName ?? imageGeneration.modelId,
              size: imageGeneration.size,
              quality: t(`imageQuality${capitalize(imageGeneration.quality)}`),
              format: (imageGeneration.outputFormat ?? "png").toUpperCase(),
            })}
          </p>
        ) : null}
        {!editOpen ? (
          <div className="message-actions">
            {visibleText ? (
              <TextTooltip content={t("copy")}>
                <button
                  aria-label={t("copy")}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(visibleText)
                      .then(() =>
                        notify({ message: t("copied"), tone: "success" }),
                      )
                      .catch(() =>
                        notify({ message: t("copyError"), tone: "error" }),
                      )
                  }
                  type="button"
                >
                  <Copy aria-hidden="true" className="size-3.5" />
                </button>
              </TextTooltip>
            ) : null}
            {message.role === "user" ? (
              <>
                <TextTooltip content={t("edit")}>
                  <button
                    aria-label={t("edit")}
                    disabled={generationBusy}
                    onClick={startEditing}
                    ref={editTriggerRef}
                    type="button"
                  >
                    <Pencil aria-hidden="true" className="size-3.5" />
                  </button>
                </TextTooltip>
                {chat.currentConversation?.activeLeafId === message.id ? (
                  <TextTooltip content={t("sendEditedMessage")}>
                    <button
                      aria-label={t("sendEditedMessage")}
                      disabled={generationBusy}
                      onClick={() =>
                        void chat
                          .generateUserMessage(message.id)
                          .catch((cause: unknown) =>
                            notify({
                              message: formatUserFacingError(cause, t),
                              tone: "error",
                            }),
                          )
                      }
                      type="button"
                    >
                      <SendHorizontal aria-hidden="true" className="size-3.5" />
                    </button>
                  </TextTooltip>
                ) : null}
              </>
            ) : message.status !== "error" ? (
              <TextTooltip content={t("regenerate")}>
                <button
                  aria-label={t("regenerate")}
                  disabled={generationBusy}
                  onClick={() =>
                    void chat
                      .regenerateAssistant(message.id)
                      .catch((cause: unknown) =>
                        notify({
                          message: formatUserFacingError(cause, t),
                          tone: "error",
                        }),
                      )
                  }
                  type="button"
                >
                  <RotateCcw aria-hidden="true" className="size-3.5" />
                </button>
              </TextTooltip>
            ) : null}
            <TextTooltip content={t("clearContextHere")}>
              <button
                aria-label={t("clearContextHere")}
                onClick={() => void chat.setContextCutoff(message.id)}
                type="button"
              >
                <Archive aria-hidden="true" className="size-3.5" />
              </button>
            </TextTooltip>
            {siblings.length > 1 ? (
              <span className="message-version-controls">
                <TextTooltip content={t("previousVersion")}>
                  <button
                    aria-label={t("previousVersion")}
                    disabled={versionIndex <= 0}
                    onClick={() => {
                      const previous = siblings[versionIndex - 1];
                      if (previous) void chat.selectVersion(previous.id);
                    }}
                    type="button"
                  >
                    <ChevronLeft aria-hidden="true" className="size-3.5" />
                  </button>
                </TextTooltip>
                {versionIndex + 1}/{siblings.length}
                <TextTooltip content={t("nextVersion")}>
                  <button
                    aria-label={t("nextVersion")}
                    disabled={versionIndex >= siblings.length - 1}
                    onClick={() => {
                      const next = siblings[versionIndex + 1];
                      if (next) void chat.selectVersion(next.id);
                    }}
                    type="button"
                  >
                    <ChevronRight aria-hidden="true" className="size-3.5" />
                  </button>
                </TextTooltip>
              </span>
            ) : null}
            {message.usage ? (
              <span className="message-usage">
                {message.usage.estimated ? t("approximately") : ""}
                {message.usage.totalTokens ?? 0} {t("tokens")}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {message.role === "user" ? (
        <div aria-hidden="true" className="user-mark">
          <UserRound size={17} strokeWidth={2.1} />
        </div>
      ) : null}
    </article>
  );
}

function ToolActivity({
  parts,
  pendingNames,
}: {
  parts: readonly ToolCallPart[];
  pendingNames: readonly string[];
}) {
  const { t } = useTranslation();
  const visiblePending = pendingNames.filter(Boolean);
  if (parts.length === 0 && visiblePending.length === 0) return null;

  return (
    <div className="tool-activity-list">
      {visiblePending.map((name, index) => (
        <div
          className="tool-activity-row is-running"
          key={`${name}-${index}`}
          role="status"
        >
          <Globe2 aria-hidden="true" size={15} />
          <span>
            {name === WEB_SEARCH_TOOL_NAME ? t("webSearching") : name}
          </span>
        </div>
      ))}
      {parts.map((part) => {
        if (part.status === "running") {
          return (
            <div
              className="tool-activity-row is-running"
              key={part.id}
              role="status"
            >
              <Globe2 aria-hidden="true" size={15} />
              <span>{t("webSearching")}</span>
            </div>
          );
        }
        if (part.status === "error") {
          return (
            <div className="tool-activity-row is-error" key={part.id}>
              <div className="tool-activity-status">
                <Globe2 aria-hidden="true" size={15} />
                <span>{t("webSearchFailed")}</span>
              </div>
              <p>{webSearchErrorMessage(part.errorCode, t)}</p>
            </div>
          );
        }
        const search = projectWebSearchTool(part);
        const label = t("webSearchCompleted", {
          count: search?.results.length ?? 0,
        });
        if (!search?.results.length) {
          return (
            <div className="tool-activity-row is-complete" key={part.id}>
              <Globe2 aria-hidden="true" size={15} />
              <div>
                <span>{label}</span>
                {search?.answer ? <p>{search.answer}</p> : null}
              </div>
            </div>
          );
        }
        return (
          <details className="tool-activity-row" key={part.id}>
            <summary>
              <Globe2 aria-hidden="true" size={15} />
              <span>{label}</span>
              <ChevronRight
                aria-hidden="true"
                className="tool-activity-chevron"
                size={14}
              />
            </summary>
            {search.answer ? <p>{search.answer}</p> : null}
            <ul className="tool-source-list">
              {search.results.map((result) => (
                <li key={result.url}>
                  <a href={result.url} rel="noreferrer" target="_blank">
                    {result.title || result.url}
                  </a>
                  <small>{new URL(result.url).hostname}</small>
                  {result.content ? <p>{result.content}</p> : null}
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

function webSearchErrorMessage(
  code: string | null,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (code) {
    case "TOOL_AUTH_FAILED":
      return t("webSearchAuthFailed");
    case "TOOL_RATE_LIMITED":
      return t("webSearchRateLimited");
    case "TOOL_REQUEST_TIMEOUT":
      return t("webSearchTimedOut");
    case "TOOL_SERVICE_UNAVAILABLE":
      return t("webSearchUnavailable");
    case "TOOL_REQUEST_ABORTED":
      return t("webSearchStopped");
    case "INVALID_TOOL_INPUT":
      return t("webSearchInvalidRequest");
    default:
      return t("webSearchRequestFailed");
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
