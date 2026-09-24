import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import type { SeededFixture } from "../../src/bootstrap/seed.js";
import { hashToken } from "../../src/service/tokens.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";

let store: CampfireStore;

beforeEach(() => {
  store = openInMemoryStore();
});

afterEach(() => {
  store.close();
});

describe("seedFixture", () => {
  it("is idempotent and returns the same fixture", () => {
    const first: SeededFixture = seedFixture(store);
    const second: SeededFixture = seedFixture(store);

    expect(second).toEqual(first);
    expect(store.listHumans(FIXTURE.teamId)).toHaveLength(2);
    expect(store.listAgents(FIXTURE.teamId)).toHaveLength(2);
    expect(store.listWorkspaces()).toHaveLength(2);
  });

  it("seeds the four billing participants", () => {
    seedFixture(store);

    const billing = store.listParticipants(FIXTURE.workspaces.billing);
    expect(billing.map((p) => `${p.actor.actorId}:${p.actor.actorType}:${p.role}`).sort()).toEqual(
      [
        `${FIXTURE.humans.sergio}:human:owner`,
        `${FIXTURE.agents.codexSergio}:agent:agent`,
        `${FIXTURE.humans.alice}:human:member`,
        `${FIXTURE.agents.opencodeAlice}:agent:agent`,
      ].sort(),
    );
  });

  it("keeps the unrelated workspace to Sergio only", () => {
    seedFixture(store);

    const participants = store.listParticipants(FIXTURE.workspaces.unrelated);
    expect(participants).toHaveLength(1);
    expect(participants[0]?.actor).toEqual({ actorId: FIXTURE.humans.sergio, actorType: "human" });
    expect(participants[0]?.role).toBe("owner");
  });

  it("stores the sentinel in the unrelated finding", () => {
    seedFixture(store);

    const findings = store.listFindings(FIXTURE.workspaces.unrelated);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.summary).toContain(FIXTURE.unrelatedFindingSentinel);
  });

  it("leaves the billing workspace without findings, tasks, decisions, or artifacts", () => {
    seedFixture(store);

    expect(store.listFindings(FIXTURE.workspaces.billing)).toEqual([]);
    expect(store.listTasks(FIXTURE.workspaces.billing)).toEqual([]);
    expect(store.listDecisions(FIXTURE.workspaces.billing)).toEqual([]);
    expect(store.listArtifacts(FIXTURE.workspaces.billing)).toEqual([]);
  });

  it("lists only the billing workspace for Alice's agent", () => {
    seedFixture(store);

    const workspaces = store.listWorkspacesForActor({
      actorId: FIXTURE.agents.opencodeAlice,
      actorType: "agent",
    });
    expect(workspaces.map((w) => w.id)).toEqual([FIXTURE.workspaces.billing]);
  });

  it("records contributions for billing workspace create, joins, and goal", () => {
    seedFixture(store);

    const billing = store.listContributions(FIXTURE.workspaces.billing);
    expect(billing.length).toBeGreaterThan(0);
    expect(billing.map((entry) => [entry.action, entry.objectType, entry.objectId])).toEqual([
      ["create", "workspace", FIXTURE.workspaces.billing],
      ["join", "participant", FIXTURE.humans.sergio],
      ["join", "participant", FIXTURE.agents.codexSergio],
      ["join", "participant", FIXTURE.humans.alice],
      ["join", "participant", FIXTURE.agents.opencodeAlice],
      ["create", "goal", FIXTURE.goals.billing],
    ]);
    expect(billing.map((entry) => entry.id)).toEqual([
      "con_seed_ws_billing_deploy_create",
      "con_seed_ws_billing_deploy_join_hum_sergio",
      "con_seed_ws_billing_deploy_join_agt_codex_sergio",
      "con_seed_ws_billing_deploy_join_hum_alice",
      "con_seed_ws_billing_deploy_join_agt_opencode_alice",
      "con_seed_ws_billing_deploy_goal",
    ]);
  });

  it("records a contribution for the unrelated finding", () => {
    seedFixture(store);

    const unrelated = store.listContributions(FIXTURE.workspaces.unrelated);
    expect(unrelated.some((entry) => entry.objectType === "finding")).toBe(true);
    expect(unrelated.find((entry) => entry.objectType === "finding")?.payload?.summary).toContain(
      FIXTURE.unrelatedFindingSentinel,
    );
  });

  it("inserts fixture actor token hashes", () => {
    seedFixture(store);
    expect(store.getActorTokenByHash(hashToken(FIXTURE.tokens.sergio))?.actor.actorId).toBe(
      FIXTURE.humans.sergio,
    );
    expect(store.getActorTokenByHash(hashToken(FIXTURE.tokens.alice))?.actor.actorId).toBe(
      FIXTURE.humans.alice,
    );
    expect(store.getActorTokenByHash(hashToken(FIXTURE.tokens.codexSergio))?.actor.actorId).toBe(
      FIXTURE.agents.codexSergio,
    );
    expect(store.getActorTokenByHash(hashToken(FIXTURE.tokens.opencodeAlice))?.actor.actorId).toBe(
      FIXTURE.agents.opencodeAlice,
    );
  });

  it("does not duplicate contributions when seed is run twice", () => {
    seedFixture(store);
    const firstBilling = store.listContributions(FIXTURE.workspaces.billing);
    const firstUnrelated = store.listContributions(FIXTURE.workspaces.unrelated);

    seedFixture(store);

    expect(store.listContributions(FIXTURE.workspaces.billing)).toHaveLength(firstBilling.length);
    expect(store.listContributions(FIXTURE.workspaces.unrelated)).toHaveLength(firstUnrelated.length);
  });
});
