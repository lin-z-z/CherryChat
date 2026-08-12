"use client";

import { Cable, Database, Github, Info, ShieldCheck, Tags } from "lucide-react";
import { useTranslation } from "react-i18next";

import packageJson from "../../../../package.json";

import { BrandIcon } from "@/components/chat/brand-icon";
import { SettingsSection } from "@/components/chat/settings-layout";
import type { ChatController } from "@/features/chat/use-chat-controller";

const APP_VERSION = packageJson.version;
const APP_LICENSE = "MIT";
const APP_REPOSITORY_URL = "https://github.com/lin-z-z/CherryChat";

export function AboutPage({
  publicConfig,
}: {
  publicConfig: ChatController["publicConfig"];
}) {
  const { t } = useTranslation();
  const connectionAvailability = publicConfig?.hostedEnabled
    ? publicConfig.byokEnabled
      ? t("accessCodeAndCustomApi")
      : t("accessCodeOnly")
    : t("customApiOnly");
  return (
    <SettingsSection
      description={t("aboutDetailsDescription")}
      icon={Info}
      title={t("aboutProductInformation")}
    >
      <div className="settings-ui-panel settings-about-panel">
        <div className="settings-about-identity">
          <span className="settings-about-brand-mark">
            <BrandIcon size={56} />
          </span>
          <div className="settings-about-identity-copy">
            <span className="settings-about-eyebrow">
              {t("aboutProductLabel")}
            </span>
            <h3>{t("appName")}</h3>
            <p>{t("aboutTagline")}</p>
          </div>
        </div>
        <dl className="about-list settings-about-list">
          <div>
            <dt>
              <span className="settings-about-detail-icon">
                <Tags aria-hidden="true" size={17} />
              </span>
              <span>
                <strong>{t("version")}</strong>
                <small>{t("versionDescription")}</small>
              </span>
            </dt>
            <dd>{APP_VERSION}</dd>
          </div>
          <div>
            <dt>
              <span className="settings-about-detail-icon">
                <ShieldCheck aria-hidden="true" size={17} />
              </span>
              <span>
                <strong>{t("license")}</strong>
                <small>{t("licenseDescription")}</small>
              </span>
            </dt>
            <dd>{APP_LICENSE}</dd>
          </div>
          <div>
            <dt>
              <span className="settings-about-detail-icon">
                <Cable aria-hidden="true" size={17} />
              </span>
              <span>
                <strong>{t("connectionAvailability")}</strong>
                <small>{t("connectionAvailabilityDescription")}</small>
              </span>
            </dt>
            <dd>{connectionAvailability}</dd>
          </div>
          <div>
            <dt>
              <span className="settings-about-detail-icon">
                <Database aria-hidden="true" size={17} />
              </span>
              <span>
                <strong>{t("dataLocation")}</strong>
                <small>{t("dataLocationDescription")}</small>
              </span>
            </dt>
            <dd>{t("currentBrowser")}</dd>
          </div>
          <div className="settings-about-repository">
            <dt>
              <span className="settings-about-detail-icon">
                <Github aria-hidden="true" size={17} />
              </span>
              <span>
                <strong>{t("repository")}</strong>
                <small>{t("repositoryDescription")}</small>
              </span>
            </dt>
            <dd>
              <a href={APP_REPOSITORY_URL} rel="noreferrer" target="_blank">
                {t("openRepository")}
              </a>
            </dd>
          </div>
        </dl>
      </div>
    </SettingsSection>
  );
}
