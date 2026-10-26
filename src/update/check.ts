import { cacheIsFresh } from "./cache.js";
import { noticeLine } from "./notice.js";
import { isNewerStable } from "./semver.js";
import type { PublishedRelease, UpdateCheckCache } from "./types.js";

export function decideNotice(input: {
  installed: string;
  cached: UpdateCheckCache | undefined;
  nowMs: number;
  fetched: PublishedRelease | undefined;
  fetchFailed: boolean;
}): { notice?: string; nextCache: UpdateCheckCache; networkAllowed: boolean } {
  if (input.cached !== undefined && cacheIsFresh(input.cached, input.nowMs)) {
    const release = input.cached.ok ? input.cached.release : undefined;
    const notice = release !== undefined && isNewerStable(release.version, input.installed) ? noticeLine(release.version) : undefined;
    return { ...(notice === undefined ? {} : { notice }), nextCache: input.cached, networkAllowed: false };
  }
  const checkedAt = new Date(input.nowMs).toISOString();
  if (input.fetchFailed || input.fetched === undefined) {
    return { nextCache: { checkedAt, ok: false }, networkAllowed: true };
  }
  const notice = isNewerStable(input.fetched.version, input.installed) ? noticeLine(input.fetched.version) : undefined;
  return {
    ...(notice === undefined ? {} : { notice }),
    nextCache: { checkedAt, ok: true, release: input.fetched },
    networkAllowed: true,
  };
}
