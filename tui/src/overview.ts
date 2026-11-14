import { array, object, safe, type SectionRow } from "./sections.js";
import type { AttentionState } from "./attention.js";
import { attentionCount } from "./attention.js";
import { activitySummary } from "./activity.js";

/** Summaries describe the bounded data actually returned, never invented totals. */
export function overviewSummaryRows(context: unknown, attention: AttentionState): SectionRow[] {
  const c = object(context);
  const slices = object(c.slices);
  const count = (slice: string, suffix: string): string => {
    const value = object(slices[slice]);
    return typeof value.total === "number" && Number.isFinite(value.total) ? `${value.total} ${suffix}` : "count unavailable";
  };
  const attentionText = attention.status === "ready" ? attentionCount(attention) ?? "not available"
    : attention.status === "loading" ? "loading" : "unavailable";
  const recent = typeof c.provenanceTotal === "number" ? `${c.provenanceTotal} recorded changes` : "count unavailable";
  const workspaceId = safe(object(c.workspace).id);
  const latest = array(c.provenance).filter((item) => {
    const entry = object(item);
    return entry.workspaceId === undefined || entry.workspaceId === workspaceId;
  }).sort((a, b) => safe(object(b).createdAt).localeCompare(safe(object(a).createdAt)))[0];
  const activity = latest ? activitySummary(latest, array(c.participants)) : recent;
  return [
    { id: "attention", kind: "section", text: `Needs you  ·  ${safe(attentionText)}` },
    { id: "work", kind: "section", text: `Work  ·  ${count("tasks", "recorded")}` },
    { id: "decisions", kind: "section", text: `Decisions  ·  ${count("decisions", "proposed or accepted")}` },
    { id: "changes", kind: "section", text: `Activity  ·  ${activity}` },
  ];
}
