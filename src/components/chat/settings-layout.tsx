"use client";

import type { LucideIcon } from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";

import {
  RangeControl,
  SwitchControl,
} from "@/components/settings/settings-controls";
import { cn } from "@/lib/cn";

export function SettingsSection({
  title,
  description,
  icon: Icon,
  action,
  tone = "default",
  children,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  action?: ReactNode;
  tone?: "default" | "danger";
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "settings-ui-section",
        tone === "danger" && "settings-ui-section-danger",
      )}
    >
      <header className="settings-ui-section-heading">
        <span className="settings-section-icon">
          <Icon aria-hidden="true" size={18} />
        </span>
        <div className="settings-section-copy">
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {action ? (
          <div className="settings-section-action">{action}</div>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  icon: Icon,
  className,
  children,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("settings-ui-row", className)}>
      <div className="settings-ui-row-copy">
        {Icon ? (
          <span className="settings-row-icon">
            <Icon aria-hidden="true" size={18} />
          </span>
        ) : null}
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      <div className="settings-ui-row-control">{children}</div>
    </div>
  );
}

export function CapabilityRow({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className="settings-capability-row">
      <div className="settings-capability-copy">
        <span className="settings-capability-icon">
          <Icon aria-hidden="true" size={17} />
        </span>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      <div className="settings-capability-control">{children}</div>
    </div>
  );
}

export function OptionalNumberControl({
  id,
  disabled = false,
  enabled,
  max,
  min,
  onChange,
  sliderLabel,
  step,
  toggleLabel,
  value,
  valueLabel,
}: {
  id: string;
  disabled?: boolean;
  enabled: boolean;
  max: number;
  min: number;
  onChange: (setting: { enabled: boolean; value: number }) => void;
  sliderLabel: string;
  step: number;
  toggleLabel: string;
  value: number;
  valueLabel: string;
}) {
  const handleNumberChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.currentTarget.valueAsNumber;
    if (!Number.isFinite(nextValue)) return;
    onChange({
      enabled,
      value: Math.min(max, Math.max(min, nextValue)),
    });
  };

  return (
    <div className="settings-optional-number-control">
      <SwitchControl
        checked={enabled}
        disabled={disabled}
        id={`${id}-enabled`}
        label={toggleLabel}
        onCheckedChange={(nextEnabled) =>
          onChange({ enabled: nextEnabled, value })
        }
      />
      <div className="settings-parameter-inputs">
        <RangeControl
          aria-label={sliderLabel}
          disabled={disabled || !enabled}
          max={max}
          min={min}
          onValueChange={(nextValue) =>
            onChange({
              enabled,
              value: Math.min(max, Math.max(min, nextValue)),
            })
          }
          step={step}
          value={value}
        />
        <input
          aria-label={valueLabel}
          className="settings-control settings-parameter-number"
          disabled={disabled || !enabled}
          max={max}
          min={min}
          onChange={handleNumberChange}
          step={step}
          type="number"
          value={value}
        />
      </div>
    </div>
  );
}

export function StatusOrError({
  error,
  status,
}: {
  error: string | null;
  status: string | null;
}) {
  if (error) {
    return (
      <p className="settings-local-error" role="alert">
        {error}
      </p>
    );
  }
  return status ? <p className="settings-status-line">{status}</p> : null;
}
