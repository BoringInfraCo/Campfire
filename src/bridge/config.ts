/**
 * Operator webhook configuration.
 *
 * Read from the process environment. This is not an MCP tool, and this module
 * does not persist or log the signing secret.
 */
import { CAMPFIRE_EVENT_TYPES, type CampfireEventType } from "../domain/events.js";

export interface WebhookBridgeConfig {
  id: string;
  url: string;
  secret: string;
  eventTypes: readonly CampfireEventType[];
  workspaceIds: readonly string[];
}

export type WebhookConfigResult =
  | { configured: false; problem?: string }
  | { configured: true; bridge: WebhookBridgeConfig };

const ENV_ID = "CAMPFIRE_WEBHOOK_ID";
const ENV_URL = "CAMPFIRE_WEBHOOK_URL";
const ENV_SECRET = "CAMPFIRE_WEBHOOK_SECRET";
const ENV_EVENTS = "CAMPFIRE_WEBHOOK_EVENTS";
const ENV_WORKSPACES = "CAMPFIRE_WEBHOOK_WORKSPACES";
const ENV_OPERATOR_TOKEN = "CAMPFIRE_BRIDGE_TOKEN";

const ENV_NAMES = [ENV_ID, ENV_URL, ENV_SECRET, ENV_EVENTS, ENV_WORKSPACES] as const;

const LOOPBACK_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

function splitList(value: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const part of value.split(",")) {
    const token = part.trim();
    if (token.length === 0 || seen.has(token)) continue;
    seen.add(token);
    items.push(token);
  }
  return items;
}

function isCampfireEventType(value: string): value is CampfireEventType {
  return (CAMPFIRE_EVENT_TYPES as readonly string[]).includes(value);
}

/** HTTPS anywhere. HTTP only for loopback. Userinfo is never allowed. */
function webhookUrlAllowed(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return false;
  if (url.hostname === "") return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return LOOPBACK_HTTP_HOSTS.has(url.hostname);
  return false;
}

export function readWebhookBridgeConfig(env: Record<string, string | undefined>): WebhookConfigResult {
  const values = ENV_NAMES.map((name) => env[name]);
  if (values.every((value) => value === undefined)) {
    return { configured: false };
  }
  if (values.some((value) => isBlank(value))) {
    return { configured: false, problem: "incomplete webhook configuration" };
  }

  const eventTokens = splitList(env[ENV_EVENTS] ?? "");
  const workspaceIds = splitList(env[ENV_WORKSPACES] ?? "");
  if (eventTokens.length === 0 || workspaceIds.length === 0) {
    return { configured: false, problem: "incomplete webhook configuration" };
  }

  const eventTypes: CampfireEventType[] = [];
  for (const token of eventTokens) {
    if (!isCampfireEventType(token)) {
      return { configured: false, problem: "unknown webhook event type" };
    }
    eventTypes.push(token);
  }

  const url = (env[ENV_URL] ?? "").trim();
  if (!webhookUrlAllowed(url)) {
    return { configured: false, problem: "webhook URL is not allowed" };
  }

  return {
    configured: true,
    bridge: {
      id: (env[ENV_ID] ?? "").trim(),
      url,
      secret: env[ENV_SECRET] ?? "",
      eventTypes,
      workspaceIds,
    },
  };
}

export function bridgeAllows(
  bridge: WebhookBridgeConfig,
  event: { type: string; workspaceId: string },
): boolean {
  return (
    (bridge.eventTypes as readonly string[]).includes(event.type) &&
    bridge.workspaceIds.includes(event.workspaceId)
  );
}

/**
 * Instance-operator credential for hosted bridge inspection.
 *
 * This is deliberately not an actor token. Resolving an actor would put
 * instance-wide bridge configuration and delivery metadata behind a workspace
 * authorization check that does not apply to operator configuration, so we
 * require a distinct credential that grants no Campfire identity or workspace
 * access. Unset means the hosted inspection route stays closed.
 */
export function readBridgeOperatorToken(env: Record<string, string | undefined>): string | undefined {
  const token = (env[ENV_OPERATOR_TOKEN] ?? "").trim();
  return token.length > 0 ? token : undefined;
}

/**
 * Constant-time comparison for equal-length values. Missing or empty values
 * fail without a content-dependent branch.
 */
export function bridgeOperatorTokenMatches(
  provided: string | undefined,
  expected: string | undefined,
): boolean {
  if (provided === undefined || expected === undefined) return false;
  if (provided.length === 0 || expected.length === 0) return false;
  const left = new TextEncoder().encode(provided);
  const right = new TextEncoder().encode(expected);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}
