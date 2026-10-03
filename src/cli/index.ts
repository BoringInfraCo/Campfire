#!/usr/bin/env node
import { joinFromInvitation, saveInvitationFile } from "../bootstrap/enrollment-client.js";
import type { EnrollmentHarness, IssuedEnrollmentInvitation } from "../domain/enrollment.js";
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
import {
  defaultHarnessConfigPath,
  assertConnectionCompatible,
  detectInstalledHarnesses,
  prepareConnection,
} from "../bootstrap/connect.js";
import { beginHuman, connectInstalledHarnesses } from "../bootstrap/listen.js";
import { startLocalWorkspace, openLoopbackUrl, shouldOpenBrowser } from "../bootstrap/local-workspace.js";
import {
  formatStatus,
  loadCredentials,
  loadProfile,
  loadAnyProfile,
  persistHumanProfile,
  persistOnboardProfile,
  readOperatorAgentToken,
  readOperatorHumanToken,
  rememberAgentCredential,
  rememberProfileAgents,
} from "../bootstrap/profile.js";
import { canonicalEndpoint, loadRemoteProfile, resolveRemoteAccess, recipientHandoffNames } from "../bootstrap/remote-profile.js";
import { enrollRemoteAgent } from "../bootstrap/enrollment-client.js";
import { defaultHumanName, promptHumanName } from "./first-run.js";
import {
  CLI_COMMAND_NAMES,
  commandSpec,
  commandSpecForArgs,
  formatCommandUsage,
  formatUsage,
  isKnownCommand,
  type CliCommand,
} from "./catalog.js";
import { parseArgs, type ParsedArgs } from "./args.js";
import { resolveErrorOutput, resolveExplicitOutput, resolveOutputMode, type ResolvedOutput } from "./output.js";
import {
  buildAwaitingWorkspace,
  buildCommandManifest,
  buildTelemetryStatus,
  buildWorkspaceAgents,
  buildWorkspaceChanges,
  buildWorkspaceDecisions,
  buildWorkspaceInspect,
  buildWorkspaceStatus,
  formatAttentionItem,
  formatCommandManifest,
  formatContributionDeltaLine,
  formatContributionLine,
  formatParticipant,
  formatTelemetryStatus,
  formatWorkspaceAgents,
  formatWorkspaceChanges,
  formatWorkspaceDecisions,
  formatWorkspaceInspect,
  formatWorkspaceStatus,
  INSPECT_KINDS,
  type InspectKind,
  type TelemetryEndpoint,
} from "./projections.js";
import { commandForNextAction, formatCliFailure, SEED_RESET_WARNING } from "./recovery.js";
import { isInteractiveTty, wordmark } from "./ui.js";
import { diagnoseHosted, diagnoseLocal } from "../bootstrap/doctor.js";
import type { DoctorReport } from "../bootstrap/doctor.js";
import { buildHandoff, formatHandoff } from "../bootstrap/handoff.js";
import { formatOnboardReceipt, onboardInstallation, type OnboardReceipt } from "../bootstrap/onboard.js";
import { setupContract } from "../bootstrap/setup-contract.js";
import { seedFixture } from "../bootstrap/seed.js";
import { loadConfig } from "../config.js";
import { MAX_PAGE_SIZE } from "../domain/context-policy.js";
import { CampfireError, ValidationError } from "../domain/errors.js";
import {
  ActorNotFound,
  ArtifactNotFound,
  DecisionNotFound,
  FindingNotFound,
  GoalNotFound,
  TaskNotFound,
  WorkspaceNotFound,
} from "../domain/errors.js";
import { installedCampfireVersion } from "../bootstrap/version.js";
import type {
  ActorRef,
  Artifact,
  ArtifactType,
  Contribution,
  Decision,
  Finding,
  GoalStatus,
  ParticipantRole,
  Task,
  TaskStatus,
  WorkspaceStatus,
} from "../domain/types.js";
import { campfireHttpBridgeReport, campfireHttpCall, hostedPreflightError } from "../http/client.js";
import {
  DEFAULT_TELEMETRY_ENDPOINT,
  TELEMETRY_ENDPOINT_ENV_VAR,
  reportActivated,
  reportActive,
  telemetryInBackground,
} from "../telemetry/report.js";
import { loadTelemetryState, resolveTelemetryPreference, setTelemetryEnabled } from "../telemetry/state.js";
import { dispatchCampfireMethod } from "../http/dispatch.js";
import { DEFAULT_HTTP_HOST, DEFAULT_HTTP_PORT, startCampfireHttpServer } from "../http/server.js";
import { DEFAULT_VIEWER_HOST, DEFAULT_VIEWER_PORT, DEFAULT_VIEWER_THEME, VIEWER_THEMES, startCampfireViewer } from "../viewer/server.js";
import {
  readCampfireToken,
  readCampfireSessionId,
  readCampfireUrl,
  readHarness,
  resolveServerIdentity,
} from "../mcp/context.js";
import type { ServerIdentity } from "../mcp/context.js";
import { startStdioServer } from "../mcp/stdio.js";
import { readBridgeOperatorToken, readWebhookBridgeConfig } from "../bridge/config.js";
import { collectBridgeReport, formatBridgeReport, type BridgeReport } from "../bridge/report.js";
import { createRuntime } from "../runtime.js";
import { openReadonlySqliteStore } from "../store/sqlite-store.js";
import type {
  GetActivityInput,
  SuggestedNextAction,
  WorkspaceCatchUp,
  WorkspaceContext,
  WorkspaceObjectPage,
  WorkspaceView,
  ReadinessStatus,
  WorkspaceSummary,
} from "../service/service.js";
import type { CampfireStore } from "../store/store.js";

const DEFAULT_ACTOR_ID = "hum_sergio";
const DEFAULT_ACTOR_TYPE = "human";

const WORKSPACE_STATUSES = ["active", "completed", "archived"] as const;
const GOAL_STATUSES = ["active", "completed", "abandoned"] as const;
const TASK_STATUSES = ["open", "in_progress", "blocked", "completed"] as const;
const PARTICIPANT_ROLES = ["owner", "member", "agent", "viewer"] as const;
const ACTOR_TYPES = ["human", "agent"] as const;
const ARTIFACT_TYPES = ["file", "document", "log", "other"] as const;

const HEADER_LABEL_WIDTH = 9;

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
 *
 * `stripFlags` removes flags whose names collide with the command's own
 * arguments (e.g. add-artifact's `--type` is the artifact type, not the
 * acting actor type) so identity resolution never misreads them.
 */
function resolveCliIdentity(argv: string[], options?: { stripFlags?: string[] }): ServerIdentity {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (env.CAMPFIRE_ACTOR_ID === undefined || env.CAMPFIRE_ACTOR_ID.trim().length === 0) {
    env.CAMPFIRE_ACTOR_ID = DEFAULT_ACTOR_ID;
  }
  if (env.CAMPFIRE_ACTOR_TYPE === undefined || env.CAMPFIRE_ACTOR_TYPE.trim().length === 0) {
    env.CAMPFIRE_ACTOR_TYPE = DEFAULT_ACTOR_TYPE;
  }
  const args = options?.stripFlags === undefined ? argv : stripFlags(argv, options.stripFlags);
  return resolveServerIdentity(env, args);
}

interface CliBackend {
  identity: ServerIdentity;
  store?: CampfireStore;
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/**
 * The single CLI call funnel, with the TEL-001E lifecycle boundary attached.
 *
 * A successful `get_workspace_context` is the section 9 "first successful
 * authenticated workspace-context operation". Every withBackend-based read
 * command funnels through here, so one hook observes activation and repeated
 * use without instrumenting commands individually (TEL-001 section 4 forbids
 * per-command instrumentation). `--help`, `--version`, `capabilities`, `setup`,
 * `seed`, `bootstrap`, and `telemetry` never reach this funnel, so trivial and
 * telemetry commands cannot activate an installation.
 *
 * The Viewer is deliberately not instrumented: `src/viewer/server.ts` and
 * `src/bootstrap/local-workspace.ts` receive their own `call` and are left
 * untouched. `campfire view` does hand this wrapper to the Viewer, and that is
 * safe rather than accidental: `claimActivation` answers once per installation
 * and `claimActiveEvent` once per UTC day, so a Viewer polling every two
 * seconds still produces one event and then local reads only.
 *
 * Both reports are fire-and-forget, and the awaited result is returned
 * unchanged, so measurement cannot delay, fail, or alter the command.
 */
function measuredCall(
  call: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): CliBackend["call"] {
  return async (method, params) => {
    const result = await call(method, params);
    if (method === "get_workspace_context") {
      telemetryInBackground(reportActivated("cli", { env: process.env }));
      telemetryInBackground(reportActive("cli", { env: process.env }));
    }
    return result;
  };
}

async function withBackend<T>(
  argv: string[],
  fn: (backend: CliBackend) => T | Promise<T>,
  options?: {
    /**
     * Flag names that must not be read as acting-identity flags because the
     * command reuses them for its own arguments (target actor, artifact type).
     */
    stripIdentityFlags?: string[];
  },
): Promise<T> {
  const parsed = parseArgs(argv);
  const remoteProfile = loadRemoteProfile();
  const access = remoteProfile === undefined ? undefined : resolveRemoteAccess({url:optionalFlag(parsed.flags,"url"),token:readCampfireToken(process.env,argv)});
  const url = access?.url ?? readCampfireUrl();
  const token = access?.token ?? readCampfireToken(process.env, argv) ?? readOperatorHumanToken();

  if (url !== undefined) {
    if (token === undefined) {
      throw new ValidationError("Missing token: pass --token or set CAMPFIRE_TOKEN when CAMPFIRE_URL is set", {
        field: "token",
      });
    }
    const identity: ServerIdentity = {
      ctx: { actor: { actorId: access?.profile.humanId ?? DEFAULT_ACTOR_ID, actorType: "human" } },
    };
    const backend: CliBackend = {
      identity,
      call: measuredCall((method, params) =>
        campfireHttpCall({ baseUrl: url, token, method, params: params ?? {} }),
      ),
    };
    return await fn(backend);
  }

  const identity = resolveCliIdentity(
    argv,
    options?.stripIdentityFlags === undefined ? undefined : { stripFlags: options.stripIdentityFlags },
  );
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
      call: measuredCall((method, params) =>
        Promise.resolve(dispatchCampfireMethod(runtime.service, bound.ctx, method, params ?? {})),
      ),
    };
    return await fn(backend);
  } finally {
    runtime.close();
  }
}

/** Compact JSON: machine output must not pay for decorative whitespace (CLI-001). */
function printJson(value: unknown): void {
  console.log(JSON.stringify(value));
}

/** The resolved output mode for a dispatched catalog command. */
function commandOutput(parsed: ParsedArgs): ResolvedOutput {
  if (parsed.command === undefined || !isKnownCommand(parsed.command)) {
    // Bare `campfire` keeps its first-run human rendering; explicit JSON or
    // CAMPFIRE_OUTPUT=json still selects JSON.
    return resolveExplicitOutput(parsed) === "json" ? "json" : "human";
  }
  return resolveOutputMode(parsed, commandSpecForArgs(parsed.command, parsed.flags));
}

/** Render one command result in the selected mode from the same object. */
function emitResult<T>(
  result: T,
  mode: ResolvedOutput,
  render: (value: T) => string,
): void {
  if (mode === "json") {
    printJson(result);
    return;
  }
  const text = render(result);
  if (text.length > 0) {
    console.log(text);
  }
}

type WorkspaceSelection =
  | { workspaceId: string }
  | { awaiting: true; human?: { id: string; name: string } };

function workspaceSelectionError(workspaces: WorkspaceSummary[]): ValidationError {
  if (workspaces.length === 0) {
    return new ValidationError(
      "No Campfire workspace is available for this actor. Run campfire onboard, or pass --workspace <id>.",
      { field: "workspace", workspaces: [] },
    );
  }
  return new ValidationError(
    "Multiple Campfire workspaces are available; select one with --workspace <id>.",
    {
      field: "workspace",
      workspaces: workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        status: workspace.status,
      })),
    },
  );
}

/**
 * One workspace selection rule for primary read commands (CLI-001 section 6):
 * explicit id, then the local profile, then the sole authorized workspace. The
 * profile is a selector only; it is never the source of truth for status.
 */
async function resolveReadWorkspace(
  backend: CliBackend,
  explicit: string | undefined,
  options?: { allowAwaiting?: boolean },
): Promise<WorkspaceSelection> {
  if (explicit !== undefined && explicit.trim().length > 0) {
    return { workspaceId: explicit };
  }
  const profile = loadAnyProfile();
  if (profile?.workspaceId !== undefined) {
    return { workspaceId: profile.workspaceId };
  }
  const workspaces = (await backend.call("list_workspaces", {})) as WorkspaceSummary[];
  if (workspaces.length === 1) {
    return { workspaceId: workspaces[0]!.id };
  }
  if (options?.allowAwaiting === true && profile !== undefined && workspaces.length === 0) {
    return {
      awaiting: true,
      human: { id: profile.humanId, name: profile.humanName },
    };
  }
  throw workspaceSelectionError(workspaces);
}

function explicitWorkspaceArgument(parsed: ParsedArgs): string | undefined {
  return optionalFlag(parsed.flags, "workspace") ?? parsed.positionals[0];
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

function formatDeltaLine(contribution: Contribution): string {
  return formatContributionDeltaLine(contribution);
}

/**
 * The contribution delta for a caller-supplied `--since` cursor. States
 * `truncated` when the window omits older post-cursor rows; the resume cursor
 * always points at the newest contribution in the log, including when the
 * window is partial.
 */
function formatDeltaSection(context: WorkspaceContext, since: string | undefined): string[] {
  const delta = context.since;
  if (delta === undefined) {
    return [];
  }
  const anchor = since ?? delta.cursor;
  if (delta.items.length === 0) {
    return [`Since  ${anchor}  (no new contributions)`];
  }
  const note = delta.truncated ? "; truncated" : "";
  return [
    `Since  ${anchor}  (${delta.items.length} contributions${note})`,
    ...delta.items.map((item) => `  ${formatDeltaLine(item)}`),
  ];
}

/**
 * Newest contribution id the caller should retain for the next return. It is
 * an observation pointer, not a summary of the changes or permission to execute.
 */
function formatResumeCursor(context: WorkspaceContext): string | undefined {
  const newest = context.since?.cursor ?? context.provenance.at(-1)?.id;
  return newest === undefined ? undefined : labeled("Resume cursor", newest);
}

function formatDecision(decision: Decision): string {
  return joinFields(decision.id, decision.summary);
}

function formatTask(task: Task): string {
  return joinFields(task.id, `[${task.status}]`, task.title);
}

function formatSuggestedNextAction(action: SuggestedNextAction): string {
  if (action.kind === "none") {
    return "none";
  }
  return joinFields(action.kind, action.id, action.summary, `(${action.reason})`);
}

function section(title: string, lines: string[]): string[] {
  if (lines.length === 0) {
    return [];
  }
  return [title, ...lines.map((line) => `  ${line}`)];
}

function appendShowing(
  lines: string[],
  slice: { returned: number; total: number; truncated: boolean } | undefined,
): string[] {
  if (lines.length === 0 || slice === undefined || !slice.truncated) return lines;
  return [...lines, `Showing ${slice.returned} of ${slice.total}`];
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

const ALIGNMENT_BOUNDARY_SENTENCE =
  "Records what the team has proposed, accepted, or left unspecified. Not permission to execute.";

function stringIds(value: readonly string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((id): id is string => typeof id === "string" && id.length > 0);
}

function describeDecision(decisions: readonly Decision[], id: string): string {
  const decision = decisions.find((item) => item.id === id);
  if (decision === undefined || decision.summary.length === 0) {
    return id;
  }
  return `${id} ${decision.summary}`;
}

function describeBlockedTask(context: WorkspaceContext, id: string): string {
  const blocked = context.currentWork.blockedTasks.find((task) => task.id === id);
  if (blocked !== undefined && blocked.title.length > 0) {
    return `${id} ${blocked.title}`;
  }
  // openTasks includes non-completed work. Only a blocked row may supply the title.
  const fromOpen = context.openTasks.find((task) => task.id === id && task.status === "blocked");
  if (fromOpen !== undefined && fromOpen.title.length > 0) {
    return `${id} ${fromOpen.title}`;
  }
  return id;
}

/**
 * Recorded alignment boundary. Omitted when the projection has no `alignment`
 * (do not invent one). Describes what was recorded; it is not a grant to execute
 * and does not claim a proposal caused a blocked task.
 */
function formatAlignmentBoundary(context: WorkspaceContext): string[] {
  const alignment = context.alignment;
  if (alignment === undefined || alignment === null) {
    return [];
  }
  const lines = [`status: ${alignment.status}`, ALIGNMENT_BOUNDARY_SENTENCE];
  for (const id of stringIds(alignment.proposedDecisionIds)) {
    lines.push(`proposed: ${describeDecision(context.proposedDecisions, id)}`);
  }
  for (const id of stringIds(alignment.acceptedDecisionIds)) {
    lines.push(`accepted: ${describeDecision(context.acceptedDecisions, id)}`);
  }
  for (const id of stringIds(alignment.unresolvedBlockedTaskIds)) {
    lines.push(`unresolved blocked tasks: ${describeBlockedTask(context, id)}`);
  }
  return section("Recorded alignment boundary", lines);
}

function formatOrientation(context: WorkspaceContext, since?: string): string {
  const { workspace, goal } = context;
  const lines: string[] = [
    labeled("Workspace", workspace.id, workspace.name, `[${workspace.status}]`),
  ];
  if (goal !== undefined) {
    lines.push(labeled("Goal", goal.title));
  }
  lines.push(
    ...formatAlignmentBoundary(context),
    ...section("Needs You", context.needsYou.map(formatAttentionItem)),
    ...section("Needs Attention", context.needsAttention.map(formatAttentionItem)),
    ...section("Current Work", [
      ...context.currentWork.inProgressTasks.map(formatTask),
      ...context.currentWork.blockedTasks.map(formatTask),
      ...context.currentWork.acceptedDecisions.map(formatDecision),
    ]),
    ...section("Suggested next (orientation hint)", [
      formatSuggestedNextAction(context.suggestedNextAction),
    ]),
    ...section("Participants", context.participants.map(formatParticipant)),
    ...appendShowing(
      section("Proposed decisions", context.proposedDecisions.map(formatDecision)),
      context.slices.decisions,
    ),
    ...appendShowing(
      section("Accepted decisions", context.acceptedDecisions.map(formatDecision)),
      context.slices.decisions,
    ),
    ...appendShowing(section("Open tasks", context.openTasks.map(formatTask)), context.slices.tasks),
    ...appendShowing(
      section(
        "Findings",
        context.findings.map((finding) => joinFields(finding.id, finding.summary)),
      ),
      context.slices.findings,
    ),
    ...appendShowing(
      section(
        "Artifacts",
        context.artifacts.map((artifact) =>
          joinFields(artifact.id, artifact.type, artifact.uriOrPath, artifact.title),
        ),
      ),
      context.slices.artifacts,
    ),
    ...formatDeltaSection(context, since),
    ...appendShowing(
      section(
        "Recent changes",
        context.slices.recentChanges.items.map((change) => joinFields(change.materiality, change.summary)),
      ),
      context.slices.recentChanges,
    ),
    ...provenanceSection(
      "Recent provenance",
      context.provenance,
      context.provenanceTotal,
      context.provenanceTruncated,
    ),
  );
  const resumeCursor = formatResumeCursor(context);
  if (resumeCursor !== undefined) {
    lines.push(resumeCursor);
  }
  lines.push(
    `History is not fully included. Drill down with campfire decisions, findings, tasks, artifacts, and catch-up. orientationCursor ${context.orientationCursor}`,
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

function printBridgeReport(report: BridgeReport, asJson: boolean): void {
  if (asJson) {
    printJson(report);
    return;
  }
  console.log(formatBridgeReport(report));
}

/**
 * Operator inspection surface for webhook delivery state.
 *
 * Local mode reads the SQLite outbox directly. When `CAMPFIRE_URL` is set the
 * command asks the hosted instance for the same report, so Worker/D1 delivery
 * state is inspectable too. The hosted route takes the instance-operator token
 * (`CAMPFIRE_BRIDGE_TOKEN` or `--token`), not an actor token. The server
 * redacts the destination to an origin; the raw URL and signing secret never
 * cross either boundary. Not an MCP tool.
 */
async function cmdBridge(parsed: ParsedArgs): Promise<void> {
  const asJson = commandOutput(parsed) === "json";
  const webhookConfig = readWebhookBridgeConfig(process.env);
  const hostedUrl = readCampfireUrl() ?? loadRemoteProfile()?.url;
  if (hostedUrl !== undefined) {
    const token = optionalFlag(parsed.flags, "token") ?? readBridgeOperatorToken(process.env);
    if (token === undefined) {
      throw new ValidationError(
        "Missing operator token: pass --token or set CAMPFIRE_BRIDGE_TOKEN when CAMPFIRE_URL is set",
        { field: "token" },
      );
    }
    printBridgeReport(await campfireHttpBridgeReport({ baseUrl: hostedUrl, token }), asJson);
    return;
  }

  const config = loadConfig();
  let store: CampfireStore;
  try {
    store = openReadonlySqliteStore(config.databasePath);
  } catch {
    throw new ValidationError(`No Campfire database at ${config.databasePath}`, { field: "db" });
  }
  try {
    printBridgeReport(await collectBridgeReport(webhookConfig, store), asJson);
  } finally {
    store.close();
  }
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
  if (flags.reset === true) {
    console.error(SEED_RESET_WARNING);
  }
}

/**
 * Idempotent org/team setup for a blank database.
 *
 * Source layout note: TypeScript lives in `src/`, `npm run build` (`tsc`)
 * emits runnable JS into `dist/` (gitignored), and `bin.campfire` points at
 * the built `dist/src/cli/index.js`. Local dev keeps using `tsx src/...`.
 */
function printDoctor(
  report: DoctorReport,
  asJson: boolean,
  hint?: { workspaceId: string; harness: string },
): void {
  if (asJson) {
    printJson(report);
    return;
  }
  const lines = [`Campfire doctor ${report.version}`, `ready: ${report.ready ? "yes" : "no"}`, `next: ${report.nextAction}`];
  const command = commandForNextAction(report.nextAction, hint);
  if (command !== undefined) {
    lines.push(`  ${command}`);
  }
  for (const check of report.checks) {
    lines.push(`- ${check.id}: ${check.pass ? "pass" : `fail (${check.nextAction})`}`);
  }
  console.log(lines.join("\n"));
}

function cmdSetup(parsed: ParsedArgs): void {
  const contract = setupContract();
  if (commandOutput(parsed) === "json") {
    printJson(contract);
    return;
  }
  console.log(
    [
      `Campfire setup contract ${contract.version}`,
      "Inputs: --human-name --agent-name --harness --workspace-name --goal",
      "Human credential: operator CLI / administration",
      "Agent credential: exactly one harness process (CAMPFIRE_TOKEN)",
      "Handoff: no credential",
      `Serve: ${contract.serve.command}`,
      "MCP: campfire mcp with CAMPFIRE_URL, CAMPFIRE_TOKEN, CAMPFIRE_HARNESS",
      "Agent steps: register_agent_session, preflight, get_workspace_context",
      "Viewer: campfire view on loopback. The browser does not receive a token.",
      `Owner invitation: ${contract.enrollment.invitation}`,
      `Recipient: ${contract.enrollment.join}`,
      "Remote startup: campfire up proxies the shared instance; it opens no local collaboration database.",
      `Additional harness: ${contract.enrollment.additionalAgent}`,
      "Enrollment prepares connections. The agent explicitly registers a session before contributing.",
      "A harness reload or explicit approval is required before MCP tools appear.",
      "",
    ].join("\n"),
  );
}

const TELEMETRY_SUBCOMMANDS = ["status", "enable", "disable"] as const;
type TelemetrySubcommand = (typeof TELEMETRY_SUBCOMMANDS)[number];

/**
 * The ingestion endpoint this installation would use, without sending anything.
 *
 * This mirrors `resolveTelemetryTarget` deliberately instead of calling it:
 * that helper mints an installation id as a side effect, and `status` must be
 * a pure read. An endpoint that fails validation is reported as unusable
 * rather than repaired, and the configured value is never echoed back because a
 * URL can carry an operator secret.
 */
function telemetryEndpointStatus(env: NodeJS.ProcessEnv = process.env): TelemetryEndpoint {
  const configured = env[TELEMETRY_ENDPOINT_ENV_VAR]?.trim();
  const fromEnv = configured !== undefined && configured.length > 0;
  try {
    return {
      url: canonicalEndpoint(fromEnv ? configured! : DEFAULT_TELEMETRY_ENDPOINT, { allowLoopbackHttp: true }),
      source: fromEnv ? "env" : "default",
      valid: true,
    };
  } catch {
    return { source: fromEnv ? "env" : "default", valid: false };
  }
}

/**
 * `campfire telemetry status|enable|disable` (TEL-001B, section 12).
 *
 * Local preference control only: no SQLite runtime, no token, and no network,
 * so it works on a fresh install before any workspace exists. The resolved
 * preference is re-read after a write so an ambient `CAMPFIRE_TELEMETRY`
 * override stays visible in the output instead of being hidden by the value
 * that was just stored.
 */
function cmdTelemetry(parsed: ParsedArgs): void {
  const mode = commandOutput(parsed);
  const requested = parsed.positionals[0];
  const subcommand = TELEMETRY_SUBCOMMANDS.find((name) => name === requested) as TelemetrySubcommand | undefined;
  if (subcommand === undefined) {
    throw new ValidationError(
      `Unknown telemetry subcommand: ${requested === undefined ? "(none)" : requested}. ` +
        `Run campfire telemetry status, campfire telemetry enable, or campfire telemetry disable; campfire telemetry --help lists them.`,
      { field: "telemetry" },
    );
  }
  // `status` reads the state file only. Calling the enabling path here would
  // create an installation id, which would make inspecting telemetry an
  // observable event about this installation.
  const state =
    subcommand === "status"
      ? loadTelemetryState(process.env)
      : setTelemetryEnabled(subcommand === "enable", process.env);
  const preference = resolveTelemetryPreference(process.env);
  emitResult(
    buildTelemetryStatus({
      ...preference,
      ...(state?.installationId === undefined ? {} : { installationId: state.installationId }),
      ...(state?.activatedOn === undefined ? {} : { activatedOn: state.activatedOn }),
      ...(state?.lastActiveOn === undefined ? {} : { lastActiveOn: state.lastActiveOn }),
      endpoint: telemetryEndpointStatus(process.env),
    }),
    mode,
    formatTelemetryStatus,
  );
}

async function cmdConnect(parsed: ParsedArgs): Promise<void> {
  const flags = parsed.flags;
  const harness = requireFlag(flags, "harness");
  const profile = loadAnyProfile();
  const configPath =
    optionalFlag(flags, "config") ??
    (harness === "codex" || harness === "opencode" ? defaultHarnessConfigPath(harness) : undefined);
  if (configPath === undefined) {
    throw new ValidationError("Missing required --config argument", { field: "config" });
  }
  const mcpCommand = optionalFlag(flags, "mcp-command") ?? process.argv[1] ?? "campfire";
  if (flags.enroll === true) {
    if (profile?.mode !== "remote") {
      throw new ValidationError("--enroll requires a joined remote profile", { field: "enroll", nextAction: "join_with_invitation_file" });
    }
    const ownerAccess = resolveRemoteAccess({ url: optionalFlag(flags, "url") });
    if (ownerAccess.url !== profile.url) {
      throw new ValidationError("Agent enrollment must use the enrolled endpoint", { field: "endpoint", nextAction: "use_enrolled_endpoint" });
    }
    const known = profile.agents.find((agent) => agent.harness === harness);
    const knownToken = known === undefined ? undefined : resolveRemoteAccess({ harness }).token;
    assertConnectionCompatible({ harness, configPath, url: profile.url, ...(knownToken === undefined ? {} : { agentToken: knownToken }) });
    const enrollmentHarness = requireEnum(harness, ["codex", "opencode"] as const, "harness") as EnrollmentHarness;
    await enrollRemoteAgent({ harness: enrollmentHarness, name: optionalFlag(flags, "agent-name"), configPath, mcpCommand });
  }
  const access = profile?.mode === "remote"
    ? resolveRemoteAccess({ harness, url: optionalFlag(flags, "url"), token: optionalFlag(flags, "token") })
    : undefined;
  const url = access?.url ?? optionalFlag(flags, "url") ?? profile?.url ?? "http://127.0.0.1:9414";
  const agentToken = access?.token ??
    optionalFlag(flags, "token") ?? process.env.CAMPFIRE_TOKEN ?? readOperatorAgentToken(process.env, harness);
  if (agentToken === undefined) {
    throw new ValidationError("Missing agent token: pass --token or set CAMPFIRE_TOKEN", { field: "token" });
  }
  if (access !== undefined && (optionalFlag(flags, "token") !== undefined || readCampfireToken(process.env, []) !== undefined)) {
    const who = await campfireHttpCall<{ actor: ActorRef }>({ baseUrl: access.url, token: agentToken, method: "whoami" });
    if (who.actor.actorType !== "agent" || access.url === access.profile.url && who.actor.actorId !== access.agent?.id) {
      throw new ValidationError("Connection requires the selected recipient agent credential", { field: "token", nextAction: "use_recipient_agent_credential" });
    }
  }
  const workspaceId = optionalFlag(flags, "workspace") ?? profile?.workspaceId;
  const plan = prepareConnection({
    harness,
    configPath,
    mcpCommand,
    url,
    agentToken,
    ...(access === undefined ? {} : { rejectConflicting: true }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
  });
  if (commandOutput(parsed) === "json") {
    printJson(plan);
    return;
  }
  const scope = plan.workspaceId === undefined ? "" : ` for workspace ${plan.workspaceId}`;
  console.log(
    [
      `Wrote ${plan.harness} connection${scope}.`,
      `Config: ${plan.configPath}`,
      "The agent token was stored in that file and is not repeated here.",
      "Reload the harness or start a fresh process. Approval may be required.",
      "",
    ].join("\n"),
  );
}

async function cmdDoctor(parsed: ParsedArgs): Promise<void> {
  const remoteProfile = loadRemoteProfile();
  const workspaceId = optionalFlag(parsed.flags, "workspace") ?? parsed.positionals[0] ?? remoteProfile?.workspaceId;
  if (workspaceId === undefined || workspaceId.trim().length === 0) {
    throw new ValidationError("Missing required <workspaceId> argument", { field: "workspaceId" });
  }
  const harness = requireFlag(parsed.flags, "harness");
  const access = remoteProfile === undefined ? undefined : resolveRemoteAccess({
    harness, url: optionalFlag(parsed.flags, "url"), token: optionalFlag(parsed.flags, "token"),
  });
  const token = access?.token ?? optionalFlag(parsed.flags, "token") ?? process.env.CAMPFIRE_TOKEN ?? readOperatorAgentToken(process.env, harness);
  // Flag wins over the environment. Hosted doctor must be told the session id;
  // it does not look one up.
  const sessionFromFlag = optionalFlag(parsed.flags, "session");
  const sessionId = sessionFromFlag ?? readCampfireSessionId(process.env, []);
  const url = access?.url ?? optionalFlag(parsed.flags, "url") ?? readCampfireUrl();
  const asJson = commandOutput(parsed) === "json";
  if (url !== undefined) {
    if (token === undefined) {
      printDoctor(
        { ready: false, version: setupContract().version, mode: "hosted", checks: [{ id: "token", pass: false, nextAction: "set_agent_token" }], nextAction: "set_agent_token" },
        asJson,
        { workspaceId, harness },
      );
      return;
    }
    const report = await diagnoseHosted(
      async (method, params) => {
        try {
          return await campfireHttpCall({ baseUrl: url, token, method, params });
        } catch (error) {
          if (error instanceof CampfireError) throw error;
          throw new CampfireError("ValidationError", "Unable to reach Campfire", { nextAction: "start_campfire_serve" });
        }
      },
      { workspaceId, harness, reachable: true, sessionId, expectedAgentId: access?.agent?.id },
    );
    printDoctor(report, asJson, { workspaceId, harness });
    return;
  }
  const config = loadConfig();
  ensureParentDir(config.databasePath);
  const runtime = createRuntime(config);
  try {
    printDoctor(diagnoseLocal(runtime, { workspaceId, harness, token }), asJson, { workspaceId, harness });
  } finally {
    runtime.close();
  }
}

async function cmdHandoff(parsed: ParsedArgs): Promise<void> {
  const remoteProfile = loadRemoteProfile();
  const workspaceId = optionalFlag(parsed.flags, "workspace") ?? parsed.positionals[0] ?? remoteProfile?.workspaceId;
  if (workspaceId === undefined || workspaceId.trim().length === 0) {
    throw new ValidationError("Missing required <workspaceId> argument", { field: "workspaceId" });
  }
  const harness = requireFlag(parsed.flags, "harness");
  const viewerUrl = requireFlag(parsed.flags, "viewer-url");
  const access = remoteProfile === undefined ? undefined : resolveRemoteAccess({
    harness, url: optionalFlag(parsed.flags, "url"), token: optionalFlag(parsed.flags, "token"),
  });
  const token = access?.token ?? optionalFlag(parsed.flags, "token") ?? process.env.CAMPFIRE_TOKEN ?? readOperatorAgentToken(process.env, harness);
  if (token === undefined) {
    throw new ValidationError("Missing agent token: pass --token or set CAMPFIRE_TOKEN", { field: "token" });
  }
  const url = access?.url ?? optionalFlag(parsed.flags, "url") ?? readCampfireUrl();
  if (url !== undefined) {
    const sessionId = optionalFlag(parsed.flags, "session") ?? readCampfireSessionId(process.env, []);
    const call = (method: string, params: Record<string, unknown>) => campfireHttpCall({ baseUrl: url, token, method, params });
    const doctor = await diagnoseHosted(call, { workspaceId, harness, reachable: true, sessionId, expectedAgentId: access?.agent?.id });
    if (!doctor.ready) {
      throw new ValidationError("Setup is not ready for handoff", { field: "handoff", nextAction: doctor.nextAction });
    }
    const view = await call("get_workspace", { workspaceId, ...(sessionId === undefined ? {} : { agentSessionId: sessionId }) }) as WorkspaceView;
    let names: { humanName: string; agentName: string };
    if (remoteProfile !== undefined) names = recipientHandoffNames(remoteProfile, harness);
    else {
      const who = await call("whoami", {}) as { actor: ActorRef };
      const agent = view.participants.find((participant) => participant.actor.actorId === who.actor.actorId);
      const human = agent?.humanOwnerId === undefined ? undefined : view.participants.find((participant) => participant.actor.actorId === agent.humanOwnerId);
      if (agent === undefined || human === undefined) throw new ValidationError("Workspace is missing the selected recipient identity", { field: "handoff" });
      names = { humanName: human.name, agentName: agent.name };
    }
    if (view.goal === undefined) throw new ValidationError("Workspace is missing a goal for handoff", { field: "workspaceId" });
    const receipt = buildHandoff({ version: doctor.version, workspaceName: view.workspace.name, workspaceId,
      goalTitle: view.goal.title, ...names, viewerUrl, doctor });
    if (commandOutput(parsed) === "json") printJson(receipt);
    else console.log(formatHandoff(receipt));
    return;
  }
  const config = loadConfig();
  ensureParentDir(config.databasePath);
  const runtime = createRuntime(config);
  try {
    const doctor = diagnoseLocal(runtime, { workspaceId, harness, token });
    const actor = runtime.service.resolveToken(token);
    const view = runtime.service.getWorkspace({ actor }, workspaceId);
    const agent = view.participants.find((participant) => participant.actor.actorId === actor.actorId && participant.harness === harness);
    const human = view.participants.find((participant) => participant.actor.actorType === "human" && participant.actor.actorId === agent?.humanOwnerId);
    if (human === undefined || agent === undefined || view.goal === undefined) {
      throw new ValidationError("Workspace is missing the owner, agent, or goal for handoff", { field: "workspaceId" });
    }
    const receipt = buildHandoff({
      version: doctor.version,
      workspaceName: view.workspace.name,
      workspaceId,
      goalTitle: view.goal.title,
      humanName: human.name,
      agentName: agent.name,
      viewerUrl,
      doctor,
    });
    if (commandOutput(parsed) === "json") printJson(receipt);
    else console.log(formatHandoff(receipt));
  } finally {
    runtime.close();
  }
}

async function cmdOnboard(parsed: ParsedArgs): Promise<void> {
  const flags = parsed.flags;
  // Reject blank input before opening SQLite so a typo cannot create a database.
  const humanName = requireFlag(flags, "human-name");
  const agentName = requireFlag(flags, "agent-name");
  const harness = requireFlag(flags, "harness");
  const workspaceName = requireFlag(flags, "workspace-name");
  const goal = requireFlag(flags, "goal");
  const config = loadConfig();
  ensureParentDir(config.databasePath);
  const runtime = createRuntime(config);
  // Kept outside the try so the report cannot be reached before the workspace,
  // goal, and local profile are all committed; `runtime.close()` still runs on
  // every path through the block.
  let receipt: OnboardReceipt;
  try {
    receipt = onboardInstallation(runtime.store, runtime.service, runtime.config, {
      humanName,
      agentName,
      harness,
      workspaceName,
      goal,
    });
    persistOnboardProfile({
      databasePath: receipt.databasePath,
      workspaceId: receipt.workspace.id,
      workspaceName: receipt.workspace.name,
      goalTitle: receipt.goal.title,
      humanId: receipt.human.id,
      humanName: receipt.human.displayName,
      agentId: receipt.agent.id,
      agentName: receipt.agent.name,
      harness: receipt.agent.harness,
      humanToken: receipt.human.token,
      agentToken: receipt.agent.token,
    });
  } finally {
    runtime.close();
  }
  // TEL-001E, section 9 "successful workspace bootstrap". Placed after the
  // database is closed and after the profile is persisted, and sent in the
  // background: an onboarding that already succeeded is never failed, delayed,
  // or rolled back by measurement.
  telemetryInBackground(reportActivated("cli", { env: process.env }));
  if (commandOutput(parsed) === "json") {
    printJson(receipt);
    return;
  }
  console.log(formatOnboardReceipt(receipt));
}

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
    if (backend.store !== undefined) {
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

async function cmdPreflight(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const remote = loadRemoteProfile();
  const workspaceId = optionalFlag(parsed.flags, "workspace") ?? parsed.positionals[0] ?? remote?.workspaceId;
  if (workspaceId === undefined || workspaceId.trim().length === 0) {
    throw new ValidationError("Missing required <workspaceId> argument or --workspace", {
      field: "workspaceId",
    });
  }
  const access = remote===undefined ? undefined : resolveRemoteAccess({url:optionalFlag(parsed.flags,"url"),token:readCampfireToken(process.env,argv),harness:readHarness(process.env,argv)});
  const url = access?.url ?? readCampfireUrl();
  if (url === undefined) {
    throw new ValidationError(
      "CAMPFIRE_URL is required for hosted preflight; set it to the Campfire serve endpoint",
      { field: "CAMPFIRE_URL" },
    );
  }
  const token = access?.token ?? readCampfireToken(process.env, argv);
  if (token === undefined) {
    throw new ValidationError(
      "CAMPFIRE_TOKEN is required for hosted preflight; set it to the actor-specific token",
      { field: "CAMPFIRE_TOKEN" },
    );
  }
  const sessionId = readCampfireSessionId(process.env, argv);
  let status: ReadinessStatus;
  try {
    status = await campfireHttpCall<ReadinessStatus>({
      baseUrl: url,
      token,
      method: "preflight",
      params: sessionId === undefined ? { workspaceId } : { workspaceId, agentSessionId: sessionId },
    });
  } catch (error) {
    if (error instanceof CampfireError) throw hostedPreflightError(error);
    throw new ValidationError(
      "Unable to reach Campfire at the configured CAMPFIRE_URL; verify the endpoint and start campfire serve",
      { field: "CAMPFIRE_URL", nextAction: "start campfire serve" },
    );
  }
  const harness = readHarness(process.env, argv);
  const result = harness === undefined ? status : { ...status, harness };
  if (commandOutput(parsed) === "json") {
    printJson(result);
    return;
  }
  const session = status.sessionId === undefined ? "human identity" : `session=${status.sessionId}`;
  console.log(
    `Campfire ready: workspace=${status.workspaceId}, actor=${status.actor.actorId} (${status.actor.actorType}), ${session}`,
  );
}

async function cmdList(argv: string[]): Promise<void> {
  await withBackend(argv, async (backend) => {
    printJson(await backend.call("list_workspaces", {}));
  });
}

async function cmdShow(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const workspaceId = requirePositional(parsed, "workspaceId");
  const mode = commandOutput(parsed);
  const full = parsed.flags.full === true;
  const since = optionalFlag(parsed.flags, "since");
  if (full && since !== undefined) {
    throw new ValidationError("--since applies to the orientation projection, not --full", {
      field: "since",
    });
  }
  await withBackend(argv, async (backend) => {
    if (full) {
      const view = (await backend.call("get_workspace", { workspaceId })) as WorkspaceView;
      emitResult(view, mode, formatFullView);
      return;
    }
    const params: Record<string, unknown> = { workspaceId };
    if (since !== undefined) {
      params.since = since;
    }
    const context = (await backend.call("get_workspace_context", params)) as WorkspaceContext;
    // The service object already carries workspace, alignment, currentWork,
    // the orientation hint, and the since projection.
    emitResult(context, mode, (value) => formatOrientation(value, since));
  });
}

interface ActivityRenderPage {
  items: Contribution[];
  total: number;
  truncated: boolean;
  nextBefore?: string;
}

function renderActivityPage(page: ActivityRenderPage): string {
  const lines = page.items.map(formatContributionLine);
  if (page.truncated) {
    const parts = [`truncated total=${page.total}`];
    if (page.nextBefore !== undefined) {
      parts.push(`nextBefore=${page.nextBefore}`);
    }
    lines.push(parts.join(" "));
  }
  return lines.join("\n");
}

async function cmdActivity(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const mode = commandOutput(parsed);
  const limit = optionalPositiveInt(parsed.flags, "limit");
  const before = optionalFlag(parsed.flags, "before");
  const explicit = explicitWorkspaceArgument(parsed);
  await withBackend(argv, async (backend) => {
    const selection = await resolveReadWorkspace(backend, explicit);
    if ("awaiting" in selection) {
      throw workspaceSelectionError([]);
    }
    const query: GetActivityInput = { workspaceId: selection.workspaceId };
    if (limit !== undefined) {
      query.limit = limit;
    }
    if (before !== undefined) {
      query.before = before;
    }
    const page = (await backend.call(
      "get_activity",
      query as unknown as Record<string, unknown>,
    )) as ActivityRenderPage;
    emitResult(page, mode, renderActivityPage);
  });
}

async function cmdStatus(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const mode = commandOutput(parsed);
  const explicit = explicitWorkspaceArgument(parsed);
  await withBackend(argv, async (backend) => {
    const selection = await resolveReadWorkspace(backend, explicit, { allowAwaiting: true });
    if ("awaiting" in selection) {
      emitResult(buildAwaitingWorkspace(selection.human), mode, formatWorkspaceStatus);
      return;
    }
    const context = (await backend.call("get_workspace_context", {
      workspaceId: selection.workspaceId,
    })) as WorkspaceContext;
    emitResult(buildWorkspaceStatus(context), mode, formatWorkspaceStatus);
  });
}

async function cmdAgents(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const mode = commandOutput(parsed);
  const explicit = explicitWorkspaceArgument(parsed);
  await withBackend(argv, async (backend) => {
    const selection = await resolveReadWorkspace(backend, explicit);
    if ("awaiting" in selection) {
      throw workspaceSelectionError([]);
    }
    const context = (await backend.call("get_workspace_context", {
      workspaceId: selection.workspaceId,
    })) as WorkspaceContext;
    emitResult(buildWorkspaceAgents(context), mode, formatWorkspaceAgents);
  });
}

async function cmdDecisions(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const mode = commandOutput(parsed);
  const explicit = explicitWorkspaceArgument(parsed);
  const limit = optionalPositiveInt(parsed.flags, "limit") ?? MAX_PAGE_SIZE;
  const cursor = optionalFlag(parsed.flags, "cursor");
  const status = optionalFlag(parsed.flags, "status");
  await withBackend(argv, async (backend) => {
    const selection = await resolveReadWorkspace(backend, explicit);
    if ("awaiting" in selection) {
      throw workspaceSelectionError([]);
    }
    const params: Record<string, unknown> = { workspaceId: selection.workspaceId, limit };
    if (cursor !== undefined) params.cursor = cursor;
    if (status !== undefined) params.status = status;
    const page = (await backend.call("list_decisions", params)) as WorkspaceObjectPage<Decision>;
    emitResult(buildWorkspaceDecisions(page), mode, formatWorkspaceDecisions);
  });
}

async function cmdContext(parsed: ParsedArgs, argv: string[]): Promise<void> {
  if (parsed.flags.full === true) {
    throw new ValidationError("context does not accept --full", { field: "full" });
  }
  const mode = commandOutput(parsed);
  const since = optionalFlag(parsed.flags, "since");
  const explicit = explicitWorkspaceArgument(parsed);
  await withBackend(argv, async (backend) => {
    const selection = await resolveReadWorkspace(backend, explicit);
    if ("awaiting" in selection) {
      throw workspaceSelectionError([]);
    }
    const params: Record<string, unknown> = { workspaceId: selection.workspaceId };
    if (since !== undefined) params.since = since;
    const context = (await backend.call("get_workspace_context", params)) as WorkspaceContext;
    emitResult(context, mode, (value) => formatOrientation(value, since));
  });
}

function formatCatchUp(page: WorkspaceCatchUp): string {
  const lines = [labeled("From", page.fromCursor), labeled("To", page.toCursor)];
  for (const change of page.changes.items) {
    lines.push(joinFields(change.materiality, change.summary));
  }
  if (page.changes.truncated) {
    lines.push(`Showing ${page.changes.returned} of ${page.changes.total}`);
  }
  return lines.join("\n");
}

async function cmdCatchUp(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const mode = commandOutput(parsed);
  const after = requireFlag(parsed.flags, "after");
  const limit = optionalPositiveInt(parsed.flags, "limit");
  const explicit = explicitWorkspaceArgument(parsed);
  await withBackend(argv, async (backend) => {
    const selection = await resolveReadWorkspace(backend, explicit);
    if ("awaiting" in selection) {
      throw workspaceSelectionError([]);
    }
    const params: Record<string, unknown> = { workspaceId: selection.workspaceId, after };
    if (limit !== undefined) params.limit = limit;
    const page = (await backend.call("get_workspace_changes", params)) as WorkspaceCatchUp;
    emitResult(page, mode, formatCatchUp);
  });
}

function formatObjectPage<T>(page: WorkspaceObjectPage<T>, line: (item: T) => string): string {
  const lines = [labeled("Workspace", page.workspaceId), ...page.items.map((item) => `  ${line(item)}`)];
  if (page.truncated) lines.push(`Showing ${page.returned} of ${page.total}`);
  return lines.join("\n");
}

async function cmdFindings(parsed: ParsedArgs, argv: string[]): Promise<void> {
  await cmdObjectPage(parsed, argv, "list_findings", (page) =>
    formatObjectPage(page as WorkspaceObjectPage<Finding>, (finding) => joinFields(finding.id, finding.summary)),
  );
}

async function cmdTasks(parsed: ParsedArgs, argv: string[]): Promise<void> {
  await cmdObjectPage(parsed, argv, "list_tasks", (page) =>
    formatObjectPage(page as WorkspaceObjectPage<Task>, (task) => joinFields(task.id, `[${task.status}]`, task.title)),
  );
}

async function cmdArtifacts(parsed: ParsedArgs, argv: string[]): Promise<void> {
  await cmdObjectPage(parsed, argv, "list_artifacts", (page) =>
    formatObjectPage(page as WorkspaceObjectPage<Artifact>, (artifact) =>
      joinFields(artifact.id, artifact.type, artifact.uriOrPath, artifact.title),
    ),
  );
}

async function cmdObjectPage(
  parsed: ParsedArgs,
  argv: string[],
  method: "list_findings" | "list_tasks" | "list_artifacts",
  render: (page: WorkspaceObjectPage<Finding | Task | Artifact>) => string,
): Promise<void> {
  const mode = commandOutput(parsed);
  const explicit = explicitWorkspaceArgument(parsed);
  const limit = optionalPositiveInt(parsed.flags, "limit");
  const cursor = optionalFlag(parsed.flags, "cursor");
  const status = method === "list_tasks" ? optionalFlag(parsed.flags, "status") : undefined;
  await withBackend(argv, async (backend) => {
    const selection = await resolveReadWorkspace(backend, explicit);
    if ("awaiting" in selection) {
      throw workspaceSelectionError([]);
    }
    const params: Record<string, unknown> = { workspaceId: selection.workspaceId };
    if (limit !== undefined) params.limit = limit;
    if (cursor !== undefined) params.cursor = cursor;
    if (status !== undefined) params.status = status;
    const page = (await backend.call(method, params)) as WorkspaceObjectPage<Finding | Task | Artifact>;
    emitResult(page, mode, render);
  });
}

async function cmdChanges(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const mode = commandOutput(parsed);
  const since = optionalFlag(parsed.flags, "since");
  const explicit = explicitWorkspaceArgument(parsed);
  await withBackend(argv, async (backend) => {
    const selection = await resolveReadWorkspace(backend, explicit);
    if ("awaiting" in selection) {
      throw workspaceSelectionError([]);
    }
    const params: Record<string, unknown> = { workspaceId: selection.workspaceId };
    if (since !== undefined) {
      params.since = since;
    }
    const context = (await backend.call("get_workspace_context", params)) as WorkspaceContext;
    emitResult(buildWorkspaceChanges(context, since), mode, formatWorkspaceChanges);
  });
}

/**
 * Select one object from the authorized full workspace projection. There is no
 * cross-workspace lookup: an id from another workspace is simply not found.
 */
function selectInspectObject(view: WorkspaceView, kind: InspectKind, id: string): unknown {
  switch (kind) {
    case "workspace": {
      if (view.workspace.id !== id) {
        throw new WorkspaceNotFound(id);
      }
      return view.workspace;
    }
    case "agent": {
      const found = view.participants.find(
        (participant) => participant.actor.actorId === id && participant.actor.actorType === "agent",
      );
      if (found === undefined) {
        throw new ActorNotFound(id);
      }
      // Static participant record, flattened so the agent id is explicit.
      return {
        id: found.actor.actorId,
        actorType: found.actor.actorType,
        name: found.name,
        role: found.role,
        ...(found.harness === undefined ? {} : { harness: found.harness }),
        ...(found.humanOwnerId === undefined ? {} : { humanOwnerId: found.humanOwnerId }),
        joinedAt: found.joinedAt,
      };
    }
    case "goal": {
      if (view.goal === undefined || view.goal.id !== id) {
        throw new GoalNotFound(id);
      }
      return view.goal;
    }
    case "task": {
      const found = view.tasks.find((task) => task.id === id);
      if (found === undefined) {
        throw new TaskNotFound(id);
      }
      return found;
    }
    case "finding": {
      const found = view.findings.find((finding) => finding.id === id);
      if (found === undefined) {
        throw new FindingNotFound(id);
      }
      return found;
    }
    case "decision": {
      const found = view.decisions.find((decision) => decision.id === id);
      if (found === undefined) {
        throw new DecisionNotFound(id);
      }
      return found;
    }
    case "artifact": {
      const found = view.artifacts.find((artifact) => artifact.id === id);
      if (found === undefined) {
        throw new ArtifactNotFound(id);
      }
      return found;
    }
    case "contribution": {
      const found = view.activity.find((contribution) => contribution.id === id);
      if (found === undefined) {
        throw new ValidationError(`Contribution not found in workspace: ${id}`, {
          field: "contributionId",
          contributionId: id,
        });
      }
      return found;
    }
  }
}

async function cmdInspect(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const mode = commandOutput(parsed);
  const kindRaw = parsed.positionals[0];
  if (kindRaw === undefined || kindRaw.trim().length === 0) {
    throw new ValidationError(`Missing required <kind> argument; expected ${INSPECT_KINDS.join("|")}`, {
      field: "kind",
    });
  }
  if (!(INSPECT_KINDS as readonly string[]).includes(kindRaw)) {
    throw new ValidationError(
      `Invalid inspect kind: ${kindRaw}; expected ${INSPECT_KINDS.join("|")}`,
      { field: "kind", value: kindRaw },
    );
  }
  const kind = kindRaw as InspectKind;
  const id = parsed.positionals[1];
  if (id === undefined || id.trim().length === 0) {
    throw new ValidationError("Missing required <id> argument", { field: "id" });
  }
  const workspaceFlag = optionalFlag(parsed.flags, "workspace");
  if (kind !== "workspace" && workspaceFlag === undefined) {
    throw new ValidationError(
      `--workspace <workspaceId> is required to inspect a ${kind}; inspect never searches other workspaces`,
      { field: "workspace" },
    );
  }
  const workspaceId = kind === "workspace" ? (workspaceFlag ?? id) : workspaceFlag!;
  await withBackend(argv, async (backend) => {
    if (kind === "task" || kind === "finding" || kind === "decision" || kind === "artifact") {
      const method =
        kind === "task" ? "get_task" : kind === "finding" ? "get_finding" : kind === "decision" ? "get_decision" : "get_artifact";
      const object = await backend.call(method, { workspaceId, [`${kind}Id`]: id });
      emitResult(buildWorkspaceInspect(workspaceId, kind, object), mode, formatWorkspaceInspect);
      return;
    }
    const view = (await backend.call("get_workspace", { workspaceId })) as WorkspaceView;
    const object = selectInspectObject(view, kind, id);
    emitResult(buildWorkspaceInspect(workspaceId, kind, object), mode, formatWorkspaceInspect);
  });
}

async function cmdCapabilities(parsed: ParsedArgs): Promise<void> {
  const mode = commandOutput(parsed);
  emitResult(buildCommandManifest(installedCampfireVersion()), mode, formatCommandManifest);
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

async function cmdInviteTeammate(parsed:ParsedArgs,argv:string[]):Promise<void> {
  const workspaceId=requirePositional(parsed,"workspaceId"); const path=requireFlag(parsed.flags,"out");
  const remote=loadRemoteProfile();
  const access=remote===undefined?undefined:resolveRemoteAccess({url:optionalFlag(parsed.flags,"url"),token:readCampfireToken(process.env,argv)});
  const endpoint=canonicalEndpoint(access?.url ?? optionalFlag(parsed.flags,"url") ?? readCampfireUrl() ?? "",{allowLoopbackHttp:parsed.flags["allow-loopback"]===true});
  const token=access?.token ?? readCampfireToken(process.env,argv);
  if(token===undefined) throw new ValidationError("Invitation issuance requires a credential for this shared endpoint; pass --token or CAMPFIRE_TOKEN",{field:"token"});
  const call=(method:string,params:Record<string,unknown>)=>campfireHttpCall({baseUrl:endpoint,token,method,params});
  const hours=optionalFlag(parsed.flags,"expires-in-hours");
  const invitation=await call("issue_enrollment_invitation",{workspaceId,...(hours===undefined?{}:{expiresInHours:Number(hours)})}) as IssuedEnrollmentInvitation;
  let receipt;
  try { receipt=saveInvitationFile(path,invitation,endpoint,parsed.flags["allow-loopback"]===true); }
  catch(error) { try { await call("revoke_enrollment_invitation",{workspaceId,invitationId:invitation.invitationId}); } catch {} throw error; }
  emitResult(receipt,commandOutput(parsed),value=>`Private invitation saved to ${value.path}.\nExpires ${value.expiresAt}. Transfer this file privately to your teammate.\nAnyone holding this file can claim its enrollment authority; it does not verify their identity.\nThey run: campfire join --invitation-file <private-file> --human-name <name> --harness codex|opencode`);
}
async function cmdRevokeInvitation(parsed:ParsedArgs,argv:string[]):Promise<void> {
  const invitationId=requirePositional(parsed,"invitationId"); const workspaceId=requireFlag(parsed.flags,"workspace");
  await withBackend(argv,async backend=>emitResult(await backend.call("revoke_enrollment_invitation",{workspaceId,invitationId}),commandOutput(parsed),(value:any)=>value.revokedAuthority==="consumed_receipt_replay"
      ? "Invitation consumed. Receipt replay for the original claimant is now revoked. That human, their agents, credentials, and membership remain enrolled; this is not offboarding."
      : "Invitation revoked before anyone claimed it. No enrollment happened, and existing members are unaffected."));
}

async function cmdJoin(parsed: ParsedArgs, argv: string[]): Promise<void> {
  const invitationFile = optionalFlag(parsed.flags,"invitation-file");
  if (invitationFile !== undefined) {
    if (parsed.positionals.length > 0 || parsed.flags.workspace !== undefined || parsed.flags.token !== undefined || parsed.flags.url !== undefined) throw new ValidationError("Invitation join uses the invitation scope; remove workspace, URL, and token overrides");
    const selected = parsed.occurrences.harness ?? [];
    if (selected.length===0 || selected.some(harness=>harness!=="codex" && harness!=="opencode")) throw new ValidationError("Select --harness codex or --harness opencode; both may be selected once",{field:"harness"});
    if (parsed.flags.config !== undefined && selected.length!==1) throw new ValidationError("--config requires one selected harness; use --codex-config and --opencode-config when selecting both",{field:"config"});
    const configPaths:Partial<Record<EnrollmentHarness,string>> = {};
    for(const harness of selected as EnrollmentHarness[]) {
      const path=optionalFlag(parsed.flags,`${harness}-config`) ?? optionalFlag(parsed.flags,"config");
      if(path!==undefined) configPaths[harness]=path;
    }
    const receipt = await joinFromInvitation({invitationFile,humanName:requireFlag(parsed.flags,"human-name"),harnesses:selected as EnrollmentHarness[],configPaths,mcpCommand:optionalFlag(parsed.flags,"mcp-command"),allowLoopback:parsed.flags["allow-loopback"]===true});
    // TEL-001E, section 9 "successful workspace join": the enrollment is
    // committed and verified, so this installation demonstrably works. Only
    // the invitation variant reaches it; background so a committed join is
    // never failed by measurement.
    telemetryInBackground(reportActivated("cli", { env: process.env }));
    emitResult(receipt,commandOutput(parsed),value=>`Joined ${value.workspace.name} as ${value.human.name}.\nCompleted: ${value.stages.join(", ")}.\nConnected ${value.agents.map(agent=>agent.harness).join(" and ")}. Reload the harness and approve Campfire tools.\nNext: campfire up`);
    return;
  }
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
  await withBackend(
    argv,
    async (backend) => {
      printJson(await backend.call("add_artifact", { workspaceId, type, title, uriOrPath }));
    },
    // --type names the artifact here, not the acting identity; the acting
    // actor type comes from CAMPFIRE_ACTOR_TYPE / the default human.
    { stripIdentityFlags: ["type"] },
  );
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
    // --actor/--type name the token target, not the acting identity.
    { stripIdentityFlags: ["actor", "type"] },
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
    // --actor/--type name the invite target, not the acting identity.
    { stripIdentityFlags: ["actor", "type"] },
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

async function cmdUp(parsed: ParsedArgs): Promise<void> {
  const profile = loadAnyProfile();
  if (profile === undefined) {
    throw new ValidationError("No Campfire profile yet. Run campfire in a terminal, or pass --human-name.", {
      field: "up",
    });
  }
  if (profile.mode === "remote") {
    const access = resolveRemoteAccess({ url: optionalFlag(parsed.flags, "url"), token: optionalFlag(parsed.flags, "token") });
    const connect = parsed.flags["no-connect"] !== true;
    if (connect && access.url !== profile.url) {
      throw new ValidationError("An endpoint override can run a Viewer with --no-connect; enrolled agent credentials remain bound to their original endpoint", {
        field: "endpoint", nextAction: "use_no_connect_for_override",
      });
    }
    const viewerPortRaw = optionalFlag(parsed.flags, "viewer-port");
    const viewerPort = viewerPortRaw === undefined ? DEFAULT_VIEWER_PORT : Number(viewerPortRaw);
    if (!Number.isInteger(viewerPort) || viewerPort < 0 || viewerPort > 65535) {
      throw new ValidationError("--viewer-port must be an integer between 0 and 65535", { field: "viewer-port" });
    }
    const call = (method: string, params: Record<string, unknown> = {}) => campfireHttpCall({ baseUrl: access.url, token: access.token, method, params });
    const who = await call("whoami") as { actor: ActorRef };
    if (who.actor?.actorType !== "human" || access.url === profile.url && who.actor.actorId !== profile.humanId) {
      throw new ValidationError("Remote Viewer requires the recipient's human credential", { field: "credentials", nextAction: "use_recipient_human_credential" });
    }
    const workspaces = await call("list_workspaces") as WorkspaceSummary[];
    const connected: string[] = [];
    if (connect) {
      const selected = optionalFlag(parsed.flags, "harness");
      const installed = detectInstalledHarnesses();
      const harnesses = profile.agents.map((agent) => agent.harness).filter((harness) => selected === undefined ? installed.includes(harness as "codex" | "opencode") : harness === selected);
      if (selected !== undefined && harnesses.length === 0) {
        throw new ValidationError("Selected harness has no enrolled recipient agent", { field: "harness", nextAction: "enroll_selected_harness" });
      }
      const override = optionalFlag(parsed.flags, "config");
      if (override !== undefined && harnesses.length !== 1) {
        throw new ValidationError("Select one enrolled --harness when using --config", { field: "config" });
      }
      const plans = harnesses.map((harness) => {
        const agentAccess = resolveRemoteAccess({ harness }, { ...process.env, CAMPFIRE_TOKEN: undefined });
        const configPath = override ?? defaultHarnessConfigPath(harness as "codex" | "opencode");
        const input = { harness, configPath, url: agentAccess.url, agentToken: agentAccess.token,
          workspaceId: profile.workspaceId, mcpCommand: optionalFlag(parsed.flags, "mcp-command") ?? process.argv[1] ?? "campfire", rejectConflicting: true };
        assertConnectionCompatible(input);
        return input;
      });
      for (const input of plans) connected.push(prepareConnection(input).harness);
    }
    const viewer = await startCampfireViewer({ call, host: DEFAULT_VIEWER_HOST, port: viewerPort,
      theme: optionalFlag(parsed.flags, "theme") ?? DEFAULT_VIEWER_THEME });
    try {
      const openBrowser = parsed.flags["no-open"] !== true && shouldOpenBrowser();
      if (openBrowser) {
        try { openLoopbackUrl(viewer.url); } catch { /* Browser launch is optional. */ }
      }
      if (commandOutput(parsed) === "json") {
        printJson({ mode: "remote", human: profile.humanName, workspaceId: profile.workspaceId,
          workspaces: workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name, goal: workspace.goalTitle })),
          agents: connected, connectionPrepared: connected.length > 0, reloadRequired: connected.length > 0,
          sessionRegistered: false, apiUrl: access.url, viewerUrl: viewer.url, openedBrowser: openBrowser, pastSessionsImported: false });
      } else {
        console.log([wordmark(false), `  You        ${profile.humanName}`,
          connected.length === 0 ? "  Agents     no connection prepared" : `  Agents     ${connected.join(", ")}`,
          ...workspaces.map((workspace) => `  Workspace  ${workspace.name}`), "",
          `  Viewer     ${viewer.url}`, ...(connected.length === 0 ? [] : ["  Agent      reload the harness, then continue in that session"]),
          "  The Viewer is read-only; an agent registers its own session before contributing.", ""].join("\n"));
      }
      console.error(`[campfire] remote workspace  viewer ${viewer.url}`);
      await new Promise<void>((resolve) => {
        const shutdown = (): void => {
          process.removeListener("SIGINT", shutdown);
          process.removeListener("SIGTERM", shutdown);
          void viewer.close().finally(resolve);
        };
        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);
      });
    } catch (error) {
      await viewer.close();
      throw error;
    }
    return;
  }
  const humanToken = readOperatorHumanToken();
  if (humanToken === undefined) {
    throw new ValidationError("Missing operator credential. Re-run campfire onboard.", { field: "credentials" });
  }
  const config = loadConfig();
  ensureParentDir(config.databasePath);
  const runtime = createRuntime(config);
  let running: Awaited<ReturnType<typeof startLocalWorkspace>> | undefined;
  try {
    const actor = runtime.service.resolveToken(humanToken);
    const human = runtime.store.getHuman(actor.actorId);
    if (human === undefined) {
      throw new ValidationError("The stored operator credential is not a human.", { field: "credentials" });
    }
    const connect = parsed.flags["no-connect"] !== true;
    let connected: string[] = [];
    if (connect) {
      const harnesses = detectInstalledHarnesses();
      const known: Record<string, string | undefined> = {};
      const stored = loadCredentials();
      for (const harness of harnesses) {
        known[harness] = stored?.agents?.[harness] ?? (profile.harness === harness ? stored?.agentToken : undefined);
      }
      const mcpCommand = optionalFlag(parsed.flags, "mcp-command") ?? process.argv[1] ?? "campfire";
      const url = optionalFlag(parsed.flags, "url") ?? profile.url;
      const configOverride =
        harnesses.length === 1 ? optionalFlag(parsed.flags, "config") : undefined;
      const result = connectInstalledHarnesses({
        store: runtime.store,
        service: runtime.service,
        human: { id: human.id, teamId: human.teamId },
        harnesses,
        knownTokens: known,
        url,
        mcpCommand,
        ...(profile.workspaceId === undefined ? {} : { workspaceId: profile.workspaceId }),
        configPathFor: (harness) => configOverride ?? defaultHarnessConfigPath(harness),
        onMintedToken: (harness, token) => rememberAgentCredential(harness, token),
      });
      connected = result.connected;
      if (result.agents.length > 0) {
        rememberProfileAgents(
          result.agents.map((agent) => ({ id: agent.agentId, name: agent.name, harness: agent.harness })),
        );
      }
    }
    const workspaces = runtime.service.listWorkspaces({ actor });
    const httpHost = optionalFlag(parsed.flags, "host") ?? DEFAULT_HTTP_HOST;
    const httpPortRaw = optionalFlag(parsed.flags, "port");
    const httpPort = httpPortRaw === undefined ? DEFAULT_HTTP_PORT : Number(httpPortRaw);
    const viewerPortRaw = optionalFlag(parsed.flags, "viewer-port");
    const viewerPort = viewerPortRaw === undefined ? DEFAULT_VIEWER_PORT : Number(viewerPortRaw);
    if (!Number.isInteger(httpPort) || httpPort < 0 || httpPort > 65535) {
      throw new ValidationError("--port must be an integer between 0 and 65535", { field: "port" });
    }
    if (!Number.isInteger(viewerPort) || viewerPort < 0 || viewerPort > 65535) {
      throw new ValidationError("--viewer-port must be an integer between 0 and 65535", { field: "viewer-port" });
    }
    running = await startLocalWorkspace({
      runtime,
      human: { actor },
      httpHost,
      httpPort,
      viewerPort,
    });
    const openBrowser = parsed.flags["no-open"] !== true && shouldOpenBrowser();
    if (openBrowser) {
      try {
        openLoopbackUrl(running.viewerUrl);
      } catch {
        // Opening a browser is convenience, not correctness.
      }
    }
    if (commandOutput(parsed) === "json") {
      printJson({
        human: profile.humanName,
        workspaces: workspaces.map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          goal: workspace.goalTitle,
        })),
        agents: connected,
        apiUrl: running.apiUrl,
        viewerUrl: running.viewerUrl,
        openedBrowser: openBrowser,
        pastSessionsImported: false,
      });
    } else {
      const workspaceLines =
        workspaces.length === 0
          ? ["  Waiting for an agent to start work."]
          : workspaces.map(
              (workspace) =>
                `  Workspace  ${workspace.name}${workspace.goalTitle === undefined ? "" : `  ${workspace.goalTitle}`}`,
            );
      const lines = [
        wordmark(false),
        connected.length === 0 ? "  Agents     none connected yet" : `  Agents     ${connected.join(", ")}`,
        ...workspaceLines,
        "  Past sessions are not imported.",
        "",
        `  You        ${running.viewerUrl}`,
      ];
      if (connected.length > 0) {
        lines.push("  Agent      reload the harness, then continue in that session");
      }
      lines.push("");
      console.log(lines.join("\n"));
    }
    console.error(`[campfire] HTTP ${running.apiUrl}  viewer ${running.viewerUrl}`);
    const session = running;
    await new Promise<void>((resolve) => {
      const shutdown = (signal: NodeJS.Signals): void => {
        console.error(`[campfire] received ${signal}, shutting down`);
        void session.close().finally(() => {
          runtime.close();
          resolve();
        });
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    });
  } catch (error) {
    await running?.close();
    runtime.close();
    throw error;
  }
}

function printStatus(asJson: boolean): void {
  const profile = loadProfile();
  if (profile === undefined) {
    throw new ValidationError("No Campfire profile yet. Run campfire in a terminal, or pass --human-name.", {
      field: "status",
    });
  }
  if (asJson) {
    printJson({
      workspace: profile.workspaceName,
      workspaceId: profile.workspaceId,
      goal: profile.goalTitle,
      human: profile.humanName,
      agent: profile.agentName,
      harness: profile.harness,
      databasePath: profile.databasePath,
    });
    return;
  }
  process.stdout.write(wordmark());
  console.log(formatStatus(profile));
}

function startHuman(humanName: string): void {
  const config = loadConfig();
  ensureParentDir(config.databasePath);
  const runtime = createRuntime(config);
  try {
    const started = beginHuman(runtime.store, runtime.service, runtime.config, humanName);
    persistHumanProfile({
      databasePath: started.databasePath,
      humanId: started.humanId,
      humanName: started.humanName,
      humanToken: started.token,
    });
  } finally {
    runtime.close();
  }
}

async function cmdDefault(parsed: ParsedArgs): Promise<void> {
  const existing = loadAnyProfile();
  if (existing?.mode === "remote") {
    const result = { mode: "remote", human: existing.humanName, humanId: existing.humanId,
      workspaceId: existing.workspaceId, workspace: existing.workspaceName, agents: existing.agents,
      nextAction: "campfire up", pastSessionsImported: false };
    if (commandOutput(parsed) === "json") printJson(result);
    else console.log([wordmark(false), `  You        ${existing.humanName}`,
      `  Workspace  ${existing.workspaceName ?? existing.workspaceId}`,
      `  Agents     ${existing.agents.map((agent) => `${agent.name} (${agent.harness})`).join(", ")}`,
      "", "  campfire up     open the shared workspace journal and prepare your agents", "  campfire status read current authorized work", ""].join("\n"));
    return;
  }
  if (existing !== undefined) {
    printStatus(commandOutput(parsed) === "json");
    return;
  }
  const named = optionalFlag(parsed.flags, "human-name");
  const noninteractive =
    commandOutput(parsed) === "json" || process.env.CAMPFIRE_NONINTERACTIVE === "1" || !isInteractiveTty();
  if (noninteractive && named === undefined) {
    throw new ValidationError(
      "Run campfire in a terminal to confirm your name, or pass --human-name. Agents and workspaces appear when a harness connects.",
      { field: "human-name" },
    );
  }
  const humanName = named ?? (await promptHumanName(defaultHumanName()));
  startHuman(humanName);
  if (commandOutput(parsed) === "json") {
    const profile = loadProfile();
    printJson({
      human: profile?.humanName,
      humanId: profile?.humanId,
      databasePath: profile?.databasePath,
      waiting: "agent",
      pastSessionsImported: false,
    });
    return;
  }
  if (noninteractive) {
    process.stdout.write(wordmark());
    console.log(formatStatus(loadProfile()!));
    return;
  }
  await cmdUp(parsed);
}

function printHelp(command?: string): void {
  if (command === undefined || command === "help") {
    console.log(formatUsage());
    return;
  }
  if (!isKnownCommand(command)) {
    throw new ValidationError(`Unknown command: ${command}`, { command });
  }
  console.log(formatCommandUsage(command));
}

type CliHandler = (parsed: ParsedArgs, argv: string[]) => Promise<void> | void;

/**
 * Dispatch map keyed by catalog command. Tests assert its keys match the
 * catalog exactly, so a dispatched command cannot silently lose its help or
 * capabilities entry, and a catalogued command cannot lose its handler.
 */
export const CLI_COMMAND_HANDLERS: Record<CliCommand, CliHandler> = {
  setup: (parsed) => cmdSetup(parsed),
  onboard: (parsed) => cmdOnboard(parsed),
  connect: (parsed) => cmdConnect(parsed),
  doctor: (parsed) => cmdDoctor(parsed),
  handoff: (parsed) => cmdHandoff(parsed),
  up: (parsed) => cmdUp(parsed),
  status: (parsed, argv) => cmdStatus(parsed, argv),
  agents: (parsed, argv) => cmdAgents(parsed, argv),
  decisions: (parsed, argv) => cmdDecisions(parsed, argv),
  context: (parsed, argv) => cmdContext(parsed, argv),
  "catch-up": (parsed, argv) => cmdCatchUp(parsed, argv),
  findings: (parsed, argv) => cmdFindings(parsed, argv),
  tasks: (parsed, argv) => cmdTasks(parsed, argv),
  artifacts: (parsed, argv) => cmdArtifacts(parsed, argv),
  changes: (parsed, argv) => cmdChanges(parsed, argv),
  inspect: (parsed, argv) => cmdInspect(parsed, argv),
  capabilities: (parsed) => cmdCapabilities(parsed),
  bridge: (parsed) => cmdBridge(parsed),
  whoami: (_parsed, argv) => cmdWhoami(argv),
  list: (_parsed, argv) => cmdList(argv),
  show: (parsed, argv) => cmdShow(parsed, argv),
  activity: (parsed, argv) => cmdActivity(parsed, argv),
  preflight: (parsed, argv) => cmdPreflight(parsed, argv),
  "create-workspace": (parsed, argv) => cmdCreateWorkspace(parsed, argv),
  "update-workspace": (parsed, argv) => cmdUpdateWorkspace(parsed, argv),
  "create-goal": (parsed, argv) => cmdCreateGoal(parsed, argv),
  "update-goal": (parsed, argv) => cmdUpdateGoal(parsed, argv),
  "add-finding": (parsed, argv) => cmdAddFinding(parsed, argv),
  "add-decision": (parsed, argv) => cmdAddDecision(parsed, argv),
  "accept-decision": (parsed, argv) => cmdAcceptDecision(parsed, argv),
  "create-task": (parsed, argv) => cmdCreateTask(parsed, argv),
  "update-task": (parsed, argv) => cmdUpdateTask(parsed, argv),
  "add-artifact": (parsed, argv) => cmdAddArtifact(parsed, argv),
  "create-human": (parsed, argv) => cmdCreateHuman(parsed, argv),
  "create-agent": (parsed, argv) => cmdCreateAgent(parsed, argv),
  "issue-token": (parsed, argv) => cmdIssueToken(parsed, argv),
  "revoke-token": (parsed, argv) => cmdRevokeToken(parsed, argv),
  invite: (parsed, argv) => cmdInvite(parsed, argv),
  join: (parsed, argv) => cmdJoin(parsed, argv),
  "invite-teammate": (parsed, argv) => cmdInviteTeammate(parsed, argv),
  "revoke-invitation": (parsed, argv) => cmdRevokeInvitation(parsed, argv),
  serve: (parsed) => cmdServe(parsed),
  view: (parsed, argv) => cmdView(parsed, argv),
  mcp: (_parsed, argv) => cmdMcp(argv),
  init: () => cmdInit(),
  bootstrap: (parsed) => cmdBootstrap(parsed.flags),
  seed: (parsed) => cmdSeed(parsed.flags),
  telemetry: (parsed) => cmdTelemetry(parsed),
  help: (parsed) => printHelp(parsed.positionals[0]),
};

export async function runCli(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  applyDbFlag(parsed.flags);

  if (parsed.flags.help === true) {
    printHelp(parsed.command);
    return;
  }

  if (parsed.command === undefined) {
    return cmdDefault(parsed);
  }

  if (!isKnownCommand(parsed.command)) {
    throw new ValidationError(`Unknown command: ${parsed.command}`, { command: parsed.command });
  }

  // Validate the output request once for every catalogued command, including
  // JSON-only commands whose handlers never consult the mode.
  resolveOutputMode(parsed, commandSpecForArgs(parsed.command, parsed.flags));

  return CLI_COMMAND_HANDLERS[parsed.command](parsed, argv);
}

async function run(): Promise<void> {
  process.exitCode = await runCliEntry(process.argv.slice(2));
}

export { formatCliFailure };

/**
 * Run the CLI against an explicit argv and return the process exit code.
 * Exported so tests cover the exact stdout/stderr contract of the binary.
 */
export async function runCliEntry(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  try {
    await runCli(argv);
    return 0;
  } catch (error) {
    console.error(
      formatCliFailure(error, {
        json: resolveErrorOutput(parsed) === "json",
        command: parsed.command,
      }),
    );
    return 1;
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
