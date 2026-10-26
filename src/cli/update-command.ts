import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { installedCampfireVersion } from "../bootstrap/version.js";
import { loadAnyProfile, resolveProfilePaths } from "../bootstrap/profile.js";
import { ValidationError } from "../domain/errors.js";
import { classifyInstallChannel } from "../update/channel.js";
import { decideNotice } from "../update/check.js";
import { readUpdateCache, serializeUpdateCache, UPDATE_CHECK_FILE } from "../update/cache.js";
import { acceptAnswer, renderConfirm } from "../update/confirm.js";
import { detectReleasePlatform } from "../update/platform.js";
import { fetchLatestRelease, parseLatestRelease } from "../update/release.js";
import { discardPreviousInstall, replaceDirect, restorePreviousInstall } from "../update/replace.js";
import { pollHealth, restartPlan } from "../update/restart.js";
import { shouldAnnounce } from "../update/notice.js";
import type { PublishedRelease } from "../update/types.js";
import type { ParsedArgs } from "./args.js";
import { ownedCampfireService } from "./service-owner.js";

const STARTUP_TIMEOUT_MS = 800;
const CHECK_TIMEOUT_MS = 3000;

export interface UpdateCommandDeps {
  now?: () => number;
  fetchLatest?: (timeoutMs: number) => Promise<unknown>;
  fetchFile?: (url: string) => Promise<{ ok: boolean; bytes: Uint8Array }>;
  spawnSmoke?: (binPath: string) => { ok: boolean; stdout: string };
  listEntries?: (bytes: Uint8Array) => string[];
  unpack?: (bytes: Uint8Array, destDir: string) => void;
  prompt?: (text: string) => Promise<string | undefined>;
  fetchHealth?: (url: string) => Promise<string | undefined>;
  probeListener?: () => Promise<"none" | "other-version" | "same-version">;
  reexec?: (bin: string, argv: readonly string[]) => { kill: () => void };
  exitProcess?: (code: number) => void;
  modulePath?: string;
  installedVersion?: string;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  env?: NodeJS.ProcessEnv;
  command?: string;
}

function wantsJson(parsed: ParsedArgs, stdoutIsTTY: boolean): boolean {
  if (parsed.flags.output === "json" || parsed.flags.json === true) return true;
  if (parsed.flags.output === "human") return false;
  return !stdoutIsTTY;
}

function runningModulePath(deps: UpdateCommandDeps): string {
  if (deps.modulePath !== undefined) return deps.modulePath;
  const argv = process.argv[1];
  if (argv === undefined || argv.length === 0) return "";
  try {
    return realpathSync(argv);
  } catch {
    return argv;
  }
}

function profileMode(env: NodeJS.ProcessEnv): "local" | "remote" | "none" {
  try {
    const profile = loadAnyProfile(env);
    if (profile === undefined) return "none";
    return profile.mode === "remote" ? "remote" : "local";
  } catch {
    return "none";
  }
}

async function defaultPrompt(text: string): Promise<string | undefined> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(text.endsWith("\n") ? text : `${text}\n`);
  } catch {
    return undefined;
  } finally {
    rl.close();
  }
}

function defaultReexec(bin: string, argv: readonly string[]): { kill: () => void } {
  const child = spawn(bin, [...argv], { stdio: "inherit" });
  return { kill: () => child.kill("SIGTERM") };
}

function defaultSmoke(binPath: string): { ok: boolean; stdout: string } {
  const result = spawnSync(binPath, ["--version"], { encoding: "utf8", timeout: 15_000 });
  return { ok: result.status === 0, stdout: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

async function downloadFile(url: string): Promise<{ ok: boolean; bytes: Uint8Array }> {
  try {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
    if (!response.ok) return { ok: false, bytes: new Uint8Array() };
    return { ok: true, bytes: new Uint8Array(await response.arrayBuffer()) };
  } catch {
    return { ok: false, bytes: new Uint8Array() };
  }
}

async function probeDefaultListener(version: string): Promise<"none" | "other-version" | "same-version"> {
  let other = false;
  for (const url of ["http://127.0.0.1:9414/health", "http://127.0.0.1:9415/health"]) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(400) });
      if (response.ok) {
        const body = (await response.json()) as { version?: unknown };
        if (body.version === version) return "same-version";
      }
      other = true;
    } catch {
      // Closed port.
    }
  }
  return other ? "other-version" : "none";
}

async function readHealth(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(400) });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : undefined;
  } catch {
    return undefined;
  }
}

function emit(json: boolean, payload: Record<string, unknown>, lines: string[]): void {
  if (json) console.log(JSON.stringify(payload));
  else if (lines.length > 0) console.log(lines.join("\n"));
}

function writeCache(env: NodeJS.ProcessEnv, body: string): void {
  try {
    const dir = resolveProfilePaths(env).configDir;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, UPDATE_CHECK_FILE);
    const temp = `${path}.tmp`;
    writeFileSync(temp, body, { mode: 0o600 });
    renameSync(temp, path);
  } catch {
    // The next check can run without a cache.
  }
}

function readCache(env: NodeJS.ProcessEnv) {
  try {
    return readUpdateCache(readFileSync(join(resolveProfilePaths(env).configDir, UPDATE_CHECK_FILE), "utf8"));
  } catch {
    return undefined;
  }
}

export async function announceStableUpdate(deps: UpdateCommandDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  const stdoutIsTTY = deps.stdoutIsTTY ?? process.stdout.isTTY === true;
  if (!shouldAnnounce({
    stdoutIsTTY,
    command: deps.command,
    outputMode: "human",
    noninteractive: env.CAMPFIRE_NONINTERACTIVE === "1",
    ci: env.CI === "1" || env.CI === "true",
  })) return;
  let installed: string;
  try {
    installed = deps.installedVersion ?? installedCampfireVersion();
  } catch {
    return;
  }
  const platform = detectReleasePlatform(process.platform, process.arch);
  if (platform === undefined) return;
  const nowMs = (deps.now ?? Date.now)();
  const cached = readCache(env);
  const preview = decideNotice({ installed, cached, nowMs, fetched: undefined, fetchFailed: false });
  if (!preview.networkAllowed) {
    if (preview.notice !== undefined) console.error(preview.notice);
    return;
  }
  let fetched: PublishedRelease | undefined;
  let fetchFailed = false;
  try {
    const body = await (deps.fetchLatest ?? fetchLatestRelease)(STARTUP_TIMEOUT_MS);
    const parsed = parseLatestRelease(body, platform);
    if (parsed.ok) fetched = parsed.release;
    else fetchFailed = true;
  } catch {
    fetchFailed = true;
  }
  const decision = decideNotice({ installed, cached, nowMs, fetched, fetchFailed });
  writeCache(env, serializeUpdateCache(decision.nextCache));
  if (decision.notice !== undefined) console.error(decision.notice);
}

export async function runUpdateCommand(parsed: ParsedArgs, deps: UpdateCommandDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  const stdoutIsTTY = deps.stdoutIsTTY ?? process.stdout.isTTY === true;
  const stdinIsTTY = deps.stdinIsTTY ?? process.stdin.isTTY === true;
  const json = wantsJson(parsed, stdoutIsTTY);
  const checkOnly = parsed.flags.check === true;
  const interactive = stdinIsTTY && !json && env.CAMPFIRE_NONINTERACTIVE !== "1" && !checkOnly;
  let installed: string;
  try {
    installed = deps.installedVersion ?? installedCampfireVersion();
  } catch {
    throw new ValidationError("Could not read the installed Campfire version.", { field: "update" });
  }
  const layout = classifyInstallChannel({ modulePath: runningModulePath(deps) });
  const releasePlatform = detectReleasePlatform(process.platform, process.arch);
  if (releasePlatform === undefined) {
    emit(json, {
      installed,
      channel: layout.channel,
      updateAvailable: false,
      changed: false,
      restart: "not-applicable",
      check: "unsupported",
    }, ["This architecture has no published Campfire archive. Nothing was changed."]);
    return;
  }
  const nowMs = (deps.now ?? Date.now)();
  let fetched: PublishedRelease | undefined;
  let fetchFailed = false;
  try {
    const body = await (deps.fetchLatest ?? fetchLatestRelease)(CHECK_TIMEOUT_MS);
    const parsedRelease = parseLatestRelease(body, releasePlatform);
    if (parsedRelease.ok) fetched = parsedRelease.release;
    else fetchFailed = true;
  } catch {
    fetchFailed = true;
  }
  const decision = decideNotice({ installed, cached: undefined, nowMs, fetched, fetchFailed });
  writeCache(env, serializeUpdateCache(decision.nextCache));
  if (fetchFailed || fetched === undefined) {
    emit(json, {
      installed,
      channel: layout.channel,
      updateAvailable: false,
      confirmed: false,
      changed: false,
      restart: "not-applicable",
      check: "unavailable",
    }, ["Could not check for updates."]);
    return;
  }
  const pinned = fetched;
  if (decision.notice === undefined) {
    emit(json, {
      installed,
      target: pinned.version,
      channel: layout.channel,
      notesUrl: pinned.notesUrl,
      updateAvailable: false,
      confirmed: false,
      changed: false,
      restart: "not-applicable",
      check: "ok",
    }, [`Campfire ${installed} is current.`]);
    return;
  }
  const preview = renderConfirm({
    installed,
    target: pinned.version,
    channel: layout.channel,
    notesUrl: pinned.notesUrl,
    instruction: layout.instruction,
    ask: interactive && layout.channel === "direct",
  });
  if (layout.channel !== "direct" || !interactive) {
    const next = layout.channel === "direct"
      ? "Run campfire update in a terminal and confirm before installing."
      : layout.instruction;
    emit(json, {
      installed,
      target: pinned.version,
      channel: layout.channel,
      notesUrl: pinned.notesUrl,
      updateAvailable: true,
      confirmed: false,
      changed: false,
      restart: "not-applicable",
      check: "ok",
      ...(next === undefined ? {} : { next }),
    }, [preview, ...(next !== undefined && !preview.includes(next) ? [next] : [])]);
    return;
  }
  console.log(preview);
  const answer = await (deps.prompt ?? defaultPrompt)(`Install ${pinned.version}? [y/N] `);
  if (!acceptAnswer(answer)) {
    emit(json, {
      installed,
      target: pinned.version,
      channel: layout.channel,
      notesUrl: pinned.notesUrl,
      updateAvailable: true,
      confirmed: false,
      changed: false,
      restart: "not-applicable",
      check: "ok",
    }, [`Update declined. Campfire ${installed} is unchanged.`]);
    return;
  }
  const owner = ownedCampfireService();
  const replaced = await replaceDirect({
    prefix: layout.prefix ?? "",
    release: { version: pinned.version, tarballUrl: pinned.tarballUrl, checksumUrl: pinned.checksumUrl },
    fetch: deps.fetchFile ?? downloadFile,
    spawnSmoke: deps.spawnSmoke ?? defaultSmoke,
    ...(deps.listEntries === undefined ? {} : { listEntries: deps.listEntries }),
    ...(deps.unpack === undefined ? {} : { unpack: deps.unpack }),
    preservePrevious: owner !== undefined,
  });
  if (!replaced.ok) throw new ValidationError(replaced.recovery, { field: "update", code: replaced.code });
  if (owner !== undefined && layout.binPath !== undefined && layout.prefix !== undefined) {
    let child: { kill: () => void };
    try {
      await owner.stop();
      child = (deps.reexec ?? defaultReexec)(layout.binPath, owner.argv);
    } catch {
      restorePreviousInstall(layout.prefix);
      throw new ValidationError(
        "The new Campfire did not start. The previous version was restored. Start it again with: campfire up",
        { field: "update" },
      );
    }
    const healthBase = owner.apiUrl ?? owner.viewerUrl;
    const healthy = healthBase === undefined
      ? false
      : await pollHealth(
          () => (deps.fetchHealth ?? readHealth)(new URL("/health", healthBase).toString()),
          pinned.version,
          20,
          deps.fetchHealth === undefined ? 250 : 0,
        );
    if (!healthy) {
      child.kill();
      restorePreviousInstall(layout.prefix);
      throw new ValidationError(
        "The new Campfire did not pass its health check. The previous version was restored. Start it again with: campfire up",
        { field: "update" },
      );
    }
    discardPreviousInstall(layout.prefix);
    emit(json, {
      installed,
      target: pinned.version,
      channel: "direct",
      notesUrl: pinned.notesUrl,
      updateAvailable: true,
      confirmed: true,
      changed: true,
      restart: "restarted",
      check: "ok",
    }, [`Campfire ${pinned.version} is running.`]);
    (deps.exitProcess ?? process.exit)(0);
    return;
  }
  const listener = deps.probeListener !== undefined ? await deps.probeListener() : await probeDefaultListener(pinned.version);
  const plan = restartPlan({
    channel: "direct",
    replaced: true,
    ownsLifecycle: false,
    profileMode: profileMode(env),
    listener,
    version: pinned.version,
  });
  emit(json, {
    installed,
    target: pinned.version,
    channel: "direct",
    notesUrl: pinned.notesUrl,
    updateAvailable: true,
    confirmed: true,
    changed: true,
    restart: plan.action,
    check: "ok",
  }, [`Installed Campfire ${pinned.version}.`, ...plan.lines]);
}
