/**
 * Session-host launch selection for the three pinned harnesses.
 *
 * Codex stays on codex-cli 0.164.0. Claude Code is 2.1.260 and takes the
 * initial instruction as a positional prompt. OpenCode is 2.2.5 and takes
 * `--prompt` on the interactive root command, not `opencode run`.
 * The child is always shell:false. The environment allowlist lives in codex.ts.
 */
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { accessSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { ValidationError } from "../domain/errors.js";
import {
  assertCodexVersion,
  buildCodexLaunch,
  childEnvironment,
  codexInitialInstruction,
  discoverCodexExecutable,
  parseCodexVersion,
  readCodexVersion,
  type CodexLaunchPlan,
} from "./codex.js";
import {
  CLAUDE_CODE_VERSION,
  CODEX_CLI_VERSION,
  OPENCODE_CLI_VERSION,
  UNKNOWN_SESSION_HARNESS_MESSAGE,
  type SessionHostDeps,
  type SpawnSyncResult,
  type SupportedHarness,
} from "./types.js";

export function canonicalSessionHarness(harness: string): SupportedHarness {
  if (harness === "claude") return "claude-code";
  if (harness === "codex" || harness === "claude-code" || harness === "opencode") return harness;
  throw new ValidationError(UNKNOWN_SESSION_HARNESS_MESSAGE, { field: "harness", value: harness });
}

export function assertLaunchableHarness(harness: string): asserts harness is SupportedHarness {
  if (harness === "codex" || harness === "claude-code" || harness === "opencode") return;
  throw new ValidationError(UNKNOWN_SESSION_HARNESS_MESSAGE, { field: "harness", value: harness });
}

export function explicitHarnessExecutable(deps: SessionHostDeps, harness: SupportedHarness): string | undefined {
  if (harness === "codex") return deps.codexExecutable;
  if (harness === "claude-code") return deps.claudeExecutable;
  return deps.opencodeExecutable;
}

export function discoverHarnessExecutable(
  env: NodeJS.ProcessEnv,
  harness: SupportedHarness,
  explicit?: string,
): string {
  if (harness === "codex") return discoverCodexExecutable(env, explicit);
  if (harness === "claude-code") {
    return discoverNamed(env, explicit, "CLAUDE_CLI", "claude", "Claude Code", CLAUDE_CODE_VERSION);
  }
  return discoverNamed(env, explicit, "OPENCODE_CLI", "opencode", "OpenCode", OPENCODE_CLI_VERSION);
}

export function inspectHarnessExecutable(
  harness: SupportedHarness,
  executable: string,
  deps: Pick<SessionHostDeps, "readVersion" | "spawnSync">,
): void {
  if (harness === "codex") {
    if (deps.readVersion !== undefined) {
      const reported = deps.readVersion(executable);
      assertCodexVersion(parseCodexVersion(reported) ?? (reported === CODEX_CLI_VERSION ? reported : undefined));
      return;
    }
    readCodexVersion(executable, deps.spawnSync);
    return;
  }
  const pin = harness === "claude-code" ? CLAUDE_CODE_VERSION : OPENCODE_CLI_VERSION;
  const label = harness === "claude-code" ? "Claude Code" : "OpenCode";
  const field = harness === "claude-code" ? "claude" : "opencode";
  const reported = deps.readVersion !== undefined
    ? deps.readVersion(executable)
    : readPinnedVersion(executable, deps.spawnSync, label, pin, field);
  const parsed = parseCodexVersion(reported) ?? (reported === pin ? reported : undefined);
  if (parsed !== pin) {
    throw new ValidationError(
      `${label} ${pin} is required for campfire session; found ${parsed ?? "unknown"}. Install ${label} ${pin} and retry.`,
      { field, nextAction: `install_${field}`, found: parsed ?? "unknown" },
    );
  }
}

export function buildHarnessLaunch(input: {
  harness: SupportedHarness;
  executable: string;
  cwd: string;
  parentEnv: NodeJS.ProcessEnv;
  sessionId: string;
  workspaceId: string;
  taskId: string;
}): CodexLaunchPlan {
  if (input.harness === "codex") {
    return buildCodexLaunch({
      executable: input.executable,
      cwd: input.cwd,
      parentEnv: input.parentEnv,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      taskId: input.taskId,
    });
  }
  const instruction = codexInitialInstruction(input.workspaceId, input.taskId);
  return {
    executable: input.executable,
    args: input.harness === "opencode" ? ["--prompt", instruction] : [instruction],
    cwd: input.cwd,
    env: childEnvironment(input.parentEnv, input.sessionId),
    shell: false,
  };
}

function discoverNamed(
  env: NodeJS.ProcessEnv,
  explicit: string | undefined,
  envVar: string,
  binary: string,
  label: string,
  version: string,
): string {
  if (explicit !== undefined) {
    if (!isAbsolute(explicit)) {
      throw new ValidationError(`${label} executable must be an absolute path.`, { field: binary });
    }
    assertExecutable(explicit, label, version, binary);
    return explicit;
  }
  const fromEnv = env[envVar]?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    if (!isAbsolute(fromEnv)) {
      throw new ValidationError(`${envVar} must be an absolute path to ${label} ${version}.`, { field: binary });
    }
    assertExecutable(fromEnv, label, version, binary);
    return fromEnv;
  }
  const pathValue = env.PATH ?? "";
  for (const directory of pathValue.split(delimiter)) {
    if (directory.length === 0) continue;
    const candidate = join(directory, binary);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep scanning PATH. Do not shell out to `which`.
    }
  }
  throw new ValidationError(
    `${label} ${version} was not found on PATH. Install ${label} ${version} and retry.`,
    { field: binary, nextAction: `install_${binary}` },
  );
}

function assertExecutable(path: string, label: string, version: string, field: string): void {
  try {
    accessSync(path, constants.X_OK);
  } catch {
    throw new ValidationError(
      `${label} ${version} was not found. Install ${label} ${version} and retry.`,
      { field, nextAction: `install_${field}` },
    );
  }
}

function readPinnedVersion(
  executable: string,
  spawnSyncImpl: SessionHostDeps["spawnSync"],
  label: string,
  version: string,
  field: string,
): string {
  const run = spawnSyncImpl ?? defaultSpawnSync;
  const result = run(executable, ["--version"], { shell: false, timeout: 5_000 });
  if (result.error !== undefined || result.status !== 0) {
    throw new ValidationError(
      `${label} ${version} could not be inspected. Install ${label} ${version} and retry.`,
      { field, nextAction: `install_${field}` },
    );
  }
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function defaultSpawnSync(
  command: string,
  args: readonly string[],
  options: { shell: false; timeout?: number },
): SpawnSyncResult {
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
