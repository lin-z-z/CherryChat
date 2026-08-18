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
  assert.equal(result.screenshotCount, 4);
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

test("reports obsolete product maturity language", async () => {
  await writeText("README.md", "# CherryChat\n\nThis product is an MVP.\n");

  const result = await checkDocumentation({ root: workingDirectory });

  assert.ok(
    result.errors.some((error) =>
      error.includes("obsolete product maturity term MVP"),
    ),
  );
});

test("reports obsolete Beta product maturity language", async () => {
  await writeText(
    "README.md",
    "# CherryChat\n\nThis product is a Beta release.\n",
  );

  const result = await checkDocumentation({ root: workingDirectory });

  assert.ok(
    result.errors.some((error) =>
      error.includes("obsolete product maturity term Beta"),
    ),
  );
});

test("reports missing bilingual release documents", async () => {
  await rm(join(workingDirectory, "docs/RELEASES_CN.md"));

  const result = await checkDocumentation({ root: workingDirectory });

  assert.ok(
    result.errors.some(
      (error) =>
        error.includes("docs/RELEASES_CN.md") &&
        error.includes("file is missing"),
    ),
  );
});

test("reports missing release navigation", async () => {
  await writeText(
    "docs/README.md",
    "# Docs\n\n[简体中文](./README_CN.md)\n\n## Boundary\n\nStable documentation.\n",
  );

  const result = await checkDocumentation({ root: workingDirectory });

  assert.ok(
    result.errors.some(
      (error) =>
        error.includes("docs/README.md") &&
        error.includes("missing required entry ./RELEASES.md"),
    ),
  );
  assert.ok(
    result.errors.some(
      (error) =>
        error.includes("docs/README.md") &&
        error.includes("missing required entry ../CHANGELOG.md"),
    ),
  );
});

async function createValidFixture(root) {
  const readmeShared = [
    "1.1.0",
    "[Contributing](./CONTRIBUTING.md)",
    "[License](./LICENSE)",
    "https://vercel.com/new/clone",
  ].join("\n");

  await writeText(
    "README.md",
    `# CherryChat\n\n[简体中文](./README_CN.md)\n[Docs](./docs/README.md)\n[Deployment](./docs/DEPLOYMENT.md)\n[Image generation](./docs/IMAGE_GENERATION.md)\n[Security](./docs/SECURITY.md)\n[Releases](./docs/RELEASES.md)\n[Changelog](./CHANGELOG.md)\nBring Your Own Key (BYOK)\nHosted access\nSelf-hosting\n${readmeShared}\n`,
  );
  await writeText(
    "README_CN.md",
    `# CherryChat\n\n[English](./README.md)\n[文档](./docs/README_CN.md)\n[部署](./docs/DEPLOYMENT_CN.md)\n[图片生成](./docs/IMAGE_GENERATION_CN.md)\n[安全](./docs/SECURITY_CN.md)\n[发布](./docs/RELEASES_CN.md)\n[变更记录](./CHANGELOG_CN.md)\n自带 API Key（BYOK）\n托管访问（Hosted access）\n自托管（Self-hosting）\n${readmeShared}\n`,
  );
  await writeText(
    "CHANGELOG.md",
    "# Changelog\n\n[简体中文](./CHANGELOG_CN.md)\n\n## [Unreleased]\n\n## [1.1.0]\n\n### Added\n\nImage generation.\n\n## [1.0.0]\n\n### Known limitations\n\nBackup v2.\n\n[Deployment](./docs/DEPLOYMENT.md)\n[Security](./docs/SECURITY.md)\n[Releases](./docs/RELEASES.md)\n",
  );
  await writeText(
    "CHANGELOG_CN.md",
    "# 变更记录\n\n[English](./CHANGELOG.md)\n\n## [Unreleased]\n\n## [1.1.0]\n\n### 新增\n\n图片生成。\n\n## [1.0.0]\n\n### 已知限制\n\nBackup v2。\n\n[部署](./docs/DEPLOYMENT_CN.md)\n[安全](./docs/SECURITY_CN.md)\n[发布](./docs/RELEASES_CN.md)\n",
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
    ["IMAGE_GENERATION.md", "IMAGE_GENERATION_CN.md"],
    ["ROADMAP.md", "ROADMAP_CN.md"],
    ["RELEASES.md", "RELEASES_CN.md"],
  ]) {
    const englishTerms = [
      englishName === "DEPLOYMENT.md"
        ? "\nBring Your Own Key (BYOK)\nHosted access\nSelf-hosting\nWho supplies the provider key\nWho pays the provider\n[Images](./IMAGE_GENERATION.md)\nIMAGE_GENERATION_PROFILES\n"
        : "",
      englishName === "README.md"
        ? "\nv1.1.0\n[Images](./IMAGE_GENERATION.md)\n[Releases](./RELEASES.md)\n[Changelog](../CHANGELOG.md)\n"
        : "",
      englishName === "RELEASES.md"
        ? "\nvMAJOR.MINOR.PATCH\nworkflow_dispatch\nactions: read\ncontents: write\nPublic tags are immutable\n"
        : "",
      englishName === "IMAGE_GENERATION.md"
        ? "\ngpt-image-2\n/v1/images/generations\n/v1/images/edits\n/api/image-generation\nIMAGE_GENERATION_PROFILES\nBackup v2\n"
        : "",
    ].join("");
    const chineseTerms = [
      chineseName === "DEPLOYMENT_CN.md"
        ? "\n自带 API Key（BYOK）\n托管访问（Hosted access）\n自托管（Self-hosting）\n谁提供 Provider Key\n谁承担 Provider 费用\n[图片](./IMAGE_GENERATION_CN.md)\nIMAGE_GENERATION_PROFILES\n"
        : "",
      chineseName === "README_CN.md"
        ? "\nv1.1.0\n[图片](./IMAGE_GENERATION_CN.md)\n[发布](./RELEASES_CN.md)\n[变更记录](../CHANGELOG_CN.md)\n"
        : "",
      chineseName === "RELEASES_CN.md"
        ? "\nvMAJOR.MINOR.PATCH\nworkflow_dispatch\nactions: read\ncontents: write\n公开 Tag 不可移动\n"
        : "",
      chineseName === "IMAGE_GENERATION_CN.md"
        ? "\ngpt-image-2\n/v1/images/generations\n/v1/images/edits\n/api/image-generation\nIMAGE_GENERATION_PROFILES\nBackup v2\n"
        : "",
    ].join("");
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
    "cherrychat-image-generation.png",
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
