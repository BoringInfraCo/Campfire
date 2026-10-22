/**
 * ACT-001 Step 3: signed GitHub workflow_run ingress (D5).
 *
 * Synthetic fixtures only. No live GitHub, production credential, or
 * public-repository mutation.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import type { ActorContext } from "../../src/service/authorization.js";
import type { ActorRef } from "../../src/domain/types.js";
import {
  ingestGithubWorkflowRun,
  type GithubIngressRequest,
} from "../../src/service/github-ingress.js";
import {
  readGithubSourceConfig,
  sourceAuthorityFingerprint,
  type GithubSourceBinding,
} from "../../src/integrations/github-source-config.js";
import {
  GITHUB_INGRESS_MAX_BODY_BYTES,
  githubSignatureFor,
  ingressEncodingAllowed,
  verifyGithubSignature,
} from "../../src/integrations/github-workflow-run.js";
import { createWorkerHandler } from "../../src/worker/handler.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";
import { createD1Store, migrateD1 } from "../../src/worker/d1-store.js";
import { ingestGithubWorkflowRunAsync } from "../../src/service/github-ingress.js";
import { createAsyncCampfireService } from "../../src/worker/async-service.js";

const FIXTURE = JSON.parse(
  readFileSync(new URL("../../fixtures/act-001/step-0/proposal/signed-payloads.json", import.meta.url), "utf8"),
) as {
  testOnlySecret: string;
  cases: Array<{ id: string; body: string; signature: string; delivery?: string; expected: string }>;
};
const DIGESTS = JSON.parse(
  readFileSync(new URL("../../fixtures/act-001/step-0/proposal/digest-vectors.json", import.meta.url), "utf8"),
) as { sourceAuthorityFingerprint: { sha256: string } };

const SECRET = FIXTURE.testOnlySecret;
const NOW = "2026-10-21T12:10:00.000Z";
const SHA = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const TARGET = {
  repositoryId: "123456789",
  repositoryName: "example-org/verification-sandbox",
  workflowId: "9876543",
  runId: "11223344",
  commitSha: SHA,
  expectedAttempt: 2,
};

const OWNER: ActorRef = { actorId: "hum_owner", actorType: "human" };
const EXEC: ActorRef = { actorId: "hum_exec", actorType: "human" };
const INTEGRATION: ActorRef = { actorId: "agt_act001_integration", actorType: "agent" };

function fixtureCase(id: string) {
  const found = FIXTURE.cases.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`missing fixture ${id}`);
  return found;
}

function ctx(actor: ActorRef, agentSessionId?: string): ActorContext {
  return agentSessionId === undefined ? { actor } : { actor, agentSessionId };
}

let store: CampfireStore;
let service: CampfireService;
let nowMs: number;
let keySeq: number;
let idSource: ReturnType<typeof createCounterIdSource>;

function clock(): string {
  return new Date(nowMs).toISOString();
}

function nextKey(): string {
  keySeq += 1;
  return `key-${keySeq}`;
}

beforeEach(() => {
  store = openInMemoryStore();
  nowMs = Date.parse(NOW);
  keySeq = 0;
  idSource = createCounterIdSource();
  service = createCampfireService({ store, idSource, clock });
  store.createOrganization({ id: "org_1", name: "o", createdAt: NOW });
  store.createTeam({ id: "team_1", organizationId: "org_1", name: "t", createdAt: NOW });
  store.createHuman({ id: "hum_owner", teamId: "team_1", displayName: "Owner", createdAt: NOW });
  store.createHuman({ id: "hum_exec", teamId: "team_1", displayName: "Exec", createdAt: NOW });
  store.createAgent({
    id: "agt_act001_integration",
    teamId: "team_1",
    humanId: "hum_owner",
    name: "integration",
    harness: "campfire-integration",
    createdAt: NOW,
  });
});

afterEach(() => {
  service.close();
});

function sourceEnv(workspaceId: string, sessionId: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    CAMPFIRE_GITHUB_SOURCE_ID: "src_act001_github",
    CAMPFIRE_GITHUB_SOURCE_WORKSPACE_ID: workspaceId,
    CAMPFIRE_GITHUB_SOURCE_REPOSITORY_ID: TARGET.repositoryId,
    CAMPFIRE_GITHUB_SOURCE_REPOSITORY_NAME: TARGET.repositoryName,
    CAMPFIRE_GITHUB_SOURCE_WORKFLOW_ID: TARGET.workflowId,
    CAMPFIRE_GITHUB_SOURCE_KIND: "ci.retry_verification",
    CAMPFIRE_GITHUB_SOURCE_SECRET: SECRET,
    CAMPFIRE_GITHUB_SOURCE_AGENT_ID: INTEGRATION.actorId,
    CAMPFIRE_GITHUB_SOURCE_SESSION_ID: sessionId,
    ...extra,
  };
}

function requireSource(env: Record<string, string>): GithubSourceBinding {
  const config = readGithubSourceConfig(env);
  if (!config.configured) throw new Error(config.problem ?? "source not configured");
  return config.source;
}

function arrangeReserved(): { ws: string; sessionId: string; proposalId: string; source: GithubSourceBinding } {
  const ws = service.createWorkspace(ctx(OWNER), { teamId: "team_1", name: "lab" }).id;
  service.inviteToWorkspace(ctx(OWNER), { workspaceId: ws, actor: EXEC, role: "member" });
  service.joinWorkspace(ctx(EXEC), { workspaceId: ws });
  service.inviteToWorkspace(ctx(OWNER), { workspaceId: ws, actor: INTEGRATION, role: "member" });
  service.joinWorkspace(ctx(INTEGRATION), { workspaceId: ws });
  const sessionId = service.registerAgentSession(ctx(INTEGRATION), {
    agentId: INTEGRATION.actorId,
    workspaceId: ws,
    harness: "campfire-integration",
  }).id;
  const task = service.createTask(ctx(OWNER), { workspaceId: ws, title: "verify" }).id;
  const finding = service.addFinding(ctx(OWNER), { workspaceId: ws, summary: "jobs failed" }).id;
  const proposed = service.propose_action(ctx(OWNER), {
    workspaceId: ws,
    target: { ...TARGET },
    executor: { ...EXEC },
    reason: "retry the failed verification",
    taskId: task,
    findingIds: [finding],
    requestKey: nextKey(),
    sourceAuthorityRevision: "src_act001_github#1",
  });
  const approved = service.review_action(ctx(OWNER), {
    workspaceId: ws,
    proposalId: proposed.proposal.id,
    revision: proposed.proposal.revision,
    intentDigest: proposed.proposal.intentDigest,
    decision: "approve",
    requestKey: nextKey(),
  });
  const reserved = service.reserve_action_execution(ctx(EXEC), {
    workspaceId: ws,
    proposalId: approved.proposal.id,
    revision: approved.proposal.revision,
    intentDigest: approved.proposal.intentDigest,
    requestKey: nextKey(),
  });
  const source = requireSource(sourceEnv(ws, sessionId));
  return { ws, sessionId, proposalId: reserved.proposal.id, source };
}

async function ingest(
  source: GithubSourceBinding,
  input: { body: string; signature?: string; delivery?: string; event?: string },
) {
  const rawBody = new TextEncoder().encode(input.body);
  const request: GithubIngressRequest = {
    sourceId: source.sourceId,
    eventName: input.event ?? "workflow_run",
    deliveryId: input.delivery ?? "act001-delivery-0001",
    signatureHeader: input.signature ?? (await githubSignatureFor(source.secret, rawBody)),
    rawBody,
  };
  return ingestGithubWorkflowRun(store, source, request, { clock, idSource });
}

describe("signed payload fixtures", () => {
  it("matches frozen HMAC vectors and the source authority fingerprint", async () => {
    for (const entry of FIXTURE.cases) {
      if (entry.id === "tampered") {
        expect(await verifyGithubSignature(SECRET, new TextEncoder().encode(entry.body), entry.signature)).toBe(false);
        continue;
      }
      if (entry.id === "replay-same-delivery") continue;
      expect(await verifyGithubSignature(SECRET, new TextEncoder().encode(entry.body), entry.signature)).toBe(true);
    }
    const fp = await sourceAuthorityFingerprint({
      sourceId: "src_act001_github",
      workspaceId: "ws_act001_lab",
      repositoryId: "123456789",
      repositoryName: "example-org/verification-sandbox",
      workflowId: "9876543",
      actionKind: "ci.retry_verification",
      agentId: "agt_act001_integration",
      sessionId: "ses_act001_integration_01",
    });
    expect(fp).toBe(DIGESTS.sourceAuthorityFingerprint.sha256);
  });
});

describe("D5 signed ingress", () => {
  it("accepts a matching completed run as one Artifact + one Finding", async () => {
    const arranged = arrangeReserved();
    const beforeFindings = store.listFindings(arranged.ws).length;
    const beforeArtifacts = store.listArtifacts(arranged.ws).length;
    const entry = fixtureCase("completed-matching");
    const result = await ingest(arranged.source, {
      body: entry.body,
      signature: entry.signature,
      delivery: "act001-delivery-0001",
    });
    expect(result).toEqual({ status: 200, body: { ok: true, result: { outcome: "accepted" } } });
    expect(store.listFindings(arranged.ws)).toHaveLength(beforeFindings + 1);
    expect(store.listArtifacts(arranged.ws)).toHaveLength(beforeArtifacts + 1);
    const finding = store.listFindings(arranged.ws).find((row) => row.summary === "Verification attempt 2 completed: failure");
    const artifact = store.listArtifacts(arranged.ws).find((row) => row.uriOrPath === "https://github.com/example-org/verification-sandbox/actions/runs/11223344");
    expect(finding).toBeDefined();
    expect(finding?.detail).toContain("Provider observation");
    expect(finding?.createdBy).toEqual(INTEGRATION);
    expect(artifact).toBeDefined();
    expect(JSON.stringify(finding)).not.toContain(SECRET);
    expect(JSON.stringify(finding)).not.toContain("zen");
    const view = service.get_action_proposal(ctx(OWNER), { workspaceId: arranged.ws, proposalId: arranged.proposalId });
    expect(view.signedObservation?.findingId).toBe(finding?.id);
    expect(view.signedObservation?.artifactId).toBe(artifact?.id);
    expect(view.signedObservation?.conclusion).toBe("failure");
    const receipts = service.list_action_receipts(ctx(OWNER), { workspaceId: arranged.ws, proposalId: arranged.proposalId });
    expect(receipts.linkedObservations?.[0]?.findingId).toBe(finding?.id);
    expect(JSON.stringify(receipts)).not.toMatch(/success":true/);
  });

  it("acknowledges ping without state", async () => {
    const arranged = arrangeReserved();
    const before = store.listFindings(arranged.ws).length;
    const entry = fixtureCase("ping");
    const result = await ingest(arranged.source, {
      body: entry.body,
      signature: entry.signature,
      event: "ping",
      delivery: "act001-delivery-ping",
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, result: { outcome: "pong" } });
    expect(store.listFindings(arranged.ws)).toHaveLength(before);
    expect(store.getGithubSourceBinding(arranged.source.sourceId)).toBeUndefined();
  });

  it("rejects a tampered body with 401 and no state", async () => {
    const arranged = arrangeReserved();
    const before = store.listFindings(arranged.ws).length;
    const entry = fixtureCase("tampered");
    const result = await ingest(arranged.source, {
      body: entry.body,
      signature: entry.signature,
    });
    expect(result.status).toBe(401);
    expect(store.listFindings(arranged.ws)).toHaveLength(before);
  });

  it("conflicts when a delivery id is reused for different bytes", async () => {
    const arranged = arrangeReserved();
    const first = fixtureCase("completed-matching");
    await ingest(arranged.source, { body: first.body, signature: first.signature, delivery: "act001-delivery-0001" });
    const replay = fixtureCase("replay-same-delivery");
    const result = await ingest(arranged.source, {
      body: replay.body,
      delivery: "act001-delivery-0001",
    });
    expect(result.status).toBe(409);
    expect(store.listFindings(arranged.ws).filter((row) => row.summary.includes("Verification attempt"))).toHaveLength(1);
  });

  it("returns 200 duplicate for the same semantic event with a new delivery id", async () => {
    const arranged = arrangeReserved();
    const entry = fixtureCase("completed-matching");
    await ingest(arranged.source, { body: entry.body, signature: entry.signature, delivery: "act001-delivery-0001" });
    const before = store.listFindings(arranged.ws).length;
    const replay = fixtureCase("replay-new-delivery");
    const result = await ingest(arranged.source, {
      body: replay.body,
      signature: replay.signature,
      delivery: "act001-delivery-0002",
    });
    expect(result).toEqual({ status: 200, body: { ok: true, result: { outcome: "duplicate" } } });
    expect(store.listFindings(arranged.ws)).toHaveLength(before);
  });

  it("ignores the wrong repository", async () => {
    const arranged = arrangeReserved();
    const before = store.listFindings(arranged.ws).length;
    const entry = fixtureCase("wrong-repo");
    const result = await ingest(arranged.source, { body: entry.body, signature: entry.signature, delivery: "del-wrong-repo" });
    expect(result).toEqual({ status: 200, body: { ok: true, result: { outcome: "ignored" } } });
    expect(store.listFindings(arranged.ws)).toHaveLength(before);
  });

  it("ignores an unreserved attempt", async () => {
    const arranged = arrangeReserved();
    const before = store.listFindings(arranged.ws).length;
    const entry = fixtureCase("wrong-attempt");
    const result = await ingest(arranged.source, { body: entry.body, signature: entry.signature, delivery: "del-wrong-attempt" });
    expect(result).toEqual({ status: 200, body: { ok: true, result: { outcome: "ignored" } } });
    expect(store.listFindings(arranged.ws)).toHaveLength(before);
  });

  it("rejects a first-seen stale timestamp", async () => {
    const arranged = arrangeReserved();
    const entry = fixtureCase("stale-timestamp");
    const result = await ingest(arranged.source, { body: entry.body, signature: entry.signature, delivery: "del-stale" });
    expect(result.status).toBe(400);
    expect(store.listFindings(arranged.ws).some((row) => row.summary.includes("Verification attempt"))).toBe(false);
  });

  it("rejects a missing signature, future timestamp, and unrelated events", async () => {
    const arranged = arrangeReserved();
    const matching = fixtureCase("completed-matching");
    const missing = await ingest(arranged.source, { body: matching.body, signature: "", delivery: "del-missing" });
    expect(missing.status).toBe(401);

    const futureBody = matching.body.replace("2026-10-21T12:09:30.000Z", "2026-10-21T13:00:00.000Z");
    const future = await ingest(arranged.source, { body: futureBody, delivery: "del-future" });
    expect(future.status).toBe(400);

    const push = await ingest(arranged.source, {
      body: matching.body,
      signature: matching.signature,
      event: "push",
      delivery: "del-push",
    });
    expect(push).toEqual({ status: 200, body: { ok: true, result: { outcome: "ignored" } } });
  });

  it("records a provider success as a success observation without granting anything else", async () => {
    const arranged = arrangeReserved();
    const before = store.listFindings(arranged.ws).length;
    const body = fixtureCase("completed-matching").body.replace('"conclusion":"failure"', '"conclusion":"success"');
    const result = await ingest(arranged.source, { body, delivery: "del-success" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, result: { outcome: "accepted" } });
    // A provider success is reported as verification success: the finding
    // names the attempt and the success conclusion, and the proposal view
    // carries the same signed observation. It grants no merge, deploy, or
    // decision authority: no Decision row is created.
    const summaries = store.listFindings(arranged.ws).map((row) => row.summary);
    expect(summaries).toContain("Verification attempt 2 completed: success");
    expect(store.listFindings(arranged.ws)).toHaveLength(before + 1);
    const view = service.get_action_proposal(ctx(OWNER), { workspaceId: arranged.ws, proposalId: arranged.proposalId });
    expect(view.signedObservation?.conclusion).toBe("success");
    expect(view.signedObservation?.attempt).toBe(2);
    expect(view.signedObservation?.findingId).toBeDefined();
    expect(store.listDecisions(arranged.ws)).toHaveLength(0);
  });

  it("does not treat cancelled, skipped, or unknown conclusions as success", async () => {
    for (const [conclusion, expected] of [
      ["cancelled", "cancelled"],
      ["skipped", "skipped"],
      ["weird-status", "unknown"],
    ] as const) {
      const arranged = arrangeReserved();
      const source = { ...arranged.source, sourceId: `src_${conclusion}` };
      const body = fixtureCase("completed-matching").body.replace('"conclusion":"failure"', `"conclusion":"${conclusion}"`);
      const result = await ingest(source, { body, delivery: `del-${conclusion}` });
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ ok: true, result: { outcome: "accepted" } });
      const summaries = store.listFindings(arranged.ws).map((row) => row.summary);
      expect(summaries).toContain(`Verification attempt 2 completed: ${expected}`);
      expect(summaries.some((summary) => summary.includes("completed: success"))).toBe(false);
    }
  });

  it("rejects chunked and compressed encoding", () => {
    expect(ingressEncodingAllowed(undefined, "chunked")).toBe(false);
    expect(ingressEncodingAllowed("gzip", undefined)).toBe(false);
    expect(ingressEncodingAllowed(undefined, undefined)).toBe(true);
    expect(ingressEncodingAllowed("identity", "identity")).toBe(true);
  });

  it("rejects source rebinding and unknown sources", async () => {
    const arranged = arrangeReserved();
    const matching = fixtureCase("completed-matching");
    await ingest(arranged.source, { body: matching.body, signature: matching.signature });
    const rebound = { ...arranged.source, workspaceId: "ws_other" };
    const reboundResult = await ingest(rebound, {
      body: matching.body,
      signature: matching.signature,
      delivery: "del-rebind",
    });
    expect(reboundResult.status).toBe(409);

    const unknown = await ingestGithubWorkflowRun(
      store,
      arranged.source,
      {
        sourceId: "src_unknown",
        eventName: "workflow_run",
        deliveryId: "del-unknown",
        signatureHeader: matching.signature,
        rawBody: new TextEncoder().encode(matching.body),
      },
      { clock, idSource },
    );
    expect(unknown.status).toBe(404);
  });

  it("keeps the binding across a session rotation and rejects an actor rebinding", async () => {
    const arranged = arrangeReserved();
    const matching = fixtureCase("completed-matching");
    const first = await ingest(arranged.source, {
      body: matching.body,
      signature: matching.signature,
      delivery: "act001-delivery-0001",
    });
    expect(first.status).toBe(200);

    // Session renewal keeps the same authority: no conflict, fingerprint rotates.
    const rotatedSessionId = service.registerAgentSession(ctx(INTEGRATION), {
      agentId: INTEGRATION.actorId,
      workspaceId: arranged.ws,
      harness: "campfire-integration",
    }).id;
    const rotated = { ...arranged.source, sessionId: rotatedSessionId };
    const rotatedFingerprint = await sourceAuthorityFingerprint(rotated);
    const second = await ingest(rotated, {
      body: matching.body,
      signature: matching.signature,
      delivery: "act001-delivery-0002",
    });
    expect(second).toEqual({ status: 200, body: { ok: true, result: { outcome: "duplicate" } } });
    expect(store.getGithubSourceBinding(arranged.source.sourceId)?.authorityFingerprint).toBe(rotatedFingerprint);

    // Actor rebinding under the same source id conflicts, even with a valid signature.
    const rebound = { ...arranged.source, agentId: "agt_someone_else" };
    const reboundResult = await ingest(rebound, { body: matching.body, delivery: "del-rebind-agent" });
    expect(reboundResult.status).toBe(409);
  });

  it("keeps dedup across secret rotation and a new source id", async () => {
    const arranged = arrangeReserved();
    const matching = fixtureCase("completed-matching");
    await ingest(arranged.source, { body: matching.body, signature: matching.signature, delivery: "act001-delivery-0001" });
    const rotated = { ...arranged.source, secret: "act001-rotated-secret-0002" };
    const oldSig = await ingest(rotated, { body: matching.body, signature: matching.signature, delivery: "del-old-sig" });
    expect(oldSig.status).toBe(401);
    const newSig = await ingest(rotated, { body: matching.body, delivery: "del-rotated" });
    expect(newSig).toEqual({ status: 200, body: { ok: true, result: { outcome: "duplicate" } } });

    const replacement: GithubSourceBinding = { ...arranged.source, sourceId: "src_act001_github_b" };
    const otherSource = await ingest(replacement, { body: matching.body, delivery: "del-new-source" });
    expect(otherSource).toEqual({ status: 200, body: { ok: true, result: { outcome: "duplicate" } } });
    expect(store.listFindings(arranged.ws).filter((row) => row.summary.includes("Verification attempt"))).toHaveLength(1);
  });

  it("returns 503 when the integration session is unavailable", async () => {
    const arranged = arrangeReserved();
    service.endAgentSession(ctx(INTEGRATION), arranged.sessionId);
    const matching = fixtureCase("completed-matching");
    const result = await ingest(arranged.source, { body: matching.body, signature: matching.signature, delivery: "del-ended" });
    expect(result.status).toBe(503);
    expect(store.listFindings(arranged.ws).some((row) => row.summary.includes("Verification attempt"))).toBe(false);
  });

  it("returns 408 when the ingress body stalls past the read deadline", async () => {
    const arranged = arrangeReserved();
    const before = store.listFindings(arranged.ws).length;
    const handle = createWorkerHandler({
      service,
      store,
      sourceEnv: sourceEnv(arranged.ws, arranged.sessionId),
      clock,
      idSource,
      ingressBodyTimeoutMs: 50,
    });
    // A slow-drip body: each chunk resolves inside the deadline, but the
    // stream as a whole outlives it, so the adapter answers 408 instead of
    // waiting on the open connection. No signature is needed: the deadline
    // fires before verification.
    let pulls = 0;
    const slow = new ReadableStream({
      async pull(controller) {
        pulls += 1;
        if (pulls > 4) {
          controller.close();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
        controller.enqueue(new TextEncoder().encode(`{"pad":"${"x".repeat(64)}"}\n`));
      },
    });
    const response = await handle(
      new Request(`https://campfire.test/v1/integrations/github/${arranged.source.sourceId}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "workflow_run",
          "x-github-delivery": "del-slow",
          "x-hub-signature-256": "sha256=0".padEnd(71, "0"),
        },
        body: slow,
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(408);
    expect(await response.json()).toEqual({ ok: false, error: "ValidationError", message: "Request timeout" });
    expect(store.listFindings(arranged.ws)).toHaveLength(before);
  });

  it("returns 503 without touching state when the store is unavailable", async () => {
    const arranged = arrangeReserved();
    const before = store.listFindings(arranged.ws).length;
    // Missing store double: the adapter cannot correlate or persist, so it
    // fails closed before reading the body. No workspace content leaks.
    const handle = createWorkerHandler({
      service,
      sourceEnv: sourceEnv(arranged.ws, arranged.sessionId),
      clock,
      idSource,
    });
    const matching = fixtureCase("completed-matching");
    const response = await handle(
      new Request(`https://campfire.test/v1/integrations/github/${arranged.source.sourceId}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "workflow_run",
          "x-github-delivery": "del-no-store",
          "x-hub-signature-256": matching.signature,
        },
        body: matching.body,
      }),
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(JSON.stringify(body)).not.toContain(arranged.ws);
    expect(store.listFindings(arranged.ws)).toHaveLength(before);
  });

  it("creates exactly one evidence pair for concurrent valid deliveries", async () => {
    const arranged = arrangeReserved();
    const matching = fixtureCase("completed-matching");
    const rawBody = new TextEncoder().encode(matching.body);
    const request = (delivery: string): GithubIngressRequest => ({
      sourceId: arranged.source.sourceId,
      eventName: "workflow_run",
      deliveryId: delivery,
      signatureHeader: matching.signature,
      rawBody,
    });
    const [a, b] = await Promise.all([
      ingestGithubWorkflowRun(store, arranged.source, request("del-c1"), { clock, idSource }),
      ingestGithubWorkflowRun(store, arranged.source, request("del-c2"), { clock, idSource }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 200]);
    const outcomes = [a, b].map((row) => (row.body.ok ? row.body.result.outcome : "err"));
    expect(outcomes.sort()).toEqual(["accepted", "duplicate"]);
    expect(store.listFindings(arranged.ws).filter((row) => row.summary.includes("Verification attempt"))).toHaveLength(1);
    expect(store.listArtifacts(arranged.ws).filter((row) => row.uriOrPath.includes("/actions/runs/11223344"))).toHaveLength(1);
  });
});

describe("HTTP ingress route", () => {
  it("enforces 404/413/415 and never returns workspace content", async () => {
    const arranged = arrangeReserved();
    const handle = createWorkerHandler({
      service,
      store,
      sourceEnv: sourceEnv(arranged.ws, arranged.sessionId),
      clock,
      idSource,
    });
    const matching = fixtureCase("completed-matching");
    const unknown = await handle(
      new Request("https://campfire.test/v1/integrations/github/src_unknown", {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": matching.signature },
        body: matching.body,
      }),
    );
    expect(unknown.status).toBe(404);
    expect(JSON.stringify(await unknown.json())).not.toContain(arranged.ws);

    const oversized = await handle(
      new Request(`https://campfire.test/v1/integrations/github/${arranged.source.sourceId}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "workflow_run",
          "x-github-delivery": "del-big",
          "x-hub-signature-256": matching.signature,
        },
        body: "x".repeat(GITHUB_INGRESS_MAX_BODY_BYTES + 1),
      }),
    );
    expect(oversized.status).toBe(413);

    const chunked = await handle(
      new Request(`https://campfire.test/v1/integrations/github/${arranged.source.sourceId}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "transfer-encoding": "chunked",
          "x-github-event": "workflow_run",
          "x-hub-signature-256": matching.signature,
        },
        body: matching.body,
      }),
    );
    expect(chunked.status).toBe(415);

    const gzip = await handle(
      new Request(`https://campfire.test/v1/integrations/github/${arranged.source.sourceId}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
          "x-github-event": "workflow_run",
          "x-hub-signature-256": matching.signature,
        },
        body: matching.body,
      }),
    );
    expect(gzip.status).toBe(415);

    const disabled = createWorkerHandler({ service, store, sourceEnv: {}, clock, idSource });
    const none = await disabled(
      new Request(`https://campfire.test/v1/integrations/github/${arranged.source.sourceId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: matching.body,
      }),
    );
    expect(none.status).toBe(404);
  });

  it("a disabled source is 404 and enabling it grants no other workspace an action", async () => {
    const arranged = arrangeReserved();
    // A second workspace with its own evidence but no proposals: enabling
    // the ws1-bound source must never authorize anything here.
    const other = service.createWorkspace(ctx(OWNER), { teamId: "team_1", name: "other" }).id;
    const otherTask = service.createTask(ctx(OWNER), { workspaceId: other, title: "other work" }).id;
    void otherTask;
    const otherFinding = service.addFinding(ctx(OWNER), { workspaceId: other, summary: "other note" }).id;
    void otherFinding;
    const matching = fixtureCase("completed-matching");

    const disabled = createWorkerHandler({ service, store, sourceEnv: {}, clock, idSource });
    const none = await disabled(
      new Request(`https://campfire.test/v1/integrations/github/${arranged.source.sourceId}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "workflow_run",
          "x-github-delivery": "del-disabled",
          "x-hub-signature-256": matching.signature,
        },
        body: matching.body,
      }),
    );
    expect(none.status).toBe(404);
    expect(store.listFindings(arranged.ws).filter((row) => row.summary.includes("Verification attempt"))).toHaveLength(0);
    expect(store.listFindings(other).map((row) => row.id)).toEqual([otherFinding]);

    const enabled = createWorkerHandler({
      service,
      store,
      sourceEnv: sourceEnv(arranged.ws, arranged.sessionId),
      clock,
      idSource,
    });
    const accepted = await enabled(
      new Request(`https://campfire.test/v1/integrations/github/${arranged.source.sourceId}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "workflow_run",
          "x-github-delivery": "act001-delivery-0001",
          "x-hub-signature-256": matching.signature,
        },
        body: matching.body,
      }),
    );
    expect(accepted.status).toBe(200);
    // The observation lands only in the bound workspace; the other workspace
    // gains no finding, no proposal, and no receipt surface.
    expect(store.listFindings(arranged.ws).filter((row) => row.summary.includes("Verification attempt"))).toHaveLength(1);
    expect(store.listFindings(other).map((row) => row.id)).toEqual([otherFinding]);
    expect(store.countActionProposals(other)).toBe(0);
  });
});

describe("D1 ingress parity", () => {
  it("accepts one pair and ignores a concurrent duplicate", async () => {
    const adapter = sqliteD1();
    await migrateD1(adapter.binding);
    const remote = createD1Store(adapter.binding);
    const remoteIds = createCounterIdSource();
    const remoteClock = () => NOW;
    const remoteService = createAsyncCampfireService({ store: remote, idSource: remoteIds, clock: remoteClock });
    await remote.createOrganization({ id: "org_1", name: "o", createdAt: NOW });
    await remote.createTeam({ id: "team_1", organizationId: "org_1", name: "t", createdAt: NOW });
    await remote.createHuman({ id: "hum_owner", teamId: "team_1", displayName: "Owner", createdAt: NOW });
    await remote.createHuman({ id: "hum_exec", teamId: "team_1", displayName: "Exec", createdAt: NOW });
    await remote.createAgent({
      id: "agt_act001_integration",
      teamId: "team_1",
      humanId: "hum_owner",
      name: "integration",
      harness: "campfire-integration",
      createdAt: NOW,
    });
    const ws = (await remoteService.createWorkspace(ctx(OWNER), { teamId: "team_1", name: "lab" })).id;
    await remoteService.inviteToWorkspace(ctx(OWNER), { workspaceId: ws, actor: EXEC, role: "member" });
    await remoteService.joinWorkspace(ctx(EXEC), { workspaceId: ws });
    await remoteService.inviteToWorkspace(ctx(OWNER), { workspaceId: ws, actor: INTEGRATION, role: "member" });
    await remoteService.joinWorkspace(ctx(INTEGRATION), { workspaceId: ws });
    const sessionId = (await remoteService.registerAgentSession(ctx(INTEGRATION), {
      agentId: INTEGRATION.actorId,
      workspaceId: ws,
      harness: "campfire-integration",
    })).id;
    const task = (await remoteService.createTask(ctx(OWNER), { workspaceId: ws, title: "verify" })).id;
    const finding = (await remoteService.addFinding(ctx(OWNER), { workspaceId: ws, summary: "jobs failed" })).id;
    const proposed = await remoteService.propose_action(ctx(OWNER), {
      workspaceId: ws,
      target: { ...TARGET },
      executor: { ...EXEC },
      reason: "retry the failed verification",
      taskId: task,
      findingIds: [finding],
      requestKey: "k1",
    });
    const approved = await remoteService.review_action(ctx(OWNER), {
      workspaceId: ws,
      proposalId: proposed.proposal.id,
      revision: proposed.proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      decision: "approve",
      requestKey: "k2",
    });
    await remoteService.reserve_action_execution(ctx(EXEC), {
      workspaceId: ws,
      proposalId: approved.proposal.id,
      revision: approved.proposal.revision,
      intentDigest: approved.proposal.intentDigest,
      requestKey: "k3",
    });
    const source = requireSource(sourceEnv(ws, sessionId));
    const matching = fixtureCase("completed-matching");
    const rawBody = new TextEncoder().encode(matching.body);
    const make = (delivery: string): GithubIngressRequest => ({
      sourceId: source.sourceId,
      eventName: "workflow_run",
      deliveryId: delivery,
      signatureHeader: matching.signature,
      rawBody,
    });
    const [a, b] = await Promise.all([
      ingestGithubWorkflowRunAsync(remote, source, make("d1"), { clock: remoteClock, idSource: remoteIds }),
      ingestGithubWorkflowRunAsync(remote, source, make("d2"), { clock: remoteClock, idSource: remoteIds }),
    ]);
    const findings = await remote.listFindings(ws);
    expect(findings.filter((row) => row.summary.includes("Verification attempt 2 completed: failure"))).toHaveLength(1);
    expect([a.status, b.status].sort()).toEqual([200, 200]);
    adapter.database.close();
  });
});
