/**
 * RCL-001 service contract: authorize before search, keep lifecycle honest,
 * and return one typed recall from SQLite and D1.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCounterIdSource } from "../../src/domain/ids.js";
import {
  ActorNotFound,
  ParticipantRequired,
  RecallRestart,
  ValidationError,
  WorkspaceNotFound,
} from "../../src/domain/errors.js";
import {
  DECISION_SET_LINKED_NEXT_STEP,
  RECALL_DECISION_SET_LIMIT,
  RECALL_RESPONSE_MAX_BYTES,
  encodeRecallCursor,
  jsonByteLength,
  type RecallCursor,
} from "../../src/domain/recall.js";
import type { ActorRef } from "../../src/domain/types.js";
import { campfireHttpCall } from "../../src/http/client.js";
import { isDeliveryEligibleMethod } from "../../src/http/dispatch.js";
import { startCampfireHttpServer } from "../../src/http/server.js";
import { createRuntimeFromPath } from "../../src/runtime.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { projectRecallAsync } from "../../src/service/recall-read.js";
import type { ActorContext } from "../../src/service/authorization.js";
import type { CampfireService } from "../../src/service/service.js";
import {
  countRecallDecisionSetSql,
  recallDecisionSetSql,
  recallGoalSql,
  recallSectionSql,
} from "../../src/store/recall-queries.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { createAsyncCampfireService } from "../../src/worker/async-service.js";
import { createD1Store, migrateD1, type AsyncCampfireStore } from "../../src/worker/d1-store.js";
import { createD1WorkerHandler } from "../../src/worker/handler.js";
import { VIEWER_READ_METHODS } from "../../src/viewer/server.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";

const NOW = "2026-01-01T00:00:00.000Z";
const QUERY = "partner callback";
/** The authorization test's query, also used to seed a decision it must not read. */
const sentinelQuery = "query-sentinel-do-not-log";
const SECRET_URI = "secret-uri-only-do-not-match";
const SECRET_META = "secret-meta-only";
const SECRET_NOTE = "secret-note-only";
const SECRET_REASON = "secret-reason-only";
const NAME_SENTINEL = "workspace-name-sentinel";

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
  return (): string => {
    current += 1000;
    return new Date(current).toISOString();
  };
}

function withStderr(run: () => void): { error: unknown; log: string } {
  const chunks: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stderr.write;
  let error: unknown;
  try {
    run();
  } catch (caught) {
    error = caught;
  } finally {
    process.stderr.write = original;
  }
  return { error, log: chunks.join("") };
}

function cursor(overrides: Partial<RecallCursor> & Pick<RecallCursor, "workspaceId" | "query">): string {
  return encodeRecallCursor({
    v: 1,
    ordering: "rcl-1",
    sourcePosition: 0,
    section: "current",
    tier: 0,
    at: NOW,
    id: "missing",
    ...overrides,
  });
}

let store: CampfireStore;
let service: CampfireService;

beforeEach(() => {
  store = openInMemoryStore();
  service = createCampfireService({ store, idSource: createCounterIdSource(), clock: createClock() });
  store.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: NOW });
  store.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: NOW });
  store.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
  store.createHuman({ id: "hum_2", teamId: "team_1", displayName: "Grace", createdAt: NOW });
  store.createHuman({ id: "hum_3", teamId: "team_1", displayName: "Vera", createdAt: NOW });
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

function seedRecall() {
  const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: NAME_SENTINEL });
  const workspaceId = workspace.id;
  service.inviteToWorkspace(ctxHuman1, { workspaceId, actor: AGENT1, role: "agent" });
  service.joinWorkspace(ctxAgent1, { workspaceId });
  service.inviteToWorkspace(ctxHuman1, { workspaceId, actor: HUMAN3, role: "viewer" });
  service.joinWorkspace(ctxHuman3, { workspaceId });
  service.createGoal(ctxHuman1, {
    workspaceId,
    title: "Ship the partner callback",
    description: "keep going",
  });

  const taskOld = service.createTask(ctxHuman1, { workspaceId, title: "partner callback" });
  const taskNew = service.createTask(ctxHuman1, { workspaceId, title: "partner callback" });
  const progress = service.createTask(ctxHuman1, { workspaceId, title: "partner callback extra progress" });
  service.updateTask(ctxHuman1, { taskId: progress.id, status: "in_progress" });
  const blocked = service.createTask(ctxHuman1, { workspaceId, title: "partner callback extra blocked" });
  service.updateTask(ctxHuman1, { taskId: blocked.id, status: "blocked" });
  const done = service.createTask(ctxHuman1, { workspaceId, title: "partner callback extra done" });
  service.updateTask(ctxHuman1, { taskId: done.id, status: "completed" });

  const evidence = service.addFinding(ctxHuman1, {
    workspaceId,
    summary: "partner callback extra evidence",
    detail: "first reading",
  });
  const proposed = service.addDecision(ctxHuman1, { workspaceId, summary: "partner callback extra proposal" });
  service.citeDecisionBasis(ctxHuman1, { decisionId: proposed.id, findingId: evidence.id });
  const accepted = service.acceptDecision(
    ctxHuman1,
    service.addDecision(ctxHuman1, {
      workspaceId,
      summary: "partner callback extra accepted",
      rationale: "Accept the previous secret for twenty-four hours during rotation.",
    }).id,
  );
  service.citeDecisionBasis(ctxHuman1, { decisionId: accepted.id, findingId: evidence.id });
  const retired = service.acceptDecision(
    ctxHuman1,
    service.addDecision(ctxHuman1, { workspaceId, summary: "partner callback extra retired" }).id,
  );
  service.citeDecisionBasis(ctxHuman1, { decisionId: retired.id, findingId: evidence.id });
  service.retireDecision(ctxHuman1, { decisionId: retired.id, reason: SECRET_REASON });
  service.withdrawFinding(ctxHuman1, { findingId: evidence.id, reason: SECRET_REASON });

  const oldLead = service.addFinding(ctxHuman1, { workspaceId, summary: "partner callback extra old" });
  const corrected = service.correctFinding(ctxHuman1, {
    findingId: oldLead.id,
    summary: "partner callback extra corrected",
    reason: SECRET_REASON,
  });
  const artifact = service.addArtifact(ctxHuman1, {
    workspaceId,
    type: "log",
    title: "partner callback extra log",
    uriOrPath: SECRET_URI,
    metadata: { secret: SECRET_META },
  });
  service.citeFindingEvidence(ctxHuman1, {
    findingId: corrected.id,
    artifactId: artifact.id,
    relation: "supports",
    note: SECRET_NOTE,
  });

  const session = service.registerAgentSession(ctxAgent1, {
    agentId: AGENT1.actorId,
    workspaceId,
    harness: "codex",
  });
  const sessionFinding = service.addFinding(
    { actor: AGENT1, agentSessionId: session.id },
    { workspaceId, summary: "partner callback extra session" },
  );

  const other = service.createWorkspace(ctxHuman2, { teamId: "team_1", name: "Other" });
  const foreignFinding = service.addFinding(ctxHuman2, {
    workspaceId: other.id,
    summary: "partner callback extra foreign",
  });
  const foreignArtifact = service.addArtifact(ctxHuman2, {
    workspaceId: other.id,
    type: "log",
    title: "foreign log",
    uriOrPath: "foreign-uri-do-not-copy",
  });
  // A real decision in the other workspace. `dec_link` below names it as its
  // predecessor, so the recall read must drop that id after a point lookup
  // confirms the workspace — exactly as it drops `find_link`'s predecessor.
  const foreignDecision = service.acceptDecision(
    ctxHuman2,
    service.addDecision(ctxHuman2, {
      workspaceId: other.id,
      summary: "partner callback extra foreign decision",
    }).id,
  );
  store.createFinding({
    id: "find_link",
    workspaceId,
    summary: "partner callback extra link",
    currentness: "current",
    predecessorId: foreignFinding.id,
    createdBy: HUMAN1,
    createdAt: "2026-06-01T00:00:00.000Z",
  });
  store.insertFindingEvidence({
    id: "ev_foreign",
    workspaceId,
    findingId: corrected.id,
    artifactId: foreignArtifact.id,
    relation: "supports",
    createdBy: HUMAN1,
    createdAt: NOW,
  });
  store.insertDecisionCitation({
    id: "cit_foreign",
    workspaceId,
    decisionId: accepted.id,
    findingId: foreignFinding.id,
    note: "foreign basis",
    createdBy: HUMAN1,
    createdAt: NOW,
  });
  // A second accepted decision on the same question. Neither names the other,
  // so the decision set is genuinely unresolved rather than single.
  const acceptedSecond = service.acceptDecision(
    ctxHuman1,
    service.addDecision(ctxHuman1, {
      workspaceId,
      summary: "partner callback extra second accepted",
      rationale: "Rotate the partner secret on a fixed cadence.",
    }).id,
  );
  service.citeDecisionBasis(ctxHuman1, { decisionId: acceptedSecond.id, findingId: evidence.id });
  // Same technique as `find_link`: a same-workspace decision whose predecessor
  // points into another workspace, so the cross-workspace id must be dropped
  // from the set member exactly as it is from a section hit.
  store.createDecision({
    id: "dec_link",
    workspaceId,
    summary: "partner callback extra decision link",
    status: "proposed",
    updatedAt: "2026-06-02T00:00:00.000Z",
    predecessorId: foreignDecision.id,
    createdBy: HUMAN1,
    createdAt: "2026-06-01T00:00:00.000Z",
  });

  return {
    workspace,
    other,
    taskOld,
    taskNew,
    progress,
    blocked,
    done,
    evidence,
    proposed,
    accepted,
    acceptedSecond,
    retired,
    oldLead,
    corrected,
    artifact,
    session,
    sessionFinding,
    foreignFinding,
    foreignArtifact,
    foreignDecision,
  };
}

describe("recall authorization", () => {
  it("rejects unknown workspaces, outsiders, and bad cursors before search", () => {
    const queries: string[] = [];
    const observed = openInMemoryStore({ observeQuery: (sql) => queries.push(sql) });
    const observedService = createCampfireService({
      store: observed,
      idSource: createCounterIdSource(),
      clock: createClock(),
    });
    observed.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: NOW });
    observed.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: NOW });
    observed.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
    observed.createHuman({ id: "hum_2", teamId: "team_1", displayName: "Grace", createdAt: NOW });
    const workspace = observedService.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Visible" });
    observedService.createTask(ctxHuman1, { workspaceId: workspace.id, title: "visible excerpt" });
    // An accepted decision that matches the sentinel, so an authorized read
    // would return a decision set. Denials must reach no `norm_primary` SQL,
    // and the decision-set query is built from the same expression.
    observedService.acceptDecision(
      ctxHuman1,
      observedService.addDecision(ctxHuman1, {
        workspaceId: workspace.id,
        summary: `${sentinelQuery} rule`,
      }).id,
    );
    const sentinel = sentinelQuery;

    queries.length = 0;
    const missing = withStderr(() => {
      observedService.recallWorkspace(ctxHuman1, { workspaceId: "ws_missing", query: sentinel });
    });
    expect(missing.error).toBeInstanceOf(WorkspaceNotFound);
    expect(JSON.stringify(missing.error)).not.toContain(sentinel);
    expect(missing.log).not.toContain(sentinel);
    expect(missing.log).toContain("workspace:read");
    expect(queries.some((sql) => sql.includes("norm_primary"))).toBe(false);

    queries.length = 0;
    const outsider = withStderr(() => {
      observedService.recallWorkspace(ctxHuman2, { workspaceId: workspace.id, query: sentinel });
    });
    expect(outsider.error).toBeInstanceOf(ParticipantRequired);
    expect(outsider.log).not.toContain(sentinel);
    expect(outsider.log).not.toContain("visible excerpt");
    expect(queries.some((sql) => sql.includes("norm_primary"))).toBe(false);

    // Sanity: the same read by a participant does run the set query, so the
    // assertions above prove ordering rather than a missing query.
    queries.length = 0;
    const allowed = observedService.recallWorkspace(ctxHuman1, { workspaceId: workspace.id, query: sentinel });
    expect(allowed.decisionSet?.members.map((row) => row.id)).toHaveLength(1);
    expect(queries.some((sql) => sql.includes("norm_primary"))).toBe(true);

    queries.length = 0;
    const forged = withStderr(() => {
      observedService.recallWorkspace(ctxHuman1, {
        workspaceId: workspace.id,
        query: sentinel,
        cursor: cursor({ workspaceId: "ws_other_secret", query: sentinel }),
      });
    });
    expect(forged.error).toBeInstanceOf(ValidationError);
    expect((forged.error as ValidationError).details).toEqual({ field: "cursor", workspaceId: workspace.id });
    expect(JSON.stringify(forged.error)).not.toContain("ws_other_secret");
    expect(forged.log).not.toContain(sentinel);
    expect(queries.some((sql) => sql.includes("norm_primary"))).toBe(false);

    expect(() =>
      observedService.recallWorkspace(ctxHuman1, { workspaceId: workspace.id, query: sentinel, cursor: "nope" }),
    ).toThrow(ValidationError);
    expect(() =>
      observedService.recallWorkspace(ctxHuman1, {
        workspaceId: workspace.id,
        query: "beta",
        cursor: cursor({ workspaceId: workspace.id, query: "alpha" }),
      }),
    ).toThrow(ValidationError);
    let orderingError: unknown;
    try {
      observedService.recallWorkspace(ctxHuman1, {
        workspaceId: workspace.id,
        query: sentinel,
        cursor: `rcl1.${Buffer.from(
          JSON.stringify({
            v: 1,
            ordering: "rcl-0",
            workspaceId: workspace.id,
            query: sentinel,
            sourcePosition: 0,
            section: "current",
            tier: 0,
            at: NOW,
            id: "x",
          }),
        ).toString("base64url")}`,
      });
    } catch (error) {
      orderingError = error;
    }
    expect(orderingError).toBeInstanceOf(ValidationError);
    expect((orderingError as ValidationError).message).toContain("ordering");
    expect(JSON.stringify(orderingError)).not.toContain("visible excerpt");
    expect(() => observedService.recallWorkspace(ctxHuman1, { workspaceId: workspace.id, query: "   " })).toThrow(
      ValidationError,
    );
    expect(() =>
      observedService.recallWorkspace(ctxHuman1, { workspaceId: workspace.id, query: sentinel, limit: 51 }),
    ).toThrow(ValidationError);
    observedService.close();
  });

  it("checks the recipient without the issuer session and writes no contribution", () => {
    const seeded = seedRecall();
    const before = store.listContributions(seeded.workspace.id).length;
    const token = service.createHuman(ctxHuman1, { teamId: "team_1", displayName: "Tokened" }).token;
    expect(token.startsWith("cft_")).toBe(true);

    const denied = withStderr(() => {
      service.projectHandoffPacket(ctxHuman1, {
        workspaceId: seeded.workspace.id,
        query: QUERY,
        recipient: HUMAN2,
      });
    });
    expect(denied.error).toBeInstanceOf(ParticipantRequired);
    expect(denied.log).not.toContain(QUERY);

    const mismatched = withStderr(() => {
      service.projectHandoffPacket(ctxHuman1, {
        workspaceId: seeded.workspace.id,
        query: QUERY,
        recipient: { actorId: HUMAN1.actorId, actorType: "agent" },
      });
    });
    expect(mismatched.error).toBeInstanceOf(ActorNotFound);
    expect((mismatched.error as ActorNotFound).message).toBe(`Actor not found: ${HUMAN1.actorId}`);
    expect(JSON.stringify(mismatched.error)).not.toContain(QUERY);

    const session = seeded.session.id;
    const fromAgent = service.projectHandoffPacket(
      { actor: AGENT1, agentSessionId: session },
      { workspaceId: seeded.workspace.id, query: QUERY, recipient: HUMAN1 },
    );
    expect(fromAgent.recipient).toEqual({ actorId: HUMAN1.actorId, actorType: "human" });
    expect(fromAgent.issuer).toEqual({ actorId: AGENT1.actorId, actorType: "agent" });

    const self = service.projectHandoffPacket(ctxHuman1, {
      workspaceId: seeded.workspace.id,
      query: QUERY,
      recipient: HUMAN1,
    });
    const viewer = service.projectHandoffPacket(ctxHuman1, {
      workspaceId: seeded.workspace.id,
      query: QUERY,
      recipient: HUMAN3,
    });
    expect(self.recipient.actorId).toBe(HUMAN1.actorId);
    expect(viewer.recipient.actorId).toBe(HUMAN3.actorId);
    expect(store.listContributions(seeded.workspace.id)).toHaveLength(before);
    expect(JSON.stringify(viewer)).not.toContain(token);
    expect(JSON.stringify(viewer)).not.toContain("cft_");
  });
});

describe("recall lifecycle", () => {
  it("separates current from historical work and omits foreign relationship text", () => {
    const seeded = seedRecall();
    const before = store.listContributions(seeded.workspace.id).length;
    const recall = service.recallWorkspace(ctxHuman1, { workspaceId: seeded.workspace.id, query: QUERY });
    const packet = service.projectHandoffPacket(ctxHuman1, {
      workspaceId: seeded.workspace.id,
      query: QUERY,
      recipient: HUMAN3,
    });
    expect(store.listContributions(seeded.workspace.id)).toHaveLength(before);

    expect(recall.goal?.matched).toBe(true);
    expect(recall.goal?.title).toContain("partner callback");
    expect(recall.completeness.fullHistoryIncluded).toBe(false);
    const currentIds = recall.current.items.map((item) => item.id);
    const historicalIds = recall.historical.items.map((item) => item.id);
    const artifactIds = recall.artifacts.items.map((item) => item.id);
    expect(currentIds.slice(0, 2)).toEqual([seeded.taskNew.id, seeded.taskOld.id]);
    expect(currentIds).toEqual(expect.arrayContaining([
      seeded.progress.id,
      seeded.blocked.id,
      seeded.corrected.id,
      seeded.sessionFinding.id,
      seeded.proposed.id,
      seeded.accepted.id,
      "find_link",
    ]));
    expect(currentIds).not.toEqual(expect.arrayContaining([
      seeded.done.id,
      seeded.evidence.id,
      seeded.oldLead.id,
      seeded.retired.id,
      seeded.artifact.id,
      seeded.foreignFinding.id,
    ]));
    expect(historicalIds).toEqual(expect.arrayContaining([
      seeded.done.id,
      seeded.evidence.id,
      seeded.oldLead.id,
      seeded.retired.id,
    ]));
    expect(historicalIds).not.toContain(seeded.progress.id);
    expect(artifactIds).toEqual([seeded.artifact.id]);
    expect(recall.artifacts.items[0]?.lifecycle).toBe("log");

    const progressHit = recall.current.items.find((item) => item.id === seeded.progress.id);
    expect(progressHit?.lifecycle).toBe("in_progress");
    const acceptedHit = recall.current.items.find((item) => item.id === seeded.accepted.id);
    expect(acceptedHit?.lifecycle).toBe("accepted");
    expect(acceptedHit?.needsReview).toBe(true);
    expect(acceptedHit?.needsReviewFindingIds).toEqual([seeded.evidence.id]);
    expect(acceptedHit?.basisFindingIds).toEqual([seeded.evidence.id]);
    const proposedHit = recall.current.items.find((item) => item.id === seeded.proposed.id);
    expect(proposedHit?.lifecycle).toBe("proposed");
    expect(proposedHit?.needsReview).toBe(true);
    const retiredHit = recall.historical.items.find((item) => item.id === seeded.retired.id);
    expect(retiredHit?.lifecycle).toBe("superseded");
    expect(retiredHit?.needsReview).toBeUndefined();
    const link = recall.current.items.find((item) => item.id === "find_link");
    expect(link?.predecessorId).toBeUndefined();
    const sessionHit = recall.current.items.find((item) => item.id === seeded.sessionFinding.id);
    expect(sessionHit?.provenance.createdBy).toEqual(AGENT1);
    expect(sessionHit?.provenance.agentSessionId).toBe(seeded.session.id);
    const correctedHit = recall.current.items.find((item) => item.id === seeded.corrected.id);
    expect(correctedHit?.evidenceArtifactIds).toEqual([seeded.artifact.id]);
    expect(correctedHit?.predecessorId).toBe(seeded.oldLead.id);
    const oldHit = recall.historical.items.find((item) => item.id === seeded.oldLead.id);
    expect(oldHit?.lifecycle).toBe("superseded");
    expect(oldHit?.successorId).toBe(seeded.corrected.id);
    expect(oldHit?.excerpt).toContain("old");
    expect(oldHit?.excerpt).not.toContain("corrected");

    const packed = JSON.stringify(packet);
    expect(packet.kind).toBe("CampfireHandoffPacket");
    expect(packet.offlineCopy).toBe(true);
    expect(packet.sensitiveOfflineCopy).toBe(true);
    expect(packet.fullHistoryIncluded).toBe(false);
    expect(packet.authority).toBe(
      "This offline copy is not a Campfire credential, not a live current-state guarantee, and not permission to execute a decision.",
    );
    expect(packet.anchors.openTasks.map((row) => row.id).sort()).toEqual([seeded.taskOld.id, seeded.taskNew.id].sort());
    expect(packet.anchors.openTasks.every((row) => row.lifecycle === "open")).toBe(true);
    expect(packet.anchors.blockedTasks.map((row) => row.id)).toEqual([seeded.blocked.id]);
    expect(packet.anchors.proposedDecisions.map((row) => row.id)).toEqual(
      expect.arrayContaining([seeded.proposed.id, "dec_link"]),
    );
    expect(packet.anchors.acceptedDecisions.map((row) => row.id)).toEqual(
      expect.arrayContaining([seeded.accepted.id, seeded.acceptedSecond.id]),
    );
    expect(packet.anchors.acceptedDecisions.find((row) => row.id === seeded.accepted.id)?.needsReview).toBe(true);
    expect(packet.anchors.acceptedDecisions.find((row) => row.id === seeded.accepted.id)?.basisFindingIds).toEqual([
      seeded.evidence.id,
    ]);
    expect(
      packet.anchors.acceptedDecisions.find((row) => row.id === seeded.accepted.id)?.rationale,
    ).toBe("Accept the previous secret for twenty-four hours during rotation.");
    const acceptedRecord = packet.records.find((row) => row.id === seeded.accepted.id);
    expect(acceptedRecord?.rationale).toBe("Accept the previous secret for twenty-four hours during rotation.");
    expect(acceptedRecord?.text).not.toContain("twenty-four");
    // RCL-003 §3.1 reverses the RCL-002 §2 position: the live recall response
    // itself now carries the bounded rationale on a decision hit, so a reader
    // can state the constraint and cite the hit id in one breath. Non-decision
    // kinds never gain it.
    const acceptedRecallHit = recall.current.items.find((item) => item.id === seeded.accepted.id);
    expect(acceptedRecallHit?.rationale).toBe("Accept the previous secret for twenty-four hours during rotation.");
    expect(acceptedRecallHit?.rationaleTruncated).toBeUndefined();
    expect(recall.current.items.find((item) => item.id === seeded.corrected.id)).not.toHaveProperty("rationale");
    expect(packed).not.toContain(SECRET_URI);
    expect(packed).not.toContain(SECRET_META);
    expect(packed).not.toContain(SECRET_NOTE);
    expect(packed).not.toContain(SECRET_REASON);
    expect(packed).not.toContain("foreign-uri-do-not-copy");
    expect(packed).not.toContain(seeded.foreignFinding.id);

    for (const secret of [SECRET_URI, SECRET_META, SECRET_NOTE, SECRET_REASON, NAME_SENTINEL]) {
      const missed = service.recallWorkspace(ctxHuman1, { workspaceId: seeded.workspace.id, query: secret });
      expect(missed.current.items).toEqual([]);
      expect(missed.historical.items).toEqual([]);
      expect(missed.artifacts.items).toEqual([]);
      expect(missed.current.total).toBe(0);
      expect(missed.goal?.matched).toBe(false);
      expect(JSON.stringify(missed.current)).not.toContain("visible");
    }

    const bare = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "No goal" });
    const empty = service.recallWorkspace(ctxHuman1, { workspaceId: bare.id, query: QUERY });
    expect(empty.goal).toBeUndefined();
    expect(empty.current).toMatchObject({ items: [], total: 0, returned: 0, truncated: false });
    expect(empty.historical.truncated).toBe(false);
    expect(empty.artifacts.truncated).toBe(false);

    const marker = service.createTask(ctxHuman1, { workspaceId: seeded.workspace.id, title: "later catchup marker" });
    const changes = service.getWorkspaceChanges(ctxHuman1, {
      workspaceId: seeded.workspace.id,
      after: recall.sourceCursor,
    });
    expect(changes.changes.items.map((item) => item.objectId)).toContain(marker.id);
    expect(changes.changes.items.map((item) => item.objectId)).not.toContain(seeded.taskOld.id);
  });

  it("continues only the cursor section and restarts when the source position moved", () => {
    const seeded = seedRecall();
    const first = service.recallWorkspace(ctxHuman1, { workspaceId: seeded.workspace.id, query: QUERY, limit: 1 });
    expect(first.current.returned).toBe(1);
    expect(first.current.truncated).toBe(true);
    expect(first.current.nextCursor).toBeDefined();
    const second = service.recallWorkspace(ctxHuman1, {
      workspaceId: seeded.workspace.id,
      query: QUERY,
      limit: 1,
      cursor: first.current.nextCursor,
    });
    expect(second.current.items[0]?.id).not.toBe(first.current.items[0]?.id);
    expect(second.historical.items.map((item) => item.id)).toEqual(first.historical.items.map((item) => item.id));
    expect(second.artifacts.items.map((item) => item.id)).toEqual(first.artifacts.items.map((item) => item.id));

    const restarted = withStderr(() => {
      service.recallWorkspace(ctxHuman1, {
        workspaceId: seeded.workspace.id,
        query: QUERY,
        cursor: cursor({ workspaceId: seeded.workspace.id, query: QUERY, sourcePosition: 999_999 }),
      });
    });
    expect(restarted.error).toBeInstanceOf(RecallRestart);
    expect((restarted.error as RecallRestart).details).toEqual({
      workspaceId: seeded.workspace.id,
      field: "cursor",
    });
    expect(JSON.stringify(restarted.error)).not.toContain(QUERY);
    expect(restarted.log).not.toContain(QUERY);
  });

  it("keeps the decision set identical across limit, cursor, and every section", () => {
    const seeded = seedRecall();
    const full = service.recallWorkspace(ctxHuman1, { workspaceId: seeded.workspace.id, query: QUERY });
    const set = full.decisionSet;
    expect(set?.state).toBe("unresolved-accepted-decisions");
    const memberIds = (set?.members ?? []).map((row) => row.id);
    expect(memberIds.length).toBeGreaterThan(1);

    // A different page limit must not change the set at all.
    const one = service.recallWorkspace(ctxHuman1, { workspaceId: seeded.workspace.id, query: QUERY, limit: 1 });
    expect(one.current.items).toHaveLength(1);
    expect(one.decisionSet?.members.map((row) => row.id)).toEqual(memberIds);
    expect(one.decisionSet?.total).toBe(set?.total);
    expect(one.decisionSet?.state).toBe(set?.state);
    expect(one.decisionSet?.operativeDecisionId).toBeUndefined();

    // Paging through every section with limit 1 never changes it either.
    const seen: string[][] = [];
    let next = one.current.nextCursor;
    let guard = 0;
    while (next !== undefined && guard < 60) {
      guard += 1;
      const page = service.recallWorkspace(ctxHuman1, {
        workspaceId: seeded.workspace.id,
        query: QUERY,
        limit: 1,
        cursor: next,
      });
      expect(page.decisionSet?.members.map((row) => row.id)).toEqual(memberIds);
      expect(page.decisionSet?.total).toBe(set?.total);
      expect(page.decisionSet?.state).toBe(set?.state);
      seen.push(page.decisionSet?.members.map((row) => row.id) ?? []);
      next = page.current.nextCursor;
    }
    expect(seen.length).toBeGreaterThan(0);
    for (const snapshot of seen) expect(snapshot).toEqual(memberIds);

    // Walk the historical and artifacts sections the same way. A cursor carries
    // the section it belongs to, so only that section advances.
    for (const section of ["historical", "artifacts"] as const) {
      let sectionCursor: string | undefined = one[section].nextCursor;
      let steps = 0;
      while (sectionCursor !== undefined && steps < 60) {
        steps += 1;
        const page = service.recallWorkspace(ctxHuman1, {
          workspaceId: seeded.workspace.id,
          query: QUERY,
          limit: 1,
          cursor: sectionCursor,
        });
        expect(page.decisionSet?.members.map((row) => row.id)).toEqual(memberIds);
        expect(page.decisionSet?.total).toBe(set?.total);
        expect(page.decisionSet?.state).toBe(set?.state);
        sectionCursor = page[section].nextCursor;
      }
      // Only a section with more than one match has a cursor to walk.
      if (one[section].truncated) expect(steps).toBeGreaterThan(0);
      else expect(steps).toBe(0);
    }
  });

  it("groups every matching decision with its lifecycle, links, and citations", () => {
    const seeded = seedRecall();
    const recall = service.recallWorkspace(ctxHuman1, { workspaceId: seeded.workspace.id, query: QUERY });
    const set = recall.decisionSet;
    expect(set).toBeDefined();
    expect(set?.members.map((row) => row.id)).toEqual(
      expect.arrayContaining([seeded.proposed.id, seeded.accepted.id, seeded.acceptedSecond.id, seeded.retired.id]),
    );
    expect(set?.returned).toBe(set?.members.length);
    expect(set?.truncated).toBe(false);

    const accepted = set?.members.find((row) => row.id === seeded.accepted.id);
    expect(accepted?.lifecycle).toBe("accepted");
    expect(accepted?.summary).toBe("partner callback extra accepted");
    expect(accepted?.summaryTruncated).toBe(false);
    expect(accepted?.rationale).toBe("Accept the previous secret for twenty-four hours during rotation.");
    expect(accepted?.basisFindingIds).toEqual([seeded.evidence.id]);
    // The cited finding was withdrawn, so this accepted decision needs review.
    expect(accepted?.needsReview).toBe(true);
    expect(accepted?.needsReviewFindingIds).toEqual([seeded.evidence.id]);
    expect(accepted?.provenance.createdBy).toEqual(HUMAN1);

    // A superseded decision is a member with its exact stored lifecycle, and it
    // never carries needsReview.
    const superseded = set?.members.find((row) => row.id === seeded.retired.id);
    expect(superseded?.lifecycle).toBe("superseded");
    expect(superseded?.needsReview).toBeUndefined();
    expect(superseded?.needsReviewFindingIds).toBeUndefined();

    // A cross-workspace relationship id is dropped from a member exactly as it
    // is dropped from a section hit.
    const linked = set?.members.find((row) => row.id === "dec_link");
    expect(linked?.lifecycle).toBe("proposed");
    expect(linked?.predecessorId).toBeUndefined();
    expect(linked?.successorId).toBeUndefined();
    expect(set?.members.find((row) => row.id === seeded.accepted.id)?.basisFindingIds).not.toContain(
      seeded.foreignFinding.id,
    );
    expect(JSON.stringify(recall.decisionSet)).not.toContain(seeded.foreignDecision.id);

    // Two accepted decisions and no recorded transition between them.
    expect(set?.state).toBe("unresolved-accepted-decisions");
    expect(set?.operativeDecisionId).toBeUndefined();
    expect(set?.recordedTransitions).toEqual([]);
    expect(set?.beforeActing).toBe(
      "Campfire has not selected an operative decision. Do not execute either rule. Seek a recorded retirement of one accepted decision, or an accepted replacement that names its predecessor and is accepted with a reason.",
    );
  });

  it("keeps artifact uri, metadata, notes, and reasons out of the decision set", () => {
    const seeded = seedRecall();
    const recall = service.recallWorkspace(ctxHuman1, { workspaceId: seeded.workspace.id, query: QUERY });
    const packedSet = JSON.stringify(recall.decisionSet);
    for (const secret of [SECRET_URI, SECRET_META, SECRET_NOTE, SECRET_REASON]) {
      expect(packedSet).not.toContain(secret);
    }
    // A query for a secret matches nothing, so the set is empty and safe.
    for (const secret of [SECRET_URI, SECRET_META, SECRET_NOTE, SECRET_REASON]) {
      const missed = service.recallWorkspace(ctxHuman1, { workspaceId: seeded.workspace.id, query: secret });
      expect(missed.decisionSet?.members).toEqual([]);
      expect(missed.decisionSet?.state).toBe("no-accepted-decision");
      expect(missed.decisionSet?.operativeDecisionId).toBeUndefined();
      expect(missed.decisionSet?.beforeActing).toBeUndefined();
      expect(JSON.stringify(missed.decisionSet)).not.toContain(secret);
    }
  });

  it("resolves the set from a real accepted replacement and names the survivor", () => {
    // One accepted decision to start, so the replacement resolves the set rather
    // than leaving a second accepted decision to argue with.
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Replacement" });
    service.inviteToWorkspace(ctxHuman1, { workspaceId: workspace.id, actor: HUMAN3, role: "viewer" });
    service.joinWorkspace(ctxHuman3, { workspaceId: workspace.id });
    const original = service.acceptDecision(
      ctxHuman1,
      service.addDecision(ctxHuman1, {
        workspaceId: workspace.id,
        summary: "partner callback original rule",
        rationale: "Use the original rule.",
      }).id,
    );

    const before = service.recallWorkspace(ctxHuman1, { workspaceId: workspace.id, query: QUERY });
    expect(before.decisionSet?.state).toBe("single-accepted-decision");
    expect(before.decisionSet?.operativeDecisionId).toBe(original.id);
    expect(before.decisionSet?.beforeActing).toBeUndefined();

    // The real path: propose with a predecessor, then accept it with a reason.
    const replacement = service.addDecision(ctxHuman1, {
      workspaceId: workspace.id,
      summary: "partner callback replacement rule",
      rationale: "Adopt the replacement rule for partner callbacks.",
      replacesDecisionId: original.id,
    });
    service.acceptDecision(ctxHuman1, replacement.id, { reason: "recorded replacement" });

    const after = service.recallWorkspace(ctxHuman1, { workspaceId: workspace.id, query: QUERY });
    const set = after.decisionSet;
    expect(set?.state).toBe("linked-accepted-decisions");
    expect(set?.recordedTransitions).toEqual([
      { supersededDecisionId: original.id, supersedingDecisionId: replacement.id },
    ]);
    expect(set?.members.map((row) => row.id)).toEqual(expect.arrayContaining([original.id, replacement.id]));
    expect(set?.operativeDecisionId).toBe(replacement.id);
    // The recorded replacement resolves the set, so no instruction is emitted.
    expect(set?.beforeActing).toBeUndefined();
    expect(set?.members.find((row) => row.id === original.id)?.lifecycle).toBe("superseded");
    expect(set?.members.find((row) => row.id === original.id)?.successorId).toBe(replacement.id);
    expect(set?.members.find((row) => row.id === replacement.id)?.predecessorId).toBe(original.id);

    // The packet carries the same resolution so an offline recipient can follow it.
    const packet = service.projectHandoffPacket(ctxHuman1, {
      workspaceId: workspace.id,
      query: QUERY,
      recipient: HUMAN3,
    });
    expect(packet.decisionSet?.state).toBe("linked-accepted-decisions");
    expect(packet.decisionSet?.operativeDecisionId).toBe(replacement.id);
    expect(packet.decisionSet?.recordedTransitions).toEqual([
      { supersededDecisionId: original.id, supersedingDecisionId: replacement.id },
    ]);
    expect(packet.decisionSet?.beforeActing).toBeUndefined();
    expect(packet.decisionSet?.members.map((row) => row.id)).toEqual(
      expect.arrayContaining([original.id, replacement.id]),
    );
    // This case must not degenerate into "always ask for a review".
    expect(packet.decisionSet?.beforeActing).toBeUndefined();
    expect(packet.decisionSet?.linkedNextStep).toBe(DECISION_SET_LINKED_NEXT_STEP);
    expect(packet.decisionSet?.members.find((row) => row.id === replacement.id)?.rationale).toBe(
      "Adopt the replacement rule for partner callbacks.",
    );
    expect(packet.decisionSet?.members.find((row) => row.id === replacement.id)?.section).toBe("current");
    // The predecessor is historical in the grouped set too, and its stored
    // rationale is not emitted under `rationale` there.
    const supersededRow = packet.decisionSet?.members.find((row) => row.id === original.id);
    expect(supersededRow?.section).toBe("historical");
    expect(supersededRow).not.toHaveProperty("rationale");
    expect(supersededRow?.historicalExplanation).toContain(original.id);
  });

  it("never promotes a superseded decision's rationale into a live condition in the packet", () => {
    // The RCL-003 S2 failure, reproduced through the real service path. The
    // predecessor's rationale holds a precondition clause that the accepted
    // replacement never mentions. The recipient read both rationales from the
    // same field and applied the clause as a current release condition.
    const clause =
      "Keep the 02:00 job disabled until two on-request releases have run with no operator escalation.";
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Promotion" });
    service.inviteToWorkspace(ctxHuman1, { workspaceId: workspace.id, actor: HUMAN3, role: "viewer" });
    service.joinWorkspace(ctxHuman3, { workspaceId: workspace.id });
    const predecessor = service.acceptDecision(
      ctxHuman1,
      service.addDecision(ctxHuman1, {
        workspaceId: workspace.id,
        summary: "partner callback window rule",
        rationale: clause,
      }).id,
    );
    const replacement = service.addDecision(ctxHuman1, {
      workspaceId: workspace.id,
      summary: "partner callback window rule replacement",
      rationale: "Adopt the replacement rule for partner callbacks.",
      replacesDecisionId: predecessor.id,
    });
    service.acceptDecision(ctxHuman1, replacement.id, { reason: "recorded replacement" });

    const packet = service.projectHandoffPacket(ctxHuman1, {
      workspaceId: workspace.id,
      query: QUERY,
      recipient: HUMAN3,
    });
    expect(packet.decisionSet?.state).toBe("linked-accepted-decisions");
    expect(packet.decisionSet?.operativeDecisionId).toBe(replacement.id);
    expect(packet.decisionSet?.linkedNextStep).toBe(DECISION_SET_LINKED_NEXT_STEP);

    const setMembers = packet.decisionSet?.members ?? [];
    expect(setMembers.map((row) => row.id).sort()).toEqual([predecessor.id, replacement.id].sort());
    // No superseded member carries a `rationale`, so the clause has no path
    // into the grouped view under the field a reader acts on.
    for (const row of setMembers.filter((entry) => entry.lifecycle === "superseded")) {
      expect(row).not.toHaveProperty("rationale");
      expect(row).not.toHaveProperty("rationaleTruncated");
      expect(row.section).toBe("historical");
      expect(row.historicalExplanation).toContain(row.id);
    }
    // The clause is not reachable anywhere inside `decisionSet`: not in a field,
    // not in the summary, not in the explanation.
    expect(JSON.stringify(packet.decisionSet)).not.toContain("two on-request releases");
    // `records` still carries it, correctly labelled `historical`: the flat
    // section split is the durable record and is not what this projection drops.
    expect(JSON.stringify(packet.records)).toContain("two on-request releases");
    const flatPredecessor = packet.records.find((row) => row.id === predecessor.id);
    expect(flatPredecessor?.section).toBe("historical");
  });
});

describe("recall bounds and parity", () => {
  it("keeps the shared placeholder order and the same SQLite and D1 ranking", async () => {
    const goal = recallGoalSql("ws_1", "callback");
    expect(goal.params).toEqual(["callback", "callback", "callback", "callback", "callback", "callback", "ws_1"]);
    const section = recallSectionSql("ws_1", "current", { normalizedQuery: "callback", limit: 20 });
    expect(section.params.slice(0, 3)).toEqual(["ws_1", "ws_1", "ws_1"]);
    expect(section.params.slice(3, 9)).toEqual(["callback", "callback", "callback", "callback", "callback", "callback"]);
    expect(section.params.at(-1)).toBe(21);

    const sqlite = openInMemoryStore();
    const adapter = sqliteD1();
    try {
      await migrateD1(adapter.binding);
      const remote = createD1Store(adapter.binding);
      await seedRank(sqlite);
      await seedRank(remote);
      for (const name of ["current", "historical", "artifacts"] as const) {
        const left = sqlite.recallSection("ws_1", name, { normalizedQuery: "callback", limit: 10 });
        const right = await remote.recallSection("ws_1", name, { normalizedQuery: "callback", limit: 10 });
        expect(right.total).toBe(left.total);
        expect(right.items.map((item) => [item.id, item.tier, item.kind])).toEqual(
          left.items.map((item) => [item.id, item.tier, item.kind]),
        );
      }
      expect(sqlite.recallGoal("ws_1", "callback")?.matched).toBe(true);
      expect((await remote.recallGoal("ws_1", "callback"))?.matched).toBe(true);
      expect(sqlite.recallSection("ws_1", "artifacts", { normalizedQuery: SECRET_URI, limit: 10 }).items).toEqual([]);
      expect((await remote.recallSection("ws_1", "artifacts", { normalizedQuery: SECRET_URI, limit: 10 })).items).toEqual([]);
    } finally {
      sqlite.close();
      adapter.database.close();
    }
  });

  it("returns the same decision set rows in the same order on SQLite and D1", async () => {
    const sqlite = openInMemoryStore();
    const adapter = sqliteD1();
    try {
      await migrateD1(adapter.binding);
      const remote = createD1Store(adapter.binding);
      await seedRank(sqlite);
      await seedRank(remote);

      const left = sqlite.recallDecisionSet("ws_1", { normalizedQuery: "callback", limit: RECALL_DECISION_SET_LIMIT });
      const right = await remote.recallDecisionSet("ws_1", { normalizedQuery: "callback", limit: RECALL_DECISION_SET_LIMIT });
      expect(right.total).toBe(left.total);
      expect(right.hasMore).toBe(left.hasMore);
      expect(right.members.map((row) => [row.id, row.tier, row.lifecycle])).toEqual(
        left.members.map((row) => [row.id, row.tier, row.lifecycle]),
      );
      expect(right.members.map((row) => row.id)).toEqual(left.members.map((row) => row.id));
      // Both ends of the recorded replacement are inside the set on both
      // engines, in rcl-1 order: same tier, so the newer decision ranks first.
      expect(left.members.map((row) => row.id)).toEqual(["dec_new", "dec_old"]);
      expect(left.members.map((row) => row.lifecycle)).toEqual(["accepted", "superseded"]);
      expect(left.members.find((row) => row.id === "dec_old")?.successorId).toBe("dec_new");
      expect(left.members.find((row) => row.id === "dec_new")?.predecessorId).toBe("dec_old");
      expect(right.members.find((row) => row.id === "dec_old")?.successorId).toBe("dec_new");
      expect(right.members.find((row) => row.id === "dec_new")?.predecessorId).toBe("dec_old");
      // The set never selects artifact columns.
      const setSql = recallDecisionSetSql("ws_1", { normalizedQuery: "callback", limit: 10 }).sql;
      expect(setSql).toContain("norm_primary");
      expect(setSql).toContain("LIMIT");
      expect(setSql).toContain("workspace_id");
      expect(setSql).not.toContain("uri_or_path");
      expect(setSql).not.toContain("metadata");
      expect(setSql).not.toContain("payload");
      expect(setSql).not.toContain("LIKE");
      expect(countRecallDecisionSetSql("ws_1", "callback").sql).not.toContain("uri_or_path");

      // A cut set reports the same total on both engines.
      const cappedLeft = sqlite.recallDecisionSet("ws_1", { normalizedQuery: "callback", limit: 1 });
      const cappedRight = await remote.recallDecisionSet("ws_1", { normalizedQuery: "callback", limit: 1 });
      expect(cappedRight.total).toBe(cappedLeft.total);
      expect(cappedRight.hasMore).toBe(cappedLeft.hasMore);
      expect(cappedRight.members.map((row) => row.id)).toEqual(cappedLeft.members.map((row) => row.id));
      expect(cappedLeft.hasMore).toBe(true);
      expect(cappedLeft.total).toBe(2);
    } finally {
      sqlite.close();
      adapter.database.close();
    }
  });

  it("limits a 10,000-row workspace in SQL", () => {
    const queries: string[] = [];
    const bulk = openInMemoryStore({ observeQuery: (sql) => queries.push(sql) });
    const bulkService = createCampfireService({ store: bulk, idSource: createCounterIdSource(), clock: createClock() });
    try {
      bulk.createOrganization({ id: "org_1", name: "Org", createdAt: NOW });
      bulk.createTeam({ id: "team_1", organizationId: "org_1", name: "Team", createdAt: NOW });
      bulk.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
      bulk.createHuman({ id: "hum_2", teamId: "team_1", displayName: "Grace", createdAt: NOW });
      const workspace = bulkService.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Bulk" });
      const other = bulkService.createWorkspace(ctxHuman2, { teamId: "team_1", name: "Elsewhere" });
      bulk.createFinding({
        id: "find_other",
        workspaceId: other.id,
        summary: "needle",
        currentness: "current",
        createdBy: HUMAN2,
        createdAt: NOW,
      });
      bulk.transaction(() => {
        for (let index = 0; index < 10_000; index += 1) {
          bulk.createFinding({
            id: `f_${String(index).padStart(5, "0")}`,
            workspaceId: workspace.id,
            summary: "needle",
            currentness: "current",
            createdBy: HUMAN1,
            createdAt: NOW,
          });
        }
      });
      queries.length = 0;
      const page = bulkService.recallWorkspace(ctxHuman1, { workspaceId: workspace.id, query: "needle", limit: 5 });
      expect(page.current.total).toBe(10_000);
      expect(page.current.returned).toBe(5);
      expect(page.current.truncated).toBe(true);
      expect(page.current.items.map((item) => item.id)).toEqual(["f_00000", "f_00001", "f_00002", "f_00003", "f_00004"]);
      const recallSql = queries.filter((sql) => sql.includes("norm_primary"));
      expect(recallSql.length).toBeGreaterThan(0);
      expect(recallSql.some((sql) => sql.includes("LIMIT"))).toBe(true);
      expect(recallSql.every((sql) => sql.includes("workspace_id"))).toBe(true);
      expect(recallSql.join("\n")).not.toContain("uri_or_path");
      expect(recallSql.join("\n")).not.toContain("metadata");
      expect(recallSql.join("\n")).not.toContain("payload");
    } finally {
      bulkService.close();
    }
  }, 60_000);

  it("drops artifact hits before historical hits when the recall document exceeds 48 KiB", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Cap" });
    const marker = `recallcap${"q".repeat(80)}`;
    const text = `${"p".repeat(80)}${marker}${"s".repeat(80)}`;
    store.transaction(() => {
      for (let index = 0; index < 40; index += 1) {
        const createdAt = new Date(Date.parse("2026-06-01T00:00:00.000Z") + index * 1000).toISOString();
        store.createFinding({
          id: `find_cap_${String(index).padStart(2, "0")}`,
          workspaceId: workspace.id,
          summary: text,
          createdBy: HUMAN1,
          createdAt,
        });
        store.createTask({
          id: `task_cap_${String(index).padStart(2, "0")}`,
          workspaceId: workspace.id,
          title: text,
          status: "completed",
          createdBy: HUMAN1,
          createdAt,
          updatedAt: createdAt,
        });
        store.createArtifact({
          id: `art_cap_${String(index).padStart(2, "0")}`,
          workspaceId: workspace.id,
          type: "log",
          title: text,
          uriOrPath: `file:///cap-${index}`,
          createdBy: HUMAN1,
          createdAt,
        });
      }
    });
    const recall = service.recallWorkspace(ctxHuman1, { workspaceId: workspace.id, query: marker, limit: 40 });
    expect(jsonByteLength(recall)).toBeLessThanOrEqual(RECALL_RESPONSE_MAX_BYTES);
    expect(recall.completeness.responseTruncated).toBe(true);
    expect(recall.artifacts.returned).toBeLessThan(recall.artifacts.total);
    expect(recall.current.total).toBe(40);
    expect(recall.historical.total).toBe(40);
    if (recall.historical.returned < recall.historical.total) {
      expect(recall.artifacts.items).toEqual([]);
    }
    expect(JSON.stringify(recall)).not.toContain("file:///cap-");
  });

  it("drops a D1 page when the append position moves during the read", async () => {
    const sync = openInMemoryStore();
    const asyncStore = wrapSync(sync);
    let bumped = false;
    const storeProxy = new Proxy(asyncStore, {
      get(target, prop, receiver) {
        if (prop === "recallSection") {
          const original = Reflect.get(target, prop, receiver) as (...args: unknown[]) => Promise<unknown>;
          return async (...args: unknown[]) => {
            const page = await original(...args);
            if (!bumped) {
              bumped = true;
              sync.createContribution({
                id: "con_bump",
                workspaceId: String(args[0]),
                actor: HUMAN1,
                action: "create",
                objectType: "task",
                objectId: "task_bump",
                createdAt: NOW,
              });
            }
            return page;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as AsyncCampfireStore;
    const asyncService = createAsyncCampfireService({
      store: storeProxy,
      idSource: createCounterIdSource(),
      clock: createClock(),
    });
    try {
      await storeProxy.createOrganization({ id: "org_1", name: "Org", createdAt: NOW });
      await storeProxy.createTeam({ id: "team_1", organizationId: "org_1", name: "Team", createdAt: NOW });
      await storeProxy.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
      const workspace = await asyncService.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Moving" });
      await asyncService.createTask(ctxHuman1, { workspaceId: workspace.id, title: "partner callback" });
      await expect(
        asyncService.recallWorkspace(ctxHuman1, { workspaceId: workspace.id, query: QUERY }),
      ).rejects.toMatchObject({
        code: "RecallRestart",
        details: { workspaceId: workspace.id, field: "cursor" },
      });
      expect(bumped).toBe(true);
    } finally {
      sync.close();
    }
  });

  it("does not return rows when the async read sees a new append position", async () => {
    let reads = 0;
    await expect(
      projectRecallAsync(
        {
          maxAppendPosition: async () => {
            reads += 1;
            return reads;
          },
          getWorkspace: async () => ({
            id: "ws_1",
            teamId: "team_1",
            name: "W",
            status: "active",
            createdBy: HUMAN1,
            createdAt: NOW,
            updatedAt: NOW,
          }),
          recallGoal: async () => undefined,
          recallSection: async () => ({
            items: [
              {
                kind: "task",
                id: "task_secret_row",
                tier: 0,
                recency: NOW,
                primaryText: "do not return this mixed row",
                lifecycle: "open",
                createdByActorId: "hum_1",
                createdByActorType: "human",
                createdAt: NOW,
              },
            ],
            total: 1,
            hasMore: false,
          }),
          // A set member that matches the query, so a read that did not throw
          // would leak the mixed row through the set instead of the sections.
          recallDecisionSet: async () => ({
            members: [
              {
                id: "dec_secret_row",
                tier: 2,
                summary: `partner callback ${QUERY}`,
                lifecycle: "accepted",
                createdByActorId: "hum_1",
                createdByActorType: "human",
                createdAt: NOW,
              },
            ],
            total: 1,
            hasMore: false,
          }),
          listFindingEvidence: async () => [],
          listDecisionCitations: async () => [],
          listStaleCitedFindingIds: async () => [],
          getFinding: async () => undefined,
          getDecision: async () => undefined,
          getArtifact: async () => undefined,
          pageTasks: async () => ({ items: [], total: 0, hasMore: false }),
          pageDecisions: async () => ({ items: [], total: 0, hasMore: false }),
        },
        {
          workspaceId: "ws_1",
          queryText: QUERY,
          normalizedQuery: QUERY,
          limit: 20,
          generatedAt: NOW,
          includeAnchors: false,
        },
      ),
    ).rejects.toBeInstanceOf(RecallRestart);
    expect(reads).toBe(2);
  });
});

describe("recall surfaces stay closed", () => {
  it("leaves viewer methods, delivery, and telemetry allow-lists unchanged", async () => {
    expect(VIEWER_READ_METHODS).not.toContain("recall_workspace");
    expect(VIEWER_READ_METHODS).not.toContain("project_handoff_packet");
    expect(isDeliveryEligibleMethod("recall_workspace")).toBe(false);
    expect(isDeliveryEligibleMethod("project_handoff_packet")).toBe(false);
    const { readFileSync } = await import("node:fs");
    const tools = readFileSync(new URL("../../src/mcp/tools.ts", import.meta.url), "utf8");
    const activation = tools.slice(tools.indexOf("ACTIVATION_METHODS"), tools.indexOf("ACTIVITY_METHODS"));
    const activity = tools.slice(tools.indexOf("ACTIVITY_METHODS"), tools.indexOf("function reportMcpSuccess"));
    expect(activation).not.toContain("recall_workspace");
    expect(activity).not.toContain("recall_workspace");
    expect(tools).toContain("Does not write a handoff file");
  });
});

describe("recall HTTP restart", () => {
  it("maps RecallRestart to 409 on the local server and the worker", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rcl-http-"));
    const runtime = createRuntimeFromPath(join(dir, "campfire.db"));
    const server = await startCampfireHttpServer({ runtime, host: "127.0.0.1", port: 0 });
    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((chunk?: unknown) => {
      errors.push(String(chunk));
    });
    try {
      runtime.store.createOrganization({ id: "org_1", name: "Org", createdAt: NOW });
      runtime.store.createTeam({ id: "team_1", organizationId: "org_1", name: "Team", createdAt: NOW });
      const created = runtime.service.createHuman(undefined, { teamId: "team_1", displayName: "Ada" });
      const ctx = { actor: { actorId: created.human.id, actorType: "human" as const } };
      const workspace = runtime.service.createWorkspace(ctx, { teamId: "team_1", name: "HTTP" });
      runtime.service.createTask(ctx, { workspaceId: workspace.id, title: "visible-task-title" });
      const query = "query-sentinel-do-not-log";
      await expect(
        campfireHttpCall({
          baseUrl: server.url,
          token: created.token,
          method: "recall_workspace",
          params: {
            workspaceId: workspace.id,
            query,
            cursor: cursor({ workspaceId: workspace.id, query, sourcePosition: 999_999 }),
          },
        }),
      ).rejects.toMatchObject({ code: "RecallRestart", details: { httpStatus: 409 } });
      const found = await campfireHttpCall<{ current: { items: Array<{ id: string }> } }>({
        baseUrl: server.url,
        token: created.token,
        method: "recall_workspace",
        params: { workspaceId: workspace.id, query: "visible-task-title" },
      });
      expect(found.current.items).toHaveLength(1);
      const nbsp = await campfireHttpCall<{ current: { total: number } }>({
        baseUrl: server.url,
        token: created.token,
        method: "recall_workspace",
        params: { workspaceId: workspace.id, query: "\u00A0visible-task-title" },
      });
      expect(nbsp.current.total).toBe(0);
      expect(errors.join("\n")).not.toContain(query);
      expect(errors.join("\n")).not.toContain("visible-task-title");

      const sync = openInMemoryStore();
      const workerStore = wrapSync(sync);
      const workerService = createAsyncCampfireService({
        store: workerStore,
        idSource: createCounterIdSource(),
        clock: () => NOW,
      });
      const handle = createD1WorkerHandler({ store: workerStore });
      try {
        await workerStore.createOrganization({ id: "org_1", name: "Org", createdAt: NOW });
        await workerStore.createTeam({ id: "team_1", organizationId: "org_1", name: "Team", createdAt: NOW });
        const human = await workerService.createHuman(undefined, { teamId: "team_1", displayName: "Ada" });
        const workerCtx = { actor: { actorId: human.human.id, actorType: "human" as const } };
        const workerWorkspace = await workerService.createWorkspace(workerCtx, { teamId: "team_1", name: "Worker" });
        await workerService.createTask(workerCtx, { workspaceId: workerWorkspace.id, title: "visible-task-title" });
        const response = await handle(
          new Request("https://campfire.test/v1/call", {
            method: "POST",
            headers: {
              authorization: `Bearer ${human.token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              method: "recall_workspace",
              params: {
                workspaceId: workerWorkspace.id,
                query,
                cursor: cursor({ workspaceId: workerWorkspace.id, query, sourcePosition: 999_999 }),
              },
            }),
          }),
        );
        const body = (await response.json()) as { ok: boolean; error: string; message: string };
        expect(response.status).toBe(409);
        expect(body.error).toBe("RecallRestart");
        expect(JSON.stringify(body)).not.toContain(query);
        expect(JSON.stringify(body)).not.toContain("visible-task-title");
      } finally {
        sync.close();
      }
    } finally {
      errorSpy.mockRestore();
      await server.close();
      runtime.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

async function seedRank(target: CampfireStore | AsyncCampfireStore): Promise<void> {
  await target.createOrganization({ id: "org_1", name: "Org", createdAt: NOW });
  await target.createTeam({ id: "team_1", organizationId: "org_1", name: "Team", createdAt: NOW });
  await target.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
  await target.createWorkspace({
    id: "ws_1",
    teamId: "team_1",
    name: "Workspace",
    status: "active",
    createdBy: HUMAN1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await target.createGoal({
    id: "goal_1",
    workspaceId: "ws_1",
    title: "Callback goal",
    status: "active",
    createdBy: HUMAN1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await target.createTask({
    id: "task_exact",
    workspaceId: "ws_1",
    title: "callback",
    status: "open",
    createdBy: HUMAN1,
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  });
  await target.createTask({
    id: "task_prefix",
    workspaceId: "ws_1",
    title: "callback extra",
    status: "open",
    createdBy: HUMAN1,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  });
  await target.createTask({
    id: "task_done",
    workspaceId: "ws_1",
    title: "callback done",
    status: "completed",
    createdBy: HUMAN1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });
  await target.createFinding({
    id: "find_sec",
    workspaceId: "ws_1",
    summary: "other",
    detail: "callback",
    currentness: "current",
    createdBy: HUMAN1,
    createdAt: "2026-01-02T00:00:00.000Z",
  });
  await target.createArtifact({
    id: "art_1",
    workspaceId: "ws_1",
    type: "log",
    title: "callback doc",
    uriOrPath: SECRET_URI,
    createdBy: HUMAN1,
    createdAt: NOW,
  });
  // A recorded replacement, so the decision set has both a superseded and an
  // accepted member and both ends of a transition inside the set. The link is
  // written through the real transition claim, exactly as COR-001 does.
  await target.createDecision({
    id: "dec_old",
    workspaceId: "ws_1",
    summary: "callback old rule",
    rationale: "the superseded reason",
    status: "accepted",
    createdBy: HUMAN1,
    createdAt: "2026-01-03T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
  });
  await target.createDecision({
    id: "dec_new",
    workspaceId: "ws_1",
    summary: "callback new rule",
    rationale: "the accepted reason",
    status: "accepted",
    predecessorId: "dec_old",
    createdBy: HUMAN1,
    createdAt: "2026-01-04T00:00:00.000Z",
    updatedAt: "2026-01-04T00:00:00.000Z",
  });
  await target.claimDecisionTransition({
    decisionId: "dec_old",
    successorId: "dec_new",
    kind: "superseded",
    reason: "recorded replacement",
    actor: HUMAN1,
    createdAt: "2026-01-04T00:00:00.000Z",
  });
}

function wrapSync(syncStore: CampfireStore): AsyncCampfireStore {
  return new Proxy(syncStore, {
    get(target, prop, receiver) {
      if (prop === "transaction") {
        return (fn: () => Promise<unknown>) => fn();
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => Promise.resolve((value as (...inner: unknown[]) => unknown).apply(target, args));
    },
  }) as unknown as AsyncCampfireStore;
}
