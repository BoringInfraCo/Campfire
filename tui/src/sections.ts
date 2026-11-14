/** Bounded display projections. Never treat an omitted context slice as complete. */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type * as WorkConsole from "../../src/presentation/work-console.js";
import type { SectionId } from "./nav-state.js";
import { activitySummary } from "./activity.js";

const source = new URL("../../src/presentation/work-console.ts", import.meta.url);
const built = new URL("../../dist/src/presentation/work-console.js", import.meta.url);
const labels = (await import((existsSync(fileURLToPath(source)) ? source : built).href)) as typeof WorkConsole;

export interface SectionRow { id: string; kind: string; text: string; cueId?: string; rowKey?: string }
export type RecordValue = Record<string, unknown>;
export function object(value: unknown): RecordValue { return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {}; }
export function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
/** Validate the server's workspace binding before exposing any returned rows. */
export function pageMatchesWorkspace(value: unknown, workspaceId: string, required: boolean): boolean {
  const page = object(value);
  if ((required || page.workspaceId !== undefined) && page.workspaceId !== workspaceId) return false;
  return Array.isArray(page.items) && page.items.every((entry) => {
    const row = object(entry);
    return row.workspaceId === undefined || row.workspaceId === workspaceId;
  });
}
/** Records with unexpected identity are not safe to show as the selected record. */
export function detailMatchesSelection(value: unknown, workspaceId: string, id: string): boolean {
  const record = object(value);
  return record.workspaceId === workspaceId && record.id === id;
}
/**
 * Task rows always carry a workspace id. A page binding alone is not enough
 * when a row could name another workspace.
 */
export function taskPageMatchesWorkspace(value: unknown, workspaceId: string): boolean {
  const page = object(value);
  if (page.workspaceId !== workspaceId || !Array.isArray(page.items)) return false;
  return page.items.every((entry) => object(entry).workspaceId === workspaceId);
}
/** Activity pages have no page-level workspace id; every contribution must. */
export function activityMatchesWorkspace(value: unknown, workspaceId: string): boolean {
  const page = object(value);
  if (page.workspaceId !== undefined && page.workspaceId !== workspaceId) return false;
  if (!Array.isArray(page.items)) return false;
  return page.items.every((entry) => object(entry).workspaceId === workspaceId);
}
/** History is bound to one workspace record. Omitted identity is not a match. */
export function historyMatchesRequest(value: unknown, workspaceId: string, objectType: string, objectId: string): boolean {
  const page = object(value);
  if (page.workspaceId !== workspaceId || page.objectType !== objectType || page.objectId !== objectId || !Array.isArray(page.items)) return false;
  return page.items.every((entry) => {
    const row = object(entry);
    return row.workspaceId === workspaceId && row.objectType === objectType && row.objectId === objectId;
  });
}
export function safe(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim() : "";
}
function decisionStatus(value: unknown): string {
  const status = safe(value);
  return status.length === 0 ? "" : labels.decisionStatusLabel(status);
}
function row(value: unknown, kind: string): SectionRow | undefined {
  const v = object(value); const actor = object(v.actor);
  const id = safe(v.id) || safe(actor.actorId);
  if (!id) return undefined;
  const label = safe(v.title) || safe(v.summary) || safe(v.name) || safe(v.description) || id;
  const status = kind === "decision"
    ? decisionStatus(v.status)
    : safe(v.status) || safe(v.changeType) || safe(v.contributionType) || safe(actor.actorType);
  // Keep identifiers available for selection and details without letting them
  // crowd out the record's actual title on every list row.
  const type = kind === "finding" || kind === "artifact" ? kind : "";
  const secondary = [type, status.replace(/_/g, " ")].filter(Boolean).join(" · ");
  return { id, kind, text: `${label}${secondary ? ` · ${secondary}` : ""}` };
}
function rows(values: unknown[], kind: string): SectionRow[] {
  return values.map((value) => row(value, kind)).filter((v): v is SectionRow => v !== undefined);
}
/** `get_workspace_context` binds the snapshot on `workspace.id`, not a top-level id. */
function contextWorkspaceId(context: unknown): string {
  return safe(object(object(context).workspace).id);
}
/** A missing row workspace id stays. A different id is another workspace's record. */
function inContextWorkspace(value: unknown, workspaceId: string): boolean {
  if (workspaceId.length === 0) return true;
  const recorded = object(value).workspaceId;
  if (recorded === undefined) return true;
  return safe(recorded) === workspaceId;
}
function contextRows(context: unknown, values: unknown[], kind: string): SectionRow[] {
  const workspaceId = contextWorkspaceId(context);
  return rows(values.filter((value) => inContextWorkspace(value, workspaceId)), kind);
}
function unique(values: SectionRow[]): SectionRow[] {
  const seen = new Set<string>(); return values.filter((value) => { const key = `${value.kind}:${value.id}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
export function sectionRows(section: SectionId, context: unknown, pages: Record<string, unknown>): SectionRow[] {
  const c = object(context); const slices = object(c.slices);
  if (section === "work") return rows(array(object(pages.work).items), "task");
  if (section === "people") return rows(array(object(pages.people).items), "participant");
  if (section === "changes") return array(object(pages.changes).items).flatMap((item) => {
    const id = safe(object(item).id);
    const text = activitySummary(item, [...array(c.participants), ...array(object(pages.people).items)]);
    return id && text ? [{ id, kind: "contribution", text }] : [];
  });
  if (section === "decisions") return unique(contextRows(c, [...array(c.proposedDecisions), ...array(c.acceptedDecisions), ...array(c.supersededDecisions), ...array(object(slices.decisions).items)], "decision"));
  if (section === "references") return unique([...contextRows(c, [...array(c.findings), ...array(object(slices.findings).items)], "finding"), ...contextRows(c, [...array(c.artifacts), ...array(object(slices.artifacts).items)], "artifact")]);
  if (section === "overview") return unique(contextRows(c, [...array(c.openTasks), ...array(object(c.currentWork).inProgressTasks), ...array(object(c.currentWork).blockedTasks)], "task"));
  return [];
}

/** Open and in-progress tasks only. You-cue subjects are already listed above. */
export function overviewWorkRows(context: unknown, skipIds: ReadonlySet<string>): SectionRow[] {
  const c = object(context);
  const workspaceId = contextWorkspaceId(c);
  const tasks = [...array(c.openTasks), ...array(object(c.currentWork).inProgressTasks)]
    .filter((task) => inContextWorkspace(task, workspaceId));
  return unique(rows(tasks, "task")).filter((row) => !skipIds.has(row.id));
}

/** Needs you, then team, then work that is not already a you cue. */
export function overviewRows(context: unknown, cues: readonly SectionRow[]): SectionRow[] {
  const you = cues.filter((row) => row.text.startsWith("[you]"));
  const team = cues.filter((row) => row.text.startsWith("[team]"));
  return [...you, ...team, ...overviewWorkRows(context, new Set(you.map((row) => row.id)))];
}

/** Same recorded fields as the classic contribution line, with an allowlisted payload. */
export function contributionText(value: unknown): string {
  const v = object(value);
  const actor = object(v.actor);
  const parts = [safe(v.id), safe(v.createdAt), safe(actor.actorId), safe(actor.actorType), safe(v.action), safe(v.objectType), safe(v.objectId)];
  const session = safe(v.agentSessionId);
  if (session) parts.push(`session ${session}`);
  const payload = object(v.payload);
  for (const key of ["summary", "title", "status"] as const) {
    const text = safe(payload[key]);
    if (text) parts.push(`${key}=${text}`);
  }
  if (payload.assignee === null) parts.push("assignee=null");
  else {
    const actorId = safe(object(payload.assignee).actorId);
    if (actorId) parts.push(`assignee=${actorId}`);
  }
  return parts.filter((part) => part.length > 0).join(" · ");
}

/** ATT-001 is a separately labelled fallback, available only after an attention-read failure. */
export function fallbackAttentionRows(context: unknown): SectionRow[] {
  const c = object(context);
  const entries = (items: unknown, audience: string): SectionRow[] => array(items).flatMap((item) => {
    const value = object(item); const id = safe(value.id); const kind = safe(value.kind);
    if (!id || (kind !== "task" && kind !== "decision")) return [];
    const reason = safe(value.reason); const summary = safe(value.summary) || id;
    const findings = array(value.needsReviewFindingIds).map((id) => safe(id)).filter((id) => id.length > 0);
    const citation = findings.length > 0 ? ` · non-current findings: ${findings.join(", ")}` : "";
    return [{ id, kind, rowKey: JSON.stringify([audience, kind, id, reason]), text: `[${audience}] ${labels.attentionReasonLabel(reason) || "recorded item"} · ${summary} · ${id}${citation}` }];
  });
  return [...entries(c.needsYou, "you"), ...entries(c.needsAttention, "team")];
}

export function fallbackAttentionCoverage(context: unknown): string {
  const coverage = object(object(context).attentionCoverage);
  const fraction = labels.attentionCoverageText(coverage as unknown as Parameters<typeof labels.attentionCoverageText>[0]);
  const prefix = fraction.length > 0 ? `${fraction} ` : "";
  if (coverage.completeUnderRules === true) return `${prefix}Older-list coverage: complete under its rules; it does not include all FAC-001 cues.`;
  if (coverage.completeUnderRules === false) return `${prefix}Older-list coverage: incomplete; additional items may exist.`;
  return "Older-list coverage unavailable; additional items may exist.";
}
export function coverage(section: SectionId, context: unknown, pages: Record<string, unknown>): string {
  const page = object(pages[section]);
  if (["work", "people", "changes"].includes(section)) {
    if (!pages[section]) return "This section has not loaded.";
    const shown = array(page.items).length;
    const total = typeof page.total === "number" ? page.total : undefined;
    const more = page.truncated === true || !!page.nextCursor || !!page.nextBefore || (total !== undefined && total > shown);
    const count = total === undefined ? `${shown} shown` : `${shown} of ${total}`;
    return `${count}${more ? "; more records exist" : ""}.`;
  }
  if (["decisions", "references", "overview"].includes(section)) return "Showing bounded workspace context; additional records may exist.";
  return "";
}

/** A missing page is still loading; don't imply that its data is empty. */
export function sectionEmptyMessage(section: SectionId, pages: Record<string, unknown>): string {
  if ((section === "work" || section === "people" || section === "changes") && !pages[section]) return "Waiting for records to load.";
  switch (section) {
    case "work": return "No work recorded in this view.";
    case "decisions": return "No decisions recorded in this view.";
    case "references": return "No findings or artifacts recorded in this view.";
    case "people": return "No participants in this view.";
    case "changes": return "No activity recorded in this view.";
    case "overview": return "No work or attention cues in this view.";
    default: return "No records in this view.";
  }
}
/** Detail output has an explicit allowlist, not arbitrary server object serialization. */
export function detailLines(value: unknown): string[] {
  const v = object(value); const lines: string[] = [];
  for (const key of ["id", "title", "summary", "status", "description", "currentness", "createdAt", "updatedAt"]) {
    const val = safe(v[key]); if (val) lines.push(`${key}: ${val}`);
  }
  for (const key of ["createdBy", "updatedBy"]) {
    const actor = object(v[key]); const actorId = safe(actor.actorId); const actorType = safe(actor.actorType);
    if (actorId) lines.push(`${key}: ${actorId}${actorType ? ` (${actorType})` : ""}`);
  }
  return lines.length ? lines : ["No displayable record details."];
}
