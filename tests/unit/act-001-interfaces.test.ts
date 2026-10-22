/**
 * ACT-001 Step 2 HTTP /v1/call dispatch and MCP tool surface.
 *
 * Eight HTTP methods; six MCP tools. review_action/cancel_action stay on HTTP
 * so an agent /v1/call is denied by service auth. Not a harness trace.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CAMPFIRE_HTTP_METHODS, dispatchCampfireMethod, isDeliveryEligibleMethod } from "../../src/http/dispatch.js";
import { CAMPFIRE_HTTP_METHODS as ASYNC_HTTP_METHODS } from "../../src/worker/async-dispatch.js";
import { MCP_TOOL_NAMES } from "../../src/catalog/capability-search.js";
import { createCampfireMcpServer } from "../../src/mcp/tools.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import type { CampfireStore } from "../../src/store/store.js";
import type { CampfireService } from "../../src/service/service.js";
import type { ActorContext } from "../../src/service/authorization.js";
import type { ActorRef } from "../../src/domain/types.js";
import { Unauthorized } from "../../src/domain/errors.js";
import type { ActionProposalView } from "../../src/service/service.js";

const NOW = "2026-10-21T12:00:00.000Z";
const OWNER: ActorRef = { actorId: "hum_owner", actorType: "human" };
const AGENT: ActorRef = { actorId: "agt_owner", actorType: "agent" };
const TARGET = {
  repositoryId: "123",
  repositoryName: "acme/api",
  workflowId: "456",
  runId: "789",
  commitSha: "a".repeat(40),
  expectedAttempt: 1,
};

const ACTION_HTTP_METHODS = [
  "propose_action",
  "review_action",
  "cancel_action",
  "reserve_action_execution",
  "record_action_outcome",
  "get_action_proposal",
  "list_action_proposals",
  "list_action_receipts",
] as const;

const ACTION_MCP_TOOLS = [
  "propose_action",
  "reserve_action_execution",
  "record_action_outcome",
  "get_action_proposal",
  "list_action_proposals",
  "list_action_receipts",
] as const;

let store: CampfireStore;
let service: CampfireService;
let nowMs: number;

function clock(): string {
  nowMs += 1000;
  return new Date(nowMs).toISOString();
}

function ctx(actor: ActorRef, agentSessionId?: string): ActorContext {
  return agentSessionId === undefined ? { actor } : { actor, agentSessionId };
}

beforeEach(() => {
  store = openInMemoryStore();
  nowMs = Date.parse(NOW);
  service = createCampfireService({ store, idSource: createCounterIdSource(), clock });
  store.createOrganization({ id: "org_1", name: "o", createdAt: NOW });
  store.createTeam({ id: "team_1", organizationId: "org_1", name: "t", createdAt: NOW });
  store.createHuman({ id: "hum_owner", teamId: "team_1", displayName: "Owner", createdAt: NOW });
  store.createAgent({ id: "agt_owner", teamId: "team_1", humanId: "hum_owner", name: "owner-agent", harness: "codex", createdAt: NOW });
});

afterEach(() => {
  service.close();
});

function arrange() {
  const ws = service.createWorkspace(ctx(OWNER), { teamId: "team_1", name: "w" }).id;
  service.inviteToWorkspace(ctx(OWNER), { workspaceId: ws, actor: AGENT, role: "owner" });
  service.joinWorkspace(ctx(AGENT), { workspaceId: ws });
  const task = service.createTask(ctx(OWNER), { workspaceId: ws, title: "fix ci" }).id;
  const finding = service.addFinding(ctx(OWNER), { workspaceId: ws, summary: "flaky" }).id;
  const session = service.registerAgentSession(ctx(AGENT), {
    agentId: AGENT.actorId,
    workspaceId: ws,
    harness: "codex",
  }).id;
  return { ws, task, finding, session };
}

describe("HTTP /v1/call dispatch", () => {
  it("adds the eight ACT-001 methods on both dispatch files and keeps them off the outbound bridge", () => {
    expect(ASYNC_HTTP_METHODS).toEqual([...CAMPFIRE_HTTP_METHODS]);
    expect(CAMPFIRE_HTTP_METHODS).toHaveLength(55);
    expect(CAMPFIRE_HTTP_METHODS).toEqual(expect.arrayContaining([...ACTION_HTTP_METHODS]));
    for (const method of ACTION_HTTP_METHODS) {
      expect(isDeliveryEligibleMethod(method)).toBe(false);
    }
    const local = readFileSync(new URL("../../src/http/dispatch.ts", import.meta.url), "utf8");
    const worker = readFileSync(new URL("../../src/worker/async-dispatch.ts", import.meta.url), "utf8");
    expect(local).toContain("case \"propose_action\"");
    expect(worker).toContain("case \"propose_action\"");
  });

  it("maps all eight methods through dispatchCampfireMethod", () => {
    const { ws, task, finding } = arrange();
    const proposed = dispatchCampfireMethod(service, ctx(OWNER), "propose_action", {
      workspaceId: ws,
      target: TARGET,
      executor: OWNER,
      reason: "retry the failed verification",
      taskId: task,
      findingIds: [finding],
      requestKey: "http-propose",
    }) as ActionProposalView;
    expect(proposed.proposal.status).toBe("proposed");

    const listed = dispatchCampfireMethod(service, ctx(OWNER), "list_action_proposals", {
      workspaceId: ws,
    }) as { items: Array<{ id: string }> };
    expect(listed.items.map((item) => item.id)).toContain(proposed.proposal.id);

    const inspected = dispatchCampfireMethod(service, ctx(OWNER), "get_action_proposal", {
      workspaceId: ws,
      proposalId: proposed.proposal.id,
    }) as ActionProposalView;
    expect(inspected.proposal.id).toBe(proposed.proposal.id);

    const approved = dispatchCampfireMethod(service, ctx(OWNER), "review_action", {
      workspaceId: ws,
      proposalId: proposed.proposal.id,
      revision: proposed.proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      decision: "approve",
      requestKey: "http-approve",
    }) as ActionProposalView;
    expect(approved.proposal.status).toBe("approved");

    const reserved = dispatchCampfireMethod(service, ctx(OWNER), "reserve_action_execution", {
      workspaceId: ws,
      proposalId: approved.proposal.id,
      revision: approved.proposal.revision,
      intentDigest: approved.proposal.intentDigest,
      requestKey: "http-reserve",
    }) as ActionProposalView;
    expect(reserved.proposal.status).toBe("dispatch_reserved");

    const receipt = dispatchCampfireMethod(service, ctx(OWNER), "record_action_outcome", {
      workspaceId: ws,
      proposalId: reserved.proposal.id,
      revision: reserved.proposal.revision,
      intentDigest: reserved.proposal.intentDigest,
      outcome: "accepted",
      providerRef: { repositoryId: "123", workflowId: "456", runId: "789" },
      requestKey: "http-receipt",
    }) as { outcome: string };
    expect(receipt.outcome).toBe("accepted");

    const receipts = dispatchCampfireMethod(service, ctx(OWNER), "list_action_receipts", {
      workspaceId: ws,
      proposalId: reserved.proposal.id,
    }) as { items: Array<{ id: string }> };
    expect(receipts.items.length).toBeGreaterThan(0);
  });

  it("denies agent review_action and cancel_action through /v1/call", () => {
    const { ws, task, finding, session } = arrange();
    const proposed = dispatchCampfireMethod(service, ctx(AGENT, session), "propose_action", {
      workspaceId: ws,
      target: { ...TARGET, runId: "790" },
      executor: AGENT,
      reason: "retry the failed verification",
      taskId: task,
      findingIds: [finding],
      requestKey: "agent-propose",
    }) as ActionProposalView;

    expect(() =>
      dispatchCampfireMethod(service, ctx(AGENT, session), "review_action", {
        workspaceId: ws,
        proposalId: proposed.proposal.id,
        revision: proposed.proposal.revision,
        intentDigest: proposed.proposal.intentDigest,
        decision: "approve",
        requestKey: "agent-approve",
      }),
    ).toThrow(Unauthorized);

    expect(() =>
      dispatchCampfireMethod(service, ctx(AGENT, session), "cancel_action", {
        workspaceId: ws,
        proposalId: proposed.proposal.id,
        revision: proposed.proposal.revision,
        intentDigest: proposed.proposal.intentDigest,
        reason: "never mind",
        requestKey: "agent-cancel",
      }),
    ).toThrow(Unauthorized);
  });
});

describe("MCP tools", () => {
  it("registers the six action tools and omits review_action and cancel_action", async () => {
    const server = createCampfireMcpServer({
      service,
      identity: { ctx: { actor: OWNER } },
    });
    const client = new Client({ name: "act-001", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      for (const name of ACTION_MCP_TOOLS) {
        expect(names).toContain(name);
        expect(MCP_TOOL_NAMES).toContain(name);
      }
      expect(names).not.toContain("review_action");
      expect(names).not.toContain("cancel_action");
      expect(MCP_TOOL_NAMES).not.toContain("review_action");
      expect(MCP_TOOL_NAMES).not.toContain("cancel_action");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
