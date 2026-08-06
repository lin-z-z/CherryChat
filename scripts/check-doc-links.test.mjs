import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkDocumentation } from "./check-doc-links.mjs";

let workingDirectory;

beforeEach(async () => {
  workingDirectory = await mkdtemp(join(tmpdir(), "cherrychat-doc-check-"));
  await createValidFixture(workingDirectory);
});

afterEach(async () => {
  await rm(workingDirectory, { force: true, recursive: true });
});

test("passes a complete documentation fixture", async () => {
  const result = await checkDocumentation({ root: workingDirectory });

  assert.deepEqual(result.errors, []);
  assert.equal(result.screenshotCount, 3);
});

test("reports missing and private local targets", async () => {
  await writeText(
    "docs/README.md",
    "# Docs\n\n[Missing](./missing.md)\n[Private](../.trellis/tasks/current.md)\n",
  );

  const result = await checkDocumentation({ root: workingDirectory });

  assert.ok(
    result.errors.some((error) => error.includes("missing local target")),
  );
  assert.ok(result.errors.some((error) => error.includes("private path")));
});

test("reports release placeholders and oversized screenshots", async () => {
  await writeText(
    "CONTRIBUTING.md",
    "# Contributing\n\nTODO: contact <owner>.\n",
  );
  await writeFile(
    join(workingDirectory, "docs/images/cherrychat-mobile.png"),
    Buffer.alloc(1_500_001),
  );

  const result = await checkDocumentation({ root: workingDirectory });

  assert.ok(result.errors.some((error) => error.includes("TODO placeholder")));
  assert.ok(result.errors.some((error) => error.includes("owner placeholder")));
  assert.ok(result.errors.some((error) => error.includes("exceeds")));
});

async function createValidFixture(root) {
  const readmeShared = [
    "Preview",
    "[Deployment](./docs/DEPLOYMENT.md)",
    "[Security](./docs/SECURITY.md)",
    "[Contributing](./CONTRIBUTING.md)",
    "[License](./LICENSE)",
    "https://vercel.com/new/clone",
  ].join("\n");

  await writeText(
    "README.md",
    `# CherryChat\n\n[简体中文](./README_CN.md)\n${readmeShared}\n`,
  );
  await writeText(
    "README_CN.md",
    `# CherryChat\n\n[English](./README.md)\n${readmeShared}\n`,
  );
  await writeText("CONTRIBUTING.md", "# Contributing\n");
  await writeText("LICENSES.md", "# Licenses\n");
  await writeText("LICENSE", "MIT\n");
  await writeText("docs/README.md", "# Docs\n\n[Security](./SECURITY.md)\n");
  await writeText("docs/DEPLOYMENT.md", "# Deployment\n");
  await writeText("docs/SECURITY.md", "# Security\n");

  for (const imageName of [
    "cherrychat-desktop.png",
    "cherrychat-settings.png",
    "cherrychat-mobile.png",
  ]) {
    await mkdir(join(root, "docs/images"), { recursive: true });
    await writeFile(join(root, "docs/images", imageName), Buffer.from("png"));
  }
}

async function writeText(relativePath, content) {
  const absolutePath = join(workingDirectory, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}
