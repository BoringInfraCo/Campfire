import { describe, expect, it } from "vitest";
import { buildDomainEvent, stableEventBody } from "../../src/domain/event-body.js";
import { eventTypeForMutation, type QualifyingMutation } from "../../src/domain/event-qualify.js";
import type { CampfireEventType, DomainEventRecord, WebhookDeliveryRecord } from "../../src/domain/events.js";
import { bridgeAllows, readWebhookBridgeConfig, type WebhookBridgeConfig } from "../../src/bridge/config.js";
import {
  bridgeOperatorTokenMatches,
  readBridgeOperatorToken,
} from "../../src/bridge/config.js";
import { destinationFingerprint } from "../../src/bridge/fingerprint.js";
import { postSignedWebhook } from "../../src/bridge/post.js";
import { pumpWebhookDeliveries, type DeliveryPumpStore } from "../../src/bridge/pump.js";
import {
  buildBridgeReport,
  collectBridgeReport,
  formatBridgeReport,
  redactWebhookUrl,
} from "../../src/bridge/report.js";
import {
  nextRetry,
  sanitizeDeliveryError,
  WEBHOOK_CLAIM_LEASE_MS,
  WEBHOOK_DELIVERY_BATCH,
  WEBHOOK_MAX_ATTEMPTS,
} from "../../src/bridge/retry.js";

const NOW = "2026-09-27T00:00:00.000Z";
const SECRET = "super-secret-value";

function configuredEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    CAMPFIRE_WEBHOOK_ID: "bridge-1",
    CAMPFIRE_WEBHOOK_URL: "https://example.com/hook",
    CAMPFIRE_WEBHOOK_SECRET: SECRET,
    CAMPFIRE_WEBHOOK_EVENTS: "finding.recorded, decision.accepted, finding.recorded",
    CAMPFIRE_WEBHOOK_WORKSPACES: "ws_1, ws_1, ws_2",
    ...overrides,
  };
}

function bridgeConfig(overrides: Partial<WebhookBridgeConfig> = {}): WebhookBridgeConfig {
  return {
    id: "bridge-1",
    url: "https://example.com/hook",
    secret: "secret",
    eventTypes: ["finding.recorded"],
    workspaceIds: ["ws_1"],
    ...overrides,
  };
}

function sampleEvent(body?: string): DomainEventRecord {
  const built = buildDomainEvent({
    id: "evt_1",
    type: "finding.recorded",
    occurredAt: NOW,
    workspaceId: "ws_1",
    actor: { actorId: "agt_1", actorType: "agent" },
    subjectType: "finding",
    subjectId: "fin_1",
    summary: "Migration 284 is unsafe",
    data: { summary: "Migration 284 is unsafe" },
    contributionId: "con_1",
  });
  if (body !== undefined) built.record.body = body;
  return built.record;
}

function deliveryRow(overrides: Partial<WebhookDeliveryRecord> = {}): WebhookDeliveryRecord {
  return {
    id: "del_1",
    eventId: "evt_1",
    bridgeId: "bridge-1",
    status: "pending",
    attemptCount: 0,
    configFingerprint: destinationFingerprint(bridgeConfig()),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

async function hmacHeader(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const hex = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `v1=${hex}`;
}

describe("event qualification", () => {
  it.each<[QualifyingMutation, CampfireEventType]>([
    [{ kind: "finding.created" }, "finding.recorded"],
    [{ kind: "decision.created", status: "proposed" }, "decision.proposed"],
    [{ kind: "decision.updated", from: "proposed", to: "accepted" }, "decision.accepted"],
    [{ kind: "task.updated", from: "open", to: "blocked" }, "task.blocked"],
    [{ kind: "task.updated", from: "in_progress", to: "blocked" }, "task.blocked"],
    [{ kind: "task.updated", from: "open", to: "completed" }, "task.completed"],
    [{ kind: "task.updated", from: "blocked", to: "completed" }, "task.completed"],
    [{ kind: "goal.updated", from: "active", to: "completed" }, "goal.completed"],
    [{ kind: "goal.updated", from: "abandoned", to: "completed" }, "goal.completed"],
    [{ kind: "artifact.created" }, "artifact.attached"],
    [{ kind: "workspace.updated", from: "active", to: "completed" }, "workspace.completed"],
    [{ kind: "workspace.updated", from: "archived", to: "completed" }, "workspace.completed"],
  ])("maps %j to %s", (mutation, expected) => {
    expect(eventTypeForMutation(mutation)).toBe(expected);
  });

  it.each<QualifyingMutation>([
    { kind: "task.updated", from: "open", to: "open" },
    { kind: "task.updated", from: "blocked", to: "blocked" },
    { kind: "task.updated", from: "open", to: "in_progress" },
    { kind: "task.updated", from: "in_progress", to: "open" },
    { kind: "decision.created", status: "accepted" },
    { kind: "decision.created", status: "superseded" },
    { kind: "decision.updated", from: "accepted", to: "superseded" },
    { kind: "decision.updated", from: "proposed", to: "superseded" },
    { kind: "decision.updated", from: "proposed", to: "proposed" },
    { kind: "workspace.updated", from: "active", to: "archived" },
    { kind: "workspace.updated", from: "completed", to: "completed" },
    { kind: "goal.updated", from: "active", to: "abandoned" },
    { kind: "goal.updated", from: "completed", to: "completed" },
    { kind: "goal.updated", from: "active", to: "active" },
  ])("emits nothing for %j", (mutation) => {
    expect(eventTypeForMutation(mutation)).toBeUndefined();
  });
});

describe("domain event body", () => {
  const base = {
    id: "evt_1",
    type: "finding.recorded" as const,
    occurredAt: NOW,
    workspaceId: "ws_1",
    actor: { actorId: "agt_1", actorType: "agent" as const },
    subjectType: "finding" as const,
    subjectId: "fin_1",
    summary: "Migration 284 is unsafe",
    contributionId: "con_1",
  };

  it("omits agentSessionId and onBehalfOf when they are absent", () => {
    const { envelope, record } = buildDomainEvent({
      ...base,
      data: { summary: base.summary },
    });
    expect(envelope.specVersion).toBe("1.0");
    expect(envelope.provenance).toEqual({ contributionId: "con_1" });
    expect("agentSessionId" in envelope.provenance).toBe(false);
    expect("onBehalfOf" in envelope.provenance).toBe(false);
    expect("agentSessionId" in record).toBe(false);
    expect("onBehalfOf" in record).toBe(false);
    expect(record.createdAt).toBe(NOW);
    expect(record.workspaceId).toBe("ws_1");
    expect(record.contributionId).toBe("con_1");

    const parsed = JSON.parse(record.body) as {
      provenance: Record<string, unknown>;
    };
    expect(Object.keys(parsed)).toEqual([
      "specVersion",
      "id",
      "type",
      "occurredAt",
      "workspace",
      "actor",
      "subject",
      "summary",
      "data",
      "provenance",
    ]);
    expect(Object.keys(parsed.provenance)).toEqual(["contributionId"]);
    expect(record.body).toBe(stableEventBody(envelope));
    expect(stableEventBody(envelope)).toBe(stableEventBody(envelope));
    expect(buildDomainEvent({ ...base, data: { summary: base.summary } }).record.body).toBe(record.body);
  });

  it("includes agentSessionId and onBehalfOf when they are present", () => {
    const input = {
      ...base,
      data: { summary: base.summary },
      agentSessionId: "ses_1",
      onBehalfOf: { actorId: "hum_1", actorType: "human" as const },
    };
    const { envelope, record } = buildDomainEvent(input);
    expect(envelope.provenance).toEqual({
      contributionId: "con_1",
      agentSessionId: "ses_1",
      onBehalfOf: { actorId: "hum_1", actorType: "human" },
    });
    expect(record.agentSessionId).toBe("ses_1");
    expect(record.onBehalfOf).toEqual({ actorId: "hum_1", actorType: "human" });
    const parsed = JSON.parse(record.body) as { provenance: Record<string, unknown> };
    expect(Object.keys(parsed.provenance)).toEqual(["contributionId", "agentSessionId", "onBehalfOf"]);
    expect(Object.keys(parsed.provenance.onBehalfOf as Record<string, unknown>)).toEqual([
      "actorId",
      "actorType",
    ]);
    expect(record.body).toBe(stableEventBody(envelope));
    expect(buildDomainEvent(input).record.body).toBe(record.body);
  });

  it("drops data keys whose values are undefined", () => {
    const { envelope, record } = buildDomainEvent({
      ...base,
      data: { kept: "yes", dropped: undefined, also: 1 },
    });
    expect(envelope.data).toEqual({ kept: "yes", also: 1 });
    expect(record.data).toEqual({ kept: "yes", also: 1 });
    expect(Object.keys(JSON.parse(record.body).data as Record<string, unknown>)).toEqual(["kept", "also"]);
  });
});

describe("webhook config", () => {
  it("is off when every webhook variable is unset", () => {
    expect(readWebhookBridgeConfig({})).toEqual({ configured: false });
    expect(readWebhookBridgeConfig({ PATH: "/usr/bin" })).toEqual({ configured: false });
    expect("problem" in readWebhookBridgeConfig({})).toBe(false);
  });

  it("rejects a partial configuration without echoing the secret", () => {
    const result = readWebhookBridgeConfig({ CAMPFIRE_WEBHOOK_SECRET: SECRET });
    expect(result).toEqual({ configured: false, problem: "incomplete webhook configuration" });
    expect(JSON.stringify(result)).not.toContain(SECRET);

    const emptyList = readWebhookBridgeConfig(configuredEnv({ CAMPFIRE_WEBHOOK_EVENTS: " , " }));
    expect(emptyList).toEqual({ configured: false, problem: "incomplete webhook configuration" });
    expect(JSON.stringify(emptyList)).not.toContain(SECRET);
  });

  it("accepts https and loopback http, and preserves an explicit allowlist", () => {
    const https = readWebhookBridgeConfig(
      configuredEnv({
        CAMPFIRE_WEBHOOK_ID: "  bridge-1  ",
        CAMPFIRE_WEBHOOK_URL: "  https://example.com/hook  ",
        CAMPFIRE_WEBHOOK_SECRET: "  secret-bytes  ",
      }),
    );
    expect(https).toEqual({
      configured: true,
      bridge: {
        id: "bridge-1",
        url: "https://example.com/hook",
        secret: "  secret-bytes  ",
        eventTypes: ["finding.recorded", "decision.accepted"],
        workspaceIds: ["ws_1", "ws_2"],
      },
    });

    expect(
      readWebhookBridgeConfig(configuredEnv({ CAMPFIRE_WEBHOOK_URL: "http://127.0.0.1:8787/hook" })).configured,
    ).toBe(true);
    expect(readWebhookBridgeConfig(configuredEnv({ CAMPFIRE_WEBHOOK_URL: "http://localhost/hook" })).configured).toBe(
      true,
    );
    expect(readWebhookBridgeConfig(configuredEnv({ CAMPFIRE_WEBHOOK_URL: "http://[::1]/hook" })).configured).toBe(
      true,
    );
  });

  it("rejects non-loopback http and URLs with userinfo", () => {
    const http = readWebhookBridgeConfig(configuredEnv({ CAMPFIRE_WEBHOOK_URL: "http://example.com/hook" }));
    expect(http).toEqual({ configured: false, problem: "webhook URL is not allowed" });

    const credentials = readWebhookBridgeConfig(
      configuredEnv({ CAMPFIRE_WEBHOOK_URL: "https://user:pass@example.com/hook" }),
    );
    expect(credentials).toEqual({ configured: false, problem: "webhook URL is not allowed" });
    expect(JSON.stringify(credentials)).not.toContain(SECRET);
    expect(JSON.stringify(credentials)).not.toContain("user:pass");
    expect(JSON.stringify(credentials)).not.toContain("pass");
  });

  it("rejects an unknown event type without echoing it", () => {
    const result = readWebhookBridgeConfig(
      configuredEnv({ CAMPFIRE_WEBHOOK_EVENTS: `finding.recorded,${SECRET}` }),
    );
    expect(result).toEqual({ configured: false, problem: "unknown webhook event type" });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("allows an event only when both the type and the workspace are listed", () => {
    const result = readWebhookBridgeConfig(configuredEnv());
    expect(result.configured).toBe(true);
    if (!result.configured) return;
    expect(bridgeAllows(result.bridge, { type: "finding.recorded", workspaceId: "ws_1" })).toBe(true);
    expect(bridgeAllows(result.bridge, { type: "decision.accepted", workspaceId: "ws_2" })).toBe(true);
    expect(bridgeAllows(result.bridge, { type: "task.blocked", workspaceId: "ws_1" })).toBe(false);
    expect(bridgeAllows(result.bridge, { type: "finding.recorded", workspaceId: "ws_other" })).toBe(false);
    expect(bridgeAllows(result.bridge, { type: "finding.recorded", workspaceId: "ws_10" })).toBe(false);
  });

  it("reads the instance-operator token from its own variable, not an actor token", () => {
    expect(readBridgeOperatorToken({})).toBeUndefined();
    expect(readBridgeOperatorToken({ CAMPFIRE_BRIDGE_TOKEN: "   " })).toBeUndefined();
    expect(readBridgeOperatorToken({ CAMPFIRE_TOKEN: "cft_actor" })).toBeUndefined();
    expect(readBridgeOperatorToken({ CAMPFIRE_BRIDGE_TOKEN: "  operator-secret  " })).toBe(
      "operator-secret",
    );
  });

  it("matches the operator token exactly and rejects missing or empty values", () => {
    expect(bridgeOperatorTokenMatches("operator-secret", "operator-secret")).toBe(true);
    expect(bridgeOperatorTokenMatches("operator-secret", "operator-secrez")).toBe(false);
    expect(bridgeOperatorTokenMatches("operator", "operator-secret")).toBe(false);
    expect(bridgeOperatorTokenMatches(undefined, "operator-secret")).toBe(false);
    expect(bridgeOperatorTokenMatches("operator-secret", undefined)).toBe(false);
    expect(bridgeOperatorTokenMatches("", "")).toBe(false);
  });
});

describe("signed webhook post", () => {
  const request = {
    url: "https://example.com/hook",
    secret: "secret",
    eventId: "evt_1",
    eventType: "finding.recorded",
    body: '{"a":1}',
    timestampSeconds: "1700000000",
  };

  it("signs the timestamp and the exact body", async () => {
    const calls: RequestInit[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls.push(init ?? {});
      return new Response(null, { status: 204 });
    };
    const result = await postSignedWebhook({ ...request, fetchImpl });
    expect(result).toEqual({ ok: true });
    const init = calls[0];
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("manual");
    expect(init?.body).toBe(request.body);
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Campfire-Event-Id"]).toBe("evt_1");
    expect(headers["X-Campfire-Event-Type"]).toBe("finding.recorded");
    expect(headers["X-Campfire-Timestamp"]).toBe("1700000000");
    const expected = await hmacHeader("secret", "1700000000", '{"a":1}');
    expect(headers["X-Campfire-Signature"]).toBe(expected);
    expect(headers["X-Campfire-Signature"]).toMatch(/^v1=[0-9a-f]+$/);
  });

  it("refuses a redirect and asks fetch not to follow it", async () => {
    const calls: RequestInit[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls.push(init ?? {});
      return new Response(null, { status: 302, headers: { Location: "https://evil.example/steal" } });
    };
    const result = await postSignedWebhook({ ...request, fetchImpl });
    expect(result).toEqual({ ok: false, error: "redirect refused" });
    expect(calls[0]?.redirect).toBe("manual");
  });

  it("maps a TimeoutError to timeout", async () => {
    const fetchImpl: typeof fetch = async () => {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    };
    await expect(postSignedWebhook({ ...request, fetchImpl })).resolves.toEqual({
      ok: false,
      error: "timeout",
    });
  });

  it("returns HTTP 500 without throwing or including the response body", async () => {
    const fetchImpl: typeof fetch = async () => new Response("secret body", { status: 500 });
    const result = await postSignedWebhook({ ...request, fetchImpl });
    expect(result).toEqual({ ok: false, error: "HTTP 500" });
    expect(result.error).not.toContain("secret body");
  });
});

describe("retry policy", () => {
  it("waits 1000ms after the first failure and exhausts the fifth", () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(5);
    expect(nextRetry(NOW, 1)).toEqual({
      status: "pending",
      nextAttemptAt: "2026-09-27T00:00:01.000Z",
    });
    expect(nextRetry(NOW, 2)).toEqual({
      status: "pending",
      nextAttemptAt: "2026-09-27T00:00:02.000Z",
    });
    expect(nextRetry(NOW, 3)).toEqual({
      status: "pending",
      nextAttemptAt: "2026-09-27T00:00:04.000Z",
    });
    expect(nextRetry(NOW, 4)).toEqual({
      status: "pending",
      nextAttemptAt: "2026-09-27T00:00:08.000Z",
    });
    expect(nextRetry(NOW, 5)).toEqual({ status: "exhausted" });
    expect(() => nextRetry("not-a-date", 1)).toThrow(Error);
  });

  it("bounds diagnostics and strips secrets, tokens, and url userinfo", () => {
    const timeout = new Error(`timeout while using ${SECRET}`);
    timeout.name = "TimeoutError";
    expect(sanitizeDeliveryError(timeout, SECRET)).toBe("timeout");
    expect(sanitizeDeliveryError(new Error("HTTP 502 upstream"))).toBe("HTTP 502");
    expect(sanitizeDeliveryError(new Error("redirect refused"))).toBe("redirect refused");
    const leaked = sanitizeDeliveryError(
      new Error(`connect failed https://user:pass@example.com token cft_abc123 secret ${SECRET}`),
      SECRET,
    );
    expect(leaked).not.toContain(SECRET);
    expect(leaked).not.toContain("cft_abc123");
    expect(leaked).not.toContain("user:pass");
    expect(sanitizeDeliveryError(new Error("x".repeat(500))).length).toBe(200);
  });

  it("reduces a webhook URL in a diagnostic to its origin", () => {
    const sanitized = sanitizeDeliveryError(
      new Error("request to https://example.com/hook/live_SENTINEL?access_token=QUERY_SENTINEL failed"),
    );
    expect(sanitized).toBe("request to https://example.com failed");
    expect(sanitized).not.toContain("live_SENTINEL");
    expect(sanitized).not.toContain("QUERY_SENTINEL");
    expect(
      sanitizeDeliveryError(new Error("dial http://[::1]:8787/hooks/secret?token=x timed out")),
    ).toBe("dial http://[::1]:8787 timed out");
  });
});

describe("delivery pump", () => {
  it("marks a 2xx delivery delivered and posts the persisted body", async () => {
    const event = sampleEvent('{"specVersion":"1.0","id":"evt_1","sentinel":true}');
    const row = deliveryRow({ eventId: event.id });
    const posted: string[] = [];
    const marked: Array<{ id: string; claimToken: string; deliveredAt: string }> = [];
    let listed: { bridgeId: string; now: string; leaseBefore: string; configFingerprint: string; limit: number } | undefined;
    const store: DeliveryPumpStore = {
      listDueWebhookDeliveries: async (input) => {
        listed = input;
        return [row];
      },
      getDomainEvent: async (id) => (id === event.id ? event : undefined),
      claimWebhookDelivery: async (id, input) => ({
        ...row,
        id,
        status: "delivering",
        claimToken: input.claimToken,
        claimedAt: input.now,
      }),
      markWebhookDeliveryDelivered: async (id, claimToken, deliveredAt) => {
        marked.push({ id, claimToken, deliveredAt });
        return true;
      },
      markWebhookDeliveryRetry: async () => {
        throw new Error("retry was not expected");
      },
    };
    const fetchImpl: typeof fetch = async (_input, init) => {
      posted.push(String(init?.body));
      return new Response(null, { status: 204 });
    };

    const result = await pumpWebhookDeliveries({
      store,
      bridge: bridgeConfig(),
      now: () => NOW,
      fetchImpl,
      newClaimToken: () => "claim-1",
    });

    expect(result).toEqual({ delivered: 1, retried: 0, exhausted: 0, skipped: 0 });
    expect(posted).toEqual([event.body]);
    expect(marked).toEqual([{ id: row.id, claimToken: "claim-1", deliveredAt: NOW }]);
    expect(listed).toEqual({
      bridgeId: "bridge-1",
      now: NOW,
      leaseBefore: new Date(Date.parse(NOW) - WEBHOOK_CLAIM_LEASE_MS).toISOString(),
      configFingerprint: destinationFingerprint(bridgeConfig()),
      // PSA-001 / P1: the sweep's batch size reaches the store, so the read is
      // bounded in SQL rather than trimmed after every due row is fetched.
      limit: WEBHOOK_DELIVERY_BATCH,
    });
  });

  it("schedules a pending retry after HTTP 500", async () => {
    const event = sampleEvent();
    const row = deliveryRow({ eventId: event.id, attemptCount: 0 });
    let retry:
      | {
          attemptCount: number;
          status: string;
          nextAttemptAt?: string;
          lastError?: string;
        }
      | undefined;
    const store: DeliveryPumpStore = {
      listDueWebhookDeliveries: async () => [row],
      getDomainEvent: async () => event,
      claimWebhookDelivery: async (_id, input) => ({
        ...row,
        status: "delivering",
        claimToken: input.claimToken,
      }),
      markWebhookDeliveryDelivered: async () => {
        throw new Error("delivered was not expected");
      },
      markWebhookDeliveryRetry: async (_id, _token, input) => {
        retry = input;
        return true;
      },
    };
    const fetchImpl: typeof fetch = async () => new Response("nope", { status: 500 });
    const result = await pumpWebhookDeliveries({
      store,
      bridge: bridgeConfig(),
      now: () => NOW,
      fetchImpl,
      newClaimToken: () => "claim-1",
    });
    expect(result).toEqual({ delivered: 0, retried: 1, exhausted: 0, skipped: 0 });
    expect(retry).toEqual({
      attemptCount: 1,
      status: "pending",
      nextAttemptAt: "2026-09-27T00:00:01.000Z",
      lastError: "HTTP 500",
      updatedAt: NOW,
    });
  });

  it("marks the fifth failure exhausted", async () => {
    const event = sampleEvent();
    const row = deliveryRow({ eventId: event.id });
    let attemptCount = 0;
    let last:
      | {
          attemptCount: number;
          status: string;
          nextAttemptAt?: string;
          lastError?: string;
        }
      | undefined;
    const store: DeliveryPumpStore = {
      listDueWebhookDeliveries: async () => [deliveryRow({ eventId: event.id, attemptCount })],
      getDomainEvent: async () => event,
      claimWebhookDelivery: async (_id, input) => ({
        ...row,
        attemptCount,
        status: "delivering",
        claimToken: input.claimToken,
      }),
      markWebhookDeliveryDelivered: async () => false,
      markWebhookDeliveryRetry: async (_id, _token, input) => {
        attemptCount = input.attemptCount;
        last = input;
        return true;
      },
    };
    const fetchImpl: typeof fetch = async () => new Response(null, { status: 500 });
    const results = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      results.push(
        await pumpWebhookDeliveries({
          store,
          bridge: bridgeConfig(),
          now: () => NOW,
          fetchImpl,
          newClaimToken: () => `claim-${attempt}`,
        }),
      );
    }
    expect(results.slice(0, 4).every((result) => result.retried === 1)).toBe(true);
    expect(results[4]).toEqual({ delivered: 0, retried: 0, exhausted: 1, skipped: 0 });
    expect(last).toMatchObject({
      attemptCount: 5,
      status: "exhausted",
      lastError: "HTTP 500",
      updatedAt: NOW,
    });
    expect(last?.nextAttemptAt).toBeUndefined();
  });

  it("does not list or claim when the bridge is not configured", async () => {
    let listed = false;
    let claimed = false;
    const store: DeliveryPumpStore = {
      listDueWebhookDeliveries: async () => {
        listed = true;
        return [];
      },
      getDomainEvent: async () => {
        throw new Error("getDomainEvent was called");
      },
      claimWebhookDelivery: async () => {
        claimed = true;
        return undefined;
      },
      markWebhookDeliveryDelivered: async () => false,
      markWebhookDeliveryRetry: async () => false,
    };
    const result = await pumpWebhookDeliveries({
      store,
      bridge: undefined,
      now: () => NOW,
    });
    expect(result).toEqual({ delivered: 0, retried: 0, exhausted: 0, skipped: 0 });
    expect(listed).toBe(false);
    expect(claimed).toBe(false);
  });

  it("does not claim an event the allowlist excludes", async () => {
    const event = sampleEvent();
    let claims = 0;
    let fetches = 0;
    const store: DeliveryPumpStore = {
      listDueWebhookDeliveries: async () => [deliveryRow({ eventId: event.id })],
      getDomainEvent: async () => event,
      claimWebhookDelivery: async () => {
        claims += 1;
        return undefined;
      },
      markWebhookDeliveryDelivered: async () => false,
      markWebhookDeliveryRetry: async () => false,
    };
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      return new Response(null, { status: 204 });
    };
    const wrongType = await pumpWebhookDeliveries({
      store,
      bridge: bridgeConfig({ eventTypes: ["task.completed"] }),
      now: () => NOW,
      fetchImpl,
    });
    const wrongWorkspace = await pumpWebhookDeliveries({
      store,
      bridge: bridgeConfig({ workspaceIds: ["ws_other"] }),
      now: () => NOW,
      fetchImpl,
    });
    expect(wrongType).toEqual({ delivered: 0, retried: 0, exhausted: 0, skipped: 1 });
    expect(wrongWorkspace).toEqual({ delivered: 0, retried: 0, exhausted: 0, skipped: 1 });
    expect(claims).toBe(0);
    expect(fetches).toBe(0);
  });

  it("does not count a lost claim as delivered", async () => {
    const event = sampleEvent();
    const row = deliveryRow({ eventId: event.id });
    let claims = 0;
    let fetches = 0;
    const store: DeliveryPumpStore = {
      listDueWebhookDeliveries: async () => [row],
      getDomainEvent: async () => event,
      claimWebhookDelivery: async (_id, input) => {
        claims += 1;
        if (claims > 1) return undefined;
        return { ...row, status: "delivering", claimToken: input.claimToken };
      },
      markWebhookDeliveryDelivered: async () => true,
      markWebhookDeliveryRetry: async () => false,
    };
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      return new Response(null, { status: 204 });
    };
    const options = {
      store,
      bridge: bridgeConfig(),
      now: () => NOW,
      fetchImpl,
      newClaimToken: () => "claim-1",
    };
    const first = await pumpWebhookDeliveries(options);
    const second = await pumpWebhookDeliveries(options);
    expect(first).toEqual({ delivered: 1, retried: 0, exhausted: 0, skipped: 0 });
    expect(second).toEqual({ delivered: 0, retried: 0, exhausted: 0, skipped: 1 });
    expect(fetches).toBe(1);
  });

  it("does not post a row queued for a different destination with the same bridge id", async () => {
    const event = sampleEvent();
    const queuedFor = destinationFingerprint(bridgeConfig({ url: "https://old.example.com/hook" }));
    const row = deliveryRow({ eventId: event.id, configFingerprint: queuedFor });
    let claims = 0;
    let fetches = 0;
    const store: DeliveryPumpStore = {
      listDueWebhookDeliveries: async () => [row],
      getDomainEvent: async () => event,
      claimWebhookDelivery: async () => {
        claims += 1;
        return undefined;
      },
      markWebhookDeliveryDelivered: async () => false,
      markWebhookDeliveryRetry: async () => false,
    };
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      return new Response(null, { status: 204 });
    };

    const moved = await pumpWebhookDeliveries({
      store,
      // Same bridge id, different URL.
      bridge: bridgeConfig({ url: "https://new.example.com/hook" }),
      now: () => NOW,
      fetchImpl,
    });
    const rotated = await pumpWebhookDeliveries({
      store,
      // Same bridge id and URL, different signing secret.
      bridge: bridgeConfig({ secret: "rotated-secret" }),
      now: () => NOW,
      fetchImpl,
    });
    expect(moved).toEqual({ delivered: 0, retried: 0, exhausted: 0, skipped: 1 });
    expect(rotated).toEqual({ delivered: 0, retried: 0, exhausted: 0, skipped: 1 });
    expect(claims).toBe(0);
    expect(fetches).toBe(0);
  });
});

describe("bridge report", () => {
  const PATH_SENTINEL = "wh_live_9f3a7c";
  const QUERY_SENTINEL = "query_5c2b11";
  const RAW_URL = `https://example.com/hooks/${PATH_SENTINEL}?access_token=${QUERY_SENTINEL}`;

  function configured(url: string = RAW_URL): WebhookBridgeConfig {
    return {
      id: "bridge-1",
      url,
      secret: SECRET,
      eventTypes: ["finding.recorded"],
      workspaceIds: ["ws_1"],
    };
  }

  it("reports the origin only, never the raw path, query, or secret", () => {
    const event = sampleEvent();
    const report = buildBridgeReport({
      config: { configured: true, bridge: configured() },
      counts: { pending: 0, delivering: 0, delivered: 1, exhausted: 0 },
      deliveries: [
        {
          delivery: deliveryRow({ status: "delivered", deliveredAt: NOW }),
          event: { type: event.type, workspaceId: event.workspaceId },
        },
      ],
    });

    expect(report.origin).toBe("https://example.com");
    expect(report).not.toHaveProperty("url");
    const json = JSON.stringify(report);
    expect(json).not.toContain(PATH_SENTINEL);
    expect(json).not.toContain(QUERY_SENTINEL);
    expect(json).not.toContain(RAW_URL);
    expect(json).not.toContain(SECRET);

    const text = formatBridgeReport(report);
    expect(text).toContain("origin: https://example.com");
    expect(text).not.toContain(PATH_SENTINEL);
    expect(text).not.toContain(QUERY_SENTINEL);
    expect(text).not.toContain(SECRET);
  });

  it("redacts an unparsable destination", () => {
    expect(redactWebhookUrl("not a url")).toBe("[invalid webhook url]");
    expect(redactWebhookUrl("https://user:secret@example.com/hook")).toBe("https://example.com");
  });

  it("collects counts and delivery rows for sync and async sources", async () => {
    const event = sampleEvent();
    const delivery = deliveryRow({ status: "delivered", deliveredAt: NOW });
    const report = await collectBridgeReport(
      { configured: true, bridge: configured() },
      {
        countWebhookDeliveries: async () => ({ pending: 0, delivering: 0, delivered: 1, exhausted: 0 }),
        listWebhookDeliveries: async () => [delivery, deliveryRow({ id: "dlv_missing", eventId: "evt_missing" })],
        getDomainEvent: async (id) => (id === event.id ? event : undefined),
      },
    );
    expect(report.counts.delivered).toBe(1);
    expect(report.deliveries).toEqual([
      expect.objectContaining({ eventId: event.id, eventType: event.type, workspaceId: event.workspaceId }),
      expect.objectContaining({ eventId: "evt_missing" }),
    ]);
    expect(report.deliveries[1]?.eventType).toBeUndefined();
    expect(report.deliveries[1]?.workspaceId).toBeUndefined();
  });
});
