/**
 * Shared process helpers for real harness runs.
 *
 * Harnesses are executed as genuine vendor CLI processes. Their stdout is
 * captured verbatim so transcript-isolation can be checked against the actual
 * process output rather than a reconstruction.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

export interface ProcessResult {
  exitCode: number;
  startedAt: string;
  finishedAt: string;
  signal?: string;
  error?: string;
}

export interface RunProcessOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  stdoutPath: string;
  stderrPath: string;
}

/** Run a command to completion, persisting stdout/stderr to files. */
export function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions,
): ProcessResult {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs,
    // Close stdin so CLIs do not block waiting for piped input.
    input: "",
  });
  const finishedAt = new Date().toISOString();

  writeFileSync(options.stdoutPath, result.stdout ?? "", "utf8");
  writeFileSync(options.stderrPath, result.stderr ?? "", "utf8");

  let error: string | undefined;
  if (result.error) {
    error = result.error.message;
  } else if (result.signal) {
    error = `terminated by signal ${result.signal}`;
  }

  const exitCode = result.status ?? (result.signal ? 124 : 1);
  return {
    exitCode,
    startedAt,
    finishedAt,
    signal: result.signal ?? undefined,
    error,
  };
}

/** Best-effort harness CLI version, recorded as evidence. */
export function detectVersion(command: string): string {
  try {
    const result = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 20_000 });
    const text = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    return text.split(/\r?\n/)[0]?.trim() || "unknown";
  } catch {
    return "unknown";
  }
}
