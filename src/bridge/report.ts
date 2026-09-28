/**
 * Operator view of the webhook bridge.
 *
 * The destination is reported as an origin only. Paths and query strings can
 * carry credentials, and the signing secret is never included.
 */
import type { WebhookConfigResult } from "./config.js";
import type {
  DomainEventRecord,
  WebhookDeliveryCounts,
  WebhookDeliveryRecord,
} from "../domain/events.js";

export interface BridgeDeliveryView {
  eventId: string;
  eventType?: string;
  workspaceId?: string;
  attemptCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt?: string;
  deliveredAt?: string;
  error?: string;
}

export interface BridgeReport {
  configured: boolean;
  id?: string;
  origin?: string;
  eventTypes?: readonly string[];
  workspaceIds?: readonly string[];
  problem?: string;
  counts: WebhookDeliveryCounts;
  deliveries: BridgeDeliveryView[];
}

/** Scheme, host, and port. No userinfo, path, query, or fragment. */
export function redactWebhookUrl(raw: string): string {
  try {
    return new URL(raw).origin;
  } catch {
    return "[invalid webhook url]";
  }
}

/**
 * Minimal read-only store shape both the SQLite CLI path and the D1 worker
 * route satisfy. One report builder means local and hosted output cannot
 * drift, and neither can leak the raw destination.
 */
export interface BridgeReportSource {
  countWebhookDeliveries(): WebhookDeliveryCounts | Promise<WebhookDeliveryCounts>;
  listWebhookDeliveries(): WebhookDeliveryRecord[] | Promise<WebhookDeliveryRecord[]>;
  getDomainEvent(id: string): DomainEventRecord | undefined | Promise<DomainEventRecord | undefined>;
}

/** Collect counts and delivery rows, then build the redacted operator view. */
export async function collectBridgeReport(
  config: WebhookConfigResult,
  source: BridgeReportSource,
): Promise<BridgeReport> {
  const counts = await source.countWebhookDeliveries();
  const rows = await source.listWebhookDeliveries();
  const deliveries: Array<{ delivery: WebhookDeliveryRecord; event?: DomainEventRecord }> = [];
  for (const delivery of rows) {
    const event = await source.getDomainEvent(delivery.eventId);
    deliveries.push(event === undefined ? { delivery } : { delivery, event });
  }
  return buildBridgeReport({ config, counts, deliveries });
}

export function buildBridgeReport(input: {
  config: WebhookConfigResult;
  counts: WebhookDeliveryCounts;
  deliveries: ReadonlyArray<{
    delivery: WebhookDeliveryRecord;
    event?: { type: string; workspaceId: string };
  }>;
}): BridgeReport {
  const { config, counts } = input;
  const deliveries = input.deliveries.map(({ delivery, event }) => {
    const view: BridgeDeliveryView = {
      eventId: delivery.eventId,
      ...(event !== undefined ? { eventType: event.type, workspaceId: event.workspaceId } : {}),
      attemptCount: delivery.attemptCount,
      status: delivery.status,
      createdAt: delivery.createdAt,
      updatedAt: delivery.updatedAt,
    };
    if (delivery.nextAttemptAt !== undefined) view.nextAttemptAt = delivery.nextAttemptAt;
    if (delivery.deliveredAt !== undefined) view.deliveredAt = delivery.deliveredAt;
    if (delivery.lastError !== undefined) view.error = delivery.lastError;
    return view;
  });
  if (!config.configured) {
    return {
      configured: false,
      ...(config.problem !== undefined ? { problem: config.problem } : {}),
      counts,
      deliveries,
    };
  }
  return {
    configured: true,
    id: config.bridge.id,
    origin: redactWebhookUrl(config.bridge.url),
    eventTypes: config.bridge.eventTypes,
    workspaceIds: config.bridge.workspaceIds,
    counts,
    deliveries,
  };
}

export function formatBridgeReport(report: BridgeReport): string {
  const lines = ["Webhook bridge", `configured: ${report.configured ? "yes" : "no"}`];
  if (report.configured) {
    lines.push(`id: ${report.id ?? ""}`, `origin: ${report.origin ?? ""}`);
    lines.push(`events: ${(report.eventTypes ?? []).join(", ")}`);
    lines.push(`workspaces: ${(report.workspaceIds ?? []).join(", ")}`);
  } else if (report.problem !== undefined) {
    lines.push(`problem: ${report.problem}`);
  }
  lines.push(
    `pending: ${report.counts.pending}`,
    `delivering: ${report.counts.delivering}`,
    `delivered: ${report.counts.delivered}`,
    `exhausted: ${report.counts.exhausted}`,
  );
  for (const delivery of report.deliveries) {
    lines.push(
      [
        delivery.eventId,
        delivery.eventType ?? "unknown",
        delivery.workspaceId ?? "unknown",
        delivery.status,
        `attempts=${delivery.attemptCount}`,
        delivery.error ?? "",
      ]
        .filter((part) => part.length > 0)
        .join("  "),
    );
  }
  return lines.join("\n");
}
