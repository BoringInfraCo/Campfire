/**
 * Ingestion guards on `POST /v1/telemetry`: the version floor and the
 * per-source rate limit.
 *
 * The route carries no bearer by design — it writes only anonymous data points
 * — so it is open to anyone who learns the URL. Two guards bound that exposure
 * without putting Campfire itself in the path of failure:
 *
 *   - The version floor drops payloads whose declared version predates the
 *     release that introduced telemetry, which no real binary can emit.
 *   - The rate limit bounds the cost of a flood. It is generous, fails open,
 *     and its key is an opaque hash, so a network address never reaches a
 *     binding or a data point.
 */
import { describe, expect, it } from "vitest";
import { handleTelemetryEvent, type RateLimiterBinding } from "../../src/worker/telemetry.js";
import type { AnalyticsEngineDataset } from "../../src/worker/telemetry.js";

const ID_A = "11111111-2222-4333-8444-555555555555";

interface DataPoint {
  blobs?: string[];
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

/** Limiter that allows a fixed number of calls, then refuses. */
function limiter(allow: number): RateLimiterBinding & { keys: string[] } {
  const keys: string[] = [];
  let remaining = allow;
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      if (remaining > 0) {
        remaining -= 1;
        return { success: true };
      }
      return { success: false };
    },
  };
}

describe("telemetry ingestion version floor", () => {
  it("records an event at or above the floor", async () => {
    for (const version of ["1.9.1", "1.10.0", "1.13.0"]) {
      const { dataset, points } = fakeDataset();
      const response = await handleTelemetryEvent(
        { dataset },
        post(payload({ campfireVersion: version })),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, result: { recorded: true } });
      expect(points).toHaveLength(1);
    }
  });

  it("drops the sub-floor stream without writing a data point", async () => {
    const { dataset, points } = fakeDataset();
    const response = await handleTelemetryEvent({ dataset }, post(payload({ campfireVersion: "1.2.0" })));
    expect(response.status).toBe(200);
    expect(points).toHaveLength(0);
  });

  it("reports a dropped forgery as recorded:false rather than an error", async () => {
    // A rejection would teach a prober exactly which field gave it away, and
    // would make an honest client retry.
    const { dataset } = fakeDataset();
    const response = await handleTelemetryEvent({ dataset }, post(payload({ campfireVersion: "1.2.0" })));
    expect(await response.json()).toEqual({ ok: true, result: { recorded: false } });
  });

  it("applies to every event, not just activation", async () => {
    for (const event of ["install_completed", "active", "contributed", "teammate_joined"]) {
      const { dataset, points } = fakeDataset();
      await handleTelemetryEvent(
        { dataset },
        post(payload({ event, campfireVersion: "1.2.0" })),
      );
      expect(points).toHaveLength(0);
    }
  });

  it("still records an unparseable version rather than guessing", async () => {
    const { dataset, points } = fakeDataset();
    await handleTelemetryEvent({ dataset }, post(payload({ campfireVersion: "unknown" })));
    expect(points).toHaveLength(1);
  });
});

describe("telemetry ingestion rate limit", () => {
  it("allows traffic up to the budget and refuses beyond it", async () => {
    const { dataset, points } = fakeDataset();
    const rateLimiter = limiter(2);
    const options = { dataset, rateLimiter };

    const first = await handleTelemetryEvent(options, post(payload(), { "CF-Connecting-IP": "203.0.113.7" }));
    expect(first.status).toBe(200);

    const second = await handleTelemetryEvent(options, post(payload(), { "CF-Connecting-IP": "203.0.113.7" }));
    expect(second.status).toBe(200);

    const third = await handleTelemetryEvent(options, post(payload(), { "CF-Connecting-IP": "203.0.113.7" }));
    expect(third.status).toBe(429);
    expect(points).toHaveLength(2);
  });

  it("never passes a network address to the binding", async () => {
    const { dataset } = fakeDataset();
    const rateLimiter = limiter(10);
    await handleTelemetryEvent(
      { dataset, rateLimiter },
      post(payload(), { "CF-Connecting-IP": "198.51.100.42" }),
    );
    expect(rateLimiter.keys).toHaveLength(1);
    expect(rateLimiter.keys[0]).not.toContain("198.51.100.42");
    expect(rateLimiter.keys[0]).toMatch(/^t[0-9a-f]+$/);
  });

  it("is stable per source so the budget actually accumulates", async () => {
    const { dataset } = fakeDataset();
    const rateLimiter = limiter(10);
    for (let index = 0; index < 3; index += 1) {
      await handleTelemetryEvent(
        { dataset, rateLimiter },
        post(payload(), { "CF-Connecting-IP": "203.0.113.9" }),
      );
    }
    expect(new Set(rateLimiter.keys).size).toBe(1);
  });

  it("does not limit when no binding is configured", async () => {
    const { dataset, points } = fakeDataset();
    for (let index = 0; index < 5; index += 1) {
      const response = await handleTelemetryEvent({ dataset }, post(payload()));
      expect(response.status).toBe(200);
    }
    expect(points).toHaveLength(5);
  });

  it("fails open when the binding throws", async () => {
    // A limiter that errors must not be able to silence telemetry for everyone.
    const { dataset, points } = fakeDataset();
    const broken: RateLimiterBinding = {
      async limit() {
        throw new Error("rate limiter unavailable");
      },
    };
    const response = await handleTelemetryEvent({ dataset, rateLimiter: broken }, post(payload()));
    expect(response.status).toBe(200);
    expect(points).toHaveLength(1);
  });

  it("does not limit a request with no address header", async () => {
    const { dataset } = fakeDataset();
    const rateLimiter = limiter(0);
    const response = await handleTelemetryEvent({ dataset, rateLimiter }, post(payload()));
    expect(response.status).toBe(200);
    expect(rateLimiter.keys).toHaveLength(0);
  });

  it("still answers 405 to a non-POST without consuming budget", async () => {
    const { dataset } = fakeDataset();
    const rateLimiter = limiter(10);
    const response = await handleTelemetryEvent(
      { dataset, rateLimiter },
      new Request("https://campfire.test/v1/telemetry"),
    );
    expect(response.status).toBe(405);
    expect(rateLimiter.keys).toHaveLength(0);
  });
});