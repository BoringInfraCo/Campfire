/**
 * CLI read projections and human renderers (CLI-001).
 *
 * Each builder turns one authorized service projection into the single command
 * result object. The human renderer is derived from that same object, so text
 * and JSON can never disagree about facts. Human layout may add labels and
 * whitespace; it never adds facts.
 */
import type {
  Contribution,
  Decision,
  DecisionStatus,
  GoalStatus,
  ParticipantRole,
  WorkspaceStatus,
} from "../domain/types.js";
import type {
  AttentionItem,
  ParticipantView,
  WorkspaceContext,
  WorkspaceView,
} from "../service/service.js";
import {
  CLI_CATALOG,
  CLI_GROUPS,
  CLI_COMMAND_NAMES,
  type CliGroup,
  type CliOutputMode,
} from "./catalog.js";

export const PROJECTION_VERSION = 1 as const;

const HEADER_LABEL_WIDTH = 9;
const GROUP_TITLES: Record<CliGroup, string> = {
  start: "Start and connect",
  workspace: "Understand the workspace",
  recover: "Recover and hand off",
  discover: "Discover the CLI",
  admin: "Administration",
};

function joinFields(...parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => part !== undefined && part.length > 0).join("  ");
}

function labeled(label: string, ...values: Array<string | undefined>): string {
  return joinFields(label.padEnd(HEADER_LABEL_WIDTH), ...values);
}

function section(title: string, lines: string[]): string[] {
  if (lines.length === 0) {
    return [];
  }
  return [title, ...lines.map((line) => `  ${line}`)];
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

// ---------------------------------------------------------------------------
// Contribution lines shared by show, activity, and changes.
// ---------------------------------------------------------------------------

export function formatContributionLine(contribution: Contribution): string {
  return joinFields(
    contribution.id,
    contribution.createdAt,
    contribution.actor.actorId,
    contribution.action,
    contribution.objectType,
    contribution.objectId,
  );
}

/**
 * Payload fields a returning caller needs to read the change itself. Only the
 * fields the contribution actually recorded are printed (Sprint 010), so an
 * assignee-only task update does not invent a status.
 */
export function formatPayloadFields(contribution: Contribution): string | undefined {
  const payload = contribution.payload ?? {};
  const parts: string[] = [];
  for (const key of ["summary", "title", "status"] as const) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) {
      parts.push(`${key}=${value}`);
    }
  }
  const assignee = payload.assignee;
  if (assignee === null) {
    parts.push("assignee=null");
  } else if (
    typeof assignee === "object" &&
    assignee !== null &&
    typeof (assignee as { actorId?: unknown }).actorId === "string"
  ) {
    parts.push(`assignee=${(assignee as { actorId: string }).actorId}`);
  }
  return parts.length === 0 ? undefined : parts.join("  ");
}

export function formatContributionDeltaLine(contribution: Contribution): string {
  return joinFields(formatContributionLine(contribution), formatPayloadFields(contribution));
}

export function formatAttentionItem(item: AttentionItem): string {
  return joinFields(
    item.kind,
    item.id,
    `[${item.status}]`,
    item.summary,
    `(${item.reason})`,
    item.assignee === undefined ? undefined : `assignee=${item.assignee.actorId}`,
  );
}

export function formatParticipant(participant: ParticipantView): string {
  return joinFields(
    participant.name,
    participant.role,
    participant.harness,
    participant.humanOwnerId === undefined ? undefined : `on behalf of ${participant.humanOwnerId}`,
  );
}

// ---------------------------------------------------------------------------
// workspace_status
// ---------------------------------------------------------------------------

export interface WorkspaceStatusResult {
  version: typeof PROJECTION_VERSION;
  kind: "workspace_status";
  state: "ready";
  workspace: { id: string; name: string; status: WorkspaceStatus };
  goal?: { id: string; title: string; status: GoalStatus };
  participants: { humans: number; agents: number };
  work: { open: number; inProgress: number; blocked: number };
  decisions: { proposed: number; accepted: number };
  attention: { needsYou: AttentionItem[]; needsAttention: AttentionItem[] };
  activity: { total: number; newestContributionId?: string; truncated: boolean };
}

export interface AwaitingWorkspaceResult {
  version: typeof PROJECTION_VERSION;
  kind: "workspace_status";
  state: "awaiting_workspace";
  human?: { id: string; name: string };
  next: Array<{ command: string; when: string }>;
}

function countTaskStatus(tasks: WorkspaceContext["openTasks"], status: string): number {
  return tasks.filter((task) => task.status === status).length;
}

export function buildWorkspaceStatus(context: WorkspaceContext): WorkspaceStatusResult {
  const participants = context.participants;
  const newest = context.provenance.at(-1)?.id;
  return {
    version: PROJECTION_VERSION,
    kind: "workspace_status",
    state: "ready",
    workspace: {
      id: context.workspace.id,
      name: context.workspace.name,
      status: context.workspace.status,
    },
    ...(context.goal === undefined
      ? {}
      : {
          goal: {
            id: context.goal.id,
            title: context.goal.title,
            status: context.goal.status,
          },
        }),
    participants: {
      humans: participants.filter((participant) => participant.actor.actorType === "human").length,
      agents: participants.filter((participant) => participant.actor.actorType === "agent").length,
    },
    work: {
      open: countTaskStatus(context.openTasks, "open"),
      inProgress: countTaskStatus(context.openTasks, "in_progress"),
      blocked: countTaskStatus(context.openTasks, "blocked"),
    },
    decisions: {
      proposed: context.proposedDecisions.length,
      accepted: context.acceptedDecisions.length,
    },
    attention: {
      needsYou: context.needsYou,
      needsAttention: context.needsAttention,
    },
    activity: {
      total: context.provenanceTotal,
      ...(newest === undefined ? {} : { newestContributionId: newest }),
      truncated: context.provenanceTruncated,
    },
  };
}

export function buildAwaitingWorkspace(human?: {
  id: string;
  name: string;
}): AwaitingWorkspaceResult {
  return {
    version: PROJECTION_VERSION,
    kind: "workspace_status",
    state: "awaiting_workspace",
    ...(human === undefined ? {} : { human }),
    next: [
      { command: "campfire up", when: "Start the local API and Viewer so an agent can connect" },
      { command: "campfire --help", when: "See the command list" },
    ],
  };
}

export function formatWorkspaceStatus(result: WorkspaceStatusResult | AwaitingWorkspaceResult): string {
  if (result.state === "awaiting_workspace") {
    return formatAwaitingWorkspace(result);
  }
  const lines: string[] = [
    labeled("Workspace", result.workspace.name, `[${result.workspace.status}]`, result.workspace.id),
  ];
  if (result.goal !== undefined) {
    lines.push(labeled("Goal", result.goal.title, `[${result.goal.status}]`));
  }
  lines.push(
    labeled(
      "Participants",
      countLabel(result.participants.humans, "human"),
      countLabel(result.participants.agents, "agent"),
    ),
    labeled(
      "Work",
      `open ${result.work.open}`,
      `in progress ${result.work.inProgress}`,
      `blocked ${result.work.blocked}`,
    ),
    labeled(
      "Decisions",
      `proposed ${result.decisions.proposed}`,
      `accepted ${result.decisions.accepted}`,
    ),
    ...section(`Needs You  (${result.attention.needsYou.length})`, result.attention.needsYou.map(formatAttentionItem)),
    ...section(
      `Needs Attention  (${result.attention.needsAttention.length})`,
      result.attention.needsAttention.map(formatAttentionItem),
    ),
    labeled(
      "Activity",
      countLabel(result.activity.total, "contribution"),
      result.activity.newestContributionId === undefined
        ? undefined
        : `newest ${result.activity.newestContributionId}`,
      result.activity.truncated ? "(recent window truncated)" : undefined,
    ),
  );
  return lines.join("\n");
}

function formatAwaitingWorkspace(result: AwaitingWorkspaceResult): string {
  const lines: string[] = [];
  if (result.human !== undefined) {
    lines.push(labeled("You", result.human.name));
  }
  lines.push("Waiting for an agent to start work.", "Past sessions are not imported.");
  for (const step of result.next) {
    lines.push(joinFields(step.command.padEnd(HEADER_LABEL_WIDTH), step.when));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// workspace_agents
// ---------------------------------------------------------------------------

export interface WorkspaceAgent {
  id: string;
  name: string;
  role: ParticipantRole;
  harness?: string;
  humanOwnerId?: string;
  joinedAt: string;
}

export interface WorkspaceAgentsResult {
  version: typeof PROJECTION_VERSION;
  kind: "workspace_agents";
  workspaceId: string;
  agents: WorkspaceAgent[];
}

export function buildWorkspaceAgents(context: WorkspaceContext): WorkspaceAgentsResult {
  const agents = context.participants
    .filter((participant) => participant.actor.actorType === "agent")
    .map((participant) => ({
      id: participant.actor.actorId,
      name: participant.name,
      role: participant.role,
      ...(participant.harness === undefined ? {} : { harness: participant.harness }),
      ...(participant.humanOwnerId === undefined ? {} : { humanOwnerId: participant.humanOwnerId }),
      joinedAt: participant.joinedAt,
    }));
  return {
    version: PROJECTION_VERSION,
    kind: "workspace_agents",
    workspaceId: context.workspace.id,
    agents,
  };
}

export function formatWorkspaceAgents(result: WorkspaceAgentsResult): string {
  const lines = [labeled("Workspace", result.workspaceId)];
  if (result.agents.length === 0) {
    lines.push(labeled("Agents", "none recorded"));
    return lines.join("\n");
  }
  lines.push(...section(`Agents  (${result.agents.length})`, result.agents.map((agent) =>
    joinFields(
      agent.id,
      agent.name,
      `role=${agent.role}`,
      agent.harness === undefined ? undefined : `harness=${agent.harness}`,
      agent.humanOwnerId === undefined ? undefined : `owner=${agent.humanOwnerId}`,
      `joined=${agent.joinedAt}`,
    ),
  )));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// workspace_decisions
// ---------------------------------------------------------------------------

export interface WorkspaceDecisionsResult {
  version: typeof PROJECTION_VERSION;
  kind: "workspace_decisions";
  workspaceId: string;
  proposed: Decision[];
  accepted: Decision[];
  superseded: Decision[];
}

export function buildWorkspaceDecisions(view: WorkspaceView): WorkspaceDecisionsResult {
  const of = (status: DecisionStatus): Decision[] =>
    view.decisions.filter((decision) => decision.status === status);
  return {
    version: PROJECTION_VERSION,
    kind: "workspace_decisions",
    workspaceId: view.workspace.id,
    proposed: of("proposed"),
    accepted: of("accepted"),
    superseded: of("superseded"),
  };
}

function decisionLines(decisions: readonly Decision[]): string[] {
  return decisions.map((decision) =>
    joinFields(
      decision.id,
      decision.summary,
      `[${decision.status}]`,
      decision.rationale === undefined ? undefined : `rationale=${decision.rationale}`,
    ),
  );
}

export function formatWorkspaceDecisions(result: WorkspaceDecisionsResult): string {
  return [
    labeled("Workspace", result.workspaceId),
    ...section(`Proposed  (${result.proposed.length})`, decisionLines(result.proposed)),
    ...section(`Accepted  (${result.accepted.length})`, decisionLines(result.accepted)),
    ...section(`Superseded  (${result.superseded.length})`, decisionLines(result.superseded)),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// workspace_changes
// ---------------------------------------------------------------------------

export interface WorkspaceChangesResult {
  version: typeof PROJECTION_VERSION;
  kind: "workspace_changes";
  workspaceId: string;
  fromCursor?: string;
  toCursor?: string;
  items: Contribution[];
  truncated: boolean;
}

export function buildWorkspaceChanges(
  context: WorkspaceContext,
  since?: string,
): WorkspaceChangesResult {
  if (since !== undefined && context.since !== undefined) {
    return {
      version: PROJECTION_VERSION,
      kind: "workspace_changes",
      workspaceId: context.workspace.id,
      fromCursor: since,
      toCursor: context.since.cursor,
      items: context.since.items,
      truncated: context.since.truncated,
    };
  }
  const newest = context.provenance.at(-1)?.id;
  return {
    version: PROJECTION_VERSION,
    kind: "workspace_changes",
    workspaceId: context.workspace.id,
    ...(newest === undefined ? {} : { toCursor: newest }),
    items: context.provenance,
    truncated: context.provenanceTruncated,
  };
}

export function formatWorkspaceChanges(result: WorkspaceChangesResult): string {
  const lines: string[] = [labeled("Workspace", result.workspaceId)];
  if (result.fromCursor !== undefined) {
    lines.push(labeled("From", result.fromCursor));
  }
  if (result.toCursor !== undefined) {
    lines.push(labeled("Cursor", result.toCursor));
  }
  if (result.items.length === 0) {
    lines.push(
      result.fromCursor === undefined ? "Changes   none recorded" : `Changes   no changes after ${result.fromCursor}`,
    );
    return lines.join("\n");
  }
  const note = result.truncated ? "; truncated" : "";
  lines.push(`Changes   ${countLabel(result.items.length, "contribution")}${note}`);
  lines.push(...result.items.map((item) => `  ${formatContributionDeltaLine(item)}`));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// workspace_inspect
// ---------------------------------------------------------------------------

export const INSPECT_KINDS = [
  "workspace",
  "agent",
  "goal",
  "task",
  "finding",
  "decision",
  "artifact",
  "contribution",
] as const;

export type InspectKind = (typeof INSPECT_KINDS)[number];

export interface WorkspaceInspectResult {
  version: typeof PROJECTION_VERSION;
  kind: "workspace_inspect";
  workspaceId: string;
  objectType: InspectKind;
  object: unknown;
}

export function buildWorkspaceInspect(
  workspaceId: string,
  objectType: InspectKind,
  object: unknown,
): WorkspaceInspectResult {
  return {
    version: PROJECTION_VERSION,
    kind: "workspace_inspect",
    workspaceId,
    objectType,
    object,
  };
}

const INSPECT_FIELDS: Record<InspectKind, readonly string[]> = {
  workspace: ["id", "name", "status", "teamId", "description", "createdBy", "createdAt", "updatedAt"],
  agent: ["id", "actorType", "name", "role", "harness", "humanOwnerId", "joinedAt"],
  goal: ["id", "title", "status", "description", "createdBy", "agentSessionId", "createdAt", "updatedAt"],
  task: ["id", "title", "status", "description", "assignee", "createdBy", "agentSessionId", "createdAt", "updatedAt"],
  finding: ["id", "summary", "detail", "confidence", "sourceArtifactId", "createdBy", "agentSessionId", "createdAt"],
  decision: ["id", "summary", "rationale", "status", "approvedBy", "createdBy", "agentSessionId", "createdAt", "updatedAt"],
  artifact: ["id", "type", "title", "uriOrPath", "createdBy", "agentSessionId", "createdAt"],
  contribution: ["id", "actor", "agentSessionId", "action", "objectType", "objectId", "payload", "createdAt"],
};

function renderFieldValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const actor = value as { actorId?: unknown; actorType?: unknown };
    if (typeof actor.actorId === "string" && typeof actor.actorType === "string") {
      return `${actor.actorId} (${actor.actorType})`;
    }
    return JSON.stringify(value);
  }
  return String(value);
}

export function formatWorkspaceInspect(result: WorkspaceInspectResult): string {
  const object = result.object as Record<string, unknown>;
  const lines: string[] = [
    labeled("Workspace", result.workspaceId),
    labeled("Kind", result.objectType),
  ];
  for (const field of INSPECT_FIELDS[result.objectType]) {
    const rendered = renderFieldValue(object?.[field]);
    if (rendered !== undefined) {
      lines.push(labeled(field, rendered));
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// cli_command_manifest
// ---------------------------------------------------------------------------

export interface CliCommandManifestEntry {
  name: string;
  description: string;
  usage: string;
  mutates: boolean;
  workspaceScoped: boolean;
  outputModes: readonly CliOutputMode[];
  protocol: boolean;
  variants?: readonly {selector:string;usage:string;mutates:boolean;outputModes:readonly CliOutputMode[]}[];
  related?: readonly string[];
}

export interface CliCommandManifest {
  version: typeof PROJECTION_VERSION;
  kind: "cli_command_manifest";
  manifestVersion: typeof PROJECTION_VERSION;
  campfireVersion: string;
  commands: CliCommandManifestEntry[];
}

export function buildCommandManifest(campfireVersion: string): CliCommandManifest {
  return {
    version: PROJECTION_VERSION,
    kind: "cli_command_manifest",
    manifestVersion: PROJECTION_VERSION,
    campfireVersion,
    commands: CLI_COMMAND_NAMES.map((name) => {
      const entry = CLI_CATALOG[name];
      return {
        name: entry.name,
        description: entry.description,
        usage: entry.usage,
        mutates: entry.mutates,
        workspaceScoped: entry.workspaceScoped,
        outputModes: entry.outputModes,
        protocol: entry.protocol,
        ...(entry.variants===undefined?{}:{variants:entry.variants}),
        ...(entry.related === undefined ? {} : { related: entry.related }),
      };
    }),
  };
}

export function formatCommandManifest(manifest: CliCommandManifest): string {
  const lines = [`Campfire CLI ${manifest.campfireVersion}  (manifest ${manifest.manifestVersion})`];
  for (const group of CLI_GROUPS) {
    const entries = manifest.commands.filter(
      (entry) => CLI_CATALOG[entry.name as keyof typeof CLI_CATALOG]?.group === group,
    );
    if (entries.length === 0) continue;
    lines.push("", `${GROUP_TITLES[group]}:`);
    for (const entry of entries) {
      lines.push(`  campfire ${entry.name}  ${entry.description}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// telemetry_status
// ---------------------------------------------------------------------------

/**
 * Where the effective preference came from. `env` wins over a stored
 * preference so CI can guarantee silence without mutating operator state.
 */
export type TelemetryPreferenceSource = "env" | "preference" | "default";

export interface TelemetryEndpoint {
  /** Absent when the configured endpoint failed validation. */
  url?: string;
  source?: "env" | "default";
  /** False disables delivery rather than repairing a bad endpoint by guessing. */
  valid: boolean;
}

export interface TelemetryStatusInput {
  enabled: boolean;
  source: TelemetryPreferenceSource;
  /** Absent until an installation id exists; reading status never creates one. */
  installationId?: string;
  activatedOn?: string;
  lastActiveOn?: string;
  endpoint: TelemetryEndpoint;
}

export interface TelemetryStatusResult {
  version: typeof PROJECTION_VERSION;
  kind: "telemetry_status";
  enabled: boolean;
  source: TelemetryPreferenceSource;
  installation?: {
    /** Random local UUID. An installation, never a person. */
    id: string;
    activatedOn?: string;
    lastActiveOn?: string;
  };
  endpoint: TelemetryEndpoint;
  next: Array<{ command: string; when: string }>;
}

export function buildTelemetryStatus(input: TelemetryStatusInput): TelemetryStatusResult {
  const next: Array<{ command: string; when: string }> = input.enabled
    ? [{ command: "campfire telemetry disable", when: "Stop anonymous product telemetry" }]
    : [{ command: "campfire telemetry enable", when: "Send anonymous product telemetry" }];
  return {
    version: PROJECTION_VERSION,
    kind: "telemetry_status",
    enabled: input.enabled,
    source: input.source,
    ...(input.installationId === undefined
      ? {}
      : {
          installation: {
            id: input.installationId,
            ...(input.activatedOn === undefined ? {} : { activatedOn: input.activatedOn }),
            ...(input.lastActiveOn === undefined ? {} : { lastActiveOn: input.lastActiveOn }),
          },
        }),
    endpoint: input.endpoint,
    next,
  };
}

function telemetryInstallationLabel(installation: TelemetryStatusResult["installation"]): string {
  if (installation === undefined) {
    return "none yet (created on the first reported event)";
  }
  return joinFields(
    installation.id,
    installation.activatedOn === undefined ? undefined : `activated ${installation.activatedOn}`,
    installation.lastActiveOn === undefined ? undefined : `last active ${installation.lastActiveOn}`,
    "(this installation, not a person)",
  );
}

function telemetryEndpointLabel(endpoint: TelemetryEndpoint): string {
  if (!endpoint.valid) {
    // The configured value is never echoed: a URL can carry an operator secret.
    return "unusable; delivery is disabled";
  }
  return joinFields(endpoint.url, endpoint.source === undefined ? undefined : `(${endpoint.source})`);
}

export function formatTelemetryStatus(result: TelemetryStatusResult): string {
  const lines = [
    labeled("Telemetry", result.enabled ? "enabled" : "disabled", `(${result.source})`),
    labeled("Install", telemetryInstallationLabel(result.installation)),
    labeled("Endpoint", telemetryEndpointLabel(result.endpoint)),
  ];
  for (const step of result.next) {
    lines.push(joinFields(step.command.padEnd(HEADER_LABEL_WIDTH), step.when));
  }
  return lines.join("\n");
}
