/**
 * Private handoff file for one offline packet.
 *
 * Only the immediate parent and the final path are inspected. Walking every
 * ancestor would reject macOS `os.tmpdir()`, because `/var` is a symlink.
 * The parent symlink is not followed: a symlinked directory is not a place
 * this writer will create a file.
 */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { ValidationError } from "../domain/errors.js";
import { serializeHandoffPacket, type CampfireHandoffPacket } from "../domain/recall.js";

const OUT = { field: "out" } as const;

function cannotSecure(): ValidationError {
  return new ValidationError("The destination cannot be secured", OUT);
}

function refuseSymlink(): ValidationError {
  return new ValidationError("Refusing a symlink", OUT);
}

function refuseOverwrite(): ValidationError {
  return new ValidationError("Refusing overwrite", OUT);
}

function errnoOf(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function exclusiveWriteFlags(): number {
  const flags = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY;
  return typeof constants.O_NOFOLLOW === "number" ? flags | constants.O_NOFOLLOW : flags;
}

function writeAll(fd: number, payload: Buffer): void {
  let offset = 0;
  while (offset < payload.length) {
    const wrote = writeSync(fd, payload, offset, payload.length - offset);
    if (wrote <= 0) throw cannotSecure();
    offset += wrote;
  }
}

/** Resolved destination. Creates nothing. */
export function assertHandoffDestination(destination: string): string {
  let resolved: string;
  try {
    resolved = resolve(destination);
  } catch {
    throw cannotSecure();
  }
  let parentStat;
  try {
    parentStat = lstatSync(dirname(resolved));
  } catch {
    throw cannotSecure();
  }
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw cannotSecure();
  }
  try {
    const existing = lstatSync(resolved);
    if (existing.isSymbolicLink()) throw refuseSymlink();
    throw refuseOverwrite();
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (errnoOf(error) === "ENOENT") return resolved;
    throw cannotSecure();
  }
}

/**
 * Write a new mode-0600 file. The temporary name is hard-linked into place;
 * an existing final path is never replaced.
 */
export function writeHandoffFile(
  destination: string,
  packet: CampfireHandoffPacket,
): { bytes: number; path: string } {
  const resolved = assertHandoffDestination(destination);
  const serialized = serializeHandoffPacket(packet);
  const bytes = Buffer.byteLength(serialized);
  const temporary = join(dirname(resolved), `${basename(resolved)}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  let created = false;
  try {
    fd = openSync(temporary, exclusiveWriteFlags(), 0o600);
    created = true;
    try {
      fchmodSync(fd, 0o600);
      writeAll(fd, Buffer.from(serialized, "utf8"));
      fsyncSync(fd);
    } finally {
      const openFd = fd;
      fd = undefined;
      closeSync(openFd);
    }
    try {
      linkSync(temporary, resolved);
    } catch (error) {
      try {
        unlinkSync(temporary);
      } catch {
        // The finally block unlinks the temp name again.
      }
      throw errnoOf(error) === "EEXIST" ? refuseOverwrite() : cannotSecure();
    }
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw cannotSecure();
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Close already ran, or the descriptor never opened.
      }
    }
    if (created) {
      try {
        unlinkSync(temporary);
      } catch {
        // The temp name is already gone after a failed link cleanup.
      }
    }
  }

  let written;
  try {
    written = lstatSync(resolved);
  } catch {
    throw cannotSecure();
  }
  if (written.isSymbolicLink() || !written.isFile() || (written.mode & 0o777) !== 0o600) {
    try {
      unlinkSync(resolved);
    } catch {
      // Still refuse the unsecured result.
    }
    throw cannotSecure();
  }
  return { bytes, path: resolved };
}
