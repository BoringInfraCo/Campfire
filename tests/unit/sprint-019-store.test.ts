import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Contribution } from "../../src/domain/types.js";
import type { DomainEventRecord, WebhookDeliveryRecord } from "../../src/domain/events.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";

const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-02T00:00:00.000Z";

let store: CampfireStore;

beforeEach(() => {
  store = openInMemoryStore();
});

afterEach(() => {
  store.close();
});

function seedWorkspace(): void {
  store.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: NOW });
  store.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: NOW });
  store.createWorkspace({
    id: "ws_1",
    teamId: "team_1",
    name: "Workspace One",
    status: "active",
    createdBy: { actorId: "hum_1", actorType: "human" },
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function contribution(id: string, createdAt = NOW): Contribution {
  return {
    id,
    workspaceId: "ws_1",
    actor: { actorId: "agt_1", actorType: "agent" },
    action: "create",
    objectType: "finding",
    objectId: "find_1",
    createdAt,
    appendPosition: 1,
  };
}

function domainEvent(id: string, contributionId: string, occurredAt = NOW): DomainEventRecord {
  return {
    id,
    specVersion: "1.0",
    type: "finding.recorded",
    occurredAt,
    workspaceId: "ws_1",
    actor: { actorId: "agt_1", actorType: "agent" },
    subjectType: "finding",
    subjectId: "find_1",
    summary: "JSON columns round-trip",
    data: { note: "kept", n: 1 },
    body: "{\"custom\":true}",
    contributionId,
    createdAt: occurredAt,
  };
}

function delivery(id: string, eventId: string, createdAt = NOW, patch: Partial<WebhookDeliveryRecord> = {}): WebhookDeliveryRecord {
  return {
    id,
    eventId,
    bridgeId: "bridge_a",
    status: "pending",
    attemptCount: 0,
    configFingerprint: "fp",
    createdAt,
    updatedAt: createdAt,
    ...patch,
  };
}

describe("sprint 019 store", () => {
  it("round-trips domain events without treating deliveries as contributions", () => {
    seedWorkspace();
    store.createContribution(contribution("con_1"));
    store.createDomainEvent(domainEvent("evt_later", "con_1", LATER));
    store.createDomainEvent({
      ...domainEvent("evt_sooner", "con_1", NOW),
      agentSessionId: "ses_1",
      onBehalfOf: { actorId: "hum_1", actorType: "human" },
    });
    store.createWebhookDelivery(delivery("dlv_1", "evt_sooner"));

    expect(store.getDomainEvent("evt_sooner")).toEqual({
      ...domainEvent("evt_sooner", "con_1", NOW),
      agentSessionId: "ses_1",
      onBehalfOf: { actorId: "hum_1", actorType: "human" },
    });
    expect(store.getDomainEvent("evt_later")).toEqual(domainEvent("evt_later", "con_1", LATER));
    expect(store.getDomainEvent("missing")).toBeUndefined();
    expect(store.listDomainEventsForWorkspace("ws_1").map((event) => event.id)).toEqual([
      "evt_sooner",
      "evt_later",
    ]);
    expect(store.listContributions("ws_1").map((row) => row.id)).toEqual(["con_1"]);
    expect(store.getWebhookDelivery("dlv_1")).toEqual(delivery("dlv_1", "evt_sooner"));
    expect(store.countWebhookDeliveries()).toEqual({
      pending: 1,
      delivering: 0,
      delivered: 0,
      exhausted: 0,
    });
  });

  it("lists due deliveries for one bridge in created order", () => {
    seedWorkspace();
    store.createContribution(contribution("con_1"));
    store.createDomainEvent(domainEvent("evt_1", "con_1"));
    store.createWebhookDelivery(delivery("dlv_other", "evt_1", "2026-01-01T00:00:00.000Z", { bridgeId: "bridge_b" }));
    store.createWebhookDelivery(
      delivery("dlv_stale", "evt_1", "2026-01-01T00:00:01.000Z", {
        status: "delivering",
        claimedAt: "2026-01-01T00:00:00.000Z",
        claimToken: "old",
      }),
    );
    store.createWebhookDelivery(delivery("dlv_due", "evt_1", "2026-01-01T00:00:02.000Z"));
    store.createWebhookDelivery(
      delivery("dlv_future", "evt_1", "2026-01-01T00:00:03.000Z", {
        nextAttemptAt: "2026-01-03T00:00:00.000Z",
      }),
    );
    store.createWebhookDelivery(
      delivery("dlv_fresh", "evt_1", "2026-01-01T00:00:04.000Z", {
        status: "delivering",
        claimedAt: LATER,
        claimToken: "fresh",
      }),
    );

    expect(
      store.listDueWebhookDeliveries({
        bridgeId: "bridge_a",
        now: LATER,
        leaseBefore: "2026-01-01T00:00:00.000Z",
        configFingerprint: "fp",
      }).map((row) => row.id),
    ).toEqual(["dlv_stale", "dlv_due"]);
    expect(store.countWebhookDeliveries()).toEqual({
      pending: 3,
      delivering: 2,
      delivered: 0,
      exhausted: 0,
    });
  });

  it("does not list or claim a row whose destination fingerprint changed", () => {
    seedWorkspace();
    store.createContribution(contribution("con_1"));
    store.createDomainEvent(domainEvent("evt_1", "con_1"));
    store.createWebhookDelivery(delivery("dlv_1", "evt_1", NOW, { configFingerprint: "old-fp" }));

    expect(
      store.listDueWebhookDeliveries({
        bridgeId: "bridge_a",
        now: LATER,
        leaseBefore: NOW,
        configFingerprint: "new-fp",
      }),
    ).toEqual([]);
    expect(
      store.claimWebhookDelivery("dlv_1", {
        now: LATER,
        claimToken: "tok-a",
        leaseBefore: NOW,
        configFingerprint: "new-fp",
      }),
    ).toBeUndefined();
    expect(store.getWebhookDelivery("dlv_1")?.status).toBe("pending");

    expect(
      store
        .listDueWebhookDeliveries({
          bridgeId: "bridge_a",
          now: LATER,
          leaseBefore: NOW,
          configFingerprint: "old-fp",
        })
        .map((row) => row.id),
    ).toEqual(["dlv_1"]);
  });

  it("claims once until the lease expires, then marks delivered only with the winning token", () => {
    seedWorkspace();
    store.createContribution(contribution("con_1"));
    store.createDomainEvent(domainEvent("evt_1", "con_1"));
    store.createWebhookDelivery(delivery("dlv_1", "evt_1"));

    const now = LATER;
    const leaseBefore = "2026-01-01T00:00:00.000Z";
    const first = store.claimWebhookDelivery("dlv_1", { now, claimToken: "tok-a", leaseBefore, configFingerprint: "fp" });
    expect(first).toMatchObject({ status: "delivering", claimToken: "tok-a", claimedAt: now });

    expect(
      store.claimWebhookDelivery("dlv_1", { now, claimToken: "tok-b", leaseBefore, configFingerprint: "fp" }),
    ).toBeUndefined();
    expect(
      store.claimWebhookDelivery("dlv_1", { now, claimToken: "tok-a", leaseBefore, configFingerprint: "other" }),
    ).toBeUndefined();
    expect(store.getWebhookDelivery("dlv_1")?.claimToken).toBe("tok-a");

    const afterLease = "2026-01-02T00:00:01.000Z";
    const renewed = store.claimWebhookDelivery("dlv_1", {
      now: afterLease,
      claimToken: "tok-c",
      leaseBefore: afterLease,
      configFingerprint: "fp",
    });
    expect(renewed?.claimToken).toBe("tok-c");
    expect(renewed?.claimedAt).toBe(afterLease);

    expect(store.markWebhookDeliveryDelivered("dlv_1", "tok-wrong", afterLease)).toBe(false);
    expect(store.getWebhookDelivery("dlv_1")?.status).toBe("delivering");

    const deliveredAt = "2026-01-02T00:00:02.000Z";
    expect(store.markWebhookDeliveryDelivered("dlv_1", "tok-c", deliveredAt)).toBe(true);
    expect(store.getWebhookDelivery("dlv_1")).toMatchObject({
      status: "delivered",
      deliveredAt,
      updatedAt: deliveredAt,
      attemptCount: 1,
    });
    expect(store.getWebhookDelivery("dlv_1")?.claimToken).toBeUndefined();
    expect(store.markWebhookDeliveryDelivered("dlv_1", "tok-c", "2026-01-02T00:00:03.000Z")).toBe(false);
    expect(store.getWebhookDelivery("dlv_1")?.attemptCount).toBe(1);
  });

  it("does not claim a pending delivery before next_attempt_at", () => {
    seedWorkspace();
    store.createContribution(contribution("con_1"));
    store.createDomainEvent(domainEvent("evt_1", "con_1"));
    store.createWebhookDelivery(
      delivery("dlv_1", "evt_1", NOW, { nextAttemptAt: "2026-01-03T00:00:00.000Z" }),
    );
    expect(
      store.claimWebhookDelivery("dlv_1", {
        now: LATER,
        claimToken: "tok-a",
        leaseBefore: NOW,
        configFingerprint: "fp",
      }),
    ).toBeUndefined();
    expect(store.getWebhookDelivery("dlv_1")?.status).toBe("pending");
  });

  it("retries only with the current claim token and clears the lease when exhausted", () => {
    seedWorkspace();
    store.createContribution(contribution("con_1"));
    store.createDomainEvent(domainEvent("evt_1", "con_1"));
    store.createWebhookDelivery(delivery("dlv_1", "evt_1"));
    store.claimWebhookDelivery("dlv_1", { now: LATER, claimToken: "tok-a", leaseBefore: NOW, configFingerprint: "fp" });

    expect(
      store.markWebhookDeliveryRetry("dlv_1", "tok-wrong", {
        attemptCount: 2,
        status: "exhausted",
        lastError: "nope",
        updatedAt: LATER,
      }),
    ).toBe(false);
    expect(store.getWebhookDelivery("dlv_1")?.status).toBe("delivering");

    expect(
      store.markWebhookDeliveryRetry("dlv_1", "tok-a", {
        attemptCount: 3,
        status: "exhausted",
        nextAttemptAt: LATER,
        lastError: "bridge down",
        updatedAt: "2026-01-02T00:00:05.000Z",
      }),
    ).toBe(true);
    const row = store.getWebhookDelivery("dlv_1");
    expect(row).toMatchObject({
      status: "exhausted",
      attemptCount: 3,
      lastError: "bridge down",
      updatedAt: "2026-01-02T00:00:05.000Z",
    });
    expect(row?.nextAttemptAt).toBeUndefined();
    expect(row?.claimToken).toBeUndefined();
    expect(row?.claimedAt).toBeUndefined();
  });

  it("rolls back the contribution and domain event when the transaction throws", () => {
    seedWorkspace();
    expect(() =>
      store.transaction(() => {
        store.createContribution(contribution("con_rollback"));
        store.createDomainEvent(domainEvent("evt_rollback", "con_rollback"));
        throw new Error("boom");
      }),
    ).toThrow("boom");

    expect(store.getContribution("con_rollback")).toBeUndefined();
    expect(store.getDomainEvent("evt_rollback")).toBeUndefined();
  });
});
