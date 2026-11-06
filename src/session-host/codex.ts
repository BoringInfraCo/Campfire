/**
 * Codex CLI adapter pinned to codex-cli 0.164.0.
 *
 * The initial instruction names the workspace id and task id only. It is not
 * stored in the registry. The child environment is an allowlist:
 * PATH, HOME, USER, LOGNAME, TMPDIR, TMP, TEMP, LANG, LC_ALL, LC_CTYPE, TERM,
 * COLORTERM, SHELL, XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_CACHE_HOME,
 * XDG_RUNTIME_DIR, and CAMPFIRE_URL when it does not contain a credential.
 * CAMPFIRE_SESSION_ID is set to the Core session id. CAMPFIRE_TOKEN, bridge
 * tokens, and the agent credential are not passed. Existing Codex MCP config
 * is not read or written.
 */
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { accessSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { ValidationError } from "../domain/errors.js";
import { CODEX_CLI_VERSION, CODEX_ONLY_MESSAGE, type SpawnSyncResult, type SupportedHarness } from "./types.js";

const PASSTHROUGH = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "SHELL",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
] as const;

const SCRUBBED = ["CAMPFIRE_TOKEN", "CAMPFIRE_BRIDGE_TOKEN", "CAMPFIRE_HUMAN_TOKEN", "CAMPFIRE_OPERATOR_TOKEN"];

export function assertLaunchableHarness(harness: string): asserts harness is "codex" {
  if (harness === "claude-code" || harness === "opencode" || harness !== "codex") {
    throw new ValidationError(CODEX_ONLY_MESSAGE, { field: "harness", value: harness });
  }
}

export function isKnownHarness(harness: string): harness is SupportedHarness {
  return harness === "codex" || harness === "claude-code" || harness === "opencode";
}

export function codexInitialInstruction(workspaceId: string, taskId: string): string {
  return `Read Campfire task ${taskId} in workspace ${workspaceId}. Use your Campfire tools for the task and authorized workspace context before you act.`;
}

export function childEnvironment(parent: NodeJS.ProcessEnv, sessionId: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of PASSTHROUGH) {
    const value = parent[key];
    if (typeof value === "string" && value.length > 0) env[key] = value;
  }
  const url = parent.CAMPFIRE_URL;
  if (typeof url === "string" && url.length > 0 && !url.includes("cft_") && !/token=/i.test(url)) {
    env.CAMPFIRE_URL = url;
  }
  env.CAMPFIRE_SESSION_ID = sessionId;
  for (const key of SCRUBBED) delete env[key];
  return env;
}

export function discoverCodexExecutable(env: NodeJS.ProcessEnv, explicit?: string): string {
  if (explicit !== undefined) {
    if (!isAbsolute(explicit)) {
      throw new ValidationError("Codex executable must be an absolute path.", { field: "codex" });
    }
    assertExecutable(explicit);
    return explicit;
  }
  const fromEnv = env.CODEX_CLI?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    if (!isAbsolute(fromEnv)) {
      throw new ValidationError("CODEX_CLI must be an absolute path to codex-cli 0.164.0.", { field: "codex" });
    }
    assertExecutable(fromEnv);
    return fromEnv;
  }
  const pathValue = env.PATH ?? "";
  for (const directory of pathValue.split(delimiter)) {
    if (directory.length === 0) continue;
    const candidate = join(directory, "codex");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep scanning PATH. Do not shell out to `which`.
    }
  }
  throw new ValidationError(
    `Codex CLI ${CODEX_CLI_VERSION} was not found on PATH. Install codex-cli ${CODEX_CLI_VERSION} and retry.`,
    { field: "codex", nextAction: "install_codex_cli" },
  );
}

function assertExecutable(path: string): void {
  try {
    accessSync(path, constants.X_OK);
  } catch {
    throw new ValidationError(
      `Codex CLI ${CODEX_CLI_VERSION} was not found. Install codex-cli ${CODEX_CLI_VERSION} and retry.`,
      { field: "codex", nextAction: "install_codex_cli" },
    );
  }
}

export function parseCodexVersion(output: string): string | undefined {
  const match = /\b(\d+\.\d+\.\d+)\b/.exec(output);
  return match?.[1];
}

export function assertCodexVersion(version: string | undefined): void {
  if (version !== CODEX_CLI_VERSION) {
    throw new ValidationError(
      `Codex CLI ${CODEX_CLI_VERSION} is required for campfire session; found ${version ?? "unknown"}. Install codex-cli ${CODEX_CLI_VERSION} and retry.`,
      { field: "codex", nextAction: "install_codex_cli", found: version ?? "unknown" },
    );
  }
}

export function readCodexVersion(
  executable: string,
  spawnSyncImpl: (command: string, args: readonly string[], options: { shell: false; timeout?: number }) => SpawnSyncResult = defaultSpawnSync,
): string {
  const result = spawnSyncImpl(executable, ["--version"], { shell: false, timeout: 5_000 });
  if (result.error !== undefined || result.status !== 0) {
    throw new ValidationError(
      `Codex CLI ${CODEX_CLI_VERSION} could not be inspected. Install codex-cli ${CODEX_CLI_VERSION} and retry.`,
      { field: "codex", nextAction: "install_codex_cli" },
    );
  }
  const version = parseCodexVersion(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  assertCodexVersion(version);
  return CODEX_CLI_VERSION;
}

function defaultSpawnSync(command: string, args: readonly string[], options: { shell: false; timeout?: number }): SpawnSyncResult {
  const result = spawnSync(command, [...args], {
    shell: false,
    encoding: "utf8",
    timeout: options.timeout,
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}

export interface CodexLaunchPlan {
  executable: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell: false;
}

export function buildCodexLaunch(input: {
  executable: string;
  cwd: string;
  parentEnv: NodeJS.ProcessEnv;
  sessionId: string;
  workspaceId: string;
  taskId: string;
}): CodexLaunchPlan {
  return {
    executable: input.executable,
    args: [codexInitialInstruction(input.workspaceId, input.taskId)],
    cwd: input.cwd,
    env: childEnvironment(input.parentEnv, input.sessionId),
    shell: false,
  };
}
