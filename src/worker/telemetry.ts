/**
 * Anonymous product telemetry: Cloudflare ingestion (TEL-001F) and
 * installer-request measurement (TEL-001D).
 *
 * This adapter is thin on purpose. It validates the payload against the
 * schema in `src/telemetry/contract.ts` and writes one Analytics Engine data
 * point. It performs no authorization lookup, touches no D1 row, and makes no
 * outbound request, because telemetry must never become a way to observe or
 * delay a Campfire call. The only privacy-relevant decisions here are the ones
 * spelled out below; everything else — the allow-list, the vocabulary, the
 * blob positions — belongs to the contract module, which the CLI and the
 * installer share. AE allows one sampling index, so the dimensions do not
 * live in `indexes`.
 *
 * Note the contract is imported directly rather than through
 * `src/telemetry/index.ts`: that barrel also pulls in the local state file and
 * the Node-only HTTP client, which must never enter the Worker bundle.
 */
import {
  buildTelemetryEvent,
  normalizeTelemetryClientFamily,
  normalizeTelemetryInstallerRoute,
  normalizeTelemetryRegion,
  parseTelemetryEventV1,
  TELEMETRY_MAX_PAYLOAD_BYTES,
  telemetryDataPoint,
} from "../telemetry/contract.js";

/**
 * Optional Analytics Engine dataset binding
 * (`[[analytics_engine_datasets]] binding = "TELEMETRY"`). Structural type
 * only: `writeDataPoint` is the entire API this adapter uses, and declaring it
 * here keeps the worker free of `@cloudflare/workers-types`.
 */
export interface AnalyticsEngineDataset {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void;
}

/**
 * Ingestion path, unprefixed. The zone route carries a `/campfire` prefix that
 * `apiPath` strips, so one constant spells the route for the router, the
 * installer's `CAMPFIRE_TELEMETRY_URL`, and the tests.
 */
export const TELEMETRY_PATH = "/v1/telemetry";

export interface TelemetryIngestOptions {
  dataset?: AnalyticsEngineDataset;
}

/** Same envelope as `handler.ts`; duplicated rather than imported to avoid an adapter cycle. */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function fail(status: number, code: string, message: string): Response {
  return json(status, { ok: false, error: code, message });
}

/**
 * Read the body under a hard byte ceiling, streaming rather than trusting
 * `content-length`. A client that omits or understates the header must not be
 * able to make the Worker buffer an arbitrary body, so the cap is enforced
 * against bytes actually received and the stream is cancelled on breach.
 */
async function readBoundedJson(request: Request): Promise<
  | { ok: true; value: unknown }
  | { ok: false; response: Response }
> {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader !== undefined) {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > TELEMETRY_MAX_PAYLOAD_BYTES) {
        await reader.cancel();
        return { ok: false, response: fail(413, "ValidationError", "Telemetry payload too large") };
      }
      chunks.push(item.value);
    }
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, response: fail(400, "ValidationError", "Telemetry payload must be JSON") };
  }
}

/**
 * Accept one schema-v1 event.
 *
 * An undocumented field is a rejection rather than a silent drop: ignoring it
 * would let a future client smuggle content past the allow-list while still
 * being told it succeeded, which is exactly what the acceptance criteria
 * ("server accepts only documented events/fields") rule out.
 *
 * Responses are truthful about what happened. With no dataset bound — local
 * dev, or a deployment where the operator has not provisioned the dataset — the
 * event is accepted and reported as `recorded: false`, so the installer's
 * best-effort POST does not look like a failure and retry. `recorded: true`
 * means the binding accepted `writeDataPoint`; Analytics Engine persists it
 * asynchronously and does not provide a per-event durability acknowledgement.
 */
export async function handleTelemetryEvent(
  options: TelemetryIngestOptions,
  request: Request,
): Promise<Response> {
  if (request.method !== "POST") {
    return fail(405, "ValidationError", `Method not allowed: ${request.method}`);
  }

  const body = await readBoundedJson(request);
  if (!body.ok) return body.response;

  const parsed = parseTelemetryEventV1(body.value);
  if (!parsed.ok) {
    return parsed.reason === "unknown_field"
      ? fail(400, "ValidationError", "Telemetry payload contains an undocumented field")
      : fail(400, "ValidationError", "Telemetry payload does not match schema version 1");
  }

  if (options.dataset === undefined) {
    return json(200, { ok: true, result: { recorded: false } });
  }

  try {
    const extras =
      parsed.event.event === "install_completed"
        ? { region: installerRegionFrom(request) }
        : undefined;
    options.dataset.writeDataPoint(telemetryDataPoint(parsed.event, extras));
  } catch {
    // A measurement write must not become a client error: the caller has
    // nothing to fix, and a 500 here would make a successful install look
    // broken. Still report honestly that no data point was recorded.
    return json(200, { ok: true, result: { recorded: false } });
  }
  return json(200, { ok: true, result: { recorded: true } });
}

/**
 * Cloudflare's request metadata. Typed structurally so the Worker stays free
 * of `@cloudflare/workers-types`. Only `country` is ever read.
 */
interface IncomingRequestCfCountry {
  country?: unknown;
}

function installerRegionFrom(request: Request | undefined): string {
  if (request === undefined || !("cf" in request)) return "unknown";
  const cf = (request as Request & { cf?: IncomingRequestCfCountry }).cf;
  return normalizeTelemetryRegion(cf?.country);
}

function installerRouteFrom(request: Request | undefined): "latest" | "versioned" | "none" {
  if (request === undefined) return "none";
  return normalizeTelemetryInstallerRoute(new URL(request.url).pathname);
}

function clientFamilyFrom(request: Request | undefined): string | undefined {
  if (request === undefined) return undefined;
  return normalizeTelemetryClientFamily(request.headers.get("user-agent"));
}

/**
 * Record `install_requested` for the public installer route (TEL-001D).
 *
 * Anonymous by contract: no installation id exists yet at this point in the
 * funnel, and none is sent. The requestor is a shell pipeline, so os/arch stay
 * `unknown` — the installer reports platform truthfully in `install_completed`.
 * Country-level region is the one Cloudflare field this write reads
 * (`request.cf.country`, ISO 3166-1 alpha-2 such as US, CA, MX). The User-Agent
 * header is classified into a closed family and then discarded. Address, city,
 * colo, host, token headers, and the raw User-Agent are never stored.
 */
export function recordInstallRequested(
  dataset: AnalyticsEngineDataset | undefined,
  request?: Request,
): Promise<void> {
  if (dataset === undefined) return Promise.resolve();
  return Promise.resolve().then(() => {
    try {
      const route = installerRouteFrom(request);
      dataset.writeDataPoint(
        telemetryDataPoint(
          buildTelemetryEvent({
            event: "install_requested",
            installMethod: "curl",
            os: "unknown",
            arch: "unknown",
          }),
          {
            region: installerRegionFrom(request),
            ...(route === "none" ? {} : { installerRoute: route }),
            clientFamily: clientFamilyFrom(request) ?? "unknown",
          },
        ),
      );
    } catch {
      // Installer downloads must not fail because measurement failed.
    }
  });
}
