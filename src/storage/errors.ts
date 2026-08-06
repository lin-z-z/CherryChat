export type StorageErrorCode =
  | "QUOTA_EXCEEDED"
  | "TRANSACTION_FAILED"
  | "INTEGRITY_ERROR"
  | "DUPLICATE_ID"
  | "UNAVAILABLE";

export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StorageError";
  }
}

export function normalizeStorageError(cause: unknown): StorageError {
  if (cause instanceof StorageError) return cause;
  const name = readErrorName(cause);
  if (name === "QuotaExceededError") {
    return new StorageError("QUOTA_EXCEEDED", "Browser storage quota is full", {
      cause,
    });
  }
  if (name === "ConstraintError") {
    return new StorageError("DUPLICATE_ID", "A stored ID already exists", {
      cause,
    });
  }
  if (name === "DataError") {
    return new StorageError(
      "INTEGRITY_ERROR",
      "Stored data failed an integrity check",
      { cause },
    );
  }
  if (
    name === "AbortError" ||
    name === "TransactionInactiveError" ||
    name === "PrematureCommitError"
  ) {
    return new StorageError(
      "TRANSACTION_FAILED",
      "The storage transaction failed",
      { cause },
    );
  }
  return new StorageError("UNAVAILABLE", "Browser storage is unavailable", {
    cause,
  });
}

function readErrorName(cause: unknown): string {
  if (cause instanceof Error || cause instanceof DOMException)
    return cause.name;
  if (cause && typeof cause === "object" && "name" in cause) {
    const name = Reflect.get(cause, "name");
    return typeof name === "string" ? name : "";
  }
  return "";
}
