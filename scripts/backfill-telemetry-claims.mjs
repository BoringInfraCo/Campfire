#!/usr/bin/env node

/**
 * Cold-start backfill for the telemetry prior-install gate.
 *
 * Legit installation ids whose `install_completed` predates the D1 guard have
 * no `telemetry_claims` row, so the prior-install gate would treat their
 * `activated`/`active` events as `no_install`. This script derives the
 * idempotent backfill offline: it hashes each installation id with SHA-256 and
 * emits one `INSERT OR IGNORE` per id. The raw id never leaves the operator
 * machine in any stored form — only digests reach D1, matching the guard's
 * `install:<sha256hex>` claim key, so the output file contains hashes only.
 *
 * Usage:
 *   node scripts/backfill-telemetry-claims.mjs <uuid>... [--from-json ids.json]
 *   node scripts/backfill-telemetry-claims.mjs --from-json ids.json > backfill.sql
 *   node scripts/backfill-telemetry-claims.mjs <uuid>... --execute-sql > backfill.sql
 *
 * `--from-json` accepts a JSON array of strings or `{ "ids": [...] }`.
 * `--claimed-at` overrides the `claimed_at` timestamp (default: now, ISO).
 * `--execute-sql` additionally prints the `wrangler d1 execute` invocation to
 * stderr (never executed by this script). Stdout carries only SQL.
 * Stderr carries only hashes and a count summary — never a raw id.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const INSTALL_KIND = "install";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the value is a UUID-shaped installation id. Case-insensitive. */
export function isInstallationId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

/** SHA-256 hex of one installation id. The only form ids take into storage. */
export function hashInstallationId(installationId) {
  return createHash("sha256").update(installationId.trim(), "utf8").digest("hex");
}

/** D1 claim key for one installation id. Matches `guard.ts` exactly. */
export function claimKeyForInstallationId(installationId) {
  return `install:${hashInstallationId(installationId)}`;
}

/** One idempotent backfill row. `claimKey` must already be the full key. */
export function backfillStatementFor(claimKey, claimedAt) {
  return `INSERT OR IGNORE INTO telemetry_claims (kind, claim_key, claimed_at) VALUES ('${INSTALL_KIND}', '${claimKey}', '${claimedAt}');`;
}

/**
 * Deduplicated backfill statements for valid ids. Invalid ids throw without
 * echoing the offending value (raw ids must not appear in any output).
 */
export function buildBackfillStatements(ids, claimedAt) {
  const seen = new Set();
  const statements = [];
  for (const id of ids) {
    if (!isInstallationId(id)) {
      throw new Error("refusing to backfill: one entry is not a valid installation id (UUID)");
    }
    const key = claimKeyForInstallationId(id);
    if (seen.has(key)) continue;
    seen.add(key);
    statements.push(backfillStatementFor(key, claimedAt));
  }
  return statements;
}

/** The `wrangler d1 execute` invocation. Printed, never executed. */
export function wranglerExecuteInvocation({ database, local, sqlFile }) {
  const target = local ? "--local" : "--remote";
  return `npx wrangler d1 execute ${database} ${target} --file ${sqlFile}`;
}

const USAGE = `Usage: node scripts/backfill-telemetry-claims.mjs [options] [<uuid> ...]

Cold-start backfill for the telemetry prior-install gate. Emits idempotent
INSERT OR IGNORE statements (hashes only) to stdout.

Options:
  --from-json <path>     JSON file: an array of ids or { "ids": [...] }.
  --claimed-at <iso>     claimed_at timestamp (default: now, ISO 8601).
  --database <name>      D1 database name for the printed invocation
                         (default: campfire).
  --local                Print a --local invocation (default: --remote).
  --execute-sql          Also print the wrangler d1 execute invocation to
                         stderr. This script never executes wrangler itself.
  --help, -h             Print this help and exit.

Output: stdout carries only SQL (digests, no raw ids). Stderr carries only
the count summary and, with --execute-sql, the wrangler invocation. Raw
installation ids appear in neither stream. Save stdout to a file, then apply:
  npx wrangler d1 execute campfire --remote --file backfill.sql`;

function fail(message) {
  console.error(`backfill-telemetry-claims: ${message}`);
  process.exit(1);
}

export function parseArgs(argv) {
  const opts = {
    ids: [],
    fromJson: undefined,
    claimedAt: undefined,
    database: "campfire",
    local: false,
    executeSql: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--from-json") {
      opts.fromJson = argv[++index];
      if (opts.fromJson === undefined) fail("--from-json requires a path");
    } else if (arg === "--claimed-at") {
      opts.claimedAt = argv[++index];
      if (opts.claimedAt === undefined) fail("--claimed-at requires an ISO timestamp");
    } else if (arg === "--database") {
      opts.database = argv[++index];
      if (opts.database === undefined) fail("--database requires a name");
    } else if (arg === "--local") {
      opts.local = true;
    } else if (arg === "--execute-sql") {
      opts.executeSql = true;
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg.startsWith("--")) {
      fail(`unknown argument: ${arg}`);
    } else {
      opts.ids.push(arg);
    }
  }
  return opts;
}

function readIdsFromJson(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    fail(`cannot read --from-json file (${path.length > 0 ? "unreadable path" : "missing path"})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("cannot parse --from-json file: not valid JSON");
  }
  const ids = Array.isArray(parsed) ? parsed : parsed?.ids;
  if (!Array.isArray(ids)) fail("cannot parse --from-json file: expected an array or { \"ids\": [...] }");
  return ids;
}

function resolveClaimedAt(raw) {
  if (raw === undefined) return new Date().toISOString();
  if (Number.isNaN(Date.parse(raw))) fail("--claimed-at must be a valid ISO 8601 timestamp");
  return raw;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stderr.write(`${USAGE}\n`);
    return;
  }
  const fromFile = opts.fromJson !== undefined ? readIdsFromJson(opts.fromJson) : [];
  const ids = [...fromFile, ...opts.ids];
  if (ids.length === 0) fail("no installation ids: pass UUIDs as arguments and/or --from-json <path>");
  const claimedAt = resolveClaimedAt(opts.claimedAt);
  let statements;
  try {
    statements = buildBackfillStatements(ids, claimedAt);
  } catch (error) {
    fail(error instanceof Error ? error.message : "invalid input");
  }
  for (const statement of statements) {
    process.stdout.write(`${statement}\n`);
  }
  process.stderr.write(
    `backfill-telemetry-claims: ${statements.length} statement(s) for ${statements.length} unique installation(s) at ${claimedAt}\n`,
  );
  if (opts.executeSql) {
    process.stderr.write(
      `# Apply with:\n${wranglerExecuteInvocation({ database: opts.database, local: opts.local, sqlFile: "backfill.sql" })}\n`,
    );
  }
}

/**
 * Importable hashing/SQL generation for unit tests. Importing this module has
 * no side effects: the CLI entry below only runs when the file is executed
 * directly, never when it is imported.
 */
const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    fail(error instanceof Error ? error.message : "unexpected failure");
  }
}
