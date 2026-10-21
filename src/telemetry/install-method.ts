/**
 * Package-manager install channel detection (TEL-001 brew/nix bootstrap).
 *
 * Homebrew and Nix install the same release archives as the curl installer,
 * but they never fetch `install.sh`, so the shell installer never reports for
 * them. The CLI reports `install_completed` on the first run instead, with the
 * channel self-reported as `brew` or `nix` (labeled, unverified — never
 * token-proven; see docs/TELEMETRY.md "Package-manager bootstrap").
 *
 * Double-report safety with the shell installer: both writers share one claim
 * in one file. `install.sh` resolves its state file exactly as
 * `resolveProfilePaths` does (`CAMPFIRE_CONFIG_DIR`, then
 * `XDG_CONFIG_HOME/campfire`, then `$HOME/.config/campfire`), and writes
 * `installCompletedReported: true` when it creates `telemetry.json` on a
 * fresh curl install. `claimInstallCompleted` answers `""` on the second
 * caller, so whichever writer runs second sends nothing locally — and a
 * replayed id is deduplicated server-side (`INSERT OR IGNORE`) even when the
 * shell posts for an existing file it deliberately leaves byte-for-byte
 * untouched. Curl installs therefore never reach this path at all:
 * `detectInstallMethod` returns `undefined` for them and the hook stays silent,
 * leaving the report to `install.sh`.
 */
import {
  reportInstallCompleted,
  telemetryInBackground,
  type TelemetryReportOptions,
} from "./report.js";

export type PackageManagerInstallMethod = "brew" | "nix";

/**
 * Map an executable path to its install channel. Pure string matching: no
 * filesystem access, no environment reads, never throws for a string input.
 *
 * Order matters only in that `/nix/store` wins outright; a Homebrew path can
 * never also be a Nix store path.
 */
export function detectInstallMethod(
  execPath: string = process.execPath,
): PackageManagerInstallMethod | undefined {
  if (execPath.includes("/nix/store")) return "nix";
  if (
    execPath.includes("/Cellar/") ||
    execPath.includes("/Homebrew/") ||
    execPath.includes("/homebrew/")
  ) {
    return "brew";
  }
  return undefined;
}

export interface PackageManagerInstallOptions extends TelemetryReportOptions {
  /** Override for tests. Defaults to `process.execPath`. */
  execPath?: string;
}

/**
 * Report `install_completed` once for a package-manager install, and do
 * nothing for any other channel. Fire-and-forget: the returned promise is
 * handed to `telemetryInBackground`, and this function itself never throws —
 * a broken detection or a disabled endpoint must not fail a first run.
 * `reportInstallCompleted` already respects `isTelemetryEnabled` and the local
 * one-shot claim, so disabled telemetry sends nothing and writes nothing, and
 * a second call (from either channel) is locally silent.
 */
export function maybeReportPackageManagerInstall(
  options: PackageManagerInstallOptions = {},
): void {
  const { execPath, ...reportOptions } = options;
  let method: PackageManagerInstallMethod | undefined;
  try {
    method = detectInstallMethod(execPath ?? process.execPath);
  } catch {
    return;
  }
  if (method === undefined) return;
  telemetryInBackground(
    reportInstallCompleted({ ...reportOptions, installMethod: method }),
  );
}
