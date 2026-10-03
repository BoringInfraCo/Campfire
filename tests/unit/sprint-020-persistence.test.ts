import { afterEach, describe, expect, it } from "vitest";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import { createD1Store, migrateD1 } from "../../src/worker/d1-store.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";
import type { CampfireStore } from "../../src/store/store.js";
import type { AsyncCampfireStore } from "../../src/worker/d1-store.js";
import type { EnrollmentInvitation, EnrollmentProvisionPlan, OwnedAgentProvisionPlan } from "../../src/domain/enrollment.js";
import type { Contribution } from "../../src/domain/types.js";

const NOW = "2026-10-01T10:00:00.000Z";
const END = "2026-10-02T10:00:00.000Z";
const owner = { actorId: "hum_owner", actorType: "human" as const };
const close: (() => void)[] = [];
afterEach(() => { for (const fn of close.splice(0)) fn(); });

function contribution(id: string): Contribution {
  return { id, workspaceId: "ws_shared", actor: owner, action: "create", objectType: "participant", objectId: id, createdAt: NOW };
}
const invitation: EnrollmentInvitation = {
  id: "eni_first", workspaceId: "ws_shared", teamId: "team", issuedByHumanId: owner.actorId,
  secretHash: "1".repeat(64), createdAt: NOW, expiresAt: END, permittedHarnesses: ["codex", "opencode"],
};
function plan(suffix: string): EnrollmentProvisionPlan {
  const humanId = `hum_${suffix}`;
  const agentId = `agt_${suffix}`;
  return {
    invitationId: invitation.id, secretHash: invitation.secretHash, requestId: suffix,
    requestDigest: suffix.padEnd(64, "0"), claimedAt: NOW,
    human: { id: humanId, teamId: "team", displayName: suffix, createdAt: NOW },
    agents: [{ id: agentId, teamId: "team", humanId, name: "Codex", harness: "codex", createdAt: NOW }],
    tokens: [
      { id: `tok_h_${suffix}`, actor: { actorId: humanId, actorType: "human" }, tokenHash: `${suffix}-human`, createdAt: NOW },
      { id: `tok_a_${suffix}`, actor: { actorId: agentId, actorType: "agent" }, tokenHash: `${suffix}-agent`, createdAt: NOW },
    ],
    participants: [
      { workspaceId: "ws_shared", actor: { actorId: humanId, actorType: "human" }, role: "member", joinedAt: NOW },
      { workspaceId: "ws_shared", actor: { actorId: agentId, actorType: "agent" }, role: "agent", joinedAt: NOW },
    ],
    contributions: [contribution(`con_${suffix}`)],
    receipt: { version: 1, kind: "workspace_enrollment", invitationId: invitation.id, requestId: suffix,
      workspace: { id: "ws_shared", name: "Shared", teamId: "team" }, human: { id: humanId, name: suffix },
      agents: [{ id: agentId, name: "Codex", harness: "codex" }], enrolledAt: NOW },
  };
}
function agentPlan(suffix: string, harness: "codex" | "opencode" = "opencode"): OwnedAgentProvisionPlan {
  const agent = { id: `agt_${suffix}`, teamId: "team", humanId: "hum_one", name: harness, harness, createdAt: NOW };
  const receipt = { version: 1 as const, kind: "owned_agent_enrollment" as const, requestId: suffix,
    workspaceId: "ws_shared", humanId: "hum_one", agent: { id: agent.id, name: harness, harness }, enrolledAt: NOW };
  return { claimedAt: NOW, agent, token: { id: `tok_${suffix}`, actor: { actorId: agent.id, actorType: "agent" }, tokenHash: suffix, createdAt: NOW },
    participant: { workspaceId: "ws_shared", actor: { actorId: agent.id, actorType: "agent" }, role: "agent", joinedAt: NOW },
    contributions: [contribution(`con_${suffix}`)],
    record: { workspaceId: "ws_shared", humanId: "hum_one", harness, requestId: suffix,
      requestDigest: suffix.padEnd(64, "0"), tokenHash: suffix, receipt },
  };
}
async function setup(mode: "sqlite" | "d1") {
  let store: CampfireStore | AsyncCampfireStore;
  let adapter: ReturnType<typeof sqliteD1> | undefined;
  if (mode === "sqlite") { store = openInMemoryStore(); close.push(() => store.close()); }
  else { adapter = sqliteD1(); close.push(() => adapter!.database.close()); await migrateD1(adapter.binding); store = createD1Store(adapter.binding); }
  await store.createOrganization({ id: "org", name: "Org", createdAt: NOW });
  await store.createTeam({ id: "team", organizationId: "org", name: "Team", createdAt: NOW });
  await store.createHuman({ id: owner.actorId, teamId: "team", displayName: "Owner", createdAt: NOW });
  await store.createWorkspace({ id: "ws_shared", teamId: "team", name: "Shared", status: "active", createdBy: owner, createdAt: NOW, updatedAt: NOW });
  await store.addParticipant({ workspaceId: "ws_shared", actor: owner, role: "owner", joinedAt: NOW });
  expect(await store.createEnrollmentInvitation(invitation, contribution("con_issue"))).toBe(true);
  return { store, adapter };
}

describe.each(["sqlite", "d1"] as const)("Sprint 020 guarded enrollment on %s", (mode) => {
  it("provisions one enrollment, and identical/different replays write nothing", async () => {
    const { store } = await setup(mode);
    expect(await store.provisionEnrollment(plan("one"))).toBe(true);
    expect(await store.provisionEnrollment(plan("one"))).toBe(false);
    expect(await store.provisionEnrollment(plan("two"))).toBe(false);
    expect(await store.countHumans()).toBe(2);
    expect(await store.listAgents("team")).toHaveLength(1);
    expect(await store.listParticipants("ws_shared")).toHaveLength(3);
    expect(await store.listContributions("ws_shared")).toHaveLength(2);
    expect((await store.getEnrollmentInvitation(invitation.id))?.receipt).toEqual(plan("one").receipt);
    expect((await store.getOwnedAgentEnrollment("ws_shared", "hum_one", "codex"))?.receipt.agent.id).toBe("agt_one");
  });
  it("only one of two concurrent different requests obtains all rows", async () => {
    const { store } = await setup(mode);
    const results = await Promise.all([store.provisionEnrollment(plan("one")), store.provisionEnrollment(plan("two"))]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.countHumans()).toBe(2);
    expect(await store.listAgents("team")).toHaveLength(1);
    expect(await store.listContributions("ws_shared")).toHaveLength(2);
  });
  it("identical concurrent requests never insert twice, even with identical precomputed row IDs", async () => {
    const { store } = await setup(mode);
    const claim = plan("one");
    const results = await Promise.all([store.provisionEnrollment(claim), store.provisionEnrollment(claim)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await store.getEnrollmentInvitation(invitation.id))?.receipt).toEqual(claim.receipt);
    expect(await store.countHumans()).toBe(2);
    expect(await store.listContributions("ws_shared")).toHaveLength(2);
  });
  it("rejects issuance and revocation after owner authority is lost without appending history", async () => {
    const { store } = await setup(mode);
    await store.updateParticipantRole("ws_shared", owner, "member");
    expect(await store.createEnrollmentInvitation({ ...invitation, id: "eni_denied", secretHash: "9".repeat(64) }, contribution("con_denied"))).toBe(false);
    expect(await store.getEnrollmentInvitation("eni_denied")).toBeUndefined();
    expect(await store.revokeEnrollmentInvitation({ invitationId: invitation.id, workspaceId: "ws_shared", actor: owner,
      revokedAt: NOW, contribution: contribution("con_revoke_denied") })).toBe(false);
    expect((await store.getEnrollmentInvitationByHash(invitation.secretHash))?.revokedAt).toBeUndefined();
    expect(await store.listContributions("ws_shared")).toHaveLength(1);
  });
  it("provisions both explicitly selected harnesses with separate managed slots", async () => {
    const { store } = await setup(mode);
    const claim = plan("one");
    claim.agents.push({ id: "agt_other", name: "OpenCode", harness: "opencode", humanId: claim.human.id, teamId: "team", createdAt: NOW });
    claim.tokens.push({ id: "tok_other", actor: { actorId: "agt_other", actorType: "agent" }, tokenHash: "other-agent", createdAt: NOW });
    claim.participants.push({ workspaceId: "ws_shared", actor: { actorId: "agt_other", actorType: "agent" }, role: "agent", joinedAt: NOW });
    claim.receipt.agents.push({ id: "agt_other", name: "OpenCode", harness: "opencode" });
    expect(await store.provisionEnrollment(claim)).toBe(true);
    expect(await store.countHumans()).toBe(2);
    expect(await store.listAgents("team")).toHaveLength(2);
    expect(await store.listParticipants("ws_shared")).toHaveLength(4);
    expect((await store.getOwnedAgentEnrollment("ws_shared", "hum_one", "opencode"))?.tokenHash).toBe("other-agent");
  });
  it("rolls back consumption and earlier inserts on a token uniqueness failure", async () => {
    const { store } = await setup(mode);
    await store.createActorToken({ id: "tok_existing", actor: owner, tokenHash: "one-agent", createdAt: NOW });
    await expect(Promise.resolve().then(() => store.provisionEnrollment(plan("one")))).rejects.toThrow();
    expect((await store.getEnrollmentInvitation(invitation.id))?.consumedAt).toBeUndefined();
    expect(await store.countHumans()).toBe(1);
    expect(await store.listAgents("team")).toHaveLength(0);
    expect(await store.getActorTokenByHash("one-human")).toBeUndefined();
    expect(await store.listContributions("ws_shared")).toHaveLength(1);
  });
  it.each(["expired", "revoked", "owner_changed", "workspace_closed", "wrong_secret"])("rejects %s at the SQL claim boundary", async (reason) => {
    const { store, adapter } = await setup(mode);
    const claim = plan("one");
    if (reason === "expired") claim.claimedAt = END;
    if (reason === "wrong_secret") claim.secretHash = "2".repeat(64);
    const invalidate = async () => {
      if (reason === "revoked") await store.revokeEnrollmentInvitation({ invitationId: invitation.id, workspaceId: "ws_shared", actor: owner, revokedAt: NOW, contribution: contribution("con_revoke") });
      if (reason === "owner_changed") await store.updateParticipantRole("ws_shared", owner, "member");
      if (reason === "workspace_closed") await store.updateWorkspace("ws_shared", { status: "completed", updatedAt: NOW });
    };
    await invalidate();
    expect(await store.provisionEnrollment(claim)).toBe(false);
    expect(await store.countHumans()).toBe(1);
    expect(await store.listAgents("team")).toHaveLength(0);
    expect(await store.getActorTokenByHash("one-human")).toBeUndefined();
    if (adapter) expect(adapter.database.prepare("SELECT COUNT(*) n FROM managed_agent_slots").get()).toEqual({ n: 0 });
  });
  it("has one unique additional managed harness slot, including slots installed at join", async () => {
    const { store } = await setup(mode);
    await store.provisionEnrollment(plan("one"));
    expect(await store.provisionOwnedAgent(agentPlan("duplicate", "codex"))).toBe(false);
    const results = await Promise.all([store.provisionOwnedAgent(agentPlan("second")), store.provisionOwnedAgent(agentPlan("loser"))]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.listAgents("team")).toHaveLength(2);
    expect(await store.listContributions("ws_shared")).toHaveLength(3);
    expect((await store.getOwnedAgentEnrollment("ws_shared", "hum_one", "opencode"))?.receipt.agent.id).toBe("agt_second");
    expect(await store.getActorTokenByHash("duplicate")).toBeUndefined();
    expect(await store.getActorTokenByHash("loser")).toBeUndefined();
  });
  it("additional-agent provisioning rolls back its slot, agent, and history on a token conflict", async () => {
    const { store } = await setup(mode);
    await store.provisionEnrollment(plan("one"));
    await store.createActorToken({ id: "tok_blocked", actor: owner, tokenHash: "second", createdAt: NOW });
    await expect(Promise.resolve().then(() => store.provisionOwnedAgent(agentPlan("second")))).rejects.toThrow();
    expect(await store.getOwnedAgentEnrollment("ws_shared", "hum_one", "opencode")).toBeUndefined();
    expect(await store.getAgent("agt_second")).toBeUndefined();
    expect(await store.listContributions("ws_shared")).toHaveLength(2);
  });
  it("cannot create a slot after the enrolled human loses invite authority", async () => {
    const { store } = await setup(mode);
    await store.provisionEnrollment(plan("one"));
    await store.updateParticipantRole("ws_shared", { actorId: "hum_one", actorType: "human" }, "viewer");
    expect(await store.provisionOwnedAgent(agentPlan("second"))).toBe(false);
    expect(await store.getAgent("agt_second")).toBeUndefined();
    expect(await store.getOwnedAgentEnrollment("ws_shared", "hum_one", "opencode")).toBeUndefined();
  });
  it("revoking consumed replay authority preserves issued credentials and adds history once", async () => {
    const { store } = await setup(mode);
    await store.provisionEnrollment(plan("one"));
    const revoke = { invitationId: invitation.id, workspaceId: "ws_shared", actor: owner, revokedAt: NOW, contribution: contribution("con_revoke") };
    expect(await store.revokeEnrollmentInvitation(revoke)).toBe(true);
    expect(await store.revokeEnrollmentInvitation(revoke)).toBe(false);
    expect((await store.getEnrollmentInvitation(invitation.id))?.revokedAt).toBe(NOW);
    expect((await store.getActorTokenByHash("one-human"))?.revokedAt).toBeUndefined();
    expect(await store.listContributions("ws_shared")).toHaveLength(3);
  });
});

it("checks owner eligibility in the D1 batch after a preflight would have passed", async () => {
  const { store, adapter } = await setup("d1");
  expect((await store.getParticipant("ws_shared", owner))?.role).toBe("owner");
  adapter!.beforeBatch = () => {
    adapter!.database.prepare("UPDATE workspace_participants SET role = 'member' WHERE workspace_id = ? AND actor_id = ?")
      .run("ws_shared", owner.actorId);
    adapter!.beforeBatch = undefined;
  };
  expect(await store.provisionEnrollment(plan("one"))).toBe(false);
  expect(await store.countHumans()).toBe(1);
  expect(await store.listContributions("ws_shared")).toHaveLength(1);
});
