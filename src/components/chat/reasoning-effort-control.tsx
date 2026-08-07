"use client";

import { Brain, Check, ChevronDown } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  EffectiveModelCapability,
  ReasoningChoice,
} from "@/runtime/chat/types";
import {
  DEFAULT_REASONING_CHOICE,
  getGlmOpenAIChatReasoningVariant,
  getQwenOpenAIChatReasoningVariant,
  isDeepSeekV4OpenAIChatCapability,
  isKimiK3OpenAIChatCapability,
  sameReasoningChoice,
} from "@/runtime/models/effective-model-capabilities";

export interface ReasoningEffortControlProps {
  capability: EffectiveModelCapability | null;
  modelId: string;
  value: ReasoningChoice;
  disabled: boolean;
  onValueChange: (value: ReasoningChoice) => void;
}

export function ReasoningEffortControl({
  capability,
  modelId,
  value,
  disabled,
  onValueChange,
}: ReasoningEffortControlProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (
    capability?.modelId !== modelId ||
    capability.reasoningControl.kind === "none"
  ) {
    return null;
  }

  if (capability.reasoningControl.kind === "fixed") {
    return (
      <div className="reasoning-control-root" data-availability="automatic">
        <span
          aria-label={t("automaticReasoning")}
          className="reasoning-control-trigger reasoning-control-automatic"
          role="status"
        >
          <Brain
            aria-hidden="true"
            className="reasoning-control-icon"
            size={15}
          />
          <span className="reasoning-control-label">
            {t("automaticReasoning")}
          </span>
        </span>
      </div>
    );
  }

  const options: readonly ReasoningChoice[] =
    capability.reasoningControl.kind === "switch"
      ? [
          DEFAULT_REASONING_CHOICE,
          ...capability.reasoningControl.options.map((mode) => ({ mode })),
        ]
      : capability.reasoningControl.options;
  const glmVariant = getGlmOpenAIChatReasoningVariant(capability);
  const qwenVariant = getQwenOpenAIChatReasoningVariant(capability);
  const defaultOptionLabel = isDeepSeekV4OpenAIChatCapability(capability)
    ? t("deepSeekProviderDefault")
    : glmVariant === "glm-5.2"
      ? t("glm52ProviderDefault")
      : glmVariant === "switch"
        ? t("glmSwitchProviderDefault")
        : qwenVariant === "qwen3.8-max" || qwenVariant === "qwen3.8-max-preview"
          ? t("qwen38ProviderDefault")
          : qwenVariant === "hybrid-default-on"
            ? t("qwenDefaultOnProviderDefault")
            : qwenVariant === "hybrid-default-off"
              ? t("qwenDefaultOffProviderDefault")
              : isKimiK3OpenAIChatCapability(capability)
                ? t("kimiK3ProviderDefault")
                : t("providerDefault");
  const selected =
    options.find((option) => sameReasoningChoice(option, value)) ??
    DEFAULT_REASONING_CHOICE;
  const selectedOptionLabel = reasoningChoiceLabel(
    selected,
    t,
    defaultOptionLabel,
  );
  const triggerLabel =
    selected.mode === "default" ? t("providerDefault") : selectedOptionLabel;

  const selectChoice = (nextValue: ReasoningChoice) => {
    if (disabled) return;
    onValueChange(nextValue);
    setOpen(false);
  };

  return (
    <div className="reasoning-control-root" data-availability="adjustable">
      <Popover.Root
        onOpenChange={(nextOpen) => {
          if (nextOpen && disabled) return;
          setOpen(nextOpen);
        }}
        open={open}
      >
        <Popover.Trigger asChild>
          <button
            aria-label={`${t("reasoningEffort")}: ${selectedOptionLabel}`}
            className="reasoning-control-trigger"
            disabled={disabled}
            name="reasoningEffort"
            type="button"
          >
            <Brain
              aria-hidden="true"
              className="reasoning-control-icon"
              size={15}
            />
            <span className="reasoning-control-label">{triggerLabel}</span>
            <ChevronDown
              aria-hidden="true"
              className="reasoning-control-chevron"
              size={12}
              strokeWidth={2.5}
            />
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            align="end"
            aria-label={t("reasoningEffort")}
            className="reasoning-control-popover"
            collisionPadding={8}
            sideOffset={8}
          >
            <div
              aria-label={t("reasoningEffort")}
              className="reasoning-control-list"
              role="listbox"
            >
              <ReasoningOption
                disabled={disabled}
                label={defaultOptionLabel}
                onSelect={() => selectChoice(DEFAULT_REASONING_CHOICE)}
                selected={selected.mode === "default"}
              />
              {options.slice(1).map((option) => (
                <ReasoningOption
                  disabled={disabled}
                  key={reasoningChoiceKey(option)}
                  label={reasoningChoiceLabel(option, t, defaultOptionLabel)}
                  onSelect={() => selectChoice(option)}
                  selected={sameReasoningChoice(selected, option)}
                />
              ))}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

function reasoningChoiceKey(choice: ReasoningChoice): string {
  return choice.mode === "effort"
    ? `${choice.mode}:${choice.effort}`
    : choice.mode;
}

function reasoningChoiceLabel(
  choice: ReasoningChoice,
  t: ReturnType<typeof useTranslation>["t"],
  defaultLabel: string,
): string {
  if (choice.mode === "default") return defaultLabel;
  if (choice.mode === "effort") {
    return t(`effort.${choice.effort}`, { defaultValue: choice.effort });
  }
  return t(`effort.${choice.mode}`, { defaultValue: choice.mode });
}

function ReasoningOption({
  disabled,
  label,
  onSelect,
  selected,
}: {
  disabled: boolean;
  label: string;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <button
      aria-selected={selected}
      className="reasoning-control-option"
      disabled={disabled}
      onClick={onSelect}
      role="option"
      type="button"
    >
      <span className="reasoning-control-option-label">{label}</span>
      {selected ? (
        <Check
          aria-hidden="true"
          className="reasoning-control-option-check"
          size={13}
        />
      ) : null}
    </button>
  );
}
