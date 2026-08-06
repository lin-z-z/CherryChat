import { describe, expect, it } from "vitest";

import {
  sameValue,
  uniqueModelIds,
} from "@/components/chat/settings-workspace-logic";

describe("settings workspace pure logic", () => {
  it("normalizes, removes blanks, and preserves the first model order", () => {
    expect(
      uniqueModelIds([" model-a ", "", "ｍｏｄｅｌ-b", "model-a"]),
    ).toEqual(["model-a", "model-b"]);
  });

  it("compares serializable drafts without sharing object identity", () => {
    expect(sameValue({ enabled: true }, { enabled: true })).toBe(true);
    expect(sameValue({ enabled: true }, { enabled: false })).toBe(false);
  });
});
