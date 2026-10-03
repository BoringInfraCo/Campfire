import { beforeEach, describe, expect, it } from "vitest";
import { seedFixture } from "../../src/bootstrap/seed.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import type { CampfireStore } from "../../src/store/store.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import {
  createD1WorkerHandler,
  createWorkerHandler,
  type AssetsFetch,
} from "../../src/worker/handler.js";
import { handleTelemetryEvent, recordInstallRequested, TELEMETRY_PATH } from "../../src/worker/telemetry.js";
import type { AnalyticsEngineDataset } from "../../src/worker/telemetry.js";
import type { AsyncCampfireStore } from "../../src/worker/d1-store.js";

/**
 * TEL-001 Worker coverage (sprint section 18, "Worker"; section 17).
 *
 * Two adapters are under test:
 *
 *   - `GET /install` (and its zone-prefixed spelling) is the *measured*
 *     installer route. It must serve the same installer body as before and add
 *     exactly one anonymous `install_requested` data point — no installation id,
 *     `unknown` platform — because at that point in the funnel no installation
 *     exists and the requestor is a shell pipeline (section 5, section 11).
 *   - `POST /v1/telemetry` is the ingestion endpoint. It accepts only the
 *     documented schema-1 events and fields, refuses an oversized body without
 *     trusting `content-length`, and reports a lost measurement as a success so
 *     the installer's best-effort POST never looks like something to retry.
 */

const NOW = "2026-01-01T00:00:00.000Z";
const ID_A = "11111111-2222-4333-8444-555555555555";
const INSTALLER_BODY = "#!/bin/sh\n# installer\n";

interface DataPoint {
  indexes?: string[];
  blobs?: string[];
  doubles?: number[];
}

/**
 * Analytics Engine stand-in. `writeDataPoint` is the entire API the adapter
 * uses. An illegal point is rejected before it is stored: AE accepts at most
 * one index, twenty blobs, and twenty doubles, and a thrown write is what the
 * adapter already reports as `recorded: false`.
 */
function fakeDataset(): { dataset: AnalyticsEngineDataset; points: DataPoint[] } {
  const points: DataPoint[] = [];
  return {
    points,
    dataset: {
      writeDataPoint(point) {
        const indexes = point.indexes?.length ?? 0;
        const blobs = point.blobs?.length ?? 0;
        const doubles = point.doubles?.length ?? 0;
        if (indexes > 1 || blobs > 20 || doubles > 20) {
          throw new Error(
            "Analytics Engine accepts at most one index, twenty blobs, and twenty doubles",
          );
        }
        points.push(point);
      },
    },
  };
}

function throwingDataset(): AnalyticsEngineDataset {
  return {
    writeDataPoint() {
      throw new Error("analytics engine unavailable");
    },
  };
}

function validEvent(overrides: Record<string, unknown> = {}): string {
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

let store: CampfireStore;
let service: CampfireService;
let dataset: AnalyticsEngineDataset;
let points: DataPoint[];
let fetched: string[];
let assetsFetch: AssetsFetch;
let handle: (request: Request) => Promise<Response>;

/** Let the deferred installer-request write land before asserting on it. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function get(path: string): Promise<Response> {
  return handle(new Request(`https://campfire.test${path}`));
}

function post(path: string, body: string, headers: Record<string, string> = {}): Promise<Response> {
  return handle(
    new Request(`https://campfire.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    }),
  );
}

beforeEach(() => {
  store = openInMemoryStore();
  seedFixture(store, { clock: () => NOW });
  service = createCampfireService({ store, idSource: createCounterIdSource(), clock: () => NOW });
  const fake = fakeDataset();
  dataset = fake.dataset;
  points = fake.points;
  fetched = [];
  assetsFetch = async (request) => {
    fetched.push(new URL(request.url).pathname);
    return new Response(INSTALLER_BODY, { status: 200, headers: { "content-type": "text/x-shellscript" } });
  };
  handle = createWorkerHandler({ service, assetsFetch, telemetryDataset: dataset });
});

describe("measured installer route", () => {
  it("serves the installer and records one anonymous install_requested for /campfire/install", async () => {
    const response = await get("/campfire/install");
    await flush();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INSTALLER_BODY);
    expect(fetched).toEqual(["/campfire/install.sh"]);
    expect(points).toHaveLength(1);
    expect(points[0]?.indexes).toEqual(["install_requested"]);
    // No installation id exists yet, and none may be invented from the request.
    // It stays blob8, never the sampling index.
    expect(points[0]?.blobs).toEqual([
      "install_requested",
      "1",
      "unknown",
      "unknown",
      "unknown",
      "curl",
      "none",
      "",
    ]);
  });

  it("behaves identically on the prefix-stripped /install route", async () => {
    const response = await get("/install");
    await flush();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INSTALLER_BODY);
    expect(fetched).toEqual(["/campfire/install.sh"]);
    expect(points).toHaveLength(1);
    expect(points[0]?.indexes?.[0]).toBe("install_requested");
  });

  it("records nothing for the pre-existing installer asset route", async () => {
    for (const path of ["/campfire/install.sh", "/campfire/v1.1.0/install.sh"]) {
      const response = await get(path);
      await flush();
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(INSTALLER_BODY);
    }
    expect(fetched).toEqual(["/campfire/install.sh", "/campfire/v1.1.0/install.sh"]);
    // Fetching the script itself is not an installer request: it is a route that
    // already existed, and counting it would inflate the top of the funnel.
    expect(points).toEqual([]);
  });

  it("records nothing when the asset fetch fails with 404 or 502", async () => {
    const missing = createWorkerHandler({
      service,
      assetsFetch: async () => new Response("not found", { status: 404 }),
      telemetryDataset: dataset,
    });
    const missingResponse = await missing(new Request("https://campfire.test/install"));
    await flush();
    expect(missingResponse.status).toBe(404);
    expect(points).toEqual([]);

    const broken = createWorkerHandler({
      service,
      assetsFetch: async () => {
        throw new Error("asset binding unavailable");
      },
      telemetryDataset: dataset,
    });
    const brokenResponse = await broken(new Request("https://campfire.test/campfire/install"));
    await flush();
    expect(brokenResponse.status).toBe(502);
    expect(points).toEqual([]);

    const unbound = createWorkerHandler({ service, telemetryDataset: dataset });
    const unboundResponse = await unbound(new Request("https://campfire.test/install"));
    await flush();
    expect(unboundResponse.status).toBe(404);
    expect(points).toEqual([]);
  });

  it("still serves the installer when no dataset is provisioned", async () => {
    handle = createWorkerHandler({ service, assetsFetch });
    const response = await get("/install");
    await flush();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INSTALLER_BODY);
  });

  it("serves the installer when the analytics write throws", async () => {
    handle = createWorkerHandler({ service, assetsFetch, telemetryDataset: throwingDataset() });
    const response = await get("/install");
    await flush();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INSTALLER_BODY);
  });

  it("does not read identity from the request when recording install_requested", async () => {
    const response = await handle(
      new Request("https://campfire.test/install", {
        headers: {
          authorization: "Bearer REDACTED-example-token",
          "user-agent": "example-agent/1.0",
          "cf-connecting-ip": "203.0.113.7",
          "x-forwarded-for": "203.0.113.7",
        },
      }),
    );
    await flush();
    expect(response.status).toBe(200);
    const point = JSON.stringify(points[0]);
    expect(points).toHaveLength(1);
    for (const leak of ["REDACTED", "example-agent", "203.0.113.7", "cf-connecting-ip", "user-agent"]) {
      expect(point).not.toContain(leak);
    }
  });

  it("is a no-op when recording without a dataset", async () => {
    await expect(recordInstallRequested(undefined)).resolves.toBeUndefined();
    expect(points).toEqual([]);
  });
});

describe("telemetry ingestion", () => {
  it("accepts a valid event and writes exactly one data point in the documented order", async () => {
    const response = await post(TELEMETRY_PATH, validEvent());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: { recorded: true } });
    expect(points).toHaveLength(1);
    expect(points[0]).toEqual({
      indexes: ["activated"],
      blobs: ["activated", "1", "1.9.1", "darwin", "arm64", "none", "cli", ID_A],
    });
  });

  it("serves the zone-prefixed route identically to the origin-root route", async () => {
    const response = await post("/campfire/v1/telemetry", validEvent());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: { recorded: true } });
    expect(points).toHaveLength(1);
    expect(points[0]).toEqual({
      indexes: ["activated"],
      blobs: ["activated", "1", "1.9.1", "darwin", "arm64", "none", "cli", ID_A],
    });
  });

  it("accepts an anonymous install_requested with no installation id", async () => {
    const response = await post(
      TELEMETRY_PATH,
      validEvent({ event: "install_requested", installationId: "", installMethod: "curl", surface: undefined }),
    );
    expect(response.status).toBe(200);
    expect(points[0]?.indexes).toEqual(["install_requested"]);
    expect(points[0]?.blobs).toEqual([
      "install_requested",
      "1",
      "1.9.1",
      "darwin",
      "arm64",
      "curl",
      "none",
      "",
    ]);
  });

  it("reports recorded false when no dataset is bound, without failing the client", async () => {
    handle = createWorkerHandler({ service, assetsFetch });
    const response = await post(TELEMETRY_PATH, validEvent());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: { recorded: false } });
  });

  it("reports a failed analytics write without failing the client", async () => {
    handle = createWorkerHandler({ service, assetsFetch, telemetryDataset: throwingDataset() });
    const response = await post(TELEMETRY_PATH, validEvent());
    // A lost measurement is not a client error: the caller has nothing to fix,
    // and a 500 would make a successful install look broken.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: { recorded: false } });
  });

  it("rejects an undocumented field with 400", async () => {
    const response = await post(TELEMETRY_PATH, validEvent({ workspaceName: "example-repo" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: "ValidationError" });
    expect(points).toEqual([]);
  });

  it("rejects a wrong schema version with 400", async () => {
    for (const version of [0, 2, "1", null]) {
      const response = await post(TELEMETRY_PATH, validEvent({ schemaVersion: version }));
      expect(response.status, String(version)).toBe(400);
      expect(await response.json()).toMatchObject({
        ok: false,
        message: "Telemetry payload does not match schema version 1",
      });
    }
    expect(points).toEqual([]);
  });

  it("rejects an unknown event with 400", async () => {
    const response = await post(TELEMETRY_PATH, validEvent({ event: "session_replay" }));
    expect(response.status).toBe(400);
    expect(points).toEqual([]);
  });

  it("rejects a non-object body, including an array, with 400", async () => {
    for (const body of ["[]", JSON.stringify([validEvent()]), '"nope"', "7", "null", "true"]) {
      const response = await post(TELEMETRY_PATH, body);
      expect(response.status, body).toBe(400);
    }
    expect(points).toEqual([]);
  });

  it("rejects malformed json and an empty body with 400", async () => {
    for (const body of ["", "{broken", "{'single':'quotes'}"]) {
      const response = await post(TELEMETRY_PATH, body);
      expect(response.status, body).toBe(400);
      expect(await response.json()).toMatchObject({ message: "Telemetry payload must be JSON" });
    }
    expect(points).toEqual([]);
  });

  it("rejects an install_requested that carries an installation id with 400", async () => {
    const response = await post(TELEMETRY_PATH, validEvent({ event: "install_requested" }));
    expect(response.status).toBe(400);
    expect(points).toEqual([]);
  });

  it("rejects a non-uuid installation id with 400", async () => {
    for (const id of ["example-host.invalid", "1111", ""]) {
      const response = await post(TELEMETRY_PATH, validEvent({ installationId: id }));
      expect(response.status, id).toBe(400);
    }
    expect(points).toEqual([]);
  });

  it("requires no bearer token at all", async () => {
    const response = await handle(
      new Request(`https://campfire.test${TELEMETRY_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: validEvent(),
      }),
    );
    expect(response.status).toBe(200);
  });
});

describe("telemetry payload ceiling", () => {
  const oversized = validEvent({ campfireVersion: "9".repeat(5_000) });

  it("refuses a body over 2 KiB with 413", async () => {
    expect(Buffer.byteLength(oversized)).toBeGreaterThan(2_048);
    const response = await post(TELEMETRY_PATH, oversized);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "ValidationError",
      message: "Telemetry payload too large",
    });
    expect(points).toEqual([]);
  });

  it("caps on received bytes when content-length understates the body", async () => {
    const response = await post(TELEMETRY_PATH, oversized, { "content-length": "12" });
    expect(response.status).toBe(413);
    expect(points).toEqual([]);
  });

  it("caps on received bytes when content-length is absent", async () => {
    const response = await post(TELEMETRY_PATH, oversized, { "content-length": "" });
    expect(response.status).toBe(413);
    expect(points).toEqual([]);
  });

  it("caps a streamed body in chunks rather than buffering it whole", async () => {
    const chunk = "x".repeat(1_024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 8; i += 1) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    const response = await handle(
      new Request(`https://campfire.test${TELEMETRY_PATH}`, { method: "POST", body: stream, duplex: "half" } as RequestInit),
    );
    expect(response.status).toBe(413);
    expect(points).toEqual([]);
  });

  it("checks size before parsing, so an oversized malformed body is still 413", async () => {
    const response = await post(TELEMETRY_PATH, "{".repeat(5_000));
    expect(response.status).toBe(413);
  });

  it("accepts a documented payload that sits well under the ceiling", async () => {
    const response = await post(TELEMETRY_PATH, validEvent());
    expect(response.status).toBe(200);
    expect(points).toHaveLength(1);
  });
});

describe("telemetry method handling", () => {
  it("rejects a non-post method with 405 in the ingestion adapter", async () => {
    for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
      const response = await handleTelemetryEvent(
        { dataset },
        new Request(`https://campfire.test${TELEMETRY_PATH}`, { method }),
      );
      expect(response.status, method).toBe(405);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: "ValidationError",
        message: `Method not allowed: ${method}`,
      });
    }
    expect(points).toEqual([]);
  });

  it("does not let a GET of the ingestion path record anything through the router", async () => {
    // The router matches the ingestion path ahead of its method split, so a GET
    // reaches the adapter and answers 405 rather than the 404 the asset branch
    // would produce for an unknown path. Either way nothing is recorded and no
    // asset is fetched.
    const response = await get(TELEMETRY_PATH);
    expect(response.status).toBe(405);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "ValidationError",
      message: "Method not allowed: GET",
    });
    await flush();
    expect(points).toEqual([]);
    expect(fetched).toEqual([]);
  });

  it("still answers 404 for an unrelated unknown path", async () => {
    // Guards the route hoist: moving the telemetry match above the method split
    // must not make every unmatched path look like the ingestion route.
    const response = await get("/v1/telemetry-elsewhere");
    expect(response.status).toBe(404);
    await flush();
    expect(points).toEqual([]);
  });
});

describe("d1 handler parity", () => {
  /** Adapt the sync store to the async boundary, mirroring tests/worker/async-service.test.ts. */
  function wrapSync(sync: CampfireStore): AsyncCampfireStore {
    return new Proxy(sync, {
      get(target, prop, receiver) {
        if (prop === "transaction") return (fn: () => Promise<unknown>) => fn();
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (typeof value !== "function") return value;
        return (...args: unknown[]) =>
          Promise.resolve((value as (...a: unknown[]) => unknown).apply(target, args));
      },
    }) as unknown as AsyncCampfireStore;
  }

  it("records installer requests and telemetry events on the production handler", async () => {
    const d1Handle = createD1WorkerHandler({
      store: wrapSync(store),
      assetsFetch,
      telemetryDataset: dataset,
      clock: () => NOW,
    });

    const install = await d1Handle(new Request("https://campfire.test/install"));
    await flush();
    expect(install.status).toBe(200);
    expect(points).toHaveLength(1);
    expect(points[0]?.indexes?.[0]).toBe("install_requested");

    const ingest = await d1Handle(
      new Request(`https://campfire.test/campfire${TELEMETRY_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: validEvent({ event: "active", surface: "agent" }),
      }),
    );
    expect(ingest.status).toBe(200);
    expect(points).toHaveLength(2);
    expect(points[1]).toEqual({
      indexes: ["active"],
      blobs: ["active", "1", "1.9.1", "darwin", "arm64", "none", "agent", ID_A],
    });
  });
});
