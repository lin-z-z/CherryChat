import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  authenticateAccessCode,
  createSessionToken,
  verifySessionToken,
} from "@/server/auth";

const secret = "s".repeat(32);

describe("hosted authentication", () => {
  it("compares NFKC-normalized access codes through fixed-length HMACs", () => {
    const config = {
      accessCodes: ["first-code", "ABC-123", "last-code"],
      authSecret: secret,
    };

    const codeId = authenticateAccessCode("  ＡＢＣ-123  ", config);

    expect(codeId).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(authenticateAccessCode("ABC-124", config)).toBeNull();
    expect(authenticateAccessCode("x".repeat(257), config)).toBeNull();
    expect(codeId).not.toContain("ABC-123");
  });

  it("applies the access-code limit in UTF-8 bytes without a minimum length", () => {
    const shortConfig = { accessCodes: ["x"], authSecret: secret };
    const multibyteConfig = {
      accessCodes: ["界".repeat(85)],
      authSecret: secret,
    };

    expect(authenticateAccessCode("x", shortConfig)).not.toBeNull();
    expect(
      authenticateAccessCode("界".repeat(85), multibyteConfig),
    ).not.toBeNull();
    expect(authenticateAccessCode("界".repeat(86), multibyteConfig)).toBeNull();
  });

  it("binds v2 sessions to one active access code", () => {
    const activeConfig = {
      accessCodes: ["first-code", "second-code"],
      authSecret: secret,
    };
    const codeId = authenticateAccessCode("first-code", activeConfig);
    if (!codeId) throw new Error("Expected an access-code ID");
    const token = createSessionToken(secret, codeId, 1000, 60);

    expect(verifySessionToken(token, activeConfig, 1059)).toBe(true);
    expect(
      verifySessionToken(
        token,
        { ...activeConfig, accessCodes: ["second-code"] },
        1059,
      ),
    ).toBe(false);
    expect(verifySessionToken(token, activeConfig, 1060)).toBe(false);
    expect(verifySessionToken(`${token}x`, activeConfig, 1059)).toBe(false);
    expect(token).not.toContain("first-code");
  });

  it("rejects legacy v1 session payloads after the one-time upgrade", () => {
    const encodedPayload = Buffer.from(
      JSON.stringify({ version: 1, expiresAt: 2000 }),
    ).toString("base64url");
    const legacySignature = createHmac("sha256", secret)
      .update("session")
      .update("\0")
      .update(encodedPayload)
      .digest("base64url");

    expect(
      verifySessionToken(
        `${encodedPayload}.${legacySignature}`,
        {
          accessCodes: ["first-code"],
          authSecret: secret,
        },
        1000,
      ),
    ).toBe(false);
  });
});
