"use client";

import { ArrowRight, Cable, Image, KeyRound, Link2, Save } from "lucide-react";
import { useTranslation } from "react-i18next";

import { imageProfileLabel } from "@/components/chat/image-generation-profile-label";
import {
  SettingsRow,
  SettingsSection,
  StatusOrError,
} from "@/components/chat/settings-layout";
import {
  PasswordField,
  SettingsButton,
  TextField,
} from "@/components/settings/settings-controls";
import type { PublicImageGenerationProfile } from "@/features/chat/connection-controller";

export interface ImageGenerationConnectionDraft {
  baseUrl: string;
  apiKey: string;
  hasApiKey: boolean;
}

interface ImageGenerationPageProps {
  connectionMode: "byok" | "hosted";
  dirty: boolean;
  draft: ImageGenerationConnectionDraft;
  error: string | null;
  hostedEnabled: boolean;
  hostedProfiles: readonly PublicImageGenerationProfile[];
  onChange: (next: ImageGenerationConnectionDraft) => void;
  onOpenModelService: () => void;
  onSave: () => void;
  saving: boolean;
  status: string | null;
}

export function ImageGenerationPage({
  connectionMode,
  dirty,
  draft,
  error,
  hostedEnabled,
  hostedProfiles,
  onChange,
  onOpenModelService,
  onSave,
  saving,
  status,
}: ImageGenerationPageProps) {
  const { t } = useTranslation();
  const hosted = connectionMode === "hosted";

  return (
    <div className="settings-page-stack">
      <SettingsSection
        description={t("imageGenerationConnectionDescription")}
        icon={Image}
        title={t("imageGenerationConnection")}
      >
        <div className="settings-ui-panel settings-connection-form">
          <SettingsRow
            description={t("imageGenerationConnectionMethodDescription")}
            icon={Cable}
            title={t("connectionMethod")}
          >
            <div className="settings-action-group">
              <span className="settings-inline-value">
                {hosted ? t("useAccessCode") : t("customApi")}
              </span>
              <SettingsButton onClick={onOpenModelService} type="button">
                {t("settingsService")}
                <ArrowRight aria-hidden="true" size={16} />
              </SettingsButton>
            </div>
          </SettingsRow>
          {hosted ? (
            <SettingsRow
              description={
                hostedEnabled
                  ? t("hostedImageGenerationReadyDescription")
                  : t("hostedImageGenerationUnavailableDescription")
              }
              icon={KeyRound}
              title={
                hostedEnabled
                  ? t("hostedImageGenerationReady")
                  : t("hostedImageGenerationUnavailable")
              }
            >
              <div className="settings-field-stack">
                {hostedProfiles.map((profile) => (
                  <span className="settings-inline-value" key={profile.id}>
                    {imageProfileLabel(profile.name, profile.modelId)}
                  </span>
                ))}
                {hostedProfiles.length === 0 ? (
                  <span className="settings-inline-value">
                    {t("notConfigured")}
                  </span>
                ) : null}
              </div>
            </SettingsRow>
          ) : (
            <>
              <SettingsRow
                description={t("imageGenerationUrlsDescription")}
                icon={Link2}
                title={t("imageGenerationUrls")}
              >
                <div className="settings-field-stack">
                  <TextField
                    id="image-generation-base-url"
                    label={t("imageGenerationBaseUrl")}
                    onChange={(event) =>
                      onChange({ ...draft, baseUrl: event.target.value })
                    }
                    spellCheck={false}
                    value={draft.baseUrl}
                  />
                </div>
              </SettingsRow>
              <SettingsRow
                description={t("imageGenerationCredentialDescription")}
                icon={KeyRound}
                title={t("imageGenerationCredential")}
              >
                <div className="settings-field-stack">
                  <PasswordField
                    autoComplete="off"
                    hidePasswordLabel={t("hideApiKey")}
                    id="image-generation-api-key"
                    label={t("apiKey")}
                    onChange={(event) =>
                      onChange({ ...draft, apiKey: event.target.value })
                    }
                    placeholder={draft.hasApiKey ? t("apiKeySaved") : "sk-..."}
                    showPasswordLabel={t("showApiKey")}
                    value={draft.apiKey}
                  />
                </div>
              </SettingsRow>
            </>
          )}
          {!hosted ? (
            <div className="settings-action-row settings-form-actions">
              <StatusOrError error={error} status={status} />
              <SettingsButton
                disabled={!dirty || saving}
                onClick={onSave}
                variant="primary"
              >
                <Save aria-hidden="true" size={16} />
                {saving ? t("saving") : t("saveImageGeneration")}
              </SettingsButton>
            </div>
          ) : null}
        </div>
      </SettingsSection>
    </div>
  );
}
