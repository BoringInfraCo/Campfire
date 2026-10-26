import type { StableVersion } from "./types.js";

const STABLE = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseStableVersion(input: string): StableVersion | undefined {
  const match = STABLE.exec(input.trim());
  if (match === null) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) {
    return undefined;
  }
  return { major, minor, patch, raw: `${major}.${minor}.${patch}` };
}

export function compareStable(left: StableVersion, right: StableVersion): -1 | 0 | 1 {
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  return 0;
}

/** True only when both sides are stable and the candidate is strictly newer. */
export function isNewerStable(candidate: string, installed: string): boolean {
  const next = parseStableVersion(candidate);
  const current = parseStableVersion(installed);
  if (next === undefined || current === undefined) return false;
  return compareStable(next, current) > 0;
}
