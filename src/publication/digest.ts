import { createHash, randomBytes } from "node:crypto";
import {
  canonicalJson,
  snapshotDigestInput,
  type PublicationSnapshot,
} from "../domain/publication.js";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function publicationDigest(snapshot: PublicationSnapshot): string {
  return sha256Hex(canonicalJson(snapshotDigestInput(snapshot)));
}

export function randomHex(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}

export function randomRecoverySecret(): string {
  return `cfr_${randomHex(16)}`;
}

/** Operator-held rehearsal admission capability. The Worker stores only its SHA-256. */
export function randomRehearsalCode(): string {
  return `cfrh_${randomHex(24)}`;
}
