/**
 * SES-001 wrapper lifecycle.
 *
 * `run` registers the Core session before the child starts, heartbeats on a
 * clock independent of stdio, and finalizes through the control-socket owner.
 * Stop and reconcile never signal an unverified pid.
 */
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { constants } from "node:fs";
import { accessSync } from "node:fs";
import { dirname } from "node:path";
import { loadAnyProfile, readOperatorAgentToken, type AnyCampfireProfile } from "../bootstrap/profile.js";
import { ValidationError } from "../domain/errors.js";
import { SESSION_REPORT_MIN_INTERVAL_MS } from "../domain/session-runtime.js";
import { assertCodexVersion, assertLaunchableHarness, buildCodexLaunch, discoverCodexExecutable, parseCodexVersion, readCodexVersion } from "./codex.js";
import { sendControl, startControlServer, type ControlServer } from "./control.js";
import { deleteCommandLauncher, formatCopyLaunchCommand, openTerminalLauncher, writeCommandLauncher } from "./external.js";
import { assertSessionHostEnabled } from "./flag.js";
import {
  createLaunchId,
  ensurePrivateDir,
  ensureRegistry,
  listRegistryEntries,
  lockPath,
  readLaunchRecord,
  RegistryFault,
  removeLaunchFiles,
  writeLaunchRecord,
} from "./registry.js";
import { assertObjectId, reviewCheckout } from "./repository.js";
import {
  EMBEDDED_UNAVAILABLE_MESSAGE,
  CODEX_CLI_VERSION,
  FINAL_TTL_MS,
  HEARTBEAT_MS,
  RUNTIME_REPORT_MISSING_MESSAGE,
  STOP_GRACE_MS,
  UNLAUNCHED_TTL_MS,
  type Clock,
  type CoreClient,
  type FailureKind,
  type LaunchRecord,
  type ManagedChild,
  type PrepareReceipt,
  type RuntimeState,
  type SessionActorContext,
  type SessionHostDeps,
  type SpawnRequest,
} from "./types.js";

const FINAL_STATES = new Set(["exited", "failed", "control_lost"]);

export interface PrepareInput {
  workspaceId: string;
  taskId: string;
  agentId: string;
  harness: string;
  repository: string;
  worktree?: string;
  launch: string;
}

export interface PrepareResult {
  receipt: PrepareReceipt;
  copyCommand?: string;
}

export interface RunResult {
  launchId: string;
  coreSessionId?: string;
  localState: "exited" | "failed";
  exitCode?: number;
  failureKind?: FailureKind;
}

export interface StopResult {
  launchId: string;
  stopped: boolean;
  control: "ok" | "lost";
  reconcileRequired: boolean;
}

export interface ReconcileResult {
  checkedAt: string;
  expiredRemoved: string[];
  finalizedRemoved: string[];
  corrupt: string[];
  symlinkRefused: string[];
  insecure: string[];
  deadWrappers: string[];
  pidReuseRefused: string[];
  missingExecutable: string[];
  controlLost: string[];
  unchanged: string[];
}

interface ExitState {
  settled: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
}

const systemClock: Clock = {
  now: () => Date.now(),
  wait: (ms: number) => new Promise((resolve) => {
    setTimeout(resolve, ms);
  }),
};

function depsEnv(deps: SessionHostDeps): NodeJS.ProcessEnv {
  return deps.env ?? process.env;
}

function clockOf(deps: SessionHostDeps): Clock {
  return deps.clock ?? systemClock;
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function requireProfile(env: NodeJS.ProcessEnv): AnyCampfireProfile {
  const profile = loadAnyProfile(env);
  if (profile === undefined) {
    throw new ValidationError("No Campfire profile yet. Run campfire in a terminal.", { field: "profile" });
  }
  return profile;
}

function assertOwnedAgent(profile: AnyCampfireProfile, agentId: string, harness: string): void {
  const listed = profile.agents?.find((agent) => agent.id === agentId);
  if (listed !== undefined) {
    if (listed.harness !== harness) {
      throw new ValidationError("The launch agent harness does not match this profile.", { field: "harness" });
    }
    return;
  }
  if (profile.mode !== "remote" && profile.agentId === agentId && profile.harness === harness) return;
  throw new ValidationError("The launch agent is not owned by this profile.", { field: "agentId" });
}

function resolveCredential(deps: SessionHostDeps, harness: string): string {
  const env = depsEnv(deps);
  const token = deps.resolveAgentCredential?.(env, harness) ?? readOperatorAgentToken(env, harness);
  if (token === undefined || token.trim().length === 0) {
    throw new ValidationError("No Codex agent credential is stored for this profile. Connect the agent before campfire session run.", {
      field: "credentials",
      nextAction: "connect_agent",
    });
  }
  return token;
}

function executableIsPresent(path: string | undefined): boolean {
  if (path === undefined) return false;
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function tryCodexPath(deps: SessionHostDeps): string | undefined {
  try {
    return discoverCodexExecutable(depsEnv(deps), deps.codexExecutable);
  } catch {
    return undefined;
  }
}

export function receiptFor(record: LaunchRecord): PrepareReceipt {
  const displayName = record.repositoryRoot.split("/").filter((part) => part.length > 0).at(-1) ?? "repository";
  return {
    launchId: record.launchId,
    workspaceId: record.workspaceId,
    taskId: record.taskId,
    agentId: record.agentId,
    harness: record.harness,
    repositoryDisplayName: displayName,
    localLaunchState: record.localState,
    expiresAt: record.expiresAt,
    launchMode: record.launchMode,
  };
}

export function prepareSession(input: PrepareInput, deps: SessionHostDeps = {}): PrepareResult {
  const env = depsEnv(deps);
  assertSessionHostEnabled(env);
  const workspaceId = assertObjectId(input.workspaceId, "workspaceId");
  const taskId = assertObjectId(input.taskId, "taskId");
  const agentId = assertObjectId(input.agentId, "agentId");
  if (input.harness === "claude-code" || input.harness === "opencode" || input.harness !== "codex") {
    assertLaunchableHarness(input.harness);
  }
  if (input.launch === "embedded") {
    if (env.CAMPFIRE_EMBEDDED_TERMINAL !== "1") {
      throw new ValidationError(EMBEDDED_UNAVAILABLE_MESSAGE, { field: "launch", nextAction: "use_external_launch" });
    }
  }
  if (input.launch !== "external" && input.launch !== "copy-launch-command" && input.launch !== "embedded") {
    throw new ValidationError("Launch mode must be external, embedded, or copy-launch-command.", { field: "launch" });
  }
  const profile = requireProfile(env);
  assertOwnedAgent(profile, agentId, "codex");
  resolveCredential(deps, "codex");
  const checkout = reviewCheckout(input.repository, input.worktree);
  const executable = discoverCodexExecutable(env, deps.codexExecutable);
  inspectCodex(executable, deps);
  const now = clockOf(deps).now();
  const launchId = createLaunchId();
  const record: LaunchRecord = {
    version: 1,
    launchId,
    workspaceId,
    taskId,
    agentId,
    humanId: profile.humanId,
    harness: "codex",
    repositoryRoot: checkout.repositoryRoot,
    ...(checkout.worktreePath === undefined ? {} : { worktreePath: checkout.worktreePath }),
    launchMode: input.launch === "copy-launch-command" ? "copy" : input.launch,
    createdAt: iso(now),
    expiresAt: iso(now + UNLAUNCHED_TTL_MS),
    localState: "prepared",
  };
  writeLaunchRecord(env, record);
  const receipt = receiptFor(record);
  if (input.launch === "embedded") return { receipt };
  const campfire = deps.campfireExecutable ?? defaultCampfireExecutable();
  if (input.launch === "copy-launch-command") {
    return { receipt, copyCommand: formatCopyLaunchCommand(campfire, launchId) };
  }
  const root = ensureRegistry(env);
  const launcher = writeCommandLauncher(root, launchId, campfire);
  try {
    if (deps.openExternal !== undefined) deps.openExternal(launcher);
    else openTerminalLauncher(launcher, deps.spawnSync);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("Could not open Terminal.app for this launch. Use --launch copy-launch-command.", {
      field: "launch",
      nextAction: "copy_launch_command",
    });
  }
  return { receipt };
}

function inspectCodex(executable: string, deps: SessionHostDeps): void {
  if (deps.readVersion !== undefined) {
    const reported = deps.readVersion(executable);
    assertCodexVersion(parseCodexVersion(reported) ?? (reported === CODEX_CLI_VERSION ? reported : undefined));
    return;
  }
  readCodexVersion(executable, deps.spawnSync);
}

function armTimer(ms: number): { done: Promise<boolean>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let finish: (fired: boolean) => void = () => undefined;
  const done = new Promise<boolean>((resolve) => {
    finish = (fired: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(fired);
    };
    timer = setTimeout(() => finish(true), ms);
  });
  return {
    done,
    cancel: () => {
      if (timer !== undefined) clearTimeout(timer);
      finish(false);
    },
  };
}

function defaultCampfireExecutable(): string {
  const entry = process.argv[1];
  if (entry === undefined || entry.length === 0) return process.execPath;
  return entry.startsWith("/") ? entry : `${process.cwd()}/${entry}`;
}

function revalidate(record: LaunchRecord, deps: SessionHostDeps): { cwd: string } {
  const env = depsEnv(deps);
  const profile = requireProfile(env);
  if (profile.humanId !== record.humanId) {
    throw new ValidationError("This profile does not own the launch.", { field: "humanId" });
  }
  assertOwnedAgent(profile, record.agentId, record.harness);
  assertLaunchableHarness(record.harness);
  assertObjectId(record.taskId, "taskId");
  const now = clockOf(deps).now();
  const expiry = Date.parse(record.expiresAt);
  if (record.localState === "prepared" && (Number.isNaN(expiry) || expiry <= now)) {
    throw new ValidationError("This launch expired before it started. Prepare a new session.", {
      field: "launchId",
      nextAction: "session_prepare",
    });
  }
  if (record.localState !== "prepared") {
    throw new ValidationError(`Launch ${record.launchId} is already ${record.localState}. Refusing to start a second wrapper.`, {
      field: "launchId",
    });
  }
  const checkout = reviewCheckout(record.repositoryRoot, record.worktreePath);
  return { cwd: checkout.cwd };
}

function acquireLock(env: NodeJS.ProcessEnv, launchId: string, alive: (pid: number) => boolean): () => void {
  const root = ensureRegistry(env);
  const path = lockPath(root, launchId);
  ensurePrivateDir(dirname(path));
  try {
    const existing = lstatSync(path);
    if (existing.isSymbolicLink()) {
      throw new ValidationError("Launch lock is a symlink. Refusing to follow it.", { field: "launchId" });
    }
    const pid = Number(readFileSync(path, "utf8").split("\n")[0]);
    if (alive(pid)) {
      throw new ValidationError(`Launch ${launchId} is already running. Refusing to start a second wrapper.`, {
        field: "launchId",
      });
    }
    unlinkSync(path);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ValidationError(`Launch ${launchId} is already running. Refusing to start a second wrapper.`, {
        field: "launchId",
      });
    }
  }
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ValidationError(`Launch ${launchId} is already running. Refusing to start a second wrapper.`, {
        field: "launchId",
      });
    }
    throw error;
  }
  writeSync(fd, `${process.pid}\n`);
  return () => {
    try {
      closeSync(fd);
    } catch {
      // The descriptor is already closed.
    }
    try {
      const stat = lstatSync(path);
      if (!stat.isSymbolicLink() && stat.isFile()) unlinkSync(path);
    } catch {
      // The lock is already gone.
    }
  };
}

function isMissingReport(error: unknown): boolean {
  if (!(error instanceof ValidationError)) return false;
  return error.details?.field === "reportAgentSessionRuntime" || error.message === RUNTIME_REPORT_MISSING_MESSAGE;
}

/** Core rejects a second report inside five seconds. The same sequence is sent once more. */
function isReportRateLimited(error: unknown): boolean {
  return error instanceof ValidationError && error.message.includes("limited to one every");
}

function defaultSpawn(request: SpawnRequest): ManagedChild {
  return spawn(request.command, [...request.args], {
    cwd: request.cwd,
    env: request.env,
    shell: false,
    stdio: request.stdio,
    windowsHide: true,
  });
}

function trackExit(child: ManagedChild): { state: ExitState; done: Promise<void> } {
  const state: ExitState = { settled: false, code: null, signal: null };
  const done = new Promise<void>((resolve) => {
    child.once("exit", (code, signal) => {
      state.settled = true;
      state.code = code;
      state.signal = signal;
      resolve();
    });
  });
  return { state, done };
}

function waitUntilSpawned(child: ManagedChild): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("spawn timeout"));
    }, 5_000);
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onSpawn = (): void => {
      cleanup();
      resolve();
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      child.off("error", onError);
      child.off("spawn", onSpawn);
    };
    child.once("error", onError);
    child.once("spawn", onSpawn);
  });
}

function normalizeExit(state: ExitState): { runtime: "exited" | "failed"; exitCode?: number; failureKind?: FailureKind } {
  if (state.signal !== null) return { runtime: "failed", failureKind: "signal" };
  if (state.code === 0) return { runtime: "exited", exitCode: 0 };
  if (typeof state.code === "number" && state.code >= 0 && state.code <= 255) {
    return { runtime: "failed", failureKind: "nonzero_exit", exitCode: state.code };
  }
  return { runtime: "failed", failureKind: "wrapper_lost" };
}

function finalizeRecord(record: LaunchRecord, deps: SessionHostDeps, state: LaunchRecord["localState"], failureKind?: FailureKind, exitCode?: number): void {
  const now = clockOf(deps).now();
  record.localState = state;
  record.finalizedAt = iso(now);
  record.expiresAt = iso(now + FINAL_TTL_MS);
  if (failureKind !== undefined) record.failureKind = failureKind;
  if (exitCode !== undefined) record.exitCode = exitCode;
  writeLaunchRecord(depsEnv(deps), record);
}

export async function runSession(launchId: string, deps: SessionHostDeps = {}): Promise<RunResult> {
  const env = depsEnv(deps);
  assertSessionHostEnabled(env);
  const id = assertObjectId(launchId, "launchId");
  if (!id.startsWith("lch_")) {
    throw new ValidationError("Launch id is invalid.", { field: "launchId" });
  }
  const alive = deps.pidAlive ?? pidAlive;
  const release = acquireLock(env, id, alive);
  let control: ControlServer | undefined;
  const timers: Array<{ cancel: () => void }> = [];
  try {
    const record = readLaunchRecord(env, id);
    const { cwd } = revalidate(record, deps);
    const credential = resolveCredential(deps, record.harness);
    if (credential.length === 0) {
      throw new ValidationError("No Codex agent credential is stored for this profile. Connect the agent before campfire session run.", {
        field: "credentials",
      });
    }
    const root = ensureRegistry(env);
    deleteCommandLauncher(root, id);
    const core = deps.core;
    if (core === undefined) {
      throw new ValidationError("Campfire Core is not available for this session.", { field: "core", nextAction: "upgrade_campfire_core" });
    }
    const agentCtx: SessionActorContext = deps.agentContext ?? { actor: { actorId: record.agentId, actorType: "agent" } };
    const executable = discoverCodexExecutable(env, deps.codexExecutable);
    inspectCodex(executable, deps);
    let sessionId: string;
    try {
      const session = await core.registerAgentSession(agentCtx, {
        agentId: record.agentId,
        workspaceId: record.workspaceId,
        harness: record.harness,
        taskId: record.taskId,
      });
      sessionId = session.id;
    } catch (error) {
      throw error;
    }
    record.coreSessionId = sessionId;
    record.localState = "starting";
    record.wrapperPid = process.pid;
    record.wrapperStartMarker = randomBytes(16).toString("hex");
    writeLaunchRecord(env, record);
    const bound: SessionActorContext = { ...agentCtx, agentSessionId: sessionId };
    let sequence = record.lastSequence ?? 0;
    const report = async (state: RuntimeState, extra: { exitCode?: number; failureKind?: FailureKind } = {}): Promise<void> => {
      sequence += 1;
      const payload = {
        sessionId,
        state,
        sequence,
        ...(extra.exitCode === undefined ? {} : { exitCode: extra.exitCode }),
        ...(extra.failureKind === undefined ? {} : { failureKind: extra.failureKind }),
      };
      const accept = (): void => {
        record.lastSequence = sequence;
        record.reporting = "ok";
        record.localState = state;
        writeLaunchRecord(env, record);
      };
      try {
        await core.reportAgentSessionRuntime(bound, payload);
        accept();
      } catch (error) {
        if (isMissingReport(error)) throw error;
        if (!isReportRateLimited(error)) {
          record.reporting = "offline";
          writeLaunchRecord(env, record);
          return;
        }
        await clockOf(deps).wait(SESSION_REPORT_MIN_INTERVAL_MS);
        try {
          await core.reportAgentSessionRuntime(bound, payload);
          accept();
        } catch (retryError) {
          if (isMissingReport(retryError)) throw retryError;
          record.reporting = "offline";
          writeLaunchRecord(env, record);
        }
      }
    };
    try {
      await report("starting");
    } catch (error) {
      if (isMissingReport(error)) {
        await core.endAgentSession(bound, sessionId).catch(() => undefined);
        finalizeRecord(record, deps, "failed", "control_unavailable");
      }
      throw error;
    }
    const marker = record.wrapperStartMarker;
    if (marker === undefined) {
      throw new ValidationError("Launch marker was not stored.", { field: "launchId" });
    }
    let stopRequested = false;
    let wakeStop = (): void => undefined;
    const stopWait = new Promise<void>((resolve) => {
      wakeStop = resolve;
    });
    const socketDir = deps.socketDir ?? `/tmp/cfses-${process.getuid?.() ?? 0}`;
    try {
      control = await startControlServer({
        directory: socketDir,
        launchId: id,
        marker,
        onStop: () => {
          stopRequested = true;
          wakeStop();
        },
      });
    } catch (error) {
      await core.endAgentSession(bound, sessionId).catch(() => undefined);
      finalizeRecord(record, deps, "failed", "control_unavailable");
      throw error;
    }
    record.privateControlSocket = control.path;
    writeLaunchRecord(env, record);
    const plan = buildCodexLaunch({
      executable,
      cwd,
      parentEnv: env,
      sessionId,
      workspaceId: record.workspaceId,
      taskId: record.taskId,
    });
    const child = (deps.spawn ?? defaultSpawn)({
      command: plan.executable,
      args: plan.args,
      cwd: plan.cwd,
      env: plan.env,
      shell: false,
      stdio: deps.stdio ?? "inherit",
    });
    const exit = trackExit(child);
    try {
      await waitUntilSpawned(child);
    } catch {
      await report("failed", { failureKind: "spawn_failed" }).catch(() => undefined);
      await core.endAgentSession(bound, sessionId).catch(() => undefined);
      finalizeRecord(record, deps, "failed", "spawn_failed");
      if (control !== undefined) await control.close().catch(() => undefined);
      return { launchId: id, coreSessionId: sessionId, localState: "failed", failureKind: "spawn_failed" };
    }
    const heartbeat = deps.heartbeatMs ?? HEARTBEAT_MS;
    const manualClock = deps.clock;
    while (!exit.state.settled && !stopRequested) {
      let tick: Promise<"tick" | "cancel">;
      if (manualClock === undefined) {
        const armed = armTimer(heartbeat);
        timers.push(armed);
        tick = armed.done.then((fired) => (fired ? "tick" : "cancel"));
      } else {
        tick = manualClock.wait(heartbeat).then(() => "tick");
      }
      const which = await Promise.race([
        exit.done.then(() => "exit" as const),
        stopWait.then(() => "stop" as const),
        tick,
      ]);
      if (which === "cancel" || which === "exit" || exit.state.settled || which === "stop" || stopRequested) break;
      await report("running");
    }
    for (const timer of timers) timer.cancel();
    if (stopRequested && !exit.state.settled) {
      await report("stopping");
      child.kill("SIGTERM");
      const grace = deps.graceMs ?? STOP_GRACE_MS;
      let graceElapsed: Promise<boolean>;
      let cancelGrace: (() => void) | undefined;
      if (manualClock === undefined) {
        const armed = armTimer(grace);
        cancelGrace = armed.cancel;
        graceElapsed = armed.done.then((fired) => fired);
      } else {
        graceElapsed = manualClock.wait(grace).then(() => true);
      }
      const elapsed = await Promise.race([
        exit.done.then(() => false),
        graceElapsed,
      ]);
      cancelGrace?.();
      if (elapsed && !exit.state.settled) child.kill("SIGKILL");
      await exit.done;
    } else if (!exit.state.settled) {
      await exit.done;
    }
    const normalized = normalizeExit(exit.state);
    await report(normalized.runtime, {
      ...(normalized.exitCode === undefined ? {} : { exitCode: normalized.exitCode }),
      ...(normalized.failureKind === undefined ? {} : { failureKind: normalized.failureKind }),
    });
    await core.endAgentSession(bound, sessionId).catch(() => undefined);
    finalizeRecord(record, deps, normalized.runtime, normalized.failureKind, normalized.exitCode);
    return {
      launchId: id,
      coreSessionId: sessionId,
      localState: normalized.runtime,
      ...(normalized.exitCode === undefined ? {} : { exitCode: normalized.exitCode }),
      ...(normalized.failureKind === undefined ? {} : { failureKind: normalized.failureKind }),
    };
  } finally {
    for (const timer of timers) timer.cancel();
    if (control !== undefined) await control.close().catch(() => undefined);
    release();
  }
}

export async function stopSession(launchId: string, deps: SessionHostDeps = {}): Promise<StopResult> {
  const env = depsEnv(deps);
  assertSessionHostEnabled(env);
  const id = assertObjectId(launchId, "launchId");
  const record = readLaunchRecord(env, id);
  const socket = record.privateControlSocket;
  const marker = record.wrapperStartMarker;
  const lost = (): StopResult => {
    record.localState = "control_lost";
    writeLaunchRecord(env, record);
    return { launchId: id, stopped: false, control: "lost", reconcileRequired: true };
  };
  if (socket === undefined || marker === undefined) return lost();
  try {
    const response = await sendControl(socket, { op: "stop", launchId: id, marker });
    if (response.ok !== true) return lost();
    return { launchId: id, stopped: true, control: "ok", reconcileRequired: false };
  } catch {
    return lost();
  }
}

export async function reconcileSessions(deps: SessionHostDeps = {}): Promise<ReconcileResult> {
  const env = depsEnv(deps);
  assertSessionHostEnabled(env);
  const now = clockOf(deps).now();
  const alive = deps.pidAlive ?? pidAlive;
  const listed = listRegistryEntries(env);
  const result: ReconcileResult = {
    checkedAt: iso(now),
    expiredRemoved: [],
    finalizedRemoved: [],
    corrupt: listed.faults.filter((fault) => fault.kind === "corrupt").map((fault) => fault.launchId),
    symlinkRefused: listed.faults.filter((fault) => fault.kind === "symlink").map((fault) => fault.launchId),
    insecure: listed.faults.filter((fault) => fault.kind === "insecure").map((fault) => fault.launchId),
    deadWrappers: [],
    pidReuseRefused: [],
    missingExecutable: [],
    controlLost: [],
    unchanged: [],
  };
  const codexPath = tryCodexPath(deps);
  for (const record of listed.records) {
    const expiry = Date.parse(record.expiresAt);
    if (record.localState === "prepared" && !Number.isNaN(expiry) && expiry <= now) {
      removeIfSafe(env, record.launchId, result);
      result.expiredRemoved.push(record.launchId);
      continue;
    }
    if (FINAL_STATES.has(record.localState) && !Number.isNaN(expiry) && expiry <= now) {
      removeIfSafe(env, record.launchId, result);
      result.finalizedRemoved.push(record.launchId);
      continue;
    }
    if (record.localState === "prepared" && !executableIsPresent(codexPath)) {
      result.missingExecutable.push(record.launchId);
      continue;
    }
    if (record.localState === "starting" || record.localState === "running" || record.localState === "stopping") {
      const pid = record.wrapperPid;
      if (pid === undefined || !alive(pid)) {
        await finishDeadWrapper(record, deps, result);
        continue;
      }
      const identified = await identifyWrapper(record);
      if (identified) {
        result.unchanged.push(record.launchId);
        continue;
      }
      record.localState = "control_lost";
      record.finalizedAt = iso(now);
      record.expiresAt = iso(now + FINAL_TTL_MS);
      writeLaunchRecord(env, record);
      result.pidReuseRefused.push(record.launchId);
      result.controlLost.push(record.launchId);
      continue;
    }
    result.unchanged.push(record.launchId);
  }
  return result;
}

function removeIfSafe(env: NodeJS.ProcessEnv, launchId: string, result: ReconcileResult): void {
  try {
    removeLaunchFiles(env, launchId);
  } catch (error) {
    if (error instanceof RegistryFault && error.kind === "symlink") result.symlinkRefused.push(launchId);
  }
}

async function identifyWrapper(record: LaunchRecord): Promise<boolean> {
  if (record.privateControlSocket === undefined || record.wrapperStartMarker === undefined) return false;
  try {
    const response = await sendControl(record.privateControlSocket, {
      op: "identify",
      launchId: record.launchId,
      marker: record.wrapperStartMarker,
    });
    return response.ok === true && response.pid === record.wrapperPid;
  } catch {
    return false;
  }
}

async function finishDeadWrapper(record: LaunchRecord, deps: SessionHostDeps, result: ReconcileResult): Promise<void> {
  const env = depsEnv(deps);
  const core = deps.core;
  if (core !== undefined && record.coreSessionId !== undefined) {
    const agentCtx: SessionActorContext = deps.agentContext ?? {
      actor: { actorId: record.agentId, actorType: "agent" },
      agentSessionId: record.coreSessionId,
    };
    const sequence = (record.lastSequence ?? 0) + 1;
    try {
      await core.reportAgentSessionRuntime(agentCtx, {
        sessionId: record.coreSessionId,
        state: "failed",
        sequence,
        failureKind: "wrapper_lost",
      });
      record.lastSequence = sequence;
    } catch {
      record.reporting = "offline";
    }
    await core.endAgentSession(agentCtx, record.coreSessionId).catch(() => undefined);
  }
  finalizeRecord(record, deps, "failed", "wrapper_lost");
  result.deadWrappers.push(record.launchId);
}

export async function listSessions(
  workspaceId: string,
  deps: SessionHostDeps & { core: CoreClient; readerContext?: SessionActorContext },
  cursor?: string,
) {
  assertSessionHostEnabled(depsEnv(deps));
  const id = assertObjectId(workspaceId, "workspaceId");
  const reader = deps.readerContext ?? { actor: { actorId: "human", actorType: "human" as const } };
  return deps.core.listAgentSessions(reader, { workspaceId: id, ...(cursor === undefined ? {} : { cursor }) });
}

