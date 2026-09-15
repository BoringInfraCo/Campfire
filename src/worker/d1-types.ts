/**
 * Minimal structural types for the Cloudflare D1 binding.
 *
 * Defined locally (instead of `@cloudflare/workers-types`) so `tsc --noEmit`
 * and Vitest pass without generating `worker-configuration.d.ts`. Shapes
 * follow the current D1 Workers Binding API docs (prepare/bind/first/all/run,
 * database batch/exec).
 */

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<{ success: boolean }>;
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
  ASSETS: AssetsFetcher;
}
