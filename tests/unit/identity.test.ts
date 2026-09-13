import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { ParticipantRequired, TeamNotFound, Unauthorized, ValidationError } from "../../src/domain/errors.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import type { ActorRef } from "../../src/domain/types.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import { hashToken } from "../../src/service/tokens.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";

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

describe("tokens and identity", () => {
  let store: CampfireStore;
  let service: CampfireService;

  beforeEach(() => {
    store = openInMemoryStore();
    service = createCampfireService({ store, idSource: createCounterIdSource(), clock: createClock() });
    store.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: NOW });
    store.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: NOW });
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

  it("issues a token that resolves to the same actor", () => {
    const issued = service.issueToken(ctxHuman1, HUMAN1);
    expect(issued.token.startsWith("cft_")).toBe(true);
    expect(issued.token.length).toBeGreaterThanOrEqual("cft_".length + 32);
    expect(issued.actor).toEqual(HUMAN1);
    expect(store.getActorTokenByHash(hashToken(issued.token))?.actor).toEqual(HUMAN1);
    expect(service.resolveToken(issued.token)).toEqual(HUMAN1);
  });

  it("rejects a wrong token as Unauthorized", () => {
    service.issueToken(ctxHuman1, HUMAN1);
    expect(() => service.resolveToken("cft_" + "ab".repeat(16))).toThrow(Unauthorized);
  });

  it("does not let token A act as actor B", () => {
    const a = service.issueToken(ctxHuman1, HUMAN1);
    const b = service.issueToken(ctxHuman2, HUMAN2);
    expect(service.resolveToken(a.token)).toEqual(HUMAN1);
    expect(service.resolveToken(b.token)).toEqual(HUMAN2);
    expect(service.resolveToken(a.token).actorId).not.toBe(HUMAN2.actorId);
  });

  it("lets a human issue a token for an agent they own and not for another human", () => {
    const forAgent = service.issueToken(ctxHuman1, AGENT1);
    expect(service.resolveToken(forAgent.token)).toEqual(AGENT1);
    expect(() => service.issueToken(ctxHuman1, HUMAN2)).toThrow(Unauthorized);
    expect(() => service.issueToken(ctxHuman2, AGENT1)).toThrow(Unauthorized);
    expect(() => service.issueToken(ctxAgent1, AGENT1)).toThrow(Unauthorized);
  });

  it("rejects a revoked token", () => {
    const issued = service.issueToken(ctxHuman1, HUMAN1);
    const record = store.getActorTokenByHash(hashToken(issued.token));
    expect(record).toBeDefined();
    store.revokeActorToken(record!.id, "2026-01-02T00:00:00.000Z");
    expect(() => service.resolveToken(issued.token)).toThrow(Unauthorized);
  });

  it("creates an agent only for the acting owning human", () => {
    const created = service.createAgent(ctxHuman1, {
      teamId: "team_1",
      humanId: "hum_1",
      name: "Other",
      harness: "codex",
    });
    expect(created.agent.humanId).toBe("hum_1");
    expect(service.resolveToken(created.token).actorId).toBe(created.agent.id);

    expect(() =>
      service.createAgent(ctxHuman2, {
        teamId: "team_1",
        humanId: "hum_1",
        name: "Nope",
        harness: "codex",
      }),
    ).toThrow(Unauthorized);
    expect(() =>
      service.createAgent(ctxHuman1, {
        teamId: "team_1",
        humanId: "hum_2",
        name: "Nope",
        harness: "codex",
      }),
    ).toThrow(Unauthorized);
    expect(() =>
      service.createAgent(ctxAgent1, {
        teamId: "team_1",
        humanId: "hum_1",
        name: "Nope",
        harness: "codex",
      }),
    ).toThrow(Unauthorized);
  });

  it("invites then joins, and rejects join without an invite", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    expect(() => service.joinWorkspace(ctxHuman2, { workspaceId: workspace.id })).toThrow(
      ParticipantRequired,
    );

    const invite = service.inviteToWorkspace(ctxHuman1, {
      workspaceId: workspace.id,
      actor: HUMAN2,
      role: "member",
    });
    expect(invite.consumedAt).toBeUndefined();
    expect(store.listContributions(workspace.id).some((c) => c.objectType === "invite")).toBe(true);

    const joined = service.joinWorkspace(ctxHuman2, { workspaceId: workspace.id, role: "owner" });
    expect(joined.role).toBe("member");
    expect(store.getOpenInvite(workspace.id, HUMAN2)).toBeUndefined();
    expect(store.getParticipant(workspace.id, HUMAN2)?.role).toBe("member");
  });

  it("cannot self-assign owner without an invite whose role is owner", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    service.inviteToWorkspace(ctxHuman1, {
      workspaceId: workspace.id,
      actor: HUMAN2,
      role: "member",
    });
    const joined = service.joinWorkspace(ctxHuman2, { workspaceId: workspace.id, role: "owner" });
    expect(joined.role).toBe("member");
  });

  it("does not let an agent invite", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    service.inviteToWorkspace(ctxHuman1, { workspaceId: workspace.id, actor: AGENT1, role: "agent" });
    service.joinWorkspace(ctxAgent1, { workspaceId: workspace.id });
    expect(() =>
      service.inviteToWorkspace(ctxAgent1, { workspaceId: workspace.id, actor: HUMAN2, role: "member" }),
    ).toThrow(Unauthorized);
  });

  it("does not let a viewer invite", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    service.inviteToWorkspace(ctxHuman1, {
      workspaceId: workspace.id,
      actor: HUMAN2,
      role: "viewer",
    });
    service.joinWorkspace(ctxHuman2, { workspaceId: workspace.id });
    expect(() =>
      service.inviteToWorkspace(ctxHuman2, { workspaceId: workspace.id, actor: AGENT1, role: "agent" }),
    ).toThrow(Unauthorized);
  });

  it("registers an agent session from agents.human_id and rejects a mismatched humanId", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    service.inviteToWorkspace(ctxHuman1, { workspaceId: workspace.id, actor: AGENT1, role: "agent" });
    service.joinWorkspace(ctxAgent1, { workspaceId: workspace.id });

    const session = service.registerAgentSession(ctxAgent1, {
      agentId: "agt_1",
      workspaceId: workspace.id,
      harness: "codex",
    });
    expect(session.humanId).toBe("hum_1");

    expect(() =>
      service.registerAgentSession(ctxAgent1, {
        agentId: "agt_1",
        humanId: "hum_2",
        workspaceId: workspace.id,
        harness: "codex",
      }),
    ).toThrow(Unauthorized);
  });

  it("rejects registerAgentSession when the agent has no owning human", () => {
    store.createAgent({
      id: "agt_orphan",
      teamId: "team_1",
      name: "Orphan",
      harness: "codex",
      createdAt: NOW,
    });
    const orphan: ActorContext = { actor: { actorId: "agt_orphan", actorType: "agent" } };
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    service.inviteToWorkspace(ctxHuman1, {
      workspaceId: workspace.id,
      actor: orphan.actor,
      role: "agent",
    });
    service.joinWorkspace(orphan, { workspaceId: workspace.id });
    expect(() =>
      service.registerAgentSession(orphan, {
        agentId: "agt_orphan",
        humanId: "hum_1",
        workspaceId: workspace.id,
        harness: "codex",
      }),
    ).toThrow(ValidationError);
  });

  it("rejects endAgentSession for a stranger", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    service.inviteToWorkspace(ctxHuman1, { workspaceId: workspace.id, actor: AGENT1, role: "agent" });
    service.joinWorkspace(ctxAgent1, { workspaceId: workspace.id });
    const session = service.registerAgentSession(ctxAgent1, {
      agentId: "agt_1",
      humanId: "hum_1",
      workspaceId: workspace.id,
      harness: "codex",
    });
    expect(() => service.endAgentSession(ctxHuman2, session.id)).toThrow(Unauthorized);
  });

  it("lets the session agent or owning human end the session", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    service.inviteToWorkspace(ctxHuman1, { workspaceId: workspace.id, actor: AGENT1, role: "agent" });
    service.joinWorkspace(ctxAgent1, { workspaceId: workspace.id });
    const session = service.registerAgentSession(ctxAgent1, {
      agentId: "agt_1",
      workspaceId: workspace.id,
      harness: "codex",
    });
    service.endAgentSession(ctxHuman1, session.id);
    expect(store.getAgentSession(session.id)?.endedAt).toBeDefined();
  });
});

describe("createHuman bootstrap", () => {
  let store: CampfireStore;
  let service: CampfireService;

  beforeEach(() => {
    store = openInMemoryStore();
    service = createCampfireService({ store, idSource: createCounterIdSource(), clock: createClock() });
    store.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: NOW });
    store.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: NOW });
  });

  afterEach(() => {
    service.close();
  });

  it("bootstraps the first human then requires a team human for the second", () => {
    expect(store.countHumans()).toBe(0);
    const first = service.createHuman(undefined, { teamId: "team_1", displayName: "Ada" });
    expect(first.human.displayName).toBe("Ada");
    expect(service.resolveToken(first.token)).toEqual({
      actorId: first.human.id,
      actorType: "human",
    });

    expect(() => service.createHuman(undefined, { teamId: "team_1", displayName: "Grace" })).toThrow(
      Unauthorized,
    );

    const ctxFirst: ActorContext = { actor: { actorId: first.human.id, actorType: "human" } };
    const second = service.createHuman(ctxFirst, { teamId: "team_1", displayName: "Grace" });
    expect(second.human.displayName).toBe("Grace");
    expect(service.resolveToken(second.token).actorId).toBe(second.human.id);
    expect(store.countHumans()).toBe(2);
  });

  it("rejects bootstrap against an unknown team", () => {
    expect(() => service.createHuman(undefined, { teamId: "team_missing", displayName: "Ada" })).toThrow(
      TeamNotFound,
    );
  });
});

describe("seed fixture tokens", () => {
  let store: CampfireStore;
  let service: CampfireService;

  beforeEach(() => {
    store = openInMemoryStore();
    service = createCampfireService({ store });
    seedFixture(store);
  });

  afterEach(() => {
    service.close();
  });

  it("resolves labeled fixture tokens to the seeded actors", () => {
    expect(service.resolveToken(FIXTURE.tokens.sergio)).toEqual({
      actorId: FIXTURE.humans.sergio,
      actorType: "human",
    });
    expect(service.resolveToken(FIXTURE.tokens.alice)).toEqual({
      actorId: FIXTURE.humans.alice,
      actorType: "human",
    });
    expect(service.resolveToken(FIXTURE.tokens.codexSergio)).toEqual({
      actorId: FIXTURE.agents.codexSergio,
      actorType: "agent",
    });
    expect(service.resolveToken(FIXTURE.tokens.opencodeAlice)).toEqual({
      actorId: FIXTURE.agents.opencodeAlice,
      actorType: "agent",
    });
  });
});
