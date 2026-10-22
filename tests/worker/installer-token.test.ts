/**
 * Installer token issuance + all-path measurement.
 *
 * Every Worker-served installer route (`/install`, `/campfire/install`,
 * `/campfire/install.sh`, versioned snapshots) shares one serving path: on a
 * 2xx it records one anonymous `install_requested` and bakes a single-use
 * install token into the script bytes by replacing the first occurrence of
 * the completion-body marker. Anything unexpected — no marker, a refused
 * mint, a 404/502 — serves the bytes (or the failure) unchanged.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { seedFixture } from "../../src/bootstrap/seed.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import type { CampfireStore } from "../../src/store/store.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import {
  createWorkerHandler,
  INSTALL_TOKEN_MARKER,
  INSTALL_TOKEN_TTL_MS,
  type AssetsFetch,
} from "../../src/worker/handler.js";
import type { AnalyticsEngineDataset, RateLimiterBinding } from "../../src/worker/telemetry.js";
import { INSTALL_TOKEN_RATE_LIMIT_PREFIX } from "../../src/worker/telemetry.js";
import type { TelemetryGuard } from "../../src/telemetry/guard.js";

const NOW = "2026-01-01T00:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const MARKED_SCRIPT = `#!/bin/sh
body='{"schemaVersion":1,"event":"install_completed","installationId":"%s","campfireVersion":"%s","os":"%s","arch":"%s","installMethod":"curl"}'
echo done
`;
const UNMARKED_SCRIPT = "#!/bin/sh\n# legacy installer without telemetry\n";

interface DataPoint {
  indexes?: string[];
  blobs?: string[];
}

interface IssuedCall {
  token: string;
  issuedAt: string;
  expiresAt: string;
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

function fakeGuard(onIssue: (call: IssuedCall) => "issued" | "error" = () => "issued"): TelemetryGuard & {
  issued: IssuedCall[];
} {
  const issued: IssuedCall[] = [];
  return {
    issued,
    async issueInstallToken(input) {
      const call = { token: input.token, issuedAt: input.issuedAt, expiresAt: input.expiresAt };
      issued.push(call);
      return onIssue(call);
    },
    async completeInstall() {
      return "error";
    },
    async claimInstallDirect() {
      return "error";
    },
    async claimActivation() {
      return "error";
    },
    async claimActive() {
      return "error";
    },
  };
}

let service: CampfireService;
let points: DataPoint[];
let dataset: AnalyticsEngineDataset;
let guard: TelemetryGuard & { issued: IssuedCall[] };
let scriptByPath: Map<string, { status: number; body: string }>;
let assetsFetch: AssetsFetch;
let handle: (request: Request) => Promise<Response>;

/** Let the deferred installer-request write land before asserting on it. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function buildHandle(
  issue: (call: IssuedCall) => "issued" | "error" = () => "issued",
  rateLimiter?: RateLimiterBinding,
): void {
  const fake = fakeDataset();
  dataset = fake.dataset;
  points = fake.points;
  guard = fakeGuard(issue);
  assetsFetch = async (request) => {
    const path = new URL(request.url).pathname;
    const entry = scriptByPath.get(path) ?? scriptByPath.get("/campfire/install.sh");
    if (entry === undefined) return new Response("not found", { status: 404 });
    return new Response(entry.body, {
      status: entry.status,
      headers: { "content-type": "text/x-shellscript" },
    });
  };
  handle = createWorkerHandler({
    service,
    assetsFetch,
    telemetryDataset: dataset,
    telemetryGuard: guard,
    telemetryNow: () => NOW_MS,
    ...(rateLimiter !== undefined ? { telemetryRateLimiter: rateLimiter } : {}),
  });
}

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return handle(
    new Request(`https://campfire.test${path}`, {
      headers,
    }),
  );
}

/** Limiter fake that records keys and allows a fixed number of calls. */
function recordingLimiter(allow: number): RateLimiterBinding & { keys: string[] } {
  const keys: string[] = [];
  let remaining = allow;
  return {
    keys,
    async limit({ key }: { key: string }) {
      keys.push(key);
      if (remaining > 0) {
        remaining -= 1;
        return { success: true };
      }
      return { success: false };
    },
  };
}

beforeEach(() => {
  const store: CampfireStore = openInMemoryStore();
  seedFixture(store, { clock: () => NOW });
  service = createCampfireService({ store, idSource: createCounterIdSource(), clock: () => NOW });
  scriptByPath = new Map([["/campfire/install.sh", { status: 200, body: MARKED_SCRIPT }]]);
  buildHandle();
});

describe("installer token issuance", () => {
  it("bakes a single-use token into /campfire/install and records the request", async () => {
    const response = await get("/campfire/install");
    await flush();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/x-shellscript");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    const match = /"installToken":"([^"]+)"/.exec(text);
    expect(match?.[1]).toMatch(UUID_PATTERN);
    expect(text).not.toContain(INSTALL_TOKEN_MARKER);
    expect(text.replace(/"installMethod":"curl","installToken":"[^"]+"}/, "")).toContain("echo done");

    expect(guard.issued).toHaveLength(1);
    expect(guard.issued[0]?.token).toBe(match?.[1]);
    expect(guard.issued[0]?.issuedAt).toBe(NOW);
    expect(Date.parse(guard.issued[0]?.expiresAt ?? "") - Date.parse(guard.issued[0]?.issuedAt ?? "")).toBe(
      INSTALL_TOKEN_TTL_MS,
    );
    expect(INSTALL_TOKEN_TTL_MS).toBe(900_000);

    expect(points).toHaveLength(1);
    expect(points[0]?.indexes).toEqual(["install_requested"]);
  });

  it("replaces only the first marker occurrence", async () => {
    scriptByPath.set("/campfire/install.sh", { status: 200, body: `${MARKED_SCRIPT}${MARKED_SCRIPT}` });
    const response = await get("/campfire/install.sh");
    await flush();
    const text = await response.text();
    expect(text.match(/"installToken":"/g)).toHaveLength(1);
    expect(text).toContain(INSTALL_TOKEN_MARKER);
  });

  it("serves unmarked bytes unchanged without a token or cache override", async () => {
    scriptByPath.set("/campfire/install.sh", { status: 200, body: UNMARKED_SCRIPT });
    const response = await get("/campfire/install");
    await flush();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(UNMARKED_SCRIPT);
    expect(response.headers.get("cache-control")).not.toBe("no-store");
    expect(guard.issued).toHaveLength(0);
    // The fetch itself is still measured: the script was served.
    expect(points).toHaveLength(1);
    expect(points[0]?.indexes).toEqual(["install_requested"]);
  });

  it("serves bytes unchanged when the mint fails, and still records", async () => {
    buildHandle(() => "error");
    const response = await get("/campfire/install");
    await flush();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(MARKED_SCRIPT);
    expect(response.headers.get("cache-control")).not.toBe("no-store");
    expect(points).toHaveLength(1);
  });

  it("serves bytes unchanged without a guard", async () => {
    const fake = fakeDataset();
    handle = createWorkerHandler({ service, assetsFetch, telemetryDataset: fake.dataset });
    const response = await get("/campfire/install");
    await flush();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(MARKED_SCRIPT);
    expect(fake.points).toHaveLength(1);
  });
});

describe("all installer paths are measured", () => {
  it("records install_requested for the asset route and versioned snapshots", async () => {
    for (const path of ["/campfire/install.sh", "/campfire/v1.25.0/install.sh"]) {
      scriptByPath.set(
        path === "/campfire/install.sh" ? "/campfire/install.sh" : path,
        { status: 200, body: MARKED_SCRIPT },
      );
      const response = await get(path);
      await flush();
      expect(response.status, path).toBe(200);
      expect(response.headers.get("cache-control"), path).toBe("no-store");
      expect(await response.text(), path).toContain('"installToken":"');
    }
    expect(points).toHaveLength(2);
    expect(points.every((point) => point.indexes?.[0] === "install_requested")).toBe(true);
  });

  it("records nothing when the asset fetch fails with 404 or 502", async () => {
    scriptByPath.set("/campfire/install.sh", { status: 404, body: "not found" });
    const missing = await get("/campfire/install.sh");
    await flush();
    expect(missing.status).toBe(404);
    expect(points).toEqual([]);

    const broken = createWorkerHandler({
      service,
      assetsFetch: async () => {
        throw new Error("asset binding unavailable");
      },
      telemetryDataset: dataset,
      telemetryGuard: guard,
    });
    const failed = await broken(new Request("https://campfire.test/campfire/install"));
    await flush();
    expect(failed.status).toBe(502);
    expect(points).toEqual([]);
    expect(guard.issued).toHaveLength(0);
  });
});

describe("installer token-mint budget", () => {
  it("serves bytes unchanged when over budget, but still records install_requested", async () => {
    // Zero allowance: the very first mint is refused.
    buildHandle(() => "issued", recordingLimiter(0));
    const response = await get("/campfire/install", { "CF-Connecting-IP": "203.0.113.7" });
    await flush();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(MARKED_SCRIPT);
    // Untokenized bytes keep their existing cache behavior: no no-store.
    expect(response.headers.get("cache-control")).not.toBe("no-store");
    expect(guard.issued).toHaveLength(0);
    // The fetch itself is still measured: over budget loses the token, not the count.
    expect(points).toHaveLength(1);
    expect(points[0]?.indexes).toEqual(["install_requested"]);
  });

  it("fails open when the limiter throws, minting a token as today", async () => {
    const broken: RateLimiterBinding = {
      async limit() {
        throw new Error("rate limiter unavailable");
      },
    };
    buildHandle(() => "issued", broken);
    const response = await get("/campfire/install", { "CF-Connecting-IP": "203.0.113.7" });
    await flush();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain('"installToken":"');
    expect(guard.issued).toHaveLength(1);
    expect(points).toHaveLength(1);
  });

  it("mints without a limiter or address, and keys mints distinctly from ingestion", async () => {
    // No limiter configured: unbounded, exactly as before the budget existed.
    buildHandle();
    const plain = await get("/campfire/install");
    await flush();
    expect(await plain.text()).toContain('"installToken":"');
    expect(guard.issued).toHaveLength(1);

    // No address header: fail open, mint as today, consume no budget.
    const shared = recordingLimiter(10);
    buildHandle(() => "issued", shared);
    const noAddress = await get("/campfire/install");
    await flush();
    expect(await noAddress.text()).toContain('"installToken":"');
    expect(shared.keys).toHaveLength(0);

    // Same source, same binding: the mint key carries the install-token prefix
    // and never equals the ingestion-budget key, so the two budgets share the
    // 120/min binding without consuming each other's keys.
    const minted = await get("/campfire/install", { "CF-Connecting-IP": "198.51.100.42" });
    await flush();
    expect(await minted.text()).toContain('"installToken":"');
    expect(shared.keys).toHaveLength(1);
    expect(shared.keys[0]).toMatch(new RegExp(`^${INSTALL_TOKEN_RATE_LIMIT_PREFIX}t[0-9a-f]+$`));
    expect(shared.keys[0]).not.toMatch(/^t[0-9a-f]+$/);
  });
});
