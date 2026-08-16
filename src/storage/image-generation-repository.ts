import { z } from "zod";

import {
  IMAGE_GENERATION_QUALITIES,
  IMAGE_GENERATION_SIZES,
  type ImageGenerationConfiguration,
  type ImageGenerationSaveInput,
} from "@/runtime/chat/types";
import {
  DEFAULT_IMAGE_EDIT_URL,
  DEFAULT_IMAGE_GENERATION_MODEL,
  DEFAULT_IMAGE_GENERATION_URL,
  normalizeImageEndpointUrl,
} from "@/runtime/image-generation/image-generation-contract";
import type { ChatDatabase } from "@/storage/database";
import { normalizeStorageError } from "@/storage/errors";

export const IMAGE_GENERATION_SETTINGS_KEY = "imageGeneration";
const IMAGE_GENERATION_CREDENTIAL_KEY = "image-generation-credential";

const settingsSchema = z
  .object({
    generationUrl: z.string().min(1).max(2_048),
    editUrl: z.string().min(1).max(2_048),
    modelId: z.string().trim().min(1).max(512),
    size: z.enum(IMAGE_GENERATION_SIZES),
    quality: z.enum(IMAGE_GENERATION_QUALITIES),
  })
  .strict();
const credentialSchema = z
  .object({ apiKey: z.string().trim().min(8).max(2_048) })
  .strict();

export class ImageGenerationRepository {
  constructor(
    private readonly database: ChatDatabase,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async load(): Promise<ImageGenerationConfiguration> {
    try {
      const [settingsRecord, credentialRecord] = await Promise.all([
        this.database.settings.get(IMAGE_GENERATION_SETTINGS_KEY),
        this.database.meta.get(IMAGE_GENERATION_CREDENTIAL_KEY),
      ]);
      const parsedSettings = settingsSchema.safeParse(settingsRecord?.value);
      const parsedCredential = credentialSchema.safeParse(
        credentialRecord?.value,
      );
      const settings = parsedSettings.success
        ? parsedSettings.data
        : defaultSettings();
      return {
        ...settings,
        apiKey: parsedCredential.success ? parsedCredential.data.apiKey : "",
        hasApiKey: parsedCredential.success,
      };
    } catch (cause) {
      throw normalizeStorageError(cause);
    }
  }

  async save(
    input: ImageGenerationSaveInput,
  ): Promise<ImageGenerationConfiguration> {
    const apiKey = input.apiKey.trim();
    const settings = settingsSchema.parse({
      generationUrl: normalizeImageEndpointUrl(input.generationUrl),
      editUrl: normalizeImageEndpointUrl(input.editUrl),
      modelId: input.modelId.normalize("NFKC").trim(),
      size: input.size,
      quality: input.quality,
    });
    if (apiKey) credentialSchema.parse({ apiKey });
    const updatedAt = this.now();
    try {
      await this.database.transaction(
        "rw",
        this.database.settings,
        this.database.meta,
        async () => {
          await this.database.settings.put({
            key: IMAGE_GENERATION_SETTINGS_KEY,
            value: settings,
            updatedAt,
          });
          if (apiKey) {
            await this.database.meta.put({
              key: IMAGE_GENERATION_CREDENTIAL_KEY,
              value: { apiKey },
              updatedAt,
            });
          } else {
            await this.database.meta.delete(IMAGE_GENERATION_CREDENTIAL_KEY);
          }
        },
      );
      return { ...settings, apiKey, hasApiKey: Boolean(apiKey) };
    } catch (cause) {
      throw normalizeStorageError(cause);
    }
  }
}

function defaultSettings() {
  return {
    generationUrl: DEFAULT_IMAGE_GENERATION_URL,
    editUrl: DEFAULT_IMAGE_EDIT_URL,
    modelId: DEFAULT_IMAGE_GENERATION_MODEL,
    size: "1024x1024" as const,
    quality: "auto" as const,
  };
}
