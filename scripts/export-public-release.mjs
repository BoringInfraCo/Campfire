#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const EXACT_SOURCE_PATHS = new Set([
  ".github/workflows/ci.yml",
  ".github/workflows/release-tarball.yml",
  "LICENSE",
  "package-lock.json",
  "package.json",
  "scripts/package.sh",
  "scripts/run-acceptance-002.ts",
  "scripts/run-acceptance.ts",
  "scripts/sprint-019-receiver.mjs",
  "scripts/wrangler-deploy.mjs",
  "tsconfig.json",
  "vitest.config.ts",
  "wrangler.example.toml",
  "wrangler.toml",
  "docs/ARCHITECTURE.md",
  "docs/OPERATOR.md",
  "docs/PRODUCT_DEFINITION.md",
  "docs/VISION.md",
]);

const SOURCE_PREFIXES = ["fixtures/", "migrations/", "public/", "src/", "tests/"];
const TEMPLATE_ROOT = "public-release/root";
const OVERRIDE_ROOT = "public-release/overrides";

const FORBIDDEN_PATH =
  /(^|\/)(?:\.git|\.campfire|\.wrangler|dist|evidence|node_modules|release|skills|docs\/internal)(?:\/|$)|(^|\/)AGENTS\.md$|(^|\/)wrangler(?:\..+)?\.local\.toml$|(^|\/)(?:\.env(?:\..*)?|[^/]+\.env|[^/]+\.(?:db|db-journal|sqlite|sqlite3|key|pem|p12))$/i;

const FORBIDDEN_CONTENT = [
  { label: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: "GitHub token", pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { label: "OpenAI-style secret", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "Campfire bearer token", pattern: /\bcft_[0-9a-fA-F]{32,}\b/ },
  { label: "absolute macOS user path", pattern: /\/Users\/[A-Za-z0-9._-]+\// },
  { label: "absolute Windows user path", pattern: /[A-Za-z]:\\Users\\[^\\]+\\/i },
];

function fail(message) {
  console.error(`export-public-release: ${message}`);
  process.exit(1);
}

function git(args, encoding = "utf8") {
  return execFileSync("git", args, { cwd: root, encoding, stdio: ["ignore", "pipe", "pipe"] });
}

function parseArgs(argv) {
  const result = { ref: undefined, output: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--ref") result.ref = argv[++index];
    else if (arg === "--output") result.output = argv[++index];
    else if (arg === "--help") {
      console.log("Usage: npm run export:public -- --ref <tag-or-commit> --output <empty-directory>");
      process.exit(0);
    } else fail(`unknown argument: ${arg}`);
  }
  if (!result.ref) fail("--ref is required");
  if (!result.output) fail("--output is required");
  return result;
}

function listTree(ref, prefix) {
  const output = git(["ls-tree", "-r", "-z", ref, "--", prefix], "buffer");
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\w+)\s+([0-9a-f]+)\t(.+)$/);
      if (!match) fail(`could not parse git tree entry: ${line}`);
      return { mode: match[1], type: match[2], object: match[3], path: match[4] };
    });
}

function writeBlob(ref, entry, destinationPath) {
  const contents = git(["show", `${ref}:${entry.path}`], "buffer");
  mkdirSync(dirname(destinationPath), { recursive: true });
  writeFileSync(destinationPath, contents);
  if (entry.mode === "100755") chmodSync(destinationPath, 0o755);
}

function sourcePathAllowed(path) {
  return EXACT_SOURCE_PATHS.has(path) || SOURCE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function copyTree(ref, treeRoot, destinationRoot, stripPrefix = "") {
  for (const entry of listTree(ref, treeRoot)) {
    if (entry.type !== "blob") continue;
    const destinationRelative = stripPrefix ? entry.path.slice(stripPrefix.length) : entry.path;
    if (!destinationRelative || destinationRelative.startsWith("/") || destinationRelative.includes("..")) {
      fail(`unsafe destination path derived from ${entry.path}`);
    }
    writeBlob(ref, entry, join(destinationRoot, destinationRelative));
  }
}

function walk(directory, prefix = "") {
  const files = [];
  for (const name of readdirSync(directory).sort()) {
    const fullPath = join(directory, name);
    const relativePath = prefix ? `${prefix}/${name}` : name;
    if (statSync(fullPath).isDirectory()) files.push(...walk(fullPath, relativePath));
    else files.push({ fullPath, relativePath });
  }
  return files;
}

function renderTemplates(directory, replacements) {
  for (const { fullPath, relativePath } of walk(directory)) {
    const contents = readFileSync(fullPath);
    if (contents.includes(0)) continue;
    let text = contents.toString("utf8");
    for (const [token, value] of Object.entries(replacements)) text = text.replaceAll(token, value);
    writeFileSync(fullPath, text);
  }
}

function auditExport(directory) {
  const files = walk(directory);
  if (files.length === 0) fail("export is empty");
  for (const { fullPath, relativePath } of files) {
    if (FORBIDDEN_PATH.test(relativePath)) fail(`forbidden path in export: ${relativePath}`);
    const contents = readFileSync(fullPath);
    if (contents.includes(0)) continue;
    const text = contents.toString("utf8");
    for (const rule of FORBIDDEN_CONTENT) {
      if (rule.pattern.test(text)) fail(`${rule.label} pattern in export: ${relativePath}`);
    }
  }
  return files.map(({ relativePath }) => relativePath);
}

const args = parseArgs(process.argv.slice(2));
const status = git(["status", "--porcelain=v1"]);
if (status.trim()) fail("working tree must be clean; commit or stash changes before exporting");

const sourceCommit = git(["rev-parse", `${args.ref}^{commit}`]).trim();
const templateCommit = git(["rev-parse", "HEAD^{commit}"]).trim();
const output = resolve(args.output);
const relativeToRoot = relative(root, output);
if (!isAbsolute(output) || output === root || (!relativeToRoot.startsWith(`..${sep}`) && relativeToRoot !== "..")) {
  fail("--output must be outside the private repository");
}
if (existsSync(output) && readdirSync(output).length > 0) fail("--output must not exist or must be empty");
mkdirSync(output, { recursive: true });

const sourceEntries = listTree(sourceCommit, ".").filter(
  (entry) => entry.type === "blob" && sourcePathAllowed(entry.path),
);
for (const entry of sourceEntries) writeBlob(sourceCommit, entry, join(output, entry.path));

copyTree(templateCommit, TEMPLATE_ROOT, output, `${TEMPLATE_ROOT}/`);
copyTree(templateCommit, OVERRIDE_ROOT, output, `${OVERRIDE_ROOT}/`);

const packageJson = JSON.parse(readFileSync(join(output, "package.json"), "utf8"));
const expectedTag = `v${packageJson.version}`;
if (args.ref !== expectedTag && !args.ref.endsWith(sourceCommit)) {
  fail(`source ref ${args.ref} does not match package version ${packageJson.version} (${expectedTag})`);
}

const sourceDate = git(["show", "-s", "--format=%cI", sourceCommit]).trim();
const exportDate = new Date().toISOString().slice(0, 10);
renderTemplates(output, {
  "{{VERSION}}": packageJson.version,
  "{{SOURCE_COMMIT}}": sourceCommit,
  "{{SOURCE_DATE}}": sourceDate,
  "{{EXPORT_DATE}}": exportDate,
});

const files = auditExport(output);
writeFileSync(
  join(output, "PUBLIC_SNAPSHOT_MANIFEST.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      version: packageJson.version,
      sourceCommit,
      sourceDate,
      exportedAt: `${exportDate}T00:00:00.000Z`,
      files: [...files, "PUBLIC_SNAPSHOT_MANIFEST.json"].sort(),
    },
    null,
    2,
  )}\n`,
);

console.log(`export-public-release: v${packageJson.version}`);
console.log(`export-public-release: source ${sourceCommit}`);
console.log(`export-public-release: wrote ${files.length + 1} files to ${output}`);
