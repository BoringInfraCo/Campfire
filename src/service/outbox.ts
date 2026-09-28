/**
 * Plan a domain event and, when the operator bridge allows it, a delivery row.
 *
 * The caller writes both inside the mutation transaction. Nothing here
 * performs network I/O. `onBehalfOf` comes only from the agent session row.
 */
import { bridgeAllows, readWebhookBridgeConfig, type WebhookBridgeConfig } from "../bridge/config.js";
import { destinationFingerprint } from "../bridge/fingerprint.js";
import { buildDomainEvent } from "../domain/event-body.js";
import { eventTypeForMutation, type QualifyingMutation } from "../domain/event-qualify.js";
import type { DomainEventRecord, DomainEventSubjectType, WebhookDeliveryRecord } from "../domain/events.js";
import type { ActorRef } from "../domain/types.js";

export function resolveOnBehalfOf(
  actor: ActorRef,
  workspaceId: string,
  session: { agentId: string; humanId: string; workspaceId: string } | undefined,
): { actorId: string; actorType: "human" } | undefined {
  if (actor.actorType !== "agent" || session === undefined) return undefined;
  if (session.agentId !== actor.actorId || session.workspaceId !== workspaceId) return undefined;
  if (session.humanId.trim().length === 0) return undefined;
  return { actorId: session.humanId, actorType: "human" };
}

export function bridgeFromEnv(env: Record<string, string | undefined>): WebhookBridgeConfig | undefined {
  const config = readWebhookBridgeConfig(env);
  return config.configured ? config.bridge : undefined;
}

export interface OutboxPlanInput {
  mutation: QualifyingMutation;
  eventId: string;
  deliveryId: string;
  occurredAt: string;
  workspaceId: string;
  actor: { actorId: string; actorType: "human" | "agent" };
  subjectType: DomainEventSubjectType;
  subjectId: string;
  summary: string;
  data: Record<string, unknown>;
  contributionId: string;
  agentSessionId?: string;
  onBehalfOf?: { actorId: string; actorType: "human" };
  bridge: WebhookBridgeConfig | undefined;
}

export function planOutbox(
  input: OutboxPlanInput,
): { event: DomainEventRecord; delivery?: WebhookDeliveryRecord } | undefined {
  const type = eventTypeForMutation(input.mutation);
  if (type === undefined) return undefined;
  const { record } = buildDomainEvent({
    id: input.eventId,
    type,
    occurredAt: input.occurredAt,
    workspaceId: input.workspaceId,
    actor: input.actor,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    summary: input.summary,
    data: input.data,
    contributionId: input.contributionId,
    ...(input.agentSessionId !== undefined ? { agentSessionId: input.agentSessionId } : {}),
    ...(input.onBehalfOf !== undefined ? { onBehalfOf: input.onBehalfOf } : {}),
  });
  if (input.bridge === undefined || !bridgeAllows(input.bridge, { type, workspaceId: input.workspaceId })) {
    return { event: record };
  }
  return {
    event: record,
    delivery: {
      id: input.deliveryId,
      eventId: record.id,
      bridgeId: input.bridge.id,
      status: "pending",
      attemptCount: 0,
      configFingerprint: destinationFingerprint(input.bridge),
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    },
  };
}

export function definedData(data: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) copy[key] = value;
  }
  return copy;
}
