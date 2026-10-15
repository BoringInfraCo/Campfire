/**
 * SWH-001 served-state dump for the frozen answer key (contract §6.1/§9.2).
 *
 * Reads the seeded database through the real application service — each human's
 * own token is resolved to their actor, exactly as the CLI/Viewer binding does
 * — and writes stable, pretty-printed JSON (`get_workspace_context` for Dana and
 * Rowan, `get_workspace` as the detail-inspection reference).
 *
 *   npx tsx fixtures/swh-001/dump.ts --db <campfire.db> --tokens <tokens.json> --out <dir>
 *
 * The read clock is frozen to `SERVED_AT`, so two dumps of two independently
 * seeded databases are byte-identical. Never hand-edit dumps; re-run this.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { openReadonlySqliteStore } from "../../src/store/sqlite-store.js";
import { SCENARIO, SERVED_AT } from "./seed.js";

function fail(message: string): never {
  throw new Error(`swh-001 dump: ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

/** Recursively sort object keys so dumps are stable across runs. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) output[key] = sorted(input[key]);
    return output;
  }
  return value;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function writeStable(outDir: string, name: string, value: unknown): { name: string; sha256: string } {
  const text = `${JSON.stringify(sorted(value), null, 2)}\n`;
  assert(!text.includes("cft_"), `${name} contains a credential-shaped string`);
  writeFileSync(resolve(outDir, name), text);
  return { name, sha256: sha256(text) };
}

function parseArgs(argv: string[]): { db: string; tokens: string; out: string } {
  let db: string | undefined;
  let tokens: string | undefined;
  let out: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--db" || arg === "--tokens" || arg === "--out") {
      if (value === undefined || value.startsWith("--")) fail(`${arg} requires a value`);
      const path = isAbsolute(value) ? value : resolve(value);
      if (arg === "--db") db = path;
      else if (arg === "--tokens") tokens = path;
      else out = path;
      index += 1;
      continue;
    }
    fail(`unknown argument ${arg}`);
  }
  if (db === undefined) fail("--db is required");
  if (tokens === undefined) fail("--tokens is required");
  if (out === undefined) fail("--out is required");
  return { db, tokens, out };
}

const args = parseArgs(process.argv.slice(2));
mkdirSync(args.out, { recursive: true });

const tokenValues = JSON.parse(readFileSync(args.tokens, "utf8")) as Partial<Record<"dana" | "rowan" | "codex" | "opencode", string>>;
assert(typeof tokenValues.dana === "string" && tokenValues.dana.length > 0, "tokens.json has no dana token");
assert(typeof tokenValues.rowan === "string" && tokenValues.rowan.length > 0, "tokens.json has no rowan token");

const store = openReadonlySqliteStore(args.db);
const service = createCampfireService({ store, clock: () => SERVED_AT });
try {
  const danaActor = service.resolveToken(tokenValues.dana);
  const rowanActor = service.resolveToken(tokenValues.rowan);
  assert(
    danaActor.actorId === SCENARIO.humans.dana && danaActor.actorType === "human",
    `dana token resolved to ${danaActor.actorId}`,
  );
  assert(
    rowanActor.actorId === SCENARIO.humans.rowan && rowanActor.actorType === "human",
    `rowan token resolved to ${rowanActor.actorId}`,
  );

  const danaContext = service.getWorkspaceContext({ actor: danaActor }, SCENARIO.workspaceId);
  const rowanContext = service.getWorkspaceContext({ actor: rowanActor }, SCENARIO.workspaceId);
  const workspace = service.getWorkspace({ actor: danaActor }, SCENARIO.workspaceId);

  const files = [
    writeStable(args.out, "context-dana.json", danaContext),
    writeStable(args.out, "context-rowan.json", rowanContext),
    writeStable(args.out, "workspace-dana.json", workspace),
  ];

  process.stdout.write(
    `${JSON.stringify(
      {
        databasePath: args.db,
        outDir: args.out,
        servedAt: SERVED_AT,
        files,
        sourcePosition: {
          dana: { orientationCursor: danaContext.orientationCursor, generatedAt: danaContext.generatedAt },
          rowan: { orientationCursor: rowanContext.orientationCursor, generatedAt: rowanContext.generatedAt },
        },
      },
      null,
      2,
    )}\n`,
  );
} finally {
  service.close();
}
