/**
 * Isolated GitHub Actions `rerun-failed-jobs` stub (ACT-001 §5.1).
 *
 * SIMULATED / FIXTURE EVIDENCE. This is not live GitHub, not a product
 * runner, and not a daemon. Its only authority is the synthetic allowlist
 * in docs/evidence/act-001/step-0/pilot-allowlist.json. Campfire stores none
 * of the simulated credential and has no execute/run/GitHub dispatch endpoint.
 *
 * The client validates the allowlisted target, inspects the failed completed
 * run, then submits POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs
 * at most once. A lost response records `unknown` and must not POST again.
 */
import { ACT001 } from "./seed.js";

export const STUB_AUTHORITY_LABEL =
  "SIMULATED / FIXTURE EVIDENCE — not live GitHub, not human demand, not a Campfire credential";

export const SIMULATED_GITHUB_CREDENTIAL = "SIMULATED-GITHUB-TOKEN-FIXTURE-ONLY";
export const GITHUB_API_VERSION = "2022-11-28";
export const RERUN_FAILED_JOBS_PATH = "/repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs";

export type StubSubmitOutcome = "accepted" | "definite_failure" | "unknown";

export interface StubRunState {
  owner: string;
  repo: string;
  repositoryId: string;
  workflowId: string;
  runId: string;
  headSha: string;
  attempt: number;
  status: "completed" | "in_progress" | "queued";
  conclusion: "failure" | "success" | "cancelled" | "skipped" | null;
}

export interface StubTarget {
  repositoryId: string;
  repositoryName: string;
  workflowId: string;
  runId: string;
  commitSha: string;
  expectedAttempt: number;
}

export interface StubSubmitResult {
  label: typeof STUB_AUTHORITY_LABEL;
  outcome: StubSubmitOutcome;
  /** True only when the stub recorded a simulated HTTP POST. */
  posted: boolean;
  /** True when the stub would have created a new attempt (accepted or lost-response). */
  dispatched: boolean;
  reason: string;
  httpStatus?: number;
  apiVersion: typeof GITHUB_API_VERSION;
  path: string;
}

export interface GithubRerunStub {
  readonly label: typeof STUB_AUTHORITY_LABEL;
  inspect(target: StubTarget): { ok: true; run: StubRunState } | { ok: false; reason: string };
  submitRerunFailedJobs(target: StubTarget, credential: string): StubSubmitResult;
  postCount(runId?: string): number;
}

const ALLOWLIST: StubTarget = { ...ACT001.target };

function targetKey(target: StubTarget): string {
  return `${target.repositoryId}:${target.workflowId}:${target.runId}:${target.commitSha}:${target.expectedAttempt}`;
}

function matchesAllowlist(target: StubTarget): boolean {
  return (
    target.repositoryId === ALLOWLIST.repositoryId &&
    target.repositoryName === ALLOWLIST.repositoryName &&
    target.workflowId === ALLOWLIST.workflowId &&
    target.runId === ALLOWLIST.runId &&
    target.commitSha === ALLOWLIST.commitSha &&
    target.expectedAttempt === ALLOWLIST.expectedAttempt
  );
}

function defaultRun(): StubRunState {
  const [owner, repo] = ALLOWLIST.repositoryName.split("/");
  return {
    owner: owner ?? "example-org",
    repo: repo ?? "verification-sandbox",
    repositoryId: ALLOWLIST.repositoryId,
    workflowId: ALLOWLIST.workflowId,
    runId: ALLOWLIST.runId,
    headSha: ALLOWLIST.commitSha,
    attempt: ACT001.target.observedFailedAttempt,
    status: "completed",
    conclusion: "failure",
  };
}

export function createGithubRerunStub(options?: {
  mode?: StubSubmitOutcome;
  run?: Partial<StubRunState>;
}): GithubRerunStub {
  const mode = options?.mode ?? "accepted";
  const run: StubRunState = { ...defaultRun(), ...options?.run };
  const postedKeys = new Set<string>();
  const posts: string[] = [];

  function inspect(target: StubTarget): { ok: true; run: StubRunState } | { ok: false; reason: string } {
    if (!matchesAllowlist(target)) {
      return { ok: false, reason: "target is not the allowlisted synthetic verification run" };
    }
    if (target.repositoryId !== run.repositoryId || target.workflowId !== run.workflowId || target.runId !== run.runId) {
      return { ok: false, reason: "provider run identity drifted from the approved target" };
    }
    if (target.commitSha !== run.headSha) {
      return { ok: false, reason: "commit SHA drifted from the approved target" };
    }
    if (run.status !== "completed" || run.conclusion !== "failure") {
      return { ok: false, reason: "run is not a completed failure; refusing dispatch" };
    }
    if (run.attempt + 1 !== target.expectedAttempt) {
      return { ok: false, reason: `observed attempt ${run.attempt} would not produce expectedAttempt ${target.expectedAttempt}` };
    }
    return { ok: true, run: { ...run } };
  }

  return {
    label: STUB_AUTHORITY_LABEL,
    inspect,
    submitRerunFailedJobs(target, credential) {
      const path = `/repos/${run.owner}/${run.repo}/actions/runs/${target.runId}/rerun-failed-jobs`;
      const base = {
        label: STUB_AUTHORITY_LABEL,
        apiVersion: GITHUB_API_VERSION,
        path,
      } as const;
      if (credential !== SIMULATED_GITHUB_CREDENTIAL) {
        return {
          ...base,
          outcome: "definite_failure",
          posted: false,
          dispatched: false,
          reason: "simulated credential rejected; no dispatch",
          httpStatus: 401,
        };
      }
      const checked = inspect(target);
      if (!checked.ok) {
        return {
          ...base,
          outcome: "definite_failure",
          posted: false,
          dispatched: false,
          reason: checked.reason,
        };
      }
      const key = targetKey(target);
      if (postedKeys.has(key)) {
        return {
          ...base,
          outcome: "unknown",
          posted: false,
          dispatched: false,
          reason: "a prior POST was already recorded for this run/attempt; refusing a second POST after a lost response",
        };
      }
      if (mode === "definite_failure") {
        return {
          ...base,
          outcome: "definite_failure",
          posted: false,
          dispatched: false,
          reason: "provider refused the rerun before dispatch (simulated 422)",
          httpStatus: 422,
        };
      }
      postedKeys.add(key);
      posts.push(key);
      if (mode === "unknown") {
        return {
          ...base,
          outcome: "unknown",
          posted: true,
          dispatched: true,
          reason: "simulated POST left the client; the HTTP response was lost. Do not POST again.",
        };
      }
      return {
        ...base,
        outcome: "accepted",
        posted: true,
        dispatched: true,
        reason: "simulated POST accepted; this is submission only, not verification success",
        httpStatus: 201,
      };
    },
    postCount(runId) {
      if (runId === undefined) return posts.length;
      return posts.filter((key) => key.includes(`:${runId}:`)).length;
    },
  };
}

/**
 * Client-owned submit-once procedure. Campfire is not called here.
 * Record the returned outcome with `record_action_outcome` afterwards.
 */
export function submitAllowlistedRerunOnce(
  stub: GithubRerunStub,
  target: StubTarget,
  credential: string = SIMULATED_GITHUB_CREDENTIAL,
): StubSubmitResult {
  return stub.submitRerunFailedJobs(target, credential);
}
