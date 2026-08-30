import { createHmac, timingSafeEqual } from "node:crypto";

import type { HostedServerConfig } from "@/server/config";

export const SESSION_COOKIE_NAME = "cherrychat_session";
export const ACCESS_CODE_HEADER_NAME = "x-cherrychat-access-code";
const MAX_ACCESS_CODE_BYTES = 256;

export function normalizeAccessCode(value: string): string | null {
  const normalized = value.normalize("NFKC").trim();
  const byteLength = new TextEncoder().encode(normalized).byteLength;
  return byteLength > 0 && byteLength <= MAX_ACCESS_CODE_BYTES
    ? normalized
    : null;
}

export function authenticateAccessCode(
  candidate: string,
  config: Pick<HostedServerConfig, "accessCodes" | "authSecret">,
): string | null {
  const normalizedCandidate = normalizeAccessCode(candidate);
  const candidateDigest = digest(
    "access-code",
    normalizedCandidate ?? "",
    config.authSecret,
  );
  let matchedCodeId: string | null = null;
  for (const accessCode of config.accessCodes) {
    const normalizedAccessCode = normalizeAccessCode(accessCode) ?? "";
    const expectedDigest = digest(
      "access-code",
      normalizedAccessCode,
      config.authSecret,
    );
    const matches = timingSafeEqual(candidateDigest, expectedDigest);
    const codeId = digest(
      "access-code-id",
      normalizedAccessCode,
      config.authSecret,
    ).toString("base64url");
    if (matches) matchedCodeId = codeId;
  }
  return normalizedCandidate === null ? null : matchedCodeId;
}

/** Reads the raw, still percent-encoded access code header. */
export function readAccessCodeHeader(request: Request): string | null {
  return request.headers.get(ACCESS_CODE_HEADER_NAME);
}

/**
 * Decodes an access code header value. HTTP headers cannot carry non-ASCII
 * bytes, so the client percent-encodes the code; plain ASCII codes survive
 * unchanged. Returns null when the encoding is malformed, which the caller
 * treats as an invalid credential rather than a missing one.
 */
export function decodeAccessCodeHeader(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function digest(purpose: string, value: string, secret: string): Buffer {
  return createHmac("sha256", secret)
    .update(purpose)
    .update("\0")
    .update(value)
    .digest();
}
