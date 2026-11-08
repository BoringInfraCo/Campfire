import { createCounterIdSource } from "../../src/domain/ids.js";
import type { ActorRef } from "../../src/domain/types.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireStore } from "../../src/store/store.js";

export const MH_NOW = "2026-10-21T12:00:00.000Z";
export const MH_OWNER: ActorRef = { actorId: "hum_owner", actorType: "human" };
export const MH_EXEC: ActorRef = { actorId: "hum_exec", actorType: "human" };
export const mhOwner: ActorContext = { actor: MH_OWNER };

export const SENTINELS = {
  findingSummary: "SENTINEL_FINDING_SUMMARY_a1",
  findingDetail: "SENTINEL_FINDING_DETAIL_a2",
  decisionSummary: "SENTINEL_DECISION_SUMMARY_a3",
  rationale: "SENTINEL_RATIONALE_a4",
  citationNote: "SENTINEL_CITATION_NOTE_a5",
  evidenceNote: "SENTINEL_EVIDENCE_NOTE_a6",
  artifactTitle: "SENTINEL_ARTIFACT_TITLE_a7",
  artifactUri: "https://sentinel-a8.example/SENTINEL_ARTIFACT_URI_a8",
  artifactMeta: "SENTINEL_ARTIFACT_META_a9",
  taskTitle: "SENTINEL_TASK_TITLE_b1",
  taskDescription: "SENTINEL_TASK_DESCRIPTION_b2",
  proposalReason: "SENTINEL_PROPOSAL_REASON_b3",
  withdrawReason: "SENTINEL_WITHDRAW_REASON_b4",
} as const;

const TARGET = {
  repositoryId: "123",
  repositoryName: "acme/api",
  workflowId: "456",
  runId: "789",
  commitSha: "a".repeat(40),
  expectedAttempt: 1,
};

export interface SeededMemory {
  workspaceId: string;
  blockedTaskId: string;
  describedBlockedTaskId: string;
  acceptedDecisionId: string;
  citationId: string;
  citedFindingId: string;
  contradictedFindingId: string;
  evidenceId: string;
  artifactId: string;
  proposalId: string;
  unknownReceiptId: string;
}

/** Seeds one positive case per rule, with sentinel text in every free-text field. */
export function seedMemoryHealth(store: CampfireStore, options: { idSource?: ReturnType<typeof createCounterIdSource> } = {}) {
  let ms = Date.parse(MH_NOW);
  const clock = () => new Date((ms += 1000)).toISOString();
  const service = createCampfireService({ store, idSource: options.idSource ?? createCounterIdSource(), clock });
  store.createOrganization({ id: "org_1", name: "o", createdAt: MH_NOW });
  store.createTeam({ id: "team_1", organizationId: "org_1", name: "t", createdAt: MH_NOW });
  for (const [id, name] of [["hum_owner", "Owner"], ["hum_exec", "Exec"], ["hum_outsider", "Outsider"]] as const) {
    store.createHuman({ id, teamId: "team_1", displayName: name, createdAt: MH_NOW });
  }
  const ws = service.createWorkspace(mhOwner, { teamId: "team_1", name: "w" }).id;
  service.inviteToWorkspace(mhOwner, { workspaceId: ws, actor: MH_EXEC, role: "member" });
  service.joinWorkspace({ actor: MH_EXEC }, { workspaceId: ws });

  const blocked = service.createTask(mhOwner, { workspaceId: ws, title: SENTINELS.taskTitle });
  service.updateTask(mhOwner, { taskId: blocked.id, status: "blocked" });
  const described = service.createTask(mhOwner, {
    workspaceId: ws,
    title: "near miss",
    description: SENTINELS.taskDescription,
  });
  service.updateTask(mhOwner, { taskId: described.id, status: "blocked" });

  const cited = service.addFinding(mhOwner, { workspaceId: ws, summary: SENTINELS.findingSummary, detail: SENTINELS.findingDetail });
  const decision = service.addDecision(mhOwner, {
    workspaceId: ws,
    summary: SENTINELS.decisionSummary,
    rationale: SENTINELS.rationale,
  });
  const citation = service.citeDecisionBasis(mhOwner, {
    decisionId: decision.id,
    findingId: cited.id,
    note: SENTINELS.citationNote,
  });
  service.acceptDecision(mhOwner, decision.id);

  const contradicted = service.addFinding(mhOwner, { workspaceId: ws, summary: "plain finding" });
  const artifact = service.addArtifact(mhOwner, {
    workspaceId: ws,
    type: "log",
    title: SENTINELS.artifactTitle,
    uriOrPath: SENTINELS.artifactUri,
    metadata: { note: SENTINELS.artifactMeta },
  });
  const evidence = service.citeFindingEvidence(mhOwner, {
    findingId: contradicted.id,
    artifactId: artifact.id,
    relation: "contradicts",
    note: SENTINELS.evidenceNote,
  });

  const task = service.createTask(mhOwner, { workspaceId: ws, title: "ci task" });
  const proposal = service.propose_action(mhOwner, {
    workspaceId: ws,
    target: { ...TARGET },
    executor: { ...MH_EXEC },
    reason: SENTINELS.proposalReason,
    taskId: task.id,
    findingIds: [contradicted.id],
    requestKey: "k1",
  });
  const approved = service.review_action(mhOwner, {
    workspaceId: ws,
    proposalId: proposal.proposal.id,
    revision: 1,
    intentDigest: proposal.proposal.intentDigest,
    decision: "approve",
    requestKey: "k2",
  });
  const reserved = service.reserve_action_execution({ actor: MH_EXEC }, {
    workspaceId: ws,
    proposalId: approved.proposal.id,
    revision: 2,
    intentDigest: approved.proposal.intentDigest,
    requestKey: "k3",
  });
  const receipt = service.record_action_outcome({ actor: MH_EXEC }, {
    workspaceId: ws,
    proposalId: reserved.proposal.id,
    revision: 3,
    intentDigest: reserved.proposal.intentDigest,
    outcome: "unknown",
    providerRef: { repositoryId: "123", workflowId: "456", runId: "789" },
    requestKey: "k4",
  });

  const seeded: SeededMemory = {
    workspaceId: ws,
    blockedTaskId: blocked.id,
    describedBlockedTaskId: described.id,
    acceptedDecisionId: decision.id,
    citationId: citation.id,
    citedFindingId: cited.id,
    contradictedFindingId: contradicted.id,
    evidenceId: evidence.id,
    artifactId: artifact.id,
    proposalId: proposal.proposal.id,
    unknownReceiptId: receipt.id,
  };
  return { service, seeded, clock };
}
