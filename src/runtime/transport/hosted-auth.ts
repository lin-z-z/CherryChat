/**
 * The request header that carries the browser-held Hosted access code.
 *
 * Hosted authentication is stateless: the server validates this header against
 * the current `ACCESS_CODE` allowlist on every request. It must only ever be
 * attached to same-origin CherryChat API routes, never to an upstream model,
 * search, or image service.
 */
export const HOSTED_ACCESS_CODE_HEADER = "X-CherryChat-Access-Code";

/**
 * Builds the Hosted auth header for same-origin requests. Returns no header for
 * BYOK connections or when no access code is stored, so unauthenticated callers
 * still receive public responses instead of a malformed credential.
 */
export function hostedAccessCodeHeaders(input: {
  mode: "byok" | "hosted";
  accessCode?: string | null | undefined;
}): Record<string, string> {
  if (input.mode !== "hosted") return {};
  const accessCode = input.accessCode?.trim();
  // HTTP headers carry only ASCII, and access codes may contain any UTF-8 text,
  // so the value is percent-encoded. The server decodes it before comparing.
  return accessCode
    ? { [HOSTED_ACCESS_CODE_HEADER]: encodeURIComponent(accessCode) }
    : {};
}
