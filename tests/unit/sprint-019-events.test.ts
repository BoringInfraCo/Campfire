import { afterEach, describe, expect, it } from "vitest";
import { createCounterIdSource } from "../../src/domain/ids.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { createAsyncCampfireService } from "../../src/worker/async-service.js";
import type { AsyncCampfireStore } from "../../src/worker/d1-store.js";
import { ParticipantRequired, Unauthorized } from "../../src/domain/errors.js";

const NOW = "2026-01-01T00:00:00.000Z";
const SECRET = "webhook-secret-should-stay-out";
const TRANSCRIPT = "PRIVATE_TRANSCRIPT_SENTINEL";
const FILE_BYTES = "ARTIFACT_FILE_BYTES_SENTINEL";
const UNRELATED = "UNRELATED_WORKSPACE_SENTINEL";

function clockAt(start: string): () => string {
  let current = Date.parse(start);
  return () => {
    current += 1000;
    return new Date(current).toISOString();
  };
}

function bridgeEnv(workspaceId: string): Record<string, string> {
  return {
    CAMPFIRE_WEBHOOK_ID: "bridge_test",
    CAMPFIRE_WEBHOOK_URL: "http://127.0.0.1:9/hook",
    CAMPFIRE_WEBHOOK_SECRET: SECRET,
    CAMPFIRE_WEBHOOK_EVENTS: "finding.recorded,decision.proposed,decision.accepted,task.blocked,task.completed,goal.completed,artifact.attached,workspace.completed",
    CAMPFIRE_WEBHOOK_WORKSPACES: workspaceId,
  };
}

function setup(webhookEnv?: Record<string, string | undefined>) {
  const store = openInMemoryStore();
  const idSource = createCounterIdSource();
  const service = createCampfireService({
    store,
    idSource,
    clock: clockAt(NOW),
    webhookEnv: webhookEnv ?? {},
  });
  store.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: NOW });
  store.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: NOW });
  store.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
  store.createAgent({
    id: "agt_1",
    teamId: "team_1",
    humanId: "hum_1",
    name: "Codex",
    harness: "codex",
    createdAt: NOW,
  });
  const human: ActorContext = { actor: { actorId: "hum_1", actorType: "human" } };
  const workspace = service.createWorkspace(human, { teamId: "team_1", name: "Billing" });
  return { store, service, human, workspace, idSource };
}

describe("sprint 019 domain events", () => {
  const open: Array<{ close(): void }> = [];
  afterEach(() => {
    for (const service of open) service.close();
    open.length = 0;
  });

  it("emits one event per qualifying transition and links the contribution", () => {
    const { store, service, human, workspace } = setup();
    open.push(service);
    const finding = service.addFinding(human, { workspaceId: workspace.id, summary: "Retry budget is 3" });
    const decision = service.addDecision(human, { workspaceId: workspace.id, summary: "Keep SQLite" });
    service.acceptDecision(human, decision.id);
    const task = service.createTask(human, { workspaceId: workspace.id, title: "Ship the migration" });
    service.updateTask(human, { taskId: task.id, status: "in_progress" });
    service.updateTask(human, { taskId: task.id, status: "blocked" });
    service.updateTask(human, { taskId: task.id, status: "completed" });
    const goal = service.createGoal(human, { workspaceId: workspace.id, title: "Ship billing" });
    service.updateGoal(human, { goalId: goal.id, status: "completed" });
    service.addArtifact(human, {
      workspaceId: workspace.id,
      type: "log",
      title: "deploy log",
      uriOrPath: "file:///tmp/deploy.log",
      metadata: { contents: FILE_BYTES },
    });
    service.updateWorkspace(human, { workspaceId: workspace.id, status: "completed" });

    const events = store.listDomainEventsForWorkspace(workspace.id);
    expect(events.map((event) => event.type)).toEqual([
      "finding.recorded",
      "decision.proposed",
      "decision.accepted",
      "task.blocked",
      "task.completed",
      "goal.completed",
      "artifact.attached",
      "workspace.completed",
    ]);
    for (const event of events) {
      expect(store.getContribution(event.contributionId)?.objectId).toBe(event.subjectId);
      expect(event.body).not.toContain(SECRET);
      expect(event.body).not.toContain(TRANSCRIPT);
      expect(event.body).not.toContain(FILE_BYTES);
      expect(event.body).not.toContain("cft_");
    }
    const artifact = events.find((event) => event.type === "artifact.attached");
    expect(artifact?.data).toEqual({
      title: "deploy log",
      type: "log",
      uriOrPath: "file:///tmp/deploy.log",
    });
    expect(store.listContributions(workspace.id).some((row) => row.objectType === "artifact")).toBe(true);
    expect(store.countWebhookDeliveries()).toEqual({ pending: 0, delivering: 0, delivered: 0, exhausted: 0 });
  });

  it("creates a delivery only for an allowlisted workspace and type", () => {
    const env = bridgeEnv("ws_000001");
    env.CAMPFIRE_WEBHOOK_EVENTS = "finding.recorded,task.blocked";
    const { store, service, human, workspace } = setup(env);
    open.push(service);
    expect(workspace.id).toBe("ws_000001");
    const other = service.createWorkspace(human, { teamId: "team_1", name: UNRELATED });
    service.addFinding(human, { workspaceId: workspace.id, summary: "Visible" });
    service.addFinding(human, { workspaceId: other.id, summary: "Hidden finding" });
    const task = service.createTask(human, { workspaceId: workspace.id, title: "Wait" });
    service.updateTask(human, { taskId: task.id, title: "Wait renamed" });
    service.updateTask(human, { taskId: task.id, status: "completed" });

    const deliveries = store.listWebhookDeliveries();
    expect(deliveries).toHaveLength(1);
    const event = store.getDomainEvent(deliveries[0]!.eventId);
    expect(event?.type).toBe("finding.recorded");
    expect(event?.workspaceId).toBe(workspace.id);
    expect(JSON.stringify(store.listDomainEventsForWorkspace(workspace.id))).not.toContain(UNRELATED);
    expect(JSON.stringify(deliveries)).not.toContain(SECRET);
  });

  it("records onBehalfOf from the agent session and not the harness name", () => {
    const { store, service, human, workspace } = setup();
    open.push(service);
    const agentActor = { actorId: "agt_1", actorType: "agent" } as const;
    service.inviteToWorkspace(human, { workspaceId: workspace.id, actor: agentActor, role: "agent" });
    service.joinWorkspace({ actor: agentActor }, { workspaceId: workspace.id });
    const session = service.registerAgentSession(
      { actor: agentActor },
      { agentId: "agt_1", humanId: "hum_1", workspaceId: workspace.id, harness: "codex" },
    );
    const agent: ActorContext = { actor: agentActor, agentSessionId: session.id };
    service.addFinding(agent, { workspaceId: workspace.id, summary: "Session finding" });
    const event = store.listDomainEventsForWorkspace(workspace.id)[0];
    expect(event?.actor).toEqual({ actorId: "agt_1", actorType: "agent" });
    expect(event?.onBehalfOf).toEqual({ actorId: "hum_1", actorType: "human" });
    expect(event?.agentSessionId).toBe(session.id);
    expect(event?.body).not.toContain("codex");
  });

  it("writes no event when authorization fails", () => {
    const { store, service, human, workspace } = setup();
    open.push(service);
    store.createHuman({ id: "hum_2", teamId: "team_1", displayName: "Grace", createdAt: NOW });
    const stranger: ActorContext = { actor: { actorId: "hum_2", actorType: "human" } };
    expect(() => service.addFinding(stranger, { workspaceId: workspace.id, summary: "nope" })).toThrow(ParticipantRequired);
    const agentActor = { actorId: "agt_1", actorType: "agent" } as const;
    service.inviteToWorkspace(human, { workspaceId: workspace.id, actor: agentActor, role: "agent" });
    service.joinWorkspace({ actor: agentActor }, { workspaceId: workspace.id });
    const agent: ActorContext = { actor: agentActor };
    expect(() => service.addFinding(agent, { workspaceId: workspace.id, summary: "no session" })).toThrow(Unauthorized);
    expect(store.listDomainEventsForWorkspace(workspace.id)).toEqual([]);
    expect(store.listWebhookDeliveries()).toEqual([]);
  });

  it("matches the async service envelope for the same finding", async () => {
    const sync = setup();
    const asyncSide = setup();
    open.push(sync.service, asyncSide.service);
    sync.service.addFinding(sync.human, { workspaceId: sync.workspace.id, summary: "Same fact" });
    const wrapped = new Proxy(asyncSide.store, {
      get(target, prop, receiver) {
        if (prop === "transaction") return (fn: () => Promise<unknown>) => fn();
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => Promise.resolve((value as (...a: unknown[]) => unknown).apply(target, args));
      },
    }) as unknown as AsyncCampfireStore;
    const asyncService = createAsyncCampfireService({
      store: wrapped,
      idSource: asyncSide.idSource,
      clock: clockAt("2026-02-01T00:00:00.000Z"),
      webhookEnv: {},
    });
    await asyncService.addFinding(asyncSide.human, { workspaceId: asyncSide.workspace.id, summary: "Same fact" });
    const syncBody = JSON.parse(sync.store.listDomainEventsForWorkspace(sync.workspace.id)[0]!.body) as {
      specVersion: string;
      type: string;
      summary: string;
      data: unknown;
      actor: unknown;
    };
    const asyncBody = JSON.parse(asyncSide.store.listDomainEventsForWorkspace(asyncSide.workspace.id)[0]!.body) as {
      specVersion: string;
      type: string;
      summary: string;
      data: unknown;
      actor: unknown;
    };
    expect(asyncBody).toMatchObject({
      specVersion: syncBody.specVersion,
      type: syncBody.type,
      summary: syncBody.summary,
      data: syncBody.data,
      actor: syncBody.actor,
    });
  });
});
