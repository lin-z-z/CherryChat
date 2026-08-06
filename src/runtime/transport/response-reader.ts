export const ERROR_RESPONSE_MAX_BYTES = 64 * 1024;
export const MODEL_LIST_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
export const JSON_RESPONSE_MAX_BYTES = 16 * 1024 * 1024;
export const MAX_MODEL_LIST_ITEMS = 2_000;

export class ResponseLimitError extends Error {
  constructor(readonly maximumBytes: number) {
    super("Upstream response exceeded the size limit");
    this.name = "ResponseLimitError";
  }
}

export async function readLimitedResponseBytes(
  response: Response,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new RangeError("Response byte limit must be a non-negative integer");
  }
  const contentLength = parseContentLength(
    response.headers.get("content-length"),
  );
  if (contentLength !== null && contentLength > maximumBytes) {
    const error = new ResponseLimitError(maximumBytes);
    await response.body?.cancel(error).catch(() => undefined);
    throw error;
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const cancelForAbort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  if (signal?.aborted) cancelForAbort();
  else signal?.addEventListener("abort", cancelForAbort, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (totalBytes + value.byteLength > maximumBytes) {
        const error = new ResponseLimitError(maximumBytes);
        await reader.cancel(error).catch(() => undefined);
        throw error;
      }
      totalBytes += value.byteLength;
      chunks.push(value);
    }
    if (signal?.aborted) throw signal.reason;
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancelForAbort);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readLimitedResponseText(
  response: Response,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  const bytes = await readLimitedResponseBytes(response, maximumBytes, signal);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function readLimitedResponseJson(
  response: Response,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<unknown> {
  return JSON.parse(
    await readLimitedResponseText(response, maximumBytes, signal),
  ) as unknown;
}

function parseContentLength(value: string | null): number | null {
  if (!value || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
