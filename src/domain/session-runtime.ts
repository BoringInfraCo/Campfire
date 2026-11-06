import { Conflict, ValidationError } from "./errors.js";

/**
 * SES-001 operational session reports.
 *
 * A report is an expiring observation from a local supervisor. It is not a
 * Task, Finding, Decision, or Contribution, and it never carries terminal
 * bytes, paths, or credentials. Server time decides freshness.
 */

export const SESSION_RUNTIME_STATES = ["starting", "running", "stopping", "exited", "failed"] as const;
export type SessionRuntimeState = (typeof SESSION_RUNTIME_STATES)[number];

export const SESSION_FAILURE_KINDS = [
  "spawn_failed",
  "exited_nonzero",
  "signal",
  "control_lost",
] as const;
export type SessionFailureKind = (typeof SESSION_FAILURE_KINDS)[number];

export const SESSION_LEASE_MS = 45_000;
export const SESSION_REPORT_MIN_INTERVAL_MS = 5_000;
export const SESSION_LIST_DEFAULT_LIMIT = 25;
export const SESSION_LIST_MAX_LIMIT = 50;
export const SESSION_TITLE_MAX = 240;

const FAILURE_ALIASES: Record<string, SessionFailureKind> = {
  spawn_failed: "spawn_failed",
  exited_nonzero: "exited_nonzero",
  nonzero_exit: "exited_nonzero",
  signal: "signal",
  control_lost: "control_lost",
  wrapper_lost: "control_lost",
  control_unavailable: "control_lost",
  missing_executable: "spawn_failed",
};

export interface AgentSessionRuntimeReport {
  sessionId: string;
  workspaceId: string;
  taskId: string;
  state: SessionRuntimeState;
  origin: "local_supervisor";
  sequence: number;
  reportedAt: string;
  expiresAt?: string;
  exitCode?: number;
  failureKind?: SessionFailureKind;
}

export type DerivedSessionRuntimeState = SessionRuntimeState | "unknown";

export function isFinalRuntimeState(state: SessionRuntimeState): boolean {
  return state === "exited" || state === "failed";
}

export function normalizeFailureKind(value: string | undefined): SessionFailureKind | undefined {
  if (value === undefined) return undefined;
  return FAILURE_ALIASES[value];
}

export function addMilliseconds(iso: string, ms: number): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    throw new Error("invalid timestamp");
  }
  return new Date(parsed + ms).toISOString();
}

export function deriveSessionRuntimeState(input: {
  report?: Pick<AgentSessionRuntimeReport, "state" | "expiresAt">;
  now: string;
}): DerivedSessionRuntimeState {
  const report = input.report;
  if (report === undefined) return "unknown";
  if (isFinalRuntimeState(report.state)) return report.state;
  if (report.expiresAt === undefined) return "unknown";
  const expires = Date.parse(report.expiresAt);
  const now = Date.parse(input.now);
  if (Number.isNaN(expires) || Number.isNaN(now) || expires <= now) return "unknown";
  return report.state;
}

export type RuntimeDecision =
  | { kind: "accept" }
  | { kind: "idempotent" }
  | { kind: "reject"; reason: "stale_sequence" | "final" | "rate_limited" | "conflict" };

export function decideRuntimeReport(
  previous: AgentSessionRuntimeReport | undefined,
  next: { sequence: number; state: SessionRuntimeState; exitCode?: number; failureKind?: SessionFailureKind },
  now: string,
): RuntimeDecision {
  if (previous === undefined) return { kind: "accept" };
  if (next.sequence < previous.sequence) return { kind: "reject", reason: "stale_sequence" };
  if (next.sequence === previous.sequence) {
    const same =
      next.state === previous.state &&
      next.exitCode === previous.exitCode &&
      next.failureKind === previous.failureKind;
    return same ? { kind: "idempotent" } : { kind: "reject", reason: "conflict" };
  }
  if (isFinalRuntimeState(previous.state)) return { kind: "reject", reason: "final" };
  const elapsed = Date.parse(now) - Date.parse(previous.reportedAt);
  if (elapsed < SESSION_REPORT_MIN_INTERVAL_MS) return { kind: "reject", reason: "rate_limited" };
  return { kind: "accept" };
}

const HARNESS_CANONICAL: Record<string, string> = {
  codex: "codex",
  claude: "claude-code",
  "claude-code": "claude-code",
  opencode: "opencode",
};

/** True when the session harness is the agent harness or an existing alias. */
export function harnessesMatch(agentHarness: string, sessionHarness: string): boolean {
  if (agentHarness === sessionHarness) return true;
  const agent = HARNESS_CANONICAL[agentHarness];
  const session = HARNESS_CANONICAL[sessionHarness];
  return agent !== undefined && agent === session;
}

export interface RuntimeReportInput {
  state: string;
  sequence: number;
  exitCode?: number;
  failureKind?: string;
}

/**
 * Validates one supervisor report and returns the row to store.
 * An idempotent repeat returns the stored row and must not be written again.
 */
export function prepareRuntimeReport(
  session: { id: string; workspaceId: string; taskId?: string; endedAt?: string },
  previous: AgentSessionRuntimeReport | undefined,
  input: RuntimeReportInput,
  now: string,
): { write: boolean; report: AgentSessionRuntimeReport } {
  if (session.taskId === undefined) {
    throw new ValidationError("A runtime report requires a session attached to a task", { field: "taskId" });
  }
  if (!SESSION_RUNTIME_STATES.includes(input.state as SessionRuntimeState)) {
    throw new ValidationError("Unknown session runtime state", { field: "state" });
  }
  const state = input.state as SessionRuntimeState;
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    throw new ValidationError("sequence must be a positive integer", { field: "sequence" });
  }
  const failureKind = normalizeFailureKind(input.failureKind);
  if (input.failureKind !== undefined && failureKind === undefined) {
    throw new ValidationError("Unknown session failure kind", { field: "failureKind" });
  }
  const final = isFinalRuntimeState(state);
  if (!final && (input.exitCode !== undefined || failureKind !== undefined)) {
    throw new ValidationError("exit facts belong on a final runtime report", { field: "state" });
  }
  if (state === "failed" && failureKind === undefined) {
    throw new ValidationError("A failed report needs a failure kind", { field: "failureKind" });
  }
  if (input.exitCode !== undefined && (!Number.isSafeInteger(input.exitCode) || input.exitCode < 0 || input.exitCode > 255)) {
    throw new ValidationError("exitCode must be an integer from 0 to 255", { field: "exitCode" });
  }
  if (session.endedAt !== undefined && !final) {
    throw new ValidationError("An ended session only accepts a final runtime report", { field: "state" });
  }
  const decision = decideRuntimeReport(
    previous,
    { sequence: input.sequence, state, exitCode: input.exitCode, failureKind },
    now,
  );
  if (decision.kind === "idempotent" && previous !== undefined) {
    return { write: false, report: previous };
  }
  if (decision.kind === "reject") {
    if (decision.reason === "rate_limited") {
      throw new ValidationError("Session runtime reports are limited to one every 5 seconds", { field: "sequence" });
    }
    throw new Conflict("Session runtime report was rejected", { reason: decision.reason, field: "sequence" });
  }
  return {
    write: true,
    report: {
      sessionId: session.id,
      workspaceId: session.workspaceId,
      taskId: session.taskId,
      state,
      origin: "local_supervisor",
      sequence: input.sequence,
      reportedAt: now,
      ...(final ? {} : { expiresAt: addMilliseconds(now, SESSION_LEASE_MS) }),
      ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
      ...(failureKind === undefined ? {} : { failureKind }),
    },
  };
}
