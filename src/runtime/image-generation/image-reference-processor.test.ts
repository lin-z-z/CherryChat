import { describe, expect, it, vi } from "vitest";

import type { ProcessedImage } from "@/runtime/attachments/image-processor";
import type { AttachmentRecord } from "@/runtime/chat/types";
import {
  ImageReferenceProcessor,
  TARGET_IMAGE_REFERENCE_BYTES,
} from "@/runtime/image-generation/image-reference-processor";

describe("ImageReferenceProcessor", () => {
  it("deduplicates incoming and stored images by hash", async () => {
    const process = vi
      .fn<(blob: Blob) => Promise<ProcessedImage>>()
      .mockResolvedValueOnce(processed("stored", 10))
      .mockResolvedValueOnce(processed("new", 20))
      .mockResolvedValueOnce(processed("new", 20));
    const processor = new ImageReferenceProcessor({ process } as never);

    await expect(
      processor.add(
        [attachment("stored", 10)],
        [new Blob(["one"]), new Blob(["two"]), new Blob(["three"])],
      ),
    ).resolves.toEqual([processed("new", 20)]);
    expect(process).toHaveBeenCalledTimes(3);
  });

  it("rejects a seventeenth unique reference and request budget overflow", async () => {
    const process = vi
      .fn<(blob: Blob) => Promise<ProcessedImage>>()
      .mockResolvedValue(processed("new", TARGET_IMAGE_REFERENCE_BYTES));
    const processor = new ImageReferenceProcessor({ process } as never);
    const sixteen = Array.from({ length: 16 }, (_, index) =>
      attachment(`stored-${index}`, 1),
    );

    await expect(
      processor.add(sixteen, [new Blob(["extra"])]),
    ).rejects.toMatchObject({ code: "TOO_MANY_IMAGES" });
    expect(() =>
      processor.assertRequestBudget(
        [attachment("oversized", TARGET_IMAGE_REFERENCE_BYTES)],
        TARGET_IMAGE_REFERENCE_BYTES,
      ),
    ).toThrow(expect.objectContaining({ code: "SOURCE_TOO_LARGE" }));
  });
});

function processed(hash: string, byteSize: number): ProcessedImage {
  return {
    blob: new Blob([new Uint8Array(byteSize)], { type: "image/png" }),
    mimeType: "image/png",
    width: 1,
    height: 1,
    byteSize,
    sha256: hash.padEnd(64, "0"),
  };
}

function attachment(hash: string, byteSize: number): AttachmentRecord {
  return {
    id: hash,
    ...processed(hash, byteSize),
    createdAt: "2026-08-13T00:00:00.000Z",
  };
}
