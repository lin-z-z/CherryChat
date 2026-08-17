"use client";

import { ChevronDown } from "lucide-react";
import { Popover } from "radix-ui";
import { useId, useState } from "react";

import {
  SelectControl,
  type SettingsSelectOption,
} from "@/components/settings/settings-controls";
import { cn } from "@/lib/cn";

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
