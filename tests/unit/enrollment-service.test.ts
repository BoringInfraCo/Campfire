import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { hashToken } from "../../src/service/tokens.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
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
    const invitation = service.issueEnrollmentInvitation(owner, { workspaceId, expiresInHours: 1 });
    const request = { ...input(), invitationId: invitation.invitationId };
    now = "2026-10-01T13:00:00.000Z";
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
