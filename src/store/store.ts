/**
 * Persistence boundary.
 *
 * The domain/service layer depends on this interface only. The SQLite
 * implementation lives in `sqlite-store.ts`. Keeping this explicit avoids
 * leaking storage details into collaboration semantics (AGENTS.md invariant 7).
 */
import type {
  ActionProposal,
  ActionReceipt,
} from "../domain/action-proposal.js";
import type {
  GithubIngressDeliveryRecord,
  GithubIngressReceiptRecord,
  GithubSourceBindingRecord,
} from "./action-proposal-records.js";
import type {
  DomainEventRecord,
  WebhookDeliveryCounts,
  WebhookDeliveryRecord,
} from "../domain/events.js";
import type {
  ActorRef,
  ActorToken,
  Agent,
  AgentSession,
  Artifact,
  Contribution,
  NewContribution,
  Decision,
  DecisionCitation,
  DecisionTransitionKind,
  Finding,
  FindingEvidence,
  FindingTransitionKind,
  FindingCurrentness,
  Goal,
  Human,
  Organization,
  ParticipantRole,
  Task,
  Team,
  Workspace,
  WorkspaceInvite,
  WorkspaceParticipant,
  WorkspaceStatus,
  GoalStatus,
  TaskStatus,
  DecisionStatus,
} from "../domain/types.js";
import type { EnrollmentHarness, EnrollmentInvitation, EnrollmentProvisionPlan, OwnedAgentEnrollmentRecord, OwnedAgentProvisionPlan, RevokeEnrollmentInvitationPlan } from "../domain/enrollment.js";
import type {
  ContributionPageQuery,
  ContributionWindow,
  ObjectPage,
  ObjectPageQuery,
  ParticipantObjectPage,
  ParticipantPageQuery,
  RecordHistoryQuery,
} from "./context-queries.js";
import type { RecallSectionName } from "../domain/recall.js";
import type {
  RecallDecisionSetPage,
  RecallDecisionSetQuery,
  RecallGoalRow,
  RecallPage,
  RecallPageQuery,
} from "./recall-queries.js";

export interface WorkspacePatch {
  name?: string;
  description?: string;
  status?: WorkspaceStatus;
  updatedAt: string;
}

export interface GoalPatch {
  title?: string;
  description?: string;
  status?: GoalStatus;
  updatedAt: string;
}

export interface TaskPatch {
  title?: string;
  description?: string;
  status?: TaskStatus;
  assignee?: ActorRef | null;
  updatedAt: string;
}

export interface DecisionPatch {
  summary?: string;
  rationale?: string;
  status?: DecisionStatus;
  approvedBy?: ActorRef | null;
  updatedAt: string;
}

/** One committed finding correction. The primary key is the finding being left behind. */
export interface FindingTransitionClaim {
  findingId: string;
  successorId?: string;
  kind: FindingTransitionKind;
  reason: string;
  actor: ActorRef;
  agentSessionId?: string;
  createdAt: string;
}

/** One committed decision transition. The primary key is the decision being left behind. */
export interface DecisionTransitionClaim {
  decisionId: string;
  successorId?: string;
  kind: DecisionTransitionKind;
  reason: string;
  actor: ActorRef;
  agentSessionId?: string;
  createdAt: string;
}

export interface ActionProposalPatch {
  status: ActionProposal["status"];
  revision: number;
  updatedAt: string;
  reviewActorId?: string | null;
  reviewActorType?: string | null;
  reviewSessionId?: string | null;
  reviewAt?: string | null;
  reviewReason?: string | null;
  reviewRevision?: number | null;
  reservationActorId?: string | null;
  reservationActorType?: string | null;
  reservationSessionId?: string | null;
  reservedAt?: string | null;
  reservationId?: string | null;
  reservationRevision?: number | null;
  evidenceSnapshotJson?: string | null;
}

export interface ActionProposalPageQuery {
  limit: number;
  after?: { at: string; id: string };
}

export interface ActionProposalPageResult {
  items: ActionProposal[];
  total: number;
  hasMore: boolean;
  next?: { at: string; id: string };
}

export interface ActionReceiptPageQuery {
  limit: number;
  after?: { at: string; id: string };
}

export interface ActionReceiptPageResult {
  items: ActionReceipt[];
  total: number;
  hasMore: boolean;
  next?: { at: string; id: string };
}

export interface ActionMutationReceipt {
  workspaceId: string;
  actorId: string;
  actorType: "human" | "agent";
  method: string;
  requestKey: string;
  inputDigest: string;
  /** JSON-serialized successful result returned for equal-input replays. */
  resultJson: string;
  createdAt: string;
}

export interface CampfireStore {
  // --- identity ---
  createOrganization(organization: Organization): void;
  getOrganization(id: string): Organization | undefined;

  createTeam(team: Team): void;
  getTeam(id: string): Team | undefined;

  createHuman(human: Human): void;
  getHuman(id: string): Human | undefined;
  listHumans(teamId: string): Human[];
  countHumans(): number;

  createAgent(agent: Agent): void;
  getAgent(id: string): Agent | undefined;
  listAgents(teamId: string): Agent[];

  createAgentSession(session: AgentSession): void;
  getAgentSession(id: string): AgentSession | undefined;
  endAgentSession(id: string, endedAt: string): void;
  listAgentSessions(workspaceId: string): AgentSession[];

  // --- workspaces ---
  createWorkspace(workspace: Workspace): void;
  getWorkspace(id: string): Workspace | undefined;
  updateWorkspace(id: string, patch: WorkspacePatch): void;
  listWorkspaces(): Workspace[];
  listWorkspacesForActor(actor: ActorRef): Workspace[];

  addParticipant(participant: WorkspaceParticipant): void;
  getParticipant(workspaceId: string, actor: ActorRef): WorkspaceParticipant | undefined;
  listParticipants(workspaceId: string): WorkspaceParticipant[];
  /** Workspace-bounded keyset. Does not load `get_workspace`. */
  pageParticipants(workspaceId: string, query: ParticipantPageQuery): ParticipantObjectPage;
  countParticipants(workspaceId: string, humanOwnerId?: string): number;
  updateParticipantRole(workspaceId: string, actor: ActorRef, role: ParticipantRole): void;

  // --- contribution objects ---
  createGoal(goal: Goal): void;
  getGoal(id: string): Goal | undefined;
  getGoalForWorkspace(workspaceId: string): Goal | undefined;
  updateGoal(id: string, patch: GoalPatch): void;

  createTask(task: Task): void;
  getTask(id: string): Task | undefined;
  listTasks(workspaceId: string): Task[];
  updateTask(id: string, patch: TaskPatch): void;

  createFinding(finding: Finding): void;
  getFinding(id: string): Finding | undefined;
  listFindings(workspaceId: string): Finding[];
  countFindings(workspaceId: string, currentness?: FindingCurrentness | "all"): number;
  countHistoricalFindings(workspaceId: string): number;
  listFindingEvidence(findingIds: readonly string[]): FindingEvidence[];
  getFindingEvidence(id: string): FindingEvidence | undefined;
  insertFindingEvidence(evidence: FindingEvidence): void;
  deleteFindingEvidence(findingId: string, artifactId: string): boolean;
  /** Inserts the transition and updates the finding. Must run inside a transaction. */
  claimFindingTransition(claim: FindingTransitionClaim): void;

  createDecision(decision: Decision): void;
  getDecision(id: string): Decision | undefined;
  listDecisions(workspaceId: string): Decision[];
  updateDecision(id: string, patch: DecisionPatch): void;
  listDecisionCitations(decisionIds: readonly string[]): DecisionCitation[];
  getDecisionCitation(id: string): DecisionCitation | undefined;
  /** Cited finding ids whose currentness is not current. */
  listStaleCitedFindingIds(decisionIds: readonly string[]): string[];
  insertDecisionCitation(citation: DecisionCitation): void;
  deleteDecisionCitation(decisionId: string, findingId: string): boolean;
  /** Inserts the transition and supersedes the decision. Must run inside a transaction. */
  claimDecisionTransition(claim: DecisionTransitionClaim): void;

  createArtifact(artifact: Artifact): void;
  getArtifact(id: string): Artifact | undefined;
  listArtifacts(workspaceId: string): Artifact[];

  // --- activity / provenance ---
  /** Store assigns `appendPosition`. A caller-supplied position is ignored. */
  createContribution(contribution: Omit<Contribution, "appendPosition">): void;
  getContribution(id: string): Contribution | undefined;
  listContributions(workspaceId: string): Contribution[];
  /** Highest append position in the workspace, or 0 when it has no contributions. */
  maxAppendPosition(workspaceId: string): number;

  // --- actor tokens (hashes only) ---
  createActorToken(token: ActorToken): void;
  getActorTokenByHash(tokenHash: string): ActorToken | undefined;
  revokeActorToken(id: string, revokedAt: string): void;

  // --- workspace invites ---
  createInvite(invite: WorkspaceInvite): void;
  getOpenInvite(workspaceId: string, actor: ActorRef): WorkspaceInvite | undefined;
  consumeInvite(id: string, consumedAt: string): void;
  listInvites(workspaceId: string): WorkspaceInvite[];

  // Guarded Sprint 020 administrative provisioning. False means this execution
  // did not claim authority; callers may inspect a winning receipt for replay.
  createEnrollmentInvitation(invitation: EnrollmentInvitation, contribution: NewContribution): boolean;
  getEnrollmentInvitation(id: string): EnrollmentInvitation | undefined;
  getEnrollmentInvitationByHash(secretHash: string): EnrollmentInvitation | undefined;
  revokeEnrollmentInvitation(input: RevokeEnrollmentInvitationPlan): boolean;
  provisionEnrollment(plan: EnrollmentProvisionPlan): boolean;
  getOwnedAgentEnrollment(workspaceId: string, humanId: string, harness: EnrollmentHarness): OwnedAgentEnrollmentRecord | undefined;
  provisionOwnedAgent(plan: OwnedAgentProvisionPlan): boolean;

  // --- domain events ---
  createDomainEvent(event: DomainEventRecord): void;
  getDomainEvent(id: string): DomainEventRecord | undefined;
  listDomainEventsForWorkspace(workspaceId: string): DomainEventRecord[];

  // Operational delivery state, not Contributions.
  createWebhookDelivery(delivery: WebhookDeliveryRecord): void;
  getWebhookDelivery(id: string): WebhookDeliveryRecord | undefined;
  listWebhookDeliveries(): WebhookDeliveryRecord[];
  countWebhookDeliveries(): WebhookDeliveryCounts;

  /**
   * Due deliveries for one bridge, oldest first.
   *
   * `limit` bounds how many rows the query returns (PSA-001 / P1). It is part of
   * the read rather than a post-read slice: a backlog must not be read and
   * mapped in full only for the caller to drop the tail. Callers that page
   * through a backlog must pass their per-sweep batch size, not a page of a
   * larger read.
   */
  listDueWebhookDeliveries(input: {
    bridgeId: string;
    now: string;
    leaseBefore: string;
    configFingerprint: string;
    limit: number;
  }): WebhookDeliveryRecord[];

  claimWebhookDelivery(
    id: string,
    input: { now: string; claimToken: string; leaseBefore: string; configFingerprint: string },
  ): WebhookDeliveryRecord | undefined;

  markWebhookDeliveryDelivered(id: string, claimToken: string, deliveredAt: string): boolean;

  markWebhookDeliveryRetry(
    id: string,
    claimToken: string,
    input: {
      attemptCount: number;
      status: "pending" | "exhausted";
      nextAttemptAt?: string;
      lastError?: string;
      updatedAt: string;
    },
  ): boolean;

  // --- infrastructure ---
  transaction<T>(fn: () => T): T;
  close(): void;

  /**
   * Bounded CTX-001 reads. `limit` is the page size (1–100). Implementations
   * fetch one extra row to set `hasMore` and must not read the rest of the table.
   * `total` is the authorized workspace count for the same filter, not the page length.
   */
  countObjectsByStatus(kind: "decisions" | "tasks", workspaceId: string): Array<{ status: string; count: number }>;
  countObjects(kind: "findings" | "artifacts" | "contributions", workspaceId: string): number;
  pageDecisions(workspaceId: string, query: ObjectPageQuery & { statuses?: DecisionStatus[] }): ObjectPage<Decision>;
  countDecisions(workspaceId: string, statuses?: DecisionStatus[]): number;
  pageTasks(workspaceId: string, query: ObjectPageQuery & { statuses?: TaskStatus[] }): ObjectPage<Task>;
  countTasks(workspaceId: string, statuses?: TaskStatus[]): number;
  pageFindings(
    workspaceId: string,
    query: ObjectPageQuery & { currentness?: FindingCurrentness | "all" },
  ): ObjectPage<Finding>;
  pageArtifacts(workspaceId: string, query: ObjectPageQuery): ObjectPage<Artifact>;
  /**
   * One rcl-1 page. `limit` is 1–50. The implementation fetches one extra row
   * and does not load the rest of the match set into application memory.
   */
  recallSection(workspaceId: string, section: RecallSectionName, query: RecallPageQuery): RecallPage;
  /** The workspace goal, with whether its title or description matched. Absent when the workspace has no goal. */
  recallGoal(workspaceId: string, normalizedQuery: string): RecallGoalRow | undefined;
  /**
   * Every decision the same normalized query matches, current and historical, in
   * rcl-1 order. Independent of the section `limit` and `cursor`, so paging a
   * section never changes this page.
   */
  recallDecisionSet(workspaceId: string, query: RecallDecisionSetQuery): RecallDecisionSetPage;
  pageContributions(workspaceId: string, query: ContributionPageQuery): ObjectPage<Contribution>;
  /**
   * ACT-001 action proposals. `updateActionProposal` is a guarded claim: it
   * applies only when the row still carries `expectedRevision` (and, when
   * given, `expectedStatus`), returning whether this caller won the claim.
   * Concurrent SQLite writers serialize in the transaction; concurrent D1
   * batches fail the whole batch when the guard matches no row.
   */
  createActionProposal(proposal: ActionProposal, intentJson: string, targetKey: string): void;
  getActionProposal(id: string): ActionProposal | undefined;
  countActionProposals(workspaceId: string): number;
  pageActionProposals(workspaceId: string, query: ActionProposalPageQuery): ActionProposalPageResult;
  updateActionProposal(
    id: string,
    patch: ActionProposalPatch,
    expected: { revision: number; status?: ActionProposal["status"] },
  ): boolean;
  /**
   * Workspace-wide unique provider target key. Never deleted: the key
   * survives terminal receipts and crashes. Throws `Conflict` on duplicates.
   */
  createActionTargetReservation(input: {
    workspaceId: string;
    targetKey: string;
    proposalId: string;
    reservationId: string;
    reservedAt: string;
  }): void;
  getActionTargetReservation(
    workspaceId: string,
    targetKey: string,
  ): { proposalId: string; reservationId: string } | undefined;
  /** Append-only submission/reconciliation receipts. Duplicate keys conflict per recorder. */
  createActionReceipt(receipt: ActionReceipt): void;
  getActionReceipt(id: string): ActionReceipt | undefined;
  getActionReceiptByRequestKey(proposalId: string, actor: ActorRef, requestKey: string): ActionReceipt | undefined;
  countActionReceipts(workspaceId: string, proposalId: string): number;
  pageActionReceipts(
    workspaceId: string,
    proposalId: string,
    query: ActionReceiptPageQuery,
  ): ActionReceiptPageResult;
  /** Mutation idempotency scoped to workspace, actor, method, and requestKey. */
  getActionMutationReceipt(
    workspaceId: string,
    actorId: string,
    actorType: "human" | "agent",
    method: string,
    requestKey: string,
  ): ActionMutationReceipt | undefined;
  putActionMutationReceipt(receipt: ActionMutationReceipt): void;
  /**
   * ACT-001 signed GitHub ingress. Binding is persisted on first use.
   * Delivery identity and semantic attempt keys survive secret rotation.
   */
  getGithubSourceBinding(sourceId: string): GithubSourceBindingRecord | undefined;
  createGithubSourceBinding(binding: GithubSourceBindingRecord): void;
  listGithubSourceBindings(workspaceId: string): GithubSourceBindingRecord[];
  updateGithubSourceBindingFingerprint(sourceId: string, authorityFingerprint: string): void;
  getGithubIngressDelivery(sourceId: string, deliveryId: string): GithubIngressDeliveryRecord | undefined;
  createGithubIngressDelivery(delivery: GithubIngressDeliveryRecord): void;
  getGithubIngressReceiptByAttempt(
    workspaceId: string,
    attemptKey: string,
  ): GithubIngressReceiptRecord | undefined;
  listGithubIngressReceiptsForProposal(
    workspaceId: string,
    proposalId: string,
  ): GithubIngressReceiptRecord[];
  createGithubIngressReceipt(receipt: GithubIngressReceiptRecord): void;
  /**
   * Matching contributions for one object, newest append position first, at or
   * below `tip`. Does not scan the workspace activity list in memory.
   */
  pageRecordHistory(
    workspaceId: string,
    query: RecordHistoryQuery,
  ): { items: Contribution[]; total: number; hasMore: boolean };
  /** Newest `limit` contributions in the workspace, chronological. `total` is the workspace count. */
  listRecentContributionWindow(workspaceId: string, limit: number): ObjectPage<Contribution>;
  /**
   * Newest `limit` contributions strictly after `contributionId`, chronological.
   * `found` is false when the id is missing or belongs to another workspace.
   * `total` is the count strictly after the anchor. `hasMore` means older rows
   * after the anchor were omitted from this newest window.
   */
  listContributionsSince(workspaceId: string, contributionId: string, limit: number): ContributionWindow;
  /**
   * Newest `limit` contributions strictly before `contributionId`, chronological.
   * `found` is false when the id is missing or belongs to another workspace.
   * `total` is the count of every contribution in the workspace.
   */
  listContributionsBefore(workspaceId: string, contributionId: string, limit: number): ContributionWindow;
}
