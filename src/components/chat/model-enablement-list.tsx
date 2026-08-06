"use client";

import { Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ModelIcon } from "@/components/chat/model-icon";
import {
  CheckboxControl,
  SettingsButton,
} from "@/components/settings/settings-controls";

export interface ModelEnablementListProps {
  models: readonly string[];
  enabledModels: readonly string[];
  requiredModels: readonly string[];
  disabled?: boolean;
  onEnabledModelsChange: (models: string[]) => void;
}

export function ModelEnablementList({
  models,
  enabledModels,
  requiredModels,
  disabled = false,
  onEnabledModelsChange,
}: ModelEnablementListProps) {
  const { t } = useTranslation();
  const id = useId();
  const [query, setQuery] = useState("");
  const availableModels = useMemo(
    () => uniqueModels([...requiredModels, ...enabledModels, ...models]),
    [enabledModels, models, requiredModels],
  );
  const enabled = useMemo(
    () => new Set(uniqueModels(enabledModels)),
    [enabledModels],
  );
  const required = useMemo(
    () => new Set(uniqueModels(requiredModels)),
    [requiredModels],
  );
  const onlyRequiredModelsEnabled =
    enabled.size === required.size &&
    Array.from(enabled).every((modelId) => required.has(modelId));
  const filteredModels = useMemo(() => {
    const normalizedQuery = query.normalize("NFKC").trim().toLocaleLowerCase();
    if (!normalizedQuery) return availableModels;
    return availableModels.filter((modelId) =>
      modelId.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [availableModels, query]);

  const updateModel = (modelId: string, checked: boolean) => {
    const next = new Set(enabled);
    if (checked) next.add(modelId);
    else next.delete(modelId);
    onEnabledModelsChange(
      availableModels.filter((availableModel) => next.has(availableModel)),
    );
  };

  return (
    <div className="model-enablement">
      <div className="model-enablement-toolbar">
        <div className="model-enablement-search">
          <Search aria-hidden="true" size={16} />
          <input
            aria-label={t("searchDiscoveredModels")}
            disabled={disabled}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchDiscoveredModels")}
            type="search"
            value={query}
          />
        </div>
        <span className="model-enablement-count">
          {t("enabledModelCount", {
            enabled: enabled.size,
            total: availableModels.length,
          })}
        </span>
      </div>

      <div className="model-enablement-actions">
        <SettingsButton
          disabled={disabled || enabled.size === availableModels.length}
          onClick={() => onEnabledModelsChange(availableModels)}
          type="button"
        >
          {t("enableAllModels")}
        </SettingsButton>
        <SettingsButton
          disabled={disabled || onlyRequiredModelsEnabled}
          onClick={() =>
            onEnabledModelsChange(
              availableModels.filter((modelId) => required.has(modelId)),
            )
          }
          type="button"
        >
          {t("keepModelsInUse")}
        </SettingsButton>
      </div>

      <div
        aria-label={t("chooseEnabledModels")}
        className="model-enablement-list"
        role="group"
      >
        {filteredModels.length > 0 ? (
          filteredModels.map((modelId, index) => {
            const requiredModel = required.has(modelId);
            const lastEnabledModel = enabled.has(modelId) && enabled.size === 1;
            return (
              <div className="model-enablement-item" key={modelId}>
                <ModelIcon modelId={modelId} size={20} />
                <span className="model-enablement-name">{modelId}</span>
                {requiredModel ? (
                  <span className="model-enablement-required">
                    {t("modelInUse")}
                  </span>
                ) : null}
                <CheckboxControl
                  checked={enabled.has(modelId)}
                  disabled={disabled || lastEnabledModel}
                  id={`${id}-${index}`}
                  label={t("enableModel", { model: modelId })}
                  onCheckedChange={(checked) => updateModel(modelId, checked)}
                />
              </div>
            );
          })
        ) : (
          <p className="model-selector-empty" role="status">
            {t("noModelsFound")}
          </p>
        )}
      </div>
    </div>
  );
}

function uniqueModels(models: readonly string[]): string[] {
  return Array.from(
    new Set(
      models.map((modelId) => modelId.normalize("NFKC").trim()).filter(Boolean),
    ),
  );
}
