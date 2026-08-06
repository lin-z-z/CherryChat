import i18next, { type i18n } from "i18next";
import { initReactI18next } from "react-i18next";

import { resources, type AppLanguage } from "@/i18n/resources";

export function createI18n(initialLanguage: AppLanguage): i18n {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    resources,
    lng: initialLanguage,
    fallbackLng: "en",
    supportedLngs: ["zh-CN", "en"],
    interpolation: { escapeValue: false },
    initImmediate: false,
    showSupportNotice: false,
  });
  return instance;
}
