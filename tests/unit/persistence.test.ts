import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openInMemoryStore, openSqliteStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import type { ActorRef } from "../../src/domain/types.js";

const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-02T00:00:00.000Z";

const HUMAN: ActorRef = { actorId: "hum_1", actorType: "human" };
const AGENT: ActorRef = { actorId: "agt_1", actorType: "agent" };

let store: CampfireStore;

beforeEach(() => {
  store = openInMemoryStore();
});

afterEach(() => {
  store.close();
});

function seedBase(target: CampfireStore): void {
  target.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: NOW });
  target.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: NOW });
  target.createHuman({
    id: "hum_1",
    teamId: "team_1",
    displayName: "Human One",
    externalIdentity: "human.one@example.com",
    createdAt: NOW,
  });
  target.createAgent({
    id: "agt_1",
    teamId: "team_1",
    humanId: "hum_1",
    name: "Agent One",
    harness: "codex",
    model: "gpt-5",
    instanceMetadata: { host: "local", nested: { depth: 2 } },
    createdAt: NOW,
  });
  target.createWorkspace({
    id: "ws_1",
    teamId: "team_1",
    name: "Workspace One",
    description: "first workspace",
    status: "active",
    createdBy: HUMAN,
    createdAt: NOW,
    updatedAt: NOW,
  });
  target.addParticipant({ workspaceId: "ws_1", actor: HUMAN, role: "owner", joinedAt: NOW });
}

describe("identity persistence", () => {
  it("round-trips organizations, teams, humans, and agents", () => {
    seedBase(store);

    expect(store.getOrganization("org_1")).toEqual({
      id: "org_1",
      name: "Boring Infra Co.",
      createdAt: NOW,
    });
    expect(store.getTeam("team_1")).toEqual({
      id: "team_1",
      organizationId: "org_1",
      name: "Engineering",
      createdAt: NOW,
    });
    expect(store.getHuman("hum_1")).toEqual({
      id: "hum_1",
      teamId: "team_1",
      displayName: "Human One",
      externalIdentity: "human.one@example.com",
      createdAt: NOW,
    });
    expect(store.getAgent("agt_1")).toEqual({
      id: "agt_1",
      teamId: "team_1",
      humanId: "hum_1",
      name: "Agent One",
      harness: "codex",
      model: "gpt-5",
      instanceMetadata: { host: "local", nested: { depth: 2 } },
      createdAt: NOW,
    });

    expect(store.listHumans("team_1").map((h) => h.id)).toEqual(["hum_1"]);
    expect(store.listAgents("team_1").map((a) => a.id)).toEqual(["agt_1"]);
  });

  it("returns undefined for missing rows instead of throwing", () => {
    expect(store.getOrganization("missing")).toBeUndefined();
    expect(store.getTeam("missing")).toBeUndefined();
    expect(store.getHuman("missing")).toBeUndefined();
    expect(store.getAgent("missing")).toBeUndefined();
    expect(store.getWorkspace("missing")).toBeUndefined();
    expect(store.getGoal("missing")).toBeUndefined();
    expect(store.getTask("missing")).toBeUndefined();
    expect(store.getFinding("missing")).toBeUndefined();
    expect(store.getDecision("missing")).toBeUndefined();
    expect(store.getArtifact("missing")).toBeUndefined();
    expect(store.getContribution("missing")).toBeUndefined();
    expect(store.getAgentSession("missing")).toBeUndefined();
    expect(store.getParticipant("ws_1", HUMAN)).toBeUndefined();
  });
});

describe("agent sessions", () => {
  it("stores a nullable endedAt and sets it on end", () => {
    seedBase(store);
    store.createAgentSession({
      id: "ses_1",
      agentId: "agt_1",
      humanId: "hum_1",
      workspaceId: "ws_1",
      harness: "codex",
      startedAt: NOW,
    });

    expect(store.getAgentSession("ses_1")).toEqual({
      id: "ses_1",
      agentId: "agt_1",
      humanId: "hum_1",
      workspaceId: "ws_1",
      harness: "codex",
      startedAt: NOW,
      endedAt: undefined,
    });

    store.endAgentSession("ses_1", LATER);
    expect(store.getAgentSession("ses_1")?.endedAt).toBe(LATER);
    expect(store.listAgentSessions("ws_1").map((s) => s.id)).toEqual(["ses_1"]);
  });
});

describe("contribution object persistence and JSON columns", () => {
  it("round-trips workspace, participant, goal, task, artifact, finding, decision, and contribution", () => {
    seedBase(store);
    store.createAgentSession({
      id: "ses_1",
      agentId: "agt_1",
      humanId: "hum_1",
      workspaceId: "ws_1",
      harness: "codex",
      startedAt: NOW,
    });

    store.createGoal({
      id: "goal_1",
      workspaceId: "ws_1",
      title: "Prove continuation",
      description: "Ship Sprint 001",
      status: "active",
      createdBy: HUMAN,
      agentSessionId: "ses_1",
      createdAt: NOW,
      updatedAt: NOW,
    });

    store.createTask({
      id: "task_1",
      workspaceId: "ws_1",
      title: "Write store",
      description: "SQLite + JSON",
      status: "in_progress",
      assignee: AGENT,
      createdBy: HUMAN,
      agentSessionId: "ses_1",
      createdAt: NOW,
      updatedAt: NOW,
    });

    store.createArtifact({
      id: "art_1",
      workspaceId: "ws_1",
      type: "document",
      title: "Design notes",
      uriOrPath: "docs/design.md",
      metadata: { size: 1234, tags: ["design", "sprint"], nested: { ok: true } },
      createdBy: AGENT,
      agentSessionId: "ses_1",
      createdAt: NOW,
    });

    store.createFinding({
      id: "find_1",
      workspaceId: "ws_1",
      summary: "JSON columns round-trip",
      detail: "metadata, instanceMetadata, payload",
      confidence: 0.75,
      sourceArtifactId: "art_1",
      createdBy: AGENT,
      agentSessionId: "ses_1",
      createdAt: NOW,
    });

    store.createDecision({
      id: "dec_1",
      workspaceId: "ws_1",
      summary: "Use better-sqlite3",
      rationale: "Synchronous, embedded, boring",
      status: "accepted",
      approvedBy: HUMAN,
      createdBy: HUMAN,
      agentSessionId: "ses_1",
      createdAt: NOW,
      updatedAt: NOW,
    });

    store.createContribution({
      id: "con_1",
      workspaceId: "ws_1",
      actor: AGENT,
      agentSessionId: "ses_1",
      action: "create",
      objectType: "task",
      objectId: "task_1",
      payload: { note: "created via agent", nested: { count: 3 } },
      createdAt: NOW,
    });

    expect(store.getWorkspace("ws_1")).toEqual({
      id: "ws_1",
      teamId: "team_1",
      name: "Workspace One",
      description: "first workspace",
      status: "active",
      createdBy: HUMAN,
      createdAt: NOW,
      updatedAt: NOW,
    });

    expect(store.getParticipant("ws_1", HUMAN)).toEqual({
      workspaceId: "ws_1",
      actor: HUMAN,
      role: "owner",
      joinedAt: NOW,
    });

    expect(store.getGoal("goal_1")).toEqual({
      id: "goal_1",
      workspaceId: "ws_1",
      title: "Prove continuation",
      description: "Ship Sprint 001",
      status: "active",
      createdBy: HUMAN,
      agentSessionId: "ses_1",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(store.getGoalForWorkspace("ws_1")?.id).toBe("goal_1");

    expect(store.getTask("task_1")).toEqual({
      id: "task_1",
      workspaceId: "ws_1",
      title: "Write store",
      description: "SQLite + JSON",
      status: "in_progress",
      assignee: AGENT,
      createdBy: HUMAN,
      agentSessionId: "ses_1",
      createdAt: NOW,
      updatedAt: NOW,
    });

    expect(store.getArtifact("art_1")).toEqual({
      id: "art_1",
      workspaceId: "ws_1",
      type: "document",
      title: "Design notes",
      uriOrPath: "docs/design.md",
      metadata: { size: 1234, tags: ["design", "sprint"], nested: { ok: true } },
      createdBy: AGENT,
      agentSessionId: "ses_1",
      createdAt: NOW,
    });

    expect(store.getFinding("find_1")).toEqual({
      id: "find_1",
      workspaceId: "ws_1",
      summary: "JSON columns round-trip",
      detail: "metadata, instanceMetadata, payload",
      confidence: 0.75,
      sourceArtifactId: "art_1",
      createdBy: AGENT,
      agentSessionId: "ses_1",
      createdAt: NOW,
    });

    expect(store.getDecision("dec_1")).toEqual({
      id: "dec_1",
      workspaceId: "ws_1",
      summary: "Use better-sqlite3",
      rationale: "Synchronous, embedded, boring",
      status: "accepted",
      approvedBy: HUMAN,
      createdBy: HUMAN,
      agentSessionId: "ses_1",
      createdAt: NOW,
      updatedAt: NOW,
    });

    expect(store.getContribution("con_1")).toEqual({
      id: "con_1",
      workspaceId: "ws_1",
      actor: AGENT,
      agentSessionId: "ses_1",
      action: "create",
      objectType: "task",
      objectId: "task_1",
      payload: { note: "created via agent", nested: { count: 3 } },
      createdAt: NOW,
    });

    expect(store.listParticipants("ws_1").map((p) => p.actor.actorId)).toEqual(["hum_1"]);
  });
});

describe("listWorkspacesForActor", () => {
  it("filters by actor id AND actor type", () => {
    seedBase(store);
    store.createWorkspace({
      id: "ws_2",
      teamId: "team_1",
      name: "Workspace Two",
      status: "active",
      createdBy: HUMAN,
      createdAt: NOW,
      updatedAt: NOW,
    });

    store.createHuman({
      id: "shared_id",
      teamId: "team_1",
      displayName: "Shared Human",
      createdAt: NOW,
    });
    store.createAgent({
      id: "shared_id",
      teamId: "team_1",
      name: "Shared Agent",
      harness: "opencode",
      createdAt: NOW,
    });

    const sharedHuman: ActorRef = { actorId: "shared_id", actorType: "human" };
    const sharedAgent: ActorRef = { actorId: "shared_id", actorType: "agent" };
    store.addParticipant({ workspaceId: "ws_1", actor: sharedHuman, role: "member", joinedAt: NOW });
    store.addParticipant({ workspaceId: "ws_2", actor: sharedAgent, role: "agent", joinedAt: NOW });

    expect(store.listWorkspacesForActor(sharedHuman).map((w) => w.id)).toEqual(["ws_1"]);
    expect(store.listWorkspacesForActor(sharedAgent).map((w) => w.id)).toEqual(["ws_2"]);
    expect(store.listWorkspacesForActor({ actorId: "shared_id", actorType: "human" })).toHaveLength(1);
  });
});

describe("workspace scoping", () => {
  it("scopes tasks, findings, decisions, artifacts, and contributions to a workspace", () => {
    seedBase(store);
    store.createWorkspace({
      id: "ws_2",
      teamId: "team_1",
      name: "Workspace Two",
      status: "active",
      createdBy: HUMAN,
      createdAt: NOW,
      updatedAt: NOW,
    });

    store.createTask({
      id: "task_1",
      workspaceId: "ws_1",
      title: "T1",
      status: "open",
      createdBy: HUMAN,
      createdAt: NOW,
      updatedAt: NOW,
    });
    store.createTask({
      id: "task_2",
      workspaceId: "ws_2",
      title: "T2",
      status: "open",
      createdBy: HUMAN,
      createdAt: NOW,
      updatedAt: NOW,
    });

    store.createFinding({ id: "find_1", workspaceId: "ws_1", summary: "F1", createdBy: HUMAN, createdAt: NOW });
    store.createFinding({ id: "find_2", workspaceId: "ws_2", summary: "F2", createdBy: HUMAN, createdAt: NOW });

    store.createDecision({
      id: "dec_1",
      workspaceId: "ws_1",
      summary: "D1",
      status: "proposed",
      createdBy: HUMAN,
      createdAt: NOW,
      updatedAt: NOW,
    });
    store.createDecision({
      id: "dec_2",
      workspaceId: "ws_2",
      summary: "D2",
      status: "proposed",
      createdBy: HUMAN,
      createdAt: NOW,
      updatedAt: NOW,
    });

    store.createArtifact({
      id: "art_1",
      workspaceId: "ws_1",
      type: "log",
      title: "A1",
      uriOrPath: "a1.log",
      createdBy: HUMAN,
      createdAt: NOW,
    });
    store.createArtifact({
      id: "art_2",
      workspaceId: "ws_2",
      type: "log",
      title: "A2",
      uriOrPath: "a2.log",
      createdBy: HUMAN,
      createdAt: NOW,
    });

    store.createContribution({
      id: "con_1",
      workspaceId: "ws_1",
      actor: HUMAN,
      action: "create",
      objectType: "task",
      objectId: "task_1",
      createdAt: NOW,
    });
    store.createContribution({
      id: "con_2",
      workspaceId: "ws_2",
      actor: HUMAN,
      action: "create",
      objectType: "task",
      objectId: "task_2",
      createdAt: NOW,
    });

    expect(store.listTasks("ws_1").map((t) => t.id)).toEqual(["task_1"]);
    expect(store.listTasks("ws_2").map((t) => t.id)).toEqual(["task_2"]);
    expect(store.listFindings("ws_1").map((f) => f.id)).toEqual(["find_1"]);
    expect(store.listFindings("ws_2").map((f) => f.id)).toEqual(["find_2"]);
    expect(store.listDecisions("ws_1").map((d) => d.id)).toEqual(["dec_1"]);
    expect(store.listDecisions("ws_2").map((d) => d.id)).toEqual(["dec_2"]);
    expect(store.listArtifacts("ws_1").map((a) => a.id)).toEqual(["art_1"]);
    expect(store.listArtifacts("ws_2").map((a) => a.id)).toEqual(["art_2"]);
    expect(store.listContributions("ws_1").map((c) => c.id)).toEqual(["con_1"]);
    expect(store.listContributions("ws_2").map((c) => c.id)).toEqual(["con_2"]);
  });
});

describe("partial updates", () => {
  it("updates only provided workspace fields", () => {
    seedBase(store);
    store.updateWorkspace("ws_1", { name: "Renamed", updatedAt: LATER });

    const workspace = store.getWorkspace("ws_1");
    expect(workspace?.name).toBe("Renamed");
    expect(workspace?.description).toBe("first workspace");
    expect(workspace?.status).toBe("active");
    expect(workspace?.createdBy).toEqual(HUMAN);
    expect(workspace?.createdAt).toBe(NOW);
    expect(workspace?.updatedAt).toBe(LATER);
  });

  it("updates only provided goal fields", () => {
    seedBase(store);
    store.createGoal({
      id: "goal_1",
      workspaceId: "ws_1",
      title: "Original title",
      description: "Original description",
      status: "active",
      createdBy: HUMAN,
      createdAt: NOW,
      updatedAt: NOW,
    });

    store.updateGoal("goal_1", { status: "completed", updatedAt: LATER });

    const goal = store.getGoal("goal_1");
    expect(goal?.title).toBe("Original title");
    expect(goal?.description).toBe("Original description");
    expect(goal?.status).toBe("completed");
    expect(goal?.updatedAt).toBe(LATER);
  });

  it("updates only provided task fields", () => {
    seedBase(store);
    store.createTask({
      id: "task_1",
      workspaceId: "ws_1",
      title: "Task title",
      description: "Task description",
      status: "open",
      assignee: AGENT,
      createdBy: HUMAN,
      createdAt: NOW,
      updatedAt: NOW,
    });

    store.updateTask("task_1", { status: "in_progress", updatedAt: LATER });

    const task = store.getTask("task_1");
    expect(task?.title).toBe("Task title");
    expect(task?.description).toBe("Task description");
    expect(task?.status).toBe("in_progress");
    expect(task?.assignee).toEqual(AGENT);
    expect(task?.updatedAt).toBe(LATER);
  });

  it("clears the assignee when the patch is null", () => {
    seedBase(store);
    store.createTask({
      id: "task_1",
      workspaceId: "ws_1",
      title: "Assigned",
      status: "open",
      assignee: AGENT,
      createdBy: HUMAN,
      createdAt: NOW,
      updatedAt: NOW,
    });

    store.updateTask("task_1", { assignee: null, updatedAt: LATER });
    expect(store.getTask("task_1")?.assignee).toBeUndefined();
  });

  it("updates only provided decision fields and can clear approvedBy", () => {
    seedBase(store);
    store.createDecision({
      id: "dec_1",
      workspaceId: "ws_1",
      summary: "Original summary",
      rationale: "Original rationale",
      status: "proposed",
      approvedBy: HUMAN,
      createdBy: HUMAN,
      createdAt: NOW,
      updatedAt: NOW,
    });

    store.updateDecision("dec_1", { rationale: "Updated rationale", updatedAt: LATER });

    const decision = store.getDecision("dec_1");
    expect(decision?.summary).toBe("Original summary");
    expect(decision?.rationale).toBe("Updated rationale");
    expect(decision?.status).toBe("proposed");
    expect(decision?.approvedBy).toEqual(HUMAN);
    expect(decision?.updatedAt).toBe(LATER);

    store.updateDecision("dec_1", { approvedBy: null, updatedAt: LATER });
    expect(store.getDecision("dec_1")?.approvedBy).toBeUndefined();
  });
});

describe("actor tokens and workspace invites", () => {
  it("round-trips a token hash and revoke", () => {
    seedBase(store);
    store.createActorToken({
      id: "tok_1",
      actor: HUMAN,
      tokenHash: "abc123",
      createdAt: NOW,
    });

    expect(store.getActorTokenByHash("abc123")).toEqual({
      id: "tok_1",
      actor: HUMAN,
      tokenHash: "abc123",
      createdAt: NOW,
      revokedAt: undefined,
    });
    expect(store.getActorTokenByHash("missing")).toBeUndefined();

    store.revokeActorToken("tok_1", LATER);
    expect(store.getActorTokenByHash("abc123")?.revokedAt).toBe(LATER);
  });

  it("creates, lists, and consumes an open invite", () => {
    seedBase(store);
    store.createInvite({
      id: "inv_1",
      workspaceId: "ws_1",
      actor: AGENT,
      role: "agent",
      invitedBy: HUMAN,
      createdAt: NOW,
    });

    expect(store.getOpenInvite("ws_1", AGENT)).toMatchObject({ id: "inv_1", consumedAt: undefined });
    expect(store.listInvites("ws_1").map((invite) => invite.id)).toEqual(["inv_1"]);

    store.consumeInvite("inv_1", LATER);
    expect(store.getOpenInvite("ws_1", AGENT)).toBeUndefined();
    expect(store.listInvites("ws_1")[0]?.consumedAt).toBe(LATER);
  });
});

describe("transactions", () => {
  it("returns the callback result and commits", () => {
    seedBase(store);
    const result = store.transaction(() => {
      store.createHuman({ id: "hum_2", teamId: "team_1", displayName: "Human Two", createdAt: NOW });
      return "committed";
    });

    expect(result).toBe("committed");
    expect(store.getHuman("hum_2")?.displayName).toBe("Human Two");
  });

  it("rolls back when the callback throws", () => {
    seedBase(store);
    expect(() =>
      store.transaction(() => {
        store.createHuman({ id: "hum_3", teamId: "team_1", displayName: "Human Three", createdAt: NOW });
        throw new Error("boom");
      }),
    ).toThrow("boom");

    expect(store.getHuman("hum_3")).toBeUndefined();
  });
});

describe("foreign-key integrity", () => {
  it("rejects a task referencing an unknown workspace", () => {
    seedBase(store);
    expect(() =>
      store.createTask({
        id: "task_orphan",
        workspaceId: "ws_missing",
        title: "Orphan",
        status: "open",
        createdBy: HUMAN,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ).toThrow();
  });
});

describe("persistence across process restart", () => {
  it("survives close and reopen of the same database file", () => {
    const dir = mkdtempSync(join(tmpdir(), "campfire-persistence-"));
    const file = join(dir, "campfire.db");
    try {
      const first = openSqliteStore(file);
      seedBase(first);
      first.createGoal({
        id: "goal_1",
        workspaceId: "ws_1",
        title: "Durable goal",
        description: "Should survive restart",
        status: "active",
        createdBy: HUMAN,
        createdAt: NOW,
        updatedAt: NOW,
      });
      first.createTask({
        id: "task_1",
        workspaceId: "ws_1",
        title: "Durable task",
        status: "open",
        createdBy: HUMAN,
        createdAt: NOW,
        updatedAt: NOW,
      });
      first.close();

      const second = openSqliteStore(file);
      expect(second.getWorkspace("ws_1")?.name).toBe("Workspace One");
      expect(second.getAgent("agt_1")?.instanceMetadata).toEqual({ host: "local", nested: { depth: 2 } });
      expect(second.getGoal("goal_1")?.title).toBe("Durable goal");
      expect(second.listTasks("ws_1").map((t) => t.id)).toEqual(["task_1"]);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
