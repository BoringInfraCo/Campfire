/**
 * COR-001 correct the record.
 * Deterministic service evidence. This file does not claim a live harness trace.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CAMPFIRE_EVENT_TYPES } from "../../src/domain/events.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import {
  Conflict,
  CrossWorkspaceReference,
  FindingNotFound,
  InvalidTransition,
  Unauthorized,
  ValidationError,
} from "../../src/domain/errors.js";
import type { ActorRef, ParticipantRole } from "../../src/domain/types.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import { openInMemoryStore, openSqliteStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { createD1Store, migrateD1 } from "../../src/worker/d1-store.js";
import { createAsyncCampfireService } from "../../src/worker/async-service.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";

const NOW = "2026-01-01T00:00:00.000Z";
const HUMAN1: ActorRef = { actorId: "hum_1", actorType: "human" };
const HUMAN2: ActorRef = { actorId: "hum_2", actorType: "human" };
const HUMAN3: ActorRef = { actorId: "hum_3", actorType: "human" };
const AGENT1: ActorRef = { actorId: "agt_1", actorType: "agent" };
const ctxHuman1: ActorContext = { actor: HUMAN1 };
const ctxHuman2: ActorContext = { actor: HUMAN2 };
const ctxHuman3: ActorContext = { actor: HUMAN3 };
const ctxAgent1: ActorContext = { actor: AGENT1 };

function createClock(startMs = Date.parse(NOW)) {
  let current = startMs;
  const tick = (): string => {
    current += 1000;
    return new Date(current).toISOString();
  };
  return { tick };
}

let store: CampfireStore;
let service: CampfireService;

beforeEach(() => {
  store = openInMemoryStore();
  service = createCampfireService({ store, idSource: createCounterIdSource(), clock: createClock().tick });
  store.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: NOW });
  store.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: NOW });
  store.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
  store.createHuman({ id: "hum_2", teamId: "team_1", displayName: "Grace", createdAt: NOW });
  store.createHuman({ id: "hum_3", teamId: "team_1", displayName: "Outsider", createdAt: NOW });
  store.createAgent({
    id: "agt_1",
    teamId: "team_1",
    humanId: "hum_1",
    name: "Codex",
    harness: "codex",
    createdAt: NOW,
  });
});

afterEach(() => {
  service.close();
});

function enroll(actor: ActorContext, workspaceId: string, role: ParticipantRole): void {
  service.inviteToWorkspace(ctxHuman1, { workspaceId, actor: actor.actor, role });
  service.joinWorkspace(actor, { workspaceId });
}

function workspaceNamed(name: string): string {
  return service.createWorkspace(ctxHuman1, { teamId: "team_1", name }).id;
}

function eventTypes(workspaceId: string): string[] {
  return store.listDomainEventsForWorkspace(workspaceId).map((event) => event.type);
}

describe("COR-001 correct the record", () => {
  it("keeps the old finding text and links the replacement one step", () => {
    const workspaceId = workspaceNamed("Incident");
    enroll(ctxHuman2, workspaceId, "member");
    const log = service.addArtifact(ctxHuman1, {
      workspaceId,
      type: "log",
      title: "boot log",
      uriOrPath: "boot.log",
    });
    const original = service.addFinding(ctxHuman1, {
      workspaceId,
      summary: "disk is full",
      detail: "original detail",
      sourceArtifactId: log.id,
    });
    const evidence = service.citeFindingEvidence(ctxHuman1, {
      findingId: original.id,
      artifactId: log.id,
      relation: "supports",
      note: "df output",
    });

    const cursor = service.getWorkspaceContext(ctxHuman2, workspaceId).orientationCursor;
    const replacement = service.correctFinding(ctxHuman2, {
      findingId: original.id,
      summary: "disk has free space",
      detail: "corrected detail",
      reason: "measured again",
      evidence: [{ artifactId: log.id, relation: "contradicts", note: "second sample" }],
    });

    const historical = service.getFindingInWorkspace(ctxHuman2, workspaceId, original.id);
    expect(historical.summary).toBe("disk is full");
    expect(historical.detail).toBe("original detail");
    expect(historical.sourceArtifactId).toBe(log.id);
    expect(historical.currentness).toBe("superseded");
    expect(historical.correctionReason).toBe("measured again");
    expect(historical.successorId).toBe(replacement.id);
    expect(historical.correctedBy).toEqual(HUMAN2);
    expect(historical.evidence?.map((row) => row.id)).toEqual([evidence.id]);
    expect(replacement.predecessorId).toBe(original.id);
    expect(replacement.currentness).toBe("current");
    expect(replacement.correctionReason).toBeUndefined();
    expect(replacement.evidence?.[0]).toMatchObject({ relation: "contradicts", note: "second sample" });

    const context = service.getWorkspaceContext(ctxHuman2, workspaceId);
    expect(context.findings.map((finding) => finding.id)).toEqual([replacement.id]);
    expect(context.slices.findings.total).toBe(1);
    expect(context.historicalCounts.findings).toBe(1);
    expect(context.supersededDecisions).toEqual([]);

    expect(() =>
      service.correctFinding(ctxHuman1, { findingId: original.id, summary: "again", reason: "no" }),
    ).toThrow(InvalidTransition);
    expect(() => service.withdrawFinding(ctxHuman1, { findingId: original.id, reason: "no" })).toThrow(
      InvalidTransition,
    );
    expect(service.getFindingInWorkspace(ctxHuman1, workspaceId, original.id).summary).toBe("disk is full");

    const caughtUp = service.getWorkspaceChanges(ctxHuman2, { workspaceId, after: cursor });
    const corrections = caughtUp.changes.items.filter((change) => change.changeType === "finding.corrected");
    expect(corrections.map((change) => change.objectId)).toEqual([original.id, replacement.id]);
    expect(corrections.every((change) => change.reason === "measured again")).toBe(true);
    expect(corrections[0]?.successorId).toBe(replacement.id);
    expect(corrections[1]?.predecessorId).toBe(original.id);
  });

  it("withdraws without a replacement and filters historical rows without spending the current budget", () => {
    const workspaceId = workspaceNamed("Incident");
    const kept = service.addFinding(ctxHuman1, { workspaceId, summary: "still true" });
    const dropped = service.addFinding(ctxHuman1, { workspaceId, summary: "retracted", detail: "keep this" });
    const withdrawn = service.withdrawFinding(ctxHuman1, { findingId: dropped.id, reason: "could not reproduce" });

    expect(withdrawn.currentness).toBe("withdrawn");
    expect(withdrawn.summary).toBe("retracted");
    expect(withdrawn.detail).toBe("keep this");
    expect(withdrawn.correctionReason).toBe("could not reproduce");
    expect(withdrawn.successorId).toBeUndefined();

    const current = service.listFindingsPage(ctxHuman1, { workspaceId });
    expect(current.items.map((finding) => finding.id)).toEqual([kept.id]);
    expect(current.total).toBe(1);
    const historical = service.listFindingsPage(ctxHuman1, { workspaceId, currentness: "withdrawn" });
    expect(historical.items.map((finding) => finding.id)).toEqual([dropped.id]);
    expect(historical.total).toBe(1);
    const all = service.listFindingsPage(ctxHuman1, { workspaceId, currentness: "all", limit: 1 });
    expect(all.total).toBe(2);
    expect(all.returned).toBe(1);
    expect(all.truncated).toBe(true);
    const rest = service.listFindingsPage(ctxHuman1, { workspaceId, currentness: "all", limit: 1, cursor: all.nextCursor });
    expect(new Set([all.items[0]?.id, rest.items[0]?.id])).toEqual(new Set([kept.id, dropped.id]));
    expect(service.getWorkspaceContext(ctxHuman1, workspaceId).historicalCounts.findings).toBe(1);
  });

  it("proposes a replacement without changing the accepted decision, then claims one successor", () => {
    const workspaceId = workspaceNamed("Incident");
    const accepted = service.acceptDecision(
      ctxHuman1,
      service.addDecision(ctxHuman1, { workspaceId, summary: "ship the patch" }).id,
    );
    const first = service.addDecision(ctxHuman1, {
      workspaceId,
      summary: "ship the revised patch",
      replacesDecisionId: accepted.id,
    });
    const second = service.addDecision(ctxHuman1, {
      workspaceId,
      summary: "wait for the vendor",
      replacesDecisionId: accepted.id,
    });

    expect(service.getDecisionInWorkspace(ctxHuman1, workspaceId, accepted.id).status).toBe("accepted");
    expect(first.status).toBe("proposed");
    expect(first.predecessorId).toBe(accepted.id);
    expect(second.predecessorId).toBe(accepted.id);
    const before = service.getWorkspaceContext(ctxHuman1, workspaceId);
    expect(before.slices.decisions.total).toBe(3);
    expect(before.historicalCounts.decisions).toBe(0);

    expect(() => service.acceptDecision(ctxHuman1, first.id)).toThrow(ValidationError);
    expect(service.getDecisionInWorkspace(ctxHuman1, workspaceId, accepted.id).status).toBe("accepted");

    const cursor = before.orientationCursor;
    const chosen = service.acceptDecision(ctxHuman1, first.id, { reason: "the revision covers the failure" });
    expect(chosen.status).toBe("accepted");
    expect(chosen.approvedBy).toEqual(HUMAN1);
    const retired = service.getDecisionInWorkspace(ctxHuman1, workspaceId, accepted.id);
    expect(retired.status).toBe("superseded");
    expect(retired.successorId).toBe(first.id);
    expect(retired.supersedeReason).toBe("the revision covers the failure");

    expect(() => service.acceptDecision(ctxHuman1, second.id, { reason: "too late" })).toThrow(InvalidTransition);
    expect(service.getDecisionInWorkspace(ctxHuman1, workspaceId, second.id).status).toBe("proposed");
    expect(service.getDecisionInWorkspace(ctxHuman1, workspaceId, accepted.id).successorId).toBe(first.id);

    const after = service.getWorkspaceContext(ctxHuman1, workspaceId);
    expect(after.acceptedDecisions.map((decision) => decision.id)).toEqual([first.id]);
    expect(after.proposedDecisions.map((decision) => decision.id)).toEqual([second.id]);
    expect(after.slices.decisions.total).toBe(2);
    expect(after.historicalCounts.decisions).toBe(1);
    expect(after.supersededDecisions).toEqual([]);

    const changes = service.getWorkspaceChanges(ctxHuman1, { workspaceId, after: cursor }).changes.items;
    expect(changes.map((change) => change.changeType)).toEqual(["update:accepted", "decision.superseded"]);
    expect(changes[1]).toMatchObject({
      objectId: accepted.id,
      reason: "the revision covers the failure",
      successorId: first.id,
    });
  });

  it("returns conflict when a second acceptance loses the successor claim", () => {
    const workspaceId = workspaceNamed("Incident");
    const accepted = service.acceptDecision(
      ctxHuman1,
      service.addDecision(ctxHuman1, { workspaceId, summary: "ship the patch" }).id,
    );
    const first = service.addDecision(ctxHuman1, {
      workspaceId,
      summary: "ship the revised patch",
      replacesDecisionId: accepted.id,
    });
    const second = service.addDecision(ctxHuman1, {
      workspaceId,
      summary: "wait for the vendor",
      replacesDecisionId: accepted.id,
    });
    service.acceptDecision(ctxHuman1, first.id, { reason: "first claim" });
    store.updateDecision(accepted.id, { status: "accepted", updatedAt: NOW });

    expect(() => service.acceptDecision(ctxHuman1, second.id, { reason: "lost the race" })).toThrow(Conflict);
    expect(service.getDecisionInWorkspace(ctxHuman1, workspaceId, second.id).status).toBe("proposed");
    expect(service.getDecisionInWorkspace(ctxHuman1, workspaceId, accepted.id).successorId).toBe(first.id);
    expect(service.getDecisionInWorkspace(ctxHuman1, workspaceId, first.id).status).toBe("accepted");
  });

  it("retires an accepted decision and rejects a proposed one without a replacement", () => {
    const workspaceId = workspaceNamed("Incident");
    const accepted = service.acceptDecision(
      ctxHuman1,
      service.addDecision(ctxHuman1, { workspaceId, summary: "keep the workaround" }).id,
    );
    const proposed = service.addDecision(ctxHuman1, { workspaceId, summary: "try another workaround" });
    const retired = service.retireDecision(ctxHuman1, { decisionId: accepted.id, reason: "workaround expired" });
    const rejected = service.retireDecision(ctxHuman1, { decisionId: proposed.id, reason: "not a team choice" });

    expect(retired.status).toBe("superseded");
    expect(retired.supersedeReason).toBe("workaround expired");
    expect(retired.successorId).toBeUndefined();
    expect(rejected.status).toBe("superseded");
    expect(rejected.supersedeReason).toBe("not a team choice");
    expect(() => service.acceptDecision(ctxHuman1, proposed.id)).toThrow(InvalidTransition);
    expect(() => service.retireDecision(ctxHuman1, { decisionId: accepted.id, reason: "again" })).toThrow(
      InvalidTransition,
    );
    const context = service.getWorkspaceContext(ctxHuman1, workspaceId);
    expect(context.slices.decisions.total).toBe(0);
    expect(context.historicalCounts.decisions).toBe(2);
  });

  it("flags a current decision when cited evidence is no longer current", () => {
    const workspaceId = workspaceNamed("Incident");
    const finding = service.addFinding(ctxHuman1, { workspaceId, summary: "cache is stale", detail: "first reading" });
    const decision = service.acceptDecision(
      ctxHuman1,
      service.addDecision(ctxHuman1, { workspaceId, summary: "flush the cache" }).id,
    );
    const citation = service.citeDecisionBasis(ctxHuman1, {
      decisionId: decision.id,
      findingId: finding.id,
      note: "basis note",
    });
    service.withdrawFinding(ctxHuman1, { findingId: finding.id, reason: "cache was cold" });

    const flagged = service.getDecisionInWorkspace(ctxHuman1, workspaceId, decision.id);
    expect(flagged.status).toBe("accepted");
    expect(flagged.needsReview).toBe(true);
    expect(flagged.needsReviewFindingIds).toEqual([finding.id]);
    expect(flagged.citations?.map((row) => row.id)).toEqual([citation.id]);
    const oriented = service.getWorkspaceContext(ctxHuman1, workspaceId);
    expect(oriented.acceptedDecisions[0]?.needsReview).toBe(true);
    expect(oriented.findings).toEqual([]);

    const retired = service.retireDecision(ctxHuman1, { decisionId: decision.id, reason: "basis withdrawn" });
    expect(retired.needsReview).toBeUndefined();
    expect(retired.citations?.map((row) => row.findingId)).toEqual([finding.id]);
    const after = service.getWorkspaceContext(ctxHuman1, workspaceId);
    expect(after.acceptedDecisions).toEqual([]);
    expect(after.slices.decisions.items.some((item) => item.needsReview === true)).toBe(false);
    expect(service.getDecisionInWorkspace(ctxHuman1, workspaceId, decision.id).status).toBe("superseded");
  });

  it("keeps a catch-up tip frozen while a later correction waits for the next run", () => {
    const workspaceId = workspaceNamed("Incident");
    service.addFinding(ctxHuman1, { workspaceId, summary: "first report" });
    const cursor = service.getWorkspaceContext(ctxHuman1, workspaceId).orientationCursor;
    const original = service.addFinding(ctxHuman1, { workspaceId, summary: "needs correction" });
    service.correctFinding(ctxHuman1, {
      findingId: original.id,
      summary: "corrected report",
      reason: "new sample",
    });
    const first = service.getWorkspaceChanges(ctxHuman1, { workspaceId, after: cursor, limit: 1 });
    expect(first.changes.returned).toBe(1);
    expect(first.changes.truncated).toBe(true);
    const later = service.addFinding(ctxHuman1, { workspaceId, summary: "after the frozen tip" });
    const second = service.getWorkspaceChanges(ctxHuman1, { workspaceId, after: first.toCursor, limit: 10 });
    expect(second.changes.items.some((change) => change.objectId === later.id)).toBe(false);
    const rerun = service.getWorkspaceChanges(ctxHuman1, { workspaceId, after: cursor, limit: 20 });
    expect(rerun.changes.items.some((change) => change.objectId === later.id)).toBe(true);
  });

  it("rejects unauthorized actors and cross-workspace relations without leaking the other workspace", () => {
    const workspaceId = workspaceNamed("Incident");
    const otherId = workspaceNamed("Other");
    const secret = "FOREIGN_WORKSPACE_DETAIL";
    const finding = service.addFinding(ctxHuman1, { workspaceId, summary: "local fact", detail: secret });
    const otherArtifact = service.addArtifact(ctxHuman1, {
      workspaceId: otherId,
      type: "log",
      title: "foreign",
      uriOrPath: "foreign.log",
    });
    const evidence = service.citeFindingEvidence(ctxHuman1, {
      findingId: finding.id,
      artifactId: service.addArtifact(ctxHuman1, {
        workspaceId,
        type: "log",
        title: "local",
        uriOrPath: "local.log",
      }).id,
      relation: "supports",
      note: secret,
    });

    expect(() =>
      service.correctFinding(ctxHuman3, { findingId: finding.id, summary: "nope", reason: secret }),
    ).toThrow(FindingNotFound);
    try {
      service.correctFinding(ctxHuman3, { findingId: finding.id, summary: "nope", reason: secret });
    } catch (error) {
      expect(error).toBeInstanceOf(FindingNotFound);
      expect((error as Error).message).not.toContain(workspaceId);
      expect((error as Error).message).not.toContain(secret);
    }
    expect(() => service.removeFindingEvidence(ctxHuman3, { evidenceId: evidence.id })).toThrow(Conflict);
    try {
      service.removeFindingEvidence(ctxHuman3, { evidenceId: evidence.id });
    } catch (error) {
      expect((error as Error).message).toBe("Finding evidence was not found");
      expect((error as Error).message).not.toContain(workspaceId);
      expect((error as Error).message).not.toContain(secret);
    }

    enroll(ctxHuman2, workspaceId, "viewer");
    expect(() =>
      service.correctFinding(ctxHuman2, { findingId: finding.id, summary: "viewer", reason: "no" }),
    ).toThrow(Unauthorized);
    enroll(ctxAgent1, workspaceId, "agent");
    expect(() =>
      service.correctFinding(ctxAgent1, { findingId: finding.id, summary: "no session", reason: "no" }),
    ).toThrow(Unauthorized);

    expect(() =>
      service.citeFindingEvidence(ctxHuman1, {
        findingId: finding.id,
        artifactId: otherArtifact.id,
        relation: "supports",
      }),
    ).toThrow(CrossWorkspaceReference);
    try {
      service.citeFindingEvidence(ctxHuman1, {
        findingId: finding.id,
        artifactId: otherArtifact.id,
        relation: "supports",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(CrossWorkspaceReference);
      expect((error as Error).message).not.toContain(otherId);
    }
    expect(service.getFindingInWorkspace(ctxHuman1, workspaceId, finding.id).summary).toBe("local fact");
    expect(service.listWorkspaces(ctxHuman3).some((item) => item.id === workspaceId)).toBe(false);
  });

  it("rejects an empty or oversized reason, a long note, and a duplicate citation", () => {
    const workspaceId = workspaceNamed("Incident");
    const finding = service.addFinding(ctxHuman1, { workspaceId, summary: "fact" });
    const artifact = service.addArtifact(ctxHuman1, {
      workspaceId,
      type: "document",
      title: "note",
      uriOrPath: "note.md",
    });
    expect(() => service.withdrawFinding(ctxHuman1, { findingId: finding.id, reason: "  " })).toThrow(ValidationError);
    expect(() =>
      service.correctFinding(ctxHuman1, { findingId: finding.id, summary: "next", reason: "x".repeat(2001) }),
    ).toThrow(ValidationError);
    expect(() =>
      service.citeFindingEvidence(ctxHuman1, {
        findingId: finding.id,
        artifactId: artifact.id,
        relation: "supports",
        note: "n".repeat(501),
      }),
    ).toThrow(ValidationError);
    service.citeFindingEvidence(ctxHuman1, { findingId: finding.id, artifactId: artifact.id, relation: "supports" });
    expect(() =>
      service.citeFindingEvidence(ctxHuman1, { findingId: finding.id, artifactId: artifact.id, relation: "contradicts" }),
    ).toThrow(Conflict);
    expect(() => service.removeFindingEvidence(ctxHuman1, { evidenceId: "fev_missing" })).toThrow(Conflict);
    expect(service.getFindingInWorkspace(ctxHuman1, workspaceId, finding.id).currentness).toBe("current");
  });

  it("does not map correction transitions onto the closed webhook vocabulary", () => {
    const workspaceId = workspaceNamed("Incident");
    const finding = service.addFinding(ctxHuman1, { workspaceId, summary: "recorded fact" });
    expect(eventTypes(workspaceId)).toEqual(["finding.recorded"]);
    service.correctFinding(ctxHuman1, { findingId: finding.id, summary: "revised fact", reason: "measured" });
    service.withdrawFinding(ctxHuman1, {
      findingId: service.addFinding(ctxHuman1, { workspaceId, summary: "temporary" }).id,
      reason: "withdrawn",
    });
    const accepted = service.acceptDecision(
      ctxHuman1,
      service.addDecision(ctxHuman1, { workspaceId, summary: "first choice" }).id,
    );
    service.retireDecision(ctxHuman1, { decisionId: accepted.id, reason: "retired" });
    const replacement = service.addDecision(ctxHuman1, {
      workspaceId,
      summary: "second choice",
      replacesDecisionId: service.acceptDecision(
        ctxHuman1,
        service.addDecision(ctxHuman1, { workspaceId, summary: "standing choice" }).id,
      ).id,
    });
    service.acceptDecision(ctxHuman1, replacement.id, { reason: "explicit replacement" });

    const events = store.listDomainEventsForWorkspace(workspaceId);
    expect(events.map((event) => event.type)).toEqual([
      "finding.recorded",
      "finding.recorded",
      "decision.proposed",
      "decision.accepted",
      "decision.proposed",
      "decision.accepted",
      "decision.proposed",
      "decision.accepted",
    ]);
    expect(new Set(events.map((event) => event.type)).size).toBeGreaterThan(0);
    for (const event of events) {
      expect(CAMPFIRE_EVENT_TYPES).toContain(event.type);
    }
    expect(events.filter((event) => event.type === "decision.accepted").at(-1)?.subjectId).toBe(replacement.id);
    expect(events.filter((event) => event.subjectId === accepted.id).map((event) => event.type)).toEqual([
      "decision.proposed",
      "decision.accepted",
    ]);
    expect(events.filter((event) => event.subjectId === finding.id).map((event) => event.type)).toEqual([
      "finding.recorded",
    ]);
  });

  it("rolls back a correction when the successor claim fails", () => {
    const local = openInMemoryStore();
    const guarded = new Proxy(local, {
      get(target, prop, receiver) {
        if (prop === "claimFindingTransition") {
          return () => {
            throw new Error("injected claim failure");
          };
        }
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const guardedService = createCampfireService({
      store: guarded,
      idSource: createCounterIdSource(),
      clock: createClock().tick,
    });
    local.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: NOW });
    local.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: NOW });
    local.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
    const workspaceId = guardedService.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Rollback" }).id;
    const artifact = guardedService.addArtifact(ctxHuman1, {
      workspaceId,
      type: "log",
      title: "sample",
      uriOrPath: "sample.log",
    });
    const original = guardedService.addFinding(ctxHuman1, {
      workspaceId,
      summary: "original",
      detail: "stays",
      sourceArtifactId: artifact.id,
    });
    const findingsBefore = local.listFindings(workspaceId).length;
    const contributionsBefore = local.listContributions(workspaceId).length;
    const eventsBefore = local.listDomainEventsForWorkspace(workspaceId).length;

    expect(() =>
      guardedService.correctFinding(ctxHuman1, {
        findingId: original.id,
        summary: "should not land",
        reason: "injected",
        evidence: [{ artifactId: artifact.id, relation: "supports" }],
      }),
    ).toThrow(/injected claim failure/);

    expect(local.listFindings(workspaceId)).toHaveLength(findingsBefore);
    expect(local.listContributions(workspaceId)).toHaveLength(contributionsBefore);
    expect(local.listDomainEventsForWorkspace(workspaceId)).toHaveLength(eventsBefore);
    expect(local.listFindingEvidence([original.id])).toEqual([]);
    const stored = local.getFinding(original.id);
    expect(stored?.summary).toBe("original");
    expect(stored?.currentness).toBe("current");
    expect(stored?.successorId).toBeUndefined();
    guardedService.close();
  });

  it("rejects a predecessor cycle before writing a replacement", () => {
    const dir = mkdtempSync(join(tmpdir(), "cor-001-"));
    const databasePath = join(dir, "campfire.db");
    const fileStore = openSqliteStore(databasePath);
    const fileService = createCampfireService({
      store: fileStore,
      idSource: createCounterIdSource(),
      clock: createClock().tick,
    });
    fileStore.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: NOW });
    fileStore.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: NOW });
    fileStore.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
    const workspaceId = fileService.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Cycle" }).id;
    const first = fileService.addFinding(ctxHuman1, { workspaceId, summary: "A" });
    const second = fileService.addFinding(ctxHuman1, { workspaceId, summary: "B" });
    fileService.close();

    const db = new Database(databasePath);
    db.prepare("UPDATE findings SET predecessor_id = ? WHERE id = ?").run(second.id, first.id);
    db.prepare("UPDATE findings SET predecessor_id = ? WHERE id = ?").run(first.id, second.id);
    db.close();

    const reopened = openSqliteStore(databasePath);
    const reopenedService = createCampfireService({
      store: reopened,
      idSource: createCounterIdSource(),
      clock: createClock().tick,
    });
    expect(() =>
      reopenedService.correctFinding(ctxHuman1, { findingId: first.id, summary: "C", reason: "cycle" }),
    ).toThrow(InvalidTransition);
    expect(reopened.listFindings(workspaceId).map((finding) => finding.id).sort()).toEqual([first.id, second.id].sort());
    reopenedService.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("COR-001 D1 parity", () => {
  it("matches current orientation, filters, catch-up, and inspection on a fresh D1 store", async () => {
    const adapter = sqliteD1();
    await migrateD1(adapter.binding);
    const remote = createD1Store(adapter.binding);
    const remoteService = createAsyncCampfireService({
      store: remote,
      idSource: createCounterIdSource(),
      clock: createClock().tick,
    });
    await remote.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: NOW });
    await remote.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: NOW });
    await remote.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
    const workspaceId = (await remoteService.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Remote" })).id;
    const original = await remoteService.addFinding(ctxHuman1, {
      workspaceId,
      summary: "old remote fact",
      detail: "remote detail",
    });
    const cursor = (await remoteService.getWorkspaceContext(ctxHuman1, workspaceId)).orientationCursor;
    const replacement = await remoteService.correctFinding(ctxHuman1, {
      findingId: original.id,
      summary: "current remote fact",
      reason: "remote correction",
    });
    const eventsAfterCorrect = (await remote.listDomainEventsForWorkspace(workspaceId)).map((event) => event.type);
    expect(eventsAfterCorrect).toEqual(["finding.recorded"]);

    const current = await remoteService.listFindingsPage(ctxHuman1, { workspaceId, currentness: "current" });
    const superseded = await remoteService.listFindingsPage(ctxHuman1, { workspaceId, currentness: "superseded" });
    expect(current.total).toBe(1);
    expect(current.items.map((finding) => finding.id)).toEqual([replacement.id]);
    expect(superseded.total).toBe(1);
    expect(superseded.items[0]).toMatchObject({
      id: original.id,
      summary: "old remote fact",
      detail: "remote detail",
      currentness: "superseded",
      correctionReason: "remote correction",
      successorId: replacement.id,
    });
    const context = await remoteService.getWorkspaceContext(ctxHuman1, workspaceId);
    expect(context.findings.map((finding) => finding.id)).toEqual([replacement.id]);
    expect(context.historicalCounts).toEqual({ findings: 1, decisions: 0 });
    const caughtUp = await remoteService.getWorkspaceChanges(ctxHuman1, { workspaceId, after: cursor });
    expect(caughtUp.changes.items.map((change) => change.changeType)).toEqual(["finding.corrected", "finding.corrected"]);
    expect(caughtUp.changes.items[0]?.reason).toBe("remote correction");

    const decision = await remoteService.acceptDecision(
      ctxHuman1,
      (await remoteService.addDecision(ctxHuman1, { workspaceId, summary: "remote choice" })).id,
    );
    await remoteService.citeDecisionBasis(ctxHuman1, { decisionId: decision.id, findingId: replacement.id });
    await remoteService.withdrawFinding(ctxHuman1, { findingId: replacement.id, reason: "remote withdrawal" });
    const flagged = await remoteService.getDecisionInWorkspace(ctxHuman1, workspaceId, decision.id);
    expect(flagged.needsReviewFindingIds).toEqual([replacement.id]);
    expect(flagged.status).toBe("accepted");
    adapter.database.close();
  });

  it("does not keep a removal contribution when a D1 delete matches no row", async () => {
    const adapter = sqliteD1();
    await migrateD1(adapter.binding);
    const remote = createD1Store(adapter.binding);
    const remoteService = createAsyncCampfireService({
      store: remote,
      idSource: createCounterIdSource(),
      clock: createClock().tick,
    });
    await remote.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: NOW });
    await remote.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: NOW });
    await remote.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
    const workspaceId = (await remoteService.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Remote" })).id;
    const finding = await remoteService.addFinding(ctxHuman1, { workspaceId, summary: "remote fact" });
    const artifact = await remoteService.addArtifact(ctxHuman1, {
      workspaceId,
      type: "log",
      title: "remote log",
      uriOrPath: "remote.log",
    });
    const evidence = await remoteService.citeFindingEvidence(ctxHuman1, {
      findingId: finding.id,
      artifactId: artifact.id,
      relation: "supports",
    });
    await remoteService.removeFindingEvidence(ctxHuman1, { evidenceId: evidence.id });
    expect(await remote.getFindingEvidence(evidence.id)).toBeUndefined();

    await expect(remote.transaction(async () => {
      await remote.deleteFindingEvidence(finding.id, artifact.id);
      await remote.createContribution({
        id: "con_ghost",
        workspaceId,
        actor: HUMAN1,
        action: "update",
        objectType: "finding",
        objectId: finding.id,
        payload: { summary: "removed ghost" },
        createdAt: NOW,
      });
    })).rejects.toBeInstanceOf(Conflict);
    expect((await remote.listContributions(workspaceId)).map((row) => row.id)).not.toContain("con_ghost");
    adapter.database.close();
  });
});
