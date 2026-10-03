import { afterEach, describe, expect, it } from "vitest";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { hashToken } from "../../src/service/tokens.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { createD1Store, migrateD1, type AsyncCampfireStore } from "../../src/worker/d1-store.js";
import { createWorkerHandler, createD1WorkerHandler } from "../../src/worker/handler.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";

const NOW = "2026-10-01T12:00:00.000Z";
const owner = { actorId: "hum_owner", actorType: "human" as const };
const close: (() => void)[] = [];
afterEach(() => { for (const fn of close.splice(0)) fn(); });

async function setup(mode: "sync" | "d1") {
  let store: CampfireStore | AsyncCampfireStore;
  let handle: (request: Request) => Promise<Response>;
  if (mode === "sync") {
    const local = openInMemoryStore(); store = local; close.push(() => local.close());
    const service = createCampfireService({ store: local, clock: () => NOW, idSource: createCounterIdSource() });
    handle = createWorkerHandler({ service });
  } else {
    const adapter = sqliteD1(); close.push(() => adapter.database.close());
    await migrateD1(adapter.binding);
    const remote = createD1Store(adapter.binding); store = remote;
    handle = createD1WorkerHandler({ store: remote, clock: () => NOW, idSource: createCounterIdSource() });
  }
  await store.createOrganization({ id: "org", name: "Org", createdAt: NOW });
  await store.createTeam({ id: "team", organizationId: "org", name: "Team", createdAt: NOW });
  for (const id of ["hum_owner", "hum_member"]) {
    await store.createHuman({ id, teamId: "team", displayName: id, createdAt: NOW });
    await store.createActorToken({ id: `tok_${id}`, actor: { actorId: id, actorType: "human" }, tokenHash: hashToken(id), createdAt: NOW });
  }
  await store.createAgent({ id: "agt_owner", humanId: owner.actorId, teamId: "team", name: "Owner's agent", harness: "codex", createdAt: NOW });
  await store.createActorToken({ id: "tok_agent", actor: { actorId: "agt_owner", actorType: "agent" }, tokenHash: hashToken("agt_owner"), createdAt: NOW });
  for (const id of ["ws_shared", "ws_private"]) {
    await store.createWorkspace({ id, teamId: "team", name: id, status: "active", createdBy: owner, createdAt: NOW, updatedAt: NOW });
    await store.addParticipant({ workspaceId: id, actor: owner, role: "owner", joinedAt: NOW });
  }
  await store.addParticipant({ workspaceId: "ws_shared", actor: { actorId: "hum_member", actorType: "human" }, role: "member", joinedAt: NOW });
  await store.addParticipant({ workspaceId: "ws_shared", actor: { actorId: "agt_owner", actorType: "agent" }, role: "agent", joinedAt: NOW });
  await store.createFinding({ id: "find_private", workspaceId: "ws_private", summary: "PRIVATE_WORKSPACE_SENTINEL", createdBy: owner, createdAt: NOW });
  const call = async (path: string, token: string | undefined, body?: unknown, method = "POST") => {
    const response = await handle(new Request(`https://campfire.test${path}`, {
      method, headers: { ...(token === undefined ? {} : { authorization: `Bearer ${token}` }), "content-type": "application/json" },
      ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
    }));
    return { status: response.status, body: await response.json() as any };
  };
  const actorCall = (prefix: string, token: string, method: string, params: Record<string, unknown> = {}) => call(`${prefix}/v1/call`, token, { method, params });
  const issue = async (prefix = "") => {
    const result = await actorCall(prefix, owner.actorId, "issue_enrollment_invitation", { workspaceId: "ws_shared" });
    expect(result.status).toBe(200); return result.body.result as { invitationId: string; secret: string };
  };
  return { store, call, actorCall, issue };
}
function input(invitationId: string) {
  return { invitationId, requestId: "worker-enroll-request", humanName: "Teammate", humanTokenHash: hashToken("teammate-human"),
    agents: [{ harness: "opencode", tokenHash: hashToken("teammate-agent") }] };
}

describe.each(["sync", "d1"] as const)("Sprint 020 Worker enrollment transport on %s", (mode) => {
  it.each(["", "/campfire"])("supports %s API base path and exact replay without leaking credentials", async (prefix) => {
    const { store, call, actorCall, issue } = await setup(mode);
    const invitation = await issue(prefix);
    const request = input(invitation.invitationId);
    const first = await call(`${prefix}/v1/enrollment/redeem`, invitation.secret, request);
    expect(first.status).toBe(200);
    const replay = await call(`${prefix}/v1/enrollment/redeem`, invitation.secret, request);
    expect(replay).toEqual(first);
    expect(await store.countHumans()).toBe(3);
    const identity = await actorCall(prefix, "teammate-human", "whoami");
    expect(identity.body.result.actor).toEqual({ actorId: first.body.result.human.id, actorType: "human" });
    const context = await actorCall(prefix, "teammate-agent", "get_workspace_context", { workspaceId: "ws_shared" });
    expect(context.status).toBe(200);
    const unrelated = await actorCall(prefix, "teammate-agent", "get_workspace_context", { workspaceId: "ws_private" });
    expect(unrelated.status).toBe(403);
    for (const output of [first.body, context.body, unrelated.body, await store.listContributions("ws_shared")]) {
      const text = JSON.stringify(output);
      expect(text).not.toContain(invitation.secret);
      expect(text).not.toContain(request.humanTokenHash);
      expect(text).not.toContain(request.agents[0]!.tokenHash);
      expect(text).not.toContain("PRIVATE_WORKSPACE_SENTINEL");
    }
  });
  it("rejects scope/owner overrides before consuming or creating any state", async () => {
    const { store, call, issue } = await setup(mode);
    const invitation = await issue("/campfire");
    for (const extra of [{ workspaceId: "ws_private" }, { teamId: "foreign" }, { role: "owner" }, { humanId: owner.actorId }]) {
      const result = await call("/campfire/v1/enrollment/redeem", invitation.secret, { ...input(invitation.invitationId), ...extra });
      expect(result.status).toBe(400);
    }
    expect(await store.countHumans()).toBe(2);
    expect((await store.getEnrollmentInvitation(invitation.invitationId))?.consumedAt).toBeUndefined();
  });
  it("concurrent exact retries return one receipt, while a different claimant cannot provision", async () => {
    const { store, call, issue } = await setup(mode);
    const invitation = await issue("/campfire");
    const request = input(invitation.invitationId);
    const loser = { ...request, requestId: "worker-other-request", humanTokenHash: hashToken("other-human"),
      agents: [{ harness: "codex", tokenHash: hashToken("other-agent") }] };
    const results = await Promise.all([
      call("/campfire/v1/enrollment/redeem", invitation.secret, request),
      call("/campfire/v1/enrollment/redeem", invitation.secret, request),
      call("/campfire/v1/enrollment/redeem", invitation.secret, loser),
    ]);
    expect(results[0]!.status).toBe(200);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]!.status).toBe(400);
    expect(results[2]!.body.error).toBe("Conflict");
    expect(await store.countHumans()).toBe(3);
    expect(await store.getActorTokenByHash(loser.humanTokenHash)).toBeUndefined();
    expect(await store.listAgents("team")).toHaveLength(2);
  });
  it("invitation capability cannot authenticate actor calls or Viewer, and redemption is not a dispatch method", async () => {
    const { call, actorCall, issue } = await setup(mode);
    const invitation = await issue();
    expect((await actorCall("", invitation.secret, "whoami")).status).toBe(401);
    expect((await call("/campfire/api/list_workspaces", invitation.secret, undefined, "GET")).status).toBe(401);
    expect((await call("/campfire/api/call", invitation.secret, { method: "whoami" })).status).toBe(401);
    expect((await actorCall("", owner.actorId, "redeem_enrollment", input(invitation.invitationId))).status).toBe(400);
    expect((await call("/v1/enrollment/redeem", undefined, input(invitation.invitationId))).status).toBe(401);
    expect((await call("/v1/enrollment/redeem", owner.actorId, input(invitation.invitationId))).status).toBe(403);
  });
  it("only a human owner issues/revokes, and consumed revocation blocks replay without offboarding", async () => {
    const { call, actorCall, issue } = await setup(mode);
    for (const token of ["hum_member", "agt_owner"]) {
      expect((await actorCall("/campfire", token, "issue_enrollment_invitation", { workspaceId: "ws_shared" })).status).toBe(403);
    }
    const invitation = await issue("/campfire");
    const request = input(invitation.invitationId);
    expect((await call("/campfire/v1/enrollment/redeem", invitation.secret, request)).status).toBe(200);
    expect((await actorCall("/campfire", "hum_member", "revoke_enrollment_invitation", { workspaceId: "ws_shared", invitationId: invitation.invitationId })).status).toBe(403);
    const revoked = await actorCall("/campfire", owner.actorId, "revoke_enrollment_invitation", { workspaceId: "ws_shared", invitationId: invitation.invitationId });
    expect(revoked.status).toBe(200);
    expect((await call("/campfire/v1/enrollment/redeem", invitation.secret, request)).status).toBe(403);
    expect((await actorCall("/campfire", "teammate-human", "get_workspace_context", { workspaceId: "ws_shared" })).status).toBe(200);
  });
});
