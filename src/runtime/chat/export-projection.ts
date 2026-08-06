import { buildSelectedPath, parentKey } from "@/runtime/chat/message-tree";
import type {
  AttachmentRecord,
  BranchSelectionRecord,
  ConversationRecord,
  MessageNode,
} from "@/runtime/chat/types";

export interface ExportAttachmentMetadata {
  id: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
  createdAt: string;
}

export interface ConversationExportProjection {
  conversation: ConversationRecord;
  messages: MessageNode[];
  branchSelections: BranchSelectionRecord[];
  attachments: ExportAttachmentMetadata[];
}

export interface ConversationExportSource {
  conversation: ConversationRecord;
  messages: readonly MessageNode[];
  branchSelections: readonly BranchSelectionRecord[];
  attachments: readonly AttachmentRecord[];
}

export interface ConversationProjectionOptions {
  branch: "all" | "current";
  includeReasoning: boolean;
}

export function projectConversationExport(
  source: ConversationExportSource,
  options: ConversationProjectionOptions,
): ConversationExportProjection {
  const sourceMessages = source.messages.filter(
    ({ conversationId }) => conversationId === source.conversation.id,
  );
  const selectedMessages =
    options.branch === "all"
      ? sourceMessages
      : buildSelectedPath(sourceMessages, source.branchSelections);
  const messages = selectedMessages.map((message) => ({
    ...structuredClone(message),
    parts: message.parts
      .filter(
        (part) =>
          part.type !== "provider_context" &&
          (options.includeReasoning || part.type !== "reasoning"),
      )
      .map((part) => structuredClone(part)),
  }));
  const attachmentIds = new Set(
    messages.flatMap((message) =>
      message.parts
        .filter((part) => part.type === "image_ref")
        .map((part) => part.attachmentId),
    ),
  );
  const attachments = source.attachments
    .filter(({ id }) => attachmentIds.has(id))
    .map((attachment) => ({
      id: attachment.id,
      mimeType: attachment.mimeType,
      width: attachment.width,
      height: attachment.height,
      byteSize: attachment.byteSize,
      sha256: attachment.sha256,
      createdAt: attachment.createdAt,
    }));
  const branchSelections =
    options.branch === "all"
      ? source.branchSelections.filter(
          ({ conversationId }) => conversationId === source.conversation.id,
        )
      : messages.map((message) => ({
          conversationId: source.conversation.id,
          parentKey: parentKey(message.parentId),
          selectedChildId: message.id,
        }));

  return {
    conversation: structuredClone(source.conversation),
    messages,
    branchSelections: structuredClone(branchSelections),
    attachments,
  };
}
