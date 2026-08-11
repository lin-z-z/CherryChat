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
  SelectControl,
  SettingsButton,
  SwitchControl,
  TextField,
} from "@/components/settings/settings-controls";
import type { ChatController } from "@/features/chat/use-chat-controller";
import {
  WEB_SEARCH_PROVIDER_IDS,
  type WebSearchProviderId,
} from "@/runtime/chat/types";
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
  hostedProvider,
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
  hostedProvider: WebSearchProviderId | null;
  status: string | null;
  onChange: (draft: ChatController["webSearchConfig"]) => void;
  onSave: () => void;
  onTest: () => void;
}) {
  const { t } = useTranslation();
  const busy = saving || testing;
  const visibleProvider =
    connectionMode === "hosted" && hostedProvider
      ? hostedProvider
      : draft.provider;
  const providerConfig = draft.providers[visibleProvider];
  const hasPersonalKey = providerConfig.hasApiKey;
  const hasPersonalSource = hasPersonalKey;
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
          className="settings-web-search-control-row"
          description={t(`webSearchServiceDescription.${serviceState}`)}
          icon={ServiceStateIcon}
          title={t("webSearchService")}
        >
          <strong className="settings-source-value">
            {t(`webSearchServiceStatus.${serviceState}`)}
          </strong>
        </SettingsRow>
        <SettingsRow
          className="settings-web-search-control-row"
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
        <div className="settings-form-block">
          <label htmlFor="settings-web-search-provider">
            {t("webSearchProvider")}
          </label>
          <small>{t("webSearchProviderDescription")}</small>
          <SelectControl
            aria-label={t("webSearchProvider")}
            disabled={busy || personalFieldsDisabled}
            id="settings-web-search-provider"
            onValueChange={(provider) => {
              const nextProvider = WEB_SEARCH_PROVIDER_IDS.find(
                (candidate) => candidate === provider,
              );
              if (!nextProvider) return;
              onChange({
                ...draft,
                provider: nextProvider,
                hasApiKey: draft.providers[nextProvider].hasApiKey,
              });
            }}
            options={[
              { value: "tavily", label: t("webSearchProviderTavily") },
              { value: "exa", label: t("webSearchProviderExa") },
              { value: "grok", label: t("webSearchProviderGrok") },
            ]}
            value={visibleProvider}
          />
        </div>
        <div className="settings-form-block settings-web-search-key">
          <PasswordField
            autoComplete="off"
            description={
              personalFieldsDisabled
                ? visibleProvider === "tavily"
                  ? t("personalTavilyApiKeyInactiveDescription")
                  : t("personalWebSearchKeyInactiveDescription")
                : visibleProvider === "tavily"
                  ? t("tavilyApiKeyDescription")
                  : t("webSearchApiKeyDescription")
            }
            disabled={busy || personalFieldsDisabled}
            hidePasswordLabel={t("hidePassword")}
            id={`settings-${visibleProvider}-api-key`}
            label={
              personalFieldsDisabled
                ? visibleProvider === "tavily"
                  ? t("personalTavilyApiKey")
                  : t("personalWebSearchKey")
                : visibleProvider === "tavily"
                  ? t("tavilyApiKey")
                  : t("webSearchApiKey")
            }
            onChange={(event) =>
              onChange({
                ...draft,
                providers: {
                  ...draft.providers,
                  [visibleProvider]: {
                    ...providerConfig,
                    apiKey: event.target.value,
                    hasApiKey: Boolean(event.target.value.trim()),
                  },
                },
                hasApiKey: Boolean(event.target.value.trim()),
              })
            }
            placeholder={visibleProvider === "grok" ? "xai-..." : "..."}
            showPasswordLabel={t("showPassword")}
            value={providerConfig.apiKey}
          />
        </div>
        {visibleProvider === "grok" ? (
          <>
            <div className="settings-form-block">
              <TextField
                autoComplete="url"
                description={
                  personalFieldsDisabled
                    ? t("personalWebSearchUrlInactiveDescription")
                    : t("grokResponsesUrlDescription")
                }
                disabled={busy || personalFieldsDisabled}
                id="settings-grok-responses-url"
                label={t("grokResponsesUrl")}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    providers: {
                      ...draft.providers,
                      grok: {
                        ...draft.providers.grok,
                        responsesUrl: event.target.value,
                      },
                    },
                  })
                }
                placeholder="https://api.x.ai/v1/responses"
                type="url"
                value={draft.providers.grok.responsesUrl}
              />
            </div>
            <div className="settings-form-block">
              <TextField
                autoComplete="off"
                description={t("grokModelDescription")}
                disabled={busy || personalFieldsDisabled}
                id="settings-grok-model"
                label={t("grokModel")}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    providers: {
                      ...draft.providers,
                      grok: {
                        ...draft.providers.grok,
                        model: event.target.value,
                      },
                    },
                  })
                }
                value={draft.providers.grok.model}
              />
            </div>
            <SettingsRow
              className="settings-web-search-control-row"
              description={t("grokXSearchDescription")}
              icon={Globe2}
              title={t("grokXSearch")}
            >
              <SwitchControl
                checked={draft.providers.grok.xSearch}
                disabled={busy || personalFieldsDisabled}
                id="settings-grok-x-search"
                label={t("grokXSearch")}
                onCheckedChange={(xSearch) =>
                  onChange({
                    ...draft,
                    providers: {
                      ...draft.providers,
                      grok: { ...draft.providers.grok, xSearch },
                    },
                  })
                }
              />
            </SettingsRow>
          </>
        ) : (
          <div className="settings-form-block">
            <TextField
              autoComplete="url"
              description={
                personalFieldsDisabled
                  ? t("personalWebSearchUrlInactiveDescription")
                  : t(
                      visibleProvider === "exa"
                        ? "exaBaseUrlDescription"
                        : "tavilyApiUrlDescription",
                    )
              }
              disabled={busy || personalFieldsDisabled}
              id={`settings-${visibleProvider}-api-url`}
              label={
                visibleProvider === "exa" ? t("exaBaseUrl") : t("tavilyApiUrl")
              }
              onChange={(event) =>
                onChange({
                  ...draft,
                  providers: {
                    ...draft.providers,
                    [visibleProvider]: {
                      ...providerConfig,
                      baseUrl: event.target.value,
                    },
                  },
                })
              }
              placeholder={
                visibleProvider === "exa"
                  ? "https://api.exa.ai"
                  : "https://api.tavily.com"
              }
              type="url"
              value={
                visibleProvider === "exa"
                  ? draft.providers.exa.baseUrl
                  : draft.providers.tavily.baseUrl
              }
            />
          </div>
        )}
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
