import { ChatTransportError } from "@/runtime/transport/chat-errors";
import { normalizeHttpBaseUrl } from "@/runtime/transport/transport-http";

export const DEFAULT_TAVILY_BASE_URL = "https://api.tavily.com";
export const TAVILY_SEARCH_PATH = "/search";
const MAX_TAVILY_BASE_URL_LENGTH = 2_048;

export function normalizeTavilyBaseUrl(value: string): string {
  if (value.trim().length > MAX_TAVILY_BASE_URL_LENGTH) {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "Tavily base URL is too long",
      null,
    );
  }
  return normalizeHttpBaseUrl(value, [TAVILY_SEARCH_PATH]);
}

export function buildTavilySearchUrl(baseUrl: string): string {
  return `${normalizeTavilyBaseUrl(baseUrl)}${TAVILY_SEARCH_PATH}`;
}
