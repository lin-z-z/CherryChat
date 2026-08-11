import { ChatTransportError } from "@/runtime/transport/chat-errors";
import { normalizeHttpBaseUrl } from "@/runtime/transport/transport-http";

export const DEFAULT_GROK_RESPONSES_URL = "https://api.x.ai/v1/responses";
export const DEFAULT_GROK_MODEL = "grok-4.5";
const MAX_GROK_RESPONSES_URL_LENGTH = 2_048;

export function normalizeGrokResponsesUrl(value: string): string {
  if (value.trim().length > MAX_GROK_RESPONSES_URL_LENGTH) {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "Grok Responses URL is too long",
      null,
    );
  }
  return normalizeHttpBaseUrl(value);
}
