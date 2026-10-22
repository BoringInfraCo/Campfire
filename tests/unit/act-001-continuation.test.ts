/**
 * ACT-001 D7 continuation fixture.
 *
 * Two isolated harness-shaped clients over the real service. Not a Codex or
 * OpenCode trace, not live GitHub, and not human demand. The stub's only
 * simulated authority is labeled SIMULATED / FIXTURE EVIDENCE.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ACT001, seedAct001Database } from "../../fixtures/act-001/seed.js";
import {
  createGithubRerunStub,
  SIMULATED_GITHUB_CREDENTIAL,
  STUB_AUTHORITY_LABEL,
  submitAllowlistedRerunOnce,
} from "../../fixtures/act-001/github-rerun-stub.js";
import { createCampfireMcpServer } from "../../src/mcp/tools.js";
import type { ServerIdentity } from "../../src/mcp/context.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { startCampfireHttpServer, type RunningHttpServer } from "../../src/http/server.js";
import { loadConfig } from "../../src/config.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";
import type { ActionProposalView } from "../../src/service/service.js";
import type { ActionReceipt } from "../../src/domain/action-proposal.js";
import type { Finding } from "../../src/domain/types.js";

const SIGNED = JSON.parse(
  readFileSync(new URL("../../fixtures/act-001/step-0/proposal/signed-payloads.json", import.meta.url), "utf8"),
) as { testOnlySecret: string; cases: Array<{ id: string; body: string; signature: string }> };

const NOW = "2026-10-21T12:10:00.000Z";
const SOURCE_ID = ACT001.sourceId;

const dirs: string[] = [];
const servers: McpServer[] = [];
const clients: Client[] = [];
let running: RunningHttpServer | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
  if (running !== undefined) {
    await running.close();
    running = undefined;
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixtureCase(id: string) {
  const found = SIGNED.cases.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`missing signed fixture ${id}`);
  return found;
}

function sourceEnv(workspaceId: string, sessionId: string): Record<string, string> {
  return {
    CAMPFIRE_GITHUB_SOURCE_ID: SOURCE_ID,
    CAMPFIRE_GITHUB_SOURCE_WORKSPACE_ID: workspaceId,
    CAMPFIRE_GITHUB_SOURCE_REPOSITORY_ID: ACT001.target.repositoryId,
    CAMPFIRE_GITHUB_SOURCE_REPOSITORY_NAME: ACT001.target.repositoryName,
    CAMPFIRE_GITHUB_SOURCE_WORKFLOW_ID: ACT001.target.workflowId,
    CAMPFIRE_GITHUB_SOURCE_KIND: "ci.retry_verification",
    CAMPFIRE_GITHUB_SOURCE_SECRET: SIGNED.testOnlySecret,
    CAMPFIRE_GITHUB_SOURCE_AGENT_ID: ACT001.agents.integration,
    CAMPFIRE_GITHUB_SOURCE_SESSION_ID: sessionId,
  };
}

async function openLab() {
  const dir = mkdtempSync(join(tmpdir(), "act001-cont-"));
  dirs.push(dir);
  const databasePath = join(dir, "campfire.db");
  const seeded = seedAct001Database(databasePath);
  const store = openSqliteStore(databasePath);
  const service = createCampfireService({ store, clock: () => NOW });
  vi.spyOn(console, "error").mockImplementation(() => {});
  running = await startCampfireHttpServer({
    runtime: {
      config: { ...loadConfig(), databasePath },
      store,
      service,
      close: () => service.close(),
    },
    host: "127.0.0.1",
    port: 0,
    sourceEnv: sourceEnv(seeded.workspaceId, seeded.sessions.integration),
    clock: () => NOW,
  });
  return { seeded, service, store };
}

async function connect(identity: ServerIdentity, service: ReturnType<typeof createCampfireService>): Promise<Client> {
  const server = createCampfireMcpServer({ service, identity });
  const client = new Client({ name: identity.harness ?? "act-001", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  servers.push(server);
  clients.push(client);
  return client;
}

async function mcp<T>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
  };
  const text = result.content?.find((part) => part.type === "text" && typeof part.text === "string")?.text ?? "";
  const json = text.length === 0 ? undefined : (JSON.parse(text) as T);
  if (result.isError === true) {
    throw new Error(`MCP ${name} failed: ${text}`);
  }
  return json as T;
}

async function httpCall(
  token: string,
  method: string,
  params: Record<string, unknown>,
): Promise<{ status: number; body: { ok: boolean; result?: unknown; error?: string; message?: string } }> {
  const response = await fetch(`${running!.url}/v1/call`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ method, params }),
  });
  return { status: response.status, body: (await response.json()) as { ok: boolean; result?: unknown; error?: string; message?: string } };
}

async function postIngress(delivery: string, id = "completed-matching"): Promise<{ status: number; body: { ok: boolean; result?: { outcome: string } } }> {
  const matching = fixtureCase(id);
  const response = await fetch(`${running!.url}/v1/integrations/github/${SOURCE_ID}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "workflow_run",
      "x-github-delivery": delivery,
      "x-hub-signature-256": matching.signature,
    },
    body: matching.body,
  });
  return { status: response.status, body: (await response.json()) as { ok: boolean; result?: { outcome: string } } };
}

const proposeInput = {
  workspaceId: ACT001.workspace,
  target: { ...ACT001.target },
  executor: { actorId: ACT001.agents.executing, actorType: "agent" as const },
  reason: "Retry the failed verification run after inspecting the failed job logs",
  taskId: ACT001.task,
  findingIds: [ACT001.findings.logs],
};

describe("ACT-001 two-harness continuation fixture", () => {
  it("seeds the frozen workspace without leaking the other workspace", () => {
    const dir = mkdtempSync(join(tmpdir(), "act001-seed-"));
    dirs.push(dir);
    const seeded = seedAct001Database(join(dir, "campfire.db"));
    expect(seeded.workspaceId).toBe(ACT001.workspace);
    expect(seeded.otherWorkspaceId).toBe(ACT001.otherWorkspace);
    expect(seeded.taskId).toBe(ACT001.task);
    expect(seeded.findings.logs).toBe(ACT001.findings.logs);
    expect(seeded.agents.proposing).toBe(ACT001.agents.proposing);
    expect(seeded.agents.executing).toBe(ACT001.agents.executing);
    expect(seeded.contributionCounts.lab).toBeGreaterThan(0);
    expect(JSON.stringify(seeded)).not.toContain("SIMULATED-GITHUB-TOKEN");
  });

  it("propose → human approve → stub submit → signed failure → second client inspects without a transcript", async () => {
    const { seeded, service } = await openLab();
    const clientA = await connect(
      {
        ctx: { actor: { actorId: ACT001.agents.proposing, actorType: "agent" }, agentSessionId: ACT001.sessions.proposing },
        harness: "codex",
      },
      service,
    );
    const clientB = await connect(
      {
        ctx: { actor: { actorId: ACT001.agents.executing, actorType: "agent" }, agentSessionId: ACT001.sessions.executing },
        harness: "opencode",
      },
      service,
    );

    const proposed = await mcp<ActionProposalView>(clientA, "propose_action", {
      ...proposeInput,
      requestKey: "d7-propose",
    });
    expect(proposed.proposal.status).toBe("proposed");
    expect(proposed.proposal.proposedBy.actorId).toBe(ACT001.agents.proposing);

    const approved = await httpCall(seeded.tokens.owner, "review_action", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
      revision: proposed.proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      decision: "approve",
      requestKey: "d7-approve",
    });
    expect(approved.status).toBe(200);
    expect(approved.body.ok).toBe(true);
    const approvedView = approved.body.result as ActionProposalView;
    expect(approvedView.proposal.review?.actor.actorId).toBe(ACT001.humans.owner);

    const reserved = await mcp<ActionProposalView>(clientB, "reserve_action_execution", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
      revision: approvedView.proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      requestKey: "d7-reserve",
    });
    expect(reserved.proposal.status).toBe("dispatch_reserved");

    const stub = createGithubRerunStub({ mode: "accepted" });
    expect(stub.label).toBe(STUB_AUTHORITY_LABEL);
    const submitted = submitAllowlistedRerunOnce(stub, { ...ACT001.target }, SIMULATED_GITHUB_CREDENTIAL);
    expect(submitted.outcome).toBe("accepted");
    expect(submitted.posted).toBe(true);
    expect(stub.postCount(ACT001.target.runId)).toBe(1);

    const receipt = await mcp<ActionReceipt>(clientB, "record_action_outcome", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
      revision: reserved.proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      outcome: "accepted",
      providerRef: {
        repositoryId: ACT001.target.repositoryId,
        workflowId: ACT001.target.workflowId,
        runId: ACT001.target.runId,
        attempt: ACT001.target.expectedAttempt,
      },
      requestKey: "d7-receipt",
    });
    expect(receipt.outcome).toBe("accepted");

    const ingress = await postIngress("act001-delivery-0001");
    expect(ingress).toEqual({ status: 200, body: { ok: true, result: { outcome: "accepted" } } });
    expect(JSON.stringify(ingress.body)).not.toContain(ACT001.workspace);

    const view = await mcp<ActionProposalView>(clientA, "get_action_proposal", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
    });
    const receipts = await mcp<{ items: ActionReceipt[] }>(clientA, "list_action_receipts", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
    });
    const task = await mcp<{ id: string; status: string }>(clientA, "get_task", {
      workspaceId: ACT001.workspace,
      taskId: ACT001.task,
    });
    const observation = await mcp<Finding>(clientA, "get_finding", {
      workspaceId: ACT001.workspace,
      findingId: view.signedObservation!.findingId,
    });

    expect(view.proposal.review?.actor.actorId).toBe(ACT001.humans.owner);
    expect(view.proposal.target.commitSha).toBe(ACT001.target.commitSha);
    expect(view.proposal.target.runId).toBe(ACT001.target.runId);
    expect(view.proposal.target.expectedAttempt).toBe(2);
    expect(view.latestReceipt?.outcome).toBe("accepted");
    expect(view.signedObservation?.conclusion).toBe("failure");
    expect(observation.summary).toBe("Verification attempt 2 completed: failure");
    expect(observation.summary).not.toMatch(/success/i);
    expect(receipts.items.map((item) => item.outcome)).toContain("accepted");
    expect(task.id).toBe(ACT001.task);
    expect(task.status).toBe("in_progress");
    expect(JSON.stringify(view)).not.toContain(SIMULATED_GITHUB_CREDENTIAL);
    expect(JSON.stringify(view)).not.toContain("transcript");
  });

  it("reject branch never dispatches", async () => {
    const { seeded, service } = await openLab();
    const clientA = await connect(
      {
        ctx: { actor: { actorId: ACT001.agents.proposing, actorType: "agent" }, agentSessionId: ACT001.sessions.proposing },
        harness: "codex",
      },
      service,
    );
    const proposed = await mcp<ActionProposalView>(clientA, "propose_action", {
      ...proposeInput,
      requestKey: "d7-reject-propose",
    });
    const rejected = await httpCall(seeded.tokens.owner, "review_action", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
      revision: proposed.proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      decision: "reject",
      reason: "wrong run",
      requestKey: "d7-reject",
    });
    expect((rejected.body.result as ActionProposalView).proposal.status).toBe("rejected");
    const stub = createGithubRerunStub({ mode: "accepted" });
    expect(stub.postCount()).toBe(0);
    const view = await mcp<ActionProposalView>(clientA, "get_action_proposal", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
    });
    expect(view.proposal.status).toBe("rejected");
    expect(view.proposal.reservation).toBeUndefined();
  });

  it("approved but never reserved creates no dispatch and ignores the completion event", async () => {
    const { seeded, service } = await openLab();
    const clientA = await connect(
      {
        ctx: { actor: { actorId: ACT001.agents.proposing, actorType: "agent" }, agentSessionId: ACT001.sessions.proposing },
        harness: "codex",
      },
      service,
    );
    const proposed = await mcp<ActionProposalView>(clientA, "propose_action", {
      ...proposeInput,
      requestKey: "d7-nodispatch-propose",
    });
    await httpCall(seeded.tokens.owner, "review_action", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
      revision: proposed.proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      decision: "approve",
      requestKey: "d7-nodispatch-approve",
    });
    const ingress = await postIngress("act001-delivery-nodispatch");
    expect(ingress.status).toBe(200);
    expect(ingress.body.result?.outcome).toBe("ignored");
    const view = await mcp<ActionProposalView>(clientA, "get_action_proposal", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
    });
    expect(view.proposal.status).toBe("approved");
    expect(view.signedObservation).toBeUndefined();
    expect(view.latestReceipt).toBeUndefined();
  });

  it("unknown submission does not POST twice and still correlates an event-before-receipt", async () => {
    const { seeded, service } = await openLab();
    const clientA = await connect(
      {
        ctx: { actor: { actorId: ACT001.agents.proposing, actorType: "agent" }, agentSessionId: ACT001.sessions.proposing },
        harness: "codex",
      },
      service,
    );
    const clientB = await connect(
      {
        ctx: { actor: { actorId: ACT001.agents.executing, actorType: "agent" }, agentSessionId: ACT001.sessions.executing },
        harness: "opencode",
      },
      service,
    );
    const proposed = await mcp<ActionProposalView>(clientA, "propose_action", {
      ...proposeInput,
      requestKey: "d7-unknown-propose",
    });
    const approved = await httpCall(seeded.tokens.owner, "review_action", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
      revision: proposed.proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      decision: "approve",
      requestKey: "d7-unknown-approve",
    });
    const reserved = await mcp<ActionProposalView>(clientB, "reserve_action_execution", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
      revision: (approved.body.result as ActionProposalView).proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      requestKey: "d7-unknown-reserve",
    });

    const beforeReceipt = await postIngress("act001-delivery-before-receipt");
    expect(beforeReceipt.body.result?.outcome).toBe("accepted");

    const stub = createGithubRerunStub({ mode: "unknown" });
    const first = submitAllowlistedRerunOnce(stub, { ...ACT001.target });
    const second = submitAllowlistedRerunOnce(stub, { ...ACT001.target });
    expect(first.outcome).toBe("unknown");
    expect(first.posted).toBe(true);
    expect(second.outcome).toBe("unknown");
    expect(second.posted).toBe(false);
    expect(stub.postCount()).toBe(1);

    const receipt = await mcp<ActionReceipt>(clientB, "record_action_outcome", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
      revision: reserved.proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      outcome: "unknown",
      providerRef: {
        repositoryId: ACT001.target.repositoryId,
        workflowId: ACT001.target.workflowId,
        runId: ACT001.target.runId,
      },
      requestKey: "d7-unknown-receipt",
    });
    expect(receipt.outcome).toBe("unknown");

    const view = await mcp<ActionProposalView>(clientA, "get_action_proposal", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
    });
    expect(view.proposal.status).toBe("submission_unknown");
    expect(view.latestReceipt?.outcome).toBe("unknown");
    expect(view.signedObservation?.conclusion).toBe("failure");
    expect(view.signedObservation?.attempt).toBe(2);
  });

  it("definite_failure submission records submission_failed and keeps the signed failure observation", async () => {
    const { seeded, service } = await openLab();
    const clientA = await connect(
      {
        ctx: { actor: { actorId: ACT001.agents.proposing, actorType: "agent" }, agentSessionId: ACT001.sessions.proposing },
        harness: "codex",
      },
      service,
    );
    const clientB = await connect(
      {
        ctx: { actor: { actorId: ACT001.agents.executing, actorType: "agent" }, agentSessionId: ACT001.sessions.executing },
        harness: "opencode",
      },
      service,
    );
    const proposed = await mcp<ActionProposalView>(clientA, "propose_action", {
      ...proposeInput,
      requestKey: "d7-deffail-propose",
    });
    const approved = await httpCall(seeded.tokens.owner, "review_action", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
      revision: proposed.proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      decision: "approve",
      requestKey: "d7-deffail-approve",
    });
    const reserved = await mcp<ActionProposalView>(clientB, "reserve_action_execution", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
      revision: (approved.body.result as ActionProposalView).proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      requestKey: "d7-deffail-reserve",
    });
    // The executor could not even submit (definite failure at the boundary):
    // no provider run exists, but the signed completion still arrives and is
    // recorded as provider evidence, not as an executor assertion.
    const receipt = await mcp<ActionReceipt>(clientB, "record_action_outcome", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
      revision: reserved.proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      outcome: "definite_failure",
      providerRef: {
        repositoryId: ACT001.target.repositoryId,
        workflowId: ACT001.target.workflowId,
        runId: ACT001.target.runId,
      },
      requestKey: "d7-deffail-receipt",
    });
    expect(receipt.outcome).toBe("definite_failure");

    const ingress = await postIngress("act001-delivery-deffail");
    expect(ingress).toEqual({ status: 200, body: { ok: true, result: { outcome: "accepted" } } });

    const view = await mcp<ActionProposalView>(clientA, "get_action_proposal", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
    });
    expect(view.proposal.status).toBe("submission_failed");
    expect(view.latestReceipt?.outcome).toBe("definite_failure");
    expect(view.latestReceipt?.recordedBy.actorId).toBe(ACT001.agents.executing);
    expect(view.signedObservation?.conclusion).toBe("failure");
    expect(view.signedObservation?.attempt).toBe(2);
    const observation = await mcp<Finding>(clientA, "get_finding", {
      workspaceId: ACT001.workspace,
      findingId: view.signedObservation!.findingId,
    });
    expect(observation.summary).toBe("Verification attempt 2 completed: failure");
    const receipts = await mcp<{ items: ActionReceipt[] }>(clientA, "list_action_receipts", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
    });
    expect(receipts.items.map((item) => item.outcome)).toEqual(["definite_failure"]);
    expect(JSON.stringify(view)).not.toContain(SIMULATED_GITHUB_CREDENTIAL);
  });

  it("unknown submission reconciles to accepted after the signed completion arrives", async () => {
    const { seeded, service } = await openLab();
    const clientA = await connect(
      {
        ctx: { actor: { actorId: ACT001.agents.proposing, actorType: "agent" }, agentSessionId: ACT001.sessions.proposing },
        harness: "codex",
      },
      service,
    );
    const clientB = await connect(
      {
        ctx: { actor: { actorId: ACT001.agents.executing, actorType: "agent" }, agentSessionId: ACT001.sessions.executing },
        harness: "opencode",
      },
      service,
    );
    const proposed = await mcp<ActionProposalView>(clientA, "propose_action", {
      ...proposeInput,
      requestKey: "d7-reconcile-propose",
    });
    const approved = await httpCall(seeded.tokens.owner, "review_action", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
      revision: proposed.proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      decision: "approve",
      requestKey: "d7-reconcile-approve",
    });
    const reserved = await mcp<ActionProposalView>(clientB, "reserve_action_execution", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
      revision: (approved.body.result as ActionProposalView).proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      requestKey: "d7-reconcile-reserve",
    });

    const beforeReceipt = await postIngress("act001-delivery-reconcile");
    expect(beforeReceipt.body.result?.outcome).toBe("accepted");

    const unknown = await mcp<ActionReceipt>(clientB, "record_action_outcome", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
      revision: reserved.proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      outcome: "unknown",
      providerRef: {
        repositoryId: ACT001.target.repositoryId,
        workflowId: ACT001.target.workflowId,
        runId: ACT001.target.runId,
      },
      requestKey: "d7-reconcile-unknown",
    });
    expect(unknown.outcome).toBe("unknown");
    const mid = await mcp<ActionProposalView>(clientA, "get_action_proposal", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
    });
    expect(mid.proposal.status).toBe("submission_unknown");

    // Reconciliation resolves the uncertainty without rewriting it: the
    // unknown receipt stays, and the signed provider observation stays the
    // failure event that actually arrived. A reconciled submission is not
    // proof the tests passed.
    const reconciled = await mcp<ActionReceipt>(clientB, "record_action_outcome", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
      revision: mid.proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      outcome: "reconciled_accepted",
      resolvesReceiptId: unknown.id,
      providerRef: {
        repositoryId: ACT001.target.repositoryId,
        workflowId: ACT001.target.workflowId,
        runId: ACT001.target.runId,
        attempt: ACT001.target.expectedAttempt,
        conclusion: "success",
      },
      requestKey: "d7-reconcile-accepted",
    });
    expect(reconciled.outcome).toBe("reconciled_accepted");
    expect(reconciled.resolvesReceiptId).toBe(unknown.id);

    const view = await mcp<ActionProposalView>(clientA, "get_action_proposal", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
    });
    expect(view.proposal.status).toBe("submission_accepted");
    expect(view.latestReceipt?.outcome).toBe("reconciled_accepted");
    expect(view.signedObservation?.conclusion).toBe("failure");
    const receipts = await mcp<{ items: ActionReceipt[] }>(clientA, "list_action_receipts", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
    });
    expect(receipts.items.map((item) => item.outcome).sort()).toEqual(["reconciled_accepted", "unknown"]);
    expect(JSON.stringify(view)).not.toContain(SIMULATED_GITHUB_CREDENTIAL);
  });
});
