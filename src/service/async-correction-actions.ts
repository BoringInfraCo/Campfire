/**
 * COR-001 writes. Authorization and the agent session are checked before any
 * read of another workspace's objects. One transaction holds the new row, the
 * transition, the relations, and the contributions. Correction does not emit
 * finding.recorded. Accepting a replacement emits decision.accepted only for
 * the new decision.
 */
import type { ActorContext } from "./authorization.js";
import type { AsyncAuthorizer } from "../worker/async-authorizer.js";
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
import { assertDecisionTransition } from "../domain/lifecycle.js";
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
import type { AsyncCampfireStore } from "../worker/d1-store.js";
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
  store: AsyncCampfireStore;
  authorizer: AsyncAuthorizer;
  idSource: IdSource;
  clock: () => string;
  requireAgentSession(ctx: ActorContext): Promise<void>;
  record(
    ctx: ActorContext,
    workspaceId: string,
    action: ContributionAction,
    objectType: ContributionObjectType,
    objectId: string,
    payload: Record<string, unknown> | undefined,
    createdAt: string,
  ): Promise<string>;
  behalfOf(ctx: ActorContext, workspaceId: string): Promise<{ actorId: string; actorType: "human" } | undefined>;
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
  ): Promise<void>;
  decorateFinding(finding: Finding): Promise<Finding>;
  decorateDecision(decision: Decision): Promise<Decision>;
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new ValidationError(`${field} must not be empty`, { field });
  }
}

function provenance(ctx: ActorContext, now: string): { createdBy: ActorRef; agentSessionId?: string; createdAt: string } {
  return { createdBy: ctx.actor, agentSessionId: ctx.agentSessionId, createdAt: now };
}

async function requireWorkspaceArtifact(store: AsyncCampfireStore, workspaceId: string, artifactId: string): Promise<void> {
  const artifact = await store.getArtifact(artifactId);
  if (artifact === undefined) throw new ArtifactNotFound(artifactId);
  if (artifact.workspaceId !== workspaceId) {
    throw new CrossWorkspaceReference(`Artifact ${artifactId} is not in workspace ${workspaceId}`);
  }
}

async function requireWorkspaceFinding(store: AsyncCampfireStore, workspaceId: string, findingId: string): Promise<Finding> {
  const finding = await store.getFinding(findingId);
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

async function assertFindingChain(store: AsyncCampfireStore, start: Finding): Promise<void> {
  const seen = new Set<string>();
  let current: Finding | undefined = start;
  while (current !== undefined) {
    if (seen.has(current.id)) {
      throw new InvalidTransition("finding chain is cyclic", { kind: "finding", id: start.id });
    }
    seen.add(current.id);
    if (current.predecessorId === undefined) return;
    const previous = await store.getFinding(current.predecessorId);
    if (previous === undefined) return;
    if (previous.workspaceId !== start.workspaceId) {
      throw new CrossWorkspaceReference("Finding predecessor is not in this workspace");
    }
    current = previous;
  }
}

async function assertDecisionChain(store: AsyncCampfireStore, start: Decision): Promise<void> {
  const seen = new Set<string>();
  let current: Decision | undefined = start;
  while (current !== undefined) {
    if (seen.has(current.id)) {
      throw new InvalidTransition("decision chain is cyclic", { kind: "decision", id: start.id });
    }
    seen.add(current.id);
    if (current.predecessorId === undefined) return;
    const previous = await store.getDecision(current.predecessorId);
    if (previous === undefined) return;
    if (previous.workspaceId !== start.workspaceId) {
      throw new CrossWorkspaceReference("Decision predecessor is not in this workspace");
    }
    current = previous;
  }
}

export interface AsyncCorrectionActions {
  correctFinding(ctx: ActorContext, input: CorrectFindingInput): Promise<Finding>;
  withdrawFinding(ctx: ActorContext, input: WithdrawFindingInput): Promise<Finding>;
  citeFindingEvidence(ctx: ActorContext, input: CiteFindingEvidenceInput): Promise<FindingEvidence>;
  removeFindingEvidence(ctx: ActorContext, input: RemoveFindingEvidenceInput): Promise<FindingEvidence>;
  citeDecisionBasis(ctx: ActorContext, input: CiteDecisionBasisInput): Promise<DecisionCitation>;
  removeDecisionBasis(ctx: ActorContext, input: RemoveDecisionBasisInput): Promise<DecisionCitation>;
  retireDecision(ctx: ActorContext, input: RetireDecisionInput): Promise<Decision>;
  addDecision(ctx: ActorContext, input: AddDecisionInput): Promise<Decision>;
  acceptDecision(ctx: ActorContext, decisionId: string, options?: AcceptDecisionOptions): Promise<Decision>;
}

export function createAsyncCorrectionActions(host: CorrectionHost): AsyncCorrectionActions {
  const { store } = host;

  async function loadFinding(ctx: ActorContext, findingId: string, operation: "finding:update" | "finding:create"): Promise<Finding> {
    const finding = await store.getFinding(findingId);
    // The id came from the caller. A missing row and a row in an inaccessible
    // workspace use the same error so the response does not reveal the workspace.
    if (finding === undefined || (await store.getParticipant(finding.workspaceId, ctx.actor)) === undefined) {
      throw new FindingNotFound(findingId);
    }
    await host.authorizer.assertAllowed(ctx, operation, finding.workspaceId);
    await host.requireAgentSession(ctx);
    return finding;
  }

  async function loadDecision(ctx: ActorContext, decisionId: string): Promise<Decision> {
    const decision = await store.getDecision(decisionId);
    if (decision === undefined || (await store.getParticipant(decision.workspaceId, ctx.actor)) === undefined) {
      throw new DecisionNotFound(decisionId);
    }
    await host.authorizer.assertAllowed(ctx, "decision:update", decision.workspaceId);
    await host.requireAgentSession(ctx);
    return decision;
  }

  // Same boundary as the sync path: a row id is not authorization to learn
  // that an inaccessible workspace has that evidence or citation.
  async function visibleEvidence(ctx: ActorContext, evidenceId: string): Promise<FindingEvidence> {
    const row = await store.getFindingEvidence(evidenceId);
    if (row === undefined || (await store.getParticipant(row.workspaceId, ctx.actor)) === undefined) {
      throw new Conflict("Finding evidence was not found");
    }
    return row;
  }

  async function visibleCitation(ctx: ActorContext, citationId: string): Promise<DecisionCitation> {
    const row = await store.getDecisionCitation(citationId);
    if (row === undefined || (await store.getParticipant(row.workspaceId, ctx.actor)) === undefined) {
      throw new Conflict("Decision citation was not found");
    }
    return row;
  }

  return {
    async correctFinding(ctx, input) {
      const old = await loadFinding(ctx, input.findingId, "finding:update");
      await host.authorizer.assertAllowed(ctx, "finding:create", old.workspaceId);
      assertNonEmpty(input.summary, "Finding summary");
      const reason = assertCorrectionReason(input.reason);
      assertFindingCurrent(old);
      await assertFindingChain(store, old);
      if (input.sourceArtifactId !== undefined) await requireWorkspaceArtifact(store, old.workspaceId, input.sourceArtifactId);
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
      const evidence: FindingEvidence[] = [];
      for (const item of input.evidence ?? []) {
        if (seen.has(item.artifactId)) {
          throw new Conflict("Finding evidence already cites this artifact");
        }
        seen.add(item.artifactId);
        await requireWorkspaceArtifact(store, old.workspaceId, item.artifactId);
        const note = assertEvidenceNote(item.note);
        evidence.push({
          id: host.idSource("findingEvidence"),
          workspaceId: old.workspaceId,
          findingId: created.id,
          artifactId: item.artifactId,
          relation: assertEvidenceRelation(item.relation),
          createdBy: ctx.actor,
          agentSessionId: ctx.agentSessionId,
          createdAt: now,
          ...(note !== undefined ? { note } : {}),
        });
      }
      await store.transaction(async () => {
        await store.createFinding(created);
        for (const row of evidence) await store.insertFindingEvidence(row);
        await store.claimFindingTransition({
          findingId: old.id,
          successorId: created.id,
          kind: "superseded",
          reason,
          actor: ctx.actor,
          agentSessionId: ctx.agentSessionId,
          createdAt: now,
        });
        await host.record(ctx, old.workspaceId, "update", "finding", old.id, {
          changeType: "finding.corrected",
          reason,
          successorId: created.id,
          summary: old.summary,
        }, now);
        await host.record(ctx, old.workspaceId, "create", "finding", created.id, {
          changeType: "finding.corrected",
          reason,
          predecessorId: old.id,
          summary: created.summary,
        }, now);
      });
      const stored = await store.getFinding(created.id);
      if (stored === undefined) throw new FindingNotFound(created.id);
      return await host.decorateFinding(stored);
    },

    async withdrawFinding(ctx, input) {
      const finding = await loadFinding(ctx, input.findingId, "finding:update");
      const reason = assertCorrectionReason(input.reason);
      assertFindingCurrent(finding);
      await assertFindingChain(store, finding);
      const now = host.clock();
      await store.transaction(async () => {
        await store.claimFindingTransition({
          findingId: finding.id,
          kind: "withdrawn",
          reason,
          actor: ctx.actor,
          agentSessionId: ctx.agentSessionId,
          createdAt: now,
        });
        await host.record(ctx, finding.workspaceId, "update", "finding", finding.id, {
          changeType: "finding.withdrawn",
          reason,
          summary: finding.summary,
        }, now);
      });
      const stored = await store.getFinding(finding.id);
      if (stored === undefined) throw new FindingNotFound(finding.id);
      return await host.decorateFinding(stored);
    },

    async citeFindingEvidence(ctx, input) {
      const finding = await loadFinding(ctx, input.findingId, "finding:update");
      const relation = assertEvidenceRelation(input.relation);
      const note = assertEvidenceNote(input.note);
      await requireWorkspaceArtifact(store, finding.workspaceId, input.artifactId);
      const existingEvidence = await store.listFindingEvidence([finding.id]);
      if (existingEvidence.some((row) => row.artifactId === input.artifactId)) {
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
      await store.transaction(async () => {
        await store.insertFindingEvidence(row);
        await host.record(ctx, finding.workspaceId, "update", "finding", finding.id, {
          summary: `${relation} ${input.artifactId}`,
          artifactId: input.artifactId,
          relation,
          ...(note !== undefined ? { note } : {}),
        }, now);
      });
      return row;
    },

    async removeFindingEvidence(ctx, input) {
      const row = await visibleEvidence(ctx, input.evidenceId);
      const finding = await loadFinding(ctx, row.findingId, "finding:update");
      const now = host.clock();
      await store.transaction(async () => {
        if (!(await store.deleteFindingEvidence(row.findingId, row.artifactId))) {
          throw new Conflict("Finding evidence was not found");
        }
        await host.record(ctx, finding.workspaceId, "update", "finding", finding.id, {
          summary: `removed ${row.artifactId}`,
          artifactId: row.artifactId,
          evidenceId: row.id,
        }, now);
      });
      return row;
    },

    async citeDecisionBasis(ctx, input) {
      const decision = await loadDecision(ctx, input.decisionId);
      const note = assertEvidenceNote(input.note);
      await requireWorkspaceFinding(store, decision.workspaceId, input.findingId);
      const existingCitations = await store.listDecisionCitations([decision.id]);
      if (existingCitations.some((row) => row.findingId === input.findingId)) {
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
      await store.transaction(async () => {
        await store.insertDecisionCitation(row);
        await host.record(ctx, decision.workspaceId, "update", "decision", decision.id, {
          summary: `cites ${input.findingId}`,
          findingId: input.findingId,
          ...(note !== undefined ? { note } : {}),
        }, now);
      });
      return row;
    },

    async removeDecisionBasis(ctx, input) {
      const row = await visibleCitation(ctx, input.citationId);
      const decision = await loadDecision(ctx, row.decisionId);
      const now = host.clock();
      await store.transaction(async () => {
        if (!(await store.deleteDecisionCitation(row.decisionId, row.findingId))) {
          throw new Conflict("Decision citation was not found");
        }
        await host.record(ctx, decision.workspaceId, "update", "decision", decision.id, {
          summary: `removed citation ${row.findingId}`,
          findingId: row.findingId,
          citationId: row.id,
        }, now);
      });
      return row;
    },

    async retireDecision(ctx, input) {
      const decision = await loadDecision(ctx, input.decisionId);
      const reason = assertCorrectionReason(input.reason);
      if (decision.status === "superseded") {
        throw new InvalidTransition(`Decision ${decision.id} is superseded`, {
          kind: "decision",
          from: decision.status,
          to: "superseded",
        });
      }
      assertDecisionTransition(decision.status, "superseded");
      await assertDecisionChain(store, decision);
      const kind = decision.status === "proposed" ? "rejected" : "superseded";
      const changeType = decision.status === "proposed" ? "decision.rejected" : "decision.superseded";
      const now = host.clock();
      await store.transaction(async () => {
        await store.claimDecisionTransition({
          decisionId: decision.id,
          kind,
          reason,
          actor: ctx.actor,
          agentSessionId: ctx.agentSessionId,
          createdAt: now,
        });
        await host.record(ctx, decision.workspaceId, "update", "decision", decision.id, {
          changeType,
          reason,
          status: "superseded",
          summary: decision.summary,
        }, now);
      });
      const stored = await store.getDecision(decision.id);
      if (stored === undefined) throw new DecisionNotFound(decision.id);
      return await host.decorateDecision(stored);
    },

    async addDecision(ctx, input) {
      await host.authorizer.assertAllowed(ctx, "decision:create", input.workspaceId);
      await host.requireAgentSession(ctx);
      assertNonEmpty(input.summary, "Decision summary");
      if (input.status !== undefined && input.status !== "proposed") {
        throw new ValidationError("Decisions must be created as proposed; use acceptDecision to accept", {
          field: "status",
          value: input.status,
        });
      }
      let predecessor: Decision | undefined;
      if (input.replacesDecisionId !== undefined) {
        const target = await store.getDecision(input.replacesDecisionId);
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
      if (predecessor !== undefined) await assertDecisionChain(store, decision);
      const onBehalfOf = await host.behalfOf(ctx, input.workspaceId);
      await store.transaction(async () => {
        await store.createDecision(decision);
        const contributionId = await host.record(ctx, input.workspaceId, "create", "decision", decision.id, {
          summary: decision.summary,
          status: "proposed",
          ...(predecessor !== undefined ? { predecessorId: predecessor.id } : {}),
        }, now);
        await host.writeOutbox(ctx, {
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

    async acceptDecision(ctx, decisionId, options) {
      const decision = await loadDecision(ctx, decisionId);
      assertDecisionTransition(decision.status, "accepted");
      const reason = options?.reason === undefined ? undefined : assertCorrectionReason(options.reason);
      let predecessor: Decision | undefined;
      if (decision.predecessorId !== undefined) {
        if (reason === undefined) {
          throw new ValidationError("A reason is required to accept a replacement decision", { field: "reason" });
        }
        const target = await store.getDecision(decision.predecessorId);
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
        await assertDecisionChain(store, decision);
      }
      const now = host.clock();
      const onBehalfOf = await host.behalfOf(ctx, decision.workspaceId);
      await store.transaction(async () => {
        await store.updateDecision(decisionId, { status: "accepted", approvedBy: ctx.actor, updatedAt: now });
        if (predecessor !== undefined && reason !== undefined) {
          await store.claimDecisionTransition({
            decisionId: predecessor.id,
            successorId: decision.id,
            kind: "superseded",
            reason,
            actor: ctx.actor,
            agentSessionId: ctx.agentSessionId,
            createdAt: now,
          });
        }
        const contributionId = await host.record(ctx, decision.workspaceId, "update", "decision", decisionId, {
          status: "accepted",
          ...(reason !== undefined ? { reason } : {}),
          ...(predecessor !== undefined ? { predecessorId: predecessor.id, summary: decision.summary } : {}),
        }, now);
        if (predecessor !== undefined && reason !== undefined) {
          await host.record(ctx, decision.workspaceId, "update", "decision", predecessor.id, {
            changeType: "decision.superseded",
            reason,
            successorId: decision.id,
            status: "superseded",
            summary: predecessor.summary,
          }, now);
        }
        await host.writeOutbox(ctx, {
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
      const stored = await store.getDecision(decisionId);
      if (stored === undefined) throw new DecisionNotFound(decisionId);
      return await host.decorateDecision(stored);
    },
  };
}
