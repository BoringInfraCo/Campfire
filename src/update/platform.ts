import type { ReleasePlatform } from "./types.js";

export function detectReleasePlatform(platform: NodeJS.Platform, arch: string): ReleasePlatform | undefined {
  const os = platform === "darwin" || platform === "linux" ? platform : undefined;
  const normalized = arch === "arm64" || arch === "aarch64" ? "arm64" : arch === "x64" || arch === "x86_64" || arch === "amd64" ? "x64" : undefined;
  if (os === undefined || normalized === undefined) return undefined;
  return { os, arch: normalized };
}

export function releaseAssetName(platform: ReleasePlatform): string {
  return `campfire-${platform.os}-${platform.arch}.tar.gz`;
}
