/**
 * Minimal structural types for the Cloudflare D1 binding.
 *
 * Defined locally (instead of `@cloudflare/workers-types`) so `tsc --noEmit`
 * and Vitest pass without generating `worker-configuration.d.ts`. Shapes
 * follow the current D1 Workers Binding API docs (prepare/bind/first/all/run,
 * database batch/exec).
 *
 * The Analytics Engine dataset type is declared once, next to the adapter that
 * uses it, and re-exported here so `CampfireWorkerEnv` stays the single place
 * the Worker's bindings are described.
 */
import type { AnalyticsEngineDataset, RateLimiterBinding } from "./telemetry.js";

export type { AnalyticsEngineDataset, RateLimiterBinding };

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
  exec(query: string): Promise<unknown>;
}

/** Workers Assets binding (`[assets] binding = "ASSETS"`). */
export interface AssetsFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface CampfireWorkerEnv {
  DB: D1Database;
  /** Optional for API-only isolated deployments. */
  ASSETS?: AssetsFetcher;
  /**
   * Anonymous product telemetry (TEL-001). Optional by design: a deployment
   * without the binding still serves the installer and accepts ingestion,
   * reporting `recorded: false` instead of failing.
   */
  TELEMETRY?: AnalyticsEngineDataset;
  /**
   * Per-source budget for the anonymous ingestion route
   * (`[[ratelimits]]`). Optional for the same reason: with no binding the
   * route is still open, exactly as it was before the limit existed.
   */
  TELEMETRY_RATE_LIMITER?: RateLimiterBinding;
  /** Dedicated invitation budget; deployed Workers refuse joins when absent. */
  INVITATION_RATE_LIMITER?: RateLimiterBinding;
  /** Optional bounded-operations dataset; records closed route class and status only. */
  ALPHA_OPS?: AnalyticsEngineDataset;
  /** Exact "1" permits expensive writes for published alpha teams only. */
  CAMPFIRE_ALPHA_EXPENSIVE_WRITES?: string;
  /**
   * Integrity outcome measurement (`[[analytics_engine_datasets]]`).
   * Records only the outcome, reason, and event name — never an id, address,
   * or token. Optional like `TELEMETRY`.
   */
  TELEMETRY_OPS?: AnalyticsEngineDataset;
  /**
   * Per-installation budget for the ingestion route (`[[ratelimits]]`).
   * Keyed by an opaque hash of the installation id; the raw id never reaches
   * the binding. Optional; absent means no per-installation limit.
   */
  TELEMETRY_ID_RATE_LIMITER?: RateLimiterBinding;
  /**
   * Integrity gate mode: `enforce`, `shadow`, or `off`. Empty or unset
   * defaults to `shadow` (the guard measures but does not reject). Unknown
   * values are ignored and fall back to the default.
   */
  TELEMETRY_GATE_MODE?: string;
  CAMPFIRE_WEBHOOK_ID?: string;
  CAMPFIRE_WEBHOOK_URL?: string;
  CAMPFIRE_WEBHOOK_SECRET?: string;
  CAMPFIRE_WEBHOOK_EVENTS?: string;
  CAMPFIRE_WEBHOOK_WORKSPACES?: string;
  /** Instance-operator credential for GET /v1/bridge. Not an actor token. */
  CAMPFIRE_BRIDGE_TOKEN?: string;
  CAMPFIRE_GITHUB_SOURCE_ID?: string;
  CAMPFIRE_GITHUB_SOURCE_WORKSPACE_ID?: string;
  CAMPFIRE_GITHUB_SOURCE_REPOSITORY_ID?: string;
  CAMPFIRE_GITHUB_SOURCE_REPOSITORY_NAME?: string;
  CAMPFIRE_GITHUB_SOURCE_WORKFLOW_ID?: string;
  CAMPFIRE_GITHUB_SOURCE_KIND?: string;
  CAMPFIRE_GITHUB_SOURCE_SECRET?: string;
  CAMPFIRE_GITHUB_SOURCE_AGENT_ID?: string;
  CAMPFIRE_GITHUB_SOURCE_SESSION_ID?: string;
  /**
   * SHR-001 private-alpha gate. Enrollment creates a new hosted owner
   * namespace, so the write route stays closed unless this is exactly "1".
   * Public self-service requires the recorded abuse and cost review.
   */
  CAMPFIRE_PUBLICATION_ALPHA?: string;
  /** Per-source enrollment budget per rolling 24 hours. Defaults to 5. */
  CAMPFIRE_PUBLICATION_ENROLLMENTS_PER_DAY?: string;
  /**
   * SHA-256 of the operator-held rehearsal admission code. Required when the
   * alpha flag is on; store it as a Worker secret, never in wrangler.toml.
   */
  CAMPFIRE_PUBLICATION_REHEARSAL_CODE_HASH?: string;
  /** Max admission attempts per source per UTC hour. Defaults to 30. */
  CAMPFIRE_PUBLICATION_ADMISSION_ATTEMPTS_PER_HOUR?: string;
}
