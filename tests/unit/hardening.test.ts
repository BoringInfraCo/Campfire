/**
 * Hardening Sprint A invariants.
 *
 * Each test maps to one bullet in the sprint scope. Boring, deterministic,
 * no new domain entities.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import type { ActorContext } from "../../src/service/authorization.js";
import type { ActorRef, ParticipantRole, WorkspaceParticipant } from "../../src/domain/types.js";
import {
  ActorNotFound,
  Conflict,
  ParticipantRequired,
  Unauthorized,
  ValidationError,
} from "../../src/domain/errors.js";
import { bootstrapOrganizationTeam } from "../../src/bootstrap/bootstrap.js";

const NOW = "2026-01-01T00:00:00.000Z";

const HUMAN1: ActorRef = { actorId: "hum_1", actorType: "human" };
const HUMAN2: ActorRef = { actorId: "hum_2", actorType: "human" };
const AGENT1: ActorRef = { actorId: "agt_1", actorType: "agent" };

const ctxHuman1: ActorContext = { actor: HUMAN1 };
const ctxHuman2: ActorContext = { actor: HUMAN2 };
const ctxAgent1: ActorContext = { actor: AGENT1 };

function createClock(startMs = Date.parse(NOW)) {
  let current = startMs;
  return (): string => {
    current += 1000;
    return new Date(current).toISOString();
  };
}

let store: CampfireStore;
let service: CampfireService;

beforeEach(() => {
  store = openInMemoryStore();
  service = createCampfireService({ store, idSource: createCounterIdSource(), clock: createClock() });
  store.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: NOW });
  store.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: NOW });
  store.createTeam({ id: "team_2", organizationId: "org_1", name: "Other", createdAt: NOW });
  store.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
  store.createHuman({ id: "hum_2", teamId: "team_1", displayName: "Grace", createdAt: NOW });
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

function inviteAndJoin(
  inviter: ActorContext,
  joiner: ActorContext,
  workspaceId: string,
  role: ParticipantRole,
): WorkspaceParticipant {
  service.inviteToWorkspace(inviter, { workspaceId, actor: joiner.actor, role });
  return service.joinWorkspace(joiner, { workspaceId });
}

function agentCtxWithSession(workspaceId: string): ActorContext {
  inviteAndJoin(ctxHuman1, ctxAgent1, workspaceId, "agent");
  const session = service.registerAgentSession(ctxAgent1, {
    agentId: "agt_1",
    workspaceId,
    harness: "codex",
  });
  return { actor: AGENT1, agentSessionId: session.id };
}

describe("hardening: team boundaries", () => {
  it("rejects workspace creation across teams", () => {
    // hum_1 is on team_1; creating a team_2 workspace must fail.
    expect(() => service.createWorkspace(ctxHuman1, { teamId: "team_2", name: "X" })).toThrow(
      Unauthorized,
    );
  });

  it("rejects invites to actors on another team", () => {
    store.createHuman({ id: "hum_other", teamId: "team_2", displayName: "Other", createdAt: NOW });
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    expect(() =>
      service.inviteToWorkspace(ctxHuman1, {
        workspaceId: workspace.id,
        actor: { actorId: "hum_other", actorType: "human" },
        role: "member",
      }),
    ).toThrow(Unauthorized);
  });
});

describe("hardening: sessions", () => {
  it("rejects a session bound to a different workspace", () => {
    const a = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    const b = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "B" });
    inviteAndJoin(ctxHuman1, ctxAgent1, a.id, "agent");
    inviteAndJoin(ctxHuman1, ctxAgent1, b.id, "agent");
    const session = service.registerAgentSession(ctxAgent1, {
      agentId: "agt_1",
      workspaceId: a.id,
      harness: "codex",
    });
    const mismatched: ActorContext = { actor: AGENT1, agentSessionId: session.id };
    expect(() => service.getWorkspace(mismatched, b.id)).toThrow(Unauthorized);
    // Same session works for its own workspace.
    expect(service.getWorkspace(mismatched, a.id).workspace.id).toBe(a.id);
  });

  it("rejects ended sessions", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    inviteAndJoin(ctxHuman1, ctxAgent1, workspace.id, "agent");
    const session = service.registerAgentSession(ctxAgent1, {
      agentId: "agt_1",
      workspaceId: workspace.id,
      harness: "codex",
    });
    service.endAgentSession(ctxAgent1, session.id);
    const ended: ActorContext = { actor: AGENT1, agentSessionId: session.id };
    expect(() => service.getWorkspace(ended, workspace.id)).toThrow(Unauthorized);
  });

  it("requires an agent session for agent writes", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    inviteAndJoin(ctxHuman1, ctxAgent1, workspace.id, "agent");
    expect(() =>
      service.addFinding(ctxAgent1, { workspaceId: workspace.id, summary: "no session" }),
    ).toThrow(Unauthorized);
    expect(() =>
      service.addDecision(ctxAgent1, { workspaceId: workspace.id, summary: "no session" }),
    ).toThrow(Unauthorized);
    expect(() =>
      service.createTask(ctxAgent1, { workspaceId: workspace.id, title: "no session" }),
    ).toThrow(Unauthorized);
    expect(() =>
      service.addArtifact(ctxAgent1, {
        workspaceId: workspace.id,
        type: "log",
        title: "no session",
        uriOrPath: "x.log",
      }),
    ).toThrow(Unauthorized);
    expect(() =>
      service.createGoal(ctxAgent1, { workspaceId: workspace.id, title: "no session" }),
    ).toThrow(Unauthorized);

    // With a session the same writes succeed.
    const other = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "B" });
    const withSession = agentCtxWithSession(other.id);
    expect(
      service.addFinding(withSession, { workspaceId: other.id, summary: "ok" }).summary,
    ).toBe("ok");
  });
});

describe("hardening: goals, tasks, decisions", () => {
  it("blocks reactivating an old goal while another goal is active", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    const first = service.createGoal(ctxHuman1, { workspaceId: workspace.id, title: "First" });
    service.updateGoal(ctxHuman1, { goalId: first.id, status: "completed" });
    const second = service.createGoal(ctxHuman1, { workspaceId: workspace.id, title: "Second" });
    expect(second.status).toBe("active");
    expect(() => service.updateGoal(ctxHuman1, { goalId: first.id, status: "active" })).toThrow(
      Conflict,
    );
  });

  it("rejects unknown and non-participant task assignees", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    expect(() =>
      service.createTask(ctxHuman1, {
        workspaceId: workspace.id,
        title: "T",
        assignee: { actorId: "hum_missing", actorType: "human" },
      }),
    ).toThrow(ActorNotFound);
    // hum_2 exists but has not joined this workspace.
    expect(() =>
      service.createTask(ctxHuman1, { workspaceId: workspace.id, title: "T", assignee: HUMAN2 }),
    ).toThrow(ParticipantRequired);
    const task = service.createTask(ctxHuman1, { workspaceId: workspace.id, title: "T" });
    expect(() => service.updateTask(ctxHuman1, { taskId: task.id, assignee: HUMAN2 })).toThrow(
      ParticipantRequired,
    );
  });

  it("rejects decisions created directly as accepted", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    expect(() =>
      service.addDecision(ctxHuman1, {
        workspaceId: workspace.id,
        summary: "shortcut",
        status: "accepted",
      }),
    ).toThrow(ValidationError);
    expect(() =>
      service.addDecision(ctxHuman1, {
        workspaceId: workspace.id,
        summary: "shortcut",
        status: "superseded",
      }),
    ).toThrow(ValidationError);
    // The supported path still works: proposed -> acceptDecision.
    const proposed = service.addDecision(ctxHuman1, { workspaceId: workspace.id, summary: "ok" });
    expect(proposed.status).toBe("proposed");
    expect(service.acceptDecision(ctxHuman1, proposed.id).status).toBe("accepted");
  });
});

describe("hardening: token revoke", () => {
  it("revokes a token so resolveToken rejects it", () => {
    const issued = service.issueToken(ctxHuman1, HUMAN1);
    expect(service.resolveToken(issued.token)).toEqual(HUMAN1);
    const revoked = service.revokeToken(ctxHuman1, issued.token);
    expect(revoked.actor).toEqual(HUMAN1);
    expect(() => service.resolveToken(issued.token)).toThrow(Unauthorized);
  });

  it("does not let a stranger revoke another human's token", () => {
    const issued = service.issueToken(ctxHuman1, HUMAN1);
    expect(() => service.revokeToken(ctxHuman2, issued.token)).toThrow(Unauthorized);
    // Still valid after the failed revoke.
    expect(service.resolveToken(issued.token)).toEqual(HUMAN1);
  });
});

describe("hardening: bootstrap", () => {
  it("idempotently creates org+team on a blank store", () => {
    const blank = openInMemoryStore();
    try {
      const first = bootstrapOrganizationTeam(blank, {
        organizationId: "org_1",
        organizationName: "Boring Infra Co.",
        teamId: "team_1",
        teamName: "Engineering",
        createdAt: NOW,
      });
      expect(first.created).toEqual({ organization: true, team: true });
      const second = bootstrapOrganizationTeam(blank, {
        organizationId: "org_1",
        organizationName: "Boring Infra Co.",
        teamId: "team_1",
        teamName: "Engineering",
        createdAt: NOW,
      });
      expect(second.created).toEqual({ organization: false, team: false });
      expect(blank.getOrganization("org_1")?.id).toBe("org_1");
      expect(blank.getTeam("team_1")?.id).toBe("team_1");
    } finally {
      blank.close();
    }
  });
});
