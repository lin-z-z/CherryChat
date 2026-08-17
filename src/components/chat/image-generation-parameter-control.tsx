"use client";

import { ChevronDown, X } from "lucide-react";
import { Dialog, Popover } from "radix-ui";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  SelectControl,
  type SettingsSelectOption,
} from "@/components/settings/settings-controls";
import { cn } from "@/lib/cn";
import type {
  ImageGenerationAspectRatio,
  ImageGenerationParameters,
  ImageGenerationResolutionTier,
} from "@/runtime/chat/types";
import {
  calculateImageGenerationSize,
  isValidImageGenerationSize,
  normalizeImageGenerationSize,
} from "@/runtime/image-generation/image-generation-options";

export type ImageGenerationParameterOption = SettingsSelectOption;

export interface ImageGenerationParameterControlProps {
  ariaLabel: string;
  value: string;
  options: readonly ImageGenerationParameterOption[];
  disabled: boolean;
  onValueChange: (value: string) => void;
  className?: string;
}

export function ImageGenerationParameterControl({
  ariaLabel,
  value,
  options,
  disabled,
  onValueChange,
  className,
}: ImageGenerationParameterControlProps) {
  return (
    <SelectControl
      aria-label={ariaLabel}
      className={cn("image-parameter-trigger", className)}
      disabled={disabled}
      onValueChange={onValueChange}
      options={options}
      value={value}
    />
  );
}

type ImageSizeMode = "auto" | "ratio" | "custom";

export interface ImageGenerationSizeControlProps {
  ariaLabel: string;
  capabilities: {
    customSizes: boolean;
    resolutionTiers: readonly ImageGenerationResolutionTier[];
    aspectRatios: readonly ImageGenerationAspectRatio[];
  };
  disabled: boolean;
  parameters: ImageGenerationParameters;
  onSelectSize: (size: string) => void;
}

interface ImageSizeDraft {
  mode: ImageSizeMode;
  tier: Exclude<ImageGenerationResolutionTier, "auto">;
  ratio: ImageGenerationAspectRatio;
  width: string;
  height: string;
}

const SIZE_RATIOS: readonly ImageGenerationAspectRatio[] = [
  "1:1",
  "3:2",
  "2:3",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "21:9",
];

function parseSize(value: string): { width: string; height: string } | null {
  const match = /^(\d+)x(\d+)$/u.exec(value);
  return match ? { width: match[1] ?? "", height: match[2] ?? "" } : null;
}

function presetForSize(
  size: string,
  tiers: readonly Exclude<ImageGenerationResolutionTier, "auto">[],
  ratios: readonly ImageGenerationAspectRatio[],
): Pick<ImageSizeDraft, "tier" | "ratio"> | null {
  for (const tier of tiers) {
    for (const ratio of ratios) {
      if (calculateImageGenerationSize(tier, ratio) === size) {
        return { tier, ratio };
      }
    }
  }
  return null;
}

function draftFromParameters(
  parameters: ImageGenerationParameters,
  capabilities: ImageGenerationSizeControlProps["capabilities"],
): ImageSizeDraft {
  const tiers = capabilities.resolutionTiers.filter(
    (tier): tier is Exclude<ImageGenerationResolutionTier, "auto"> =>
      tier !== "auto",
  );
  const ratios = capabilities.aspectRatios.filter((ratio) =>
    SIZE_RATIOS.includes(ratio),
  );
  const fallbackTier = tiers[0] ?? "1K";
  const fallbackRatio = ratios[0] ?? "1:1";
  if (parameters.size === "auto") {
    return {
      mode: "auto",
      tier: fallbackTier,
      ratio: fallbackRatio,
      width: "1024",
      height: "1024",
    };
  }
  const preset = presetForSize(parameters.size, tiers, ratios);
  if (preset) {
    return {
      mode: "ratio",
      tier: preset.tier,
      ratio: preset.ratio,
      width: parseSize(parameters.size)?.width ?? "1024",
      height: parseSize(parameters.size)?.height ?? "1024",
    };
  }
  const parsed = parseSize(parameters.size);
  return {
    mode: capabilities.customSizes ? "custom" : "ratio",
    tier: fallbackTier,
    ratio: fallbackRatio,
    width: parsed?.width ?? "1024",
    height: parsed?.height ?? "1024",
  };
}

export function ImageGenerationSizeControl({
  ariaLabel,
  capabilities,
  disabled,
  parameters,
  onSelectSize,
}: ImageGenerationSizeControlProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ImageSizeDraft>(() =>
    draftFromParameters(parameters, capabilities),
  );

  const availableTiers = capabilities.resolutionTiers.filter(
    (tier): tier is Exclude<ImageGenerationResolutionTier, "auto"> =>
      tier !== "auto",
  );
  const availableRatios = capabilities.aspectRatios.filter((ratio) =>
    SIZE_RATIOS.includes(ratio),
  );
  const previewSize = useMemo(() => {
    if (draft.mode === "auto") return "auto";
    if (draft.mode === "ratio") {
      return calculateImageGenerationSize(draft.tier, draft.ratio);
    }
    const normalized = normalizeImageGenerationSize(
      `${draft.width}x${draft.height}`,
    );
    return isValidImageGenerationSize(normalized) ? normalized : "";
  }, [draft]);

  const apply = () => {
    if (previewSize) {
      onSelectSize(previewSize);
      setOpen(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (disabled) return;
        if (nextOpen) setDraft(draftFromParameters(parameters, capabilities));
        setOpen(nextOpen);
      }}
    >
      <Dialog.Trigger asChild>
        <button
          aria-label={`${ariaLabel}: ${parameters.size}`}
          className="image-parameter-trigger image-size-trigger"
          disabled={disabled}
          type="button"
        >
          <span>{parameters.size}</span>
          <ChevronDown aria-hidden="true" size={12} strokeWidth={2.5} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop image-size-dialog-backdrop" />
        <Dialog.Content
          aria-describedby="image-generation-size-description"
          className="image-size-dialog"
        >
          <div className="image-size-dialog-header">
            <div>
              <Dialog.Title className="image-size-dialog-title">
                {t("imageGenerationSizeDialogTitle")}
              </Dialog.Title>
              <Dialog.Description
                className="image-size-dialog-description"
                id="image-generation-size-description"
              >
                {t("imageGenerationCurrentSize", { size: parameters.size })}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label={t("close")}
                className="icon-button image-size-dialog-close"
                type="button"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </Dialog.Close>
          </div>

          <div className="image-size-mode-tabs" role="tablist">
            {capabilities.resolutionTiers.includes("auto") ? (
              <button
                aria-selected={draft.mode === "auto"}
                className={cn(
                  "image-size-mode-tab",
                  draft.mode === "auto" && "is-active",
                )}
                onClick={() =>
                  setDraft((current) => ({ ...current, mode: "auto" }))
                }
                role="tab"
                type="button"
              >
                {t("imageGenerationSizeModeAuto")}
              </button>
            ) : null}
            <button
              aria-selected={draft.mode === "ratio"}
              className={cn(
                "image-size-mode-tab",
                draft.mode === "ratio" && "is-active",
              )}
              onClick={() =>
                setDraft((current) => ({ ...current, mode: "ratio" }))
              }
              role="tab"
              type="button"
            >
              {t("imageGenerationSizeModeRatio")}
            </button>
            {capabilities.customSizes ? (
              <button
                aria-selected={draft.mode === "custom"}
                className={cn(
                  "image-size-mode-tab",
                  draft.mode === "custom" && "is-active",
                )}
                onClick={() =>
                  setDraft((current) => ({ ...current, mode: "custom" }))
                }
                role="tab"
                type="button"
              >
                {t("imageGenerationSizeModeCustom")}
              </button>
            ) : null}
          </div>

          <div className="image-size-dialog-body">
            {draft.mode === "auto" ? (
              <div className="image-size-auto-state">
                <div className="image-size-auto-mark" aria-hidden="true">
                  ✦
                </div>
                <strong>{t("imageGenerationSizeModeAuto")}</strong>
                <p>{t("imageGenerationAutoDescription")}</p>
              </div>
            ) : null}

            {draft.mode === "ratio" ? (
              <div className="image-size-ratio-state">
                <section>
                  <h3>{t("imageGenerationBaseResolution")}</h3>
                  <div className="image-size-tier-grid">
                    {availableTiers.map((tier) => (
                      <button
                        aria-pressed={draft.tier === tier}
                        className={cn(
                          "image-size-choice",
                          draft.tier === tier && "is-active",
                        )}
                        key={tier}
                        onClick={() =>
                          setDraft((current) => ({ ...current, tier }))
                        }
                        type="button"
                      >
                        {tier}
                      </button>
                    ))}
                  </div>
                </section>
                <section>
                  <h3>{t("imageGenerationAspectRatio")}</h3>
                  <div className="image-size-ratio-grid">
                    {availableRatios.map((ratio) => {
                      const [widthValue = "1", heightValue = "1"] =
                        ratio.split(":");
                      const width = Number(widthValue);
                      const height = Number(heightValue);
                      const horizontal = width > height;
                      const square = width === height;
                      return (
                        <button
                          aria-pressed={draft.ratio === ratio}
                          className={cn(
                            "image-size-choice image-size-ratio-choice",
                            draft.ratio === ratio && "is-active",
                          )}
                          key={ratio}
                          onClick={() =>
                            setDraft((current) => ({ ...current, ratio }))
                          }
                          type="button"
                        >
                          <span
                            aria-hidden="true"
                            className="image-size-ratio-preview"
                            style={{
                              aspectRatio: `${width} / ${height}`,
                              height:
                                horizontal || square ? "1.35rem" : "1.55rem",
                              width:
                                horizontal || square ? "1.55rem" : "1.05rem",
                            }}
                          />
                          <span>{ratio}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>
            ) : null}

            {draft.mode === "custom" ? (
              <div className="image-size-custom-state">
                <h3>{t("imageGenerationCustomSize")}</h3>
                <div className="image-size-custom-fields">
                  <label>
                    <span>{t("imageGenerationCustomWidth")}</span>
                    <input
                      aria-label={t("imageGenerationCustomWidth")}
                      inputMode="numeric"
                      onChange={(event) => {
                        const width = event.currentTarget.value;
                        setDraft((current) => ({
                          ...current,
                          width,
                        }));
                      }}
                      type="number"
                      value={draft.width}
                    />
                  </label>
                  <span
                    className="image-size-custom-separator"
                    aria-hidden="true"
                  >
                    ×
                  </span>
                  <label>
                    <span>{t("imageGenerationCustomHeight")}</span>
                    <input
                      aria-label={t("imageGenerationCustomHeight")}
                      inputMode="numeric"
                      onChange={(event) => {
                        const height = event.currentTarget.value;
                        setDraft((current) => ({
                          ...current,
                          height,
                        }));
                      }}
                      type="number"
                      value={draft.height}
                    />
                  </label>
                </div>
                <p>{t("imageGenerationSizeLimits")}</p>
              </div>
            ) : null}
          </div>

          <div className="image-size-preview">
            <span>{t("imageGenerationUseSize")}</span>
            <strong>{previewSize || t("imageGenerationInvalidSize")}</strong>
          </div>
          <div className="image-size-dialog-actions">
            <Dialog.Close asChild>
              <button className="secondary-button" type="button">
                {t("cancel")}
              </button>
            </Dialog.Close>
            <button
              className="primary-button"
              disabled={!previewSize}
              onClick={apply}
              type="button"
            >
              {t("confirm")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface ImageGenerationCompressionControlProps {
  ariaLabel: string;
  value: number;
  disabled: boolean;
  onValueChange: (value: number) => void;
}

export function ImageGenerationCompressionControl({
  ariaLabel,
  value,
  disabled,
  onValueChange,
}: ImageGenerationCompressionControlProps) {
  const [open, setOpen] = useState(false);
  const inputId = useId();
  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => setOpen(!disabled && nextOpen)}
    >
      <Popover.Trigger asChild>
        <button
          aria-label={`${ariaLabel}: ${value}%`}
          className="image-parameter-trigger"
          disabled={disabled}
          type="button"
        >
          <span>{value}%</span>
          <ChevronDown aria-hidden="true" size={12} strokeWidth={2.5} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          aria-label={ariaLabel}
          className="image-generation-popover image-compression-popover"
          collisionPadding={8}
          sideOffset={6}
        >
          <label className="image-compression-label" htmlFor={inputId}>
            {ariaLabel}
          </label>
          <input
            aria-label={ariaLabel}
            className="image-compression-input"
            id={inputId}
            max={100}
            min={0}
            onChange={(event) => {
              const nextValue = event.currentTarget.valueAsNumber;
              if (!Number.isFinite(nextValue)) return;
              onValueChange(Math.min(100, Math.max(0, Math.round(nextValue))));
            }}
            type="number"
            value={value}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
