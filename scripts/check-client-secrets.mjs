import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const requiredCanaryNames = [
  "OPENAI_API_KEY",
  "ACCESS_CODE",
  "AUTH_SECRET",
  "TAVILY_API_KEY",
  "TAVILY_BASE_URL",
  "EXA_API_KEY",
  "EXA_BASE_URL",
  "GROK_API_KEY",
  "GROK_RESPONSES_URL",
  "GROK_MODEL",
  "IMAGE_GENERATION_API_KEY",
  "IMAGE_GENERATION_BASE_URL",
  "IMAGE_GENERATION_MODEL",
];

function readCanaries(environment) {
  const missingNames = requiredCanaryNames.filter(
    (name) => !environment[name]?.trim(),
  );
  if (missingNames.length > 0) {
    throw new Error(
      `Missing required canary environment variables: ${missingNames.join(", ")}`,
    );
  }

  return requiredCanaryNames.map((name) => ({
    name,
    value: Buffer.from(environment[name], "utf8"),
  }));
}

async function listBundleFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      throw new Error("Client bundle directory is unavailable: .next/static");
    }
    throw cause;
  }

  const files = [];
  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listBundleFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    } else if (entry.isSymbolicLink()) {
      throw new Error("Client bundle contains an unsupported symbolic link");
    }
  }
  return files;
}

async function scanClientBundle(staticDirectory, canaries) {
  const files = await listBundleFiles(staticDirectory);
  const hitCounts = new Map(canaries.map(({ name }) => [name, 0]));

  for (const filePath of files) {
    const content = await readFile(filePath);
    for (const canary of canaries) {
      if (content.includes(canary.value)) {
        hitCounts.set(canary.name, (hitCounts.get(canary.name) ?? 0) + 1);
      }
    }
  }

  return { filesScanned: files.length, hitCounts };
}

async function main() {
  const canaries = readCanaries(process.env);
  const result = await scanClientBundle(
    resolve(process.cwd(), ".next", "static"),
    canaries,
  );
  const hits = [...result.hitCounts].filter(([, count]) => count > 0);

  if (hits.length > 0) {
    console.error("Client bundle secret scan detected configured canaries:");
    for (const [name, count] of hits) {
      console.error(`- ${name}: ${count} file(s)`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Client bundle secret scan passed (${result.filesScanned} files, ${canaries.length} canaries).\n`,
  );
}

const mainModulePath = process.argv[1] ? resolve(process.argv[1]) : null;
if (mainModulePath === fileURLToPath(import.meta.url)) {
  main().catch((cause) => {
    const message = cause instanceof Error ? cause.message : "Unknown failure";
    console.error(`Client bundle secret scan failed: ${message}`);
    process.exitCode = 1;
  });
}

export { readCanaries, scanClientBundle };
