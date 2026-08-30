import { describe, expect, it } from "vitest";

import {
  APP_VERSION,
  isNewerAppVersion,
  parseAppVersion,
} from "@/lib/app-version";

import packageJson from "../../package.json";

describe("app version", () => {
  it("reads the release version from package.json", () => {
    expect(APP_VERSION).toBe(packageJson.version);
    expect(parseAppVersion(APP_VERSION)).not.toBeNull();
  });

  it("parses plain three-part versions and ignores prerelease metadata", () => {
    expect(parseAppVersion("1.2.0")).toEqual({ major: 1, minor: 2, patch: 0 });
    expect(parseAppVersion(" 10.0.4 ")).toEqual({
      major: 10,
      minor: 0,
      patch: 4,
    });
    expect(parseAppVersion("1.2.0-rc.1")).toEqual({
      major: 1,
      minor: 2,
      patch: 0,
    });
  });

  it("rejects anything that is not a plain semantic version", () => {
    for (const value of [
      "1.2",
      "v1.2.0",
      "1.2.0.1",
      "",
      "   ",
      "not-a-version",
      null,
      undefined,
      12,
      {},
    ]) {
      expect(parseAppVersion(value)).toBeNull();
    }
  });

  it("reports an update only for a strictly newer deployment", () => {
    expect(isNewerAppVersion("1.2.0", "1.1.0")).toBe(true);
    expect(isNewerAppVersion("1.1.1", "1.1.0")).toBe(true);
    expect(isNewerAppVersion("2.0.0", "1.9.9")).toBe(true);
    expect(isNewerAppVersion("1.10.0", "1.9.0")).toBe(true);

    expect(isNewerAppVersion("1.1.0", "1.1.0")).toBe(false);
    expect(isNewerAppVersion("1.0.9", "1.1.0")).toBe(false);
    expect(isNewerAppVersion("1.1.0", "2.0.0")).toBe(false);
  });

  it("stays silent when either version is missing or unparsable", () => {
    expect(isNewerAppVersion(null, "1.1.0")).toBe(false);
    expect(isNewerAppVersion(undefined, "1.1.0")).toBe(false);
    expect(isNewerAppVersion("nightly", "1.1.0")).toBe(false);
    expect(isNewerAppVersion("1.2.0", null)).toBe(false);
    expect(isNewerAppVersion("1.2.0", "unknown")).toBe(false);
  });
});
