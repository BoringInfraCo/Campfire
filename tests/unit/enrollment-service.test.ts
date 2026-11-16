import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { hashToken } from "../../src/service/tokens.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import { InvitationAlreadyIssued, InvitationLimitReached } from "../../src/domain/errors.js";
import type { CampfireService } from "../../src/service/service.js";
import type { CampfireStore } from "../../src/store/store.js";

const owner = { actor: { actorId: FIXTURE.humans.sergio, actorType: "human" as const } };
const workspaceId = FIXTURE.workspaces.billing;
const input = () => ({ invitationId: "", requestId: "request-020", humanName: "Ruth", humanTokenHash: hashToken("recipient-human"), agents: [{ harness: "opencode" as const, tokenHash: hashToken("recipient-agent") }] });

describe("Sprint 020 application enrollment", () => {
  let store: CampfireStore;
  let service: CampfireService;
  let now: string;
  beforeEach(() => {
    now = "2026-10-01T12:00:00.000Z";
    store = openInMemoryStore();
    seedFixture(store);
    service = createCampfireService({ store, idSource: createCounterIdSource(), clock: () => now });
  });
  afterEach(() => service.close());

  it("enrolls a new distinct human and owned agent atomically; exact replay is inert", () => {
    const invitation = service.issueEnrollmentInvitation(owner, { workspaceId });
    const request = { ...input(), invitationId: invitation.invitationId };
    const receipt = service.redeemEnrollment(invitation.secret, request);
    expect(receipt.workspace.id).toBe(workspaceId);
    expect(store.getParticipant(workspaceId, { actorId: receipt.human.id, actorType: "human" })?.role).toBe("member");
    expect(store.getAgent(receipt.agents[0]!.id)?.humanId).toBe(receipt.human.id);
    expect(service.resolveToken("recipient-human").actorId).toBe(receipt.human.id);
    expect(service.resolveToken("recipient-agent").actorId).toBe(receipt.agents[0]!.id);
    const count = store.listContributions(workspaceId).length;
    expect(service.redeemEnrollment(invitation.secret, request)).toEqual(receipt);
    expect(store.listContributions(workspaceId)).toHaveLength(count);
    expect(store.listAgentSessions(workspaceId).some((s) => s.humanId === receipt.human.id)).toBe(false);
    const ctx = { actor: { actorId: receipt.agents[0]!.id, actorType: "agent" as const } };
    expect(service.getWorkspaceContext(ctx, workspaceId).goal).toBeDefined();
    expect(() => service.addFinding(ctx, { workspaceId, summary: "No implicit write session" })).toThrow();
    expect(JSON.stringify(store.listContributions(workspaceId))).not.toContain(invitation.secret);
    expect(JSON.stringify(store.listContributions(workspaceId))).not.toContain(request.humanTokenHash);
  });

  const nonOwner = { actor: { actorId: FIXTURE.humans.alice, actorType: "human" as const } };
  const issue = () => service.issueEnrollmentInvitation(owner, { workspaceId });
  const limitError = (fn: () => unknown): InvitationLimitReached => {
    try { fn(); } catch (error) { if (error instanceof InvitationLimitReached) return error; throw error; }
    throw new Error("expected InvitationLimitReached");
  };

  it("fixes expiry at exactly 30 minutes after server issuance and ignores a client-chosen lifetime", () => {
    const invitation = issue();
    expect(invitation.expiresAt).toBe("2026-10-01T12:30:00.000Z");
    now = "2026-10-01T12:07:00.000Z";
    const legacy = service.issueEnrollmentInvitation(owner, { workspaceId, expiresInHours: 168 } as never);
    expect(legacy.expiresAt).toBe("2026-10-01T12:37:00.000Z");
    expect(() => service.issueEnrollmentInvitation(owner, { workspaceId, extra: 1 } as never)).toThrow();
  });

  it("refuses a sixth active invitation with InvitationLimitReached listing active ids but no secrets", () => {
    const issued = Array.from({ length: 5 }, issue);
    const error = limitError(issue);
    expect(error.code).toBe("InvitationLimitReached");
    expect(error.message).toContain("5");
    expect(error.message.toLowerCase()).toContain("revoke");
    const active = error.details!.activeInvitations as Array<Record<string, string>>;
    expect(active.map((item) => item.invitationId).sort()).toEqual(issued.map((item) => item.invitationId).sort());
    expect(Object.keys(active[0]!).sort()).toEqual(["createdAt", "expiresAt", "invitationId"]);
    expect(JSON.stringify(error.details)).not.toContain(issued[0]!.secret);
    // The refusal wrote nothing.
    expect(service.listEnrollmentInvitations(owner, { workspaceId }).invitations).toHaveLength(5);
  });

  it("frees a slot on expiry, accept, decline, and revoke", () => {
    const first = Array.from({ length: 5 }, issue);
    expect(() => issue()).toThrow(InvitationLimitReached);
    now = "2026-10-01T12:30:00.000Z"; // all five expire exactly at +30 minutes
    expect(service.listEnrollmentInvitations(owner, { workspaceId }).invitations).toHaveLength(0);
    const batch = Array.from({ length: 5 }, issue);
    expect(() => issue()).toThrow(InvitationLimitReached);
    service.redeemEnrollment(batch[0]!.secret, { ...input(), invitationId: batch[0]!.invitationId });
    const afterAccept = issue();
    expect(() => issue()).toThrow(InvitationLimitReached);
    expect(service.declineEnrollment(batch[1]!.secret, { invitationId: batch[1]!.invitationId })).toMatchObject({ outcome: "declined" });
    issue();
    expect(() => issue()).toThrow(InvitationLimitReached);
    service.revokeEnrollmentInvitation(owner, { workspaceId, invitationId: afterAccept.invitationId });
    issue();
    expect(() => issue()).toThrow(InvitationLimitReached);
    expect(first).toHaveLength(5);
  });

  it("accept replay does not create a second enrollment or consume another slot", () => {
    const invitation = issue();
    const request = { ...input(), invitationId: invitation.invitationId };
    const receipt = service.redeemEnrollment(invitation.secret, request);
    expect(service.redeemEnrollment(invitation.secret, request)).toEqual(receipt);
    expect(() => service.redeemEnrollment(invitation.secret, { ...request, requestId: "second-claim" })).toThrow();
    expect(store.listHumans(FIXTURE.teamId).filter((human) => human.displayName === "Ruth")).toHaveLength(1);
    expect(service.listEnrollmentInvitations(owner, { workspaceId }).invitations).toHaveLength(0);
  });

  it("lists only active invitations without secrets, owner-only and workspace-scoped", () => {
    const [kept, revoked, declined, accepted] = [issue(), issue(), issue(), issue()];
    service.revokeEnrollmentInvitation(owner, { workspaceId, invitationId: revoked!.invitationId });
    service.declineEnrollment(declined!.secret, { invitationId: declined!.invitationId });
    service.redeemEnrollment(accepted!.secret, { ...input(), invitationId: accepted!.invitationId });
    now = "2026-10-01T12:10:00.000Z";
    const late = issue();
    const list = service.listEnrollmentInvitations(owner, { workspaceId });
    expect(list).toMatchObject({ kind: "enrollment_invitation_list", workspaceId, limit: 5 });
    expect(list.invitations.map((item) => item.invitationId)).toEqual([kept!.invitationId, late.invitationId]);
    expect(list.invitations[0]).toEqual({ invitationId: kept!.invitationId, createdAt: "2026-10-01T12:00:00.000Z", expiresAt: "2026-10-01T12:30:00.000Z", issuer: { id: FIXTURE.humans.sergio, name: expect.any(String) } });
    const text = JSON.stringify(list);
    for (const item of [kept!, late]) expect(text).not.toContain(item.secret);
    expect(text).not.toContain(hashToken(kept!.secret));
    expect(text).not.toContain("secret");
  });

  it("denies list and issue to non-owners and to a wrong workspace before retrieval", () => {
    issue();
    expect(() => service.listEnrollmentInvitations(nonOwner, { workspaceId })).toThrow();
    expect(() => service.listEnrollmentInvitations({ actor: { actorId: "agt_nobody", actorType: "agent" } }, { workspaceId })).toThrow();
    expect(() => service.listEnrollmentInvitations(owner, { workspaceId: FIXTURE.workspaces.billing + "_other" })).toThrow();
    expect(() => service.listEnrollmentInvitations(owner, { workspaceId, expiresInHours: 1 } as never)).toThrow();
  });

  describe("idempotent issuance by requestId", () => {
    const issueWith = (requestId: string, ctx: { actor: { actorId: string; actorType: "human" } } = owner, ws: string = workspaceId) => service.issueEnrollmentInvitation(ctx, { workspaceId: ws, requestId });
    const alreadyIssued = (fn: () => unknown): InvitationAlreadyIssued => {
      try { fn(); } catch (error) { if (error instanceof InvitationAlreadyIssued) return error; throw error; }
      throw new Error("expected InvitationAlreadyIssued");
    };

    it("a retry after a lost response creates no second row, does not count against the cap, and reveals no secret", () => {
      const first = issueWith("req-lost-1");
      const error = alreadyIssued(() => issueWith("req-lost-1"));
      expect(error.code).toBe("InvitationAlreadyIssued");
      expect(error.details).toEqual({ invitationId: first.invitationId, createdAt: "2026-10-01T12:00:00.000Z", expiresAt: first.expiresAt, status: "active" });
      expect(error.message.toLowerCase()).toContain("revoke");
      const text = JSON.stringify({ message: error.message, details: error.details });
      expect(text).not.toContain(first.secret);
      expect(text).not.toContain(hashToken(first.secret));
      expect(service.listEnrollmentInvitations(owner, { workspaceId }).invitations).toHaveLength(1);
      expect(store.listContributions(workspaceId).filter((c) => c.objectType === "enrollment_invitation")).toHaveLength(1);
      // Four more distinct issues still fit: the retry consumed no slot.
      for (let n = 0; n < 4; n += 1) issueWith(`req-other-${n}`);
      expect(() => issue()).toThrow(InvitationLimitReached);
    });

    it("still reports the existing invitation when the workspace is full", () => {
      const first = issueWith("req-full");
      for (let n = 0; n < 4; n += 1) issue();
      expect(alreadyIssued(() => issueWith("req-full")).details!.invitationId).toBe(first.invitationId);
    });

    it("reports expired, consumed, and revoked statuses", () => {
      const expired = issueWith("req-expired");
      const consumed = issueWith("req-consumed");
      const revoked = issueWith("req-revoked");
      service.redeemEnrollment(consumed.secret, { ...input(), invitationId: consumed.invitationId });
      service.revokeEnrollmentInvitation(owner, { workspaceId, invitationId: revoked.invitationId });
      expect(alreadyIssued(() => issueWith("req-consumed")).details!.status).toBe("consumed");
      expect(alreadyIssued(() => issueWith("req-revoked")).details!.status).toBe("revoked");
      now = "2026-10-01T12:30:00.000Z";
      expect(alreadyIssued(() => issueWith("req-expired")).details).toMatchObject({ invitationId: expired.invitationId, status: "expired" });
    });

    it("a refused cap-hit does not burn the request id", () => {
      const filled = Array.from({ length: 5 }, issue);
      expect(() => issueWith("req-burn")).toThrow(InvitationLimitReached);
      expect(() => issueWith("req-burn")).toThrow(InvitationLimitReached);
      service.revokeEnrollmentInvitation(owner, { workspaceId, invitationId: filled[0]!.invitationId });
      const created = issueWith("req-burn");
      expect(created.secret).toBeTruthy();
      expect(alreadyIssued(() => issueWith("req-burn")).details!.invitationId).toBe(created.invitationId);
    });

    it("a different actor or workspace with the same id learns nothing", () => {
      const first = issueWith("req-secret-id");
      for (const attempt of [() => issueWith("req-secret-id", nonOwner), () => issueWith("req-secret-id", owner, workspaceId + "_other")]) {
        let caught: unknown;
        try { attempt(); } catch (error) { caught = error; }
        expect(caught).toBeInstanceOf(Error);
        expect(caught).not.toBeInstanceOf(InvitationAlreadyIssued);
        expect(JSON.stringify(caught instanceof Error ? caught.message : "")).not.toContain(first.invitationId);
      }
    });

    it("the same id in another workspace the owner controls is an independent request", () => {
      const first = issueWith("req-scope");
      const other = issueWith("req-scope", owner, FIXTURE.workspaces.unrelated);
      expect(other.invitationId).not.toBe(first.invitationId);
    });

    it("requests without a requestId never collide", () => {
      const a = issue();
      const b = issue();
      expect(a.invitationId).not.toBe(b.invitationId);
      expect(() => service.issueEnrollmentInvitation(owner, { workspaceId, requestId: "bad id!" })).toThrow();
    });
  });

  it("scopes the cap to the workspace", () => {
    const other = Object.values(FIXTURE.workspaces).find((id) => id !== workspaceId && store.getParticipant(id, owner.actor)?.role === "owner");
    Array.from({ length: 5 }, issue);
    expect(() => issue()).toThrow(InvitationLimitReached);
    if (other !== undefined) expect(() => service.issueEnrollmentInvitation(owner, { workspaceId: other })).not.toThrow();
  });

  it("rejects non-owner issuance and all scope/secret/claim tampering", () => {
    expect(() => service.issueEnrollmentInvitation({ actor: { actorId: FIXTURE.humans.alice, actorType: "human" } }, { workspaceId })).toThrow();
    const invitation = service.issueEnrollmentInvitation(owner, { workspaceId });
    const request = { ...input(), invitationId: invitation.invitationId };
    expect(() => service.redeemEnrollment(invitation.secret, { ...request, role: "owner" } as typeof request)).toThrow();
    expect(() => service.redeemEnrollment("SECRET_SENTINEL", request)).toThrow("Invalid enrollment invitation");
    expect(() => service.resolveToken(invitation.secret)).toThrow();
    service.redeemEnrollment(invitation.secret, request);
    expect(() => service.redeemEnrollment(invitation.secret, { ...request, requestId: "different-claim" })).toThrow();
  });

  it("expiration and revocation deny initial and receipt recovery", () => {
    const invitation = service.issueEnrollmentInvitation(owner, { workspaceId });
    const request = { ...input(), invitationId: invitation.invitationId };
    now = "2026-10-01T12:30:00.000Z";
    expect(() => service.redeemEnrollment(invitation.secret, request)).toThrow();
    now = "2026-10-01T12:00:00.000Z";
    service.revokeEnrollmentInvitation(owner, { workspaceId, invitationId: invitation.invitationId });
    expect(() => service.redeemEnrollment(invitation.secret, request)).toThrow();
  });

  it("revocation receipts name which invitation authority was withdrawn", () => {
    const unclaimed = service.issueEnrollmentInvitation(owner, { workspaceId });
    const revocation = service.revokeEnrollmentInvitation(owner, { workspaceId, invitationId: unclaimed.invitationId });
    expect(revocation).toMatchObject({ kind: "enrollment_revocation", revokedAuthority: "unclaimed_enrollment", workspaceId });
    expect(service.revokeEnrollmentInvitation(owner, { workspaceId, invitationId: unclaimed.invitationId })).toEqual(revocation);

    const claimed = service.issueEnrollmentInvitation(owner, { workspaceId });
    service.redeemEnrollment(claimed.secret, { ...input(), invitationId: claimed.invitationId });
    const replay = service.revokeEnrollmentInvitation(owner, { workspaceId, invitationId: claimed.invitationId });
    expect(replay.revokedAuthority).toBe("consumed_receipt_replay");
    // Revocation withdraws invitation authority, not the enrolled identities.
    expect(store.getParticipant(workspaceId, { actorId: store.listHumans(FIXTURE.teamId).at(-1)!.id, actorType: "human" })).toBeDefined();
  });

  it("does not replay revoked actor credentials; additional managed agents remain owned and explicit", () => {
    const invitation = service.issueEnrollmentInvitation(owner, { workspaceId });
    const request = { ...input(), invitationId: invitation.invitationId };
    const receipt = service.redeemEnrollment(invitation.secret, request);
    const human = { actor: { actorId: receipt.human.id, actorType: "human" as const } };
    const extra = { workspaceId, requestId: "codex-extra", harness: "codex" as const, tokenHash: hashToken("recipient-codex") };
    const added = service.enrollOwnedAgent(human, extra);
    expect(service.enrollOwnedAgent(human, extra)).toEqual(added);
    expect(store.getAgent(added.agent.id)?.humanId).toBe(receipt.human.id);
    expect(() => service.enrollOwnedAgent(human, { ...extra, requestId: "another-slot-claim" })).toThrow();
    service.revokeToken(human, "recipient-agent");
    expect(() => service.redeemEnrollment(invitation.secret, request)).toThrow();
    expect(() => service.resolveToken("recipient-agent")).toThrow();
  });
});
