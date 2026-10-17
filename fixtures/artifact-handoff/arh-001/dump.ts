/**
 * ARH-001 served-state dump for the frozen artifact-reference key (contract §3.1 / §5 D1–D6).
 *
 * Reads the seeded database through the real application service — each actor
 * is bound directly (or through their token when `--tokens` is supplied,
 * exactly as the CLI/Viewer binding does) and writes stable, pretty-printed
 * JSON: `whoami` for every fixture actor, `get_workspace_context` and
 * `get_workspace` for every readable (actor, workspace) combination, a set of
 * denied reads for the sanitization record, and a sha256 summary of every file
 * with the page counts and truncation per slice.
 *
 *   npx tsx fixtures/artifact-handoff/arh-001/dump.ts --db <campfire.db> --tokens <tokens.json> --out <dir>
 *
 * The read clock is frozen to `SERVED_AT`, so two dumps of two independently
 * seeded databases are byte-identical. Never hand-edit dumps; re-run this.
 *
 * The unrelated workspace is deliberately never dumped: its finding carries
 * `UNRELATED_FINDING_SENTINEL` and the sanitizer hard-fails if that string
 * enters any dumped text. Zed's denial of the lab read is captured in
 * `denials.json` instead.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { ActorRef } from "../../../src/domain/types.js";
import { dispatchCampfireMethod } from "../../../src/http/dispatch.js";
import type { ActorContext } from "../../../src/service/authorization.js";
import { createCampfireService } from "../../../src/service/campfire-service.js";
import type { WorkspaceContext } from "../../../src/service/service.js";
import { openReadonlySqliteStore } from "../../../src/store/sqlite-store.js";
import { SCENARIO, SERVED_AT, UNKNOWN_WORKSPACE_ID, UNRELATED_FINDING_SENTINEL } from "./seed.js";

function fail(message: string): never {
  throw new Error(`arh-001 dump: ${message}`);
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

const ACTOR_KEYS = ["ana", "ben", "zed", "opencode", "codex"] as const;
type ActorKey = (typeof ACTOR_KEYS)[number];

/**
 * Every readable (actor, workspace) combination that may be dumped. The
 * unrelated workspace is absent by design: its only member's read would carry
 * the sentinel finding, and the sanitizer forbids that string in any dump.
 */
const READABLE: ReadonlyArray<{ actor: ActorKey; workspaceIds: readonly string[] }> = [
  { actor: "ana", workspaceIds: [SCENARIO.workspaces.lab, SCENARIO.workspaces.truncArtifacts] },
  { actor: "ben", workspaceIds: [SCENARIO.workspaces.lab, SCENARIO.workspaces.truncArtifacts] },
  { actor: "opencode", workspaceIds: [SCENARIO.workspaces.lab] },
  { actor: "codex", workspaceIds: [SCENARIO.workspaces.lab] },
];

function actorRefOf(actor: ActorKey): ActorRef {
  if (actor === "ana") return { actorId: SCENARIO.humans.ana, actorType: "human" };
  if (actor === "ben") return { actorId: SCENARIO.humans.ben, actorType: "human" };
  if (actor === "zed") return { actorId: SCENARIO.humans.zed, actorType: "human" };
  if (actor === "opencode") return { actorId: SCENARIO.agents.opencode, actorType: "agent" };
  return { actorId: SCENARIO.agents.codex, actorType: "agent" };
}

interface DenialRecord {
  case: string;
  method: string;
  actor: ActorRef;
  workspaceId: string;
  artifactId?: string;
  outcome: "denied";
  error: { name: string; code?: string; message: string };
  note: string;
}

/** Capture the real typed error surface of a denied read. */
function captureDenial(input: {
  case: string;
  method: string;
  actor: ActorKey;
  workspaceId: string;
  artifactId?: string;
  note: string;
  action: () => unknown;
}): DenialRecord {
  try {
    input.action();
  } catch (error) {
    const name = error instanceof Error ? error.name : typeof error;
    const code =
      error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
    const message = error instanceof Error ? error.message : String(error);
    return {
      case: input.case,
      method: input.method,
      actor: actorRefOf(input.actor),
      workspaceId: input.workspaceId,
      ...(input.artifactId === undefined ? {} : { artifactId: input.artifactId }),
      outcome: "denied",
      error: { name, ...(code === undefined ? {} : { code }), message },
      note: input.note,
    };
  }
  return fail(`${input.case} was allowed`);
}

function sliceFacts(slice: { total: number; returned: number; truncated: boolean; nextCursor?: string }): {
  total: number;
  returned: number;
  truncated: boolean;
  nextCursorPresent: boolean;
} {
  return {
    total: slice.total,
    returned: slice.returned,
    truncated: slice.truncated,
    nextCursorPresent: slice.nextCursor !== undefined,
  };
}

function contextSliceSummary(context: WorkspaceContext): Record<string, unknown> {
  return {
    tasks: sliceFacts(context.slices.tasks),
    findings: sliceFacts(context.slices.findings),
    decisions: sliceFacts(context.slices.decisions),
    artifacts: sliceFacts(context.slices.artifacts),
    recentChanges: sliceFacts(context.slices.recentChanges),
  };
}

const args = parseArgs(process.argv.slice(2));
mkdirSync(args.out, { recursive: true });

const tokenValues: Partial<Record<ActorKey, string>> =
  args.tokens === undefined ? {} : (JSON.parse(readFileSync(args.tokens, "utf8")) as typeof tokenValues);

const store = openReadonlySqliteStore(args.db);
const service = createCampfireService({ store, clock: () => SERVED_AT });
try {
  /** Bind each actor directly, and cross-check any supplied token. */
  const refs = new Map<ActorKey, ActorRef>();
  for (const actor of ACTOR_KEYS) {
    const expected = actorRefOf(actor);
    if (args.tokens !== undefined) {
      const token = tokenValues[actor];
      assert(typeof token === "string" && token.length > 0, `tokens.json has no ${actor} token`);
      const resolved = service.resolveToken(token);
      assert(
        resolved.actorId === expected.actorId && resolved.actorType === expected.actorType,
        `${actor} token resolved to ${resolved.actorId}`,
      );
    }
    refs.set(actor, expected);
  }

  const files: Array<{ name: string; sha256: string }> = [];
  const slices: Array<{ actor: ActorKey; workspaceId: string; slices: Record<string, unknown> }> = [];

  // whoami for every fixture actor. It carries no workspace facts, so the
  // denial-only actor (Zed) can be dumped without touching the sentinel.
  for (const actor of ACTOR_KEYS) {
    const ctx: ActorContext = { actor: refs.get(actor) as ActorRef };
    const whoami = dispatchCampfireMethod(service, ctx, "whoami", {});
    files.push(writeStable(args.out, `whoami-${actor}.json`, whoami));
  }

  // Authorized served state for every readable (actor, workspace) combination.
  for (const entry of READABLE) {
    const ctx: ActorContext = { actor: refs.get(entry.actor) as ActorRef };
    for (const workspaceId of entry.workspaceIds) {
      const context = service.getWorkspaceContext(ctx, workspaceId);
      const workspace = service.getWorkspace(ctx, workspaceId);
      files.push(writeStable(args.out, `context-${workspaceId}-${entry.actor}.json`, context));
      files.push(writeStable(args.out, `workspace-${workspaceId}-${entry.actor}.json`, workspace));
      slices.push({ actor: entry.actor, workspaceId, slices: contextSliceSummary(context) });
    }
  }

  // Denied / not-found reads: the record keeps the case, the caller, the
  // workspace id, and the error name/code/message. No object detail may cross
  // the boundary — asserted below, then re-asserted by the file sanitizer.
  const denials: DenialRecord[] = [
    captureDenial({
      case: "zed-reads-lab-context",
      method: "get_workspace_context",
      actor: "zed",
      workspaceId: SCENARIO.workspaces.lab,
      note: "Zed is not a lab participant; the message names only the caller and the workspace id.",
      action: () => service.getWorkspaceContext({ actor: actorRefOf("zed") }, SCENARIO.workspaces.lab),
    }),
    captureDenial({
      case: "ana-reads-unrelated-context",
      method: "get_workspace_context",
      actor: "ana",
      workspaceId: SCENARIO.workspaces.unrelated,
      note: "Ana is not a participant of the unrelated workspace; no title, finding, or count crosses the boundary.",
      action: () => service.getWorkspaceContext({ actor: actorRefOf("ana") }, SCENARIO.workspaces.unrelated),
    }),
    captureDenial({
      case: "ana-reads-unknown-workspace-context",
      method: "get_workspace_context",
      actor: "ana",
      workspaceId: UNKNOWN_WORKSPACE_ID,
      note: "The workspace does not exist; only the caller-supplied id is echoed.",
      action: () => service.getWorkspaceContext({ actor: actorRefOf("ana") }, UNKNOWN_WORKSPACE_ID),
    }),
    captureDenial({
      case: "ana-reads-trunc-artifact-through-lab-workspace",
      method: "get_artifact",
      actor: "ana",
      workspaceId: SCENARIO.workspaces.lab,
      artifactId: SCENARIO.artifacts.truncLinked,
      note: "A record id from another workspace addressed through the lab route is not found; nothing from the other workspace is returned.",
      action: () =>
        service.getArtifactInWorkspace(
          { actor: actorRefOf("ana") },
          SCENARIO.workspaces.lab,
          SCENARIO.artifacts.truncLinked,
        ),
    }),
  ];
  for (const denial of denials) {
    const text = JSON.stringify(denial);
    assert(!text.includes(UNRELATED_FINDING_SENTINEL), "unrelated sentinel leaked into a denial");
    assert(!text.includes("Token rotation"), "unrelated finding text leaked into a denial");
    assert(!text.includes(SCENARIO.workspaceNames.unrelated), "unrelated workspace name leaked into a denial");
    assert(!text.includes(SCENARIO.workspaceNames.lab), "lab workspace name leaked into a denial");
    assert(!text.includes("Q3 handoff analysis"), "lab artifact title leaked into a denial");
  }
  const denialsFile = writeStable(args.out, "denials.json", denials);

  const allFiles = [...files, denialsFile].sort((a, b) => (a.name < b.name ? -1 : 1));
  const summary = {
    provenance: "FIXTURE EVIDENCE — cannot establish Gate B, C, or E.",
    servedAt: SERVED_AT,
    files: allFiles,
    slices: slices.sort((a, b) => {
      const left = `${a.workspaceId}/${a.actor}`;
      const right = `${b.workspaceId}/${b.actor}`;
      return left < right ? -1 : 1;
    }),
    denials: denials.map((denial) => ({
      case: denial.case,
      outcome: denial.outcome,
      error: { name: denial.error.name, ...(denial.error.code === undefined ? {} : { code: denial.error.code }) },
    })),
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
        dumpedWorkspaces: [SCENARIO.workspaces.lab, SCENARIO.workspaces.truncArtifacts],
        denial: denials.map((denial) => ({ case: denial.case, error: denial.error.code })),
      },
      null,
      2,
    )}\n`,
  );
} finally {
  service.close();
}
