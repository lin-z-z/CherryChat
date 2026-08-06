import { describe, expect, it } from "vitest";

import {
  normalizeStorageError,
  StorageError,
  type StorageErrorCode,
} from "@/storage/errors";

describe("normalizeStorageError", () => {
  it.each<[string, StorageErrorCode]>([
    ["QuotaExceededError", "QUOTA_EXCEEDED"],
    ["AbortError", "TRANSACTION_FAILED"],
    ["DataError", "INTEGRITY_ERROR"],
    ["ConstraintError", "DUPLICATE_ID"],
  ])("maps %s to %s", (name, code) => {
    const cause = new DOMException(name, name);
    const error = normalizeStorageError(cause);

    expect(error).toBeInstanceOf(StorageError);
    expect(error).toMatchObject({ code, cause });
  });

  it("does not wrap an existing storage error again", () => {
    const error = new StorageError("UNAVAILABLE", "unavailable");
    expect(normalizeStorageError(error)).toBe(error);
  });
});
