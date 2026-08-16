"use client";

import { Image, KeyRound, Link2, Save, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  SettingsRow,
  SettingsSection,
  StatusOrError,
} from "@/components/chat/settings-layout";
import {
  PasswordField,
  SelectField,
  SettingsButton,
  TextField,
} from "@/components/settings/settings-controls";
import type {
  ImageGenerationConfiguration,
  ImageGenerationQuality,
  ImageGenerationSize,
} from "@/runtime/chat/types";

const sizeOptions: Array<{ value: ImageGenerationSize; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "1024x1024", label: "1024 x 1024" },
  { value: "1536x1024", label: "1536 x 1024" },
  { value: "1024x1536", label: "1024 x 1536" },
];

export function ImageGenerationPage({
  connectionMode,
  dirty,
  draft,
  error,
  hostedEnabled,
  hostedModel,
  onChange,
  onSave,
  saving,
  status,
}: {
  connectionMode: "byok" | "hosted";
  dirty: boolean;
  draft: ImageGenerationConfiguration;
  error: string | null;
  hostedEnabled: boolean;
  hostedModel: string | null;
  onChange: (next: ImageGenerationConfiguration) => void;
  onSave: () => void;
  saving: boolean;
  status: string | null;
}) {
  const { t } = useTranslation();
  const hosted = connectionMode === "hosted";
  const qualityOptions: Array<{
    value: ImageGenerationQuality;
    label: string;
  }> = [
    { value: "auto", label: t("imageQualityAuto") },
    { value: "low", label: t("imageQualityLow") },
    { value: "medium", label: t("imageQualityMedium") },
    { value: "high", label: t("imageQualityHigh") },
  ];

  return (
    <div className="settings-page-stack">
      <SettingsSection
        description={t("imageGenerationConnectionDescription")}
        icon={Image}
        title={t("imageGenerationConnection")}
      >
        <div className="settings-ui-panel settings-connection-form">
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
              <span className="settings-inline-value">
                {hostedModel ?? t("notConfigured")}
              </span>
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
                    id="image-generation-url"
                    label={t("imageGenerationUrl")}
                    onChange={(event) =>
                      onChange({ ...draft, generationUrl: event.target.value })
                    }
                    spellCheck={false}
                    value={draft.generationUrl}
                  />
                  <TextField
                    id="image-edit-url"
                    label={t("imageEditUrl")}
                    onChange={(event) =>
                      onChange({ ...draft, editUrl: event.target.value })
                    }
                    spellCheck={false}
                    value={draft.editUrl}
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
                  <TextField
                    id="image-generation-model"
                    label={t("imageGenerationModel")}
                    onChange={(event) =>
                      onChange({ ...draft, modelId: event.target.value })
                    }
                    value={draft.modelId}
                  />
                </div>
              </SettingsRow>
            </>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        description={t("imageGenerationDefaultsDescription")}
        icon={SlidersHorizontal}
        title={t("imageGenerationDefaults")}
      >
        <div className="settings-ui-panel settings-connection-form">
          <SettingsRow
            description={t("imageGenerationSizeDescription")}
            title={t("imageGenerationSize")}
          >
            <SelectField
              id="image-generation-size"
              label={t("imageGenerationSize")}
              onValueChange={(value) =>
                onChange({ ...draft, size: value as ImageGenerationSize })
              }
              options={sizeOptions}
              value={draft.size}
            />
          </SettingsRow>
          <SettingsRow
            description={t("imageGenerationQualityDescription")}
            title={t("imageGenerationQuality")}
          >
            <SelectField
              id="image-generation-quality"
              label={t("imageGenerationQuality")}
              onValueChange={(value) =>
                onChange({ ...draft, quality: value as ImageGenerationQuality })
              }
              options={qualityOptions}
              value={draft.quality}
            />
          </SettingsRow>
        </div>
        <StatusOrError error={error} status={status} />
        <div className="settings-action-row settings-form-actions">
          <SettingsButton
            disabled={!dirty || saving || (hosted && !hostedEnabled)}
            onClick={onSave}
            variant="primary"
          >
            <Save aria-hidden="true" size={16} />
            {saving ? t("saving") : t("saveImageGeneration")}
          </SettingsButton>
        </div>
      </SettingsSection>
    </div>
  );
}
