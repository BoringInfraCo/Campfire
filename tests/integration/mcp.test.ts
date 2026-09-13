import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { createCampfireMcpServer } from "../../src/mcp/tools.js";
import type { ServerIdentity } from "../../src/mcp/context.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";

const NOW = "2026-01-01T00:00:00.000Z";

const AGENT_A: ServerIdentity = {
  ctx: { actor: { actorId: FIXTURE.agents.codexSergio, actorType: "agent" } },
  harness: "codex",
};
const AGENT_B: ServerIdentity = {
  ctx: { actor: { actorId: FIXTURE.agents.opencodeAlice, actorType: "agent" } },
  harness: "opencode",
};

const EXPECTED_TOOLS = [
  "whoami",
  "list_workspaces",
  "create_workspace",
  "update_workspace",
  "get_workspace",
  "get_workspace_context",
  "get_activity",
  "join_workspace",
  "invite_workspace",
  "register_agent_session",
  "create_goal",
  "update_goal",
  "add_finding",
  "add_decision",
  "accept_decision",
  "create_task",
  "update_task",
  "add_artifact",
];

function createClock(startMs = Date.parse(NOW)): () => string {
  let current = startMs;
  return (): string => {
    current += 1000;
    return new Date(current).toISOString();
  };
}

interface ToolOutcome {
  isError: boolean;
  json: any;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolOutcome> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
  };
  const text = result.content?.find((part) => part.type === "text" && typeof part.text === "string")?.text;
  return {
    isError: result.isError === true,
    json: text === undefined ? undefined : JSON.parse(text),
  };
}

let store: CampfireStore;
let service: CampfireService;
const openServers: McpServer[] = [];
const openClients: Client[] = [];

async function connectIdentity(identity: ServerIdentity): Promise<Client> {
  const server = createCampfireMcpServer({ service, identity });
  const client = new Client({ name: "campfire-integration", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  openServers.push(server);
  openClients.push(client);
  return client;
}

async function connectAgents(): Promise<{ a: Client; b: Client; toolNames: string[] }> {
  const a = await connectIdentity(AGENT_A);
  const b = await connectIdentity(AGENT_B);
  const listed = await a.listTools();
  return { a, b, toolNames: listed.tools.map((tool) => tool.name) };
}

beforeEach(() => {
  store = openInMemoryStore();
  const clock = createClock();
  service = createCampfireService({ store, idSource: createCounterIdSource(), clock });
  seedFixture(store, { clock });
});

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
  await Promise.all(openServers.splice(0).map((server) => server.close()));
  service.close();
});

describe("MCP tool surface", () => {
  it("advertises all Campfire tools without a campfire. prefix", async () => {
    const { toolNames } = await connectAgents();
    expect(toolNames).toEqual(expect.arrayContaining(EXPECTED_TOOLS));
    expect(new Set(toolNames).size).toBe(toolNames.length);
  });

  it("reports the bound identity without accepting an actor parameter", async () => {
    const { a } = await connectAgents();
    const who = await call(a, "whoami");
    expect(who.isError).toBe(false);
    expect(who.json).toEqual({
      actor: { actorId: FIXTURE.agents.codexSergio, actorType: "agent" },
      harness: "codex",
    });
  });
});

describe("cross-harness continuation", () => {
  it("lets Agent A contribute and Agent B continue from Campfire state", async () => {
    const { a, b } = await connectAgents();

    const session = await call(a, "register_agent_session", {
      agentId: FIXTURE.agents.codexSergio,
      humanId: FIXTURE.humans.sergio,
      workspaceId: FIXTURE.workspaces.billing,
    });
    expect(session.isError).toBe(false);
    expect(session.json).toMatchObject({
      agentId: FIXTURE.agents.codexSergio,
      humanId: FIXTURE.humans.sergio,
      workspaceId: FIXTURE.workspaces.billing,
      harness: "codex",
    });

    const finding = await call(a, "add_finding", {
      workspaceId: FIXTURE.workspaces.billing,
      summary: "Deploy fails because the billing worker image tag is unset.",
      detail: "The manifest references BILLING_IMAGE_TAG but the pipeline never exports it.",
      confidence: 0.86,
    });
    expect(finding.isError).toBe(false);
    expect(finding.json.createdBy).toEqual({
      actorId: FIXTURE.agents.codexSergio,
      actorType: "agent",
    });

    const decision = await call(a, "add_decision", {
      workspaceId: FIXTURE.workspaces.billing,
      summary: "Pin the billing worker image tag in the deploy pipeline.",
      rationale: "Removes the implicit dependency on ambient CI state.",
    });
    expect(decision.isError).toBe(false);
    expect(decision.json.status).toBe("proposed");

    const accepted = await call(a, "accept_decision", { decisionId: decision.json.id });
    expect(accepted.isError).toBe(false);
    expect(accepted.json.status).toBe("accepted");
    expect(accepted.json.approvedBy).toEqual({
      actorId: FIXTURE.agents.codexSergio,
      actorType: "agent",
    });

    const task = await call(a, "create_task", {
      workspaceId: FIXTURE.workspaces.billing,
      title: "Export BILLING_IMAGE_TAG before deploy",
      assignee: { actorId: FIXTURE.agents.opencodeAlice, actorType: "agent" },
    });
    expect(task.isError).toBe(false);
    expect(task.json.status).toBe("open");
    expect(task.json.assignee).toEqual({
      actorId: FIXTURE.agents.opencodeAlice,
      actorType: "agent",
    });

    const artifact = await call(a, "add_artifact", {
      workspaceId: FIXTURE.workspaces.billing,
      type: "log",
      title: "Failed deploy log",
      uriOrPath: "artifacts/deploy-2026-01-01.log",
      metadata: { pipeline: "billing-deploy" },
    });
    expect(artifact.isError).toBe(false);
    expect(artifact.json.type).toBe("log");

    const context = await call(a, "get_workspace_context", {
      workspaceId: FIXTURE.workspaces.billing,
    });
    expect(context.isError).toBe(false);
    expect(context.json.goal.id).toBe(FIXTURE.goals.billing);
    expect(context.json.findings.map((item: { id: string }) => item.id)).toContain(finding.json.id);
    expect(context.json.acceptedDecisions.map((item: { id: string }) => item.id)).toContain(
      decision.json.id,
    );
    expect(context.json.openTasks.map((item: { id: string }) => item.id)).toContain(task.json.id);
    expect(context.json.artifacts.map((item: { id: string }) => item.id)).toContain(artifact.json.id);
    expect(
      context.json.provenance.some(
        (entry: { objectType: string; objectId: string; actor: { actorId: string } }) =>
          entry.objectType === "finding" &&
          entry.objectId === finding.json.id &&
          entry.actor.actorId === FIXTURE.agents.codexSergio,
      ),
    ).toBe(true);
    expect(JSON.stringify(context.json)).not.toContain(FIXTURE.unrelatedFindingSentinel);

    // Agent B, a genuinely different harness, lists only the billing workspace
    // and retrieves the shared state without Agent A's transcript.
    const list = await call(b, "list_workspaces");
    expect(list.isError).toBe(false);
    expect(list.json.map((workspace: { id: string }) => workspace.id)).toEqual([
      FIXTURE.workspaces.billing,
    ]);

    const contextB = await call(b, "get_workspace_context", {
      workspaceId: FIXTURE.workspaces.billing,
    });
    expect(contextB.isError).toBe(false);
    expect(contextB.json.findings.map((item: { id: string }) => item.id)).toContain(finding.json.id);
    expect(contextB.json.acceptedDecisions.map((item: { id: string }) => item.id)).toContain(
      decision.json.id,
    );
    expect(contextB.json.openTasks.map((item: { id: string }) => item.id)).toContain(task.json.id);
    expect(JSON.stringify(contextB.json)).not.toContain(FIXTURE.unrelatedFindingSentinel);

    const forbidden = await call(b, "get_workspace_context", {
      workspaceId: FIXTURE.workspaces.unrelated,
    });
    expect(forbidden.isError).toBe(true);
    expect(["ParticipantRequired", "Unauthorized"]).toContain(forbidden.json.error);
  });
});

describe("error handling", () => {
  it("returns a typed error for an unknown workspace", async () => {
    const { a } = await connectAgents();

    // Authorization runs before retrieval. Existence is checked without
    // returning any workspace state, so an unknown id yields WorkspaceNotFound
    // rather than a misleading membership error.
    const missing = await call(a, "get_workspace", { workspaceId: "ws_does_not_exist" });
    expect(missing.isError).toBe(true);
    expect(missing.json.error).toBe("WorkspaceNotFound");

    const joinMissing = await call(a, "join_workspace", {
      workspaceId: "ws_does_not_exist",
    });
    expect(joinMissing.isError).toBe(true);
    expect(joinMissing.json.error).toBe("WorkspaceNotFound");
  });

  it("requires a harness when neither the tool nor the identity provides one", async () => {
    const harnessless: ServerIdentity = {
      ctx: { actor: { actorId: FIXTURE.agents.codexSergio, actorType: "agent" } },
    };
    const client = await connectIdentity(harnessless);

    const result = await call(client, "register_agent_session", {
      agentId: FIXTURE.agents.codexSergio,
      humanId: FIXTURE.humans.sergio,
      workspaceId: FIXTURE.workspaces.billing,
    });
    expect(result.isError).toBe(true);
    expect(result.json.error).toBe("ValidationError");
  });

  it("does not leak a private transcript sentinel through any tool output", async () => {
    const privateSentinel = "PRIVATE_SESSION_A_TRANSCRIPT_ONLY_7c1f9a";
    const { a } = await connectAgents();

    const outputs: ToolOutcome[] = [
      await call(a, "whoami"),
      await call(a, "list_workspaces"),
      await call(a, "get_workspace", { workspaceId: FIXTURE.workspaces.billing }),
      await call(a, "get_workspace_context", { workspaceId: FIXTURE.workspaces.billing }),
      await call(a, "get_activity", { workspaceId: FIXTURE.workspaces.billing }),
    ];

    expect(JSON.stringify(outputs)).not.toContain(privateSentinel);
  });
});

describe("workspace creation isolation", () => {
  it("does not list a workspace Agent B has not joined", async () => {
    const { a, b } = await connectAgents();

    const created = await call(a, "create_workspace", {
      teamId: FIXTURE.teamId,
      name: "agent-a-only",
    });
    expect(created.isError).toBe(false);
    expect(created.json.name).toBe("agent-a-only");
    expect(created.json.status).toBe("active");

    // Hardening A3: agent writes require a registered session.
    const session = await call(a, "register_agent_session", {
      agentId: FIXTURE.agents.codexSergio,
      humanId: FIXTURE.humans.sergio,
      workspaceId: created.json.id,
    });
    expect(session.isError).toBe(false);

    const goal = await call(a, "create_goal", {
      workspaceId: created.json.id,
      title: "Keep this workspace private until B joins",
    });
    expect(goal.isError).toBe(false);

    const listA = await call(a, "list_workspaces");
    expect(listA.isError).toBe(false);
    expect(listA.json.map((workspace: { id: string }) => workspace.id)).toContain(created.json.id);

    const listB = await call(b, "list_workspaces");
    expect(listB.isError).toBe(false);
    expect(listB.json.map((workspace: { id: string }) => workspace.id)).toEqual([
      FIXTURE.workspaces.billing,
    ]);
    expect(listB.json.map((workspace: { id: string }) => workspace.id)).not.toContain(created.json.id);

    const contextB = await call(b, "get_workspace_context", { workspaceId: created.json.id });
    expect(contextB.isError).toBe(true);
    expect(["ParticipantRequired", "Unauthorized"]).toContain(contextB.json.error);
  });
});
