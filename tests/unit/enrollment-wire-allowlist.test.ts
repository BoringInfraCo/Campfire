import { expect, it } from "vitest";
import { publicEnrollmentDecline, publicEnrollmentPreview, type EnrollmentDeclineReceipt, type EnrollmentInvitationPreview } from "../../src/domain/enrollment.js";

it("never forwards additional internal fields in recipient responses", () => {
  const preview = { version: 1, kind: "enrollment_invitation_preview", invitationId: "ein_1", status: "pending", workspace: { id: "ws_1", name: "Work", teamId: "team_1", secret: "nested-secret" }, inviter: { id: "hum_1", name: "Owner", secret: "nested-secret" }, expiresAt: "2099-01-01T00:00:00Z", permittedHarnesses: ["codex"], secret: "top-secret" } as unknown as EnrollmentInvitationPreview;
  const decline = { version: 1, kind: "enrollment_invitation_decline", invitationId: "ein_1", workspaceId: "ws_1", outcome: "declined", membershipCreated: false, secret: "top-secret" } as unknown as EnrollmentDeclineReceipt;
  expect(JSON.stringify(publicEnrollmentPreview(preview))).not.toContain("secret");
  expect(JSON.stringify(publicEnrollmentDecline(decline))).not.toContain("secret");
});
