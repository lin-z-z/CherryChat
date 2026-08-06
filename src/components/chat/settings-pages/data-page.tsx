"use client";

import {
  Archive,
  BrainCircuit,
  Database,
  Download,
  FileJson,
  FileText,
  MessagesSquare,
  Printer,
  Trash2,
  Upload,
} from "lucide-react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";

import {
  SettingsRow,
  SettingsSection,
} from "@/components/chat/settings-layout";
import {
  SettingsButton,
  SwitchControl,
} from "@/components/settings/settings-controls";

export function DataPage({
  includeReasoning,
  currentConversationAvailable,
  error,
  importInputRef,
  onIncludeReasoningChange,
  onCreateBackup,
  onImport,
  onExportJson,
  onExportMarkdown,
  onPrint,
  onClearChats,
  onClearData,
}: {
  includeReasoning: boolean;
  currentConversationAvailable: boolean;
  error: string | null;
  importInputRef: RefObject<HTMLInputElement | null>;
  onIncludeReasoningChange: (value: boolean) => void;
  onCreateBackup: () => void;
  onImport: (file: File) => void;
  onExportJson: () => void;
  onExportMarkdown: () => void;
  onPrint: () => void;
  onClearChats: () => void;
  onClearData: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <SettingsSection
        description={t("backupDescription")}
        icon={Archive}
        title={t("backupAndExport")}
      >
        <div className="settings-ui-panel settings-data-panel">
          <SettingsRow
            description={t("fullBackupDescription")}
            icon={Archive}
            title={t("fullBackup")}
          >
            <div className="settings-data-actions">
              <SettingsButton onClick={onCreateBackup} type="button">
                <Download aria-hidden="true" size={16} />
                {t("exportBackup")}
              </SettingsButton>
              <SettingsButton
                onClick={() => importInputRef.current?.click()}
                type="button"
              >
                <Upload aria-hidden="true" size={16} />
                {t("importBackup")}
              </SettingsButton>
            </div>
            <input
              accept=".zip,application/zip"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImport(file);
              }}
              ref={importInputRef}
              type="file"
            />
          </SettingsRow>
          <SettingsRow
            description={t("includeReasoningDescription")}
            icon={BrainCircuit}
            title={t("includeReasoning")}
          >
            <div className="settings-data-switch-control">
              <SwitchControl
                checked={includeReasoning}
                id="settings-include-reasoning"
                label={t("includeReasoning")}
                onCheckedChange={onIncludeReasoningChange}
              />
            </div>
          </SettingsRow>
          <SettingsRow
            description={t("currentChatExportDescription")}
            icon={FileText}
            title={t("currentChatExport")}
          >
            <div className="settings-data-actions">
              <SettingsButton
                disabled={!currentConversationAvailable}
                onClick={onExportJson}
                type="button"
              >
                <FileJson aria-hidden="true" size={16} />
                {t("exportJson")}
              </SettingsButton>
              <SettingsButton
                disabled={!currentConversationAvailable}
                onClick={onExportMarkdown}
                type="button"
              >
                <FileText aria-hidden="true" size={16} />
                {t("exportMarkdown")}
              </SettingsButton>
              <SettingsButton
                disabled={!currentConversationAvailable}
                onClick={onPrint}
                type="button"
              >
                <Printer aria-hidden="true" size={16} />
                {t("printPreview")}
              </SettingsButton>
            </div>
          </SettingsRow>
        </div>
        {error ? <p className="settings-local-error">{error}</p> : null}
      </SettingsSection>

      <SettingsSection
        description={t("deleteDataDescription")}
        icon={Trash2}
        title={t("deleteData")}
        tone="danger"
      >
        <div className="settings-ui-panel">
          <SettingsRow
            description={t("clearAllConversationsDescription")}
            icon={MessagesSquare}
            title={t("clearAllConversations")}
          >
            <SettingsButton
              onClick={onClearChats}
              type="button"
              variant="danger"
            >
              <Trash2 aria-hidden="true" size={16} />
              {t("clearAllConversations")}
            </SettingsButton>
          </SettingsRow>
          <SettingsRow
            description={t("clearLocalDataDescription")}
            icon={Database}
            title={t("clearLocalData")}
          >
            <SettingsButton
              onClick={onClearData}
              type="button"
              variant="danger"
            >
              <Trash2 aria-hidden="true" size={16} />
              {t("clearLocalData")}
            </SettingsButton>
          </SettingsRow>
        </div>
      </SettingsSection>
    </>
  );
}
