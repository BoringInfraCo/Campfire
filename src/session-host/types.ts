/**
 * SES-001 local session host types.
 *
 * The private registry may store a reviewed repository path. Receipts, child
 * argv, and control messages must not carry credentials, prompts, transcripts,
 * or the raw child environment.
 */

export const CODEX_CLI_VERSION = "0.164.0";
export const CLAUDE_CODE_VERSION = "2.1.260";
export const OPENCODE_CLI_VERSION = "2.2.5";
export const HEARTBEAT_MS = 15_000;
export const UNLAUNCHED_TTL_MS = 60 * 60 * 1000;
export const FINAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const STOP_GRACE_MS = 2_000;

export const SESSION_HOST_DISABLED_MESSAGE =
  "Team agent sessions are off. Set CAMPFIRE_SESSION_HOST=1 to prepare a local agent session.";

export const UNKNOWN_SESSION_HARNESS_MESSAGE =
  "Unknown session harness. Use codex, claude-code, or opencode.";

export const EMBEDDED_UNAVAILABLE_MESSAGE =
  "Embedded terminal launch is off. Set CAMPFIRE_EMBEDDED_TERMINAL=1 or use --launch external.";

export const RUNTIME_REPORT_MISSING_MESSAGE =
  "Campfire Core has no reportAgentSessionRuntime method. The session host cannot publish runtime state until that method exists.";

export type SupportedHarness = "codex" | "claude-code" | "opencode";
export type LaunchMode = "external" | "copy" | "embedded";
export type RuntimeState = "starting" | "running" | "stopping" | "exited" | "failed";
export type FailureKind =
  | "spawn_failed"
  | "signal"
  | "nonzero_exit"
  | "wrapper_lost"
  | "missing_executable"
  | "control_unavailable";

export type LocalLaunchState =
  | "prepared"
  | RuntimeState
  | "control_lost";

export interface Clock {
  now(): number;
  /** Resolves after `ms` of this clock's time. Tests may hold the promise. */
  wait(ms: number): Promise<void>;
}

export interface SessionActorContext {
  actor: { actorId: string; actorType: "agent" | "human" };
  agentSessionId?: string;
}

export interface RegisterAgentSessionInput {
  agentId: string;
  workspaceId: string;
  harness: string;
  taskId: string;
}

export interface RegisteredAgentSession {
  id: string;
  agentId: string;
  humanId?: string;
  workspaceId: string;
  taskId?: string;
  harness: string;
  startedAt: string;
  endedAt?: string;
}

export interface RuntimeReportInput {
  sessionId: string;
  state: RuntimeState;
  sequence: number;
  exitCode?: number;
  failureKind?: FailureKind;
}

export interface RuntimeReport {
  sessionId: string;
  state: RuntimeState;
  sequence: number;
  reportedAt: string;
  expiresAt?: string;
  exitCode?: number;
  failureKind?: FailureKind;
}

export interface AgentSessionListInput {
  workspaceId: string;
  cursor?: string;
}

export interface ListedAgentSession {
  id: string;
  workspaceId: string;
  taskId?: string;
  agentId: string;
  harness: string;
  humanId?: string;
  startedAt?: string;
  endedAt?: string;
  state?: string;
  reportedAt?: string;
  expiresAt?: string;
  exitCode?: number;
}

export interface AgentSessionListPage {
  sessions: ListedAgentSession[];
  nextCursor?: string;
  serverTime: string;
}

/**
 * Private launch record (SES-001 §7.2). Serialized through an allowlist.
 * `wrapperStartMarker` is a local supervisor identity, not a Campfire credential.
 */
export interface LaunchRecord {
  version: 1;
  launchId: string;
  workspaceId: string;
  taskId: string;
  agentId: string;
  humanId: string;
  harness: SupportedHarness;
  repositoryRoot: string;
  worktreePath?: string;
  launchMode: LaunchMode;
  createdAt: string;
  expiresAt: string;
  wrapperPid?: number;
  wrapperStartMarker?: string;
  privateControlSocket?: string;
  coreSessionId?: string;
  localState: LocalLaunchState;
  exitCode?: number;
  failureKind?: FailureKind;
  finalizedAt?: string;
  lastSequence?: number;
  /** Set when a heartbeat could not reach Core. Never an error body. */
  reporting?: "ok" | "offline";
}

export interface PrepareReceipt {
  launchId: string;
  workspaceId: string;
  taskId: string;
  agentId: string;
  harness: SupportedHarness;
  repositoryDisplayName: string;
  localLaunchState: LocalLaunchState;
  expiresAt: string;
  launchMode: LaunchMode;
}

export interface SpawnRequest {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell: false;
  stdio: "inherit" | "pipe" | "ignore";
}

export interface ManagedChild {
  readonly pid?: number;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "spawn", listener: () => void): this;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  off(event: "error", listener: (error: Error) => void): this;
  off(event: "spawn", listener: () => void): this;
}

export interface SpawnSyncResult {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
}

export interface SessionHostDeps {
  env?: NodeJS.ProcessEnv;
  clock?: Clock;
  core?: CoreClient;
  spawn?: (request: SpawnRequest) => ManagedChild;
  spawnSync?: (command: string, args: readonly string[], options: { shell: false; cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number }) => SpawnSyncResult;
  openExternal?: (launcherPath: string) => void;
  codexExecutable?: string;
  claudeExecutable?: string;
  opencodeExecutable?: string;
  campfireExecutable?: string;
  /** When set, version inspection does not execute the binary. */
  readVersion?: (executable: string) => string;
  pidAlive?: (pid: number) => boolean;
  graceMs?: number;
  socketDir?: string;
  heartbeatMs?: number;
  stdio?: "inherit" | "pipe" | "ignore";
  resolveAgentCredential?: (env: NodeJS.ProcessEnv, harness: string) => string;
  agentContext?: SessionActorContext;
  readerContext?: SessionActorContext;
}

/**
 * Narrow Core surface. The parallel Core agent owns the service implementation.
 * `reportAgentSessionRuntime` must exist; the adapter refuses to run without it.
 */
export interface CoreClient {
  registerAgentSession(agentCtx: SessionActorContext, input: RegisterAgentSessionInput): Promise<RegisteredAgentSession>;
  reportAgentSessionRuntime(agentCtx: SessionActorContext, input: RuntimeReportInput): Promise<RuntimeReport>;
  endAgentSession(agentCtx: SessionActorContext, sessionId: string): Promise<void>;
  listAgentSessions(readerCtx: SessionActorContext, input: AgentSessionListInput): Promise<AgentSessionListPage>;
}
