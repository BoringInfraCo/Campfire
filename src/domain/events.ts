/**
 * Sprint 019 domain events.
 *
 * An event is an immutable fact about one successful Campfire state change.
 * It is traceable to exactly one Contribution. It is not a command, a
 * transcript, or a vendor request. Delivery attempts are operational records
 * and are not Contributions.
 */

export const CAMPFIRE_EVENT_TYPES = [
  "finding.recorded",
  "decision.proposed",
  "decision.accepted",
  "task.blocked",
  "task.completed",
  "goal.completed",
  "artifact.attached",
  "workspace.completed",
] as const;

export type CampfireEventType = (typeof CAMPFIRE_EVENT_TYPES)[number];

export type DomainEventSubjectType =
  | "workspace"
  | "goal"
  | "task"
  | "finding"
  | "decision"
  | "artifact";

export interface CampfireDomainEventV1 {
  specVersion: "1.0";
  id: string;
  type: CampfireEventType;
  occurredAt: string;
  workspace: { id: string };
  actor: { actorId: string; actorType: "human" | "agent" };
  subject: { type: DomainEventSubjectType; id: string };
  summary: string;
  data: Record<string, unknown>;
  provenance: {
    contributionId: string;
    agentSessionId?: string;
    onBehalfOf?: { actorId: string; actorType: "human" };
  };
}

/** Row stored with the mutation. `body` is the exact webhook JSON. */
export interface DomainEventRecord {
  id: string;
  specVersion: "1.0";
  type: CampfireEventType;
  occurredAt: string;
  workspaceId: string;
  actor: { actorId: string; actorType: "human" | "agent" };
  subjectType: DomainEventSubjectType;
  subjectId: string;
  summary: string;
  data: Record<string, unknown>;
  body: string;
  contributionId: string;
  agentSessionId?: string;
  onBehalfOf?: { actorId: string; actorType: "human" };
  createdAt: string;
}

export type WebhookDeliveryStatus = "pending" | "delivering" | "delivered" | "exhausted";

export interface WebhookDeliveryRecord {
  id: string;
  eventId: string;
  bridgeId: string;
  status: WebhookDeliveryStatus;
  attemptCount: number;
  nextAttemptAt?: string;
  claimedAt?: string;
  claimToken?: string;
  lastError?: string;
  deliveredAt?: string;
  /** SHA-256 of the bridge id, URL, and secret at queue time. Not the secret. */
  configFingerprint?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryCounts {
  pending: number;
  delivering: number;
  delivered: number;
  exhausted: number;
}
