"use client";

import { Image, KeyRound, Link2, Plus, Save, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
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
import type { PublicImageGenerationProfile } from "@/features/chat/connection-controller";
import type {
  ImageGenerationConfiguration,
  ImageGenerationProfile,
} from "@/runtime/chat/types";

export function ImageGenerationPage({
  connectionMode,
  dirty,
  draft,
  error,
  hostedEnabled,
  hostedProfiles,
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
  hostedProfiles: PublicImageGenerationProfile[];
  onChange: (next: ImageGenerationConfiguration) => void;
  onSave: () => void;
  saving: boolean;
  status: string | null;
}) {
  const { t } = useTranslation();
  const hosted = connectionMode === "hosted";
  const [selectedProfileId, setSelectedProfileId] = useState(
    draft.activeProfileId,
  );
  const selectedProfile = useMemo(
    () =>
      draft.profiles.find(({ id }) => id === selectedProfileId) ??
      draft.profiles.find(({ id }) => id === draft.defaultProfileId) ??
      draft.profiles[0] ??
      null,
    [draft.defaultProfileId, draft.profiles, selectedProfileId],
  );

  const updateProfile = (patch: Partial<ImageGenerationProfile>) => {
    if (!selectedProfile) return;
    onChange({
      ...draft,
      profiles: draft.profiles.map((profile) =>
        profile.id === selectedProfile.id ? { ...profile, ...patch } : profile,
      ),
    });
  };

  const addProfile = () => {
    const id = `image-profile-${crypto.randomUUID()}`;
    const profile: ImageGenerationProfile = {
      id,
      name: t("imageGenerationNewProfile"),
      mode: "byok",
      generationUrl:
        selectedProfile?.generationUrl ??
        "https://api.openai.com/v1/images/generations",
      editUrl:
        selectedProfile?.editUrl ?? "https://api.openai.com/v1/images/edits",
      apiKey: "",
      modelId: "gpt-image-2",
      sizeMode: "auto",
      hasApiKey: false,
    };
    setSelectedProfileId(id);
    onChange({
      ...draft,
      profiles: [...draft.profiles, profile],
    });
  };

  const removeProfile = () => {
    if (!selectedProfile || draft.profiles.length <= 1) return;
    const profiles = draft.profiles.filter(
      ({ id }) => id !== selectedProfile.id,
    );
    const nextId = profiles[0]?.id ?? draft.defaultProfileId;
    setSelectedProfileId(nextId);
    onChange({
      ...draft,
      profiles,
      activeProfileId:
        draft.activeProfileId === selectedProfile.id
          ? nextId
          : draft.activeProfileId,
      defaultProfileId:
        draft.defaultProfileId === selectedProfile.id
          ? nextId
          : draft.defaultProfileId,
    });
  };

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
              <div className="settings-field-stack">
                {hostedProfiles.map((profile) => (
                  <span className="settings-inline-value" key={profile.id}>
                    {profile.name} · {profile.modelId}
                  </span>
                ))}
                {hostedProfiles.length === 0 ? (
                  <span className="settings-inline-value">
                    {t("notConfigured")}
                  </span>
                ) : null}
              </div>
            </SettingsRow>
          ) : selectedProfile ? (
            <>
              <SettingsRow
                description={t("imageGenerationProfileDescription")}
                icon={Image}
                title={t("imageGenerationProfile")}
              >
                <div className="settings-field-stack">
                  <SelectField
                    id="image-generation-profile"
                    label={t("imageGenerationProfile")}
                    onValueChange={setSelectedProfileId}
                    options={draft.profiles.map(({ id, name, modelId }) => ({
                      value: id,
                      label: `${name} · ${modelId}`,
                    }))}
                    value={selectedProfile.id}
                  />
                  <TextField
                    id="image-generation-profile-name"
                    label={t("imageGenerationProfileName")}
                    onChange={(event) =>
                      updateProfile({ name: event.target.value })
                    }
                    value={selectedProfile.name}
                  />
                  <SelectField
                    id="image-generation-default-profile"
                    label={t("imageGenerationDefaultProfile")}
                    onValueChange={(value) =>
                      onChange({ ...draft, defaultProfileId: value })
                    }
                    options={draft.profiles.map(({ id, name }) => ({
                      value: id,
                      label: name,
                    }))}
                    value={draft.defaultProfileId}
                  />
                </div>
              </SettingsRow>
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
                      updateProfile({ generationUrl: event.target.value })
                    }
                    spellCheck={false}
                    value={selectedProfile.generationUrl}
                  />
                  <TextField
                    id="image-edit-url"
                    label={t("imageEditUrl")}
                    onChange={(event) =>
                      updateProfile({ editUrl: event.target.value })
                    }
                    spellCheck={false}
                    value={selectedProfile.editUrl}
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
                      updateProfile({ apiKey: event.target.value })
                    }
                    placeholder={
                      selectedProfile.hasApiKey ? t("apiKeySaved") : "sk-..."
                    }
                    showPasswordLabel={t("showApiKey")}
                    value={selectedProfile.apiKey}
                  />
                  <TextField
                    id="image-generation-model"
                    label={t("imageGenerationModel")}
                    onChange={(event) =>
                      updateProfile({ modelId: event.target.value })
                    }
                    value={selectedProfile.modelId}
                  />
                  <SelectField
                    id="image-generation-size-mode"
                    label={t("imageGenerationSizeMode")}
                    onValueChange={(value) =>
                      updateProfile({
                        sizeMode: value as ImageGenerationProfile["sizeMode"],
                      })
                    }
                    options={[
                      {
                        value: "auto",
                        label: t("imageGenerationCapabilityAuto"),
                      },
                      {
                        value: "custom",
                        label: t("imageGenerationCapabilityCustom"),
                      },
                      {
                        value: "fixed",
                        label: t("imageGenerationCapabilityFixed"),
                      },
                    ]}
                    value={selectedProfile.sizeMode}
                  />
                </div>
              </SettingsRow>
              <div className="settings-action-row settings-form-actions">
                <SettingsButton onClick={addProfile} type="button">
                  <Plus aria-hidden="true" size={16} />
                  {t("imageGenerationAddProfile")}
                </SettingsButton>
                <SettingsButton
                  disabled={draft.profiles.length <= 1}
                  onClick={removeProfile}
                  type="button"
                  variant="secondary"
                >
                  <Trash2 aria-hidden="true" size={16} />
                  {t("imageGenerationRemoveProfile")}
                </SettingsButton>
              </div>
            </>
          ) : null}
        </div>
      </SettingsSection>

      {!hosted ? (
        <>
          <StatusOrError error={error} status={status} />
          <div className="settings-action-row settings-form-actions">
            <SettingsButton
              disabled={!dirty || saving}
              onClick={onSave}
              variant="primary"
            >
              <Save aria-hidden="true" size={16} />
              {saving ? t("saving") : t("saveImageGeneration")}
            </SettingsButton>
          </div>
        </>
      ) : null}
    </div>
  );
}
