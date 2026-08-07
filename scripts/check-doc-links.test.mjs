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

test("reports missing language links and translation structure drift", async () => {
  await writeText(
    "docs/ROADMAP_CN.md",
    "# 路线图\n\n[English](./ROADMAP.md)\n\n## 边界\n\n### 额外标题\n",
  );
  await writeText("docs/SECURITY.md", "# Security\n\n## Boundary\n");

  const result = await checkDocumentation({ root: workingDirectory });

  assert.ok(
    result.errors.some((error) => error.includes("missing language link")),
  );
  assert.ok(
    result.errors.some((error) => error.includes("heading structure differs")),
  );
});

test("reports missing plain-language connection terminology", async () => {
  await writeText(
    "docs/DEPLOYMENT_CN.md",
    "# 部署\n\n[English](./DEPLOYMENT.md)\n\n## 边界\n\n连接说明。\n",
  );

  const result = await checkDocumentation({ root: workingDirectory });

  assert.ok(
    result.errors.some(
      (error) =>
        error.includes("docs/DEPLOYMENT_CN.md") &&
        error.includes("missing required entry"),
    ),
  );
});

async function createValidFixture(root) {
  const readmeShared = [
    "Preview",
    "[Contributing](./CONTRIBUTING.md)",
    "[License](./LICENSE)",
    "https://vercel.com/new/clone",
  ].join("\n");

  await writeText(
    "README.md",
    `# CherryChat\n\n[简体中文](./README_CN.md)\n[Docs](./docs/README.md)\n[Deployment](./docs/DEPLOYMENT.md)\n[Security](./docs/SECURITY.md)\nBring Your Own Key (BYOK)\nHosted access\nSelf-hosting\n${readmeShared}\n`,
  );
  await writeText(
    "README_CN.md",
    `# CherryChat\n\n[English](./README.md)\n[文档](./docs/README_CN.md)\n[部署](./docs/DEPLOYMENT_CN.md)\n[安全](./docs/SECURITY_CN.md)\n自带 API Key（BYOK）\n托管访问（Hosted access）\n自托管（Self-hosting）\n${readmeShared}\n`,
  );
  await writeText("CONTRIBUTING.md", "# Contributing\n");
  await writeText("LICENSES.md", "# Licenses\n");
  await writeText("LICENSE", "MIT\n");
  for (const [englishName, chineseName] of [
    ["README.md", "README_CN.md"],
    ["DEPLOYMENT.md", "DEPLOYMENT_CN.md"],
    ["MODEL_COMPATIBILITY.md", "MODEL_COMPATIBILITY_CN.md"],
    ["SECURITY.md", "SECURITY_CN.md"],
    ["DATA.md", "DATA_CN.md"],
    ["ROADMAP.md", "ROADMAP_CN.md"],
  ]) {
    const englishTerms =
      englishName === "DEPLOYMENT.md"
        ? "\nBring Your Own Key (BYOK)\nHosted access\nSelf-hosting\nWho supplies the provider key\nWho pays the provider\n"
        : "";
    const chineseTerms =
      chineseName === "DEPLOYMENT_CN.md"
        ? "\n自带 API Key（BYOK）\n托管访问（Hosted access）\n自托管（Self-hosting）\n谁提供 Provider Key\n谁承担 Provider 费用\n"
        : "";
    await writeText(
      `docs/${englishName}`,
      `# English\n\n[简体中文](./${chineseName})\n\n## Boundary\n\nComplete English content.\n${englishTerms}`,
    );
    await writeText(
      `docs/${chineseName}`,
      `# 中文\n\n[English](./${englishName})\n\n## 边界\n\n这是用于测试的完整中文技术文档内容，覆盖与英文相同的边界。\n${chineseTerms}`,
    );
  }

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
