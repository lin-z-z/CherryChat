import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProcessedImage } from "@/runtime/attachments/image-processor";
import {
  AttachmentRepository,
  ObjectUrlRegistry,
} from "@/storage/attachment-repository";
import { ChatDatabase } from "@/storage/database";
import { StorageError } from "@/storage/errors";

describe("AttachmentRepository", () => {
  let database: ChatDatabase;

  beforeEach(() => {
    database = new ChatDatabase(`attachment-test-${crypto.randomUUID()}`);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await database.delete();
  });

  it("persists compressed blobs and deduplicates identical hashes", async () => {
    const repository = new AttachmentRepository(
      database,
      () => "attachment-1",
      () => "2026-07-17T00:00:00.000Z",
    );
    const image: ProcessedImage = {
      blob: new Blob(["image"], { type: "image/webp" }),
      mimeType: "image/webp",
      width: 10,
      height: 20,
      byteSize: 5,
      sha256: "same-hash",
    };

    const first = await repository.save(image);
    const second = await repository.save(image);

    expect(second.id).toBe(first.id);
    expect(await repository.get(first.id)).toMatchObject({
      byteSize: 5,
      mimeType: "image/webp",
      sha256: "same-hash",
    });
    expect(await database.attachments.count()).toBe(1);
  });

  it("reports quota failures with a stable storage error code", async () => {
    const repository = new AttachmentRepository(database);
    vi.spyOn(database.attachments, "add").mockRejectedValueOnce(
      new DOMException("full", "QuotaExceededError"),
    );

    const error = await repository
      .save({
        blob: new Blob(["image"], { type: "image/webp" }),
        mimeType: "image/webp",
        width: 10,
        height: 20,
        byteSize: 5,
        sha256: "quota-hash",
      })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(StorageError);
    expect(error).toMatchObject({ code: "QUOTA_EXCEEDED" });
  });
});

describe("ObjectUrlRegistry", () => {
  it("reuses previews and revokes every URL on release or dispose", () => {
    const revoke = vi.fn();
    let id = 0;
    const registry = new ObjectUrlRegistry(() => `blob:${++id}`, revoke);
    const blob = new Blob();

    expect(registry.acquire("a", blob)).toBe("blob:1");
    expect(registry.acquire("a", blob)).toBe("blob:1");
    registry.acquire("b", blob);
    registry.release("a");
    registry.dispose();

    expect(revoke.mock.calls).toEqual([["blob:1"], ["blob:2"]]);
  });
});
