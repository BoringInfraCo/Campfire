/**
 * Viewer-only projection of `get_record_history`.
 *
 * The browser must not hold a contribution payload. HTTP, MCP, and CLI keep
 * the service JSON, including `payload`. This module imports neither
 * `node:http` nor `node:fs` so the Worker can share it.
 */

const PAYLOAD_SUMMARY_LIMIT = 160;
const TOKEN_LIMIT = 80;
const OMITTED_SUMMARY = "recorded payload omitted";

/** Stable order. A value is included only when it is a short token. */
const ALLOWED_PAYLOAD_KEYS = [
  "status",
  "currentness",
  "findingId",
  "artifactId",
  "decisionId",
  "taskId",
  "objectId",
  "objectType",
  "fromStatus",
  "toStatus",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tokenOf(value: unknown): string | undefined {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return String(value);
  }
  if (typeof value !== "string") return undefined;
  if (value.length === 0 || value.length > TOKEN_LIMIT || /\s/.test(value)) return undefined;
  return value;
}

/** Short plain summary, or the omitted marker when a payload had no safe token. */
export function contributionPayloadSummary(payload: unknown): string | undefined {
  if (payload === undefined) return undefined;
  if (!isRecord(payload)) return OMITTED_SUMMARY;
  const parts: string[] = [];
  for (const key of ALLOWED_PAYLOAD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    const token = tokenOf(payload[key]);
    if (token === undefined) continue;
    const pair = `${key} ${token}`;
    const next = parts.length === 0 ? pair : `${parts.join(" · ")} · ${pair}`;
    if (next.length > PAYLOAD_SUMMARY_LIMIT) continue;
    parts.push(pair);
  }
  if (parts.length === 0) return OMITTED_SUMMARY;
  return parts.join(" · ");
}

/**
 * Drop `payload` from each history item. Other methods must not call this.
 * Page fields other than `items` are copied through unchanged.
 */
export function projectViewerRecordHistory(result: unknown): unknown {
  if (!isRecord(result) || !Array.isArray(result.items)) return result;
  return {
    ...result,
    items: result.items.map((item) => {
      if (!isRecord(item) || !Object.prototype.hasOwnProperty.call(item, "payload")) return item;
      const summary = contributionPayloadSummary(item.payload);
      const next: Record<string, unknown> = {};
      for (const key of Object.keys(item)) {
        if (key === "payload" || key === "payloadSummary") continue;
        next[key] = item[key];
      }
      if (summary !== undefined) next.payloadSummary = summary;
      return next;
    }),
  };
}
