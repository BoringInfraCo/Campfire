import type { ActorRef, ContributionAction, ContributionObjectType } from "../domain/types.js";
import { hashToken } from "../service/tokens.js";
import type { CampfireStore } from "../store/store.js";

export const FIXTURE = {
  organizationId: "org_boringinfra",
  teamId: "team_engineering",
  humans: { sergio: "hum_sergio", alice: "hum_alice" },
  agents: { codexSergio: "agt_codex_sergio", opencodeAlice: "agt_opencode_alice" },
  workspaces: { billing: "ws_billing_deploy", unrelated: "ws_auth_migration" },
  goals: { billing: "goal_billing_deploy", unrelated: "goal_auth_migration" },
  tokens: {
    sergio: "cft_fixture_hum_sergio",
    alice: "cft_fixture_hum_alice",
    codexSergio: "cft_fixture_agt_codex_sergio",
    opencodeAlice: "cft_fixture_agt_opencode_alice",
  },
  unrelatedFindingSentinel: "UNRELATED_FINDING_SENTINEL_auth_token_rotation",
} as const;

export interface SeededFixture {
  organizationId: string;
  teamId: string;
  humanIds: { sergio: string; alice: string };
  agentIds: { codexSergio: string; opencodeAlice: string };
  workspaceIds: { billing: string; unrelated: string };
  goalIds: { billing: string; unrelated: string };
}

const SERGIO: ActorRef = { actorId: FIXTURE.humans.sergio, actorType: "human" };
const ALICE: ActorRef = { actorId: FIXTURE.humans.alice, actorType: "human" };
const CODEX_SERGIO: ActorRef = { actorId: FIXTURE.agents.codexSergio, actorType: "agent" };
const OPENCODE_ALICE: ActorRef = { actorId: FIXTURE.agents.opencodeAlice, actorType: "agent" };

const UNRELATED_FINDING_ID = "find_auth_token_rotation";

function toSeededFixture(): SeededFixture {
  return {
    organizationId: FIXTURE.organizationId,
    teamId: FIXTURE.teamId,
    humanIds: { sergio: FIXTURE.humans.sergio, alice: FIXTURE.humans.alice },
    agentIds: { codexSergio: FIXTURE.agents.codexSergio, opencodeAlice: FIXTURE.agents.opencodeAlice },
    workspaceIds: { billing: FIXTURE.workspaces.billing, unrelated: FIXTURE.workspaces.unrelated },
    goalIds: { billing: FIXTURE.goals.billing, unrelated: FIXTURE.goals.unrelated },
  };
}

function incrementIso(iso: string): string {
  return new Date(new Date(iso).getTime() + 1).toISOString();
}

function seedContribution(
  store: CampfireStore,
  input: {
    id: string;
    workspaceId: string;
    actor: ActorRef;
    action: ContributionAction;
    objectType: ContributionObjectType;
    objectId: string;
    payload?: Record<string, unknown>;
    createdAt: string;
  },
): void {
  store.createContribution(input);
}

export function seedFixture(store: CampfireStore, options?: { clock?: () => string }): SeededFixture {
  if (store.getOrganization(FIXTURE.organizationId) !== undefined) {
    return toSeededFixture();
  }

  const baseClock = options?.clock ?? (() => new Date().toISOString());

  // Timestamps drive append-only ordering, so equal or backwards wall-clock
  // readings are bumped forward to keep every inserted row strictly increasing.
  let previous = "";
  const clock = (): string => {
    const candidate = baseClock();
    previous = previous === "" || candidate > previous ? candidate : incrementIso(previous);
    return previous;
  };

  store.createOrganization({ id: FIXTURE.organizationId, name: "Boring Infra Co.", createdAt: clock() });
  store.createTeam({
    id: FIXTURE.teamId,
    organizationId: FIXTURE.organizationId,
    name: "Engineering",
    createdAt: clock(),
  });

  store.createHuman({ id: FIXTURE.humans.sergio, teamId: FIXTURE.teamId, displayName: "Sergio", createdAt: clock() });
  store.createHuman({ id: FIXTURE.humans.alice, teamId: FIXTURE.teamId, displayName: "Alice", createdAt: clock() });

  store.createAgent({
    id: FIXTURE.agents.codexSergio,
    teamId: FIXTURE.teamId,
    humanId: FIXTURE.humans.sergio,
    name: "Codex",
    harness: "codex",
    createdAt: clock(),
  });
  store.createAgent({
    id: FIXTURE.agents.opencodeAlice,
    teamId: FIXTURE.teamId,
    humanId: FIXTURE.humans.alice,
    name: "OpenCode",
    harness: "opencode",
    createdAt: clock(),
  });

  const tokenCreatedAt = clock();
  store.createActorToken({
    id: "tok_fixture_hum_sergio",
    actor: SERGIO,
    tokenHash: hashToken(FIXTURE.tokens.sergio),
    createdAt: tokenCreatedAt,
  });
  store.createActorToken({
    id: "tok_fixture_hum_alice",
    actor: ALICE,
    tokenHash: hashToken(FIXTURE.tokens.alice),
    createdAt: tokenCreatedAt,
  });
  store.createActorToken({
    id: "tok_fixture_agt_codex_sergio",
    actor: CODEX_SERGIO,
    tokenHash: hashToken(FIXTURE.tokens.codexSergio),
    createdAt: tokenCreatedAt,
  });
  store.createActorToken({
    id: "tok_fixture_agt_opencode_alice",
    actor: OPENCODE_ALICE,
    tokenHash: hashToken(FIXTURE.tokens.opencodeAlice),
    createdAt: tokenCreatedAt,
  });

  const billingCreatedAt = clock();
  store.createWorkspace({
    id: FIXTURE.workspaces.billing,
    teamId: FIXTURE.teamId,
    name: "billing-deploy-failure",
    status: "active",
    createdBy: SERGIO,
    createdAt: billingCreatedAt,
    updatedAt: billingCreatedAt,
  });
  seedContribution(store, {
    id: "con_seed_ws_billing_deploy_create",
    workspaceId: FIXTURE.workspaces.billing,
    actor: SERGIO,
    action: "create",
    objectType: "workspace",
    objectId: FIXTURE.workspaces.billing,
    payload: { name: "billing-deploy-failure" },
    createdAt: billingCreatedAt,
  });

  const sergioBillingJoinedAt = clock();
  store.addParticipant({
    workspaceId: FIXTURE.workspaces.billing,
    actor: SERGIO,
    role: "owner",
    joinedAt: sergioBillingJoinedAt,
  });
  seedContribution(store, {
    id: "con_seed_ws_billing_deploy_join_hum_sergio",
    workspaceId: FIXTURE.workspaces.billing,
    actor: SERGIO,
    action: "join",
    objectType: "participant",
    objectId: FIXTURE.humans.sergio,
    payload: { role: "owner" },
    createdAt: sergioBillingJoinedAt,
  });

  const codexBillingJoinedAt = clock();
  store.addParticipant({
    workspaceId: FIXTURE.workspaces.billing,
    actor: CODEX_SERGIO,
    role: "agent",
    joinedAt: codexBillingJoinedAt,
  });
  seedContribution(store, {
    id: "con_seed_ws_billing_deploy_join_agt_codex_sergio",
    workspaceId: FIXTURE.workspaces.billing,
    actor: CODEX_SERGIO,
    action: "join",
    objectType: "participant",
    objectId: FIXTURE.agents.codexSergio,
    payload: { role: "agent" },
    createdAt: codexBillingJoinedAt,
  });

  const aliceBillingJoinedAt = clock();
  store.addParticipant({
    workspaceId: FIXTURE.workspaces.billing,
    actor: ALICE,
    role: "member",
    joinedAt: aliceBillingJoinedAt,
  });
  seedContribution(store, {
    id: "con_seed_ws_billing_deploy_join_hum_alice",
    workspaceId: FIXTURE.workspaces.billing,
    actor: ALICE,
    action: "join",
    objectType: "participant",
    objectId: FIXTURE.humans.alice,
    payload: { role: "member" },
    createdAt: aliceBillingJoinedAt,
  });

  const opencodeBillingJoinedAt = clock();
  store.addParticipant({
    workspaceId: FIXTURE.workspaces.billing,
    actor: OPENCODE_ALICE,
    role: "agent",
    joinedAt: opencodeBillingJoinedAt,
  });
  seedContribution(store, {
    id: "con_seed_ws_billing_deploy_join_agt_opencode_alice",
    workspaceId: FIXTURE.workspaces.billing,
    actor: OPENCODE_ALICE,
    action: "join",
    objectType: "participant",
    objectId: FIXTURE.agents.opencodeAlice,
    payload: { role: "agent" },
    createdAt: opencodeBillingJoinedAt,
  });

  const billingGoalAt = clock();
  store.createGoal({
    id: FIXTURE.goals.billing,
    workspaceId: FIXTURE.workspaces.billing,
    title: "Determine why billing-service deploys fail and prepare the correct remediation.",
    status: "active",
    createdBy: SERGIO,
    createdAt: billingGoalAt,
    updatedAt: billingGoalAt,
  });
  seedContribution(store, {
    id: "con_seed_ws_billing_deploy_goal",
    workspaceId: FIXTURE.workspaces.billing,
    actor: SERGIO,
    action: "create",
    objectType: "goal",
    objectId: FIXTURE.goals.billing,
    payload: { title: "Determine why billing-service deploys fail and prepare the correct remediation." },
    createdAt: billingGoalAt,
  });

  const unrelatedCreatedAt = clock();
  store.createWorkspace({
    id: FIXTURE.workspaces.unrelated,
    teamId: FIXTURE.teamId,
    name: "auth-token-rotation",
    status: "active",
    createdBy: SERGIO,
    createdAt: unrelatedCreatedAt,
    updatedAt: unrelatedCreatedAt,
  });
  seedContribution(store, {
    id: "con_seed_ws_auth_migration_create",
    workspaceId: FIXTURE.workspaces.unrelated,
    actor: SERGIO,
    action: "create",
    objectType: "workspace",
    objectId: FIXTURE.workspaces.unrelated,
    payload: { name: "auth-token-rotation" },
    createdAt: unrelatedCreatedAt,
  });

  const sergioUnrelatedJoinedAt = clock();
  store.addParticipant({
    workspaceId: FIXTURE.workspaces.unrelated,
    actor: SERGIO,
    role: "owner",
    joinedAt: sergioUnrelatedJoinedAt,
  });
  seedContribution(store, {
    id: "con_seed_ws_auth_migration_join_hum_sergio",
    workspaceId: FIXTURE.workspaces.unrelated,
    actor: SERGIO,
    action: "join",
    objectType: "participant",
    objectId: FIXTURE.humans.sergio,
    payload: { role: "owner" },
    createdAt: sergioUnrelatedJoinedAt,
  });

  const unrelatedGoalAt = clock();
  store.createGoal({
    id: FIXTURE.goals.unrelated,
    workspaceId: FIXTURE.workspaces.unrelated,
    title: "Investigate auth service token rotation failures.",
    status: "active",
    createdBy: SERGIO,
    createdAt: unrelatedGoalAt,
    updatedAt: unrelatedGoalAt,
  });
  seedContribution(store, {
    id: "con_seed_ws_auth_migration_goal",
    workspaceId: FIXTURE.workspaces.unrelated,
    actor: SERGIO,
    action: "create",
    objectType: "goal",
    objectId: FIXTURE.goals.unrelated,
    payload: { title: "Investigate auth service token rotation failures." },
    createdAt: unrelatedGoalAt,
  });

  const unrelatedFindingAt = clock();
  store.createFinding({
    id: UNRELATED_FINDING_ID,
    workspaceId: FIXTURE.workspaces.unrelated,
    summary: `Auth token rotation: old signing key retired before replica flush. ${FIXTURE.unrelatedFindingSentinel}`,
    createdBy: SERGIO,
    createdAt: unrelatedFindingAt,
  });
  seedContribution(store, {
    id: "con_seed_ws_auth_migration_finding",
    workspaceId: FIXTURE.workspaces.unrelated,
    actor: SERGIO,
    action: "create",
    objectType: "finding",
    objectId: UNRELATED_FINDING_ID,
    payload: {
      summary: `Auth token rotation: old signing key retired before replica flush. ${FIXTURE.unrelatedFindingSentinel}`,
    },
    createdAt: unrelatedFindingAt,
  });

  return toSeededFixture();
}
