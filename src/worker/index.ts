/**
 * Cloudflare Workers entrypoint for Campfire.
 *
 * Production wiring: D1 (`env.DB`) -> async store -> async application
 * service -> thin fetch handler. Workers Assets serve only the installer;
 * the journal runs in a loopback Viewer process with its bearer server-side.
 * No secrets in code; actor identity always comes
 * from the bearer token (service.resolveToken), never from request params.
 *
 * Webhook delivery runs after a successful write response is produced
 * (waitUntil) and again on the scheduled trigger. It does not run inside the
 * mutation batch, and it is not scheduled for reads, the installer, or
 * telemetry: those cannot enqueue a delivery (PSA-001 / P1), so sweeping after
 * them made every ordinary read pay for a D1 delivery query.
 */
import { pumpWebhookDeliveries } from "../bridge/pump.js";
import { bridgeFromEnv } from "../service/outbox.js";
import { createD1Store } from "./d1-store.js";
import type { CampfireWorkerEnv } from "./d1-types.js";
import { createD1WorkerHandler } from "./handler.js";
import { createD1TelemetryGuard } from "../telemetry/guard.js";
import type { TelemetryGateMode } from "./telemetry.js";

interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}

function webhookEnv(env: CampfireWorkerEnv): Record<string, string | undefined> {
  return {
    CAMPFIRE_WEBHOOK_ID: env.CAMPFIRE_WEBHOOK_ID,
    CAMPFIRE_WEBHOOK_URL: env.CAMPFIRE_WEBHOOK_URL,
    CAMPFIRE_WEBHOOK_SECRET: env.CAMPFIRE_WEBHOOK_SECRET,
    CAMPFIRE_WEBHOOK_EVENTS: env.CAMPFIRE_WEBHOOK_EVENTS,
    CAMPFIRE_WEBHOOK_WORKSPACES: env.CAMPFIRE_WEBHOOK_WORKSPACES,
    CAMPFIRE_BRIDGE_TOKEN: env.CAMPFIRE_BRIDGE_TOKEN,
    CAMPFIRE_GITHUB_SOURCE_ID: env.CAMPFIRE_GITHUB_SOURCE_ID,
    CAMPFIRE_GITHUB_SOURCE_WORKSPACE_ID: env.CAMPFIRE_GITHUB_SOURCE_WORKSPACE_ID,
    CAMPFIRE_GITHUB_SOURCE_REPOSITORY_ID: env.CAMPFIRE_GITHUB_SOURCE_REPOSITORY_ID,
    CAMPFIRE_GITHUB_SOURCE_REPOSITORY_NAME: env.CAMPFIRE_GITHUB_SOURCE_REPOSITORY_NAME,
    CAMPFIRE_GITHUB_SOURCE_WORKFLOW_ID: env.CAMPFIRE_GITHUB_SOURCE_WORKFLOW_ID,
    CAMPFIRE_GITHUB_SOURCE_KIND: env.CAMPFIRE_GITHUB_SOURCE_KIND,
    CAMPFIRE_GITHUB_SOURCE_SECRET: env.CAMPFIRE_GITHUB_SOURCE_SECRET,
    CAMPFIRE_GITHUB_SOURCE_AGENT_ID: env.CAMPFIRE_GITHUB_SOURCE_AGENT_ID,
    CAMPFIRE_GITHUB_SOURCE_SESSION_ID: env.CAMPFIRE_GITHUB_SOURCE_SESSION_ID,
  };
}

/**
 * Integrity gate mode from the environment. Empty, unset, or unknown falls
 * back to the adapter default: `shadow` when a guard is present (the Worker
 * always builds one from `env.DB`), so production measures without rejecting.
 */
function telemetryGateMode(env: CampfireWorkerEnv): TelemetryGateMode | undefined {
  const raw = (env.TELEMETRY_GATE_MODE ?? "").trim().toLowerCase();
  if (raw === "enforce" || raw === "shadow" || raw === "off") return raw;
  return undefined;
}

async function deliverPending(env: CampfireWorkerEnv): Promise<void> {
  const store = createD1Store(env.DB);
  const bridge = bridgeFromEnv(webhookEnv(env));
  await pumpWebhookDeliveries({
    store,
    bridge,
    now: () => new Date().toISOString(),
  });
}

export default {
  async fetch(request: Request, env: CampfireWorkerEnv, ctx: WorkerContext): Promise<Response> {
    const store = createD1Store(env.DB);
    // Set by the handler only when a write committed a delivery-eligible
    // mutation. Kept out of the handler's return type deliberately: the sweep is
    // an operational side effect, not part of the client's response contract.
    let deliveryEnqueued = false;
    const handle = createD1WorkerHandler({
      store,
      assetsFetch: (req) => env.ASSETS.fetch(req),
      webhookEnv: webhookEnv(env),
      sourceEnv: webhookEnv(env),
      onWriteCommitted: () => {
        deliveryEnqueued = true;
      },
      // Passed through as-is, including undefined: an unprovisioned dataset
      // must leave the installer and the ingestion route working, not crash.
      telemetryDataset: env.TELEMETRY,
      // Same for the limiter: absent binding means the ingestion route is
      // unbounded, which is exactly how it behaved before the binding existed.
      telemetryRateLimiter: env.TELEMETRY_RATE_LIMITER,
      // Integrity: outcome measurement and the per-installation budget are
      // optional bindings like the ones above. The guard is built from the
      // Worker's own D1 so claims land in the same database the migrations
      // provision; with no explicit TELEMETRY_GATE_MODE the adapter defaults
      // to shadow (measure, do not reject).
      telemetryOpsDataset: env.TELEMETRY_OPS,
      telemetryIdRateLimiter: env.TELEMETRY_ID_RATE_LIMITER,
      telemetryGuard: createD1TelemetryGuard(env.DB),
      telemetryGateMode: telemetryGateMode(env),
    });
    const response = await handle(request);
    // Immediate delivery is retained for writes, so a freshly enqueued delivery
    // still leaves the instance without waiting for the scheduled trigger.
    if (deliveryEnqueued) {
      ctx.waitUntil(deliverPending(env).catch(() => undefined));
    }
    return response;
  },

  async scheduled(_controller: unknown, env: CampfireWorkerEnv, ctx: WorkerContext): Promise<void> {
    // The scheduled trigger is the retry/lease-recovery path and is retained.
    ctx.waitUntil(deliverPending(env).catch(() => undefined));
  },
};
