"use client";

import {
  Bot,
  ChevronDown,
  Database,
  Globe2,
  Info,
  Palette,
  Plug,
  X,
  type LucideIcon,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";

import { BrandIcon } from "@/components/chat/brand-icon";
import { ConfirmDialog } from "@/components/chat/confirm-dialog";
import {
  capabilityFormToOverride,
  capabilityToForm,
  type ModelSettingsForm,
} from "@/components/chat/model-settings-form";
import { AboutPage } from "@/components/chat/settings-pages/about-page";
import { AppearancePage } from "@/components/chat/settings-pages/appearance-page";
import { DataPage } from "@/components/chat/settings-pages/data-page";
import { ModelManagementPage } from "@/components/chat/settings-pages/model-management-page";
import { ModelServicePage } from "@/components/chat/settings-pages/model-service-page";
import { WebSearchPage } from "@/components/chat/settings-pages/web-search-page";
import {
  getConfirmationCopy,
  sameValue,
  uniqueModelIds,
  type PendingConfirmation,
} from "@/components/chat/settings-workspace-logic";
import { TextTooltip } from "@/components/chat/text-tooltip";
import {
  SettingsIconButton,
  type SettingsSelectOption,
} from "@/components/settings/settings-controls";
import { formatUserFacingError } from "@/lib/user-facing-error";
import type {
  AppTheme,
  ChatController,
} from "@/features/chat/use-chat-controller";
import type { AppLanguage } from "@/i18n/resources";
import type { ConversationExportProjection } from "@/runtime/chat/export-projection";

type SettingsCategory =
  "appearance" | "service" | "models" | "webSearch" | "data" | "about";

interface SettingsWorkspaceProps {
  chat: ChatController;
  language: AppLanguage;
  theme: AppTheme;
  onApplyGeneral: (language: AppLanguage, theme: AppTheme) => Promise<void>;
  onClose: () => void;
  onPrint: (projection: ConversationExportProjection) => void;
}

const categories = [
  {
    id: "appearance",
    icon: Palette,
    labelKey: "settingsAppearance",
    descriptionKey: "appearancePageDescription",
  },
  {
    id: "service",
    icon: Plug,
    labelKey: "settingsService",
    descriptionKey: "modelServiceDescription",
  },
  {
    id: "models",
    icon: Bot,
    labelKey: "settingsModels",
    descriptionKey: "modelManagementPageDescription",
  },
  {
    id: "webSearch",
    icon: Globe2,
    labelKey: "settingsWebSearch",
    descriptionKey: "webSearchPageDescription",
  },
  {
    id: "data",
    icon: Database,
    labelKey: "settingsData",
    descriptionKey: "dataPageDescription",
  },
  {
    id: "about",
    icon: Info,
    labelKey: "settingsAbout",
    descriptionKey: "aboutDescription",
  },
] as const satisfies ReadonlyArray<{
  id: SettingsCategory;
  icon: LucideIcon;
  labelKey:
    | "settingsAppearance"
    | "settingsService"
    | "settingsModels"
    | "settingsWebSearch"
    | "settingsData"
    | "settingsAbout";
  descriptionKey:
    | "appearancePageDescription"
    | "modelServiceDescription"
    | "modelManagementPageDescription"
    | "webSearchPageDescription"
    | "dataPageDescription"
    | "aboutDescription";
}>;

export function SettingsWorkspace({
  chat,
  language,
  theme,
  onApplyGeneral,
  onClose,
  onPrint,
}: SettingsWorkspaceProps) {
  const { t } = useTranslation();
  const id = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const settingsContentRef = useRef<HTMLElement>(null);
  const capabilityLoadEpochRef = useRef(0);
  const [category, setCategory] = useState<SettingsCategory>("appearance");
  const [contentHasScrolled, setContentHasScrolled] = useState(false);
  const [appearanceError, setAppearanceError] = useState<string | null>(null);

  const [connectionDraft, setConnectionDraft] = useState(chat.connection);
  const [connectionBaseline, setConnectionBaseline] = useState(chat.connection);
  const [connectionSaving, setConnectionSaving] = useState(false);
  const [connectionRefreshing, setConnectionRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);

  const initialEnabledModels = uniqueModelIds(chat.enabledModels);
  const [enabledModelsDraft, setEnabledModelsDraft] =
    useState(initialEnabledModels);
  const [enabledModelsSaving, setEnabledModelsSaving] = useState(false);
  const [enabledModelsError, setEnabledModelsError] = useState<string | null>(
    null,
  );
  const [enabledModelsStatus, setEnabledModelsStatus] = useState<string | null>(
    null,
  );

  const initialDefaultModel = chat.defaultModel ?? chat.connection.modelId;
  const [defaultModelDraft, setDefaultModelDraft] =
    useState(initialDefaultModel);
  const [defaultModelBaseline, setDefaultModelBaseline] =
    useState(initialDefaultModel);
  const [defaultModelSaving, setDefaultModelSaving] = useState(false);
  const [defaultModelError, setDefaultModelError] = useState<string | null>(
    null,
  );
  const [defaultModelStatus, setDefaultModelStatus] = useState<string | null>(
    null,
  );

  const initialTitleModel = chat.titleModel ?? initialDefaultModel;
  const [titleModelDraft, setTitleModelDraft] = useState(initialTitleModel);
  const [titleModelBaseline, setTitleModelBaseline] =
    useState(initialTitleModel);
  const [titleModelSaving, setTitleModelSaving] = useState(false);
  const [titleModelError, setTitleModelError] = useState<string | null>(null);
  const [titleModelStatus, setTitleModelStatus] = useState<string | null>(null);

  const [selectedModel, setSelectedModel] = useState(chat.connection.modelId);
  const [capabilityDraft, setCapabilityDraft] =
    useState<ModelSettingsForm | null>(null);
  const [capabilityBaseline, setCapabilityBaseline] =
    useState<ModelSettingsForm | null>(null);
  const [capabilityLoading, setCapabilityLoading] = useState(
    chat.connection.modelId.trim().length > 0,
  );
  const [capabilitySaving, setCapabilitySaving] = useState(false);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [capabilityStatus, setCapabilityStatus] = useState<string | null>(null);

  const [webSearchDraft, setWebSearchDraft] = useState(chat.webSearchConfig);
  const [webSearchBaseline, setWebSearchBaseline] = useState(
    chat.webSearchConfig,
  );
  const [webSearchSaving, setWebSearchSaving] = useState(false);
  const [webSearchTesting, setWebSearchTesting] = useState(false);
  const [webSearchError, setWebSearchError] = useState<string | null>(null);
  const [webSearchStatus, setWebSearchStatus] = useState<string | null>(null);

  const [includeReasoning, setIncludeReasoning] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation | null>(null);
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(
    null,
  );
  const [closeAfterSave, setCloseAfterSave] = useState(false);

  const connectionDirty = !sameValue(connectionDraft, connectionBaseline);
  const defaultModelDirty = defaultModelDraft !== defaultModelBaseline;
  const titleModelDirty = titleModelDraft !== titleModelBaseline;
  const capabilityDirty = !sameValue(capabilityDraft, capabilityBaseline);
  const webSearchDirty = !sameValue(webSearchDraft, webSearchBaseline);
  const hasUnsavedChanges =
    connectionDirty ||
    defaultModelDirty ||
    titleModelDirty ||
    capabilityDirty ||
    webSearchDirty;
  const settingsSaving =
    connectionSaving ||
    defaultModelSaving ||
    titleModelSaving ||
    capabilitySaving ||
    webSearchSaving;

  const currentCategory =
    categories.find(({ id: categoryId }) => categoryId === category) ??
    categories[0];

  const modelOptions = useMemo<SettingsSelectOption[]>(() => {
    return Array.from(
      new Set(
        [
          ...chat.models,
          chat.connection.modelId,
          chat.defaultModel ?? "",
          chat.titleModel ?? "",
          defaultModelDraft,
          titleModelDraft,
          selectedModel,
        ].filter((model) => model.trim().length > 0),
      ),
    ).map((model) => ({ value: model, label: model }));
  }, [
    chat.connection.modelId,
    chat.defaultModel,
    chat.models,
    chat.titleModel,
    defaultModelDraft,
    selectedModel,
    titleModelDraft,
  ]);

  const resolveModelCapability = chat.resolveModelCapability;
  const resolveModelExecutionCapability = chat.resolveModelExecutionCapability;
  const resolveModelPreferences = chat.resolveModelPreferences;

  useEffect(() => {
    const modelId = selectedModel.trim();
    const epoch = ++capabilityLoadEpochRef.current;
    if (!modelId) return;
    void Promise.all([
      resolveModelCapability(modelId),
      resolveModelExecutionCapability(modelId),
      resolveModelPreferences(modelId),
    ])
      .then(([capability, effective, preferences]) => {
        if (epoch !== capabilityLoadEpochRef.current) return;
        const form =
          capability && effective
            ? capabilityToForm(capability, effective, preferences)
            : null;
        setCapabilityDraft(form);
        setCapabilityBaseline(form);
      })
      .catch((cause: unknown) => {
        if (epoch !== capabilityLoadEpochRef.current) return;
        setCapabilityError(formatUserFacingError(cause, t));
        setCapabilityDraft(null);
        setCapabilityBaseline(null);
      })
      .finally(() => {
        if (epoch === capabilityLoadEpochRef.current) {
          setCapabilityLoading(false);
        }
      });
  }, [
    resolveModelCapability,
    resolveModelExecutionCapability,
    resolveModelPreferences,
    selectedModel,
    t,
  ]);

  useEffect(() => {
    if (!closeAfterSave || settingsSaving) return;

    const timeoutId = globalThis.setTimeout(() => {
      setCloseAfterSave(false);
      if (hasUnsavedChanges) {
        setPendingConfirmation({ kind: "discard" });
        return;
      }
      onClose();
    }, 0);
    return () => globalThis.clearTimeout(timeoutId);
  }, [closeAfterSave, hasUnsavedChanges, onClose, settingsSaving]);

  const requestClose = () => {
    if (settingsSaving) {
      setCloseAfterSave(true);
      return;
    }
    if (hasUnsavedChanges) {
      setPendingConfirmation({ kind: "discard" });
      return;
    }
    onClose();
  };

  const changeCategory = (nextCategory: SettingsCategory) => {
    setCategory(nextCategory);
    setContentHasScrolled(false);
    settingsContentRef.current?.scrollTo({ top: 0 });
  };

  const handleCategoryKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    categoryId: SettingsCategory,
  ) => {
    const currentIndex = categories.findIndex(({ id }) => id === categoryId);
    let nextIndex: number | null = null;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = categories.length - 1;
    else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % categories.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + categories.length) % categories.length;
    }
    if (nextIndex === null) return;
    const nextCategory = categories[nextIndex];
    if (!nextCategory) return;
    event.preventDefault();
    changeCategory(nextCategory.id);
    window.requestAnimationFrame(() => {
      document
        .getElementById(`${id}-tab-${nextCategory.id}`)
        ?.focus({ preventScroll: true });
    });
  };

  const selectModelForEditing = (modelId: string) => {
    if (modelId === selectedModel) return;
    if (capabilityDirty) {
      setPendingConfirmation({ kind: "switchModel", modelId });
      return;
    }
    applyModelSelection(modelId);
  };

  const applyModelSelection = (modelId: string) => {
    setCapabilityLoading(modelId.trim().length > 0);
    setCapabilityError(null);
    setCapabilityStatus(null);
    setCapabilityDraft(null);
    setCapabilityBaseline(null);
    setSelectedModel(modelId);
  };

  const applyAppearance = async (
    nextLanguage: AppLanguage,
    nextTheme: AppTheme,
  ) => {
    setAppearanceError(null);
    try {
      await onApplyGeneral(nextLanguage, nextTheme);
    } catch (cause) {
      setAppearanceError(formatUserFacingError(cause, t));
    }
  };

  const saveConnection = async () => {
    setConnectionError(null);
    setConnectionStatus(null);
    setConnectionSaving(true);
    try {
      await chat.saveConnection(connectionDraft);
      setConnectionBaseline(connectionDraft);
      const nextEnabledModels = uniqueModelIds([
        connectionDraft.modelId,
        chat.defaultModel ?? "",
        chat.titleModel ?? "",
      ]);
      setEnabledModelsDraft(nextEnabledModels);
      setConnectionStatus(t("connectionSaved"));
    } catch (cause) {
      setConnectionError(formatUserFacingError(cause, t));
    } finally {
      setConnectionSaving(false);
    }
  };

  const updateEnabledModels = async (models: string[]) => {
    const previous = enabledModelsDraft;
    setEnabledModelsError(null);
    setEnabledModelsStatus(null);
    setEnabledModelsDraft(models);
    setEnabledModelsSaving(true);
    try {
      const saved = await chat.saveEnabledModels(models);
      setEnabledModelsDraft(saved);
      setEnabledModelsStatus(t("enabledModelsSaved", { count: saved.length }));
    } catch (cause) {
      setEnabledModelsDraft(previous);
      setEnabledModelsError(
        formatUserFacingError(cause, t, "enabledModelsInvalid"),
      );
    } finally {
      setEnabledModelsSaving(false);
    }
  };

  const refreshModels = async () => {
    setConnectionError(null);
    setConnectionStatus(null);
    setConnectionRefreshing(true);
    try {
      const models = await chat.refreshModels(connectionBaseline);
      setConnectionStatus(t("modelsRefreshed", { count: models.length }));
    } catch (cause) {
      setConnectionError(formatUserFacingError(cause, t));
    } finally {
      setConnectionRefreshing(false);
    }
  };

  const saveDefaultModel = async () => {
    setDefaultModelError(null);
    setDefaultModelStatus(null);
    setDefaultModelSaving(true);
    try {
      const saved = await chat.saveDefaultModel(defaultModelDraft);
      setDefaultModelDraft(saved);
      setDefaultModelBaseline(saved);
      setDefaultModelStatus(t("defaultModelSaved"));
    } catch (cause) {
      setDefaultModelError(formatUserFacingError(cause, t));
    } finally {
      setDefaultModelSaving(false);
    }
  };

  const saveTitleModel = async () => {
    setTitleModelError(null);
    setTitleModelStatus(null);
    setTitleModelSaving(true);
    try {
      const saved = await chat.saveTitleModel(titleModelDraft);
      setTitleModelDraft(saved);
      setTitleModelBaseline(saved);
      setTitleModelStatus(t("titleModelSaved"));
    } catch (cause) {
      setTitleModelError(formatUserFacingError(cause, t, "selectModelError"));
    } finally {
      setTitleModelSaving(false);
    }
  };

  const saveCapability = async () => {
    if (!capabilityDraft || !selectedModel) return;
    setCapabilityError(null);
    setCapabilityStatus(null);
    setCapabilitySaving(true);
    try {
      await chat.saveModelSettings(
        selectedModel,
        capabilityFormToOverride(selectedModel, capabilityDraft),
        capabilityDraft.preferences,
      );
      const [resolved, effective, preferences] = await Promise.all([
        chat.resolveModelCapability(selectedModel),
        chat.resolveModelExecutionCapability(selectedModel),
        chat.resolveModelPreferences(selectedModel),
      ]);
      const form =
        resolved && effective
          ? capabilityToForm(resolved, effective, preferences)
          : null;
      setCapabilityDraft(form);
      setCapabilityBaseline(form);
      setCapabilityStatus(t("modelSettingsSaved", { model: selectedModel }));
    } catch (cause) {
      setCapabilityError(formatUserFacingError(cause, t));
    } finally {
      setCapabilitySaving(false);
    }
  };

  const resetCapability = async () => {
    if (!selectedModel) return;
    setCapabilityError(null);
    setCapabilityStatus(null);
    setCapabilitySaving(true);
    try {
      await chat.resetModelSettings(selectedModel);
      const [resolved, effective, preferences] = await Promise.all([
        chat.resolveModelCapability(selectedModel),
        chat.resolveModelExecutionCapability(selectedModel),
        chat.resolveModelPreferences(selectedModel),
      ]);
      const form =
        resolved && effective
          ? capabilityToForm(resolved, effective, preferences)
          : null;
      setCapabilityDraft(form);
      setCapabilityBaseline(form);
      setCapabilityStatus(t("modelSettingsReset", { model: selectedModel }));
    } catch (cause) {
      setCapabilityError(formatUserFacingError(cause, t));
    } finally {
      setCapabilitySaving(false);
    }
  };

  const saveWebSearch = async () => {
    setWebSearchError(null);
    setWebSearchStatus(null);
    setWebSearchSaving(true);
    try {
      const saved = await chat.saveWebSearchSettings({
        enabled: webSearchDraft.enabled,
        maxResults: webSearchDraft.maxResults,
        provider: webSearchDraft.provider,
        hostedProvider: webSearchDraft.hostedProvider,
        providers: {
          tavily: {
            apiKey: webSearchDraft.providers.tavily.apiKey,
            baseUrl: webSearchDraft.providers.tavily.baseUrl,
          },
          exa: {
            apiKey: webSearchDraft.providers.exa.apiKey,
            baseUrl: webSearchDraft.providers.exa.baseUrl,
          },
          grok: {
            apiKey: webSearchDraft.providers.grok.apiKey,
            responsesUrl: webSearchDraft.providers.grok.responsesUrl,
            model: webSearchDraft.providers.grok.model,
            xSearch: webSearchDraft.providers.grok.xSearch,
          },
        },
      });
      setWebSearchDraft(saved);
      setWebSearchBaseline(saved);
      setWebSearchStatus(t("webSearchSaved"));
    } catch (cause) {
      setWebSearchError(formatUserFacingError(cause, t, "webSearchSaveError"));
    } finally {
      setWebSearchSaving(false);
    }
  };

  const testWebSearch = async () => {
    setWebSearchError(null);
    setWebSearchStatus(null);
    setWebSearchTesting(true);
    try {
      await chat.testWebSearch(webSearchDraft);
      setWebSearchStatus(t("webSearchTestSucceeded"));
    } catch (cause) {
      setWebSearchError(formatUserFacingError(cause, t, "webSearchTestError"));
    } finally {
      setWebSearchTesting(false);
    }
  };

  const importBackupFile = async (file: File) => {
    setDataError(null);
    try {
      const inspected = await chat.inspectBackup(file);
      setPendingConfirmation({ kind: "import", ...inspected });
    } catch (cause) {
      setDataError(formatUserFacingError(cause, t));
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const runArtifactExport = async (
    createArtifact: () => Promise<{
      blob: Blob;
      filename: string;
      mimeType: string;
    }>,
  ) => {
    setDataError(null);
    try {
      downloadBlob(await createArtifact());
    } catch (cause) {
      setDataError(formatUserFacingError(cause, t));
    }
  };

  const confirm = async () => {
    const pending = pendingConfirmation;
    if (!pending) return;
    setConfirmationError(null);
    if (pending.kind === "discard") {
      setPendingConfirmation(null);
      onClose();
      return;
    }
    if (pending.kind === "switchModel") {
      setCapabilityDraft(capabilityBaseline);
      setPendingConfirmation(null);
      applyModelSelection(pending.modelId);
      return;
    }
    setConfirmationPending(true);
    try {
      if (pending.kind === "clearChats") {
        await chat.clearAllConversations();
      } else if (pending.kind === "clearData") {
        await chat.clearAllLocalData();
      } else {
        await chat.restoreBackup(pending.prepared);
        setDataError(null);
      }
      setPendingConfirmation(null);
    } catch (cause) {
      setConfirmationError(formatUserFacingError(cause, t));
    } finally {
      setConfirmationPending(false);
    }
  };

  const confirmationCopy = getConfirmationCopy(pendingConfirmation, t);
  const destructiveConfirmation =
    pendingConfirmation?.kind === "clearChats" ||
    pendingConfirmation?.kind === "clearData";
  const CurrentCategoryIcon = currentCategory.icon;

  return (
    <main aria-label={t("settings")} className="settings-workspace">
      <aside className="settings-sidebar">
        <div className="settings-brand">
          <span className="settings-brand-mark">
            <BrandIcon size={32} />
          </span>
          <span>{t("appName")}</span>
        </div>

        <nav
          aria-label={t("settingsCategories")}
          className="settings-nav settings-desktop-nav"
          role="tablist"
        >
          {categories.map(({ id: categoryId, icon: Icon, labelKey }) => (
            <button
              aria-controls={`${id}-panel-${categoryId}`}
              aria-selected={category === categoryId}
              className={
                categoryId === "about"
                  ? "settings-nav-item settings-nav-item-about"
                  : "settings-nav-item"
              }
              id={`${id}-tab-${categoryId}`}
              key={categoryId}
              onClick={() => changeCategory(categoryId)}
              onKeyDown={(event) => handleCategoryKeyDown(event, categoryId)}
              role="tab"
              tabIndex={category === categoryId ? 0 : -1}
              type="button"
            >
              <Icon aria-hidden="true" size={17} />
              <span>{t(labelKey)}</span>
            </button>
          ))}
        </nav>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              aria-label={t("settingsPageMenu", {
                page: t(currentCategory.labelKey),
              })}
              className="settings-mobile-nav-trigger"
              type="button"
            >
              <CurrentCategoryIcon aria-hidden="true" size={17} />
              <span>{t(currentCategory.labelKey)}</span>
              <ChevronDown aria-hidden="true" size={15} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              className="settings-mobile-nav-menu"
              collisionPadding={8}
              sideOffset={6}
            >
              {categories.map(({ id: categoryId, icon: Icon, labelKey }) => (
                <DropdownMenu.Item
                  className="settings-mobile-nav-item"
                  key={categoryId}
                  onSelect={() => changeCategory(categoryId)}
                >
                  <Icon aria-hidden="true" size={17} />
                  <span>{t(labelKey)}</span>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </aside>

      <section className="settings-main">
        <header
          className={
            contentHasScrolled
              ? "settings-header has-scroll-shadow"
              : "settings-header"
          }
        >
          <div className="settings-header-inner">
            <div className="settings-header-copy">
              <h1>
                <span aria-hidden="true" className="settings-title-parent">
                  {t("settings")}
                </span>
                <span aria-hidden="true" className="settings-title-separator">
                  /
                </span>
                <span>{t(currentCategory.labelKey)}</span>
              </h1>
              <p className="settings-header-description">
                {t(currentCategory.descriptionKey)}
              </p>
            </div>
            <TextTooltip content={t("close")}>
              <SettingsIconButton
                aria-label={t("close")}
                onClick={requestClose}
                ref={closeButtonRef}
                type="button"
              >
                <X aria-hidden="true" size={19} />
              </SettingsIconButton>
            </TextTooltip>
          </div>
        </header>

        <section
          aria-labelledby={`${id}-tab-${category}`}
          className="settings-content"
          id={`${id}-panel-${category}`}
          onScroll={(event) =>
            setContentHasScrolled(event.currentTarget.scrollTop > 2)
          }
          ref={settingsContentRef}
          role="tabpanel"
          tabIndex={0}
        >
          {category === "appearance" ? (
            <AppearancePage
              error={appearanceError}
              language={language}
              onLanguageChange={(nextLanguage) =>
                void applyAppearance(nextLanguage, theme)
              }
              onThemeChange={(nextTheme) =>
                void applyAppearance(language, nextTheme)
              }
              theme={theme}
            />
          ) : null}

          {category === "service" ? (
            <ModelServicePage
              availableModels={chat.availableModels}
              connection={connectionDraft}
              dirty={connectionDirty}
              enabledModels={enabledModelsDraft}
              enabledModelsError={enabledModelsError}
              enabledModelsSaving={enabledModelsSaving}
              enabledModelsStatus={enabledModelsStatus}
              error={connectionError}
              modelCount={chat.availableModels.length}
              onConnectionChange={(next) => {
                setConnectionDraft(next);
                setConnectionError(null);
                setConnectionStatus(null);
              }}
              onEnabledModelsChange={(models) =>
                void updateEnabledModels(models)
              }
              onRefresh={() => void refreshModels()}
              onSave={() => void saveConnection()}
              publicConfig={chat.publicConfig}
              refreshing={connectionRefreshing}
              requiredModels={uniqueModelIds([
                chat.connection.modelId,
                chat.defaultModel ?? "",
                chat.titleModel ?? "",
              ])}
              saving={connectionSaving}
              status={connectionStatus}
            />
          ) : null}

          {category === "models" ? (
            <ModelManagementPage
              capability={capabilityDraft}
              capabilityDirty={capabilityDirty}
              capabilityError={capabilityError}
              capabilityLoading={capabilityLoading}
              capabilitySaving={capabilitySaving}
              capabilityStatus={capabilityStatus}
              defaultModel={defaultModelDraft}
              defaultModelDirty={defaultModelDirty}
              defaultModelError={defaultModelError}
              defaultModelSaving={defaultModelSaving}
              defaultModelStatus={defaultModelStatus}
              modelOptions={modelOptions}
              onCapabilityChange={(next) => {
                setCapabilityDraft(next);
                setCapabilityError(null);
                setCapabilityStatus(null);
              }}
              onDefaultModelChange={(modelId) => {
                setDefaultModelDraft(modelId);
                setDefaultModelError(null);
                setDefaultModelStatus(null);
              }}
              onResetCapability={() => void resetCapability()}
              onSaveCapability={() => void saveCapability()}
              onSaveDefaultModel={() => void saveDefaultModel()}
              onSaveTitleModel={() => void saveTitleModel()}
              onSelectedModelChange={selectModelForEditing}
              selectedModel={selectedModel}
              titleModel={titleModelDraft}
              titleModelDirty={titleModelDirty}
              titleModelError={titleModelError}
              titleModelSaving={titleModelSaving}
              titleModelStatus={titleModelStatus}
              onTitleModelChange={(modelId) => {
                setTitleModelDraft(modelId);
                setTitleModelError(null);
                setTitleModelStatus(null);
              }}
            />
          ) : null}

          {category === "webSearch" ? (
            <WebSearchPage
              activeSource={chat.webSearchSource}
              connectionMode={chat.connection.mode}
              dirty={webSearchDirty}
              draft={webSearchDraft}
              error={webSearchError}
              hostedAuthenticated={chat.publicConfig?.authenticated ?? false}
              hostedEnabled={chat.publicConfig?.hostedWebSearchEnabled ?? false}
              hostedProvider={
                chat.publicConfig?.hostedWebSearchProvider ?? null
              }
              hostedProviders={
                chat.publicConfig?.hostedWebSearchProviders ?? []
              }
              onChange={(next) => {
                setWebSearchDraft(next);
                setWebSearchError(null);
                setWebSearchStatus(null);
              }}
              onSave={() => void saveWebSearch()}
              onTest={() => void testWebSearch()}
              saving={webSearchSaving}
              status={webSearchStatus}
              testing={webSearchTesting}
            />
          ) : null}

          {category === "data" ? (
            <DataPage
              currentConversationAvailable={Boolean(chat.currentConversation)}
              error={dataError}
              importInputRef={importInputRef}
              includeReasoning={includeReasoning}
              onClearChats={() =>
                setPendingConfirmation({ kind: "clearChats" })
              }
              onClearData={() => setPendingConfirmation({ kind: "clearData" })}
              onCreateBackup={() =>
                void chat
                  .createBackup()
                  .then((blob) =>
                    downloadBlob({
                      blob,
                      filename: "cherrychat-backup.zip",
                      mimeType: "application/zip",
                    }),
                  )
                  .catch((cause: unknown) =>
                    setDataError(formatUserFacingError(cause, t)),
                  )
              }
              onExportJson={() =>
                void runArtifactExport(() =>
                  chat.exportCurrentJson(includeReasoning),
                )
              }
              onExportMarkdown={() =>
                void runArtifactExport(() =>
                  chat.exportCurrentMarkdown(includeReasoning),
                )
              }
              onImport={(file) => void importBackupFile(file)}
              onIncludeReasoningChange={setIncludeReasoning}
              onPrint={() =>
                void chat
                  .loadPrintProjection(includeReasoning)
                  .then(onPrint)
                  .catch((cause: unknown) =>
                    setDataError(formatUserFacingError(cause, t)),
                  )
              }
            />
          ) : null}

          {category === "about" ? (
            <AboutPage publicConfig={chat.publicConfig} />
          ) : null}
        </section>
      </section>

      <ConfirmDialog
        cancelLabel={t("cancel")}
        confirmLabel={confirmationCopy.confirmLabel}
        description={confirmationCopy.description}
        destructive={destructiveConfirmation}
        error={confirmationError}
        onConfirm={() => void confirm()}
        onOpenChange={(open) => {
          if (!open && !confirmationPending) {
            const restoreCloseFocus = pendingConfirmation?.kind === "discard";
            setPendingConfirmation(null);
            setConfirmationError(null);
            if (restoreCloseFocus) {
              window.requestAnimationFrame(() =>
                closeButtonRef.current?.focus(),
              );
            }
          }
        }}
        open={pendingConfirmation !== null}
        pending={confirmationPending}
        title={confirmationCopy.title}
      />
    </main>
  );
}

function downloadBlob(artifact: {
  blob: Blob;
  filename: string;
  mimeType: string;
}): void {
  const url = URL.createObjectURL(
    new Blob([artifact.blob], { type: artifact.mimeType }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = artifact.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
