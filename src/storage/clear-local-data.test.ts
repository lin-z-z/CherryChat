import { describe, expect, it } from "vitest";

import { clearLocalData } from "@/storage/clear-local-data";
import { ChatDatabase } from "@/storage/database";

describe("clearLocalData", () => {
  it("removes the database and only CherryChat localStorage keys", async () => {
    const database = new ChatDatabase(`cherrychat-test-${crypto.randomUUID()}`);
    await database.settings.put({
      key: "theme",
      value: "dark",
      updatedAt: "2026-07-16T00:00:00.000Z",
    });
    window.localStorage.setItem("cherrychat.language", "zh-CN");
    window.localStorage.setItem("cherrychat.theme", "dark");
    window.localStorage.setItem("another-app", "keep");

    await clearLocalData(database, window.localStorage);

    expect(window.localStorage.getItem("cherrychat.language")).toBeNull();
    expect(window.localStorage.getItem("cherrychat.theme")).toBeNull();
    expect(window.localStorage.getItem("another-app")).toBe("keep");
    const databases = await indexedDB.databases();
    expect(databases.some(({ name }) => name === database.name)).toBe(false);
  });
});
