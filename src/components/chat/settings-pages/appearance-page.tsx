"use client";

import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  SettingsRow,
  SettingsSection,
} from "@/components/chat/settings-layout";
import { SelectControl } from "@/components/settings/settings-controls";
import type { AppTheme } from "@/features/chat/use-chat-controller";
import type { AppLanguage } from "@/i18n/resources";

export function AppearancePage({
  language,
  theme,
  error,
  onLanguageChange,
  onThemeChange,
}: {
  language: AppLanguage;
  theme: AppTheme;
  error: string | null;
  onLanguageChange: (language: AppLanguage) => void;
  onThemeChange: (theme: AppTheme) => void;
}) {
  const { t } = useTranslation();
  return (
    <SettingsSection
      description={t("appearanceDescription")}
      icon={Palette}
      title={t("appearance")}
    >
      <div className="settings-ui-panel">
        <SettingsRow
          description={t("themeDescription")}
          title={t("themeLabel")}
        >
          <SelectControl
            aria-label={t("themeLabel")}
            onValueChange={(value) => onThemeChange(value as AppTheme)}
            options={[
              { value: "system", label: t("themeSystem") },
              { value: "light", label: t("themeLight") },
              { value: "dark", label: t("themeDark") },
            ]}
            value={theme}
          />
        </SettingsRow>
        <SettingsRow
          description={t("languageDescription")}
          title={t("languageLabel")}
        >
          <SelectControl
            aria-label={t("languageLabel")}
            onValueChange={(value) => onLanguageChange(value as AppLanguage)}
            options={[
              { value: "zh-CN", label: "简体中文" },
              { value: "en", label: "English" },
            ]}
            value={language}
          />
        </SettingsRow>
      </div>
      {error ? <p className="settings-local-error">{error}</p> : null}
    </SettingsSection>
  );
}
