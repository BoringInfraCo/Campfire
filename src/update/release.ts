import { parseStableVersion } from "./semver.js";
import { releaseAssetName } from "./platform.js";
import type { PublishedRelease, ReleaseParseFailure, ReleasePlatform } from "./types.js";

export const RELEASE_LATEST_URL = "https://api.github.com/repos/BoringInfraCo/Campfire/releases/latest";

const RELEASE_HOST = "https://github.com/BoringInfraCo/Campfire/releases";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseLatestRelease(
  body: unknown,
  platform: ReleasePlatform,
): { ok: true; release: PublishedRelease } | { ok: false; reason: ReleaseParseFailure } {
  if (!isRecord(body)) return { ok: false, reason: "malformed" };
  if (body.draft === true) return { ok: false, reason: "draft" };
  if (body.prerelease === true) return { ok: false, reason: "prerelease" };
  if (typeof body.tag_name !== "string") return { ok: false, reason: "malformed" };
  const version = parseStableVersion(body.tag_name);
  if (version === undefined) {
    return { ok: false, reason: /^v?\d+\.\d+\.\d+-/.test(body.tag_name.trim()) ? "prerelease" : "malformed" };
  }
  if (!Array.isArray(body.assets)) return { ok: false, reason: "malformed" };
  const names = new Set<string>();
  for (const asset of body.assets) {
    if (isRecord(asset) && typeof asset.name === "string") names.add(asset.name);
  }
  const assetName = releaseAssetName(platform);
  const checksumName = `${assetName}.sha256`;
  if (!names.has(assetName)) return { ok: false, reason: "no-asset" };
  if (!names.has(checksumName)) return { ok: false, reason: "no-checksum" };
  const tag = `v${version.raw}`;
  return {
    ok: true,
    release: {
      version: version.raw,
      tag,
      notesUrl: `${RELEASE_HOST}/tag/${tag}`,
      assetName,
      checksumName,
      tarballUrl: `${RELEASE_HOST}/download/${tag}/${assetName}`,
      checksumUrl: `${RELEASE_HOST}/download/${tag}/${checksumName}`,
    },
  };
}

export async function fetchLatestRelease(timeoutMs: number): Promise<unknown> {
  const response = await fetch(RELEASE_LATEST_URL, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "campfire",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error("update check failed");
  return response.json() as Promise<unknown>;
}
