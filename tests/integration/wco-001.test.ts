/**
 * WCO-001 Amendment 1 — deterministic checks D1–D6.
 *
 * The witness behind the amendment was a labeled single-operator rehearsal, not
 * a C1–C7 case (`docs/evidence/wco-001/REHEARSAL.md`). These tests pin the
 * bounded repair — truthful cold-teammate availability guidance at the MCP
 * boundary and the closed evidence-relation vocabulary — while proving that
 * authorization, provenance, orientation output, boundary parity, and existing
 * surfaces are unchanged.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CLI_COMMAND_NAMES } from "../../src/cli/catalog.js";
import { assertEvidenceRelation } from "../../src/domain/correction.js";
import { ParticipantRequired, Unauthorized, ValidationError } from "../../src/domain/errors.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import type { ActorRef, FindingEvidenceRelation } from "../../src/domain/types.js";
import { FINDING_EVIDENCE_RELATIONS } from "../../src/domain/types.js";
import { SESSION_INSTRUCTIONS } from "../../src/mcp/instructions.js";
import { createCampfireMcpServer } from "../../src/mcp/tools.js";
import type { ServerIdentity } from "../../src/mcp/context.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { createAsyncCampfireService } from "../../src/worker/async-service.js";
import type { AsyncCampfireStore } from "../../src/worker/d1-store.js";
import { VIEWER_READ_METHODS } from "../../src/viewer/server.js";

const NOW = "2026-01-01T00:00:00.000Z";

const HUMAN_A: ActorRef = { actorId: "hum_wco_a", actorType: "human" };
const HUMAN_B: ActorRef = { actorId: "hum_wco_b", actorType: "human" };
const AGENT_A: ActorRef = { actorId: "agt_wco_a", actorType: "agent" };
const AGENT_B: ActorRef = { actorId: "agt_wco_b", actorType: "agent" };
const VIEWER: ActorRef = { actorId: "hum_wco_viewer", actorType: "human" };
const OUTSIDER: ActorRef = { actorId: "hum_wco_outsider", actorType: "human" };

const ctxA: ActorContext = { actor: HUMAN_A };
const ctxB: ActorContext = { actor: HUMAN_B };
const ctxViewer: ActorContext = { actor: VIEWER };
const ctxOutsider: ActorContext = { actor: OUTSIDER };
const ctxAgentA: ActorContext = { actor: AGENT_A };
const ctxAgentB: ActorContext = { actor: AGENT_B };

interface Fixture {
  store: CampfireStore;
  service: CampfireService;
  workspaceId: string;
  taskId: string;
  sessionA: string;
  sessionB: string;
}

let store: CampfireStore;
let service: CampfireService;
let fixture: Fixture;
let idSource: ReturnType<typeof createCounterIdSource>;
let clockFn: () => string;

function createClock(startMs = Date.parse(NOW)): () => string {
  let current = startMs;
  return (): string => {
    current += 1000;
    return new Date(current).toISOString();
  };
}

function inviteAndJoin(inviter: ActorContext, joiner: ActorContext, workspaceId: string, role: "member" | "agent" | "viewer"): void {
  service.inviteToWorkspace(inviter, { workspaceId, actor: joiner.actor, role });
  service.joinWorkspace(joiner, { workspaceId });
}

function buildFixture(): Fixture {
  store.createOrganization({ id: "org_wco", name: "Boring Infra Co.", createdAt: NOW });
  store.createTeam({ id: "team_wco", organizationId: "org_wco", name: "Engineering", createdAt: NOW });
  store.createHuman({ id: HUMAN_A.actorId, teamId: "team_wco", displayName: "Human A", createdAt: NOW });
  store.createHuman({ id: HUMAN_B.actorId, teamId: "team_wco", displayName: "Human B", createdAt: NOW });
  store.createHuman({ id: VIEWER.actorId, teamId: "team_wco", displayName: "Viewer", createdAt: NOW });
  store.createHuman({ id: OUTSIDER.actorId, teamId: "team_wco", displayName: "Outsider", createdAt: NOW });
  store.createAgent({
    id: AGENT_A.actorId,
    teamId: "team_wco",
    humanId: HUMAN_A.actorId,
    name: "Agent A",
    harness: "codex",
    createdAt: NOW,
  });
  store.createAgent({
    id: AGENT_B.actorId,
    teamId: "team_wco",
    humanId: HUMAN_B.actorId,
    name: "Agent B",
    harness: "opencode",
    createdAt: NOW,
  });

  const workspace = service.createWorkspace(ctxA, { teamId: "team_wco", name: "wco-001" });
  service.createGoal(ctxA, { workspaceId: workspace.id, title: "Produce the baseline" });
  inviteAndJoin(ctxA, ctxB, workspace.id, "member");
  inviteAndJoin(ctxA, ctxAgentA, workspace.id, "agent");
  inviteAndJoin(ctxA, ctxAgentB, workspace.id, "agent");
  inviteAndJoin(ctxA, ctxViewer, workspace.id, "viewer");

  const task = service.createTask(ctxA, {
    workspaceId: workspace.id,
    title: "Confirm the release archive matches the committed tag tree",
    assignee: AGENT_A,
  });
  service.updateTask(ctxA, {
    taskId: task.id,
    status: "blocked",
    description: "Pending: compare the archive contents and record the result as a finding.",
  });

  const sessionA = service.registerAgentSession(ctxAgentA, {
    agentId: AGENT_A.actorId,
    workspaceId: workspace.id,
    harness: "codex",
  });
  const sessionB = service.registerAgentSession(ctxAgentB, {
    agentId: AGENT_B.actorId,
    workspaceId: workspace.id,
    harness: "opencode",
  });

  return {
    store,
    service,
    workspaceId: workspace.id,
    taskId: task.id,
    sessionA: sessionA.id,
    sessionB: sessionB.id,
  };
}

beforeEach(() => {
  store = openInMemoryStore();
  idSource = createCounterIdSource();
  clockFn = createClock();
  service = createCampfireService({ store, idSource, clock: clockFn });
  fixture = buildFixture();
});

afterEach(() => {
  service.close();
});

// ---------------------------------------------------------------------------
// MCP helpers
// ---------------------------------------------------------------------------

const openServers: McpServer[] = [];
const openClients: Client[] = [];

async function connect(identity: ServerIdentity): Promise<Client> {
  const server = createCampfireMcpServer({ service, identity });
  const client = new Client({ name: "wco-001-integration", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  openServers.push(server);
  openClients.push(client);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; json: any; text?: string }> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
  };
  const text = result.content?.find((part) => part.type === "text" && typeof part.text === "string")?.text;
  return {
    isError: result.isError === true,
    json: text === undefined ? undefined : JSON.parse(text),
    text,
  };
}

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

// ---------------------------------------------------------------------------

describe("WCO-001 D1 — authorization", () => {
  it("states that needsAttention is ordering, not an access boundary, and that a writing teammate may take up another participant's task", () => {
    expect(SESSION_INSTRUCTIONS).toContain("needsAttention is attention ordering, not an access boundary");
    expect(SESSION_INSTRUCTIONS).toContain("may take it up with update_task");
  });

  it("a writing teammate can take up a task assigned to another agent and the write is recorded", () => {
    const updated = service.updateTask({ actor: AGENT_B, agentSessionId: fixture.sessionB }, {
      taskId: fixture.taskId,
      status: "in_progress",
    });
    expect(updated.status).toBe("in_progress");

    const latest = fixture.store.listContributions(fixture.workspaceId).at(-1);
    expect(latest?.actor).toEqual(AGENT_B);
    expect(latest?.agentSessionId).toBe(fixture.sessionB);
  });

  it("keeps the guidance truthful: unregistered agents, non-participants, and viewers are still denied", () => {
    // An agent context without a registered session.
    expect(() =>
      service.updateTask(ctxAgentA, { taskId: fixture.taskId, status: "in_progress" }),
    ).toThrow(Unauthorized);

    // A human who never joined the workspace.
    expect(() =>
      service.updateTask(ctxOutsider, { taskId: fixture.taskId, status: "in_progress" }),
    ).toThrow(ParticipantRequired);

    // A participant whose role cannot write.
    expect(() =>
      service.updateTask(ctxViewer, { taskId: fixture.taskId, status: "in_progress" }),
    ).toThrow(Unauthorized);
  });
});

describe("WCO-001 D2 — identity and provenance", () => {
  it("preserves distinct actors, sessions, and history when a teammate updates and reassigns another agent's task", () => {
    const before = fixture.store.listContributions(fixture.workspaceId).length;
    const original = fixture.store.getTask(fixture.taskId);
    expect(original?.createdBy).toEqual(HUMAN_A);
    expect(original?.assignee).toEqual(AGENT_A);

    service.updateTask({ actor: AGENT_B, agentSessionId: fixture.sessionB }, {
      taskId: fixture.taskId,
      status: "in_progress",
      assignee: AGENT_B,
    });

    const after = fixture.store.listContributions(fixture.workspaceId);
    expect(after.length).toBe(before + 1);
    const latest = after.at(-1);
    expect(latest).toMatchObject({ action: "update", objectType: "task", objectId: fixture.taskId });
    expect(latest?.actor).toEqual(AGENT_B);
    expect(latest?.agentSessionId).toBe(fixture.sessionB);

    const current = fixture.store.getTask(fixture.taskId);
    expect(current?.assignee).toEqual(AGENT_B);
    // The original author and the original session registration survive.
    expect(current?.createdBy).toEqual(HUMAN_A);
    const actions = after.map((contribution) => `${contribution.actor.actorId}:${contribution.action}`);
    expect(actions.filter((entry) => entry === `${AGENT_A.actorId}:register_session`)).toHaveLength(1);
    expect(actions.filter((entry) => entry === `${HUMAN_A.actorId}:create`)).toContain(`${HUMAN_A.actorId}:create`);
  });
});

describe("WCO-001 D3 — source fidelity", () => {
  it("uses one closed evidence vocabulary in the domain validator and the exported constant", () => {
    expect([...FINDING_EVIDENCE_RELATIONS]).toEqual(["supports", "contradicts"]);
    for (const relation of FINDING_EVIDENCE_RELATIONS) {
      expect(assertEvidenceRelation(relation)).toBe(relation);
    }
    expect(() => assertEvidenceRelation("maybe")).toThrow(ValidationError);
    expect(() => assertEvidenceRelation("SUPPORTS")).toThrow(ValidationError);
  });

  it("enumerates the closed vocabulary in the MCP input schemas", async () => {
    const client = await connect({ ctx: { actor: HUMAN_A } });
    const tools = (await client.listTools()).tools;
    const cite = tools.find((tool) => tool.name === "cite_finding_evidence");
    const correct = tools.find((tool) => tool.name === "correct_finding");
    expect((cite?.inputSchema.properties?.relation as { enum?: string[] } | undefined)?.enum).toEqual([
      "supports",
      "contradicts",
    ]);
    const evidenceItems = (correct?.inputSchema.properties?.evidence as { items?: { properties?: { relation?: { enum?: string[] } } } } | undefined)?.items;
    expect(evidenceItems?.properties?.relation?.enum).toEqual(["supports", "contradicts"]);
    expect(cite?.description).toContain("supports or contradicts");
  });

  it("keeps the orientation projection identical to the shipped one for a cold teammate", () => {
    const context = service.getWorkspaceContext({ actor: AGENT_B, agentSessionId: fixture.sessionB }, fixture.workspaceId);
    expect(context.needsYou).toEqual([]);
    expect(context.needsAttention).toEqual([
      {
        kind: "task",
        id: fixture.taskId,
        summary: "Confirm the release archive matches the committed tag tree",
        status: "blocked",
        reason: "team_blocked_task",
        assignee: AGENT_A,
      },
    ]);
    expect(context.suggestedNextAction).toEqual({
      kind: "none",
      summary: "",
      reason: "none",
      orientationHint: true,
    });
    expect(context.alignment.unresolvedBlockedTaskIds).toEqual([fixture.taskId]);
  });

  it("names the ordering semantics in the get_workspace_context description", async () => {
    const client = await connect({ ctx: { actor: HUMAN_A } });
    const tool = (await client.listTools()).tools.find((entry) => entry.name === "get_workspace_context");
    expect(tool?.description).toContain("attention ordering, not an access boundary");
  });
});

describe("WCO-001 D4 — boundary parity", () => {
  function wrapSync(target: CampfireStore): AsyncCampfireStore {
    return new Proxy(target, {
      get(source, prop, receiver) {
        if (prop === "transaction") {
          return (fn: () => Promise<unknown>) => fn();
        }
        const value = Reflect.get(source, prop, receiver) as unknown;
        if (typeof value !== "function") return value;
        return (...args: unknown[]) =>
          Promise.resolve((value as (...a: unknown[]) => unknown).apply(source, args));
      },
    }) as unknown as AsyncCampfireStore;
  }

  it("agrees on the repaired vocabulary and the orientation across the local and Workers/D1 paths", async () => {
    // The service signature is typed; the boundary admits raw strings, so the
    // validator must still reject values outside the closed vocabulary.
    const invalidRelation = "maybe" as unknown as FindingEvidenceRelation;
    const asyncService = createAsyncCampfireService({
      store: wrapSync(store),
      idSource,
      clock: clockFn,
    });

    const finding = service.addFinding(ctxA, { workspaceId: fixture.workspaceId, summary: "Baseline fact" });
    const artifact = service.addArtifact(ctxA, {
      workspaceId: fixture.workspaceId,
      type: "log",
      title: "Deploy log",
      uriOrPath: "deploy.log",
    });

    const agentBContext = { actor: AGENT_B, agentSessionId: fixture.sessionB };
    await expect(
      asyncService.citeFindingEvidence(agentBContext, {
        findingId: finding.id,
        artifactId: artifact.id,
        relation: invalidRelation,
      }),
    ).rejects.toThrow(ValidationError);
    await expect(
      asyncService.citeFindingEvidence(agentBContext, {
        findingId: finding.id,
        artifactId: artifact.id,
        relation: "contradicts",
      }),
    ).resolves.toMatchObject({ relation: "contradicts" });

    const local = service.getWorkspaceContext(agentBContext, fixture.workspaceId);
    const hosted = await asyncService.getWorkspaceContext(agentBContext, fixture.workspaceId);
    expect(hosted.needsYou).toEqual(local.needsYou);
    expect(hosted.needsAttention).toEqual(local.needsAttention);
    expect(hosted.suggestedNextAction).toEqual(local.suggestedNextAction);
  });
});

describe("WCO-001 D5 — interface safety", () => {
  it("keeps the Viewer read allowlist closed at the twelve NAV-003 methods", () => {
    expect([...VIEWER_READ_METHODS]).toEqual([
      "whoami",
      "list_workspaces",
      "get_workspace",
      "get_workspace_context",
      "get_activity",
      "list_tasks",
      "list_workspace_participants",
      "get_task",
      "get_decision",
      "get_finding",
      "get_artifact",
      "get_record_history",
    ]);
  });

  it("keeps every WCO-001 MCP tool and adds only the NAV-002 reads", async () => {
    const client = await connect({ ctx: { actor: HUMAN_A } });
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(names).toEqual(
      [
        "accept_decision",
        "add_artifact",
        "add_decision",
        "add_finding",
        "cite_decision_basis",
        "cite_finding_evidence",
        "correct_finding",
        "create_goal",
        "create_task",
        "create_workspace",
        "get_activity",
        "get_artifact",
        "get_record_history",
        "get_decision",
        "get_finding",
        "get_task",
        "get_workspace",
        "get_workspace_changes",
        "get_workspace_context",
        "invite_workspace",
        "join_workspace",
        "list_artifacts",
        "list_decisions",
        "list_findings",
        "list_tasks",
        "list_workspace_participants",
        "list_workspaces",
        "preflight",
        "recall_workspace",
        "register_agent_session",
        "remove_decision_basis",
        "remove_finding_evidence",
        "retire_decision",
        "update_goal",
        "update_task",
        "update_workspace",
        "whoami",
        "withdraw_finding",
      ].sort(),
    );
  });

  it("keeps instructions free of credential-shaped or URL material", () => {
    expect(SESSION_INSTRUCTIONS).not.toMatch(/cft_|cfe_|Bearer|https?:\/\/|\/Users\//);
  });
});

describe("WCO-001 D6 — compatibility", () => {
  it("still accepts the previously valid evidence citation end to end over MCP", async () => {
    const agentA = await connect({ ctx: { actor: AGENT_A, agentSessionId: fixture.sessionA }, harness: "codex" });

    const finding = await call(agentA, "add_finding", {
      workspaceId: fixture.workspaceId,
      summary: "Baseline facts recorded",
    });
    expect(finding.isError).toBe(false);

    const artifact = await call(agentA, "add_artifact", {
      workspaceId: fixture.workspaceId,
      type: "log",
      title: "Deploy log",
      uriOrPath: "deploy.log",
    });
    expect(artifact.isError).toBe(false);

    const citation = await call(agentA, "cite_finding_evidence", {
      findingId: finding.json.id,
      artifactId: artifact.json.id,
      relation: "supports",
    });
    expect(citation.isError).toBe(false);

    const read = await call(agentA, "get_finding", {
      workspaceId: fixture.workspaceId,
      findingId: finding.json.id,
    });
    expect(read.json.evidence).toEqual([
      expect.objectContaining({ artifactId: artifact.json.id, relation: "supports" }),
    ]);

    const correction = await call(agentA, "correct_finding", {
      findingId: finding.json.id,
      summary: "Baseline facts recorded, with a second sample",
      reason: "Second sample reviewed",
      evidence: [{ artifactId: artifact.json.id, relation: "contradicts", note: "second sample" }],
    });
    expect(correction.isError).toBe(false);
    expect(correction.json.evidence).toEqual([
      expect.objectContaining({ relation: "contradicts", note: "second sample" }),
    ]);
  });

  it("keeps the CLI command catalog unchanged for continuation commands", () => {
    const commands = [...CLI_COMMAND_NAMES];
    expect(commands).toHaveLength(60);
    for (const command of ["status", "context", "catch-up", "tasks", "update-task", "cite-evidence", "inspect"]) {
      expect(commands).toContain(command);
    }
  });
});
