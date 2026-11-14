/** FAC-001 attention read for the OpenTUI sidecar. Session state is memory-only. */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AttentionCue, AttentionResult } from "../../src/domain/attention.js";
import type * as AttentionPresentation from "../../src/presentation/attention-view.js";
import type { CallResponse } from "./client.ts";

// The sidecar is next to src/ in a checkout and next to dist/ when packaged.
// Both paths use the same renderer as the human CLI and classic dashboard.
const source = new URL("../../src/presentation/attention-view.ts", import.meta.url);
const built = new URL("../../dist/src/presentation/attention-view.js", import.meta.url);
const renderer = (await import((existsSync(fileURLToPath(source)) ? source : built).href)) as typeof AttentionPresentation;

export interface AttentionState {
  workspaceId: string;
  status: "loading" | "ready" | "error" | "denied" | "cursor_error";
  result?: AttentionResult;
  baseline?: string;
}

export type AttentionCall = (method: "get_workspace_attention", params: Record<string, unknown>) => Promise<CallResponse<unknown>>;

export function initialAttention(workspaceId: string): AttentionState {
  return { workspaceId, status: "loading" };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validResult(value: unknown, workspaceId: string): value is AttentionResult {
  if (!record(value) || value.workspaceId !== workspaceId || typeof value.orientationCursor !== "string") return false;
  if (!record(value.coverage) || typeof value.coverage.completeUnderRules !== "boolean" || !Array.isArray(value.coverage.perSource)) return false;
  if (!record(value.catchUp) || !["not_requested", "partial", "complete"].includes(String(value.catchUp.status))) return false;
  if (typeof value.catchUp.changedCount !== "number" || typeof value.catchUp.examined !== "number" ||
      typeof value.catchUp.tipAdvanced !== "boolean" || typeof value.catchUp.affectedTruncated !== "boolean" ||
      !Array.isArray(value.catchUp.affectedIds) || !value.catchUp.affectedIds.every((x) => typeof x === "string")) return false;
  if (value.catchUp.status !== "not_requested" && typeof value.catchUp.toCursor !== "string") return false;
  if (value.nextCursor !== undefined && typeof value.nextCursor !== "string") return false;
  return Array.isArray(value.cues) && value.cues.every((cue: unknown) => record(cue) &&
    typeof cue.id === "string" && typeof cue.reason === "string" && typeof cue.subjectType === "string" &&
    typeof cue.subjectId === "string" && typeof cue.summary === "string" && (cue.audience === "you" || cue.audience === "team") &&
    Array.isArray(cue.relatedIds) && cue.relatedIds.every((id: unknown) => typeof id === "string")) &&
    value.coverage.perSource.every((entry: unknown) => record(entry) && typeof entry.reason === "string" &&
      (entry.skipped === undefined || typeof entry.skipped === "string"));
}

/** Caller discards a returned state if the workspace or request generation changed. */
export async function readAttention(state: AttentionState, call: AttentionCall): Promise<AttentionState> {
  const { workspaceId, baseline } = state;
  const params: Record<string, unknown> = { workspaceId, limit: 100 };
  if (baseline !== undefined) params.since = baseline;
  try {
    const response = await call("get_workspace_attention", params);
    if (!response.ok) {
      const denied = response.error === "Unauthorized" || response.error === "ParticipantRequired";
      // /v1/call may omit details: the service's fixed message is the only
      // available discriminator in that case. Never print the raw message.
      const ahead = response.error === "ValidationError" && (response.recoveryCode === "cursor_ahead_of_tip" || response.message === "since is ahead of the current contribution tip");
      return { workspaceId, status: denied ? "denied" : ahead ? "cursor_error" : "error" };
    }
    // A successful response with a missing or different workspace binding is
    // an integrity failure, not a transient read error: discard the baseline
    // and let the session clear all workspace data instead of showing fallback.
    if (!record(response.result) || response.result.workspaceId !== workspaceId) return { workspaceId, status: "denied" };
    if (!validResult(response.result, workspaceId)) return { workspaceId, status: "error", ...(baseline === undefined ? {} : { baseline }) };
    const result = response.result;
    const next = baseline === undefined ? result.orientationCursor : result.catchUp.status === "not_requested" ? baseline : result.catchUp.toCursor;
    return { workspaceId, status: "ready", result, baseline: next };
  } catch {
    return { workspaceId, status: "error" };
  }
}

/** The caller may supply only the current workspace's ATT-001 rows as fallback. */
export function attentionLines(state: AttentionState, fallbackItems: readonly string[] = []): string[] {
  if (state.status === "denied") return ["Authorization refused or workspace did not match; workspace data cleared."];
  if (state.status === "cursor_error") return ["Attention catch-up cursor is ahead of the workspace tip. The baseline was cleared; refresh to restart.", ...fallbackItems];
  if (state.status === "error") return ["Attention read failed. Showing the older list.", ...fallbackItems];
  if (state.status !== "ready" || state.result === undefined) return ["Loading attention…"];
  return renderer.renderAttentionLines(state.result);
}

export function attentionCount(state: AttentionState): string | undefined {
  return state.status === "ready" && state.result !== undefined ? renderer.attentionNeedsYouCount(state.result).text : undefined;
}

export function attentionCueLines(cue: AttentionCue): string[] { return renderer.attentionCueLines(cue); }

/** Compact list text; identifiers and related records remain in cue details. */
export function attentionCueRowText(cue: AttentionCue): string {
  const { primary, secondary } = renderer.attentionCueParts(cue);
  return `${primary} · ${secondary} · ${cue.audience === "you" ? "You" : "Team"}`;
}

/** Summary excludes opaque cursors but retains the full catch-up status and caveats. */
function catchUpSummaryLines(result: AttentionResult): string[] {
  const c = result.catchUp;
  if (c.status === "not_requested") return ["Catch-up: starts after this first read."];
  const status = c.status === "partial" ? "Catch-up: partial; more changes exist." : "Caught up.";
  return [
    `${status} ${Number(c.changedCount)} changed in this interval; ${Number(c.examined)} examined on this page.`,
    ...(c.tipAdvanced ? ["The workspace advanced while reading."] : []),
    ...(c.affectedTruncated ? [`Affected list is truncated (showing ${c.affectedIds.length}).`] : []),
  ];
}

export function attentionSummaryLines(state: AttentionState, perspective: Perspective = "mine"): string[] {
  if (state.status !== "ready" || state.result === undefined) return attentionLines(state);
  const result = state.result;
  const hiddenOnly = result.cues.length > 0 && cuesFor(result, perspective).length === 0;
  return [
    ...(hiddenOnly ? [`No ${perspective === "mine" ? "you" : "team"} cue on this page. Press p to see the other view.`] : []),
    ...(result.cues.length === 0 ? [result.coverage.completeUnderRules ? renderer.ATTENTION_VIEW_STRINGS.emptyComplete : renderer.ATTENTION_VIEW_STRINGS.emptyIncomplete] : []),
    ...renderer.attentionCoverageViewLines(result),
    ...(result.nextCursor ? [renderer.ATTENTION_VIEW_STRINGS.morePages] : []),
    ...catchUpSummaryLines(result),
  ];
}

/** Bounded overview of every coverage/catch-up warning; `i` shows source details. */
export function attentionCompactSummaryLines(state: AttentionState, perspective: Perspective = "mine"): string[] {
  if (state.status !== "ready" || state.result === undefined) return attentionLines(state);
  const result = state.result;
  const truncated = result.coverage.perSource.filter((entry) => entry.truncated === true).length;
  const skipped = result.coverage.perSource.filter((entry) => entry.skipped !== undefined).length;
  const hiddenOnly = result.cues.length > 0 && cuesFor(result, perspective).length === 0;
  const lines: string[] = [];
  if (result.cues.length === 0) {
    lines.push(result.coverage.completeUnderRules ? renderer.ATTENTION_VIEW_STRINGS.emptyComplete : renderer.ATTENTION_VIEW_STRINGS.emptyIncomplete);
  } else if (hiddenOnly) {
    lines.push(`No ${perspective === "mine" ? "you" : "team"} cue on this page. Press p for the other view.`);
  }
  const warnings = [
    ...(truncated ? [`${truncated} source${truncated === 1 ? "" : "s"} scan limit reached`] : []),
    ...(skipped ? [`${skipped} source${skipped === 1 ? "" : "s"} skipped`] : []),
    ...(result.nextCursor ? ["more cues on another page"] : []),
  ];
  lines.push(`Coverage: ${result.coverage.completeUnderRules ? "complete under the rules" : "incomplete under the rules"}.${warnings.length ? ` ${warnings.join("; ")}. Press i for details.` : ""}`);
  const c = result.catchUp;
  if (c.status !== "not_requested") {
    const caveats = [...(c.tipAdvanced ? ["workspace advanced"] : []), ...(c.affectedTruncated ? ["affected list truncated"] : [])];
    lines.push(`${c.status === "complete" ? "Caught up" : "Catch-up partial; more changes exist"}: ${c.changedCount} changed; ${c.examined} examined.${caveats.length ? ` ${caveats.join("; ")}.` : ""}`);
  } else {
    lines.push("Catch-up starts after this first read.");
  }
  return lines;
}

/** Full coverage and catch-up information for the explicit details view. */
export function attentionDetailLines(state: AttentionState, perspective: Perspective = "mine"): string[] {
  if (state.status !== "ready" || state.result === undefined) return attentionLines(state);
  return [
    ...attentionSummaryLines(state, perspective),
    ...(state.result.catchUp.toCursor && /^cf1\.[A-Za-z0-9_-]+$/.test(state.result.catchUp.toCursor)
      ? [`Catch-up cursor: ${state.result.catchUp.toCursor}`] : []),
    ...renderer.attentionCatchUpLines(state.result).filter((line) => line.startsWith("Affected:")),
  ];
}

export type Perspective = "mine" | "team";

/** Cues for the active perspective in server order: audience filter only, never re-sorted. */
export function cuesFor(result: AttentionResult | undefined, perspective: Perspective): AttentionCue[] {
  const audience = perspective === "mine" ? "you" : "team";
  return result === undefined ? [] : result.cues.filter((cue) => cue.audience === audience);
}

/** Mine keeps the shared needs-you count (page/coverage aware); team counts loaded team cues. */
export function perspectiveHeading(state: AttentionState, perspective: Perspective): string | undefined {
  if (state.status !== "ready" || state.result === undefined) return undefined;
  const result = state.result;
  const teamCount = cuesFor(result, "team").length;
  const teamText = result.coverage.completeUnderRules && result.nextCursor === undefined
    ? String(teamCount) : `${teamCount}+ (more pages or incomplete coverage)`;
  return perspective === "mine" ? `Needs you ${attentionCount(state) ?? ""}` : `Needs attention ${teamText}`;
}
