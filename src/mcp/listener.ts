/**
 * On-demand loopback listener (Sprint 018).
 *
 * A harness session may start the same listener `campfire up` starts when
 * nothing is already accepting connections. The listening process owns
 * SQLite. This module stays an HTTP client: it does not open the database
 * and it does not read the operator credential file. The spawned CLI loads
 * that credential itself.
 *
 * The bound port is the long-term owner. The lock only covers the gap between
 * "nothing is listening" and "the new process is accepting", so two sessions
 * cannot both open the database.
 */
import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const READY_ATTEMPTS = 50;
const READY_INTERVAL_MS = 100;

export interface ListenerSpawn {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface EnsureListenerInput {
  url: string;
  env?: NodeJS.ProcessEnv;
  cliEntry?: string;
  execPath?: string;
  execArgv?: string[];
  probe?: (url: string) => Promise<boolean>;
  spawnUp?: (spawned: ListenerSpawn) => void;
  lockPath?: string;
  attempts?: number;
  intervalMs?: number;
}

export interface ListenerReady {
  ready: true;
  started: boolean;
}

export interface ListenerDown {
  ready: false;
  message: string;
  details: { field: "CAMPFIRE_URL"; nextAction: "campfire up" | "check_campfire_url"; url: string };
}

export type EnsureListenerResult = ListenerReady | ListenerDown;

function down(url: string, local: boolean): ListenerDown {
  // `campfire up` starts the loopback listener. It does not serve a remote URL.
  const message = local
    ? `Unable to reach Campfire at ${url}. Run campfire up.`
    : `Unable to reach Campfire at ${url}.`;
  return {
    ready: false,
    message,
    details: {
      field: "CAMPFIRE_URL",
      nextAction: local ? "campfire up" : "check_campfire_url",
      url,
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function endpoint(url: string): { host: string; port: number; loopback: boolean } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  const port = parsed.port.length === 0 ? (parsed.protocol === "https:" ? 443 : 80) : Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return { host: parsed.hostname, port, loopback: isLoopbackHostname(parsed.hostname) };
}

/** True when re-execing this file would run `campfire up`, not the MCP entry. */
export function isCampfireCliEntry(entry: string): boolean {
  return /(?:^|[/\\])cli[/\\]index\.(?:js|ts)$/.test(entry);
}

async function probeListener(url: string): Promise<boolean> {
  // Any HTTP response means a process accepted the connection, including an
  // auth failure. Connection failure is the only "down" signal. The probe
  // sends no token.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300);
  try {
    await fetch(url, { method: "GET", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function tryAcquire(lockPath: string): boolean {
  try {
    const fd = openSync(lockPath, "wx", 0o600);
    writeSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  let recorded: number | undefined;
  try {
    const pid = Number(readFileSync(lockPath, "utf8"));
    recorded = Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    recorded = undefined;
  }
  if (recorded !== undefined && pidAlive(recorded)) return false;
  try {
    unlinkSync(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
  }
  return tryAcquire(lockPath);
}

function release(lockPath: string): void {
  try {
    const pid = Number(readFileSync(lockPath, "utf8"));
    if (pid === process.pid) unlinkSync(lockPath);
  } catch {
    // Another start already released or replaced the lock.
  }
}

function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env, CAMPFIRE_NO_BROWSER: "1" };
  // The agent token belongs to this MCP process. The listener loads the
  // human credential from the operator store on its own.
  delete next.CAMPFIRE_TOKEN;
  delete next.CAMPFIRE_SESSION_ID;
  delete next.CAMPFIRE_ACTOR_ID;
  delete next.CAMPFIRE_URL;
  delete next.CAMPFIRE_HARNESS;
  return next;
}

function defaultSpawn(spawned: ListenerSpawn): void {
  const child = spawn(spawned.command, spawned.args, {
    detached: true,
    stdio: "ignore",
    env: spawned.env,
    windowsHide: true,
  });
  child.once("error", () => {
    // The parent learns the start failed by probing, not from this event.
  });
  child.unref();
}

async function waitUntil(
  probe: () => Promise<boolean>,
  attempts: number,
  intervalMs: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await probe()) return true;
    await sleep(intervalMs);
  }
  return probe();
}

export async function ensureLocalListener(input: EnsureListenerInput): Promise<EnsureListenerResult> {
  const env = input.env ?? process.env;
  const probe = input.probe ?? probeListener;
  const attempts = input.attempts ?? READY_ATTEMPTS;
  const intervalMs = input.intervalMs ?? READY_INTERVAL_MS;
  if (await probe(input.url)) return { ready: true, started: false };

  const target = endpoint(input.url);
  const cliEntry = input.cliEntry ?? process.argv[1];
  const local = target?.loopback === true;
  if (
    target === undefined ||
    !target.loopback ||
    cliEntry === undefined ||
    !isCampfireCliEntry(cliEntry)
  ) {
    return down(input.url, local);
  }

  const execPath = input.execPath ?? process.execPath;
  const execArgv = input.execArgv ?? process.execArgv;
  const lockPath = input.lockPath ?? join(tmpdir(), `campfire-${target.host}-${target.port}.listener.lock`);
  const deadline = Date.now() + attempts * intervalMs;
  let held = false;
  while (!held && Date.now() < deadline) {
    held = tryAcquire(lockPath);
    if (!held) {
      if (await probe(input.url)) return { ready: true, started: false };
      await sleep(intervalMs);
    }
  }
  if (!held) return down(input.url, true);

  try {
    if (await probe(input.url)) return { ready: true, started: false };
    const spawned: ListenerSpawn = {
      command: execPath,
      args: [
        ...execArgv,
        cliEntry,
        "up",
        "--no-open",
        "--no-connect",
        "--host",
        target.host,
        "--port",
        String(target.port),
      ],
      env: childEnv(env),
    };
    try {
      (input.spawnUp ?? defaultSpawn)(spawned);
    } catch {
      return down(input.url, true);
    }
    const ready = await waitUntil(() => probe(input.url), attempts, intervalMs);
    return ready ? { ready: true, started: true } : down(input.url, true);
  } finally {
    release(lockPath);
  }
}
