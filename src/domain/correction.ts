/**
 * COR-001 validation. Lifecycle changes are explicit arguments, never inferred
 * from text, time, or an agent assertion.
 */
import { ValidationError } from "./errors.js";
import type { FindingEvidenceRelation } from "./types.js";

export const CORRECTION_REASON_MAX = 2000;
export const EVIDENCE_NOTE_MAX = 500;

export function assertCorrectionReason(reason: string): string {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new ValidationError("A reason is required", { field: "reason" });
  }
  const trimmed = reason.trim();
  if (trimmed.length > CORRECTION_REASON_MAX) {
    throw new ValidationError(`Reason must be at most ${CORRECTION_REASON_MAX} characters`, {
      field: "reason",
    });
  }
  return trimmed;
}

export function assertEvidenceNote(note: string | undefined): string | undefined {
  if (note === undefined) return undefined;
  const trimmed = note.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > EVIDENCE_NOTE_MAX) {
    throw new ValidationError(`Note must be at most ${EVIDENCE_NOTE_MAX} characters`, { field: "note" });
  }
  return trimmed;
}

export function assertEvidenceRelation(relation: string): FindingEvidenceRelation {
  if (relation !== "supports" && relation !== "contradicts") {
    throw new ValidationError("Evidence relation must be supports or contradicts", {
      field: "relation",
      value: relation,
    });
  }
  return relation;
}
