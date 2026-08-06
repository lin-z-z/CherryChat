import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectionBundle } from "@/runtime/chat/types";
import { ConnectionStore } from "@/storage/connection-store";
import { ChatDatabase } from "@/storage/database";

const bundle: ConnectionBundle = {
  connection: {
    id: "current",
    mode: "byok",
    baseUrl: "https://example.com",
    modelId: "example-model",
    apiType: "openai",
    updatedAt: "2026-07-16T00:00:00.000Z",
  },
  credential: {
    id: "current",
    apiKey: "test-key",
    accessCode: "",
    encrypted: false,
    updatedAt: "2026-07-16T00:00:00.000Z",
  },
};

describe("ConnectionStore", () => {
  let database: ChatDatabase;

  beforeEach(() => {
    window.localStorage.clear();
    database = new ChatDatabase(`cherrychat-test-${crypto.randomUUID()}`);
  });

  afterEach(async () => {
    await database.delete();
  });

  it("round-trips connection and credentials in separate tables", async () => {
    const store = new ConnectionStore(database, window.localStorage);
    await store.save(bundle);

    await expect(store.load()).resolves.toEqual(bundle);
    await expect(database.connections.get("current")).resolves.toEqual(
      bundle.connection,
    );
    await expect(database.credentials.get("current")).resolves.toEqual(
      bundle.credential,
    );
  });

  it("round-trips each API type", async () => {
    const store = new ConnectionStore(database, window.localStorage);
    const variants: ConnectionBundle[] = [
      ...(
        [
          "openai-responses",
          "anthropic",
          "gemini",
          "new-api",
          "openai-compatible",
        ] as const
      ).map((apiType) => ({
        ...bundle,
        connection: { ...bundle.connection, apiType },
      })),
    ];

    for (const variant of variants) {
      await store.save(variant);
      await expect(store.load()).resolves.toEqual(variant);
      await expect(database.connections.get("current")).resolves.toEqual(
        variant.connection,
      );
    }
  });

  it.each([false, true])(
    "rejects a development-era connection without apiType (localStorage=%s)",
    async (forceLocalStorage) => {
      const legacyConnection = { ...bundle.connection } as Record<
        string,
        unknown
      >;
      delete legacyConnection.apiType;
      const legacyBundle = {
        connection: legacyConnection,
        credential: bundle.credential,
      };
      if (forceLocalStorage) {
        window.localStorage.setItem(
          "cherrychat.connection.current",
          JSON.stringify(legacyBundle),
        );
      } else {
        await database
          .table<Record<string, unknown>>("connections")
          .put(legacyConnection);
        await database.credentials.put(bundle.credential);
      }

      const store = new ConnectionStore(
        database,
        window.localStorage,
        forceLocalStorage,
      );
      await expect(store.load()).rejects.toThrow();
    },
  );

  it("clears both primary and fallback values", async () => {
    const store = new ConnectionStore(database, window.localStorage);
    await store.save(bundle);
    window.localStorage.setItem(
      "cherrychat.connection.current",
      JSON.stringify(bundle),
    );

    await store.clear();

    await expect(store.load()).resolves.toBeNull();
    expect(
      window.localStorage.getItem("cherrychat.connection.current"),
    ).toBeNull();
  });

  it("falls back to localStorage when IndexedDB cannot open", async () => {
    vi.spyOn(database, "open").mockRejectedValueOnce(
      new Error("IndexedDB blocked"),
    );
    const store = new ConnectionStore(database, window.localStorage);

    await store.save(bundle);

    expect((await store.initialize()).backend).toBe("localstorage");
    await expect(store.load()).resolves.toEqual(bundle);
  });
});
