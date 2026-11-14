/**
 * FAC-001 slice 2: human-surface rendering of an AttentionResult.
 *
 * Pure presentation. No I/O, clock, store or network. One renderer is shared by
 * the Terminal dashboard and the human `campfire attention` output so the two
 * cannot drift. Contract: docs/Campfire-FAC-001-Deterministic-Facilitation.md
 * (Amendment 4, A4.1-A4.3). Rules enforced here:
 * - cues are rendered in server order; nothing is re-sorted or grouped,
 * - no urgency, priority or ownership wording is added,
 * - an empty list never reads as an all-clear (A4.2),
 * - skipped sources do not make coverage "incomplete" (F13),
 * - every record string passes through stripTerminalControls.
 */
import type { AttentionCue, AttentionReason, AttentionResult, PerSourceCoverage } from "../domain/attention.js";
import { stripTerminalControls } from "./work-console.js";

/** FAC-001 reason labels. Separate from the ATT-001 map so shipped Viewer drift guards are unaffected. */
export const FAC_ATTENTION_REASON_LABELS = {
  action_proposal_awaiting_review: "Proposal awaiting review by an owner",
  action_outcome_unknown: "Action outcome unknown",
  assigned_blocked_task: "Assigned task is blocked",
  proposed_decision_actionable: "Proposed decision you can act on",
  team_proposed_decision: "Proposed decision awaiting the team",
  accepted_decision_needs_review: "Accepted decision needs review",
  current_finding_has_contradicting_evidence: "Current finding has contradicting evidence",
  unassigned_blocked_task: "Unassigned task is blocked",
  team_blocked_task: "Team task is blocked",
  blocked_task_missing_context: "Blocked task is missing context",
  assigned_open_task: "Assigned task is open",
} as const satisfies Record<AttentionReason, string>;

/** Frozen human strings (A4.2). */
export const ATTENTION_VIEW_STRINGS = {
  emptyComplete: "No recorded cue matches these rules.",
  emptyIncomplete:
    "No recorded cue matches these rules, but coverage is incomplete (see sources below). This does not mean nothing needs attention.",
  morePages: "More cues exist beyond this page.",
  expiredMarker: "(expired)",
  coverageComplete: "Coverage: complete under the rules.",
  coverageIncomplete: "Coverage: incomplete under the rules.",
} as const;

/** Collapse a record string to one safe line. */
function clean(value: string): string {
  return stripTerminalControls(value).replace(/\s+/g, " ").trim();
}

export function attentionReasonText(reason: string): string {
  if (Object.prototype.hasOwnProperty.call(FAC_ATTENTION_REASON_LABELS, reason)) {
    return FAC_ATTENTION_REASON_LABELS[reason as AttentionReason];
  }
  return clean(reason);
}

/** Lines for one cue, in a fixed shape: label, summary, subject and id, optional related ids. */
export function attentionCueLines(cue: AttentionCue): string[] {
  const expired = cue.reason === "action_proposal_awaiting_review" && cue.expired === true;
  const head = `[${clean(cue.audience)}] ${attentionReasonText(cue.reason)}${expired ? ` ${ATTENTION_VIEW_STRINGS.expiredMarker}` : ""}`;
  const lines = [head, `  ${clean(cue.summary)}`, `  ${clean(cue.subjectType)} ${clean(cue.subjectId)} · ${clean(cue.id)}`];
  if (cue.relatedIds.length > 0) lines.push(`  related: ${cue.relatedIds.map(clean).join(", ")}`);
  return lines;
}

function sourceLine(entry: PerSourceCoverage): string | undefined {
  const label = attentionReasonText(entry.reason);
  if (entry.skipped !== undefined) return `${label}: skipped (${clean(entry.skipped)}).`;
  if (entry.truncated === true) return `${label}: scanned ${Number(entry.scanned ?? 0)} of ${Number(entry.total ?? 0)}; scan limit reached.`;
  return undefined;
}

/** Coverage lines: the completeness verdict, then one line per skipped or truncated source. */
export function attentionCoverageViewLines(result: AttentionResult): string[] {
  const lines: string[] = [
    result.coverage.completeUnderRules ? ATTENTION_VIEW_STRINGS.coverageComplete : ATTENTION_VIEW_STRINGS.coverageIncomplete,
  ];
  for (const entry of result.coverage.perSource) {
    const line = sourceLine(entry);
    if (line !== undefined) lines.push(line);
  }
  return lines;
}

/** Catch-up lines; empty when no catch-up was requested. A `partial` run is never "caught up". */
export function attentionCatchUpLines(result: AttentionResult): string[] {
  const c = result.catchUp;
  if (c.status === "not_requested") return [];
  const lines: string[] = [];
  if (c.status === "partial") {
    lines.push(`Catch-up: partial; more changes exist. ${Number(c.changedCount)} changed in this interval; ${Number(c.examined)} examined on this page.`);
  } else {
    const to = c.toCursor === undefined ? "" : ` to ${clean(c.toCursor)}`;
    lines.push(`Caught up${to}. ${Number(c.changedCount)} changed in this interval; ${Number(c.examined)} examined on this page.`);
  }
  if (c.tipAdvanced) lines.push("The workspace advanced while reading.");
  if (c.affectedIds.length > 0) lines.push(`Affected: ${c.affectedIds.map(clean).join(", ")}`);
  if (c.affectedTruncated) lines.push(`Affected list is truncated (showing ${c.affectedIds.length}).`);
  return lines;
}

/** The "Needs You" count: you-audience cues in the returned page, never a total (A4.2). */
export function attentionNeedsYouCount(result: AttentionResult): { count: number; exact: boolean; text: string } {
  const count = result.cues.filter((cue) => cue.audience === "you").length;
  const exact = result.coverage.completeUnderRules && result.nextCursor === undefined;
  return { count, exact, text: exact ? String(count) : `${count}+ (more pages or incomplete coverage)` };
}

/** Full human rendering: cues in server order, empty or more-pages line, coverage, catch-up. */
export function renderAttentionLines(result: AttentionResult): string[] {
  const lines: string[] = [];
  if (result.cues.length === 0) {
    lines.push(result.coverage.completeUnderRules ? ATTENTION_VIEW_STRINGS.emptyComplete : ATTENTION_VIEW_STRINGS.emptyIncomplete);
  } else {
    for (const cue of result.cues) lines.push(...attentionCueLines(cue));
  }
  if (result.nextCursor !== undefined) lines.push(ATTENTION_VIEW_STRINGS.morePages);
  lines.push(...attentionCoverageViewLines(result));
  lines.push(...attentionCatchUpLines(result));
  return lines;
}

/** One-line text for a list row (attention section): label, summary, subject and cue id. */
export function attentionCueText(cue: AttentionCue): string {
  return attentionCueLines(cue)
    .map((line) => line.trim())
    .join("  ");
}

/** Overview row parts: the label (with expired marker) and the summary. Cue id is shown on selection. */
export function attentionCueParts(cue: AttentionCue): { primary: string; secondary: string } {
  const expired = cue.reason === "action_proposal_awaiting_review" && cue.expired === true;
  return {
    primary: `${attentionReasonText(cue.reason)}${expired ? ` ${ATTENTION_VIEW_STRINGS.expiredMarker}` : ""}`,
    secondary: clean(cue.summary),
  };
}

/** Compact count for a rail badge: returned cues, with a trailing + when it cannot be a complete count. */
export function attentionRailCount(result: AttentionResult): string {
  const exact = result.coverage.completeUnderRules && result.nextCursor === undefined;
  return exact ? String(result.returned) : `${result.returned}+`;
}
