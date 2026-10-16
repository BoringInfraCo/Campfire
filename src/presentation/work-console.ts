/**
 * UIX-001 shared presentation map.
 *
 * One label table for the terminal dashboard and the local Viewer. This module
 * does not decide attention, lifecycle, permission, or presence. It only names
 * fields the service already returned. The Viewer keeps the same sentences in
 * `src/viewer/static/app.js`; tests fail when those sentences drift.
 */

export const ATTENTION_REASON_LABELS = {
  proposed_decision_actionable: "proposed decision — actionable by you, not accepted",
  assigned_blocked_task: "blocked task assigned to you",
  assigned_open_task: "open task assigned to you",
  unassigned_blocked_task: "blocked task with no recorded assignee",
  team_proposed_decision: "proposed decision recorded by the team — not accepted",
  team_blocked_task: "blocked task assigned to another participant",
  team_open_task: "open task — orientation hint only",
  accepted_decision_needs_review: "accepted decision cites non-current evidence — needs human review",
} as const;

export type AttentionReasonCode = keyof typeof ATTENTION_REASON_LABELS;

/** Task and decision lifecycle tokens stay visible. These phrases sit beside them. */
export const TASK_STATUS_LABELS = {
  open: "open",
  in_progress: "in progress",
  blocked: "blocked",
  completed: "completed",
} as const;

export const DECISION_STATUS_LABELS = {
  proposed: "proposed — not accepted, not an instruction",
  accepted: "accepted",
  superseded: "superseded — historical",
  rejected: "rejected — historical",
  retired: "retired — historical",
} as const;

export const ORIENTATION_HINT_LABEL = "orientation hint, not an action";

export const ASSIGNMENT_RECORD_NOTE =
  "Recorded assignment is a record, not a permission: it does not grant or deny a write.";

export const ARTIFACT_REFERENCE_LABEL = "stored reference, not fetched";

export const REGISTERED_AGENTS_LABEL = "registered agents — recorded participants, not live presence";

export const DASHBOARD_COMMAND = "dashboard";

export const DASHBOARD_NON_TTY_MESSAGE =
  "campfire dashboard runs only in an interactive terminal. Use campfire status --output human or campfire status --output json.";

const CONTROL_ESCAPE =
  /\u001B(?:\[[0-?]*[ -/]*[@-~]|\].*?(?:\u0007|\u001B\\)|[@-Z\\-_])/gs;

/** Drop ANSI/OSC/C1 and other controls so record text cannot move the cursor or forge chrome. */
export function stripTerminalControls(value: string): string {
  const withoutEscapes = value.replace(CONTROL_ESCAPE, "");
  let out = "";
  for (const char of withoutEscapes) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      out += " ";
      continue;
    }
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) continue;
    out += char;
  }
  return out;
}

export function attentionReasonLabel(reason: string): string {
  if (Object.prototype.hasOwnProperty.call(ATTENTION_REASON_LABELS, reason)) {
    return ATTENTION_REASON_LABELS[reason as AttentionReasonCode];
  }
  return stripTerminalControls(reason);
}

export interface CoverageSlice {
  total: number;
  returned: number;
  truncated: boolean;
}

export interface AttentionCoverageView {
  tasks: CoverageSlice;
  decisions: CoverageSlice;
  completeUnderRules?: boolean;
}

function slicePart(slice: CoverageSlice | undefined): string {
  const returned = slice && typeof slice.returned === "number" ? slice.returned : "?";
  const total = slice && typeof slice.total === "number" ? slice.total : "?";
  const truncated = slice?.truncated === true;
  return `${returned} of ${total}${truncated ? " (truncated)" : ""}`;
}

/** Same sentence the Viewer `attentionCoverageText` renders. */
export function attentionCoverageText(coverage: AttentionCoverageView | undefined): string {
  if (coverage === undefined) return "";
  const truncated = coverage.tasks?.truncated === true || coverage.decisions?.truncated === true;
  const text = `Attention coverage: tasks ${slicePart(coverage.tasks)}, decisions ${slicePart(coverage.decisions)}.`;
  return truncated
    ? `${text} Cues beyond the returned pages may exist.`
    : `${text} Both source pages are complete.`;
}

/** Fraction line for the dashboard header. Counts come from the same coverage object. */
export function attentionCoverageCounts(coverage: AttentionCoverageView | undefined): string {
  if (coverage === undefined) return "coverage not reported";
  const fraction = (slice: CoverageSlice | undefined): string => {
    const returned = slice && typeof slice.returned === "number" ? slice.returned : "?";
    const total = slice && typeof slice.total === "number" ? slice.total : "?";
    return `${returned}/${total}${slice?.truncated === true ? " truncated" : ""}`;
  };
  return `${fraction(coverage.tasks)} tasks · ${fraction(coverage.decisions)} decisions`;
}

/** Same sentences the Viewer `attentionEmptyText` renders. */
export function attentionEmptyText(coverage: AttentionCoverageView | undefined): string {
  if (coverage === undefined) {
    return "No recorded attention cues in the returned records; completeness was not reported.";
  }
  if (coverage.completeUnderRules === true) {
    return "No recorded attention cues match these rules. This does not mean all work is done.";
  }
  return "No cue found in the returned records; more matching records may exist.";
}

export function recordedParticipantLine(humans: number, agents: number): string {
  return `${humans} people · ${agents} registered agents`;
}

export function taskStatusLabel(status: string): string {
  if (Object.prototype.hasOwnProperty.call(TASK_STATUS_LABELS, status)) {
    return TASK_STATUS_LABELS[status as keyof typeof TASK_STATUS_LABELS];
  }
  return stripTerminalControls(status);
}

export function decisionStatusLabel(status: string): string {
  if (Object.prototype.hasOwnProperty.call(DECISION_STATUS_LABELS, status)) {
    return DECISION_STATUS_LABELS[status as keyof typeof DECISION_STATUS_LABELS];
  }
  return stripTerminalControls(status);
}

/** Returns labels missing from a Viewer source file. Empty means the sentences match. */
export function viewerLabelDrift(source: string): string[] {
  const expected = [
    ...Object.values(ATTENTION_REASON_LABELS),
    attentionEmptyText(undefined),
    attentionEmptyText({
      tasks: { total: 0, returned: 0, truncated: false },
      decisions: { total: 0, returned: 0, truncated: false },
      completeUnderRules: true,
    }),
    attentionEmptyText({
      tasks: { total: 1, returned: 0, truncated: true },
      decisions: { total: 1, returned: 1, truncated: false },
      completeUnderRules: false,
    }),
    "Attention coverage: tasks ",
    "Cues beyond the returned pages may exist.",
    "Both source pages are complete.",
    ARTIFACT_REFERENCE_LABEL,
    ORIENTATION_HINT_LABEL,
  ];
  return expected.filter((label) => !source.includes(label));
}
