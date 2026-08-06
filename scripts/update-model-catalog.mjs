import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODELS_URL = "https://models.dev/models.json";
const API_URL = "https://models.dev/api.json";
const ALLOWED_EFFORTS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const outputPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/runtime/models/model-catalog.json",
);

const [models, providers] = await Promise.all([
  fetchJson(MODELS_URL),
  fetchJson(API_URL),
]);

const sourceEntries = Object.entries(requireRecord(models, "models.json"));
const entries = sourceEntries
  .sort(([left], [right]) => left.localeCompare(right))
  .flatMap(([canonicalId, rawModel]) => {
    const model = requireRecord(rawModel, canonicalId);
    const contextValue = optionalRecord(model.limit)?.context;
    if (!Number.isInteger(contextValue) || contextValue <= 0) return [];
    const separator = canonicalId.indexOf("/");
    if (separator <= 0 || separator === canonicalId.length - 1) {
      throw new TypeError(`Invalid canonical model ID: ${canonicalId}`);
    }
    const providerId = canonicalId.slice(0, separator);
    const providerModelId = canonicalId.slice(separator + 1);
    const provider = optionalRecord(providers[providerId]);
    const providerModels = optionalRecord(provider?.models);
    const providerModel = optionalRecord(providerModels?.[providerModelId]);
    const reasoning = model.reasoning === true;
    const contextWindow = requirePositiveInteger(
      contextValue,
      `${canonicalId}.limit.context`,
    );
    const inputModalities = optionalStringArray(
      optionalRecord(model.modalities)?.input,
    );

    return [
      [
        canonicalId,
        {
          reasoning,
          supportedEfforts: reasoning
            ? readEffortOptions(providerModel?.reasoning_options)
            : [],
          vision: inputModalities.includes("image"),
          tools: model.tool_call === true,
          contextWindow,
          temperature:
            typeof model.temperature === "boolean"
              ? model.temperature
                ? "supported"
                : "unsupported"
              : "unknown",
          topP: "unknown",
        },
      ],
    ];
  });

const sourceUpdatedAt = Object.values(models)
  .map((value) => optionalRecord(value)?.last_updated)
  .filter((value) => typeof value === "string")
  .sort()
  .at(-1);
if (!sourceUpdatedAt) {
  throw new TypeError("models.json has no last_updated values");
}

const snapshot = {
  schemaVersion: 1,
  source: {
    name: "models.dev",
    license: "MIT",
    modelsUrl: MODELS_URL,
    apiUrl: API_URL,
    updatedAt: sourceUpdatedAt,
  },
  models: Object.fromEntries(entries),
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
process.stdout.write(
  `Updated ${entries.length} model records in ${outputPath} ` +
    `(skipped ${sourceEntries.length - entries.length} without a context window)\n`,
);

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
  }
  return requireRecord(await response.json(), url);
}

function readEffortOptions(value) {
  if (!Array.isArray(value)) return [];
  const effortEntry = value.find(
    (entry) => optionalRecord(entry)?.type === "effort",
  );
  return [
    ...new Set(
      optionalStringArray(optionalRecord(effortEntry)?.values).filter((item) =>
        ALLOWED_EFFORTS.has(item),
      ),
    ),
  ];
}

function requireRecord(value, label) {
  const record = optionalRecord(value);
  if (!record) throw new TypeError(`${label} must be an object`);
  return record;
}

function optionalRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function optionalStringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string")
    : [];
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}
