import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptPath = fileURLToPath(
  new URL("./check-client-secrets.mjs", import.meta.url),
);
const canaries = {
  OPENAI_API_KEY: "sk-ci-openai-7df8c15a5c6c4ab9",
  ACCESS_CODE: "ci-access-4bb72bce1ba74296",
  AUTH_SECRET: "ci-auth-secret-99a3495414054ced9ba9",
  TAVILY_API_KEY: "tvly-ci-93b27c15620d4f75",
};

let workingDirectory;

beforeEach(async () => {
  workingDirectory = await mkdtemp(join(tmpdir(), "cherrychat-secret-scan-"));
});

afterEach(async () => {
  await rm(workingDirectory, { force: true, recursive: true });
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
