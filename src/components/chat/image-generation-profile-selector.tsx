"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  ModelSelector,
  type ModelSelectorItem,
} from "@/components/chat/model-selector";
import type { ImageGenerationProfile } from "@/runtime/chat/types";

export interface ImageGenerationProfileSelectorProps {
  profiles: readonly Pick<ImageGenerationProfile, "id" | "name" | "modelId">[];
  value: string;
  disabled: boolean;
  onValueChange: (value: string) => void;
}

export function ImageGenerationProfileSelector({
  profiles,
  value,
  disabled,
  onValueChange,
}: ImageGenerationProfileSelectorProps) {
  const { t } = useTranslation();
  const selectedProfile = profiles.find((profile) => profile.id === value);
  const items = useMemo<readonly ModelSelectorItem[]>(
    () =>
      profiles.map((profile) => ({
        value: profile.id,
        label: profile.name,
        modelId: profile.modelId,
        description: profile.modelId,
        ariaLabel: `${profile.name} \u00b7 ${profile.modelId}`,
      })),
    [profiles],
  );
  const triggerLabel = selectedProfile
    ? `${selectedProfile.name} \u00b7 ${selectedProfile.modelId}`
    : t("imageGenerationProfile");

  return (
    <ModelSelector
      ariaLabel={`${t("imageGenerationProfile")}: ${triggerLabel}`}
      disabled={disabled}
      items={items}
      listAriaLabel={t("imageGenerationProfile")}
      models={[]}
      onValueChange={onValueChange}
      popoverClassName="image-generation-profile-popover"
      searchAriaLabel={t("imageGenerationProfile")}
      triggerClassName="image-generation-profile-trigger"
      triggerLabel={triggerLabel}
      value={value}
    />
  );
}
