/**
 * Worker route for ACT-001 GitHub ingress. Synthetic fixtures only.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { createWorkerHandler } from "../../src/worker/handler.js";
import type { CampfireStore } from "../../src/store/store.js";
import type { CampfireService } from "../../src/service/service.js";
import type { ActorRef } from "../../src/domain/types.js";

const FIXTURE = JSON.parse(
  readFileSync(new URL("../../fixtures/act-001/step-0/proposal/signed-payloads.json", import.meta.url), "utf8"),
) as { testOnlySecret: string; cases: Array<{ id: string; body: string; signature: string }> };

const NOW = "2026-10-21T12:10:00.000Z";
const SHA = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const OWNER: ActorRef = { actorId: "hum_owner", actorType: "human" };
const EXEC: ActorRef = { actorId: "hum_exec", actorType: "human" };
const INTEGRATION: ActorRef = { actorId: "agt_integration", actorType: "agent" };

let store: CampfireStore;
let service: CampfireService;
let handle: (request: Request) => Promise<Response>;
let sourceId: string;
let sessionId: string;
let workspaceId: string;

beforeEach(() => {
  store = openInMemoryStore();
  const idSource = createCounterIdSource();
  service = createCampfireService({ store, idSource, clock: () => NOW });
  store.createOrganization({ id: "org_1", name: "o", createdAt: NOW });
  store.createTeam({ id: "team_1", organizationId: "org_1", name: "t", createdAt: NOW });
  store.createHuman({ id: "hum_owner", teamId: "team_1", displayName: "Owner", createdAt: NOW });
  store.createHuman({ id: "hum_exec", teamId: "team_1", displayName: "Exec", createdAt: NOW });
  store.createAgent({
    id: "agt_integration",
    teamId: "team_1",
    humanId: "hum_owner",
    name: "integration",
    harness: "campfire-integration",
    createdAt: NOW,
  });
  workspaceId = service.createWorkspace({ actor: OWNER }, { teamId: "team_1", name: "lab" }).id;
  service.inviteToWorkspace({ actor: OWNER }, { workspaceId, actor: EXEC, role: "member" });
  service.joinWorkspace({ actor: EXEC }, { workspaceId });
  service.inviteToWorkspace({ actor: OWNER }, { workspaceId, actor: INTEGRATION, role: "member" });
  service.joinWorkspace({ actor: INTEGRATION }, { workspaceId });
  sessionId = service.registerAgentSession({ actor: INTEGRATION }, {
    agentId: INTEGRATION.actorId,
    workspaceId,
    harness: "campfire-integration",
  }).id;
  const task = service.createTask({ actor: OWNER }, { workspaceId, title: "verify" }).id;
  const finding = service.addFinding({ actor: OWNER }, { workspaceId, summary: "failed" }).id;
  const proposed = service.propose_action({ actor: OWNER }, {
    workspaceId,
    target: {
      repositoryId: "123456789",
      repositoryName: "example-org/verification-sandbox",
      workflowId: "9876543",
      runId: "11223344",
      commitSha: SHA,
      expectedAttempt: 2,
    },
    executor: EXEC,
    reason: "retry the failed verification",
    taskId: task,
    findingIds: [finding],
    requestKey: "k1",
  });
  const approved = service.review_action({ actor: OWNER }, {
    workspaceId,
    proposalId: proposed.proposal.id,
    revision: proposed.proposal.revision,
    intentDigest: proposed.proposal.intentDigest,
    decision: "approve",
    requestKey: "k2",
  });
  service.reserve_action_execution({ actor: EXEC }, {
    workspaceId,
    proposalId: approved.proposal.id,
    revision: approved.proposal.revision,
    intentDigest: approved.proposal.intentDigest,
    requestKey: "k3",
  });
  sourceId = "src_act001_github";
  handle = createWorkerHandler({
    service,
    store,
    clock: () => NOW,
    idSource,
    sourceEnv: {
      CAMPFIRE_GITHUB_SOURCE_ID: sourceId,
      CAMPFIRE_GITHUB_SOURCE_WORKSPACE_ID: workspaceId,
      CAMPFIRE_GITHUB_SOURCE_REPOSITORY_ID: "123456789",
      CAMPFIRE_GITHUB_SOURCE_REPOSITORY_NAME: "example-org/verification-sandbox",
      CAMPFIRE_GITHUB_SOURCE_WORKFLOW_ID: "9876543",
      CAMPFIRE_GITHUB_SOURCE_KIND: "ci.retry_verification",
      CAMPFIRE_GITHUB_SOURCE_SECRET: FIXTURE.testOnlySecret,
      CAMPFIRE_GITHUB_SOURCE_AGENT_ID: INTEGRATION.actorId,
      CAMPFIRE_GITHUB_SOURCE_SESSION_ID: sessionId,
    },
  });
});

describe("worker GitHub ingress route", () => {
  it("accepts a signed matching completion and rejects forgery", async () => {
    const matching = FIXTURE.cases.find((entry) => entry.id === "completed-matching")!;
    const accepted = await handle(new Request(`https://campfire.test/v1/integrations/github/${sourceId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "workflow_run",
        "x-github-delivery": "act001-delivery-0001",
        "x-hub-signature-256": matching.signature,
      },
      body: matching.body,
    }));
    expect(accepted.status).toBe(200);
    const acceptedBody = await accepted.json() as { ok: boolean; result: { outcome: string } };
    expect(acceptedBody).toEqual({ ok: true, result: { outcome: "accepted" } });
    expect(JSON.stringify(acceptedBody)).not.toContain(workspaceId);

    const tampered = FIXTURE.cases.find((entry) => entry.id === "tampered")!;
    const forged = await handle(new Request(`https://campfire.test/v1/integrations/github/${sourceId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "workflow_run",
        "x-github-delivery": "act001-delivery-tampered",
        "x-hub-signature-256": tampered.signature,
      },
      body: tampered.body,
    }));
    expect(forged.status).toBe(401);
  });

  it("returns 404 for an unknown source id", async () => {
    const matching = FIXTURE.cases.find((entry) => entry.id === "completed-matching")!;
    const response = await handle(new Request("https://campfire.test/v1/integrations/github/src_missing", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": matching.signature },
      body: matching.body,
    }));
    expect(response.status).toBe(404);
  });
});
