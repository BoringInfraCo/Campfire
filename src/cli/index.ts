#!/usr/bin/env node
/**
 * Campfire developer CLI.
 *
 * A deliberately small, dependency-free wrapper around the application service
 * and the MCP stdio entrypoint. It exists so the local proof can be driven
 * without a harness (AGENTS.md "Observability").
 */
import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapOrganizationTeam } from "../bootstrap/bootstrap.js";
import { seedFixture } from "../bootstrap/seed.js";
import { loadConfig } from "../config.js";
import { CampfireError, ValidationError } from "../domain/errors.js";
import type {
  ActorRef,
  ArtifactType,
  Contribution,
  Decision,
  GoalStatus,
  ParticipantRole,
  Task,
  TaskStatus,
  WorkspaceStatus,
} from "../domain/types.js";
import { campfireHttpCall } from "../http/client.js";
import { dispatchCampfireMethod } from "../http/dispatch.js";
import { DEFAULT_HTTP_HOST, DEFAULT_HTTP_PORT, startCampfireHttpServer } from "../http/server.js";
import { DEFAULT_VIEWER_HOST, DEFAULT_VIEWER_PORT, DEFAULT_VIEWER_THEME, VIEWER_THEMES, startCampfireViewer } from "../viewer/server.js";
import {
  readCampfireToken,
  readCampfireUrl,
  resolveServerIdentity,
} from "../mcp/context.js";
import type { ServerIdentity } from "../mcp/context.js";
import { startStdioServer } from "../mcp/stdio.js";
import { createRuntime } from "../runtime.js";
import type {
  GetActivityInput,
  ParticipantView,
  WorkspaceContext,
  WorkspaceView,
} from "../service/service.js";
import type { CampfireStore } from "../store/store.js";

const DEFAULT_ACTOR_ID = "hum_sergio";
const DEFAULT_ACTOR_TYPE = "human";

const BOOLEAN_FLAGS = new Set(["reset", "help", "json", "full", "allow-remote"]);

const WORKSPACE_STATUSES = ["active", "completed", "archived"] as const;
const GOAL_STATUSES = ["active", "completed", "abandoned"] as const;
const TASK_STATUSES = ["open", "in_progress", "blocked", "completed"] as const;
const PARTICIPANT_ROLES = ["owner", "member", "agent", "viewer"] as const;
const ACTOR_TYPES = ["human", "agent"] as const;
const ARTIFACT_TYPES = ["file", "document", "log", "other"] as const;

const HEADER_LABEL_WIDTH = 9;

interface ParsedArgs {
  command?: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      if (BOOLEAN_FLAGS.has(body)) {
        flags[body] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[body] = next;
        i += 1;
      } else {
        flags[body] = true;
      }
    } else {
      positionals.push(token);
    }
  }

  const [command, ...rest] = positionals;
  return { command, positionals: rest, flags };
}

function applyDbFlag(flags: Record<string, string | boolean>): void {
  const db = flags.db;
  if (typeof db === "string" && db.trim().length > 0) {
    process.env.CAMPFIRE_DB = db;
  }
}

function ensureParentDir(databasePath: string): void {
  mkdirSync(dirname(databasePath), { recursive: true });
}

function removeDatabaseFiles(databasePath: string): void {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

function stripFlags(argv: string[], names: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;
    const matched = names.find((name) => token === `--${name}` || token.startsWith(`--${name}=`));
    if (matched === undefined) {
      result.push(token);
      continue;
    }
    if (token === `--${matched}`) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        i += 1;
      }
    }
  }
  return result;
}

/**
 * Build the acting identity for a CLI command. Flags override the environment.
 * When neither is supplied the documented default human (`hum_sergio`) is used.
 */
function resolveCliIdentity(argv: string[], options?: { ignoreActorFlags?: boolean }): ServerIdentity {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (env.CAMPFIRE_ACTOR_ID === undefined || env.CAMPFIRE_ACTOR_ID.trim().length === 0) {
    env.CAMPFIRE_ACTOR_ID = DEFAULT_ACTOR_ID;
  }
  if (env.CAMPFIRE_ACTOR_TYPE === undefined || env.CAMPFIRE_ACTOR_TYPE.trim().length === 0) {
    env.CAMPFIRE_ACTOR_TYPE = DEFAULT_ACTOR_TYPE;
  }
  const args = options?.ignoreActorFlags === true ? stripFlags(argv, ["actor", "type"]) : argv;
  return resolveServerIdentity(env, args);
}

interface CliBackend {
  identity: ServerIdentity;
  store?: CampfireStore;
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

async function withBackend<T>(
  argv: string[],
  fn: (backend: CliBackend) => T | Promise<T>,
  options?: { actorFlagIsTarget?: boolean },
): Promise<T> {
  const url = readCampfireUrl();
  const token = readCampfireToken(process.env, argv);

  if (url !== undefined) {
    if (token === undefined) {
      throw new ValidationError("Missing token: pass --token or set CAMPFIRE_TOKEN when CAMPFIRE_URL is set", {
        field: "token",
      });
    }
    const identity: ServerIdentity = {
      ctx: { actor: { actorId: DEFAULT_ACTOR_ID, actorType: DEFAULT_ACTOR_TYPE } },
    };
    const backend: CliBackend = {
      identity,
      call: (method, params) =>
        campfireHttpCall({ baseUrl: url, token, method, params: params ?? {} }),
    };
    return await fn(backend);
  }

  const identity = resolveCliIdentity(argv, { ignoreActorFlags: options?.actorFlagIsTarget === true });
  const config = loadConfig();
  ensureParentDir(config.databasePath);
  const runtime = createRuntime(config);
  try {
    let bound = identity;
    if (token !== undefined) {
      const actor = runtime.service.resolveToken(token);
      bound = { ctx: { actor, agentSessionId: identity.ctx.agentSessionId }, harness: identity.harness };
    }
    const backend: CliBackend = {
      identity: bound,
      store: runtime.store,
      call: (method, params) =>
        Promise.resolve(dispatchCampfireMethod(runtime.service, bound.ctx, method, params ?? {})),
    };
    return await fn(backend);
  } finally {
    runtime.close();
  }
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function requirePositional(parsed: ParsedArgs, field: string): string {
  const value = parsed.positionals[0];
  if (value === undefined || value.trim().length === 0) {
    throw new ValidationError(`Missing required <${field}> argument`, { field });
  }
  return value;
}

function requireFlag(flags: Record<string, string | boolean>, name: string): string {
  const value = flags[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`Missing required --${name} argument`, { field: name });
  }
  return value;
}

function optionalFlag(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value;
}

function optionalNumber(flags: Record<string, string | boolean>, name: string): number | undefined {
  const raw = flags[name];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "string") {
    throw new ValidationError(`--${name} requires a number`, { field: name });
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(`--${name} must be a number`, { field: name, value: raw });
  }
  return parsed;
}

/** Both assignee flags are required together; neither is enough on its own. */
function optionalAssignee(flags: Record<string, string | boolean>): ActorRef | undefined {
  const actorId = optionalFlag(flags, "assignee-id");
  const actorTypeRaw = optionalFlag(flags, "assignee-type");
  if (actorId === undefined && actorTypeRaw === undefined) {
    return undefined;
  }
  if (actorId === undefined || actorTypeRaw === undefined) {
    throw new ValidationError("--assignee-id and --assignee-type are required together", {
      field: "assignee-id",
    });
  }
  return { actorId, actorType: requireEnum(actorTypeRaw, ACTOR_TYPES, "assignee-type") };
}

function requireEnum<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new ValidationError(`Invalid ${field}: expected ${allowed.join("|")}`, { field, value });
}

function optionalPositiveInt(flags: Record<string, string | boolean>, name: string): number | undefined {
  const raw = flags[name];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "string") {
    throw new ValidationError(`--${name} requires a positive integer`, { field: name });
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ValidationError(`--${name} must be a positive integer`, { field: name, value: raw });
  }
  return parsed;
}

function joinFields(...parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => part !== undefined && part.length > 0).join("  ");
}

function labeled(label: string, ...values: string[]): string {
  return joinFields(label.padEnd(HEADER_LABEL_WIDTH), ...values);
}

function formatParticipant(participant: ParticipantView): string {
  return joinFields(
    participant.name,
    participant.role,
    participant.harness,
    participant.humanOwnerId === undefined ? undefined : `on behalf of ${participant.humanOwnerId}`,
  );
}

function formatContributionLine(contribution: Contribution): string {
  return joinFields(
    contribution.createdAt,
    contribution.actor.actorId,
    contribution.action,
    contribution.objectType,
    contribution.objectId,
  );
}

function formatDecision(decision: Decision): string {
  return joinFields(decision.id, decision.summary);
}

function formatTask(task: Task): string {
  return joinFields(task.id, `[${task.status}]`, task.title);
}

function section(title: string, lines: string[]): string[] {
  if (lines.length === 0) {
    return [];
  }
  return [title, ...lines.map((line) => `  ${line}`)];
}

function provenanceSection(
  title: string,
  contributions: Contribution[],
  total: number,
  truncated: boolean,
): string[] {
  if (contributions.length === 0) {
    return [];
  }
  const note = truncated
    ? `(showing ${contributions.length} of ${total}; truncated)`
    : `(showing ${contributions.length} of ${total})`;
  return section(`${title}  ${note}`, contributions.map(formatContributionLine));
}

function formatOrientation(context: WorkspaceContext): string {
  const { workspace, goal } = context;
  const lines: string[] = [
    labeled("Workspace", workspace.id, workspace.name, `[${workspace.status}]`),
  ];
  if (goal !== undefined) {
    lines.push(labeled("Goal", goal.title));
  }
  lines.push(
    ...section("Participants", context.participants.map(formatParticipant)),
    ...section("Proposed decisions", context.proposedDecisions.map(formatDecision)),
    ...section("Accepted decisions", context.acceptedDecisions.map(formatDecision)),
    ...section("Open tasks", context.openTasks.map(formatTask)),
    ...section(
      "Findings",
      context.findings.map((finding) => joinFields(finding.id, finding.summary)),
    ),
    ...section(
      "Artifacts",
      context.artifacts.map((artifact) =>
        joinFields(artifact.id, artifact.type, artifact.uriOrPath, artifact.title),
      ),
    ),
    ...provenanceSection(
      "Recent provenance",
      context.provenance,
      context.provenanceTotal,
      context.provenanceTruncated,
    ),
  );
  return lines.join("\n");
}

function formatFullView(view: WorkspaceView): string {
  const { workspace, goal } = view;
  const proposed = view.decisions.filter((decision) => decision.status === "proposed");
  const accepted = view.decisions.filter((decision) => decision.status === "accepted");
  const superseded = view.decisions.filter((decision) => decision.status === "superseded");
  const lines: string[] = [
    labeled("Workspace", workspace.id, workspace.name, `[${workspace.status}]`),
  ];
  if (goal !== undefined) {
    lines.push(labeled("Goal", goal.title, `[${goal.status}]`));
  }
  lines.push(
    ...section("Participants", view.participants.map(formatParticipant)),
    ...section("Proposed decisions", proposed.map(formatDecision)),
    ...section("Accepted decisions", accepted.map(formatDecision)),
    ...section(
      "Superseded decisions",
      superseded.map((decision) => joinFields(decision.id, decision.summary)),
    ),
    ...section("Tasks", view.tasks.map(formatTask)),
    ...section(
      "Findings",
      view.findings.map((finding) => joinFields(finding.id, finding.summary)),
    ),
    ...section(
      "Artifacts",
      view.artifacts.map((artifact) =>
        joinFields(artifact.id, artifact.type, artifact.uriOrPath, artifact.title),
      ),
    ),
    ...provenanceSection("Provenance", view.activity, view.activity.length, false),
  );
  return lines.join("\n");
}

async function cmdInit(): Promise<void> {
  const config = loadConfig();
  ensureParentDir(config.databasePath);
  const runtime = createRuntime(config);
  try {
    printJson({ databasePath: config.databasePath });
  } finally {
    runtime.close();
  }
}

async function cmdSeed(flags: Record<string, string | boolean>): Promise<void> {
  const config = loadConfig();
  if (flags.reset === true) {
    removeDatabaseFiles(config.databasePath);
  }
  ensureParentDir(config.databasePath);
  const runtime = createRuntime(config);
  try {
    const seeded = seedFixture(runtime.store);
    printJson(seeded);
  } finally {
    runtime.close();
  }
}

/**
 * Idempotent org/team setup for a blank database.
 *
 * Source layout note: TypeScript lives in `src/`, `npm run build` (`tsc`)
 * emits runnable JS into `dist/` (gitignored), and `bin.campfire` points at
 * the built `dist/src/cli/index.js`. Local dev keeps using `tsx src/...`.
 */
async function cmdBootstrap(flags: Record<string, string | boolean>): Promise<void> {
  const config = loadConfig();
  ensureParentDir(config.databasePath);
  const runtime = createRuntime(config);
  try {
    const organizationId = optionalFlag(flags, "org") ?? config.organization.id;
    const teamId = optionalFlag(flags, "team") ?? config.team.id;
    const organizationName = optionalFlag(flags, "org-name") ?? config.organization.name;
    const teamName = optionalFlag(flags, "team-name") ?? config.team.name;
    const humanName = optionalFlag(flags, "human-name");
    const now = new Date().toISOString();
    const result = bootstrapOrganizationTeam(runtime.store, {
      organizationId,
      organizationName,
      teamId,
      teamName,
      createdAt: now,
    });
    if (humanName === undefined) {
      printJson(result);
      return;
    }
    // Only the very first human can be bootstrapped without an acting token.
    // Afterwards use `create-human` with an authorized human identity.
    if (runtime.store.countHumans() !== 0) {
      throw new ValidationError("bootstrap --human-name only applies when no humans exist; use create-human", {
        field: "human-name",
      });
    }
    const created = runtime.service.createHuman(undefined, { teamId, displayName: humanName });
    printJson({ ...result, human: created.human, token: created.token });
  } finally {
    runtime.close();
  }
}

async function cmdWhoami(argv: string[]): Promise<void> {
  await withBackend(argv, async (backend) => {
    if (readCampfireUrl() === undefined) {
      await backend.call("list_workspaces", {});
      printJson({
        actor: backend.identity.ctx.actor,
        sessionId: backend.identity.ctx.agentSessionId,
        harness: backend.identity.harness,
      });
      return;
    }
    printJson(await backend.call("whoami", {}));
  });
}

async function cmdList(argv: string[]): Promise<void> {
  await withBackend(argv, async (backend) => {
    printJson(await backend.call("list_workspaces", {}));
  });
}

async function cmdShow(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const workspaceId = requirePositional(parsed, "workspaceId");
  const asJson = parsed.flags.json === true;
  const full = parsed.flags.full === true;
  await withBackend(argv, async (backend) => {
    if (full) {
      const view = (await backend.call("get_workspace", { workspaceId })) as WorkspaceView;
      if (asJson) {
        printJson(view);
        return;
      }
      console.log(formatFullView(view));
      return;
    }
    const context = (await backend.call("get_workspace_context", { workspaceId })) as WorkspaceContext;
    if (asJson) {
      printJson(context);
      return;
    }
    console.log(formatOrientation(context));
  });
}

async function cmdActivity(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const workspaceId = requirePositional(parsed, "workspaceId");
  const limit = optionalPositiveInt(parsed.flags, "limit");
  const before = optionalFlag(parsed.flags, "before");
  await withBackend(argv, async (backend) => {
    const query: GetActivityInput = { workspaceId };
    if (limit !== undefined) {
      query.limit = limit;
    }
    if (before !== undefined) {
      query.before = before;
    }
    const page = (await backend.call("get_activity", query as unknown as Record<string, unknown>)) as {
      items: Contribution[];
      total: number;
      truncated: boolean;
      nextBefore?: string;
    };
    for (const item of page.items) {
      console.log(formatContributionLine(item));
    }
    if (page.truncated) {
      const parts = [`truncated total=${page.total}`];
      if (page.nextBefore !== undefined) {
        parts.push(`nextBefore=${page.nextBefore}`);
      }
      console.error(parts.join(" "));
    }
  });
}

async function cmdCreateWorkspace(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const teamId = requireFlag(parsed.flags, "team");
  const name = requireFlag(parsed.flags, "name");
  const description = optionalFlag(parsed.flags, "description");
  await withBackend(argv, async (backend) => {
    printJson(await backend.call("create_workspace", { teamId, name, description }));
  });
}

async function cmdUpdateWorkspace(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const workspaceId = requirePositional(parsed, "workspaceId");
  const status = requireEnum(requireFlag(parsed.flags, "status"), WORKSPACE_STATUSES, "status");
  await withBackend(argv, async (backend) => {
    printJson(await backend.call("update_workspace", { workspaceId, status }));
  });
}

async function cmdCreateGoal(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const workspaceId = requireFlag(parsed.flags, "workspace");
  const title = requireFlag(parsed.flags, "title");
  const description = optionalFlag(parsed.flags, "description");
  await withBackend(argv, async (backend) => {
    printJson(await backend.call("create_goal", { workspaceId, title, description }));
  });
}

async function cmdUpdateGoal(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const goalId = requirePositional(parsed, "goalId");
  const title = optionalFlag(parsed.flags, "title");
  const description = optionalFlag(parsed.flags, "description");
  const statusRaw = optionalFlag(parsed.flags, "status");
  const status =
    statusRaw === undefined ? undefined : requireEnum(statusRaw, GOAL_STATUSES, "status");
  if (title === undefined && description === undefined && status === undefined) {
    throw new ValidationError("update-goal requires --title, --description, or --status", {
      field: "update-goal",
    });
  }
  await withBackend(argv, async (backend) => {
    printJson(await backend.call("update_goal", { goalId, title, description, status }));
  });
}

async function cmdAddFinding(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const workspaceId = requireFlag(parsed.flags, "workspace");
  const summary = requireFlag(parsed.flags, "summary");
  const detail = optionalFlag(parsed.flags, "detail");
  const confidence = optionalNumber(parsed.flags, "confidence");
  await withBackend(argv, async (backend) => {
    printJson(await backend.call("add_finding", { workspaceId, summary, detail, confidence }));
  });
}

async function cmdAddDecision(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const workspaceId = requireFlag(parsed.flags, "workspace");
  const summary = requireFlag(parsed.flags, "summary");
  const rationale = optionalFlag(parsed.flags, "rationale");
  await withBackend(argv, async (backend) => {
    printJson(await backend.call("add_decision", { workspaceId, summary, rationale }));
  });
}

async function cmdAcceptDecision(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const decisionId = requirePositional(parsed, "decisionId");
  await withBackend(argv, async (backend) => {
    printJson(await backend.call("accept_decision", { decisionId }));
  });
}

async function cmdCreateTask(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const workspaceId = requireFlag(parsed.flags, "workspace");
  const title = requireFlag(parsed.flags, "title");
  const description = optionalFlag(parsed.flags, "description");
  const assignee = optionalAssignee(parsed.flags);
  await withBackend(argv, async (backend) => {
    printJson(await backend.call("create_task", { workspaceId, title, description, assignee }));
  });
}

async function cmdUpdateTask(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const taskId = requirePositional(parsed, "taskId");
  const status = requireEnum(requireFlag(parsed.flags, "status"), TASK_STATUSES, "status");
  const title = optionalFlag(parsed.flags, "title");
  const description = optionalFlag(parsed.flags, "description");
  const assignee = optionalAssignee(parsed.flags);
  await withBackend(argv, async (backend) => {
    printJson(await backend.call("update_task", { taskId, status, title, description, assignee }));
  });
}

async function cmdJoin(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const workspaceId = requirePositional(parsed, "workspaceId");
  await withBackend(argv, async (backend) => {
    printJson(await backend.call("join_workspace", { workspaceId }));
  });
}

async function cmdAddArtifact(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const workspaceId = requireFlag(parsed.flags, "workspace");
  const type = requireEnum(requireFlag(parsed.flags, "type"), ARTIFACT_TYPES, "type") as ArtifactType;
  const title = requireFlag(parsed.flags, "title");
  const uriOrPath = requireFlag(parsed.flags, "uri");
  await withBackend(argv, async (backend) => {
    printJson(await backend.call("add_artifact", { workspaceId, type, title, uriOrPath }));
  });
}

async function cmdServe(parsed: ParsedArgs): Promise<void> {
  const host = optionalFlag(parsed.flags, "host") ?? DEFAULT_HTTP_HOST;
  const portRaw = optionalFlag(parsed.flags, "port");
  const port = portRaw === undefined ? DEFAULT_HTTP_PORT : Number(portRaw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ValidationError("--port must be an integer between 0 and 65535", { field: "port" });
  }
  const config = loadConfig();
  ensureParentDir(config.databasePath);
  const runtime = createRuntime(config);
  const running = await startCampfireHttpServer({ runtime, host, port });
  console.error(`[campfire] HTTP server listening on ${running.url}`);
  await new Promise<void>((resolve) => {
    const shutdown = (signal: NodeJS.Signals): void => {
      console.error(`[campfire] received ${signal}, shutting down`);
      void running.close().finally(() => {
        runtime.close();
        resolve();
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

async function cmdView(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const host = optionalFlag(parsed.flags, "host") ?? DEFAULT_VIEWER_HOST;
  const allowRemote = parsed.flags["allow-remote"] === true;
  const portRaw = optionalFlag(parsed.flags, "port");
  const port = portRaw === undefined ? DEFAULT_VIEWER_PORT : Number(portRaw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ValidationError("--port must be an integer between 0 and 65535", { field: "port" });
  }
  const theme = requireEnum(optionalFlag(parsed.flags, "theme") ?? DEFAULT_VIEWER_THEME, VIEWER_THEMES, "theme");
  await withBackend(argv, async (backend) => {
    const running = await startCampfireViewer({ call: backend.call, host, port, allowRemote, theme });
    console.error(`[campfire] viewer listening on ${running.url}`);
    await new Promise<void>((resolve) => {
      const shutdown = (signal: NodeJS.Signals): void => {
        console.error(`[campfire] received ${signal}, shutting down`);
        void running.close().finally(() => resolve());
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    });
  });
}

async function cmdCreateHuman(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const name = requireFlag(parsed.flags, "name");
  const teamId = requireFlag(parsed.flags, "team");
  await withBackend(argv, async (backend) => {
    printJson(await backend.call("create_human", { name, displayName: name, teamId }));
  });
}

async function cmdCreateAgent(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const name = requireFlag(parsed.flags, "name");
  const humanId = requireFlag(parsed.flags, "human");
  const harness = requireFlag(parsed.flags, "harness");
  const teamFlag = optionalFlag(parsed.flags, "team");
  await withBackend(argv, async (backend) => {
    const teamId = teamFlag ?? backend.store?.getHuman(humanId)?.teamId;
    if (teamId === undefined || teamId.length === 0) {
      throw new ValidationError("Missing required --team argument", { field: "team" });
    }
    printJson(await backend.call("create_agent", { name, humanId, harness, teamId }));
  });
}

async function cmdIssueToken(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const actorId = requireFlag(parsed.flags, "actor");
  const actorType = requireEnum(requireFlag(parsed.flags, "type"), ACTOR_TYPES, "type");
  await withBackend(
    argv,
    async (backend) => {
      printJson(await backend.call("issue_token", { actorId, actorType }));
    },
    { actorFlagIsTarget: true },
  );
}

async function cmdRevokeToken(parsed: ParsedArgs, argv: string[]): Promise<void> {
  // The target token is positional (or --revoke-token) so --token keeps
  // meaning the caller's auth token.
  const positional = parsed.positionals[0];
  const flagged = optionalFlag(parsed.flags, "revoke-token") ?? optionalFlag(parsed.flags, "revokeToken");
  const target = positional ?? flagged;
  if (target === undefined || target.trim().length === 0) {
    throw new ValidationError("revoke-token requires <token> or --revoke-token <token>", {
      field: "token",
    });
  }
  await withBackend(argv, async (backend) => {
    printJson(await backend.call("revoke_token", { token: target }));
  });
}

async function cmdInvite(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const workspaceId = requirePositional(parsed, "workspaceId");
  const actorId = requireFlag(parsed.flags, "actor");
  const actorType = requireEnum(requireFlag(parsed.flags, "type"), ACTOR_TYPES, "type");
  const role = requireEnum(requireFlag(parsed.flags, "role"), PARTICIPANT_ROLES, "role") as ParticipantRole;
  await withBackend(
    argv,
    async (backend) => {
      printJson(await backend.call("invite_workspace", { workspaceId, actorId, actorType, role }));
    },
    { actorFlagIsTarget: true },
  );
}

async function cmdMcp(argv: string[]): Promise<void> {
  const url = readCampfireUrl();
  if (url !== undefined) {
    await startStdioServer(undefined, process.env, argv);
    return;
  }
  await startStdioServer(resolveCliIdentity(argv), process.env, argv);
}

function printUsage(): void {
  const usage = [
    "Campfire developer CLI",
    "",
    "Usage:",
    "  campfire init",
    "  campfire bootstrap [--org <orgId>] [--team <teamId>] [--org-name <name>] [--team-name <name>] [--human-name <name>]",
    "  campfire seed [--reset]",
    "  campfire serve [--host 127.0.0.1] [--port 9414]",
    "  campfire view [--host 127.0.0.1] [--port 9415] [--allow-remote] [--theme campfire|fx]",
    "  campfire mcp [--actor <id>] [--type human|agent] [--session <id>] [--harness <name>] [--db <path>] [--token <token>]",
    "  campfire whoami [--actor <id>] [--type human|agent] [--db <path>] [--token <token>]",
    "  campfire list [--actor <id>] [--type human|agent] [--db <path>] [--token <token>]",
    "  campfire show <workspaceId> [--json] [--full]",
    "  campfire activity <workspaceId> [--limit N] [--before <contributionId>]",
    "  campfire create-workspace --team <teamId> --name <name> [--description <text>]",
    "  campfire update-workspace <workspaceId> --status active|completed|archived",
    "  campfire create-goal --workspace <workspaceId> --title <title> [--description <text>]",
    "  campfire update-goal <goalId> [--title <title>] [--description <text>] [--status active|completed|abandoned]",
    "  campfire add-finding --workspace <workspaceId> --summary <text> [--detail <text>] [--confidence <n>]",
    "  campfire add-decision --workspace <workspaceId> --summary <text> [--rationale <text>]",
    "  campfire accept-decision <decisionId>",
    "  campfire create-task --workspace <workspaceId> --title <title> [--description <text>] [--assignee-id <id> --assignee-type human|agent]",
    "  campfire update-task <taskId> --status open|in_progress|blocked|completed [--title <title>] [--description <text>] [--assignee-id <id> --assignee-type human|agent]",
    "  campfire add-artifact --workspace <workspaceId> --type file|document|log|other --title <title> --uri <path>",
    "  campfire create-human --name <display> --team <teamId>",
    "  campfire create-agent --name <name> --human <humanId> --harness <name> [--team <teamId>]",
    "  campfire issue-token --actor <id> --type human|agent",
    "  campfire revoke-token <token> [--revoke-token <token>]",
    "  campfire invite <workspaceId> --actor <id> --type human|agent --role owner|member|agent|viewer",
    "  campfire join <workspaceId>",
    "",
    "Global options:",
    "  --db <path>        Override CAMPFIRE_DB for this process.",
    "  --token <token>    Actor token (or CAMPFIRE_TOKEN). Preferred over --actor.",
    "  --actor <id>       Actor identity for local use (default: hum_sergio).",
    "  --type <t>         Actor type, human|agent (default: human).",
    "  --session <id>     Agent session id.",
    "  --harness <name>   Harness name for MCP / session registration.",
    "",
    "When CAMPFIRE_URL is set, commands POST /v1/call with CAMPFIRE_TOKEN / --token",
    "instead of opening the local SQLite file. serve/init/seed always use the local DB.",
    "",
    "show prints the orientation projection as readable text.",
    "view binds loopback only (127.0.0.1, ::1, localhost); non-loopback --host",
    "requires --allow-remote. The browser never receives a token.",
    "--json dumps the projection; --full uses the inspector (get_workspace).",
    "",
    "SEED NOTE: --reset deletes the database file and its -wal/-shm sidecars before seeding.",
  ];
  console.log(usage.join("\n"));
}

export async function runCli(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  applyDbFlag(parsed.flags);

  if (parsed.flags.help === true || parsed.command === undefined || parsed.command === "help") {
    printUsage();
    return;
  }

  switch (parsed.command) {
    case "init":
      return cmdInit();
    case "bootstrap":
      return cmdBootstrap(parsed.flags);
    case "seed":
      return cmdSeed(parsed.flags);
    case "serve":
      return cmdServe(parsed);
    case "view":
      return cmdView(parsed, argv);
    case "mcp":
      return cmdMcp(argv);
    case "whoami":
      return cmdWhoami(argv);
    case "list":
      return cmdList(argv);
    case "show":
      return cmdShow(parsed, argv);
    case "activity":
      return cmdActivity(parsed, argv);
    case "create-workspace":
      return cmdCreateWorkspace(parsed, argv);
    case "update-workspace":
      return cmdUpdateWorkspace(parsed, argv);
    case "create-goal":
      return cmdCreateGoal(parsed, argv);
    case "update-goal":
      return cmdUpdateGoal(parsed, argv);
    case "add-finding":
      return cmdAddFinding(parsed, argv);
    case "add-decision":
      return cmdAddDecision(parsed, argv);
    case "accept-decision":
      return cmdAcceptDecision(parsed, argv);
    case "create-task":
      return cmdCreateTask(parsed, argv);
    case "update-task":
      return cmdUpdateTask(parsed, argv);
    case "add-artifact":
      return cmdAddArtifact(parsed, argv);
    case "create-human":
      return cmdCreateHuman(parsed, argv);
    case "create-agent":
      return cmdCreateAgent(parsed, argv);
    case "issue-token":
      return cmdIssueToken(parsed, argv);
    case "revoke-token":
      return cmdRevokeToken(parsed, argv);
    case "invite":
      return cmdInvite(parsed, argv);
    case "join":
      return cmdJoin(parsed, argv);
    default:
      throw new ValidationError(`Unknown command: ${parsed.command}`, { command: parsed.command });
  }
}

async function run(): Promise<void> {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CampfireError) {
      console.error(`[${error.code}] ${error.message}`);
    } else if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    // Compare real paths: the installed entrypoint may be reached through a
    // symlink or a path containing ".." (argv[1] is verbatim), while
    // import.meta.url is normalized. String comparison alone silently no-ops.
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  void run();
}
