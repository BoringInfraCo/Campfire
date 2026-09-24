/**
 * Sprint 002 real-harness acceptance types.
 *
 * These types describe raw harness runs and the evaluation inputs/outputs. They
 * are deliberately separate from the Sprint 001 deterministic acceptance types
 * so a real-agent run can be captured, parsed, and judged without weakening the
 * Sprint 001 regression suite.
 */
import type { WorkspaceView } from "../../service/service.js";

export type HarnessKind = "codex" | "opencode" | "claude-code";

/** A single Campfire MCP tool call observed in a harness event stream. */
export interface McpCall {
  /** Raw tool name as reported by the harness (may be sanitized/prefixed). */
  rawTool: string;
  /** Canonical `campfire.<tool>` name. */
  tool: string;
  input?: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  timestamp?: string;
}

/** A non-Campfire tool call (e.g. Read/Grep/Bash) observed in the stream. */
export interface HarnessToolCall {
  rawTool: string;
  tool: string;
  input?: Record<string, unknown>;
  timestamp?: string;
}

export interface HarnessEvent {
  type: string;
  raw: unknown;
}

export interface HarnessUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

/** Normalized result of one non-interactive harness process. */
export interface HarnessRunResult {
  harness: HarnessKind;
  actorId: string;
  agentSessionId?: string;
  command: string[];
  cwd: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  rawStdoutPath: string;
  rawStderrPath: string;
  /** Final assistant message, if the harness reports one. */
  finalMessage: string;
  events: HarnessEvent[];
  mcpCalls: McpCall[];
  nonMcpToolCalls: HarnessToolCall[];
  /** Harness-native session/thread id, for evidence only. */
  harnessSessionId?: string;
  usage?: HarnessUsage;
  error?: string;
}

export interface ErgonomicsMetrics {
  firstCampfireCall?: string;
  sequence: string[];
  totalCampfireCalls: number;
  readCalls: number;
  writeCalls: number;
  orientationToolCalls: number;
  redundantReads: number;
  /** Times the agent re-fetched something it had already retrieved. */
  redundantReadTools: string[];
  missingContextSignals: string[];
  contextNoiseSignals: string[];
}

export interface RealAcceptanceCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

/** Point-in-time Campfire workspace state captured around the handoff. */
export interface CampfireSnapshot {
  workspaceId: string;
  capturedAt: string;
  view: WorkspaceView;
}

export interface HumanIntervention {
  afterInitialInstruction: true;
  classification: "operational" | "clarification" | "context_leakage" | "manual_handoff";
  description: string;
}

export interface RealAcceptanceEvidence {
  sprint: "002";
  scenario: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  environment: {
    node: string;
    platform: string;
    arch: string;
    harnessA: { kind: string; version: string; model?: string; actorId: string; sessionId?: string };
    harnessB: { kind: string; version: string; model?: string; actorId: string; sessionId?: string };
  };
  prompts: { agentA: string; agentB: string };
  stateBeforeB: CampfireSnapshot;
  stateAfterB: CampfireSnapshot;
  harnessA: HarnessRunResult;
  harnessB: HarnessRunResult;
  ergonomics: ErgonomicsMetrics;
  transcriptIsolation: {
    sentinel: string;
    presentInHarnessBRetrieval: boolean;
    presentInCampfire: boolean;
    checkedSources: string[];
  };
  workspaceIsolation: {
    unrelatedWorkspaceId: string;
    unrelatedSentinel: string;
    visibleWorkspaceIds: string[];
    unrelatedReadDenied: boolean;
    unrelatedSentinelAbsent: boolean;
  };
  humanInterventions: HumanIntervention[];
  checks: RealAcceptanceCheck[];
  limitations: string[];
  recommendation: "GO" | "CONDITIONAL GO" | "NO-GO / REFRAME";
}
