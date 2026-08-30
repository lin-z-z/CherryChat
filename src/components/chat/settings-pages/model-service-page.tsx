"use client";

import {
  Cable,
  Check,
  ChevronDown,
  CircleAlert,
  Code2,
  Globe2,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  PackageOpen,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useTranslation } from "react-i18next";

import { ModelEnablementList } from "@/components/chat/model-enablement-list";
import {
  SettingsRow,
  SettingsSection,
} from "@/components/chat/settings-layout";
import {
  PasswordField,
  SelectControl,
  SettingsButton,
  SettingsField,
  TextField,
} from "@/components/settings/settings-controls";
import type {
  ChatController,
  ConnectionDraft,
} from "@/features/chat/use-chat-controller";
import { cn } from "@/lib/cn";
import type { ChatApiType } from "@/runtime/chat/types";

const DEFAULT_API_URLS: Record<ChatApiType, string> = {
  openai: "https://api.openai.com",
  "openai-responses": "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
  "new-api": "",
  "openai-compatible": "",
};

export function ModelServicePage({
  availableModels,
  connection,
  publicConfig,
  dirty,
  saving,
  refreshing,
  modelCount,
  error,
  status,
  enabledModels,
  enabledModelsSaving,
  enabledModelsError,
  enabledModelsStatus,
  requiredModels,
  onConnectionChange,
  onEnabledModelsChange,
  onSave,
  onRefresh,
}: {
  availableModels: readonly string[];
  connection: ConnectionDraft;
  publicConfig: ChatController["publicConfig"];
  dirty: boolean;
  saving: boolean;
  refreshing: boolean;
  modelCount: number;
  error: string | null;
  status: string | null;
  enabledModels: readonly string[];
  enabledModelsSaving: boolean;
  enabledModelsError: string | null;
  enabledModelsStatus: string | null;
  requiredModels: readonly string[];
  onConnectionChange: (connection: ConnectionDraft) => void;
  onEnabledModelsChange: (models: string[]) => void;
  onSave: () => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const canUseCustom = publicConfig?.byokEnabled ?? true;
  const canUseAccessCode = publicConfig?.hostedEnabled ?? false;
  const selectedMethodAvailable =
    connection.mode === "hosted" ? canUseAccessCode : canUseCustom;
  // Hosted authentication is verified per submit, so resubmitting the same
  // non-empty access code must stay possible. BYOK keeps the dirty gate.
  const canSubmitConnection =
    connection.mode === "hosted"
      ? connection.accessCode.trim().length > 0
      : dirty;
  const selectedMethodLabel =
    connection.mode === "hosted" ? t("useAccessCode") : t("customApi");
  const SelectedMethodIcon = connection.mode === "hosted" ? KeyRound : Code2;
  return (
    <>
      <SettingsSection
        action={
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                aria-label={t("connectionMethodCurrent", {
                  method: selectedMethodLabel,
                })}
                className="settings-connection-method-trigger"
                type="button"
              >
                <SelectedMethodIcon aria-hidden="true" size={17} />
                <span>{selectedMethodLabel}</span>
                <ChevronDown aria-hidden="true" size={15} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                className="settings-connection-method-menu"
                collisionPadding={8}
                sideOffset={6}
              >
                <DropdownMenu.RadioGroup
                  onValueChange={(mode) => {
                    if (mode === "hosted" || mode === "byok") {
                      onConnectionChange({ ...connection, mode });
                    }
                  }}
                  value={connection.mode}
                >
                  <DropdownMenu.RadioItem
                    className="settings-connection-method-item"
                    value="hosted"
                  >
                    <span className="settings-method-item-icon">
                      <KeyRound aria-hidden="true" size={16} />
                    </span>
                    <span className="settings-method-item-copy">
                      <span>{t("useAccessCode")}</span>
                      <small>
                        {canUseAccessCode
                          ? t("connectionMethodAvailable")
                          : t("connectionMethodNotEnabled")}
                      </small>
                    </span>
                    <DropdownMenu.ItemIndicator className="settings-method-item-check">
                      <Check aria-hidden="true" size={15} />
                    </DropdownMenu.ItemIndicator>
                  </DropdownMenu.RadioItem>
                  <DropdownMenu.RadioItem
                    className="settings-connection-method-item"
                    value="byok"
                  >
                    <span className="settings-method-item-icon">
                      <Code2 aria-hidden="true" size={16} />
                    </span>
                    <span className="settings-method-item-copy">
                      <span>{t("customApi")}</span>
                      <small>
                        {canUseCustom
                          ? t("connectionMethodAvailable")
                          : t("connectionMethodNotEnabled")}
                      </small>
                    </span>
                    <DropdownMenu.ItemIndicator className="settings-method-item-check">
                      <Check aria-hidden="true" size={15} />
                    </DropdownMenu.ItemIndicator>
                  </DropdownMenu.RadioItem>
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        }
        description={t("connectionMethodDescription")}
        icon={Cable}
        title={t("connectionSetup")}
      >
        <div className="settings-ui-panel settings-connection-form">
          <div className="settings-form-block">
            {connection.mode === "hosted" ? (
              <PasswordField
                autoComplete="current-password"
                description={t("accessCodeDescription")}
                hidePasswordLabel={t("hidePassword")}
                id="settings-access-code"
                icon={<KeyRound size={17} />}
                label={t("accessCode")}
                onChange={(event) =>
                  onConnectionChange({
                    ...connection,
                    accessCode: event.target.value,
                  })
                }
                showPasswordLabel={t("showPassword")}
                value={connection.accessCode}
              />
            ) : (
              <>
                <SettingsField
                  description={t("apiTypeDescription")}
                  htmlFor="settings-api-type"
                  label={t("apiType")}
                >
                  <SelectControl
                    aria-label={t("apiType")}
                    id="settings-api-type"
                    onValueChange={(value) => {
                      const apiType = value as ChatApiType;
                      const currentUrl = connection.baseUrl.trim();
                      const isKnownDefault = Object.values(DEFAULT_API_URLS)
                        .filter(Boolean)
                        .includes(currentUrl);
                      onConnectionChange({
                        ...connection,
                        apiType,
                        baseUrl: isKnownDefault
                          ? DEFAULT_API_URLS[apiType]
                          : connection.baseUrl,
                      });
                    }}
                    options={[
                      { value: "openai", label: t("apiTypeOpenAI") },
                      {
                        value: "openai-responses",
                        label: t("apiTypeOpenAIResponses"),
                      },
                      { value: "anthropic", label: t("apiTypeAnthropic") },
                      { value: "gemini", label: t("apiTypeGemini") },
                      { value: "new-api", label: t("apiTypeNewApi") },
                      {
                        value: "openai-compatible",
                        label: t("apiTypeOpenAICompatible"),
                      },
                    ]}
                    value={connection.apiType}
                  />
                </SettingsField>
                <TextField
                  autoComplete="url"
                  description={t("apiUrlDescription")}
                  id="settings-api-url"
                  icon={<Globe2 size={17} />}
                  label={t("apiUrl")}
                  onChange={(event) =>
                    onConnectionChange({
                      ...connection,
                      baseUrl: event.target.value,
                    })
                  }
                  placeholder={
                    DEFAULT_API_URLS[connection.apiType] ||
                    t("apiUrlCustomPlaceholder")
                  }
                  type="url"
                  value={connection.baseUrl}
                />
                <PasswordField
                  autoComplete="off"
                  description={t("apiKeyDescription")}
                  hidePasswordLabel={t("hidePassword")}
                  id="settings-api-key"
                  icon={<LockKeyhole size={17} />}
                  label={t("apiKey")}
                  onChange={(event) =>
                    onConnectionChange({
                      ...connection,
                      apiKey: event.target.value,
                    })
                  }
                  showPasswordLabel={t("showPassword")}
                  value={connection.apiKey}
                />
              </>
            )}
          </div>
          {!selectedMethodAvailable ? (
            <div className="settings-method-availability" role="status">
              <CircleAlert aria-hidden="true" size={17} />
              <span>
                {t("connectionMethodUnavailable", {
                  method: selectedMethodLabel,
                })}
              </span>
            </div>
          ) : null}
          <div className="settings-action-row settings-form-actions settings-connection-save">
            <span className="settings-status-line">
              {selectedMethodAvailable
                ? dirty
                  ? t("unsavedConnectionChanges")
                  : status
                : null}
            </span>
            <SettingsButton
              aria-busy={saving}
              disabled={
                saving || !canSubmitConnection || !selectedMethodAvailable
              }
              onClick={onSave}
              type="button"
              variant="primary"
            >
              {saving ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="pending-spinner"
                  size={16}
                />
              ) : (
                <ShieldCheck aria-hidden="true" size={16} />
              )}
              {t("saveConnection")}
            </SettingsButton>
          </div>
          {error ? (
            <p
              className="settings-local-error settings-inline-error"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <SettingsRow
            description={t("modelDiscoveryDescription")}
            icon={PackageOpen}
            title={t("availableModels")}
          >
            <div className="settings-action-group settings-model-discovery-actions">
              <span
                aria-label={t("modelCount", { count: modelCount })}
                className="settings-model-count"
              >
                {modelCount}
              </span>
              <SettingsButton
                disabled={refreshing || dirty || !selectedMethodAvailable}
                onClick={onRefresh}
                type="button"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={cn(refreshing && "pending-spinner")}
                  size={16}
                />
                {t("refreshModels")}
              </SettingsButton>
            </div>
          </SettingsRow>
          {connection.mode === "byok" && availableModels.length > 0 ? (
            <div className="settings-model-enablement-block">
              <div className="settings-model-enablement-heading">
                <div>
                  <h3>{t("chooseEnabledModels")}</h3>
                  <p>{t("chooseEnabledModelsDescription")}</p>
                </div>
              </div>
              <ModelEnablementList
                disabled={enabledModelsSaving || dirty}
                enabledModels={enabledModels}
                models={availableModels}
                onEnabledModelsChange={onEnabledModelsChange}
                requiredModels={requiredModels}
              />
              {enabledModelsStatus ? (
                <p
                  className="settings-status-line settings-model-enablement-status"
                  role="status"
                >
                  {enabledModelsStatus}
                </p>
              ) : null}
              {enabledModelsError ? (
                <p
                  className="settings-local-error settings-inline-error"
                  role="alert"
                >
                  {enabledModelsError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </SettingsSection>
    </>
  );
}
