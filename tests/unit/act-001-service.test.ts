/**
 * ACT-001 Step 1 core: authority matrix, immutable approval, lifecycle,
 * reservation, receipts, idempotency, and bounded reads on the sync service.
 *
 * Denied calls commit no state: contribution counts are asserted around
 * representative denials. No provider network call exists in this path.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import type { ActorContext } from "../../src/service/authorization.js";
import type { ActorRef } from "../../src/domain/types.js";
import {
  ActionProposalNotFound,
  ActorNotFound,
  Conflict,
  CrossWorkspaceReference,
  InvalidTransition,
  ParticipantRequired,
  TaskNotFound,
  Unauthorized,
  ValidationError,
} from "../../src/domain/errors.js";

const NOW = "2026-10-21T12:00:00.000Z";

const OWNER: ActorRef = { actorId: "hum_owner", actorType: "human" };
const MEMBER: ActorRef = { actorId: "hum_member", actorType: "human" };
const EXEC: ActorRef = { actorId: "hum_exec", actorType: "human" };
const VIEWER: ActorRef = { actorId: "hum_viewer", actorType: "human" };
const OUTSIDER: ActorRef = { actorId: "hum_outsider", actorType: "human" };
const AGENT_OWNER: ActorRef = { actorId: "agt_owner", actorType: "agent" };
const AGENT_MEMBER: ActorRef = { actorId: "agt_member", actorType: "agent" };
const AGENT_EXEC: ActorRef = { actorId: "agt_exec", actorType: "agent" };
const AGENT_VIEWER: ActorRef = { actorId: "agt_viewer", actorType: "agent" };

const TARGET = {
  repositoryId: "123",
  repositoryName: "acme/api",
  workflowId: "456",
  runId: "789",
  commitSha: "a".repeat(40),
  expectedAttempt: 1,
};

const PROVIDER_REF = { repositoryId: "123", workflowId: "456", runId: "789" };

function targetWithAttempt(attempt: number) {
  return { ...TARGET, runId: `79${attempt}`, expectedAttempt: attempt };
}

let store: CampfireStore;
let service: CampfireService;
let nowMs: number;
let keySeq: number;

function clock(): string {
  nowMs += 1000;
  return new Date(nowMs).toISOString();
}

function ctx(actor: ActorRef, agentSessionId?: string): ActorContext {
  return agentSessionId === undefined ? { actor } : { actor, agentSessionId };
}

beforeEach(() => {
  store = openInMemoryStore();
  nowMs = Date.parse(NOW);
  keySeq = 0;
  service = createCampfireService({ store, idSource: createCounterIdSource(), clock });

  store.createOrganization({ id: "org_1", name: "o", createdAt: NOW });
  store.createTeam({ id: "team_1", organizationId: "org_1", name: "t", createdAt: NOW });
  for (const [id, name] of [
    ["hum_owner", "Owner"],
    ["hum_member", "Member"],
    ["hum_exec", "Exec"],
    ["hum_viewer", "Viewer"],
    ["hum_outsider", "Outsider"],
    ["hum_other", "Other"],
  ] as const) {
    store.createHuman({ id, teamId: "team_1", displayName: name, createdAt: NOW });
  }
  for (const [id, humanId, name, harness] of [
    ["agt_owner", "hum_owner", "owner-agent", "codex"],
    ["agt_member", "hum_member", "member-agent", "codex"],
    ["agt_exec", "hum_member", "exec-agent", "opencode"],
    ["agt_viewer", "hum_viewer", "viewer-agent", "codex"],
  ] as const) {
    store.createAgent({ id, teamId: "team_1", humanId, name, harness, createdAt: NOW });
  }
});

afterEach(() => {
  service.close();
});

function nextKey(): string {
  keySeq += 1;
  return `key-${keySeq}`;
}

interface Fixture {
  ws: string;
  ws2: string;
  task: string;
  finding: string;
  artifact: string;
  task2: string;
}

function arrange(): Fixture {
  const ws = service.createWorkspace(ctx(OWNER), { teamId: "team_1", name: "w" }).id;
  const grant = (actor: ActorRef, role: "owner" | "member" | "agent" | "viewer") => {
    service.inviteToWorkspace(ctx(OWNER), { workspaceId: ws, actor, role });
    service.joinWorkspace(ctx(actor), { workspaceId: ws });
  };
  grant(MEMBER, "member");
  grant(EXEC, "member");
  grant(VIEWER, "viewer");
  grant(AGENT_OWNER, "owner");
  grant(AGENT_MEMBER, "member");
  grant(AGENT_EXEC, "member");
  grant(AGENT_VIEWER, "viewer");
  const ws2 = service.createWorkspace(ctx(OWNER), { teamId: "team_1", name: "w2" }).id;
  const task = service.createTask(ctx(OWNER), { workspaceId: ws, title: "fix ci" }).id;
  const finding = service.addFinding(ctx(OWNER), { workspaceId: ws, summary: "flaky test observed" }).id;
  const artifact = service.addArtifact(ctx(OWNER), {
    workspaceId: ws,
    type: "log",
    title: "run log",
    uriOrPath: "logs/run.txt",
  }).id;
  const task2 = service.createTask(ctx(OWNER), { workspaceId: ws2, title: "other work" }).id;
  return { ws, ws2, task, finding, artifact, task2 };
}

function agentSession(agent: ActorRef, workspaceId: string): string {
  return service.registerAgentSession(ctx(agent), {
    agentId: agent.actorId,
    workspaceId,
    harness: "codex",
  }).id;
}

function proposeAs(
  actor: ActorRef,
  ws: string,
  task: string,
  finding: string,
  overrides: Record<string, unknown> = {},
  sessionId?: string,
) {
  return service.propose_action(ctx(actor, sessionId), {
    workspaceId: ws,
    target: { ...TARGET },
    executor: { ...EXEC },
    reason: "retry the failed verification",
    taskId: task,
    findingIds: [finding],
    requestKey: nextKey(),
    ...overrides,
  });
}

function approveAs(proposalId: string, revision: number, digest: string, ws: string, key?: string) {
  return service.review_action(ctx(OWNER), {
    workspaceId: ws,
    proposalId,
    revision,
    intentDigest: digest,
    decision: "approve",
    requestKey: key ?? nextKey(),
  });
}

function reserveAs(actor: ActorRef, proposalId: string, revision: number, digest: string, ws: string, key?: string) {
  return service.reserve_action_execution(ctx(actor), {
    workspaceId: ws,
    proposalId,
    revision,
    intentDigest: digest,
    requestKey: key ?? nextKey(),
  });
}

function reportAs(
  actor: ActorRef,
  proposalId: string,
  revision: number,
  digest: string,
  ws: string,
  outcome: "accepted" | "definite_failure" | "unknown" | "reconciled_accepted" | "reconciled_failure" = "accepted",
  extra: Record<string, unknown> = {},
  key?: string,
) {
  return service.record_action_outcome(ctx(actor), {
    workspaceId: ws,
    proposalId,
    revision,
    intentDigest: digest,
    outcome,
    providerRef: { ...PROVIDER_REF },
    requestKey: key ?? nextKey(),
    ...extra,
  });
}

function contributions(ws: string): number {
  return store.listContributions(ws).length;
}

describe("propose_action", () => {
  it("accepts owner, member, and agent proposals and records provenance without a domain event", () => {
    const f = arrange();
    const eventsBefore = store.listDomainEventsForWorkspace(f.ws).length;
    const byOwner = proposeAs(OWNER, f.ws, f.task, f.finding);
    expect(byOwner.proposal.status).toBe("proposed");
    expect(byOwner.proposal.revision).toBe(1);
    expect(byOwner.proposal.proposedBy).toEqual(OWNER);
    const ses = agentSession(AGENT_MEMBER, f.ws);
    const byAgent = proposeAs(AGENT_MEMBER, f.ws, f.task, f.finding, {}, ses);
    expect(byAgent.proposal.proposedBy).toEqual(AGENT_MEMBER);
    expect(byAgent.proposal.proposedSessionId).toBe(ses);
    expect(store.listDomainEventsForWorkspace(f.ws).length).toBe(eventsBefore);
    const writes = store.listContributions(f.ws).filter((c) => c.objectType === "action_proposal");
    expect(writes.length).toBe(2);
    expect(writes.every((c) => c.action === "create")).toBe(true);
  });

  it("denies viewers, non-participants, and wrong workspaces without committing state", () => {
    const f = arrange();
    const viewerSes = agentSession(AGENT_VIEWER, f.ws);
    const before = contributions(f.ws);
    expect(() => proposeAs(VIEWER, f.ws, f.task, f.finding)).toThrow(Unauthorized);
    expect(() => proposeAs(AGENT_VIEWER, f.ws, f.task, f.finding, {}, viewerSes)).toThrow(Unauthorized);
    expect(() => proposeAs(OUTSIDER, f.ws, f.task, f.finding)).toThrow(ParticipantRequired);
    expect(() => proposeAs(OWNER, "ws_missing", f.task, f.finding)).toThrow();
    expect(contributions(f.ws)).toBe(before);
    expect(store.countActionProposals(f.ws)).toBe(0);
  });

  it("validates requestKey, reason, references, executor, expiry, and target", () => {
    const f = arrange();
    const ses = agentSession(AGENT_MEMBER, f.ws);
    const bad = (overrides: Record<string, unknown>) =>
      expect(() => proposeAs(AGENT_MEMBER, f.ws, f.task, f.finding, overrides, ses)).toThrow(ValidationError);
    bad({ requestKey: "" });
    bad({ requestKey: "x".repeat(129) });
    bad({ requestKey: "has space\nnewline" });
    bad({ reason: "" });
    bad({ reason: "x".repeat(501) });
    bad({ findingIds: [] });
    bad({ findingIds: Array.from({ length: 11 }, (_, i) => `find_${i}`) });
    bad({ expiresAt: new Date(Date.parse(NOW) + 25 * 3_600_000).toISOString() });
    bad({ expiresAt: "not-a-time" });
    bad({ target: { ...TARGET, repositoryId: "12x" } });
    bad({ target: { ...TARGET, commitSha: "abc" } });
    bad({ target: { ...TARGET, expectedAttempt: 0 } });
    bad({ target: { ...TARGET, repositoryName: "https://example.com/evil.sh" } });
    expect(() => proposeAs(AGENT_MEMBER, f.ws, f.task, f.finding, {
      executor: { actorId: "hum_ghost", actorType: "human" },
    }, ses)).toThrow(ActorNotFound);
    expect(() => proposeAs(AGENT_MEMBER, f.ws, "task_missing", f.finding, {}, ses)).toThrow(TaskNotFound);
    expect(() => proposeAs(AGENT_MEMBER, f.ws, f.task2, f.finding, {}, ses)).toThrow(CrossWorkspaceReference);
    expect(() => proposeAs(OWNER, f.ws, f.task, f.finding, { findingIds: ["find_missing"] })).toThrow();
    // Cross-workspace citations are rejected, never linked.
    const otherFinding = service.addFinding(ctx(OWNER), { workspaceId: f.ws2, summary: "elsewhere" }).id;
    expect(() => proposeAs(OWNER, f.ws, f.task, otherFinding)).toThrow(CrossWorkspaceReference);
  });

  it("replays equal input and conflicts on unequal input for the same requestKey", () => {
    const f = arrange();
    const first = proposeAs(OWNER, f.ws, f.task, f.finding, { requestKey: "idem-1" });
    // The default expiry embeds the creation clock, so an exact replay
    // resends the recorded expiry alongside the same key.
    const replay = proposeAs(OWNER, f.ws, f.task, f.finding, {
      requestKey: "idem-1",
      expiresAt: first.proposal.expiresAt,
    });
    expect(replay.proposal.id).toBe(first.proposal.id);
    expect(store.countActionProposals(f.ws)).toBe(1);
    expect(() =>
      proposeAs(OWNER, f.ws, f.task, f.finding, {
        requestKey: "idem-1",
        expiresAt: first.proposal.expiresAt,
        reason: "a different reason",
      }),
    ).toThrow(Conflict);
  });

  it("requires an agent session for agent proposers", () => {
    const f = arrange();
    expect(() => proposeAs(AGENT_MEMBER, f.ws, f.task, f.finding)).toThrow(Unauthorized);
  });
});

describe("review_action", () => {
  it("allows a human owner to approve or reject, with reasons required for rejection", () => {
    const f = arrange();
    const p = proposeAs(MEMBER, f.ws, f.task, f.finding);
    const approved = approveAs(p.proposal.id, 1, p.proposal.intentDigest, f.ws);
    expect(approved.proposal.status).toBe("approved");
    expect(approved.proposal.revision).toBe(2);
    expect(approved.proposal.review?.actor).toEqual(OWNER);
    expect(approved.proposal.review?.decision).toBe("approved");
    const q = proposeAs(MEMBER, f.ws, f.task, f.finding);
    expect(() =>
      service.review_action(ctx(OWNER), {
        workspaceId: f.ws,
        proposalId: q.proposal.id,
        revision: 1,
        intentDigest: q.proposal.intentDigest,
        decision: "reject",
        requestKey: nextKey(),
      }),
    ).toThrow(ValidationError);
    const rejected = service.review_action(ctx(OWNER), {
      workspaceId: f.ws,
      proposalId: q.proposal.id,
      revision: 1,
      intentDigest: q.proposal.intentDigest,
      decision: "reject",
      reason: "run already passed on a retry",
      requestKey: nextKey(),
    });
    expect(rejected.proposal.status).toBe("rejected");
  });

  it("denies every non-human-owner path, including agent owners", () => {
    const f = arrange();
    const target = proposeAs(MEMBER, f.ws, f.task, f.finding);
    const ownerSes = agentSession(AGENT_OWNER, f.ws);
    const memberSes = agentSession(AGENT_MEMBER, f.ws);
    const before = contributions(f.ws);
    const attempt = (actor: ActorRef, sessionId?: string) =>
      service.review_action(ctx(actor, sessionId), {
        workspaceId: f.ws,
        proposalId: target.proposal.id,
        revision: 1,
        intentDigest: target.proposal.intentDigest,
        decision: "approve",
        requestKey: nextKey(),
      });
    expect(() => attempt(MEMBER)).toThrow(Unauthorized);
    expect(() => attempt(VIEWER)).toThrow(Unauthorized);
    expect(() => attempt(AGENT_OWNER, ownerSes)).toThrow(Unauthorized);
    expect(() => attempt(AGENT_MEMBER, memberSes)).toThrow(Unauthorized);
    expect(() => attempt(OUTSIDER)).toThrow();
    expect(contributions(f.ws)).toBe(before);
  });

  it("enforces revision, digest, status, evidence freshness, and expiry", () => {
    const f = arrange();
    const p = proposeAs(MEMBER, f.ws, f.task, f.finding);
    const review = (revision: number, digest: string, key?: string) =>
      service.review_action(ctx(OWNER), {
        workspaceId: f.ws,
        proposalId: p.proposal.id,
        revision,
        intentDigest: digest,
        decision: "approve",
        requestKey: key ?? nextKey(),
      });
    expect(() => review(99, p.proposal.intentDigest)).toThrow(Conflict);
    expect(() => review(1, "0".repeat(64))).toThrow(Conflict);
    // Cited evidence changed since proposal: approval must fail.
    service.correctFinding(ctx(OWNER), {
      findingId: f.finding,
      summary: "flaky test observed",
      reason: "confirmed on the second run",
    });
    expect(() => review(1, p.proposal.intentDigest)).toThrow(Conflict);
    // Fresh evidence approves; a second approval is a forbidden reversal.
    const fresh = proposeAs(MEMBER, f.ws, f.task, f.finding);
    const ok = service.review_action(ctx(OWNER), {
      workspaceId: f.ws,
      proposalId: fresh.proposal.id,
      revision: 1,
      intentDigest: fresh.proposal.intentDigest,
      decision: "approve",
      requestKey: nextKey(),
    });
    expect(ok.proposal.status).toBe("approved");
    expect(() =>
      service.review_action(ctx(OWNER), {
        workspaceId: f.ws,
        proposalId: fresh.proposal.id,
        revision: 2,
        intentDigest: fresh.proposal.intentDigest,
        decision: "approve",
        requestKey: nextKey(),
      }),
    ).toThrow(InvalidTransition);
  });

  it("fails approval when cited evidence is corrected between pre-check and commit", () => {
    const f = arrange();
    const p = proposeAs(MEMBER, f.ws, f.task, f.finding);
    // Interleave a finding correction after the pre-check reads but before
    // the commit rechecks: latestReceipt runs in that window, so hook it
    // once to land the correction in its own committed transaction. A
    // nested-transaction hook would roll the correction back with the failed
    // review; this hook commits durably before the review transaction opens.
    const origPage = store.pageActionReceipts.bind(store);
    let injected = false;
    (store as unknown as { pageActionReceipts: CampfireStore["pageActionReceipts"] }).pageActionReceipts = ((
      ...args: Parameters<CampfireStore["pageActionReceipts"]>
    ) => {
      if (!injected) {
        injected = true;
        service.correctFinding(ctx(OWNER), {
          findingId: f.finding,
          summary: "flaky test observed",
          reason: "confirmed on the second run",
        });
      }
      return origPage(...args);
    }) as CampfireStore["pageActionReceipts"];
    try {
      expect(() =>
        service.review_action(ctx(OWNER), {
          workspaceId: f.ws,
          proposalId: p.proposal.id,
          revision: 1,
          intentDigest: p.proposal.intentDigest,
          decision: "approve",
          requestKey: nextKey(),
        }),
      ).toThrow(Conflict);
    } finally {
      (store as unknown as { pageActionReceipts: CampfireStore["pageActionReceipts"] }).pageActionReceipts =
        origPage;
    }
    // The failed commit leaves the proposal proposed at revision 1, and the
    // interleaved correction survives (it committed before the review txn).
    const view = service.get_action_proposal(ctx(OWNER), { workspaceId: f.ws, proposalId: p.proposal.id });
    expect(view.proposal.status).toBe("proposed");
    expect(view.proposal.revision).toBe(1);
    expect(() =>
      service.review_action(ctx(OWNER), {
        workspaceId: f.ws,
        proposalId: p.proposal.id,
        revision: 1,
        intentDigest: p.proposal.intentDigest,
        decision: "approve",
        requestKey: nextKey(),
      }),
    ).toThrow(Conflict);
  });

  it("rejects approval after expiry and review in a closed workspace", () => {
    const f = arrange();
    const p = proposeAs(OWNER, f.ws, f.task, f.finding, {
      expiresAt: new Date(Date.parse(NOW) + 60_000).toISOString(),
    });
    nowMs = Date.parse(NOW) + 3_600_000;
    expect(() => approveAs(p.proposal.id, 1, p.proposal.intentDigest, f.ws)).toThrow(InvalidTransition);
    // Rejection of an expired proposal stays harmless and allowed.
    const rejected = service.review_action(ctx(OWNER), {
      workspaceId: f.ws,
      proposalId: p.proposal.id,
      revision: 1,
      intentDigest: p.proposal.intentDigest,
      decision: "reject",
      reason: "expired before anyone could act",
      requestKey: nextKey(),
    });
    expect(rejected.proposal.status).toBe("rejected");
    service.updateWorkspace(ctx(OWNER), { workspaceId: f.ws, status: "completed" });
    expect(() => proposeAs(OWNER, f.ws, f.task, f.finding)).toThrow(InvalidTransition);
  });

  it("denies review after the reviewer loses ownership and in closed workspaces", () => {
    const f = arrange();
    const p = proposeAs(MEMBER, f.ws, f.task, f.finding);
    store.updateParticipantRole(f.ws, OWNER, "member");
    expect(() => approveAs(p.proposal.id, 1, p.proposal.intentDigest, f.ws)).toThrow(Unauthorized);
    store.updateParticipantRole(f.ws, OWNER, "owner");
    service.updateWorkspace(ctx(OWNER), { workspaceId: f.ws, status: "completed" });
    const before = contributions(f.ws);
    expect(() => approveAs(p.proposal.id, 1, p.proposal.intentDigest, f.ws)).toThrow(InvalidTransition);
    expect(contributions(f.ws)).toBe(before);
    // Closed workspaces stay readable.
    const view = service.get_action_proposal(ctx(VIEWER), { workspaceId: f.ws, proposalId: p.proposal.id });
    expect(view.proposal.id).toBe(p.proposal.id);
  });
});

describe("cancel_action", () => {
  it("cancels proposed and approved proposals, never reserved or terminal ones", () => {
    const f = arrange();
    const p = proposeAs(MEMBER, f.ws, f.task, f.finding);
    const cancelled = service.cancel_action(ctx(OWNER), {
      workspaceId: f.ws,
      proposalId: p.proposal.id,
      revision: 1,
      intentDigest: p.proposal.intentDigest,
      reason: "no longer needed",
      requestKey: nextKey(),
    });
    expect(cancelled.proposal.status).toBe("cancelled");
    expect(cancelled.proposal.review?.decision).toBe("cancelled");
    expect(() =>
      service.cancel_action(ctx(OWNER), {
        workspaceId: f.ws,
        proposalId: p.proposal.id,
        revision: 2,
        intentDigest: p.proposal.intentDigest,
        reason: "again",
        requestKey: nextKey(),
      }),
    ).toThrow(InvalidTransition);

    const q = proposeAs(MEMBER, f.ws, f.task, f.finding);
    approveAs(q.proposal.id, 1, q.proposal.intentDigest, f.ws);
    const r = reserveAs(EXEC, q.proposal.id, 2, q.proposal.intentDigest, f.ws);
    expect(r.proposal.status).toBe("dispatch_reserved");
    expect(() =>
      service.cancel_action(ctx(OWNER), {
        workspaceId: f.ws,
        proposalId: q.proposal.id,
        revision: 3,
        intentDigest: q.proposal.intentDigest,
        reason: "too late",
        requestKey: nextKey(),
      }),
    ).toThrow(InvalidTransition);
  });

  it("requires a human owner and a reason", () => {
    const f = arrange();
    const ses = agentSession(AGENT_OWNER, f.ws);
    const p = proposeAs(MEMBER, f.ws, f.task, f.finding);
    const input = {
      workspaceId: f.ws,
      proposalId: p.proposal.id,
      revision: 1,
      intentDigest: p.proposal.intentDigest,
      reason: "stop",
      requestKey: nextKey(),
    };
    expect(() => service.cancel_action(ctx(AGENT_OWNER, ses), input)).toThrow(Unauthorized);
    expect(() => service.cancel_action(ctx(MEMBER), input)).toThrow(Unauthorized);
    expect(() => service.cancel_action(ctx(OWNER), { ...input, reason: "" })).toThrow(ValidationError);
  });
});

describe("reserve_action_execution", () => {
  function approved(f: Fixture, executor: ActorRef = EXEC) {
    const p = service.propose_action(ctx(MEMBER), {
      workspaceId: f.ws,
      target: { ...TARGET },
      executor,
      reason: "retry the failed verification",
      taskId: f.task,
      findingIds: [f.finding],
      requestKey: nextKey(),
    });
    return approveAs(p.proposal.id, 1, p.proposal.intentDigest, f.ws);
  }

  it("reserves for the designated executor and captures the evidence snapshot", () => {
    const f = arrange();
    const a = approved(f);
    const reserved = reserveAs(EXEC, a.proposal.id, 2, a.proposal.intentDigest, f.ws);
    expect(reserved.proposal.status).toBe("dispatch_reserved");
    expect(reserved.proposal.reservation?.actor).toEqual(EXEC);
    expect(reserved.proposal.reservation?.reservationId).toMatch(/^resv_/);
    expect(reserved.proposal.reservation?.intentDigest).toBe(a.proposal.intentDigest);
    expect(reserved.proposal.reservation?.evidenceSnapshot.task).toEqual({
      id: f.task,
      status: "open",
      updatedAt: expect.any(String),
    });
    expect(reserved.proposal.reservation?.evidenceSnapshot.findings).toEqual([
      { id: f.finding, currentness: "current" },
    ]);
    // A second reservation under the same approval is a forbidden reversal.
    expect(() => reserveAs(EXEC, a.proposal.id, 3, a.proposal.intentDigest, f.ws)).toThrow(InvalidTransition);
  });

  it("supports an agent executor with its own valid session", () => {
    const f = arrange();
    const a = approved(f, AGENT_EXEC);
    const ses = agentSession(AGENT_EXEC, f.ws);
    const reserved = service.reserve_action_execution(ctx(AGENT_EXEC, ses), {
      workspaceId: f.ws,
      proposalId: a.proposal.id,
      revision: 2,
      intentDigest: a.proposal.intentDigest,
      requestKey: nextKey(),
    });
    expect(reserved.proposal.reservation?.actor).toEqual(AGENT_EXEC);
    expect(reserved.proposal.reservation?.sessionId).toBe(ses);
  });

  it("denies non-executors, viewers, expired sessions, and wrong workspaces", () => {
    const f = arrange();
    const a = approved(f);
    const ses = agentSession(AGENT_EXEC, f.ws);
    const a2 = approved(f, AGENT_EXEC);
    service.endAgentSession(ctx(AGENT_EXEC, ses), ses);
    const before = contributions(f.ws);
    expect(() => reserveAs(OWNER, a.proposal.id, 2, a.proposal.intentDigest, f.ws)).toThrow(Unauthorized);
    expect(() => reserveAs(MEMBER, a.proposal.id, 2, a.proposal.intentDigest, f.ws)).toThrow(Unauthorized);
    expect(() =>
      service.reserve_action_execution(ctx(AGENT_EXEC, ses), {
        workspaceId: f.ws,
        proposalId: a.proposal.id,
        revision: 2,
        intentDigest: a.proposal.intentDigest,
        requestKey: nextKey(),
      }),
    ).toThrow(Unauthorized);
    // A foreign proposal id in a workspace the caller cannot read is denied
    // at the authorization boundary before any record is touched.
    expect(() =>
      service.reserve_action_execution(ctx(EXEC), {
        workspaceId: f.ws2,
        proposalId: a.proposal.id,
        revision: 2,
        intentDigest: a.proposal.intentDigest,
        requestKey: nextKey(),
      }),
    ).toThrow(ParticipantRequired);
    expect(() =>
      service.reserve_action_execution(ctx(AGENT_EXEC, ses), {
        workspaceId: f.ws,
        proposalId: a2.proposal.id,
        revision: 2,
        intentDigest: a2.proposal.intentDigest,
        requestKey: nextKey(),
      }),
    ).toThrow(Unauthorized);
    expect(contributions(f.ws)).toBe(before);
  });

  it("enforces one dispatch per exact target and attempt across proposals", () => {
    const f = arrange();
    const first = approved(f);
    reserveAs(EXEC, first.proposal.id, 2, first.proposal.intentDigest, f.ws);
    const second = approved(f);
    expect(() => reserveAs(EXEC, second.proposal.id, 2, second.proposal.intentDigest, f.ws)).toThrow(Conflict);
    // A genuinely new attempt is a different key and may reserve.
    const other = service.propose_action(ctx(MEMBER), {
      workspaceId: f.ws,
      target: targetWithAttempt(2),
      executor: { ...EXEC },
      reason: "retry the next attempt",
      taskId: f.task,
      findingIds: [f.finding],
      requestKey: nextKey(),
    });
    const otherApproved = approveAs(other.proposal.id, 1, other.proposal.intentDigest, f.ws);
    const otherReserved = reserveAs(EXEC, other.proposal.id, 2, other.proposal.intentDigest, f.ws);
    expect(otherReserved.proposal.status).toBe("dispatch_reserved");
  });

  it("keeps the target key reserved after terminal receipts and crashes", () => {
    const f = arrange();
    const a = approved(f);
    const reserved = reserveAs(EXEC, a.proposal.id, 2, a.proposal.intentDigest, f.ws);
    reportAs(EXEC, a.proposal.id, 3, a.proposal.intentDigest, f.ws, "unknown");
    const again = service.propose_action(ctx(MEMBER), {
      workspaceId: f.ws,
      target: { ...TARGET },
      executor: { ...EXEC },
      reason: "retry again after unknown",
      taskId: f.task,
      findingIds: [f.finding],
      requestKey: nextKey(),
    });
    const againApproved = approveAs(again.proposal.id, 1, again.proposal.intentDigest, f.ws);
    // Retrying a definite no-submission outcome for the same target stays a
    // separate proposal; it cannot take a second dispatch slot for the attempt.
    expect(() => reserveAs(EXEC, again.proposal.id, 2, again.proposal.intentDigest, f.ws)).toThrow(Conflict);
    expect(reserved.proposal.reservation?.reservationId).toBeDefined();
  });

  it("invalidates dispatch on changed evidence, lost authority, or expiry", () => {
    const f = arrange();
    const a = approved(f);
    service.correctFinding(ctx(OWNER), {
      findingId: f.finding,
      summary: "flaky test observed",
      reason: "reproduced locally",
    });
    expect(() => reserveAs(EXEC, a.proposal.id, 2, a.proposal.intentDigest, f.ws)).toThrow(Conflict);

    const b = approved(f);
    store.updateParticipantRole(f.ws, OWNER, "member");
    expect(() => reserveAs(EXEC, b.proposal.id, 2, b.proposal.intentDigest, f.ws)).toThrow(InvalidTransition);
    store.updateParticipantRole(f.ws, OWNER, "owner");

    const c = service.propose_action(ctx(MEMBER), {
      workspaceId: f.ws,
      target: targetWithAttempt(3),
      executor: { ...EXEC },
      reason: "retry",
      taskId: f.task,
      findingIds: [f.finding],
      requestKey: nextKey(),
      expiresAt: new Date(Date.parse(NOW) + 60_000).toISOString(),
    });
    const cApproved = approveAs(c.proposal.id, 1, c.proposal.intentDigest, f.ws);
    nowMs = Date.parse(NOW) + 3_600_000;
    expect(() => reserveAs(EXEC, c.proposal.id, 2, c.proposal.intentDigest, f.ws)).toThrow(InvalidTransition);
  });

  it("replays an equal reservation and conflicts on an unequal one", () => {
    const f = arrange();
    const a = approved(f);
    const input = {
      workspaceId: f.ws,
      proposalId: a.proposal.id,
      revision: 2,
      intentDigest: a.proposal.intentDigest,
      requestKey: "reserve-idem",
    };
    const first = service.reserve_action_execution(ctx(EXEC), input);
    const replay = service.reserve_action_execution(ctx(EXEC), input);
    expect(replay.proposal.reservation?.reservationId).toBe(first.proposal.reservation?.reservationId);
    expect(() =>
      service.reserve_action_execution(ctx(EXEC), { ...input, revision: 99 }),
    ).toThrow(Conflict);
  });

  it("keeps the reservation snapshot inspectable after later corrections", () => {
    const f = arrange();
    const a = approved(f);
    const reserved = reserveAs(EXEC, a.proposal.id, 2, a.proposal.intentDigest, f.ws);
    const snapshot = reserved.proposal.reservation?.evidenceSnapshot;
    service.correctFinding(ctx(OWNER), {
      findingId: f.finding,
      summary: "flaky test observed",
      reason: "reproduced locally",
    });
    const view = service.get_action_proposal(ctx(OWNER), { workspaceId: f.ws, proposalId: a.proposal.id });
    expect(view.proposal.reservation?.evidenceSnapshot).toEqual(snapshot);
    expect(view.proposal.reservation?.evidenceSnapshot.findings).toEqual([
      { id: f.finding, currentness: "current" },
    ]);
  });
});

describe("receipt requestKey scope", () => {
  function recoveryCodeOf(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null) return undefined;
    const details = (error as { details?: { recoveryCode?: string } }).details;
    return details?.recoveryCode;
  }

  it("scopes submission receipt keys by recorder instead of colliding across actors", () => {
    const f = arrange();
    const p = proposeAs(MEMBER, f.ws, f.task, f.finding);
    const a = approveAs(p.proposal.id, 1, p.proposal.intentDigest, f.ws);
    reserveAs(EXEC, a.proposal.id, 2, a.proposal.intentDigest, f.ws);
    const first = reportAs(EXEC, a.proposal.id, 3, a.proposal.intentDigest, f.ws, "unknown", {}, "rk-shared");
    expect(store.getActionReceiptByRequestKey(a.proposal.id, EXEC, "rk-shared")?.id).toBe(first.id);
    expect(store.getActionReceiptByRequestKey(a.proposal.id, OWNER, "rk-shared")).toBeUndefined();
    // A different recorder may reuse the key without colliding.
    store.createActionReceipt({ ...first, id: "arcp_other_recorder", recordedBy: { ...OWNER } });
    expect(store.getActionReceiptByRequestKey(a.proposal.id, OWNER, "rk-shared")?.id).toBe("arcp_other_recorder");
    // The same recorder reusing the key with a new row conflicts.
    try {
      store.createActionReceipt({ ...first, id: "arcp_clash" });
      expect.unreachable("same recorder and requestKey must conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(Conflict);
      expect(recoveryCodeOf(error)).toBe("receipt_already_recorded");
    }
  });

  it("keeps list pages within 64KiB with honest totals", () => {
    const f = arrange();
    for (let i = 0; i < 100; i += 1) {
      proposeAs(OWNER, f.ws, f.task, f.finding, { reason: "r".repeat(500) });
    }
    const page = service.list_action_proposals(ctx(VIEWER), { workspaceId: f.ws, limit: 100 });
    expect(page.total).toBe(100);
    expect(page.returned).toBeLessThan(page.total);
    expect(page.truncated).toBe(true);
    expect(page.nextCursor).toBeDefined();
    expect(Buffer.byteLength(JSON.stringify(page.items), "utf8")).toBeLessThanOrEqual(65_536);
  });

  it("rejects dispatch when a bound operator source is not cited", () => {
    const f = arrange();
    store.createGithubSourceBinding({
      sourceId: "src_act001_github",
      workspaceId: f.ws,
      repositoryId: TARGET.repositoryId,
      repositoryName: TARGET.repositoryName,
      workflowId: TARGET.workflowId,
      actionKind: "ci.retry_verification",
      integrationAgentId: AGENT_MEMBER.actorId,
      authorityFingerprint: "fp-1",
      firstUsedAt: NOW,
    });
    expect(store.listGithubSourceBindings(f.ws).map((binding) => binding.sourceId)).toEqual([
      "src_act001_github",
    ]);
    const p = proposeAs(MEMBER, f.ws, f.task, f.finding);
    const a = approveAs(p.proposal.id, 1, p.proposal.intentDigest, f.ws);
    try {
      reserveAs(EXEC, a.proposal.id, 2, a.proposal.intentDigest, f.ws);
      expect.unreachable("dispatch without a bound source revision must fail");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransition);
      expect(recoveryCodeOf(error)).toBe("source_authority_mismatch");
    }
    // A revision referencing the bound source reserves normally.
    const q = service.propose_action(ctx(MEMBER), {
      workspaceId: f.ws,
      target: targetWithAttempt(9),
      executor: { ...EXEC },
      reason: "retry the failed verification",
      taskId: f.task,
      findingIds: [f.finding],
      requestKey: nextKey(),
      sourceAuthorityRevision: "src_act001_github#7",
    });
    const qa = approveAs(q.proposal.id, 1, q.proposal.intentDigest, f.ws);
    const qr = reserveAs(EXEC, qa.proposal.id, 2, qa.proposal.intentDigest, f.ws);
    expect(qr.proposal.status).toBe("dispatch_reserved");
  });
});

describe("record_action_outcome", () => {
  function reserved(f: Fixture, attempt = 1, executor: ActorRef = EXEC) {
    const p = service.propose_action(ctx(MEMBER), {
      workspaceId: f.ws,
      target: targetWithAttempt(attempt),
      executor,
      reason: "retry the failed verification",
      taskId: f.task,
      findingIds: [f.finding],
      requestKey: nextKey(),
    });
    const a = approveAs(p.proposal.id, 1, p.proposal.intentDigest, f.ws);
    return reserveAs(executor, a.proposal.id, 2, a.proposal.intentDigest, f.ws);
  }

  it("records accepted, definite-failure, and unknown submissions", () => {
    const f = arrange();
    const a = reserved(f, 1);
    const accepted = reportAs(EXEC, a.proposal.id, 3, a.proposal.intentDigest, f.ws, "accepted");
    expect(accepted.outcome).toBe("accepted");
    expect(accepted.reservationId).toBe(a.proposal.reservation?.reservationId);
    expect(accepted.recordedBy).toEqual(EXEC);
    expect(service.get_action_proposal(ctx(OWNER), { workspaceId: f.ws, proposalId: a.proposal.id }).proposal.status).toBe(
      "submission_accepted",
    );

    const b = reserved(f, 2);
    const failed = reportAs(EXEC, b.proposal.id, 3, b.proposal.intentDigest, f.ws, "definite_failure");
    expect(failed.outcome).toBe("definite_failure");

    const c = reserved(f, 3);
    const unknown = reportAs(EXEC, c.proposal.id, 3, c.proposal.intentDigest, f.ws, "unknown");
    expect(unknown.outcome).toBe("unknown");
    // No auto-retry or second dispatch: the reservation stands unresolved.
    expect(
      service.get_action_proposal(ctx(OWNER), { workspaceId: f.ws, proposalId: c.proposal.id }).proposal.status,
    ).toBe("submission_unknown");
  });

  it("reconciles unknown submissions and preserves the original uncertainty", () => {
    const f = arrange();
    const a = reserved(f, 1);
    const unknown = reportAs(EXEC, a.proposal.id, 3, a.proposal.intentDigest, f.ws, "unknown");
    const reconciled = reportAs(EXEC, a.proposal.id, 4, a.proposal.intentDigest, f.ws, "reconciled_accepted", {
      resolvesReceiptId: unknown.id,
      providerRef: { ...PROVIDER_REF, attempt: 2, conclusion: "success" },
    });
    expect(reconciled.outcome).toBe("reconciled_accepted");
    expect(reconciled.resolvesReceiptId).toBe(unknown.id);
    const receipts = service.list_action_receipts(ctx(OWNER), { workspaceId: f.ws, proposalId: a.proposal.id });
    expect(receipts.items.map((r) => r.outcome).sort()).toEqual(["reconciled_accepted", "unknown"]);
    expect(
      service.get_action_proposal(ctx(OWNER), { workspaceId: f.ws, proposalId: a.proposal.id }).proposal.status,
    ).toBe("submission_accepted");
  });

  it("rejects contradictory terminal receipts and invalid reconciliations", () => {
    const f = arrange();
    const a = reserved(f, 1);
    reportAs(EXEC, a.proposal.id, 3, a.proposal.intentDigest, f.ws, "accepted");
    expect(() => reportAs(EXEC, a.proposal.id, 4, a.proposal.intentDigest, f.ws, "definite_failure")).toThrow(
      InvalidTransition,
    );
    expect(() =>
      reportAs(EXEC, a.proposal.id, 4, a.proposal.intentDigest, f.ws, "reconciled_accepted", {
        resolvesReceiptId: "arcp_missing",
      }),
    ).toThrow(InvalidTransition);

    const b = reserved(f, 2);
    expect(() =>
      reportAs(EXEC, b.proposal.id, 3, b.proposal.intentDigest, f.ws, "reconciled_accepted", {
        resolvesReceiptId: "arcp_missing",
      }),
    ).toThrow(InvalidTransition);
    expect(() =>
      service.record_action_outcome(ctx(EXEC), {
        workspaceId: f.ws,
        proposalId: b.proposal.id,
        revision: 3,
        intentDigest: b.proposal.intentDigest,
        outcome: "reconciled_accepted",
        providerRef: { ...PROVIDER_REF },
        requestKey: nextKey(),
      }),
    ).toThrow(ValidationError);
    // Unknown cannot be reported twice under the same approval.
    reportAs(EXEC, b.proposal.id, 3, b.proposal.intentDigest, f.ws, "unknown");
    expect(() => reportAs(EXEC, b.proposal.id, 4, b.proposal.intentDigest, f.ws, "unknown")).toThrow(InvalidTransition);
  });

  it("requires the executor, revision, and digest, and replays equal reports", () => {
    const f = arrange();
    const a = reserved(f, 1);
    expect(() => reportAs(OWNER, a.proposal.id, 3, a.proposal.intentDigest, f.ws, "accepted")).toThrow(Unauthorized);
    expect(() => reportAs(EXEC, a.proposal.id, 99, a.proposal.intentDigest, f.ws, "accepted")).toThrow(Conflict);
    expect(() => reportAs(EXEC, a.proposal.id, 3, "0".repeat(64), f.ws, "accepted")).toThrow(Conflict);
    const first = reportAs(EXEC, a.proposal.id, 3, a.proposal.intentDigest, f.ws, "accepted", {}, "report-idem");
    const replay = reportAs(EXEC, a.proposal.id, 3, a.proposal.intentDigest, f.ws, "accepted", {}, "report-idem");
    expect(replay.id).toBe(first.id);
    expect(() =>
      reportAs(EXEC, a.proposal.id, 3, a.proposal.intentDigest, f.ws, "definite_failure", {}, "report-idem"),
    ).toThrow(Conflict);
  });

  it("stores only the bounded safe provider reference", () => {
    const f = arrange();
    const a = reserved(f, 1);
    const receipt = service.record_action_outcome(ctx(EXEC), {
      workspaceId: f.ws,
      proposalId: a.proposal.id,
      revision: 3,
      intentDigest: a.proposal.intentDigest,
      outcome: "accepted",
      providerRef: { ...PROVIDER_REF, attempt: 2, conclusion: "success", token: "secret" } as never,
      requestKey: nextKey(),
    });
    expect(receipt.providerRef).toEqual({ ...PROVIDER_REF, attempt: 2, conclusion: "success" });
    expect(JSON.stringify(receipt)).not.toContain("secret");
  });
});

describe("reads", () => {
  it("lists proposals with total, returned, truncated, and cursor pages", () => {
    const f = arrange();
    proposeAs(OWNER, f.ws, f.task, f.finding);
    proposeAs(OWNER, f.ws, f.task, f.finding);
    proposeAs(OWNER, f.ws, f.task, f.finding);
    const first = service.list_action_proposals(ctx(VIEWER), { workspaceId: f.ws, limit: 2 });
    expect(first.schemaVersion).toBe(1);
    expect(first.total).toBe(3);
    expect(first.returned).toBe(2);
    expect(first.truncated).toBe(true);
    expect(first.nextCursor).toBeDefined();
    const second = service.list_action_proposals(ctx(VIEWER), {
      workspaceId: f.ws,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.total).toBe(3);
    expect(second.returned).toBe(1);
    // `truncated` follows the shared slice convention: the page does not
    // contain the whole set. The absent cursor marks the end of the pages.
    expect(second.truncated).toBe(true);
    expect(second.nextCursor).toBeUndefined();
    expect(() => service.list_action_proposals(ctx(VIEWER), { workspaceId: f.ws, limit: 0 })).toThrow(ValidationError);
    expect(() => service.list_action_proposals(ctx(VIEWER), { workspaceId: f.ws, limit: 101 })).toThrow(
      ValidationError,
    );
    // Cursor misuse fails: foreign workspace and foreign query cursors.
    expect(() =>
      service.list_action_proposals(ctx(OWNER), { workspaceId: f.ws2, cursor: first.nextCursor }),
    ).toThrow(ValidationError);
    const receipts = service.list_action_receipts(ctx(OWNER), {
      workspaceId: f.ws,
      proposalId: proposeAs(OWNER, f.ws, f.task, f.finding).proposal.id,
    });
    void receipts;
    expect(() =>
      service.list_action_proposals(ctx(VIEWER), { workspaceId: f.ws, cursor: "bm90LWpzb24=" }),
    ).toThrow(ValidationError);
  });

  it("keeps reads workspace-scoped and never flattens authorities", () => {
    const f = arrange();
    const p = proposeAs(OWNER, f.ws, f.task, f.finding);
    expect(() => service.get_action_proposal(ctx(OUTSIDER), { workspaceId: f.ws, proposalId: p.proposal.id })).toThrow();
    expect(() => service.get_action_proposal(ctx(OWNER), { workspaceId: f.ws2, proposalId: p.proposal.id })).toThrow(
      ActionProposalNotFound,
    );
    expect(() => service.list_action_receipts(ctx(OWNER), { workspaceId: f.ws2, proposalId: p.proposal.id })).toThrow(
      ActionProposalNotFound,
    );
    const view = service.get_action_proposal(ctx(VIEWER), { workspaceId: f.ws, proposalId: p.proposal.id });
    expect(view.latestReceipt).toBeUndefined();
    expect(view.signedObservation).toBeUndefined();
    expect(JSON.stringify(view).length).toBeLessThan(16_384);
  });

  it("pages receipts separately from the proposal summary", () => {
    const f = arrange();
    const p = proposeAs(MEMBER, f.ws, f.task, f.finding);
    const a = approveAs(p.proposal.id, 1, p.proposal.intentDigest, f.ws);
    const r = reserveAs(EXEC, a.proposal.id, 2, a.proposal.intentDigest, f.ws);
    reportAs(EXEC, a.proposal.id, 3, a.proposal.intentDigest, f.ws, "unknown");
    const page = service.list_action_receipts(ctx(OWNER), {
      workspaceId: f.ws,
      proposalId: a.proposal.id,
      limit: 1,
    });
    expect(page.schemaVersion).toBe(1);
    expect(page.proposalId).toBe(a.proposal.id);
    expect(page.total).toBe(1);
    expect(page.returned).toBe(1);
    const view = service.get_action_proposal(ctx(OWNER), { workspaceId: f.ws, proposalId: a.proposal.id });
    expect(view.latestReceipt?.outcome).toBe("unknown");
    expect(r.proposal.status).toBe("dispatch_reserved");
  });
});
