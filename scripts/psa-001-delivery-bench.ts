/**
 * PSA-001 delivery-read benchmark: before vs after.
 *
 * The contract (§3) requires a *repeatable* measurement with query counts, due
 * rows read, and latency for an empty queue and a backlog, and says to claim an
 * improvement only for the workload actually measured. This script measures the
 * local SQLite path against both query forms on the same fixture, so the
 * comparison is like-for-like.
 *
 *   npx tsx scripts/psa-001-delivery-bench.ts
 *
 * This is a local SQLite measurement. It is NOT a production D1 measurement and
 * NOT a full pump benchmark: it isolates the delivery *read*, which is what P1
 * changed. D1 rows read are D1 rows billed, so the row-count column is the
 * figure that transfers; the latency column does not.
 */
import Database from "better-sqlite3";
import { applyMigrations } from "../src/store/migrations.js";
import { WEBHOOK_DELIVERY_BATCH } from "../src/bridge/retry.js";

const NOW = "2026-01-01T00:00:00.000Z";
const ITERATIONS = 20;
const BACKLOG = 10_000;

/** The pre-PSA-001 query: select every due row, then trim in the caller. */
const BEFORE_SQL = `SELECT * FROM webhook_deliveries
  WHERE bridge_id = ?
    AND config_fingerprint = ?
    AND (
      (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
      OR (status = 'delivering' AND claimed_at IS NOT NULL AND claimed_at <= ?)
    )
  ORDER BY created_at, rowid`;

/** The post-PSA-001 query: identical, plus the sweep's batch bound in SQL. */
const AFTER_SQL = `${BEFORE_SQL}
  LIMIT ?`;

function seed(rows: number): Database.Database {
  const db = new Database(":memory:");
  applyMigrations(db);
  // FK chain: organization -> team -> human -> workspace -> contribution -> event.
  db.prepare(`INSERT INTO organizations (id, name, created_at) VALUES ('org_bench', 'Bench', ?)`).run(NOW);
  db.prepare(`INSERT INTO teams (id, organization_id, name, created_at) VALUES ('team_bench', 'org_bench', 'Bench', ?)`).run(NOW);
  db.prepare(
    `INSERT INTO humans (id, team_id, display_name, external_identity, created_at)
     VALUES ('hum_bench', 'team_bench', 'Bench', NULL, ?)`,
  ).run(NOW);
  db.prepare(
    `INSERT INTO workspaces (id, team_id, name, description, status, created_by_actor_id,
       created_by_actor_type, created_at, updated_at)
     VALUES ('ws_bench', 'team_bench', 'Bench', NULL, 'active', 'hum_bench', 'human', ?, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO contributions (id, workspace_id, actor_id, actor_type, action, object_type,
       object_id, created_at, append_position)
     VALUES ('con_bench', 'ws_bench', 'hum_bench', 'human', 'create', 'finding', 'find_bench', ?, 1)`,
  ).run(NOW);
  db.prepare(
    `INSERT INTO domain_events (id, spec_version, type, occurred_at, workspace_id, actor_id,
       actor_type, subject_type, subject_id, summary, data, body, contribution_id, created_at)
     VALUES ('evt_bench', '1.0', 'finding.recorded', ?, 'ws_bench', 'hum_bench', 'human',
       'finding', 'find_bench', 'bench', '{}', '{}', 'con_bench', ?)`,
  ).run(NOW, NOW);

  const insert = db.prepare(
    `INSERT INTO webhook_deliveries (id, event_id, bridge_id, status, attempt_count,
       next_attempt_at, claim_token, claimed_at, delivered_at, last_error,
       config_fingerprint, created_at, updated_at)
     VALUES (?, 'evt_bench', 'bridge_bench', 'pending', 0, NULL, NULL, NULL, NULL, NULL, 'fp', ?, ?)`,
  );
  for (let i = 0; i < rows; i += 1) {
    // Strictly increasing created_at keeps ORDER BY deterministic and oldest-first.
    insert.run(`dlv_${String(i).padStart(6, "0")}`, new Date(Date.parse(NOW) + i).toISOString(), NOW);
  }
  return db;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function measure(label: string, rows: number): void {
  const db = seed(rows);
  const before = db.prepare(BEFORE_SQL);
  const after = db.prepare(`${AFTER_SQL}`);

  const beforeTimes: number[] = [];
  const afterTimes: number[] = [];
  let beforeRowCount = 0;
  let afterRowCount = 0;

  for (let i = 0; i < ITERATIONS; i += 1) {
    // Drain the pump's own working set, not the whole read: this is what the
    // pre-fix pump did with the result (it stopped after `limit` claims).
    const t0 = performance.now();
    beforeRowCount = before.all("bridge_bench", "fp", NOW, NOW).length;
    beforeTimes.push(performance.now() - t0);

    const t1 = performance.now();
    afterRowCount = after.all("bridge_bench", "fp", NOW, NOW, WEBHOOK_DELIVERY_BATCH).length;
    afterTimes.push(performance.now() - t1);
  }

  const beforeMedian = median(beforeTimes);
  const afterMedian = median(afterTimes);

  console.log(`\n${label} (${ITERATIONS} iterations)`);
  console.log(`  rows in queue        ${rows}`);
  console.log(`  before: rows read    ${beforeRowCount}   median ${beforeMedian.toFixed(3)} ms`);
  console.log(`  after:  rows read    ${afterRowCount}    median ${afterMedian.toFixed(3)} ms`);
  if (beforeMedian > 0) {
    console.log(`  latency ratio        ${(beforeMedian / afterMedian).toFixed(2)}x`);
  }
  console.log(`  queries per sweep    1 -> 1 (unchanged; the bound is rows, not round trips)`);

  db.close();
}

console.log("PSA-001 delivery read: before vs after");
console.log(`batch size = ${WEBHOOK_DELIVERY_BATCH}`);
measure("empty queue", 0);
measure(`backlog`, BACKLOG);
console.log("\nNote: local SQLite only. Not a production D1 measurement and not a full pump benchmark.");
