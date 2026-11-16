/**
 * Harness connection preparation.
 *
 * Codex and OpenCode syntax stays in this adapter. The domain, service,
 * authorization, and store never see a config file. The written file holds
 * the agent token; this function's return value does not.
 */
import { chmodSync, closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { applyEdits, getNodeValue, modify, parseTree, type Node, type ParseError } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import { ValidationError } from "../domain/errors.js";
import { canonicalEndpoint } from "./endpoint.js";

const BEGIN = "# BEGIN campfire-connect";
const END = "# END campfire-connect";

export type OpenCodeMajor = 1 | 2;

/** OpenCode 1 reports one merged configuration; never log its contents. */
export function assertOpenCodeV1Effective(config: { serverName: string; profileDir: string; mcpCommand: string }, env: NodeJS.ProcessEnv = process.env, requireLoaded = false,
  run: (command: string, args: string[], options: { encoding: "utf8"; timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv }) => { status: number | null; stdout?: string; error?: Error } = spawnSync): void {
  const failed = (): never => { throw new ValidationError("Could not verify the effective OpenCode connection; resolve the configuration conflict and retry.", { field: "config", nextAction: "inspect_opencode_config" }); };
  const result = run("opencode", ["debug", "config"], { encoding: "utf8", timeout: 15_000, maxBuffer: 8 * 1024 * 1024, env });
  if (result.error || result.status !== 0) return failed();
  let parsed: unknown;
  try { parsed = JSON.parse(result.stdout ?? ""); } catch { return failed(); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return failed();
  const mcp = (parsed as Record<string, unknown>).mcp;
  if (mcp === undefined) { if (requireLoaded) return failed(); return; }
  if (!mcp || typeof mcp !== "object" || Array.isArray(mcp)) return failed();
  const entry = (mcp as Record<string, unknown>)[config.serverName];
  if (entry === undefined) { if (requireLoaded) return failed(); return; }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return failed();
  const server = entry as Record<string, unknown>;
  const environment = server.environment;
  if (server.type !== "local" || server.enabled !== true || !Array.isArray(server.command) || server.command.length !== 2 || server.command[0] !== config.mcpCommand || server.command[1] !== "mcp" ||
      !environment || typeof environment !== "object" || Array.isArray(environment)) return failed();
  const vars = environment as Record<string, unknown>;
  if (Object.keys(vars).length !== 2 || vars.CAMPFIRE_HARNESS !== "opencode" || vars.CAMPFIRE_MCP_PROFILE_DIR !== config.profileDir) return failed();
}

/** Check the effective OpenCode 2 sources without exposing their contents. */
export function assertOpenCodeUnshadowed(configPath: string, serverName: string, env: NodeJS.ProcessEnv = process.env, requireLoaded = false,
  run: (command: string, args: string[], options: { encoding: "utf8"; timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv }) => { status: number | null; stdout?: string; error?: Error } = spawnSync): void {
  const failed = (): never => { throw new ValidationError("Could not verify OpenCode configuration precedence; resolve the conflict or retry from the intended project.", { field: "config", nextAction: "inspect_opencode_config" }); };
  const result = run("opencode", ["debug", "config", "--standalone"], { encoding: "utf8", timeout: 15_000, maxBuffer: 8 * 1024 * 1024, env });
  if (result.error || result.status !== 0) return failed();
  let sources: unknown;
  try { sources = JSON.parse(result.stdout ?? ""); } catch { return failed(); }
  if (!Array.isArray(sources)) return failed();
  let loaded = false;
  for (const source of sources) {
    if (!source || typeof source !== "object" || Array.isArray(source)) return failed();
    if (source.type === "directory") continue;
    if (source.type !== "document" || typeof source.path !== "string" || !source.info || typeof source.info !== "object" || Array.isArray(source.info)) return failed();
    const mcp = source.info.mcp;
    if (mcp === undefined) continue;
    if (!mcp || typeof mcp !== "object" || Array.isArray(mcp)) return failed();
    const servers = mcp.servers;
    if (servers === undefined) continue;
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) return failed();
    if (Object.hasOwn(servers, serverName)) {
      if (resolve(source.path) !== resolve(configPath)) return failed();
      loaded = true;
    }
  }
  if (requireLoaded && !loaded) return failed();
}

/** Select the installed format before enrollment; never print process output or environment. */
export function detectOpenCodeMajor(
  env: NodeJS.ProcessEnv = process.env,
  run: (command: string, args: string[], options: { encoding: "utf8"; timeout: number; env: NodeJS.ProcessEnv }) => { status: number | null; stdout?: string; error?: Error } = spawnSync,
): OpenCodeMajor {
  const result = run("opencode", ["--version"], { encoding: "utf8", timeout: 5_000, env });
  const match = /^\s*(?:opencode\s+)?v?(\d+)\.\d+\.\d+(?:[-+][^\s]+)?\s*$/i.exec(result.stdout ?? "");
  const major = Number(match?.[1]);
  if (result.error || result.status !== 0 || (major !== 1 && major !== 2)) {
    throw new ValidationError("Could not identify a supported OpenCode installation. Install OpenCode 1 or 2 and retry before accepting the invitation.", { field: "harness", nextAction: "select_supported_harness" });
  }
  return major;
}

export interface ConnectionPlan {
  harness: "codex" | "opencode" | "claude-code";
  /** The harness MCP server identifier, never a credential. */
  serverName: string;
  configPath: string;
  reloadRequired: true;
  approvalMayBeRequired: true;
  /** Present when a workspace already exists. Connection does not require one. */
  workspaceId?: string;
  mcp: {
    command: string;
    args: ["mcp"];
    env: string[];
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
  /** Independent MCP server name; omitted preserves the legacy `campfire` entry. */
  serverName?: string;
  /** OpenCode 1 uses mcp.<name>; OpenCode 2 uses mcp.servers.<name>. */
  opencodeMajor?: OpenCodeMajor;
  /** Remote enrollment must never silently replace another Campfire principal. */
  rejectConflicting?: boolean;
  /** Environment used to discover the effective OpenCode configuration. */
  env?: NodeJS.ProcessEnv;
  /** Remote OpenCode reads its agent credential from this exact private profile. */
  credentialProfileDir?: string;
}

function connectionConflict(): never {
  throw new ValidationError("Campfire harness configuration conflict; choose an isolated harness config", {
    field: "config", nextAction: "use_isolated_harness_config",
  });
}

function connectionName(value?: string): string {
  const name = value ?? "campfire";
  if (!/^campfire(?:_[A-Za-z0-9_-]{1,120})?$/.test(name)) {
    throw new ValidationError("Invalid Campfire MCP server name", { field: "serverName" });
  }
  return name;
}

function markers(name: string): { begin: string; end: string } {
  return name === "campfire" ? { begin: BEGIN, end: END } : {
    begin: `${BEGIN}:${name}`,
    end: `${END}:${name}`,
  };
}

/** Find exact marker lines: the legacy marker must not match a named block. */
function markerPositions(text: string, marker: string): number[] {
  const positions: number[] = [];
  let offset = 0;
  for (const line of text.split(/(?<=\n)/)) {
    if (line.replace(/\r?\n$/, "") === marker) positions.push(offset);
    offset += line.length;
  }
  return positions;
}

function openCodeObject(text: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const tree = parseTree(text.trim() ? text : "{}", errors, { allowTrailingComma: true, disallowComments: false });
  const noDuplicates = (node: Node): boolean => {
    if (node.type === "object") {
      const keys = new Set<string>();
      for (const property of node.children ?? []) {
        const key = property.children?.[0]?.value;
        if (typeof key !== "string" || keys.has(key)) return false;
        keys.add(key);
      }
    }
    return (node.children ?? []).every(noDuplicates);
  };
  if (errors.length || tree?.type !== "object" || !noDuplicates(tree)) {
    throw new ValidationError("OpenCode config is not strict JSON or valid unambiguous JSONC; refusing to guess", { field: "config" });
  }
  return getNodeValue(tree) as Record<string, unknown>;
}

function openCodeEntries(parsed: Record<string, unknown>, major: OpenCodeMajor): { mcp: Record<string, unknown>; v2: Record<string, unknown> } {
  const raw = parsed.mcp;
  if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw))) connectionConflict();
  const mcp = (raw ?? {}) as Record<string, unknown>;
  const nested = mcp.servers;
  if (nested !== undefined && (nested === null || typeof nested !== "object" || Array.isArray(nested))) connectionConflict();
  const v2 = (nested ?? {}) as Record<string, unknown>;
  // `servers` may be a server named "servers" in v1. Do not overwrite it.
  if ("type" in v2 || "command" in v2 || "url" in v2) {
    if (major === 2) connectionConflict();
    return { mcp, v2: {} };
  }
  return { mcp, v2 };
}

function codexDocument(text: string): Record<string, unknown> {
  try { return parseToml(text) as Record<string, unknown>; }
  catch { return connectionConflict(); }
}

function codexInlineRoot(text: string): boolean {
  // Inline tables cannot be extended with a later [mcp_servers.name] table.
  // Conservatively refuse this form rather than rewrite unrelated user data.
  return /^\s*(?:mcp_servers|"mcp_servers"|'mcp_servers')\s*=/m.test(text);
}

/** Read-only check usable before enrollment. A precise reconnect is permitted. */
export function assertConnectionCompatible(input: {
  harness: string; configPath: string; url?: string; agentToken?: string; serverName?: string; opencodeMajor?: OpenCodeMajor; credentialProfileDir?: string;
}): void {
  const harness = assertSupported(input.harness);
  const name = connectionName(input.serverName);
  if (!existsSync(input.configPath)) return;
  let text: string;
  try { text = readFileSync(input.configPath, "utf8"); } catch { return connectionConflict(); }
  let url: unknown;
  let token: unknown;
  if (harness === "codex") {
    const parsed = codexDocument(text);
    const root = parsed.mcp_servers;
    if (codexInlineRoot(text) || root !== undefined && (root === null || typeof root !== "object" || Array.isArray(root))) connectionConflict();
    const existing = (root as Record<string, unknown> | undefined)?.[name];
    const key = `(?:${name}|"${name}"|'${name}')`;
    const campfireTable = new RegExp(`^\\s*\\[\\s*(?:mcp_servers|"mcp_servers"|'mcp_servers')\\s*\\.\\s*${key}(?:\\s*\\.\\s*(?:env|"env"|'env'))?\\s*\\]`, "m");
    const inlineCampfire = new RegExp(`^\\s*(?:mcp_servers|"mcp_servers"|'mcp_servers')\\s*\\.\\s*${key}\\s*=`, "m");
    const { begin, end } = markers(name);
    const starts = markerPositions(text, begin);
    const ends = markerPositions(text, end);
    // An unmanaged table cannot be appended to: that produces ambiguous TOML.
    if (existing === undefined && !campfireTable.test(text) && !inlineCampfire.test(text) && starts.length === 0 && ends.length === 0) return;
    if (starts.length !== 1 || ends.length !== 1 || ends[0]! <= starts[0]!) connectionConflict();
    const start = starts[0]!;
    const endIndex = ends[0]!;
    const outside = text.slice(0, start) + text.slice(endIndex + end.length);
    if (campfireTable.test(outside) || inlineCampfire.test(outside)) connectionConflict();
    const block = text.slice(start, endIndex);
    try {
      const urls = [...block.matchAll(/^CAMPFIRE_URL\s*=\s*(.+)$/gm)];
      const tokens = [...block.matchAll(/^CAMPFIRE_TOKEN\s*=\s*(.+)$/gm)];
      if (urls.length !== 1 || tokens.length !== 1) connectionConflict();
      url = JSON.parse(urls[0]![1]!);
      token = JSON.parse(tokens[0]![1]!);
    } catch { connectionConflict(); }
  } else if (harness === "opencode") {
    let parsed: Record<string, unknown>;
    try { parsed = openCodeObject(text); } catch { return connectionConflict(); }
    const { mcp, v2 } = openCodeEntries(parsed, input.opencodeMajor ?? 1);
    // Never shadow a same-named server in the other format.
    const legacy = mcp[name];
    const modern = v2[name];
    if (legacy !== undefined && modern !== undefined) connectionConflict();
    if (input.opencodeMajor === 2 && legacy !== undefined || input.opencodeMajor !== 2 && modern !== undefined) connectionConflict();
    const campfire = input.opencodeMajor === 2 ? modern : legacy;
    if (campfire === undefined) return;
    if (campfire === null || typeof campfire !== "object" || Array.isArray(campfire)) connectionConflict();
    const configured = campfire as Record<string, unknown>;
    if (configured.type !== "local" || (input.opencodeMajor === 2 ? configured.disabled === true : configured.enabled !== true) || !Array.isArray(configured.command) ||
        configured.command.length !== 2 || configured.command[1] !== "mcp") connectionConflict();
    const environment = (campfire as Record<string, unknown>).environment;
    if (environment === null || typeof environment !== "object" || Array.isArray(environment)) connectionConflict();
    url = (environment as Record<string, unknown>).CAMPFIRE_URL;
    token = (environment as Record<string, unknown>).CAMPFIRE_TOKEN;
    if ((environment as Record<string, unknown>).CAMPFIRE_HARNESS !== "opencode") connectionConflict();
    if (input.credentialProfileDir !== undefined && (environment as Record<string, unknown>).CAMPFIRE_MCP_PROFILE_DIR === input.credentialProfileDir && token === undefined && url === undefined) return;
  } else {
    let parsed: unknown;
    try { parsed = text.trim() ? JSON.parse(text) : {}; } catch { return connectionConflict(); }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) connectionConflict();
    const servers = (parsed as Record<string, unknown>).mcpServers;
    if (servers === undefined) return;
    if (servers === null || typeof servers !== "object" || Array.isArray(servers)) connectionConflict();
    const campfire = (servers as Record<string, unknown>)[name];
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
  const name = connectionName(input.serverName);
  const { begin, end } = markers(name);
  return [
    begin,
    `[mcp_servers.${name}]`,
    `command = ${JSON.stringify(input.mcpCommand)}`,
    'args = ["mcp"]',
    "",
    `[mcp_servers.${name}.env]`,
    `CAMPFIRE_URL = ${JSON.stringify(input.url)}`,
    `CAMPFIRE_TOKEN = ${JSON.stringify(input.agentToken)}`,
    'CAMPFIRE_HARNESS = "codex"',
    end,
    "",
  ].join("\n");
}

function writeSecretFile(path: string, contents: string, expected: string | undefined): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const temporary = join(dir, `.campfire-${randomUUID()}.tmp`);
  try {
    const fd = openSync(temporary, "wx", 0o600);
    try { writeFileSync(fd, contents); fsyncSync(fd); } finally { closeSync(fd); }
    if (expected === undefined) {
      // Exclusive link never overwrites a file another process just created.
      try { linkSync(temporary, path); } catch { return connectionConflict(); }
    } else {
      let stat;
      try { stat = lstatSync(path); } catch { return connectionConflict(); }
      if (stat.isSymbolicLink() || !stat.isFile() || readFileSync(path, "utf8") !== expected) return connectionConflict();
      // This detects ordinary intervening writes; POSIX rename is not a
      // cross-process compare-and-swap against a hostile same-user writer.
      renameSync(temporary, path);
    }
    chmodSync(path, 0o600);
    const parent = openSync(dir, "r");
    try { fsyncSync(parent); } finally { closeSync(parent); }
  } finally { rmSync(temporary, { force: true }); }
}

function prepareCodex(input: PrepareConnectionInput): void {
  let existing = "";
  let existed = false;
  try {
    existing = readFileSync(input.configPath, "utf8");
    existed = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  codexDocument(existing);
  if (codexInlineRoot(existing)) connectionConflict();
  const block = codexBlock(input);
  const { begin, end } = markers(connectionName(input.serverName));
  const starts = markerPositions(existing, begin);
  const ends = markerPositions(existing, end);
  if (starts.length === 0 && ends.length === 0) {
    const prefix = existing.length === 0 || existing.endsWith("\n") ? existing : `${existing}\n`;
    const updated = `${prefix}${block}`;
    codexDocument(updated);
    writeSecretFile(input.configPath, updated, existed ? existing : undefined);
    return;
  }
  if (starts.length !== 1 || ends.length !== 1 || ends[0]! <= starts[0]!) {
    throw new ValidationError("Codex config has an ambiguous campfire-connect block; refusing to guess", {
      field: "config",
    });
  }
  const after = existing.slice(ends[0]! + end.length).replace(/^\r?\n/, "");
  const updated = `${existing.slice(0, starts[0]!)}${block}${after}`;
  codexDocument(updated);
  writeSecretFile(input.configPath, updated, existed ? existing : undefined);
}

function prepareOpenCode(input: PrepareConnectionInput): void {
  let text = "{}\n";
  let original: string | undefined;
  try {
    text = readFileSync(input.configPath, "utf8");
    original = text;
    if (!text.trim()) text = "{}\n";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ValidationError("OpenCode config cannot be read; refusing to guess", { field: "config" });
  }
  const parsed = openCodeObject(text);
  const major = input.opencodeMajor ?? 1;
  const { mcp, v2 } = openCodeEntries(parsed, major);
  const name = connectionName(input.serverName);
  const existing = major === 2 ? v2[name] : mcp[name];
  const base = major === 2 ? ["mcp", "servers", name] : ["mcp", name];
  const options = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } };
  // Update fields individually so comments and unrelated options remain intact.
  if (existing === null || typeof existing !== "object" || Array.isArray(existing)) {
    text = applyEdits(text, modify(text, base, {}, options));
  }
  const fields: Array<[string[], unknown]> = [
    [[...base, "type"], "local"],
    [[...base, "command"], [input.mcpCommand, "mcp"]],
    [[...base, major === 2 ? "disabled" : "enabled"], major !== 2],
    [[...base, "environment", "CAMPFIRE_HARNESS"], "opencode"],
  ];
  if (input.credentialProfileDir !== undefined) {
    fields.push([[...base, "environment", "CAMPFIRE_MCP_PROFILE_DIR"], input.credentialProfileDir]);
    const priorEnv = (existing && typeof existing === "object" && !Array.isArray(existing) ? (existing as Record<string, unknown>).environment : undefined);
    if (priorEnv && typeof priorEnv === "object" && !Array.isArray(priorEnv)) {
      if (Object.hasOwn(priorEnv, "CAMPFIRE_URL")) text = applyEdits(text, modify(text, [...base, "environment", "CAMPFIRE_URL"], undefined, options));
      if (Object.hasOwn(priorEnv, "CAMPFIRE_TOKEN")) text = applyEdits(text, modify(text, [...base, "environment", "CAMPFIRE_TOKEN"], undefined, options));
    }
  } else {
    fields.push([[...base, "environment", "CAMPFIRE_URL"], input.url], [[...base, "environment", "CAMPFIRE_TOKEN"], input.agentToken]);
  }
  // OpenCode 2 defaults to Code Mode; Campfire's tested MCP interface is the
  // direct tool surface and must not depend on a harness-specific runtime.
  if (major === 2) fields.push([[...base, "codemode"], false]);
  for (const [path, value] of fields) text = applyEdits(text, modify(text, path, value, options));
  writeSecretFile(input.configPath, text.endsWith("\n") ? text : `${text}\n`, original);
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
  const name = connectionName(input.serverName);
  const existing = servers === undefined ? undefined : (servers as Record<string, unknown>)[name];
  if (existing !== undefined && !isClaudeCampfireServer(existing)) {
    throw new ValidationError(
      "Claude Code already has a campfire MCP server that is not the Campfire adapter; refusing to replace it",
      { field: "config", nextAction: "use_isolated_harness_config" },
    );
  }
  const next = { ...(servers as Record<string, unknown> | undefined) };
  next[name] = claudeCampfireEntry(input);
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
  _opencodeMajor?: OpenCodeMajor,
  globalOnly = false,
): string {
  const home = (env.HOME ?? homedir()).trim() || homedir();
  if (harness === "codex") return join(home, ".codex", "config.toml");
  if (!globalOnly) {
    // JSONC overrides JSON when both are present; never silently edit the
    // lower-priority file and claim the harness will load that connection.
    for (const path of [join(cwd, ".opencode", "opencode.jsonc"), join(cwd, ".opencode", "opencode.json"), join(cwd, "opencode.jsonc"), join(cwd, "opencode.json")]) {
      if (existsSync(path)) return path;
    }
  }
  const xdg = (env.XDG_CONFIG_HOME ?? "").trim() || join(home, ".config");
  const jsonc = join(xdg, "opencode", "opencode.jsonc");
  if (existsSync(jsonc)) return jsonc;
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
  const serverName = connectionName(input.serverName);
  rejectUnsafe(input.configPath, "config");
  rejectUnsafe(input.mcpCommand, "mcp-command");
  rejectUnsafe(input.url, "url");
  rejectUnsafe(input.agentToken, "token");
  if (input.credentialProfileDir !== undefined && (harness !== "opencode" || !isAbsolute(input.credentialProfileDir))) throw new ValidationError("Remote OpenCode connection requires an absolute profile directory", { field: "profile" });
  if (input.workspaceId !== undefined) rejectUnsafe(input.workspaceId, "workspace");
  if (harness === "claude-code" && !isAbsolute(input.mcpCommand)) {
    throw new ValidationError("Claude Code MCP command must be an absolute path.", { field: "mcp-command" });
  }
  // Named connections are always non-destructive, including direct callers.
  if (input.rejectConflicting || serverName !== "campfire") assertConnectionCompatible(input);
  if (harness === "opencode" && input.opencodeMajor === 1 && input.credentialProfileDir !== undefined) assertOpenCodeV1Effective({ serverName, profileDir: input.credentialProfileDir, mcpCommand: input.mcpCommand }, input.env);
  if (harness === "opencode" && input.opencodeMajor === 2 && input.rejectConflicting) assertOpenCodeUnshadowed(input.configPath, serverName, input.env);
  if (harness === "codex") prepareCodex(input);
  else if (harness === "opencode") prepareOpenCode(input);
  else prepareClaude(input);
  if (harness === "opencode" && input.opencodeMajor === 1 && input.credentialProfileDir !== undefined) assertOpenCodeV1Effective({ serverName, profileDir: input.credentialProfileDir, mcpCommand: input.mcpCommand }, input.env, true);
  if (harness === "opencode" && input.opencodeMajor === 2 && input.rejectConflicting) assertOpenCodeUnshadowed(input.configPath, serverName, input.env, true);
  return {
    harness,
    serverName,
    configPath: input.configPath,
    reloadRequired: true,
    approvalMayBeRequired: true,
    ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
    mcp: {
      command: input.mcpCommand,
      args: ["mcp"],
      env: input.credentialProfileDir === undefined ? ["CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_HARNESS"] : ["CAMPFIRE_MCP_PROFILE_DIR", "CAMPFIRE_HARNESS"],
    },
    nextAction: "reload_or_new_process",
  };
}
