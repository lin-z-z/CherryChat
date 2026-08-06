import { connectionBundleSchema } from "@/runtime/chat/schemas";
import type { ConnectionBundle } from "@/runtime/chat/types";
import type { ChatDatabase } from "@/storage/database";

const FALLBACK_KEY = "cherrychat.connection.current";

export type ConnectionStorageBackend = "indexeddb" | "localstorage";

export interface ConnectionStoreStatus {
  backend: ConnectionStorageBackend;
  persistent: boolean;
}

type LocalStoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export class ConnectionStore {
  private backend: ConnectionStorageBackend | null = null;

  constructor(
    private readonly database: ChatDatabase,
    private readonly localStorage: LocalStoragePort,
    private readonly forceLocalStorage = false,
  ) {}

  async initialize(): Promise<ConnectionStoreStatus> {
    if (this.backend) {
      return { backend: this.backend, persistent: true };
    }

    if (this.forceLocalStorage) {
      this.backend = "localstorage";
      return { backend: this.backend, persistent: true };
    }

    try {
      await this.database.open();
      this.backend = "indexeddb";
    } catch {
      this.backend = "localstorage";
    }

    return { backend: this.backend, persistent: true };
  }

  async load(): Promise<ConnectionBundle | null> {
    const { backend } = await this.initialize();
    if (backend === "localstorage") {
      const raw = this.localStorage.getItem(FALLBACK_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      return connectionBundleSchema.parse(parsed);
    }

    const [connection, credential] = await Promise.all([
      this.database.connections.get("current"),
      this.database.credentials.get("current"),
    ]);
    if (!connection || !credential) return null;
    return connectionBundleSchema.parse({ connection, credential });
  }

  async save(bundle: ConnectionBundle): Promise<void> {
    const validated = connectionBundleSchema.parse(bundle);
    const { backend } = await this.initialize();
    if (backend === "localstorage") {
      this.localStorage.setItem(FALLBACK_KEY, JSON.stringify(validated));
      return;
    }

    await this.database.transaction(
      "rw",
      this.database.connections,
      this.database.credentials,
      async () => {
        await this.database.connections.put(validated.connection);
        await this.database.credentials.put(validated.credential);
      },
    );
  }

  async clear(): Promise<void> {
    this.localStorage.removeItem(FALLBACK_KEY);
    const { backend } = await this.initialize();
    if (backend === "indexeddb") {
      await this.database.transaction(
        "rw",
        this.database.connections,
        this.database.credentials,
        async () => {
          await this.database.connections.clear();
          await this.database.credentials.clear();
        },
      );
    }
  }
}
