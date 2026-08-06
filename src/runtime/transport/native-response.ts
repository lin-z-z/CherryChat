import { z } from "zod";

import { ChatTransportError } from "@/runtime/transport/chat-errors";
import {
  JSON_RESPONSE_MAX_BYTES,
  readLimitedResponseJson,
  ResponseLimitError,
} from "@/runtime/transport/response-reader";

export async function parseNativeJson<Output>(
  response: Response,
  schema: z.ZodType<Output>,
  description: string,
  maximumBytes = JSON_RESPONSE_MAX_BYTES,
): Promise<Output> {
  let value: unknown;
  try {
    value = await readLimitedResponseJson(response, maximumBytes);
  } catch (error) {
    if (error instanceof ChatTransportError) throw error;
    throw new ChatTransportError(
      "STREAM_PROTOCOL_ERROR",
      error instanceof ResponseLimitError
        ? `${description} exceeds the response size limit`
        : `${description} is not valid JSON`,
      response.status,
    );
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ChatTransportError(
      "STREAM_PROTOCOL_ERROR",
      `${description} has an unexpected shape`,
      response.status,
    );
  }
  return parsed.data;
}
