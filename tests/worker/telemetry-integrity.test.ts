/**
 * Server-side telemetry integrity: the D1 idempotency guard and the gated
 * ingestion flow.
 *
 * The client already bounds `activated`/`active` locally; that stops honest
 * replays but nothing else. These tests cover the server-side half:
 *
 *   - `TelemetryGuard` over real SQL (via the SQLite-backed D1 stand-in):
 *     single-use install tokens, install/activation/active claims, expiry
 *     pruning, and the privacy shape (digests only — no raw id or token in
 *     any row).
 *   - `handleTelemetryEvent` with a fake guard: enforce vs shadow duplicates,
 *     `no_install`, token verdicts, the release-time check, the
 *     per-installation budget, and the ops dataset carrying no id or address.
 */
import { describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { sqliteD1 } from "../helpers/sqlite-d1.js";
import { V9_SQL } from "../../src/store/telemetry-integrity-schema.js";
import {
  activeClaimDate,
  createD1TelemetryGuard,
  type GuardD1Database,
  type TelemetryGuard,
} from "../../src/telemetry/guard.js";
import {
  isTelemetryInstallationId,
  parseTelemetryEventV1,
  TELEMETRY_LEGACY_EVENTS,
  TELEMETRY_TEST_INSTALLATION_IDS,
  telemetryDataPoint,
} from "../../src/telemetry/contract.js";
import {
  handleTelemetryEvent,
  type AnalyticsEngineDataset,
  type RateLimiterBinding,
  type TelemetryIngestOptions,
} from "../../src/worker/telemetry.js";

const ID_A = "11111111-2222-4333-8444-555555555555";
const ID_B = "22222222-3333-4444-8555-666666666666";
const TOKEN_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TOKEN_B = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
/** After every known release (1.25.0 shipped 2026-10-21T01:06:22Z). */
const NOW_AFTER = Date.parse("2026-10-22T00:00:00Z");
const NOW_AFTER_ISO = new Date(NOW_AFTER).toISOString();
/** After 1.24.0 but before the 1.25.0 release instant. */
const NOW_BEFORE_125 = Date.parse("2026-10-20T12:00:00Z");

interface DataPoint {
  indexes?: string[];
  blobs?: string[];
  doubles?: number[];
}

function fakeDataset(): { dataset: AnalyticsEngineDataset; points: DataPoint[] } {
  const points: DataPoint[] = [];
  return {
    points,
    dataset: {
      writeDataPoint(point) {
        points.push(point);
      },
    },
  };
}

/** Limiter that allows a fixed number of calls, then refuses. */
function limiter(allow: number): RateLimiterBinding {
  let remaining = allow;
  return {
    async limit() {
      if (remaining > 0) {
        remaining -= 1;
        return { success: true };
      }
      return { success: false };
    },
  };
}

function payload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    event: "activated",
    installationId: ID_A,
    campfireVersion: "1.9.1",
    os: "darwin",
    arch: "arm64",
    surface: "cli",
    ...overrides,
  });
}

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://campfire.test/v1/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

interface FakeGuardState {
  tokens: Set<string>;
  installs: Set<string>;
  activations: Set<string>;
  actives: Set<string>;
  broken: boolean;
}

function fakeGuardState(): FakeGuardState {
  return { tokens: new Set(), installs: new Set(), activations: new Set(), actives: new Set(), broken: false };
}

/** In-memory guard with the same verdict vocabulary as the D1 guard. */
function fakeGuard(state: FakeGuardState): TelemetryGuard {
  return {
    async issueInstallToken({ token }) {
      if (state.broken) return "error";
      state.tokens.add(token);
      return "issued";
    },
    async completeInstall({ installationId, installToken }) {
      if (state.broken) return "error";
      if (installToken === undefined || !state.tokens.has(installToken)) return "invalid_token";
      state.tokens.delete(installToken);
      if (state.installs.has(installationId)) return "duplicate";
      state.installs.add(installationId);
      return "accepted";
    },
    async claimInstallDirect({ installationId }) {
      if (state.broken) return "error";
      if (state.installs.has(installationId)) return "duplicate";
      state.installs.add(installationId);
      return "claimed";
    },
    async claimActivation({ installationId }) {
      if (state.broken) return "error";
      if (!state.installs.has(installationId)) return "no_install";
      if (state.activations.has(installationId)) return "duplicate";
      state.activations.add(installationId);
      return "claimed";
    },
    async claimActive({ installationId, date }) {
      if (state.broken) return "error";
      if (!state.installs.has(installationId)) return "no_install";
      const key = `${installationId}|${date}`;
      if (state.actives.has(key)) return "duplicate";
      state.actives.add(key);
      return "claimed";
    },
  };
}

function throwingGuardDb(): GuardD1Database {
  const throwing = (): never => {
    throw new Error("d1 unavailable");
  };
  return { prepare: () => ({ bind: () => ({ first: async () => throwing(), run: async () => throwing() }) }) };
}

async function tableDump(database: Database.Database): Promise<string> {
  const claims = database.prepare("SELECT kind, claim_key, claimed_at FROM telemetry_claims").all() as Array<Record<string, unknown>>;
  const tokens = database.prepare("SELECT token_hash, issued_at, expires_at, consumed_at FROM telemetry_install_tokens").all() as Array<Record<string, unknown>>;
  return JSON.stringify({ claims, tokens });
}

describe("d1 telemetry guard", () => {
  it("accepts one install per token and duplicates a replayed installation id", async () => {
    const state = sqliteD1();
    state.database.exec(V9_SQL);
    const guard = createD1TelemetryGuard(state.binding);
    expect(await guard.issueInstallToken({ token: TOKEN_A, issuedAt: NOW_AFTER_ISO, expiresAt: "2026-11-22T00:00:00.000Z" })).toBe("issued");
    expect(await guard.completeInstall({ installationId: ID_A, installToken: TOKEN_A, now: NOW_AFTER_ISO })).toBe("accepted");

    // The same installation id under a fresh token is a duplicate, not a
    // second count — and the fresh token is still consumed (single-use).
    expect(await guard.issueInstallToken({ token: TOKEN_B, issuedAt: NOW_AFTER_ISO, expiresAt: "2026-11-22T00:00:00.000Z" })).toBe("issued");
    expect(await guard.completeInstall({ installationId: ID_A, installToken: TOKEN_B, now: NOW_AFTER_ISO })).toBe("duplicate");
    const consumed = state.database.prepare("SELECT consumed_at FROM telemetry_install_tokens").all() as Array<{ consumed_at: string | null }>;
    expect(consumed.every((row) => row.consumed_at !== null)).toBe(true);
  });

  it("rejects a missing, unknown, or expired token without touching claims", async () => {
    const state = sqliteD1();
    state.database.exec(V9_SQL);
    const guard = createD1TelemetryGuard(state.binding);
    expect(await guard.completeInstall({ installationId: ID_A, now: NOW_AFTER_ISO })).toBe("invalid_token");
    expect(await guard.completeInstall({ installationId: ID_A, installToken: TOKEN_A, now: NOW_AFTER_ISO })).toBe("invalid_token");
    expect(await guard.issueInstallToken({ token: TOKEN_A, issuedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-09-02T00:00:00.000Z" })).toBe("issued");
    expect(await guard.completeInstall({ installationId: ID_A, installToken: TOKEN_A, now: NOW_AFTER_ISO })).toBe("invalid_token");
    const count = state.database.prepare("SELECT COUNT(*) AS n FROM telemetry_claims").get() as { n: number };
    expect(count.n).toBe(0);
  });

  it("claims activation once and only after install", async () => {
    const state = sqliteD1();
    state.database.exec(V9_SQL);
    const guard = createD1TelemetryGuard(state.binding);
    expect(await guard.claimActivation({ installationId: ID_A })).toBe("no_install");
    await guard.issueInstallToken({ token: TOKEN_A, issuedAt: NOW_AFTER_ISO, expiresAt: "2026-11-22T00:00:00.000Z" });
    expect(await guard.completeInstall({ installationId: ID_A, installToken: TOKEN_A, now: NOW_AFTER_ISO })).toBe("accepted");
    expect(await guard.claimActivation({ installationId: ID_A })).toBe("claimed");
    expect(await guard.claimActivation({ installationId: ID_A })).toBe("duplicate");
  });

  it("claims active once per UTC day and only after install", async () => {
    const state = sqliteD1();
    state.database.exec(V9_SQL);
    const guard = createD1TelemetryGuard(state.binding);
    expect(await guard.claimActive({ installationId: ID_A, date: "2026-10-22" })).toBe("no_install");
    await guard.issueInstallToken({ token: TOKEN_A, issuedAt: NOW_AFTER_ISO, expiresAt: "2026-11-22T00:00:00.000Z" });
    await guard.completeInstall({ installationId: ID_A, installToken: TOKEN_A, now: NOW_AFTER_ISO });
    expect(activeClaimDate(new Date(NOW_AFTER))).toBe("2026-10-22");
    expect(await guard.claimActive({ installationId: ID_A, date: "2026-10-22" })).toBe("claimed");
    expect(await guard.claimActive({ installationId: ID_A, date: "2026-10-22" })).toBe("duplicate");
    expect(await guard.claimActive({ installationId: ID_A, date: "2026-10-23" })).toBe("claimed");
  });

  it("stores digests only — no raw installation id or token in any row", async () => {
    const state = sqliteD1();
    state.database.exec(V9_SQL);
    const guard = createD1TelemetryGuard(state.binding);
    await guard.issueInstallToken({ token: TOKEN_A, issuedAt: NOW_AFTER_ISO, expiresAt: "2026-11-22T00:00:00.000Z" });
    await guard.completeInstall({ installationId: ID_A, installToken: TOKEN_A, now: NOW_AFTER_ISO });
    await guard.claimActivation({ installationId: ID_A });
    await guard.claimActive({ installationId: ID_A, date: "2026-10-22" });
    const dump = await tableDump(state.database);
    expect(dump).not.toContain(ID_A);
    expect(dump).not.toContain(TOKEN_A);
  });

  it("fails open when d1 throws", async () => {
    const guard = createD1TelemetryGuard(throwingGuardDb());
    expect(await guard.issueInstallToken({ token: TOKEN_A, issuedAt: NOW_AFTER_ISO, expiresAt: NOW_AFTER_ISO })).toBe("error");
    expect(await guard.completeInstall({ installationId: ID_A, installToken: TOKEN_A, now: NOW_AFTER_ISO })).toBe("error");
    expect(await guard.claimActivation({ installationId: ID_A })).toBe("error");
    expect(await guard.claimActive({ installationId: ID_A, date: "2026-10-22" })).toBe("error");
  });
});

describe("contract: install token and reserved names", () => {
  it("accepts a uuid token on install_completed and keeps it out of blobs", () => {
    const parsed = parseTelemetryEventV1(JSON.parse(payload({ event: "install_completed", installToken: TOKEN_A })));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.event.installToken).toBe(TOKEN_A);
    const point = telemetryDataPoint(parsed.event);
    expect(JSON.stringify(point)).not.toContain(TOKEN_A);
    expect(point.blobs).toHaveLength(8);
  });

  it("rejects a token anywhere but install_completed, or a non-uuid token", () => {
    for (const event of ["activated", "active", "install_requested"]) {
      expect(parseTelemetryEventV1(JSON.parse(payload({ event, installToken: TOKEN_A })))).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
    expect(parseTelemetryEventV1(JSON.parse(payload({ event: "install_completed", installToken: "not-a-token" })))).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("keeps legacy event names rejected", () => {
    expect(TELEMETRY_LEGACY_EVENTS.length).toBeGreaterThan(0);
    for (const event of TELEMETRY_LEGACY_EVENTS) {
      expect(parseTelemetryEventV1(JSON.parse(payload({ event })))).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("reserves the documented test installation ids as well-formed uuids", () => {
    expect(TELEMETRY_TEST_INSTALLATION_IDS).toContain(ID_A);
    for (const id of TELEMETRY_TEST_INSTALLATION_IDS) {
      expect(isTelemetryInstallationId(id)).toBe(true);
    }
  });
});

describe("gated ingestion with a fake guard", () => {
  function options(
    guardState: FakeGuardState,
    extra: Partial<TelemetryIngestOptions> = {},
  ): { options: TelemetryIngestOptions; main: DataPoint[]; ops: DataPoint[] } {
    const main = fakeDataset();
    const ops = fakeDataset();
    return {
      options: {
        dataset: main.dataset,
        opsDataset: ops.dataset,
        guard: fakeGuard(guardState),
        now: () => NOW_AFTER,
        ...extra,
      },
      main: main.points,
      ops: ops.points,
    };
  }

  it("deduplicates a replayed install in enforce and in shadow", async () => {
    for (const gateMode of ["enforce", "shadow"] as const) {
      const state = fakeGuardState();
      state.installs.add(ID_A);
      state.tokens.add(TOKEN_A);
      const { options: opts, main, ops } = options(state, { gateMode });
      const response = await handleTelemetryEvent(
        opts,
        post(payload({ event: "install_completed", campfireVersion: "1.25.0", installToken: TOKEN_A })),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, result: { recorded: false } });
      expect(main).toHaveLength(0);
      expect(ops).toEqual([
        { indexes: ["ingest_outcome"], blobs: ["deduplicated", "duplicate_install", "install_completed"], doubles: [1] },
      ]);
    }
  });

  it("rejects activated with no install in enforce, measures and continues in shadow", async () => {
    const enforced = options(fakeGuardState(), { gateMode: "enforce" });
    const denied = await handleTelemetryEvent(enforced.options, post(payload({ event: "activated" })));
    expect(await denied.json()).toEqual({ ok: true, result: { recorded: false } });
    expect(enforced.main).toHaveLength(0);
    expect(enforced.ops).toEqual([
      { indexes: ["ingest_outcome"], blobs: ["rejected", "no_install", "activated"], doubles: [1] },
    ]);

    // Shadow is the default when a guard is present: no gateMode passed.
    const shadowed = options(fakeGuardState());
    const allowed = await handleTelemetryEvent(shadowed.options, post(payload({ event: "activated" })));
    expect(await allowed.json()).toEqual({ ok: true, result: { recorded: true } });
    expect(shadowed.main).toHaveLength(1);
    expect(shadowed.ops).toEqual([
      { indexes: ["ingest_outcome"], blobs: ["would_reject", "no_install", "activated"], doubles: [1] },
    ]);
  });

  it("consumes a valid install token and accepts the install in both modes", async () => {
    for (const gateMode of ["enforce", "shadow"] as const) {
      const state = fakeGuardState();
      state.tokens.add(TOKEN_A);
      const { options: opts, main, ops } = options(state, { gateMode });
      const response = await handleTelemetryEvent(
        opts,
        post(payload({ event: "install_completed", campfireVersion: "1.25.0", installToken: TOKEN_A })),
      );
      expect(await response.json()).toEqual({ ok: true, result: { recorded: true } });
      expect(main).toHaveLength(1);
      expect(state.tokens.has(TOKEN_A)).toBe(false);
      expect(ops).toEqual([
        { indexes: ["ingest_outcome"], blobs: ["accepted", "ok", "install_completed"], doubles: [1] },
      ]);
    }
  });

  it("rejects a tokenless install in enforce and measures it in shadow", async () => {
    const enforced = options(fakeGuardState(), { gateMode: "enforce" });
    const denied = await handleTelemetryEvent(
      enforced.options,
      post(payload({ event: "install_completed", campfireVersion: "1.25.0" })),
    );
    expect(await denied.json()).toEqual({ ok: true, result: { recorded: false } });
    expect(enforced.main).toHaveLength(0);
    expect(enforced.ops).toEqual([
      { indexes: ["ingest_outcome"], blobs: ["rejected", "invalid_token", "install_completed"], doubles: [1] },
    ]);

    const shadowed = options(fakeGuardState(), { gateMode: "shadow" });
    const allowed = await handleTelemetryEvent(
      shadowed.options,
      post(payload({ event: "install_completed", campfireVersion: "1.25.0" })),
    );
    expect(await allowed.json()).toEqual({ ok: true, result: { recorded: true } });
    expect(shadowed.main).toHaveLength(1);
    expect(shadowed.ops).toEqual([
      { indexes: ["ingest_outcome"], blobs: ["would_reject", "invalid_token", "install_completed"], doubles: [1] },
    ]);
  });

  it("rejects a version whose release is in the future, and allows unknown versions", async () => {
    const enforced = options(fakeGuardState(), { gateMode: "enforce", now: () => NOW_BEFORE_125 });
    const denied = await handleTelemetryEvent(
      enforced.options,
      post(payload({ event: "activated", campfireVersion: "1.25.0" })),
    );
    expect(await denied.json()).toEqual({ ok: true, result: { recorded: false } });
    expect(enforced.main).toHaveLength(0);
    expect(enforced.ops).toEqual([
      { indexes: ["ingest_outcome"], blobs: ["rejected", "version_not_released", "activated"], doubles: [1] },
    ]);

    const shadowed = options(fakeGuardState(), { gateMode: "shadow", now: () => NOW_BEFORE_125 });
    const allowed = await handleTelemetryEvent(
      shadowed.options,
      post(payload({ event: "activated", campfireVersion: "1.25.0" })),
    );
    expect(await allowed.json()).toEqual({ ok: true, result: { recorded: true } });
    expect(shadowed.main).toHaveLength(1);
    expect(shadowed.ops).toEqual([
      { indexes: ["ingest_outcome"], blobs: ["would_reject", "version_not_released", "activated"], doubles: [1] },
    ]);

    // Unknown versions are honest possibilities: allowed, measured as such.
    const unknown = options(fakeGuardState(), { gateMode: "enforce" });
    const response = await handleTelemetryEvent(unknown.options, post(payload({ event: "activated", campfireVersion: "unknown" })));
    expect(await response.json()).toEqual({ ok: true, result: { recorded: false } });
    expect(unknown.main).toHaveLength(0);
    expect(unknown.ops).toEqual([
      { indexes: ["ingest_outcome"], blobs: ["rejected", "no_install", "activated"], doubles: [1] },
    ]);

    const installed = fakeGuardState();
    installed.installs.add(ID_A);
    const accepted = options(installed, { gateMode: "enforce" });
    const ok = await handleTelemetryEvent(accepted.options, post(payload({ event: "activated", campfireVersion: "unknown" })));
    expect(await ok.json()).toEqual({ ok: true, result: { recorded: true } });
    expect(accepted.ops).toEqual([
      { indexes: ["ingest_outcome"], blobs: ["accepted", "unknown_release", "activated"], doubles: [1] },
    ]);
  });

  it("limits per installation id with a 429 and fails open without a binding", async () => {
    const state = fakeGuardState();
    state.installs.add(ID_A);
    const { options: opts, main, ops } = options(state, { gateMode: "enforce", idRateLimiter: limiter(1) });
    const first = await handleTelemetryEvent(opts, post(payload({ event: "active" })));
    expect(first.status).toBe(200);
    const second = await handleTelemetryEvent(opts, post(payload({ event: "active" })));
    expect(second.status).toBe(429);
    expect(main).toHaveLength(1);
    expect(ops).toContainEqual(
      { indexes: ["ingest_outcome"], blobs: ["rejected", "rate_limited_id", "active"], doubles: [1] },
    );

    const open = options(state, { gateMode: "enforce" });
    const other = payload({ event: "active", installationId: ID_B });
    state.installs.add(ID_B);
    for (let index = 0; index < 3; index += 1) {
      const response = await handleTelemetryEvent(open.options, post(other));
      expect(response.status).toBe(200);
    }
  });

  it("fails open when the guard throws", async () => {
    const state = fakeGuardState();
    state.broken = true;
    const { options: opts, main } = options(state, { gateMode: "enforce" });
    const response = await handleTelemetryEvent(opts, post(payload({ event: "install_completed", campfireVersion: "1.25.0" })));
    expect(await response.json()).toEqual({ ok: true, result: { recorded: true } });
    expect(main).toHaveLength(1);
  });

  it("drops when no dataset is bound and records the floor in ops", async () => {
    const installed = fakeGuardState();
    installed.installs.add(ID_A);
    const noDataset = options(installed, { gateMode: "enforce", dataset: undefined });
    const dropped = await handleTelemetryEvent(noDataset.options, post(payload({ event: "activated" })));
    expect(await dropped.json()).toEqual({ ok: true, result: { recorded: false } });
    expect(noDataset.ops).toEqual([
      { indexes: ["ingest_outcome"], blobs: ["dropped", "missing_dataset", "activated"], doubles: [1] },
    ]);

    const floor = options(fakeGuardState(), { gateMode: "enforce" });
    const forged = await handleTelemetryEvent(floor.options, post(payload({ event: "activated", campfireVersion: "1.2.0" })));
    expect(await forged.json()).toEqual({ ok: true, result: { recorded: false } });
    expect(floor.main).toHaveLength(0);
    expect(floor.ops).toEqual([
      { indexes: ["ingest_outcome"], blobs: ["dropped", "floor", "activated"], doubles: [1] },
    ]);
  });

  it("keeps installation ids and addresses out of every ops point", async () => {
    const state = fakeGuardState();
    state.installs.add(ID_A);
    const { options: opts, main, ops } = options(state, {
      gateMode: "shadow",
      idRateLimiter: limiter(100),
    });
    const events = [
      payload({ event: "install_completed", campfireVersion: "1.25.0", installToken: TOKEN_A }),
      payload({ event: "activated" }),
      payload({ event: "active" }),
      payload({ event: "activated", installationId: ID_B }),
    ];
    for (const body of events) {
      await handleTelemetryEvent(opts, post(body, { "CF-Connecting-IP": "203.0.113.7" }));
    }
    expect(main.length).toBeGreaterThan(0);
    expect(ops.length).toBe(events.length);
    // The main dataset carries the installation id in blob8 by design
    // (deduplicated installation counts). The ops dataset must never see an
    // id, a token, or an address — only the outcome, reason, and event name.
    const leaked = ops.map((point) => JSON.stringify(point)).join("\n");
    for (const secret of [ID_A, ID_B, TOKEN_A, "203.0.113.7"]) {
      expect(leaked, secret).not.toContain(secret);
    }
    for (const point of ops) {
      expect(point.indexes).toEqual(["ingest_outcome"]);
      expect(point.blobs).toHaveLength(3);
      expect(point.doubles).toEqual([1]);
    }
  });

  it("leaves the gate off when no guard is configured", async () => {
    const main = fakeDataset();
    const ops = fakeDataset();
    const response = await handleTelemetryEvent(
      { dataset: main.dataset, opsDataset: ops.dataset, now: () => NOW_AFTER },
      post(payload({ event: "activated", campfireVersion: "unknown" })),
    );
    expect(await response.json()).toEqual({ ok: true, result: { recorded: true } });
    expect(ops.points).toEqual([
      { indexes: ["ingest_outcome"], blobs: ["accepted", "ok", "activated"], doubles: [1] },
    ]);
  });
});

describe("package-manager bootstrap installs (brew/nix)", () => {
  function bootstrapOptions(
    guardState: FakeGuardState,
    extra: Partial<TelemetryIngestOptions> = {},
  ): { options: TelemetryIngestOptions; main: DataPoint[]; ops: DataPoint[] } {
    const main = fakeDataset();
    const ops = fakeDataset();
    return {
      options: {
        dataset: main.dataset,
        opsDataset: ops.dataset,
        guard: fakeGuard(guardState),
        now: () => NOW_AFTER,
        gateMode: "enforce",
        ...extra,
      },
      main: main.points,
      ops: ops.points,
    };
  }

  function installCompletedBody(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      schemaVersion: 1,
      event: "install_completed",
      installationId: ID_A,
      campfireVersion: "1.25.0",
      os: "darwin",
      arch: "arm64",
      ...overrides,
    });
  }

  it("accepts a tokenless brew install once via the direct claim", async () => {
    const { options: opts, main, ops } = bootstrapOptions(fakeGuardState());
    const response = await handleTelemetryEvent(opts, post(installCompletedBody({ installMethod: "brew" })));
    expect(await response.json()).toEqual({ ok: true, result: { recorded: true } });
    expect(main).toHaveLength(1);
    expect(main[0]?.blobs?.[5]).toBe("brew");
    expect(ops).toEqual([
      { indexes: ["ingest_outcome"], blobs: ["accepted", "bootstrap_brew", "install_completed"], doubles: [1] },
    ]);
  });

  it("accepts a tokenless nix install once via the direct claim", async () => {
    const { options: opts, main, ops } = bootstrapOptions(fakeGuardState());
    const response = await handleTelemetryEvent(opts, post(installCompletedBody({ installMethod: "nix" })));
    expect(await response.json()).toEqual({ ok: true, result: { recorded: true } });
    expect(main).toHaveLength(1);
    expect(main[0]?.blobs?.[5]).toBe("nix");
    expect(ops).toEqual([
      { indexes: ["ingest_outcome"], blobs: ["accepted", "bootstrap_nix", "install_completed"], doubles: [1] },
    ]);
  });

  it("deduplicates a replayed brew install", async () => {
    const state = fakeGuardState();
    const first = bootstrapOptions(state);
    await handleTelemetryEvent(first.options, post(installCompletedBody({ installMethod: "brew" })));
    expect(first.main).toHaveLength(1);

    const second = bootstrapOptions(state);
    const replay = await handleTelemetryEvent(second.options, post(installCompletedBody({ installMethod: "brew" })));
    expect(await replay.json()).toEqual({ ok: true, result: { recorded: false } });
    expect(second.main).toHaveLength(0);
    expect(second.ops).toEqual([
      { indexes: ["ingest_outcome"], blobs: ["deduplicated", "duplicate_install", "install_completed"], doubles: [1] },
    ]);
  });

  it("rejects an absent-method tokenless install in enforce (curl channel)", async () => {
    const { options: opts, main, ops } = bootstrapOptions(fakeGuardState());
    const response = await handleTelemetryEvent(opts, post(installCompletedBody()));
    expect(await response.json()).toEqual({ ok: true, result: { recorded: false } });
    expect(main).toHaveLength(0);
    expect(ops).toEqual([
      { indexes: ["ingest_outcome"], blobs: ["rejected", "invalid_token", "install_completed"], doubles: [1] },
    ]);
  });

  it("rejects an explicit curl tokenless install in enforce", async () => {
    const { options: opts, main, ops } = bootstrapOptions(fakeGuardState());
    const response = await handleTelemetryEvent(opts, post(installCompletedBody({ installMethod: "curl" })));
    expect(await response.json()).toEqual({ ok: true, result: { recorded: false } });
    expect(main).toHaveLength(0);
    expect(ops).toEqual([
      { indexes: ["ingest_outcome"], blobs: ["rejected", "invalid_token", "install_completed"], doubles: [1] },
    ]);
  });

  it("accepts a brew install carrying a token without consuming it", async () => {
    const state = fakeGuardState();
    state.tokens.add(TOKEN_A);
    const { options: opts, main, ops } = bootstrapOptions(state);
    const response = await handleTelemetryEvent(
      opts,
      post(installCompletedBody({ installMethod: "brew", installToken: TOKEN_A })),
    );
    expect(await response.json()).toEqual({ ok: true, result: { recorded: true } });
    expect(main).toHaveLength(1);
    expect(ops).toEqual([
      { indexes: ["ingest_outcome"], blobs: ["accepted", "bootstrap_brew", "install_completed"], doubles: [1] },
    ]);
    // The token survives: a package-manager client has no legitimate way to
    // hold one, so consuming it would let token theft burn installer tokens.
    expect(state.tokens.has(TOKEN_A)).toBe(true);

    // And it is still valid for a later curl-channel use.
    const curl = bootstrapOptions(state);
    const curlResponse = await handleTelemetryEvent(
      curl.options,
      post(installCompletedBody({ installationId: ID_B, installMethod: "curl", installToken: TOKEN_A })),
    );
    expect(await curlResponse.json()).toEqual({ ok: true, result: { recorded: true } });
    expect(state.tokens.has(TOKEN_A)).toBe(false);
  });

  it("claims a direct install once over real SQL and stores digests only", async () => {
    const state = sqliteD1();
    state.database.exec(V9_SQL);
    const guard = createD1TelemetryGuard(state.binding);
    expect(await guard.claimInstallDirect({ installationId: ID_A, now: NOW_AFTER_ISO })).toBe("claimed");
    expect(await guard.claimInstallDirect({ installationId: ID_A, now: NOW_AFTER_ISO })).toBe("duplicate");
    // The direct claim satisfies the later activation gate like a token claim.
    expect(await guard.claimActivation({ installationId: ID_A })).toBe("claimed");
    const dump = await tableDump(state.database);
    expect(dump).not.toContain(ID_A);
  });

  it("fails the direct claim open when d1 throws", async () => {
    const guard = createD1TelemetryGuard(throwingGuardDb());
    expect(await guard.claimInstallDirect({ installationId: ID_A, now: NOW_AFTER_ISO })).toBe("error");
  });

  it("keeps ids and addresses out of bootstrap ops points", async () => {
    const { options: opts, main, ops } = bootstrapOptions(fakeGuardState());
    await handleTelemetryEvent(
      opts,
      post(installCompletedBody({ installMethod: "brew" }), { "CF-Connecting-IP": "203.0.113.7" }),
    );
    await handleTelemetryEvent(
      opts,
      post(installCompletedBody({ installationId: ID_B, installMethod: "nix" }), { "CF-Connecting-IP": "203.0.113.7" }),
    );
    expect(main).toHaveLength(2);
    expect(ops).toHaveLength(2);
    const leaked = ops.map((point) => JSON.stringify(point)).join("\n");
    for (const secret of [ID_A, ID_B, "203.0.113.7"]) {
      expect(leaked, secret).not.toContain(secret);
    }
    for (const point of ops) {
      expect(point.indexes).toEqual(["ingest_outcome"]);
      expect(point.blobs).toHaveLength(3);
      expect(point.doubles).toEqual([1]);
    }
  });
});
