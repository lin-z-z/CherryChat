"use client";

import { Check, ChevronDown, Monitor, Moon, Sun } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import type { AppTheme } from "@/features/chat/use-chat-controller";

export interface ThemeSwitcherProps {
  value: AppTheme;
  resolvedTheme?: string | undefined;
  onValueChange: (theme: AppTheme) => void;
}

const themeOptions = [
  { value: "system", labelKey: "themeSystem", icon: Monitor },
  { value: "light", labelKey: "themeLight", icon: Sun },
  { value: "dark", labelKey: "themeDark", icon: Moon },
] as const satisfies ReadonlyArray<{
  value: AppTheme;
  labelKey: "themeSystem" | "themeLight" | "themeDark";
  icon: typeof Monitor;
}>;

export function ThemeSwitcher({
  value,
  resolvedTheme,
  onValueChange,
}: ThemeSwitcherProps) {
  const { t } = useTranslation();
  const mounted = useSyncExternalStore(
    subscribeToHydration,
    clientSnapshot,
    serverSnapshot,
  );

  const displayTheme = mounted ? value : "system";
  const displayOption = getThemeOption(displayTheme);
  const displayLabel = t(displayOption.labelKey);
  const accessibleLabel = t("themeQuickSwitcher", { theme: displayLabel });

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          aria-label={accessibleLabel}
          className="theme-switcher-trigger"
          title={accessibleLabel}
          type="button"
        >
          <ThemeDisplayIcon mounted={mounted} resolvedTheme={resolvedTheme} />
          <span className="theme-switcher-label">{displayLabel}</span>
          <ChevronDown
            aria-hidden="true"
            className="theme-switcher-chevron"
            size={12}
            strokeWidth={2.5}
          />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          aria-label={t("themeOptions")}
          className="theme-switcher-content"
          collisionPadding={8}
          sideOffset={6}
        >
          <DropdownMenu.RadioGroup
            onValueChange={(nextValue) => {
              if (isAppTheme(nextValue)) onValueChange(nextValue);
            }}
            value={value}
          >
            {themeOptions.map(
              ({ value: optionValue, labelKey, icon: Icon }) => (
                <DropdownMenu.RadioItem
                  className="theme-switcher-option"
                  key={optionValue}
                  value={optionValue}
                >
                  <Icon
                    aria-hidden="true"
                    className="theme-switcher-option-icon"
                    size={16}
                  />
                  <span>{t(labelKey)}</span>
                  <span aria-hidden="true" className="theme-switcher-check">
                    <DropdownMenu.ItemIndicator>
                      <Check size={14} strokeWidth={2.5} />
                    </DropdownMenu.ItemIndicator>
                  </span>
                </DropdownMenu.RadioItem>
              ),
            )}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function isAppTheme(value: string): value is AppTheme {
  return value === "system" || value === "light" || value === "dark";
}

function getThemeOption(theme: AppTheme) {
  return themeOptions.find(({ value }) => value === theme) ?? themeOptions[0];
}

function ThemeDisplayIcon({
  mounted,
  resolvedTheme,
}: {
  mounted: boolean;
  resolvedTheme: string | undefined;
}) {
  const iconProps = {
    "aria-hidden": true,
    className: "theme-switcher-icon",
    size: 16,
  } as const;

  if (!mounted) return <Monitor {...iconProps} />;
  if (resolvedTheme === "dark") return <Moon {...iconProps} />;
  if (resolvedTheme === "light") return <Sun {...iconProps} />;
  return <Monitor {...iconProps} />;
}

function subscribeToHydration() {
  return () => undefined;
}

function clientSnapshot() {
  return true;
}

function serverSnapshot() {
  return false;
}
