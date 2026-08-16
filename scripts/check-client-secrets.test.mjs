import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptPath = fileURLToPath(
  new URL("./check-client-secrets.mjs", import.meta.url),
);
const ciWorkflowPath = fileURLToPath(
  new URL("../.github/workflows/ci.yml", import.meta.url),
);
const canaries = {
  OPENAI_API_KEY: "sk-ci-openai-7df8c15a5c6c4ab9",
  ACCESS_CODE: "ci-access-4bb72bce1ba74296",
  AUTH_SECRET: "ci-auth-secret-99a3495414054ced9ba9",
  TAVILY_API_KEY: "tvly-ci-93b27c15620d4f75",
  TAVILY_BASE_URL: "https://tvly-ci-upstream.example/search",
  EXA_API_KEY: "exa-ci-3495bbf2a7aa49af",
  EXA_BASE_URL: "https://exa-ci-upstream.example",
  GROK_API_KEY: "xai-ci-dd0e609949bc42f8",
  GROK_RESPONSES_URL: "https://grok-ci-upstream.example/v1/responses",
  GROK_MODEL: "grok-ci-canary-4-5",
  IMAGE_GENERATION_API_KEY: "image-ci-f55ac84fdc314eef",
  IMAGE_GENERATION_URL:
    "https://image-ci-upstream.example/v1/images/generations",
  IMAGE_EDIT_URL: "https://image-ci-upstream.example/v1/images/edits",
  IMAGE_GENERATION_MODEL: "image-ci-canary-model",
};

let workingDirectory;

beforeEach(async () => {
  workingDirectory = await mkdtemp(join(tmpdir(), "cherrychat-secret-scan-"));
});

afterEach(async () => {
  await rm(workingDirectory, { force: true, recursive: true });
});

test("CI builds and scans with every server canary", async () => {
  const workflow = await readFile(ciWorkflowPath, "utf8");
  const buildStep = workflow.match(
    /- name: Build production application[\s\S]*?(?=\n\s+- name:)/u,
  )?.[0];
  const scanStep = workflow.match(
    /- name: Scan client bundle for server canaries[\s\S]*?(?=\n\s+- name:)/u,
  )?.[0];

  assert.ok(buildStep, "Build step is missing from CI");
  assert.ok(scanStep, "Client-bundle scan step is missing from CI");
  for (const [name, value] of Object.entries(canaries)) {
    const declaration = `${name}: ${value}`;
    assert.ok(buildStep.includes(declaration), `${name} is missing from build`);
    assert.ok(scanStep.includes(declaration), `${name} is missing from scan`);
  }
});

async function writeBundle(relativePath, content) {
  const filePath = join(workingDirectory, ".next", "static", relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

function runScanner(environment = canaries) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: workingDirectory,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      ...environment,
    },
  });
}

test("passes when configured canaries are absent from the client bundle", async () => {
  await writeBundle("chunks/app.js", "console.info('client bundle');");

  const result = runScanner();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Client bundle secret scan passed/u);
});

test("fails without printing a canary when the client bundle contains it", async () => {
  await writeBundle("chunks/app.js", `window.__value=${canaries.ACCESS_CODE}`);

  const result = runScanner();
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 1);
  assert.match(output, /ACCESS_CODE/u);
  assert.doesNotMatch(output, new RegExp(canaries.ACCESS_CODE, "u"));
});

test("fails when required canary configuration is missing", async () => {
  await writeBundle("chunks/app.js", "console.info('client bundle');");

  const result = runScanner({});

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing required canary environment variables/u);
});

test("fails when the client bundle directory is missing", () => {
  const result = runScanner();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Client bundle directory is unavailable/u);
});
