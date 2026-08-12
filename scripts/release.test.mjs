import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildReleasePayload,
  classifyReleaseState,
  classifyWorkflowRun,
  composeReleaseBody,
  createGitHubClient,
  createReleaseWithRecovery,
  ensureRemoteTargetsAbsent,
  extractChangelogSection,
  readReleaseMetadata,
  selectCiRun,
  validatePackageVersions,
  waitForSuccessfulCi,
} from "./release.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "..");
const SHA = "0123456789abcdef0123456789abcdef01234567";
let temporaryDirectory;

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { force: true, recursive: true });
    temporaryDirectory = undefined;
  }
});

test("validates stable and matching package versions", () => {
  assert.deepEqual(
    validatePackageVersions({
      packageVersion: "1.0.0",
      lockVersion: "1.0.0",
      lockRootVersion: "1.0.0",
    }),
    { version: "1.0.0", tagName: "v1.0.0" },
  );

  assert.throws(
    () =>
      validatePackageVersions({
        packageVersion: "1.0.0-beta.1",
        lockVersion: "1.0.0-beta.1",
        lockRootVersion: "1.0.0-beta.1",
      }),
    /stable three-part SemVer/u,
  );
  assert.throws(
    () =>
      validatePackageVersions({
        packageVersion: "1.0.0",
        lockVersion: "0.1.1",
        lockRootVersion: "1.0.0",
      }),
    /must match exactly/u,
  );
});

test("extracts only the requested structured changelog section", () => {
  const content = [
    "# Changelog",
    "",
    "## [0.2.0] - 2026-08-11",
    "",
    "### Summary",
    "",
    "Next.",
    "",
    "## [1.0.0] - 2026-08-12",
    "",
    "### Summary",
    "",
    "First.",
    "",
    "## [0.0.1] - 2026-08-01",
  ].join("\n");

  const section = extractChangelogSection(content, "1.0.0");

  assert.match(section, /^## \[1\.0\.0\]/u);
  assert.match(section, /First\./u);
  assert.doesNotMatch(section, /0\.0\.1/u);
  assert.throws(
    () => extractChangelogSection(content, "0.3.0"),
    /missing the 0\.3\.0 release section/u,
  );
});

test("reads matching package and bilingual changelog metadata", async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "cherrychat-release-"));
  await writeJson("package.json", { version: "1.0.0" });
  await writeJson("package-lock.json", {
    version: "1.0.0",
    packages: { "": { version: "1.0.0" } },
  });
  const changelog =
    "# Changelog\n\n## [1.0.0] - 2026-08-12\n\n### Summary\n\nStable.\n";
  await writeFixture("CHANGELOG.md", changelog);
  await writeFixture("CHANGELOG_CN.md", changelog);

  const metadata = await readReleaseMetadata({ root: temporaryDirectory });

  assert.equal(metadata.version, "1.0.0");
  assert.equal(metadata.tagName, "v1.0.0");
  assert.equal(metadata.title, "CherryChat v1.0.0");
  assert.match(metadata.chineseSection, /### Summary/u);
});

test("composes curated, target, Chinese, and generated release notes", () => {
  const body = composeReleaseBody({
    englishSection: "## [1.0.0]\n\n### Summary\n\nStable.",
    repository: "lin-z-z/CherryChat",
    tagName: "v1.0.0",
    sha: SHA,
    generatedNotes: "## What's Changed\n\n- Pull request",
  });

  assert.match(body, /## \[1\.0\.0\]/u);
  assert.match(body, new RegExp(`commit/${SHA}`, "u"));
  assert.match(body, /blob\/v1\.0\.0\/CHANGELOG_CN\.md/u);
  assert.match(body, /## What's Changed/u);
  assert.ok(body.indexOf("### Summary") < body.indexOf("## 简体中文"));
});

test("maps workflow runs and selects only the exact push SHA", () => {
  assert.equal(classifyWorkflowRun(null), "wait");
  assert.equal(classifyWorkflowRun({ status: "queued" }), "wait");
  assert.equal(
    classifyWorkflowRun({ status: "completed", conclusion: "success" }),
    "success",
  );
  assert.equal(
    classifyWorkflowRun({ status: "completed", conclusion: "cancelled" }),
    "fail",
  );
  assert.equal(
    selectCiRun(
      [
        { head_sha: SHA, event: "pull_request" },
        { head_sha: "f".repeat(40), event: "push" },
        { head_sha: SHA, event: "push", id: 3 },
      ],
      SHA,
    )?.id,
    3,
  );
});

test("waits through queued and in-progress CI before success", async () => {
  const states = ["queued", "in_progress", "completed"];
  let callCount = 0;

  const run = await waitForSuccessfulCi({
    sha: SHA,
    timeoutMs: 100,
    now: () => 0,
    sleep: async () => {},
    getWorkflowRuns: async () => {
      const status = states[callCount++] ?? "completed";
      return [
        {
          id: callCount,
          event: "push",
          head_sha: SHA,
          status,
          conclusion: status === "completed" ? "success" : null,
        },
      ];
    },
  });

  assert.equal(run.conclusion, "success");
  assert.equal(callCount, 3);
});

test("fails when the exact CI run stays missing until timeout", async () => {
  await assert.rejects(
    waitForSuccessfulCi({
      sha: SHA,
      timeoutMs: 0,
      now: () => 0,
      getWorkflowRuns: async () => [],
    }),
    /Timed out waiting/u,
  );
});

for (const conclusion of ["failure", "cancelled", "timed_out"]) {
  test(`fails when the exact CI run concludes ${conclusion}`, async () => {
    await assert.rejects(
      waitForSuccessfulCi({
        sha: SHA,
        getWorkflowRuns: async () => [
          {
            event: "push",
            head_sha: SHA,
            status: "completed",
            conclusion,
          },
        ],
      }),
      new RegExp(conclusion, "u"),
    );
  });
}

test("classifies absent, successful, and inconsistent remote state", () => {
  const release = { html_url: "https://github.com/example/release" };

  assert.equal(
    classifyReleaseState({ tagSha: null, release: null }, SHA),
    "absent",
  );
  assert.equal(classifyReleaseState({ tagSha: SHA, release }, SHA), "success");
  assert.equal(
    classifyReleaseState({ tagSha: SHA, release: null }, SHA),
    "inconsistent",
  );
  assert.equal(
    classifyReleaseState({ tagSha: "f".repeat(40), release }, SHA),
    "inconsistent",
  );
});

test("rejects pre-existing remote Tags or Releases", () => {
  assert.throws(
    () => ensureRemoteTargetsAbsent({ tagSha: SHA, release: null }, "v1.0.0"),
    /already exists/u,
  );
  assert.throws(
    () =>
      ensureRemoteTargetsAbsent({ tagSha: null, release: { id: 1 } }, "v1.0.0"),
    /already exists/u,
  );
});

test("recovers an ambiguous create response when both remote objects match", async () => {
  const release = { html_url: "https://github.com/example/release" };
  const result = await createReleaseWithRecovery({
    expectedSha: SHA,
    createRelease: async () => {
      throw new Error("network details must not escape");
    },
    readState: async () => ({ tagSha: SHA, release }),
  });

  assert.deepEqual(result, { release, recovered: true });
});

test("verifies a successful create response with one write call", async () => {
  const release = { html_url: "https://github.com/example/release" };
  let createCount = 0;
  const result = await createReleaseWithRecovery({
    expectedSha: SHA,
    createRelease: async () => {
      createCount += 1;
    },
    readState: async () => ({ tagSha: SHA, release }),
  });

  assert.equal(createCount, 1);
  assert.deepEqual(result, { release, recovered: false });
});

test("allows retry when an ambiguous create response leaves no objects", async () => {
  await assert.rejects(
    createReleaseWithRecovery({
      expectedSha: SHA,
      createRelease: async () => {
        throw new Error("network details must not escape");
      },
      readState: async () => ({ tagSha: null, release: null }),
    }),
    /may be retried/u,
  );
});

test("requires manual review for partial or mismatched remote state", async () => {
  await assert.rejects(
    createReleaseWithRecovery({
      expectedSha: SHA,
      createRelease: async () => {},
      readState: async () => ({ tagSha: SHA, release: null }),
    }),
    /manual review/u,
  );
});

test("builds one ordinary Latest Release payload", () => {
  assert.deepEqual(
    buildReleasePayload({
      tagName: "v1.0.0",
      sha: SHA,
      title: "CherryChat v1.0.0",
      body: "Release body",
    }),
    {
      tag_name: "v1.0.0",
      target_commitish: SHA,
      name: "CherryChat v1.0.0",
      body: "Release body",
      draft: false,
      prerelease: false,
      make_latest: "true",
    },
  );
});

test("redacts GitHub API response bodies and credentials from errors", async () => {
  const token = "test-token-must-not-appear";
  const client = createGitHubClient({
    token,
    fetchImplementation: async () => ({
      ok: false,
      status: 500,
      json: async () => ({ secret: token }),
    }),
  });

  await assert.rejects(
    client.request("/repos/example/project"),
    (error) =>
      error instanceof Error &&
      error.message.includes("status 500") &&
      !error.message.includes(token) &&
      !error.message.includes("secret"),
  );
});

test("release workflow is manual, pinned, serialized, and minimally scoped", async () => {
  const workflow = await readFile(
    join(repositoryRoot, ".github/workflows/release.yml"),
    "utf8",
  );

  assert.match(workflow, /^on:\r?\n  workflow_dispatch:\r?$/mu);
  assert.doesNotMatch(workflow, /^\s+(?:pull_request|push):/mu);
  assert.doesNotMatch(workflow, /^\s+inputs:/mu);
  assert.match(
    workflow,
    /permissions:\r?\n  actions: read\r?\n  contents: write/u,
  );
  assert.match(workflow, /cancel-in-progress: false/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /GITHUB_REF_NAME.*DEFAULT_BRANCH/u);
  assert.match(workflow, /run: node scripts\/release\.mjs/u);
  assert.doesNotMatch(workflow, /secrets\.|pull_request_target|npm publish/iu);

  const actionReferences = [...workflow.matchAll(/uses:\s+[^@\s]+@([^\s]+)/gu)];
  assert.equal(actionReferences.length, 2);
  for (const reference of actionReferences) {
    assert.match(reference[1] ?? "", /^[0-9a-f]{40}$/u);
  }
});

async function writeJson(relativePath, value) {
  await writeFixture(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeFixture(relativePath, content) {
  const target = join(temporaryDirectory, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}
