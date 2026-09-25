// Resolves the real D1 database_id WITHOUT committing it.
// Precedence: non-empty trimmed $CAMPFIRE_D1_DATABASE_ID, else gitignored
// wrangler.local.toml. A sentinel env value wins and is unusable — it does
// not fall through to the local file. Empty/whitespace env is absent, and a
// local-file sentinel is treated as no id.
//
// Remote mutation (any invocation without --dry-run, including deploy and
// `d1 migrations apply ... --remote`) fails closed before spawning Wrangler
// when no non-placeholder id is available. A placeholder must never be sent
// to Cloudflare. `deploy --dry-run` may still use the committed placeholder
// because it does not mutate remote state.
//
// When a real id is present, an ephemeral --config is written under os.tmpdir()
// (prefix campfire-wrangler-) and removed after Wrangler exits, including
// failure and spawn errors. The committed wrangler.toml is never rewritten.
// Logs name the source only, never the id, a sentinel, or file contents.
//
// Usage: node scripts/wrangler-deploy.mjs [wrangler args...]
//   npm run deploy            -> wrangler deploy
//   npm run deploy:dry-run    -> wrangler deploy --dry-run
//   npm run db:migrate        -> wrangler d1 migrations apply campfire --remote
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
const REPLACE_ME = "REPLACE_ME_WITH_OUTPUT_OF_WRANGLER_D1_CREATE";

// Test seams. Production npm scripts leave both unset, so this file always
// spawns `npx wrangler` with the repo as cwd.
// CAMPFIRE_WRANGLER_BIN: when set, spawn that executable with wrangler's args
// directly (not via npx) so tests can stub Wrangler without network or credentials.
// CAMPFIRE_CONFIG_ROOT: honored only when the bin is also set. Tests point it
// at an isolated fixture so the operator's gitignored wrangler.local.toml is
// never read. When the bin is unset, root is always the repo (parent of scripts/).
const wranglerBin = process.env.CAMPFIRE_WRANGLER_BIN?.trim() ?? "";
const requestedRoot = process.env.CAMPFIRE_CONFIG_ROOT?.trim() ?? "";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = wranglerBin && requestedRoot ? requestedRoot : repoRoot;

function isSentinel(id) {
  return id === PLACEHOLDER || id === REPLACE_ME;
}

function idFromLocalFile() {
  try {
    const text = readFileSync(join(root, "wrangler.local.toml"), "utf8");
    const m = text.match(/database_id\s*=\s*"([^"]+)"/);
    if (m && m[1] && !isSentinel(m[1])) {
      return { id: m[1], source: "wrangler.local.toml" };
    }
  } catch {
    // absent — fall through
  }
  return null;
}

// Non-empty trimmed env wins even when it is a sentinel. Do not fall through
// to wrangler.local.toml in that case. Empty/whitespace env is absent.
const envId = process.env.CAMPFIRE_D1_DATABASE_ID?.trim() ?? "";
const configured = envId
  ? { id: envId, source: "$CAMPFIRE_D1_DATABASE_ID" }
  : idFromLocalFile();
const real = configured && !isSentinel(configured.id) ? configured : null;

const args = process.argv.slice(2);
if (args.length === 0) args.push("deploy");
const dryRun = args.includes("--dry-run");

function spawnWrangler(configFlag) {
  // Production invocation stays `npx wrangler`. The bin seam replaces npx
  // only when a test sets CAMPFIRE_WRANGLER_BIN.
  if (wranglerBin) {
    return spawnSync(wranglerBin, [...args, ...configFlag], {
      stdio: "inherit",
      cwd: root,
      env: process.env,
    });
  }
  return spawnSync("npx", ["wrangler", ...args, ...configFlag], {
    stdio: "inherit",
    cwd: root,
    env: process.env,
  });
}

// Do not process.exit inside this try: Node skips finally on process.exit,
// which would leave the ephemeral config (and the injected id) on disk.
let tmp = null;
let status = 1;
try {
  if (real) {
    const src = readFileSync(join(root, "wrangler.toml"), "utf8");
    if (!src.includes(PLACEHOLDER)) {
      console.error("error: placeholder id not found in wrangler.toml; refusing to patch");
    } else {
      tmp = mkdtempSync(join(tmpdir(), "campfire-wrangler-"));
      const out = src
        .replaceAll(PLACEHOLDER, real.id)
        // --config in $TMPDIR breaks wrangler's config-relative paths, so
        // absolutize them in the ephemeral copy only (committed file untouched).
        .replace('main = "src/worker/index.ts"', `main = "${join(root, "src/worker/index.ts")}"`)
        .replace('migrations_dir = "migrations"', `migrations_dir = "${join(root, "migrations")}"`)
        .replace('directory = "./public"', `directory = "${join(root, "public")}"`);
      const tmpConfig = join(tmp, "wrangler.toml");
      writeFileSync(tmpConfig, out);
      console.error(`[campfire] using D1 id from ${real.source} via ephemeral config`);
      const res = spawnWrangler(["--config", tmpConfig]);
      status = res.status ?? 1;
    }
  } else if (!dryRun) {
    // Fail closed before spawn. No ephemeral config, and the message must not
    // include the configured id, a sentinel, bearer tokens, or file contents.
    console.error(
      "[campfire] error: remote mutation requires a non-placeholder D1 id from $CAMPFIRE_D1_DATABASE_ID or wrangler.local.toml",
    );
  } else {
    console.error(
      "[campfire] no D1 id found (env/local file); using committed placeholder config (local dev / --dry-run only)",
    );
    const res = spawnWrangler([]);
    status = res.status ?? 1;
  }
} finally {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}

process.exit(status);
