/**
 * Bounded operational measurement for the hosted alpha. Dimensions are a
 * closed route vocabulary and HTTP outcome only; request URLs, capabilities,
 * actor ids, workspace ids, and bodies never enter Analytics Engine.
 */
import type { AnalyticsEngineDataset } from "./telemetry.js";

export type AlphaRoute =
  | "publication_enroll"
  | "publication_import"
  | "publication_recover"
  | "invitation_preview"
  | "invitation_decline"
  | "invitation_redeem"
  | "api_call"
  | "join_page"
  | "installer"
  | "telemetry"
  | "other";

export function alphaRoute(request: Request): AlphaRoute {
  let path: string;
  try { path = new URL(request.url).pathname; }
  catch { return "other"; }
  if (path.startsWith("/campfire/")) path = path.slice("/campfire".length);
  switch (path) {
    case "/v1/publication/enroll": return "publication_enroll";
    case "/v1/publication/import": return "publication_import";
    case "/v1/publication/recover": return "publication_recover";
    case "/v1/enrollment/preview": return "invitation_preview";
    case "/v1/enrollment/decline": return "invitation_decline";
    case "/v1/enrollment/redeem": return "invitation_redeem";
    case "/v1/call": return "api_call";
    case "/join": return "join_page";
    case "/v1/telemetry": return "telemetry";
    case "/install.sh": return "installer";
    default: return /^\/v\d+\.\d+\.\d+\/install\.sh$/.test(path) ? "installer" : "other";
  }
}

export function recordAlphaRequest(
  dataset: AnalyticsEngineDataset | undefined,
  request: Request,
  status: number,
  elapsedMs: number,
): void {
  if (dataset === undefined) return;
  const route = alphaRoute(request);
  const method = request.method === "GET" || request.method === "POST" ? request.method : "OTHER";
  const outcome = status === 429 ? "limited" : status === 503 ? "unavailable" :
    status >= 500 ? "server_error" : status >= 400 ? "client_error" : "success";
  try {
    dataset.writeDataPoint({
      indexes: [route],
      blobs: [route, method, outcome, String(status)],
      doubles: [1, Number.isFinite(elapsedMs) ? Math.max(0, Math.round(elapsedMs)) : 0],
    });
  } catch {
    // A metrics outage must not change an authenticated Campfire response.
  }
}
