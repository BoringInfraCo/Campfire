/**
 * Deterministic ergonomics analysis for Campfire MCP call traces.
 *
 * Sprint 002 section 12 asks us to observe how a real agent orients. These are
 * simple, inspectable heuristics over the recorded call list — no LLM, no
 * network, and no hidden state. The goal is evidence, not a score.
 */
import type { ErgonomicsMetrics, McpCall } from "./types.js";
import { canonicalToolName, isReadTool, isWriteTool } from "./tools.js";

/** A large single-tool payload is a candidate source of context noise. */
const LARGE_OUTPUT_CHARS = 20_000;

function rawName(call: McpCall): string {
  return call.rawTool.length > 0 ? call.rawTool : call.tool;
}

function canonicalName(call: McpCall): string {
  return canonicalToolName(rawName(call));
}

/** Stable, key-sorted serialization so equivalent inputs normalize equally. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? "null" : encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function normalizeInput(input?: Record<string, unknown>): string {
  return stableStringify(input ?? {});
}

/** Extract `find_*` identifiers from a serialized context projection. */
function extractFindingIds(output?: string): Set<string> {
  const ids = new Set<string>();
  if (output === undefined) return ids;
  const matches = output.match(/find[_-][A-Za-z0-9]+/gi);
  if (matches === null) return ids;
  for (const match of matches) ids.add(match.toLowerCase());
  return ids;
}

export function analyzeErgonomics(calls: McpCall[]): ErgonomicsMetrics {
  const sequence = calls.map((call) => canonicalName(call));

  const readFlags = calls.map((call) => isReadTool(rawName(call)));
  const writeFlags = calls.map((call) => isWriteTool(rawName(call)));

  const readCalls = readFlags.filter(Boolean).length;
  const writeCalls = writeFlags.filter(Boolean).length;

  // Orientation = reads performed before the agent commits its first write.
  // If it never writes, every read is orientation.
  let orientationToolCalls = 0;
  let sawWrite = false;
  for (let i = 0; i < calls.length; i += 1) {
    if (writeFlags[i] === true) {
      sawWrite = true;
      continue;
    }
    if (!sawWrite && readFlags[i] === true) orientationToolCalls += 1;
  }

  // Redundant read = a read with the same canonical tool and normalized input
  // as an earlier read in the trace.
  const seenReads = new Map<string, number>();
  const redundantTools = new Set<string>();
  let redundantReads = 0;
  for (let i = 0; i < calls.length; i += 1) {
    if (readFlags[i] !== true) continue;
    const call = calls[i];
    if (call === undefined) continue;
    const key = `${canonicalName(call)}::${normalizeInput(call.input)}`;
    const count = seenReads.get(key) ?? 0;
    if (count > 0) {
      redundantReads += 1;
      redundantTools.add(canonicalName(call));
    }
    seenReads.set(key, count + 1);
  }

  // Missing-context signals: cheap, evidence-backed hints that the agent could
  // not find what it needed on the first reasonable projection.
  const missingContextSignals: string[] = [];
  const activityAt = sequence.indexOf("campfire.get_activity");
  const contextAt = sequence.indexOf("campfire.get_workspace_context");
  if (activityAt !== -1 && contextAt !== -1 && activityAt < contextAt) {
    missingContextSignals.push(
      "Agent called campfire.get_activity before campfire.get_workspace_context, then fetched the full context (went looking for more).",
    );
  }
  if (sequence.includes("campfire.get_workspace") && sequence.includes("campfire.get_workspace_context")) {
    missingContextSignals.push(
      "Agent fetched two full workspace projections: campfire.get_workspace and campfire.get_workspace_context.",
    );
  }

  // Context-noise signals: oversized payloads and duplicated projections.
  const contextNoiseSignals: string[] = [];
  for (let i = 0; i < calls.length; i += 1) {
    const call = calls[i];
    if (call === undefined) continue;
    const length = call.output?.length ?? 0;
    if (length > LARGE_OUTPUT_CHARS) {
      contextNoiseSignals.push(
        `campfire tool ${canonicalName(call)} returned ${length} characters (> ${LARGE_OUTPUT_CHARS}).`,
      );
    }
  }

  const workspaceCall = calls.find((call) => canonicalName(call) === "campfire.get_workspace");
  const contextCall = calls.find((call) => canonicalName(call) === "campfire.get_workspace_context");
  if (workspaceCall !== undefined && contextCall !== undefined) {
    const workspaceIds = extractFindingIds(workspaceCall.output);
    const contextIds = extractFindingIds(contextCall.output);
    const shared = [...workspaceIds].filter((id) => contextIds.has(id));
    if (shared.length > 0) {
      contextNoiseSignals.push(
        `campfire.get_workspace and campfire.get_workspace_context returned ${shared.length} overlapping finding id(s).`,
      );
    }
  }

  return {
    ...(sequence[0] !== undefined ? { firstCampfireCall: sequence[0] } : {}),
    sequence,
    totalCampfireCalls: calls.length,
    readCalls,
    writeCalls,
    orientationToolCalls,
    redundantReads,
    redundantReadTools: [...redundantTools].sort(),
    missingContextSignals,
    contextNoiseSignals,
  };
}
