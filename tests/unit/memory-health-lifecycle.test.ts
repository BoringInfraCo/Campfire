/**
 * MEM-001 D3 (lifecycle safety and safe resolution) and the service-level part
 * of D7 (no free text in results, errors, or logs) on the SQLite service.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Conflict, ValidationError } from "../../src/domain/errors.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { MH_EXEC, MH_OWNER, SENTINELS, mhOwner, seedMemoryHealth, type SeededMemory } from "../helpers/mem-health-seed.js";
import type { CampfireService } from "../../src/service/service.js";

let store: CampfireStore;
let service: CampfireService;
let s: SeededMemory;

beforeEach(() => {
  store = openInMemoryStore();
  const seeded = seedMemoryHealth(store);
  service = seeded.service;
  s = seeded.seeded;
});
afterEach(() => {
  service.close();
  vi.restoreAllMocks();
});

function health(extra: { reason?: string; limit?: number; cursor?: string } = {}) {
  return service.getMemoryHealth(mhOwner, { workspaceId: s.workspaceId, ...extra });
}

/** Everything D3 says a read must not change. */
function canonicalSnapshot() {
  const ws = s.workspaceId;
  const findings = store.listFindings(ws);
  const decisions = store.listDecisions(ws);
  const proposal = store.getActionProposal(s.proposalId);
  return JSON.stringify({
    tasks: store.listTasks(ws),
    findings,
    evidence: store.listFindingEvidence(findings.map((f) => f.id)),
    decisions,
    citations: store.listDecisionCitations(decisions.map((d) => d.id)),
    artifacts: store.listArtifacts(ws),
    contributions: store.listContributions(ws),
    events: store.listDomainEventsForWorkspace(ws),
    proposal,
    receipt: store.getActionReceipt(s.unknownReceiptId),
    receiptCount: store.countActionReceipts(ws, s.proposalId),
  });
}

const reasonsOf = () => health().cues.map((c) => c.reason).sort();

describe("MEM-001 seeded fixture", () => {
  it("has the expected cues and ignores the near-miss blocked task with a description", () => {
    const result = health();
    // The accepted Decision cites a current Finding, so it is a clean control until the Finding changes.
    expect(result.cues.map((c) => c.reason)).toEqual([
      "action_outcome_unknown",
      "current_finding_has_contradicting_evidence",
      "blocked_task_missing_context",
    ]);
    expect(result.cues.some((c) => c.subjectId === s.describedBlockedTaskId)).toBe(false);
  });
});

describe("MEM-001 D3: reads change nothing and execute no resolution path", () => {
  it("repeated and paged reads leave every canonical record byte-identical", () => {
    // Make the decision cue exist too.
    service.withdrawFinding(mhOwner, { findingId: s.citedFindingId, reason: "r" });
    expect(reasonsOf()).toContain("accepted_decision_needs_review");
    const before = canonicalSnapshot();
    const first = health({ limit: 1 });
    health({ limit: 1, cursor: first.nextCursor! });
    health({ reason: "blocked_task_missing_context" });
    health();
    expect(canonicalSnapshot()).toBe(before);
  });

  it("never invokes a store method other than reads and the read transaction", () => {
    const calls: string[] = [];
    const spy = new Proxy(store, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function" || typeof prop !== "string") return value;
        return (...args: unknown[]) => {
          calls.push(prop);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const svc = createServiceFactory({ store: spy, clock: () => "2026-10-22T00:00:00.000Z" });
    const result = svc.getMemoryHealth(mhOwner, { workspaceId: s.workspaceId });
    expect(result.cues.length).toBeGreaterThan(0);
    const allowed = /^(get|list|count|read|has|find|transaction)/;
    const offenders = [...new Set(calls)].filter((name) => !allowed.test(name));
    expect(offenders).toEqual([]);
    expect(calls).toContain("readMemoryHealthSnapshot");
    for (const name of ["updateTask", "removeDecisionBasis", "removeFindingEvidence", "appendContribution", "createContribution", "createActionReceipt"]) {
      expect(calls).not.toContain(name);
    }
  });

  it("cue wording never claims truth, failure, success, retry, or lifecycle change", () => {
    service.withdrawFinding(mhOwner, { findingId: s.citedFindingId, reason: "r" });
    for (const cue of health().cues) {
      expect(cue.summary).not.toMatch(/\b(false|wrong|revoked|replaced|retired|succeeded|failed|automatically)\b/i);
    }
    const byReason = Object.fromEntries(health().cues.map((c) => [c.reason, c.summary]));
    expect(byReason["accepted_decision_needs_review"]).toContain("acceptance is unchanged");
    expect(byReason["current_finding_has_contradicting_evidence"]).toContain("remains current");
    expect(byReason["action_outcome_unknown"]).toContain("reconcile receipt");
    expect(byReason["action_outcome_unknown"]).toContain("before any retry");
  });
});

describe("MEM-001 D3: correcting or withdrawing a Finding leaves its DecisionCitation intact", () => {
  it("withdraw_finding keeps the citation, the accepted status, and the cue", () => {
    const citationBefore = JSON.stringify(store.getDecisionCitation(s.citationId));
    expect(health().cues.some((c) => c.reason === "accepted_decision_needs_review")).toBe(false);
    service.withdrawFinding(mhOwner, { findingId: s.citedFindingId, reason: SENTINELS.withdrawReason });
    expect(JSON.stringify(store.getDecisionCitation(s.citationId))).toBe(citationBefore);
    expect(store.getDecision(s.acceptedDecisionId)?.status).toBe("accepted");
    expect(store.getFinding(s.citedFindingId)?.currentness).toBe("withdrawn");
    const cue = health().cues.find((c) => c.reason === "accepted_decision_needs_review")!;
    expect(cue.sourceFacts).toEqual({
      decisionStatus: "accepted", citationId: s.citationId, findingId: s.citedFindingId, findingCurrentness: "withdrawn",
    });
    expect(cue.relatedRecordIds).toEqual([s.citationId, s.citedFindingId]);
  });

  it("correct_finding keeps the citation on the historical Finding and keeps the cue", () => {
    const citationBefore = JSON.stringify(store.getDecisionCitation(s.citationId));
    const corrected = service.correctFinding(mhOwner, { findingId: s.citedFindingId, summary: "replacement", reason: "typo" });
    expect(corrected.id).not.toBe(s.citedFindingId);
    expect(JSON.stringify(store.getDecisionCitation(s.citationId))).toBe(citationBefore);
    expect(store.getDecisionCitation(s.citationId)?.findingId).toBe(s.citedFindingId);
    expect(store.getDecision(s.acceptedDecisionId)?.status).toBe("accepted");
    const cue = health().cues.find((c) => c.reason === "accepted_decision_needs_review")!;
    expect(cue.sourceFacts).toMatchObject({ citationId: s.citationId, findingId: s.citedFindingId, findingCurrentness: "superseded" });
    // The replacement Finding is not cited, so only the historical citation matters.
    expect(health().cues.filter((c) => c.reason === "accepted_decision_needs_review").length).toBe(1);
  });

  it("withdrawing or correcting the contradicted Finding ends that cue but keeps the evidence row", () => {
    expect(reasonsOf()).toContain("current_finding_has_contradicting_evidence");
    service.withdrawFinding(mhOwner, { findingId: s.contradictedFindingId, reason: "r" });
    expect(reasonsOf()).not.toContain("current_finding_has_contradicting_evidence");
    expect(store.getFindingEvidence(s.evidenceId)).toBeDefined();
    expect(store.getArtifact(s.artifactId)).toBeDefined();
  });
});

describe("MEM-001 D3: existing mutations resolve each cue; the read never does", () => {
  it("remove_decision_basis resolves the decision cue without touching decision status", () => {
    service.withdrawFinding(mhOwner, { findingId: s.citedFindingId, reason: "r" });
    const cue = health().cues.find((c) => c.reason === "accepted_decision_needs_review")!;
    const citationId = (cue.sourceFacts as { citationId: string }).citationId;
    expect(citationId).toBe(s.citationId);
    // Reading again does not remove it.
    health();
    expect(reasonsOf()).toContain("accepted_decision_needs_review");
    service.removeDecisionBasis(mhOwner, { citationId });
    expect(reasonsOf()).not.toContain("accepted_decision_needs_review");
    expect(store.getDecision(s.acceptedDecisionId)?.status).toBe("accepted");
    expect(store.getFinding(s.citedFindingId)?.currentness).toBe("withdrawn");
  });

  it("retire_decision also ends the decision cue (status leaves accepted)", () => {
    service.withdrawFinding(mhOwner, { findingId: s.citedFindingId, reason: "r" });
    service.retireDecision(mhOwner, { decisionId: s.acceptedDecisionId, reason: "r" });
    expect(reasonsOf()).not.toContain("accepted_decision_needs_review");
  });

  it("remove_finding_evidence resolves the contradiction cue without deleting the Artifact or changing currentness", () => {
    const cue = health().cues.find((c) => c.reason === "current_finding_has_contradicting_evidence")!;
    const evidenceId = (cue.sourceFacts as { evidenceId: string }).evidenceId;
    expect(evidenceId).toBe(s.evidenceId);
    health();
    expect(reasonsOf()).toContain("current_finding_has_contradicting_evidence");
    service.removeFindingEvidence(mhOwner, { evidenceId });
    expect(reasonsOf()).not.toContain("current_finding_has_contradicting_evidence");
    expect(store.getArtifact(s.artifactId)).toBeDefined();
    expect(store.getFinding(s.contradictedFindingId)?.currentness).toBe("current");
  });

  it("update_task with a description or an assignee ends the blocked cue without changing status", () => {
    const cue = health().cues.find((c) => c.reason === "blocked_task_missing_context")!;
    expect(cue.subjectId).toBe(s.blockedTaskId);
    service.updateTask(mhOwner, { taskId: s.blockedTaskId, description: "waiting on infra" });
    expect(reasonsOf()).not.toContain("blocked_task_missing_context");
    expect(store.getTask(s.blockedTaskId)?.status).toBe("blocked");
    service.updateTask(mhOwner, { taskId: s.blockedTaskId, description: "   " });
    // Whitespace-only overwrite (if accepted) re-opens the cue; assignee also closes it.
    service.updateTask(mhOwner, { taskId: s.blockedTaskId, assignee: MH_EXEC });
    expect(reasonsOf()).not.toContain("blocked_task_missing_context");
    expect(store.getTask(s.blockedTaskId)?.status).toBe("blocked");
  });

  it("record_action_outcome reconciled_* resolves the action cue and keeps the original unknown receipt", () => {
    const cue = health().cues.find((c) => c.reason === "action_outcome_unknown")!;
    expect(cue.relatedRecordIds[1]).toBe(s.unknownReceiptId);
    const proposal = store.getActionProposal(s.proposalId)!;
    service.record_action_outcome({ actor: MH_EXEC }, {
      workspaceId: s.workspaceId,
      proposalId: s.proposalId,
      revision: proposal.revision,
      intentDigest: proposal.intentDigest,
      outcome: "reconciled_failure",
      resolvesReceiptId: s.unknownReceiptId,
      providerRef: { repositoryId: "123", workflowId: "456", runId: "789" },
      requestKey: "k5",
    } as never);
    expect(reasonsOf()).not.toContain("action_outcome_unknown");
    expect(store.getActionReceipt(s.unknownReceiptId)?.outcome).toBe("unknown");
  });
});

describe("MEM-001 D7: sentinel free text never appears in results, errors, or logs", () => {
  const sentinels = Object.values(SENTINELS);
  const forbiddenExtras = ["acme/api", "sentinel-a8.example", "intentDigest"];

  function assertClean(label: string, text: string) {
    for (const value of [...sentinels, ...forbiddenExtras]) {
      expect(text.includes(value), `${label} leaks ${value}`).toBe(false);
    }
  }

  it("serialized results (all reasons, filters, pages) carry no sentinel text", () => {
    service.withdrawFinding(mhOwner, { findingId: s.citedFindingId, reason: SENTINELS.withdrawReason });
    const results = [health(), health({ limit: 1 }), ...MH_REASON_LIST.map((reason) => health({ reason }))];
    results.push(health({ limit: 1, cursor: results[1]!.nextCursor! }));
    expect(results.every((r) => r.coverage.total >= 0)).toBe(true);
    for (const result of results) assertClean("result", JSON.stringify(result));
    // The cursor is opaque but decodable: it must hold no free text either.
    const cursor = results[1]!.nextCursor!;
    assertClean("cursor", Buffer.from(cursor.slice("mh1.".length), "base64url").toString("utf8"));
    expect(cursor).not.toMatch(/token|secret|password/i);
  });

  it("errors (validation, stale cursor, auth) carry no sentinel text or decoded cursor state", () => {
    const first = health({ limit: 1 });
    service.createTask(mhOwner, { workspaceId: s.workspaceId, title: SENTINELS.taskTitle });
    const failures: unknown[] = [];
    const attempt = (fn: () => unknown) => {
      try { fn(); } catch (error) { failures.push(error); }
    };
    attempt(() => health({ limit: 1, cursor: first.nextCursor! }));
    attempt(() => health({ cursor: "mh1.not-base64-json" }));
    attempt(() => health({ reason: SENTINELS.rationale }));
    attempt(() => health({ limit: 0 }));
    attempt(() => service.getMemoryHealth({ actor: { actorId: "hum_outsider", actorType: "human" } }, { workspaceId: s.workspaceId, cursor: first.nextCursor! }));
    expect(failures.length).toBe(5);
    expect(failures[0]).toBeInstanceOf(Conflict);
    expect(failures[1]).toBeInstanceOf(ValidationError);
    for (const error of failures) {
      const e = error as Error & { details?: unknown };
      const text = JSON.stringify({ name: e.name, message: e.message, details: e.details, stack: undefined });
      // The reason-filter error may echo nothing of the rejected input.
      assertClean("error", text);
      expect(text).not.toContain(Buffer.from(first.nextCursor!.slice(4), "base64url").toString("utf8"));
    }
    // The stale-cursor conflict returns nothing but the typed recovery information.
    expect((failures[0] as Conflict).details).toEqual({
      recoveryCode: "memory_health_stale_cursor", field: "cursor", nextAction: "restart_without_cursor",
    });
  });

  it("the only log output of a read is the pre-existing authz audit line, with ids only", () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); return true as never; };
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
    vi.spyOn(console, "warn").mockImplementation(capture);
    vi.spyOn(console, "info").mockImplementation(capture);
    vi.spyOn(console, "debug").mockImplementation(capture);
    vi.spyOn(process.stdout, "write").mockImplementation(capture);
    vi.spyOn(process.stderr, "write").mockImplementation(capture);
    health();
    health({ limit: 1 });
    try { health({ reason: "bogus" }); } catch { /* expected */ }
    const records = lines.join("").split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(records.length).toBe(3);
    for (const record of records) {
      expect(record.event).toBe("authz");
      expect(record.operation).toBe("workspace:read");
      expect(Object.keys(record).sort()).toEqual(["actorId", "allow", "event", "operation", "workspaceId"]);
    }
    assertClean("log", lines.join(""));
  });

  it("owner identity is unused: MH_OWNER constant is the actor, no token material exists in cues", () => {
    expect(JSON.stringify(health())).not.toContain(MH_OWNER.actorId + "_token");
    expect(JSON.stringify(health())).not.toMatch(/token|hash|secret|password|bearer/i);
  });
});

const MH_REASON_LIST = [
  "action_outcome_unknown",
  "accepted_decision_needs_review",
  "current_finding_has_contradicting_evidence",
  "blocked_task_missing_context",
] as const;

import { createCampfireService as createServiceFactory } from "../../src/service/campfire-service.js";
