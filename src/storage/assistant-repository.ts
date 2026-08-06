import { assistantSchema } from "@/runtime/chat/schemas";
import {
  createAssistantSnapshot,
  DEFAULT_ASSISTANT_ICON,
  DEFAULT_ASSISTANT_ID,
  DEFAULT_ASSISTANT_NAME,
  type AssistantIcon,
  type AssistantRecord,
  type AssistantSnapshot,
} from "@/runtime/chat/types";
import type { ChatDatabase } from "@/storage/database";
import { normalizeStorageError } from "@/storage/errors";

const MAX_ASSISTANT_NAME_LENGTH = 80;
const MAX_ASSISTANT_PROMPT_LENGTH = 20_000;

interface AssistantRepositoryDependencies {
  createId: () => string;
  now: () => string;
}

export interface AssistantInput {
  name: string;
  icon: AssistantIcon;
  systemPrompt: string;
}

export class AssistantNotFoundError extends Error {
  constructor(assistantId: string) {
    super(`Assistant does not exist: ${assistantId}`);
    this.name = "AssistantNotFoundError";
  }
}

export class DefaultAssistantOperationError extends Error {
  constructor(operation: "delete" | "identity") {
    super(
      operation === "delete"
        ? "The Default Assistant cannot be deleted"
        : "The Default Assistant name and icon cannot be changed",
    );
    this.name = "DefaultAssistantOperationError";
  }
}

const defaultDependencies: AssistantRepositoryDependencies = {
  createId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

export class AssistantRepository {
  private readonly dependencies: AssistantRepositoryDependencies;

  constructor(
    private readonly database: ChatDatabase,
    dependencies: Partial<AssistantRepositoryDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async ensureDefault(): Promise<AssistantRecord> {
    try {
      return await this.database.transaction(
        "rw",
        this.database.assistants,
        async () => {
          const existing =
            await this.database.assistants.get(DEFAULT_ASSISTANT_ID);
          const timestamp = this.dependencies.now();
          const record = assistantSchema.parse({
            id: DEFAULT_ASSISTANT_ID,
            kind: "default",
            name: DEFAULT_ASSISTANT_NAME,
            icon: DEFAULT_ASSISTANT_ICON,
            systemPrompt: existing?.systemPrompt ?? "",
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: existing?.updatedAt ?? timestamp,
          });
          await this.database.assistants.put(record);
          return record;
        },
      );
    } catch (cause) {
      throw normalizeStorageError(cause);
    }
  }

  async list(): Promise<AssistantRecord[]> {
    const records = (await this.database.assistants.toArray()).map((record) =>
      assistantSchema.parse(record),
    );
    return records.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "default" ? -1 : 1;
      return left.createdAt.localeCompare(right.createdAt);
    });
  }

  async get(assistantId: string): Promise<AssistantRecord> {
    const record = await this.database.assistants.get(assistantId);
    if (!record) throw new AssistantNotFoundError(assistantId);
    return assistantSchema.parse(record);
  }

  async create(input: AssistantInput): Promise<AssistantRecord> {
    const normalized = normalizeAssistantInput(input);
    const timestamp = this.dependencies.now();
    const record = assistantSchema.parse({
      id: this.dependencies.createId(),
      kind: "custom",
      ...normalized,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    try {
      await this.database.assistants.add(record);
      return record;
    } catch (cause) {
      throw normalizeStorageError(cause);
    }
  }

  async update(
    assistantId: string,
    input: AssistantInput,
  ): Promise<AssistantRecord> {
    const current = await this.get(assistantId);
    const normalized = normalizeAssistantInput(input);
    if (
      current.kind === "default" &&
      (normalized.name !== DEFAULT_ASSISTANT_NAME ||
        normalized.icon !== DEFAULT_ASSISTANT_ICON)
    ) {
      throw new DefaultAssistantOperationError("identity");
    }
    const record = assistantSchema.parse({
      ...current,
      ...normalized,
      updatedAt: this.dependencies.now(),
    });
    try {
      await this.database.assistants.put(record);
      return record;
    } catch (cause) {
      throw normalizeStorageError(cause);
    }
  }

  async delete(assistantId: string): Promise<void> {
    const current = await this.get(assistantId);
    if (current.kind === "default") {
      throw new DefaultAssistantOperationError("delete");
    }
    try {
      await this.database.assistants.delete(assistantId);
    } catch (cause) {
      throw normalizeStorageError(cause);
    }
  }

  snapshot(assistant: AssistantRecord): AssistantSnapshot {
    return createAssistantSnapshot(assistantSchema.parse(assistant));
  }
}

function normalizeAssistantInput(input: AssistantInput): AssistantInput {
  const name = input.name.trim();
  const systemPrompt = input.systemPrompt.trim();
  if (!name) throw new RangeError("Assistant name is required");
  if (name.length > MAX_ASSISTANT_NAME_LENGTH) {
    throw new RangeError(
      `Assistant name cannot exceed ${MAX_ASSISTANT_NAME_LENGTH} characters`,
    );
  }
  if (systemPrompt.length > MAX_ASSISTANT_PROMPT_LENGTH) {
    throw new RangeError(
      `Assistant prompt cannot exceed ${MAX_ASSISTANT_PROMPT_LENGTH} characters`,
    );
  }
  return { name, icon: input.icon, systemPrompt };
}
