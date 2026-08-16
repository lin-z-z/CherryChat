import { z } from "zod";

import {
  IMAGE_GENERATION_ASPECT_RATIOS,
  IMAGE_GENERATION_OUTPUT_FORMATS,
  IMAGE_GENERATION_QUALITIES,
  IMAGE_GENERATION_RESOLUTION_TIERS,
  IMAGE_GENERATION_SIZE_MODES,
  IMAGE_GENERATION_SIZES,
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
  parametersFromLegacySize,
} from "@/runtime/image-generation/image-generation-options";
import type { ChatDatabase } from "@/storage/database";
import { normalizeStorageError } from "@/storage/errors";

export const IMAGE_GENERATION_SETTINGS_KEY = "imageGeneration";
const LEGACY_IMAGE_GENERATION_CREDENTIAL_KEY = "image-generation-credential";
const IMAGE_GENERATION_CREDENTIALS_KEY = "image-generation-credentials.v2";
const DEFAULT_PROFILE_ID = "default-gpt-image-2";

const profileIdSchema = z.string().trim().min(1).max(128);
const storedProfileSchema = z
  .object({
    id: profileIdSchema,
    name: z.string().trim().min(1).max(100),
    baseUrl: z.string().min(1).max(2_048),
    modelId: z.string().trim().min(1).max(512),
    sizeMode: z.enum(IMAGE_GENERATION_SIZE_MODES),
  })
  .strict();
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
    version: z.literal(3),
    profiles: z.array(storedProfileSchema).min(1).max(32),
    defaultProfileId: profileIdSchema,
    activeProfileId: profileIdSchema,
    activeHostedProfileId: profileIdSchema.nullable().default(null),
    parametersByProfile: z.record(z.string(), parametersSchema),
  })
  .strict();
const legacyStoredProfileSchema = z
  .object({
    id: profileIdSchema,
    name: z.string().trim().min(1).max(100),
    generationUrl: z.string().min(1).max(2_048),
    editUrl: z.string().min(1).max(2_048),
    modelId: z.string().trim().min(1).max(512),
    sizeMode: z.enum(IMAGE_GENERATION_SIZE_MODES),
  })
  .strict();
const legacySettingsV2Schema = z
  .object({
    version: z.literal(2),
    profiles: z.array(legacyStoredProfileSchema).min(1).max(32),
    defaultProfileId: profileIdSchema,
    activeProfileId: profileIdSchema,
    activeHostedProfileId: profileIdSchema.nullable().default(null),
    parametersByProfile: z.record(z.string(), parametersSchema),
  })
  .strict();
const credentialsSchema = z
  .object({
    version: z.literal(2),
    apiKeys: z.record(z.string(), z.string().trim().min(8).max(2_048)),
  })
  .strict();
const legacySettingsSchema = z
  .object({
    generationUrl: z.string().min(1).max(2_048),
    editUrl: z.string().min(1).max(2_048),
    modelId: z.string().trim().min(1).max(512),
    size: z.enum(IMAGE_GENERATION_SIZES),
    quality: z.enum(IMAGE_GENERATION_QUALITIES),
  })
  .strict();
const legacyCredentialSchema = z
  .object({ apiKey: z.string().trim().min(8).max(2_048) })
  .strict();

type StoredProfile = z.infer<typeof storedProfileSchema>;
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
    const normalizedProfiles = normalizeProfiles(input.profiles);
    const defaultProfileId = profileIdSchema.parse(input.defaultProfileId);
    assertProfileExists(normalizedProfiles, defaultProfileId);
    const activeProfileId = normalizedProfiles.some(
      ({ id }) => id === current.activeProfileId,
    )
      ? current.activeProfileId
      : defaultProfileId;
    const parametersByProfile = normalizeParametersByProfile(
      normalizedProfiles,
      current.parametersByProfile,
    );
    return this.persist({
      profiles: normalizedProfiles,
      defaultProfileId,
      activeProfileId,
      activeHostedProfileId: current.activeHostedProfileId,
      parametersByProfile,
    });
  }

  async selectProfile(
    profileId: string,
  ): Promise<ImageGenerationConfiguration> {
    const current = await this.load();
    const normalizedId = profileIdSchema.parse(profileId);
    assertProfileExists(current.profiles, normalizedId);
    return this.persist({ ...current, activeProfileId: normalizedId });
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
    const [settingsRecord, credentialsRecord, legacyCredentialRecord] =
      await Promise.all([
        this.database.settings.get(IMAGE_GENERATION_SETTINGS_KEY),
        this.database.meta.get(IMAGE_GENERATION_CREDENTIALS_KEY),
        this.database.meta.get(LEGACY_IMAGE_GENERATION_CREDENTIAL_KEY),
      ]);
    const credentials = credentialsSchema.safeParse(credentialsRecord?.value);
    const settings = settingsSchema.safeParse(settingsRecord?.value);
    if (settings.success) {
      return hydrateConfiguration(
        settings.data,
        credentials.success ? credentials.data.apiKeys : {},
      );
    }
    const legacySettingsV2 = legacySettingsV2Schema.safeParse(
      settingsRecord?.value,
    );
    if (legacySettingsV2.success) {
      const migrated: StoredSettings = {
        version: 3,
        profiles: legacySettingsV2.data.profiles.map((profile) => ({
          ...profile,
          baseUrl: normalizeImageBaseUrl(profile.generationUrl),
        })),
        defaultProfileId: legacySettingsV2.data.defaultProfileId,
        activeProfileId: legacySettingsV2.data.activeProfileId,
        activeHostedProfileId: legacySettingsV2.data.activeHostedProfileId,
        parametersByProfile: legacySettingsV2.data.parametersByProfile,
      };
      return hydrateConfiguration(
        migrated,
        credentials.success ? credentials.data.apiKeys : {},
      );
    }
    const legacySettings = legacySettingsSchema.safeParse(
      settingsRecord?.value,
    );
    const legacyCredential = legacyCredentialSchema.safeParse(
      legacyCredentialRecord?.value,
    );
    if (legacySettings.success) {
      const profile = normalizeProfile({
        id: DEFAULT_PROFILE_ID,
        name: legacySettings.data.modelId,
        mode: "byok",
        baseUrl: normalizeImageBaseUrl(legacySettings.data.generationUrl),
        apiKey: legacyCredential.success ? legacyCredential.data.apiKey : "",
        modelId: legacySettings.data.modelId,
        sizeMode: "auto",
        hasApiKey: legacyCredential.success,
      });
      return {
        profiles: [profile],
        defaultProfileId: profile.id,
        activeProfileId: profile.id,
        activeHostedProfileId: null,
        parametersByProfile: {
          [profile.id]: parametersFromLegacySize(
            legacySettings.data.size,
            legacySettings.data.quality,
          ),
        },
      };
    }
    return createDefaultImageGenerationConfiguration();
  }

  private async persist(
    configuration: ImageGenerationConfiguration,
  ): Promise<ImageGenerationConfiguration> {
    const normalizedProfiles = normalizeProfiles(configuration.profiles);
    assertProfileExists(normalizedProfiles, configuration.defaultProfileId);
    assertProfileExists(normalizedProfiles, configuration.activeProfileId);
    const parametersByProfile = normalizeParametersByProfile(
      normalizedProfiles,
      configuration.parametersByProfile,
    );
    const stored: StoredSettings = {
      version: 3,
      profiles: normalizedProfiles.map(toStoredProfile),
      defaultProfileId: configuration.defaultProfileId,
      activeProfileId: configuration.activeProfileId,
      activeHostedProfileId: configuration.activeHostedProfileId,
      parametersByProfile,
    };
    const apiKeys = Object.fromEntries(
      normalizedProfiles
        .filter(({ apiKey }) => apiKey.length > 0)
        .map(({ id, apiKey }) => [id, apiKey]),
    );
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
          if (Object.keys(apiKeys).length > 0) {
            await this.database.meta.put({
              key: IMAGE_GENERATION_CREDENTIALS_KEY,
              value: credentialsSchema.parse({ version: 2, apiKeys }),
              updatedAt,
            });
          } else {
            await this.database.meta.delete(IMAGE_GENERATION_CREDENTIALS_KEY);
          }
          await this.database.meta.delete(
            LEGACY_IMAGE_GENERATION_CREDENTIAL_KEY,
          );
        },
      );
    } catch (cause) {
      throw normalizeStorageError(cause);
    }
    return hydrateConfiguration(stored, apiKeys);
  }
}

export function createDefaultImageGenerationConfiguration(): ImageGenerationConfiguration {
  const profile: ImageGenerationProfile = {
    id: DEFAULT_PROFILE_ID,
    name: "GPT Image 2",
    mode: "byok",
    baseUrl: DEFAULT_IMAGE_GENERATION_BASE_URL,
    apiKey: "",
    modelId: DEFAULT_IMAGE_GENERATION_MODEL,
    sizeMode: "auto",
    hasApiKey: false,
  };
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

function normalizeProfiles(
  profiles: readonly ImageGenerationProfile[],
): ImageGenerationProfile[] {
  if (profiles.length < 1 || profiles.length > 32) {
    throw new RangeError(
      "Configure from 1 through 32 image generation profiles",
    );
  }
  const normalized = profiles.map(normalizeProfile);
  if (new Set(normalized.map(({ id }) => id)).size !== normalized.length) {
    throw new RangeError("Image generation profile IDs must be unique");
  }
  return normalized;
}

function normalizeProfile(
  profile: ImageGenerationProfile,
): ImageGenerationProfile {
  if (profile.mode !== "byok") {
    throw new RangeError(
      "Only personal image generation profiles can be saved",
    );
  }
  const id = profileIdSchema.parse(profile.id);
  const name = z.string().trim().min(1).max(100).parse(profile.name);
  const modelId = z
    .string()
    .trim()
    .min(1)
    .max(512)
    .parse(profile.modelId.normalize("NFKC"));
  const apiKey = profile.apiKey.trim();
  if (apiKey) {
    z.string().min(8).max(2_048).parse(apiKey);
  }
  return {
    id,
    name,
    mode: "byok",
    baseUrl: normalizeImageBaseUrl(profile.baseUrl),
    apiKey,
    modelId,
    sizeMode: z.enum(IMAGE_GENERATION_SIZE_MODES).parse(profile.sizeMode),
    hasApiKey: Boolean(apiKey),
  };
}

function toStoredProfile(profile: ImageGenerationProfile): StoredProfile {
  return {
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    modelId: profile.modelId,
    sizeMode: profile.sizeMode,
  };
}

function hydrateConfiguration(
  settings: StoredSettings,
  apiKeys: Record<string, string>,
): ImageGenerationConfiguration {
  const profiles = settings.profiles.map((profile) => {
    const apiKey = apiKeys[profile.id] ?? "";
    return {
      ...profile,
      mode: "byok" as const,
      apiKey,
      hasApiKey: Boolean(apiKey),
    };
  });
  const defaultProfileId = profiles.some(
    ({ id }) => id === settings.defaultProfileId,
  )
    ? settings.defaultProfileId
    : profiles[0]?.id;
  if (!defaultProfileId) return createDefaultImageGenerationConfiguration();
  const activeProfileId = profiles.some(
    ({ id }) => id === settings.activeProfileId,
  )
    ? settings.activeProfileId
    : defaultProfileId;
  return {
    profiles,
    defaultProfileId,
    activeProfileId,
    activeHostedProfileId: settings.activeHostedProfileId,
    parametersByProfile: normalizeParametersByProfile(
      profiles,
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

function assertProfileExists(
  profiles: readonly Pick<ImageGenerationProfile, "id">[],
  profileId: string,
): void {
  if (!profiles.some(({ id }) => id === profileId)) {
    throw new RangeError("Image generation profile does not exist");
  }
}
