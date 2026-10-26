import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ReplaceFailure } from "./types.js";

export interface ReplaceRequest {
  prefix: string;
  release: { version: string; tarballUrl: string; checksumUrl: string };
  fetch: (url: string) => Promise<{ ok: boolean; bytes: Uint8Array }>;
  spawnSmoke: (binPath: string) => { ok: boolean; stdout: string };
  listEntries?: (bytes: Uint8Array) => string[];
  unpack?: (bytes: Uint8Array, destDir: string) => void;
  /** Keep the previous tree so a failed restart can restore it. */
  preservePrevious?: boolean;
}

export type ReplaceResult =
  | { ok: true; version: string }
  | { ok: false; code: ReplaceFailure; recovery: string };

const UNCHANGED = "The previous Campfire install is unchanged.";

function failure(code: ReplaceFailure, recovery: string): ReplaceResult {
  return { ok: false, code, recovery };
}

function canWrite(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, `.campfire-write-${randomBytes(3).toString("hex")}`);
    writeFileSync(probe, "");
    rmSync(probe);
    return true;
  } catch {
    return false;
  }
}

function safeEntry(entry: string): boolean {
  if (entry.length === 0 || entry.startsWith("/") || entry.includes("\\")) return false;
  const parts = entry.split("/").filter((part) => part.length > 0);
  if (parts.some((part) => part === "..")) return false;
  if (parts[0] === "bin") return parts.length <= 2;
  if (parts[0] === "lib" && parts[1] === "campfire") return true;
  return false;
}

function defaultListEntries(bytes: Uint8Array, archivePath: string): string[] {
  writeFileSync(archivePath, bytes);
  const listed = spawnSync("tar", ["-tzf", archivePath], { encoding: "utf8" });
  if (listed.status !== 0) return [];
  return listed.stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

function defaultUnpack(archivePath: string, destDir: string): void {
  const extracted = spawnSync("tar", ["-xzf", archivePath, "-C", destDir], { encoding: "utf8" });
  if (extracted.status !== 0) throw new Error("could not unpack campfire archive");
}

function readArchiveVersion(packagePath: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

function moveAside(live: string, previous: string, recursive: boolean): void {
  if (!existsSync(live)) return;
  if (existsSync(previous)) rmSync(previous, { recursive, force: true });
  renameSync(live, previous);
}

export function restorePreviousInstall(prefix: string): boolean {
  const liveLib = join(prefix, "lib", "campfire");
  const prevLib = join(prefix, "lib", "campfire.previous");
  const liveBin = join(prefix, "bin", "campfire");
  const prevBin = join(prefix, "bin", "campfire.previous");
  if (!existsSync(prevLib) && !existsSync(prevBin)) return false;
  if (existsSync(prevLib)) {
    rmSync(liveLib, { recursive: true, force: true });
    renameSync(prevLib, liveLib);
  }
  if (existsSync(prevBin)) {
    rmSync(liveBin, { force: true });
    renameSync(prevBin, liveBin);
  }
  return true;
}

export function discardPreviousInstall(prefix: string): void {
  rmSync(join(prefix, "lib", "campfire.previous"), { recursive: true, force: true });
  rmSync(join(prefix, "bin", "campfire.previous"), { force: true });
}

export async function replaceDirect(options: ReplaceRequest): Promise<ReplaceResult> {
  const { prefix, release } = options;
  if (
    !isAbsolute(prefix) ||
    !canWrite(prefix) ||
    !canWrite(join(prefix, "bin")) ||
    !canWrite(join(prefix, "lib"))
  ) {
    return failure("permission", `${UNCHANGED} A writable install prefix is required.`);
  }
  const stage = join(prefix, `.campfire-update-${randomBytes(4).toString("hex")}`);
  const liveLib = join(prefix, "lib", "campfire");
  const liveBin = join(prefix, "bin", "campfire");
  const prevLib = join(prefix, "lib", "campfire.previous");
  const prevBin = join(prefix, "bin", "campfire.previous");
  let moved = false;
  try {
    mkdirSync(stage, { recursive: true });
    let tarball: { ok: boolean; bytes: Uint8Array };
    let checksum: { ok: boolean; bytes: Uint8Array };
    try {
      tarball = await options.fetch(release.tarballUrl);
      checksum = await options.fetch(release.checksumUrl);
    } catch {
      return failure("download", `${UNCHANGED} The download stopped before the install was replaced.`);
    }
    if (!tarball.ok || !checksum.ok) {
      return failure("download", `${UNCHANGED} The pinned archive and its SHA-256 must both download.`);
    }
    const digest = Buffer.from(checksum.bytes).toString("utf8").trim().split(/\s+/)[0] ?? "";
    if (!/^[0-9a-fA-F]{64}$/.test(digest)) {
      return failure("checksum", `${UNCHANGED} The published checksum was missing or not a SHA-256 digest.`);
    }
    const actual = createHash("sha256").update(tarball.bytes).digest("hex");
    if (actual.toLowerCase() !== digest.toLowerCase()) {
      return failure("checksum", `${UNCHANGED} The archive checksum did not match the published SHA-256.`);
    }
    const archivePath = join(stage, "archive.tar.gz");
    const entries = options.listEntries?.(tarball.bytes) ?? defaultListEntries(tarball.bytes, archivePath);
    if (entries.length === 0 || entries.some((entry) => !safeEntry(entry))) {
      return failure("archive", `${UNCHANGED} The archive layout was not a Campfire release.`);
    }
    try {
      if (options.unpack !== undefined) options.unpack(tarball.bytes, stage);
      else defaultUnpack(archivePath, stage);
    } catch {
      return failure("archive", `${UNCHANGED} The archive could not be unpacked.`);
    }
    const stagedBin = join(stage, "bin", "campfire");
    const stagedPkg = join(stage, "lib", "campfire", "package.json");
    if (!existsSync(stagedBin) || readArchiveVersion(stagedPkg) !== release.version) {
      return failure("archive", `${UNCHANGED} The archive version did not match the pinned release ${release.version}.`);
    }
    const staged = options.spawnSmoke(stagedBin);
    if (!staged.ok || staged.stdout.length === 0 || !staged.stdout.includes(release.version)) {
      return failure("smoke", `${UNCHANGED} The new Campfire failed its version check before it replaced the current install.`);
    }
    moveAside(liveLib, prevLib, true);
    moveAside(liveBin, prevBin, false);
    moved = true;
    renameSync(join(stage, "lib", "campfire"), liveLib);
    renameSync(stagedBin, liveBin);
    chmodSync(liveBin, 0o755);
    const installed = options.spawnSmoke(liveBin);
    if (!installed.ok || installed.stdout.length === 0 || !installed.stdout.includes(release.version)) {
      restorePreviousInstall(prefix);
      moved = false;
      return failure("smoke", "The new Campfire failed its version check. The previous version was restored.");
    }
    if (options.preservePrevious !== true) discardPreviousInstall(prefix);
    return { ok: true, version: release.version };
  } catch {
    if (moved) restorePreviousInstall(prefix);
    return failure("smoke", "The install did not finish. The previous version was restored when it was still on disk.");
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
