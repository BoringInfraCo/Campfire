/**
 * Launcher for the Bun OpenTUI terminal. Bare `campfire` opens this screen.
 *
 * Dev resolves `tui/` from `src/cli`. A built file at `dist/src/cli` resolves
 * the repo `tui/` the same way. Packaged installs place the sidecar at
 * `lib/campfire/tui` beside `dist/`.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ValidationError } from "../domain/errors.js";

export const VENDORED_BUN_MESSAGE =
  "This prototype needs the vendored Bun in tui/ (Bun >= 1.3.14). The Campfire CLI itself still runs on Node 22.";

/** The sidecar cannot be started on this installation; no child was launched. */
export class OpentuiUnavailableError extends ValidationError {
  constructor(message = VENDORED_BUN_MESSAGE) { super(message, { field: "opentui" }); }
}

const MIN_BUN = "1.3.14";

export interface OpentuiFlagSource {
  opentui?: unknown;
}

export function opentuiRequested(env: NodeJS.ProcessEnv, flags: OpentuiFlagSource): boolean {
  return flags.opentui === true || env.CAMPFIRE_TUI === "opentui";
}

export function vendoredBunPackageName(platform: string, arch: string): string | undefined {
  if (platform === "darwin" && arch === "arm64") return "@oven/bun-darwin-aarch64";
  if (platform === "darwin" && arch === "x64") return "@oven/bun-darwin-x64";
  if (platform === "linux" && arch === "x64") return "@oven/bun-linux-x64";
  if (platform === "linux" && arch === "arm64") return "@oven/bun-linux-aarch64";
  return undefined;
}

/**
 * Paths the npm `bun` package may leave the platform binary at.
 * Postinstall renames `@oven/bun-<platform>/bin/bun` onto `bun/bin/bun.exe`.
 * Either location is the vendored binary. A missing install returns the
 * platform path so the error still points at `tui/`.
 */
export function vendoredBunCandidates(tuiRoot: string, platform: string = process.platform, arch: string = process.arch): string[] {
  const name = vendoredBunPackageName(platform, arch);
  if (name === undefined) return [join(tuiRoot, "node_modules", "missing-bun-platform", "bin", "bun")];
  const platformBin = join(tuiRoot, "node_modules", ...name.split("/"), "bin");
  return [
    join(platformBin, "bun"),
    join(platformBin, "bun.exe"),
    join(tuiRoot, "node_modules", "bun", "bin", "bun.exe"),
    join(tuiRoot, "node_modules", "bun", "bin", "bun"),
  ];
}

/** Absolute path of the platform Bun binary inside a `tui/` install. */
export function vendoredBunPath(tuiRoot: string, platform: string = process.platform, arch: string = process.arch): string {
  const candidates = vendoredBunCandidates(tuiRoot, platform, arch);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0] ?? join(tuiRoot, "node_modules", "missing-bun-platform", "bin", "bun");
}

export function resolveTuiRoot(startFile = fileURLToPath(import.meta.url)): string {
  const here = dirname(startFile);
  const candidates = [resolve(here, "../../tui"), resolve(here, "../../../tui")];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "package.json")) && existsSync(join(candidate, "src", "main.ts"))) {
      return candidate;
    }
  }
  throw new OpentuiUnavailableError();
}

export function bunMeetsMinimum(versionText: string, minimum = MIN_BUN): boolean {
  const found = versionText.match(/(\d+)\.(\d+)\.(\d+)/);
  const required = minimum.match(/(\d+)\.(\d+)\.(\d+)/);
  if (found === null || required === null) return false;
  const got = [Number(found[1]), Number(found[2]), Number(found[3])];
  const need = [Number(required[1]), Number(required[2]), Number(required[3])];
  for (let index = 0; index < 3; index += 1) {
    const left = got[index] ?? 0;
    const right = need[index] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
}

export function readBunVersion(bunPath: string): string {
  const result = spawnSync(bunPath, ["--version"], { encoding: "utf8", timeout: 15_000 });
  if (result.error !== undefined || result.status !== 0) return "";
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

export interface OpentuiChild {
  once(event: "error", listener: (error: Error) => void): void;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
}

export interface OpentuiSpawnOptions {
  stdio: "inherit";
  env: NodeJS.ProcessEnv;
  cwd: string;
}

export type OpentuiSpawn = (command: string, args: readonly string[], options: OpentuiSpawnOptions) => OpentuiChild;

export interface SpawnOpentuiInput {
  baseUrl: string;
  token: string;
  workspaceId: string;
  awaitingWorkspace: boolean;
  actorId: string;
  actorType: string;
  parentEnv?: NodeJS.ProcessEnv;
  tuiRoot?: string;
  bunBin?: string;
  platform?: string;
  arch?: string;
  /** Test hook for the runtime's Linux libc check. */
  linuxLibc?: "glibc" | "unsupported";
  /** Test hook. Production runs `bun --version`. */
  readVersion?: (bunPath: string) => string;
  spawnImpl?: OpentuiSpawn;
}

export function assertVendoredBun(bunPath: string, versionText: string): void {
  if (!existsSync(bunPath) || !bunMeetsMinimum(versionText)) {
    throw new OpentuiUnavailableError();
  }
}

/** The current release archives carry glibc binaries only. */
export function linuxLibc(): "glibc" | "unsupported" {
  try {
    const report = process.report?.getReport();
    const header = typeof report === "object" && report !== null ? (report as { header?: { glibcVersionRuntime?: unknown } }).header : undefined;
    return header && typeof header.glibcVersionRuntime === "string" ? "glibc" : "unsupported";
  } catch {
    return "unsupported";
  }
}

/**
 * Spawn `tui/src/main.ts` with the vendored Bun. The token is an environment
 * variable, never an argv entry.
 */
export function spawnOpentui(input: SpawnOpentuiInput): OpentuiChild {
  const tuiRoot = input.tuiRoot ?? resolveTuiRoot();
  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  const env = input.parentEnv ?? process.env;
  if (platform === "linux" && (env.OPENTUI_LIBC === "musl" || (input.linuxLibc ?? linuxLibc()) !== "glibc")) {
    throw new OpentuiUnavailableError("OpenTUI requires glibc on Linux in this release; the classic dashboard remains available.");
  }
  const bunBin = input.bunBin ?? vendoredBunPath(tuiRoot, platform, arch);
  const versionText = (input.readVersion ?? readBunVersion)(bunBin);
  assertVendoredBun(bunBin, versionText);
  const script = join(tuiRoot, "src", "main.ts");
  if (!existsSync(script) || !existsSync(join(tuiRoot, "node_modules", "@opentui", "core", "package.json")) ||
      !existsSync(join(tuiRoot, "node_modules", "@opentui", `core-${platform}-${arch}`, "package.json"))) {
    throw new OpentuiUnavailableError();
  }
  const childEnv: NodeJS.ProcessEnv = { ...env };
  childEnv.CAMPFIRE_URL = input.baseUrl;
  childEnv.CAMPFIRE_TOKEN = input.token;
  childEnv.CAMPFIRE_WORKSPACE_ID = input.workspaceId;
  childEnv.CAMPFIRE_ACTOR_ID = input.actorId;
  childEnv.CAMPFIRE_ACTOR_TYPE = input.actorType;
  if (input.awaitingWorkspace) childEnv.CAMPFIRE_AWAITING_WORKSPACE = "1";
  else delete childEnv.CAMPFIRE_AWAITING_WORKSPACE;
  const spawnImpl = input.spawnImpl ?? ((command, args, options) => spawn(command, [...args], options));
  return spawnImpl(bunBin, [script], { stdio: "inherit", env: childEnv, cwd: tuiRoot });
}

/**
 * Reserved sidecar exit status meaning "run the update handoff". It must equal
 * UPDATE_EXIT_CODE in tui/src/exit-codes.ts; the sidecar cannot import from
 * src/, and this launcher must not import renderer code.
 */
export const OPENTUI_UPDATE_EXIT_CODE = 75;

export type OpentuiOutcome = "quit" | "update";

export function waitForOpentui(child: OpentuiChild): Promise<OpentuiOutcome> {
  return new Promise((resolve, reject) => {
    child.once("error", (error) => {
      reject(new ValidationError(`${VENDORED_BUN_MESSAGE} (${error.message})`, { field: "opentui" }));
    });
    child.once("exit", (code) => {
      if (code === 0) {
        resolve("quit");
        return;
      }
      if (code === OPENTUI_UPDATE_EXIT_CODE) {
        resolve("update");
        return;
      }
      reject(new ValidationError(`OpenTUI exited with status ${code ?? "null"}.`, { field: "opentui" }));
    });
  });
}

export type { ChildProcess };
