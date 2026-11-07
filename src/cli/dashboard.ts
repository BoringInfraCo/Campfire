/**
 * UIX-001 read-only terminal console; NAV-001 focused navigator; NAV-002
 * paged work, on-demand people, and selected-record history.
 *
 * The default frame is one read-only shell: a workspace and people rail, and
 * an overview pane (goal, Needs You, Needs Attention, work). Other sections
 * keep a single body plus the source block. The local `/` filter narrows the
 * shown rows of the loaded page — matching, loaded, and workspace total stay
 * separate numbers. It is not workspace search and not a model prompt. The
 * exact input `/update` followed by Return requests an update and is not kept
 * as a filter. `w` lists workspaces; enter switches, and the screen still
 * draws one workspace. Record text is untrusted: only `renderDashboard` text
 * is drawn, and every record string goes through `stripTerminalControls`. An
 * omitted participant roster is not zero people. Registration is not presence.
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
const WORKSPACE_LIST_UNAVAILABLE = "The workspace list is unavailable.";
const RECORDED_NOT_PRESENT = "recorded, not present";

export type DashboardSection = "overview" | "attention" | "work" | "decisions" | "references" | "people" | "changes";
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
  /** Cleaned name from the page this place left, when that human was on it. */
  humanOwnerName?: string;
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
  /** Set when the page is that human's recorded agents. */
  humanOwnerId?: string;
  /**
   * Set only when that human was on the page this read left. Otherwise the
   * heading uses the id.
   */
  humanOwnerName?: string;
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
  humanOwnerName?: string;
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
  humanOwnerName?: string;
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
  /** Set only by exact `/update` then Return. Not a shown-row filter. */
  updateRequested: boolean;
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
  /** Workspace picker. One workspace still renders; this is not a tab strip. */
  workspaceListOpen: boolean;
  workspaceChoices: Array<{ id: string; name: string }>;
  workspaceListRow: number;
  /** Set by `w`. The session lists workspaces, or notes that the list is unavailable. */
  workspaceListRequest?: { generation: number };
  /** Set by enter on a workspace row. The session assigns this id and refreshes. */
  workspaceSwitchId?: string;
  /**
   * No workspace exists yet. The frame must not invent records, sessions, or
   * a goal, and the session must not call the workspace loaders.
   */
  awaitingWorkspace?: boolean;
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
  /** Side effect for an exact `/update` request. The dashboard does not install. */
  onUpdate?: () => Promise<void>;
  /** Id and name only. Omitted means `w` notes that the list is unavailable. */
  listWorkspaces?: () => Promise<Array<{ id: string; name: string }>>;
  /**
   * Assigns the id closed over by the host's loaders. Called when a switch
   * id is fulfilled, before the context refresh reads it.
   */
  adoptWorkspace?: (workspaceId: string) => void;
  /**
   * Draw the empty-workspace screen. `workspaceId` stays required; callers
   * pass `""` with this flag. Loaders are not called.
   */
  awaitingWorkspace?: boolean;
}

const SECTIONS: readonly DashboardSection[] = [
  "overview",
  "attention",
  "work",
  "decisions",
  "references",
  "people",
  "changes",
];

const FOOTER_LEFT = "j/k move    h history    ? help";
const FOOTER_RIGHT = "tab section    enter open    q quit";
const COMPACT_FOOTER = "j/k move  h history  ? help  tab  enter  q quit";

const HELP_LINES = [
  "Overview shows the goal, Needs You, Needs Attention, and work. The rail lists workspaces and recorded people.",
  "tab moves among Overview, Needs You or Needs Attention, Work, Decisions, Sources, People & Agents, and Activity.",
  "p switches Needs You and Needs Attention. It does not change the workspace.",
  "w lists workspaces. enter switches to the selected workspace. esc closes the list.",
  "The rail shows each workspace, then new and menu. menu is m, which opens this help. new is campfire create-workspace; this screen does not create one.",
  "j and k move within shown rows, among workspace choices while that list is open, or among loaded contributions while history is open. enter opens a read-only detail.",
  "n and b page Work, People, or an open history panel. Elsewhere they do not move the selection.",
  "h opens or closes recorded changes for the selected task, decision, finding, or artifact.",
  "esc closes the workspace list first, then history. A later esc clears a committed filter. ctrl-c always quits.",
  "/ filters the loaded page, not the workspace. enter confirms; esc clears. Letters stay text.",
  "/update reviews a Campfire update. The canonical command is campfire update. Other / text still filters this page.",
  "r reloads orientation and the active page as separate reads.",
  "? toggles this help. q quits.",
  "Registration, role, and join time are not presence or permission.",
  "Recorded registration is not presence.",
  RECORDED_NOT_PRESENT,
  NOT_RUNNING,
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
  awaitingWorkspace?: boolean;
}): DashboardState {
  return {
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    actorType: input.actorType,
    perspective: input.perspective ?? "mine",
    section: input.section ?? "overview",
    row: 0,
    help: false,
    quit: false,
    refreshRequested: false,
    updateRequested: false,
    detailOpen: false,
    filter: "",
    filterMode: false,
    generation: 1,
    boundedReads: input.boundedReads ?? false,
    workspaceListOpen: false,
    workspaceChoices: [],
    workspaceListRow: 0,
    ...(input.context === undefined ? {} : { context: input.context }),
    ...(input.refreshedAt === undefined ? {} : { refreshedAt: input.refreshedAt }),
    ...(input.staleError === undefined ? {} : { staleError: input.staleError }),
    ...(input.awaitingWorkspace === true ? { awaitingWorkspace: true } : {}),
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
  if (item.actor.actorType === "agent") parts.push(RECORDED_NOT_PRESENT);
  return parts.filter((part) => part.length > 0).join("  ");
}

/**
 * Humans first, then agents grouped by the owner key in first-seen order.
 * Selectable rows stay the participants. Headers are drawn later and are not
 * rows, so j/k follows this order.
 */
function groupedPeople(items: readonly ParticipantListItem[]): ParticipantListItem[] {
  const humans: ParticipantListItem[] = [];
  const agents: ParticipantListItem[] = [];
  for (const item of items) {
    if (item.actor.actorType === "agent") agents.push(item);
    else humans.push(item);
  }
  const groups = new Map<string, ParticipantListItem[]>();
  for (const agent of agents) {
    const key = clean(agent.humanOwnerId ?? "");
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [agent]);
    else list.push(agent);
  }
  const ordered = [...humans];
  for (const list of groups.values()) ordered.push(...list);
  return ordered;
}

/** Names of humans on this loaded page. A missing name falls back to the id. */
function humanNamesOnPage(items: readonly ParticipantListItem[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const item of items) {
    if (item.actor.actorType === "agent") continue;
    const id = clean(item.actor.actorId);
    if (id.length === 0 || names.has(id)) continue;
    const name = clean(item.name);
    names.set(id, name.length > 0 ? name : id);
  }
  return names;
}

function peopleGroupLabel(item: ParticipantListItem, humans: ReadonlyMap<string, string>): string {
  if (item.actor.actorType !== "agent") return "People";
  const owner = clean(item.humanOwnerId ?? "");
  if (owner.length === 0) return "Agents";
  const name = humans.get(owner);
  return name === undefined ? `Agents recorded for ${owner}` : `Agents recorded for ${name}`;
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

function attentionRow(context: WorkspaceContext, item: AttentionItem): DashRow {
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
}

/** Tasks the work section would list: a loaded page, else orientation when unbounded. */
function workSource(state: DashboardState, context: WorkspaceContext): Task[] {
  if (state.taskPage !== undefined) return state.taskPage.items;
  if (state.boundedReads) return [];
  return currentTasks(context);
}

/**
 * Overview work rows follow the work section's source, keep open and
 * in_progress tasks, and skip ids already listed under Needs You.
 */
function overviewWorkRows(state: DashboardState, context: WorkspaceContext): DashRow[] {
  const skip = new Set(context.needsYou.map((item) => item.id));
  return workSource(state, context)
    .filter((task) => (task.status === "open" || task.status === "in_progress") && !skip.has(task.id))
    .map(taskRow);
}

function overviewParts(state: DashboardState, context: WorkspaceContext): {
  needsYou: DashRow[];
  needsAttention: DashRow[];
  work: DashRow[];
} {
  return {
    needsYou: context.needsYou.map((item) => attentionRow(context, item)),
    needsAttention: context.needsAttention.map((item) => attentionRow(context, item)),
    work: overviewWorkRows(state, context),
  };
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
    case "overview": {
      // Same order the overview pane draws, so j/k moves that combined list.
      const parts = overviewParts(state, context);
      return [...parts.needsYou, ...parts.needsAttention, ...parts.work];
    }
    case "attention":
      return attentionItems(state, context).map((item) => attentionRow(context, item));
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
      // not a page, and an omitted array is not a roster. Grouping changes
      // display order on this page; it is not a workspace census.
      return groupedPeople(state.peoplePage?.items ?? []).map((item) => ({
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
    updateRequested: state.updateRequested,
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
    workspaceListOpen: state.workspaceListOpen,
    workspaceChoices: state.workspaceChoices,
    workspaceListRow: state.workspaceListRow,
    ...(state.workspaceListRequest === undefined ? {} : { workspaceListRequest: state.workspaceListRequest }),
    ...(state.workspaceSwitchId === undefined ? {} : { workspaceSwitchId: state.workspaceSwitchId }),
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
    return reconcileSelection(state, { ...state, filter: "", filterMode: false, updateRequested: false });
  }
  if (key === "\r" || key === "\n" || key === "\r\n" || key === "enter") {
    // Exact `/update` requests an update. Every other string stays a filter.
    if (state.filter === "update") {
      return { ...state, filter: "", filterMode: false, updateRequested: true };
    }
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
        cursorStack: [...page.cursorStack, {
          cursor: page.cursor,
          pageNumber: page.pageNumber,
          humanOwnerId: page.humanOwnerId,
          humanOwnerName: page.humanOwnerName,
        }],
        humanOwnerId: page.humanOwnerId,
        humanOwnerName: page.humanOwnerName,
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
      humanOwnerName: previous.humanOwnerName,
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

function openHumanAgents(state: DashboardState, human: ParticipantListItem): DashboardState {
  const page = state.peoplePage;
  const generation = state.generation + 1;
  const humanId = human.actor.actorId;
  const name = clean(human.name);
  const label = name.length > 0 ? name : clean(humanId);
  const stack = page === undefined
    ? []
    : [...page.cursorStack, {
      cursor: page.cursor,
      pageNumber: page.pageNumber,
      humanOwnerId: page.humanOwnerId,
      humanOwnerName: page.humanOwnerName,
    }];
  return {
    ...withoutTransient(state),
    generation,
    statusNote: `Loading agents recorded for ${label}. Rows below are the last successful page, not this request.`,
    peoplePageRequest: {
      generation,
      humanOwnerId: humanId,
      ...(name.length > 0 ? { humanOwnerName: name } : {}),
      pageNumber: 1,
      cursorStack: stack,
      recoverOnRejectedCursor: false,
    },
  };
}

function closeWorkspaceList(state: DashboardState): DashboardState {
  return {
    ...state,
    workspaceListOpen: false,
    workspaceListRequest: undefined,
    statusNote: undefined,
  };
}

/** Enter on a workspace row. The session assigns the id and refreshes context. */
function requestWorkspaceSwitch(state: DashboardState): DashboardState {
  const choice = state.workspaceChoices[state.workspaceListRow];
  if (choice === undefined) return state;
  return {
    ...closeWorkspaceList(state),
    workspaceSwitchId: choice.id,
  };
}

/**
 * Host loaders must already read the new id. Clears the previous workspace's
 * pages, history, detail, and inspect state, and keeps the section.
 */
export function fulfillWorkspaceSwitch(state: DashboardState, workspaceId: string): DashboardState {
  const generation = state.generation + 1;
  const next: DashboardState = {
    ...state,
    workspaceId,
    generation,
    row: 0,
    refreshRequested: true,
    detailOpen: false,
    inspected: undefined,
    inspectRequest: undefined,
    history: undefined,
    historyRequest: undefined,
    taskPage: undefined,
    taskPageRequest: undefined,
    peoplePage: undefined,
    peoplePageRequest: undefined,
    peopleSplit: undefined,
    workspaceSwitchId: undefined,
    workspaceListOpen: false,
    workspaceListRequest: undefined,
    refreshedAt: undefined,
    staleError: undefined,
    statusNote: undefined,
    selectionNote: undefined,
  };
  if (next.boundedReads && next.section === "work") {
    next.taskPageRequest = { generation, pageNumber: 1, cursorStack: [], recoverOnRejectedCursor: false };
  }
  if (next.section === "people") {
    next.peoplePageRequest = { generation, pageNumber: 1, cursorStack: [], recoverOnRejectedCursor: false };
  }
  return next;
}

export function applyWorkspaceChoices(
  state: DashboardState,
  choices: ReadonlyArray<{ id: string; name: string }>,
): DashboardState {
  const cleaned: Array<{ id: string; name: string }> = [];
  for (const choice of choices) {
    const id = clean(choice.id);
    if (id.length === 0) continue;
    const name = clean(choice.name);
    cleaned.push({ id, name: name.length > 0 ? name : id });
  }
  const row = cleaned.length === 0 ? 0 : Math.min(state.workspaceListRow, cleaned.length - 1);
  // Store choices for the rail even when the picker is closed. Do not open it.
  return {
    ...state,
    workspaceChoices: cleaned,
    workspaceListRow: row,
    workspaceListRequest: undefined,
  };
}

export function unavailableWorkspaceList(state: DashboardState): DashboardState {
  return {
    ...state,
    workspaceListOpen: false,
    workspaceListRequest: undefined,
    workspaceChoices: [],
    workspaceListRow: 0,
    statusNote: WORKSPACE_LIST_UNAVAILABLE,
  };
}

export function reduceDashboardKey(state: DashboardState, key: string): DashboardState {
  // Ctrl-C quits from every mode, including while a filter is being typed.
  if (key === "\u0003" || key === "ctrl-c") return { ...state, quit: true, refreshRequested: false };
  // The workspace list closes before history and before a committed or in-progress filter.
  if ((key === "\u001b" || key === "esc") && (state.workspaceListOpen || state.workspaceListRequest !== undefined)) {
    return closeWorkspaceList(state);
  }
  if (state.filterMode) return reduceFilterModeKey(state, key);
  if (key === "\u001b" || key === "esc") {
    // History closes before a committed filter so one esc cannot do both.
    if (state.history?.open === true) {
      return {
        ...state,
        generation: state.generation + 1,
        history: undefined,
        historyRequest: undefined,
        statusNote: undefined,
        updateRequested: false,
      };
    }
    if (state.filter.length === 0) return state.updateRequested ? { ...state, updateRequested: false } : state;
    return reconcileSelection(state, { ...state, filter: "", updateRequested: false });
  }
  if (key === "\u007f" || key === "\u0008" || key === "backspace") return state;
  if (key === "/" && !state.workspaceListOpen) return { ...state, filterMode: true };
  const action = canonicalKey(key);
  if (action === "quit") return { ...state, quit: true, refreshRequested: false };
  if (action === "w") {
    return {
      ...state,
      workspaceListOpen: true,
      workspaceListRequest: { generation: state.generation },
      statusNote: undefined,
    };
  }
  if (state.workspaceListOpen && (action === "tab" || action === "p" || action === "n" || action === "b" || action === "h" || action === "r" || action === "?" || action === "m")) {
    if (action === "?" || action === "m") return { ...state, help: !state.help, refreshRequested: false };
    return state;
  }
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
    const section = SECTIONS[(index + 1) % SECTIONS.length] ?? "overview";
    return openSection(state, section);
  }
  if (action === "j" || action === "k") {
    if (state.workspaceListOpen) {
      const count = state.workspaceChoices.length;
      const delta = action === "j" ? 1 : -1;
      const row = count <= 0 ? 0 : Math.min(count - 1, Math.max(0, state.workspaceListRow + delta));
      return { ...state, workspaceListRow: row, statusNote: undefined };
    }
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
  if (action === "?" || action === "m") return { ...state, help: !state.help, refreshRequested: false };
  if (action === "n" || action === "b") {
    const direction = action === "n" ? "next" : "back";
    if (state.history?.open === true) return pageHistory(state, direction);
    if (state.section === "work") return pageWork(state, direction);
    if (state.section === "people") return pagePeople(state, direction);
    return { ...state, statusNote: PAGING_UNAVAILABLE };
  }
  if (action === "h") return toggleHistory(state);
  if (action === "enter") {
    if (state.workspaceListOpen) return requestWorkspaceSwitch(state);
    const selected = selectedRow(state);
    if (selected === undefined) return { ...withoutTransient(state), detailOpen: false };
    if (selected.kind === "participant" && selected.participant?.actor.actorType === "human") {
      return openHumanAgents(state, selected.participant);
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
  if (stamp.generation !== state.generation) return state;
  // Overview prefetches page 1 for the rail and the work block. Keep the
  // overview selection; only the work section repositions its own rows.
  if (state.section !== "work") {
    if (state.section !== "overview") return state;
    return {
      ...state,
      taskPage: toLoaded(page, stamp),
      taskPageRequest: undefined,
    };
  }
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
  if (stamp.generation !== state.generation) return state;
  if (state.section !== "people") {
    // The rail reads page 1 while another section is showing. Do not move that
    // section's selection or treat the page as the people-section roster walk
    // unless it is the unfiltered page the rail asked for.
    const peoplePage: PeoplePageState = {
      ...toLoaded(page, stamp),
      ...(stamp.humanOwnerId === undefined ? {} : { humanOwnerId: stamp.humanOwnerId }),
      ...(stamp.humanOwnerName === undefined ? {} : { humanOwnerName: stamp.humanOwnerName }),
    };
    const peopleSplit = stamp.humanOwnerId === undefined
      ? countSplit(state.peopleSplit, stamp.pageNumber, page.items, page.total, page.truncated)
      : state.peopleSplit;
    return {
      ...state,
      peoplePage,
      peoplePageRequest: undefined,
      ...(peopleSplit === undefined ? {} : { peopleSplit }),
    };
  }
  const peoplePage: PeoplePageState = {
    ...toLoaded(page, stamp),
    ...(stamp.humanOwnerId === undefined ? {} : { humanOwnerId: stamp.humanOwnerId }),
    ...(stamp.humanOwnerName === undefined ? {} : { humanOwnerName: stamp.humanOwnerName }),
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
  const humanOwnerName = state.peoplePage?.humanOwnerName;
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
      ...(humanOwnerName === undefined ? {} : { humanOwnerName }),
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
    case "overview":
      return String(context.slices.tasks.total);
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
  const heading = state.perspective === "mine" ? "NEEDS YOU" : "NEEDS ATTENTION";
  const lines: TaggedLine[] = [
    ...chrome(`${heading}  ${counts}`, columns, 0),
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

function recordedAgentsLabel(page: PeoplePageState): string {
  const name = page.humanOwnerName === undefined ? "" : clean(page.humanOwnerName);
  const id = page.humanOwnerId === undefined ? "" : clean(page.humanOwnerId);
  return `Agents recorded for ${name.length > 0 ? name : id}`;
}

function renderPeopleRows(state: DashboardState, columns: number): TaggedLine[] {
  const humans = humanNamesOnPage(state.peoplePage?.items ?? []);
  const rows = shownRows(state);
  const lines: TaggedLine[] = [];
  let previous = "";
  rows.forEach((row, index) => {
    const item = row.participant;
    const header = item === undefined ? "" : peopleGroupLabel(item, humans);
    if (header.length > 0 && header !== previous) {
      lines.push(...chrome(header, columns, 1));
      previous = header;
    }
    const marker = index === state.row ? "> " : "";
    const rank = index === state.row || row.reviewCue ? 0 : 1;
    lines.push(...record(`${marker}${row.text}`, columns, rank));
  });
  return lines;
}

interface PaneLine extends TaggedLine {
  /** `full` uses the terminal width. `pane` sits to the right of the rail. */
  span?: "full" | "pane";
}

/** One sidebar width. The body keeps a 3-column gutter: the divider plus a 2-space inset. */
const SIDEBAR_WIDTH = 24;
const BODY_GUTTER = 3;

function shellLayout(columns: number): { rail: number; gutter: number; main: number } {
  if (columns < 72) return { rail: 0, gutter: 0, main: columns };
  return {
    rail: SIDEBAR_WIDTH,
    gutter: BODY_GUTTER,
    main: Math.max(1, columns - SIDEBAR_WIDTH - BODY_GUTTER),
  };
}

function tagSpan(lines: readonly TaggedLine[], mainWidth: number): PaneLine[] {
  return lines.map((line) => ({
    text: line.text,
    rank: line.rank,
    span: line.text.length > mainWidth ? "full" : "pane",
  }));
}

function overviewTitleLine(name: string, id: string, needs: number, width: number): string {
  const right = `Needs You  ${needs}`;
  const left = `${name}  ${id}`.trim();
  const gap = width - left.length - right.length;
  if (gap >= 2) return left + " ".repeat(gap) + right;
  const compact = `${left}  ${right}`;
  return compact.length <= width ? compact : compact.slice(0, width);
}

function rowMatchesFilter(state: DashboardState, row: DashRow): boolean {
  if (state.filter.length === 0) return true;
  const needle = state.filter.toLowerCase();
  return row.id.toLowerCase().includes(needle) || row.text.toLowerCase().includes(needle);
}

function pushPane(lines: PaneLine[], text: string, width: number, rank: number): void {
  const parts = wrapSegments(text, Math.max(1, width), "");
  for (const part of parts) lines.push({ text: part, rank, span: "pane" });
}

/** Prefix stays on the first line only. Continuation lines keep the same indent. */
function pushPrefixed(lines: PaneLine[], text: string, mainWidth: number, rank: number, prefix: string): void {
  // Keep the two-space token gaps. `clean` would collapse them.
  const body = stripTerminalControls(text).trim();
  if (body.length === 0) {
    lines.push({ text: prefix, rank, span: "pane" });
    return;
  }
  const room = Math.max(1, mainWidth - prefix.length);
  const parts = wrapSegments(body, room, "");
  parts.forEach((part, index) => {
    const lead = index === 0 ? prefix : " ".repeat(prefix.length);
    lines.push({ text: lead + part, rank, span: "pane" });
  });
}

function pushBlank(lines: PaneLine[]): void {
  lines.push({ text: "", rank: 2, span: "pane" });
}

/**
 * Display name for an overview subtitle. People-page rows win over the
 * orientation roster. A missing name falls back to the actor id. No actor
 * yields an empty string so the row does not invent an assignee.
 */
function personName(state: DashboardState, context: WorkspaceContext, actorId: string | undefined): string {
  if (actorId === undefined) return "";
  const id = clean(actorId);
  if (id.length === 0) return "";
  const lists: Array<{ actor: { actorId: string }; name: string }> = [
    ...(state.peoplePage?.items ?? []),
    ...context.participants,
  ];
  for (const person of lists) {
    if (clean(person.actor.actorId) !== id) continue;
    const name = clean(person.name);
    return name.length > 0 ? name : id;
  }
  return id;
}

function withRecordId(text: string, id: string): string {
  if (id.length === 0) return text;
  if (text.split(/\s+/).includes(id)) return text;
  return text.length > 0 ? `${text}    ${id}` : id;
}

/**
 * Two-line overview drawing. `sectionRows` stays the dense filter text.
 * Subtitles are not selectable rows; the `>` marker still tracks `state.row`.
 */
function overviewVisual(
  group: "needsYou" | "needsAttention" | "work",
  row: DashRow,
  state: DashboardState,
  context: WorkspaceContext,
): { primary: string; secondary: string } {
  const id = clean(row.id);
  if (group === "work") {
    const task = taskRecord(state, context, row.id);
    const status = task === undefined ? "" : taskStatusLabel(task.status);
    const title = task === undefined ? "" : clean(task.title);
    const primary = [status, title].filter((part) => part.length > 0).join("  ");
    const name = personName(state, context, task?.assignee?.actorId);
    if (task?.status === "in_progress") {
      const who = name.length > 0 ? `${name}    ` : "";
      return { primary, secondary: `${who}not a running process` };
    }
    return { primary, secondary: name };
  }
  const item = [...context.needsYou, ...context.needsAttention].find((entry) => entry.id === row.id);
  if (item?.kind === "decision") {
    const status = clean(item.status);
    const summary = clean(item.summary);
    const primary = [status, summary].filter((part) => part.length > 0).join("  ");
    const findings = (item.needsReviewFindingIds ?? []).map((findingId) => clean(findingId)).filter((findingId) => findingId.length > 0);
    const review = row.reviewCue || item.reason === "accepted_decision_needs_review" || findings.length > 0;
    if (!review) return { primary, secondary: "" };
    const cites = findings.length > 0 ? `    cites ${findings.join("  ")}` : "";
    return { primary, secondary: `needs review${cites}    acceptance unchanged` };
  }
  const status = item === undefined ? "" : taskStatusLabel(item.status);
  const summary = item === undefined ? "" : clean(item.summary);
  const primary = [status, summary].filter((part) => part.length > 0).join("  ");
  const assignee = item?.assignee?.actorId ?? taskRecord(state, context, row.id)?.assignee?.actorId;
  const name = personName(state, context, assignee);
  const assigned = name.length > 0 ? `assigned to ${name}` : "";
  return { primary, secondary: withRecordId(assigned, id) };
}

function buildOverview(state: DashboardState, context: WorkspaceContext, columns: number, mainWidth: number): PaneLine[] {
  const lines: PaneLine[] = [];
  const width = Math.max(1, mainWidth);
  const name = clean(context.workspace.name);
  const needs = context.needsYou.length;
  const titleWidth = mainWidth > 0 && mainWidth < columns ? mainWidth : columns;
  const titleLine = overviewTitleLine(name.length > 0 ? name : "workspace", clean(state.workspaceId), needs, titleWidth);
  // Padding before "Needs You" is intentional; do not trim it.
  lines.push({ text: titleLine, rank: 0, span: "pane" });
  if (state.staleError !== undefined && clean(state.staleError).length > 0) {
    pushPane(lines, `STALE  ${clean(state.staleError)}`, width, 0);
  }
  pushBlank(lines);
  lines.push({ text: "GOAL", rank: 0, span: "pane" });
  pushBlank(lines);
  const goal = context.goal;
  if (goal !== undefined && clean(goal.title).length > 0) {
    // Stay inside the pane. A long title wraps here instead of spanning the rail.
    // A measure near 48 breaks the billing goal the way the shell mock does.
    pushPane(lines, clean(goal.title), Math.min(width, 48), 0);
  } else {
    lines.push({ text: "no recorded goal", rank: 0, span: "pane" });
  }
  lines.push(...tagSpan(noteLines(state, columns), mainWidth));

  const parts = overviewParts(state, context);
  let shownIndex = 0;
  const drawGroup = (title: string, rows: DashRow[], group: "needsYou" | "needsAttention" | "work"): void => {
    pushBlank(lines);
    lines.push({ text: title, rank: 0, span: "pane" });
    for (const row of rows) {
      if (!rowMatchesFilter(state, row)) continue;
      const selected = shownIndex === state.row;
      const rank = selected || row.reviewCue ? 0 : 1;
      const visual = overviewVisual(group, row, state, context);
      const secondary = selected ? withRecordId(visual.secondary, clean(row.id)) : visual.secondary;
      pushPrefixed(lines, visual.primary, width, rank, selected ? "> " : "  ");
      // Subtitle sits under the title, one step past the status word.
      if (secondary.length > 0) pushPrefixed(lines, secondary, width, rank, "      ");
      shownIndex += 1;
    }
  };
  drawGroup("NEEDS YOU", parts.needsYou, "needsYou");
  drawGroup("NEEDS ATTENTION", parts.needsAttention, "needsAttention");
  drawGroup("WORK", parts.work, "work");
  if (state.detailOpen) lines.push(...tagSpan(buildSource(state, context, columns), mainWidth));
  return lines;
}

function buildWork(state: DashboardState, context: WorkspaceContext, columns: number): TaggedLine[] {
  const page = state.taskPage;
  const heading = page === undefined
    ? `WORK  ${sliceCoverage("tasks", context.slices.tasks)}`
    : `WORK  ${pageFact(page)}`;
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
    lines.push(...chrome("PEOPLE & AGENTS", columns, 0));
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
        `${recordedAgentsLabel(page)}  total ${page.total}  ${pageFact(page)}`,
        columns,
        0,
      ),
    );
    lines.push(
      ...record("total counts this human's agents in this workspace. It is not the unfiltered page and not a presence count.", columns, 1),
    );
  } else {
    lines.push(...chrome(`PEOPLE & AGENTS  ${pageFact(page)}`, columns, 0));
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
  lines.push(...renderPeopleRows(state, columns));
  return lines;
}

function buildDecisions(state: DashboardState, context: WorkspaceContext, columns: number): TaggedLine[] {
  const lines: TaggedLine[] = [
    ...chrome(`DECISIONS  ${sliceCoverage("decisions", context.slices.decisions)}`, columns, 1),
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
    ...chrome(`SOURCES  ${sliceCoverage("artifacts", context.slices.artifacts)}`, columns, 1),
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
      `ACTIVITY  showing ${context.provenance.length} of ${context.provenanceTotal}${truncated}`,
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
    case "overview":
      return buildOverview(state, context, columns, columns);
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

function buildWorkspaceList(state: DashboardState, columns: number): TaggedLine[] {
  const lines: TaggedLine[] = [...chrome("WORKSPACES", columns, 0)];
  if (state.workspaceListRequest !== undefined && state.workspaceChoices.length === 0) {
    lines.push(...record("Workspace list is loading.", columns, 0));
  } else if (state.workspaceChoices.length === 0) {
    lines.push(...record("No workspace was returned.", columns, 1));
  } else {
    state.workspaceChoices.forEach((choice, index) => {
      const marker = index === state.workspaceListRow ? "> " : "";
      const rank = index === state.workspaceListRow ? 0 : 1;
      lines.push(...record(`${marker}${clean(choice.name)}  ${clean(choice.id)}`, columns, rank));
    });
  }
  lines.push(...record("enter switches to the selected workspace. esc closes this list.", columns, 1));
  lines.push(...noteLines(state, columns));
  return lines;
}

function wideFooter(columns: number): string {
  const gap = columns - FOOTER_LEFT.length - FOOTER_RIGHT.length;
  if (gap < 1) {
    const joined = `${FOOTER_LEFT}  ${FOOTER_RIGHT}`;
    return joined.length <= columns ? joined : joined.slice(0, columns);
  }
  return FOOTER_LEFT + " ".repeat(gap) + FOOTER_RIGHT;
}

function footerLines(columns: number, historyOpen: boolean): TaggedLine[] {
  const label = historyOpen
    ? columns < 100
      ? "j/k event  n/b API page  h/esc close  r refresh  q quit"
      : "j/k event   n/b API page   h/esc close   r refresh   q quit"
    : columns < 100 ? COMPACT_FOOTER : wideFooter(columns);
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
function isFilterChrome(line: string | undefined): boolean {
  if (line === undefined) return false;
  const body = line.trim();
  if (body.length === 0) return false;
  const first = body[0] ?? "";
  if (first === "┌" || first === "└" || first === "│" || first === "┐" || first === "┘") return true;
  return body.startsWith("> filter");
}

function pinFacts(lines: string[], columns: number, facts: readonly string[]): string[] {
  const frame = [...lines];
  const missing = facts.filter(
    (fact) => fact.length > 0 && !frame.some((line) => line.includes(fact)),
  );
  let slot = frame.length - 1;
  for (const fact of missing) {
    while (slot >= 0 && ((frame[slot] ?? "").includes("q quit") || isFilterChrome(frame[slot]))) slot -= 1;
    if (slot < 0) break;
    const text = `  ${fact}`;
    frame[slot] = text.length > columns ? text.slice(0, columns) : text;
    slot -= 1;
  }
  return frame;
}

function projectLine(left: string, railWidth: number, right: string, columns: number, gutter = BODY_GUTTER): string {
  if (railWidth <= 0) return right.length > columns ? right.slice(0, columns) : right;
  const clipped = left.length > railWidth ? left.slice(0, railWidth) : left;
  const gap = " ".repeat(Math.max(1, gutter));
  const line = `${clipped.padEnd(railWidth, " ")}${gap}${right}`;
  return line.length > columns ? line.slice(0, columns) : line;
}

function composeShell(
  rail: readonly TaggedLine[],
  main: readonly PaneLine[],
  railWidth: number,
  columns: number,
  gutter = BODY_GUTTER,
): TaggedLine[] {
  if (railWidth <= 0) {
    return main.map((line) => ({
      text: line.text.length > columns ? line.text.slice(0, columns) : line.text,
      rank: line.rank,
    }));
  }
  const out: TaggedLine[] = [];
  let railIndex = 0;
  for (const line of main) {
    if (line.span === "full") {
      out.push({ text: line.text.length > columns ? line.text.slice(0, columns) : line.text, rank: line.rank });
      continue;
    }
    const left = railIndex < rail.length ? (rail[railIndex]?.text ?? "") : "";
    if (railIndex < rail.length) railIndex += 1;
    out.push({ text: projectLine(left, railWidth, line.text, columns, gutter), rank: line.rank });
  }
  while (railIndex < rail.length) {
    const left = rail[railIndex];
    railIndex += 1;
    if (left === undefined) continue;
    out.push({ text: projectLine(left.text, railWidth, "", columns, gutter), rank: left.rank });
  }
  return out;
}

function railSplitLine(left: string, right: string, width: number): string {
  if (width <= left.length) return left.slice(0, Math.max(0, width));
  if (left.length + 1 + right.length > width) return `${left} ${right}`.slice(0, width);
  return left + " ".repeat(width - left.length - right.length) + right;
}

function agentsGroupedLine(width: number): string {
  return railSplitLine("agents", "grouped", width);
}

function workspaceActionsLine(width: number): string {
  return railSplitLine("new", "menu", width);
}

/** People for the rail. An omitted orientation roster is not an empty team. */
function railRoster(state: DashboardState, context: WorkspaceContext): ParticipantListItem[] {
  if (state.peoplePage !== undefined) return state.peoplePage.items;
  if (context.participantsCoverage?.omitted === true) return [];
  if (context.participants.length > 0) return [...context.participants];
  return [];
}

function personLabel(item: ParticipantListItem): string {
  const name = clean(item.name);
  return name.length > 0 ? name : clean(item.actor.actorId);
}

/** Harness sits on the right edge of the rail. No glyph: registration is not presence. */
function railAgentLine(item: ParticipantListItem, width: number): string {
  const name = personLabel(item);
  const harness = item.harness === undefined ? "" : clean(item.harness);
  const indented = `  ${name}`;
  if (harness.length === 0) return indented;
  if (width <= 0) return indented.slice(0, Math.max(0, width));
  // A harness that fits by itself stays; the name is what gets clipped.
  if (harness.length >= width) return harness.slice(0, width);
  const gap = width - indented.length - harness.length;
  if (gap >= 1) return indented + " ".repeat(gap) + harness;
  const room = width - harness.length - 1;
  if (room <= 0) return harness.padStart(width, " ");
  return `${indented.slice(0, room)} ${harness}`;
}

function railPeople(items: readonly ParticipantListItem[], width: number): TaggedLine[] {
  const lines: TaggedLine[] = [];
  const add = (text: string): void => {
    lines.push(railPlain(text, width, 1));
  };
  const humans = items.filter((item) => item.actor.actorType !== "agent");
  const agents = items.filter((item) => item.actor.actorType === "agent");
  const nested = new Set<ParticipantListItem>();
  for (const human of humans) {
    add(personLabel(human));
    const id = clean(human.actor.actorId);
    for (const agent of agents) {
      if (clean(agent.humanOwnerId ?? "") !== id) continue;
      nested.add(agent);
      add(railAgentLine(agent, width));
    }
  }
  const byOwner = new Map<string, ParticipantListItem[]>();
  for (const agent of agents) {
    if (nested.has(agent)) continue;
    const key = clean(agent.humanOwnerId ?? "");
    const list = byOwner.get(key);
    if (list === undefined) byOwner.set(key, [agent]);
    else list.push(agent);
  }
  for (const [owner, list] of byOwner) {
    if (owner.length > 0) add(owner);
    for (const agent of list) add(railAgentLine(agent, width));
  }
  return lines;
}

/** One rail row. Leading spaces are indentation, so this does not trim them. */
function railPlain(text: string, width: number, rank: number): TaggedLine {
  const cleaned = stripTerminalControls(text).replace(/[\r\n]+/g, "");
  return { text: cleaned.length > width ? cleaned.slice(0, width) : cleaned, rank };
}

function workspaceRailRow(name: string, selected: boolean, badge: string, width: number): string {
  const marker = selected ? "> " : "  ";
  // The count sits on the name. The empty rest of the rail stays empty.
  const body = badge.length > 0 ? `${marker}${name} ${badge}` : `${marker}${name}`;
  return body.length > width ? body.slice(0, width) : body;
}

function buildRail(state: DashboardState, context: WorkspaceContext, width: number): TaggedLine[] {
  const lines: TaggedLine[] = [...chrome("workspaces", width, 1)];
  const needs = context.needsYou.length;
  const badge = needs > 0 ? String(needs) : "";
  const choices = state.workspaceChoices;
  if (choices.length === 0) {
    const name = clean(context.workspace.name);
    lines.push(railPlain(workspaceRailRow(name.length > 0 ? name : "workspace", true, badge, width), width, 0));
  } else {
    for (const choice of choices) {
      const selected = choice.id === state.workspaceId;
      lines.push(railPlain(workspaceRailRow(clean(choice.name), selected, selected ? badge : "", width), width, selected ? 0 : 1));
    }
  }
  lines.push({ text: workspaceActionsLine(width), rank: 1 });
  // One blank between the workspace list and the people list. Both groups stay packed.
  lines.push({ text: "", rank: 1 });
  lines.push({ text: agentsGroupedLine(width), rank: 1 });
  lines.push(...railPeople(railRoster(state, context), width));
  return lines;
}

function shownRecordsDetail(state: DashboardState, context: WorkspaceContext | undefined): string {
  const typing = state.filterMode ? " (typing — enter confirms, esc clears, ctrl-c quits)" : "";
  const shown = shownRows(state).length;
  const loaded = sectionRows(state).length;
  const total = context === undefined ? "0" : workspaceTotal(state, context);
  return `filter "${clean(state.filter)}"${typing}  filters shown records, not the workspace  matching ${shown}  loaded ${loaded}  workspace total ${total}`;
}

function buildPrompt(state: DashboardState, context: WorkspaceContext | undefined, width: number): TaggedLine[] {
  if (!filterActive(state)) return chrome("> filter shown records", width, 0);
  return chrome(`> ${clean(state.filter)}  ${shownRecordsDetail(state, context)}`, width, 0);
}

/** Overview filter sits in the main pane, inset one column from each edge. */
function buildFilterBox(state: DashboardState, context: WorkspaceContext | undefined, width: number): TaggedLine[] {
  const boxWidth = Math.max(1, width > 2 ? width - 2 : width);
  const rule = (left: string, right: string): string => {
    if (boxWidth <= 1) return left.slice(0, boxWidth);
    if (boxWidth === 2) return `${left}${right}`.slice(0, boxWidth);
    return left + "─".repeat(boxWidth - 2) + right;
  };
  const content = (text: string): string => {
    if (boxWidth <= 1) return "│".slice(0, boxWidth);
    if (boxWidth === 2) return "││";
    const room = boxWidth - 2;
    const body = text.length > room ? text.slice(0, room) : text.padEnd(room, " ");
    return `│${body}│`;
  };
  const middle = filterActive(state) ? `> ${clean(state.filter)}` : "> filter shown records";
  const lines: TaggedLine[] = [
    { text: rule("┌", "┐"), rank: 0 },
    { text: content(` ${middle}`), rank: 0 },
  ];
  if (filterActive(state)) lines.push({ text: content(` ${shownRecordsDetail(state, context)}`), rank: 0 });
  lines.push({ text: rule("└", "┘"), rank: 0 });
  return lines;
}

function buildClassicHeader(state: DashboardState, context: WorkspaceContext | undefined, columns: number): TaggedLine[] {
  const name = context === undefined ? "workspace" : clean(context.workspace.name);
  const refreshed = state.refreshedAt === undefined ? "not yet" : clean(state.refreshedAt);
  const header: TaggedLine[] = [
    ...chrome(`Campfire  /  ${name}  ${clean(state.workspaceId)}`, columns, 0),
    ...chrome(`${clean(state.actorId)} ${clean(state.actorType)}  ·  refreshed ${refreshed}`, columns, 0),
  ];
  const awaitingSwitch = state.refreshRequested && state.context !== undefined && context === undefined;
  if (context?.goal !== undefined) {
    header.push(
      ...chrome("GOAL", columns, 0),
      ...record(clean(context.goal.title), columns, 0),
      ...record(clean(context.goal.id), columns, 0),
    );
  } else if (!awaitingSwitch) {
    header.push(...chrome("GOAL", columns, 0), ...record("no recorded goal", columns, 0));
  }
  if (state.staleError !== undefined && clean(state.staleError).length > 0) {
    header.push(...record(`STALE  ${clean(state.staleError)}`, columns, 0));
  } else if (awaitingSwitch) {
    header.push(...record("Loading workspace context.", columns, 0));
  } else if (state.context !== undefined && context === undefined) {
    header.push(...record("STALE  workspace context did not match the authorized workspace", columns, 0));
  }
  if (context !== undefined) {
    header.push(...record(attentionCoverageCounts(context.attentionCoverage), columns, 0));
    header.push(...buildParticipants(state, context, columns));
  }
  return header;
}

/** Mock navigation chrome. These are labels, not records. */
const EMPTY_NAV = [
  "My work",
  "Team work",
  "Sessions",
  "Needs you",
  "People & agents",
  "Decisions",
  "Sources",
  "Recent changes",
] as const;

function clipCell(text: string, width: number): string {
  return text.length > width ? text.slice(0, width) : text;
}

function emptyRail(width: number): TaggedLine[] {
  const lines: TaggedLine[] = [
    { text: clipCell("CAMPFIRE", width), rank: 0 },
    { text: "", rank: 0 },
    { text: clipCell("NAVIGATE", width), rank: 0 },
  ];
  for (const name of EMPTY_NAV) {
    const mark = name === "Sessions" ? "> " : "  ";
    lines.push({ text: clipCell(`${mark}${name}`, width), rank: 0 });
  }
  return lines;
}

function titlePair(left: string, right: string, width: number): string[] {
  if (left.length + 2 + right.length > width) return [clipCell(left, width), clipCell(right, width)];
  const gap = width - left.length - right.length;
  return [`${left}${" ".repeat(gap)}${right}`];
}

function emptyBody(width: number, help: boolean): PaneLine[] {
  if (help) {
    const lines: TaggedLine[] = [
      ...chrome("HELP", width, 0),
      ...chrome("No workspace yet", width, 0),
    ];
    for (const line of HELP_LINES) lines.push(...record(line, width, 1));
    return lines.map((line) => ({ text: line.text, rank: line.rank }));
  }
  const prose = [
    "Describe the work to your agent. It can create the workspace and goal.",
    "Sessions, decisions, and people appear after a workspace exists.",
    "Terminal output is not shown here.",
  ];
  const lines: PaneLine[] = [
    ...titlePair("Team sessions", "Selected session", width).map((text) => ({ text, rank: 0 })),
    ...titlePair("No workspace yet", "No session selected", width).map((text) => ({ text, rank: 0 })),
  ];
  for (const sentence of prose) {
    for (const text of wrapSegments(sentence, width, "")) lines.push({ text, rank: 0 });
  }
  return lines;
}

/**
 * The mock's shell with no workspace behind it.
 * The sidebar carries the logo and section labels. The panes name Team sessions
 * and Selected session. No session, person, or terminal line is invented.
 */
function renderEmptyShell(columns: number, rows: number, help: boolean): string {
  const size = viewport(columns, rows);
  const layout = shellLayout(size.columns);
  const rail = layout.rail > 0 ? emptyRail(layout.rail) : [];
  const mainWidth = layout.rail > 0 ? layout.main : size.columns;
  const main = emptyBody(mainWidth, help);
  if (layout.rail === 0) {
    main.unshift(
      { text: "CAMPFIRE", rank: 0 },
      { text: "NAVIGATE", rank: 1 },
      ...EMPTY_NAV.map((name) => ({
        text: clipCell(name === "Sessions" ? `> ${name}` : `  ${name}`, mainWidth),
        rank: 0,
      })),
    );
  }
  const footer = footerLines(size.columns, false);
  const footerKept = footer.length >= size.rows ? footer.slice(footer.length - size.rows) : footer;
  const room = Math.max(0, size.rows - footerKept.length);
  // Help lines are lower rank than the sidebar. Keep each rail row, or a long
  // help page drops the logo and the section labels beside it.
  const composed = composeShell(rail, main, layout.rail, size.columns, layout.gutter).map((line, index) => (
    layout.rail > 0 && index < rail.length ? { text: line.text, rank: 0 } : line
  ));
  const fitted = fit(composed, room);
  const blanks = Array.from({ length: Math.max(0, room - fitted.length) }, () => "");
  return [...fitted, ...blanks, ...footerKept.map((line) => line.text)]
    .map((line) => stripTerminalControls(line))
    .join("\n");
}

/** Honest empty screen. It does not invent sessions, people, or terminal output. */
export function renderAwaitingWorkspace(columns: number, rows: number): string {
  return renderEmptyShell(columns, rows, false);
}

function renderAwaitingHelp(columns: number, rows: number): string {
  return renderEmptyShell(columns, rows, true);
}

export function renderDashboard(state: DashboardState, columns: number, rows: number): string {
  const size = viewport(columns, rows);
  if (state.awaitingWorkspace === true) {
    if (state.help !== true) return renderAwaitingWorkspace(size.columns, size.rows);
    return renderAwaitingHelp(size.columns, size.rows);
  }
  const layout = shellLayout(size.columns);
  const context = sameWorkspace(state);
  const historyOpen = state.history?.open === true;
  const overviewShell = context !== undefined
    && state.section === "overview"
    && !state.help
    && !state.workspaceListOpen
    && !historyOpen;

  const main: PaneLine[] = [];
  if (!overviewShell) main.push(...tagSpan(buildClassicHeader(state, context, size.columns), layout.main));
  if (state.help) {
    const help: TaggedLine[] = [...chrome("HELP", size.columns, 1)];
    for (const line of HELP_LINES) help.push(...record(line, size.columns, 1));
    main.push(...tagSpan(help, layout.main));
  } else if (state.workspaceListOpen) {
    main.push(...tagSpan(buildWorkspaceList(state, size.columns), layout.main));
  } else if (context !== undefined && historyOpen) {
    const history: TaggedLine[] = [
      ...chrome(`SOURCE  ${clean(state.history?.objectType ?? "")}  ${clean(state.history?.objectId ?? "")}`, size.columns, 0),
      ...buildHistory(state, size.columns),
    ];
    main.push(...tagSpan(history, layout.main));
  } else if (overviewShell && context !== undefined) {
    main.push(...buildOverview(state, context, size.columns, layout.main));
  } else if (context !== undefined) {
    main.push(...tagSpan([
      ...buildActiveSection(state, context, size.columns),
      ...buildSource(state, context, size.columns),
    ], layout.main));
  }

  const rail = layout.rail > 0 && context !== undefined ? buildRail(state, context, layout.rail) : [];
  const promptWidth = layout.rail > 0 ? layout.main : size.columns;
  const footer = footerLines(size.columns, historyOpen);
  const footerKept = footer.length >= size.rows ? footer.slice(footer.length - size.rows) : footer;
  const promptRoom = Math.max(0, size.rows - footerKept.length);
  const prompt = (overviewShell ? buildFilterBox(state, context, promptWidth) : buildPrompt(state, context, promptWidth)).slice(0, promptRoom);
  const promptTexts = prompt.map((line) => projectLine("", layout.rail, line.text, size.columns, layout.gutter));
  const room = Math.max(0, size.rows - footerKept.length - promptTexts.length);
  const fitted = fit(composeShell(rail, main, layout.rail, size.columns, layout.gutter), room);
  const blanks = Array.from({ length: Math.max(0, room - fitted.length) }, () => "");
  const selected = context === undefined ? undefined : shownRows(state)[state.row];
  const coverageToken = context === undefined ? "" : attentionCoverageCounts(context.attentionCoverage).split(" ")[0] ?? "";
  // The overview keeps the workspace id and the selected record id, which the
  // shell already shows. Goal id and coverage stay off that screen.
  const facts = overviewShell
    ? [state.workspaceId, selected?.id ?? ""]
    : [state.workspaceId, context?.goal?.id ?? "", selected?.id ?? "", coverageToken];
  return pinFacts(
    [...fitted, ...blanks, ...promptTexts, ...footerKept.map((line) => line.text)],
    size.columns,
    facts,
  ).map((line) => stripTerminalControls(line)).join("\n");
}

const RESET = "\x1b[0m";
const GOLD = "\x1b[38;2;230;176;110m";
const DIM = "\x1b[2m";
const BAR_BG = "\x1b[48;2;48;42;30m";
const BAR_FG = "\x1b[38;2;244;236;220m";
const RAIL_PANEL = "\x1b[48;2;22;24;32m";
const RAIL_CHIP = "\x1b[48;2;44;48;60m";
const RAIL_NAME = "\x1b[38;2;236;238;242m";
const COUNT_FG = "\x1b[38;2;255;244;230m";
const COUNT_BG = "\x1b[48;2;196;122;48m";
/** One column. The same mark for every selected workspace; it does not report a session. */
const WORKSPACE_MARK = "●";
/** One column. The same mark for every recorded agent; it does not report a session. */
const AGENT_MARK = "◦";

/** Longest first so "in progress" wins over any shorter prefix. */
const STATUS_WORDS = [
  "in progress",
  "superseded",
  "completed",
  "accepted",
  "proposed",
  "rejected",
  "blocked",
  "retired",
  "open",
];

const SECTION_LABELS = new Set(["GOAL", "NEEDS YOU", "NEEDS ATTENTION", "WORK"]);

interface PaintedLine {
  raw: string;
  footer: boolean;
  /** Null when the line is not a rail + gutter + pane composition. */
  railText: string | null;
  pane: string;
}

/**
 * Live color for one plain `renderDashboard` frame. The renderer stays free
 * of escapes. A non-empty `NO_COLOR` returns the frame unchanged. Inverse
 * video is not used; the `>` already in the text is the selection.
 */
export function paintDashboardFrame(frame: string, columns: number): string {
  if ((process.env.NO_COLOR ?? "").length > 0) return frame;
  const width = viewport(columns, 1).columns;
  const layout = shellLayout(width);
  const lines = frame.split("\n");
  // Blank rows fill the sidebar only after a real rail row exists.
  const composed = lines.some((line) => {
    if (line.length === 0 || isFooterLine(line)) return false;
    return describeDashboardLine(line, layout.rail, layout.gutter).railText !== null;
  });
  const parts = lines.map((line) => {
    const part = describeDashboardLine(line, layout.rail, layout.gutter);
    if (!composed && line.length === 0) return { ...part, railText: null, pane: "" };
    return part;
  });
  const bar = selectionSpan(parts);
  return parts.map((part, index) => (
    paintDashboardLine(part, index >= bar.start && index <= bar.end, layout.rail, layout.gutter, layout.main, width)
  )).join("\n");
}

function paintSelection(frame: string, columns: number): string {
  return paintDashboardFrame(frame, columns);
}

function isFooterLine(line: string): boolean {
  return line === "q quit" || (line.includes("j/k") && line.includes("q quit"));
}

function describeDashboardLine(line: string, rail: number, gutter: number): PaintedLine {
  if (isFooterLine(line)) return { raw: line, footer: true, railText: null, pane: line };
  // Filler rows between the work and the filter are empty. The sidebar still covers them.
  if (rail > 0 && line.length === 0) {
    return { raw: line, footer: false, railText: " ".repeat(rail), pane: "" };
  }
  const gap = rail > 0 ? Math.max(1, gutter) : 0;
  const gutterText = gap > 0 ? line.slice(rail, rail + gap) : "";
  if (rail <= 0 || line.length < rail + gap || gutterText.trim() !== "") {
    return { raw: line, footer: false, railText: null, pane: line };
  }
  const railText = line.slice(0, rail);
  // A full-width row can land a space on the gutter column. The only `> `
  // that belongs in the rail is the workspace marker at column 0.
  if (railText.indexOf("> ") > 0) return { raw: line, footer: false, railText: null, pane: line };
  return { raw: line, footer: false, railText, pane: line.slice(rail + gap) };
}

function statusWord(content: string): string | undefined {
  for (const word of STATUS_WORDS) {
    if (content === word || content.startsWith(`${word} `)) return word;
  }
  return undefined;
}

function isSectionLabel(pane: string): boolean {
  return SECTION_LABELS.has(pane.trim());
}

function isFilterPane(pane: string): boolean {
  if (pane.includes("filters shown records")) return true;
  const body = pane.trim();
  if (body.length === 0) return false;
  if (body.startsWith("> filter")) return true;
  const first = body[0] ?? "";
  return first === "┌" || first === "└" || first === "│" || first === "┐" || first === "┘";
}

function isSubtitle(pane: string): boolean {
  return /^ {4,}\S/.test(pane);
}

/** Overview's next row is exactly two spaces and a status word. */
function isNextRecord(pane: string): boolean {
  if (!pane.startsWith("  ") || pane.startsWith("   ")) return false;
  return statusWord(pane.slice(2)) !== undefined;
}

/**
 * A wrapped title keeps going. A sibling row is two spaces plus either a
 * status word or the double-space field gap records use.
 */
function isWrapContinuation(pane: string): boolean {
  if (!pane.startsWith("  ") || pane.startsWith("   ") || pane.startsWith("  > ")) return false;
  const body = pane.slice(2);
  if (!/\S/.test(body)) return false;
  if (statusWord(body) !== undefined) return false;
  return !body.includes("  ");
}

function isSelectionStart(pane: string): boolean {
  if (pane.includes("filters shown records")) return false;
  if (pane.startsWith("> filter") || pane.startsWith("  > filter")) return false;
  return pane.startsWith("> ") || pane.startsWith("  > ");
}

function includeInBar(pane: string): boolean {
  if (pane.trim().length === 0) return false;
  if (isSectionLabel(pane) || isFilterPane(pane) || isNextRecord(pane)) return false;
  return isSubtitle(pane) || isWrapContinuation(pane);
}

function selectionSpan(parts: readonly PaintedLine[]): { start: number; end: number } {
  const start = parts.findIndex((part) => !part.footer && isSelectionStart(part.pane));
  if (start < 0) return { start: -1, end: -1 };
  let end = start;
  let index = start + 1;
  while (index < parts.length) {
    const part = parts[index];
    if (part === undefined || part.footer || !includeInBar(part.pane)) break;
    end = index;
    if (!isSubtitle(part.pane)) {
      index += 1;
      continue;
    }
    index += 1;
    while (index < parts.length) {
      const follow = parts[index];
      if (follow === undefined || follow.footer || !isSubtitle(follow.pane)) break;
      end = index;
      index += 1;
    }
    break;
  }
  return { start, end };
}

function paintSectionLabel(pane: string): string | undefined {
  const trimmed = pane.trim();
  if (!SECTION_LABELS.has(trimmed)) return undefined;
  const at = pane.indexOf(trimmed);
  return `${pane.slice(0, at)}${GOLD}${trimmed}${RESET}${pane.slice(at + trimmed.length)}`;
}

function paintNeedsYou(pane: string): string | undefined {
  if (pane.startsWith(">") || pane.startsWith(" ")) return undefined;
  const at = pane.indexOf("Needs You");
  if (at <= 0 || !/\S/.test(pane.slice(0, at))) return undefined;
  const left = pane.slice(0, at);
  const parts = left.match(/^(\S+)(  )(\S+)(.*)$/);
  const head = parts === null
    ? left
    : `${parts[1]}${parts[2]}${DIM}${parts[3]}${RESET}${parts[4]}`;
  return `${head}${GOLD}${pane.slice(at)}${RESET}`;
}

function leadingStatus(pane: string): { index: number; word: string } | undefined {
  let offset = -1;
  if (pane.startsWith("  > ")) offset = 4;
  else if (pane.startsWith("> ")) offset = 2;
  else if (pane.startsWith("  ") && !pane.startsWith("   ")) offset = 2;
  if (offset < 0) return undefined;
  const word = statusWord(pane.slice(offset));
  if (word === undefined) return undefined;
  return { index: offset, word };
}

/** The plain frame keeps `>`. On the bar the status word is the marker. */
function hideSelectionMark(text: string): string {
  return text.replace(/^( *)> /, (mark) => " ".repeat(mark.length));
}

function paintRecordText(text: string, onBar: boolean): string {
  const shown = onBar ? hideSelectionMark(text) : text;
  if (isSubtitle(shown)) return onBar ? `${BAR_BG}${DIM}${shown}${RESET}` : `${DIM}${shown}${RESET}`;
  const status = leadingStatus(shown);
  if (!onBar) {
    if (status === undefined) return shown;
    return `${shown.slice(0, status.index)}${GOLD}${status.word}${RESET}${shown.slice(status.index + status.word.length)}`;
  }
  if (status === undefined) return `${BAR_BG}${BAR_FG}${shown}${RESET}`;
  const before = shown.slice(0, status.index);
  const after = shown.slice(status.index + status.word.length);
  // Reset clears the bar background, so each colored run puts it back.
  return `${BAR_BG}${BAR_FG}${before}${RESET}${BAR_BG}${GOLD}${status.word}${RESET}${BAR_BG}${BAR_FG}${after}${RESET}`;
}

function paintPlainPane(pane: string): string {
  if (isFilterPane(pane)) return pane;
  return paintSectionLabel(pane) ?? paintNeedsYou(pane) ?? paintRecordText(pane, false);
}

function padPane(pane: string, railText: string | null, rail: number, gutter: number, main: number, columns: number): string {
  const gap = railText === null ? 0 : Math.max(rail > 0 ? 1 : 0, gutter);
  const budget = railText === null ? columns : Math.max(0, columns - rail - gap);
  const target = Math.min(main, budget);
  if (pane.length >= target) return pane;
  return pane + " ".repeat(target - pane.length);
}

/** Section labels are not workspaces. `> Sessions` stays a nav row, not a workspace chip. */
function paintEmptyNavRail(railText: string): string | undefined {
  const match = railText.match(/^(> )(\S.*\S|\S)(\s*)$/);
  const name = match?.[2] ?? "";
  if (match === null || !EMPTY_NAV.includes(name as (typeof EMPTY_NAV)[number])) return undefined;
  const label = `> ${name}`;
  const rest = match[3] ?? "";
  const marked = `${BAR_BG}${BAR_FG}${label}${RESET}`;
  return rest.length > 0 ? `${marked}${RAIL_PANEL}${rest}${RESET}` : marked;
}

function paintWorkspaceRail(railText: string): string {
  const count = railText.match(/^(> )(\S+)(?:( )(\d+))?(\s*)$/);
  if (count === null) return `${RAIL_PANEL}${railText}${RESET}`;
  const name = count[2] ?? "";
  const gap = count[3] ?? "";
  const digits = count[4] ?? "";
  const rest = count[5] ?? "";
  const chip = `${RAIL_CHIP}${RAIL_NAME}${WORKSPACE_MARK} ${name}${gap}${RESET}`;
  const badge = digits.length > 0 ? `${COUNT_FG}${COUNT_BG}${digits}${RESET}` : "";
  const tail = rest.length > 0 ? `${RAIL_PANEL}${rest}${RESET}` : "";
  return chip + badge + tail;
}

/**
 * List mark plus the agent name, harness still on the right edge.
 * The mark is omitted when the rail is too narrow to keep that edge.
 */
function paintAgentRail(railText: string, indentedName: string, harness: string, tail: string): string {
  const name = indentedName.trim();
  const prefix = `  ${AGENT_MARK} ${name}`;
  const room = railText.length - tail.length;
  const hole = room - prefix.length - harness.length;
  const shown = hole >= 1 ? `${prefix}${" ".repeat(hole)}${harness}${tail}` : railText;
  const harnessAt = shown.length - tail.length - harness.length;
  const markAt = shown.indexOf(AGENT_MARK);
  if (hole < 1 || markAt < 0 || harnessAt < markAt) {
    const gap = " ".repeat(Math.max(0, railText.length - indentedName.length - harness.length - tail.length));
    const plain = `${RAIL_PANEL}${indentedName}${gap}${DIM}${harness}${RESET}`;
    return tail.length > 0 ? `${plain}${RAIL_PANEL}${tail}${RESET}` : plain;
  }
  const head = shown.slice(0, markAt);
  const mid = shown.slice(markAt + AGENT_MARK.length, harnessAt);
  const painted = `${RAIL_PANEL}${head}${DIM}${AGENT_MARK}${RESET}${RAIL_PANEL}${mid}${DIM}${harness}${RESET}`;
  return tail.length > 0 ? `${painted}${RAIL_PANEL}${tail}${RESET}` : painted;
}

/** Sidebar column. Harness names are dim; a human name stays bright. */
function paintQuietRail(railText: string): string {
  if (railText.trim().length === 0) return `${RAIL_PANEL}${railText}${RESET}`;
  const header = railText.trim();
  if (
    header === "workspaces"
    || header === "NAVIGATE"
    || (railText.startsWith("agents") && railText.trimEnd().endsWith("grouped"))
    || (railText.startsWith("new") && railText.trimEnd().endsWith("menu"))
  ) {
    return `${RAIL_PANEL}${DIM}${railText}${RESET}`;
  }
  const openWorkspace = railText.match(/^  (\S+)(\s*)$/);
  if (openWorkspace !== null) {
    const name = openWorkspace[1] ?? "";
    const rest = openWorkspace[2] ?? "";
    return `${RAIL_PANEL}${DIM}${AGENT_MARK}${RESET}${RAIL_PANEL} ${name}${rest}${RESET}`;
  }
  const agent = railText.match(/^(  \S.*?\S)( {2,})(\S+)(\s*)$/);
  if (agent !== null) {
    return paintAgentRail(railText, agent[1] ?? "", agent[3] ?? "", agent[4] ?? "");
  }
  if (/^\S+$/.test(header)) {
    const trimmed = railText.trimEnd();
    const pad = railText.slice(trimmed.length);
    const name = `${RAIL_PANEL}${RAIL_NAME}${trimmed}${RESET}`;
    return pad.length > 0 ? `${name}${RAIL_PANEL}${pad}${RESET}` : name;
  }
  return `${RAIL_PANEL}${railText}${RESET}`;
}

function paintDashboardLine(
  part: PaintedLine,
  onBar: boolean,
  rail: number,
  gutter: number,
  main: number,
  columns: number,
): string {
  if (part.footer) return `${DIM}${part.raw}${RESET}`;
  const pane = onBar
    ? paintRecordText(padPane(part.pane, part.railText, rail, gutter, main, columns), true)
    : paintPlainPane(part.pane);
  if (part.railText === null) return pane;
  const left = paintEmptyNavRail(part.railText)
    ?? (part.railText.startsWith("> ") ? paintWorkspaceRail(part.railText) : paintQuietRail(part.railText));
  const gap = " ".repeat(Math.max(1, gutter));
  return `${left}${RAIL_PANEL}${gap}${RESET}${pane}`;
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
const COMMAND_CHARS = new Set(["p", "j", "k", "r", "?", "q", "/", "n", "b", "h", "w"]);

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
    ...(options.awaitingWorkspace === true ? { awaitingWorkspace: true } : {}),
  });
  let closed = false;
  let finished = false;
  let screenOn = false;
  let rawEnabled = false;
  let suspended = false;
  let pumping = false;
  let pendingPump = false;
  let listening = false;
  let updating = false;
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

  const draw = (force = false): void => {
    if (closed || (updating && !force)) return;
    const size = viewportOf();
    const frame = paintSelection(renderDashboard(state, size.columns, size.rows), size.columns);
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

  const queueRailReads = (): void => {
    // Context omits participants, so the rail and overview work block ask for
    // the same reads the people and work sections use. The picker stays closed.
    if (options.loadPeople !== undefined && state.peoplePage === undefined && state.peoplePageRequest === undefined) {
      state = {
        ...state,
        peoplePageRequest: {
          generation: state.generation,
          pageNumber: 1,
          cursorStack: [],
          recoverOnRejectedCursor: false,
        },
      };
    }
    if (state.boundedReads && options.loadTasks !== undefined && state.taskPage === undefined && state.taskPageRequest === undefined) {
      state = {
        ...state,
        taskPageRequest: {
          generation: state.generation,
          pageNumber: 1,
          cursorStack: [],
          recoverOnRejectedCursor: false,
        },
      };
    }
    if (options.listWorkspaces !== undefined && state.workspaceChoices.length === 0 && state.workspaceListRequest === undefined && !state.workspaceListOpen) {
      state = { ...state, workspaceListRequest: { generation: state.generation } };
    }
  };

  const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  const isRejectedCursor = (error: unknown): boolean =>
    error instanceof CampfireError && error.code === "ValidationError";

  async function fulfillOne(): Promise<boolean> {
    if (closed) return false;
    if (state.workspaceSwitchId !== undefined) {
      const nextId = state.workspaceSwitchId;
      options.adoptWorkspace?.(nextId);
      state = fulfillWorkspaceSwitch(state, nextId);
      return true;
    }
    if (state.workspaceListRequest !== undefined) {
      // A picker request must ignore a stale result. A rail prefetch applies
      // while the picker is closed, and yields if a picker request starts.
      const forPicker = state.workspaceListOpen;
      state = { ...state, workspaceListRequest: undefined };
      if (options.listWorkspaces === undefined) {
        if (forPicker) state = unavailableWorkspaceList(state);
        return true;
      }
      try {
        const choices = await options.listWorkspaces();
        if (closed || state.workspaceSwitchId !== undefined) return true;
        const superseded = state.workspaceListRequest !== undefined;
        if (forPicker) {
          if (!state.workspaceListOpen || superseded) return true;
        } else if (superseded || state.workspaceListOpen) {
          return true;
        }
        state = applyWorkspaceChoices(state, choices);
      } catch (error) {
        if (closed || state.workspaceSwitchId !== undefined) return true;
        if (forPicker && state.workspaceListOpen && state.workspaceListRequest === undefined) {
          state = {
            ...unavailableWorkspaceList(state),
            statusNote: `The workspace list is unavailable. ${noteOf(errorText(error))}`,
          };
        }
      }
      return true;
    }
    const currentWorkspace = (): boolean => state.workspaceSwitchId === undefined;
    if (state.refreshRequested) {
      if (options.awaitingWorkspace === true || state.awaitingWorkspace === true) {
        state = { ...state, refreshRequested: false };
        return true;
      }
      const generation = state.generation;
      const requestedId = state.workspaceId;
      state = { ...state, refreshRequested: false };
      try {
        const loaded = await options.load();
        if (!closed && state.workspaceId === requestedId && currentWorkspace()) {
          state = applyContextLoad(state, loaded, now().toISOString(), generation);
          if (state.context?.workspace.id === requestedId && state.staleError === undefined) queueRailReads();
        }
      } catch (error) {
        if (!closed && state.workspaceId === requestedId && currentWorkspace()) {
          state = failContextLoad(state, generation, errorText(error));
        }
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
      const requestedId = state.workspaceId;
      try {
        const page = await options.loadTasks(taskReq.cursor);
        if (!closed && state.workspaceId === requestedId && state.workspaceSwitchId === undefined) {
          state = applyTaskPage(state, page, { ...taskReq, readAt: now().toISOString() });
        }
      } catch (error) {
        if (closed || state.workspaceId !== requestedId || state.workspaceSwitchId !== undefined) return true;
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
      const requestedId = state.workspaceId;
      try {
        const page = await options.loadPeople({ cursor: peopleReq.cursor, humanOwnerId: peopleReq.humanOwnerId });
        if (!closed && state.workspaceId === requestedId && state.workspaceSwitchId === undefined) {
          state = applyPeoplePage(state, page, { ...peopleReq, readAt: now().toISOString() });
        }
      } catch (error) {
        if (closed || state.workspaceId !== requestedId || state.workspaceSwitchId !== undefined) return true;
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
      const requestedId = state.workspaceId;
      try {
        const page = await options.loadHistory({ objectType, objectId, cursor: historyReq.cursor });
        if (!closed && state.workspaceId === requestedId && state.workspaceSwitchId === undefined) {
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
        if (closed || state.workspaceId !== requestedId || state.workspaceSwitchId !== undefined) return true;
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
      const requestedId = state.workspaceId;
      try {
        const record = await options.inspect(request.kind, request.id);
        if (closed || state.generation !== request.generation || state.workspaceId !== requestedId || state.workspaceSwitchId !== undefined) {
          return true;
        }
        const selected = shownRows(state)[state.row];
        if (selected?.id !== request.id) return true;
        state = { ...state, inspected: { method: inspectMethod(request.kind), sourceId: request.id, record } };
      } catch (error) {
        if (closed || state.generation !== request.generation || state.workspaceId !== requestedId || state.workspaceSwitchId !== undefined) {
          return true;
        }
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
    if (options.awaitingWorkspace === true) {
      if (!closed) draw();
      return;
    }
    const generation = state.generation;
    const requestedId = state.workspaceId;
    let loadedOk = false;
    try {
      const loaded = await options.load();
      if (closed || state.workspaceId !== requestedId || state.workspaceSwitchId !== undefined) return;
      state = applyContextLoad(state, loaded, now().toISOString(), generation);
      loadedOk = state.context?.workspace.id === requestedId && state.staleError === undefined;
    } catch (error) {
      if (closed || state.workspaceId !== requestedId || state.workspaceSwitchId !== undefined) return;
      state = failContextLoad(state, generation, errorText(error));
    }
    if (loadedOk && !closed && state.workspaceSwitchId === undefined) {
      queueRailReads();
      schedule();
    }
    if (!closed) draw();
  };

  const performUpdate = async (): Promise<void> => {
    leaveScreen();
    try {
      if (options.onUpdate !== undefined) await options.onUpdate();
    } catch {
      if (!closed && !finished && !state.quit) {
        state = { ...state, statusNote: "Update could not be completed." };
      }
    }
    if (!closed && !finished && !state.quit) {
      enterScreen();
      draw(true);
    }
    updating = false;
  };

  const onData = (chunk: Buffer | string): void => {
    if (closed || finished || updating) return;
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
    if (state.updateRequested) {
      state = { ...state, updateRequested: false };
      updating = true;
      void performUpdate();
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
    if (closed || suspended || updating || !terminalIsForeground()) return;
    state = requestDashboardRefresh(state);
    schedule();
  }, DASHBOARD_AUTO_REFRESH_MS);
  if (typeof timer.unref === "function") timer.unref();

  try {
    // Listen before the first write so `q` typed as the screen opens still quits.
    stdin.on("data", onData);
    stdout.on("resize", onResize);
    process.on("SIGINT", onSigint);
    process.on("SIGTSTP", onStop);
    process.on("SIGCONT", onCont);
    listening = true;
    enterScreen();
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
