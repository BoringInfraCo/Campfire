import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import {
  deriveRecordedAlignment,
  ORIENTATION_PROVENANCE_LIMIT,
  type CampfireService,
} from "../../src/service/service.js";
import type { ActorContext } from "../../src/service/authorization.js";
import type { ActorRef, Decision, ParticipantRole, Task, WorkspaceParticipant } from "../../src/domain/types.js";
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

describe("Sprint 008 orientation projection", () => {
  interface Populated {
    workspaceId: string;
    actionable: Decision;
    accepted: Decision;
    assignedOpen: Task;
    assignedBlocked: Task;
    inProgress: Task;
    completed: Task;
    unassignedBlocked: Task;
    otherBlocked: Task;
  }

  // Build a workspace through the product (never the empty seed fixture):
  // goal, participants, proposed + accepted decisions, tasks in all four
  // states with assignees, findings, and an artifact.
  function populate(): Populated {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Room" });
    inviteAndJoin(ctxHuman1, ctxHuman2, workspace.id, "member");
    inviteAndJoin(ctxHuman1, ctxAgent1, workspace.id, "agent");
    service.createGoal(ctxHuman1, { workspaceId: workspace.id, title: "Ship the room" });

    const actionable = service.addDecision(ctxHuman1, {
      workspaceId: workspace.id,
      summary: "Adopt D1",
    });
    const accepted = service.addDecision(ctxHuman1, {
      workspaceId: workspace.id,
      summary: "Adopt D2",
    });
    service.acceptDecision(ctxHuman1, accepted.id);

    const assignedOpen = service.createTask(ctxHuman1, {
      workspaceId: workspace.id,
      title: "Open mine",
      assignee: HUMAN1,
    });
    const assignedBlocked = service.createTask(ctxHuman1, {
      workspaceId: workspace.id,
      title: "Blocked mine",
      assignee: HUMAN1,
    });
    service.updateTask(ctxHuman1, { taskId: assignedBlocked.id, status: "blocked" });
    const inProgress = service.createTask(ctxHuman1, {
      workspaceId: workspace.id,
      title: "In progress",
      assignee: HUMAN1,
    });
    service.updateTask(ctxHuman1, { taskId: inProgress.id, status: "in_progress" });
    const completed = service.createTask(ctxHuman1, {
      workspaceId: workspace.id,
      title: "Done",
      assignee: HUMAN1,
    });
    service.updateTask(ctxHuman1, { taskId: completed.id, status: "in_progress" });
    service.updateTask(ctxHuman1, { taskId: completed.id, status: "completed" });

    const unassignedBlocked = service.createTask(ctxHuman1, {
      workspaceId: workspace.id,
      title: "Unassigned blocked",
    });
    service.updateTask(ctxHuman1, { taskId: unassignedBlocked.id, status: "blocked" });
    const otherBlocked = service.createTask(ctxHuman1, {
      workspaceId: workspace.id,
      title: "Other blocked",
      assignee: HUMAN2,
    });
    service.updateTask(ctxHuman1, { taskId: otherBlocked.id, status: "blocked" });

    service.addFinding(ctxHuman1, { workspaceId: workspace.id, summary: "Finding A" });
    service.addArtifact(ctxHuman1, {
      workspaceId: workspace.id,
      type: "log",
      title: "Log A",
      uriOrPath: "a.log",
    });

    return {
      workspaceId: workspace.id,
      actionable,
      accepted,
      assignedOpen,
      assignedBlocked,
      inProgress,
      completed,
      unassignedBlocked,
      otherBlocked,
    };
  }

  it("derives needsYou, needsAttention, currentWork, and provenance from one call", () => {
    const p = populate();
    const context = service.getWorkspaceContext(ctxHuman1, p.workspaceId);

    // Needs You: only items the owner is authorized to act on.
    expect(context.needsYou.map((item) => item.reason)).toEqual([
      "proposed_decision_actionable",
      "assigned_blocked_task",
      "assigned_open_task",
    ]);
    expect(context.needsYou.find((item) => item.reason === "proposed_decision_actionable")).toMatchObject({
      kind: "decision",
      id: p.actionable.id,
      status: "proposed",
      summary: "Adopt D1",
    });
    expect(context.needsYou.find((item) => item.reason === "assigned_blocked_task")).toMatchObject({
      kind: "task",
      id: p.assignedBlocked.id,
      assignee: HUMAN1,
    });
    expect(context.needsYou.find((item) => item.reason === "assigned_open_task")?.id).toBe(
      p.assignedOpen.id,
    );

    // Needs Attention: team-level items the owner cannot act on directly.
    expect(context.needsAttention.map((item) => item.reason)).toEqual([
      "unassigned_blocked_task",
      "team_blocked_task",
    ]);
    expect(context.needsAttention.find((item) => item.reason === "unassigned_blocked_task")?.id).toBe(
      p.unassignedBlocked.id,
    );
    expect(context.needsAttention.find((item) => item.reason === "team_blocked_task")?.id).toBe(
      p.otherBlocked.id,
    );

    // Current work is authorization-independent.
    expect(context.currentWork.inProgressTasks.map((task) => task.id)).toEqual([p.inProgress.id]);
    expect(context.currentWork.blockedTasks.map((task) => task.id).sort()).toEqual(
      [p.assignedBlocked.id, p.unassignedBlocked.id, p.otherBlocked.id].sort(),
    );
    expect(context.currentWork.acceptedDecisions.map((decision) => decision.id)).toEqual([
      p.accepted.id,
    ]);
    expect(context.openTasks.map((task) => task.id)).not.toContain(p.completed.id);

    // Suggested next action is the highest-precedence actionable item, as a hint.
    expect(context.suggestedNextAction).toEqual({
      kind: "decision",
      id: p.actionable.id,
      summary: "Adopt D1",
      reason: "proposed_decision_actionable",
      orientationHint: true,
    });

    // Provenance summary reuses describeContribution over the full activity.
    expect(context.provenanceSummary.length).toBe(context.provenanceTotal);
    expect(context.provenanceSummary.some((line) => line.includes("Finding A"))).toBe(true);

    // No cursor supplied, no `since` projection.
    expect(context.since).toBeUndefined();
  });

  it("follows suggestedNextAction precedence deterministically", () => {
    // 1. actionable proposed decision beats an assigned blocked task.
    const ws1 = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "P1" });
    const decision1 = service.addDecision(ctxHuman1, { workspaceId: ws1.id, summary: "decide" });
    const blocked1 = service.createTask(ctxHuman1, {
      workspaceId: ws1.id,
      title: "blocked",
      assignee: HUMAN1,
    });
    service.updateTask(ctxHuman1, { taskId: blocked1.id, status: "blocked" });
    expect(service.getWorkspaceContext(ctxHuman1, ws1.id).suggestedNextAction).toMatchObject({
      kind: "decision",
      id: decision1.id,
      reason: "proposed_decision_actionable",
      orientationHint: true,
    });

    // 2. caller-assigned blocked task.
    const ws2 = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "P2" });
    const blocked2 = service.createTask(ctxHuman1, {
      workspaceId: ws2.id,
      title: "blocked",
      assignee: HUMAN1,
    });
    service.updateTask(ctxHuman1, { taskId: blocked2.id, status: "blocked" });
    expect(service.getWorkspaceContext(ctxHuman1, ws2.id).suggestedNextAction).toMatchObject({
      kind: "task",
      id: blocked2.id,
      reason: "assigned_blocked_task",
      orientationHint: true,
    });

    // 3. caller-assigned open task.
    const ws3 = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "P3" });
    const open3 = service.createTask(ctxHuman1, {
      workspaceId: ws3.id,
      title: "open",
      assignee: HUMAN1,
    });
    expect(service.getWorkspaceContext(ctxHuman1, ws3.id).suggestedNextAction).toMatchObject({
      kind: "task",
      id: open3.id,
      reason: "assigned_open_task",
      orientationHint: true,
    });

    // 4a. unassigned blocked task.
    const ws4 = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "P4" });
    const unassigned4 = service.createTask(ctxHuman1, {
      workspaceId: ws4.id,
      title: "unassigned blocked",
    });
    service.updateTask(ctxHuman1, { taskId: unassigned4.id, status: "blocked" });
    expect(service.getWorkspaceContext(ctxHuman1, ws4.id).suggestedNextAction).toMatchObject({
      kind: "task",
      id: unassigned4.id,
      reason: "unassigned_blocked_task",
      orientationHint: true,
    });

    // 4c. oldest open task when nothing higher-precedence exists.
    const ws5 = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "P5" });
    const oldest = service.createTask(ctxHuman1, { workspaceId: ws5.id, title: "first" });
    service.createTask(ctxHuman1, { workspaceId: ws5.id, title: "second" });
    expect(service.getWorkspaceContext(ctxHuman1, ws5.id).suggestedNextAction).toMatchObject({
      kind: "task",
      id: oldest.id,
      orientationHint: true,
    });

    // 5. nothing to suggest.
    const ws6 = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "P6" });
    expect(service.getWorkspaceContext(ctxHuman1, ws6.id).suggestedNextAction).toEqual({
      kind: "none",
      summary: "",
      reason: "none",
      orientationHint: true,
    });
  });

  it("tie-breaks equal updatedAt by id", () => {
    const constant = createCampfireService({
      store,
      idSource: createCounterIdSource(),
      clock: () => NOW,
    });
    const workspace = constant.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Tie" });
    const first = constant.addDecision(ctxHuman1, { workspaceId: workspace.id, summary: "A" });
    const second = constant.addDecision(ctxHuman1, { workspaceId: workspace.id, summary: "B" });

    const context = constant.getWorkspaceContext(ctxHuman1, workspace.id);
    expect(context.needsYou.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(context.suggestedNextAction.id).toBe(first.id);
  });

  it("is authorization-aware: a viewer gets no Needs You decision", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Viewer" });
    inviteAndJoin(ctxHuman1, ctxHuman2, workspace.id, "viewer");
    const decision = service.addDecision(ctxHuman1, {
      workspaceId: workspace.id,
      summary: "Viewer cannot accept",
    });

    const context = service.getWorkspaceContext(ctxHuman2, workspace.id);
    expect(context.needsYou).toEqual([]);
    expect(context.needsAttention).toEqual([
      {
        kind: "decision",
        id: decision.id,
        summary: "Viewer cannot accept",
        status: "proposed",
        reason: "team_proposed_decision",
      },
    ]);
    expect(context.suggestedNextAction).toMatchObject({
      kind: "decision",
      id: decision.id,
      reason: "team_proposed_decision",
      orientationHint: true,
    });
  });

  it("rejects a non-participant before retrieval", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Private" });
    expect(() => service.getWorkspaceContext(ctxAgent1, workspace.id)).toThrow(ParticipantRequired);
  });

  it("projects contributions strictly after a since cursor", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Since" });
    service.addFinding(ctxHuman1, { workspaceId: workspace.id, summary: "one" });
    service.addFinding(ctxHuman1, { workspaceId: workspace.id, summary: "two" });
    const activity = store.listContributions(workspace.id);
    const anchor = activity[1]!.id;

    const context = service.getWorkspaceContext(ctxHuman1, workspace.id, { since: anchor });
    expect(context.since?.items.map((item) => item.id)).toEqual(
      activity.slice(2).map((item) => item.id),
    );
    expect(context.since?.cursor).toBe(activity.at(-1)!.id);
    expect(context.since?.truncated).toBe(false);
  });

  it("caps the since window and rejects an unknown cursor", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "SinceCap" });
    const anchor = store.listContributions(workspace.id).at(-1)!.id;
    for (let index = 0; index < ORIENTATION_PROVENANCE_LIMIT + 3; index += 1) {
      service.addFinding(ctxHuman1, { workspaceId: workspace.id, summary: `finding ${index}` });
    }
    const activity = store.listContributions(workspace.id);

    const context = service.getWorkspaceContext(ctxHuman1, workspace.id, { since: anchor });
    expect(context.since?.truncated).toBe(true);
    expect(context.since?.items).toHaveLength(ORIENTATION_PROVENANCE_LIMIT);
    expect(context.since?.items.map((item) => item.id)).toEqual(
      activity.slice(-ORIENTATION_PROVENANCE_LIMIT).map((item) => item.id),
    );
    // The window keeps the newest 20; the omitted prefix is absent.
    expect(context.since?.items.map((item) => item.id)).not.toContain(activity[1]!.id);
    expect(context.since?.items.at(-1)?.id).toBe(activity.at(-1)!.id);
    // The resume cursor is the newest id in the log, including when truncated.
    expect(context.since?.cursor).toBe(activity.at(-1)!.id);

    let thrown: unknown;
    try {
      service.getWorkspaceContext(ctxHuman1, workspace.id, { since: "con_missing" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ValidationError);
    expect((thrown as ValidationError).details?.field).toBe("since");
  });
});

describe("Sprint 010 return contract", () => {
  it("returns exactly the other participant's changes after a stored cursor", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Return" });
    inviteAndJoin(ctxHuman1, ctxHuman2, workspace.id, "member");
    const decision = service.addDecision(ctxHuman1, {
      workspaceId: workspace.id,
      summary: "Return decision",
    });
    const task = service.createTask(ctxHuman1, {
      workspaceId: workspace.id,
      title: "Return task",
      assignee: HUMAN1,
    });

    // The returning caller observed the workspace at this point and retained
    // the newest contribution id as the prior cursor.
    const before = service.getWorkspaceContext(ctxHuman1, workspace.id);
    const cursor = before.provenance.at(-1)!.id;

    // Another participant accepts the decision, blocks the task, and reassigns it.
    service.acceptDecision(ctxHuman2, decision.id);
    service.updateTask(ctxHuman2, { taskId: task.id, status: "blocked" });
    const reassigned = service.updateTask(ctxHuman2, { taskId: task.id, assignee: HUMAN2 });

    const after = service.getWorkspaceContext(ctxHuman1, workspace.id);
    const delta = service.getWorkspaceContext(ctxHuman1, workspace.id, { since: cursor });

    expect(delta.since).toBeDefined();
    expect(delta.since!.items.map((item) => [item.action, item.objectType, item.objectId])).toEqual([
      ["update", "decision", decision.id],
      ["update", "task", task.id],
      ["update", "task", task.id],
    ]);
    expect(delta.since!.items.every((item) => item.actor.actorId === HUMAN2.actorId)).toBe(true);
    expect(delta.since!.items.map((item) => item.payload)).toEqual([
      { status: "accepted" },
      { status: "blocked" },
      { assignee: HUMAN2 },
    ]);
    expect(delta.since!.truncated).toBe(false);
    expect(delta.since!.cursor).toBe(after.provenance.at(-1)!.id);
    expect(reassigned.assignee).toEqual(HUMAN2);

    // Current implications are the siblings on the same response.
    expect(delta.alignment).toEqual(after.alignment);
    expect(delta.currentWork).toEqual(after.currentWork);
    expect(delta.suggestedNextAction).toEqual(after.suggestedNextAction);
  });

  it("returns an empty window at the newest id and exposes it through provenance", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Newest" });
    service.addFinding(ctxHuman1, { workspaceId: workspace.id, summary: "only" });

    const context = service.getWorkspaceContext(ctxHuman1, workspace.id);
    expect(context.since).toBeUndefined();
    const newest = context.provenance.at(-1)!.id;

    const empty = service.getWorkspaceContext(ctxHuman1, workspace.id, { since: newest });
    expect(empty.since).toEqual({ cursor: newest, items: [], truncated: false });
  });

  it("fails closed for a cursor from another workspace without returning rows", () => {
    const a = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "A" });
    const b = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "B" });
    service.addFinding(ctxHuman1, { workspaceId: b.id, summary: "B finding" });
    const foreign = store.listContributions(b.id).at(-1)!.id;

    let thrown: unknown;
    try {
      service.getWorkspaceContext(ctxHuman1, a.id, { since: foreign });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ValidationError);
    expect((thrown as ValidationError).details).toEqual({ field: "since", since: foreign });
    // The read is rejected as a whole; no partial projection from either workspace.
    expect(String((thrown as ValidationError).message)).not.toContain("B finding");
  });

  it("rejects a non-participant before reading the delta", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Private return" });
    service.addFinding(ctxHuman1, { workspaceId: workspace.id, summary: "hidden" });
    const cursor = store.listContributions(workspace.id).at(-1)!.id;

    expect(() => service.getWorkspaceContext(ctxHuman2, workspace.id, { since: cursor })).toThrow(
      ParticipantRequired,
    );
  });
});

describe("Sprint 008 attention edge cases", () => {
  it("demotes viewer-assigned blocked and open tasks to needsAttention, not needsYou", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Viewer edges" });
    inviteAndJoin(ctxHuman1, ctxHuman2, workspace.id, "viewer");

    // Tasks are assigned to the viewer by the owner; the viewer may read but
    // cannot act, so neither task may surface as Needs You (Sprint 008).
    const blocked = service.createTask(ctxHuman1, {
      workspaceId: workspace.id,
      title: "Viewer blocked",
      assignee: HUMAN2,
    });
    service.updateTask(ctxHuman1, { taskId: blocked.id, status: "blocked" });
    const open = service.createTask(ctxHuman1, {
      workspaceId: workspace.id,
      title: "Viewer open",
      assignee: HUMAN2,
    });

    const context = service.getWorkspaceContext(ctxHuman2, workspace.id);
    expect(context.needsYou).toEqual([]);
    expect(context.needsAttention).toEqual([
      {
        kind: "task",
        id: blocked.id,
        summary: "Viewer blocked",
        status: "blocked",
        reason: "team_blocked_task",
        assignee: HUMAN2,
      },
      {
        kind: "task",
        id: open.id,
        summary: "Viewer open",
        status: "open",
        reason: "assigned_open_task",
        assignee: HUMAN2,
      },
    ]);
  });

  it("falls back to team_open_task for an unassigned oldest open task", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Fallback" });
    const oldest = service.createTask(ctxHuman1, { workspaceId: workspace.id, title: "Oldest open" });
    service.createTask(ctxHuman1, { workspaceId: workspace.id, title: "Newer open" });

    const context = service.getWorkspaceContext(ctxHuman1, workspace.id);
    // The owner cannot act on an unassigned task, so it is neither Needs You
    // nor Needs Attention; the generic fallback still points at it.
    expect(context.needsYou).toEqual([]);
    expect(context.needsAttention).toEqual([]);
    expect(context.suggestedNextAction).toEqual({
      kind: "task",
      id: oldest.id,
      summary: "Oldest open",
      reason: "team_open_task",
      orientationHint: true,
    });
  });

  it("keeps an actionable proposed decision ahead of the team_open_task fallback", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Precedence" });
    const decision = service.addDecision(ctxHuman1, { workspaceId: workspace.id, summary: "Decide now" });
    const fallback = service.createTask(ctxHuman1, {
      workspaceId: workspace.id,
      title: "Unassigned open",
    });

    const context = service.getWorkspaceContext(ctxHuman1, workspace.id);
    expect(context.needsAttention).toEqual([]);
    expect(context.suggestedNextAction).toEqual({
      kind: "decision",
      id: decision.id,
      summary: "Decide now",
      reason: "proposed_decision_actionable",
      orientationHint: true,
    });
    expect(context.suggestedNextAction.id).not.toBe(fallback.id);
  });
});

describe("Sprint 009 recorded alignment", () => {
  it("is open when a proposed decision exists, even alongside an accepted one", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Open" });
    const acceptedLater = service.addDecision(ctxHuman1, {
      workspaceId: workspace.id,
      summary: "Accepted later stamp",
    });
    service.acceptDecision(ctxHuman1, acceptedLater.id);
    const acceptedEarlier = service.addDecision(ctxHuman1, {
      workspaceId: workspace.id,
      summary: "Accepted earlier stamp",
    });
    service.acceptDecision(ctxHuman1, acceptedEarlier.id);
    const proposedLater = service.addDecision(ctxHuman1, {
      workspaceId: workspace.id,
      summary: "Proposed later stamp",
    });
    const proposedEarlier = service.addDecision(ctxHuman1, {
      workspaceId: workspace.id,
      summary: "Proposed earlier stamp",
    });

    // List order is created_at. Stamps invert that so the projection must sort.
    const earlier = clock.tick();
    const later = clock.tick();
    store.updateDecision(proposedEarlier.id, { updatedAt: earlier });
    store.updateDecision(proposedLater.id, { updatedAt: later });
    store.updateDecision(acceptedEarlier.id, { updatedAt: earlier });
    store.updateDecision(acceptedLater.id, { updatedAt: later });

    const context = service.getWorkspaceContext(ctxHuman1, workspace.id);
    expect(context.alignment).toEqual({
      status: "open",
      proposedDecisionIds: [proposedEarlier.id, proposedLater.id],
      acceptedDecisionIds: [acceptedEarlier.id, acceptedLater.id],
      unresolvedBlockedTaskIds: [],
    });

    const same = clock.tick();
    const tied = deriveRecordedAlignment(
      [
        { ...store.getDecision(proposedEarlier.id)!, updatedAt: same },
        { ...store.getDecision(proposedLater.id)!, updatedAt: same },
      ],
      [],
    );
    expect(tied.status).toBe("open");
    expect(tied.proposedDecisionIds).toEqual([proposedLater.id, proposedEarlier.id]);
  });

  it("is established when accepted decisions exist and no proposal does", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Established" });
    const first = service.addDecision(ctxHuman1, {
      workspaceId: workspace.id,
      summary: "First accepted",
    });
    service.acceptDecision(ctxHuman1, first.id);
    const second = service.addDecision(ctxHuman1, {
      workspaceId: workspace.id,
      summary: "Second accepted",
    });
    service.acceptDecision(ctxHuman1, second.id);
    const superseded = service.addDecision(ctxHuman1, {
      workspaceId: workspace.id,
      summary: "No longer current",
    });
    store.updateDecision(superseded.id, { status: "superseded", updatedAt: clock.tick() });

    const earlier = clock.tick();
    const later = clock.tick();
    store.updateDecision(second.id, { updatedAt: earlier });
    store.updateDecision(first.id, { updatedAt: later });

    const context = service.getWorkspaceContext(ctxHuman1, workspace.id);
    expect(context.alignment).toEqual({
      status: "established",
      proposedDecisionIds: [],
      acceptedDecisionIds: [second.id, first.id],
      unresolvedBlockedTaskIds: [],
    });
  });

  it("is unspecified when the workspace has no decisions", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "None" });
    const open = service.createTask(ctxHuman1, { workspaceId: workspace.id, title: "Still open" });

    const context = service.getWorkspaceContext(ctxHuman1, workspace.id);
    expect(context.alignment).toEqual({
      status: "unspecified",
      proposedDecisionIds: [],
      acceptedDecisionIds: [],
      unresolvedBlockedTaskIds: [],
    });
    expect(context.alignment.unresolvedBlockedTaskIds).not.toContain(open.id);
  });

  it("is unspecified when the only decisions are superseded", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Superseded" });
    const decision = service.addDecision(ctxHuman1, {
      workspaceId: workspace.id,
      summary: "Old constraint",
    });
    store.updateDecision(decision.id, { status: "superseded", updatedAt: clock.tick() });

    const context = service.getWorkspaceContext(ctxHuman1, workspace.id);
    expect(context.alignment.status).toBe("unspecified");
    expect(context.alignment.proposedDecisionIds).toEqual([]);
    expect(context.alignment.acceptedDecisionIds).toEqual([]);
    expect(context.alignment.proposedDecisionIds).not.toContain(decision.id);
    expect(context.alignment.acceptedDecisionIds).not.toContain(decision.id);
  });

  it("lists a blocked task independently of a proposal and omits other task states", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Blocked" });
    const proposed = service.addDecision(ctxHuman1, {
      workspaceId: workspace.id,
      summary: "Still proposed",
    });
    const open = service.createTask(ctxHuman1, { workspaceId: workspace.id, title: "Open" });
    const inProgress = service.createTask(ctxHuman1, {
      workspaceId: workspace.id,
      title: "In progress",
    });
    service.updateTask(ctxHuman1, { taskId: inProgress.id, status: "in_progress" });
    const completed = service.createTask(ctxHuman1, { workspaceId: workspace.id, title: "Done" });
    service.updateTask(ctxHuman1, { taskId: completed.id, status: "in_progress" });
    service.updateTask(ctxHuman1, { taskId: completed.id, status: "completed" });
    const blockedLater = service.createTask(ctxHuman1, {
      workspaceId: workspace.id,
      title: "Blocked later",
    });
    service.updateTask(ctxHuman1, { taskId: blockedLater.id, status: "blocked" });
    const blockedEarlier = service.createTask(ctxHuman1, {
      workspaceId: workspace.id,
      title: "Blocked earlier",
    });
    service.updateTask(ctxHuman1, { taskId: blockedEarlier.id, status: "blocked" });

    const earlier = clock.tick();
    const later = clock.tick();
    store.updateTask(blockedEarlier.id, { updatedAt: earlier });
    store.updateTask(blockedLater.id, { updatedAt: later });

    const context = service.getWorkspaceContext(ctxHuman1, workspace.id);
    expect(context.alignment.status).toBe("open");
    expect(context.alignment.proposedDecisionIds).toEqual([proposed.id]);
    expect(context.alignment.acceptedDecisionIds).toEqual([]);
    expect(context.alignment.unresolvedBlockedTaskIds).toEqual([
      blockedEarlier.id,
      blockedLater.id,
    ]);
    expect(context.alignment.unresolvedBlockedTaskIds).not.toContain(open.id);
    expect(context.alignment.unresolvedBlockedTaskIds).not.toContain(inProgress.id);
    expect(context.alignment.unresolvedBlockedTaskIds).not.toContain(completed.id);
    expect(Object.keys(context.alignment)).toEqual([
      "status",
      "proposedDecisionIds",
      "acceptedDecisionIds",
      "unresolvedBlockedTaskIds",
    ]);
  });

  it("keeps needsYou and needsAttention authorization unchanged", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Viewer" });
    inviteAndJoin(ctxHuman1, ctxHuman2, workspace.id, "viewer");
    const decision = service.addDecision(ctxHuman1, {
      workspaceId: workspace.id,
      summary: "Viewer cannot accept",
    });

    const owner = service.getWorkspaceContext(ctxHuman1, workspace.id);
    expect(owner.needsYou.find((item) => item.id === decision.id)).toMatchObject({
      reason: "proposed_decision_actionable",
      status: "proposed",
    });
    expect(owner.needsAttention.map((item) => item.reason)).not.toContain("team_proposed_decision");

    const viewer = service.getWorkspaceContext(ctxHuman2, workspace.id);
    expect(viewer.needsYou).toEqual([]);
    expect(viewer.needsAttention).toEqual([
      {
        kind: "decision",
        id: decision.id,
        summary: "Viewer cannot accept",
        status: "proposed",
        reason: "team_proposed_decision",
      },
    ]);
  });

  it("records exactly one contribution on accept and none when deriving alignment", () => {
    const workspace = service.createWorkspace(ctxHuman1, { teamId: "team_1", name: "Provenance" });
    const decision = service.addDecision(ctxHuman1, {
      workspaceId: workspace.id,
      summary: "Accept me",
    });
    const before = store.listContributions(workspace.id).length;

    service.getWorkspaceContext(ctxHuman1, workspace.id);
    expect(store.listContributions(workspace.id).length).toBe(before);

    service.acceptDecision(ctxHuman1, decision.id);
    expect(store.listContributions(workspace.id).length).toBe(before + 1);

    const context = service.getWorkspaceContext(ctxHuman1, workspace.id);
    expect(context.alignment.status).toBe("established");
    expect(context.alignment.acceptedDecisionIds).toEqual([decision.id]);
    expect(store.listContributions(workspace.id).length).toBe(before + 1);
    expect(store.listContributions(workspace.id).at(-1)).toMatchObject({
      action: "update",
      objectType: "decision",
      objectId: decision.id,
    });
  });
});
