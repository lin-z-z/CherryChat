import packageJson from "../../package.json";

/**
 * The release version compiled into the current bundle. Both the server's public
 * config and the client's freshness check read this same value so a deployment
 * can never publish a version the build does not agree with.
 */
export const APP_VERSION: string = packageJson.version;

interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parses `major.minor.patch`, ignoring any prerelease or build metadata. Returns
 * null for anything that is not a plain three-part numeric version so callers
 * can stay silent instead of guessing.
 */
export function parseAppVersion(value: unknown): SemanticVersion | null {
  if (typeof value !== "string") return null;
  const match =
    /^(\d{1,10})\.(\d{1,10})\.(\d{1,10})(?:[-+][0-9A-Za-z.-]+)?$/u.exec(
      value.trim(),
    );
  if (!match) return null;
  const [major, minor, patch] = [match[1], match[2], match[3]].map(Number);
  return major === undefined || minor === undefined || patch === undefined
    ? null
    : { major, minor, patch };
}

/**
 * True only when `candidate` is a strictly newer release than `current`. An
 * unparsable version on either side reports false, so a failed or malformed
 * config response never triggers an update prompt.
 */
export function isNewerAppVersion(
  candidate: unknown,
  current: unknown = APP_VERSION,
): boolean {
  const next = parseAppVersion(candidate);
  const installed = parseAppVersion(current);
  if (!next || !installed) return false;
  if (next.major !== installed.major) return next.major > installed.major;
  if (next.minor !== installed.minor) return next.minor > installed.minor;
  return next.patch > installed.patch;
}
