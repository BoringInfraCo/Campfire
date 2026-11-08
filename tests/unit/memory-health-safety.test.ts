/**
 * MEM-001 D2 mutation tests, D5/e byte-budget trimming, and D7 static
 * inference-absence checks over the pure projection.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ValidationError } from "../../src/domain/errors.js";
import {
  MEMORY_HEALTH_REASONS,
  deriveMemoryHealthCues,
  pageMemoryHealth,
  type MemoryHealthReason,
  type MemoryHealthRows,
} from "../../src/domain/memory-health.js";

const T1 = "2026-01-01T00:00:01.000Z";
const T2 = "2026-01-01T00:00:02.000Z";

function baseRows(): MemoryHealthRows {
  return {
    decisions: [
      {
        id: "dec_1",
        status: "accepted",
        createdAt: T1,
        updatedAt: T2,
        citations: [
          { id: "cit_1", findingId: "fnd_1", createdAt: T1, findingCurrentness: "withdrawn", findingCreatedAt: T1, findingCorrectedAt: T2 },
        ],
      },
    ],
    findings: [
      {
        id: "fnd_2",
        currentness: "current",
        createdAt: T1,
        evidence: [{ id: "evd_1", artifactId: "art_1", relation: "contradicts", createdAt: T1, artifactCreatedAt: T1 }],
      },
    ],
    tasks: [{ id: "tsk_1", status: "blocked", description: null, assigneeId: null, createdAt: T1, updatedAt: T2 }],
    proposals: [
      {
        id: "apr_1",
        status: "submission_unknown",
        revision: 3,
        taskId: "tsk_9",
        reservationId: "res_1",
        createdAt: T1,
        updatedAt: T2,
        receipts: [{ id: "arcp_1", outcome: "unknown", recordedAt: T2 }],
      },
    ],
  };
}

function reasons(rows: MemoryHealthRows): MemoryHealthReason[] {
  return deriveMemoryHealthCues(rows, MEMORY_HEALTH_REASONS).map((cue) => cue.reason);
}

function mutate(fn: (rows: MemoryHealthRows) => void): MemoryHealthReason[] {
  const rows = structuredClone(baseRows()) as {
    -readonly [K in keyof MemoryHealthRows]: MemoryHealthRows[K] extends readonly (infer U)[] ? U[] : never;
  };
  fn(rows as unknown as MemoryHealthRows);
  return reasons(rows as unknown as MemoryHealthRows);
}

const ALL = [...MEMORY_HEALTH_REASONS];
const without = (reason: MemoryHealthReason) => ALL.filter((r) => r !== reason);

describe("MEM-001 D2 mutation tests: each source condition gates its rule", () => {
  it("baseline yields exactly one cue per rule", () => {
    expect(reasons(baseRows()).sort()).toEqual([...ALL].sort());
  });

  it.each(["proposed", "superseded", "retired", "rejected", "Accepted", "bogus", ""])(
    "decision status %j removes the decision cue",
    (status) => {
      expect(mutate((r) => { (r.decisions[0] as { status: string }).status = status; }).sort()).toEqual(
        without("accepted_decision_needs_review").sort(),
      );
    },
  );

  it.each(["current", "Withdrawn", "bogus", ""])("cited finding currentness %j removes the decision cue", (value) => {
    expect(mutate((r) => { (r.decisions[0]!.citations[0] as { findingCurrentness: string }).findingCurrentness = value; }).sort()).toEqual(
      without("accepted_decision_needs_review").sort(),
    );
  });

  it("superseded citation currentness still produces the cue; a decision without citations produces none", () => {
    const rows = baseRows();
    (rows.decisions[0]!.citations[0] as { findingCurrentness: string }).findingCurrentness = "superseded";
    expect(deriveMemoryHealthCues(rows, MEMORY_HEALTH_REASONS).find((c) => c.reason === "accepted_decision_needs_review")?.sourceFacts).toMatchObject({
      findingCurrentness: "superseded",
    });
    expect(mutate((r) => { (r.decisions[0] as { citations: unknown[] }).citations = []; })).not.toContain("accepted_decision_needs_review");
  });

  it.each(["superseded", "withdrawn", "Current", "bogus", ""])("finding currentness %j removes the contradiction cue", (value) => {
    expect(mutate((r) => { (r.findings[0] as { currentness: string }).currentness = value; }).sort()).toEqual(
      without("current_finding_has_contradicting_evidence").sort(),
    );
  });

  it.each(["supports", "Contradicts", "contradicts ", "bogus", ""])("evidence relation %j removes the contradiction cue", (value) => {
    expect(mutate((r) => { (r.findings[0]!.evidence[0] as { relation: string }).relation = value; }).sort()).toEqual(
      without("current_finding_has_contradicting_evidence").sort(),
    );
  });

  it.each(["open", "in_progress", "done", "Blocked", "bogus", ""])("task status %j removes the blocked cue", (value) => {
    expect(mutate((r) => { (r.tasks[0] as { status: string }).status = value; }).sort()).toEqual(
      without("blocked_task_missing_context").sort(),
    );
  });

  it.each([
    ["non-empty description", { description: "why" }],
    ["description with outer whitespace", { description: "  why  " }],
    ["assignee", { assigneeId: "hum_1" }],
    ["both", { description: "why", assigneeId: "hum_1" }],
  ])("blocked task with %s produces no cue", (_label, patch) => {
    expect(mutate((r) => { Object.assign(r.tasks[0]!, patch); }).sort()).toEqual(without("blocked_task_missing_context").sort());
  });

  it.each([
    ["undefined description", { description: undefined }],
    ["null description", { description: null }],
    ["empty description", { description: "" }],
    ["whitespace description", { description: " \t\n " }],
    ["empty assignee", { assigneeId: "" }],
    ["undefined assignee", { assigneeId: undefined }],
  ])("blocked task with %s still produces the cue", (_label, patch) => {
    expect(mutate((r) => { Object.assign(r.tasks[0]!, patch); }).sort()).toEqual([...ALL].sort());
  });

  it.each(["proposed", "approved", "dispatch_reserved", "submission_accepted", "submission_failed", "cancelled", "Submission_Unknown", "bogus", ""])(
    "proposal status %j removes the action cue",
    (status) => {
      expect(mutate((r) => { (r.proposals[0] as { status: string }).status = status; }).sort()).toEqual(
        without("action_outcome_unknown").sort(),
      );
    },
  );

  it.each(["accepted", "definite_failure", "reconciled_accepted", "reconciled_failure", "UNKNOWN", "bogus", ""])(
    "receipt outcome %j removes the action cue",
    (outcome) => {
      expect(mutate((r) => { (r.proposals[0]!.receipts[0] as { outcome: string }).outcome = outcome; }).sort()).toEqual(
        without("action_outcome_unknown").sort(),
      );
    },
  );

  it("a proposal with no receipts produces no cue, and two unknown receipts produce two distinct cues", () => {
    expect(mutate((r) => { (r.proposals[0] as { receipts: unknown[] }).receipts = []; })).not.toContain("action_outcome_unknown");
    const rows = baseRows();
    (rows.proposals[0] as { receipts: Array<{ id: string; outcome: string; recordedAt: string }> }).receipts.push({
      id: "arcp_2", outcome: "unknown", recordedAt: T2,
    });
    const cues = deriveMemoryHealthCues(rows, MEMORY_HEALTH_REASONS).filter((c) => c.reason === "action_outcome_unknown");
    expect(cues.map((c) => c.id).length).toBe(2);
    expect(new Set(cues.map((c) => c.id)).size).toBe(2);
  });

  it("cross-rule isolation: a mutation never creates a cue for a different rule", () => {
    const rows = baseRows();
    (rows.tasks[0] as { status: string }).status = "done";
    (rows.findings[0] as { currentness: string }).currentness = "superseded";
    expect(reasons(rows).sort()).toEqual(["accepted_decision_needs_review", "action_outcome_unknown"]);
  });
});

describe("MEM-001 D2 fail-closed: non-allowlisted fields and invalid timestamps", () => {
  const SECRET = "SENTINEL_NON_ALLOWLISTED_f1";
  const EXTRA = {
    title: SECRET, summary: SECRET, rationale: SECRET, note: SECRET, uri: SECRET, uriOrPath: SECRET,
    reason: SECRET, detail: SECRET, metadata: { x: SECRET }, token: SECRET, tokenHash: SECRET, providerRef: SECRET,
  };

  it("extra properties on every source row never reach the serialized result", () => {
    const rows = baseRows();
    Object.assign(rows.decisions[0]!, EXTRA);
    Object.assign(rows.decisions[0]!.citations[0]!, EXTRA);
    Object.assign(rows.findings[0]!, EXTRA);
    Object.assign(rows.findings[0]!.evidence[0]!, EXTRA);
    Object.assign(rows.tasks[0]!, { ...EXTRA, description: "  " });
    Object.assign(rows.proposals[0]!, EXTRA);
    Object.assign(rows.proposals[0]!.receipts[0]!, EXTRA);
    const result = pageMemoryHealth({
      rows, supportedReasons: MEMORY_HEALTH_REASONS, workspaceId: "ws_1", actorType: "human", actorId: "hum_1",
      role: "owner", observedAt: T2, orientationCursor: "oc", contributionTip: 4, limit: 2,
    });
    expect(result.cues.length).toBe(2);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    const all = deriveMemoryHealthCues(rows, MEMORY_HEALTH_REASONS);
    expect(JSON.stringify(all)).not.toContain(SECRET);
  });

  it("emits exactly the frozen key set per reason and no other keys", () => {
    const keys: Record<MemoryHealthReason, { cue: string[]; facts: string[] }> = {
      action_outcome_unknown: {
        cue: ["createdAt", "id", "reason", "relatedRecordIds", "sourceFacts", "sourceUpdateTime", "subjectId", "subjectType", "summary", "updatedAt"],
        facts: ["proposalRevision", "proposalStatus", "reservationId", "taskId", "unknownReceiptId", "unknownReceiptOutcome"],
      },
      accepted_decision_needs_review: {
        cue: ["createdAt", "id", "reason", "relatedRecordIds", "sourceFacts", "sourceUpdateTime", "subjectId", "subjectType", "summary", "updatedAt"],
        facts: ["citationId", "decisionStatus", "findingCurrentness", "findingId"],
      },
      current_finding_has_contradicting_evidence: {
        cue: ["createdAt", "id", "reason", "relatedRecordIds", "sourceFacts", "sourceUpdateTime", "subjectId", "subjectType", "summary"],
        facts: ["artifactId", "evidenceId", "findingCurrentness", "relation"],
      },
      blocked_task_missing_context: {
        cue: ["createdAt", "id", "reason", "relatedRecordIds", "sourceFacts", "sourceUpdateTime", "subjectId", "subjectType", "summary", "updatedAt"],
        facts: ["hasAssignee", "hasDescription", "taskStatus"],
      },
    };
    const rows = baseRows();
    Object.assign(rows.tasks[0]!, EXTRA);
    Object.assign(rows.decisions[0]!, EXTRA);
    for (const cue of deriveMemoryHealthCues(rows, MEMORY_HEALTH_REASONS)) {
      expect(Object.keys(cue).sort()).toEqual(keys[cue.reason].cue);
      expect(Object.keys(cue.sourceFacts).sort()).toEqual(keys[cue.reason].facts);
    }
  });

  it.each([
    ["decision.updatedAt", (r: MemoryHealthRows) => { (r.decisions[0] as { updatedAt: string }).updatedAt = "not-a-date"; }],
    ["citation.createdAt", (r: MemoryHealthRows) => { (r.decisions[0]!.citations[0] as { createdAt: string }).createdAt = "2026-01-01 00:00:00"; }],
    ["evidence.artifactCreatedAt", (r: MemoryHealthRows) => { (r.findings[0]!.evidence[0] as { artifactCreatedAt: string }).artifactCreatedAt = "2026-01-01T00:00:01+02:00"; }],
    ["task.updatedAt", (r: MemoryHealthRows) => { (r.tasks[0] as { updatedAt: string }).updatedAt = ""; }],
    ["receipt.recordedAt", (r: MemoryHealthRows) => { (r.proposals[0]!.receipts[0] as { recordedAt: string }).recordedAt = "2026-13-45T00:00:00.000Z"; }],
  ])("a non-canonical %s fails closed with ValidationError instead of emitting a cue", (_label, fn) => {
    const rows = structuredClone(baseRows());
    fn(rows);
    expect(() => deriveMemoryHealthCues(rows, MEMORY_HEALTH_REASONS)).toThrow(ValidationError);
  });

  it("a timestamp in a non-matching row is never inspected (no cue, no throw)", () => {
    const rows = structuredClone(baseRows());
    (rows.tasks[0] as { status: string }).status = "done";
    (rows.tasks[0] as { updatedAt: string }).updatedAt = "garbage";
    expect(() => deriveMemoryHealthCues(rows, MEMORY_HEALTH_REASONS)).not.toThrow();
  });
});

describe("MEM-001 byte-budget trimming (D5/e)", () => {
  function manyBlocked(count: number): MemoryHealthRows {
    return {
      decisions: [], findings: [], proposals: [],
      tasks: Array.from({ length: count }, (_, i) => ({
        id: `tsk_${String(i).padStart(3, "0")}`, status: "blocked", description: null, assigneeId: null,
        createdAt: T1, updatedAt: `2026-01-01T00:00:${String(10 + i).padStart(2, "0")}.000Z`,
      })),
    };
  }
  const common = {
    supportedReasons: MEMORY_HEALTH_REASONS, workspaceId: "ws_1", actorType: "human" as const, actorId: "hum_1",
    role: "owner", observedAt: T2, orientationCursor: "oc", contributionTip: 7,
  };
  const size = (cues: unknown) => Buffer.byteLength(JSON.stringify(cues), "utf8");

  it("returns a shorter page and a normal nextCursor without altering total, then continues without loss", () => {
    const rows = manyBlocked(10);
    const full = pageMemoryHealth({ ...common, rows, limit: 10 });
    expect(full.cues.length).toBe(10);
    const budget = size(full.cues.slice(0, 3));
    const first = pageMemoryHealth({ ...common, rows, limit: 10, byteBudget: budget });
    expect(first.cues.length).toBe(3);
    expect(first.coverage).toEqual({ rulesEvaluated: [...MEMORY_HEALTH_REASONS], total: 10, returned: 3, truncated: true });
    expect(first.nextCursor).toBeDefined();
    expect(size(first.cues)).toBeLessThanOrEqual(budget);

    const seen = [...first.cues.map((c) => c.id)];
    let cursor = first.nextCursor;
    let pages = 1;
    while (cursor !== undefined) {
      const page = pageMemoryHealth({ ...common, rows, limit: 10, byteBudget: budget, cursor });
      expect(page.coverage.total).toBe(10);
      expect(page.coverage.returned).toBe(page.cues.length);
      expect(page.coverage.truncated).toBe(page.nextCursor !== undefined);
      expect(page.observedAt).toBe(first.observedAt);
      seen.push(...page.cues.map((c) => c.id));
      cursor = page.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(20);
    }
    expect(seen).toEqual(full.cues.map((c) => c.id));
    expect(pages).toBe(4);
  });

  it("an exact-fit budget returns the whole page with no cursor", () => {
    const rows = manyBlocked(4);
    const full = pageMemoryHealth({ ...common, rows });
    const exact = pageMemoryHealth({ ...common, rows, byteBudget: size(full.cues) });
    expect(exact.cues.length).toBe(4);
    expect(exact.coverage.truncated).toBe(false);
    expect(exact.nextCursor).toBeUndefined();
    const oneShort = pageMemoryHealth({ ...common, rows, byteBudget: size(full.cues) - 1 });
    expect(oneShort.cues.length).toBe(3);
    expect(oneShort.coverage).toMatchObject({ total: 4, returned: 3, truncated: true });
    expect(oneShort.nextCursor).toBeDefined();
  });

  it("a single cue larger than the budget is a ValidationError, never a dropped cue", () => {
    const rows = manyBlocked(2);
    expect(() => pageMemoryHealth({ ...common, rows, byteBudget: 10 })).toThrow(ValidationError);
    try {
      pageMemoryHealth({ ...common, rows, byteBudget: 10 });
    } catch (error) {
      expect((error as ValidationError).details).toMatchObject({ field: "byteBudget" });
    }
  });
});

describe("MEM-001 D7 static inference absence", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, "../..");
  const files = [
    "src/domain/memory-health.ts",
    "src/service/memory-health-read.ts",
    "src/store/memory-health-queries.ts",
  ];
  const FORBIDDEN_MODULES = /^(node:)?(fs|fs\/promises|net|http|https|http2|dgram|dns|tls|child_process|worker_threads|os|path|url|crypto|zlib)$|^(openai|@anthropic-ai\/.*|@ai-sdk\/.*|ai|undici|node-fetch|axios|got|ws)$/;

  function importSpecs(source: string): string[] {
    const specs: string[] = [];
    for (const match of source.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g)) specs.push(match[1]!);
    for (const match of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) specs.push(match[1]!);
    for (const match of source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) specs.push(match[1]!);
    return specs;
  }

  it.each(files)("%s imports no network, model, filesystem, process, or clock module", (file) => {
    const source = readFileSync(resolve(root, file), "utf8");
    const specs = importSpecs(source);
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      expect(FORBIDDEN_MODULES.test(spec), `${file} imports ${spec}`).toBe(false);
      expect(spec.startsWith("."), `${file} imports non-relative ${spec}`).toBe(true);
    }
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const banned of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /\bEventSource\b/, /process\.(env|stdout|stderr|argv)/, /console\./, /Math\.random/, /Date\.now\s*\(/, /new Date\s*\(\s*\)/, /\.ai\.run|embedding|Embedding|anthropic|openai/i]) {
      expect(banned.test(code), `${file} matches ${banned}`).toBe(false);
    }
  });

  it("the relative import closure of the memory-health sources reaches no network/model/fs module", () => {
    const seen = new Set<string>();
    const queue = files.map((f) => resolve(root, f));
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      for (const spec of importSpecs(source)) {
        if (spec.startsWith(".")) {
          queue.push(resolve(dirname(file), spec.replace(/\.js$/, ".ts")));
        } else {
          expect(FORBIDDEN_MODULES.test(spec), `${file} imports ${spec}`).toBe(false);
        }
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });
});
