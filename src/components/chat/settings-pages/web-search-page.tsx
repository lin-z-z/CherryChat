"use client";

import {
  Cable,
  Check,
  CircleAlert,
  Globe2,
  LoaderCircle,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  SettingsRow,
  SettingsSection,
} from "@/components/chat/settings-layout";
import {
  PasswordField,
  RangeControl,
  SettingsButton,
  SwitchControl,
  TextField,
} from "@/components/settings/settings-controls";
import type { ChatController } from "@/features/chat/use-chat-controller";
import { WEB_SEARCH_RESULT_COUNT } from "@/runtime/tools/web-search-settings";

export function WebSearchPage({
  activeSource,
  connectionMode,
  draft,
  dirty,
  saving,
  testing,
  error,
  hostedAuthenticated,
  hostedEnabled,
  status,
  onChange,
  onSave,
  onTest,
}: {
  activeSource: ChatController["webSearchSource"];
  connectionMode: ChatController["connection"]["mode"];
  draft: ChatController["webSearchConfig"];
  dirty: boolean;
  saving: boolean;
  testing: boolean;
  error: string | null;
  hostedAuthenticated: boolean;
  hostedEnabled: boolean;
  status: string | null;
  onChange: (draft: ChatController["webSearchConfig"]) => void;
  onSave: () => void;
  onTest: () => void;
}) {
  const { t } = useTranslation();
  const busy = saving || testing;
  const hasPersonalKey = Boolean(draft.apiKey.trim());
  const hasPersonalSource = hasPersonalKey && Boolean(draft.baseUrl.trim());
  const hostedReady = hostedEnabled && hostedAuthenticated;
  const activeSourceReady =
    connectionMode === "hosted" ? hostedReady : hasPersonalSource;
  const personalFieldsDisabled = connectionMode === "hosted";
  const serviceState =
    activeSource === "browser"
      ? "personal"
      : activeSource === "hosted"
        ? "hosted"
        : connectionMode === "hosted"
          ? hostedEnabled
            ? "login"
            : "hostedUnavailable"
          : "personalRequired";
  const ServiceStateIcon =
    serviceState === "personal" || serviceState === "hosted"
      ? ShieldCheck
      : CircleAlert;
  return (
    <SettingsSection
      description={t("webSearchDescription")}
      icon={Globe2}
      title={t("webSearch")}
    >
      <div className="settings-ui-panel">
        <SettingsRow
          description={t(`webSearchServiceDescription.${serviceState}`)}
          icon={ServiceStateIcon}
          title={t("webSearchService")}
        >
          <strong className="settings-source-value">
            {t(`webSearchServiceStatus.${serviceState}`)}
          </strong>
        </SettingsRow>
        <SettingsRow
          description={t("webSearchEnableDescription")}
          icon={Globe2}
          title={t("webSearchEnable")}
        >
          <SwitchControl
            checked={draft.enabled}
            disabled={busy || (!draft.enabled && !activeSourceReady)}
            id="settings-web-search-enabled"
            label={t("webSearchEnable")}
            onCheckedChange={(enabled) => onChange({ ...draft, enabled })}
          />
        </SettingsRow>
        <div className="settings-form-block settings-web-search-key">
          <PasswordField
            autoComplete="off"
            description={
              personalFieldsDisabled
                ? t("personalTavilyApiKeyInactiveDescription")
                : t("tavilyApiKeyDescription")
            }
            disabled={busy || personalFieldsDisabled}
            hidePasswordLabel={t("hidePassword")}
            id="settings-tavily-api-key"
            label={
              personalFieldsDisabled
                ? t("personalTavilyApiKey")
                : t("tavilyApiKey")
            }
            onChange={(event) =>
              onChange({
                ...draft,
                apiKey: event.target.value,
                hasApiKey: Boolean(event.target.value.trim()),
              })
            }
            placeholder="tvly-..."
            showPasswordLabel={t("showPassword")}
            value={draft.apiKey}
          />
        </div>
        <div className="settings-form-block">
          <TextField
            autoComplete="url"
            description={
              personalFieldsDisabled
                ? t("personalTavilyApiUrlInactiveDescription")
                : t("tavilyApiUrlDescription")
            }
            disabled={busy || personalFieldsDisabled}
            id="settings-tavily-api-url"
            label={t("tavilyApiUrl")}
            onChange={(event) =>
              onChange({ ...draft, baseUrl: event.target.value })
            }
            placeholder="https://api.tavily.com"
            type="url"
            value={draft.baseUrl}
          />
        </div>
        <SettingsRow
          className="settings-web-search-result-row"
          description={t("webSearchResultCountDescription")}
          icon={SlidersHorizontal}
          title={t("webSearchResultCount")}
        >
          <RangeControl
            aria-label={t("webSearchResultCount")}
            disabled={busy}
            marks={[
              { value: 1, label: "1" },
              {
                value: WEB_SEARCH_RESULT_COUNT.default,
                label: t("webSearchResultCountDefault"),
              },
              { value: 20, label: "20" },
              { value: WEB_SEARCH_RESULT_COUNT.max, label: "50" },
            ]}
            max={WEB_SEARCH_RESULT_COUNT.max}
            min={WEB_SEARCH_RESULT_COUNT.min}
            onValueChange={(maxResults) => onChange({ ...draft, maxResults })}
            step={WEB_SEARCH_RESULT_COUNT.step}
            value={draft.maxResults}
            valueText={t("webSearchResultCountValue", {
              count: draft.maxResults,
            })}
          />
        </SettingsRow>
        <div className="settings-action-row settings-form-actions settings-web-search-actions">
          <span className="settings-status-line">
            {status ?? (dirty ? t("unsavedWebSearchChanges") : null)}
          </span>
          <div className="settings-action-group">
            <SettingsButton
              disabled={busy || !activeSourceReady}
              onClick={onTest}
              type="button"
            >
              {testing ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="pending-spinner"
                  size={16}
                />
              ) : (
                <Cable aria-hidden="true" size={16} />
              )}
              {t("testWebSearch")}
            </SettingsButton>
            <SettingsButton
              disabled={busy || !dirty}
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
                <Check aria-hidden="true" size={16} />
              )}
              {t("saveWebSearch")}
            </SettingsButton>
          </div>
        </div>
        {error ? (
          <p
            className="settings-local-error settings-inline-error"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    </SettingsSection>
  );
}
