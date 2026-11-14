import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { publicationDigest } from "../../src/publication/digest.js";
import { hashToken } from "../../src/service/tokens.js";
import { readWorkspaceSnapshot } from "../../src/publication/snapshot.js";
import { createD1Store, migrateD1 } from "../../src/worker/d1-store.js";
import { createD1WorkerHandler } from "../../src/worker/handler.js";
import { prunePublicationAdmissionAttempts } from "../../src/worker/publication.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";
import { SHR, seedShrLocalWorkspace } from "../helpers/shr-001.js";

const NOW = "2026-10-23T13:00:00.000Z";
const REHEARSAL_CODE = `cfrh_${"9".repeat(48)}`;
const ownerToken = `cft_${"1".repeat(32)}`;
const agentToken = `cft_${"2".repeat(32)}`;
const otherOwnerToken = `cft_${"3".repeat(32)}`;
const recovery = `cfr_${"4".repeat(32)}`;
const roots: string[] = [];
const closes: Array<() => void> = [];

afterEach(() => {
  for (const close of closes.splice(0)) close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function localSnapshot() {
  const root = mkdtempSync(join(tmpdir(), "shr-worker-"));
  roots.push(root);
  const db = join(root, "campfire.db");
  seedShrLocalWorkspace(db);
  return readWorkspaceSnapshot({
    databasePath: db,
    workspaceId: SHR.workspaceId,
    ownerHumanId: SHR.humanId,
    packageVersion: "1.26.2-test",
    exportedAt: NOW,
  });
}

async function setup(
  publicationOverrides: Record<string, unknown> | undefined = undefined,
  headerCode: string | null = REHEARSAL_CODE,
) {
  const adapter = sqliteD1();
  closes.push(() => adapter.database.close());
  await migrateD1(adapter.binding);
  const store = createD1Store(adapter.binding);
  const ids = createCounterIdSource();
  const handle = createD1WorkerHandler({
    store,
    clock: () => NOW,
    idSource: ids,
    publication: {
      db: adapter.binding,
      enabled: true,
      clock: () => NOW,
      idSource: ids,
      rehearsalCodeHash: hashToken(REHEARSAL_CODE),
      ...publicationOverrides,
    },
  });
  const call = async (path: string, token: string | undefined, body?: unknown, method = "POST") => {
    const response = await handle(new Request(`https://host.test${path}`, {
      method,
      headers: {
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.10",
        ...(headerCode === null ? {} : { "x-campfire-rehearsal-code": headerCode }),
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
    }));
    return { status: response.status, body: await response.json() as any };
  };
  const actorCall = (token: string, method: string, params: Record<string, unknown> = {}, prefix = "") =>
    call(`${prefix}/v1/call`, token, { method, params });
  return { adapter, store, handle, call, actorCall };
}

function enrollmentBody(id = "pub-request-1", humanId: string = SHR.humanId, token = ownerToken) {
  return {
    requestId: id,
    humanId,
    humanName: SHR.humanName,
    humanTokenHash: hashToken(token),
    recoveryHash: hashToken(recovery),
    agents: [{ id: SHR.agentId, name: SHR.agentName, harness: "codex", tokenHash: hashToken(agentToken) }],
    workspaceName: SHR.workspaceName,
    sourceWorkspaceId: SHR.workspaceId,
    sourcePackageVersion: "1.26.2-test",
    sourceSchemaVersion: 10,
    deviceKeyHash: hashToken("device-one"),
  };
}

describe("SHR-001 hosted publication boundary", () => {
  it("fails closed unless the rehearsal admission code matches", async () => {
    const missingCode = await setup(undefined, null);
    expect((await missingCode.call("/v1/publication/enroll", undefined, enrollmentBody())).status).toBe(403);

    const wrongCode = await setup(undefined, `cfrh_${"0".repeat(48)}`);
    expect((await wrongCode.call("/v1/publication/enroll", undefined, enrollmentBody())).status).toBe(403);

    const unconfigured = await setup({ rehearsalCodeHash: undefined });
    expect((await unconfigured.call("/v1/publication/enroll", undefined, enrollmentBody())).status).toBe(403);

    const disabled = await setup({ enabled: false });
    expect((await disabled.call("/v1/publication/enroll", undefined, enrollmentBody())).status).toBe(403);

    const allowed = await setup();
    expect((await allowed.call("/v1/publication/enroll", undefined, enrollmentBody())).status).toBe(200);

    const limited = await setup({ maxAdmissionAttemptsPerHour: 2 }, `cfrh_${"0".repeat(48)}`);
    expect((await limited.call("/v1/publication/enroll", undefined, enrollmentBody())).status).toBe(403);
    expect((await limited.call("/v1/publication/enroll", undefined, enrollmentBody())).status).toBe(403);
    expect((await limited.call("/v1/publication/enroll", undefined, enrollmentBody())).status).toBe(429);
  });

  it("recovers the owner credential only with the recovery secret and admission code", async () => {
    const { call, actorCall } = await setup();
    const snapshot = localSnapshot();
    expect((await call("/v1/publication/enroll", undefined, enrollmentBody())).status).toBe(200);
    expect((await call("/v1/publication/import", ownerToken, { requestId: "pub-request-1", digest: snapshot.digest, snapshot })).status).toBe(200);

    const wrong = await call("/v1/publication/recover", undefined, {
      requestId: "pub-request-1", humanId: SHR.humanId, recoverySecret: `cfr_${"0".repeat(32)}`, humanTokenHash: hashToken("replacement"), newRecoveryHash: hashToken(`cfr_${"5".repeat(32)}`),
    });
    expect(wrong.status).toBe(403);

    const replacement = `cft_${"4".repeat(32)}`;
    const nextRecovery = `cfr_${"5".repeat(32)}`;
    const recovered = await call("/v1/publication/recover", undefined, {
      requestId: "pub-request-1", humanId: SHR.humanId, recoverySecret: recovery, humanTokenHash: hashToken(replacement), newRecoveryHash: hashToken(nextRecovery),
    });
    expect(recovered.status).toBe(200);
    expect((await call("/v1/publication/recover", undefined, {
      requestId: "pub-request-1", humanId: SHR.humanId, recoverySecret: recovery,
      humanTokenHash: hashToken(`cft_${"6".repeat(32)}`), newRecoveryHash: hashToken(`cfr_${"6".repeat(32)}`),
    })).status).toBe(403);
    expect((await call("/v1/publication/recover", undefined, {
      requestId: "pub-request-1", humanId: SHR.humanId, recoverySecret: nextRecovery,
      humanTokenHash: hashToken(`cft_${"7".repeat(32)}`), newRecoveryHash: hashToken(`cfr_${"7".repeat(32)}`),
    })).status).toBe(200);
    expect((await actorCall(ownerToken, "whoami")).status).toBe(401);
    expect((await actorCall(replacement, "whoami")).status).toBe(401);
    const secondReplacement = `cft_${"7".repeat(32)}`;
    expect((await actorCall(secondReplacement, "whoami")).body.result.actor.actorId).toBe(SHR.humanId);
    expect((await actorCall(secondReplacement, "get_workspace", { workspaceId: SHR.workspaceId })).status).toBe(200);
    // Agent credentials are not rotated by human recovery.
    expect((await actorCall(agentToken, "whoami")).body.result.actor.actorId).toBe(SHR.agentId);
  });

  it("bounds recovery attempts independently of publication admission", async () => {
    const { call } = await setup();
    expect((await call("/v1/publication/enroll", undefined, enrollmentBody())).status).toBe(200);
    const body = {
      requestId: "pub-request-1", humanId: SHR.humanId, recoverySecret: `cfr_${"0".repeat(32)}`,
      humanTokenHash: hashToken(`cft_${"8".repeat(32)}`), newRecoveryHash: hashToken(`cfr_${"8".repeat(32)}`),
    };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await call("/v1/publication/recover", undefined, body)).status).toBe(403);
    }
    expect((await call("/v1/publication/recover", undefined, body)).status).toBe(429);
  });

  it("prunes admission and recovery source counters after seven days", async () => {
    const { adapter, call } = await setup(undefined, `cfrh_${"0".repeat(48)}`);
    expect((await call("/v1/publication/enroll", undefined, enrollmentBody())).status).toBe(403);
    await adapter.binding.prepare(
      "INSERT INTO publication_admission_attempts (source_hash, window_start, attempts, updated_at) VALUES (?, ?, 1, ?)",
    ).bind("old-source", "2026-10-15T00:00:00.000Z", "2026-10-15T00:00:00.000Z").run();
    await prunePublicationAdmissionAttempts(adapter.binding, NOW);
    const rows = await adapter.binding.prepare("SELECT source_hash FROM publication_admission_attempts ORDER BY source_hash").all<{ source_hash: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]?.source_hash).not.toBe("old-source");
  });

  it("fences simultaneous recovery requests using the same old secret", async () => {
    const { call, actorCall } = await setup();
    expect((await call("/v1/publication/enroll", undefined, enrollmentBody())).status).toBe(200);
    const tokens = [`cft_${"9".repeat(32)}`, `cft_${"a".repeat(32)}`];
    const requests = tokens.map((token, index) => call("/v1/publication/recover", undefined, {
      requestId: "pub-request-1", humanId: SHR.humanId, recoverySecret: recovery,
      humanTokenHash: hashToken(token), newRecoveryHash: hashToken(`cfr_${String(index + 6).repeat(32)}`),
    }));
    const results = await Promise.all(requests);
    expect(results.map((result) => result.status).sort()).toEqual([200, 403]);
    const winner = results.findIndex((result) => result.status === 200);
    expect((await actorCall(tokens[winner]!, "whoami")).status).toBe(200);
    expect((await actorCall(tokens[1 - winner]!, "whoami")).status).toBe(401);
  });

  it("enrolls a fresh owner, imports one complete graph, and keeps tenants isolated", async () => {
    const { store, call, actorCall } = await setup();
    const snapshot = localSnapshot();
    const enroll = await call("/v1/publication/enroll", undefined, enrollmentBody());
    expect(enroll.status).toBe(200);
    expect(enroll.body.result.kind).toBe("workspace_publication_enrollment");
    expect(enroll.body.result.human.id).toBe(SHR.humanId);

    const before = await actorCall(ownerToken, "list_workspaces");
    expect(before.body.result).toEqual([]);

    const imported = await call("/v1/publication/import", ownerToken, { requestId: "pub-request-1", digest: snapshot.digest, snapshot });
    expect(imported.status).toBe(200);
    expect(imported.body.result.workspace.id).toBe(SHR.workspaceId);
    expect(imported.body.result.sourceTip).toBe(10);

    const workspace = await actorCall(ownerToken, "get_workspace", { workspaceId: SHR.workspaceId });
    expect(workspace.status).toBe(200);
    expect(workspace.body.result.workspace.id).toBe(SHR.workspaceId);
    expect(workspace.body.result.findings.map((finding: any) => finding.id)).toEqual([SHR.findingId]);
    expect(workspace.body.result.findings[0].currentness).toBe("current");
    expect(workspace.body.result.decisions[0].citations[0].findingId).toBe(SHR.findingId);
    expect(workspace.body.result.activity.map((row: any) => row.appendPosition)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(workspace.body.result.workspace.teamId).toBe(imported.body.result.workspace.teamId);

    // Enrollment placeholders are replaced by the local provenance fields.
    const hostedHuman = await store.getHuman(SHR.humanId);
    expect(hostedHuman?.displayName).toBe(SHR.humanName);
    expect(hostedHuman?.createdAt).toBe("2026-10-23T12:00:02.000Z");
    const hostedAgent = await store.getAgent(SHR.agentId);
    expect(hostedAgent?.name).toBe(SHR.agentName);
    expect(hostedAgent?.model).toBe("gpt-5");
    expect(hostedAgent?.createdAt).toBe("2026-10-23T12:00:03.000Z");

    const agentWho = await actorCall(agentToken, "whoami");
    expect(agentWho.body.result.actor).toEqual({ actorId: SHR.agentId, actorType: "agent" });
    const agentRead = await actorCall(agentToken, "get_workspace", { workspaceId: SHR.workspaceId });
    expect(agentRead.status).toBe(200);
    expect(agentRead.body.result.findings.map((finding: any) => finding.id)).toEqual([SHR.findingId]);

    // A second owner cannot read, overwrite, or invite into this workspace.
    const otherEnroll = await call("/v1/publication/enroll", undefined, {
      ...enrollmentBody("pub-request-2", "hum_other", otherOwnerToken),
      agents: [],
      deviceKeyHash: hashToken("device-two"),
    });
    expect(otherEnroll.status).toBe(200);
    expect((await actorCall(otherOwnerToken, "get_workspace", { workspaceId: SHR.workspaceId })).status).toBe(403);
    expect((await actorCall(otherOwnerToken, "issue_enrollment_invitation", { workspaceId: SHR.workspaceId })).status).toBe(403);

    // Exact retry is inert; the same request with changed content conflicts.
    const replay = await call("/v1/publication/import", ownerToken, { requestId: "pub-request-1", digest: snapshot.digest, snapshot });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(imported.body);
    const changed = structuredClone(snapshot);
    changed.findings[0]!.summary = "changed after commit";
    changed.digest = publicationDigest(changed);
    const changedResult = await call("/v1/publication/import", ownerToken, { requestId: "pub-request-1", digest: changed.digest, snapshot: changed });
    expect(changedResult.status).toBe(409);

    const tampered = structuredClone(snapshot);
    tampered.findings[0]!.summary = "tampered without digest";
    const tamperedResult = await call("/v1/publication/import", ownerToken, { requestId: "pub-request-1", digest: snapshot.digest, snapshot: tampered });
    expect(tamperedResult.status).toBe(400);

    // The import is bound to the workspace id recorded at enrollment.
    const otherWorkspace = structuredClone(snapshot);
    otherWorkspace.workspaceId = "ws_other";
    otherWorkspace.workspace.id = "ws_other";
    otherWorkspace.digest = publicationDigest(otherWorkspace);
    const otherResult = await call("/v1/publication/import", ownerToken, {
      requestId: "pub-request-1", digest: otherWorkspace.digest, snapshot: otherWorkspace,
    });
    expect(otherResult.status).toBe(400);
    expect(otherResult.body.message).toContain("enrolled source workspace");
  });

  it("does not expose a partial workspace when one row conflicts", async () => {
    const { call, store } = await setup();
    const snapshot = localSnapshot();
    const enroll = await call("/v1/publication/enroll", undefined, enrollmentBody());
    expect(enroll.status).toBe(200);
    const teamId = enroll.body.result.team.id as string;
    const other = { actorId: "hum_other", actorType: "human" as const };
    await store.createWorkspace({
      id: "ws_foreign",
      teamId,
      name: "foreign",
      status: "active",
      createdBy: other,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await store.addParticipant({ workspaceId: "ws_foreign", actor: other, role: "owner", joinedAt: NOW });
    await store.createFinding({
      id: SHR.findingId,
      workspaceId: "ws_foreign",
      summary: "foreign collision",
      createdBy: other,
      createdAt: NOW,
    });
    const result = await call("/v1/publication/import", ownerToken, { requestId: "pub-request-1", digest: snapshot.digest, snapshot });
    expect(result.status).toBe(409);
    const workspace = await store.getWorkspace(SHR.workspaceId);
    expect(workspace).toBeUndefined();
    expect(await store.listParticipants(SHR.workspaceId)).toEqual([]);
    expect(await store.getContribution("con_finding_create")).toBeUndefined();
  });

  it("rejects a fraction-less snapshot timestamp as a validation error, not a digest mismatch", async () => {
    const { call } = await setup();
    const snapshot = localSnapshot();
    const bad = structuredClone(snapshot);
    bad.workspace.updatedAt = "2026-10-23T12:20:00Z";
    // Recompute the digest over the received bytes so only the timestamp gate can fail.
    bad.digest = publicationDigest(bad);
    expect((await call("/v1/publication/enroll", undefined, enrollmentBody())).status).toBe(200);
    const result = await call("/v1/publication/import", ownerToken, {
      requestId: "pub-request-1", digest: bad.digest, snapshot: bad,
    });
    expect(result.status).toBe(400);
    expect(result.body.details.field).toBe("workspace.updatedAt");
    expect(result.body.message).toContain("workspace.updatedAt");
  });

  it("rejects a tampered digest and a reopened enrollment without leaking state", async () => {
    const { call } = await setup();
    const snapshot = localSnapshot();
    expect((await call("/v1/publication/enroll", undefined, enrollmentBody())).status).toBe(200);
    const tampered = structuredClone(snapshot);
    tampered.findings[0]!.summary = "tampered";
    const result = await call("/v1/publication/import", ownerToken, { requestId: "pub-request-1", digest: snapshot.digest, snapshot: tampered });
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).not.toContain(ownerToken);
    expect(JSON.stringify(result.body)).not.toContain(agentToken);
    const sameRequest = await call("/v1/publication/enroll", undefined, {
      ...enrollmentBody(),
      humanName: "Different name",
    });
    expect(sameRequest.status).toBe(409);
    const reuseHuman = await call("/v1/publication/enroll", undefined, enrollmentBody("pub-request-3"));
    expect(reuseHuman.status).toBe(409);
  });
});
