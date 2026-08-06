import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import { formatUserFacingError } from "@/lib/user-facing-error";
import { ChatTransportError } from "@/runtime/transport/chat-errors";
import { StorageError } from "@/storage/errors";

const t = ((key: string) => key) as TFunction;

describe("formatUserFacingError", () => {
  it("maps transport errors without exposing their internal detail", () => {
    const error = new ChatTransportError(
      "UPSTREAM_ERROR",
      "Upstream request failed",
      500,
      "internal trace",
    );

    expect(formatUserFacingError(error, t)).toBe("chatError.UPSTREAM_ERROR");
  });

  it("maps storage errors to localized recovery copy", () => {
    const error = new StorageError("QUOTA_EXCEEDED", "quota full");

    expect(formatUserFacingError(error, t)).toBe("storageError.QUOTA_EXCEEDED");
  });

  it("uses a localized fallback for unknown errors", () => {
    expect(formatUserFacingError(new Error("Invalid server config"), t)).toBe(
      "unknownError",
    );
    expect(formatUserFacingError(null, t, "imageError")).toBe("imageError");
  });
});
