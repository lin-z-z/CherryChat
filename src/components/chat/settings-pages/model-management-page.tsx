"use client";

import {
  Activity,
  BrainCircuit,
  CircleAlert,
  Gauge,
  Image as ImageIcon,
  LoaderCircle,
  RotateCcw,
  SlidersHorizontal,
  Star,
  Tags,
  Thermometer,
  Type,
  Wrench,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { type ModelSettingsForm } from "@/components/chat/model-settings-form";
import { ModelSelector } from "@/components/chat/model-selector";
import {
  CapabilityRow,
  OptionalNumberControl,
  SettingsSection,
  StatusOrError,
} from "@/components/chat/settings-layout";
import {
  SettingsButton,
  SettingsField,
  SwitchControl,
  type SettingsSelectOption,
} from "@/components/settings/settings-controls";

export function ModelManagementPage({
  modelOptions,
  defaultModel,
  defaultModelDirty,
  defaultModelSaving,
  defaultModelError,
  defaultModelStatus,
  titleModel,
  titleModelDirty,
  titleModelSaving,
  titleModelError,
  titleModelStatus,
  selectedModel,
  capability,
  capabilityDirty,
  capabilityLoading,
  capabilitySaving,
  capabilityError,
  capabilityStatus,
  onDefaultModelChange,
  onTitleModelChange,
  onSaveDefaultModel,
  onSaveTitleModel,
  onSelectedModelChange,
  onCapabilityChange,
  onSaveCapability,
  onResetCapability,
}: {
  modelOptions: readonly SettingsSelectOption[];
  defaultModel: string;
  defaultModelDirty: boolean;
  defaultModelSaving: boolean;
  defaultModelError: string | null;
  defaultModelStatus: string | null;
  titleModel: string;
  titleModelDirty: boolean;
  titleModelSaving: boolean;
  titleModelError: string | null;
  titleModelStatus: string | null;
  selectedModel: string;
  capability: ModelSettingsForm | null;
  capabilityDirty: boolean;
  capabilityLoading: boolean;
  capabilitySaving: boolean;
  capabilityError: string | null;
  capabilityStatus: string | null;
  onDefaultModelChange: (modelId: string) => void;
  onTitleModelChange: (modelId: string) => void;
  onSaveDefaultModel: () => void;
  onSaveTitleModel: () => void;
  onSelectedModelChange: (modelId: string) => void;
  onCapabilityChange: (capability: ModelSettingsForm) => void;
  onSaveCapability: () => void;
  onResetCapability: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <SettingsSection
        description={t("modelRolesDescription")}
        icon={Star}
        title={t("modelRoles")}
      >
        <div className="settings-ui-panel settings-default-model-panel">
          <div className="settings-default-model-form settings-model-role-row">
            <SettingsField
              description={t("defaultModelRowDescription")}
              htmlFor="settings-default-model"
              label={t("defaultModel")}
            >
              <ModelSelector
                ariaLabel={t("defaultModel")}
                disabled={defaultModelSaving}
                id="settings-default-model"
                models={modelOptions.map(({ value }) => value)}
                onValueChange={onDefaultModelChange}
                value={defaultModel}
                variant="settings"
              />
            </SettingsField>
            <SettingsButton
              aria-busy={defaultModelSaving}
              className="settings-default-model-save"
              disabled={defaultModelSaving || !defaultModelDirty}
              onClick={onSaveDefaultModel}
              type="button"
              variant="primary"
            >
              {defaultModelSaving ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="pending-spinner"
                  size={16}
                />
              ) : null}
              {t("saveDefaultModel")}
            </SettingsButton>
          </div>
          <StatusOrError
            error={defaultModelError}
            status={defaultModelStatus}
          />
          <div className="settings-model-role-row">
            <SettingsField
              description={t("titleModelRowDescription")}
              htmlFor="settings-title-model"
              label={t("titleModel")}
            >
              <ModelSelector
                ariaLabel={t("titleModel")}
                disabled={titleModelSaving}
                id="settings-title-model"
                models={modelOptions.map(({ value }) => value)}
                onValueChange={onTitleModelChange}
                value={titleModel}
                variant="settings"
              />
            </SettingsField>
            <SettingsButton
              aria-busy={titleModelSaving}
              className="settings-default-model-save"
              disabled={titleModelSaving || !titleModelDirty}
              onClick={onSaveTitleModel}
              type="button"
              variant="primary"
            >
              {titleModelSaving ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="pending-spinner"
                  size={16}
                />
              ) : (
                <Tags aria-hidden="true" size={16} />
              )}
              {t("saveTitleModel")}
            </SettingsButton>
          </div>
          <StatusOrError error={titleModelError} status={titleModelStatus} />
        </div>
      </SettingsSection>

      <SettingsSection
        description={t("modelCompatibilityDescription")}
        icon={SlidersHorizontal}
        title={t("modelCompatibility")}
      >
        <div className="settings-ui-panel">
          <div className="settings-form-block settings-model-picker">
            <SettingsField
              description={t("selectedModelDescription")}
              htmlFor="settings-selected-model"
              label={t("settingsSelectedModel")}
            >
              <ModelSelector
                ariaLabel={t("settingsSelectedModel")}
                disabled={capabilitySaving}
                id="settings-selected-model"
                models={modelOptions.map(({ value }) => value)}
                onValueChange={onSelectedModelChange}
                value={selectedModel}
                variant="settings"
              />
            </SettingsField>
            {capability ? (
              <p
                className="settings-model-source"
                data-source={capability.source}
                role="status"
              >
                <span aria-hidden="true" />
                {capability.source === "user"
                  ? t("modelSettingsSourceCustom")
                  : capability.source === "builtin"
                    ? t("modelSettingsSourceBuiltin")
                    : capability.source === "catalog"
                      ? t("modelSettingsSourceCatalog")
                      : t("modelSettingsSourceInferred")}
              </p>
            ) : null}
            {capability?.endpointLimited ? (
              <p className="settings-endpoint-limit-note" role="status">
                <CircleAlert aria-hidden="true" size={15} />
                {t("modelEndpointLimitDescription")}
              </p>
            ) : null}
          </div>

          {capabilityLoading ? (
            <div className="settings-loading-state" role="status">
              <LoaderCircle
                aria-hidden="true"
                className="pending-spinner"
                size={18}
              />
              {t("loadingModelSettings")}
            </div>
          ) : capability ? (
            <div className="settings-capability-form">
              <CapabilityRow
                description={t("reasoningCapabilityDescription")}
                icon={BrainCircuit}
                title={t("reasoningCapability")}
              >
                <SwitchControl
                  checked={capability.reasoning}
                  id="settings-reasoning-capability"
                  label={t("reasoningCapability")}
                  onCheckedChange={(reasoning) =>
                    onCapabilityChange({
                      ...capability,
                      reasoning,
                      supportedEfforts: reasoning
                        ? capability.supportedEfforts ||
                          capability.automaticSupportedEfforts
                        : capability.supportedEfforts,
                    })
                  }
                />
              </CapabilityRow>
              <CapabilityRow
                description={t("visionCapabilityDescription")}
                icon={ImageIcon}
                title={t("visionCapability")}
              >
                <SwitchControl
                  checked={capability.vision}
                  id="settings-vision-capability"
                  label={t("visionCapability")}
                  onCheckedChange={(vision) =>
                    onCapabilityChange({ ...capability, vision })
                  }
                />
              </CapabilityRow>
              <CapabilityRow
                description={t("toolCapabilityDescription")}
                icon={Wrench}
                title={t("toolCapability")}
              >
                <SwitchControl
                  checked={capability.tools}
                  id="settings-tool-capability"
                  label={t("toolCapability")}
                  onCheckedChange={(tools) =>
                    onCapabilityChange({ ...capability, tools })
                  }
                />
              </CapabilityRow>
              {capability.reasoning ? (
                <CapabilityRow
                  description={
                    capability.reasoningParameterAvailable
                      ? t("supportedEffortsDescription")
                      : t("modelReasoningEndpointLimitDescription")
                  }
                  icon={BrainCircuit}
                  title={t("supportedEfforts")}
                >
                  <input
                    aria-label={t("supportedEfforts")}
                    className="settings-control settings-capability-text"
                    id="settings-supported-efforts"
                    onChange={(event) =>
                      onCapabilityChange({
                        ...capability,
                        supportedEfforts: event.target.value,
                      })
                    }
                    placeholder={t("supportedEffortsPlaceholder")}
                    value={capability.supportedEfforts}
                  />
                </CapabilityRow>
              ) : null}
              <CapabilityRow
                description={t("contextWindowDescription")}
                icon={Type}
                title={t("contextWindow")}
              >
                <input
                  aria-label={t("contextWindow")}
                  className="settings-control settings-capability-number"
                  id="settings-context-window"
                  min={1024}
                  onChange={(event) =>
                    onCapabilityChange({
                      ...capability,
                      contextWindow: Number(event.target.value),
                    })
                  }
                  type="number"
                  value={capability.contextWindow}
                />
              </CapabilityRow>
              <CapabilityRow
                description={
                  capability.streamingAvailable
                    ? t("modelStreamingDescription")
                    : t("modelParameterUnsupported")
                }
                icon={Activity}
                title={t("modelStreaming")}
              >
                <SwitchControl
                  checked={capability.preferences.streaming}
                  disabled={!capability.streamingAvailable}
                  id="settings-streaming"
                  label={t("modelStreaming")}
                  onCheckedChange={(streaming) =>
                    onCapabilityChange({
                      ...capability,
                      preferences: {
                        ...capability.preferences,
                        streaming,
                      },
                    })
                  }
                />
              </CapabilityRow>
              <CapabilityRow
                description={
                  capability.temperatureAvailable
                    ? t("modelTemperatureDescription")
                    : t("modelParameterUnsupported")
                }
                icon={Thermometer}
                title={t("modelTemperature")}
              >
                <OptionalNumberControl
                  enabled={capability.preferences.temperature.enabled}
                  disabled={!capability.temperatureAvailable}
                  id="settings-temperature"
                  max={2}
                  min={0}
                  onChange={(temperature) =>
                    onCapabilityChange({
                      ...capability,
                      preferences: {
                        ...capability.preferences,
                        temperature,
                      },
                    })
                  }
                  sliderLabel={t("modelTemperatureSlider")}
                  step={0.1}
                  toggleLabel={t("enableModelTemperature")}
                  value={capability.preferences.temperature.value}
                  valueLabel={t("modelTemperatureValue")}
                />
              </CapabilityRow>
              <CapabilityRow
                description={
                  capability.topPAvailable
                    ? t("modelTopPDescription")
                    : t("modelParameterUnsupported")
                }
                icon={Gauge}
                title={t("modelTopP")}
              >
                <OptionalNumberControl
                  enabled={capability.preferences.topP.enabled}
                  disabled={!capability.topPAvailable}
                  id="settings-top-p"
                  max={1}
                  min={0}
                  onChange={(topP) =>
                    onCapabilityChange({
                      ...capability,
                      preferences: {
                        ...capability.preferences,
                        topP,
                      },
                    })
                  }
                  sliderLabel={t("modelTopPSlider")}
                  step={0.05}
                  toggleLabel={t("enableModelTopP")}
                  value={capability.preferences.topP.value}
                  valueLabel={t("modelTopPValue")}
                />
              </CapabilityRow>
            </div>
          ) : (
            <p className="settings-loading-state">{t("selectModelError")}</p>
          )}

          <div className="settings-action-row settings-form-actions">
            <span className="settings-status-line">
              {capabilityDirty ? t("unsavedModelChanges") : capabilityStatus}
            </span>
            <div className="settings-action-group">
              <SettingsButton
                disabled={capabilitySaving || capabilityLoading || !capability}
                onClick={onResetCapability}
                type="button"
              >
                <RotateCcw aria-hidden="true" size={16} />
                {t("resetModelSettings")}
              </SettingsButton>
              <SettingsButton
                aria-busy={capabilitySaving}
                disabled={
                  capabilitySaving ||
                  capabilityLoading ||
                  !capability ||
                  !capabilityDirty
                }
                onClick={onSaveCapability}
                type="button"
                variant="primary"
              >
                {capabilitySaving ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="pending-spinner"
                    size={16}
                  />
                ) : null}
                {t("saveModelSettings")}
              </SettingsButton>
            </div>
          </div>
          {capabilityError ? (
            <p
              className="settings-local-error settings-inline-error"
              role="alert"
            >
              {capabilityError}
            </p>
          ) : null}
        </div>
      </SettingsSection>
    </>
  );
}
