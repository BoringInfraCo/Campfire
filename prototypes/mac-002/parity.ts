#!/usr/bin/env bun
/**
 * MAC-002 cross-surface parity harness (Gate S1 — semantic parity tooling).
 *
 * Proves that the desktop (GPUIX) client, the Viewer, and the CLI show the
 * same authorized data for the same actor and workspace. Three snapshots:
 *
 *   A "viewer-raw"  — direct POST /api/call reads of the same Viewer the
 *                     desktop/TUI surfaces read (read-only allowlist only).
 *   B "client"      — the GPUIX shell's own boundary class:
 *                     `new CampfireViewerClient(fetch).listWorkspaces()`
 *                     + `.getWorkspaceContext(workspaceId)`.
 *   C "cli"         — the Campfire CLI run with `--output json` for the same
 *                     workspace (whoami/list/context/tasks/findings/decisions/
 *                     artifacts/activity/changes + one bounded inspect).
 *
 * Snapshot C is spawned through `tsx src/cli/index.ts` in THIS repository; env
 * is passed through untouched, so the same profile decides local SQLite vs
 * hosted CAMPFIRE_URL identically to an operator CLI run.
 *
 * SAFETY / SCOPE
 * - READS ONLY. No `campfire` write command is invoked by this script.
 * - Never reads credential files and never sets CAMPFIRE_TOKEN (or any
 *   credential env var). The CLI child inherits the caller's environment.
 * - The Viewer leg must run only against the operator's started Viewer
 *   (`campfire up`); the script never starts or restarts Campfire services
 *   except `--selfcheck`, which serves canned envelopes from an ephemeral
 *   port-0 server and leaves the CLI leg in skip mode.
 * - Attention reasons are kept as the stable Sprint 008 RAW codes
 *   (src/service/service.ts lines 269-277) — never localized labels
 *   (labels live in src/presentation/work-console.ts lines 10-19).
 *
 * Run:  bun prototypes/mac-002/parity.ts [--selfcheck] [--json] [flags]
 */

// node: APIs only — bun runs them natively, and tsc checks them with
// @types/node (a devDependency of this repository).
import { execFile as execFileCb } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Paths (the desktop repo sits beside Campfire-Internal; three levels up).
// ---------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI_ENTRY = "src/cli/index.ts";
const TSX_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const DEFAULT_CLIENT_PATH = fileURLToPath(
  new URL("../../../campfire-desktop/apps/gpuix/src/campfire/step1/viewer-client.ts", import.meta.url),
);
const DEFAULT_VIEWER = "http://127.0.0.1:9415";
const ORIENTATION_PAGE_LIMIT_DEFAULT = 50;

// ---------------------------------------------------------------------------
// Small flags parser.
// ---------------------------------------------------------------------------

interface Flags {
  viewer: string;
  workspace?: string;
  outDir: string;
  limit: number;
  clientPath: string;
  selfcheck: boolean;
  json: boolean;
}

function parseFlags(argv: readonly string[]): Flags {
  const flags: Flags = {
    viewer: DEFAULT_VIEWER,
    outDir: fileURLToPath(new URL("./out", import.meta.url)),
    limit: ORIENTATION_PAGE_LIMIT_DEFAULT,
    clientPath: DEFAULT_CLIENT_PATH,
    selfcheck: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    const value = (): string => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`Missing value for ${token}`);
      }
      i += 1;
      return next;
    };
    switch (token) {
      case "--viewer":
        flags.viewer = value();
        break;
      case "--workspace":
        flags.workspace = value();
        break;
      case "--out":
        flags.outDir = value();
        break;
      case "--limit":
        flags.limit = Number(value());
        break;
      case "--client-path":
        flags.clientPath = value();
        break;
      case "--selfcheck":
        flags.selfcheck = true;
        break;
      case "--json":
        flags.json = true;
        break;
      default:
        throw new Error(`Unknown flag: ${token} (supported: --viewer --workspace --out --limit --client-path --selfcheck --json)`);
    }
  }
  if (!Number.isInteger(flags.limit) || flags.limit < 1) {
    throw new Error("--limit must be a positive integer");
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Tolerant JSON helpers (unknown in, cells out; no transient domain imports).
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

interface Slice {
  items: unknown[];
  total?: number;
  returned?: number;
  truncated?: boolean;
}

function sliceOf(container: unknown, key: string): Slice | undefined {
  const s = asRecord(asRecord(container)?.[key]);
  if (s === undefined) return undefined;
  const items = asArray(s.items) ?? [];
  return {
    items,
    total: num(s.total),
    returned: num(s.returned),
    truncated: typeof s.truncated === "boolean" ? s.truncated : undefined,
  };
}

function idsOf(items: readonly unknown[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    const id = str(asRecord(item)?.id);
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

function statusPairs(items: readonly unknown[], key: "status" | "currentness"): string[] {
  const pairs: string[] = [];
  for (const item of items) {
    const record = asRecord(item);
    const id = str(record?.id);
    const value = record === undefined ? undefined : record[key];
    if (id !== undefined && str(value) !== undefined) {
      pairs.push(`${id}=${value as string}`);
    } else if (id !== undefined) {
      pairs.push(`${id}=${key === "currentness" ? "absent" : "absent"}`);
    }
  }
  return pairs;
}

function stable(value: unknown): string {
  return JSON.stringify(value);
}

// Attention items are compared as ordered tuples. RAW reason codes only.
function attentionTuples(items: readonly unknown[]): string[] {
  const rows: string[] = [];
  for (const item of items) {
    const record = asRecord(item);
    if (record === undefined) continue;
    const id = str(record.id) ?? "-";
    const kind = str(record.kind) ?? "-";
    const status = str(record.status) ?? "-";
    const reason = str(record.reason) ?? "-";
    const summary = str(record.summary) ?? "-";
    const assignee = asRecord(record.assignee);
    const assigneeId = str(assignee?.actorId) ?? "-";
    rows.push(`${kind}|${id}|${status}|${reason}|${assigneeId}|${summary}`);
  }
  return rows;
}

function attentionReasonsSorted(items: readonly unknown[]): string[] {
  const reasons = new Set<string>();
  for (const item of items) {
    const reason = str(asRecord(item)?.reason);
    if (reason !== undefined) reasons.add(reason);
  }
  return [...reasons].sort();
}

// ---------------------------------------------------------------------------
// The cell model. Every snapshot is reduced to the SAME flat cell map; absent
// cells are simply omitted, and the diff reports them as SKIP with a reason.
// ---------------------------------------------------------------------------

type Cells = Record<string, unknown>;

function setGoal(cells: Cells, context: Record<string, unknown>): void {
  const workspace = asRecord(context.workspace) ?? {};
  const assign = (key: string, value: unknown): void => {
    if (value !== undefined) cells[key] = value;
  };
  assign("workspace.id", str(workspace.id));
  assign("workspace.name", str(workspace.name));
  assign("workspace.status", str(workspace.status));
  const goal = asRecord(context.goal);
  if (goal !== undefined) {
    assign("workspace.goalTitle", str(goal.title));
    assign("workspace.goalId", str(goal.id));
    assign("workspace.goalStatus", str(goal.status));
  }
}

function setTasksSlice(cells: Cells, context: Record<string, unknown>): void {
  const tasks = sliceOf(context.slices, "tasks");
  if (tasks === undefined) return;
  cells["tasks.slice.ids"] = idsOf(tasks.items);
  cells["tasks.slice.statusById"] = statusPairs(tasks.items, "status");
  if (tasks.total !== undefined) cells["tasks.slice.total"] = tasks.total;
  if (tasks.returned !== undefined) cells["tasks.slice.returned"] = tasks.returned;
  if (tasks.truncated !== undefined) cells["tasks.slice.truncated"] = tasks.truncated;
}

function setFindingsSlice(cells: Cells, context: Record<string, unknown>): void {
  const findings = sliceOf(context.slices, "findings");
  if (findings === undefined) return;
  cells["findings.slice.ids"] = idsOf(findings.items);
  cells["findings.slice.currentnessById"] = statusPairs(findings.items, "currentness");
  if (findings.total !== undefined) cells["findings.slice.total"] = findings.total;
  if (findings.returned !== undefined) cells["findings.slice.returned"] = findings.returned;
  if (findings.truncated !== undefined) cells["findings.slice.truncated"] = findings.truncated;
}

function setArtifactsSlice(cells: Cells, context: Record<string, unknown>): void {
  const artifacts = sliceOf(context.slices, "artifacts");
  if (artifacts === undefined) return;
  cells["artifacts.slice.ids"] = idsOf(artifacts.items);
  if (artifacts.total !== undefined) cells["artifacts.slice.total"] = artifacts.total;
  if (artifacts.returned !== undefined) cells["artifacts.slice.returned"] = artifacts.returned;
  if (artifacts.truncated !== undefined) cells["artifacts.slice.truncated"] = artifacts.truncated;
}

/**
 * Decision cells are built from the legacy interface arrays
 * (proposedDecisions/acceptedDecisions/supersededDecisions), which exist on the
 * raw service read (A), the narrowed desktop client result (B: a superseded
 * summary keeps only the status the service recorded, which may be absent),
 * and the full CLI context (C).
 * Ordering: proposed, accepted, then superseded.
 */
function setDecisionsFromContext(cells: Cells, context: Record<string, unknown>): void {
  const slice = sliceOf(context.slices, "decisions");
  const proposed = asArray(context.proposedDecisions) ?? [];
  const accepted = asArray(context.acceptedDecisions) ?? [];
  const superseded = asArray(context.supersededDecisions) ?? [];
  const everything = [...proposed, ...accepted, ...superseded];
  if (slice === undefined && everything.length === 0) return;
  cells["decisions.slice.ids"] = idsOf(everything);
  cells["decisions.slice.statusById"] = statusPairs(everything, "status");
  cells["decisions.slice.proposedCount"] = proposed.length;
  cells["decisions.slice.acceptedCount"] = accepted.length;
  cells["decisions.slice.supersededCount"] = superseded.length;
  const needsReview = everything
    .filter((item) => asRecord(item)?.needsReview === true)
    .map((item) => str(asRecord(item)?.id) ?? "")
    .filter((id) => id.length > 0);
  cells["decisions.slice.needsReviewIds"] = needsReview;
  if (slice !== undefined) {
    if (slice.total !== undefined) cells["decisions.slice.total"] = slice.total;
    if (slice.returned !== undefined) cells["decisions.slice.returned"] = slice.returned;
    if (slice.truncated !== undefined) cells["decisions.slice.truncated"] = slice.truncated;
  }
}

function setAttention(cells: Cells, context: Record<string, unknown>): void {
  const needsYou = asArray(context.needsYou) ?? [];
  const needsAttention = asArray(context.needsAttention) ?? [];
  if (context.needsYou !== undefined) cells["attention.needsYou"] = attentionTuples(needsYou);
  if (context.needsAttention !== undefined) cells["attention.needsAttention"] = attentionTuples(needsAttention);
  const coverage = asRecord(context.attentionCoverage);
  if (coverage !== undefined) {
    const tasks = asRecord(coverage.tasks);
    const decisions = asRecord(coverage.decisions);
    if (tasks !== undefined) cells["attention.coverageTasks"] = { returned: tasks.returned ?? null, total: tasks.total ?? null };
    if (decisions !== undefined) cells["attention.coverageDecisions"] = { returned: decisions.returned ?? null, total: decisions.total ?? null };
    if (typeof coverage.completeUnderRules === "boolean") {
      cells["attention.coverageComplete"] = coverage.completeUnderRules;
    }
  }
  // Raw Sprint 008 reason codes as a set, per ATT-001's stable vocabulary.
  if (context.needsYou !== undefined || context.needsAttention !== undefined) {
    cells["attention.reasonCodes"] = attentionReasonsSorted([...needsYou, ...needsAttention]);
  }
}

function setAlignment(cells: Cells, context: Record<string, unknown>): void {
  const alignment = asRecord(context.alignment);
  if (alignment === undefined) return;
  const status = str(alignment.status);
  if (status !== undefined) cells["alignment.status"] = status;
  const ids = (key: string, cellKey: string): void => {
    const value = asArray(alignment[key]);
    if (value !== undefined) cells[cellKey] = value.filter((id) => str(id) !== undefined).map((id) => id as string);
  };
  ids("proposedDecisionIds", "alignment.proposedDecisionIds");
  ids("acceptedDecisionIds", "alignment.acceptedDecisionIds");
  ids("unresolvedBlockedTaskIds", "alignment.unresolvedBlockedTaskIds");
}

function setSuggestedNextAction(cells: Cells, context: Record<string, unknown>): void {
  const suggested = asRecord(context.suggestedNextAction);
  if (suggested === undefined) return;
  const summary = str(suggested.summary);
  if (summary !== undefined) cells["suggestedNext.summary"] = summary;
  const kind = str(suggested.kind);
  if (kind !== undefined) cells["suggestedNext.kind"] = kind;
  const reason = str(suggested.reason);
  if (reason !== undefined) cells["suggestedNext.reason"] = reason;
}

/**
 * Provenance window cells (the contribution-ordering family). A read of
 * `get_workspace_context` returns `provenance` capped at
 * ORIENTATION_PROVENANCE_LIMIT with total/truncated; the client mirrors these.
 */
function setProvenance(cells: Cells, context: Record<string, unknown>): void {
  const provenance = asArray(context.provenance) ?? [];
  if (context.provenance !== undefined) cells["provenance.slice.ids"] = idsOf(provenance);
  if (num(context.provenanceTotal) !== undefined) cells["provenance.slice.total"] = num(context.provenanceTotal);
  if (typeof context.provenanceTruncated === "boolean") {
    cells["provenance.slice.truncated"] = context.provenanceTruncated;
  }
}

function setWorkspaceList(cells: Cells, list: unknown[], workspaceId: string): void {
  cells["list.workspaceIds"] = list
    .map((entry) => str(asRecord(entry)?.id))
    .filter((id): id is string => id !== undefined);
  const selected = list.find((entry) => str(asRecord(entry)?.id) === workspaceId);
  const openTaskCount = num(asRecord(selected)?.openTaskCount);
  if (openTaskCount !== undefined) cells["workspace.openTaskCount"] = openTaskCount;
}

function setWhoami(cells: Cells, whoami: unknown): void {
  const actor = asRecord(asRecord(whoami)?.actor);
  if (actor === undefined) return;
  if (str(actor.actorId) !== undefined) cells["whoami.actorId"] = str(actor.actorId);
  if (str(actor.actorType) !== undefined) cells["whoami.actorType"] = str(actor.actorType);
}

/** A read of `list_tasks`, already returned by the Viewer allowlist, is the
 * strong same-method task page; the CLI `campfire tasks` command opens the
 * identical read. */
function setTaskPage(cells: Cells, page: unknown): void {
  const record = asRecord(page);
  if (record === undefined) return;
  const items = asArray(record.items) ?? [];
  cells["tasks.page.ids"] = idsOf(items);
  cells["tasks.page.statusById"] = statusPairs(items, "status");
  if (num(record.total) !== undefined) cells["tasks.page.total"] = num(record.total);
  if (num(record.returned) !== undefined) cells["tasks.page.returned"] = num(record.returned);
  if (typeof record.truncated === "boolean") cells["tasks.page.truncated"] = record.truncated;
  cells["tasks.page.nextCursor"] = str(record.nextCursor) ?? "absent";
}

/** A read of `get_activity` == CLI `campfire activity <ws> --limit <n>`. */
function setActivityPage(cells: Cells, page: unknown): void {
  const record = asRecord(page);
  if (record === undefined) return;
  const items = asArray(record.items) ?? [];
  cells["activity.page.ids"] = idsOf(items);
  if (num(record.total) !== undefined) cells["activity.page.total"] = num(record.total);
  if (typeof record.truncated === "boolean") cells["activity.page.truncated"] = record.truncated;
  cells["activity.page.nextBefore"] = str(record.nextBefore) ?? "absent";
}

/** A read of `list_workspace_participants` == the CLI `campfire context`
 * roster (context carries the full participant array when the roster is not
 * omitted). Identity, role, name, and recorded human owner are the facts.
 * Order is not: the page is cursor order (actor type, actor id) and the
 * context array is join order. */
function setParticipantsFromPage(cells: Cells, page: unknown): void {
  const record = asRecord(page);
  if (record === undefined) return;
  const items = asArray(record.items) ?? [];
  cells["participants.roster"] = rosterTuples(items);
  if (num(record.total) !== undefined) cells["participants.rosterTotal"] = num(record.total);
  if (num(record.returned) !== undefined) cells["participants.rosterReturned"] = num(record.returned);
}

function rosterTuples(items: readonly unknown[]): string[] {
  const rows: string[] = [];
  for (const item of items) {
    const record = asRecord(item);
    const actor = asRecord(record?.actor);
    const actorId = str(actor?.actorId);
    const role = str(record?.role);
    const name = asRecord(record)?.name;
    if (actorId === undefined || role === undefined) continue;
    const owner = str(record?.humanOwnerId) ?? "-";
    rows.push(`${actorId}|${role}|${typeof name === "string" && name.length > 0 ? name : "-"}|${owner}`);
  }
  rows.sort();
  return rows;
}

// Snapshot A — built from raw Viewer envelopes (unchanged, un-narrowed).
// The context read is issued exactly as the desktop/TUI send it:
// { workspaceId, participants: "omit" }.
function buildViewerCells(input: {
  list: unknown;
  whoami: unknown;
  context: unknown;
  tasksPage: unknown;
  participantsPage: unknown;
  activityPage: unknown;
  workspaceId: string;
}): Cells {
  const cells: Cells = {};
  const rawList = asArray(input.list);
  if (rawList !== undefined) setWorkspaceList(cells, rawList, input.workspaceId);
  setWhoami(cells, input.whoami);
  const context = asRecord(input.context);
  if (context !== undefined) {
    setGoal(cells, context);
    setTasksSlice(cells, context);
    setFindingsSlice(cells, context);
    setArtifactsSlice(cells, context);
    setDecisionsFromContext(cells, context);
    setAttention(cells, context);
    setAlignment(cells, context);
    setSuggestedNextAction(cells, context);
    setProvenance(cells, context);
    const omitted = asRecord(context.participantsCoverage);
    if (omitted !== undefined && omitted.omitted === true && num(omitted.total) !== undefined) {
      cells["participants.omittedTotal"] = num(omitted.total);
    }
  }
  if (input.tasksPage !== undefined) setTaskPage(cells, input.tasksPage);
  if (input.participantsPage !== undefined) setParticipantsFromPage(cells, input.participantsPage);
  if (input.activityPage !== undefined) setActivityPage(cells, input.activityPage);
  return cells;
}

/** Snapshot B — from the desktop client's own narrowed public results only:
 * `listWorkspaces()` and `getWorkspaceContext(workspaceId)`. Anything the
 * client does not expose is simply an absent cell (SKIP in the diff). */
function buildClientCells(input: { list: unknown; context: unknown; workspaceId: string }): Cells {
  const cells: Cells = {};
  const rawList = asArray(input.list);
  if (rawList !== undefined) setWorkspaceList(cells, rawList, input.workspaceId);
  const context = asRecord(input.context);
  if (context !== undefined) {
    setGoal(cells, context);
    setTasksSlice(cells, context);
    setFindingsSlice(cells, context);
    setArtifactsSlice(cells, context);
    setDecisionsFromContext(cells, context);
    setAttention(cells, context);
    setAlignment(cells, context);
    setSuggestedNextAction(cells, context);
    setProvenance(cells, context);
    if (num(context.participantsOmittedTotal) !== undefined) {
      cells["participants.omittedTotal"] = num(context.participantsOmittedTotal);
    }
  }
  return cells;
}

// Snapshot C — reduced from CLI JSON outputs (raw pages and CLI projections),
// all for the same --workspace id. `context` is the same get_workspace_context
// read the Viewer mediates; it carries the participant roster because the CLI
// does not send participants:"omit".
function buildCliCells(input: {
  whoami?: unknown;
  list?: unknown;
  context?: unknown;
  tasksPage?: unknown;
  findingsPage?: unknown;
  decisionsProjection?: unknown;
  artifactsPage?: unknown;
  activityPage?: unknown;
  changesProjection?: unknown;
  inspect?: unknown;
  workspaceId: string;
}): Cells {
  const cells: Cells = {};
  if (input.whoami !== undefined) setWhoami(cells, input.whoami);
  if (input.list !== undefined) {
    const rawList = asArray(input.list);
    if (rawList !== undefined) setWorkspaceList(cells, rawList, input.workspaceId);
  }
  const context = asRecord(input.context);
  if (context !== undefined) {
    setGoal(cells, context);
    setTasksSlice(cells, context);
    setFindingsSlice(cells, context);
    setArtifactsSlice(cells, context);
    setDecisionsFromContext(cells, context);
    setAttention(cells, context);
    setAlignment(cells, context);
    setSuggestedNextAction(cells, context);
    setProvenance(cells, context);
    const roster = asArray(context.participants);
    if (roster !== undefined) {
      cells["participants.roster"] = rosterTuples(roster);
      cells["participants.rosterTotal"] = roster.length;
    }
  }
  if (input.tasksPage !== undefined) setTaskPage(cells, input.tasksPage);
  if (input.findingsPage !== undefined) {
    const page = asRecord(input.findingsPage);
    if (page !== undefined) {
      const items = asArray(page.items) ?? [];
      cells["findings.page.ids"] = idsOf(items);
      cells["findings.page.currentnessById"] = statusPairs(items, "currentness");
      if (num(page.total) !== undefined) cells["findings.page.total"] = num(page.total);
      if (num(page.returned) !== undefined) cells["findings.page.returned"] = num(page.returned);
      if (typeof page.truncated === "boolean") cells["findings.page.truncated"] = page.truncated;
      cells["findings.page.nextCursor"] = str(page.nextCursor) ?? "absent";
    }
  }
  if (input.decisionsProjection !== undefined) {
    const projection = asRecord(input.decisionsProjection);
    if (projection !== undefined) {
      const proposed = asArray(projection.proposed) ?? [];
      const accepted = asArray(projection.accepted) ?? [];
      const superseded = asArray(projection.superseded) ?? [];
      const everything = [...proposed, ...accepted, ...superseded];
      cells["decisions.page.ids"] = idsOf(everything);
      cells["decisions.page.statusById"] = statusPairs(everything, "status");
      cells["decisions.page.proposedCount"] = proposed.length;
      cells["decisions.page.acceptedCount"] = accepted.length;
      cells["decisions.page.supersededCount"] = superseded.length;
      cells["decisions.page.needsReviewIds"] = everything
        .filter((item) => asRecord(item)?.needsReview === true)
        .map((item) => str(asRecord(item)?.id) ?? "")
        .filter((id) => id.length > 0);
      if (num(projection.total) !== undefined) cells["decisions.page.total"] = num(projection.total);
      if (num(projection.returned) !== undefined) cells["decisions.page.returned"] = num(projection.returned);
      if (typeof projection.truncated === "boolean") cells["decisions.page.truncated"] = projection.truncated;
      cells["decisions.page.nextCursor"] = str(projection.nextCursor) ?? "absent";
    }
  }
  if (input.artifactsPage !== undefined) {
    const page = asRecord(input.artifactsPage);
    if (page !== undefined) {
      const items = asArray(page.items) ?? [];
      cells["artifacts.page.ids"] = idsOf(items);
      if (num(page.total) !== undefined) cells["artifacts.page.total"] = num(page.total);
      if (num(page.returned) !== undefined) cells["artifacts.page.returned"] = num(page.returned);
      if (typeof page.truncated === "boolean") cells["artifacts.page.truncated"] = page.truncated;
      cells["artifacts.page.nextCursor"] = str(page.nextCursor) ?? "absent";
    }
  }
  if (input.activityPage !== undefined) setActivityPage(cells, input.activityPage);
  if (input.changesProjection !== undefined) {
    const changes = asRecord(input.changesProjection);
    if (changes !== undefined) {
      // Same underlying provenance window as the context read; the cursor cell
      // is informational and only the CLI exposes the projection shape.
      cells["changes.toCursor"] = str(changes.toCursor) ?? "absent";
      if (typeof changes.truncated === "boolean") cells["changes.truncated"] = changes.truncated;
    }
  }
  if (input.inspect !== undefined) {
    const record = asRecord(input.inspect);
    const object = asRecord(record?.object);
    if (record !== undefined && object !== undefined) {
      if (str(object.id) !== undefined) cells["inspect.task.id"] = str(object.id);
      if (str(object.status) !== undefined) cells["inspect.task.status"] = str(object.status);
    }
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Diff engine.
// ---------------------------------------------------------------------------

interface CellVerdict {
  cell: string;
  verdict: "PASS" | "DIFF" | "SKIP";
  reason?: string;
  left?: unknown;
  right?: unknown;
}

type Surface = "viewer-raw" | "desktop-client" | "cli";

function diffPair(
  cellsA: Cells,
  cellsB: Cells,
  surfaceBName: Surface,
): { verdicts: CellVerdict[]; compared: number; diffs: number } {
  const keys = new Set<string>([...Object.keys(cellsA), ...Object.keys(cellsB)]);
  const verdicts: CellVerdict[] = [];
  let compared = 0;
  let diffs = 0;
  for (const key of [...keys].sort()) {
    const inA = key in cellsA;
    const inB = key in cellsB;
    if (!inA || !inB) {
      const missingIn = inA ? surfaceBName : "viewer-raw";
      const keyOwnedBy = inA ? "viewer-raw" : surfaceBName;
      verdicts.push({
        cell: key,
        verdict: "SKIP",
        reason: `${missingIn} does not return this cell; the cell comes from the ${keyOwnedBy} surface output shape`,
      });
      continue;
    }
    compared += 1;
    if (stable(cellsA[key]) === stable(cellsB[key])) {
      verdicts.push({ cell: key, verdict: "PASS" });
    } else {
      diffs += 1;
      verdicts.push({ cell: key, verdict: "DIFF", left: cellsA[key], right: cellsB[key] });
    }
  }
  return { verdicts, compared, diffs };
}

// ---------------------------------------------------------------------------
// Snapshot A — raw Viewer reads (the same endpoints the desktop/TUI use).
// ---------------------------------------------------------------------------

interface ViewerCallFailure extends Error {
  status?: number;
}

async function viewerCall(apiUrl: string, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, params }),
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    throw new Error(
      `Viewer unreachable at ${apiUrl} (${error instanceof Error ? error.message : String(error)}). Run campfire up, then refresh.`,
    ) as ViewerCallFailure;
  }
  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch {
    throw new Error(`Viewer ${apiUrl} returned a non-JSON body (status ${response.status}).`) as ViewerCallFailure;
  }
  const record = asRecord(envelope);
  if (!response.ok || record?.ok !== true) {
    const message = str(record?.message) ?? `Viewer call ${method} failed with HTTP ${response.status}`;
    const failure = new Error(`${message} (method=${method}, status=${response.status})`) as ViewerCallFailure;
    failure.status = response.status;
    throw failure;
  }
  return record.result;
}

function viewerApiUrl(viewerUrl: string): string {
  const base = viewerUrl.replace(/\/+$/, "");
  return `${base}/api/call`;
}

// ---------------------------------------------------------------------------
// Snapshot B — the desktop client's own boundary class.
// ---------------------------------------------------------------------------

interface ViewerFetchLike {
  (input: string, init?: RequestInit): Promise<Response>;
}

async function loadClientModule(clientPath: string): Promise<{
  construct: (fetch?: ViewerFetchLike) => {
    listWorkspaces(): Promise<unknown>;
    getWorkspaceContext(workspaceId: string): Promise<unknown>;
  };
  viewerEndpoint?: string;
}> {
  let mod: unknown;
  try {
    mod = await import(pathToFileURL(clientPath).href);
  } catch (error) {
    throw new Error(
      `Cannot import the desktop client at ${clientPath}: ${error instanceof Error ? error.message : String(error)}. ` +
        "Remediation: run from the repository root (bun prototypes/mac-002/parity.ts) or pass " +
        `--client-path <abs path to campfire-desktop/apps/gpuix/src/campfire/step1/viewer-client.ts>.`,
    );
  }
  const record = asRecord(mod);
  const Ctor = record?.CampfireViewerClient;
  if (typeof Ctor !== "function") {
    throw new Error(
      `The imported module at ${clientPath} does not export CampfireViewerClient. ` +
        "The parity harness depends only on the stable client surface: CampfireViewerClient, " +
        "viewerEndpoint, listWorkspaces(), getWorkspaceContext(). If the desktop shell is being " +
        "rewritten right now, re-run after it lands or pass --client-path to an older checkout.",
    );
  }
  const ViewerClient = Ctor as new (fetch?: ViewerFetchLike) => {
    listWorkspaces(): Promise<unknown>;
    getWorkspaceContext(workspaceId: string): Promise<unknown>;
  };
  const viewerEndpoint = typeof record?.viewerEndpoint === "string" ? record.viewerEndpoint : undefined;
  return { construct: (fetch?: ViewerFetchLike) => new ViewerClient(fetch), viewerEndpoint };
}

/** The client posts to its fixed viewerEndpoint constant; a small fetch
 * wrapper keeps --viewer/--selfcheck working without importing transient
 * types. Both the client's own constant and the built-in default are matched
 * so endpoint drift degrades loudly rather than silently hitting port 9415. */
function makeClientFetch(viewerEndpoint: string | undefined, target: string): ViewerFetchLike {
  const targetUrl = new URL(target);
  targetUrl.pathname = "/api/call";
  const rewritten = targetUrl.href;
  return (input: string, init?: RequestInit): Promise<Response> => {
    const forwarded = input === viewerEndpoint || input === "http://127.0.0.1:9415/api/call" ? rewritten : input;
    return globalThis.fetch(forwarded, init);
  };
}

// ---------------------------------------------------------------------------
// Snapshot C — the CLI. Exact commands verified against src/cli/catalog.ts and
// src/cli/index.ts: whoami (JSON-only), list (JSON-only), context, tasks,
// findings, decisions, artifacts, activity, changes, inspect.
// ---------------------------------------------------------------------------

interface CliRun {
  ok: boolean;
  stdout: string;
  exitCode?: number;
  error?: string;
}

async function runCliCommand(args: readonly string[]): Promise<CliRun> {
  const env = { ...process.env };
  const useLocalTsx = existsSync(TSX_BIN);
  const command = useLocalTsx ? TSX_BIN : "npx";
  const argv = useLocalTsx ? [CLI_ENTRY, ...args] : ["tsx", CLI_ENTRY, ...args];
  try {
    const { stdout } = await execFile(command, argv, {
      cwd: REPO_ROOT,
      env,
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, stdout };
  } catch (error) {
    const err = error as { code?: number; message?: string; killed?: boolean };
    return { ok: false, stdout: "", exitCode: err.code, error: err.message };
  }
}

function parseCliJson(run: CliRun): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!run.ok) {
    return { ok: false, error: `CLI command failed (exit ${run.exitCode ?? "signal"}): ${(run.error ?? "").slice(0, 500)}` };
  }
  try {
    return { ok: true, value: JSON.parse(run.stdout.trim()) as unknown };
  } catch (error) {
    return { ok: false, error: `CLI stdout was not a single JSON value: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ---------------------------------------------------------------------------
// Runner.
// ---------------------------------------------------------------------------

interface SnapshotMeta {
  surface: Surface;
  viewerUrl?: string;
  cliProfileBooleans?: { campfireUrlInEnv: boolean; campfireTokenInEnv: boolean; campfireActorIdInEnv: boolean };
  cliError?: string;
  legError?: string;
}

interface Snapshot {
  meta: SnapshotMeta;
  cells: Cells;
}

interface RunResult {
  startedAt: string;
  finishedAt: string;
  selfcheck: boolean;
  viewer: string;
  workspaceId: string | null;
  pageLimit: number;
  artifacts: { snapshotPath: string | null };
  ab: { verdicts: CellVerdict[]; compared: number; diffs: number };
  ac: { verdicts: CellVerdict[]; compared: number; diffs: number; skips: number };
  exit: 0 | 1;
  notes: string[];
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sanitizeWorkspaceId(id: string): string {
  return id.replace(/[^A-Za-z0-9_.-]/g, "_");
}

function truthyEnv(name: string): boolean {
  return typeof process.env[name] === "string" && (process.env[name] ?? "").trim().length > 0;
}

async function runParity(options: Flags & { skipCliLeg: boolean }): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const notes: string[] = [];
  const apiUrl = viewerApiUrl(options.viewer);

  // --- Snapshot A -----------------------------------------------------------
  const list = await viewerCall(apiUrl, "list_workspaces", {});
  const rawList = asArray(list) ?? [];
  const firstWorkspaceId = str(asRecord(rawList[0])?.id);
  const workspaceId = options.workspace ?? firstWorkspaceId;
  if (workspaceId === undefined) {
    notes.push("viewer-raw: list_workspaces returned no workspaces and no --workspace id was given");
  }

  let cellsA: Cells = {};
  let legErrorA: string | undefined;
  if (workspaceId !== undefined) {
    const readSettled = async (promise: Promise<unknown>): Promise<{ value?: unknown; error?: string }> => {
      try {
        return { value: await promise };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    };
    const [whoami, context, tasksPage, participantsPage, activityPage] = await Promise.all([
      readSettled(viewerCall(apiUrl, "whoami", {})),
      readSettled(viewerCall(apiUrl, "get_workspace_context", { workspaceId, participants: "omit" })),
      readSettled(viewerCall(apiUrl, "list_tasks", { workspaceId, limit: options.limit })),
      readSettled(viewerCall(apiUrl, "list_workspace_participants", { workspaceId, limit: options.limit })),
      readSettled(viewerCall(apiUrl, "get_activity", { workspaceId, limit: options.limit })),
    ]);
    const failures = [whoami.error, context.error, tasksPage.error, participantsPage.error, activityPage.error]
      .filter((entry): entry is string => entry !== undefined);
    legErrorA = failures.length > 0 ? `viewer-raw: ${failures.join("; ")}` : undefined;
    cellsA = buildViewerCells({
      list,
      whoami: whoami.value,
      context: context.value,
      tasksPage: tasksPage.value,
      participantsPage: participantsPage.value,
      activityPage: activityPage.value,
      workspaceId,
    });
  }

  // --- Snapshot B -----------------------------------------------------------
  let cellsB: Cells = {};
  let legErrorB: string | undefined;
  try {
    const client = await loadClientModule(options.clientPath);
    const fetchImpl = makeClientFetch(client.viewerEndpoint, options.viewer);
    const shell = client.construct(fetchImpl);
    const [listB, contextB] = await Promise.allSettled([
      shell.listWorkspaces(),
      workspaceId === undefined ? Promise.reject(new Error("no workspace selected")) : shell.getWorkspaceContext(workspaceId),
    ]);
    if (listB.status === "rejected") {
      legErrorB = `desktop-client: listWorkspaces() failed: ${String(listB.reason)}`;
    }
    if (contextB.status === "rejected") {
      legErrorB = `${legErrorB === undefined ? "" : `${legErrorB}; `}desktop-client: getWorkspaceContext() failed: ${String(contextB.reason)}`;
    }
    cellsB = buildClientCells({
      list: listB.status === "fulfilled" ? listB.value : undefined,
      context: contextB.status === "fulfilled" ? contextB.value : undefined,
      workspaceId: workspaceId ?? "",
    });
  } catch (error) {
    legErrorB = `desktop-client: ${error instanceof Error ? error.message : String(error)}`;
  }

  // --- Snapshot C -----------------------------------------------------------
  let cellsC: Cells = {};
  let legErrorC: string | undefined;
  if (options.skipCliLeg) {
    legErrorC = "selfcheck: CLI leg disabled (offline canned Viewer)";
  } else if (workspaceId !== undefined) {
    const ws = ["--workspace", workspaceId];
    const out = ["--output", "json"];
    const limit = ["--limit", String(options.limit)];
    const commands: Array<{ key: string; args: string[] }> = [
      { key: "whoami", args: ["whoami"] },
      { key: "list", args: ["list"] },
      { key: "context", args: ["context", ...ws, ...out] },
      { key: "tasks", args: ["tasks", ...ws, ...limit, ...out] },
      { key: "findings", args: ["findings", ...ws, ...limit, ...out] },
      { key: "decisions", args: ["decisions", ...ws, ...limit, ...out] },
      { key: "artifacts", args: ["artifacts", ...ws, ...limit, ...out] },
      { key: "activity", args: ["activity", ...ws, ...limit, ...out] },
      { key: "changes", args: ["changes", ...ws, ...out] },
    ];
    const results = new Map<string, unknown>();
    const commandErrors: string[] = [];
    for (const { key, args } of commands) {
      const run = await runCliCommand(args);
      const parsed = parseCliJson(run);
      if (parsed.ok) {
        results.set(key, parsed.value);
      } else {
        commandErrors.push(`${key}: ${parsed.error}`);
      }
    }
    // inspect uses one real id from the tasks page (bounded per-record probe).
    const tasksPage = results.get("tasks");
    const taskItems = asArray(asRecord(tasksPage)?.items) ?? [];
    const firstTaskId = str(asRecord(taskItems[0])?.id);
    if (firstTaskId !== undefined) {
      const run = await runCliCommand(["inspect", "task", firstTaskId, ...ws, ...out]);
      const parsed = parseCliJson(run);
      if (parsed.ok) {
        results.set("inspectTask", parsed.value);
      } else {
        commandErrors.push(`inspect: ${parsed.error}`);
      }
    }
    legErrorC = commandErrors.length > 0 ? `cli: ${commandErrors.join("; ")}` : undefined;
    cellsC = buildCliCells({
      whoami: results.get("whoami"),
      list: results.get("list"),
      context: results.get("context"),
      tasksPage: results.get("tasks"),
      findingsPage: results.get("findings"),
      decisionsProjection: results.get("decisions"),
      artifactsPage: results.get("artifacts"),
      activityPage: results.get("activity"),
      changesProjection: results.get("changes"),
      inspect: results.get("inspectTask"),
      workspaceId,
    });
  } else {
    legErrorC = "cli: no workspace selected";
  }

  // --- Diff + verdict -------------------------------------------------------
  const ab = diffPair(cellsA, cellsB, "desktop-client");
  const ac = diffPair(cellsA, cellsC, "cli");
  const acSkips = ac.verdicts.filter((verdict) => verdict.verdict === "SKIP").length;

  const bIntact = "workspace.id" in cellsB;
  const aIntact = "workspace.id" in cellsA;
  const cliFailed = legErrorC !== undefined && !options.skipCliLeg;
  const readFailed = legErrorA !== undefined || legErrorB !== undefined;
  const exit: 0 | 1 =
    ab.diffs === 0 &&
    ac.diffs === 0 &&
    aIntact &&
    bIntact &&
    ab.compared > 0 &&
    !cliFailed &&
    !readFailed
      ? 0
      : 1;

  const finishedAt = new Date().toISOString();
  const workspaceIdOut = workspaceId ?? "unknown";
  const outDir = options.outDir;
  mkdirSync(outDir, { recursive: true });
  const artifactPath = join(
    outDir,
    `parity-snapshot-${options.selfcheck ? "selfcheck-" : ""}${sanitizeWorkspaceId(workspaceIdOut)}-${timestampSlug()}.json`,
  );
  const artifact = {
    run: {
      tool: "prototypes/mac-002/parity.ts",
      purpose: "Gate S1 semantic parity (docs/Campfire-Multi-Surface-Strategy.md, Evidence gates) — read-only evidence",
      startedAt,
      finishedAt,
      selfcheck: options.selfcheck,
      viewer: options.viewer,
      workspaceId,
      pageLimit: options.limit,
      cliSurface: { repositoryRoot: REPO_ROOT, entry: CLI_ENTRY, outputMode: "--output json", identity: "env passthrough (default hum_sergio/human when no env identity is set)" },
      safety: {
        readsOnly: true,
        credentialEnvSet: false,
        envBooleans: { campfireUrlInEnv: truthyEnv("CAMPFIRE_URL"), campfireTokenInEnv: truthyEnv("CAMPFIRE_TOKEN"), campfireActorIdInEnv: truthyEnv("CAMPFIRE_ACTOR_ID") },
      },
    },
    legErrors: { viewerRaw: legErrorA, desktopClient: legErrorB, cli: legErrorC },
    snapshots: { "viewer-raw": cellsA, "desktop-client": cellsB, cli: cellsC },
    verdicts: { ab, ac },
    summary: {
      abCompared: ab.compared,
      abDiffs: ab.diffs,
      acCompared: ac.compared,
      acPass: ac.verdicts.filter((v) => v.verdict === "PASS").length,
      acSkips,
      acDiffs: ac.diffs,
      exit,
      notes,
    },
  };
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

  return {
    startedAt,
    finishedAt,
    selfcheck: options.selfcheck,
    viewer: options.viewer,
    workspaceId: workspaceId ?? null,
    pageLimit: options.limit,
    artifacts: { snapshotPath: artifactPath },
    ab,
    ac: { ...ac, skips: acSkips },
    exit,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Human output.
// ---------------------------------------------------------------------------

function printVerdictTable(ab: RunResult["ab"], ac: RunResult["ac"]): void {
  const rows = new Map<string, { ab?: CellVerdict; ac?: CellVerdict }>();
  for (const verdict of ab.verdicts) rows.set(verdict.cell, { ...rows.get(verdict.cell), ab: verdict });
  for (const verdict of ac.verdicts) rows.set(verdict.cell, { ...rows.get(verdict.cell), ac: verdict });
  const width = Math.max("cell".length, ...[...rows.keys()].map((key) => key.length)) + 2;
  console.log(`cell${" ".repeat(width - 4)}A==B        A==C`);
  for (const [cell, pair] of [...rows.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const mark = (verdict: CellVerdict | undefined): string => {
      if (verdict === undefined) return "—";
      if (verdict.verdict === "PASS") return "PASS";
      if (verdict.verdict === "SKIP") return "SKIP";
      return "DIFF";
    };
    const reasonFor = (verdict: CellVerdict | undefined): string => {
      if (verdict?.verdict === "SKIP" && verdict.reason !== undefined) return ` [${verdict.reason}]`;
      if (verdict?.verdict === "DIFF") return "  <-- inspect out/ artifact (left/right recorded)";
      return "";
    };
    const left = `${mark(pair.ab)}${reasonFor(pair.ab)}`.slice(0, 60);
    console.log(`${cell.padEnd(width)}${left.padEnd(62)}${mark(pair.ac)}${reasonFor(pair.ac)}`);
  }
}

function printRun(run: RunResult): void {
  console.log("Campfire MAC-002 parity — Gate S1 semantic parity harness (read-only)");
  console.log(`viewer        ${run.viewer}`);
  console.log(`workspace     ${run.workspaceId ?? "(none resolved)"}`);
  console.log(`page limit    ${run.pageLimit}`);
  console.log(`selfcheck     ${run.selfcheck ? "yes (canned envelopes, CLI leg skipped)" : "no"}`);
  if (run.notes.length > 0) console.log(`notes         ${run.notes.join("; ")}`);
  console.log("");
  printVerdictTable(run.ab, run.ac);
  console.log("");
  console.log(`A==B compared ${run.ab.compared}, diffs ${run.ab.diffs}`);
  console.log(`A==C compared ${run.ac.compared} (pass ${run.ac.compared - run.ac.skips - run.ac.diffs}, skip ${run.ac.skips}), diffs ${run.ac.diffs}`);
  console.log(`artifact      ${run.artifacts.snapshotPath}`);
  console.log(`exit          ${run.exit}`);
  if (run.exit === 0) {
    console.log("Gate S1 harness result: surfaces agree on the compared cells (SKIPs are documented surface-shape gaps, not failures).");
  } else if (run.ab.diffs > 0) {
    console.log("Gate S1 harness result: NOT PROVEN — the desktop client narrowing disagrees with the raw Viewer read (A==B shown above).");
  } else {
    console.log("Gate S1 harness result: NOT PROVEN — the CLI surface disagrees with the raw Viewer read (A==C shown above).");
  }
}

// ---------------------------------------------------------------------------
// --selfcheck: canned envelopes on an ephemeral port-0 server. The fixture
// mirrors the WorkspaceContext JSON shape (fixture-viewer.mjs shape, enriched
// with attention/alignment/coverage fields) and never opens a profile, token,
// database, or the real Viewer port.
// ---------------------------------------------------------------------------

function slice(items: unknown[]): Record<string, unknown> {
  return { items, total: items.length, returned: items.length, truncated: false };
}

function selfcheckFixture(): {
  workspaceId: string;
  list: unknown;
  whoami: unknown;
  contextOmitted: unknown;
  contextFull: unknown;
  participantsPage: unknown;
  tasksPage: unknown;
  activityPage: unknown;
} {
  const workspace = { id: "ws_mac002_demo", name: "Parity demo workspace", status: "active" };
  const humans = { hum_sergio: "Sergio" };
  const taskA = { id: "task_mac002_a", workspaceId: workspace.id, title: "Record the gate evidence", description: "First bounded task.", status: "open", assignee: { actorId: "hum_sergio", actorType: "human" }, updatedAt: "2026-10-28T09:00:00.000Z" };
  const taskB = { id: "task_mac002_b", workspaceId: workspace.id, title: "Unblock the verification", description: "Blocked work.", status: "blocked", assignee: { actorId: "hum_sergio", actorType: "human" }, updatedAt: "2026-10-28T09:00:00.000Z" };
  const taskC = { id: "task_mac002_c", workspaceId: workspace.id, title: "Review the parity cells", description: "Unassigned team work.", status: "open", updatedAt: "2026-10-28T09:00:00.000Z" };
  const finding = { id: "find_mac002_a", workspaceId: workspace.id, summary: "All three surfaces read one authorized response.", detail: "Recorded for the parity gate.", currentness: "current" };
  const artifact = { id: "art_mac002_a", workspaceId: workspace.id, type: "document", title: "Parity cell notes", uriOrPath: "docs/evidence/mac-002/PARITY-RUNBOOK.md" };
  const proposed = { id: "dec_mac002_a", workspaceId: workspace.id, summary: "Adopt the three-snapshot parity harness.", status: "proposed" };
  const accepted = { id: "dec_mac002_acc", workspaceId: workspace.id, summary: "Read only through the actor-bound Viewer.", status: "accepted", needsReview: true };
  const superseded = { id: "dec_mac002_old", summary: "Earlier scope note.", updatedAt: "2026-10-27T08:00:00.000Z" };
  const roster = [
    { actor: { actorId: "hum_sergio", actorType: "human" }, name: "Sergio", role: "owner", joinedAt: "2026-10-28T08:00:00.000Z" },
    { actor: { actorId: "ag_mac002_cli", actorType: "agent" }, name: "Parity CLI harness", role: "agent", harness: "opencode", joinedAt: "2026-10-28T08:00:00.000Z", humanOwnerIsParticipant: true },
  ];
  const participantsCoverage = { returned: 0, total: roster.length, truncated: false, omitted: true };
  const con0002 = { id: "con_mac002_0002", createdAt: "2026-10-28T09:02:00.000Z", actor: { actorId: "hum_sergio", actorType: "human" }, action: "decision.accepted", objectType: "decision", objectId: "dec_mac002_acc" };
  const con0001 = { id: "con_mac002_0001", createdAt: "2026-10-28T09:01:00.000Z", actor: { actorId: "hum_sergio", actorType: "human" }, action: "task.created", objectType: "task", objectId: "task_mac002_a" };
  const base = {
    schemaVersion: 1,
    generatedAt: "2026-10-28T09:10:00.000Z",
    orientationCursor: "con_mac002_0002",
    completeness: { fullHistoryIncluded: false, drillDownAvailable: true },
    workspace,
    goal: { id: "goal_mac002_demo", workspaceId: workspace.id, title: "Prove cross-surface parity", status: "active", updatedAt: "2026-10-28T08:00:00.000Z" },
    slices: {
      decisions: slice([proposed, accepted]),
      findings: slice([finding]),
      tasks: slice([taskA, taskB, taskC]),
      blockers: slice([taskB]),
      artifacts: slice([artifact]),
      recentChanges: slice([]),
    },
    proposedDecisions: [proposed],
    acceptedDecisions: [accepted],
    supersededDecisions: [superseded],
    openTasks: [taskA, taskB, taskC],
    findings: [finding],
    artifacts: [artifact],
    provenance: [con0001, con0002],
    provenanceTotal: 2,
    provenanceTruncated: false,
    needsYou: [
      { kind: "task", id: "task_mac002_b", summary: "blocked task assigned to you", status: "blocked", reason: "assigned_blocked_task", assignee: { actorId: "hum_sergio", actorType: "human" } },
      { kind: "decision", id: "dec_mac002_a", summary: "proposed decision — actionable by you, not accepted", status: "proposed", reason: "proposed_decision_actionable" },
    ],
    needsAttention: [
      { kind: "task", id: "task_mac002_c", summary: "team open task cue", status: "open", reason: "team_open_task" },
      { kind: "decision", id: "dec_mac002_acc", summary: "accepted decision cites non-current evidence — needs human review", status: "accepted", reason: "accepted_decision_needs_review" },
    ],
    attentionCoverage: { tasks: { total: 3, returned: 3, truncated: false }, decisions: { total: 3, returned: 3, truncated: false }, completeUnderRules: true },
    currentWork: { inProgressTasks: [], blockedTasks: [taskB], acceptedDecisions: [accepted] },
    suggestedNextAction: { kind: "task", id: "task_mac002_a", summary: "Start the assigned open task.", reason: "assigned_open_task", orientationHint: true },
    alignment: { status: "established", proposedDecisionIds: ["dec_mac002_a"], acceptedDecisionIds: ["dec_mac002_acc"], unresolvedBlockedTaskIds: ["task_mac002_b"] },
    historicalCounts: { findings: 2, decisions: 3 },
    provenanceSummary: ["Sergio accepted decision dec_mac002_acc.", "Sergio recorded task task_mac002_a."],
  };
  const contextOmitted = { ...base, participants: [], participantsCoverage };
  const contextFull = { ...base, participants: roster };
  return {
    workspaceId: workspace.id,
    list: [
      {
        id: workspace.id,
        name: workspace.name,
        status: workspace.status,
        goalTitle: "Prove cross-surface parity",
        openTaskCount: 3,
        updatedAt: "2026-10-28T09:10:00.000Z",
      },
    ],
    whoami: { actor: { actorId: "hum_sergio", actorType: "human" }, harness: "parity-fixture" },
    contextOmitted,
    contextFull,
    participantsPage: { schemaVersion: 1, workspaceId: workspace.id, items: roster, total: roster.length, returned: roster.length, truncated: false },
    tasksPage: { schemaVersion: 1, workspaceId: workspace.id, items: [taskA, taskB, taskC], total: 3, returned: 3, truncated: false },
    activityPage: { items: [con0001, con0002], total: 2, truncated: false },
  };
}

type SelfcheckServer = { url: string; port: number; close: () => Promise<void> };

function startSelfcheckServer(fixture: ReturnType<typeof selfcheckFixture>): Promise<SelfcheckServer> {
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse): void => {
    const respond = (status: number, body: unknown): void => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.method !== "POST" || !request.url || !request.url.endsWith("/api/call")) {
      respond(404, { ok: false, message: "selfcheck fixture serves POST /api/call only" });
      return;
    }
    void (async (): Promise<void> => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      let call: { method?: unknown; params?: unknown } = {};
      try {
        call = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method?: unknown; params?: unknown };
      } catch {
        respond(400, { ok: false, message: "selfcheck fixture requires a JSON body" });
        return;
      }
      const method = typeof call.method === "string" ? call.method : "";
      const params = isRecord(call.params) ? call.params : {};
      // Bounded denial: an unknown workspace id is not an error page, it is
      // the 404 envelope an actor-bound Viewer returns for another workspace.
      const paramsWorkspace = str(params.workspaceId);
      if (paramsWorkspace !== undefined && paramsWorkspace !== fixture.workspaceId) {
        respond(404, { ok: false, message: "selfcheck fixture: unknown workspace (bounded denial)" });
        return;
      }
      switch (method) {
        case "list_workspaces":
          respond(200, { ok: true, result: fixture.list });
          return;
        case "whoami":
          respond(200, { ok: true, result: fixture.whoami });
          return;
        case "get_workspace_context":
          respond(200, { ok: true, result: params.participants === "omit" ? fixture.contextOmitted : fixture.contextFull });
          return;
        case "list_tasks":
          respond(200, { ok: true, result: fixture.tasksPage });
          return;
        case "list_workspace_participants":
          respond(200, { ok: true, result: fixture.participantsPage });
          return;
        case "get_activity":
          respond(200, { ok: true, result: fixture.activityPage });
          return;
        default:
          respond(403, { ok: false, message: "selfcheck fixture: not in the Viewer read allowlist" });
          return;
      }
    })();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // Port 0: the OS assigns an ephemeral port, so the selfcheck never
    // collides with the operator's Viewer on 9415.
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = isRecord(address) || typeof address === "object" ? (address as { port?: number }).port ?? 0 : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error === undefined ? done() : fail(error)));
          }),
      });
    });
  });
}

async function runSelfcheck(flags: Flags): Promise<RunResult> {
  const fixture = selfcheckFixture();
  const server = await startSelfcheckServer(fixture);
  try {
    const run = await runParity({
      ...flags,
      viewer: server.url,
      workspace: fixture.workspaceId,
      skipCliLeg: true,
    });
    const artifactBytes = run.artifacts.snapshotPath === null ? 0 : readFileSync(run.artifacts.snapshotPath).byteLength;
    const hasWorkspaceCell = "workspace.id" in run.ab.verdicts.map((verdict) => verdict.cell).reduce<Set<string>>((acc, cell) => acc.add(cell), new Set());
    const problems: string[] = [];
    if (run.exit !== 0) problems.push(`exit ${run.exit} (expected 0)`);
    if (run.ab.compared === 0 || !hasWorkspaceCell) problems.push("snapshot A/B produced no compared cells; the desktop client parse was not exercised");
    if (artifactBytes === 0) problems.push("artifact file was not written");
    console.log(`[selfcheck] ephemeral fixture Viewer on port ${server.port} (closed after run)`);
    console.log(`[selfcheck] A==B parsed+compared cells: ${run.ab.compared}, A==C compared: ${run.ac.compared}`);
    return run;
  } finally {
    await server.close();
  }
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const run = flags.selfcheck ? await runSelfcheck(flags) : await runParity({ ...flags, skipCliLeg: false });
  if (flags.json) {
    console.log(
      JSON.stringify({
        workspaceId: run.workspaceId,
        viewer: run.viewer,
        ab: { compared: run.ab.compared, diffs: run.ab.diffs },
        ac: { compared: run.ac.compared, skips: run.ac.skips, diffs: run.ac.diffs },
        summary: run.exit === 0 ? "surfaces-agree (Gate S1 harness)" : "not-proven",
        notes: run.notes,
        exit: run.exit,
        artifact: run.artifacts.snapshotPath,
      }),
    );
  } else {
    printRun(run);
  }
  process.exitCode = run.exit;
}

await main();
