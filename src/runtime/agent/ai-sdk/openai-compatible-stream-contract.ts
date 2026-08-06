import { z } from "zod";

export const TRUNCATED_CHAT_COMPLETION_FINISH_REASON =
  "cherrychat_stream_protocol_error";

const terminalChunkSchema = z
  .object({
    choices: z.array(
      z
        .object({
          index: z.number().int().nonnegative(),
          finish_reason: z.string().nullable().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export function hasChatCompletionTerminalEvent(data: string): boolean {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return false;
  }
  const parsed = terminalChunkSchema.safeParse(value);
  if (!parsed.success) return false;
  const primaryChoice =
    parsed.data.choices.find(({ index }) => index === 0) ??
    parsed.data.choices[0];
  return (
    primaryChoice?.finish_reason !== undefined &&
    primaryChoice.finish_reason !== null
  );
}
