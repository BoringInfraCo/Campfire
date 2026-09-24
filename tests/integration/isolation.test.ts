/**
 * Workspace + provenance isolation integration test.
 *
 * Uses in-memory SQLite plus in-memory MCP transports (no subprocesses) to make
 * the Sprint 001 invariants fast to verify: workspace scoping, per-actor
 * membership, and append-only activity with preserved provenance.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import type { Contribution } from "../../src/domain/types.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import type { ServerIdentity } from "../../src/mcp/context.js";
import { createCampfireMcpServer } from "../../src/mcp/tools.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { ActivityPage, CampfireService } from "../../src/service/service.js";
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
const HUMAN_ALICE: ServerIdentity = {
  ctx: { actor: { actorId: FIXTURE.humans.alice, actorType: "human" } },
};

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

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolOutcome> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
  };
  const text = result.content?.find(
    (part) => part.type === "text" && typeof part.text === "string",
  )?.text;
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
  const client = new Client({ name: "campfire-isolation", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  openServers.push(server);
  openClients.push(client);
  return client;
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

describe("workspace isolation", () => {
  it("never leaks the unrelated workspace sentinel into billing projections", async () => {
    const a = await connectIdentity(AGENT_A);
    await call(a, "register_agent_session", {
      agentId: FIXTURE.agents.codexSergio,
      humanId: FIXTURE.humans.sergio,
      workspaceId: FIXTURE.workspaces.billing,
    });
    await call(a, "add_finding", {
      workspaceId: FIXTURE.workspaces.billing,
      summary: "Billing finding that must not carry unrelated state.",
    });

    const projections = await Promise.all([
      call(a, "list_workspaces"),
      call(a, "get_workspace", { workspaceId: FIXTURE.workspaces.billing }),
      call(a, "get_workspace_context", { workspaceId: FIXTURE.workspaces.billing }),
      call(a, "get_activity", { workspaceId: FIXTURE.workspaces.billing }),
    ]);

    for (const projection of projections) {
      expect(projection.isError).toBe(false);
      expect(JSON.stringify(projection.json)).not.toContain(FIXTURE.unrelatedFindingSentinel);
    }
  });

  it("prevents Agent B from reading the unrelated workspace", async () => {
    const b = await connectIdentity(AGENT_B);

    const context = await call(b, "get_workspace_context", {
      workspaceId: FIXTURE.workspaces.unrelated,
    });
    const workspace = await call(b, "get_workspace", {
      workspaceId: FIXTURE.workspaces.unrelated,
    });
    const activity = await call(b, "get_activity", {
      workspaceId: FIXTURE.workspaces.unrelated,
    });

    for (const outcome of [context, workspace, activity]) {
      expect(outcome.isError).toBe(true);
      expect(["ParticipantRequired", "Unauthorized"]).toContain(outcome.json.error);
      expect(JSON.stringify(outcome.json)).not.toContain(FIXTURE.unrelatedFindingSentinel);
    }

    const list = await call(b, "list_workspaces");
    expect(list.isError).toBe(false);
    expect(list.json.map((item: { id: string }) => item.id)).toEqual([FIXTURE.workspaces.billing]);
  });
});

describe("append-only activity", () => {
  it("preserves Agent A's contributions before Agent B's writes", async () => {
    const a = await connectIdentity(AGENT_A);
    await call(a, "register_agent_session", {
      agentId: FIXTURE.agents.codexSergio,
      humanId: FIXTURE.humans.sergio,
      workspaceId: FIXTURE.workspaces.billing,
    });
    const findingA = await call(a, "add_finding", {
      workspaceId: FIXTURE.workspaces.billing,
      summary: "Agent A finding.",
    });
    const decisionA = await call(a, "add_decision", {
      workspaceId: FIXTURE.workspaces.billing,
      summary: "Agent A decision.",
    });

    const activityAfterA = await call(a, "get_activity", {
      workspaceId: FIXTURE.workspaces.billing,
    });
    expect(activityAfterA.isError).toBe(false);
    const aPage = activityAfterA.json as ActivityPage;
    const aContributions: Contribution[] = aPage.items;
    const findingContribution = aContributions.find(
      (entry) => entry.objectType === "finding" && entry.objectId === findingA.json.id,
    );
    expect(findingContribution).toBeDefined();
    expect(findingContribution?.actor.actorId).toBe(FIXTURE.agents.codexSergio);

    const b = await connectIdentity(AGENT_B);
    await call(b, "register_agent_session", {
      agentId: FIXTURE.agents.opencodeAlice,
      humanId: FIXTURE.humans.alice,
      workspaceId: FIXTURE.workspaces.billing,
    });
    const findingB = await call(b, "add_finding", {
      workspaceId: FIXTURE.workspaces.billing,
      summary: "Agent B finding.",
    });
    await call(b, "add_artifact", {
      workspaceId: FIXTURE.workspaces.billing,
      type: "document",
      title: "Agent B plan",
      uriOrPath: "fixtures/billing/plan.md",
    });

    const activityAfterB = await call(b, "get_activity", {
      workspaceId: FIXTURE.workspaces.billing,
    });
    expect(activityAfterB.isError).toBe(false);
    const bPage = activityAfterB.json as ActivityPage;
    const finalContributions: Contribution[] = bPage.items;

    // The original contribution object is untouched.
    const preserved = finalContributions.find((entry) => entry.id === findingContribution?.id);
    expect(preserved).toEqual(findingContribution);

    const aIndices = finalContributions
      .map((entry, index) => ({ entry, index }))
      .filter(
        (item) =>
          item.entry.actor.actorId === FIXTURE.agents.codexSergio &&
          item.entry.agentSessionId !== undefined,
      )
      .map((item) => item.index);
    const bIndices = finalContributions
      .map((entry, index) => ({ entry, index }))
      .filter(
        (item) =>
          item.entry.actor.actorId === FIXTURE.agents.opencodeAlice &&
          item.entry.agentSessionId !== undefined,
      )
      .map((item) => item.index);

    expect(aIndices.length).toBeGreaterThan(0);
    expect(bIndices.length).toBeGreaterThan(0);
    expect(finalContributions.length).toBeGreaterThan(aContributions.length);
    expect(Math.min(...bIndices)).toBeGreaterThan(Math.max(...aIndices));

    // The decision written by Agent A is still present with unchanged provenance.
    const context = await call(b, "get_workspace_context", {
      workspaceId: FIXTURE.workspaces.billing,
    });
    const survivingAccepted = context.json.acceptedDecisions.find(
      (entry: { id: string }) => entry.id === decisionA.json.id,
    );
    const survivingProposed = context.json.proposedDecisions.find(
      (entry: { id: string }) => entry.id === decisionA.json.id,
    );
    // Decision was proposed, so it is absent from acceptedDecisions but visible
    // in the orientation projection's proposedDecisions (Sprint 003).
    const workspaceView = await call(b, "get_workspace", {
      workspaceId: FIXTURE.workspaces.billing,
    });
    const decision = workspaceView.json.decisions.find(
      (entry: { id: string }) => entry.id === decisionA.json.id,
    );
    expect(decision).toBeDefined();
    expect(decision.createdBy).toEqual({ actorId: FIXTURE.agents.codexSergio, actorType: "agent" });
    expect(survivingAccepted).toBeUndefined();
    expect(survivingProposed).toBeDefined();
    expect(survivingProposed.createdBy).toEqual({
      actorId: FIXTURE.agents.codexSergio,
      actorType: "agent",
    });

    const findings = workspaceView.json.findings.map((entry: { id: string }) => entry.id);
    expect(findings).toContain(findingA.json.id);
    expect(findings).toContain(findingB.json.id);
  });
});

describe("agent identity does not inherit its human owner's membership", () => {
  it("denies an uninvited agent even when its human owner is a participant", async () => {
    store.createAgent({
      id: "agt_uninvited",
      teamId: FIXTURE.teamId,
      humanId: FIXTURE.humans.alice,
      name: "Uninvited Agent",
      harness: "codex",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const uninvited: ServerIdentity = {
      ctx: { actor: { actorId: "agt_uninvited", actorType: "agent" } },
      harness: "codex",
    };
    const agentClient = await connectIdentity(uninvited);
    const humanClient = await connectIdentity(HUMAN_ALICE);

    const agentRead = await call(agentClient, "get_workspace_context", {
      workspaceId: FIXTURE.workspaces.billing,
    });
    expect(agentRead.isError).toBe(true);
    expect(agentRead.json.error).toBe("ParticipantRequired");

    // The human owner is a direct participant and can read.
    const humanRead = await call(humanClient, "get_workspace_context", {
      workspaceId: FIXTURE.workspaces.billing,
    });
    expect(humanRead.isError).toBe(false);
    expect(humanRead.json.workspace.id).toBe(FIXTURE.workspaces.billing);
  });
});
