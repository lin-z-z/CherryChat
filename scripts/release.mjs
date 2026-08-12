import { appendFile, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = resolve(dirname(scriptPath), "..");
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/iu;
const GITHUB_API_VERSION = "2022-11-28";
const CI_WORKFLOW_FILE = "ci.yml";
const DEFAULT_CI_TIMEOUT_MS = 80 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 15 * 1000;

export function validatePackageVersions({
  packageVersion,
  lockVersion,
  lockRootVersion,
}) {
  if (!SEMVER_PATTERN.test(packageVersion ?? "")) {
    throw new Error("package.json version must be a stable three-part SemVer.");
  }
  if (lockVersion !== packageVersion || lockRootVersion !== packageVersion) {
    throw new Error(
      "package.json and package-lock.json versions must match exactly.",
    );
  }
  return {
    version: packageVersion,
    tagName: `v${packageVersion}`,
  };
}

export function extractChangelogSection(content, version) {
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  const headingPattern = new RegExp(
    `^## \\[${escapeRegExp(version)}\\](?:\\s+-\\s+.+)?$`,
    "u",
  );
  const startIndex = lines.findIndex((line) => headingPattern.test(line));
  if (startIndex === -1) {
    throw new Error(`Changelog is missing the ${version} release section.`);
  }

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (lines[index]?.startsWith("## ")) {
      endIndex = index;
      break;
    }
  }

  const section = lines.slice(startIndex, endIndex).join("\n").trim();
  if (!/^###\s+/mu.test(section)) {
    throw new Error(
      `Changelog ${version} section must contain structured release notes.`,
    );
  }
  return section;
}

export async function readReleaseMetadata({ root = defaultRoot } = {}) {
  const [packageJson, packageLock, englishChangelog, chineseChangelog] =
    await Promise.all([
      readJson(resolve(root, "package.json"), "package.json"),
      readJson(resolve(root, "package-lock.json"), "package-lock.json"),
      readFile(resolve(root, "CHANGELOG.md"), "utf8"),
      readFile(resolve(root, "CHANGELOG_CN.md"), "utf8"),
    ]);

  const packageVersion = readStringProperty(
    packageJson,
    "version",
    "package.json",
  );
  const lockVersion = readStringProperty(
    packageLock,
    "version",
    "package-lock.json",
  );
  const lockRootVersion = readNestedStringProperty(
    packageLock,
    ["packages", "", "version"],
    "package-lock.json",
  );
  const { version, tagName } = validatePackageVersions({
    packageVersion,
    lockVersion,
    lockRootVersion,
  });

  return {
    version,
    tagName,
    title: `CherryChat ${tagName}`,
    englishSection: extractChangelogSection(englishChangelog, version),
    chineseSection: extractChangelogSection(chineseChangelog, version),
  };
}

export function classifyWorkflowRun(run) {
  if (!run || run.status !== "completed") return "wait";
  return run.conclusion === "success" ? "success" : "fail";
}

export function selectCiRun(workflowRuns, sha) {
  if (!Array.isArray(workflowRuns)) return null;
  return (
    workflowRuns.find(
      (run) => run?.head_sha === sha && run?.event === "push",
    ) ?? null
  );
}

export async function waitForSuccessfulCi({
  getWorkflowRuns,
  sha,
  timeoutMs = DEFAULT_CI_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  now = Date.now,
  sleep = delay,
}) {
  const deadline = now() + timeoutMs;

  while (true) {
    const run = selectCiRun(await getWorkflowRuns(), sha);
    const state = classifyWorkflowRun(run);
    if (state === "success") return run;
    if (state === "fail") {
      throw new Error(
        `CI run for ${sha} completed without success (${run.conclusion ?? "unknown"}).`,
      );
    }
    if (now() >= deadline) {
      throw new Error(`Timed out waiting for a successful CI run for ${sha}.`);
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
  }
}

export function composeReleaseBody({
  englishSection,
  repository,
  tagName,
  sha,
  generatedNotes,
}) {
  const commitUrl = `https://github.com/${repository}/commit/${sha}`;
  const chineseUrl = `https://github.com/${repository}/blob/${tagName}/CHANGELOG_CN.md`;
  return [
    englishSection.trim(),
    "## Release target",
    `Commit: [\`${sha}\`](${commitUrl})`,
    "## 简体中文",
    `[查看 ${tagName} 中文变更记录](${chineseUrl})`,
    generatedNotes.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildReleasePayload({ tagName, sha, title, body }) {
  return {
    tag_name: tagName,
    target_commitish: sha,
    name: title,
    body,
    draft: false,
    prerelease: false,
    make_latest: "true",
  };
}

export function classifyReleaseState({ tagSha, release }, expectedSha) {
  if (!tagSha && !release) return "absent";
  if (tagSha === expectedSha && release) return "success";
  return "inconsistent";
}

export function ensureRemoteTargetsAbsent(state, tagName) {
  if (state.tagSha || state.release) {
    throw new Error(`Remote Tag or Release ${tagName} already exists.`);
  }
}

export async function createReleaseWithRecovery({
  createRelease,
  readState,
  expectedSha,
}) {
  let creationFailed = false;
  try {
    await createRelease();
  } catch {
    creationFailed = true;
  }

  const state = await readState();
  const classification = classifyReleaseState(state, expectedSha);
  if (classification === "success") {
    return {
      release: state.release,
      recovered: creationFailed,
    };
  }
  if (classification === "absent") {
    throw new Error(
      "Release creation left no remote Tag or Release; the workflow may be retried.",
    );
  }
  throw new Error(
    "Release creation left inconsistent remote state; manual review is required.",
  );
}

export function createGitHubClient({ token, fetchImplementation = fetch }) {
  if (!token) throw new Error("GITHUB_TOKEN is required.");

  return {
    async request(path, { method = "GET", body, allowNotFound = false } = {}) {
      let response;
      try {
        response = await fetchImplementation(`https://api.github.com${path}`, {
          method,
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": GITHUB_API_VERSION,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch {
        throw new Error(`GitHub API ${method} request failed.`);
      }

      if (allowNotFound && response.status === 404) return null;
      if (!response.ok) {
        throw new Error(
          `GitHub API ${method} request failed with status ${response.status}.`,
        );
      }
      if (response.status === 204) return null;
      try {
        return await response.json();
      } catch {
        throw new Error(`GitHub API ${method} returned invalid JSON.`);
      }
    },
  };
}

export async function readRemoteReleaseState({ client, repository, tagName }) {
  const encodedTag = encodeURIComponent(tagName);
  const [tagReference, release] = await Promise.all([
    client.request(`/repos/${repository}/git/ref/tags/${encodedTag}`, {
      allowNotFound: true,
    }),
    client.request(`/repos/${repository}/releases/tags/${encodedTag}`, {
      allowNotFound: true,
    }),
  ]);

  return {
    tagSha: tagReference
      ? await resolveTagCommitSha({ client, repository, tagReference })
      : null,
    release,
  };
}

export async function runRelease({
  root = defaultRoot,
  env = process.env,
  fetchImplementation = fetch,
  writeOutput = (message) => process.stdout.write(`${message}\n`),
} = {}) {
  if (process.argv.slice(2).length > 0) {
    throw new Error("Release script does not accept command-line overrides.");
  }
  const context = readGitHubContext(env);
  const metadata = await readReleaseMetadata({ root });
  const client = createGitHubClient({
    token: context.token,
    fetchImplementation,
  });

  const initialState = await readRemoteReleaseState({
    client,
    repository: context.repository,
    tagName: metadata.tagName,
  });
  ensureRemoteTargetsAbsent(initialState, metadata.tagName);

  const ciRun = await waitForSuccessfulCi({
    sha: context.sha,
    getWorkflowRuns: async () => {
      const query = new URLSearchParams({
        branch: context.defaultBranch,
        event: "push",
        head_sha: context.sha,
        per_page: "20",
      });
      const result = await client.request(
        `/repos/${context.repository}/actions/workflows/${CI_WORKFLOW_FILE}/runs?${query}`,
      );
      return result?.workflow_runs;
    },
  });

  const generated = await client.request(
    `/repos/${context.repository}/releases/generate-notes`,
    {
      method: "POST",
      body: {
        tag_name: metadata.tagName,
        target_commitish: context.sha,
      },
    },
  );
  if (typeof generated?.body !== "string") {
    throw new Error("GitHub generated release notes are missing a body.");
  }

  const body = composeReleaseBody({
    englishSection: metadata.englishSection,
    repository: context.repository,
    tagName: metadata.tagName,
    sha: context.sha,
    generatedNotes: generated.body,
  });
  await writeReleaseSummary({
    summaryPath: env.GITHUB_STEP_SUMMARY,
    title: metadata.title,
    ciRun,
    body,
  });

  const payload = buildReleasePayload({
    tagName: metadata.tagName,
    sha: context.sha,
    title: metadata.title,
    body,
  });
  const result = await createReleaseWithRecovery({
    expectedSha: context.sha,
    createRelease: () =>
      client.request(`/repos/${context.repository}/releases`, {
        method: "POST",
        body: payload,
      }),
    readState: () =>
      readRemoteReleaseState({
        client,
        repository: context.repository,
        tagName: metadata.tagName,
      }),
  });

  const releaseUrl = result.release?.html_url;
  if (typeof releaseUrl !== "string" || releaseUrl.length === 0) {
    throw new Error("Verified Release is missing its public URL.");
  }
  writeOutput(`Published ${metadata.tagName} from ${context.sha}.`);
  writeOutput(`Release: ${releaseUrl}`);
  return { ...result, metadata, ciRun, releaseUrl };
}

function readGitHubContext(env) {
  if (env.GITHUB_ACTIONS !== "true") {
    throw new Error("Release publication is allowed only in GitHub Actions.");
  }
  const repository = requireEnvironment(env, "GITHUB_REPOSITORY");
  const sha = requireEnvironment(env, "GITHUB_SHA");
  const refName = requireEnvironment(env, "GITHUB_REF_NAME");
  const defaultBranch = requireEnvironment(env, "GITHUB_DEFAULT_BRANCH");
  const token = requireEnvironment(env, "GITHUB_TOKEN");

  if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
    throw new Error("GITHUB_REPOSITORY must be an owner/repository pair.");
  }
  if (!SHA_PATTERN.test(sha)) {
    throw new Error("GITHUB_SHA must be a full commit SHA.");
  }
  if (refName !== defaultBranch) {
    throw new Error("Release workflow must run from the default branch.");
  }
  return { repository, sha, refName, defaultBranch, token };
}

async function resolveTagCommitSha({ client, repository, tagReference }) {
  let object = tagReference?.object;
  for (let depth = 0; depth < 5; depth += 1) {
    if (object?.type === "commit" && SHA_PATTERN.test(object.sha ?? "")) {
      return object.sha;
    }
    if (object?.type !== "tag" || !SHA_PATTERN.test(object.sha ?? "")) {
      return null;
    }
    const tag = await client.request(
      `/repos/${repository}/git/tags/${object.sha}`,
    );
    object = tag?.object;
  }
  return null;
}

async function writeReleaseSummary({ summaryPath, title, ciRun, body }) {
  if (!summaryPath) return;
  const ciUrl =
    typeof ciRun?.html_url === "string" ? ciRun.html_url : "Unavailable";
  await appendFile(
    summaryPath,
    `# ${title}\n\nCI: ${ciUrl}\n\n${body}\n`,
    "utf8",
  );
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
}

function readStringProperty(value, property, label) {
  const result = value?.[property];
  if (typeof result !== "string") {
    throw new Error(`${label} is missing ${property}.`);
  }
  return result;
}

function readNestedStringProperty(value, properties, label) {
  let result = value;
  for (const property of properties) result = result?.[property];
  if (typeof result !== "string") {
    throw new Error(`${label} is missing ${properties.join(".")}.`);
  }
  return result;
}

function requireEnvironment(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function delay(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    await runRelease();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Release failed.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
