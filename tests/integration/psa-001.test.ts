/**
 * PSA-001 regression suite.
 *
 * Contract: `docs/Campfire-v1.15-PSA-001-Performance-and-Security-Hardening.md`
 * Audit:    `docs/SPRINT_PSA_001_AUDIT.md`
 *
 * Every test here corresponds to a named verification clause in §3 of the
 * contract. These assert behavior, not implementation: the tests would still
 * pass if the fix were reimplemented differently.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { startCampfireHttpServer, type RunningHttpServer } from "../../src/http/server.js";
import { createRuntimeFromPath, type CampfireRuntime } from "../../src/runtime.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import {
  isAllowedViewerHost,
  startCampfireViewer,
  type RunningViewer,
} from "../../src/viewer/server.js";
import worker from "../../src/worker/index.js";
import { createWorkerHandler } from "../../src/worker/handler.js";
import { createD1Store, migrateD1 } from "../../src/worker/d1-store.js";
import { buildDomainEvent } from "../../src/domain/event-body.js";
import type { D1Database } from "../../src/worker/d1-types.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";
import {
  normalizeDeliveryLimit,
  WEBHOOK_DELIVERY_BATCH,
} from "../../src/bridge/retry.js";

/** A string that must never survive into a 500 body. */
const SECRET = "audit-private-path/db.sqlite";

async function jsonOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Raw request with a caller-chosen `Host`.
 *
 * `fetch` cannot be used for the Host-boundary tests: `Host` is a forbidden
 * header name in the fetch spec and undici silently drops it, so every request
 * would arrive with the real listening address and the test would pass without
 * ever exercising the boundary. A DNS-rebinding attacker controls the Host at
 * the socket level, which is what this reproduces.
 */
function rawRequest(options: {
  port: number;
  path: string;
  method?: string;
  host?: string;
  body?: string;
}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: options.port,
        path: options.path,
        method: options.method ?? "GET",
        // Node's http client sets Host from `host`/`port` unless given one.
        ...(options.host !== undefined ? { headers: { host: options.host } } : {}),
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          text += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) req.end(options.body);
    else req.end();
  });
}

describe("S1 — local Viewer Host boundary", () => {
  let dir: string;
  let runtime: CampfireRuntime;
  let viewer: RunningViewer;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "campfire-host-boundary-"));
    runtime = createRuntimeFromPath(join(dir, "campfire.db"));
    seedFixture(runtime.store);
    vi.spyOn(console, "error").mockImplementation(() => {});
    viewer = await startCampfireViewer({
      // The Viewer's authority: anything this returns is actor-bound data.
      call: async (method) => {
        if (method === "list_workspaces") {
          return [{ id: FIXTURE.workspaces.billing, name: "Billing" }];
        }
        return { sentinel: true };
      },
      host: "127.0.0.1",
      port: 0,
    });
  });

  afterEach(async () => {
    await viewer.close();
    runtime.close();
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  function apiCall(hostHeader: string) {
    return rawRequest({
      port: viewer.port,
      path: "/api/call",
      method: "POST",
      host: hostHeader,
      body: JSON.stringify({ method: "list_workspaces", params: {} }),
    });
  }

  it("rejects an unrelated Host before /api/call runs (DNS rebinding, audit S1)", async () => {
    const response = await apiCall("attacker.example");

    expect(response.status).toBe(403);
    // The decisive assertion: no actor-bound Viewer data crossed the boundary,
    // not merely that the request failed.
    expect(response.text).not.toContain(FIXTURE.workspaces.billing);
    expect(response.text).not.toContain("Billing");
  });

  it("rejects an unrelated Host on the generated page and the static shell", async () => {
    for (const path of ["/", "/app.js", `/generated/workspaces/${FIXTURE.workspaces.billing}`]) {
      const response = await rawRequest({ port: viewer.port, path, host: "attacker.example" });
      expect(response.status, `${path} must reject an unrelated Host`).toBe(403);
      expect(response.text).not.toContain(FIXTURE.workspaces.billing);
    }
  });

  it("accepts the listening address and the loopback names at the real port", async () => {
    // port 0 resolves to an ephemeral port; the check must use that, not 0.
    const accepted = [
      `127.0.0.1:${viewer.port}`,
      `localhost:${viewer.port}`,
      // Case spelling a browser or curl may produce.
      `LOCALHOST:${viewer.port}`,
    ];
    for (const host of accepted) {
      const response = await apiCall(host);
      expect(response.status, `${host} must be accepted`).toBe(200);
      expect(response.text).toContain(FIXTURE.workspaces.billing);
    }
  });

  it("rejects the right loopback name on the wrong port", async () => {
    const response = await apiCall(`127.0.0.1:${viewer.port + 1}`);
    expect(response.status).toBe(403);
  });

  it("rejects a portless or malformed Host", async () => {
    // An omitted port means 80/443. This listener is neither.
    expect((await apiCall("127.0.0.1")).status).toBe(403);
    // Unterminated IPv6 bracket, and a bare IPv6 literal with two colons.
    expect((await apiCall("[::1:9415")).status).toBe(403);
    expect((await apiCall("::1:9415")).status).toBe(403);
    // An empty Host is not case here: Node's client substitutes the real
    // authority before it reaches the socket. The Host-less HTTP/1.1 request,
    // which cannot be substituted, is covered by the raw-socket test below.
  });

  it("does not serve an HTTP/1.1 request that carries no Host at all", async () => {
    // Written on a raw socket because no HTTP client will emit a Host-less 1.1
    // request. Node's own parser answers 400 before the handler; the point is
    // that such a request never reaches a route.
    const status = await new Promise<number>((resolve, reject) => {
      const socket = connect(viewer.port, "127.0.0.1", () => {
        socket.write(`POST /api/call HTTP/1.1\r\nConnection: close\r\nContent-Length: 2\r\n\r\n{}`);
      });
      let raw = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        raw += chunk;
      });
      socket.on("end", () => resolve(Number(/^HTTP\/1\.1 (\d+)/.exec(raw)?.[1] ?? 0)));
      socket.on("error", reject);
    });

    expect(status).toBeGreaterThanOrEqual(400);
  });

  it("covers IPv4, IPv6, and localhost in the pure predicate", () => {
    expect(isAllowedViewerHost("127.0.0.1:9415", { boundHost: "127.0.0.1", port: 9415 })).toBe(true);
    expect(isAllowedViewerHost("[::1]:9415", { boundHost: "::1", port: 9415 })).toBe(true);
    expect(isAllowedViewerHost("::1:9415", { boundHost: "::1", port: 9415 })).toBe(false);
    expect(isAllowedViewerHost("localhost:9415", { boundHost: "127.0.0.1", port: 9415 })).toBe(true);
    // Bound address always allowed, even when it is not a loopback spelling.
    expect(isAllowedViewerHost("box.local:9415", { boundHost: "box.local", port: 9415 })).toBe(true);
    // The name is not the address.
    expect(isAllowedViewerHost("box.local:9415", { boundHost: "127.0.0.1", port: 9415 })).toBe(false);
    expect(isAllowedViewerHost("attacker.example:9415", { boundHost: "127.0.0.1", port: 9415 })).toBe(false);
    expect(isAllowedViewerHost(undefined, { boundHost: "127.0.0.1", port: 9415 })).toBe(false);
  });

  it("keeps the Host guard on a loopback bind even with --allow-remote", async () => {
    const local = await startCampfireViewer({
      call: async () => ({ ok: true }),
      host: "127.0.0.1",
      port: 0,
      allowRemote: true,
    });
    try {
      const response = await rawRequest({ port: local.port, path: "/", host: "campfire.example:9999" });
      expect(response.status).toBe(403);
    } finally {
      await local.close();
    }
  });

  it("keeps the explicit non-loopback bind working", async () => {
    // `--allow-remote` is the operator's explicit choice to expose the
    // Viewer's authority beyond loopback. The Host check is a loopback-scoped
    // DNS-rebinding guard; it must not silently break that separate contract.
    const remote = await startCampfireViewer({
      call: async () => ({ ok: true }),
      host: "0.0.0.0",
      port: 0,
      allowRemote: true,
    });
    try {
      const response = await rawRequest({
        port: remote.port,
        path: "/api/call",
        method: "POST",
        host: "campfire.example:9999",
        body: JSON.stringify({ method: "list_workspaces", params: {} }),
      });
      expect(response.status).toBe(200);
    } finally {
      await remote.close();
    }
  });
});

describe("S2 — Worker body cap", () => {
  function handler() {
    const store = openInMemoryStore();
    seedFixture(store);
    const service = createCampfireService({
      store,
      idSource: createCounterIdSource(),
      clock: () => "2026-01-01T00:00:00.000Z",
    });
    return createWorkerHandler({ service });
  }

  function call(
    handle: (r: Request) => Promise<Response>,
    body: string | ReadableStream<Uint8Array>,
    headers: Record<string, string> = {},
  ) {
    const init: RequestInit = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${FIXTURE.tokens.sergio}`,
        ...headers,
      },
      body: body as NonNullable<RequestInit["body"]>,
    };
    // A streaming body needs an explicit duplex hint; a string body does not.
    if (typeof body !== "string") (init as { duplex?: string }).duplex = "half";
    return handle(new Request("https://campfire.test/v1/call", init));
  }

  it("stops at the cap when Content-Length is omitted (audit S2)", async () => {
    const oversized = JSON.stringify({
      method: "whoami",
      params: { padding: "x".repeat(2 * 1_048_576) },
    });
    // A stream body: `Request` will not synthesise a Content-Length for it.
    const response = await call(handler(), new Blob([oversized]).stream());

    expect(response.status).toBe(400);
    expect((await jsonOf(response))["message"]).toMatch(/too large/i);
  });

  it("stops at the cap when Content-Length is understated", async () => {
    const oversized = JSON.stringify({
      method: "whoami",
      params: { padding: "x".repeat(2 * 1_048_576) },
    });
    const response = await call(handler(), new Blob([oversized]).stream(), {
      // Lying about the length must not buy extra buffer.
      "content-length": "10",
    });

    expect(response.status).toBe(400);
    expect((await jsonOf(response))["message"]).toMatch(/too large/i);
  });

  it("counts bytes, not characters, so multibyte content cannot slip past", async () => {
    // 600k three-byte characters is ~1.8 MB of bytes but well under 1 MiB of
    // characters. A character-counting cap would let this through.
    const multibyte = JSON.stringify({ method: "whoami", params: { padding: "中".repeat(600_000) } });
    expect(multibyte.length).toBeLessThan(1_048_576);
    expect(new TextEncoder().encode(multibyte).length).toBeGreaterThan(1_048_576);

    const response = await call(handler(), new Blob([multibyte]).stream());
    expect(response.status).toBe(400);
    expect((await jsonOf(response))["message"]).toMatch(/too large/i);
  });

  it("cancels the oversized stream instead of buffering it whole", async () => {
    let cancelled = false;
    const handle = handler();
    // Count what the adapter actually pulled from the stream. A cancel means the
    // adapter stopped pulling rather than draining to the end.
    let produced = 0;
    const oversized = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += 64 * 1024;
        controller.enqueue(new Uint8Array(64 * 1024).fill(0x61));
        if (produced > 8 * 1_048_576) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });

    const response = await handle(
      new Request("https://campfire.test/v1/call", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${FIXTURE.tokens.sergio}`,
        },
        body: oversized as NonNullable<RequestInit["body"]>,
        duplex: "half",
      } as RequestInit),
    );

    expect(response.status).toBe(400);
    expect(cancelled).toBe(true);
    // The stream offered 8 MiB; the adapter must not have consumed it all.
    expect(produced).toBeLessThan(8 * 1_048_576);
  });

  it("still dispatches a valid call and still rejects malformed JSON", async () => {
    const ok = await call(handler(), JSON.stringify({ method: "whoami", params: {} }));
    expect(ok.status).toBe(200);
    expect((await jsonOf(ok))["ok"]).toBe(true);

    const bad = await call(handler(), "{not json", { "content-type": "application/json" });
    expect(bad.status).toBe(400);
    expect((await jsonOf(bad))["message"]).toMatch(/must be JSON/i);
  });

  it("does not echo a body-read failure to the client (S3)", async () => {
    const response = await call(handler(), "boom", { "content-length": "abc" });
    // Malformed declared length: rejected without an internal string.
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain(SECRET);
  });
});

describe("S3 — generic unexpected-error boundary", () => {
  let dir: string;
  let runtime: CampfireRuntime;
  let http: RunningHttpServer;
  let viewer: RunningViewer;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "campfire-error-boundary-"));
    runtime = createRuntimeFromPath(join(dir, "campfire.db"));
    seedFixture(runtime.store);
    vi.spyOn(console, "error").mockImplementation(() => {});
    http = await startCampfireHttpServer({ runtime, host: "127.0.0.1", port: 0 });
    viewer = await startCampfireViewer({
      call: async () => {
        throw new Error(`SQLITE_CANTOPEN: ${SECRET}`);
      },
      host: "127.0.0.1",
      port: 0,
    });
  });

  afterEach(async () => {
    await viewer.close();
    await http.close();
    runtime.close();
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("never returns raw exception text from the Viewer 500", async () => {
    const response = await fetch(`${viewer.url}/api/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "list_workspaces", params: {} }),
    });

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("SQLITE_CANTOPEN");
  });

  it("keeps a deliberate typed client error useful", async () => {
    // The generic boundary must not swallow the typed errors that are meant to
    // be client-facing: a read-only rejection is actionable, not internal.
    const response = await fetch(`${viewer.url}/api/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "create_finding", params: {} }),
    });

    expect(response.status).toBe(403);
    expect((await jsonOf(response))["error"]).toBe("Unauthorized");
  });

  it("never returns raw exception text from the Node HTTP 500", async () => {
    // Force an unexpected failure inside a committed request by closing the
    // runtime store underneath the server.
    runtime.store.close();
    const response = await fetch(`${http.url}/v1/call`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${FIXTURE.tokens.sergio}`,
      },
      body: JSON.stringify({ method: "list_workspaces", params: {} }),
    }).catch((error: unknown) => error as Error);

    if (response instanceof Error) return; // connection reset is also a non-leak
    const text = await response.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(dir);
  });

  it("gives the operator a stable diagnostic without logging exception contents", async () => {
    const logged: string[] = [];
    vi.mocked(console.error).mockImplementation((line: unknown) => {
      logged.push(String(line));
    });
    await fetch(`${viewer.url}/api/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "list_workspaces", params: {} }),
    });

    expect(logged.join("\n")).toContain('"route":"/api/call"');
    expect(logged.join("\n")).toContain('"kind":"exception"');
    expect(logged.join("\n")).not.toContain(SECRET);
  });

  it("does not put a generated workspace id in an internal-error log", async () => {
    const logged: string[] = [];
    vi.mocked(console.error).mockImplementation((line: unknown) => { logged.push(String(line)); });
    const workspaceId = "ws_private_probe";
    const response = await fetch(`${viewer.url}/generated/workspaces/${workspaceId}`);
    expect(response.status).toBe(500);
    expect(logged.join("\n")).toContain('"route":"/generated/workspaces/:id"');
    expect(logged.join("\n")).not.toContain(workspaceId);
    expect(logged.join("\n")).not.toContain(SECRET);
  });
});

describe("P1 — bounded webhook work", () => {
  /**
   * Domain events are FK-bound to a workspace and a Contribution, so a backlog
   * needs a real workspace and one contribution per event. Sync and async
   * stores share these names so the same builder drives both.
   */
  function seedOrgAndWorkspace(sync: {
    createOrganization(o: { id: string; name: string; createdAt: string }): void;
    createTeam(t: { id: string; organizationId: string; name: string; createdAt: string }): void;
    createWorkspace(w: {
      id: string; teamId: string; name: string; status: string;
      createdBy: { actorId: string; actorType: string };
      createdAt: string; updatedAt: string;
    }): void;
  }): void {
    sync.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: "2026-01-01T00:00:00.000Z" });
    sync.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: "2026-01-01T00:00:00.000Z" });
    sync.createWorkspace({
      id: FIXTURE.workspaces.billing,
      teamId: "team_1",
      name: "Billing",
      status: "active",
      createdBy: { actorId: FIXTURE.humans.sergio, actorType: "human" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  }

  function backlogEvent(index: number, occurredAt: string) {
    return buildDomainEvent({
      id: `evt_${index}`,
      type: "finding.recorded",
      occurredAt,
      workspaceId: FIXTURE.workspaces.billing,
      actor: { actorId: FIXTURE.humans.sergio, actorType: "human" },
      subjectType: "finding",
      subjectId: `find_${index}`,
      summary: `finding ${index}`,
      data: {},
      contributionId: `con_${index}`,
    }).record;
  }

  it("clamps a hostile or absent batch size instead of reading without a limit", () => {
    // `LIMIT -1` means "no limit" in SQLite and `LIMIT NULL` errors in D1.
    // A bad batch size must degrade to the default, never to an unbounded read.
    expect(normalizeDeliveryLimit(undefined)).toBe(WEBHOOK_DELIVERY_BATCH);
    expect(normalizeDeliveryLimit(0)).toBe(WEBHOOK_DELIVERY_BATCH);
    expect(normalizeDeliveryLimit(-1)).toBe(WEBHOOK_DELIVERY_BATCH);
    expect(normalizeDeliveryLimit(-100)).toBe(WEBHOOK_DELIVERY_BATCH);
    expect(normalizeDeliveryLimit(Number.NaN)).toBe(WEBHOOK_DELIVERY_BATCH);
    expect(normalizeDeliveryLimit(Number.POSITIVE_INFINITY)).toBe(WEBHOOK_DELIVERY_BATCH);
    expect(normalizeDeliveryLimit(7.9)).toBe(7);
    expect(normalizeDeliveryLimit(5)).toBe(5);
    expect(normalizeDeliveryLimit(WEBHOOK_DELIVERY_BATCH + 1)).toBe(WEBHOOK_DELIVERY_BATCH + 1);
  });

  it("fetches at most the batch size per sweep and drains oldest-first across sweeps", async () => {
    const store = openInMemoryStore();
    seedOrgAndWorkspace(store);

    const BRIDGE = "bridge_1";
    const FP = "fp";
    const now = "2026-01-02T00:00:00.000Z";
    const backlog = WEBHOOK_DELIVERY_BATCH * 3;

    // A backlog larger than one batch, oldest-first by created_at.
    for (let i = 0; i < backlog; i += 1) {
      const id = `dlv_${String(i).padStart(4, "0")}`;
      const createdAt = `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`;
      store.createContribution({
        id: `con_${i}`,
        workspaceId: FIXTURE.workspaces.billing,
        actor: { actorId: FIXTURE.humans.sergio, actorType: "human" },
        action: "create",
        objectType: "finding",
        objectId: `find_${i}`,
        createdAt,
      });
      store.createDomainEvent(backlogEvent(i, createdAt));
      store.createWebhookDelivery({
        id,
        eventId: `evt_${i}`,
        bridgeId: BRIDGE,
        status: "pending",
        attemptCount: 0,
        configFingerprint: FP,
        createdAt,
        updatedAt: createdAt,
      });
    }

    // One sweep selects exactly one batch, not the whole backlog.
    const first = store.listDueWebhookDeliveries({
      bridgeId: BRIDGE,
      now,
      leaseBefore: now,
      configFingerprint: FP,
      limit: WEBHOOK_DELIVERY_BATCH,
    });
    expect(first).toHaveLength(WEBHOOK_DELIVERY_BATCH);
    expect(first[0]?.id).toBe("dlv_0000");
    // Oldest first, and the batch is the head of the backlog, not an arbitrary slice.
    expect(first.map((r) => r.id)).toEqual(
      Array.from({ length: WEBHOOK_DELIVERY_BATCH }, (_, i) => `dlv_${String(i).padStart(4, "0")}`),
    );

    // Deliver that batch, then the next sweep picks up exactly where it stopped.
    for (const row of first) {
      store.claimWebhookDelivery(row.id, {
        now,
        claimToken: `tok-${row.id}`,
        leaseBefore: now,
        configFingerprint: FP,
      });
      store.markWebhookDeliveryDelivered(row.id, `tok-${row.id}`, now);
    }

    const second = store.listDueWebhookDeliveries({
      bridgeId: BRIDGE,
      now,
      leaseBefore: now,
      configFingerprint: FP,
      limit: WEBHOOK_DELIVERY_BATCH,
    });
    expect(second).toHaveLength(WEBHOOK_DELIVERY_BATCH);
    expect(second[0]?.id).toBe(`dlv_${String(WEBHOOK_DELIVERY_BATCH).padStart(4, "0")}`);

    // No delivered row is ever re-offered: deduplication survives the bound.
    const deliveredIds = new Set(first.map((r) => r.id));
    expect(second.some((r) => deliveredIds.has(r.id))).toBe(false);
  });

  it("reads zero rows for an empty queue", () => {
    const store = openInMemoryStore();
    expect(
      store.listDueWebhookDeliveries({
        bridgeId: "bridge_1",
        now: "2026-01-02T00:00:00.000Z",
        leaseBefore: "2026-01-02T00:00:00.000Z",
        configFingerprint: "fp",
        limit: WEBHOOK_DELIVERY_BATCH,
      }),
    ).toEqual([]);
  });

  it("applies the bound in D1 SQL, not after the read", async () => {
    const adapter = sqliteD1();
    await migrateD1(adapter.binding);
    const store = createD1Store(adapter.binding);

    const queries: string[] = [];
    const db = adapter.binding;
    const wrapped: D1Database = {
      prepare(sql: string) {
        queries.push(sql);
        return db.prepare(sql);
      },
      batch: (s) => db.batch(s),
      exec: (s) => db.exec(s),
    };
    const wrappedStore = createD1Store(wrapped);

    await wrappedStore.listDueWebhookDeliveries({
      bridgeId: "bridge_1",
      now: "2026-01-02T00:00:00.000Z",
      leaseBefore: "2026-01-02T00:00:00.000Z",
      configFingerprint: "fp",
      limit: 20,
    });

    expect(queries.some((q) => /webhook_deliveries/.test(q) && /LIMIT \?/i.test(q))).toBe(true);
    expect(store).toBeDefined();
  });

  it("a real D1-backed backlog selects one batch per sweep", async () => {
    const adapter = sqliteD1();
    await migrateD1(adapter.binding);
    const store = createD1Store(adapter.binding);

    await store.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: "2026-01-01T00:00:00.000Z" });
    await store.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: "2026-01-01T00:00:00.000Z" });
    await store.createWorkspace({
      id: FIXTURE.workspaces.billing,
      teamId: "team_1",
      name: "Billing",
      status: "active",
      createdBy: { actorId: FIXTURE.humans.sergio, actorType: "human" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const FP = "fp";
    const BRIDGE = "bridge_1";
    for (let i = 0; i < WEBHOOK_DELIVERY_BATCH * 2; i += 1) {
      const createdAt = `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`;
      await store.createContribution({
        id: `con_${i}`,
        workspaceId: FIXTURE.workspaces.billing,
        actor: { actorId: FIXTURE.humans.sergio, actorType: "human" },
        action: "create",
        objectType: "finding",
        objectId: `find_${i}`,
        createdAt,
      });
      await store.createDomainEvent(backlogEvent(i, createdAt));
      await store.createWebhookDelivery({
        id: `dlv_${String(i).padStart(4, "0")}`,
        eventId: `evt_${i}`,
        bridgeId: BRIDGE,
        status: "pending",
        attemptCount: 0,
        configFingerprint: FP,
        createdAt,
        updatedAt: createdAt,
      });
    }

    const due = await store.listDueWebhookDeliveries({
      bridgeId: BRIDGE,
      now: "2026-01-02T00:00:00.000Z",
      leaseBefore: "2026-01-02T00:00:00.000Z",
      configFingerprint: FP,
      limit: WEBHOOK_DELIVERY_BATCH,
    });

    expect(due).toHaveLength(WEBHOOK_DELIVERY_BATCH);
    expect(due[0]?.id).toBe("dlv_0000");
    adapter.database.close();
  });

  it("schedules no delivery sweep for a read-only Worker request", async () => {
    const seen: string[] = [];
    const db: D1Database = {
      prepare(query: string) {
        const stmt = {
          bind() {
            seen.push(query);
            return stmt;
          },
          async first() {
            return null;
          },
          async all() {
            return { results: [], success: true };
          },
          async run() {
            return { success: true, meta: { changes: 0 } };
          },
        };
        return stmt as unknown as ReturnType<D1Database["prepare"]>;
      },
      async batch() {
        return [];
      },
      async exec() {
        return { success: true };
      },
    };

    const waits: Array<Promise<unknown>> = [];
    const ctx = { waitUntil(promise: Promise<unknown>) { waits.push(promise); } };
    const env = {
      DB: db,
      ASSETS: { fetch: async () => new Response("installer") },
      CAMPFIRE_WEBHOOK_ID: "bridge_worker",
      CAMPFIRE_WEBHOOK_URL: "http://127.0.0.1:9/hook",
      CAMPFIRE_WEBHOOK_SECRET: "worker-secret",
      CAMPFIRE_WEBHOOK_EVENTS: "finding.recorded",
      CAMPFIRE_WEBHOOK_WORKSPACES: "ws_1",
    };

    // A read: no bearer, so it fails before dispatch. It still must not sweep.
    await worker.fetch(
      new Request("https://campfire.test/api/list_workspaces"),
      env,
      ctx,
    );
    await Promise.all(waits);

    expect(waits).toHaveLength(0);
    expect(seen.some((q) => q.includes("webhook_deliveries"))).toBe(false);
  });

  it("schedules no delivery sweep for an installer request", async () => {
    const seen: string[] = [];
    const db: D1Database = {
      prepare(query: string) {
        const stmt = {
          bind() {
            seen.push(query);
            return stmt;
          },
          async first() {
            return null;
          },
          async all() {
            return { results: [], success: true };
          },
          async run() {
            return { success: true, meta: { changes: 0 } };
          },
        };
        return stmt as unknown as ReturnType<D1Database["prepare"]>;
      },
      async batch() {
        return [];
      },
      async exec() {
        return { success: true };
      },
    };

    const waits: Array<Promise<unknown>> = [];
    await worker.fetch(
      new Request("https://campfire.test/campfire/install.sh"),
      {
        DB: db,
        ASSETS: { fetch: async () => new Response("#!/bin/sh\n") },
        CAMPFIRE_WEBHOOK_ID: "bridge_worker",
        CAMPFIRE_WEBHOOK_URL: "http://127.0.0.1:9/hook",
        CAMPFIRE_WEBHOOK_SECRET: "worker-secret",
      },
      { waitUntil(promise) { waits.push(promise); } },
    );
    await Promise.all(waits);

    expect(waits).toHaveLength(0);
    expect(seen.some((q) => q.includes("webhook_deliveries"))).toBe(false);
  });

  it("retains the scheduled retry sweep", async () => {
    const seen: string[] = [];
    const db: D1Database = {
      prepare(query: string) {
        const stmt = {
          bind() {
            seen.push(query);
            return stmt;
          },
          async first() {
            return null;
          },
          async all() {
            return { results: [], success: true };
          },
          async run() {
            return { success: true, meta: { changes: 0 } };
          },
        };
        return stmt as unknown as ReturnType<D1Database["prepare"]>;
      },
      async batch() {
        return [];
      },
      async exec() {
        return { success: true };
      },
    };

    const waits: Array<Promise<unknown>> = [];
    await worker.scheduled(
      undefined,
      {
        DB: db,
        ASSETS: { fetch: async () => new Response("unused") },
        CAMPFIRE_WEBHOOK_ID: "bridge_worker",
        CAMPFIRE_WEBHOOK_URL: "http://127.0.0.1:9/hook",
        CAMPFIRE_WEBHOOK_SECRET: "worker-secret",
        CAMPFIRE_WEBHOOK_EVENTS: "finding.recorded",
        CAMPFIRE_WEBHOOK_WORKSPACES: "ws_1",
      },
      { waitUntil(promise) { waits.push(promise); } },
    );
    await Promise.all(waits);

    // The scheduled trigger is the retry and lease-recovery path; it must remain.
    expect(waits.length).toBeGreaterThan(0);
    expect(seen.some((q) => q.includes("webhook_deliveries"))).toBe(true);
    expect(seen.join("\n")).not.toContain("worker-secret");
  });

  it("does not sweep after a successful /v1/call read and still sweeps after an eligible write", async () => {
    const adapter = sqliteD1();
    await migrateD1(adapter.binding);
    const store = createD1Store(adapter.binding);
    const { createAsyncCampfireService } = await import("../../src/worker/async-service.js");

    // Provision the minimum a real write needs: a team to attach the human to.
    await store.createOrganization({ id: FIXTURE.organizationId, name: "Boring Infra Co.", createdAt: "2026-01-01T00:00:00.000Z" });
    await store.createTeam({ id: FIXTURE.teamId, organizationId: FIXTURE.organizationId, name: "Engineering", createdAt: "2026-01-01T00:00:00.000Z" });

    const service = createAsyncCampfireService({ store, clock: () => "2026-01-01T00:00:00.000Z" });
    const issued = await service.createHuman(undefined, {
      teamId: FIXTURE.teamId,
      externalIdentity: "probe@example.com",
      displayName: "Probe",
    });
    const actor = await service.resolveToken(issued.token);
    await store.createWorkspace({
      id: "ws_psa",
      teamId: FIXTURE.teamId,
      name: "PSA",
      status: "active",
      createdBy: actor,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await store.addParticipant({ workspaceId: "ws_psa", actor, role: "owner", joinedAt: "2026-01-01T00:00:00.000Z" });

    const waits: Array<Promise<unknown>> = [];
    const env = {
      DB: adapter.binding,
      ASSETS: { fetch: async () => new Response("unused") },
      CAMPFIRE_WEBHOOK_ID: "bridge_worker",
      CAMPFIRE_WEBHOOK_URL: "http://127.0.0.1:9/hook",
      CAMPFIRE_WEBHOOK_SECRET: "worker-secret",
      CAMPFIRE_WEBHOOK_EVENTS: "finding.recorded",
    };
    const call = (method: string, params: Record<string, unknown>) => worker.fetch(
      new Request("https://campfire.test/v1/call", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${issued.token}`,
        },
        body: JSON.stringify({ method, params }),
      }),
      env,
      { waitUntil(promise) { waits.push(promise); } },
    );
    expect((await call("whoami", {})).status).toBe(200);
    expect(waits).toHaveLength(0);
    expect((await call("add_finding", { workspaceId: "ws_psa", summary: "Delivery probe" })).status).toBe(200);
    await Promise.all(waits);
    // A committed write keeps its immediate delivery; the bound is on the read,
    // not on whether delivery happens.
    expect(waits.length).toBeGreaterThan(0);
  });
});

// Keeps the in-memory better-sqlite3 import honest for the helper type above.
void Database;
