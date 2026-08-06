import type { TFunction } from "i18next";

import { ChatTransportError } from "@/runtime/transport/chat-errors";
import { StorageError } from "@/storage/errors";

export function formatUserFacingError(
  cause: unknown,
  t: TFunction,
  fallbackKey = "unknownError",
): string {
  if (cause instanceof ChatTransportError) {
    return t(`chatError.${cause.code}`);
  }
  if (cause instanceof StorageError) {
    return t(`storageError.${cause.code}`);
  }
  return t(fallbackKey);
}
