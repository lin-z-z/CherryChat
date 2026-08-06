"use client";

import { ThemeProvider } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

import { NotificationProvider } from "@/components/notifications/notification-provider";
import { createI18n } from "@/i18n/create-i18n";
import { resolveLanguage, type AppLanguage } from "@/i18n/resources";

const LANGUAGE_STORAGE_KEY = "cherrychat.language";
const THEME_STORAGE_KEY = "cherrychat.theme";

interface ProvidersProps {
  children: ReactNode;
  initialLanguage: AppLanguage;
  nonce?: string | undefined;
}

export function Providers({
  children,
  initialLanguage,
  nonce,
}: ProvidersProps) {
  const [i18n] = useState(() => createI18n(initialLanguage));

  useEffect(() => {
    const storedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (storedLanguage) {
      void i18n.changeLanguage(resolveLanguage(storedLanguage));
    }
  }, [i18n]);

  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
        storageKey={THEME_STORAGE_KEY}
        {...(nonce ? { nonce } : {})}
      >
        <NotificationProvider>{children}</NotificationProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}

export function persistLanguage(language: AppLanguage): void {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
}
