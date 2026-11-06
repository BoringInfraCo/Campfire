/**
 * Harness connection preparation.
 *
 * Codex and OpenCode syntax stays in this adapter. The domain, service,
 * authorization, and store never see a config file. The written file holds
 * the agent token; this function's return value does not.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { ValidationError } from "../domain/errors.js";
import { canonicalEndpoint } from "./endpoint.js";

const BEGIN = "# BEGIN campfire-connect";
const END = "# END campfire-connect";

export interface ConnectionPlan {
  harness: "codex" | "opencode" | "claude-code";
  configPath: string;
  reloadRequired: true;
  approvalMayBeRequired: true;
  /** Present when a workspace already exists. Connection does not require one. */
  workspaceId?: string;
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
  workspaceId?: string;
  /** Remote enrollment must never silently replace another Campfire principal. */
  rejectConflicting?: boolean;
}

function connectionConflict(): never {
  throw new ValidationError("Campfire harness configuration conflict; choose an isolated harness config", {
    field: "config", nextAction: "use_isolated_harness_config",
  });
}

/** Read-only check usable before enrollment. A precise reconnect is permitted. */
export function assertConnectionCompatible(input: {
  harness: string; configPath: string; url?: string; agentToken?: string;
}): void {
  const harness = assertSupported(input.harness);
  if (!existsSync(input.configPath)) return;
  let text: string;
  try { text = readFileSync(input.configPath, "utf8"); } catch { return connectionConflict(); }
  let url: unknown;
  let token: unknown;
  if (harness === "codex") {
    const campfireTable = /^\s*\[\s*(?:mcp_servers|"mcp_servers"|'mcp_servers')\s*\.\s*(?:campfire|"campfire"|'campfire')(?:\s*\.\s*(?:env|"env"|'env'))?\s*\]/m;
    const inlineCampfire = /^\s*(?:mcp_servers|"mcp_servers"|'mcp_servers')\s*\.\s*(?:campfire|"campfire"|'campfire')\s*=/m;
    // An unmanaged table cannot be appended to: that produces ambiguous TOML.
    if (!campfireTable.test(text) && !inlineCampfire.test(text) && !text.includes(BEGIN)) return;
    const start = text.indexOf(BEGIN);
    const end = text.indexOf(END, start);
    if (start === -1 || end === -1 || text.indexOf(BEGIN, start + BEGIN.length) !== -1 || text.indexOf(END, end + END.length) !== -1) connectionConflict();
    const outside = text.slice(0, start) + text.slice(end + END.length);
    if (campfireTable.test(outside) || inlineCampfire.test(outside)) connectionConflict();
    const block = text.slice(start, end);
    try {
      const urls = [...block.matchAll(/^CAMPFIRE_URL\s*=\s*(.+)$/gm)];
      const tokens = [...block.matchAll(/^CAMPFIRE_TOKEN\s*=\s*(.+)$/gm)];
      if (urls.length !== 1 || tokens.length !== 1) connectionConflict();
      url = JSON.parse(urls[0]![1]!);
      token = JSON.parse(tokens[0]![1]!);
    } catch { connectionConflict(); }
  } else if (harness === "opencode") {
    let parsed: unknown;
    try { parsed = text.trim() ? JSON.parse(text) : {}; } catch { return connectionConflict(); }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) connectionConflict();
    const mcp = (parsed as Record<string, unknown>).mcp;
    if (mcp === undefined) return;
    if (mcp === null || typeof mcp !== "object" || Array.isArray(mcp)) connectionConflict();
    const campfire = (mcp as Record<string, unknown>).campfire;
    if (campfire === undefined) return;
    if (campfire === null || typeof campfire !== "object" || Array.isArray(campfire)) connectionConflict();
    const configured = campfire as Record<string, unknown>;
    if (configured.type !== "local" || configured.enabled !== true || !Array.isArray(configured.command) ||
        configured.command.length !== 2 || configured.command[1] !== "mcp") connectionConflict();
    const environment = (campfire as Record<string, unknown>).environment;
    if (environment === null || typeof environment !== "object" || Array.isArray(environment)) connectionConflict();
    url = (environment as Record<string, unknown>).CAMPFIRE_URL;
    token = (environment as Record<string, unknown>).CAMPFIRE_TOKEN;
    if ((environment as Record<string, unknown>).CAMPFIRE_HARNESS !== "opencode") connectionConflict();
  } else {
    let parsed: unknown;
    try { parsed = text.trim() ? JSON.parse(text) : {}; } catch { return connectionConflict(); }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) connectionConflict();
    const servers = (parsed as Record<string, unknown>).mcpServers;
    if (servers === undefined) return;
    if (servers === null || typeof servers !== "object" || Array.isArray(servers)) connectionConflict();
    const campfire = (servers as Record<string, unknown>).campfire;
    if (campfire === undefined) return;
    if (!isClaudeCampfireServer(campfire)) connectionConflict();
    const entry = campfire as Record<string, unknown>;
    const environment = entry.env as Record<string, unknown>;
    url = environment.CAMPFIRE_URL;
    token = environment.CAMPFIRE_TOKEN;
  }
  if (typeof url !== "string" || typeof token !== "string" || input.url === undefined || input.agentToken === undefined) connectionConflict();
  try {
    if (canonicalEndpoint(url, { allowLoopbackHttp: true }) !== canonicalEndpoint(input.url, { allowLoopbackHttp: true }) || token !== input.agentToken) connectionConflict();
  } catch { connectionConflict(); }
}

function rejectUnsafe(value: string, field: string): void {
  if (value.trim().length === 0 || /[\r\n"#]/.test(value)) {
    throw new ValidationError(`${field} is missing or unsafe to write`, { field });
  }
}

function assertSupported(harness: string): "codex" | "opencode" | "claude-code" {
  if (harness === "codex" || harness === "opencode" || harness === "claude-code") return harness;
  throw new ValidationError(
    `Harness ${JSON.stringify(harness)} has no validated connection adapter. Use codex, claude-code, or opencode.`,
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

function isClaudeCampfireServer(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  const environment = entry.env;
  if (environment === null || typeof environment !== "object" || Array.isArray(environment)) return false;
  const args = entry.args;
  return entry.type === "stdio"
    && typeof entry.command === "string"
    && entry.command.length > 0
    && Array.isArray(args)
    && args.length === 1
    && args[0] === "mcp"
    && (environment as Record<string, unknown>).CAMPFIRE_HARNESS === "claude-code";
}

function claudeCampfireEntry(input: PrepareConnectionInput): Record<string, unknown> {
  return {
    type: "stdio",
    command: input.mcpCommand,
    args: ["mcp"],
    env: {
      CAMPFIRE_URL: input.url,
      CAMPFIRE_TOKEN: input.agentToken,
      CAMPFIRE_HARNESS: "claude-code",
    },
  };
}

function prepareClaude(input: PrepareConnectionInput): void {
  let parsed: Record<string, unknown> = {};
  try {
    const text = readFileSync(input.configPath, "utf8");
    if (text.trim().length === 0) parsed = {};
    else {
      const value = JSON.parse(text) as unknown;
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new ValidationError("Claude Code config must be a JSON object; refusing to guess", { field: "config" });
      }
      parsed = value as Record<string, unknown>;
    }
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") parsed = {};
    else throw new ValidationError("Claude Code config is not strict JSON; refusing to guess", { field: "config" });
  }
  const servers = parsed.mcpServers;
  if (servers !== undefined && (servers === null || typeof servers !== "object" || Array.isArray(servers))) {
    throw new ValidationError("Claude Code mcpServers is not an object; refusing to guess", { field: "config" });
  }
  const existing = servers === undefined ? undefined : (servers as Record<string, unknown>).campfire;
  if (existing !== undefined && !isClaudeCampfireServer(existing)) {
    throw new ValidationError(
      "Claude Code already has a campfire MCP server that is not the Campfire adapter; refusing to replace it",
      { field: "config", nextAction: "use_isolated_harness_config" },
    );
  }
  const next = { ...(servers as Record<string, unknown> | undefined) };
  next.campfire = claudeCampfireEntry(input);
  parsed.mcpServers = next;
  writeClaudeFile(input.configPath, `${JSON.stringify(parsed, null, 2)}\n`);
}

/** Replace the Claude config by rename so a short write cannot truncate oauthAccount. */
function writeClaudeFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.campfire-tmp`;
  writeFileSync(temporary, contents, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

export function defaultHarnessConfigPath(
  harness: "codex" | "opencode",
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const home = (env.HOME ?? homedir()).trim() || homedir();
  if (harness === "codex") return join(home, ".codex", "config.toml");
  const local = join(cwd, "opencode.json");
  if (existsSync(local)) return local;
  const xdg = (env.XDG_CONFIG_HOME ?? "").trim() || join(home, ".config");
  return join(xdg, "opencode", "opencode.json");
}

/** User-scope Claude Code config. Project `.mcp.json` is never the default. */
export function defaultClaudeConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = (env.HOME ?? homedir()).trim() || homedir();
  return join(home, ".claude.json");
}

export type SupportedHarness = "codex" | "opencode";

export function detectInstalledHarnesses(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): SupportedHarness[] {
  const home = (env.HOME ?? homedir()).trim() || homedir();
  const found: SupportedHarness[] = [];
  if (existsSync(join(home, ".codex"))) found.push("codex");
  const xdg = (env.XDG_CONFIG_HOME ?? "").trim() || join(home, ".config");
  if (existsSync(join(cwd, "opencode.json")) || existsSync(join(xdg, "opencode"))) {
    found.push("opencode");
  }
  return found;
}

export function detectInstalledHarness(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): SupportedHarness | undefined {
  return detectInstalledHarnesses(env, cwd)[0];
}

export function prepareConnection(input: PrepareConnectionInput): ConnectionPlan {
  const harness = assertSupported(input.harness);
  rejectUnsafe(input.configPath, "config");
  rejectUnsafe(input.mcpCommand, "mcp-command");
  rejectUnsafe(input.url, "url");
  rejectUnsafe(input.agentToken, "token");
  if (input.workspaceId !== undefined) rejectUnsafe(input.workspaceId, "workspace");
  if (harness === "claude-code" && !isAbsolute(input.mcpCommand)) {
    throw new ValidationError("Claude Code MCP command must be an absolute path.", { field: "mcp-command" });
  }
  if (input.rejectConflicting) assertConnectionCompatible(input);
  if (harness === "codex") prepareCodex(input);
  else if (harness === "opencode") prepareOpenCode(input);
  else prepareClaude(input);
  return {
    harness,
    configPath: input.configPath,
    reloadRequired: true,
    approvalMayBeRequired: true,
    ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
    mcp: {
      command: input.mcpCommand,
      args: ["mcp"],
      env: ["CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_HARNESS"],
    },
    nextAction: "reload_or_new_process",
  };
}
