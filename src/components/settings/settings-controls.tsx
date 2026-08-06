"use client";

import { Check, ChevronDown, Eye, EyeOff } from "lucide-react";
import type {
  ButtonHTMLAttributes,
  ReactNode,
  InputHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { forwardRef, useState } from "react";
import { Checkbox, Select, Slider } from "radix-ui";

import { cn } from "@/lib/cn";

export interface SettingsFieldProps {
  label: string;
  htmlFor: string;
  description?: string | undefined;
  error?: string | null | undefined;
  children: ReactNode;
}

export function SettingsField({
  label,
  htmlFor,
  description,
  error,
  children,
}: SettingsFieldProps) {
  return (
    <div className="settings-form-field">
      <label htmlFor={htmlFor}>{label}</label>
      {description ? <small>{description}</small> : null}
      {children}
      {error ? (
        <span className="settings-field-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export type SettingsTextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  description?: string;
  error?: string | null;
  icon?: ReactNode;
  endAction?: ReactNode;
};

export function TextField(props: SettingsTextFieldProps) {
  const {
    label,
    description,
    error,
    icon,
    endAction,
    className,
    id,
    ...inputProps
  } = props;
  if (!id) throw new Error("TextField requires an id");
  return (
    <SettingsField
      description={description}
      error={error}
      htmlFor={id}
      label={label}
    >
      <div
        className={cn(
          "settings-input-shell",
          error && "has-error",
          inputProps.disabled && "is-disabled",
        )}
      >
        {icon ? (
          <span aria-hidden="true" className="settings-input-icon">
            {icon}
          </span>
        ) : null}
        <input
          className={cn(
            "settings-control settings-text-field",
            icon && "has-start-icon",
            endAction && "has-end-action",
            className,
          )}
          id={id}
          {...inputProps}
        />
        {endAction}
      </div>
    </SettingsField>
  );
}

export function PasswordField(
  props: Omit<SettingsTextFieldProps, "endAction" | "type"> & {
    showPasswordLabel: string;
    hidePasswordLabel: string;
  },
) {
  const { showPasswordLabel, hidePasswordLabel, ...inputProps } = props;
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...inputProps}
      endAction={
        <button
          aria-label={visible ? hidePasswordLabel : showPasswordLabel}
          aria-pressed={visible}
          className="settings-field-action"
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          {visible ? (
            <EyeOff aria-hidden="true" size={17} />
          ) : (
            <Eye aria-hidden="true" size={17} />
          )}
        </button>
      }
      type={visible ? "text" : "password"}
    />
  );
}

export function TextAreaField(
  props: TextareaHTMLAttributes<HTMLTextAreaElement> & {
    label: string;
    description?: string;
    error?: string | null;
  },
) {
  const { label, description, error, id, ...textareaProps } = props;
  if (!id) throw new Error("TextAreaField requires an id");
  return (
    <SettingsField
      description={description}
      error={error}
      htmlFor={id}
      label={label}
    >
      <textarea
        className="settings-control settings-textarea"
        id={id}
        {...textareaProps}
      />
    </SettingsField>
  );
}

export interface SettingsSelectOption {
  value: string;
  label: string;
}

export interface SettingsSelectControlProps {
  id?: string;
  "aria-label"?: string;
  className?: string;
  disabled?: boolean;
  options: readonly SettingsSelectOption[];
  onValueChange: (value: string) => void;
  value: string;
}

export function SelectControl({
  id,
  "aria-label": ariaLabel,
  className,
  disabled = false,
  onValueChange,
  options,
  value,
}: SettingsSelectControlProps) {
  return (
    <Select.Root
      disabled={disabled}
      onValueChange={onValueChange}
      value={value}
    >
      <Select.Trigger
        aria-label={ariaLabel}
        className={cn("settings-select-trigger", className)}
        id={id}
      >
        <Select.Value />
        <Select.Icon>
          <ChevronDown aria-hidden="true" size={16} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          align="start"
          className="settings-select-content"
          collisionPadding={8}
          position="popper"
          sideOffset={5}
        >
          <Select.Viewport className="settings-select-viewport">
            {options.map((option) => (
              <Select.Item
                className="settings-select-item"
                key={option.value}
                value={option.value}
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="settings-select-item-check">
                  <Check aria-hidden="true" size={15} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export function SelectField(
  props: Omit<SettingsSelectControlProps, "aria-label"> & {
    label: string;
    description?: string;
    error?: string | null;
  },
) {
  const { label, description, error, id, options, ...selectProps } = props;
  if (!id) throw new Error("SelectField requires an id");
  return (
    <SettingsField
      description={description}
      error={error}
      htmlFor={id}
      label={label}
    >
      <SelectControl
        aria-label={label}
        id={id}
        options={options}
        {...selectProps}
      />
    </SettingsField>
  );
}

export interface SettingsRangeMark {
  value: number;
  label: string;
}

export interface SettingsRangeControlProps {
  id?: string;
  "aria-label": string;
  disabled?: boolean;
  marks?: readonly SettingsRangeMark[];
  max: number;
  min: number;
  onValueChange: (value: number) => void;
  step: number;
  value: number;
  valueText?: string;
}

export function RangeControl({
  id,
  "aria-label": ariaLabel,
  disabled = false,
  marks = [],
  max,
  min,
  onValueChange,
  step,
  value,
  valueText,
}: SettingsRangeControlProps) {
  const updateValue = (values: number[]) => {
    const nextValue = values[0];
    if (nextValue !== undefined) onValueChange(nextValue);
  };

  return (
    <div className="settings-range-control">
      {valueText ? (
        <output className="settings-range-value">{valueText}</output>
      ) : null}
      <Slider.Root
        className="settings-range-root"
        disabled={disabled}
        max={max}
        min={min}
        onValueChange={updateValue}
        step={step}
        value={[value]}
      >
        <Slider.Track className="settings-range-track">
          <Slider.Range className="settings-range-fill" />
        </Slider.Track>
        <Slider.Thumb
          aria-label={ariaLabel}
          aria-valuetext={valueText}
          className="settings-range-thumb"
          id={id}
        />
      </Slider.Root>
      {marks.length > 0 ? (
        <div className="settings-range-marks">
          {marks.map((mark) => (
            <button
              className="settings-range-mark"
              data-active={mark.value === value ? "true" : undefined}
              disabled={disabled}
              key={mark.value}
              onClick={() => onValueChange(mark.value)}
              style={{
                left: `${((mark.value - min) / (max - min)) * 100}%`,
              }}
              type="button"
            >
              {mark.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export interface SwitchFieldProps {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export interface SwitchControlProps {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function SwitchControl({
  id,
  label,
  checked,
  onCheckedChange,
  disabled = false,
}: SwitchControlProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="settings-switch"
      disabled={disabled}
      id={id}
      onClick={() => onCheckedChange(!checked)}
      role="switch"
      type="button"
    >
      <span aria-hidden="true" />
    </button>
  );
}

export function SwitchField({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled = false,
}: SwitchFieldProps) {
  return (
    <div className="settings-switch-row">
      <div className="settings-switch-copy">
        <label htmlFor={id}>{label}</label>
        {description ? <small>{description}</small> : null}
      </div>
      <SwitchControl
        checked={checked}
        disabled={disabled}
        id={id}
        label={label}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

export interface CheckboxControlProps {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function CheckboxControl({
  id,
  label,
  checked,
  onCheckedChange,
  disabled = false,
}: CheckboxControlProps) {
  return (
    <Checkbox.Root
      aria-label={label}
      checked={checked}
      className="settings-checkbox"
      disabled={disabled}
      id={id}
      onCheckedChange={(nextChecked) => onCheckedChange(nextChecked === true)}
    >
      <Checkbox.Indicator>
        <Check aria-hidden="true" size={14} strokeWidth={2.5} />
      </Checkbox.Indicator>
    </Checkbox.Root>
  );
}

export type SettingsButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
};

export function SettingsButton({
  children,
  className = "",
  variant = "secondary",
  ...props
}: SettingsButtonProps) {
  return (
    <button
      className={cn(
        "settings-button",
        variant === "primary" && "settings-button-primary",
        variant === "secondary" && "settings-button-secondary",
        variant === "danger" && "settings-button-danger",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export const SettingsIconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function SettingsIconButton({ children, className = "", ...props }, ref) {
  return (
    <button
      className={cn("settings-icon-button", className)}
      ref={ref}
      {...props}
    >
      {children}
    </button>
  );
});
