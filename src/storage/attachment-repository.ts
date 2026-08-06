import type { ProcessedImage } from "@/runtime/attachments/image-processor";
import type { AttachmentRecord } from "@/runtime/chat/types";
import type { ChatDatabase } from "@/storage/database";
import { normalizeStorageError } from "@/storage/errors";

export class AttachmentRepository {
  constructor(
    private readonly database: ChatDatabase,
    private readonly createId: () => string = () => crypto.randomUUID(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async save(image: ProcessedImage): Promise<AttachmentRecord> {
    try {
      const existing = await this.database.attachments
        .where("sha256")
        .equals(image.sha256)
        .first();
      if (existing) return existing;

      const attachment: AttachmentRecord = {
        id: this.createId(),
        blob: image.blob,
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
        byteSize: image.byteSize,
        sha256: image.sha256,
        createdAt: this.now(),
      };
      await this.database.attachments.add(attachment);
      return attachment;
    } catch (cause) {
      throw normalizeStorageError(cause);
    }
  }

  get(attachmentId: string): Promise<AttachmentRecord | undefined> {
    return this.database.attachments.get(attachmentId);
  }
}

export class ObjectUrlRegistry {
  private readonly urls = new Map<string, string>();

  constructor(
    private readonly createObjectURL: (
      blob: Blob,
    ) => string = URL.createObjectURL,
    private readonly revokeObjectURL: (
      url: string,
    ) => void = URL.revokeObjectURL,
  ) {}

  acquire(attachmentId: string, blob: Blob): string {
    const existing = this.urls.get(attachmentId);
    if (existing) return existing;
    const url = this.createObjectURL(blob);
    this.urls.set(attachmentId, url);
    return url;
  }

  release(attachmentId: string): void {
    const url = this.urls.get(attachmentId);
    if (!url) return;
    this.revokeObjectURL(url);
    this.urls.delete(attachmentId);
  }

  dispose(): void {
    for (const url of this.urls.values()) this.revokeObjectURL(url);
    this.urls.clear();
  }
}
