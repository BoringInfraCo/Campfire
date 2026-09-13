/**
 * Sprint 004 multi-session acceptance.
 *
 * A workspace created through the product (not seed) is reused by a second
 * isolated MCP client. Orientation stays capped after many writes.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import type { Contribution } from "../../src/domain/types.js";
import { createCampfireMcpServer } from "../../src/mcp/tools.js";
import type { ServerIdentity } from "../../src/mcp/context.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import {
  ORIENTATION_PROVENANCE_LIMIT,
  type ActivityPage,
  type CampfireService,
  type WorkspaceContext,
} from "../../src/service/service.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";

const NOW = "2026-01-01T00:00:00.000Z";
const WORKSPACE_NAME = "living-workspace-004";

const AGENT_A: ServerIdentity = {
  ctx: { actor: { actorId: FIXTURE.agents.codexSergio, actorType: "agent" } },
  harness: "codex",
};
const AGENT_B: ServerIdentity = {
  ctx: { actor: { actorId: FIXTURE.agents.opencodeAlice, actorType: "agent" } },
  harness: "opencode",
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
  const client = new Client({ name: "campfire-living-workspace", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  openServers.push(server);
  openClients.push(client);
  return client;
}

async function disconnectAll(): Promise<void> {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
  await Promise.all(openServers.splice(0).map((server) => server.close()));
}

beforeEach(() => {
  store = openInMemoryStore();
  const clock = createClock();
  service = createCampfireService({ store, idSource: createCounterIdSource(), clock });
  seedFixture(store, { clock });
});

afterEach(async () => {
  await disconnectAll();
  service.close();
});

describe("living workspace multi-session continuation", () => {
  it("creates a workspace through the product and continues it from a second isolated client", async () => {
    const a = await connectIdentity(AGENT_A);

    const created = await call(a, "create_workspace", {
      teamId: FIXTURE.teamId,
      name: WORKSPACE_NAME,
    });
    expect(created.isError).toBe(false);
    const workspaceId = created.json.id as string;
    expect(created.json.name).toBe(WORKSPACE_NAME);
    expect(created.json.status).toBe("active");

    // Hardening A3: agent writes require a registered session.
    const sessionA = await call(a, "register_agent_session", {
      agentId: FIXTURE.agents.codexSergio,
      humanId: FIXTURE.humans.sergio,
      workspaceId,
    });
    expect(sessionA.isError).toBe(false);

    const goal = await call(a, "create_goal", {
      workspaceId,
      title: "Keep the living workspace useful across sessions",
    });
    expect(goal.isError).toBe(false);

    const finding = await call(a, "add_finding", {
      workspaceId,
      summary: "Session A recorded a durable finding.",
    });
    expect(finding.isError).toBe(false);

    const decision = await call(a, "add_decision", {
      workspaceId,
      summary: "Continue from Campfire state, not a transcript.",
    });
    expect(decision.isError).toBe(false);

    const accepted = await call(a, "accept_decision", { decisionId: decision.json.id });
    expect(accepted.isError).toBe(false);
    expect(accepted.json.status).toBe("accepted");

    const task = await call(a, "create_task", {
      workspaceId,
      title: "Resume work in a second session",
    });
    expect(task.isError).toBe(false);

    const artifact = await call(a, "add_artifact", {
      workspaceId,
      type: "document",
      title: "Session notes",
      uriOrPath: "fixtures/billing/README.md",
    });
    expect(artifact.isError).toBe(false);

    const invited = await call(a, "invite_workspace", {
      workspaceId,
      actorId: FIXTURE.agents.opencodeAlice,
      actorType: "agent",
      role: "agent",
    });
    expect(invited.isError).toBe(false);

    await disconnectAll();

    const b = await connectIdentity(AGENT_B);
    const joined = await call(b, "join_workspace", { workspaceId });
    expect(joined.isError).toBe(false);

    const sessionB = await call(b, "register_agent_session", {
      agentId: FIXTURE.agents.opencodeAlice,
      humanId: FIXTURE.humans.alice,
      workspaceId,
    });
    expect(sessionB.isError).toBe(false);

    const context = await call(b, "get_workspace_context", { workspaceId });
    expect(context.isError).toBe(false);
    const projection = context.json as WorkspaceContext;
    expect(projection.goal?.id).toBe(goal.json.id);
    expect(projection.goal?.title).toBe("Keep the living workspace useful across sessions");
    expect(projection.findings.map((item) => item.id)).toContain(finding.json.id);
    expect(projection.acceptedDecisions.map((item) => item.id)).toContain(decision.json.id);
    expect(projection.openTasks.map((item) => item.id)).toContain(task.json.id);
    expect(projection.artifacts.map((item) => item.id)).toContain(artifact.json.id);
    expect(projection.provenance.length).toBeGreaterThan(0);
    expect(JSON.stringify(projection)).not.toContain(FIXTURE.unrelatedFindingSentinel);

    for (let index = 0; index < 25; index += 1) {
      const extra = await call(b, "add_finding", {
        workspaceId,
        summary: `Session B finding ${index}`,
      });
      expect(extra.isError).toBe(false);
    }

    const loaded = await call(b, "get_workspace_context", { workspaceId });
    expect(loaded.isError).toBe(false);
    expect(loaded.json.provenanceTruncated).toBe(true);
    expect(loaded.json.provenance).toHaveLength(ORIENTATION_PROVENANCE_LIMIT);

    const page = await call(b, "get_activity", { workspaceId, limit: 5 });
    expect(page.isError).toBe(false);
    const firstPage = page.json as ActivityPage;
    expect(firstPage.items).toHaveLength(5);
    expect(firstPage.truncated).toBe(true);
    expect(firstPage.nextBefore).toBeDefined();

    const older = await call(b, "get_activity", {
      workspaceId,
      limit: 5,
      before: firstPage.nextBefore,
    });
    expect(older.isError).toBe(false);
    const secondPage = older.json as ActivityPage;
    expect(secondPage.items.length).toBeGreaterThan(0);
    const firstIds = new Set(firstPage.items.map((item: Contribution) => item.id));
    expect(secondPage.items.every((item) => !firstIds.has(item.id))).toBe(true);

    const completed = await call(b, "update_workspace", {
      workspaceId,
      status: "completed",
    });
    expect(completed.isError).toBe(false);
    expect(completed.json.status).toBe("completed");

    const archived = await call(b, "update_workspace", {
      workspaceId,
      status: "archived",
    });
    expect(archived.isError).toBe(false);
    expect(archived.json.status).toBe("archived");

    const invalid = await call(b, "update_workspace", {
      workspaceId,
      status: "active",
    });
    expect(invalid.isError).toBe(true);
    expect(invalid.json.error).toBe("InvalidTransition");
  });
});
