/**
 * UIX-001 read-only terminal console.
 *
 * Record text is untrusted: only `renderDashboard` text is drawn, and every
 * record string goes through `stripTerminalControls`. Screen controls stay in
 * the session runner. A failed refresh keeps the last context.
 */
import { execFileSync } from "node:child_process";
import type { Artifact, Contribution, Decision, Task } from "../domain/types.js";
import {
  ARTIFACT_REFERENCE_LABEL,
  ASSIGNMENT_RECORD_NOTE,
  ORIENTATION_HINT_LABEL,
  attentionCoverageCounts,
  attentionCoverageText,
  attentionEmptyText,
  attentionReasonLabel,
  decisionStatusLabel,
  recordedParticipantLine,
  stripTerminalControls,
  taskStatusLabel,
} from "../presentation/work-console.js";
import type { AttentionItem, SupersededDecisionSummary, WorkspaceContext } from "../service/service.js";

export const DASHBOARD_AUTO_REFRESH_MS = 15_000;

export type DashboardSection = "attention" | "work" | "decisions" | "changes";
export type DashboardPerspective = "mine" | "team";
export type DashboardInspectKind = "task" | "finding" | "decision" | "artifact";

export interface DashboardInspectRequest {
  kind: DashboardInspectKind;
  id: string;
}

export interface DashboardInspected {
  method: string;
  sourceId: string;
  record: unknown;
}

export interface DashboardState {
  workspaceId: string;
  actorId: string;
  actorType: string;
  context?: WorkspaceContext;
  perspective: DashboardPerspective;
  section: DashboardSection;
  row: number;
  help: boolean;
  quit: boolean;
  refreshRequested: boolean;
  detailOpen: boolean;
  inspectRequest?: DashboardInspectRequest;
  inspected?: DashboardInspected;
  staleError?: string;
  refreshedAt?: string;
}

export interface DashboardSessionOptions {
  workspaceId: string;
  actorId: string;
  actorType: string;
  load: () => Promise<WorkspaceContext>;
  inspect?: (kind: DashboardInspectKind, id: string) => Promise<unknown>;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  now?: () => Date;
}

const SECTIONS: readonly DashboardSection[] = ["attention", "work", "decisions", "changes"];

const FOOTER = "p perspective   tab section   j/k move   enter inspect   r refresh   ? help   q quit";
const COMPACT_FOOTER = "j/k move   enter inspect   r refresh   q quit";

const HELP_LINES = [
  "p switches My work and Team work. It does not change the workspace.",
  "tab moves among attention, current work, decisions, and recent changes.",
  "j and k move within the section. enter opens a read-only detail.",
  "r refreshes. ? toggles this help. q quits.",
  "Registration and contributions are recorded history, not live presence.",
  "needsYou and needsAttention are cues, not permission.",
];

interface TaggedLine {
  text: string;
  rank: number;
}

interface DashRow {
  kind: "task" | "decision" | "finding" | "artifact" | "contribution";
  id: string;
  text: string;
  full: boolean;
  reviewCue: boolean;
  fetchKind?: DashboardInspectKind;
  objectType?: string;
  objectId?: string;
}

export function createDashboardState(input: {
  workspaceId: string;
  actorId: string;
  actorType: string;
  context?: WorkspaceContext;
  perspective?: DashboardPerspective;
  section?: DashboardSection;
  refreshedAt?: string;
  staleError?: string;
}): DashboardState {
  return {
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    actorType: input.actorType,
    perspective: input.perspective ?? "mine",
    section: input.section ?? "attention",
    row: 0,
    help: false,
    quit: false,
    refreshRequested: false,
    detailOpen: false,
    ...(input.context === undefined ? {} : { context: input.context }),
    ...(input.refreshedAt === undefined ? {} : { refreshedAt: input.refreshedAt }),
    ...(input.staleError === undefined ? {} : { staleError: input.staleError }),
  };
}

export function inspectMethod(kind: DashboardInspectKind): string {
  switch (kind) {
    case "task":
      return "get_task";
    case "finding":
      return "get_finding";
    case "decision":
      return "get_decision";
    case "artifact":
      return "get_artifact";
  }
}

function clean(value: string): string {
  return stripTerminalControls(value).replace(/\s+/g, " ").trim();
}

function sameWorkspace(state: DashboardState): WorkspaceContext | undefined {
  const context = state.context;
  if (context === undefined) return undefined;
  if (context.workspace.id !== state.workspaceId) return undefined;
  return context;
}

function viewport(columns: number, rows: number): { columns: number; rows: number } {
  const width = Number.isFinite(columns) && columns >= 1 ? Math.floor(columns) : 80;
  const height = Number.isFinite(rows) && rows >= 1 ? Math.floor(rows) : 24;
  return { columns: width, rows: height };
}

function wrapSegments(text: string, columns: number, indent: string): string[] {
  const body = stripTerminalControls(text).trim();
  const width = Math.max(indent.length + 1, Math.max(1, columns));
  const room = Math.max(1, width - indent.length);
  if (body.length === 0) return [indent.length > 0 ? indent : ""];
  const lines: string[] = [];
  let rest = body;
  while (rest.length > room) {
    let breakAt = rest.lastIndexOf(" ", room);
    if (breakAt <= 0) breakAt = room;
    lines.push(indent + rest.slice(0, breakAt));
    const next = rest.slice(breakAt).replace(/^ +/, "");
    rest = next.length < rest.length ? next : rest.slice(Math.max(1, room));
  }
  if (rest.length > 0) lines.push(indent + rest);
  return lines;
}

function chrome(text: string, columns: number, rank: number): TaggedLine[] {
  return wrapSegments(text, columns, "").map((line) => ({ text: line, rank }));
}

function record(text: string, columns: number, rank: number): TaggedLine[] {
  return wrapSegments(text, columns, "  ").map((line) => ({ text: line, rank }));
}

function taskById(context: WorkspaceContext, id: string): Task | undefined {
  const lists = [context.openTasks, context.currentWork.inProgressTasks, context.currentWork.blockedTasks];
  for (const list of lists) {
    const found = list.find((task) => task.id === id);
    if (found !== undefined) return found;
  }
  return undefined;
}

function decisionById(context: WorkspaceContext, id: string): Decision | undefined {
  const lists = [context.proposedDecisions, context.acceptedDecisions, context.currentWork.acceptedDecisions];
  for (const list of lists) {
    const found = list.find((decision) => decision.id === id);
    if (found !== undefined) return found;
  }
  return undefined;
}

function currentTasks(context: WorkspaceContext): Task[] {
  const byId = new Map<string, Task>();
  const consider = (task: Task): void => {
    if (task.status !== "open" && task.status !== "in_progress" && task.status !== "blocked") return;
    if (!byId.has(task.id)) byId.set(task.id, task);
  };
  for (const task of context.openTasks) consider(task);
  for (const task of context.currentWork.inProgressTasks) consider(task);
  for (const task of context.currentWork.blockedTasks) consider(task);
  return [...byId.values()];
}

function acceptedDecisions(context: WorkspaceContext): Decision[] {
  const byId = new Map<string, Decision>();
  for (const decision of context.acceptedDecisions) byId.set(decision.id, decision);
  for (const decision of context.currentWork.acceptedDecisions) {
    if (!byId.has(decision.id)) byId.set(decision.id, decision);
  }
  return [...byId.values()];
}

function taskText(task: Task): string {
  const token = clean(task.status);
  const label = taskStatusLabel(task.status);
  const status = token === label ? token : `${token}  ${label}`;
  return [status, clean(task.id), clean(task.title)].filter((part) => part.length > 0).join("  ");
}

function decisionText(decision: Decision): string {
  const token = clean(decision.status);
  const label = decisionStatusLabel(decision.status);
  const status = token === label ? token : `${token}  ${label}`;
  const parts = [status, clean(decision.id), clean(decision.summary)];
  if (decision.needsReview === true) {
    parts.push("needs review");
    const findings = decision.needsReviewFindingIds ?? [];
    if (findings.length > 0) parts.push(findings.map((id) => clean(id)).join(", "));
  }
  return parts.filter((part) => part.length > 0).join("  ");
}

function historicalText(decision: SupersededDecisionSummary): string {
  return [decisionStatusLabel("superseded"), clean(decision.id), clean(decision.summary)]
    .filter((part) => part.length > 0)
    .join("  ");
}

function attentionText(item: AttentionItem): string {
  const parts = [clean(item.status), clean(item.id), attentionReasonLabel(item.reason), clean(item.summary)];
  if (item.assignee !== undefined) parts.push(`assignee: ${clean(item.assignee.actorId)}`);
  const citations = item.needsReviewFindingIds ?? [];
  if (citations.length > 0) parts.push(`non-current citations: ${citations.map((id) => clean(id)).join(", ")}`);
  return parts.filter((part) => part.length > 0).join("  ");
}

function attentionItems(state: DashboardState, context: WorkspaceContext): AttentionItem[] {
  return state.perspective === "mine" ? context.needsYou : context.needsAttention;
}

function changeRows(context: WorkspaceContext): DashRow[] {
  if (context.provenance.length > 0) {
    return context.provenance.map((entry) => contributionRow(entry));
  }
  return context.slices.recentChanges.items.map((change) => ({
    kind: "contribution" as const,
    id: clean(change.objectId),
    text: [clean(change.actorId), clean(change.actorType), clean(change.changeType), clean(change.objectId)]
      .filter((part) => part.length > 0)
      .join("  "),
    full: true,
    reviewCue: false,
    objectType: change.objectType,
    objectId: change.objectId,
  }));
}

function contributionRow(entry: Contribution): DashRow {
  return {
    kind: "contribution",
    id: entry.id,
    text: [clean(entry.actor.actorId), clean(entry.actor.actorType), clean(entry.action), clean(entry.objectId)]
      .filter((part) => part.length > 0)
      .join("  "),
    full: true,
    reviewCue: false,
    objectType: entry.objectType,
    objectId: entry.objectId,
  };
}

export function sectionRows(state: DashboardState): DashRow[] {
  const context = sameWorkspace(state);
  if (context === undefined) return [];
  switch (state.section) {
    case "attention":
      return attentionItems(state, context).map((item) => {
        const kind = item.kind === "decision" ? "decision" : "task";
        const full = kind === "decision" ? decisionById(context, item.id) !== undefined : taskById(context, item.id) !== undefined;
        return {
          kind,
          id: item.id,
          text: attentionText(item),
          full,
          reviewCue: item.reason === "accepted_decision_needs_review" || (item.needsReviewFindingIds?.length ?? 0) > 0,
          ...(full ? {} : { fetchKind: kind }),
        };
      });
    case "work":
      return currentTasks(context).map((task) => ({
        kind: "task" as const,
        id: task.id,
        text: taskText(task),
        full: true,
        reviewCue: false,
      }));
    case "decisions": {
      const proposed = context.proposedDecisions.map((decision) => ({
        kind: "decision" as const,
        id: decision.id,
        text: decisionText(decision),
        full: true,
        reviewCue: false,
      }));
      const accepted = acceptedDecisions(context).map((decision) => ({
        kind: "decision" as const,
        id: decision.id,
        text: decisionText(decision),
        full: true,
        reviewCue: decision.needsReview === true,
      }));
      const historical = context.supersededDecisions.map((decision) => ({
        kind: "decision" as const,
        id: decision.id,
        text: historicalText(decision),
        full: false,
        reviewCue: false,
        fetchKind: "decision" as const,
      }));
      return [...proposed, ...accepted, ...historical];
    }
    case "changes":
      return changeRows(context);
  }
}

function sectionCount(state: DashboardState): number {
  return sectionRows(state).length;
}

function clampRow(state: DashboardState): DashboardState {
  const count = sectionCount(state);
  const row = count <= 0 ? 0 : Math.min(Math.max(0, state.row), count - 1);
  return row === state.row ? state : { ...state, row };
}

function withoutTransient(state: DashboardState): DashboardState {
  return {
    workspaceId: state.workspaceId,
    actorId: state.actorId,
    actorType: state.actorType,
    perspective: state.perspective,
    section: state.section,
    row: state.row,
    help: state.help,
    quit: state.quit,
    refreshRequested: false,
    detailOpen: false,
    ...(state.context === undefined ? {} : { context: state.context }),
    ...(state.staleError === undefined ? {} : { staleError: state.staleError }),
    ...(state.refreshedAt === undefined ? {} : { refreshedAt: state.refreshedAt }),
  };
}

function canonicalKey(key: string): string {
  if (key === "\t" || key === "tab") return "tab";
  if (key === "\r" || key === "\n" || key === "\r\n" || key === "enter") return "enter";
  if (key === "\u0003" || key === "ctrl-c" || key === "q") return "quit";
  return key;
}

export function reduceDashboardKey(state: DashboardState, key: string): DashboardState {
  const action = canonicalKey(key);
  if (action === "quit") return { ...state, quit: true, refreshRequested: false };
  if (action === "p") {
    return clampRow({
      ...withoutTransient(state),
      perspective: state.perspective === "mine" ? "team" : "mine",
      row: 0,
    });
  }
  if (action === "tab") {
    const index = SECTIONS.indexOf(state.section);
    const section = SECTIONS[(index + 1) % SECTIONS.length] ?? "attention";
    return clampRow({ ...withoutTransient(state), section, row: 0 });
  }
  if (action === "j" || action === "k") {
    const count = sectionCount(state);
    const delta = action === "j" ? 1 : -1;
    const row = count <= 0 ? 0 : Math.min(count - 1, Math.max(0, state.row + delta));
    return { ...withoutTransient(state), row };
  }
  if (action === "r") return { ...state, refreshRequested: true };
  if (action === "?") return { ...state, help: !state.help, refreshRequested: false };
  if (action === "enter") {
    const selected = sectionRows(state)[state.row];
    if (selected === undefined) return { ...withoutTransient(state), detailOpen: false };
    if (selected.full || selected.fetchKind === undefined) {
      return { ...withoutTransient(state), detailOpen: true };
    }
    return {
      ...withoutTransient(state),
      detailOpen: true,
      inspectRequest: { kind: selected.fetchKind, id: selected.id },
    };
  }
  return state;
}

function renderRowList(rows: DashRow[], selected: number, columns: number): TaggedLine[] {
  const lines: TaggedLine[] = [];
  rows.forEach((row, index) => {
    const marker = index === selected ? "> " : "";
    const rank = index === selected || row.reviewCue ? 0 : 1;
    lines.push(...record(`${marker}${row.text}`, columns, rank));
  });
  return lines;
}

function buildAttention(state: DashboardState, context: WorkspaceContext, columns: number): TaggedLine[] {
  const items = attentionItems(state, context);
  const selected = state.section === "attention";
  const counts = attentionCoverageCounts(context.attentionCoverage);
  const coverage = attentionCoverageText(context.attentionCoverage);
  const heading = state.perspective === "mine" ? "MY WORK  Needs You" : "TEAM WORK  Needs Attention";
  const lines: TaggedLine[] = [
    ...chrome(`${heading}  ATTENTION  ${counts}`, columns, 0),
    ...(coverage.length > 0 ? record(coverage, columns, 0) : []),
    ...record(ASSIGNMENT_RECORD_NOTE, columns, 1),
  ];
  if (items.length === 0) {
    lines.push(...record(attentionEmptyText(context.attentionCoverage), columns, 0));
    return lines;
  }
  lines.push(...renderRowList(sectionRows({ ...state, section: "attention" }), selected ? state.row : -1, columns));
  return lines;
}

function buildWork(state: DashboardState, context: WorkspaceContext, columns: number): TaggedLine[] {
  const rows = sectionRows({ ...state, section: "work" });
  const lines: TaggedLine[] = [...chrome("CURRENT WORK", columns, 1)];
  const hint = context.suggestedNextAction;
  if (hint !== undefined) {
    const parts = [ORIENTATION_HINT_LABEL];
    if (hint.id !== undefined && hint.id.length > 0) parts.push(clean(hint.id));
    if (hint.summary.length > 0) parts.push(clean(hint.summary));
    lines.push(...record(parts.join("  "), columns, 1));
  }
  if (rows.length === 0) {
    lines.push(...record("No open, in_progress, or blocked task in the returned records.", columns, 1));
    return lines;
  }
  lines.push(...renderRowList(rows, state.section === "work" ? state.row : -1, columns));
  return lines;
}

function buildDecisions(state: DashboardState, context: WorkspaceContext, columns: number): TaggedLine[] {
  const rows = sectionRows({ ...state, section: "decisions" });
  const lines: TaggedLine[] = [...chrome("RECORDED DECISIONS", columns, 1)];
  if (rows.length === 0) {
    lines.push(...record("No proposed or accepted decision in the returned records.", columns, 1));
    return lines;
  }
  lines.push(...renderRowList(rows, state.section === "decisions" ? state.row : -1, columns));
  return lines;
}

function buildChanges(state: DashboardState, context: WorkspaceContext, columns: number): TaggedLine[] {
  const rows = sectionRows({ ...state, section: "changes" });
  const truncated = context.provenanceTruncated ? "  truncated" : "";
  const lines: TaggedLine[] = [
    ...chrome(
      `RECENT CHANGES  showing ${context.provenance.length} of ${context.provenanceTotal}${truncated}`,
      columns,
      1,
    ),
  ];
  if (rows.length === 0) {
    lines.push(...record("No recent change in the returned records.", columns, 2));
    return lines;
  }
  lines.push(...renderRowList(rows, state.section === "changes" ? state.row : -1, columns));
  return lines;
}

function artifactFor(context: WorkspaceContext, id: string | undefined): Artifact | undefined {
  if (id === undefined) return undefined;
  return context.artifacts.find((artifact) => artifact.id === id);
}

function detailBody(detail: unknown, columns: number): TaggedLine[] {
  if (detail === null || typeof detail !== "object") return [];
  const fields = detail as Record<string, unknown>;
  const lines: TaggedLine[] = [];
  const pick = (label: string, value: unknown): void => {
    if (typeof value === "string" && value.length > 0) {
      lines.push(...record(`${label}  ${clean(value)}`, columns, 1));
    }
  };
  pick("status", fields.status);
  pick("title", fields.title);
  pick("summary", fields.summary);
  pick("type", fields.type);
  pick("uriOrPath", fields.uriOrPath);
  if (fields.needsReview === true) lines.push(...record("needs review", columns, 0));
  if (Array.isArray(fields.needsReviewFindingIds)) {
    const ids = fields.needsReviewFindingIds.filter((id): id is string => typeof id === "string");
    if (ids.length > 0) lines.push(...record(`non-current citations: ${ids.map((id) => clean(id)).join(", ")}`, columns, 0));
  }
  if (typeof fields.type === "string" && typeof fields.uriOrPath === "string") {
    lines.push(...record(ARTIFACT_REFERENCE_LABEL, columns, 0));
  }
  return lines;
}

function buildSource(state: DashboardState, context: WorkspaceContext, columns: number): TaggedLine[] {
  const rows = sectionRows(state);
  const selected = rows[state.row];
  const lines: TaggedLine[] = [...chrome("SOURCE", columns, 0)];
  if (selected === undefined) {
    lines.push(...record("no selected record", columns, 1));
    return lines;
  }
  const inspected =
    state.detailOpen && state.inspected !== undefined && state.inspected.sourceId === selected.id
      ? state.inspected
      : undefined;
  const method =
    inspected !== undefined
      ? inspected.method
      : selected.full || selected.fetchKind === undefined
        ? "get_workspace_context"
        : inspectMethod(selected.fetchKind);
  lines.push(...record(`${method}  ${clean(selected.id)}`, columns, 0));
  if (inspected !== undefined) lines.push(...detailBody(inspected.record, columns));
  const task = selected.kind === "task" ? taskById(context, selected.id) : undefined;
  if (task !== undefined && inspected === undefined) {
    lines.push(...record(`${clean(task.status)}  ${clean(task.title)}`, columns, 1));
  }
  const decision = selected.kind === "decision" ? decisionById(context, selected.id) : undefined;
  if (decision !== undefined && inspected === undefined) {
    lines.push(...record(decisionText(decision), columns, decision.needsReview === true ? 0 : 1));
  }
  const artifactId = selected.kind === "artifact" ? selected.id : selected.objectType === "artifact" ? selected.objectId : undefined;
  const artifact = artifactFor(context, artifactId);
  if (artifact !== undefined) {
    lines.push(
      ...record(
        `${clean(artifact.id)}  ${clean(artifact.type)}  ${clean(artifact.uriOrPath)}  ${ARTIFACT_REFERENCE_LABEL}`,
        columns,
        0,
      ),
    );
  } else if (selected.objectType === "artifact" && selected.objectId !== undefined) {
    lines.push(...record(`${clean(selected.objectId)}  ${ARTIFACT_REFERENCE_LABEL}`, columns, 0));
  }
  return lines;
}

function fullWidthFacts(state: DashboardState, context: WorkspaceContext, columns: number): TaggedLine[] {
  const lines: TaggedLine[] = [];
  if (attentionItems(state, context).length === 0) {
    lines.push(...record(attentionEmptyText(context.attentionCoverage), columns, 0));
  }
  for (const decision of context.proposedDecisions) {
    lines.push(...record(`${decisionStatusLabel(decision.status)}  ${clean(decision.id)}`, columns, 0));
  }
  for (const decision of acceptedDecisions(context)) {
    const findings = (decision.needsReviewFindingIds ?? []).map((id) => clean(id)).filter((id) => id.length > 0);
    const review = decision.needsReview === true ? `  needs review${findings.length > 0 ? `  ${findings.join(", ")}` : ""}` : "";
    lines.push(...record(`accepted  ${clean(decision.id)}${review}`, columns, 0));
  }
  for (const decision of context.supersededDecisions) {
    lines.push(...record(`${decisionStatusLabel("superseded")}  ${clean(decision.id)}`, columns, 1));
  }
  return lines;
}

function buildArtifactReferences(context: WorkspaceContext, columns: number): TaggedLine[] {
  if (context.artifacts.length === 0) return [];
  const lines: TaggedLine[] = [...chrome("ARTIFACT REFERENCES", columns, 1)];
  for (const artifact of context.artifacts) {
    lines.push(
      ...record(
        `${clean(artifact.id)}  ${clean(artifact.type)}  ${clean(artifact.uriOrPath)}  ${ARTIFACT_REFERENCE_LABEL}`,
        columns,
        0,
      ),
    );
  }
  return lines;
}

function buildParticipants(context: WorkspaceContext, columns: number): TaggedLine[] {
  const humans = context.participants.filter((participant) => participant.actor.actorType === "human").length;
  const agents = context.participants.filter((participant) => participant.actor.actorType === "agent").length;
  const lines: TaggedLine[] = [...chrome(recordedParticipantLine(humans, agents), columns, 1)];
  for (const participant of context.participants) {
    if (participant.actor.actorType !== "agent") continue;
    const harness = participant.harness === undefined ? "harness not recorded" : clean(participant.harness);
    const owner = participant.humanOwnerId === undefined ? "owner not recorded" : clean(participant.humanOwnerId);
    lines.push(
      ...record(`${clean(participant.name)}  ${harness}  owner ${owner}  registered  recorded`, columns, 1),
    );
  }
  return lines;
}

function footerLines(columns: number): TaggedLine[] {
  const lines = chrome(columns < 100 ? COMPACT_FOOTER : FOOTER, columns, 0);
  if (lines.some((line) => line.text.includes("q quit"))) return lines;
  return [{ text: "q quit", rank: 0 }];
}

function fit(tagged: TaggedLine[], rows: number): string[] {
  const kept = tagged.slice();
  while (kept.length > rows) {
    let drop = -1;
    let best = -1;
    for (let index = kept.length - 1; index >= 0; index -= 1) {
      const rank = kept[index]?.rank ?? 0;
      if (rank > best) {
        best = rank;
        drop = index;
      }
    }
    if (drop < 0 || best <= 0) break;
    kept.splice(drop, 1);
  }
  const visible = kept.length > rows ? kept.slice(0, rows) : kept;
  return visible.map((line) => line.text);
}

/**
 * A full screen of rank-0 cues can push the selected id off the first page.
 * Put any missing fact back on the last content line. The footer stays.
 */
function pinFacts(lines: string[], columns: number, facts: readonly string[]): string[] {
  const frame = [...lines];
  const missing = facts.filter(
    (fact) => fact.length > 0 && !frame.some((line) => line.includes(fact)),
  );
  let slot = frame.length - 1;
  if ((frame[slot] ?? "").includes("q quit")) slot -= 1;
  for (const fact of missing) {
    if (slot < 0) break;
    const text = `  ${fact}`;
    frame[slot] = text.length > columns ? text.slice(0, columns) : text;
    slot -= 1;
  }
  return frame;
}

function zipColumns(left: TaggedLine[], right: TaggedLine[], leftWidth: number, rightWidth: number): TaggedLine[] {
  const count = Math.max(left.length, right.length);
  const lines: TaggedLine[] = [];
  for (let index = 0; index < count; index += 1) {
    const l = left[index];
    const r = right[index];
    const ltext = (l?.text ?? "").padEnd(leftWidth, " ").slice(0, leftWidth);
    const rtext = (r?.text ?? "").slice(0, rightWidth);
    lines.push({
      text: `${ltext} ${rtext}`.trimEnd(),
      rank: Math.min(l?.rank ?? 9, r?.rank ?? 9),
    });
  }
  return lines;
}

export function renderDashboard(state: DashboardState, columns: number, rows: number): string {
  const size = viewport(columns, rows);
  const context = sameWorkspace(state);
  const name = context === undefined ? "workspace" : clean(context.workspace.name);
  const refreshed = state.refreshedAt === undefined ? "not yet" : clean(state.refreshedAt);
  const header: TaggedLine[] = [
    ...chrome(`Campfire  /  ${name}  ${clean(state.workspaceId)}`, size.columns, 0),
    ...chrome(`${clean(state.actorId)} ${clean(state.actorType)}  ·  refreshed ${refreshed}`, size.columns, 0),
  ];
  if (context?.goal === undefined) {
    header.push(...chrome("GOAL", size.columns, 0), ...record("no recorded goal", size.columns, 0));
  } else {
    header.push(
      ...chrome("GOAL", size.columns, 0),
      ...record(clean(context.goal.title), size.columns, 0),
      ...record(clean(context.goal.id), size.columns, 0),
    );
  }
  if (state.staleError !== undefined && clean(state.staleError).length > 0) {
    header.push(...record(`STALE  ${clean(state.staleError)}`, size.columns, 0));
  } else if (state.context !== undefined && context === undefined) {
    header.push(...record("STALE  workspace context did not match the authorized workspace", size.columns, 0));
  }
  if (context !== undefined) {
    header.push(...record(attentionCoverageCounts(context.attentionCoverage), size.columns, 0));
    header.push(...buildParticipants(context, size.columns));
    header.push(...buildArtifactReferences(context, size.columns));
    header.push(...fullWidthFacts(state, context, size.columns));
  }

  let body: TaggedLine[] = [];
  if (state.help) {
    body.push(...chrome("HELP", size.columns, 1));
    for (const line of HELP_LINES) body.push(...record(line, size.columns, 1));
  }
  if (context !== undefined) {
    const sections: Record<DashboardSection, TaggedLine[]> = {
      attention: buildAttention(state, context, size.columns < 100 ? size.columns : Math.floor((size.columns - 1) / 2)),
      work: buildWork(state, context, size.columns < 100 ? size.columns : Math.floor((size.columns - 1) / 2)),
      decisions: buildDecisions(
        state,
        context,
        size.columns < 100 ? size.columns : size.columns - Math.floor((size.columns - 1) / 2) - 1,
      ),
      changes: buildChanges(
        state,
        context,
        size.columns < 100 ? size.columns : size.columns - Math.floor((size.columns - 1) / 2) - 1,
      ),
    };
    if (size.columns < 100) {
      const order = [state.section, ...SECTIONS.filter((section) => section !== state.section)];
      for (const section of order) {
        const block = sections[section];
        if (block !== undefined) body.push(...block);
      }
    } else {
      const leftWidth = Math.floor((size.columns - 1) / 2);
      const rightWidth = size.columns - leftWidth - 1;
      body.push(
        ...zipColumns(
          [...sections.attention, ...sections.work],
          [...sections.decisions, ...sections.changes],
          leftWidth,
          rightWidth,
        ),
      );
    }
    const sourceWidth = size.columns;
    body.push(...buildSource(state, context, sourceWidth));
  }
  const footer = footerLines(size.columns);
  const footerKept = footer.length >= size.rows ? footer.slice(footer.length - size.rows) : footer;
  const fitted = fit([...header, ...body], size.rows - footerKept.length);
  const selected = context === undefined ? undefined : sectionRows(state)[state.row];
  const coverageToken =
    context === undefined ? "" : attentionCoverageCounts(context.attentionCoverage).split(" ")[0] ?? "";
  const facts = [state.workspaceId, context?.goal?.id ?? "", selected?.id ?? "", coverageToken];
  return pinFacts([...fitted, ...footerKept.map((line) => line.text)], size.columns, facts)
    .map((line) => stripTerminalControls(line))
    .join("\n");
}

function terminalIsForeground(): boolean {
  try {
    const pid = String(process.pid);
    const tpgid = execFileSync("ps", ["-o", "tpgid=", "-p", pid], { encoding: "utf8" }).trim();
    const pgid = execFileSync("ps", ["-o", "pgid=", "-p", pid], { encoding: "utf8" }).trim();
    return tpgid.length > 0 && tpgid === pgid;
  } catch {
    return false;
  }
}

function writeControl(stream: NodeJS.WriteStream, text: string): void {
  try {
    stream.write(text);
  } catch {
    // A dead stream must not hide the original failure during restore.
  }
}

function normalizeInputKey(text: string): string | undefined {
  if (text.includes("\u0003")) return "\u0003";
  if (text === "\t") return "tab";
  if (text === "\r" || text === "\n" || text === "\r\n") return "enter";
  if (text === "p" || text === "j" || text === "k" || text === "r" || text === "?" || text === "q") return text;
  return undefined;
}

export async function runDashboardSession(options: DashboardSessionOptions): Promise<void> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const now = options.now ?? ((): Date => new Date());
  let state = createDashboardState({
    workspaceId: options.workspaceId,
    actorId: options.actorId,
    actorType: options.actorType,
  });
  let closed = false;
  let finished = false;
  let screenOn = false;
  let rawEnabled = false;
  let suspended = false;
  let refreshInFlight = false;
  let pendingManual = false;
  let listening = false;
  let resolveQuit: () => void = () => {};
  const quitPromise = new Promise<void>((resolve) => {
    resolveQuit = resolve;
  });

  const viewportOf = (): { columns: number; rows: number } => {
    const columns = stdout.columns;
    const rows = stdout.rows;
    return {
      columns: typeof columns === "number" && columns > 0 ? columns : 80,
      rows: typeof rows === "number" && rows > 0 ? rows : 24,
    };
  };

  const draw = (): void => {
    if (closed) return;
    const size = viewportOf();
    const frame = renderDashboard(state, size.columns, size.rows);
    writeControl(stdout, "\x1b[H\x1b[2J");
    writeControl(stdout, frame.endsWith("\n") ? frame : `${frame}\n`);
    writeControl(stdout, "\x1b[H");
  };

  const enterScreen = (): void => {
    writeControl(stdout, "\x1b[?1049h");
    writeControl(stdout, "\x1b[?25l");
    if (stdin.isTTY === true && typeof stdin.setRawMode === "function") {
      stdin.setRawMode(true);
      rawEnabled = true;
    }
    stdin.resume();
    screenOn = true;
  };

  const leaveScreen = (): void => {
    if (rawEnabled && typeof stdin.setRawMode === "function") {
      try {
        stdin.setRawMode(false);
      } catch {
        // Already restored.
      }
      rawEnabled = false;
    }
    writeControl(stdout, "\x1b[?25h");
    writeControl(stdout, "\x1b[?1049l");
    try {
      stdin.pause();
    } catch {
      // Already paused.
    }
    screenOn = false;
  };

  const finish = (): void => {
    if (finished) return;
    finished = true;
    closed = true;
    resolveQuit();
  };

  const refresh = async (automatic: boolean): Promise<void> => {
    if (closed) return;
    if (automatic && (suspended || !terminalIsForeground())) return;
    if (refreshInFlight) {
      if (!automatic) pendingManual = true;
      return;
    }
    refreshInFlight = true;
    try {
      const loaded = await options.load();
      if (closed) return;
      if (loaded.workspace.id !== state.workspaceId) {
        throw new Error("workspace context did not match the authorized workspace");
      }
      state = clampRow({
        ...state,
        context: loaded,
        staleError: undefined,
        refreshedAt: now().toISOString(),
        refreshRequested: false,
      });
    } catch (error) {
      if (closed) return;
      const message = stripTerminalControls(error instanceof Error ? error.message : String(error));
      state = {
        ...state,
        staleError: message.length > 0 ? message : "read failed",
        refreshRequested: false,
      };
    } finally {
      refreshInFlight = false;
    }
    if (!closed) draw();
    if (pendingManual && !closed) {
      pendingManual = false;
      await refresh(false);
    }
  };

  const inspectSelection = async (): Promise<void> => {
    const request = state.inspectRequest;
    if (request === undefined || options.inspect === undefined) return;
    const method = inspectMethod(request.kind);
    try {
      const record = await options.inspect(request.kind, request.id);
      if (closed) return;
      if (state.inspectRequest?.id !== request.id || state.inspectRequest.kind !== request.kind) return;
      state = { ...state, inspectRequest: undefined, inspected: { method, sourceId: request.id, record } };
    } catch (error) {
      if (closed) return;
      const message = stripTerminalControls(error instanceof Error ? error.message : String(error));
      state = {
        ...state,
        inspectRequest: undefined,
        staleError: message.length > 0 ? message : "read failed",
      };
    }
  };

  const onData = (chunk: Buffer | string): void => {
    if (closed || finished) return;
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const key = normalizeInputKey(text);
    if (key === undefined) return;
    state = reduceDashboardKey(state, key);
    if (state.quit) {
      finish();
      return;
    }
    if (state.refreshRequested) {
      void refresh(false);
      return;
    }
    void inspectSelection().finally(() => {
      if (!closed) draw();
    });
  };

  const onResize = (): void => {
    if (!closed) draw();
  };

  const onSigint = (): void => {
    state = { ...state, quit: true };
    finish();
  };

  const onStop = (): void => {
    suspended = true;
    if (screenOn) leaveScreen();
    try {
      process.kill(process.pid, "SIGSTOP");
    } catch {
      // Stay suspended so a failed check does not refresh in the background.
    }
  };

  const onCont = (): void => {
    const wasSuspended = suspended;
    suspended = false;
    if (closed) return;
    if (wasSuspended && !screenOn) {
      enterScreen();
      draw();
    }
  };

  const timer = setInterval(() => {
    void refresh(true);
  }, DASHBOARD_AUTO_REFRESH_MS);
  if (typeof timer.unref === "function") timer.unref();

  try {
    enterScreen();
    stdin.on("data", onData);
    stdout.on("resize", onResize);
    process.on("SIGINT", onSigint);
    process.on("SIGTSTP", onStop);
    process.on("SIGCONT", onCont);
    listening = true;
    await refresh(false);
    if (!finished) await quitPromise;
  } finally {
    closed = true;
    clearInterval(timer);
    if (listening) {
      stdin.off("data", onData);
      stdout.off("resize", onResize);
      process.off("SIGINT", onSigint);
      process.off("SIGTSTP", onStop);
      process.off("SIGCONT", onCont);
    }
    leaveScreen();
  }
}
