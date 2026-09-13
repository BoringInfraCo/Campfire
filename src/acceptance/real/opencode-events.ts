/**
 * Parsing for OpenCode `run --format json` output.
 *
 * OpenCode emits JSONL where each line is an object with a `type` and (usually)
 * a `part`. The stream is heterogeneous and version-dependent, so this parser is
 * deliberately permissive: a line that is not a well-formed JSON object is
 * ignored, and no field access is allowed to throw. Parsing is pure and
 * deterministic — Sprint 002 correctness must not depend on a model.
 */
import type { HarnessEvent, HarnessToolCall, HarnessUsage, McpCall } from "./types.js";
import { canonicalToolName, isCampfireTool } from "./tools.js";

export interface ParsedHarnessStream {
  events: HarnessEvent[];
  mcpCalls: McpCall[];
  nonMcpToolCalls: HarnessToolCall[];
  finalMessage: string;
  harnessSessionId?: string;
  usage?: HarnessUsage;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Preserve string output verbatim; otherwise serialize the structured value. */
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
  if (isRecord(value)) return asString(value.message);
  return undefined;
}

export function parseOpencodeEvents(jsonl: string): ParsedHarnessStream {
  const events: HarnessEvent[] = [];
  const mcpCalls: McpCall[] = [];
  const nonMcpToolCalls: HarnessToolCall[] = [];
  let finalMessage = "";
  let harnessSessionId: string | undefined;
  let error: string | undefined;

  let sawUsage = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let costUsd = 0;

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

    // Session id: first non-empty `sessionID` anywhere in the stream.
    if (harnessSessionId === undefined) {
      const sessionId = asString(parsed.sessionID);
      if (sessionId !== undefined && sessionId.trim().length > 0) {
        harnessSessionId = sessionId;
      }
    }

    if (type === "error") {
      error = extractError(parsed.error) ?? asString(parsed.message) ?? error;
    }

    const part = isRecord(parsed.part) ? parsed.part : undefined;
    if (part === undefined) continue;

    const partType = asString(part.type);

    if (partType === "tool") {
      const rawTool = asString(part.tool);
      if (rawTool === undefined || rawTool.length === 0) continue;

      const state = isRecord(part.state) ? part.state : undefined;
      const input = state !== undefined && isRecord(state.input) ? state.input : undefined;
      const output = stringifyOutput(state?.output);
      const isError =
        (state !== undefined && asString(state.status) === "error") ||
        (state !== undefined && Boolean(state.error));

      if (isCampfireTool(rawTool)) {
        mcpCalls.push({
          rawTool,
          tool: canonicalToolName(rawTool),
          ...(input !== undefined ? { input } : {}),
          ...(output !== undefined ? { output } : {}),
          ...(isError ? { isError } : {}),
        });
      } else {
        nonMcpToolCalls.push({
          rawTool,
          tool: rawTool,
          ...(input !== undefined ? { input } : {}),
        });
      }
      continue;
    }

    if (partType === "text") {
      // Last text part wins; this is the harness's final assistant message.
      const text = asString(part.text);
      if (text !== undefined) finalMessage = text;
      continue;
    }

    if (type === "step_finish") {
      const tokens = isRecord(part.tokens) ? part.tokens : undefined;
      if (tokens !== undefined || asNumber(part.cost) !== undefined) {
        sawUsage = true;
        inputTokens += asNumber(tokens?.input) ?? 0;
        outputTokens += asNumber(tokens?.output) ?? 0;
        totalTokens += asNumber(tokens?.total) ?? 0;
        costUsd += asNumber(part.cost) ?? 0;
      }
    }
  }

  const usage: HarnessUsage | undefined = sawUsage
    ? {
        inputTokens,
        outputTokens,
        totalTokens,
        costUsd,
      }
    : undefined;

  return {
    events,
    mcpCalls,
    nonMcpToolCalls,
    finalMessage,
    ...(harnessSessionId !== undefined ? { harnessSessionId } : {}),
    ...(usage !== undefined ? { usage } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}
