import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { ORIENTATION_PROVENANCE_LIMIT, type CampfireService } from "../../src/service/service.js";
import type { ActorContext } from "../../src/service/authorization.js";
import type { ActorRef, ParticipantRole, WorkspaceParticipant } from "../../src/domain/types.js";
import {
  ActorNotFound,
  ArtifactNotFound,
  Conflict,
  CrossWorkspaceReference,
  InvalidTransition,
  ParticipantRequired,
  Unauthorized,
  ValidationError,
} from "../../src/domain/errors.js";

const NOW = "2026-01-01T00:00:00.000Z";

const HUMAN1: ActorRef = { actorId: "hum_1", actorType: "human" };
const HUMAN2: ActorRef = { actorId: "hum_2", actorType: "human" };
const AGENT1: ActorRef = { actorId: "agt_1", actorType: "agent" };

const ctxHuman1: ActorContext = { actor: HUMAN1 };
const ctxHuman2: ActorContext = { actor: HUMAN2 };
const ctxAgent1: ActorContext = { actor: AGENT1 };

function createClock(startMs = Date.parse(NOW)) {
  let current = startMs;
  const values: string[] = [];
  const tick = (): string => {
    current += 1000;
    const iso = new Date(current).toISOString();
    values.push(iso);
    return iso;
  };
  return {
    tick,
    values,
    last: (): string => {
      const last = values[values.length - 1];
      if (last === undefined) {
        throw new Error("clock has not ticked yet");
      }
      return last;
    },
  };
}

let store: CampfireStore;
let service: CampfireService;
let clock: ReturnType<typeof createClock>;

beforeEach(() => {
  store = openInMemoryStore();
  clock = createClock();
  service = createCampfireService({ store, idSource: createCounterIdSource(), clock: clock.tick });

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

function inviteAndJoin(
  inviter: ActorContext,
  joiner: ActorContext,
  workspaceId: string,
  role: ParticipantRole,
): WorkspaceParticipant {
  service.inviteToWorkspace(inviter, { workspaceId, actor: joiner.actor, role });
  return service.joinWorkspace(joiner, { workspaceId });
}

describe("workspace creation and listing", () => {
  it("creates a workspace with the creator as owner and records contributions", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Sprint 001" });

    expect(workspace.status).toBe("active");
    expect(workspace.createdBy).toEqual(HUMAN1);
    expect(workspace.createdAt).toBe(workspace.updatedAt);

    expect(store.getParticipant(workspace.id, HUMAN1)).toEqual({
      workspaceId: workspace.id,
      actor: HUMAN1,
      role: "owner",
      joinedAt: workspace.createdAt,
    });

    const contributions = store.listContributions(workspace.id);
    expect(contributions.map((c) => [c.action, c.objectType])).toEqual([
      ["create", "workspace"],
      ["join", "participant"],
    ]);
    expect(contributions.every((c) => c.actor.actorId === "hum_1")).toBe(true);
  });

  it("lists only workspaces the actor participates in", () => {
    const a = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    const b = service.createWorkspace(ctxHuman2, { teamId: "team_1", name: "B" });

    expect(service.listWorkspaces(ctxHuman1).map((w) => w.id)).toEqual([a.id]);
    expect(service.listWorkspaces(ctxHuman2).map((w) => w.id)).toEqual([b.id]);
  });

  it("summarizes goal title and open task count", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    service.createGoal(ctxHuman1, { workspaceId: workspace.id, title: "Continuity" });
    service.createTask(ctxHuman1, { workspaceId: workspace.id, title: "T1" });
    const t2 = service.createTask(ctxHuman1, { workspaceId: workspace.id, title: "T2" });
    service.updateTask(ctxHuman1, { taskId: t2.id, status: "completed" });

    const summary = service.listWorkspaces(ctxHuman1)[0]!;
    expect(summary.goalTitle).toBe("Continuity");
    expect(summary.openTaskCount).toBe(1);
  });

  it("rejects unknown team and unknown actor", () => {
    expect(() => service.createWorkspace(ctxHuman1, { teamId: "team_missing", name: "X" })).toThrow();
    expect(() =>
      service.listWorkspaces({ actor: { actorId: "hum_missing", actorType: "human" } }),
    ).toThrow(ActorNotFound);
  });
});

describe("authorization", () => {
  it("rejects reads by non-participants", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });

    expect(() => service.getWorkspace(ctxHuman2, workspace.id)).toThrow(ParticipantRequired);
    expect(() => service.getWorkspaceContext(ctxHuman2, workspace.id)).toThrow(ParticipantRequired);
    expect(() => service.getActivity(ctxHuman2, { workspaceId: workspace.id })).toThrow(
      ParticipantRequired,
    );
  });

  it("does not let an agent inherit its human owner's participation", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });

    expect(store.getParticipant(workspace.id, HUMAN1)?.role).toBe("owner");
    expect(store.getParticipant(workspace.id, AGENT1)).toBeUndefined();
    expect(() => service.getWorkspace(ctxAgent1, workspace.id)).toThrow(ParticipantRequired);
    expect(() => service.createGoal(ctxAgent1, { workspaceId: workspace.id, title: "nope" })).toThrow(
      ParticipantRequired,
    );
  });

  it("prevents viewers from writing but allows reading", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    inviteAndJoin(ctxHuman1, ctxHuman2, workspace.id, "viewer");

    expect(() => service.createGoal(ctxHuman2, { workspaceId: workspace.id, title: "nope" })).toThrow(
      Unauthorized,
    );
    expect(() => service.createTask(ctxHuman2, { workspaceId: workspace.id, title: "nope" })).toThrow(
      Unauthorized,
    );
    expect(service.getWorkspace(ctxHuman2, workspace.id).workspace.id).toBe(workspace.id);
    expect(service.getActivity(ctxHuman2, { workspaceId: workspace.id }).items).toEqual(
      store.listContributions(workspace.id),
    );
  });

  it("rejects an agent session that does not belong to the acting agent", () => {
    store.createAgent({
      id: "agt_2",
      teamId: "team_1",
      humanId: "hum_1",
      name: "Other",
      harness: "opencode",
      createdAt: NOW,
    });
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    const agent2: ActorContext = { actor: { actorId: "agt_2", actorType: "agent" } };
    inviteAndJoin(ctxHuman1, ctxAgent1, workspace.id, "agent");
    inviteAndJoin(ctxHuman1, agent2, workspace.id, "agent");
    const session = service.registerAgentSession(agent2, {
      agentId: "agt_2",
      humanId: "hum_1",
      workspaceId: workspace.id,
      harness: "opencode",
    });

    const wrongCtx: ActorContext = { actor: AGENT1, agentSessionId: session.id };
    expect(() => service.getWorkspace(wrongCtx, workspace.id)).toThrow(Unauthorized);
  });

  it("only lets agents register sessions", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    expect(() =>
      service.registerAgentSession(ctxHuman1, {
        agentId: "agt_1",
        humanId: "hum_1",
        workspaceId: workspace.id,
        harness: "codex",
      }),
    ).toThrow(Unauthorized);
  });
});

describe("provenance", () => {
  it("records finding provenance including the acting agent session", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    inviteAndJoin(ctxHuman1, ctxAgent1, workspace.id, "agent");
    const session = service.registerAgentSession(ctxAgent1, {
      agentId: "agt_1",
      humanId: "hum_1",
      workspaceId: workspace.id,
      harness: "codex",
    });
    const agentCtx: ActorContext = { actor: AGENT1, agentSessionId: session.id };

    const finding = service.addFinding(agentCtx, {
      workspaceId: workspace.id,
      summary: "Node 22 ESM imports need .js",
      detail: "NodeNext resolution",
      confidence: 0.9,
    });

    expect(finding.createdBy).toEqual(AGENT1);
    expect(finding.agentSessionId).toBe(session.id);
    expect(finding.createdAt).toBe(clock.last());

    const contribution = store.listContributions(workspace.id).find((c) => c.objectId === finding.id);
    expect(contribution).toMatchObject({
      action: "create",
      objectType: "finding",
      actor: AGENT1,
      agentSessionId: session.id,
      createdAt: finding.createdAt,
    });
  });

  it("resolves participant names and builds a provenance summary", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    const finding = service.addFinding(ctxHuman1, {
      workspaceId: workspace.id,
      summary: "Something useful",
    });

    const view = service.getWorkspace(ctxHuman1, workspace.id);
    expect(view.participants.find((p) => p.actor.actorId === "hum_1")?.name).toBe("Ada");
    expect(view.provenanceSummary).toContain(
      `Ada contributed finding ${finding.id}: Something useful`,
    );
  });

  it("resolves agent participant harness and human owner", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    inviteAndJoin(ctxHuman1, ctxAgent1, workspace.id, "agent");

    const view = service.getWorkspace(ctxHuman1, workspace.id);
    const agent = view.participants.find((p) => p.actor.actorType === "agent");
    expect(agent?.name).toBe("Codex");
    expect(agent?.harness).toBe("codex");
    expect(agent?.humanOwnerId).toBe("hum_1");
  });

  it("ends an agent session with a timestamp and records the update", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    inviteAndJoin(ctxHuman1, ctxAgent1, workspace.id, "agent");
    const session = service.registerAgentSession(ctxAgent1, {
      agentId: "agt_1",
      humanId: "hum_1",
      workspaceId: workspace.id,
      harness: "codex",
    });

    service.endAgentSession(ctxAgent1, session.id);
    expect(store.getAgentSession(session.id)?.endedAt).toBe(clock.last());

    const latest = store.listContributions(workspace.id).at(-1);
    expect(latest).toMatchObject({
      action: "update",
      objectType: "agent_session",
      objectId: session.id,
    });
  });
});

describe("decisions", () => {
  it("defaults to proposed and supports explicit acceptance", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    const decision = service.addDecision(ctxHuman1, {
      workspaceId: workspace.id,
      summary: "Use SQLite",
    });

    expect(decision.status).toBe("proposed");
    expect(decision.approvedBy).toBeUndefined();

    const accepted = service.acceptDecision(ctxHuman1, decision.id);
    expect(accepted.status).toBe("accepted");
    expect(accepted.approvedBy).toEqual(HUMAN1);

    const latest = store.listContributions(workspace.id).at(-1);
    expect(latest).toMatchObject({
      action: "update",
      objectType: "decision",
      objectId: decision.id,
      payload: { status: "accepted" },
    });
  });

  it("rejects accepting a superseded decision", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    const decision = service.addDecision(ctxHuman1, { workspaceId: workspace.id, summary: "Old" });
    store.updateDecision(decision.id, { status: "superseded", updatedAt: clock.tick() });

    expect(() => service.acceptDecision(ctxHuman1, decision.id)).toThrow(InvalidTransition);
  });
});

describe("tasks", () => {
  it("drives the task lifecycle through explicit transitions", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    const task = service.createTask(ctxHuman1, { workspaceId: workspace.id, title: "Write service" });
    expect(task.status).toBe("open");

    const inProgress = service.updateTask(ctxHuman1, { taskId: task.id, status: "in_progress" });
    expect(inProgress.status).toBe("in_progress");

    const completed = service.updateTask(ctxHuman1, { taskId: task.id, status: "completed" });
    expect(completed.status).toBe("completed");
    expect(completed.updatedAt).toBe(clock.last());

    expect(() => service.updateTask(ctxHuman1, { taskId: task.id, status: "in_progress" })).toThrow(
      InvalidTransition,
    );
  });

  it("appends update contributions without mutating history", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    const task = service.createTask(ctxHuman1, { workspaceId: workspace.id, title: "T" });
    const before = store.listContributions(workspace.id).map((c) => c.id);

    service.updateTask(ctxHuman1, { taskId: task.id, title: "T renamed" });
    service.updateTask(ctxHuman1, { taskId: task.id, status: "in_progress" });

    const after = store.listContributions(workspace.id);
    expect(after.length).toBe(before.length + 2);
    expect(after.slice(0, before.length).map((c) => c.id)).toEqual(before);
    expect(store.getContribution(before[before.length - 1]!)?.action).toBe("create");
  });

  it("returns the task unchanged and records nothing when no fields are provided", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    const task = service.createTask(ctxHuman1, { workspaceId: workspace.id, title: "T" });
    const before = store.listContributions(workspace.id).length;

    const result = service.updateTask(ctxHuman1, { taskId: task.id });

    expect(result).toEqual(task);
    expect(store.listContributions(workspace.id).length).toBe(before);
  });

  it("rejects an unknown task", () => {
    expect(() => service.updateTask(ctxHuman1, { taskId: "task_missing" })).toThrow();
  });

  it("reassigns and clears the task assignee", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    inviteAndJoin(ctxHuman1, ctxAgent1, workspace.id, "agent");
    inviteAndJoin(ctxHuman1, ctxHuman2, workspace.id, "member");
    const task = service.createTask(ctxHuman1, { workspaceId: workspace.id, title: "Write service" });
    expect(task.assignee).toBeUndefined();

    const assigned = service.updateTask(ctxHuman1, { taskId: task.id, assignee: AGENT1 });
    expect(assigned.assignee).toEqual(AGENT1);

    const reassigned = service.updateTask(ctxHuman1, { taskId: task.id, assignee: HUMAN2 });
    expect(reassigned.assignee).toEqual(HUMAN2);
    expect(reassigned.status).toBe("open");

    const cleared = service.updateTask(ctxHuman1, { taskId: task.id, assignee: null });
    expect(cleared.assignee).toBeUndefined();

    const latest = store.listContributions(workspace.id).at(-1);
    expect(latest).toMatchObject({
      action: "update",
      objectType: "task",
      objectId: task.id,
      payload: { assignee: null },
    });
  });
});

describe("artifacts and findings", () => {
  it("rejects cross-workspace and unknown artifact references", () => {
    const a = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    const b = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "B" });
    const artifact = service.addArtifact(ctxHuman1, {
      workspaceId: b.id,
      type: "log",
      title: "B log",
      uriOrPath: "b.log",
    });

    expect(() =>
      service.addFinding(ctxHuman1, {
        workspaceId: a.id,
        summary: "leak",
        sourceArtifactId: artifact.id,
      }),
    ).toThrow(CrossWorkspaceReference);

    expect(() =>
      service.addFinding(ctxHuman1, {
        workspaceId: a.id,
        summary: "missing",
        sourceArtifactId: "art_missing",
      }),
    ).toThrow(ArtifactNotFound);
  });

  it("accepts a same-workspace artifact reference", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    const artifact = service.addArtifact(ctxHuman1, {
      workspaceId: workspace.id,
      type: "document",
      title: "Notes",
      uriOrPath: "notes.md",
    });

    const finding = service.addFinding(ctxHuman1, {
      workspaceId: workspace.id,
      summary: "Read the notes",
      sourceArtifactId: artifact.id,
    });
    expect(finding.sourceArtifactId).toBe(artifact.id);
  });
});

describe("workspace context projections", () => {
  it("scopes context to a single workspace", () => {
    const a = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    const b = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "B" });
    service.createGoal(ctxHuman1, { workspaceId: a.id, title: "Goal A" });
    service.createTask(ctxHuman1, { workspaceId: a.id, title: "Task A" });
    service.addArtifact(ctxHuman1, {
      workspaceId: a.id,
      type: "log",
      title: "A log",
      uriOrPath: "a.log",
    });
    service.createTask(ctxHuman1, { workspaceId: b.id, title: "Task B" });

    const context = service.getWorkspaceContext(ctxHuman1, a.id);
    expect(context.workspace.id).toBe(a.id);
    expect(context.goal?.title).toBe("Goal A");
    expect(context.openTasks.map((t) => t.title)).toEqual(["Task A"]);
    expect(context.artifacts.map((x) => x.title)).toEqual(["A log"]);
    expect(context.provenance.every((c) => c.workspaceId === a.id)).toBe(true);
  });

  it("projects open tasks, proposed and accepted decisions, and caps provenance", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    service.createTask(ctxHuman1, { workspaceId: workspace.id, title: "open" });
    const done = service.createTask(ctxHuman1, { workspaceId: workspace.id, title: "done" });
    service.updateTask(ctxHuman1, { taskId: done.id, status: "completed" });
    const proposed = service.addDecision(ctxHuman1, { workspaceId: workspace.id, summary: "proposed" });
    const accepted = service.addDecision(ctxHuman1, { workspaceId: workspace.id, summary: "accepted" });
    service.acceptDecision(ctxHuman1, accepted.id);
    service.addDecision(ctxHuman1, { workspaceId: workspace.id, summary: "later proposed" });

    const context = service.getWorkspaceContext(ctxHuman1, workspace.id);
    expect(context.openTasks.map((t) => t.title)).toEqual(["open"]);
    expect(context.acceptedDecisions.map((d) => d.id)).toEqual([accepted.id]);
    expect(context.proposedDecisions.map((d) => d.id)).toContain(proposed.id);
    expect(context.supersededDecisions).toEqual([]);
    expect(context.provenanceTruncated).toBe(false);
    expect(context.provenanceTotal).toBe(context.provenance.length);
  });

  it("caps orientation provenance and leaves the full inspector untruncated", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    for (let index = 0; index < ORIENTATION_PROVENANCE_LIMIT + 5; index += 1) {
      service.addFinding(ctxHuman1, { workspaceId: workspace.id, summary: `finding ${index}` });
    }
    const context = service.getWorkspaceContext(ctxHuman1, workspace.id);
    expect(context.provenance).toHaveLength(ORIENTATION_PROVENANCE_LIMIT);
    expect(context.provenanceTruncated).toBe(true);
    expect(context.provenanceTotal).toBeGreaterThan(ORIENTATION_PROVENANCE_LIMIT);
    const inspector = service.getWorkspace(ctxHuman1, workspace.id);
    expect(inspector.activity).toHaveLength(context.provenanceTotal);
  });

  it("normalizes cwd-absolute artifact paths to workspace-relative URIs", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    const absolute = `${process.cwd()}/fixtures/billing/migration-284.sql`;
    const artifact = service.addArtifact(ctxHuman1, {
      workspaceId: workspace.id,
      type: "file",
      title: "migration 284",
      uriOrPath: absolute,
    });
    expect(artifact.uriOrPath).toBe("fixtures/billing/migration-284.sql");
  });

  it("rejects artifact paths that cannot be made workspace-relative", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    expect(() =>
      service.addArtifact(ctxHuman1, {
        workspaceId: workspace.id,
        type: "file",
        title: "secret",
        uriOrPath: "/tmp/secret.sql",
      }),
    ).toThrow(ValidationError);
  });

  it("rejects unauthorized context reads", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    expect(() => service.getWorkspaceContext(ctxHuman2, workspace.id)).toThrow(ParticipantRequired);
    expect(() => service.getWorkspace(ctxHuman2, workspace.id)).toThrow(ParticipantRequired);
  });
});

describe("validation and membership idempotence", () => {
  it("rejects empty required fields", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    expect(() => service.createGoal(ctxHuman1, { workspaceId: workspace.id, title: "  " })).toThrow(
      ValidationError,
    );
    expect(() => service.addFinding(ctxHuman1, { workspaceId: workspace.id, summary: "" })).toThrow(
      ValidationError,
    );
    expect(() => service.addDecision(ctxHuman1, { workspaceId: workspace.id, summary: "" })).toThrow(
      ValidationError,
    );
    expect(() => service.createTask(ctxHuman1, { workspaceId: workspace.id, title: "" })).toThrow(
      ValidationError,
    );
    expect(() =>
      service.addArtifact(ctxHuman1, {
        workspaceId: workspace.id,
        type: "log",
        title: "ok",
        uriOrPath: "",
      }),
    ).toThrow(ValidationError);
  });

  it("is idempotent when joining an existing membership", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    inviteAndJoin(ctxHuman1, ctxHuman2, workspace.id, "member");
    const again = service.joinWorkspace(ctxHuman2, { workspaceId: workspace.id, role: "owner" });
    expect(again.role).toBe("member");
    expect(store.listContributions(workspace.id).filter((c) => c.objectType === "participant")).toHaveLength(
      2,
    );
  });
});

describe("workspace lifecycle", () => {
  it("transitions active → completed → archived and records updates", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });

    const completed = service.updateWorkspace(ctxHuman1, {
      workspaceId: workspace.id,
      status: "completed",
    });
    expect(completed.status).toBe("completed");
    expect(completed.updatedAt).toBe(clock.last());

    const archived = service.updateWorkspace(ctxHuman1, {
      workspaceId: workspace.id,
      status: "archived",
    });
    expect(archived.status).toBe("archived");

    const latest = store.listContributions(workspace.id).at(-1);
    expect(latest).toMatchObject({
      action: "update",
      objectType: "workspace",
      objectId: workspace.id,
      payload: { status: "archived" },
    });
  });

  it("allows completed → active and rejects archived → active", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    service.updateWorkspace(ctxHuman1, { workspaceId: workspace.id, status: "completed" });

    const reopened = service.updateWorkspace(ctxHuman1, {
      workspaceId: workspace.id,
      status: "active",
    });
    expect(reopened.status).toBe("active");

    service.updateWorkspace(ctxHuman1, { workspaceId: workspace.id, status: "archived" });
    expect(() =>
      service.updateWorkspace(ctxHuman1, { workspaceId: workspace.id, status: "active" }),
    ).toThrow(InvalidTransition);
  });

  it("prevents viewers from updating workspace status", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    inviteAndJoin(ctxHuman1, ctxHuman2, workspace.id, "viewer");

    expect(() =>
      service.updateWorkspace(ctxHuman2, { workspaceId: workspace.id, status: "completed" }),
    ).toThrow(Unauthorized);
  });
});

describe("current goal", () => {
  it("rejects a second active goal and allows a new one after completion", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    const first = service.createGoal(ctxHuman1, { workspaceId: workspace.id, title: "First" });

    expect(() => service.createGoal(ctxHuman1, { workspaceId: workspace.id, title: "Second" })).toThrow(
      Conflict,
    );

    const completed = service.updateGoal(ctxHuman1, { goalId: first.id, status: "completed" });
    expect(completed.status).toBe("completed");

    const second = service.createGoal(ctxHuman1, { workspaceId: workspace.id, title: "Second" });
    expect(second.status).toBe("active");
    expect(second.id).not.toBe(first.id);
  });

  it("projects the active goal rather than an older completed one", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    const first = service.createGoal(ctxHuman1, { workspaceId: workspace.id, title: "Old goal" });
    service.updateGoal(ctxHuman1, { goalId: first.id, status: "completed" });
    const second = service.createGoal(ctxHuman1, {
      workspaceId: workspace.id,
      title: "Current goal",
      description: "the live one",
    });

    const context = service.getWorkspaceContext(ctxHuman1, workspace.id);
    expect(context.goal?.id).toBe(second.id);
    expect(context.goal?.title).toBe("Current goal");

    const summary = service.listWorkspaces(ctxHuman1)[0]!;
    expect(summary.goalTitle).toBe("Current goal");
  });

  it("rejects an empty title on update", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    const goal = service.createGoal(ctxHuman1, { workspaceId: workspace.id, title: "Keep" });
    expect(() => service.updateGoal(ctxHuman1, { goalId: goal.id, title: "  " })).toThrow(ValidationError);
  });
});

describe("activity page", () => {
  it("returns the full log when no limit is set", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    service.createGoal(ctxHuman1, { workspaceId: workspace.id, title: "G" });
    service.addFinding(ctxHuman1, { workspaceId: workspace.id, summary: "F" });

    const page = service.getActivity(ctxHuman1, { workspaceId: workspace.id });
    const all = store.listContributions(workspace.id);
    expect(page.items).toEqual(all);
    expect(page.total).toBe(all.length);
    expect(page.truncated).toBe(false);
    expect(page.nextBefore).toBeUndefined();
  });

  it("pages newest-first windows with a before cursor", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    for (let index = 0; index < 5; index += 1) {
      service.addFinding(ctxHuman1, { workspaceId: workspace.id, summary: `finding ${index}` });
    }
    const all = store.listContributions(workspace.id);
    expect(all.length).toBeGreaterThan(5);

    const first = service.getActivity(ctxHuman1, { workspaceId: workspace.id, limit: 3 });
    expect(first.items).toHaveLength(3);
    expect(first.truncated).toBe(true);
    expect(first.nextBefore).toBe(first.items[0]?.id);
    expect(first.items.map((item) => item.id)).toEqual(all.slice(-3).map((item) => item.id));

    const second = service.getActivity(ctxHuman1, {
      workspaceId: workspace.id,
      limit: 3,
      before: first.nextBefore,
    });
    expect(second.items).toHaveLength(3);
    expect(second.truncated).toBe(true);
    const overlap = second.items.filter((item) => first.items.some((other) => other.id === item.id));
    expect(overlap).toEqual([]);
    expect(second.items.at(-1)?.id).not.toBe(first.items[0]?.id);

    expect(() =>
      service.getActivity(ctxHuman1, { workspaceId: workspace.id, before: "con_missing" }),
    ).toThrow(ValidationError);
  });
});
