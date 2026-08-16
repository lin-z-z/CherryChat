import { strToU8, zipSync } from "fflate";

import { bytesToBlob, readBlobBytes } from "@/runtime/attachments/blob-utils";
import {
  projectConversationExport,
  type ConversationExportProjection,
} from "@/runtime/chat/export-projection";
import type { MessageNode } from "@/runtime/chat/types";
import type { ChatDatabase } from "@/storage/database";

export interface DownloadArtifact {
  blob: Blob;
  filename: string;
  mimeType: string;
}

export async function loadConversationProjection(
  database: ChatDatabase,
  conversationId: string,
  branch: "all" | "current",
  includeReasoning: boolean,
): Promise<ConversationExportProjection> {
  const conversation = await database.conversations.get(conversationId);
  if (!conversation)
    throw new Error(`Conversation does not exist: ${conversationId}`);
  const [messages, branchSelections, attachments] = await Promise.all([
    database.messages.where("conversationId").equals(conversationId).toArray(),
    database.branchSelections
      .where("conversationId")
      .equals(conversationId)
      .toArray(),
    database.attachments.toArray(),
  ]);
  return projectConversationExport(
    { conversation, messages, branchSelections, attachments },
    { branch, includeReasoning },
  );
}

export async function exportConversationJson(
  database: ChatDatabase,
  conversationId: string,
  includeReasoning = false,
): Promise<DownloadArtifact> {
  const projection = await loadConversationProjection(
    database,
    conversationId,
    "all",
    includeReasoning,
  );
  const filename = `${safeFilename(projection.conversation.title)}.json`;
  return {
    blob: textBlob(JSON.stringify(projection, null, 2), "application/json"),
    filename,
    mimeType: "application/json",
  };
}

export async function exportConversationMarkdown(
  database: ChatDatabase,
  conversationId: string,
  includeReasoning = false,
): Promise<DownloadArtifact> {
  const projection = await loadConversationProjection(
    database,
    conversationId,
    "current",
    includeReasoning,
  );
  const baseName = safeFilename(projection.conversation.title);
  const attachmentById = new Map(
    (await database.attachments.toArray()).map((attachment) => [
      attachment.id,
      attachment,
    ]),
  );
  const markdown = renderConversationMarkdown(projection, (attachmentId) => {
    const attachment = attachmentById.get(attachmentId);
    if (!attachment)
      throw new Error(`Attachment does not exist: ${attachmentId}`);
    return `attachments/${attachment.id}.${extensionForMime(attachment.mimeType)}`;
  });
  if (projection.attachments.length === 0) {
    return {
      blob: textBlob(markdown, "text/markdown"),
      filename: `${baseName}.md`,
      mimeType: "text/markdown",
    };
  }

  const files: Record<string, Uint8Array> = {
    [`${baseName}.md`]: strToU8(markdown),
  };
  for (const metadata of projection.attachments) {
    const attachment = attachmentById.get(metadata.id);
    if (!attachment)
      throw new Error(`Attachment does not exist: ${metadata.id}`);
    files[
      `attachments/${attachment.id}.${extensionForMime(attachment.mimeType)}`
    ] = await readBlobBytes(attachment.blob);
  }
  return {
    blob: bytesToBlob(zipSync(files, { level: 6 }), "application/zip"),
    filename: `${baseName}-markdown.zip`,
    mimeType: "application/zip",
  };
}

export function renderConversationMarkdown(
  projection: ConversationExportProjection,
  attachmentPath: (attachmentId: string) => string,
): string {
  const lines = [`# ${projection.conversation.title}`, ""];
  for (const message of projection.messages) {
    lines.push(`## ${message.role === "user" ? "User" : "Assistant"}`, "");
    for (const part of message.parts) {
      if (part.type === "text") lines.push(part.text, "");
      if (part.type === "reasoning") {
        lines.push(
          "> **Reasoning**",
          ...part.text.split("\n").map((line) => `> ${line}`),
          "",
        );
      }
      if (part.type === "image_ref") {
        lines.push(
          `![${escapeMarkdownAlt(part.alt ?? "Attached image")}](${attachmentPath(
            part.attachmentId,
          )})`,
          "",
        );
      }
    }
    appendUsage(lines, message);
  }
  return `${lines.join("\n").trim()}\n`;
}

function appendUsage(lines: string[], message: MessageNode): void {
  if (message.role !== "assistant" || !message.usage) return;
  lines.push(
    `*${message.usage.estimated ? "Approx. " : ""}${message.usage.totalTokens ?? 0} tokens*`,
    "",
  );
}

function escapeMarkdownAlt(value: string): string {
  return value.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function safeFilename(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, "-")
    .replace(/[. ]+$/gu, "")
    .trim()
    .slice(0, 80);
  return normalized || "cherrychat-conversation";
}

function extensionForMime(mimeType: string): "png" | "jpg" | "webp" {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  throw new Error(`Unsupported attachment MIME: ${mimeType}`);
}

function textBlob(text: string, type: string): Blob {
  return bytesToBlob(strToU8(text), `${type};charset=utf-8`);
}
