import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { createRuntimeFromPath } from "../../src/runtime.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { hashToken } from "../../src/service/tokens.js";
import { startCampfireHttpServer } from "../../src/http/server.js";
import { createD1Store, migrateD1 } from "../../src/worker/d1-store.js";
import { createD1WorkerHandler, createWorkerHandler } from "../../src/worker/handler.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import type { AsyncCampfireStore } from "../../src/worker/d1-store.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

describe.each(["http", "worker-sqlite", "worker-d1"] as const)("invitation transport privacy: %s", (mode) => {
  it("keeps pending preview useful and hides workspace data after lifecycle changes", async () => {
    let now = "2026-11-16T00:00:00.000Z";
    let store: CampfireStore | AsyncCampfireStore;
    let handle: (path: string, token: string, body: unknown) => Promise<{ status: number; data: any }>;
    if (mode === "http") {
      const dir = mkdtempSync(join(tmpdir(), "campfire-redaction-"));
      const runtime = createRuntimeFromPath(join(dir, "store.db"));
      store = runtime.store;
      const service = createCampfireService({ store: runtime.store, clock: () => now, idSource: createCounterIdSource() });
      const server = await startCampfireHttpServer({ runtime: { ...runtime, service }, port: 0 });
      cleanups.push(() => rmSync(dir, { recursive: true, force: true }), () => runtime.close(), () => server.close());
      handle = async (path, token, body) => {
        const response = await fetch(`${server.url}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
        return { status: response.status, data: await response.json() };
      };
    } else {
      let worker: (request: Request) => Promise<Response>;
      if (mode === "worker-sqlite") {
        const local = openInMemoryStore(); store = local; cleanups.push(() => local.close());
        worker = createWorkerHandler({ service: createCampfireService({ store: local, clock: () => now, idSource: createCounterIdSource() }) });
      } else {
        const adapter = sqliteD1(); cleanups.push(() => { adapter.database.close(); });
        await migrateD1(adapter.binding); store = createD1Store(adapter.binding);
        worker = createD1WorkerHandler({ store, clock: () => now, idSource: createCounterIdSource() });
      }
      handle = async (path, token, body) => {
        const response = await worker(new Request(`https://campfire.test${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
        return { status: response.status, data: await response.json() };
      };
    }

    const owner = { actorId: "hum_owner", actorType: "human" as const };
    await store.createOrganization({ id: "org_secret", name: "Org", createdAt: now });
    await store.createTeam({ id: "team_secret", organizationId: "org_secret", name: "Team", createdAt: now });
    await store.createHuman({ id: owner.actorId, teamId: "team_secret", displayName: "SECRET INVITER", createdAt: now });
    await store.createActorToken({ id: "tok_owner", actor: owner, tokenHash: hashToken("owner-token"), createdAt: now });
    await store.createWorkspace({ id: "ws_secret", teamId: "team_secret", name: "SECRET WORKSPACE", status: "active", createdBy: owner, createdAt: now, updatedAt: now });
    await store.addParticipant({ workspaceId: "ws_secret", actor: owner, role: "owner", joinedAt: now });
    const actorCall = (method: string, params: object) => handle("/v1/call", "owner-token", { method, params });
    const issue = async () => {
      const response = await actorCall("issue_enrollment_invitation", { workspaceId: "ws_secret" });
      expect(response.status).toBe(200);
      return response.data.result as { invitationId: string; secret: string };
    };
    const preview = (invitation: { invitationId: string; secret: string }) => handle("/v1/enrollment/preview", invitation.secret, { invitationId: invitation.invitationId });
    const decline = (invitation: { invitationId: string; secret: string }) => handle("/v1/enrollment/decline", invitation.secret, { invitationId: invitation.invitationId });
    const checkPreview = async (invitation: { invitationId: string; secret: string }, status: string) => {
      const response = await preview(invitation);
      expect(response.status).toBe(200);
      expect(response.data.result).toEqual({ version: 1, kind: "enrollment_invitation_preview", invitationId: invitation.invitationId, status });
      for (const forbidden of ["ws_secret", "team_secret", "SECRET WORKSPACE", "SECRET INVITER", "expiresAt", "permittedHarnesses"]) expect(JSON.stringify(response.data)).not.toContain(forbidden);
    };
    const checkDecline = async (invitation: { invitationId: string; secret: string }, outcome: string) => {
      const response = await decline(invitation);
      expect(response.status).toBe(200);
      expect(response.data.result).toEqual({ version: 1, kind: "enrollment_invitation_decline", invitationId: invitation.invitationId, outcome, membershipCreated: false });
    };

    const pending = await issue();
    const revoked = await issue();
    const declined = await issue();
    const consumed = await issue();
    const expired = await issue();
    expect((await preview(pending)).data.result).toMatchObject({ status: "pending", workspace: { id: "ws_secret", name: "SECRET WORKSPACE" }, inviter: { name: "SECRET INVITER" } });
    expect((await actorCall("revoke_enrollment_invitation", { workspaceId: "ws_secret", invitationId: revoked.invitationId })).status).toBe(200);
    await checkPreview(revoked, "revoked"); await checkDecline(revoked, "already_revoked");
    expect((await decline(declined)).data.result).toMatchObject({ outcome: "declined", membershipCreated: false });
    await checkPreview(declined, "revoked"); await checkDecline(declined, "already_revoked");
    const redeemed = await handle("/v1/enrollment/redeem", consumed.secret, { invitationId: consumed.invitationId, requestId: "redaction-test", humanName: "Recipient", humanTokenHash: hashToken("new-human"), agents: [{ harness: "opencode", tokenHash: hashToken("new-agent") }] });
    expect(redeemed.status).toBe(200);
    await checkPreview(consumed, "consumed"); await checkDecline(consumed, "already_used");
    now = "2026-11-16T00:31:00.000Z";
    await checkPreview(expired, "expired"); await checkDecline(expired, "expired");
    // Issue a fresh invitation before disabling the workspace, so unavailable
    // is distinguished from expiry rather than relying on lifecycle precedence.
    const unavailable = await issue();
    await store.updateWorkspace("ws_secret", { status: "archived", updatedAt: now });
    await checkPreview(unavailable, "unavailable"); await checkDecline(unavailable, "unavailable");
    const invalid = await handle("/v1/enrollment/preview", `cfe_${"0".repeat(32)}`, { invitationId: pending.invitationId });
    expect(invalid.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(invalid.data)).not.toContain("SECRET WORKSPACE");
  });
});
