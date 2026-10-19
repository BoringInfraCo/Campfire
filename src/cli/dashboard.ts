/**
 * UIX-001 read-only terminal console; NAV-001 focused navigator; NAV-002
 * paged work, on-demand people, and selected-record history.
 *
 * One active section renders at a time. The local `/` filter narrows the
 * shown rows of the loaded page — matching, loaded, and workspace total stay
 * separate numbers. It is not workspace search. Record text is untrusted:
 * only `renderDashboard` text is drawn, and every record string goes through
 * `stripTerminalControls`. An omitted participant roster is not zero people.
 */
import { execFileSync } from "node:child_process";
import { CampfireError } from "../domain/errors.js";
import type { Artifact, Contribution, Decision, Finding, Task } from "../domain/types.js";
import {
  ARTIFACT_EXTERNAL_UNVERIFIED_LABEL,
  ARTIFACT_REFERENCE_LABEL,
  ARTIFACT_UNSAFE_CONTROL_LABEL,
  ASSIGNMENT_RECORD_NOTE,
  ORIENTATION_HINT_LABEL,
  attentionCoverageCounts,
  attentionCoverageText,
  attentionEmptyText,
  attentionReasonLabel,
  classifyArtifactReference,
  decisionStatusLabel,
  recordedParticipantLine,
  stripTerminalControls,
  taskStatusLabel,
} from "../presentation/work-console.js";
import type {
  AttentionItem,
  ParticipantListItem,
  SupersededDecisionSummary,
  WorkspaceContext,
} from "../service/service.js";

export const DASHBOARD_AUTO_REFRESH_MS = 15_000;
export const DASHBOARD_TASK_PAGE_LIMIT = 20;
export const DASHBOARD_PEOPLE_PAGE_LIMIT = 20;
export const DASHBOARD_HISTORY_PAGE_LIMIT = 10;

const HISTORY_EMPTY_TEXT = "No contributions recorded for this record";
const PAGING_UNAVAILABLE = "Paging is unavailable here.";
const CURSOR_REJECTED = "The page cursor was rejected. Showing a fresh first page.";
const SELECTION_MOVED = "The previous selection is no longer on this page.";
const NOT_RUNNING = "in_progress is a recorded task status, not a running process.";
const NOT_ATTENTION = "This page is not an attention recomputation or an all-clear.";
const NOT_CENSUS = "Pages are separate reads. This is not a consistent census.";
const NOT_PRESENCE = "Recorded registration is not presence or permission to act.";

export type DashboardSection = "attention" | "work" | "decisions" | "references" | "people" | "changes";
export type DashboardPerspective = "mine" | "team";
export type DashboardInspectKind = "task" | "finding" | "decision" | "artifact";
export type HistoryObjectType = DashboardInspectKind;

export interface DashboardInspectRequest {
  kind: DashboardInspectKind;
  id: string;
  generation: number;
}

export interface DashboardInspected {
  method: string;
  sourceId: string;
  record: unknown;
}

/** One step back through a cursor stack. `cursor` undefined is the first page. */
export interface PagePlace {
  cursor?: string;
  pageNumber: number;
  humanOwnerId?: string;
}

export interface LoadedPage<T> {
  items: T[];
  total: number;
  returned: number;
  truncated: boolean;
  nextCursor?: string;
  cursor?: string;
  pageNumber: number;
  readAt: string;
  cursorStack: PagePlace[];
  stale: boolean;
  error?: string;
}

export interface PeoplePageState extends LoadedPage<ParticipantListItem> {
  /** Set when the page is that human's workspace-participating agents. */
  humanOwnerId?: string;
}

/**
 * Unfiltered roster walk. A split is shown only when pages 1..N were applied
 * in order and the summed rows equal the authorized total.
 */
export interface PeopleSplit {
  humans: number;
  agents: number;
  summed: number;
  complete: boolean;
  /** True only for a contiguous walk that began on unfiltered page 1. */
  fromStart: boolean;
  nextPage?: number;
}

export interface HistoryState {
  open: boolean;
  objectType: HistoryObjectType;
  objectId: string;
  /** Selected contribution within the loaded API page. */
  row: number;
  page?: LoadedPage<Contribution>;
  unavailable?: string;
}

export interface PageRequest {
  generation: number;
  cursor?: string;
  pageNumber: number;
  cursorStack: PagePlace[];
  previousSelectionId?: string;
  recoverOnRejectedCursor: boolean;
  humanOwnerId?: string;
  objectType?: HistoryObjectType;
  objectId?: string;
}

export interface DashboardPageInput<T> {
  items: T[];
  total: number;
  returned: number;
  truncated: boolean;
  nextCursor?: string;
}

export interface AppliedPageStamp {
  generation: number;
  readAt: string;
  cursor?: string;
  pageNumber: number;
  cursorStack: PagePlace[];
  previousSelectionId?: string;
  humanOwnerId?: string;
}

export interface HistoryStamp {
  generation: number;
  readAt: string;
  cursor?: string;
  pageNumber: number;
  cursorStack: PagePlace[];
  objectType: HistoryObjectType;
  objectId: string;
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
  /** Local filter over the shown rows of the active section (never the workspace). */
  filter: string;
  filterMode: boolean;
  /** Bumped when workspace, actor, perspective, section, page, or selection changes. */
  generation: number;
  /**
   * Real sessions page Work with `list_tasks`. Unit fixtures that only carry
   * an orientation context leave this false and keep the NAV-001 work rows.
   */
  boundedReads: boolean;
  inspectRequest?: DashboardInspectRequest;
  inspected?: DashboardInspected;
  staleError?: string;
  refreshedAt?: string;
  taskPage?: LoadedPage<Task>;
  taskPageRequest?: PageRequest;
  peoplePage?: PeoplePageState;
  peoplePageRequest?: PageRequest;
  peopleSplit?: PeopleSplit;
  history?: HistoryState;
  historyRequest?: PageRequest;
  /** Why an unavailable key did nothing. Not an exception. */
  statusNote?: string;
  selectionNote?: string;
}

export interface DashboardSessionOptions {
  workspaceId: string;
  actorId: string;
  actorType: string;
  load: () => Promise<WorkspaceContext>;
  inspect?: (kind: DashboardInspectKind, id: string) => Promise<unknown>;
  loadTasks?: (cursor: string | undefined) => Promise<DashboardPageInput<Task>>;
  loadPeople?: (input: { cursor?: string; humanOwnerId?: string }) => Promise<DashboardPageInput<ParticipantListItem>>;
  loadHistory?: (input: {
    objectType: HistoryObjectType;
    objectId: string;
    cursor?: string;
  }) => Promise<DashboardPageInput<Contribution>>;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  now?: () => Date;
}

const SECTIONS: readonly DashboardSection[] = [
  "attention",
  "work",
  "decisions",
  "references",
  "people",
  "changes",
];

const FOOTER =
  "p perspective   tab section   j/k move   n/b page   h history   / filter   enter   r refresh   ? help   esc   q quit";
const COMPACT_FOOTER = "tab  j/k move  n/b page  h history  / filter  enter  r  ?  esc  q quit";

const HELP_LINES = [
  "p switches My work and Team work. It does not change the workspace.",
  "tab moves among attention, work, decisions, references, people, and recent changes.",
  "j and k move within shown rows, or among loaded contributions while history is open. enter opens a read-only detail.",
  "n and b page Work, People, or an open history panel. Elsewhere they do not move the selection.",
  "h opens or closes recorded changes for the selected task, decision, finding, or artifact.",
  "esc closes history first. A later esc clears a committed filter. ctrl-c always quits.",
  "/ filters the loaded page, not the workspace. enter confirms; esc clears. Letters stay text.",
  "r reloads orientation and the active page as separate reads.",
  "? toggles this help. q quits.",
  "Registration, role, and join time are not presence or permission.",
  "needsYou and needsAttention are cues, not permission. A work page is not an all-clear.",
  "An empty history means no contributions are recorded for that record, not that no earlier work happened.",
];

interface TaggedLine {
  text: string;
  rank: number;
}

interface DashRow {
  kind: "task" | "decision" | "finding" | "artifact" | "contribution" | "participant";
  id: string;
  text: string;
  full: boolean;
  reviewCue: boolean;
  fetchKind?: DashboardInspectKind;
  objectType?: string;
  objectId?: string;
  participant?: ParticipantListItem;
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
  boundedReads?: boolean;
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
    filter: "",
    filterMode: false,
    generation: 1,
    boundedReads: input.boundedReads ?? false,
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

function participantText(item: ParticipantListItem): string {
  const id = clean(item.actor.actorId);
  const name = clean(item.name);
  const who = item.actor.actorType === "agent" ? "agent" : "human";
  const label = name.length > 0 ? name : id;
  const parts = [who, label];
  if (label !== id) parts.push(id);
  parts.push(`role ${clean(item.role)}`);
  if (item.harness !== undefined && clean(item.harness).length > 0) parts.push(`harness ${clean(item.harness)}`);
  return parts.filter((part) => part.length > 0).join("  ");
}

function taskRow(task: Task): DashRow {
  return { kind: "task", id: task.id, text: taskText(task), full: true, reviewCue: false };
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

/**
 * ARH-001 inspect-only artifact reference text.
 *
 * Terminal rows gain the frozen reference class, the destination host for
 * openable-https references, and the recorded cited-by relations — all from
 * the same authorized read this projection already holds. Relations are never
 * inferred and never invented under "no relation found": the row simply shows
 * them when the serving read's findings carry an evidence row for this
 * artifact. The external caveat names the access boundary; membership is
 * never described as external access (runbook and §4 wording preserved).
 *
 * There is deliberately NO open action in the terminal: inspect-only upgrade.
 */
function artifactReferenceTail(artifact: Artifact, context: WorkspaceContext): string {
  const parts: string[] = [ARTIFACT_REFERENCE_LABEL];
  const classification = classifyArtifactReference(artifact.uriOrPath);
  // Cited-by is a fact about the artifact record, not about its reference, so
  // it does not depend on the class; class/host/caveat do not render for a
  // missing reference.
  const citedBy = citedByText(artifact.id, context.findings);
  if (classification.class !== "none") {
    parts.push(`class ${classification.class}`);
    if (classification.host !== null) parts.push(`host ${classification.host}`);
  }
  if (citedBy !== null) parts.push(citedBy);
  if (classification.class !== "none") {
    parts.push(ARTIFACT_EXTERNAL_UNVERIFIED_LABEL);
    if (classification.unsafe) parts.push(ARTIFACT_UNSAFE_CONTROL_LABEL);
  }
  return parts.join("  ");
}

function artifactReferenceText(artifact: Artifact, context: WorkspaceContext): string {
  const parts = [clean(artifact.id), clean(artifact.type), clean(artifact.uriOrPath), artifactReferenceTail(artifact, context)];
  return parts.filter((part) => part.length > 0).join("  ");
}

/**
 * Cited-by relations exactly as the returned findings record them (Finding ID
 * + relation, deduplicated per finding/relation pair, in read order).
 */
function citedByText(artifactId: string, findings: WorkspaceContext["findings"]): string | null {
  const cites: string[] = [];
  const seen = new Set<string>();
  for (const finding of findings) {
    const findingId = clean(finding.id);
    for (const row of finding.evidence ?? []) {
      if (row.artifactId !== artifactId) continue;
      const relation = clean(row.relation);
      const key = `${findingId}\u0000${relation}`;
      if (findingId.length === 0 || relation.length === 0 || seen.has(key)) continue;
      seen.add(key);
      cites.push(`${findingId} (${relation})`);
    }
  }
  if (cites.length === 0) return null;
  return `cited by ${cites.join(", ")}`;
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
      // A loaded list_tasks page is the work list. Orientation tasks stay the
      // fallback only for fixtures that never asked for a bounded page.
      if (state.taskPage !== undefined) return state.taskPage.items.map(taskRow);
      if (state.boundedReads) return [];
      return currentTasks(context).map(taskRow);
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
    case "references":
      // NAV-001: the v1.21 typed reference rows are reachable on demand
      // instead of printing every Artifact above the default work list.
      return context.artifacts.map((artifact) => ({
        kind: "artifact" as const,
        id: artifact.id,
        text: artifactReferenceText(artifact, context),
        full: true,
        reviewCue: false,
      }));
    case "people":
      // Rows come only from the participant page. The orientation array is
      // not a page, and an omitted array is not a roster.
      return (state.peoplePage?.items ?? []).map((item) => ({
        kind: "participant" as const,
        id: item.actor.actorId,
        text: participantText(item),
        full: true,
        reviewCue: false,
        participant: item,
      }));
    case "changes":
      return changeRows(context);
  }
}

/**
 * The "shown rows": the active section's loaded rows narrowed by the local
 * filter (case-insensitive substring over the row id or its rendered text).
 * An empty filter returns the loaded rows unchanged.
 */
export function shownRows(state: DashboardState): DashRow[] {
  const rows = sectionRows(state);
  if (state.filter.length === 0) return rows;
  const needle = state.filter.toLowerCase();
  return rows.filter(
    (row) => row.id.toLowerCase().includes(needle) || row.text.toLowerCase().includes(needle),
  );
}

function filterActive(state: DashboardState): boolean {
  return state.filter.length > 0 || state.filterMode;
}

function sectionCount(state: DashboardState): number {
  return shownRows(state).length;
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
    filter: state.filter,
    filterMode: state.filterMode,
    generation: state.generation,
    boundedReads: state.boundedReads,
    ...(state.context === undefined ? {} : { context: state.context }),
    ...(state.staleError === undefined ? {} : { staleError: state.staleError }),
    ...(state.refreshedAt === undefined ? {} : { refreshedAt: state.refreshedAt }),
    ...(state.taskPage === undefined ? {} : { taskPage: state.taskPage }),
    ...(state.peoplePage === undefined ? {} : { peoplePage: state.peoplePage }),
    ...(state.peopleSplit === undefined ? {} : { peopleSplit: state.peopleSplit }),
  };
}

function canonicalKey(key: string): string {
  if (key === "\t" || key === "tab") return "tab";
  if (key === "\r" || key === "\n" || key === "\r\n" || key === "enter") return "enter";
  if (key === "\u0003" || key === "ctrl-c" || key === "q") return "quit";
  return key;
}

/**
 * Selection reconciliation across a reshaped shown list.
 *
 * `previous` still carries the old list (old filter text or old context);
 * `next` carries the new one. The selected row id is preserved when it
 * survives, keeping `detailOpen`/`inspected` only while the inspected source
 * still equals that selection; when it disappears the top shown row is
 * selected and stale detail is dropped so an old record never renders as the
 * current selection.
 */
function reconcileSelection(previous: DashboardState, next: DashboardState): DashboardState {
  const selectedId = shownRows(previous)[previous.row]?.id;
  const index = selectedId === undefined ? -1 : shownRows(next).findIndex((row) => row.id === selectedId);
  if (selectedId === undefined || index < 0) {
    const lost = selectedId !== undefined;
    return {
      ...next,
      row: 0,
      detailOpen: false,
      inspected: undefined,
      ...(lost
        ? {
            generation: previous.generation + 1,
            history: undefined,
            historyRequest: undefined,
            inspectRequest: undefined,
          }
        : {}),
    };
  }
  const historyMatches = previous.history?.open === true && previous.history.objectId === selectedId;
  const keptHistory = historyMatches
    ? { history: previous.history, ...(previous.historyRequest === undefined ? {} : { historyRequest: previous.historyRequest }) }
    : { history: undefined, historyRequest: undefined };
  if (next.detailOpen && next.inspected !== undefined && next.inspected.sourceId === selectedId) {
    return { ...next, row: index, ...keptHistory };
  }
  return { ...next, row: index, detailOpen: false, inspected: undefined, ...keptHistory };
}

/**
 * Post-load reconciliation (exported for tests): replace the context and
 * timestamp after a successful read, keep the selected row id when it
 * survives in the new shown list, and drop `detailOpen`/`inspected` when the
 * selection disappears so no old detail is shown as current.
 */
export function reconcileAfterLoad(
  state: DashboardState,
  loaded: WorkspaceContext,
  refreshedAt: string,
): DashboardState {
  return reconcileSelection(state, {
    ...state,
    context: loaded,
    staleError: undefined,
    refreshedAt,
    refreshRequested: false,
  });
}

/** Filter-typing mode keys. Ctrl-C is handled first, in every mode. */
function reduceFilterModeKey(state: DashboardState, key: string): DashboardState {
  if (key === "\u001b" || key === "esc") {
    // esc clears the text AND leaves typing mode in one step.
    return reconcileSelection(state, { ...state, filter: "", filterMode: false });
  }
  if (key === "\r" || key === "\n" || key === "\r\n" || key === "enter") {
    // enter confirms: the text stays and keeps narrowing the shown rows.
    return { ...state, filterMode: false };
  }
  if (key === "\u007f" || key === "\u0008" || key === "backspace") {
    if (state.filter.length === 0) return state;
    return reconcileSelection(state, { ...state, filter: state.filter.slice(0, -1) });
  }
  if (key.length === 1) {
    const code = key.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) {
      return reconcileSelection(state, { ...state, filter: state.filter + key });
    }
  }
  return state;
}

function selectedRow(state: DashboardState): DashRow | undefined {
  return shownRows(state)[state.row];
}

function historyTarget(row: DashRow | undefined): { objectType: HistoryObjectType; objectId: string } | undefined {
  if (row === undefined) return undefined;
  if (row.kind === "task" || row.kind === "decision" || row.kind === "finding" || row.kind === "artifact") {
    return { objectType: row.kind, objectId: row.id };
  }
  return undefined;
}

function openSection(state: DashboardState, section: DashboardSection): DashboardState {
  const generation = state.generation + 1;
  const next: DashboardState = {
    ...withoutTransient(state),
    section,
    row: 0,
    generation,
  };
  if (section === "work" && state.boundedReads && state.taskPage === undefined) {
    next.taskPageRequest = { generation, pageNumber: 1, cursorStack: [], recoverOnRejectedCursor: false };
  }
  if (section === "people" && state.peoplePage === undefined) {
    next.peoplePageRequest = { generation, pageNumber: 1, cursorStack: [], recoverOnRejectedCursor: false };
  }
  return clampRow(next);
}

/** Reload orientation and the active page. Each read keeps its own generation. */
export function requestDashboardRefresh(state: DashboardState): DashboardState {
  const generation = state.generation + 1;
  const selectedId = selectedRow(state)?.id;
  const next: DashboardState = { ...state, generation, refreshRequested: true, statusNote: undefined };
  if (state.boundedReads && state.section === "work") {
    next.taskPageRequest = {
      generation,
      cursor: state.taskPage?.cursor,
      pageNumber: state.taskPage?.pageNumber ?? 1,
      cursorStack: state.taskPage?.cursorStack ?? [],
      previousSelectionId: selectedId,
      recoverOnRejectedCursor: state.taskPage?.cursor !== undefined,
    };
  }
  if (state.section === "people") {
    next.peoplePageRequest = {
      generation,
      cursor: state.peoplePage?.cursor,
      pageNumber: state.peoplePage?.pageNumber ?? 1,
      cursorStack: state.peoplePage?.cursorStack ?? [],
      humanOwnerId: state.peoplePage?.humanOwnerId,
      previousSelectionId: selectedId,
      recoverOnRejectedCursor: state.peoplePage?.cursor !== undefined,
    };
  }
  if (state.history?.open === true) {
    const page = state.history.page;
    next.historyRequest = {
      generation,
      objectType: state.history.objectType,
      objectId: state.history.objectId,
      cursor: page?.cursor,
      pageNumber: page?.pageNumber ?? 1,
      cursorStack: page?.cursorStack ?? [],
      recoverOnRejectedCursor: page?.cursor !== undefined,
    };
  }
  return next;
}

function pageWork(state: DashboardState, direction: "next" | "back"): DashboardState {
  const page = state.taskPage;
  if (page === undefined) return { ...state, statusNote: "Paging is unavailable until a work page is loaded." };
  const selectedId = selectedRow(state)?.id;
  if (direction === "next") {
    if (page.truncated !== true || page.nextCursor === undefined) return { ...state, statusNote: "No next work page." };
    const generation = state.generation + 1;
    return {
      ...withoutTransient(state),
      generation,
      statusNote: "Loading the next work page. Rows below are the last successful page.",
      taskPageRequest: {
        generation,
        cursor: page.nextCursor,
        pageNumber: page.pageNumber + 1,
        cursorStack: [...page.cursorStack, { cursor: page.cursor, pageNumber: page.pageNumber }],
        previousSelectionId: selectedId,
        recoverOnRejectedCursor: true,
      },
    };
  }
  const previous = page.cursorStack[page.cursorStack.length - 1];
  if (previous === undefined) return { ...state, statusNote: "No previous work page." };
  const generation = state.generation + 1;
  return {
    ...withoutTransient(state),
    generation,
    statusNote: "Loading the previous work page. Rows below are the last successful page.",
    taskPageRequest: {
      generation,
      cursor: previous.cursor,
      pageNumber: previous.pageNumber,
      cursorStack: page.cursorStack.slice(0, -1),
      previousSelectionId: selectedId,
      recoverOnRejectedCursor: previous.cursor !== undefined,
    },
  };
}

function pagePeople(state: DashboardState, direction: "next" | "back"): DashboardState {
  const page = state.peoplePage;
  if (page === undefined) return { ...state, statusNote: "Paging is unavailable until a people page is loaded." };
  const selectedId = selectedRow(state)?.id;
  if (direction === "next") {
    if (page.truncated !== true || page.nextCursor === undefined) return { ...state, statusNote: "No next people page." };
    const generation = state.generation + 1;
    return {
      ...withoutTransient(state),
      generation,
      statusNote: "Loading the next people page. Rows below are the last successful page.",
      peoplePageRequest: {
        generation,
        cursor: page.nextCursor,
        pageNumber: page.pageNumber + 1,
        cursorStack: [...page.cursorStack, { cursor: page.cursor, pageNumber: page.pageNumber, humanOwnerId: page.humanOwnerId }],
        humanOwnerId: page.humanOwnerId,
        previousSelectionId: selectedId,
        recoverOnRejectedCursor: true,
      },
    };
  }
  const previous = page.cursorStack[page.cursorStack.length - 1];
  if (previous === undefined) return { ...state, statusNote: "No previous people page." };
  const generation = state.generation + 1;
  return {
    ...withoutTransient(state),
    generation,
    statusNote: "Loading the previous people page. Rows below are the last successful page.",
    peoplePageRequest: {
      generation,
      cursor: previous.cursor,
      pageNumber: previous.pageNumber,
      cursorStack: page.cursorStack.slice(0, -1),
      humanOwnerId: previous.humanOwnerId,
      previousSelectionId: selectedId,
      recoverOnRejectedCursor: previous.cursor !== undefined,
    },
  };
}

function pageHistory(state: DashboardState, direction: "next" | "back"): DashboardState {
  const history = state.history;
  if (history === undefined || !history.open) return state;
  const page = history.page;
  if (page === undefined) return { ...state, statusNote: "Paging is unavailable until the history page loads." };
  if (direction === "next") {
    if (page.truncated !== true || page.nextCursor === undefined) return { ...state, statusNote: "No next history page." };
    const generation = state.generation + 1;
    return {
      ...state,
      generation,
      statusNote: undefined,
      historyRequest: {
        generation,
        objectType: history.objectType,
        objectId: history.objectId,
        cursor: page.nextCursor,
        pageNumber: page.pageNumber + 1,
        cursorStack: [...page.cursorStack, { cursor: page.cursor, pageNumber: page.pageNumber }],
        recoverOnRejectedCursor: true,
      },
    };
  }
  const previous = page.cursorStack[page.cursorStack.length - 1];
  if (previous === undefined) return { ...state, statusNote: "No previous history page." };
  const generation = state.generation + 1;
  return {
    ...state,
    generation,
    statusNote: undefined,
    historyRequest: {
      generation,
      objectType: history.objectType,
      objectId: history.objectId,
      cursor: previous.cursor,
      pageNumber: previous.pageNumber,
      cursorStack: page.cursorStack.slice(0, -1),
      recoverOnRejectedCursor: previous.cursor !== undefined,
    },
  };
}

function sameRecordHistory(
  state: DashboardState,
  id: string | undefined,
): Pick<DashboardState, "history" | "historyRequest"> {
  if (id === undefined || state.history?.open !== true || state.history.objectId !== id) {
    return { history: undefined, historyRequest: undefined };
  }
  return {
    history: state.history,
    ...(state.historyRequest === undefined ? {} : { historyRequest: state.historyRequest }),
  };
}

function toggleHistory(state: DashboardState): DashboardState {
  const target = historyTarget(selectedRow(state));
  if (target === undefined) {
    return {
      ...state,
      statusNote: "History is available for a task, decision, finding, or artifact. This selection is not one of those records.",
    };
  }
  if (state.history?.open === true && state.history.objectType === target.objectType && state.history.objectId === target.objectId) {
    return { ...state, generation: state.generation + 1, history: undefined, historyRequest: undefined, statusNote: undefined };
  }
  const generation = state.generation + 1;
  return {
    ...state,
    generation,
    statusNote: undefined,
    history: { open: true, objectType: target.objectType, objectId: target.objectId, row: 0 },
    historyRequest: {
      generation,
      objectType: target.objectType,
      objectId: target.objectId,
      pageNumber: 1,
      cursorStack: [],
      recoverOnRejectedCursor: false,
    },
  };
}

function openHumanAgents(state: DashboardState, humanId: string): DashboardState {
  const page = state.peoplePage;
  const generation = state.generation + 1;
  const stack = page === undefined
    ? []
    : [...page.cursorStack, { cursor: page.cursor, pageNumber: page.pageNumber, humanOwnerId: page.humanOwnerId }];
  return {
    ...withoutTransient(state),
    generation,
    statusNote: `Loading workspace-participating agents for ${clean(humanId)}. Rows below are the last successful page, not this request.`,
    peoplePageRequest: {
      generation,
      humanOwnerId: humanId,
      pageNumber: 1,
      cursorStack: stack,
      recoverOnRejectedCursor: false,
    },
  };
}

export function reduceDashboardKey(state: DashboardState, key: string): DashboardState {
  // Ctrl-C quits from every mode, including while a filter is being typed.
  if (key === "\u0003" || key === "ctrl-c") return { ...state, quit: true, refreshRequested: false };
  if (state.filterMode) return reduceFilterModeKey(state, key);
  if (key === "\u001b" || key === "esc") {
    // History closes before a committed filter so one esc cannot do both.
    if (state.history?.open === true) {
      return { ...state, generation: state.generation + 1, history: undefined, historyRequest: undefined, statusNote: undefined };
    }
    if (state.filter.length === 0) return state;
    return reconcileSelection(state, { ...state, filter: "" });
  }
  if (key === "\u007f" || key === "\u0008" || key === "backspace") return state;
  if (key === "/") return { ...state, filterMode: true };
  const action = canonicalKey(key);
  if (action === "quit") return { ...state, quit: true, refreshRequested: false };
  if (action === "p") {
    return clampRow({
      ...withoutTransient(state),
      perspective: state.perspective === "mine" ? "team" : "mine",
      row: 0,
      generation: state.generation + 1,
    });
  }
  if (action === "tab") {
    const index = SECTIONS.indexOf(state.section);
    const section = SECTIONS[(index + 1) % SECTIONS.length] ?? "attention";
    return openSection(state, section);
  }
  if (action === "j" || action === "k") {
    if (state.history?.open === true) {
      const count = state.history.page?.items.length ?? 0;
      const delta = action === "j" ? 1 : -1;
      const row = count <= 0 ? 0 : Math.min(count - 1, Math.max(0, state.history.row + delta));
      return { ...state, history: { ...state.history, row }, statusNote: undefined };
    }
    const beforeId = selectedRow(state)?.id;
    const count = sectionCount(state);
    const delta = action === "j" ? 1 : -1;
    const row = count <= 0 ? 0 : Math.min(count - 1, Math.max(0, state.row + delta));
    const moved = { ...withoutTransient(state), row, selectionNote: undefined };
    const afterId = shownRows(moved)[moved.row]?.id;
    if (beforeId !== afterId) return { ...moved, generation: state.generation + 1 };
    // The same record stays selected, so its open history is still the record's.
    return { ...moved, ...sameRecordHistory(state, beforeId) };
  }
  if (action === "r") return requestDashboardRefresh(state);
  if (action === "?") return { ...state, help: !state.help, refreshRequested: false };
  if (action === "n" || action === "b") {
    const direction = action === "n" ? "next" : "back";
    if (state.history?.open === true) return pageHistory(state, direction);
    if (state.section === "work") return pageWork(state, direction);
    if (state.section === "people") return pagePeople(state, direction);
    return { ...state, statusNote: PAGING_UNAVAILABLE };
  }
  if (action === "h") return toggleHistory(state);
  if (action === "enter") {
    const selected = selectedRow(state);
    if (selected === undefined) return { ...withoutTransient(state), detailOpen: false };
    if (selected.kind === "participant" && selected.participant?.actor.actorType === "human") {
      return openHumanAgents(state, selected.participant.actor.actorId);
    }
    const history = sameRecordHistory(state, selected.id);
    if (selected.full || selected.fetchKind === undefined) {
      return { ...withoutTransient(state), ...history, detailOpen: true };
    }
    return {
      ...withoutTransient(state),
      ...history,
      detailOpen: true,
      inspectRequest: { kind: selected.fetchKind, id: selected.id, generation: state.generation },
    };
  }
  return state;
}

function toLoaded<T>(page: DashboardPageInput<T>, stamp: { readAt: string; cursor?: string; pageNumber: number; cursorStack: PagePlace[] }): LoadedPage<T> {
  return {
    items: page.items,
    total: page.total,
    returned: page.returned,
    truncated: page.truncated,
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    ...(stamp.cursor === undefined ? {} : { cursor: stamp.cursor }),
    pageNumber: stamp.pageNumber,
    readAt: stamp.readAt,
    cursorStack: stamp.cursorStack,
    stale: false,
  };
}

function placeSelection(state: DashboardState, previousId: string | undefined): { row: number; selectionNote?: string } {
  if (previousId === undefined) return { row: 0 };
  const index = shownRows(state).findIndex((row) => row.id === previousId);
  if (index >= 0) return { row: index };
  return { row: 0, selectionNote: SELECTION_MOVED };
}

function keepDetail(state: DashboardState, id: string | undefined, found: boolean): Pick<DashboardState, "detailOpen" | "inspected" | "history" | "historyRequest"> {
  if (!found || id === undefined) {
    return { detailOpen: false, inspected: undefined, history: undefined, historyRequest: undefined };
  }
  const history = state.history?.open === true && state.history.objectId === id ? state.history : undefined;
  return {
    detailOpen: state.detailOpen && (state.inspected === undefined || state.inspected.sourceId === id),
    inspected: state.inspected?.sourceId === id ? state.inspected : undefined,
    history,
    historyRequest: history !== undefined ? state.historyRequest : undefined,
  };
}

export function applyTaskPage(state: DashboardState, page: DashboardPageInput<Task>, stamp: AppliedPageStamp): DashboardState {
  if (stamp.generation !== state.generation || state.section !== "work") return state;
  const draft: DashboardState = {
    ...state,
    taskPage: toLoaded(page, stamp),
    taskPageRequest: undefined,
    row: 0,
    statusNote: undefined,
    selectionNote: undefined,
  };
  const placed = placeSelection(draft, stamp.previousSelectionId);
  const found = stamp.previousSelectionId !== undefined && placed.selectionNote === undefined;
  return { ...draft, row: placed.row, ...(placed.selectionNote === undefined ? {} : { selectionNote: placed.selectionNote }), ...keepDetail(state, stamp.previousSelectionId, found) };
}

function countSplit(previous: PeopleSplit | undefined, pageNumber: number, items: readonly ParticipantListItem[], total: number, truncated: boolean): PeopleSplit {
  const humans = items.filter((item) => item.actor.actorType === "human").length;
  const agents = items.filter((item) => item.actor.actorType === "agent").length;
  const more = truncated ? { nextPage: pageNumber + 1 } : {};
  if (pageNumber === 1) {
    return { humans, agents, summed: items.length, complete: !truncated && items.length === total, fromStart: true, ...more };
  }
  if (previous === undefined || previous.fromStart !== true || previous.complete === true || previous.nextPage !== pageNumber) {
    return { humans, agents, summed: items.length, complete: false, fromStart: false, ...more };
  }
  const summed = previous.summed + items.length;
  return {
    humans: previous.humans + humans,
    agents: previous.agents + agents,
    summed,
    complete: !truncated && summed === total,
    fromStart: true,
    ...more,
  };
}

export function applyPeoplePage(
  state: DashboardState,
  page: DashboardPageInput<ParticipantListItem>,
  stamp: AppliedPageStamp,
): DashboardState {
  if (stamp.generation !== state.generation || state.section !== "people") return state;
  const peoplePage: PeoplePageState = {
    ...toLoaded(page, stamp),
    ...(stamp.humanOwnerId === undefined ? {} : { humanOwnerId: stamp.humanOwnerId }),
  };
  const peopleSplit = stamp.humanOwnerId === undefined
    ? countSplit(state.peopleSplit, stamp.pageNumber, page.items, page.total, page.truncated)
    : state.peopleSplit;
  const draft: DashboardState = {
    ...state,
    peoplePage,
    peoplePageRequest: undefined,
    row: 0,
    statusNote: undefined,
    selectionNote: undefined,
    ...(peopleSplit === undefined ? {} : { peopleSplit }),
  };
  const placed = placeSelection(draft, stamp.previousSelectionId);
  return { ...draft, row: placed.row, ...(placed.selectionNote === undefined ? {} : { selectionNote: placed.selectionNote }), detailOpen: false, inspected: undefined };
}

export function applyHistoryPage(state: DashboardState, page: DashboardPageInput<Contribution>, stamp: HistoryStamp): DashboardState {
  if (stamp.generation !== state.generation) return state;
  const history = state.history;
  if (history === undefined || !history.open) return state;
  if (history.objectType !== stamp.objectType || history.objectId !== stamp.objectId) return state;
  const target = historyTarget(selectedRow(state));
  if (target === undefined || target.objectType !== stamp.objectType || target.objectId !== stamp.objectId) return state;
  return {
    ...state,
    historyRequest: undefined,
    statusNote: undefined,
    history: {
      open: true,
      objectType: stamp.objectType,
      objectId: stamp.objectId,
      row: history.page?.pageNumber === stamp.pageNumber
        ? Math.min(history.row, Math.max(0, page.items.length - 1))
        : 0,
      page: toLoaded(page, stamp),
    },
  };
}

function noteOf(message: string): string {
  const text = clean(message);
  return text.length > 0 ? text : "read failed";
}

export function failTaskPage(state: DashboardState, generation: number, message: string): DashboardState {
  if (generation !== state.generation || state.section !== "work") return state;
  const note = noteOf(message);
  if (state.taskPage === undefined) {
    return { ...state, taskPageRequest: undefined, statusNote: `Work page is unavailable. ${note}` };
  }
  return {
    ...state,
    taskPageRequest: undefined,
    statusNote: `Work page is stale. Last success ${state.taskPage.readAt}. ${note}`,
    taskPage: { ...state.taskPage, stale: true, error: note },
  };
}

export function rejectTaskCursor(state: DashboardState, generation: number): DashboardState {
  if (generation !== state.generation || state.section !== "work") return state;
  const nextGeneration = state.generation + 1;
  return {
    ...state,
    generation: nextGeneration,
    statusNote: CURSOR_REJECTED,
    taskPageRequest: { generation: nextGeneration, pageNumber: 1, cursorStack: [], recoverOnRejectedCursor: false },
  };
}

export function failPeoplePage(state: DashboardState, generation: number, message: string): DashboardState {
  if (generation !== state.generation || state.section !== "people") return state;
  const note = noteOf(message);
  if (state.peoplePage === undefined) {
    return { ...state, peoplePageRequest: undefined, statusNote: `People page is unavailable. ${note}` };
  }
  return {
    ...state,
    peoplePageRequest: undefined,
    statusNote: `People page is stale. Last success ${state.peoplePage.readAt}. ${note}`,
    peoplePage: { ...state.peoplePage, stale: true, error: note },
  };
}

export function rejectPeopleCursor(state: DashboardState, generation: number): DashboardState {
  if (generation !== state.generation || state.section !== "people") return state;
  const nextGeneration = state.generation + 1;
  const humanOwnerId = state.peoplePage?.humanOwnerId;
  return {
    ...state,
    generation: nextGeneration,
    statusNote: CURSOR_REJECTED,
    peoplePageRequest: {
      generation: nextGeneration,
      pageNumber: 1,
      cursorStack: [],
      recoverOnRejectedCursor: false,
      ...(humanOwnerId === undefined ? {} : { humanOwnerId }),
    },
  };
}

export function failHistoryRead(state: DashboardState, generation: number, message: string): DashboardState {
  if (generation !== state.generation) return state;
  if (state.history === undefined || !state.history.open) return state;
  const note = noteOf(message);
  const page = state.history.page;
  return {
    ...state,
    historyRequest: undefined,
    history: {
      ...state.history,
      unavailable: note,
      ...(page === undefined ? {} : { page: { ...page, stale: true, error: note } }),
    },
  };
}

export function rejectHistoryCursor(state: DashboardState, generation: number): DashboardState {
  if (generation !== state.generation) return state;
  const history = state.history;
  if (history === undefined || !history.open) return state;
  const nextGeneration = state.generation + 1;
  return {
    ...state,
    generation: nextGeneration,
    statusNote: CURSOR_REJECTED,
    history: { ...history, unavailable: undefined, page: history.page === undefined ? undefined : { ...history.page, stale: true } },
    historyRequest: {
      generation: nextGeneration,
      objectType: history.objectType,
      objectId: history.objectId,
      pageNumber: 1,
      cursorStack: [],
      recoverOnRejectedCursor: false,
    },
  };
}

export function applyContextLoad(
  state: DashboardState,
  loaded: WorkspaceContext,
  refreshedAt: string,
  generation: number,
): DashboardState {
  if (loaded.workspace.id !== state.workspaceId) {
    if (generation !== state.generation && state.context !== undefined) return state;
    return { ...state, staleError: "workspace context did not match the authorized workspace", refreshRequested: false };
  }
  // The first context may still apply after a key moved the generation; a later
  // refresh must not overwrite a newer selection's pending read.
  if (generation !== state.generation && state.context !== undefined) return state;
  return reconcileAfterLoad(state, loaded, refreshedAt);
}

export function failContextLoad(state: DashboardState, generation: number, message: string): DashboardState {
  if (generation !== state.generation && state.context !== undefined) return state;
  return { ...state, staleError: noteOf(message), refreshRequested: false };
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

/**
 * The local-filter indicator. The wording states the filter's scope
 * explicitly — it narrows shown records, not the workspace read — and shows
 * the shown-of-loaded split so a narrowed list is never mistaken for source
 * coverage.
 */
function workspaceTotal(state: DashboardState, context: WorkspaceContext): string {
  switch (state.section) {
    case "work":
      return String(state.taskPage?.total ?? context.slices.tasks.total);
    case "people":
      if (state.peoplePage !== undefined) return String(state.peoplePage.total);
      if (context.participantsCoverage !== undefined) return String(context.participantsCoverage.total);
      return String(context.participants.length);
    case "decisions":
      return String(context.slices.decisions.total);
    case "references":
      return String(context.slices.artifacts.total);
    case "changes":
      return String(context.provenanceTotal);
    case "attention":
      return String(context.attentionCoverage.tasks.total);
  }
}

function filterIndicator(state: DashboardState, context: WorkspaceContext, columns: number): TaggedLine[] {
  if (!filterActive(state)) return [];
  const typing = state.filterMode ? " (typing — enter confirms, esc clears, ctrl-c quits)" : "";
  const shown = shownRows(state).length;
  const loaded = sectionRows(state).length;
  return record(
    `filter "${clean(state.filter)}"${typing}  filters shown records, not the workspace  matching ${shown}  loaded ${loaded}  workspace total ${workspaceTotal(state, context)}`,
    columns,
    0,
  );
}

/**
 * The rows-or-empty tail of a section. With an active filter the explicit
 * "no shown row matches the filter" line replaces the empty state (the
 * section's coverage/caveat lines above stay visible); the section's own
 * empty state only appears when the loaded list itself is empty.
 */
function emptyOrFilterLines(
  state: DashboardState,
  emptyText: string,
  columns: number,
  emptyRank: number,
): TaggedLine[] {
  if (!filterActive(state)) return record(emptyText, columns, emptyRank);
  const lines = record("no shown row matches the filter", columns, 0);
  if (sectionRows(state).length === 0) return [...lines, ...record(emptyText, columns, emptyRank)];
  return lines;
}

/** Slice coverage in the NAV-001 heading format: `tasks 20 of 64  truncated`. */
function sliceCoverage(
  label: string,
  slice: { returned: number; total: number; truncated: boolean } | undefined,
): string {
  const returned = slice && typeof slice.returned === "number" ? slice.returned : "?";
  const total = slice && typeof slice.total === "number" ? slice.total : "?";
  const truncated = slice?.truncated === true ? "  truncated" : "";
  return `${label} ${returned} of ${total}${truncated}`;
}

function buildAttention(state: DashboardState, context: WorkspaceContext, columns: number): TaggedLine[] {
  const counts = attentionCoverageCounts(context.attentionCoverage);
  const coverage = attentionCoverageText(context.attentionCoverage);
  const heading = state.perspective === "mine" ? "MY WORK  Needs You" : "TEAM WORK  Needs Attention";
  const lines: TaggedLine[] = [
    ...chrome(`${heading}  ATTENTION  ${counts}`, columns, 0),
    ...(coverage.length > 0 ? record(coverage, columns, 0) : []),
    ...record(ASSIGNMENT_RECORD_NOTE, columns, 1),
    ...filterIndicator(state, context, columns),
  ];
  const rows = shownRows(state);
  if (rows.length === 0) {
    lines.push(...emptyOrFilterLines(state, attentionEmptyText(context.attentionCoverage), columns, 0));
    return lines;
  }
  lines.push(...renderRowList(rows, state.row, columns));
  return lines;
}

function pageFact(page: { returned: number; total: number; truncated: boolean; pageNumber: number; readAt: string; stale: boolean }): string {
  const more = page.truncated ? "another page" : "no further page";
  const stale = page.stale ? "  stale" : "";
  return `returned ${page.returned} of ${page.total}  page ${page.pageNumber}  ${more}  read ${clean(page.readAt)}${stale}`;
}

function noteLines(state: DashboardState, columns: number): TaggedLine[] {
  const lines: TaggedLine[] = [];
  if (state.statusNote !== undefined && clean(state.statusNote).length > 0) {
    lines.push(...record(clean(state.statusNote), columns, 0));
  }
  if (state.selectionNote !== undefined && clean(state.selectionNote).length > 0) {
    lines.push(...record(clean(state.selectionNote), columns, 0));
  }
  return lines;
}

function buildWork(state: DashboardState, context: WorkspaceContext, columns: number): TaggedLine[] {
  const page = state.taskPage;
  const heading = page === undefined
    ? `CURRENT WORK  ${sliceCoverage("tasks", context.slices.tasks)}`
    : `CURRENT WORK  ${pageFact(page)}`;
  const lines: TaggedLine[] = [...chrome(heading, columns, page === undefined ? 1 : 0)];
  if (page !== undefined) {
    lines.push(...record(NOT_ATTENTION, columns, 1));
    lines.push(...record(NOT_RUNNING, columns, 1));
    lines.push(...record(NOT_CENSUS, columns, 1));
  } else if (state.boundedReads) {
    lines.push(...record(state.taskPageRequest === undefined ? "The work page has not loaded." : "Work page is loading.", columns, 0));
  }
  const hint = context.suggestedNextAction;
  if (hint !== undefined && page === undefined && !state.boundedReads) {
    const parts = [ORIENTATION_HINT_LABEL];
    if (hint.id !== undefined && hint.id.length > 0) parts.push(clean(hint.id));
    if (hint.summary.length > 0) parts.push(clean(hint.summary));
    lines.push(...record(parts.join("  "), columns, 1));
  }
  lines.push(...noteLines(state, columns));
  lines.push(...filterIndicator(state, context, columns));
  const rows = shownRows(state);
  if (rows.length === 0) {
    if (state.boundedReads && page === undefined) return lines;
    lines.push(
      ...emptyOrFilterLines(state, "No open, in_progress, or blocked task in the returned records.", columns, 1),
    );
    return lines;
  }
  lines.push(...renderRowList(rows, state.row, columns));
  return lines;
}

function buildPeople(state: DashboardState, context: WorkspaceContext, columns: number): TaggedLine[] {
  const page = state.peoplePage;
  const lines: TaggedLine[] = [];
  if (page === undefined) {
    lines.push(...chrome("PEOPLE", columns, 0));
    lines.push(
      ...record(
        state.peoplePageRequest === undefined ? "People are loaded only when this section asks for them." : "People page is loading.",
        columns,
        0,
      ),
    );
    lines.push(...noteLines(state, columns));
    lines.push(...filterIndicator(state, context, columns));
    return lines;
  }
  if (page.humanOwnerId !== undefined) {
    lines.push(
      ...chrome(
        `WORKSPACE-PARTICIPATING AGENTS  ${clean(page.humanOwnerId)}  total ${page.total}  ${pageFact(page)}`,
        columns,
        0,
      ),
    );
    lines.push(
      ...record("total counts this human's agents in this workspace. It is not the unfiltered page and not a presence count.", columns, 1),
    );
  } else {
    lines.push(...chrome(`PEOPLE  ${pageFact(page)}`, columns, 0));
    lines.push(...record("This page is not the workspace human/agent split.", columns, 1));
  }
  lines.push(...record(NOT_PRESENCE, columns, 1));
  lines.push(...noteLines(state, columns));
  lines.push(...filterIndicator(state, context, columns));
  const rows = shownRows(state);
  if (rows.length === 0) {
    lines.push(...emptyOrFilterLines(state, "No participant on this page.", columns, 1));
    return lines;
  }
  lines.push(...renderRowList(rows, state.row, columns));
  return lines;
}

function buildDecisions(state: DashboardState, context: WorkspaceContext, columns: number): TaggedLine[] {
  const lines: TaggedLine[] = [
    ...chrome(`RECORDED DECISIONS  ${sliceCoverage("decisions", context.slices.decisions)}`, columns, 1),
    ...record("Competing accepted decisions are not resolved here. needs review does not revoke acceptance.", columns, 1),
    ...filterIndicator(state, context, columns),
  ];
  const rows = shownRows(state);
  if (rows.length === 0) {
    lines.push(
      ...emptyOrFilterLines(state, "No proposed or accepted decision in the returned records.", columns, 1),
    );
    return lines;
  }
  lines.push(...renderRowList(rows, state.row, columns));
  return lines;
}

function buildReferences(state: DashboardState, context: WorkspaceContext, columns: number): TaggedLine[] {
  const lines: TaggedLine[] = [
    ...chrome(`ARTIFACT REFERENCES  ${sliceCoverage("artifacts", context.slices.artifacts)}`, columns, 1),
    ...filterIndicator(state, context, columns),
  ];
  const rows = shownRows(state);
  if (rows.length === 0) {
    lines.push(
      ...emptyOrFilterLines(state, "No stored artifact reference in the returned records.", columns, 1),
    );
    return lines;
  }
  lines.push(...renderRowList(rows, state.row, columns));
  return lines;
}

function buildChanges(state: DashboardState, context: WorkspaceContext, columns: number): TaggedLine[] {
  const truncated = context.provenanceTruncated ? "  truncated" : "";
  const lines: TaggedLine[] = [
    ...chrome(
      `RECENT CHANGES  showing ${context.provenance.length} of ${context.provenanceTotal}${truncated}`,
      columns,
      1,
    ),
    ...filterIndicator(state, context, columns),
  ];
  const rows = shownRows(state);
  if (rows.length === 0) {
    lines.push(...emptyOrFilterLines(state, "No recent change in the returned records.", columns, 2));
    return lines;
  }
  lines.push(...renderRowList(rows, state.row, columns));
  return lines;
}

function buildActiveSection(state: DashboardState, context: WorkspaceContext, columns: number): TaggedLine[] {
  switch (state.section) {
    case "attention":
      return [...noteLines(state, columns), ...buildAttention(state, context, columns)];
    case "work":
      return buildWork(state, context, columns);
    case "decisions":
      return [...noteLines(state, columns), ...buildDecisions(state, context, columns)];
    case "references":
      return [...noteLines(state, columns), ...buildReferences(state, context, columns)];
    case "people":
      return buildPeople(state, context, columns);
    case "changes":
      return [...noteLines(state, columns), ...buildChanges(state, context, columns)];
  }
}

function artifactFor(context: WorkspaceContext, id: string | undefined): Artifact | undefined {
  if (id === undefined) return undefined;
  return context.artifacts.find((artifact) => artifact.id === id);
}

function actorFact(label: string, value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const actor = value as { actorId?: unknown; actorType?: unknown };
  if (typeof actor.actorId !== "string" || actor.actorId.length === 0) return undefined;
  const type = typeof actor.actorType === "string" ? actor.actorType : "actor";
  return `${label}  ${clean(type)} ${clean(actor.actorId)}`;
}

function detailBody(detail: unknown, columns: number, kind?: string): TaggedLine[] {
  if (detail === null || typeof detail !== "object") return [];
  const fields = detail as Record<string, unknown>;
  const lines: TaggedLine[] = [];
  const pick = (label: string, value: unknown): void => {
    if (typeof value === "string" && value.length > 0) {
      lines.push(...record(`${label}  ${clean(value)}`, columns, 1));
    }
  };
  const add = (text: string | undefined, rank = 1): void => {
    if (text !== undefined && clean(text).length > 0) lines.push(...record(clean(text), columns, rank));
  };
  if (kind !== undefined && kind.length > 0) pick("record type", kind);
  if (typeof fields.id === "string") pick("id", fields.id);
  pick("status", fields.status);
  if (fields.status === "in_progress") lines.push(...record(NOT_RUNNING, columns, 0));
  if (typeof fields.status === "string") {
    const label = typeof fields.title === "string" ? taskStatusLabel(fields.status) : decisionStatusLabel(fields.status);
    if (label !== fields.status) pick("status label", label);
  }
  pick("currentness", fields.currentness);
  pick("title", fields.title);
  pick("summary", fields.summary);
  pick("rationale", fields.rationale);
  pick("type", fields.type);
  pick("uriOrPath", fields.uriOrPath);
  add(actorFact("created by", fields.createdBy));
  add(actorFact("assignee", fields.assignee));
  add(actorFact("approved by", fields.approvedBy));
  pick("agent session", fields.agentSessionId);
  if (fields.needsReview === true) {
    lines.push(...record("needs review — acceptance is unchanged", columns, 0));
  }
  if (Array.isArray(fields.needsReviewFindingIds)) {
    const ids = fields.needsReviewFindingIds.filter((id): id is string => typeof id === "string");
    if (ids.length > 0) lines.push(...record(`non-current citations: ${ids.map((id) => clean(id)).join(", ")}`, columns, 0));
  }
  pick("source artifact", fields.sourceArtifactId);
  pick("predecessor", fields.predecessorId);
  pick("successor", fields.successorId);
  pick("supersede reason", fields.supersedeReason);
  add(actorFact("superseded by", fields.supersededBy));
  if (Array.isArray(fields.citations)) {
    for (const row of fields.citations) {
      if (row === null || typeof row !== "object") continue;
      const cite = row as { id?: unknown; findingId?: unknown; note?: unknown };
      const id = typeof cite.id === "string" ? clean(cite.id) : "";
      const findingId = typeof cite.findingId === "string" ? clean(cite.findingId) : "";
      if (id.length === 0 && findingId.length === 0) continue;
      const note = typeof cite.note === "string" && cite.note.length > 0 ? `  note ${clean(cite.note)}` : "";
      lines.push(...record(`citation ${id}  finding ${findingId}${note}`, columns, 0));
    }
  }
  if (Array.isArray(fields.evidence)) {
    for (const row of fields.evidence) {
      if (row === null || typeof row !== "object") continue;
      const evidence = row as { id?: unknown; artifactId?: unknown; relation?: unknown; note?: unknown };
      const id = typeof evidence.id === "string" ? clean(evidence.id) : "";
      const artifactId = typeof evidence.artifactId === "string" ? clean(evidence.artifactId) : "";
      const relation = typeof evidence.relation === "string" ? clean(evidence.relation) : "";
      if (id.length === 0 && artifactId.length === 0) continue;
      const note = typeof evidence.note === "string" && evidence.note.length > 0 ? `  note ${clean(evidence.note)}` : "";
      lines.push(...record(`evidence ${id}  artifact ${artifactId}  relation ${relation}${note}`, columns, 0));
    }
  }
  if (typeof fields.type === "string" && typeof fields.uriOrPath === "string") {
    lines.push(...record(ARTIFACT_REFERENCE_LABEL, columns, 0));
    // Same frozen classification as the reference list. The get_artifact
    // detail read carries no evidence rows, so no cited-by claim is rendered
    // here; relations appear where the serving read records them. A reference
    // classified `none` (missing/empty) shows nothing beyond the label.
    const classification = classifyArtifactReference(fields.uriOrPath);
    if (classification.class !== "none") {
      lines.push(...record(`class ${classification.class}`, columns, 0));
      if (classification.host !== null) lines.push(...record(`host ${classification.host}`, columns, 0));
      lines.push(...record(ARTIFACT_EXTERNAL_UNVERIFIED_LABEL, columns, 0));
      if (classification.unsafe) lines.push(...record(ARTIFACT_UNSAFE_CONTROL_LABEL, columns, 0));
    }
    lines.push(...record("This terminal does not open, fetch, or verify the reference.", columns, 0));
  }
  return lines;
}

function taskRecord(state: DashboardState, context: WorkspaceContext, id: string): Task | undefined {
  return state.taskPage?.items.find((task) => task.id === id) ?? taskById(context, id);
}

function findingRecord(context: WorkspaceContext, id: string): Finding | undefined {
  return context.findings.find((finding) => finding.id === id);
}

function participantFacts(item: ParticipantListItem, columns: number): TaggedLine[] {
  const lines: TaggedLine[] = [];
  lines.push(...record(`role ${clean(item.role)}`, columns, 1));
  lines.push(...record(`joinedAt ${clean(item.joinedAt)}`, columns, 1));
  if (item.actor.actorType !== "agent") {
    lines.push(...record("enter lists this human's workspace-participating agents", columns, 1));
    lines.push(...record("Membership is not presence or permission to act.", columns, 1));
    return lines;
  }
  const owner = item.humanOwnerId === undefined || item.humanOwnerId.length === 0 ? "no recorded owner" : clean(item.humanOwnerId);
  lines.push(...record(`humanOwnerId ${owner}`, columns, 0));
  if (item.humanOwnerIsParticipant === false) lines.push(...record("owner is outside the roster", columns, 0));
  else if (item.humanOwnerIsParticipant === true) lines.push(...record("owner is a workspace participant", columns, 1));
  if (item.harness !== undefined) lines.push(...record(`harness ${clean(item.harness)}`, columns, 1));
  lines.push(...record(NOT_PRESENCE, columns, 0));
  return lines;
}

function buildSource(state: DashboardState, context: WorkspaceContext, columns: number): TaggedLine[] {
  const rows = shownRows(state);
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
  const fromTaskPage = state.section === "work" && state.taskPage !== undefined && selected.kind === "task";
  const fromPeople = selected.kind === "participant";
  const method =
    inspected !== undefined
      ? inspected.method
      : fromTaskPage
        ? "list_tasks"
        : fromPeople
          ? "list_workspace_participants"
          : selected.full || selected.fetchKind === undefined
            ? "get_workspace_context"
            : inspectMethod(selected.fetchKind ?? "task");
  lines.push(...record(`${method}  ${clean(selected.id)}`, columns, 0));
  if (fromPeople && selected.participant !== undefined) {
    lines.push(...participantFacts(selected.participant, columns));
  }
  if (inspected !== undefined) lines.push(...detailBody(inspected.record, columns, selected.kind));
  const task = selected.kind === "task" ? taskRecord(state, context, selected.id) : undefined;
  if (task !== undefined && inspected === undefined) {
    if (state.detailOpen) lines.push(...detailBody(task, columns, "task"));
    else lines.push(...record(`${clean(task.status)}  ${clean(task.title)}`, columns, 1));
  }
  const decision = selected.kind === "decision" ? decisionById(context, selected.id) : undefined;
  if (decision !== undefined && inspected === undefined) {
    if (state.detailOpen) lines.push(...detailBody(decision, columns, "decision"));
    else lines.push(...record(decisionText(decision), columns, decision.needsReview === true ? 0 : 1));
  }
  const finding = selected.kind === "finding" ? findingRecord(context, selected.id) : undefined;
  if (finding !== undefined && inspected === undefined && state.detailOpen) {
    lines.push(...detailBody(finding, columns, "finding"));
  }
  const artifactId = selected.kind === "artifact" ? selected.id : selected.objectType === "artifact" ? selected.objectId : undefined;
  const artifact = artifactFor(context, artifactId);
  if (artifact !== undefined) {
    if (state.detailOpen && inspected === undefined && selected.kind === "artifact") {
      lines.push(...detailBody(artifact, columns, "artifact"));
    }
    lines.push(...record(artifactReferenceText(artifact, context), columns, 0));
  } else if (selected.objectType === "artifact" && selected.objectId !== undefined) {
    // The artifact record was not in the returned orientation, so no class,
    // host, or relation can be stated from this read; ids and the stored
    // reference label alone are shown, absent facts stay absent.
    lines.push(...record(`${clean(selected.objectId)}  ${ARTIFACT_REFERENCE_LABEL}`, columns, 0));
  }
  return lines;
}

/**
 * An omitted roster is a count, not an empty team. The human/agent split is
 * shown only from a full orientation array or after one complete unfiltered
 * people walk whose sum matches that authorized total.
 */
function buildParticipants(state: DashboardState, context: WorkspaceContext, columns: number): TaggedLine[] {
  const coverage = context.participantsCoverage;
  if (coverage?.omitted === true) {
    const split = state.peopleSplit;
    if (split?.complete === true && split.fromStart === true && split.humans + split.agents === coverage.total) {
      return [...chrome(recordedParticipantLine(split.humans, split.agents), columns, 1)];
    }
    return [...chrome(`${coverage.total} workspace participants  human/agent split is not in this read`, columns, 1)];
  }
  const humans = context.participants.filter((participant) => participant.actor.actorType === "human").length;
  const agents = context.participants.filter((participant) => participant.actor.actorType === "agent").length;
  return [...chrome(recordedParticipantLine(humans, agents), columns, 1)];
}

const PAYLOAD_LIMIT = 160;
const OMIT_PAYLOAD_KEY = /^(transcript|privatetranscript|prompt|messages)$/i;

function scrubPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubPayload);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (OMIT_PAYLOAD_KEY.test(key)) continue;
      out[key] = scrubPayload(inner);
    }
    return out;
  }
  return value;
}

function payloadSummary(payload: Record<string, unknown> | undefined): string {
  if (payload === undefined) return "";
  let text = "";
  try {
    text = JSON.stringify(scrubPayload(payload)) ?? "";
  } catch {
    return "";
  }
  text = clean(text);
  if (text.length === 0 || text === "{}") return "";
  return text.length > PAYLOAD_LIMIT ? `${text.slice(0, PAYLOAD_LIMIT)}…` : text;
}

function historyHeading(history: HistoryState): string {
  const page = history.page;
  if (history.unavailable !== undefined || page?.stale === true) {
    return "RECORDED CHANGES FOR THIS RECORD  history is unavailable";
  }
  if (page === undefined) return "RECORDED CHANGES FOR THIS RECORD  history is loading";
  if (page.total === 0) return `RECORDED CHANGES FOR THIS RECORD  returned 0 of 0  read ${clean(page.readAt)}`;
  const continuation = page.truncated ? "more changes" : "complete for recorded contributions";
  return `RECORDED CHANGES FOR THIS RECORD  returned ${page.returned} of ${page.total}  page ${page.pageNumber}  ${continuation}  read ${clean(page.readAt)}`;
}

function historyRowText(entry: Contribution): string {
  const parts = [clean(entry.id), clean(entry.action), clean(entry.actor.actorType), clean(entry.actor.actorId)];
  if (entry.agentSessionId !== undefined && entry.agentSessionId.length > 0) parts.push(`session ${clean(entry.agentSessionId)}`);
  parts.push(clean(entry.createdAt));
  return parts.filter((part) => part.length > 0).join("  ");
}

function buildHistory(state: DashboardState, columns: number): TaggedLine[] {
  const history = state.history;
  if (history === undefined || !history.open) return [];
  const lines: TaggedLine[] = [
    ...chrome(historyHeading(history), columns, 0),
    ...record(`get_record_history  ${clean(history.objectType)}  ${clean(history.objectId)}`, columns, 0),
  ];
  if (history.unavailable !== undefined) {
    lines.push(...record(`History is unavailable. ${clean(history.unavailable)}`, columns, 0));
  }
  const page = history.page;
  if (page === undefined) {
    if (history.unavailable === undefined) lines.push(...record("Recorded changes are loading.", columns, 1));
    return lines;
  }
  if (page.total === 0 && history.unavailable === undefined && page.stale !== true) {
    lines.push(...record(HISTORY_EMPTY_TEXT, columns, 0));
    return lines;
  }
  if (page.stale === true) lines.push(...record(`stale  last success ${clean(page.readAt)}`, columns, 0));
  const selected = page.items[history.row];
  if (selected !== undefined) {
    lines.push(...record(`event ${history.row + 1} of ${page.items.length} on this loaded page  j/k event  n/b API page`, columns, 0));
    lines.push(...record(`> ${historyRowText(selected)}`, columns, 0));
    const payload = payloadSummary(selected.payload);
    if (payload.length > 0) lines.push(...record(`payload ${payload}`, columns, 1));
  }
  return lines;
}

function footerLines(columns: number, historyOpen: boolean): TaggedLine[] {
  const label = historyOpen
    ? columns < 100
      ? "j/k event  n/b API page  h/esc close  r refresh  q quit"
      : "j/k event   n/b API page   h/esc close   r refresh   q quit"
    : columns < 100 ? COMPACT_FOOTER : FOOTER;
  const lines = chrome(label, columns, 0);
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
    header.push(...buildParticipants(state, context, size.columns));
  }

  let body: TaggedLine[] = [];
  if (state.help) {
    body.push(...chrome("HELP", size.columns, 1));
    for (const line of HELP_LINES) body.push(...record(line, size.columns, 1));
  }
  if (context !== undefined) {
    if (state.history?.open === true) {
      // A narrow terminal must offer every loaded contribution, even when the
      // ordinary list and source block would consume the whole viewport.
      body.push(...chrome(`SOURCE  ${clean(state.history.objectType)}  ${clean(state.history.objectId)}`, size.columns, 0));
      body.push(...buildHistory(state, size.columns));
    } else {
      // NAV-001: exactly one active section, then its selected-record source block.
      body.push(...buildActiveSection(state, context, size.columns));
      body.push(...buildSource(state, context, size.columns));
    }
  }
  const footer = footerLines(size.columns, state.history?.open === true);
  const footerKept = footer.length >= size.rows ? footer.slice(footer.length - size.rows) : footer;
  const fitted = fit([...header, ...body], size.rows - footerKept.length);
  const selected = context === undefined ? undefined : shownRows(state)[state.row];
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

/**
 * Remove complete escape sequences from one raw input chunk: CSI sequences
 * (arrows, function keys) and unknown ESC-led chords (Alt combos). A lone
 * ESC byte is kept so a chunk that is exactly ESC still reads as the esc key.
 * Sequences are never leaked as text and never swallow the rest of the chunk:
 * a coalesced `"\u001bqj"` loses the ESC chord but keeps the `j`.
 */
export function stripEscapeSequences(text: string): string {
  let kept = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char !== "\u001b") {
      kept += char;
      continue;
    }
    if (index + 1 >= text.length) {
      // A lone ESC may be the esc key itself; keep it for the caller.
      kept += "\u001b";
      continue;
    }
    if (text[index + 1] === "[") {
      let end = index + 2;
      while (end < text.length && !/[\u0040-\u007e]/.test(text[end]!)) end += 1;
      index = Math.min(end, text.length - 1);
      continue;
    }
    // An unknown ESC-led chord (for example Alt+key): skip ESC and one byte.
    index += 1;
  }
  return kept;
}

/**
 * Split one raw stdin chunk into the recognized keys it carries.
 *
 * A chunk is not guaranteed to hold a single key: a PTY delivers whatever the
 * writer queued between reads, so a scripted or pasted burst can arrive as
 * `"\t\tq"` in one chunk. Treating only whole-chunk single keys as input
 * silently dropped such bursts (a scripted capture sent two tabs and q within
 * 300 ms and the dashboard never quit). Escape sequences are stripped first,
 * then each recognized byte is returned in order and reduced one by one,
 * mirroring the filter-mode typing path; a chunk that is exactly ESC stays the
 * esc key.
 */
const COMMAND_CHARS = new Set(["p", "j", "k", "r", "?", "q", "/", "n", "b", "h"]);

/**
 * Command keys up to and including the `/` that starts a filter, then the
 * unparsed remainder. A chunk is one read: if `/dec_nav001_review` were
 * normalized as commands, the `n` inside the id would page instead of being
 * filter text. Characters after `/` stay text for that chunk.
 */
export function splitDashboardChunk(text: string): { keys: string[]; typed: string } {
  if (text.includes("\u0003")) return { keys: ["\u0003"], typed: "" };
  const cleaned = stripEscapeSequences(text);
  if (cleaned === "\u001b") return { keys: ["\u001b"], typed: "" };
  const keys: string[] = [];
  for (let index = 0; index < cleaned.length; index += 1) {
    const char = cleaned[index]!;
    let key: string | undefined;
    if (char === "\t") key = "tab";
    else if (char === "\r") {
      key = "enter";
      if (cleaned[index + 1] === "\n") index += 1;
    } else if (char === "\n") key = "enter";
    else if (char === "\u007f" || char === "\u0008") key = "\u007f";
    else if (COMMAND_CHARS.has(char)) key = char;
    if (key === undefined) continue;
    keys.push(key);
    if (key === "/") return { keys, typed: cleaned.slice(index + 1) };
  }
  return { keys, typed: "" };
}

export function normalizeInputChunk(text: string): string[] {
  return splitDashboardChunk(text).keys;
}

/** Reduce one stdin chunk, including filter text that follows `/` in that chunk. */
export function reduceDashboardChunk(state: DashboardState, text: string): DashboardState {
  if (state.filterMode) {
    const typed = stripEscapeSequences(text);
    let next = state;
    for (const char of typed) {
      next = reduceDashboardKey(next, char);
      if (next.quit) return next;
    }
    return next;
  }
  const split = splitDashboardChunk(text);
  let next = state;
  for (const key of split.keys) {
    next = reduceDashboardKey(next, key);
    if (next.quit) return next;
  }
  if (next.filterMode && split.typed.length > 0) {
    for (const char of split.typed) {
      next = reduceDashboardKey(next, char);
      if (next.quit) return next;
    }
  }
  return next;
}

export async function runDashboardSession(options: DashboardSessionOptions): Promise<void> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const now = options.now ?? ((): Date => new Date());
  let state = createDashboardState({
    workspaceId: options.workspaceId,
    actorId: options.actorId,
    actorType: options.actorType,
    boundedReads: options.loadTasks !== undefined,
  });
  let closed = false;
  let finished = false;
  let screenOn = false;
  let rawEnabled = false;
  let suspended = false;
  let pumping = false;
  let pendingPump = false;
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

  const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  const isRejectedCursor = (error: unknown): boolean =>
    error instanceof CampfireError && error.code === "ValidationError";

  async function fulfillOne(): Promise<boolean> {
    if (closed) return false;
    if (state.refreshRequested) {
      const generation = state.generation;
      state = { ...state, refreshRequested: false };
      try {
        const loaded = await options.load();
        if (!closed) state = applyContextLoad(state, loaded, now().toISOString(), generation);
      } catch (error) {
        if (!closed) state = failContextLoad(state, generation, errorText(error));
      }
      return true;
    }
    const taskReq = state.taskPageRequest;
    if (taskReq !== undefined) {
      if (taskReq.generation !== state.generation) {
        state = { ...state, taskPageRequest: undefined };
        return true;
      }
      state = { ...state, taskPageRequest: undefined };
      if (options.loadTasks === undefined) {
        state = failTaskPage(state, taskReq.generation, "Work page read is not available.");
        return true;
      }
      try {
        const page = await options.loadTasks(taskReq.cursor);
        if (!closed) state = applyTaskPage(state, page, { ...taskReq, readAt: now().toISOString() });
      } catch (error) {
        if (closed) return true;
        if (taskReq.recoverOnRejectedCursor && taskReq.cursor !== undefined && isRejectedCursor(error)) {
          state = rejectTaskCursor(state, taskReq.generation);
        } else {
          state = failTaskPage(state, taskReq.generation, errorText(error));
        }
      }
      return true;
    }
    const peopleReq = state.peoplePageRequest;
    if (peopleReq !== undefined) {
      if (peopleReq.generation !== state.generation) {
        state = { ...state, peoplePageRequest: undefined };
        return true;
      }
      state = { ...state, peoplePageRequest: undefined };
      if (options.loadPeople === undefined) {
        state = failPeoplePage(state, peopleReq.generation, "People page read is not available.");
        return true;
      }
      try {
        const page = await options.loadPeople({ cursor: peopleReq.cursor, humanOwnerId: peopleReq.humanOwnerId });
        if (!closed) state = applyPeoplePage(state, page, { ...peopleReq, readAt: now().toISOString() });
      } catch (error) {
        if (closed) return true;
        if (peopleReq.recoverOnRejectedCursor && peopleReq.cursor !== undefined && isRejectedCursor(error)) {
          state = rejectPeopleCursor(state, peopleReq.generation);
        } else {
          state = failPeoplePage(state, peopleReq.generation, errorText(error));
        }
      }
      return true;
    }
    const historyReq = state.historyRequest;
    if (historyReq !== undefined && historyReq.objectType !== undefined && historyReq.objectId !== undefined) {
      if (historyReq.generation !== state.generation) {
        state = { ...state, historyRequest: undefined };
        return true;
      }
      const objectType = historyReq.objectType;
      const objectId = historyReq.objectId;
      state = { ...state, historyRequest: undefined };
      if (options.loadHistory === undefined) {
        state = failHistoryRead(state, historyReq.generation, "History read is not available.");
        return true;
      }
      try {
        const page = await options.loadHistory({ objectType, objectId, cursor: historyReq.cursor });
        if (!closed) {
          state = applyHistoryPage(state, page, {
            generation: historyReq.generation,
            readAt: now().toISOString(),
            cursor: historyReq.cursor,
            pageNumber: historyReq.pageNumber,
            cursorStack: historyReq.cursorStack,
            objectType,
            objectId,
          });
        }
      } catch (error) {
        if (closed) return true;
        if (historyReq.recoverOnRejectedCursor && historyReq.cursor !== undefined && isRejectedCursor(error)) {
          state = rejectHistoryCursor(state, historyReq.generation);
        } else {
          state = failHistoryRead(state, historyReq.generation, errorText(error));
        }
      }
      return true;
    }
    const request = state.inspectRequest;
    if (request !== undefined) {
      if (request.generation !== state.generation || options.inspect === undefined) {
        state = { ...state, inspectRequest: undefined };
        return true;
      }
      state = { ...state, inspectRequest: undefined };
      try {
        const record = await options.inspect(request.kind, request.id);
        if (closed || state.generation !== request.generation) return true;
        const selected = shownRows(state)[state.row];
        if (selected?.id !== request.id) return true;
        state = { ...state, inspected: { method: inspectMethod(request.kind), sourceId: request.id, record } };
      } catch (error) {
        if (closed || state.generation !== request.generation) return true;
        state = { ...state, staleError: clean(errorText(error)) || "read failed" };
      }
      return true;
    }
    return false;
  }

  const schedule = (): void => {
    if (pumping) {
      pendingPump = true;
      return;
    }
    pumping = true;
    void (async () => {
      try {
        do {
          pendingPump = false;
          const did = await fulfillOne();
          if (!did && !pendingPump) break;
        } while (!closed);
      } finally {
        pumping = false;
        if (pendingPump && !closed) schedule();
      }
      if (!closed) draw();
    })();
  };

  const loadInitial = async (): Promise<void> => {
    const generation = state.generation;
    try {
      const loaded = await options.load();
      if (closed) return;
      state = applyContextLoad(state, loaded, now().toISOString(), generation);
    } catch (error) {
      if (closed) return;
      state = failContextLoad(state, generation, errorText(error));
    }
    if (!closed) draw();
  };

  const onData = (chunk: Buffer | string): void => {
    if (closed || finished) return;
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const next = reduceDashboardChunk(state, text);
    if (next === state) return;
    state = next;
    if (state.quit) {
      // Draw the final navigated state before leaving. When a burst carries
      // navigation and q in one chunk, the queued per-key draws are
      // suppressed by the teardown's closed guard, so without this the last
      // stable frame would be the first tab's section instead of the section
      // the burst navigated to.
      draw();
      finish();
      return;
    }
    draw();
    schedule();
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
    if (closed || suspended || !terminalIsForeground()) return;
    state = requestDashboardRefresh(state);
    schedule();
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
    await loadInitial();
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
