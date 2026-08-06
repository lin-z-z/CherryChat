import { openAIModelsResponseSchema } from "@/runtime/chat/schemas";
import type {
  ChatApiType,
  ChatEndpointType,
  ModelDescriptor,
} from "@/runtime/chat/types";

export interface ModelListResult {
  models: ModelDescriptor[];
  modelIds: string[];
  source: "remote" | "manual";
}

const NEW_API_ENDPOINT_TYPES: Readonly<Record<string, ChatEndpointType>> = {
  openai: "openai-chat",
  "openai-response": "openai-responses",
  "openai-response-compact": "openai-responses",
  anthropic: "anthropic",
  gemini: "gemini",
};

export function parseModelDescriptors(
  value: unknown,
  apiType: ChatApiType,
): ModelDescriptor[] {
  const response = openAIModelsResponseSchema.parse(value);
  const seen = new Set<string>();
  const descriptors: ModelDescriptor[] = [];
  for (const model of response.data) {
    const id = model.id.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    descriptors.push({
      id,
      ownedBy: model.owned_by?.trim() || null,
      endpointTypes:
        apiType === "new-api"
          ? normalizeEndpointTypes(model.supported_endpoint_types)
          : [],
    });
  }
  return descriptors;
}

export function resolveModelList(
  value: unknown,
  apiType: ChatApiType,
  manualModelId?: string,
): ModelListResult {
  try {
    const models = parseModelDescriptors(value, apiType);
    if (models.length > 0) {
      return {
        models,
        modelIds: models.map(({ id }) => id),
        source: "remote",
      };
    }
  } catch {
    // A compatible chat endpoint may legitimately omit /v1/models.
  }

  const fallback = manualModelId?.normalize("NFKC").trim();
  const models: ModelDescriptor[] = fallback
    ? [{ id: fallback, ownedBy: null, endpointTypes: [] }]
    : [];
  return { models, modelIds: models.map(({ id }) => id), source: "manual" };
}

function normalizeEndpointTypes(
  values: string[] | null | undefined,
): ChatEndpointType[] {
  if (!values) return [];
  return Array.from(
    new Set(
      values.flatMap((value) => {
        const endpoint = NEW_API_ENDPOINT_TYPES[value.trim().toLowerCase()];
        return endpoint ? [endpoint] : [];
      }),
    ),
  );
}
