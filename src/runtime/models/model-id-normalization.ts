const AGGREGATOR_PREFIXES = [
  "aihubmix-",
  "aihub-",
  "ahm-",
  "alicloud-",
  "azure-",
  "deepinfra-",
  "groq-",
  "nvidia-",
  "siliconflow-",
  "chutes-",
  "zai-org-",
  "zai-",
  "dmxapi-",
  "dmxapi_",
  "openai-",
] as const;

const COLON_VARIANT_SUFFIXES = [
  ":free",
  ":nitro",
  ":extended",
  ":beta",
  ":preview",
  ":thinking",
  ":exacto",
  ":latest",
  ":cloud",
] as const;

const HYPHEN_VARIANT_SUFFIXES = [
  "-free",
  "-search",
  "-online",
  "-think",
  "-reasoning",
  "-classic",
  "-low",
  "-high",
  "-minimal",
  "-nothink",
  "-no-think",
  "-thinking",
  "-nothinking",
] as const;

const PAREN_VARIANT_SUFFIXES = [
  "(free)",
  "(beta)",
  "(preview)",
  "(thinking)",
] as const;

const QUANTIZATION_SUFFIXES = [
  "-fp8",
  "-fp16",
  "-bf16",
  "-awq",
  "-int4",
  "-int8",
  "-gguf",
  "-gptq",
] as const;

const BEDROCK_VENDOR_PREFIX =
  /^(?:anthropic|amazon|meta|google|mistralai|cohere|openai|ai21|microsoft|nvidia)-{1,2}/u;
const BEDROCK_REVISION = /(?:[-_]v?\d+)?:\d+$/iu;
const DATE_SNAPSHOT =
  /-20\d{2}-(?:0[1-9]|1[0-2])-(?:[0-2]\d|3[01])$|-20\d{2}(?:0[1-9]|1[0-2])(?:[0-2]\d|3[01])$|-2\d(?:0[1-9]|1[0-2])(?:[0-2]\d|3[01])$|-(?:0[1-9]|1[0-2])(?:[0-2]\d|3[01])$|-2\d(?:0[1-9]|1[0-2])$/u;
const PROTECTED_COMPOUND_PREFIXES = ["non", "no", "pre", "anti", "post"];

/**
 * Produces a lookup-only key for provider aliases without changing the model ID
 * sent upstream. Exact catalogue IDs still take priority over this fallback.
 */
export function normalizeModelLookupName(modelId: string): string {
  const segments = modelId
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .split("/");
  let name = segments.at(-1) ?? "";

  name = stripAggregatorPrefix(name);
  name = name
    .replace(/^(?:[a-z]+\.)+/u, "")
    .replace(BEDROCK_VENDOR_PREFIX, "")
    .replace(BEDROCK_REVISION, "");
  if (name.startsWith("mm-")) name = `minimax-${name.slice(3)}`;

  for (;;) {
    const next = stripDateSnapshot(stripQuantization(stripVariantSuffix(name)));
    if (next === name) break;
    name = next;
  }

  return name.replace(/(\d)[,._p](?=\d)/gu, "$1-").replaceAll("_", "-");
}

function stripAggregatorPrefix(modelName: string): string {
  const prefix = AGGREGATOR_PREFIXES.find((candidate) =>
    modelName.startsWith(candidate),
  );
  return prefix ? modelName.slice(prefix.length) : modelName;
}

function stripVariantSuffix(modelName: string): string {
  const colonIndex = modelName.lastIndexOf(":");
  if (colonIndex > 0) {
    const suffix = modelName.slice(colonIndex);
    if (COLON_VARIANT_SUFFIXES.some((candidate) => candidate === suffix)) {
      return modelName.slice(0, colonIndex);
    }
  }

  for (const suffix of HYPHEN_VARIANT_SUFFIXES) {
    if (!modelName.endsWith(suffix)) continue;
    const remaining = modelName.slice(0, -suffix.length);
    const protectedCompound = PROTECTED_COMPOUND_PREFIXES.some(
      (prefix) => remaining === prefix || remaining.endsWith(`-${prefix}`),
    );
    if (!protectedCompound) return remaining;
  }

  for (const suffix of PAREN_VARIANT_SUFFIXES) {
    if (modelName.endsWith(suffix)) {
      return modelName.slice(0, -suffix.length).trimEnd();
    }
  }
  return modelName;
}

function stripQuantization(modelName: string): string {
  const suffix = QUANTIZATION_SUFFIXES.find((candidate) =>
    modelName.endsWith(candidate),
  );
  return suffix ? modelName.slice(0, -suffix.length) : modelName;
}

function stripDateSnapshot(modelName: string): string {
  return modelName.replace(/@.*$/u, "").replace(DATE_SNAPSHOT, "");
}
