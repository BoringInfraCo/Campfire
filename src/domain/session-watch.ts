import { ValidationError } from "./errors.js";
import { deriveSessionRuntimeState, SESSION_TITLE_MAX } from "./session-runtime.js";
import type { AgentSessionRuntimeReport } from "./session-runtime.js";
import type { Contribution } from "./types.js";

/**
 * SES-001 A2 owner-shared session watch.
 *
 * Everything here is derived from workspace records, the latest lease and server
 * time. Nothing here can carry terminal bytes, prompts, argv, environment, PID,
 * paths, or any transcript.
 */

export const SESSION_WATCH_DEFAULT_LIMIT = 25;
export const SESSION_WATCH_MAX_LIMIT = 50;

export const SESSION_WATCH_STATES = ["live", "disconnected", "ended"] as const;
export type SessionWatchState = (typeof SESSION_WATCH_STATES)[number];

export interface AgentSessionShare {
  sessionId: string;
  workspaceId: string;
  sharedBy: string;
  sharedAt: string;
  revokedAt?: string;
}

/** A share is in force only while it exists and has not been revoked. */
export function isShareActive(share: AgentSessionShare | undefined): boolean {
  return share !== undefined && share.revokedAt === undefined;
}

/**
 * A2 section 20.4, server time only.
 *
 * ended: `endedAt` set, or the latest report is final.
 * live: a non-final report whose lease has not expired (expiry at `now` is expired).
 * disconnected: a non-final report whose lease expired, or no report was accepted.
 */
export function deriveSessionWatchState(input: {
  endedAt?: string;
  report?: Pick<AgentSessionRuntimeReport, "state" | "expiresAt">;
  now: string;
}): SessionWatchState {
  if (input.endedAt !== undefined) return "ended";
  const runtime = deriveSessionRuntimeState({ report: input.report, now: input.now });
  if (runtime === "exited" || runtime === "failed") return "ended";
  return runtime === "unknown" ? "disconnected" : "live";
}

export interface SessionWatchActivityItem {
  position: number;
  type: string;
  summary: string;
  createdAt: string;
}

/**
 * Single-line, bounded text: control characters, line separators and whitespace runs
 * collapse to one space, the result is trimmed, and the cap never splits a surrogate pair.
 */
export function boundWatchText(value: string): string {
  const flat = value.replace(/[\p{Cc}\u2028\u2029\s]+/gu, " ").trim();
  if (flat.length <= SESSION_TITLE_MAX) return flat;
  let end = SESSION_TITLE_MAX;
  const last = flat.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return flat.slice(0, end).trimEnd();
}

function boundedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const bounded = boundWatchText(value);
  return bounded.length === 0 ? undefined : bounded;
}

/**
 * One recorded-work line. Only the same summary/title/status payload fields the
 * workspace activity line uses; any other payload field is never read.
 */
export function projectWatchActivityItem(contribution: Contribution): SessionWatchActivityItem {
  const payload = contribution.payload ?? {};
  const type = `${contribution.objectType}.${contribution.action}`;
  const summary =
    boundedString(payload.summary) ??
    boundedString(payload.title) ??
    boundedString(payload.status) ??
    `${contribution.action} ${contribution.objectType}`;
  return { position: contribution.appendPosition, type, summary, createdAt: contribution.createdAt };
}

/** `after` is an exclusive append position; absent means from the start. */
export function parseWatchAfter(after: unknown): number {
  if (after === undefined || after === null) return 0;
  if (typeof after !== "number" || !Number.isSafeInteger(after) || after < 0) {
    throw new ValidationError("after must be a non-negative integer position", { field: "after" });
  }
  return after;
}

export function clampWatchLimit(limit: number | undefined): number {
  const value = limit === undefined || !Number.isFinite(limit) ? SESSION_WATCH_DEFAULT_LIMIT : Math.trunc(limit);
  return Math.min(SESSION_WATCH_MAX_LIMIT, Math.max(1, value));
}
