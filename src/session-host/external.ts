/**
 * Terminal.app launcher.
 *
 * The short-lived .command file contains only the absolute Campfire executable
 * and the launch id. `open(1)` is invoked with an argv array and shell:false.
 * Repository paths and prompts are never interpolated into that file.
 * The launcher is owner-executable (0700) so Terminal.app can run it; group
 * and other bits stay unset. Registry JSON stays 0600.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { ValidationError } from "../domain/errors.js";
import { ensurePrivateDir, launcherPath } from "./registry.js";
import type { SpawnSyncResult } from "./types.js";

export function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function formatCopyLaunchCommand(executable: string, launchId: string): string {
  if (!isAbsolute(executable)) {
    throw new ValidationError("Campfire executable must be absolute.", { field: "executable" });
  }
  const exe = /[^A-Za-z0-9_./:-]/.test(executable) ? shellSingleQuote(executable) : executable;
  return `${exe} session run ${launchId}`;
}

/** Argv passed to open(1). Not a shell string. */
export function terminalOpenArgv(launcherFile: string): readonly string[] {
  return ["/usr/bin/open", launcherFile];
}

export function writeCommandLauncher(root: string, launchId: string, executable: string): string {
  if (!isAbsolute(executable)) {
    throw new ValidationError("Campfire executable must be absolute.", { field: "executable" });
  }
  const path = launcherPath(root, launchId);
  ensurePrivateDir(dirname(path));
  const body = `#!/bin/sh\nexec ${shellSingleQuote(executable)} session run ${launchId}\n`;
  const temporary = `${path}.${process.pid}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeSync(fd, body);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary name is already gone.
    }
    throw error;
  }
  chmodSync(path, 0o700);
  const written = lstatSync(path);
  if (written.isSymbolicLink() || !written.isFile() || (written.mode & 0o077) !== 0) {
    throw new ValidationError("Launch command file was not private.", { field: "launch" });
  }
  return path;
}

export function deleteCommandLauncher(root: string, launchId: string): void {
  const path = launcherPath(root, launchId);
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      throw new ValidationError("Launch command file is a symlink. Refusing to follow it.", { field: "launch" });
    }
    if (stat.isFile()) unlinkSync(path);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ValidationError("Launch command file could not be removed.", { field: "launch" });
    }
  }
}

export function openTerminalLauncher(
  launcherFile: string,
  spawnSyncImpl: (command: string, args: readonly string[], options: { shell: false }) => SpawnSyncResult = defaultOpen,
): void {
  if (process.platform !== "darwin") {
    throw new ValidationError("Terminal.app launch is only available on macOS. Use --launch copy-launch-command.", {
      field: "launch",
      nextAction: "copy_launch_command",
    });
  }
  const argv = terminalOpenArgv(launcherFile);
  const command = argv[0];
  if (command === undefined) {
    throw new ValidationError("Terminal.app could not be opened.", { field: "launch" });
  }
  const result = spawnSyncImpl(command, argv.slice(1), { shell: false });
  if (result.error !== undefined || result.status !== 0) {
    throw new ValidationError("Could not open Terminal.app for this launch. Use --launch copy-launch-command.", {
      field: "launch",
      nextAction: "copy_launch_command",
    });
  }
}

function defaultOpen(command: string, args: readonly string[], options: { shell: false }): SpawnSyncResult {
  const result = spawnSync(command, [...args], { shell: options.shell, encoding: "utf8" });
  return {
    status: result.status,
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}
