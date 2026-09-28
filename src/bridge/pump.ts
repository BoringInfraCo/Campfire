/**
 * Async webhook delivery pump.
 *
 * An unconfigured bridge returns immediately so removing configuration stops
 * new sends while pending rows remain. Rows outside the allowlist are not
 * claimed. The persisted event body is posted unchanged.
 */
import type { DomainEventRecord, WebhookDeliveryRecord } from "../domain/events.js";
import { bridgeAllows, type WebhookBridgeConfig } from "./config.js";
import { destinationFingerprint } from "./fingerprint.js";
import { postSignedWebhook } from "./post.js";
import { leaseBefore, nextRetry, sanitizeDeliveryError } from "./retry.js";

export interface DeliveryPumpStore {
  listDueWebhookDeliveries(input: {
    bridgeId: string;
    now: string;
    leaseBefore: string;
    configFingerprint: string;
  }): Promise<WebhookDeliveryRecord[]>;
  getDomainEvent(id: string): Promise<DomainEventRecord | undefined>;
  claimWebhookDelivery(
    id: string,
    input: { now: string; claimToken: string; leaseBefore: string; configFingerprint: string },
  ): Promise<WebhookDeliveryRecord | undefined>;
  markWebhookDeliveryDelivered(id: string, claimToken: string, deliveredAt: string): Promise<boolean>;
  markWebhookDeliveryRetry(
    id: string,
    claimToken: string,
    input: {
      attemptCount: number;
      status: "pending" | "exhausted";
      nextAttemptAt?: string;
      lastError?: string;
      updatedAt: string;
    },
  ): Promise<boolean>;
}

export async function pumpWebhookDeliveries(options: {
  store: DeliveryPumpStore;
  bridge: WebhookBridgeConfig | undefined;
  now: () => string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  limit?: number;
  newClaimToken?: () => string;
}): Promise<{ delivered: number; retried: number; exhausted: number; skipped: number }> {
  if (options.bridge === undefined) {
    return { delivered: 0, retried: 0, exhausted: 0, skipped: 0 };
  }

  const bridge = options.bridge;
  const fingerprint = destinationFingerprint(bridge);
  const limit = options.limit ?? 20;
  const newClaimToken = options.newClaimToken ?? (() => globalThis.crypto.randomUUID());
  const listedAt = options.now();
  const due = await options.store.listDueWebhookDeliveries({
    bridgeId: bridge.id,
    now: listedAt,
    leaseBefore: leaseBefore(listedAt),
    configFingerprint: fingerprint,
  });

  const counts = { delivered: 0, retried: 0, exhausted: 0, skipped: 0 };
  let claimsProcessed = 0;

  for (const row of due) {
    if (claimsProcessed >= limit) break;

    const event = await options.store.getDomainEvent(row.eventId);
    if (
      row.configFingerprint !== fingerprint ||
      event === undefined ||
      !bridgeAllows(bridge, { type: event.type, workspaceId: event.workspaceId })
    ) {
      counts.skipped += 1;
      continue;
    }

    const claimNow = options.now();
    const claimToken = newClaimToken();
    const claimed = await options.store.claimWebhookDelivery(row.id, {
      now: claimNow,
      claimToken,
      leaseBefore: leaseBefore(claimNow),
      configFingerprint: fingerprint,
    });
    if (claimed === undefined) {
      counts.skipped += 1;
      continue;
    }

    claimsProcessed += 1;
    const postNow = options.now();
    const result = await postSignedWebhook({
      url: bridge.url,
      secret: bridge.secret,
      eventId: event.id,
      eventType: event.type,
      body: event.body,
      timestampSeconds: String(Math.floor(Date.parse(postNow) / 1000)),
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });

    if (result.ok) {
      const recorded = await options.store.markWebhookDeliveryDelivered(
        claimed.id,
        claimToken,
        options.now(),
      );
      if (recorded) counts.delivered += 1;
      else counts.skipped += 1;
      continue;
    }

    const updatedAt = options.now();
    const attemptCount = claimed.attemptCount + 1;
    const retry = nextRetry(updatedAt, attemptCount);
    const recorded = await options.store.markWebhookDeliveryRetry(claimed.id, claimToken, {
      attemptCount,
      status: retry.status,
      ...(retry.status === "pending" ? { nextAttemptAt: retry.nextAttemptAt } : {}),
      lastError: sanitizeDeliveryError(result.error ?? "delivery failed", bridge.secret),
      updatedAt,
    });
    if (!recorded) {
      counts.skipped += 1;
      continue;
    }
    if (retry.status === "exhausted") counts.exhausted += 1;
    else counts.retried += 1;
  }

  return counts;
}
