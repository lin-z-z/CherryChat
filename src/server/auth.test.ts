import { describe, expect, it } from "vitest";

import {
  ACCESS_CODE_HEADER_NAME,
  authenticateAccessCode,
  decodeAccessCodeHeader,
  readAccessCodeHeader,
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

  it("distinguishes each configured access code", () => {
    const config = {
      accessCodes: ["first-code", "second-code"],
      authSecret: secret,
    };

    const first = authenticateAccessCode("first-code", config);
    const second = authenticateAccessCode("second-code", config);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);
    expect(
      authenticateAccessCode("first-code", {
        ...config,
        accessCodes: ["second-code"],
      }),
    ).toBeNull();
  });

  it("reads the access code from the dedicated request header", () => {
    const request = new Request("https://app.example/api/models", {
      headers: { [ACCESS_CODE_HEADER_NAME]: "first-code" },
    });

    expect(readAccessCodeHeader(request)).toBe("first-code");
    expect(
      readAccessCodeHeader(new Request("https://app.example/api/models")),
    ).toBeNull();
  });

  it("decodes percent-encoded access codes and rejects malformed encodings", () => {
    expect(decodeAccessCodeHeader(encodeURIComponent("访问码-1"))).toBe(
      "访问码-1",
    );
    expect(decodeAccessCodeHeader("plain-code")).toBe("plain-code");
    expect(decodeAccessCodeHeader("%E4%B8")).toBeNull();
    expect(decodeAccessCodeHeader("%zz")).toBeNull();
  });
});
