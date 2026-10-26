export interface StableVersion {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

export interface ReleasePlatform {
  os: "darwin" | "linux";
  arch: "arm64" | "x64";
}

export interface PublishedRelease {
  version: string;
  tag: string;
  notesUrl: string;
  assetName: string;
  checksumName: string;
  tarballUrl: string;
  checksumUrl: string;
}

export interface UpdateCheckCache {
  checkedAt: string;
  ok: boolean;
  release?: PublishedRelease;
}

export type InstallChannel = "direct" | "brew" | "nix" | "unknown";

export interface InstallLayout {
  channel: InstallChannel;
  managed: boolean;
  instruction?: string;
  prefix?: string;
  binPath?: string;
  libDir?: string;
}

export type ReleaseParseFailure = "malformed" | "prerelease" | "draft" | "no-asset" | "no-checksum";

export type ReplaceFailure = "permission" | "download" | "checksum" | "archive" | "smoke";
