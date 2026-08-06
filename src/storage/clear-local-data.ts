import type { ChatDatabase } from "@/storage/database";

const LOCAL_KEY_PREFIX = "cherrychat.";

type LocalStoragePort = Pick<Storage, "key" | "length" | "removeItem">;

export async function clearLocalData(
  database: ChatDatabase,
  localStorage: LocalStoragePort,
): Promise<void> {
  await database.delete();

  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(LOCAL_KEY_PREFIX)) keys.push(key);
  }
  for (const key of keys) localStorage.removeItem(key);
}
