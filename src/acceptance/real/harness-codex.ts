/**
 * Real Codex harness driver (Agent A).
 *
 * Runs `codex exec --json` non-interactively with Campfire configured as an MCP
 * server through `-c` overrides, so the user's global Codex config is never
 * modified. Identity and session are injected through the MCP server
 * environment, not through model-controlled tool arguments (SPRINT_002 section
 * 16).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runProcess } from "./harness-common.js";
import { parseCodexEvents } from "./codex-events.js";
import type { HarnessRunResult } from "./types.js";

export interface CodexHarnessConfig {
  actorId: string;
  agentSessionId: string;
  databasePath: string;
  campfireRepo: string;
  workdir: string;
  prompt: string;
  rawStdoutPath: string;
  rawStderrPath: string;
  lastMessagePath: string;
  model?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  timeoutMs?: number;
}

export function runCodexHarness(config: CodexHarnessConfig): HarnessRunResult {
  const tsx = resolve(config.campfireRepo, "node_modules/.bin/tsx");
  const stdioEntry = resolve(config.campfireRepo, "src/mcp/stdio.ts");
  const envTable =
    `{CAMPFIRE_DB="${config.databasePath}",` +
    `CAMPFIRE_ACTOR_ID="${config.actorId}",` +
    `CAMPFIRE_ACTOR_TYPE="agent",` +
    `CAMPFIRE_HARNESS="codex",` +
    `CAMPFIRE_SESSION_ID="${config.agentSessionId}"}`;

  const args: string[] = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--ephemeral",
    "-s",
    config.sandbox ?? "read-only",
    "-c",
    'approval_policy="never"',
    "-c",
    'mcp_servers.campfire.default_tools_approval_mode="approve"',
    "-c",
    `mcp_servers.campfire.command="${tsx}"`,
    "-c",
    `mcp_servers.campfire.args=["${stdioEntry}"]`,
    "-c",
    `mcp_servers.campfire.env=${envTable}`,
    "-C",
    config.workdir,
    "-o",
    config.lastMessagePath,
  ];
  if (config.model !== undefined && config.model !== "") {
    args.push("-m", config.model);
  }
  args.push(config.prompt);

  const process_ = runProcess("codex", args, {
    cwd: config.workdir,
    env: process.env,
    timeoutMs: config.timeoutMs ?? 15 * 60_000,
    stdoutPath: config.rawStdoutPath,
    stderrPath: config.rawStderrPath,
  });

  const raw = existsSync(config.rawStdoutPath) ? readFileSync(config.rawStdoutPath, "utf8") : "";
  const parsed = parseCodexEvents(raw);
  const fileMessage = existsSync(config.lastMessagePath)
    ? readFileSync(config.lastMessagePath, "utf8").trim()
    : "";
  const finalMessage = fileMessage !== "" ? fileMessage : parsed.finalMessage;

  return {
    harness: "codex",
    actorId: config.actorId,
    agentSessionId: config.agentSessionId,
    command: ["codex", ...args],
    cwd: config.workdir,
    startedAt: process_.startedAt,
    finishedAt: process_.finishedAt,
    exitCode: process_.exitCode,
    rawStdoutPath: config.rawStdoutPath,
    rawStderrPath: config.rawStderrPath,
    finalMessage,
    events: parsed.events,
    mcpCalls: parsed.mcpCalls,
    nonMcpToolCalls: parsed.nonMcpToolCalls,
    harnessSessionId: parsed.harnessSessionId,
    usage: parsed.usage,
    error: process_.error ?? parsed.error,
  };
}
