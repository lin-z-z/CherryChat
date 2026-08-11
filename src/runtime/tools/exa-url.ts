import { ChatTransportError } from "@/runtime/transport/chat-errors";
import { normalizeHttpBaseUrl } from "@/runtime/transport/transport-http";

export const DEFAULT_EXA_BASE_URL = "https://api.exa.ai";
export const EXA_SEARCH_PATH = "/search";
const MAX_EXA_BASE_URL_LENGTH = 2_048;

export function normalizeExaBaseUrl(value: string): string {
  if (value.trim().length > MAX_EXA_BASE_URL_LENGTH) {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "Exa base URL is too long",
      null,
    );
  }
  return normalizeHttpBaseUrl(value, [EXA_SEARCH_PATH]);
}

export function buildExaSearchUrl(baseUrl: string): string {
  return `${normalizeExaBaseUrl(baseUrl)}${EXA_SEARCH_PATH}`;
}
