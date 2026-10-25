import { describe, expect, it } from "vitest";
import { formatInvitationLink, invitationCapabilityShape, parseInvitationLink } from "../../src/bootstrap/invitation-link.js";

const endpoint = "https://campfire.example.test";
const invitation = { invitationId: "ein_inv_000001", secret: `cfe_${"ab".repeat(16)}` };

describe("invitation links", () => {
  it("round-trips the endpoint and capability without putting the secret in the query", () => {
    const link = formatInvitationLink(endpoint, invitation);
    expect(link.startsWith(`${endpoint}/join#v1.`)).toBe(true);
    expect(link).not.toContain("/campfire/campfire/");
    expect(link).not.toContain("?");
    expect(link).not.toContain(invitation.secret);
    expect(parseInvitationLink(link)).toEqual({ url: endpoint, ...invitation });
    expect(parseInvitationLink(link.replace("#", "\\#"))).toEqual({ url: endpoint, ...invitation });
    expect(invitationCapabilityShape(invitation.invitationId)).toBe("id");
    expect(invitationCapabilityShape(link)).toBe("link");
  });

  it("rejects an invitation id, a query secret, and a mismatched fragment", () => {
    const link = formatInvitationLink(endpoint, invitation);
    expect(() => parseInvitationLink(invitation.invitationId)).toThrow(/full link/);
    expect(() => parseInvitationLink(`${endpoint}/join?secret=${invitation.secret}#v1.aaaa`)).toThrow(/full link/);
    expect(() => parseInvitationLink(`${link}x`)).toThrow(/full link/);
    expect(() => parseInvitationLink(link.replace(endpoint, "http://127.0.0.1:9"))).toThrow(/full link/);
  });

  it("keeps a /campfire API base on the same Worker instead of adding a second prefix", () => {
    const prefixed = "https://boringinfra.company/campfire";
    const link = formatInvitationLink(prefixed, invitation);
    expect(link.startsWith(`${prefixed}/join#v1.`)).toBe(true);
    expect(link).not.toContain("/campfire/campfire/");
    expect(parseInvitationLink(link).url).toBe(prefixed);
  });

  it("accepts loopback only when the caller allows it", () => {
    const link = formatInvitationLink("http://127.0.0.1:9414", invitation, true);
    expect(parseInvitationLink(link, true).url).toBe("http://127.0.0.1:9414");
    expect(() => parseInvitationLink(link)).toThrow(/full link/);
  });
});
