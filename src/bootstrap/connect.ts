/**
 * Harness connection preparation.
 *
 * Codex and OpenCode syntax stays in this adapter. The domain, service,
 * authorization, and store never see a config file. The written file holds
 * the agent token; this function's return value does not.
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ValidationError } from "../domain/errors.js";

const BEGIN = "# BEGIN campfire-connect";
const END = "# END campfire-connect";

export interface ConnectionPlan {
  harness: "codex" | "opencode";
  configPath: string;
  reloadRequired: true;
  approvalMayBeRequired: true;
  workspaceId: string;
  mcp: {
    command: string;
    args: ["mcp"];
    env: ["CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_HARNESS"];
  };
  nextAction: "reload_or_new_process";
}

export interface PrepareConnectionInput {
  harness: string;
  configPath: string;
  mcpCommand: string;
  url: string;
  agentToken: string;
  workspaceId: string;
}

function rejectUnsafe(value: string, field: string): void {
  if (value.trim().length === 0 || /[\r\n"#]/.test(value)) {
    throw new ValidationError(`${field} is missing or unsafe to write`, { field });
  }
}

function assertSupported(harness: string): "codex" | "opencode" {
  if (harness === "codex" || harness === "opencode") return harness;
  throw new ValidationError(
    `Harness ${JSON.stringify(harness)} has no validated connection adapter. Use codex or opencode.`,
    { field: "harness" },
  );
}

function codexBlock(input: PrepareConnectionInput): string {
  return [
    BEGIN,
    "[mcp_servers.campfire]",
    `command = ${JSON.stringify(input.mcpCommand)}`,
    'args = ["mcp"]',
    "",
    "[mcp_servers.campfire.env]",
    `CAMPFIRE_URL = ${JSON.stringify(input.url)}`,
    `CAMPFIRE_TOKEN = ${JSON.stringify(input.agentToken)}`,
    'CAMPFIRE_HARNESS = "codex"',
    END,
    "",
  ].join("\n");
}

function writeSecretFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function prepareCodex(input: PrepareConnectionInput): void {
  let existing = "";
  try {
    existing = readFileSync(input.configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const block = codexBlock(input);
  if (!existing.includes(BEGIN)) {
    const prefix = existing.length === 0 || existing.endsWith("\n") ? existing : `${existing}\n`;
    writeSecretFile(input.configPath, `${prefix}${block}`);
    return;
  }
  const start = existing.indexOf(BEGIN);
  const end = existing.indexOf(END, start);
  if (end === -1 || existing.indexOf(BEGIN, start + BEGIN.length) !== -1) {
    throw new ValidationError("Codex config has an ambiguous campfire-connect block; refusing to guess", {
      field: "config",
    });
  }
  const after = existing.slice(end + END.length).replace(/^\n/, "");
  writeSecretFile(input.configPath, `${existing.slice(0, start)}${block}${after}`);
}

function prepareOpenCode(input: PrepareConnectionInput): void {
  let parsed: Record<string, unknown> = {};
  try {
    const text = readFileSync(input.configPath, "utf8");
    if (text.trim().length === 0) parsed = {};
    else {
      const value = JSON.parse(text) as unknown;
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new ValidationError("OpenCode config must be a JSON object; refusing to guess", { field: "config" });
      }
      parsed = value as Record<string, unknown>;
    }
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") parsed = {};
    else throw new ValidationError("OpenCode config is not strict JSON; refusing to guess", { field: "config" });
  }
  const mcp = parsed.mcp;
  if (mcp !== undefined && (mcp === null || typeof mcp !== "object" || Array.isArray(mcp))) {
    throw new ValidationError("OpenCode mcp setting is not an object; refusing to guess", { field: "config" });
  }
  const servers = { ...(mcp as Record<string, unknown> | undefined) };
  servers.campfire = {
    type: "local",
    command: [input.mcpCommand, "mcp"],
    enabled: true,
    environment: {
      CAMPFIRE_URL: input.url,
      CAMPFIRE_TOKEN: input.agentToken,
      CAMPFIRE_HARNESS: "opencode",
    },
  };
  parsed.mcp = servers;
  writeSecretFile(input.configPath, `${JSON.stringify(parsed, null, 2)}\n`);
}

export function prepareConnection(input: PrepareConnectionInput): ConnectionPlan {
  const harness = assertSupported(input.harness);
  rejectUnsafe(input.configPath, "config");
  rejectUnsafe(input.mcpCommand, "mcp-command");
  rejectUnsafe(input.url, "url");
  rejectUnsafe(input.agentToken, "token");
  rejectUnsafe(input.workspaceId, "workspace");
  if (harness === "codex") prepareCodex(input);
  else prepareOpenCode(input);
  return {
    harness,
    configPath: input.configPath,
    reloadRequired: true,
    approvalMayBeRequired: true,
    workspaceId: input.workspaceId,
    mcp: {
      command: input.mcpCommand,
      args: ["mcp"],
      env: ["CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_HARNESS"],
    },
    nextAction: "reload_or_new_process",
  };
}
