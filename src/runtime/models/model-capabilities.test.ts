import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  compactModelCapabilityOverride,
  getBuiltinModelCapability,
  getCatalogModelCapability,
  inferModelCapability,
  MODEL_CAPABILITY_REGISTRY_VERSION,
  resolveModelCapability,
} from "@/runtime/models/model-capabilities";
import { resolveModelList } from "@/runtime/models/model-list";
import { normalizeModelLookupName } from "@/runtime/models/model-id-normalization";
import { createDefaultModelPreferences } from "@/runtime/chat/types";
import { ChatDatabase } from "@/storage/database";
import { ModelCapabilityRepository } from "@/storage/model-capability-repository";

describe("model capabilities", () => {
  it("resolves known families from a versioned registry", () => {
    expect(MODEL_CAPABILITY_REGISTRY_VERSION).toBe(7);
    expect(getBuiltinModelCapability("gpt-5-mini")).toMatchObject({
      reasoning: true,
      vision: true,
      tools: true,
      source: "builtin",
      supportedEfforts: ["minimal", "low", "medium", "high"],
    });
    expect(getBuiltinModelCapability("openai/gpt-4.1-mini")).toMatchObject({
      vision: true,
      contextWindow: 1_047_576,
    });
    expect(getBuiltinModelCapability("custom-model")).toBeNull();
  });

  it("uses manual Grok 4.5 semantics before the generated catalogue", () => {
    expect(getBuiltinModelCapability("xai/grok-4.5")).toMatchObject({
      reasoning: true,
      supportedEfforts: ["low", "medium", "high"],
      vision: true,
      contextWindow: 500_000,
      temperature: "supported",
      topP: "unknown",
      source: "builtin",
    });
    expect(resolveModelCapability("grok-4.5")).toMatchObject({
      reasoning: true,
      supportedEfforts: ["low", "medium", "high"],
      source: "builtin",
    });
  });

  it("resolves models outside the manual registry from the static catalogue", () => {
    expect(
      getCatalogModelCapability("mistral/mistral-small-latest"),
    ).toMatchObject({
      reasoning: true,
      supportedEfforts: ["none", "high"],
      vision: true,
      contextWindow: 256_000,
      temperature: "supported",
      topP: "unknown",
      source: "catalog",
    });
    expect(getCatalogModelCapability("mistral-small-latest")).toMatchObject({
      source: "catalog",
    });
    expect(resolveModelCapability("mistral-small-latest")).toMatchObject({
      source: "catalog",
    });
  });

  it("keeps exact Gemini 3.1 Pro levels ahead of the broad family fallback", () => {
    for (const modelId of [
      "gemini-3.1-pro-preview",
      "google/gemini-3.1-pro-preview-customtools",
      "gemini-3.1-pro-customtools",
    ]) {
      expect(resolveModelCapability(modelId)).toMatchObject({
        reasoning: true,
        supportedEfforts: ["low", "medium", "high"],
        vision: true,
        contextWindow: 1_048_576,
        source: "catalog",
      });
    }
  });

  it("projects reviewed Gemini 2.5 budget controls into the legacy capability", () => {
    expect(resolveModelCapability("gemini-2.5-flash")).toMatchObject({
      reasoning: true,
      supportedEfforts: ["none", "auto", "low", "medium", "high"],
    });
    expect(resolveModelCapability("gemini-2.5-pro")).toMatchObject({
      reasoning: true,
      supportedEfforts: ["auto", "low", "medium", "high"],
    });
  });

  it("resolves common provider aliases through a collision-safe lookup key", () => {
    const aliases = [
      ["gpt-5-4", "openai/gpt-5.4"],
      ["gpt_5.4-fp8", "openai/gpt-5.4"],
      ["us.anthropic.claude-sonnet-4-5-v1:0", "anthropic/claude-sonnet-4-5"],
      ["grok-4.5-20250929", "xai/grok-4.5"],
      ["deepseek-v4_flash", "deepseek/deepseek-v4-flash"],
      ["glm-4_5-fp8", "zhipuai/glm-4.5"],
      [
        "qwen3-coder-30b-a3b-instruct-fp8",
        "alibaba/qwen3-coder-30b-a3b-instruct",
      ],
    ] as const;

    for (const [alias, canonical] of aliases) {
      const expected = getCatalogModelCapability(canonical);
      expect(expected, canonical).not.toBeNull();
      expect(getCatalogModelCapability(alias), alias).toMatchObject({
        reasoning: expected?.reasoning,
        supportedEfforts: expected?.supportedEfforts,
        vision: expected?.vision,
        contextWindow: expected?.contextWindow,
        source: "catalog",
      });
    }
  });

  it("normalizes lookup aliases without changing the upstream model ID", () => {
    expect(normalizeModelLookupName("gpt_5.4-fp8")).toBe("gpt-5-4");
    expect(
      normalizeModelLookupName("us.anthropic.claude-sonnet-4-5-v1:0"),
    ).toBe("claude-sonnet-4-5");
    expect(normalizeModelLookupName("zai-org-glm-5-thinking")).toBe("glm-5");
  });

  it("maps stable IDs to unambiguous preview catalogue capabilities", () => {
    for (const modelId of ["gemini-3.1-pro", "google/gemini-3.1-pro"]) {
      expect(getCatalogModelCapability(modelId)).toMatchObject({
        reasoning: true,
        supportedEfforts: ["low", "medium", "high"],
        contextWindow: 1_048_576,
        source: "catalog",
      });
      expect(resolveModelCapability(modelId)).toMatchObject({
        supportedEfforts: ["low", "medium", "high"],
        source: "catalog",
      });
    }
    expect(getCatalogModelCapability("gemini-3-pro")).toMatchObject({
      reasoning: true,
      supportedEfforts: ["low", "high"],
      contextWindow: 1_048_576,
      source: "catalog",
    });
  });

  it("keeps precise catalogue records ahead of broad family fallbacks", () => {
    const catalogueBackedModels = [
      {
        modelId: "openai/gpt-5.1-chat-latest",
        expected: {
          supportedEfforts: [],
          contextWindow: 128_000,
          temperature: "unsupported",
        },
      },
      {
        modelId: "openai/gpt-5.2-pro",
        expected: {
          supportedEfforts: ["medium", "high", "xhigh"],
          contextWindow: 400_000,
          temperature: "unsupported",
        },
      },
      {
        modelId: "openai/gpt-5.4",
        expected: {
          supportedEfforts: ["none", "low", "medium", "high", "xhigh"],
          contextWindow: 1_050_000,
          temperature: "unsupported",
        },
      },
      {
        modelId: "anthropic/claude-opus-4-6",
        expected: {
          supportedEfforts: ["low", "medium", "high", "max"],
          contextWindow: 1_000_000,
          temperature: "supported",
        },
        reviewedExpected: {
          supportedEfforts: ["none", "low", "medium", "high", "xhigh"],
        },
      },
      {
        modelId: "anthropic/claude-opus-4-7",
        expected: {
          supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
          contextWindow: 1_000_000,
          temperature: "unsupported",
        },
        reviewedExpected: {
          supportedEfforts: ["none", "low", "medium", "high", "xhigh"],
        },
      },
      {
        modelId: "google/gemini-3-pro-preview",
        expected: {
          supportedEfforts: ["low", "high"],
          contextWindow: 1_048_576,
          temperature: "supported",
        },
      },
      {
        modelId: "google/gemini-3-flash-preview",
        expected: {
          supportedEfforts: ["minimal", "low", "medium", "high"],
          contextWindow: 1_048_576,
          temperature: "supported",
        },
      },
      {
        modelId: "alibaba/qwen3-coder-plus",
        expected: {
          reasoning: false,
          vision: false,
          contextWindow: 1_048_576,
        },
      },
      {
        modelId: "alibaba/qwen3-coder-30b-a3b-instruct",
        expected: {
          reasoning: false,
          vision: false,
          contextWindow: 262_144,
        },
      },
      {
        modelId: "deepseek/deepseek-reasoner",
        expected: {
          supportedEfforts: [],
          contextWindow: 1_000_000,
          temperature: "supported",
        },
      },
      {
        modelId: "deepseek/deepseek-v4-flash",
        expected: {
          supportedEfforts: ["high", "max"],
          contextWindow: 1_000_000,
          temperature: "supported",
        },
        reviewedExpected: {
          supportedEfforts: ["none", "low", "high", "max"],
        },
      },
      {
        modelId: "xai/grok-4.3",
        expected: {
          supportedEfforts: ["none", "low", "medium", "high"],
          contextWindow: 1_000_000,
          temperature: "supported",
        },
      },
      {
        modelId: "zhipuai/glm-5.2",
        expected: {
          supportedEfforts: ["high", "max"],
          contextWindow: 1_000_000,
          temperature: "supported",
        },
        reviewedExpected: {
          supportedEfforts: ["none", "high", "max"],
        },
      },
    ] as const;

    for (const { modelId, expected, ...entry } of catalogueBackedModels) {
      const catalog = getCatalogModelCapability(modelId);
      const resolved = resolveModelCapability(modelId);

      expect(
        catalog,
        `${modelId} must exist in the static catalogue`,
      ).not.toBeNull();
      if (!catalog) continue;

      expect(catalog).toMatchObject(expected);
      const reviewedExpected =
        "reviewedExpected" in entry ? entry.reviewedExpected : {};
      expect(resolved).toMatchObject({
        reasoning: catalog.reasoning,
        supportedEfforts: catalog.supportedEfforts,
        vision: catalog.vision,
        contextWindow: catalog.contextWindow,
        temperature: catalog.temperature,
        topP: catalog.topP,
        source: "catalog",
        ...reviewedExpected,
      });
    }
  });

  it("keeps exact built-in corrections ahead of a generated catalogue record", () => {
    const catalog = getCatalogModelCapability("xai/grok-4.5");
    const resolved = resolveModelCapability("xai/grok-4.5");

    expect(catalog).toMatchObject({
      contextWindow: 500_000,
      supportedEfforts: ["low", "medium", "high"],
    });
    expect(resolved).toMatchObject({
      contextWindow: 500_000,
      supportedEfforts: ["low", "medium", "high"],
      source: "builtin",
    });
  });

  it("maps representative provider families without hiding user overrides", () => {
    expect(
      getBuiltinModelCapability("anthropic/claude-sonnet-4-5"),
    ).toMatchObject({
      reasoning: true,
      vision: true,
      contextWindow: 200_000,
    });
    expect(getBuiltinModelCapability("google/gemini-2.5-pro")).toMatchObject({
      reasoning: true,
      vision: true,
      contextWindow: 1_048_576,
    });
    expect(getBuiltinModelCapability("qwen/qwen3-vl-32b")).toMatchObject({
      reasoning: true,
      vision: true,
    });
    expect(getBuiltinModelCapability("qwen3:8b")).toMatchObject({
      reasoning: true,
      vision: false,
    });
    expect(getBuiltinModelCapability("deepseek-chat")).toMatchObject({
      reasoning: false,
      vision: false,
      tools: true,
    });
    expect(
      resolveModelCapability("google/gemini-2.5-pro", {
        reasoning: false,
        vision: false,
      }),
    ).toMatchObject({ reasoning: false, vision: false, source: "user" });
  });

  it("infers unknown fixed reasoning and vision models independently", () => {
    expect(inferModelCapability("vendor-reasoner-v2")).toMatchObject({
      reasoning: true,
      supportedEfforts: [],
      vision: false,
      source: "inferred",
    });
    expect(inferModelCapability("vendor-vl-chat")).toMatchObject({
      reasoning: false,
      vision: true,
      tools: false,
      source: "inferred",
    });
  });

  it("applies a validated user override without mutating the automatic result", () => {
    const automatic = inferModelCapability("custom-chat");
    const resolved = resolveModelCapability("custom-chat", {
      reasoning: true,
      supportedEfforts: ["low", "high", "low"],
      tools: true,
      contextWindow: 65_536,
    });

    expect(resolved).toMatchObject({
      reasoning: true,
      supportedEfforts: ["low", "high"],
      tools: true,
      contextWindow: 65_536,
      source: "user",
    });
    expect(automatic.source).toBe("inferred");
    expect(automatic.reasoning).toBe(false);
  });

  it("keeps automatic values sparse instead of turning them into user overrides", () => {
    expect(
      compactModelCapabilityOverride("gpt-5-mini", {
        reasoning: true,
        supportedEfforts: ["minimal", "low", "medium", "high"],
        vision: true,
        contextWindow: 400_000,
      }),
    ).toEqual({});
    expect(
      compactModelCapabilityOverride("gpt-5-mini", {
        reasoning: true,
        supportedEfforts: ["low", "high"],
        vision: false,
        contextWindow: 400_000,
      }),
    ).toEqual({ supportedEfforts: ["low", "high"], vision: false });
    expect(
      compactModelCapabilityOverride("gpt-5-mini", {
        reasoning: false,
        supportedEfforts: ["low", "high"],
      }),
    ).toEqual({ reasoning: false });
    expect(resolveModelCapability("gpt-5-mini", {})).toMatchObject({
      reasoning: true,
      vision: true,
      source: "catalog",
    });
  });

  it("falls back to a manual model when /v1/models is incompatible", () => {
    expect(
      resolveModelList(
        { data: [{ id: "gpt-4o" }, { id: "gpt-4o" }] },
        "openai-compatible",
      ),
    ).toEqual({
      models: [{ id: "gpt-4o", ownedBy: null, endpointTypes: [] }],
      modelIds: ["gpt-4o"],
      source: "remote",
    });
    expect(
      resolveModelList({ models: [] }, "openai-compatible", " custom/model "),
    ).toEqual({
      models: [{ id: "custom/model", ownedBy: null, endpointTypes: [] }],
      modelIds: ["custom/model"],
      source: "manual",
    });
  });
});

describe("ModelCapabilityRepository", () => {
  let database: ChatDatabase;

  beforeEach(() => {
    database = new ChatDatabase(`capability-test-${crypto.randomUUID()}`);
  });

  afterEach(async () => {
    await database.delete();
  });

  it("persists user overrides and resets to automatic resolution", async () => {
    const repository = new ModelCapabilityRepository(
      database,
      () => "2026-07-16T00:00:00.000Z",
    );
    await repository.saveOverride("byok", "custom-chat", {
      reasoning: true,
      supportedEfforts: ["medium"],
    });

    expect(await repository.resolve("byok", "custom-chat")).toMatchObject({
      reasoning: true,
      supportedEfforts: ["medium"],
      source: "user",
    });

    await repository.reset("byok", "custom-chat");
    expect(await repository.resolve("byok", "custom-chat")).toMatchObject({
      reasoning: false,
      source: "inferred",
    });
  });

  it("persists per-model generation preferences and resets them to defaults", async () => {
    const repository = new ModelCapabilityRepository(
      database,
      () => "2026-07-16T00:00:00.000Z",
    );
    await repository.saveSettings(
      "byok",
      "custom-chat",
      { vision: true, temperature: "supported", topP: "unsupported" },
      {
        streaming: false,
        temperature: { enabled: true, value: 0.6 },
        topP: { enabled: false, value: 1 },
      },
    );

    await expect(
      repository.resolvePreferences("byok", "custom-chat"),
    ).resolves.toMatchObject({
      streaming: false,
      temperature: { enabled: true, value: 0.6 },
    });

    await repository.saveSettings(
      "byok",
      "custom-chat",
      { vision: false },
      createDefaultModelPreferences(),
    );
    await expect(
      repository.resolve("byok", "custom-chat"),
    ).resolves.toMatchObject({
      temperature: "supported",
      topP: "unsupported",
      vision: false,
    });

    await repository.resetSettings("byok", "custom-chat");
    await expect(
      repository.resolvePreferences("byok", "custom-chat"),
    ).resolves.toEqual(createDefaultModelPreferences());
  });

  it("does not freeze automatic capabilities when only preferences are saved", async () => {
    const repository = new ModelCapabilityRepository(database);
    await repository.saveSettings(
      "byok",
      "gpt-5-mini",
      {
        reasoning: true,
        supportedEfforts: ["minimal", "low", "medium", "high"],
        vision: true,
        contextWindow: 400_000,
      },
      {
        ...createDefaultModelPreferences(),
        streaming: false,
      },
    );

    await expect(
      database.modelOverrides.get(["byok", "gpt-5-mini"]),
    ).resolves.toMatchObject({ override: {} });
    await expect(
      repository.resolve("byok", "gpt-5-mini"),
    ).resolves.toMatchObject({
      reasoning: true,
      supportedEfforts: ["minimal", "low", "medium", "high"],
      vision: true,
      source: "catalog",
    });
  });

  it("migrates a legacy Grok snapshot to current built-in defaults", async () => {
    await database.modelOverrides.put({
      connectionScope: "byok:https://x.ai",
      modelId: "grok-4.5",
      override: {
        reasoning: true,
        supportedEfforts: [],
        vision: true,
        contextWindow: 32_768,
      },
      preferences: {
        ...createDefaultModelPreferences(),
        streaming: false,
      },
      updatedAt: "2026-07-21T00:00:00.000Z",
    });
    const repository = new ModelCapabilityRepository(
      database,
      () => "2026-07-22T00:00:00.000Z",
    );

    await expect(
      repository.resolve("byok:https://x.ai", "grok-4.5"),
    ).resolves.toMatchObject({
      reasoning: true,
      supportedEfforts: ["low", "medium", "high"],
      vision: true,
      contextWindow: 500_000,
      source: "builtin",
    });
    await expect(
      repository.resolvePreferences("byok:https://x.ai", "grok-4.5"),
    ).resolves.toMatchObject({ streaming: false });
    await expect(
      database.modelOverrides.get(["byok:https://x.ai", "grok-4.5"]),
    ).resolves.toMatchObject({
      override: {},
      capabilityVersion: 2,
      preferences: { streaming: false },
    });
  });

  it("keeps real differences while migrating a legacy complete snapshot", async () => {
    await database.modelOverrides.put({
      connectionScope: "byok:https://x.ai",
      modelId: "grok-4.5",
      override: {
        reasoning: false,
        supportedEfforts: [],
        vision: false,
        contextWindow: 32_768,
      },
      updatedAt: "2026-07-21T00:00:00.000Z",
    });
    const repository = new ModelCapabilityRepository(database);

    await expect(
      repository.resolve("byok:https://x.ai", "grok-4.5"),
    ).resolves.toMatchObject({
      reasoning: false,
      vision: false,
      contextWindow: 500_000,
      source: "user",
    });
    await expect(
      database.modelOverrides.get(["byok:https://x.ai", "grok-4.5"]),
    ).resolves.toMatchObject({
      override: { reasoning: false, vision: false },
      capabilityVersion: 2,
    });
  });

  it("migrates a legacy Gemini family snapshot after preview alias resolution", async () => {
    await database.modelOverrides.put({
      connectionScope: "byok:https://google.example",
      modelId: "gemini-3.1-pro",
      override: {
        reasoning: true,
        supportedEfforts: [],
        vision: true,
        contextWindow: 1_048_576,
      },
      updatedAt: "2026-07-21T00:00:00.000Z",
    });
    const repository = new ModelCapabilityRepository(database);

    await expect(
      repository.resolve("byok:https://google.example", "gemini-3.1-pro"),
    ).resolves.toMatchObject({
      reasoning: true,
      supportedEfforts: ["low", "medium", "high"],
      contextWindow: 1_048_576,
      source: "catalog",
    });
    await expect(
      database.modelOverrides.get([
        "byok:https://google.example",
        "gemini-3.1-pro",
      ]),
    ).resolves.toMatchObject({ override: {}, capabilityVersion: 2 });
  });

  it("migrates version-one empty efforts without hiding reviewed Gemini controls", async () => {
    await database.modelOverrides.put({
      connectionScope: "byok:https://google.example",
      modelId: "gemini-2.5-flash",
      override: { supportedEfforts: [] },
      capabilityVersion: 1,
      updatedAt: "2026-07-16T00:00:00.000Z",
    });
    const repository = new ModelCapabilityRepository(database);

    await expect(
      repository.resolve("byok:https://google.example", "gemini-2.5-flash"),
    ).resolves.toMatchObject({
      supportedEfforts: ["none", "auto", "low", "medium", "high"],
      source: "catalog",
    });
    await expect(
      database.modelOverrides.get([
        "byok:https://google.example",
        "gemini-2.5-flash",
      ]),
    ).resolves.toMatchObject({ override: {}, capabilityVersion: 2 });
  });

  it("preserves a version-one non-empty custom effort list", async () => {
    await database.modelOverrides.put({
      connectionScope: "byok:https://custom.example",
      modelId: "custom-reasoner",
      override: { reasoning: true, supportedEfforts: ["low", "max"] },
      capabilityVersion: 1,
      updatedAt: "2026-07-16T00:00:00.000Z",
    });
    const repository = new ModelCapabilityRepository(database);

    await expect(
      repository.resolve("byok:https://custom.example", "custom-reasoner"),
    ).resolves.toMatchObject({
      reasoning: true,
      supportedEfforts: ["low", "max"],
      source: "user",
    });
    await expect(
      database.modelOverrides.get([
        "byok:https://custom.example",
        "custom-reasoner",
      ]),
    ).resolves.toMatchObject({
      override: { supportedEfforts: ["low", "max"] },
      capabilityVersion: 2,
    });
  });
});
