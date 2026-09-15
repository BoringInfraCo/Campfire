// Resolves the real D1 database_id WITHOUT committing it.
// Precedence: $CAMPFIRE_D1_DATABASE_ID > wrangler.local.toml > placeholder.
// Generates an ephemeral --config in os.tmpdir() with the id injected,
// then execs wrangler. Never writes back to committed wrangler.toml.
//
// Usage: node scripts/wrangler-deploy.mjs [deploy|--dry-run|...]
//   npm run deploy            -> wrangler deploy (id injected if available)
//   npm run deploy:dry-run    -> wrangler deploy --dry-run (validates with placeholder)
import { spawnSync } from "node:child_process";
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function idFromLocalFile() {
  for (const name of ["wrangler.local.toml"]) {
    try {
      const text = readFileSync(join(root, name), "utf8");
      const m = text.match(/database_id\s*=\s*"([^"]+)"/);
      if (m && m[1] && m[1] !== PLACEHOLDER && m[1] !== "REPLACE_ME_WITH_OUTPUT_OF_WRANGLER_D1_CREATE") {
        return { id: m[1], source: name };
      }
    } catch {
      // absent — fall through
    }
  }
  return null;
}

const envId = process.env.CAMPFIRE_D1_DATABASE_ID?.trim();
const local = envId ? { id: envId, source: "$CAMPFIRE_D1_DATABASE_ID" } : idFromLocalFile();
const args = process.argv.slice(2);
if (args.length === 0) args.push("deploy");

let configFlag = [];
let tmp = null;
if (local) {
  tmp = mkdtempSync(join(tmpdir(), "campfire-wrangler-"));
  const src = readFileSync(join(root, "wrangler.toml"), "utf8");
  if (!src.includes(PLACEHOLDER)) {
    console.error("error: placeholder id not found in wrangler.toml; refusing to patch");
    process.exit(1);
  }
  const out = src
    .replaceAll(PLACEHOLDER, local.id)
    // --config in $TMPDIR breaks wrangler's config-relative paths, so
    // absolutize them in the ephemeral copy only (committed file untouched).
    .replace('main = "src/worker/index.ts"', `main = "${join(root, "src/worker/index.ts")}"`)
    .replace('migrations_dir = "migrations"', `migrations_dir = "${join(root, "migrations")}"`)
    .replace('directory = "./public"', `directory = "${join(root, "public")}"`);
  const tmpConfig = join(tmp, "wrangler.toml");
  writeFileSync(tmpConfig, out);
  configFlag = ["--config", tmpConfig];
  console.error(`[campfire] using D1 id from ${local.source} via ephemeral config`);
} else {
  console.error("[campfire] no D1 id found (env/local file); using committed placeholder config (local dev / --dry-run only)");
}

const res = spawnSync("npx", ["wrangler", ...args, ...configFlag], {
  stdio: "inherit",
  cwd: root,
  env: process.env,
});
process.exit(res.status ?? 1);
