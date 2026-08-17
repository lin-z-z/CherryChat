import { z } from "zod";

import {
  IMAGE_GENERATION_ASPECT_RATIOS,
  IMAGE_GENERATION_OUTPUT_FORMATS,
  IMAGE_GENERATION_QUALITIES,
  IMAGE_GENERATION_RESOLUTION_TIERS,
  type ImageGenerationConfiguration,
  type ImageGenerationParameters,
  type ImageGenerationProfile,
  type ImageGenerationSaveInput,
} from "@/runtime/chat/types";
import {
  DEFAULT_IMAGE_GENERATION_BASE_URL,
  DEFAULT_IMAGE_GENERATION_MODEL,
  normalizeImageBaseUrl,
} from "@/runtime/image-generation/image-generation-contract";
import {
  DEFAULT_IMAGE_GENERATION_PARAMETERS,
  isValidImageGenerationSize,
  normalizeImageGenerationParameters,
} from "@/runtime/image-generation/image-generation-options";
import type { ChatDatabase } from "@/storage/database";
import { normalizeStorageError } from "@/storage/errors";

export const IMAGE_GENERATION_SETTINGS_KEY = "imageGeneration";
const IMAGE_GENERATION_CREDENTIAL_KEY = "image-generation-credential.v4";
const OBSOLETE_IMAGE_GENERATION_CREDENTIAL_KEYS = [
  "image-generation-credential",
  "image-generation-credentials.v2",
] as const;
const DEFAULT_PROFILE_ID = "default-gpt-image-2";

const profileIdSchema = z.string().trim().min(1).max(128);
const parametersSchema = z
  .object({
    resolutionTier: z.enum(IMAGE_GENERATION_RESOLUTION_TIERS),
    aspectRatio: z.enum(IMAGE_GENERATION_ASPECT_RATIOS),
    size: z.string().refine(isValidImageGenerationSize),
    quality: z.enum(IMAGE_GENERATION_QUALITIES),
    outputFormat: z.enum(IMAGE_GENERATION_OUTPUT_FORMATS),
    outputCompression: z.number().int().min(0).max(100).nullable(),
  })
  .strict();
const settingsSchema = z
  .object({
    version: z.literal(4),
    baseUrl: z.string().min(1).max(2_048),
    activeHostedProfileId: profileIdSchema.nullable().default(null),
    parametersByProfile: z.record(z.string(), parametersSchema),
  })
  .strict();
const credentialsSchema = z
  .object({
    version: z.literal(1),
    apiKey: z.string().trim().min(8).max(2_048),
  })
  .strict();

type StoredSettings = z.infer<typeof settingsSchema>;

export class ImageGenerationRepository {
  constructor(
    private readonly database: ChatDatabase,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async load(): Promise<ImageGenerationConfiguration> {
    try {
      return await this.loadConfiguration();
    } catch (cause) {
      throw normalizeStorageError(cause);
    }
  }

  async save(
    input: ImageGenerationSaveInput,
  ): Promise<ImageGenerationConfiguration> {
    const current = await this.load();
    const profile = createByokProfile(input.baseUrl, input.apiKey);
    const parametersByProfile = normalizeParametersByProfile(
      [profile],
      current.parametersByProfile,
    );
    return this.persist({
      profiles: [profile],
      defaultProfileId: profile.id,
      activeProfileId: profile.id,
      activeHostedProfileId: current.activeHostedProfileId,
      parametersByProfile,
    });
  }

  async selectHostedProfile(
    profileId: string,
  ): Promise<ImageGenerationConfiguration> {
    const current = await this.load();
    return this.persist({
      ...current,
      activeHostedProfileId: profileIdSchema.parse(profileId),
    });
  }

  async saveParameters(
    profile: Pick<
      ImageGenerationProfile,
      "id" | "mode" | "modelId" | "sizeMode"
    >,
    parameters: ImageGenerationParameters,
  ): Promise<ImageGenerationConfiguration> {
    const current = await this.load();
    const normalizedId = profileIdSchema.parse(profile.id);
    const savedProfile = current.profiles.find(({ id }) => id === normalizedId);
    if (profile.mode === "byok" && !savedProfile) {
      throw new RangeError("Image generation profile does not exist");
    }
    const normalizedParameters = normalizeImageGenerationParameters(
      parametersSchema.parse(parameters),
      savedProfile ?? profile,
    );
    return this.persist({
      ...current,
      ...(profile.mode === "byok"
        ? { activeProfileId: normalizedId }
        : { activeHostedProfileId: normalizedId }),
      parametersByProfile: {
        ...current.parametersByProfile,
        [normalizedId]: normalizedParameters,
      },
    });
  }

  private async loadConfiguration(): Promise<ImageGenerationConfiguration> {
    const [settingsRecord, credentialsRecord] = await Promise.all([
      this.database.settings.get(IMAGE_GENERATION_SETTINGS_KEY),
      this.database.meta.get(IMAGE_GENERATION_CREDENTIAL_KEY),
    ]);
    const credentials = credentialsSchema.safeParse(credentialsRecord?.value);
    const settings = settingsSchema.safeParse(settingsRecord?.value);
    if (settings.success)
      return hydrateConfiguration(
        settings.data,
        credentials.success ? credentials.data.apiKey : "",
      );
    return createDefaultImageGenerationConfiguration();
  }

  private async persist(
    configuration: ImageGenerationConfiguration,
  ): Promise<ImageGenerationConfiguration> {
    const currentProfile = configuration.profiles[0];
    const profile = createByokProfile(
      currentProfile?.baseUrl ?? DEFAULT_IMAGE_GENERATION_BASE_URL,
      currentProfile?.apiKey ?? "",
    );
    const parametersByProfile = normalizeParametersByProfile(
      [profile],
      configuration.parametersByProfile,
    );
    const stored: StoredSettings = {
      version: 4,
      baseUrl: profile.baseUrl,
      activeHostedProfileId: configuration.activeHostedProfileId,
      parametersByProfile,
    };
    const updatedAt = this.now();
    try {
      await this.database.transaction(
        "rw",
        this.database.settings,
        this.database.meta,
        async () => {
          await this.database.settings.put({
            key: IMAGE_GENERATION_SETTINGS_KEY,
            value: settingsSchema.parse(stored),
            updatedAt,
          });
          if (profile.apiKey) {
            await this.database.meta.put({
              key: IMAGE_GENERATION_CREDENTIAL_KEY,
              value: credentialsSchema.parse({
                version: 1,
                apiKey: profile.apiKey,
              }),
              updatedAt,
            });
          } else {
            await this.database.meta.delete(IMAGE_GENERATION_CREDENTIAL_KEY);
          }
          await this.database.meta.bulkDelete([
            ...OBSOLETE_IMAGE_GENERATION_CREDENTIAL_KEYS,
          ]);
        },
      );
    } catch (cause) {
      throw normalizeStorageError(cause);
    }
    return hydrateConfiguration(stored, profile.apiKey);
  }
}

export function createDefaultImageGenerationConfiguration(): ImageGenerationConfiguration {
  const profile = createByokProfile(DEFAULT_IMAGE_GENERATION_BASE_URL, "");
  return {
    profiles: [profile],
    defaultProfileId: profile.id,
    activeProfileId: profile.id,
    activeHostedProfileId: null,
    parametersByProfile: {
      [profile.id]: { ...DEFAULT_IMAGE_GENERATION_PARAMETERS },
    },
  };
}

function createByokProfile(
  baseUrl: string,
  rawApiKey: string,
): ImageGenerationProfile {
  const apiKey = rawApiKey.trim();
  if (apiKey) {
    z.string().min(8).max(2_048).parse(apiKey);
  }
  return {
    id: DEFAULT_PROFILE_ID,
    name: "GPT Image 2",
    mode: "byok",
    baseUrl: normalizeImageBaseUrl(baseUrl),
    apiKey,
    modelId: DEFAULT_IMAGE_GENERATION_MODEL,
    sizeMode: "auto",
    hasApiKey: Boolean(apiKey),
  };
}

function hydrateConfiguration(
  settings: StoredSettings,
  apiKey: string,
): ImageGenerationConfiguration {
  const profile = createByokProfile(settings.baseUrl, apiKey);
  return {
    profiles: [profile],
    defaultProfileId: profile.id,
    activeProfileId: profile.id,
    activeHostedProfileId: settings.activeHostedProfileId,
    parametersByProfile: normalizeParametersByProfile(
      [profile],
      settings.parametersByProfile,
    ),
  };
}

function normalizeParametersByProfile(
  profiles: readonly ImageGenerationProfile[],
  parametersByProfile: Readonly<Record<string, ImageGenerationParameters>>,
): Record<string, ImageGenerationParameters> {
  const preserved = Object.fromEntries(
    Object.entries(parametersByProfile).filter(
      ([id, parameters]) =>
        !profiles.some((profile) => profile.id === id) &&
        parametersSchema.safeParse(parameters).success,
    ),
  );
  return {
    ...preserved,
    ...Object.fromEntries(
      profiles.map((profile) => [
        profile.id,
        normalizeImageGenerationParameters(
          parametersByProfile[profile.id],
          profile,
        ),
      ]),
    ),
  };
}
