import { parseStableVersion } from "./semver.js";
import type { PublishedRelease, UpdateCheckCache } from "./types.js";

export const UPDATE_CHECK_FILE = "update-check.json";
export const UPDATE_CHECK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function httpsUrl(value: unknown, prefix: string): string | undefined {
  if (typeof value !== "string" || !value.startsWith(prefix)) return undefined;
  return value;
}

export function parseStoredRelease(value: unknown): PublishedRelease | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.version !== "string" || parseStableVersion(value.version)?.raw !== value.version) return undefined;
  if (value.tag !== `v${value.version}`) return undefined;
  const notesUrl = httpsUrl(value.notesUrl, "https://github.com/BoringInfraCo/Campfire/releases/tag/");
  const tarballUrl = httpsUrl(value.tarballUrl, "https://github.com/BoringInfraCo/Campfire/releases/download/");
  const checksumUrl = httpsUrl(value.checksumUrl, "https://github.com/BoringInfraCo/Campfire/releases/download/");
  if (notesUrl === undefined || tarballUrl === undefined || checksumUrl === undefined) return undefined;
  if (typeof value.assetName !== "string" || typeof value.checksumName !== "string") return undefined;
  if (!tarballUrl.endsWith(`/${value.assetName}`) || !checksumUrl.endsWith(`/${value.checksumName}`)) return undefined;
  if (value.checksumName !== `${value.assetName}.sha256`) return undefined;
  return {
    version: value.version,
    tag: value.tag,
    notesUrl,
    assetName: value.assetName,
    checksumName: value.checksumName,
    tarballUrl,
    checksumUrl,
  };
}

export function readUpdateCache(json: string): UpdateCheckCache | undefined {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!isRecord(parsed) || typeof parsed.checkedAt !== "string" || typeof parsed.ok !== "boolean") return undefined;
    if (Number.isNaN(Date.parse(parsed.checkedAt))) return undefined;
    if (parsed.release === undefined) return { checkedAt: parsed.checkedAt, ok: parsed.ok };
    const release = parseStoredRelease(parsed.release);
    if (release === undefined) return { checkedAt: parsed.checkedAt, ok: false };
    return { checkedAt: parsed.checkedAt, ok: parsed.ok, release };
  } catch {
    return undefined;
  }
}

export function cacheIsFresh(cache: UpdateCheckCache, nowMs: number): boolean {
  const checked = Date.parse(cache.checkedAt);
  if (Number.isNaN(checked)) return false;
  const age = nowMs - checked;
  return age >= 0 && age < UPDATE_CHECK_MAX_AGE_MS;
}

export function serializeUpdateCache(cache: UpdateCheckCache): string {
  const body: UpdateCheckCache = { checkedAt: cache.checkedAt, ok: cache.ok };
  if (cache.release !== undefined) body.release = cache.release;
  return `${JSON.stringify(body)}\n`;
}
