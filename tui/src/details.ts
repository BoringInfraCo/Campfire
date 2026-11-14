/** Bounded, explicit record detail projection. Never serialize arbitrary data. */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type * as WorkConsole from "../../src/presentation/work-console.js";

const source = new URL("../../src/presentation/work-console.ts", import.meta.url);
const built = new URL("../../dist/src/presentation/work-console.js", import.meta.url);
const shared = (await import((existsSync(fileURLToPath(source)) ? source : built).href)) as typeof WorkConsole;
const MAX_RELATIONS = 50;
const MAX_TEXT = 4096;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = shared.stripTerminalControls(value).replace(/\s+/g, " ").trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}… [truncated]` : text;
}

/** Only well-defined record fields are shown. No stored URI/path, payload, or transcript is displayed. */
export function recordDetailLines(value: unknown, kind: string): string[] {
  const fields = object(value);
  const lines: string[] = [];
  const add = (label: string, raw: unknown): void => { const text = clean(raw); if (text) lines.push(`${label}: ${text}`); };
  const actor = (label: string, raw: unknown): void => {
    const value = object(raw), id = clean(value.actorId), type = clean(value.actorType);
    if (id) lines.push(`${label}: ${id}${type ? ` (${type})` : ""}`);
  };
  add("record type", kind);
  for (const field of ["id", "title", "summary", "status", "description", "detail", "rationale", "currentness", "createdAt", "updatedAt"]) add(field, fields[field]);
  for (const field of ["createdBy", "updatedBy", "assignee", "approvedBy", "supersededBy"]) actor(field, fields[field]);
  if (fields.status === "in_progress") lines.push("In progress is a recorded state, not a claim an agent is running.");
  if (fields.needsReview === true) lines.push("needs review — acceptance is unchanged");
  if (Array.isArray(fields.needsReviewFindingIds)) {
    const ids = fields.needsReviewFindingIds.map(clean).filter(Boolean);
    if (ids.length) lines.push(`non-current findings: ${ids.slice(0, MAX_RELATIONS).join(", ")}${ids.length > MAX_RELATIONS ? `; ${ids.length - MAX_RELATIONS} more` : ""}`);
  }
  for (const [label, key] of [["source artifact", "sourceArtifactId"], ["predecessor", "predecessorId"], ["successor", "successorId"], ["supersede reason", "supersedeReason"]] as const) add(label, fields[key]);
  const relationLines = (key: "citations" | "evidence"): void => {
    const values = Array.isArray(fields[key]) ? fields[key] : [];
    for (const raw of values.slice(0, MAX_RELATIONS)) {
      const row = object(raw), id = clean(row.id);
      const target = clean(key === "citations" ? row.findingId : row.artifactId);
      const relation = key === "evidence" ? clean(row.relation) : "";
      if (id || target) lines.push(`${key === "citations" ? "citation" : "evidence"}: ${id}${target ? ` · ${key === "citations" ? "finding" : "artifact"} ${target}` : ""}${relation ? ` · ${relation}` : ""}`);
    }
    if (values.length > MAX_RELATIONS) lines.push(`${key}: ${values.length - MAX_RELATIONS} more not shown.`);
  };
  relationLines("citations");
  relationLines("evidence");
  if (kind === "artifact" && typeof fields.uriOrPath === "string") {
    const classification = shared.classifyArtifactReference(fields.uriOrPath);
    lines.push(shared.ARTIFACT_REFERENCE_LABEL);
    if (classification.class !== "none") {
      add("reference class", classification.class);
      add("reference host", classification.host);
      lines.push(shared.ARTIFACT_EXTERNAL_UNVERIFIED_LABEL);
      if (classification.unsafe) lines.push(shared.ARTIFACT_UNSAFE_CONTROL_LABEL);
    }
    lines.push("This terminal does not open, fetch, or verify the reference.");
  }
  return lines.length > 1 ? lines : ["No displayable record details."];
}
