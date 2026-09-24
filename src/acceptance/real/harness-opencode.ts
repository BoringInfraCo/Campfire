/**
 * Real OpenCode harness driver (Agent B).
 *
 * Writes a project-scoped `opencode.json` in the harness work directory (never
 * the user's global config) and runs `opencode run --format json --auto`. As
 * with Codex, actor/session identity is supplied through the MCP server
 * environment rather than model-controlled arguments.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runProcess } from "./harness-common.js";
import { parseOpencodeEvents } from "./opencode-events.js";
import type { HarnessRunResult } from "./types.js";

export interface OpencodeHarnessConfig {
  actorId: string;
  agentSessionId: string;
  databasePath: string;
  campfireRepo: string;
  workdir: string;
  prompt: string;
  rawStdoutPath: string;
  rawStderrPath: string;
  model?: string;
  timeoutMs?: number;
}

interface OpencodeMcpConfig {
  $schema: string;
  mcp: Record<
    string,
    {
      type: "local";
      command: string[];
      environment: Record<string, string>;
      enabled: boolean;
    }
  >;
}

export function writeOpencodeConfig(config: OpencodeHarnessConfig): string {
  const tsx = resolve(config.campfireRepo, "node_modules/.bin/tsx");
  const stdioEntry = resolve(config.campfireRepo, "src/mcp/stdio.ts");
  const mcpConfig: OpencodeMcpConfig = {
    $schema: "https://opencode.ai/config.json",
    mcp: {
      campfire: {
        type: "local",
        command: [tsx, stdioEntry],
        environment: {
          CAMPFIRE_DB: config.databasePath,
          CAMPFIRE_ACTOR_ID: config.actorId,
          CAMPFIRE_ACTOR_TYPE: "agent",
          CAMPFIRE_HARNESS: "opencode",
          CAMPFIRE_SESSION_ID: config.agentSessionId,
        },
        enabled: true,
      },
    },
  };
  const path = resolve(config.workdir, "opencode.json");
  writeFileSync(path, `${JSON.stringify(mcpConfig, null, 2)}\n`, "utf8");
  return path;
}

export function runOpencodeHarness(config: OpencodeHarnessConfig): HarnessRunResult {
  writeOpencodeConfig(config);

  const args: string[] = ["run", "--format", "json", "--auto", "--dir", config.workdir];
  if (config.model !== undefined && config.model !== "") {
    args.push("--model", config.model);
  }
  args.push(config.prompt);

  const process_ = runProcess("opencode", args, {
    cwd: config.workdir,
    env: process.env,
    timeoutMs: config.timeoutMs ?? 10 * 60_000,
    stdoutPath: config.rawStdoutPath,
    stderrPath: config.rawStderrPath,
  });

  const raw = existsSync(config.rawStdoutPath) ? readFileSync(config.rawStdoutPath, "utf8") : "";
  const parsed = parseOpencodeEvents(raw);

  return {
    harness: "opencode",
    actorId: config.actorId,
    agentSessionId: config.agentSessionId,
    command: ["opencode", ...args],
    cwd: config.workdir,
    startedAt: process_.startedAt,
    finishedAt: process_.finishedAt,
    exitCode: process_.exitCode,
    rawStdoutPath: config.rawStdoutPath,
    rawStderrPath: config.rawStderrPath,
    finalMessage: parsed.finalMessage,
    events: parsed.events,
    mcpCalls: parsed.mcpCalls,
    nonMcpToolCalls: parsed.nonMcpToolCalls,
    harnessSessionId: parsed.harnessSessionId,
    usage: parsed.usage,
    error: process_.error ?? parsed.error,
  };
}
