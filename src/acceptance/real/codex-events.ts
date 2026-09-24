/**
 * Parsing for Codex `exec --json` output.
 *
 * Codex emits JSONL lifecycle events (`thread.started`, `turn.*`, `item.*`).
 * The `item` schema for MCP tool calls is not fully documented and changes
 * across versions, so field extraction here is intentionally defensive: it
 * probes several plausible shapes and never throws on an unrecognized item.
 * Unknown items are still recorded as events so evidence capture is lossless.
 */
import type { HarnessEvent, HarnessToolCall, HarnessUsage, McpCall } from "./types.js";
import type { ParsedHarnessStream } from "./opencode-events.js";
import { canonicalToolName, isCampfireTool } from "./tools.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asString(source[key]);
    if (value !== undefined && value.length > 0) return value;
  }
  return undefined;
}

function firstRecord(source: Record<string, unknown>, keys: string[]): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = source[key];
    if (isRecord(value)) return value;
  }
  return undefined;
}

function stringifyOutput(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractError(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (isRecord(value)) return firstString(value, ["message", "error"]);
  return undefined;
}

function itemLooksLikeTool(itemType: string): boolean {
  const lower = itemType.toLowerCase();
  return (
    lower.includes("mcp") ||
    lower.includes("tool") ||
    lower.includes("function") ||
    lower.includes("call")
  );
}

function itemLooksLikeMessage(itemType: string): boolean {
  const lower = itemType.toLowerCase();
  return lower.includes("agent_message") || lower.includes("assistant") || lower.includes("message");
}

/**
 * Resolve a tool name from the first present candidate. `server` + tool is a
 * fallback for MCP items that split the server and tool into separate fields.
 */
function extractToolName(item: Record<string, unknown>): string | undefined {
  const direct = firstString(item, ["tool", "name", "tool_name"]);
  if (direct !== undefined) return direct;

  const server = asString(item.server);
  const short = firstString(item, ["tool", "tool_name", "name"]);
  if (server !== undefined && short !== undefined) {
    return short.startsWith(server) ? short : `${server}.${short}`;
  }

  const fn = isRecord(item.function) ? item.function : undefined;
  return fn !== undefined ? asString(fn.name) : undefined;
}

function extractUsage(source: Record<string, unknown>): HarnessUsage | undefined {
  const nested = isRecord(source.usage) ? source.usage : source;
  const inputTokens = asNumber(nested.input_tokens) ?? asNumber(nested.inputTokens);
  const outputTokens = asNumber(nested.output_tokens) ?? asNumber(nested.outputTokens);
  const totalTokens = asNumber(nested.total_tokens) ?? asNumber(nested.totalTokens);
  const costUsd = asNumber(nested.cost) ?? asNumber(nested.cost_usd) ?? asNumber(nested.costUsd);

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    costUsd === undefined
  ) {
    return undefined;
  }

  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
}

export function parseCodexEvents(jsonl: string): ParsedHarnessStream {
  const events: HarnessEvent[] = [];
  // Codex emits both `item.started` and `item.completed` for MCP/tool calls.
  // Key by item id and merge so a single logical call is counted once, keeping
  // the completed result when it arrives.
  const mcpById = new Map<string, McpCall>();
  const nonMcpById = new Map<string, HarnessToolCall>();
  let finalMessage = "";
  let harnessSessionId: string | undefined;
  let usage: HarnessUsage | undefined;
  let error: string | undefined;
  let fallbackId = 0;

  const lines = jsonl.split(/\r?\n/);
  for (const line of lines) {
    if (line.trim().length === 0) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;

    const type = asString(parsed.type) ?? "unknown";
    events.push({ type, raw: parsed });

    if (type === "thread.started" && harnessSessionId === undefined) {
      harnessSessionId = firstString(parsed, ["thread_id", "threadId"]);
    }

    if (type === "turn.completed") {
      usage = extractUsage(parsed) ?? usage;
    }

    if (type === "turn.failed") {
      error = extractError(parsed.error) ?? firstString(parsed, ["message"]) ?? error;
    }

    if (type === "error") {
      error = firstString(parsed, ["message"]) ?? extractError(parsed.error) ?? error;
    }

    // Only item.* lifecycle events carry tool/assistant payloads.
    if (!type.startsWith("item.")) continue;
    const item = isRecord(parsed.item) ? parsed.item : undefined;
    if (item === undefined) continue;

    const itemType = asString(item.type) ?? "";
    const itemName = asString(item.name);
    const effectiveType = itemType.length > 0 ? itemType : itemName ?? "";

    if (itemLooksLikeTool(effectiveType)) {
      const rawTool = extractToolName(item);
      if (rawTool !== undefined) {
        const inputSource = firstRecord(item, ["arguments", "input", "params"]);
        const output = stringifyOutput(item.result ?? item.output ?? item.content ?? item.response);
        const isError = asString(item.status) === "failed" || Boolean(item.error);
        fallbackId += 1;
        const itemId = asString(item.id) ?? `__item_${fallbackId}`;

        if (isCampfireTool(rawTool)) {
          const previous = mcpById.get(itemId);
          mcpById.set(itemId, {
            rawTool,
            tool: canonicalToolName(rawTool),
            ...(inputSource ?? previous?.input ? { input: inputSource ?? previous?.input } : {}),
            ...(output ?? previous?.output ? { output: output ?? previous?.output } : {}),
            ...(isError || previous?.isError ? { isError: true } : {}),
          });
        } else {
          const previous = nonMcpById.get(itemId);
          nonMcpById.set(itemId, {
            rawTool,
            tool: rawTool,
            ...(inputSource ?? previous?.input ? { input: inputSource ?? previous?.input } : {}),
          });
        }
      }
      // Fall through: a tool item may also carry assistant text in some versions.
    }

    if (itemLooksLikeMessage(effectiveType)) {
      const candidate =
        firstString(item, ["text", "message"]) ??
        (typeof item.content === "string" ? item.content : undefined) ??
        (item.content !== undefined ? stringifyOutput(item.content) : undefined);
      if (candidate !== undefined) finalMessage = candidate;
    }
  }

  return {
    events,
    mcpCalls: [...mcpById.values()],
    nonMcpToolCalls: [...nonMcpById.values()],
    finalMessage,
    ...(harnessSessionId !== undefined ? { harnessSessionId } : {}),
    ...(usage !== undefined ? { usage } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}
