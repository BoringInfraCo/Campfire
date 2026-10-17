/**
 * NAV-001 served-state dump for the display-pressure fixture (Step 0).
 *
 * Reads the seeded database through the real application service and writes
 * stable, pretty-printed JSON: `get_workspace_context` and `get_workspace` for
 * the lab workspace as Ana and as Ben, `whoami` for both, plus denial records
 * for Zed attempting the lab read (he is authorized only in the unrelated
 * workspace) and a sha256 summary of every file.
 *
 *   npx tsx fixtures/navigator/nav-001/dump.ts --db <campfire.db> [--tokens <tokens.json>] --out <dir>
 *
 * The read clock is frozen to SERVED_AT, so two dumps of two independently
 * seeded databases are byte-identical. Never hand-edit dumps; re-run this.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { ActorRef } from "../../../src/domain/types.js";
import { dispatchCampfireMethod } from "../../../src/http/dispatch.js";
import type { ActorContext } from "../../../src/service/authorization.js";
import { createCampfireService } from "../../../src/service/campfire-service.js";
import { openReadonlySqliteStore } from "../../../src/store/sqlite-store.js";
import { SCENARIO, SERVED_AT, UNRELATED_FINDING_SENTINEL } from "./seed.js";

function fail(message: string): never {
  throw new Error(`nav-001 dump: ${message}`);
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

function sanitizeCheck(name: string, text: string): void {
  assert(!text.includes("cft_"), `${name} contains a credential-shaped string`);
  assert(!text.includes("/Users/"), `${name} contains an absolute home path`);
  assert(!text.includes("/private/"), `${name} contains an absolute private path`);
  assert(!text.includes("/var/folders/"), `${name} contains an absolute temp path`);
  assert(!text.includes(UNRELATED_FINDING_SENTINEL), `${name} contains the unrelated sentinel`);
}

function writeStable(outDir: string, name: string, value: unknown): { name: string; sha256: string } {
  const text = `${JSON.stringify(sorted(value), null, 2)}\n`;
  sanitizeCheck(name, text);
  writeFileSync(resolve(outDir, name), text);
  return { name, sha256: sha256(text) };
}

function parseArgs(argv: string[]): { db: string; tokens?: string; out: string } {
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
  if (out === undefined) fail("--out is required");
  return { db, ...(tokens === undefined ? {} : { tokens }), out };
}

const ACTORS = ["ana", "ben"] as const;

/** The dumped lab workspace; the unrelated workspace is never dumped. */
const DUMPED_WORKSPACES = [SCENARIO.workspaces.lab] as const;

function human(id: string): ActorRef {
  return { actorId: id, actorType: "human" };
}

const args = parseArgs(process.argv.slice(2));
mkdirSync(args.out, { recursive: true });

const tokenValues: Partial<Record<"ana" | "ben" | "zed", string>> = {};
if (args.tokens !== undefined) {
  const parsed = JSON.parse(readFileSync(args.tokens, "utf8")) as {
    humans?: Partial<Record<"ana" | "ben" | "zed", string>>;
    zed?: string;
  } & Partial<Record<"ana" | "ben" | "zed", string>>;
  for (const actor of ACTORS) {
    tokenValues[actor] = parsed.humans?.[SCENARIO.humans[actor]] ?? parsed.humans?.[actor] ?? parsed[actor];
  }
}

const store = openReadonlySqliteStore(args.db);
const service = createCampfireService({ store, clock: () => SERVED_AT });
try {
  /** Bind each dumped actor directly, and cross-check any supplied token. */
  const actorRefs = new Map<(typeof ACTORS)[number], ActorRef>();
  for (const actor of ACTORS) {
    const expected = human(SCENARIO.humans[actor]);
    if (args.tokens !== undefined) {
      const token = tokenValues[actor];
      assert(typeof token === "string" && token.length > 0, `tokens.json has no ${actor} token`);
      const resolved = service.resolveToken(token);
      assert(
        resolved.actorId === expected.actorId && resolved.actorType === "human",
        `${actor} token resolved to ${resolved.actorId}`,
      );
    }
    actorRefs.set(actor, expected);
  }

  const files: Array<{ name: string; sha256: string }> = [];
  for (const actor of ACTORS) {
    const ref = actorRefs.get(actor) as ActorRef;
    const ctx: ActorContext = { actor: ref };
    for (const workspaceId of DUMPED_WORKSPACES) {
      const context = service.getWorkspaceContext(ctx, workspaceId);
      const workspace = service.getWorkspace(ctx, workspaceId);
      files.push(writeStable(args.out, `context-${workspaceId}-${actor}.json`, context));
      files.push(writeStable(args.out, `workspace-${workspaceId}-${actor}.json`, workspace));
    }
    const whoami = dispatchCampfireMethod(service, ctx, "whoami", {});
    files.push(writeStable(args.out, `whoami-${actor}.json`, whoami));
  }

  /**
   * Denied cross-workspace reads: Zed is a participant of the unrelated
   * workspace only. The record keeps the case, the error name/code, and the
   * message; no lab content may cross the boundary.
   */
  const zedCtx: ActorContext = { actor: human(SCENARIO.humans.zed) };
  const denials: unknown[] = [];
  for (const [label, read] of [
    ["zed-reads-lab-workspace-context", () => service.getWorkspaceContext(zedCtx, SCENARIO.workspaces.lab)],
    ["zed-reads-lab-workspace", () => service.getWorkspace(zedCtx, SCENARIO.workspaces.lab)],
  ] as const) {
    const denial = (() => {
      try {
        read();
      } catch (error) {
        const name = error instanceof Error ? error.name : typeof error;
        const code =
          error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
        const message = error instanceof Error ? error.message : String(error);
        return {
          case: label,
          actor: { actorId: SCENARIO.humans.zed, actorType: "human" },
          workspaceId: SCENARIO.workspaces.lab,
          outcome: "denied",
          error: { name, ...(code === undefined ? {} : { code }), message },
          note: "The message names only the caller and the workspace id; no title, participant, count, or record text crosses the boundary.",
        };
      }
      fail(`${label} unexpectedly succeeded`);
    })();
    denials.push(denial);
  }
  const denialText = JSON.stringify(denials);
  assert(!denialText.includes(UNRELATED_FINDING_SENTINEL), "unrelated sentinel leaked into the denial");
  assert(!denialText.includes("Token rotation"), "unrelated finding text leaked into the denial");
  assert(!denialText.includes("Zed"), "unrelated participant name leaked into the denial");
  const denialsFile = writeStable(args.out, "denials.json", denials);

  const allFiles = [...files, denialsFile].sort((a, b) => (a.name < b.name ? -1 : 1));
  const summary = {
    provenance: "FIXTURE EVIDENCE — cannot establish Gate B, C, or E.",
    servedAt: SERVED_AT,
    dumpedWorkspaces: [...DUMPED_WORKSPACES],
    denial: { cases: denials.map((denial) => (denial as { case: string }).case) },
    files: allFiles,
  };
  const summaryText = `${JSON.stringify(summary, null, 2)}\n`;
  sanitizeCheck("dump-summary.json", summaryText);
  writeFileSync(resolve(args.out, "dump-summary.json"), summaryText);

  process.stdout.write(
    `${JSON.stringify(
      {
        outDir: args.out,
        servedAt: SERVED_AT,
        files: allFiles.map((file) => file.name),
        dumpedWorkspaces: [...DUMPED_WORKSPACES],
        denials: denials.map((denial) => (denial as { case: string; error: { code?: string } }).case),
      },
      null,
      2,
    )}\n`,
  );
} finally {
  service.close();
}
