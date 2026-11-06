/**
 * CLI surface for the local session host.
 *
 * The agent credential is resolved only while handling `run`. It is passed to
 * Core as an actor token and is never written to the registry, argv, or stdout.
 */
import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { loadAnyProfile, readOperatorAgentToken, readOperatorHumanToken } from "../bootstrap/profile.js";
import { ValidationError } from "../domain/errors.js";
import { createRuntimeFromPath } from "../runtime.js";
import { createHttpCoreClient, createServiceCoreClient } from "../session-host/core-client.js";
import { assertSessionHostEnabled } from "../session-host/flag.js";
import {
  listSessions,
  prepareSession,
  reconcileSessions,
  runSession,
  stopSession,
  type ReconcileResult,
} from "../session-host/host.js";
import type { AgentSessionListPage, CoreClient, SessionActorContext, SessionHostDeps } from "../session-host/types.js";
import type { ParsedArgs } from "./args.js";
import { formatSessionHostHelp } from "./session-host-catalog.js";

export function isSessionHostArgvCommand(command: string | undefined): command is "session" | "sessions" {
  return command === "session" || command === "sessions";
}

function flagString(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requireFlag(parsed: ParsedArgs, name: string): string {
  const value = flagString(parsed, name);
  if (value === undefined) {
    throw new ValidationError(`Missing required --${name}.`, { field: name });
  }
  return value;
}

function outputMode(parsed: ParsedArgs, allowed: readonly ("human" | "json")[]): "human" | "json" {
  const requested = flagString(parsed, "output");
  if (parsed.flags.json === true && requested === "human") {
    throw new ValidationError("Conflicting output modes: --output human with --json", { field: "output" });
  }
  const mode = requested ?? (parsed.flags.json === true ? "json" : process.stdout.isTTY === true ? "human" : "json");
  if (mode !== "human" && mode !== "json" && mode !== "auto") {
    throw new ValidationError(`Invalid --output mode: ${mode}; expected auto|human|json`, { field: "output" });
  }
  const resolved = mode === "auto" ? (process.stdout.isTTY === true ? "human" : "json") : mode;
  if (!allowed.includes(resolved)) {
    throw new ValidationError(`This session command does not support --output ${resolved}.`, { field: "output" });
  }
  return resolved;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value));
}

export function formatSessionList(workspaceId: string, page: AgentSessionListPage): string {
  const lines = [`Sessions in ${workspaceId}`];
  if (page.sessions.length === 0) {
    lines.push("No sessions.");
    return lines.join("\n");
  }
  for (const session of page.sessions) {
    lines.push(
      [session.id, session.state ?? "unknown", session.agentId, session.taskId ?? "-", session.harness].join("  "),
    );
  }
  return lines.join("\n");
}

function resolveCampfireExecutable(explicit: string | undefined): string {
  if (explicit !== undefined) {
    if (!isAbsolute(explicit)) {
      throw new ValidationError("Campfire executable must be absolute.", { field: "executable" });
    }
    return explicit;
  }
  const entry = process.argv[1];
  if (entry === undefined || entry.length === 0) return process.execPath;
  try {
    return realpathSync(entry);
  } catch {
    return isAbsolute(entry) ? entry : process.execPath;
  }
}

interface OpenedCore {
  client: CoreClient;
  agent: SessionActorContext;
  reader: SessionActorContext;
  close(): void;
}

export function openProfileCore(env: NodeJS.ProcessEnv = process.env): OpenedCore {
  const profile = loadAnyProfile(env);
  if (profile === undefined) {
    throw new ValidationError("No Campfire profile yet. Run campfire in a terminal.", { field: "profile" });
  }
  const agentToken = readOperatorAgentToken(env, "codex");
  if (agentToken === undefined) {
    throw new ValidationError("No Codex agent credential is stored for this profile. Connect the agent before campfire session run.", {
      field: "credentials",
      nextAction: "connect_agent",
    });
  }
  const humanToken = readOperatorHumanToken(env);
  const reader: SessionActorContext = { actor: { actorId: profile.humanId, actorType: "human" } };
  if (profile.mode === "remote" || (env.CAMPFIRE_URL?.trim().length ?? 0) > 0) {
    if (humanToken === undefined) {
      throw new ValidationError("No operator credential is stored for this profile.", { field: "credentials" });
    }
    return {
      client: createHttpCoreClient({
        baseUrl: env.CAMPFIRE_URL?.trim() || profile.url,
        agentToken,
        humanToken,
      }),
      agent: { actor: { actorId: profile.agents?.find((agent) => agent.harness === "codex")?.id ?? "agent", actorType: "agent" } },
      reader,
      close() {},
    };
  }
  const runtime = createRuntimeFromPath(profile.databasePath);
  try {
    const agent = runtime.service.resolveToken(agentToken);
    const readerActor = humanToken === undefined ? reader.actor : runtime.service.resolveToken(humanToken);
    const client = createServiceCoreClient(runtime.service, {
      agent: { actor: agent },
      reader: { actor: readerActor },
      secrets: humanToken === undefined ? [agentToken] : [agentToken, humanToken],
    });
    return {
      client,
      agent: { actor: agent },
      reader: { actor: readerActor },
      close: () => runtime.close(),
    };
  } catch (error) {
    runtime.close();
    throw error;
  }
}

async function withProfileCore<T>(
  env: NodeJS.ProcessEnv,
  deps: SessionHostDeps,
  run: (core: OpenedCore) => Promise<T>,
): Promise<T> {
  if (deps.core !== undefined) {
    return run({
      client: deps.core,
      agent: deps.agentContext ?? { actor: { actorId: "agent", actorType: "agent" } },
      reader: deps.readerContext ?? { actor: { actorId: "human", actorType: "human" } },
      close() {},
    });
  }
  const opened = openProfileCore(env);
  try {
    return await run(opened);
  } finally {
    opened.close();
  }
}

export async function runSessionHostFromParsed(parsed: ParsedArgs, deps: SessionHostDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  assertSessionHostEnabled(env);
  if (parsed.flags.help === true) {
    console.log(formatSessionHostHelp());
    return;
  }
  const shared: SessionHostDeps = {
    ...deps,
    env,
    campfireExecutable: resolveCampfireExecutable(deps.campfireExecutable),
  };
  if (parsed.command === "sessions") {
    const workspaceId = parsed.positionals[0];
    if (workspaceId === undefined || workspaceId.trim().length === 0) {
      throw new ValidationError("Missing required <workspace> argument.", { field: "workspaceId" });
    }
    const mode = outputMode(parsed, ["human", "json"]);
    const page = await withProfileCore(env, shared, (core) =>
      listSessions(workspaceId, { ...shared, core: core.client, readerContext: core.reader }, flagString(parsed, "cursor")),
    );
    if (mode === "json") printJson(page);
    else console.log(formatSessionList(workspaceId, page));
    return;
  }
  const subcommand = parsed.positionals[0];
  if (subcommand === "prepare") {
    const launch = requireFlag(parsed, "launch");
    if (launch !== "copy-launch-command") outputMode(parsed, ["json"]);
    const result = prepareSession(
      {
        workspaceId: requireFlag(parsed, "workspace"),
        taskId: requireFlag(parsed, "task"),
        agentId: requireFlag(parsed, "agent"),
        harness: requireFlag(parsed, "harness"),
        repository: requireFlag(parsed, "repository"),
        ...(flagString(parsed, "worktree") === undefined ? {} : { worktree: flagString(parsed, "worktree") }),
        launch,
      },
      shared,
    );
    if (result.copyCommand !== undefined) {
      console.log(result.copyCommand);
      return;
    }
    printJson(result.receipt);
    return;
  }
  if (subcommand === "run") {
    const launchId = parsed.positionals[1];
    if (launchId === undefined || launchId.trim().length === 0) {
      throw new ValidationError("Missing required <launch-id> argument.", { field: "launchId" });
    }
    const result = await withProfileCore(env, shared, (core) =>
      runSession(launchId, { ...shared, core: core.client, agentContext: core.agent }),
    );
    if (result.localState === "failed") {
      throw new ValidationError(`The Codex session failed (${result.failureKind ?? "failed"}).`, {
        field: "launchId",
        launchId: result.launchId,
        ...(result.failureKind === undefined ? {} : { failureKind: result.failureKind }),
      });
    }
    return;
  }
  if (subcommand === "stop") {
    outputMode(parsed, ["json"]);
    const launchId = parsed.positionals[1];
    if (launchId === undefined || launchId.trim().length === 0) {
      throw new ValidationError("Missing required <launch-id> argument.", { field: "launchId" });
    }
    const result = await stopSession(launchId, shared);
    if (!result.stopped) {
      throw new ValidationError(
        `Local session control was lost for ${result.launchId}. Run campfire session reconcile --output json. No process was killed.`,
        { field: "launchId", launchId: result.launchId, nextAction: "session_reconcile", control: "lost" },
      );
    }
    printJson(result);
    return;
  }
  if (subcommand === "reconcile") {
    outputMode(parsed, ["json"]);
    const result: ReconcileResult = await withProfileCore(env, shared, (core) =>
      reconcileSessions({ ...shared, core: core.client, agentContext: core.agent }),
    );
    printJson(result);
    return;
  }
  throw new ValidationError("Unknown session command. Use prepare, run, stop, or reconcile.", { field: "session" });
}
