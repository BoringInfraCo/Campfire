import Database from "better-sqlite3";
import type { D1Database, D1PreparedStatement } from "../../src/worker/d1-types.js";

/** Executes the real SQL and atomic D1 batch contract on SQLite, not canned results. */
export function sqliteD1(database = new Database(":memory:")): {
  database: Database.Database;
  binding: D1Database;
  beforeBatch?: () => void;
} {
  database.pragma("foreign_keys = ON");
  const state: ReturnType<typeof sqliteD1> = {
    database,
    binding: {
      prepare(sql) {
        let values: unknown[] = [];
        const statement = {
          bind(...parameters: unknown[]) { values = parameters; return statement; },
          async first<T>(column?: string) {
            const row = database.prepare(sql).get(...values) as Record<string, unknown> | undefined;
            return (column === undefined ? row ?? null : row?.[column] ?? null) as T | null;
          },
          async all<T>() {
            return { success: true, results: database.prepare(sql).all(...values) as T[] };
          },
          async run() { return statement.execute(); },
          execute() {
            const result = database.prepare(sql).run(...values);
            return { success: true, meta: { changes: result.changes } };
          },
        };
        return statement;
      },
      async batch(statements) {
        // Give independent callers a chance to queue competing claims before
        // the database serializes each entire transaction.
        await Promise.resolve();
        state.beforeBatch?.();
        return database.transaction(() => statements.map((statement) =>
          (statement as D1PreparedStatement & { execute(): unknown }).execute()))();
      },
      async exec(sql) { database.exec(sql); return { success: true }; },
    },
  };
  return state;
}
