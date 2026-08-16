"use client";

import { useTranslation } from "react-i18next";

import { MessageMarkdown } from "@/components/message-markdown";
import type { ConversationExportProjection } from "@/runtime/chat/export-projection";

export function PrintView({
  projection,
  attachmentUrls,
  onClose,
}: {
  projection: ConversationExportProjection;
  attachmentUrls: Record<string, string>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label={t("printPreview")} className="print-view">
      <div className="print-actions">
        <button className="secondary-button" onClick={onClose} type="button">
          {t("close")}
        </button>
        <button
          className="primary-button"
          onClick={() => window.print()}
          type="button"
        >
          {t("print")}
        </button>
      </div>
      <article className="print-document">
        <h1>{projection.conversation.title}</h1>
        {projection.messages.map((message) => (
          <section className="print-message" key={message.id}>
            <h2>
              {message.role === "user" ? t("userRole") : t("assistantRole")}
            </h2>
            {message.parts.map((part, index) => {
              if (part.type === "text") {
                return (
                  <MessageMarkdown
                    content={part.text}
                    key={`${message.id}-text-${index}`}
                    streaming={false}
                  />
                );
              }
              if (part.type === "reasoning") {
                return (
                  <aside
                    className="print-reasoning"
                    key={`${message.id}-reasoning-${index}`}
                  >
                    <strong>{t("reasoning")}</strong>
                    <p>{part.text}</p>
                  </aside>
                );
              }
              if (part.type === "tool_call") return null;
              if (part.type === "provider_context") return null;
              if (part.type === "image_generation") return null;
              return (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={part.alt ?? t("attachedImage")}
                  key={`${message.id}-image-${part.attachmentId}`}
                  src={attachmentUrls[part.attachmentId]}
                />
              );
            })}
          </section>
        ))}
      </article>
    </section>
  );
}
