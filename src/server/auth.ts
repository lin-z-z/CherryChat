import { createHmac, timingSafeEqual } from "node:crypto";

import type { HostedServerConfig } from "@/server/config";

export const SESSION_COOKIE_NAME = "cherrychat_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_ACCESS_CODE_BYTES = 256;

interface SessionPayload {
  version: 2;
  expiresAt: number;
  codeId: string;
}

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

export function createSessionToken(
  authSecret: string,
  codeId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  ttlSeconds = SESSION_TTL_SECONDS,
): string {
  if (!isAccessCodeId(codeId)) {
    throw new TypeError("Session code ID is invalid");
  }
  const payload: SessionPayload = {
    version: 2,
    expiresAt: nowSeconds + ttlSeconds,
    codeId,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = digest("session", encodedPayload, authSecret).toString(
    "base64url",
  );
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(
  token: string | null | undefined,
  config: Pick<HostedServerConfig, "accessCodes" | "authSecret">,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!token) return false;
  const [encodedPayload, encodedSignature, ...rest] = token.split(".");
  if (!encodedPayload || !encodedSignature || rest.length > 0) return false;

  let suppliedSignature: Buffer;
  try {
    suppliedSignature = Buffer.from(encodedSignature, "base64url");
  } catch {
    return false;
  }
  const expectedSignature = digest(
    "session",
    encodedPayload,
    config.authSecret,
  );
  if (
    suppliedSignature.byteLength !== expectedSignature.byteLength ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return false;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as unknown;
    return (
      isSessionPayload(payload) &&
      payload.expiresAt > nowSeconds &&
      isActiveAccessCodeId(payload.codeId, config)
    );
  } catch {
    return false;
  }
}

export function readCookie(
  cookieHeader: string | null,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    const key = item.slice(0, separator).trim();
    if (key !== name) continue;
    return decodeURIComponent(item.slice(separator + 1).trim());
  }
  return null;
}

function digest(purpose: string, value: string, secret: string): Buffer {
  return createHmac("sha256", secret)
    .update(purpose)
    .update("\0")
    .update(value)
    .digest();
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 3 &&
    record.version === 2 &&
    typeof record.expiresAt === "number" &&
    Number.isSafeInteger(record.expiresAt) &&
    typeof record.codeId === "string" &&
    isAccessCodeId(record.codeId)
  );
}

function isActiveAccessCodeId(
  codeId: string,
  config: Pick<HostedServerConfig, "accessCodes" | "authSecret">,
): boolean {
  const supplied = Buffer.from(codeId, "base64url");
  let matched = false;
  for (const accessCode of config.accessCodes) {
    const expected = digest(
      "access-code-id",
      normalizeAccessCode(accessCode) ?? "",
      config.authSecret,
    );
    matched = timingSafeEqual(supplied, expected) || matched;
  }
  return matched;
}

function isAccessCodeId(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/u.test(value);
}
