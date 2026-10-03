import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { hashToken } from "../../src/service/tokens.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { createAsyncCampfireService, type AsyncCampfireService } from "../../src/worker/async-service.js";
import type { AsyncCampfireStore } from "../../src/worker/d1-store.js";
import type { CampfireService } from "../../src/service/service.js";

const NOW = "2026-10-01T12:00:00.000Z";
const workspaceId = FIXTURE.workspaces.billing;
const owner = { actor: { actorId: FIXTURE.humans.sergio, actorType: "human" as const } };
function wrapSync(store: CampfireStore): AsyncCampfireStore {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === "transaction") return (fn: () => Promise<unknown>) => fn();
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? (...args: unknown[]) => Promise.resolve((value as (...args: unknown[]) => unknown).apply(target, args)) : value;
    },
  }) as unknown as AsyncCampfireStore;
}

// This validates the async application boundary against a real atomic SQLite
// store. Guarded D1 SQL/rollback is separately exercised by persistence tests.
for (const mode of ["sync", "async"] as const) {
  describe(`Sprint 020 ${mode} application authority and continuity`, () => {
    let store: CampfireStore;
    let service: CampfireService | AsyncCampfireService;
    beforeEach(() => {
      store = openInMemoryStore();
      seedFixture(store, { clock: () => NOW });
      const options = { idSource: createCounterIdSource(), clock: () => NOW };
      service = mode === "sync" ? createCampfireService({ ...options, store }) : createAsyncCampfireService({ ...options, store: wrapSync(store) });
    });
    afterEach(() => service.close());
    const prepared = (invitationId: string) => ({ invitationId, requestId: "claim-020", humanName: "Ruth", humanTokenHash: hashToken("human-secret"), agents: [{ harness: "codex" as const, tokenHash: hashToken("codex-secret") }, { harness: "opencode" as const, tokenHash: hashToken("opencode-secret") }] });

    it("supports both explicit agent memberships, transcript-free read, session-bound contribution and reciprocal use", async () => {
      const invitation = await service.issueEnrollmentInvitation(owner, { workspaceId });
      const receipt = await service.redeemEnrollment(invitation.secret, prepared(invitation.invitationId));
      expect(receipt.agents).toHaveLength(2);
      for (const agent of receipt.agents) {
        const actor = { actorId: agent.id, actorType: "agent" as const };
        expect(store.getParticipant(workspaceId, actor)?.role).toBe("agent");
        expect((await service.listWorkspaces({ actor })).map((w) => w.id)).toEqual([workspaceId]);
        expect((await service.getWorkspaceContext({ actor }, workspaceId)).goal?.id).toBe(FIXTURE.goals.billing);
      }
      const agent = receipt.agents[0]!;
      const actor = { actorId: agent.id, actorType: "agent" as const };
      const session = await service.registerAgentSession({ actor }, { workspaceId, agentId: agent.id, harness: agent.harness });
      const finding = await service.addFinding({ actor, agentSessionId: session.id }, { workspaceId, summary: "The recipient independently confirmed a safe migration path." });
      const original = await service.getWorkspaceContext(owner, workspaceId);
      expect(original.findings.find((f) => f.id === finding.id)?.agentSessionId).toBe(session.id);
      expect(original.participants.find((p) => p.actor.actorId === agent.id)?.humanOwnerId).toBe(receipt.human.id);
      expect(JSON.stringify(original)).not.toContain(FIXTURE.unrelatedFindingSentinel);
    });

    it("rejects authority overrides, malformed prepared credentials and duplicate selections before consuming", async () => {
      const invitation = await service.issueEnrollmentInvitation(owner, { workspaceId });
      const input = prepared(invitation.invitationId);
      const count = store.countHumans();
      for (const bad of [
        { ...input, workspaceId: FIXTURE.workspaces.unrelated },
        { ...input, humanTokenHash: "PREPARED_SECRET_SENTINEL" },
        { ...input, agents: [{ ...input.agents[0]!, humanId: FIXTURE.humans.sergio }] },
        { ...input, agents: [input.agents[0]!, input.agents[0]!] },
        { ...input, humanTokenHash: input.agents[0]!.tokenHash },
      ]) {
        let caught: unknown;
        try { await service.redeemEnrollment(invitation.secret, bad as typeof input); } catch (error) { caught = error; }
        expect(caught).toBeDefined();
        expect(String(caught)).not.toContain("PREPARED_SECRET_SENTINEL");
        expect(store.getEnrollmentInvitation(invitation.invitationId)?.consumedAt).toBeUndefined();
        expect(store.countHumans()).toBe(count);
      }
    });

    it("safe invitation inspection exposes no credential hash/digest and requires a human owner", async () => {
      const invitation = await service.issueEnrollmentInvitation(owner, { workspaceId });
      const lookup = { workspaceId, invitationId: invitation.invitationId };
      const view = await service.getEnrollmentInvitation(owner, lookup);
      expect(JSON.stringify(view)).not.toContain(invitation.secret);
      expect(view).not.toHaveProperty("secretHash");
      expect(view).not.toHaveProperty("requestDigest");
      const agentActor = { actorId: FIXTURE.agents.codexSergio, actorType: "agent" as const };
      store.updateParticipantRole(workspaceId, agentActor, "owner");
      for (const actor of [agentActor, { actorId: FIXTURE.humans.alice, actorType: "human" as const }]) {
        await expect(Promise.resolve().then(() => service.getEnrollmentInvitation({ actor }, lookup))).rejects.toThrow();
        await expect(Promise.resolve().then(() => service.issueEnrollmentInvitation({ actor }, { workspaceId }))).rejects.toThrow();
        await expect(Promise.resolve().then(() => service.revokeEnrollmentInvitation({ actor }, lookup))).rejects.toThrow();
      }
    });

    it("lost issuer authority makes an outstanding invitation unusable without partial enrollment", async () => {
      const invitation = await service.issueEnrollmentInvitation(owner, { workspaceId });
      store.updateParticipantRole(workspaceId, owner.actor, "member");
      const count = store.countHumans();
      await expect(Promise.resolve().then(() => service.redeemEnrollment(invitation.secret, prepared(invitation.invitationId)))).rejects.toThrow("Invalid enrollment invitation");
      expect(store.countHumans()).toBe(count);
      expect(store.getEnrollmentInvitation(invitation.invitationId)?.consumedAt).toBeUndefined();
    });

    it("invitation revocation cancels consumed receipt recovery without erasing valid participant credentials", async () => {
      const invitation = await service.issueEnrollmentInvitation(owner, { workspaceId });
      const input = prepared(invitation.invitationId);
      const receipt = await service.redeemEnrollment(invitation.secret, input);
      await service.revokeEnrollmentInvitation(owner, { workspaceId, invitationId: invitation.invitationId });
      await expect(Promise.resolve().then(() => service.redeemEnrollment(invitation.secret, input))).rejects.toThrow();
      expect((await service.resolveToken("human-secret")).actorId).toBe(receipt.human.id);
      expect((await service.getWorkspaceContext({ actor: { actorId: receipt.human.id, actorType: "human" } }, workspaceId)).workspace.id).toBe(workspaceId);
    });

    it("simultaneous exact retries return one enrollment; altered claims remain denied", async () => {
      const invitation = await service.issueEnrollmentInvitation(owner, { workspaceId });
      const input = prepared(invitation.invitationId);
      const [first, second] = await Promise.all([Promise.resolve().then(() => service.redeemEnrollment(invitation.secret, input)), Promise.resolve().then(() => service.redeemEnrollment(invitation.secret, input))]);
      expect(first).toEqual(second);
      expect(store.listHumans(FIXTURE.teamId).filter((h) => h.id === first.human.id)).toHaveLength(1);
      await expect(Promise.resolve().then(() => service.redeemEnrollment(invitation.secret, { ...input, requestId: "other-request" }))).rejects.toThrow();
    });

    it("occupied managed slots cannot silently replace identities or revive revoked credentials", async () => {
      const invitation = await service.issueEnrollmentInvitation(owner, { workspaceId });
      const input = prepared(invitation.invitationId);
      const receipt = await service.redeemEnrollment(invitation.secret, input);
      const ctx = { actor: { actorId: receipt.human.id, actorType: "human" as const } };
      await expect(Promise.resolve().then(() => service.enrollOwnedAgent(ctx, { workspaceId, requestId: "replacement", harness: "codex", tokenHash: hashToken("replacement-secret") }))).rejects.toThrow("already has an enrolled agent");
      await service.revokeToken(ctx, "codex-secret");
      await expect(Promise.resolve().then(() => service.redeemEnrollment(invitation.secret, input))).rejects.toThrow("no longer authorize recovery");
      expect(store.getOwnedAgentEnrollment(workspaceId, receipt.human.id, "codex")?.receipt.agent.id).toBe(receipt.agents.find((a) => a.harness === "codex")?.id);
    });
  });
}
