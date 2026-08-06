import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = resolve(dirname(scriptPath), "..");

const ROOT_MARKDOWN_FILES = [
  "README.md",
  "README_CN.md",
  "CONTRIBUTING.md",
  "LICENSES.md",
];

const SCREENSHOT_PATHS = [
  "docs/images/cherrychat-desktop.png",
  "docs/images/cherrychat-settings.png",
  "docs/images/cherrychat-mobile.png",
];

const SCREENSHOT_MAX_BYTES = 1_500_000;

const FORBIDDEN_TARGETS = [
  /(?:^|\/)docs\/audits(?:\/|$)/u,
  /(?:^|\/)\.trellis\/tasks(?:\/|$)/u,
  /(?:^|\/)\.trellis\/workspace(?:\/|$)/u,
];

const PLACEHOLDERS = [
  { label: "owner placeholder", pattern: /<owner>/iu },
  { label: "example.com placeholder", pattern: /\bexample\.com\b/iu },
  { label: "TODO placeholder", pattern: /\bTODO\b/u },
];

const REQUIRED_README_TOKENS = {
  "README.md": [
    "./README_CN.md",
    "Preview",
    "./docs/DEPLOYMENT.md",
    "./docs/SECURITY.md",
    "./CONTRIBUTING.md",
    "./LICENSE",
    "vercel.com/new/clone",
  ],
  "README_CN.md": [
    "./README.md",
    "Preview",
    "./docs/DEPLOYMENT.md",
    "./docs/SECURITY.md",
    "./CONTRIBUTING.md",
    "./LICENSE",
    "vercel.com/new/clone",
  ],
};

export async function checkDocumentation({ root = defaultRoot } = {}) {
  const absoluteRoot = resolve(root);
  const markdownFiles = await collectMarkdownFiles(absoluteRoot);
  const errors = [];

  for (const filePath of markdownFiles) {
    const content = await readFile(filePath, "utf8");
    const displayPath = toRepositoryPath(absoluteRoot, filePath);

    for (const { label, pattern } of PLACEHOLDERS) {
      if (pattern.test(content)) {
        errors.push(`${displayPath}: contains ${label}`);
      }
    }

    for (const target of extractDocumentTargets(content)) {
      const normalizedTarget = normalizeTargetForPolicy(target);
      if (FORBIDDEN_TARGETS.some((pattern) => pattern.test(normalizedTarget))) {
        errors.push(`${displayPath}: links to private path ${target}`);
        continue;
      }

      const localTarget = resolveLocalTarget({
        sourcePath: filePath,
        target,
      });
      if (!localTarget) continue;
      if (!isInsideRoot(absoluteRoot, localTarget)) {
        errors.push(`${displayPath}: link escapes repository root: ${target}`);
        continue;
      }
      try {
        await stat(localTarget);
      } catch {
        errors.push(`${displayPath}: missing local target ${target}`);
      }
    }
  }

  for (const [readmePath, tokens] of Object.entries(REQUIRED_README_TOKENS)) {
    const absolutePath = resolve(absoluteRoot, readmePath);
    let content;
    try {
      content = await readFile(absolutePath, "utf8");
    } catch {
      errors.push(`${readmePath}: file is missing`);
      continue;
    }
    for (const token of tokens) {
      if (!content.includes(token)) {
        errors.push(`${readmePath}: missing required entry ${token}`);
      }
    }
  }

  for (const screenshotPath of SCREENSHOT_PATHS) {
    const absolutePath = resolve(absoluteRoot, screenshotPath);
    try {
      const metadata = await stat(absolutePath);
      if (!metadata.isFile() || metadata.size === 0) {
        errors.push(`${screenshotPath}: screenshot is empty or not a file`);
      } else if (metadata.size > SCREENSHOT_MAX_BYTES) {
        errors.push(
          `${screenshotPath}: screenshot exceeds ${SCREENSHOT_MAX_BYTES} bytes`,
        );
      }
    } catch {
      errors.push(`${screenshotPath}: screenshot is missing`);
    }
  }

  return {
    errors,
    markdownCount: markdownFiles.length,
    screenshotCount: SCREENSHOT_PATHS.length,
  };
}

export function extractDocumentTargets(content) {
  const targets = [];
  const markdownLink = /!?\[[^\]]*\]\(([^)\n]+)\)/gu;
  const htmlAttribute = /\b(?:href|src)=["']([^"']+)["']/gu;

  for (const match of content.matchAll(markdownLink)) {
    const target = cleanMarkdownTarget(match[1]);
    if (target) targets.push(target);
  }
  for (const match of content.matchAll(htmlAttribute)) {
    const target = match[1]?.trim();
    if (target) targets.push(target);
  }
  return targets;
}

export function resolveLocalTarget({ sourcePath, target }) {
  const normalized = target.trim();
  if (
    normalized.startsWith("#") ||
    normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/iu.test(normalized)
  ) {
    return null;
  }

  const withoutFragment = normalized.split("#", 1)[0]?.split("?", 1)[0];
  if (!withoutFragment) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    decoded = withoutFragment;
  }
  return resolve(dirname(sourcePath), decoded);
}

async function collectMarkdownFiles(root) {
  const files = [];
  for (const relativePath of ROOT_MARKDOWN_FILES) {
    files.push(resolve(root, relativePath));
  }
  await walkMarkdown(resolve(root, "docs"), files);
  return files;
}

async function walkMarkdown(directory, files) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "audits") continue;
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdown(entryPath, files);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }
}

function cleanMarkdownTarget(value) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("<")) {
    const end = trimmed.indexOf(">");
    return end > 1 ? trimmed.slice(1, end) : trimmed;
  }
  return trimmed.split(/\s+["']/u, 1)[0] ?? trimmed;
}

function normalizeTargetForPolicy(target) {
  return target
    .split("#", 1)[0]
    .split("?", 1)[0]
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .toLowerCase();
}

function isInsideRoot(root, target) {
  const pathFromRoot = relative(root, target);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== "..")
  );
}

function toRepositoryPath(root, filePath) {
  return relative(root, filePath).replaceAll("\\", "/");
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const result = await checkDocumentation();
  if (result.errors.length > 0) {
    for (const error of result.errors) process.stderr.write(`- ${error}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Documentation check passed (${result.markdownCount} Markdown files, ${result.screenshotCount} screenshots).\n`,
    );
  }
}
