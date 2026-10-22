/**
 * ACT-001 D4 D1/async parity: reservation races, requestKey replay, and
 * concurrent signed ingress. Overlapping D1 batches, not sequential awaits.
 *
 * Synthetic fixtures only. No live GitHub.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sqliteD1 } from "../helpers/sqlite-d1.js";
import { createD1Store, migrateD1, type AsyncCampfireStore } from "../../src/worker/d1-store.js";
import { createAsyncCampfireService, type AsyncCampfireService } from "../../src/worker/async-service.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { actionTargetKey } from "../../src/domain/action-proposal.js";
import { Conflict } from "../../src/domain/errors.js";
import type { ActorContext } from "../../src/service/authorization.js";
import type { ActorRef } from "../../src/domain/types.js";
import { ingestGithubWorkflowRunAsync, type GithubIngressRequest } from "../../src/service/github-ingress.js";
import { readGithubSourceConfig, type GithubSourceBinding } from "../../src/integrations/github-source-config.js";

const SIGNED = JSON.parse(
  readFileSync(new URL("../../fixtures/act-001/step-0/proposal/signed-payloads.json", import.meta.url), "utf8"),
) as { testOnlySecret: string; cases: Array<{ id: string; body: string; signature: string }> };

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

function ctx(actor: ActorRef, agentSessionId?: string): ActorContext {
  return agentSessionId === undefined ? { actor } : { actor, agentSessionId };
}

function fixtureCase(id: string) {
  const found = SIGNED.cases.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`missing fixture ${id}`);
  return found;
}

const adapters: Array<ReturnType<typeof sqliteD1>> = [];

afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.database.close();
});

async function openPair() {
  const adapter = sqliteD1();
  adapters.push(adapter);
  await migrateD1(adapter.binding);
  const ids = createCounterIdSource();
  const clock = () => NOW;
  const storeA = createD1Store(adapter.binding);
  const storeB = createD1Store(adapter.binding);
  const serviceA = createAsyncCampfireService({ store: storeA, idSource: ids, clock });
  const serviceB = createAsyncCampfireService({ store: storeB, idSource: ids, clock });
  return { adapter, storeA, storeB, serviceA, serviceB, ids, clock };
}

function overlapFrom(adapter: ReturnType<typeof sqliteD1>, start: () => Promise<unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    adapter.beforeBatch = () => {
      adapter.beforeBatch = undefined;
      void start().then(resolve, reject);
    };
  });
}

async function seedIdentities(store: AsyncCampfireStore, service: AsyncCampfireService) {
  await store.createOrganization({ id: "org_1", name: "o", createdAt: NOW });
  await store.createTeam({ id: "team_1", organizationId: "org_1", name: "t", createdAt: NOW });
  await store.createHuman({ id: "hum_owner", teamId: "team_1", displayName: "Owner", createdAt: NOW });
  await store.createHuman({ id: "hum_exec", teamId: "team_1", displayName: "Exec", createdAt: NOW });
  await store.createAgent({
    id: INTEGRATION.actorId,
    teamId: "team_1",
    humanId: "hum_owner",
    name: "integration",
    harness: "campfire-integration",
    createdAt: NOW,
  });
  const ws = (await service.createWorkspace(ctx(OWNER), { teamId: "team_1", name: "lab" })).id;
  await service.inviteToWorkspace(ctx(OWNER), { workspaceId: ws, actor: EXEC, role: "member" });
  await service.joinWorkspace(ctx(EXEC), { workspaceId: ws });
  await service.inviteToWorkspace(ctx(OWNER), { workspaceId: ws, actor: INTEGRATION, role: "member" });
  await service.joinWorkspace(ctx(INTEGRATION), { workspaceId: ws });
  const sessionId = (await service.registerAgentSession(ctx(INTEGRATION), {
    agentId: INTEGRATION.actorId,
    workspaceId: ws,
    harness: "campfire-integration",
  })).id;
  const task = (await service.createTask(ctx(OWNER), { workspaceId: ws, title: "verify" })).id;
  const finding = (await service.addFinding(ctx(OWNER), { workspaceId: ws, summary: "jobs failed" })).id;
  return { ws, sessionId, task, finding };
}

function sourceEnv(workspaceId: string, sessionId: string): Record<string, string> {
  return {
    CAMPFIRE_GITHUB_SOURCE_ID: "src_act001_github",
    CAMPFIRE_GITHUB_SOURCE_WORKSPACE_ID: workspaceId,
    CAMPFIRE_GITHUB_SOURCE_REPOSITORY_ID: TARGET.repositoryId,
    CAMPFIRE_GITHUB_SOURCE_REPOSITORY_NAME: TARGET.repositoryName,
    CAMPFIRE_GITHUB_SOURCE_WORKFLOW_ID: TARGET.workflowId,
    CAMPFIRE_GITHUB_SOURCE_KIND: "ci.retry_verification",
    CAMPFIRE_GITHUB_SOURCE_SECRET: SIGNED.testOnlySecret,
    CAMPFIRE_GITHUB_SOURCE_AGENT_ID: INTEGRATION.actorId,
    CAMPFIRE_GITHUB_SOURCE_SESSION_ID: sessionId,
  };
}

function requireSource(env: Record<string, string>): GithubSourceBinding {
  const config = readGithubSourceConfig(env);
  if (!config.configured) throw new Error(config.problem ?? "source not configured");
  return config.source;
}

describe("ACT-001 D1 action constraint mapping", () => {
  function recoveryCodeOf(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null) return undefined;
    const details = (error as { details?: { recoveryCode?: string } }).details;
    return details?.recoveryCode;
  }

  async function reservedProposal(service: AsyncCampfireService, ws: string, task: string, finding: string, key: string) {
    const proposed = await service.propose_action(ctx(OWNER), {
      workspaceId: ws,
      target: { ...TARGET },
      executor: { ...EXEC },
      reason: "retry the failed verification",
      taskId: task,
      findingIds: [finding],
      requestKey: `${key}-p`,
    });
    const approved = await service.review_action(ctx(OWNER), {
      workspaceId: ws,
      proposalId: proposed.proposal.id,
      revision: proposed.proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      decision: "approve",
      requestKey: `${key}-a`,
    });
    return service.reserve_action_execution(ctx(EXEC), {
      workspaceId: ws,
      proposalId: approved.proposal.id,
      revision: approved.proposal.revision,
      intentDigest: approved.proposal.intentDigest,
      requestKey: `${key}-r`,
    });
  }

  it("maps a raced target reservation to target_already_reserved", async () => {
    const { storeA, serviceA } = await openPair();
    const { ws, task, finding } = await seedIdentities(storeA, serviceA);
    const first = await reservedProposal(serviceA, ws, task, finding, "map-first");
    const secondProposed = await serviceA.propose_action(ctx(OWNER), {
      workspaceId: ws,
      target: { ...TARGET, runId: "99999999", expectedAttempt: 9 },
      executor: { ...EXEC },
      reason: "retry the failed verification",
      taskId: task,
      findingIds: [finding],
      requestKey: "map-second-p",
    });
    const targetKey = actionTargetKey(TARGET);
    try {
      await storeA.transaction(async () => {
        await storeA.createActionTargetReservation({
          workspaceId: ws,
          targetKey,
          proposalId: secondProposed.proposal.id,
          reservationId: "resv_clash",
          reservedAt: NOW,
        });
        await storeA.createActionTargetReservation({
          workspaceId: ws,
          targetKey,
          proposalId: secondProposed.proposal.id,
          reservationId: "resv_clash_again",
          reservedAt: NOW,
        });
      });
      expect.unreachable("a duplicate target reservation must conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(Conflict);
      expect(recoveryCodeOf(error)).toBe("target_already_reserved");
    }
    expect(first.proposal.status).toBe("dispatch_reserved");
  });

  it("maps a raced mutation receipt to request_key_conflict", async () => {
    const { storeA, serviceA } = await openPair();
    const { ws } = await seedIdentities(storeA, serviceA);
    try {
      await storeA.transaction(async () => {
        await storeA.putActionMutationReceipt({
          workspaceId: ws,
          actorId: OWNER.actorId,
          actorType: OWNER.actorType,
          method: "propose_action",
          requestKey: "map-mutation",
          inputDigest: "digest-one",
          resultJson: "{}",
          createdAt: NOW,
        });
        await storeA.putActionMutationReceipt({
          workspaceId: ws,
          actorId: OWNER.actorId,
          actorType: OWNER.actorType,
          method: "propose_action",
          requestKey: "map-mutation",
          inputDigest: "digest-two",
          resultJson: "{}",
          createdAt: NOW,
        });
      });
      expect.unreachable("a duplicate mutation receipt must conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(Conflict);
      expect(recoveryCodeOf(error)).toBe("request_key_conflict");
    }
  });

  it("scopes submission receipt keys by recorder and maps clashes to receipt_already_recorded", async () => {
    const { storeA, serviceA } = await openPair();
    const { ws, task, finding } = await seedIdentities(storeA, serviceA);
    const reserved = await reservedProposal(serviceA, ws, task, finding, "map-receipt");
    const reservationId = reserved.proposal.reservation?.reservationId;
    if (reservationId === undefined) throw new Error("reservation missing");
    const base = {
      workspaceId: ws,
      proposalId: reserved.proposal.id,
      reservationId,
      intentDigest: reserved.proposal.intentDigest,
      outcome: "accepted" as const,
      providerRef: { repositoryId: TARGET.repositoryId, workflowId: TARGET.workflowId, runId: TARGET.runId },
      recordedAt: NOW,
      requestKey: "rk-scoped",
    };
    await storeA.createActionReceipt({ ...base, id: "arcp_exec_1", recordedBy: { ...EXEC } });
    // A different recorder may reuse the key without colliding.
    await storeA.createActionReceipt({ ...base, id: "arcp_integration_1", recordedBy: { ...INTEGRATION } });
    expect((await storeA.getActionReceiptByRequestKey(reserved.proposal.id, INTEGRATION, "rk-scoped"))?.id).toBe(
      "arcp_integration_1",
    );
    expect((await storeA.getActionReceiptByRequestKey(reserved.proposal.id, EXEC, "rk-scoped"))?.id).toBe(
      "arcp_exec_1",
    );
    // The same recorder reusing the key conflicts with the SQLite recovery code.
    try {
      await storeA.transaction(async () => {
        await storeA.createActionReceipt({ ...base, id: "arcp_exec_2", recordedBy: { ...EXEC } });
        await storeA.createActionReceipt({ ...base, id: "arcp_exec_3", recordedBy: { ...EXEC } });
      });
      expect.unreachable("a duplicate submission receipt must conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(Conflict);
      expect(recoveryCodeOf(error)).toBe("receipt_already_recorded");
    }
  });
});

describe("ACT-001 D1 reservation and receipt races", () => {
  it("concurrent cancel and reserve on one approval leave at most one dispatch slot", async () => {
    const { adapter, storeA, serviceA, serviceB } = await openPair();
    const { ws, task, finding } = await seedIdentities(storeA, serviceA);
    const proposed = await serviceA.propose_action(ctx(OWNER), {
      workspaceId: ws,
      target: { ...TARGET },
      executor: { ...EXEC },
      reason: "retry the failed verification",
      taskId: task,
      findingIds: [finding],
      requestKey: "p1",
    });
    const approved = await serviceA.review_action(ctx(OWNER), {
      workspaceId: ws,
      proposalId: proposed.proposal.id,
      revision: proposed.proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      decision: "approve",
      requestKey: "a1",
    });

    const overlap = overlapFrom(adapter, () =>
      serviceB.cancel_action(ctx(OWNER), {
        workspaceId: ws,
        proposalId: approved.proposal.id,
        revision: approved.proposal.revision,
        intentDigest: approved.proposal.intentDigest,
        reason: "stop before dispatch",
        requestKey: "c-race",
      }),
    );
    const reserved = serviceA.reserve_action_execution(ctx(EXEC), {
      workspaceId: ws,
      proposalId: approved.proposal.id,
      revision: approved.proposal.revision,
      intentDigest: approved.proposal.intentDigest,
      requestKey: "r-race",
    });
    const settled = await Promise.allSettled([reserved, overlap]);
    const target = await storeA.getActionTargetReservation(ws, actionTargetKey(TARGET));
    const view = await serviceA.get_action_proposal(ctx(OWNER), { workspaceId: ws, proposalId: proposed.proposal.id });
    const reservedCount = target === undefined ? 0 : 1;
    expect(reservedCount).toBeLessThanOrEqual(1);
    if (view.proposal.status === "dispatch_reserved") {
      expect(target?.proposalId).toBe(proposed.proposal.id);
    } else {
      expect(view.proposal.status).toBe("cancelled");
      expect(target).toBeUndefined();
    }
    expect(settled.length).toBe(2);
  });

  it("two separately approved proposals for the same target yield one reservation", async () => {
    const { adapter, storeA, serviceA, serviceB } = await openPair();
    const { ws, task, finding } = await seedIdentities(storeA, serviceA);
    const first = await serviceA.propose_action(ctx(OWNER), {
      workspaceId: ws,
      target: { ...TARGET },
      executor: { ...EXEC },
      reason: "retry the failed verification",
      taskId: task,
      findingIds: [finding],
      requestKey: "p-first",
    });
    const second = await serviceA.propose_action(ctx(OWNER), {
      workspaceId: ws,
      target: { ...TARGET },
      executor: { ...EXEC },
      reason: "retry the failed verification again",
      taskId: task,
      findingIds: [finding],
      requestKey: "p-second",
    });
    const firstApproved = await serviceA.review_action(ctx(OWNER), {
      workspaceId: ws,
      proposalId: first.proposal.id,
      revision: first.proposal.revision,
      intentDigest: first.proposal.intentDigest,
      decision: "approve",
      requestKey: "a-first",
    });
    const secondApproved = await serviceA.review_action(ctx(OWNER), {
      workspaceId: ws,
      proposalId: second.proposal.id,
      revision: second.proposal.revision,
      intentDigest: second.proposal.intentDigest,
      decision: "approve",
      requestKey: "a-second",
    });

    const overlap = overlapFrom(adapter, () =>
      serviceB.reserve_action_execution(ctx(EXEC), {
        workspaceId: ws,
        proposalId: secondApproved.proposal.id,
        revision: secondApproved.proposal.revision,
        intentDigest: secondApproved.proposal.intentDigest,
        requestKey: "r-second",
      }),
    );
    const firstReserve = serviceA.reserve_action_execution(ctx(EXEC), {
      workspaceId: ws,
      proposalId: firstApproved.proposal.id,
      revision: firstApproved.proposal.revision,
      intentDigest: firstApproved.proposal.intentDigest,
      requestKey: "r-first",
    });
    const [a, b] = await Promise.allSettled([firstReserve, overlap]);
    const winners = [a, b].filter((row) => row.status === "fulfilled");
    expect(winners.length).toBe(1);
    const target = await storeA.getActionTargetReservation(ws, actionTargetKey(TARGET));
    expect(target).toBeDefined();
    const otherId = target?.proposalId === first.proposal.id ? second.proposal.id : first.proposal.id;
    const other = await serviceA.get_action_proposal(ctx(OWNER), { workspaceId: ws, proposalId: otherId });
    expect(other.proposal.status).toBe("approved");
  });

  it("duplicate mutation requestKey replays on overlapping D1 writers", async () => {
    const { adapter, storeA, serviceA, serviceB } = await openPair();
    const { ws, task, finding } = await seedIdentities(storeA, serviceA);
    const input = {
      workspaceId: ws,
      target: { ...TARGET },
      executor: { ...EXEC },
      reason: "retry the failed verification",
      taskId: task,
      findingIds: [finding],
      requestKey: "idem-propose",
    };
    const overlap = overlapFrom(adapter, () => serviceB.propose_action(ctx(OWNER), input));
    const first = serviceA.propose_action(ctx(OWNER), input);
    const [a, b] = await Promise.all([first, overlap]);
    expect(a.proposal.id).toBe((b as typeof a).proposal.id);
    expect(await storeA.countActionProposals(ws)).toBe(1);

    await expect(serviceA.propose_action(ctx(OWNER), { ...input, reason: "different reason" })).rejects.toBeInstanceOf(
      Conflict,
    );
  });

  it("concurrent valid ingress deliveries create exactly one Finding+Artifact pair", async () => {
    const { adapter, storeA, storeB, serviceA, ids, clock } = await openPair();
    const { ws, sessionId, task, finding } = await seedIdentities(storeA, serviceA);
    const proposed = await serviceA.propose_action(ctx(OWNER), {
      workspaceId: ws,
      target: { ...TARGET },
      executor: { ...EXEC },
      reason: "retry the failed verification",
      taskId: task,
      findingIds: [finding],
      requestKey: "p-ing",
    });
    const approved = await serviceA.review_action(ctx(OWNER), {
      workspaceId: ws,
      proposalId: proposed.proposal.id,
      revision: proposed.proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      decision: "approve",
      requestKey: "a-ing",
    });
    await serviceA.reserve_action_execution(ctx(EXEC), {
      workspaceId: ws,
      proposalId: approved.proposal.id,
      revision: approved.proposal.revision,
      intentDigest: approved.proposal.intentDigest,
      requestKey: "r-ing",
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
    const overlap = overlapFrom(adapter, () =>
      ingestGithubWorkflowRunAsync(storeB, source, make("d1-b"), { clock, idSource: ids }),
    );
    const first = ingestGithubWorkflowRunAsync(storeA, source, make("d1-a"), { clock, idSource: ids });
    const [a, b] = await Promise.all([first, overlap]);
    const findings = await storeA.listFindings(ws);
    const artifacts = await storeA.listArtifacts(ws);
    expect(findings.filter((row) => row.summary.includes("Verification attempt 2 completed: failure"))).toHaveLength(1);
    expect(artifacts.filter((row) => row.uriOrPath.includes("/actions/runs/11223344"))).toHaveLength(1);
    expect([a.status, (b as typeof a).status].sort()).toEqual([200, 200]);
  });
});
