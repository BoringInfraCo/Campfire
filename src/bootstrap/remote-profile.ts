import { chmodSync, closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { ValidationError } from "../domain/errors.js";
import {
  loadAnyProfile, loadCredentials, resolveProfilePaths,
  type CampfireCredentials, type ProfileAgent, type ProfilePaths, type RemoteCampfireProfile,
} from "./profile.js";
import { canonicalEndpoint } from "./endpoint.js";
export { canonicalEndpoint } from "./endpoint.js";

export interface PersistRemoteProfileInput {
  url: string;
  humanId: string;
  humanName: string;
  workspaceId: string;
  workspaceName?: string;
  goalTitle?: string;
  humanToken: string;
  agents: Array<ProfileAgent & { token: string }>;
  allowLoopbackHttp?: boolean;
}

function failure(message: string, field: string, nextAction: string): never {
  throw new ValidationError(message, { field, nextAction });
}

function profileConflict(): never {
  return failure("Campfire profile or credential conflict; use an isolated CAMPFIRE_CONFIG_DIR", "profile", "use_isolated_profile");
}

function nonempty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 4096 || /[\r\n\0]/.test(value)) {
    failure("Remote profile field is missing or invalid", field, "check_enrollment_receipt");
  }
}

export function loadRemoteProfile(env: NodeJS.ProcessEnv = process.env): RemoteCampfireProfile | undefined {
  const profile = loadAnyProfile(env);
  return profile?.mode === "remote" ? profile : undefined;
}

export function selectProfileAgent(profile: RemoteCampfireProfile, harness: string): ProfileAgent {
  const agent = profile.agents.find((entry) => entry.harness === harness);
  if (agent === undefined) {
    failure("No enrolled recipient agent for the selected harness", "harness", "enroll_selected_harness");
  }
  return agent;
}

export function recipientHandoffNames(profile: RemoteCampfireProfile, harness: string): {
  humanName: string; agentName: string; agentId: string;
} {
  const agent = selectProfileAgent(profile, harness);
  return { humanName: profile.humanName, agentName: agent.name, agentId: agent.id };
}

export interface RemoteAccess {
  url: string;
  token: string;
  workspaceId: string;
  profile: RemoteCampfireProfile;
  agent?: ProfileAgent;
}

/** Human CLI/proxy only. MCP receives an explicit agent token from its harness. */
export function resolveRemoteAccess(
  input: { url?: string; token?: string; harness?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): RemoteAccess {
  const profile = loadRemoteProfile(env);
  if (profile === undefined) failure("No remote Campfire profile", "profile", "join_with_invitation_file");
  const url = canonicalEndpoint(input.url ?? (env.CAMPFIRE_URL?.trim() || profile.url), { allowLoopbackHttp: true });
  const explicit = input.token ?? env.CAMPFIRE_TOKEN?.trim();
  const agent = input.harness === undefined ? undefined : selectProfileAgent(profile, input.harness);
  let token: string;
  if (explicit !== undefined && explicit.length > 0) {
    nonempty(explicit, "token");
    token = explicit;
  } else {
    if (url !== profile.url) {
      failure("Endpoint override requires an explicit credential; stored credentials remain bound to the enrolled endpoint", "endpoint", "supply_override_credential");
    }
    const credentials = loadCredentials(env);
    if (credentials?.endpoint !== profile.url || credentials.humanId !== profile.humanId || credentials.workspaceId !== profile.workspaceId ||
        agent !== undefined && credentials.agentIds?.[agent.harness] !== agent.id) {
      failure("Remote credential endpoint does not match the enrolled profile", "credentials", "recover_enrollment_credentials");
    }
    const stored = input.harness === undefined ? credentials.humanToken : credentials.agents?.[input.harness];
    if (stored === undefined || stored.trim().length === 0) {
      failure("Missing enrolled recipient credential", "credentials", "recover_enrollment_credentials");
    }
    token = stored;
  }
  return { url, token, workspaceId: profile.workspaceId, profile, ...(agent === undefined ? {} : { agent }) };
}

function writeJson(path: string, value: unknown, replace: boolean, secret: boolean): void {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  const temporary = `${path}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", secret ? 0o600 : 0o644);
    writeFileSync(fd, contents);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    // Publishing a new receipt uses an atomic no-overwrite link. A partial
    // write never becomes the only saved credential bundle on a failed retry.
    if (replace) renameSync(temporary, path);
    else linkSync(temporary, path);
    if (secret) chmodSync(path, 0o600);
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporary, { force: true });
  }
}

/** Preflight before server redemption. It never changes an existing local profile. */
export function assertRemoteProfileAvailable(
  input: Pick<PersistRemoteProfileInput, "url" | "humanId" | "workspaceId">,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const profile = loadAnyProfile(env);
  if (profile !== undefined && (profile.mode !== "remote" || profile.url !== canonicalEndpoint(input.url, { allowLoopbackHttp: true }) ||
      profile.humanId !== input.humanId || profile.workspaceId !== input.workspaceId)) profileConflict();
}

/** Persist prepared credentials before the nonsecret receipt so failure is recoverable. */
function persistRemoteProfileFiles(input: PersistRemoteProfileInput, env: NodeJS.ProcessEnv): ProfilePaths {
  const url = canonicalEndpoint(input.url, { allowLoopbackHttp: input.allowLoopbackHttp });
  for (const field of ["humanId", "humanName", "workspaceId", "humanToken"] as const) nonempty(input[field], field);
  if (input.workspaceName !== undefined) nonempty(input.workspaceName, "workspaceName");
  if (input.goalTitle !== undefined) nonempty(input.goalTitle, "goalTitle");
  if (!Array.isArray(input.agents) || input.agents.length < 1 || input.agents.length > 2) profileConflict();
  for (const agent of input.agents) {
    for (const field of ["id", "name", "harness", "token"] as const) nonempty(agent[field], field);
    if (agent.harness !== "codex" && agent.harness !== "opencode") failure("Unsupported enrolled harness", "harness", "select_supported_harness");
  }
  if (new Set(input.agents.map((agent) => agent.harness)).size !== input.agents.length ||
      new Set(input.agents.map((agent) => agent.id)).size !== input.agents.length) profileConflict();
  assertRemoteProfileAvailable({ url, humanId: input.humanId, workspaceId: input.workspaceId }, env);
  const existing = loadRemoteProfile(env);
  const prior = loadCredentials(env);
  if (prior !== undefined && (prior.endpoint !== url || prior.humanToken !== input.humanToken ||
      prior.humanId !== input.humanId || prior.workspaceId !== input.workspaceId)) profileConflict();
  // An orphan secret file can be recovered only using the identical prepared
  // credential bundle, never adopted as another identity's credential store.
  const agents = [...(existing?.agents ?? [])];
  const tokens = { ...(prior?.agents ?? {}) };
  const agentIds = { ...(prior?.agentIds ?? {}) };
  for (const agent of input.agents) {
    const known = agents.find((entry) => entry.harness === agent.harness);
    if (known !== undefined && known.id !== agent.id || agentIds[agent.harness] !== undefined && agentIds[agent.harness] !== agent.id ||
        tokens[agent.harness] !== undefined && tokens[agent.harness] !== agent.token) profileConflict();
    if (known === undefined) agents.push({ id: agent.id, name: agent.name, harness: agent.harness });
    tokens[agent.harness] = agent.token;
    agentIds[agent.harness] = agent.id;
  }
  if (new Set(agents.map((agent) => agent.id)).size !== agents.length) profileConflict();
  if (existing === undefined && prior !== undefined && Object.keys(prior.agents ?? {}).some((harness) => !input.agents.some((agent) => agent.harness === harness))) profileConflict();
  const profile: RemoteCampfireProfile = {
    version: 2, mode: "remote", url,
    humanId: input.humanId, humanName: input.humanName,
    workspaceId: input.workspaceId,
    ...(input.workspaceName ?? existing?.workspaceName ? { workspaceName: input.workspaceName ?? existing?.workspaceName } : {}),
    ...(input.goalTitle ?? existing?.goalTitle ? { goalTitle: input.goalTitle ?? existing?.goalTitle } : {}),
    agents,
  };
  const credentials: CampfireCredentials = { endpoint: url, humanId: input.humanId, workspaceId: input.workspaceId,
    agentIds, humanToken: input.humanToken, agents: tokens };
  const paths = resolveProfilePaths(env);
  mkdirSync(paths.configDir, { recursive: true, mode: 0o700 });
  // Refuse replacement if a different process wrote between validation and IO.
  if (existing !== undefined && !existsSync(paths.configPath)) profileConflict();
  writeJson(paths.credentialsPath, credentials, prior !== undefined, true);
  writeJson(paths.configPath, profile, existing !== undefined, false);
  const directory = openSync(paths.configDir, "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
  return paths;
}

export function persistRemoteProfile(input: PersistRemoteProfileInput, env: NodeJS.ProcessEnv = process.env): ProfilePaths {
  try {
    return persistRemoteProfileFiles(input, env);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    failure("Enrollment credentials or profile could not be durably saved; retry with the original pending enrollment", "profile", "recover_pending_enrollment");
  }
}
