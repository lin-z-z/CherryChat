"use client";

import {
  ArrowUp,
  ChevronRight,
  Globe2,
  Image as ImageIcon,
  Menu,
  Plus,
  Square,
  X,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTheme } from "next-themes";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useTranslation } from "react-i18next";

import { BrandIcon } from "@/components/chat/brand-icon";
import { AssistantSelector } from "@/components/chat/assistant-selector";
import { PrintView } from "@/components/chat/chat-print-view";
import { SearchDialog } from "@/components/chat/chat-search-dialog";
import { ConversationSidebar } from "@/components/chat/conversation-sidebar";
import {
  ImageGenerationCompressionControl,
  ImageGenerationParameterControl,
} from "@/components/chat/image-generation-parameter-control";
import { ImageGenerationProfileSelector } from "@/components/chat/image-generation-profile-selector";
import { MessageView } from "@/components/chat/message-view";
import { ModelSelector } from "@/components/chat/model-selector";
import { ReasoningEffortControl } from "@/components/chat/reasoning-effort-control";
import { SettingsWorkspace } from "@/components/chat/settings-workspace";
import { ThemeSwitcher } from "@/components/chat/theme-switcher";
import { TextTooltip } from "@/components/chat/text-tooltip";
import { useNotifications } from "@/components/notifications/notification-provider";
import { persistLanguage } from "@/components/providers";
import {
  type AppTheme,
  useChatController,
} from "@/features/chat/use-chat-controller";
import type { AppLanguage } from "@/i18n/resources";
import { cn } from "@/lib/cn";
import { formatUserFacingError } from "@/lib/user-facing-error";
import type { ConversationExportProjection } from "@/runtime/chat/export-projection";
import { summarizeBranchUsage } from "@/runtime/chat/projections";
import type { ImageGenerationProfile } from "@/runtime/chat/types";
import { resolveImageGenerationCapabilities } from "@/runtime/image-generation/image-generation-options";

const AUTO_FOLLOW_THRESHOLD_PX = 96;

export function ChatShell() {
  const { i18n, t } = useTranslation();
  const { notify } = useNotifications();
  const { resolvedTheme, theme, setTheme } = useTheme();
  const chat = useChatController();
  const [drawerExpanded, setDrawerExpanded] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [printProjection, setPrintProjection] =
    useState<ConversationExportProjection | null>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageReferenceInputRef = useRef<HTMLInputElement>(null);
  const draggedImageReferenceRef = useRef<string | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const [modelSwitchNotice, setModelSwitchNotice] = useState<{
    conversationId: string;
    from: string;
    to: string;
    afterMessageId: string;
  } | null>(null);
  const branchUsage = useMemo(
    () => summarizeBranchUsage(chat.path),
    [chat.path],
  );

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "auto") => {
    const scrollArea = messageScrollRef.current;
    if (!scrollArea) return;
    scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior });
  }, []);

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const maxHeight = Number.parseFloat(
      window.getComputedStyle(textarea).maxHeight,
    );
    const boundedHeight = Math.min(
      textarea.scrollHeight,
      Number.isFinite(maxHeight) ? maxHeight : textarea.scrollHeight,
    );
    textarea.style.height = `${boundedHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > boundedHeight ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(resizeTextarea);
    return () => window.cancelAnimationFrame(frame);
  }, [chat.draft, resizeTextarea]);

  useEffect(() => {
    window.addEventListener("resize", resizeTextarea);
    return () => window.removeEventListener("resize", resizeTextarea);
  }, [resizeTextarea]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setAutoFollow(true);
      scrollToLatest();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [chat.currentConversation?.id, scrollToLatest]);

  useEffect(() => {
    if (!autoFollow) return;
    const frame = window.requestAnimationFrame(() => scrollToLatest());
    return () => window.cancelAnimationFrame(frame);
  }, [
    autoFollow,
    chat.path,
    chat.stream?.finalText,
    chat.stream?.reasoningText,
    modelSwitchNotice,
    scrollToLatest,
  ]);

  useEffect(() => {
    const compactViewport = window.matchMedia("(max-width: 1023px)");
    const collapseForCompactViewport = () => {
      if (compactViewport.matches) setDrawerExpanded(false);
    };
    collapseForCompactViewport();
    compactViewport.addEventListener("change", collapseForCompactViewport);
    return () =>
      compactViewport.removeEventListener("change", collapseForCompactViewport);
  }, []);

  const language: AppLanguage = i18n.resolvedLanguage?.startsWith("zh")
    ? "zh-CN"
    : "en";
  const selectedTheme: AppTheme =
    theme === "light" || theme === "dark" ? theme : "system";
  const generationBusy =
    chat.generationStarting ||
    Boolean(chat.stream) ||
    chat.imageGenerationStarting ||
    Boolean(chat.activeImageGeneration);
  const imageMode = chat.composerMode === "image";
  const supportsImageInput = Boolean(
    chat.capability?.modelId === chat.connection.modelId &&
    chat.capability.vision,
  );
  const canAttachImages =
    chat.ready &&
    chat.online &&
    !generationBusy &&
    (imageMode || supportsImageInput);
  const imageGenerationAvailable =
    chat.connection.mode === "hosted"
      ? chat.imageGenerationProfiles.length > 0
      : Boolean(chat.activeImageGenerationProfile?.hasApiKey);
  const webSearchButtonDisabled =
    generationBusy || (!chat.webSearchAvailable && !chat.webSearchEnabled);
  const webSearchTooltipContent = chat.webSearchEnabled
    ? t("disableWebSearchForChat")
    : !chat.webSearchConfig.enabled || !chat.webSearchSource
      ? chat.publicConfig?.hostedWebSearchEnabled &&
        !chat.publicConfig.authenticated &&
        !chat.webSearchConfig.hasApiKey
        ? t("authenticateWebSearchFirst")
        : t("configureWebSearchFirst")
      : chat.webSearchAvailable
        ? t("enableWebSearchForChat")
        : t("webSearchUnsupportedModel");
  const closeSettings = () => {
    chat.setSettingsOpen(false);
    window.requestAnimationFrame(() => {
      const visibleTrigger = Array.from(
        document.querySelectorAll<HTMLButtonElement>("[data-settings-trigger]"),
      ).find((trigger) => {
        const rect = trigger.getBoundingClientRect();
        return (
          !trigger.disabled &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.left < window.innerWidth &&
          rect.top < window.innerHeight
        );
      });
      const fallback = document.querySelector<HTMLButtonElement>(
        "[data-sidebar-trigger]",
      );
      (visibleTrigger ?? fallback)?.focus();
    });
  };

  if (printProjection) {
    return (
      <main className="bg-background text-foreground min-h-dvh">
        <PrintView
          attachmentUrls={chat.attachmentUrls}
          onClose={() => setPrintProjection(null)}
          projection={printProjection}
        />
      </main>
    );
  }

  if (chat.settingsOpen) {
    return (
      <SettingsWorkspace
        chat={chat}
        language={language}
        onApplyGeneral={async (nextLanguage, nextTheme) => {
          persistLanguage(nextLanguage);
          await i18n.changeLanguage(nextLanguage);
          setTheme(nextTheme);
        }}
        onClose={closeSettings}
        onPrint={(projection) => {
          chat.setSettingsOpen(false);
          setPrintProjection(projection);
        }}
        theme={selectedTheme}
      />
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!chat.ready) return;
    if (!chat.online) {
      notify({ message: t("offline"), tone: "error" });
      return;
    }
    setAutoFollow(true);
    void chat
      .send()
      .catch((cause: unknown) =>
        notify({ message: formatUserFacingError(cause, t), tone: "error" }),
      );
  };

  return (
    <main className="app-shell">
      <ConversationSidebar
        chat={chat}
        expanded={drawerExpanded}
        mobileOpen={mobileSidebarOpen}
        onExpandedChange={setDrawerExpanded}
        onMobileOpenChange={setMobileSidebarOpen}
        onOpenSettings={() => {
          setMobileSidebarOpen(false);
          chat.setSettingsOpen(true);
        }}
      />

      <section className="chat-workspace" inert={mobileSidebarOpen}>
        <header className="chat-topbar">
          <button
            aria-label={t("openSidebar")}
            className="icon-button chat-mobile-menu"
            data-sidebar-trigger
            onClick={() => setMobileSidebarOpen(true)}
            type="button"
          >
            <Menu aria-hidden="true" className="size-5" />
          </button>
          <AssistantSelector
            chat={chat}
            disabled={!chat.ready || generationBusy}
          />
          {imageMode ? (
            <ImageGenerationProfileSelector
              disabled={
                !chat.ready ||
                generationBusy ||
                chat.imageGenerationProfiles.length === 0
              }
              onValueChange={(profileId) =>
                void chat
                  .selectImageGenerationProfile(profileId)
                  .catch((cause: unknown) =>
                    notify({
                      message: formatUserFacingError(cause, t),
                      tone: "error",
                    }),
                  )
              }
              profiles={chat.imageGenerationProfiles}
              value={chat.activeImageGenerationProfile?.id ?? ""}
            />
          ) : (
            <ModelSelector
              disabled={!chat.ready || generationBusy}
              models={chat.models}
              onValueChange={(modelId) => {
                if (modelId === chat.connection.modelId) return;
                const afterMessageId = chat.path.at(-1)?.id;
                void chat
                  .selectModel(modelId)
                  .then((notice) =>
                    notice && afterMessageId
                      ? setModelSwitchNotice({ ...notice, afterMessageId })
                      : setModelSwitchNotice(null),
                  )
                  .catch((cause: unknown) =>
                    notify({
                      message: formatUserFacingError(cause, t),
                      tone: "error",
                    }),
                  );
              }}
              value={chat.connection.modelId}
            />
          )}
          <span className="chat-topbar-spacer" />
          <ThemeSwitcher
            onValueChange={setTheme}
            resolvedTheme={resolvedTheme}
            value={selectedTheme}
          />
        </header>

        <div
          className={cn(
            "chat-stage",
            chat.path.length === 0 && "chat-stage-empty",
          )}
        >
          <div
            className="message-scroll-area"
            onScroll={(event) => {
              const scrollArea = event.currentTarget;
              const distanceFromBottom =
                scrollArea.scrollHeight -
                scrollArea.clientHeight -
                scrollArea.scrollTop;
              setAutoFollow(distanceFromBottom <= AUTO_FOLLOW_THRESHOLD_PX);
            }}
            ref={messageScrollRef}
          >
            {chat.path.length === 0 ? (
              <div className="chat-empty-state">
                <h1>
                  <span className="chat-empty-mark">
                    <BrandIcon size={40} />
                  </span>
                  <span>{t("welcomeTitle")}</span>
                </h1>
              </div>
            ) : (
              <div className="message-column">
                {chat.path.map((message) => (
                  <Fragment key={message.id}>
                    <MessageView chat={chat} message={message} />
                    {chat.currentConversation?.contextCutoffId ===
                    message.id ? (
                      <div className="context-divider">
                        <span>{t("contextCleared")}</span>
                      </div>
                    ) : null}
                    {modelSwitchNotice &&
                    modelSwitchNotice.conversationId ===
                      message.conversationId &&
                    modelSwitchNotice.afterMessageId === message.id ? (
                      <div
                        aria-live="polite"
                        className="model-switch-divider"
                        role="status"
                      >
                        <span>
                          {t("modelSwitched", {
                            from: modelSwitchNotice.from,
                            to: modelSwitchNotice.to,
                          })}
                        </span>
                      </div>
                    ) : null}
                  </Fragment>
                ))}
                {branchUsage.messageCount > 0 ? (
                  <div className="branch-usage">
                    {t("branchUsage", {
                      count: branchUsage.totalTokens ?? 0,
                      messages: branchUsage.messageCount,
                    })}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="composer-region">
            {!autoFollow && chat.path.length > 0 ? (
              <button
                aria-label={t("jumpToLatest")}
                className="jump-to-latest"
                onClick={() => {
                  setAutoFollow(true);
                  scrollToLatest("smooth");
                }}
                type="button"
              >
                <ChevronRight aria-hidden="true" className="size-4 rotate-90" />
                <span>{t("jumpToLatest")}</span>
              </button>
            ) : null}
            {chat.error ? (
              <div className="chat-error" role="alert">
                <span>{chat.error}</span>
                <button
                  aria-label={t("dismiss")}
                  onClick={() => chat.setError(null)}
                  type="button"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </div>
            ) : null}
            {chat.storageDegraded ? (
              <div className="storage-warning" role="status">
                {t("storageDegraded")}
              </div>
            ) : null}
            {!chat.online ? (
              <p className="offline-note" role="status">
                {t("offline")}
              </p>
            ) : null}
            <form className="composer" onSubmit={submit}>
              {supportsImageInput && !imageMode ? (
                <input
                  accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
                  hidden
                  multiple
                  name="images"
                  onChange={(event) => {
                    const files = [...(event.target.files ?? [])];
                    void chat.addImages(files).catch((cause: unknown) =>
                      notify({
                        message: imageUploadError(cause, t),
                        tone: "error",
                      }),
                    );
                    event.target.value = "";
                  }}
                  ref={imageInputRef}
                  type="file"
                />
              ) : null}
              {imageMode ? (
                <input
                  accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
                  hidden
                  multiple
                  name="image-references"
                  onChange={(event) => {
                    const files = [...(event.target.files ?? [])];
                    void chat
                      .addImageReferences(files)
                      .catch((cause: unknown) =>
                        notify({
                          message: imageUploadError(cause, t),
                          tone: "error",
                        }),
                      );
                    event.target.value = "";
                  }}
                  ref={imageReferenceInputRef}
                  type="file"
                />
              ) : null}
              <div className="composer-frame" id="message-input-container">
                {(
                  imageMode
                    ? chat.imageReferences.length > 0
                    : chat.pendingAttachments.length > 0
                ) ? (
                  <div className="attachment-preview-row">
                    {(imageMode
                      ? chat.imageReferences
                      : chat.pendingAttachments
                    ).map((attachment, index) => (
                      <div
                        aria-label={
                          imageMode
                            ? t("imageReferencePosition", { index: index + 1 })
                            : undefined
                        }
                        className={cn(
                          "preview-chip",
                          imageMode && "image-reference-chip",
                        )}
                        draggable={imageMode}
                        key={attachment.id}
                        onDragEnd={() => {
                          draggedImageReferenceRef.current = null;
                        }}
                        onDragOver={(event) => {
                          if (imageMode) event.preventDefault();
                        }}
                        onDragStart={() => {
                          draggedImageReferenceRef.current = attachment.id;
                        }}
                        onDrop={(event) => {
                          if (!imageMode) return;
                          event.preventDefault();
                          const sourceId = draggedImageReferenceRef.current;
                          if (sourceId) {
                            chat.reorderImageReferences(
                              sourceId,
                              attachment.id,
                            );
                          }
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          alt={
                            imageMode
                              ? t("imageReferencePosition", {
                                  index: index + 1,
                                })
                              : t("imagePreview")
                          }
                          src={chat.attachmentUrls[attachment.id]}
                        />
                        {imageMode ? (
                          <span className="image-reference-index">
                            {index + 1}
                          </span>
                        ) : null}
                        <button
                          aria-label={t("removeImage")}
                          className="preview-remove"
                          onClick={() =>
                            imageMode
                              ? chat.removeImageReference(attachment.id)
                              : chat.removePendingAttachment(attachment.id)
                          }
                          type="button"
                        >
                          <X aria-hidden="true" className="size-3" />
                        </button>
                      </div>
                    ))}
                    {imageMode ? (
                      <span className="image-reference-count">
                        {t("imageReferenceCount", {
                          count: chat.imageReferences.length,
                        })}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <div
                  className="composer-input-shell"
                  onDragOver={(event) => {
                    if (
                      imageMode &&
                      event.dataTransfer.types.includes("Files")
                    ) {
                      event.preventDefault();
                    }
                  }}
                  onDrop={(event) => {
                    if (!imageMode || !event.dataTransfer.files.length) return;
                    event.preventDefault();
                    void chat
                      .addImageReferences([...event.dataTransfer.files])
                      .catch((cause: unknown) =>
                        notify({
                          message: imageUploadError(cause, t),
                          tone: "error",
                        }),
                      );
                  }}
                >
                  <textarea
                    aria-label={
                      imageMode
                        ? t("imageComposerPlaceholder")
                        : t("composerPlaceholder")
                    }
                    className="composer-textarea"
                    disabled={!chat.ready || !chat.online || generationBusy}
                    name="message"
                    onChange={(event) => chat.setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.nativeEvent.isComposing ||
                        event.nativeEvent.keyCode === 229
                      ) {
                        return;
                      }
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    onPaste={(event) => {
                      const files = [...event.clipboardData.items]
                        .filter(
                          (item) =>
                            item.kind === "file" &&
                            item.type.startsWith("image/"),
                        )
                        .map((item) => item.getAsFile())
                        .filter((file): file is File => file !== null);
                      if (files.length > 0 && canAttachImages) {
                        event.preventDefault();
                        void (
                          imageMode
                            ? chat.addImageReferences(files)
                            : chat.addImages(files)
                        ).catch((cause: unknown) =>
                          notify({
                            message: imageUploadError(cause, t),
                            tone: "error",
                          }),
                        );
                      }
                    }}
                    placeholder={
                      imageMode
                        ? t("imageComposerPlaceholder")
                        : t("composerPlaceholder")
                    }
                    ref={textareaRef}
                    rows={1}
                    value={chat.draft}
                  />
                </div>
                <div
                  className={cn(
                    "composer-action-row",
                    imageMode && "is-image-mode",
                  )}
                >
                  <div className="composer-toolbar-left">
                    <div className="composer-mode-toggle" role="group">
                      <button
                        aria-pressed={!imageMode}
                        className={cn(
                          "composer-mode-button",
                          !imageMode && "is-active",
                        )}
                        disabled={generationBusy}
                        onClick={() => chat.setComposerMode("chat")}
                        type="button"
                      >
                        {t("chatMode")}
                      </button>
                      <button
                        aria-pressed={imageMode}
                        className={cn(
                          "composer-mode-button",
                          imageMode && "is-active",
                        )}
                        disabled={generationBusy}
                        onClick={() => chat.setComposerMode("image")}
                        type="button"
                      >
                        <ImageIcon aria-hidden="true" className="size-4" />
                        {t("imageMode")}
                      </button>
                    </div>
                    {imageMode || supportsImageInput ? (
                      <TextTooltip content={t("addImage")}>
                        <button
                          aria-label={t("addImage")}
                          className="composer-tool-button"
                          disabled={!canAttachImages}
                          onClick={() =>
                            imageMode
                              ? imageReferenceInputRef.current?.click()
                              : imageInputRef.current?.click()
                          }
                          type="button"
                        >
                          <Plus aria-hidden="true" className="size-5" />
                        </button>
                      </TextTooltip>
                    ) : null}
                    {!imageMode ? (
                      <TextTooltip content={webSearchTooltipContent}>
                        <span
                          className="composer-tooltip-trigger"
                          {...(webSearchButtonDisabled
                            ? {
                                "aria-label": webSearchTooltipContent,
                                role: "note",
                                tabIndex: 0,
                              }
                            : {})}
                        >
                          <button
                            aria-label={
                              chat.webSearchEnabled
                                ? t("disableWebSearchForChat")
                                : t("enableWebSearchForChat")
                            }
                            aria-pressed={chat.webSearchEnabled}
                            className={cn(
                              "composer-tool-button",
                              chat.webSearchEnabled && "is-active",
                            )}
                            disabled={webSearchButtonDisabled}
                            onClick={() =>
                              void chat
                                .setConversationWebSearch(
                                  !chat.webSearchEnabled,
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
                            <Globe2 aria-hidden="true" className="size-5" />
                          </button>
                        </span>
                      </TextTooltip>
                    ) : null}
                  </div>
                  <div className="composer-toolbar-right">
                    {imageMode ? (
                      <>
                        <ImageGenerationParameterControl
                          ariaLabel={t("imageGenerationResolution")}
                          disabled={generationBusy}
                          onValueChange={(value) =>
                            chat.setImageGenerationParameters({
                              resolutionTier: value as
                                "auto" | "1K" | "2K" | "4K",
                            })
                          }
                          options={resolveResolutionOptions(
                            chat.activeImageGenerationProfile,
                          ).map((value) => ({ value, label: value }))}
                          value={chat.imageGenerationParameters.resolutionTier}
                        />
                        <ImageGenerationParameterControl
                          ariaLabel={t("imageGenerationAspectRatio")}
                          disabled={generationBusy}
                          onValueChange={(value) =>
                            chat.setImageGenerationParameters({
                              aspectRatio:
                                value as typeof chat.imageGenerationParameters.aspectRatio,
                            })
                          }
                          options={resolveAspectRatioOptions(
                            chat.activeImageGenerationProfile,
                          ).map((value) => ({ value, label: value }))}
                          value={chat.imageGenerationParameters.aspectRatio}
                        />
                        <ImageGenerationParameterControl
                          ariaLabel={t("imageGenerationQuality")}
                          disabled={generationBusy}
                          onValueChange={(value) =>
                            chat.setImageGenerationParameters({
                              quality:
                                value as typeof chat.imageGenerationParameters.quality,
                            })
                          }
                          options={[
                            { value: "auto", label: t("imageQualityAuto") },
                            { value: "low", label: t("imageQualityLow") },
                            { value: "medium", label: t("imageQualityMedium") },
                            { value: "high", label: t("imageQualityHigh") },
                          ]}
                          value={chat.imageGenerationParameters.quality}
                        />
                        <ImageGenerationParameterControl
                          ariaLabel={t("imageGenerationOutputFormat")}
                          disabled={generationBusy}
                          onValueChange={(value) =>
                            chat.setImageGenerationParameters({
                              outputFormat: value as "png" | "jpeg" | "webp",
                              outputCompression:
                                value === "png"
                                  ? null
                                  : (chat.imageGenerationParameters
                                      .outputCompression ?? 100),
                            })
                          }
                          options={[
                            { value: "png", label: "PNG" },
                            { value: "jpeg", label: "JPEG" },
                            { value: "webp", label: "WebP" },
                          ]}
                          value={chat.imageGenerationParameters.outputFormat}
                        />
                        {chat.imageGenerationParameters.outputFormat !==
                        "png" ? (
                          <ImageGenerationCompressionControl
                            ariaLabel={t("imageGenerationCompression")}
                            disabled={generationBusy}
                            onValueChange={(value) =>
                              chat.setImageGenerationParameters({
                                outputCompression: value,
                              })
                            }
                            value={
                              chat.imageGenerationParameters
                                .outputCompression ?? 100
                            }
                          />
                        ) : null}
                        <span className="composer-image-size-hint">
                          {chat.imageGenerationParameters.size}
                        </span>
                      </>
                    ) : (
                      <ReasoningEffortControl
                        capability={chat.capability}
                        disabled={generationBusy}
                        modelId={chat.connection.modelId}
                        onValueChange={chat.setReasoningChoice}
                        value={chat.reasoningChoice}
                      />
                    )}
                    {generationBusy ? (
                      <button
                        aria-label={t("stop")}
                        className="send-button stop-button"
                        onClick={() => void chat.stop()}
                        type="button"
                      >
                        <Square
                          aria-hidden="true"
                          className="size-3 fill-current"
                        />
                      </button>
                    ) : (
                      <button
                        aria-label={t("send")}
                        className="send-button"
                        disabled={
                          !chat.ready ||
                          !chat.online ||
                          generationBusy ||
                          (imageMode
                            ? !chat.draft.trim() || !imageGenerationAvailable
                            : !chat.draft.trim() &&
                              chat.pendingAttachments.length === 0)
                        }
                        type="submit"
                      >
                        <ArrowUp aria-hidden="true" className="size-5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      </section>

      {chat.searchOpen ? <SearchDialog chat={chat} /> : null}
    </main>
  );
}

function imageUploadError(cause: unknown, t: TFunction): string {
  return formatUserFacingError(cause, t, "imageError");
}

function resolveResolutionOptions(
  profile: ImageGenerationProfile | null,
): readonly string[] {
  return profile
    ? resolveImageGenerationCapabilities(profile).resolutionTiers
    : ["1K"];
}

function resolveAspectRatioOptions(
  profile: ImageGenerationProfile | null,
): readonly string[] {
  return profile
    ? resolveImageGenerationCapabilities(profile).aspectRatios
    : ["1:1"];
}
