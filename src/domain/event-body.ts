/**
 * Versioned domain-event envelope.
 *
 * `body` is the exact webhook JSON. Retries resend these bytes and do not
 * build a new event. `onBehalfOf` is copied only when the caller supplies it.
 */
import type {
  CampfireDomainEventV1,
  CampfireEventType,
  DomainEventRecord,
  DomainEventSubjectType,
} from "./events.js";

export interface BuildDomainEventInput {
  id: string;
  type: CampfireEventType;
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
}

function copyData(data: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) copy[key] = value;
  }
  return copy;
}

function provenanceOf(input: {
  contributionId: string;
  agentSessionId?: string;
  onBehalfOf?: { actorId: string; actorType: "human" };
}): CampfireDomainEventV1["provenance"] {
  const provenance: CampfireDomainEventV1["provenance"] = {
    contributionId: input.contributionId,
  };
  if (input.agentSessionId !== undefined) {
    provenance.agentSessionId = input.agentSessionId;
  }
  if (input.onBehalfOf !== undefined) {
    provenance.onBehalfOf = {
      actorId: input.onBehalfOf.actorId,
      actorType: "human",
    };
  }
  return provenance;
}

/** Canonical JSON for one envelope. Key order is part of the signed bytes. */
export function stableEventBody(envelope: CampfireDomainEventV1): string {
  const body: {
    specVersion: "1.0";
    id: string;
    type: CampfireEventType;
    occurredAt: string;
    workspace: { id: string };
    actor: { actorId: string; actorType: "human" | "agent" };
    subject: { type: DomainEventSubjectType; id: string };
    summary: string;
    data: Record<string, unknown>;
    provenance: CampfireDomainEventV1["provenance"];
  } = {
    specVersion: "1.0",
    id: envelope.id,
    type: envelope.type,
    occurredAt: envelope.occurredAt,
    workspace: { id: envelope.workspace.id },
    actor: {
      actorId: envelope.actor.actorId,
      actorType: envelope.actor.actorType,
    },
    subject: {
      type: envelope.subject.type,
      id: envelope.subject.id,
    },
    summary: envelope.summary,
    data: copyData(envelope.data),
    provenance: provenanceOf(envelope.provenance),
  };
  return JSON.stringify(body);
}

export function buildDomainEvent(input: BuildDomainEventInput): {
  envelope: CampfireDomainEventV1;
  record: DomainEventRecord;
} {
  const actor = {
    actorId: input.actor.actorId,
    actorType: input.actor.actorType,
  };
  const data = copyData(input.data);
  const provenance = provenanceOf({
    contributionId: input.contributionId,
    ...(input.agentSessionId !== undefined ? { agentSessionId: input.agentSessionId } : {}),
    ...(input.onBehalfOf !== undefined ? { onBehalfOf: input.onBehalfOf } : {}),
  });
  const envelope: CampfireDomainEventV1 = {
    specVersion: "1.0",
    id: input.id,
    type: input.type,
    occurredAt: input.occurredAt,
    workspace: { id: input.workspaceId },
    actor,
    subject: { type: input.subjectType, id: input.subjectId },
    summary: input.summary,
    data,
    provenance,
  };
  const body = stableEventBody(envelope);
  const record: DomainEventRecord = {
    id: input.id,
    specVersion: "1.0",
    type: input.type,
    occurredAt: input.occurredAt,
    workspaceId: input.workspaceId,
    actor,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    summary: input.summary,
    data,
    body,
    contributionId: input.contributionId,
    createdAt: input.occurredAt,
  };
  if (input.agentSessionId !== undefined) {
    record.agentSessionId = input.agentSessionId;
  }
  if (provenance.onBehalfOf !== undefined) {
    record.onBehalfOf = provenance.onBehalfOf;
  }
  return { envelope, record };
}
