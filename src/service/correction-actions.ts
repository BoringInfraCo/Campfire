/**
 * COR-001 writes. Authorization and the agent session are checked before any
 * read of another workspace's objects. One transaction holds the new row, the
 * transition, the relations, and the contributions. Correction does not emit
 * finding.recorded. Accepting a replacement emits decision.accepted only for
 * the new decision.
 */
import type { ActorContext, Authorizer } from "./authorization.js";
import { assertCorrectionReason, assertEvidenceNote, assertEvidenceRelation } from "../domain/correction.js";
import {
  ArtifactNotFound,
  Conflict,
  CrossWorkspaceReference,
  DecisionNotFound,
  FindingNotFound,
  InvalidTransition,
  ValidationError,
} from "../domain/errors.js";
import { assertAcyclicPredecessor, assertDecisionTransition } from "../domain/lifecycle.js";
import type { IdSource } from "../domain/ids.js";
import type {
  ActorRef,
  ContributionAction,
  ContributionObjectType,
  Decision,
  DecisionCitation,
  Finding,
  FindingEvidence,
} from "../domain/types.js";
import type { CampfireStore } from "../store/store.js";
import type { QualifyingMutation } from "../domain/event-qualify.js";
import type { DomainEventSubjectType } from "../domain/events.js";
import type {
  AcceptDecisionOptions,
  AddDecisionInput,
  CiteDecisionBasisInput,
  CiteFindingEvidenceInput,
  CorrectFindingInput,
  RemoveDecisionBasisInput,
  RemoveFindingEvidenceInput,
  RetireDecisionInput,
  WithdrawFindingInput,
} from "./service.js";

export interface CorrectionHost {
  store: CampfireStore;
  authorizer: Authorizer;
  idSource: IdSource;
  clock: () => string;
  requireAgentSession(ctx: ActorContext): void;
  record(
    ctx: ActorContext,
    workspaceId: string,
    action: ContributionAction,
    objectType: ContributionObjectType,
    objectId: string,
    payload: Record<string, unknown> | undefined,
    createdAt: string,
  ): string;
  behalfOf(ctx: ActorContext, workspaceId: string): { actorId: string; actorType: "human" } | undefined;
  writeOutbox(
    ctx: ActorContext,
    input: {
      mutation: QualifyingMutation;
      occurredAt: string;
      workspaceId: string;
      subjectType: DomainEventSubjectType;
      subjectId: string;
      summary: string;
      data: Record<string, unknown>;
      contributionId: string;
      onBehalfOf?: { actorId: string; actorType: "human" };
    },
  ): void;
  decorateFinding(finding: Finding): Finding;
  decorateDecision(decision: Decision): Decision;
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new ValidationError(`${field} must not be empty`, { field });
  }
}

function provenance(ctx: ActorContext, now: string): { createdBy: ActorRef; agentSessionId?: string; createdAt: string } {
  return { createdBy: ctx.actor, agentSessionId: ctx.agentSessionId, createdAt: now };
}

function requireWorkspaceArtifact(store: CampfireStore, workspaceId: string, artifactId: string): void {
  const artifact = store.getArtifact(artifactId);
  if (artifact === undefined) throw new ArtifactNotFound(artifactId);
  if (artifact.workspaceId !== workspaceId) {
    throw new CrossWorkspaceReference(`Artifact ${artifactId} is not in workspace ${workspaceId}`);
  }
}

function requireWorkspaceFinding(store: CampfireStore, workspaceId: string, findingId: string): Finding {
  const finding = store.getFinding(findingId);
  if (finding === undefined) throw new FindingNotFound(findingId);
  if (finding.workspaceId !== workspaceId) {
    throw new CrossWorkspaceReference(`Finding ${findingId} is not in workspace ${workspaceId}`);
  }
  return finding;
}

function assertFindingCurrent(finding: Finding): void {
  const currentness = finding.currentness ?? "current";
  if (currentness !== "current" || finding.successorId !== undefined) {
    throw new InvalidTransition(`Finding ${finding.id} is ${currentness}`, {
      kind: "finding",
      from: currentness,
      to: "superseded",
    });
  }
}

function assertFindingChain(store: CampfireStore, start: Finding): void {
  assertAcyclicPredecessor(start.id, (id) => {
    const finding = store.getFinding(id);
    if (finding === undefined) return undefined;
    if (finding.workspaceId !== start.workspaceId) {
      throw new CrossWorkspaceReference("Finding predecessor is not in this workspace");
    }
    return finding.predecessorId;
  }, "finding");
}

function assertDecisionChain(store: CampfireStore, start: Decision): void {
  assertAcyclicPredecessor(start.id, (id) => {
    const decision = store.getDecision(id);
    if (decision === undefined) return undefined;
    if (decision.workspaceId !== start.workspaceId) {
      throw new CrossWorkspaceReference("Decision predecessor is not in this workspace");
    }
    return decision.predecessorId;
  }, "decision");
}

export interface CorrectionActions {
  correctFinding(ctx: ActorContext, input: CorrectFindingInput): Finding;
  withdrawFinding(ctx: ActorContext, input: WithdrawFindingInput): Finding;
  citeFindingEvidence(ctx: ActorContext, input: CiteFindingEvidenceInput): FindingEvidence;
  removeFindingEvidence(ctx: ActorContext, input: RemoveFindingEvidenceInput): FindingEvidence;
  citeDecisionBasis(ctx: ActorContext, input: CiteDecisionBasisInput): DecisionCitation;
  removeDecisionBasis(ctx: ActorContext, input: RemoveDecisionBasisInput): DecisionCitation;
  retireDecision(ctx: ActorContext, input: RetireDecisionInput): Decision;
  addDecision(ctx: ActorContext, input: AddDecisionInput): Decision;
  acceptDecision(ctx: ActorContext, decisionId: string, options?: AcceptDecisionOptions): Decision;
}

export function createCorrectionActions(host: CorrectionHost): CorrectionActions {
  const { store } = host;

  function loadFinding(ctx: ActorContext, findingId: string, operation: "finding:update" | "finding:create"): Finding {
    const finding = store.getFinding(findingId);
    // The id came from the caller. A missing row and a row in an inaccessible
    // workspace use the same error so the response does not reveal the workspace.
    if (finding === undefined || store.getParticipant(finding.workspaceId, ctx.actor) === undefined) {
      throw new FindingNotFound(findingId);
    }
    host.authorizer.assertAllowed(ctx, operation, finding.workspaceId);
    host.requireAgentSession(ctx);
    return finding;
  }

  function loadDecision(ctx: ActorContext, decisionId: string): Decision {
    const decision = store.getDecision(decisionId);
    if (decision === undefined || store.getParticipant(decision.workspaceId, ctx.actor) === undefined) {
      throw new DecisionNotFound(decisionId);
    }
    host.authorizer.assertAllowed(ctx, "decision:update", decision.workspaceId);
    host.requireAgentSession(ctx);
    return decision;
  }

  // Removal is addressed by a row id, so the workspace is not known until the
  // row is read. A non-participant gets the same not-found error as a missing
  // row. The authorizer's denial names the workspace, and that must not cross
  // the boundary of a workspace the actor cannot access.
  function visibleEvidence(ctx: ActorContext, evidenceId: string): FindingEvidence {
    const row = store.getFindingEvidence(evidenceId);
    if (row === undefined || store.getParticipant(row.workspaceId, ctx.actor) === undefined) {
      throw new Conflict("Finding evidence was not found");
    }
    return row;
  }

  function visibleCitation(ctx: ActorContext, citationId: string): DecisionCitation {
    const row = store.getDecisionCitation(citationId);
    if (row === undefined || store.getParticipant(row.workspaceId, ctx.actor) === undefined) {
      throw new Conflict("Decision citation was not found");
    }
    return row;
  }

  return {
    correctFinding(ctx, input) {
      const old = loadFinding(ctx, input.findingId, "finding:update");
      host.authorizer.assertAllowed(ctx, "finding:create", old.workspaceId);
      assertNonEmpty(input.summary, "Finding summary");
      const reason = assertCorrectionReason(input.reason);
      assertFindingCurrent(old);
      assertFindingChain(store, old);
      if (input.sourceArtifactId !== undefined) requireWorkspaceArtifact(store, old.workspaceId, input.sourceArtifactId);
      const seen = new Set<string>();
      const now = host.clock();
      const created: Finding = {
        ...provenance(ctx, now),
        id: host.idSource("finding"),
        workspaceId: old.workspaceId,
        summary: input.summary,
        detail: input.detail,
        confidence: input.confidence,
        sourceArtifactId: input.sourceArtifactId,
        currentness: "current",
        predecessorId: old.id,
      };
      const evidence = (input.evidence ?? []).map((item) => {
        if (seen.has(item.artifactId)) {
          throw new Conflict("Finding evidence already cites this artifact");
        }
        seen.add(item.artifactId);
        requireWorkspaceArtifact(store, old.workspaceId, item.artifactId);
        const note = assertEvidenceNote(item.note);
        const row: FindingEvidence = {
          id: host.idSource("findingEvidence"),
          workspaceId: old.workspaceId,
          findingId: created.id,
          artifactId: item.artifactId,
          relation: assertEvidenceRelation(item.relation),
          createdBy: ctx.actor,
          agentSessionId: ctx.agentSessionId,
          createdAt: now,
          ...(note !== undefined ? { note } : {}),
        };
        return row;
      });
      store.transaction(() => {
        store.createFinding(created);
        for (const row of evidence) store.insertFindingEvidence(row);
        store.claimFindingTransition({
          findingId: old.id,
          successorId: created.id,
          kind: "superseded",
          reason,
          actor: ctx.actor,
          agentSessionId: ctx.agentSessionId,
          createdAt: now,
        });
        host.record(ctx, old.workspaceId, "update", "finding", old.id, {
          changeType: "finding.corrected",
          reason,
          successorId: created.id,
          summary: old.summary,
        }, now);
        host.record(ctx, old.workspaceId, "create", "finding", created.id, {
          changeType: "finding.corrected",
          reason,
          predecessorId: old.id,
          summary: created.summary,
        }, now);
      });
      const stored = store.getFinding(created.id);
      if (stored === undefined) throw new FindingNotFound(created.id);
      return host.decorateFinding(stored);
    },

    withdrawFinding(ctx, input) {
      const finding = loadFinding(ctx, input.findingId, "finding:update");
      const reason = assertCorrectionReason(input.reason);
      assertFindingCurrent(finding);
      assertFindingChain(store, finding);
      const now = host.clock();
      store.transaction(() => {
        store.claimFindingTransition({
          findingId: finding.id,
          kind: "withdrawn",
          reason,
          actor: ctx.actor,
          agentSessionId: ctx.agentSessionId,
          createdAt: now,
        });
        host.record(ctx, finding.workspaceId, "update", "finding", finding.id, {
          changeType: "finding.withdrawn",
          reason,
          summary: finding.summary,
        }, now);
      });
      const stored = store.getFinding(finding.id);
      if (stored === undefined) throw new FindingNotFound(finding.id);
      return host.decorateFinding(stored);
    },

    citeFindingEvidence(ctx, input) {
      const finding = loadFinding(ctx, input.findingId, "finding:update");
      const relation = assertEvidenceRelation(input.relation);
      const note = assertEvidenceNote(input.note);
      requireWorkspaceArtifact(store, finding.workspaceId, input.artifactId);
      if (store.listFindingEvidence([finding.id]).some((row) => row.artifactId === input.artifactId)) {
        throw new Conflict("Finding evidence already cites this artifact");
      }
      const now = host.clock();
      const row: FindingEvidence = {
        id: host.idSource("findingEvidence"),
        workspaceId: finding.workspaceId,
        findingId: finding.id,
        artifactId: input.artifactId,
        relation,
        createdBy: ctx.actor,
        agentSessionId: ctx.agentSessionId,
        createdAt: now,
        ...(note !== undefined ? { note } : {}),
      };
      store.transaction(() => {
        store.insertFindingEvidence(row);
        host.record(ctx, finding.workspaceId, "update", "finding", finding.id, {
          summary: `${relation} ${input.artifactId}`,
          artifactId: input.artifactId,
          relation,
          ...(note !== undefined ? { note } : {}),
        }, now);
      });
      return row;
    },

    removeFindingEvidence(ctx, input) {
      const row = visibleEvidence(ctx, input.evidenceId);
      const finding = loadFinding(ctx, row.findingId, "finding:update");
      const now = host.clock();
      store.transaction(() => {
        if (!store.deleteFindingEvidence(row.findingId, row.artifactId)) {
          throw new Conflict("Finding evidence was not found");
        }
        host.record(ctx, finding.workspaceId, "update", "finding", finding.id, {
          summary: `removed ${row.artifactId}`,
          artifactId: row.artifactId,
          evidenceId: row.id,
        }, now);
      });
      return row;
    },

    citeDecisionBasis(ctx, input) {
      const decision = loadDecision(ctx, input.decisionId);
      const note = assertEvidenceNote(input.note);
      requireWorkspaceFinding(store, decision.workspaceId, input.findingId);
      if (store.listDecisionCitations([decision.id]).some((row) => row.findingId === input.findingId)) {
        throw new Conflict("Decision already cites this finding");
      }
      const now = host.clock();
      const row: DecisionCitation = {
        id: host.idSource("decisionCitation"),
        workspaceId: decision.workspaceId,
        decisionId: decision.id,
        findingId: input.findingId,
        createdBy: ctx.actor,
        agentSessionId: ctx.agentSessionId,
        createdAt: now,
        ...(note !== undefined ? { note } : {}),
      };
      store.transaction(() => {
        store.insertDecisionCitation(row);
        host.record(ctx, decision.workspaceId, "update", "decision", decision.id, {
          summary: `cites ${input.findingId}`,
          findingId: input.findingId,
          ...(note !== undefined ? { note } : {}),
        }, now);
      });
      return row;
    },

    removeDecisionBasis(ctx, input) {
      const row = visibleCitation(ctx, input.citationId);
      const decision = loadDecision(ctx, row.decisionId);
      const now = host.clock();
      store.transaction(() => {
        if (!store.deleteDecisionCitation(row.decisionId, row.findingId)) {
          throw new Conflict("Decision citation was not found");
        }
        host.record(ctx, decision.workspaceId, "update", "decision", decision.id, {
          summary: `removed citation ${row.findingId}`,
          findingId: row.findingId,
          citationId: row.id,
        }, now);
      });
      return row;
    },

    retireDecision(ctx, input) {
      const decision = loadDecision(ctx, input.decisionId);
      const reason = assertCorrectionReason(input.reason);
      if (decision.status === "superseded") {
        throw new InvalidTransition(`Decision ${decision.id} is superseded`, {
          kind: "decision",
          from: decision.status,
          to: "superseded",
        });
      }
      assertDecisionTransition(decision.status, "superseded");
      assertDecisionChain(store, decision);
      const kind = decision.status === "proposed" ? "rejected" : "superseded";
      const changeType = decision.status === "proposed" ? "decision.rejected" : "decision.superseded";
      const now = host.clock();
      store.transaction(() => {
        store.claimDecisionTransition({
          decisionId: decision.id,
          kind,
          reason,
          actor: ctx.actor,
          agentSessionId: ctx.agentSessionId,
          createdAt: now,
        });
        host.record(ctx, decision.workspaceId, "update", "decision", decision.id, {
          changeType,
          reason,
          status: "superseded",
          summary: decision.summary,
        }, now);
      });
      const stored = store.getDecision(decision.id);
      if (stored === undefined) throw new DecisionNotFound(decision.id);
      return host.decorateDecision(stored);
    },

    addDecision(ctx, input) {
      host.authorizer.assertAllowed(ctx, "decision:create", input.workspaceId);
      host.requireAgentSession(ctx);
      assertNonEmpty(input.summary, "Decision summary");
      if (input.status !== undefined && input.status !== "proposed") {
        throw new ValidationError("Decisions must be created as proposed; use acceptDecision to accept", {
          field: "status",
          value: input.status,
        });
      }
      let predecessor: Decision | undefined;
      if (input.replacesDecisionId !== undefined) {
        const target = store.getDecision(input.replacesDecisionId);
        if (target === undefined) throw new DecisionNotFound(input.replacesDecisionId);
        if (target.workspaceId !== input.workspaceId) {
          throw new CrossWorkspaceReference(`Decision ${target.id} is not in workspace ${input.workspaceId}`);
        }
        if (target.status !== "accepted") {
          throw new InvalidTransition(`Decision ${target.id} is ${target.status}`, {
            kind: "decision",
            from: target.status,
            to: "superseded",
          });
        }
        predecessor = target;
      }
      const now = host.clock();
      const decision: Decision = {
        ...provenance(ctx, now),
        id: host.idSource("decision"),
        workspaceId: input.workspaceId,
        summary: input.summary,
        rationale: input.rationale,
        status: "proposed",
        updatedAt: now,
        ...(predecessor !== undefined ? { predecessorId: predecessor.id } : {}),
      };
      if (predecessor !== undefined) assertDecisionChain(store, decision);
      const onBehalfOf = host.behalfOf(ctx, input.workspaceId);
      store.transaction(() => {
        store.createDecision(decision);
        const contributionId = host.record(ctx, input.workspaceId, "create", "decision", decision.id, {
          summary: decision.summary,
          status: "proposed",
          ...(predecessor !== undefined ? { predecessorId: predecessor.id } : {}),
        }, now);
        host.writeOutbox(ctx, {
          mutation: { kind: "decision.created", status: "proposed" },
          occurredAt: now,
          workspaceId: input.workspaceId,
          subjectType: "decision",
          subjectId: decision.id,
          summary: decision.summary,
          data: {
            summary: decision.summary,
            status: "proposed",
            rationale: decision.rationale,
            ...(predecessor !== undefined ? { predecessorId: predecessor.id } : {}),
          },
          contributionId,
          ...(onBehalfOf !== undefined ? { onBehalfOf } : {}),
        });
      });
      return decision;
    },

    acceptDecision(ctx, decisionId, options) {
      const decision = loadDecision(ctx, decisionId);
      assertDecisionTransition(decision.status, "accepted");
      const reason = options?.reason === undefined ? undefined : assertCorrectionReason(options.reason);
      let predecessor: Decision | undefined;
      if (decision.predecessorId !== undefined) {
        if (reason === undefined) {
          throw new ValidationError("A reason is required to accept a replacement decision", { field: "reason" });
        }
        const target = store.getDecision(decision.predecessorId);
        if (target === undefined) throw new DecisionNotFound(decision.predecessorId);
        if (target.workspaceId !== decision.workspaceId) {
          throw new CrossWorkspaceReference("Decision predecessor is not in this workspace");
        }
        if (target.status !== "accepted") {
          throw new InvalidTransition(`Decision ${target.id} is ${target.status}`, {
            kind: "decision",
            from: target.status,
            to: "superseded",
          });
        }
        predecessor = target;
        assertDecisionChain(store, decision);
      }
      const now = host.clock();
      const onBehalfOf = host.behalfOf(ctx, decision.workspaceId);
      store.transaction(() => {
        store.updateDecision(decisionId, { status: "accepted", approvedBy: ctx.actor, updatedAt: now });
        if (predecessor !== undefined && reason !== undefined) {
          store.claimDecisionTransition({
            decisionId: predecessor.id,
            successorId: decision.id,
            kind: "superseded",
            reason,
            actor: ctx.actor,
            agentSessionId: ctx.agentSessionId,
            createdAt: now,
          });
        }
        const contributionId = host.record(ctx, decision.workspaceId, "update", "decision", decisionId, {
          status: "accepted",
          ...(reason !== undefined ? { reason } : {}),
          ...(predecessor !== undefined ? { predecessorId: predecessor.id, summary: decision.summary } : {}),
        }, now);
        if (predecessor !== undefined && reason !== undefined) {
          host.record(ctx, decision.workspaceId, "update", "decision", predecessor.id, {
            changeType: "decision.superseded",
            reason,
            successorId: decision.id,
            status: "superseded",
            summary: predecessor.summary,
          }, now);
        }
        host.writeOutbox(ctx, {
          mutation: { kind: "decision.updated", from: decision.status, to: "accepted" },
          occurredAt: now,
          workspaceId: decision.workspaceId,
          subjectType: "decision",
          subjectId: decisionId,
          summary: decision.summary,
          data: { summary: decision.summary, status: "accepted", previousStatus: decision.status },
          contributionId,
          ...(onBehalfOf !== undefined ? { onBehalfOf } : {}),
        });
      });
      const stored = store.getDecision(decisionId);
      if (stored === undefined) throw new DecisionNotFound(decisionId);
      return host.decorateDecision(stored);
    },
  };
}
