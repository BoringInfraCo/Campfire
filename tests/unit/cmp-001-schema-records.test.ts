/**
 * CMP-001 slice B: declared outputSchema for list_tasks, get_task, get_decision, get_finding, get_artifact.
 * The schemas must accept every real output (a mismatch makes the SDK turn a success into an isError),
 * from the Step 0 observations and from live SQLite and D1 services, and the emitted JSON Schema
 * must be free of $ref/$defs/$schema.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import type { ActorRef } from "../../src/domain/types.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import { createAsyncCampfireService } from "../../src/worker/async-service.js";
import { createD1Store, migrateD1 } from "../../src/worker/d1-store.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";
import {
  getArtifactOutput,
  getArtifactOutputSchema,
  getDecisionOutput,
  getDecisionOutputSchema,
  getFindingOutput,
  getFindingOutputSchema,
  getTaskOutput,
  getTaskOutputSchema,
  listTasksOutput,
  listTasksOutputSchema,
} from "../../src/mcp/schemas/records.js";

const SHAPES = {
  list_tasks: listTasksOutput,
  get_task: getTaskOutput,
  get_decision: getDecisionOutput,
  get_finding: getFindingOutput,
  get_artifact: getArtifactOutput,
} as const;
const LOOSE = {
  list_tasks: listTasksOutputSchema,
  get_task: getTaskOutputSchema,
  get_decision: getDecisionOutputSchema,
  get_finding: getFindingOutputSchema,
  get_artifact: getArtifactOutputSchema,
} as const;
type ToolName = keyof typeof SHAPES;
const TOOLS = Object.keys(SHAPES) as ToolName[];

/** Exactly what tools/list does (SDK 1.32.1 server/mcp.js:128-135). */
function emitted(tool: ToolName): Record<string, unknown> {
  const obj = normalizeObjectSchema(SHAPES[tool] as never);
  expect(obj).toBeDefined();
  return toJsonSchemaCompat(obj as never, { strictUnions: true, pipeStrategy: "output" }) as Record<string, unknown>;
}

function check(tool: ToolName, value: unknown) {
  return z.object(SHAPES[tool]).safeParse(value);
}

function expectValid(tool: ToolName, value: unknown, label: string) {
  const r = check(tool, value);
  expect(r.success, `${tool} ${label}: ${r.success ? "" : JSON.stringify(r.error.issues)}`).toBe(true);
}

function hasNull(v: unknown): boolean {
  if (v === null) return true;
  if (Array.isArray(v)) return v.some(hasNull);
  if (typeof v === "object" && v !== null) return Object.values(v).some(hasNull);
  return false;
}

function walk(v: unknown, path: string, hits: string[]) {
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, hits));
  else if (typeof v === "object" && v !== null) {
    for (const [k, x] of Object.entries(v)) {
      if (k === "$ref" || k === "$defs" || k === "definitions" || k === "maxLength") hits.push(`${path}.${k}`);
      if (k === "$schema" && path !== "$") hits.push(`${path}.${k}`);
      walk(x, `${path}.${k}`, hits);
    }
  }
}

describe("emitted JSON Schema", () => {
  for (const tool of TOOLS) {
    for (const form of ["shape", "loose"] as const) {
      it(`${tool} (${form}): object, no $ref/$defs, no nested $schema`, () => {
        const obj = normalizeObjectSchema((form === "shape" ? SHAPES[tool] : LOOSE[tool]) as never);
        const schema = toJsonSchemaCompat(obj as never, { strictUnions: true, pipeStrategy: "output" }) as Record<string, unknown>;
        expect(schema.type).toBe("object");
        const hits: string[] = [];
        walk(schema, "$", hits);
        expect(hits).toEqual([]);
        const text = JSON.stringify(schema);
        expect(text).not.toContain("$ref");
        expect(text).not.toContain("$defs");
        // The SDK itself stamps a root-level draft-07 $schema on every converted schema (inputSchema too);
        // a schema author cannot remove it. Pin it so a change shows up.
        expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
        expect(text.match(/\$schema/g)).toHaveLength(1);
      });
    }
    it(`${tool}: loose form leaves additionalProperties open at every object level`, () => {
      const obj = normalizeObjectSchema(LOOSE[tool] as never);
      const schema = toJsonSchemaCompat(obj as never, { strictUnions: true, pipeStrategy: "output" });
      expect(JSON.stringify(schema)).not.toContain('"additionalProperties":false');
    });
    it(`${tool}: raw shape form emits additionalProperties:false at the root only`, () => {
      const schema = emitted(tool);
      expect(schema.additionalProperties).toBe(false);
      const props = JSON.stringify(schema.properties);
      expect(props).not.toContain('"additionalProperties":false');
    });
  }
});

describe("Step 0 observations", () => {
  for (const tool of TOOLS) {
    it(`${tool}: every non-error parsedBody validates`, () => {
      const file = JSON.parse(
        readFileSync(`fixtures/cmp-001/observations/${tool}.json`, "utf8"),
      ) as { rows: Array<{ caseId: string; parsedBody: unknown; shape: { isError?: boolean } }> };
      let validated = 0;
      for (const row of file.rows) {
        if (row.shape.isError) continue;
        expectValid(tool, row.parsedBody, row.caseId);
        validated += 1;
      }
      expect(validated).toBeGreaterThan(0);
    });
  }
});

describe("negative cases", () => {
  const task = {
    createdBy: { actorId: "hum_1", actorType: "human" },
    createdAt: "t",
    id: "task_1",
    workspaceId: "ws_1",
    title: "x",
    status: "open",
    updatedAt: "t",
  };
  it("accepts a minimal task plus unknown keys", () => {
    expectValid("get_task", { ...task, futureField: 1 }, "minimal");
  });
  it("rejects wrong-typed or out-of-enum fields", () => {
    expect(check("get_task", { ...task, status: "done" }).success).toBe(false);
    expect(check("get_task", { ...task, title: 5 }).success).toBe(false);
    expect(check("get_task", { ...task, createdBy: { actorId: "a", actorType: "robot" } }).success).toBe(false);
    expect(check("get_task", { ...task, description: null }).success).toBe(false);
    expect(check("list_tasks", { schemaVersion: 2, workspaceId: "w", items: [], total: 0, returned: 0, truncated: false }).success).toBe(false);
    expect(check("list_tasks", { schemaVersion: 1, workspaceId: "w", items: [{ ...task, status: 1 }], total: 1, returned: 1, truncated: false }).success).toBe(false);
    expect(check("get_finding", { ...task, summary: "s", confidence: "high" }).success).toBe(false);
    expect(check("get_finding", { ...task, summary: "s", currentness: "gone" }).success).toBe(false);
    expect(check("get_decision", { ...task, summary: "s", status: "accepted", needsReview: false }).success).toBe(false);
    expect(check("get_decision", { ...task, summary: "s", status: "rejected" }).success).toBe(false);
    expect(check("get_artifact", { ...task, type: "file", title: "t", uriOrPath: "p", metadata: [1] }).success).toBe(false);
    expect(check("get_artifact", { ...task, type: "file", title: "t", uriOrPath: 3 }).success).toBe(false);
  });
});

// ---- live SQLite + D1 ----

const NOW = "2026-01-01T00:00:00.000Z";
const HUMAN: ActorRef = { actorId: "hum_1", actorType: "human" };
const owner: ActorContext = { actor: HUMAN };

function clock() {
  let ms = Date.parse(NOW);
  return () => new Date((ms += 1000)).toISOString();
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

async function setup() {
  const sqlite = openInMemoryStore();
  const adapter = sqliteD1();
  await migrateD1(adapter.binding);
  const remote = createD1Store(adapter.binding);
  const sync = createCampfireService({ store: sqlite, idSource: createCounterIdSource(), clock: clock() });
  const async_ = createAsyncCampfireService({ store: remote, idSource: createCounterIdSource(), clock: clock() });
  cleanups.push(() => {
    sync.close();
    adapter.database.close();
  });
  sqlite.createOrganization({ id: "org_1", name: "Org", createdAt: NOW });
  sqlite.createTeam({ id: "team_1", organizationId: "org_1", name: "Team", createdAt: NOW });
  sqlite.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
  await remote.createOrganization({ id: "org_1", name: "Org", createdAt: NOW });
  await remote.createTeam({ id: "team_1", organizationId: "org_1", name: "Team", createdAt: NOW });
  await remote.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
  return { sync, async_ };
}

type Svc = Awaited<ReturnType<typeof setup>>;

/** Runs the same calls against both services and returns the pair of results. */
async function both<T>(s: Svc, fn: (svc: ReturnType<typeof wrap>) => T | Promise<T>): Promise<[T, T]> {
  return [await fn(wrap(s.sync)), await fn(wrap(s.async_))];
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySvc = { [k: string]: (...a: any[]) => any } & Record<"createWorkspace" | "createTask" | "updateTask" | "addArtifact" | "addFinding" | "citeFindingEvidence" | "correctFinding" | "withdrawFinding" | "addDecision" | "citeDecisionBasis" | "acceptDecision" | "retireDecision" | "getTaskInWorkspace" | "getFindingInWorkspace" | "getDecisionInWorkspace" | "getArtifactInWorkspace" | "listTasksPage", (...a: any[]) => any>;
function wrap(svc: unknown): AnySvc {
  return svc as AnySvc;
}

async function seeded() {
  const s = await setup();
  const out: Record<string, { sqlite: unknown; d1: unknown }> = {};
  const roundtrip = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown;
  const record = (key: string, pair: [unknown, unknown]) => {
    out[key] = { sqlite: roundtrip(pair[0]), d1: roundtrip(pair[1]) };
  };

  const [ws] = await both(s, (v) => v.createWorkspace(owner, { teamId: "team_1", name: "W" }) as Promise<{ id: string }>);
  const W = ws.id;
  // Tasks: 5, mixed statuses, assignee/description on some; blocked ones sort first.
  const createdTasks: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const [t] = await both(s, (v) =>
      v.createTask(owner, {
        workspaceId: W,
        title: `task ${i}`,
        ...(i % 2 === 0 ? { description: `desc ${i}`, assignee: HUMAN } : {}),
      }) as Promise<{ id: string }>,
    );
    createdTasks.push(t.id);
  }
  await both(s, (v) => v.updateTask(owner, { taskId: createdTasks[3]!, status: "blocked" }));
  const taskIds = (await both(s, (v) => v.listTasksPage(owner, { workspaceId: W }) as Promise<{ items: Array<{ id: string }> }>))[0].items.map((t) => t.id);
  await both(s, (v) => v.updateTask(owner, { taskId: taskIds[taskIds.length - 1]!, status: "completed" }));

  // Artifacts with and without metadata.
  const [art1] = await both(s, (v) =>
    v.addArtifact(owner, { workspaceId: W, type: "log", title: "a1", uriOrPath: "logs/a.txt", metadata: { n: 1, nested: { x: [1, "a", null] }, s: "é" } }) as Promise<{ id: string }>,
  );
  const [art2] = await both(s, (v) => v.addArtifact(owner, { workspaceId: W, type: "file", title: "a2", uriOrPath: "src/a.ts" }) as Promise<{ id: string }>);

  // Findings: plain, with confidence + source artifact + evidence, corrected (superseded + successor), withdrawn.
  const [fPlain] = await both(s, (v) => v.addFinding(owner, { workspaceId: W, summary: "plain" }) as Promise<{ id: string }>);
  const [fRich] = await both(s, (v) =>
    v.addFinding(owner, { workspaceId: W, summary: "rich", detail: "d", confidence: 0.75, sourceArtifactId: art1.id }) as Promise<{ id: string }>,
  );
  await both(s, (v) => v.citeFindingEvidence(owner, { findingId: fRich.id, artifactId: art2.id, relation: "supports", note: "n" }));
  await both(s, (v) => v.citeFindingEvidence(owner, { findingId: fRich.id, artifactId: art1.id, relation: "contradicts" }));
  const [fOrig] = await both(s, (v) => v.addFinding(owner, { workspaceId: W, summary: "orig", detail: "old" }) as Promise<{ id: string }>);
  const [corrected] = await both(s, (v) =>
    v.correctFinding(owner, { findingId: fOrig.id, summary: "fixed", reason: "r", evidence: [{ artifactId: art1.id, relation: "supports" }] }) as Promise<{ id: string }>,
  );
  const [fWith] = await both(s, (v) => v.addFinding(owner, { workspaceId: W, summary: "to withdraw" }) as Promise<{ id: string }>);
  await both(s, (v) => v.withdrawFinding(owner, { findingId: fWith.id, reason: "wrong" }));

  // Decisions: proposed, accepted, accepted+citations+needs-review, superseded (retired and replaced).
  const [dProp] = await both(s, (v) => v.addDecision(owner, { workspaceId: W, summary: "proposed", rationale: "why" }) as Promise<{ id: string }>);
  const [dAcc] = await both(s, (v) => v.addDecision(owner, { workspaceId: W, summary: "accepted" }) as Promise<{ id: string }>);
  await both(s, (v) => v.citeDecisionBasis(owner, { decisionId: dAcc.id, findingId: fPlain.id, note: "basis" }));
  await both(s, (v) => v.acceptDecision(owner, dAcc.id));
  const [dRev] = await both(s, (v) => v.addDecision(owner, { workspaceId: W, summary: "review me" }) as Promise<{ id: string }>);
  await both(s, (v) => v.citeDecisionBasis(owner, { decisionId: dRev.id, findingId: fWith.id }));
  await both(s, (v) => v.citeDecisionBasis(owner, { decisionId: dRev.id, findingId: fOrig.id, note: "stale" }));
  await both(s, (v) => v.acceptDecision(owner, dRev.id));
  const [dOld] = await both(s, (v) => v.addDecision(owner, { workspaceId: W, summary: "old" }) as Promise<{ id: string }>);
  await both(s, (v) => v.acceptDecision(owner, dOld.id));
  const [dNew] = await both(s, (v) => v.addDecision(owner, { workspaceId: W, summary: "new", replacesDecisionId: dOld.id }) as Promise<{ id: string }>);
  await both(s, (v) => v.acceptDecision(owner, dNew.id, { reason: "replace" }));
  const [dRet] = await both(s, (v) => v.addDecision(owner, { workspaceId: W, summary: "to retire" }) as Promise<{ id: string }>);
  await both(s, (v) => v.acceptDecision(owner, dRet.id));
  await both(s, (v) => v.retireDecision(owner, { decisionId: dRet.id, reason: "no" }));

  for (const id of taskIds) record(`task:${id}`, await both(s, (v) => v.getTaskInWorkspace(owner, W, id)));
  for (const [k, id] of Object.entries({ plain: fPlain.id, rich: fRich.id, orig: fOrig.id, corrected: corrected.id, withdrawn: fWith.id })) {
    record(`finding:${k}`, await both(s, (v) => v.getFindingInWorkspace(owner, W, id)));
  }
  for (const [k, id] of Object.entries({ proposed: dProp.id, accepted: dAcc.id, review: dRev.id, old: dOld.id, new: dNew.id, retired: dRet.id })) {
    record(`decision:${k}`, await both(s, (v) => v.getDecisionInWorkspace(owner, W, id)));
  }
  for (const [k, id] of Object.entries({ withMeta: art1.id, bare: art2.id })) {
    record(`artifact:${k}`, await both(s, (v) => v.getArtifactInWorkspace(owner, W, id)));
  }
  // Paged / truncated / filtered lists.
  const first = await both(s, (v) => v.listTasksPage(owner, { workspaceId: W, limit: 2 }) as Promise<{ nextCursor?: string }>);
  record("list:p1", first);
  record("list:p2", [
    s.sync.listTasksPage(owner, { workspaceId: W, limit: 2, cursor: first[0].nextCursor! }),
    await s.async_.listTasksPage(owner, { workspaceId: W, limit: 2, cursor: first[1].nextCursor! }),
  ]);
  record("list:default", await both(s, (v) => v.listTasksPage(owner, { workspaceId: W })));
  record("list:blocked", await both(s, (v) => v.listTasksPage(owner, { workspaceId: W, status: "blocked" })));
  record("list:empty", await both(s, (v) => v.listTasksPage(owner, { workspaceId: W, status: "in_progress" })));
  return out;
}

function toolFor(key: string): ToolName {
  const kind = key.split(":")[0]!;
  return kind === "list" ? "list_tasks" : (`get_${kind}` as ToolName);
}

describe("live SQLite and D1 outputs", () => {
  it("validate against the declared schemas, have no nulls, and agree on shape", async () => {
    const out = await seeded();
    const keys = Object.keys(out);
    for (const kind of ["task", "finding", "decision", "artifact", "list"]) {
      expect(keys.some((k) => k.startsWith(`${kind}:`)), kind).toBe(true);
    }
    for (const [key, { sqlite, d1 }] of Object.entries(out)) {
      const tool = toolFor(key);
      expectValid(tool, sqlite, `${key} sqlite`);
      expectValid(tool, d1, `${key} d1`);
      // metadata is a free-form record that may legitimately hold nulls; everything else must be null-free.
      const { metadata: _m1, ...sqliteRest } = sqlite as Record<string, unknown>;
      const { metadata: _m2, ...d1Rest } = d1 as Record<string, unknown>;
      expect(hasNull(sqliteRest), `${key} sqlite has null`).toBe(false);
      expect(hasNull(d1Rest), `${key} d1 has null`).toBe(false);
      // Same key presence on both stores (values differ only by clock/ids drawn independently).
      expect(Object.keys(d1 as object).sort(), `${key} key set`).toEqual(Object.keys(sqlite as object).sort());
    }
    // Coverage of the interesting cases.
    const dec = (k: string) => out[`decision:${k}`]!.sqlite as Record<string, unknown>;
    const fin = (k: string) => out[`finding:${k}`]!.sqlite as Record<string, unknown>;
    expect(dec("review").needsReview).toBe(true);
    expect(Array.isArray(dec("accepted").citations)).toBe(true);
    expect(dec("old").status).toBe("superseded");
    expect(dec("retired").status).toBe("superseded");
    expect(fin("orig").currentness).toBe("superseded");
    expect(fin("withdrawn").currentness).toBe("withdrawn");
    expect(fin("plain").currentness).toBe("current");
    expect(fin("rich").evidence).toHaveLength(2);
    expect((out["artifact:withMeta"]!.d1 as { metadata: unknown }).metadata).toEqual({ n: 1, nested: { x: [1, "a", null] }, s: "é" });
    expect("metadata" in (out["artifact:bare"]!.sqlite as object)).toBe(false);
    const p1 = out["list:p1"]!.sqlite as { truncated: boolean; nextCursor?: string; total: number; returned: number };
    expect(p1.truncated).toBe(true);
    expect(p1.nextCursor).toBeTypeOf("string");
    expect(p1.total).toBeGreaterThan(p1.returned);
  });
});
