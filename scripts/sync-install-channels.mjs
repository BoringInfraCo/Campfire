#!/usr/bin/env node
// Pin the Homebrew formula and Nix flake to published release checksums.
//
// The four archives are produced by the public release-tarball workflow.
// Run this from the private repository after those checksums exist, then
// copy packaging/homebrew/campfire.rb to BoringInfraCo/homebrew-campfire.
// This does not publish npm and does not commit to the public snapshot.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const formulaPath = resolve(root, "packaging/homebrew/campfire.rb");
const flakePath = resolve(root, "flake.nix");
const releaseBase = "https://github.com/BoringInfraCo/Campfire/releases/download";

export const INSTALL_CHANNEL_ARCHIVES = [
  "campfire-darwin-arm64.tar.gz",
  "campfire-darwin-x64.tar.gz",
  "campfire-linux-arm64.tar.gz",
  "campfire-linux-x64.tar.gz",
];

export function hexToSri(hex) {
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`sha256 must be 64 hex characters, got ${hex}`);
  }
  return `sha256-${Buffer.from(hex, "hex").toString("base64")}`;
}

function replaceVersion(text, from, to, flavor) {
  if (flavor === "flake") {
    const marker = `version = "${from}";`;
    if (!text.includes(marker)) throw new Error(`flake is not pinned to version ${from}`);
    if (!text.includes("v${version}")) {
      throw new Error("flake download URL must interpolate ${version}");
    }
    return text.replaceAll(marker, `version = "${to}";`);
  }
  const urlMarker = `/v${from}/`;
  if (!text.includes(urlMarker)) throw new Error(`formula has no download URL for v${from}`);
  return text.replaceAll(urlMarker, `/v${to}/`);
}

function replaceFormulaHash(formula, archive, hex) {
  const pattern = new RegExp(`(${archive.replaceAll(".", "\\.")}"\\n\\s+sha256 ")[0-9a-fA-F]{64}(")`);
  if (!pattern.test(formula)) {
    throw new Error(`formula has no sha256 for ${archive}`);
  }
  return formula.replace(pattern, `$1${hex}$2`);
}

function replaceFlakeHash(flake, archive, sri) {
  const pattern = new RegExp(`(hash = ")sha256-[A-Za-z0-9+/=]+("; # ${archive.replaceAll(".", "\\.")})`);
  if (!pattern.test(flake)) {
    throw new Error(`flake has no hash for ${archive}`);
  }
  return flake.replace(pattern, `$1${sri}$2`);
}

/**
 * @param {string} formula
 * @param {string} flake
 * @param {{ version: string, digests: Record<string, string> }} pins
 */
export function applyChannelPins(formula, flake, pins) {
  if (!/^\d+\.\d+\.\d+$/.test(pins.version)) {
    throw new Error(`version must be X.Y.Z, got ${pins.version}`);
  }
  const current = formula.match(/releases\/download\/v(\d+\.\d+\.\d+)\//);
  if (!current) throw new Error("formula has no X.Y.Z download URL");
  let nextFormula = replaceVersion(formula, current[1], pins.version, "formula");
  let nextFlake = replaceVersion(flake, current[1], pins.version, "flake");
  for (const archive of INSTALL_CHANNEL_ARCHIVES) {
    const hex = pins.digests[archive];
    if (hex === undefined) throw new Error(`missing digest for ${archive}`);
    nextFormula = replaceFormulaHash(nextFormula, archive, hex.toLowerCase());
    nextFlake = replaceFlakeHash(nextFlake, archive, hexToSri(hex.toLowerCase()));
  }
  return { formula: nextFormula, flake: nextFlake };
}

export function parseChecksumFile(text, archive) {
  const digest = text.trim().split(/\s+/)[0] ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(digest)) {
    throw new Error(`checksum for ${archive} did not start with a 64-character hex digest`);
  }
  return digest.toLowerCase();
}

async function fetchDigest(version, archive) {
  const url = `${releaseBase}/v${version}/${archive}.sha256`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`could not download ${url} (${response.status})`);
  }
  return parseChecksumFile(await response.text(), archive);
}

function readPackageVersion() {
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  if (typeof manifest.version !== "string") throw new Error("package.json has no version");
  return manifest.version;
}

function parseArgs(argv) {
  const result = { version: undefined, check: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--version") result.version = argv[++index];
    else if (arg === "--check") result.check = true;
    else if (arg === "--dry-run") result.dryRun = true;
    else if (arg === "--help") {
      console.log("Usage: node scripts/sync-install-channels.mjs [--version X.Y.Z] [--check] [--dry-run]");
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = args.version ?? readPackageVersion();
  const digests = {};
  for (const archive of INSTALL_CHANNEL_ARCHIVES) {
    digests[archive] = await fetchDigest(version, archive);
  }
  const currentFormula = readFileSync(formulaPath, "utf8");
  const currentFlake = readFileSync(flakePath, "utf8");
  const next = applyChannelPins(currentFormula, currentFlake, { version, digests });
  const changed = next.formula !== currentFormula || next.flake !== currentFlake;
  if (args.check && changed) {
    throw new Error(`install channel pins do not match the v${version} release checksums`);
  }
  if (!args.dryRun && !args.check && changed) {
    writeFileSync(formulaPath, next.formula);
    writeFileSync(flakePath, next.flake);
  }
  console.log(
    changed
      ? `install channels ${args.dryRun || args.check ? "differ from" : "pinned to"} v${version}`
      : `install channels already pin v${version}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`sync-install-channels: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
