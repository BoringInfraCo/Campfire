/**
 * Hosted-first workspace creation and the confirmed local-to-hosted invite.
 *
 * Publication stays in `publishWorkspace`. An invitation is issued only after
 * that call returns a cut-over receipt, which is the single writable authority.
 */
import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { ValidationError, CampfireError } from "../domain/errors.js";
import type { EnrollmentHarness, IssuedEnrollmentInvitation, OwnedAgentReceipt } from "../domain/enrollment.js";
import type { Workspace } from "../domain/types.js";
import { canonicalEndpoint } from "../bootstrap/endpoint.js";
import { saveInvitationFile } from "../bootstrap/enrollment-client.js";
import {
  activateJoinProfile,
  joinProfileEnvironment,
  loadAnyProfile,
  loadCredentials,
  resolveProfilePaths,
  type ProfileAgent,
} from "../bootstrap/profile.js";
import { loadRemoteProfile } from "../bootstrap/remote-profile.js";
import { installedCampfireVersion } from "../bootstrap/version.js";
import { loadConfig } from "../config.js";
import { campfireHttpCall } from "../http/client.js";
import { publishWorkspace, type PublishResult } from "../publication/publish.js";
import { persistPublishedProfile } from "../publication/profile-cutover.js";
import { createRuntime } from "../runtime.js";
import { generateRawToken, hashToken } from "../service/tokens.js";

export const HOSTED_PRODUCT_ORIGIN = "https://boringinfra.company/campfire";

/** Test seam: invite confirmation can observe publication without a second importer. */
export const hostedPublish = {
  run: publishWorkspace,
};

type HostedCall = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export interface HostedCredential {
  endpoint: string;
  token: string;
  humanId?: string;
  humanName?: string;
}

export function hostedStorageLine(endpoint: string): string {
  return `Structured work for this shared workspace will be stored at ${endpoint}.`;
}

export function hostMoveExplanation(endpoint: string): string {
  return `Inviting will host this workspace at ${endpoint}, move structured records, not move private chat transcripts, keep the local database as a recoverable backup, and freeze local writes during finalization so only one copy stays writable.`;
}

export function admissionRequired(env?: NodeJS.ProcessEnv): ValidationError {
  const base = "A shared workspace is hosted, and operator admission is still required. No local workspace was created.";
  const saved = env === undefined ? undefined : savedProductProfileId(env);
  const message = saved === undefined
    ? base
    : `${base} A saved profile for ${HOSTED_PRODUCT_ORIGIN} was not selected. Select it with \`campfire profiles use ${saved}\`.`;
  return new ValidationError(message, { field: "credential", nextAction: "hosted_admission_required" });
}

export function parsePlacementAnswer(answer: string): "hosted" | "local" {
  const value = answer.trim().toLowerCase();
  if (value === "hosted") return "hosted";
  if (value === "local" || value === "local-only") return "local";
  throw new ValidationError("Choose hosted or local-only. No workspace was created.", { field: "mode" });
}

export async function promptWorkspacePlacement(
  stdin: NodeJS.ReadStream = process.stdin,
  stdout: NodeJS.WriteStream = process.stdout,
): Promise<"hosted" | "local"> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(
      "Create a hosted shared workspace, or a local-only workspace? Type hosted or local-only: ",
    );
    return parsePlacementAnswer(answer);
  } finally {
    rl.close();
  }
}

function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const hostname = new URL(endpoint).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}

/** Product origin, or a loopback test endpoint. Any other URL is refused before a write. */
export function assertHostedTarget(endpoint: string, allowLoopback: boolean): void {
  if (endpoint === HOSTED_PRODUCT_ORIGIN) return;
  if (allowLoopback && isLoopbackEndpoint(endpoint)) return;
  throw new ValidationError(
    `A shared workspace is hosted at ${HOSTED_PRODUCT_ORIGIN}. --url is accepted only for a loopback test together with --allow-loopback. Nothing was uploaded.`,
    { field: "url", nextAction: "use_hosted_origin" },
  );
}

export async function promptConfirmHost(
  endpoint: string,
  stdin: NodeJS.ReadStream = process.stdin,
  stdout: NodeJS.WriteStream = process.stdout,
): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`${hostMoveExplanation(endpoint)}\nHost this workspace and invite? [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export async function resolveWorkspacePlacement(input: {
  hosted: boolean;
  local: boolean;
  stdinIsTty: boolean;
  prompt?: () => Promise<"hosted" | "local">;
}): Promise<"hosted" | "local" | "current"> {
  if (input.hosted && input.local) {
    throw new ValidationError("Choose either --hosted or --local. No workspace was created.", { field: "mode" });
  }
  if (input.hosted) return "hosted";
  if (input.local) return "local";
  if (input.stdinIsTty) return (input.prompt ?? promptWorkspacePlacement)();
  return "current";
}

export function resolveHostedCredential(
  input: { url?: string; token?: string; allowLoopback: boolean },
  env: NodeJS.ProcessEnv = process.env,
): HostedCredential | undefined {
  const remote = loadRemoteProfile(env);
  if (remote === undefined) return undefined;
  if (input.url !== undefined) {
    const requested = canonicalEndpoint(input.url, {
      allowLoopbackHttp: input.allowLoopback || isLoopbackEndpoint(remote.url),
    });
    if (requested !== remote.url) {
      throw new ValidationError(
        "The admitted profile endpoint cannot be replaced by --url. No workspace was created.",
        { field: "url", nextAction: "use_admitted_profile" },
      );
    }
  }
  const credentials = loadCredentials(env);
  if (credentials?.endpoint !== remote.url || credentials.humanId !== remote.humanId || credentials.humanToken.trim().length === 0) {
    return undefined;
  }
  // input.token is intentionally ignored. The admitted profile credential is the only human token.
  return {
    endpoint: remote.url,
    token: credentials.humanToken,
    humanId: remote.humanId,
    humanName: remote.humanName,
  };
}

function unconfirmed(endpoint: string): ValidationError {
  return new ValidationError(hostMoveExplanation(endpoint), {
    field: "confirm-host",
    nextAction: "confirm_host_workspace",
  });
}

function notVerified(): ValidationError {
  return new ValidationError("The hosted copy was not verified, so no invitation was issued.", {
    field: "publication",
    nextAction: "retry_publish",
  });
}

export async function afterVerifiedCutover<T>(
  publish: () => Promise<{ receipt: { state: string } }>,
  issue: () => Promise<T>,
): Promise<T> {
  const result = await publish();
  if (result.receipt.state !== "cut_over") throw notVerified();
  return issue();
}

async function teamFromWorkspace(call: HostedCall, workspaceId: string): Promise<string | undefined> {
  const view = await call("get_workspace", { workspaceId }) as { workspace?: { teamId?: string } };
  const teamId = view.workspace?.teamId;
  return typeof teamId === "string" && teamId.length > 0 ? teamId : undefined;
}

function admittedTeamRequired(): ValidationError {
  return new ValidationError(
    "Campfire could not see this hosted human's team. Pass --team only when it is the team this human already belongs to. No workspace was created.",
    { field: "team", nextAction: "use_admitted_team" },
  );
}

async function hostedTeamId(call: HostedCall, explicit: string | undefined, currentWorkspaceId?: string): Promise<string> {
  if (currentWorkspaceId === undefined) throw admittedTeamRequired();
  const discovered = await teamFromWorkspace(call, currentWorkspaceId);
  if (discovered === undefined) throw admittedTeamRequired();
  if (explicit !== undefined && explicit !== discovered) {
    throw new ValidationError("That team does not match this hosted human's team. No workspace was created.", {
      field: "team",
      nextAction: "use_admitted_team",
    });
  }
  return discovered;
}

function hostedProfileKey(workspaceId: string): string {
  const safe = workspaceId.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 100);
  if (safe.length === 0) {
    throw new ValidationError("Hosted workspace id cannot select a profile.", { field: "workspaceId" });
  }
  return `ein_${safe}`;
}

function matchingHostedAgents(
  endpoint: string,
  humanId: string,
  env: NodeJS.ProcessEnv,
): Array<ProfileAgent & { token: string }> {
  const profile = loadAnyProfile(env);
  const credentials = loadCredentials(env);
  if (profile?.mode !== "remote" || profile.url !== endpoint || profile.humanId !== humanId) return [];
  if (credentials?.endpoint !== endpoint || credentials.humanId !== humanId) return [];
  const agents: Array<ProfileAgent & { token: string }> = [];
  for (const agent of profile.agents) {
    if (agent.harness !== "codex" && agent.harness !== "opencode") continue;
    const token = credentials.agents?.[agent.harness];
    if (token === undefined || credentials.agentIds?.[agent.harness] !== agent.id) continue;
    agents.push({ ...agent, token });
  }
  return agents.slice(0, 16);
}

/** Test seam. Production calls the hosted HTTP client with the actor token. */
export type HostedTokenCall = (
  token: string,
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

interface PendingHostedAgent {
  version: 1;
  workspaceId: string;
  endpoint: string;
  humanId: string;
  harness: EnrollmentHarness;
  requestId: string;
  token: string;
  tokenHash: string;
}

function hostedAgentAccessError(workspaceId: string, cause?: unknown): ValidationError {
  const detail = cause instanceof Error ? cause.message : "";
  const safe = detail.length > 0 && !/cft_|cfe_|bearer|token/i.test(detail) ? ` ${detail}` : "";
  return new ValidationError(
    `Hosted workspace ${workspaceId} was created, but its agent could not read it, so the active profile was not changed. The server workspace may already exist. No local workspace was created.${safe}`,
    { field: "agent", nextAction: "retry_hosted_create", workspaceId },
  );
}

function isExistingMembershipConflict(error: unknown): boolean {
  return error instanceof CampfireError && error.code === "Conflict" &&
    (error.message.includes("already a participant") || error.message.includes("already has an open invite"));
}

function workspaceReadable(result: unknown, workspaceId: string): boolean {
  if (typeof result !== "object" || result === null) return false;
  const record = result as { id?: unknown; workspace?: { id?: unknown } };
  return record.workspace?.id === workspaceId || record.id === workspaceId;
}

async function hostedTokenCall(
  endpoint: string,
  token: string,
  method: string,
  params: Record<string, unknown>,
  call: HostedTokenCall | undefined,
): Promise<unknown> {
  if (call !== undefined) return call(token, method, params);
  return campfireHttpCall({ baseUrl: endpoint, token, method, params });
}

function enrollHarness(agents: ProfileAgent[]): EnrollmentHarness {
  const names = new Set(agents.map((agent) => agent.harness));
  if (names.size === 1 && names.has("opencode")) return "opencode";
  return "codex";
}

function pendingHostedAgentPath(env: NodeJS.ProcessEnv, workspaceId: string): string {
  return join(resolveProfilePaths(env).configDir, `pending-hosted-agent-${hostedProfileKey(workspaceId)}.json`);
}

function flushDirectory(directory: string): void {
  const fd = openSync(directory, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function writePrivateFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, contents);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
    chmodSync(path, 0o600);
    flushDirectory(dirname(path));
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporary, { force: true });
  }
}

function loadPendingHostedAgent(path: string, workspaceId: string): PendingHostedAgent | undefined {
  if (!existsSync(path)) return undefined;
  let stat;
  try { stat = lstatSync(path); } catch {
    throw new ValidationError("Saved hosted agent enrollment could not be read. The active profile was not changed.", {
      field: "agent", nextAction: "retry_hosted_create", workspaceId,
    });
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > 8192 || (stat.mode & 0o077) !== 0) {
    throw new ValidationError("Saved hosted agent enrollment must stay a private file. The active profile was not changed.", {
      field: "agent", nextAction: "retry_hosted_create", workspaceId,
    });
  }
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, "utf8")); } catch {
    throw new ValidationError("Saved hosted agent enrollment is not reusable. The active profile was not changed.", {
      field: "agent", nextAction: "retry_hosted_create", workspaceId,
    });
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new ValidationError("Saved hosted agent enrollment is not reusable. The active profile was not changed.", {
      field: "agent", nextAction: "retry_hosted_create", workspaceId,
    });
  }
  const pending = parsed as Partial<PendingHostedAgent>;
  if (pending.version !== 1 || pending.workspaceId !== workspaceId ||
      (pending.harness !== "codex" && pending.harness !== "opencode") ||
      typeof pending.endpoint !== "string" || typeof pending.humanId !== "string" ||
      typeof pending.requestId !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(pending.requestId) ||
      typeof pending.token !== "string" || !/^cft_[a-f0-9]{32}$/.test(pending.token) ||
      pending.tokenHash !== hashToken(pending.token)) {
    throw new ValidationError("Saved hosted agent enrollment is not reusable. The active profile was not changed.", {
      field: "agent", nextAction: "retry_hosted_create", workspaceId,
    });
  }
  return pending as PendingHostedAgent;
}

function preparePendingHostedAgent(
  env: NodeJS.ProcessEnv,
  input: { workspaceId: string; endpoint: string; humanId: string; harness: EnrollmentHarness },
): PendingHostedAgent {
  const path = pendingHostedAgentPath(env, input.workspaceId);
  const existing = loadPendingHostedAgent(path, input.workspaceId);
  if (existing !== undefined) {
    if (existing.endpoint !== input.endpoint || existing.humanId !== input.humanId) {
      throw new ValidationError("Saved hosted agent enrollment does not match this profile. The active profile was not changed.", {
        field: "agent", nextAction: "retry_hosted_create", workspaceId: input.workspaceId,
      });
    }
    return existing;
  }
  const token = generateRawToken();
  const pending: PendingHostedAgent = {
    version: 1,
    workspaceId: input.workspaceId,
    endpoint: input.endpoint,
    humanId: input.humanId,
    harness: input.harness,
    requestId: randomUUID(),
    token,
    tokenHash: hashToken(token),
  };
  writePrivateFile(path, `${JSON.stringify(pending, null, 2)}\n`);
  return pending;
}

async function grantExistingAgent(
  input: { endpoint: string; workspaceId: string; humanToken: string; call?: HostedTokenCall },
  agent: ProfileAgent & { token: string },
): Promise<void> {
  const call = (token: string, method: string, params: Record<string, unknown>) =>
    hostedTokenCall(input.endpoint, token, method, params, input.call);
  try {
    await call(input.humanToken, "invite_workspace", {
      workspaceId: input.workspaceId,
      actor: { actorId: agent.id, actorType: "agent" },
      role: "agent",
    });
  } catch (error) {
    if (!isExistingMembershipConflict(error)) throw error;
  }
  try {
    await call(agent.token, "join_workspace", { workspaceId: input.workspaceId });
  } catch (error) {
    if (!isExistingMembershipConflict(error)) throw error;
  }
  const view = await call(agent.token, "get_workspace", { workspaceId: input.workspaceId });
  if (!workspaceReadable(view, input.workspaceId)) {
    throw new ValidationError("The agent could not read the new hosted workspace.", { field: "agent" });
  }
}

async function enrollOwnedWorkspaceAgent(
  input: {
    endpoint: string;
    humanId: string;
    workspaceId: string;
    humanToken: string;
    harness: EnrollmentHarness;
    call?: HostedTokenCall;
  },
  env: NodeJS.ProcessEnv,
): Promise<ProfileAgent & { token: string }> {
  const pending = preparePendingHostedAgent(env, input);
  const call = (token: string, method: string, params: Record<string, unknown>) =>
    hostedTokenCall(input.endpoint, token, method, params, input.call);
  const receipt = await call(input.humanToken, "enroll_owned_agent", {
    workspaceId: input.workspaceId,
    requestId: pending.requestId,
    harness: pending.harness,
    tokenHash: pending.tokenHash,
  }) as OwnedAgentReceipt;
  if (receipt.workspaceId !== input.workspaceId || receipt.humanId !== input.humanId ||
      receipt.requestId !== pending.requestId || receipt.agent?.harness !== pending.harness ||
      typeof receipt.agent?.id !== "string" || receipt.agent.id.length === 0) {
    throw new ValidationError("Owned agent enrollment did not match this workspace.", { field: "agent" });
  }
  const identity = await call(pending.token, "whoami", {}) as { actor?: { actorId?: string; actorType?: string } };
  if (identity.actor?.actorId !== receipt.agent.id || identity.actor?.actorType !== "agent") {
    throw new ValidationError("Owned agent enrollment identity could not be verified.", { field: "agent" });
  }
  const view = await call(pending.token, "get_workspace", { workspaceId: input.workspaceId });
  if (!workspaceReadable(view, input.workspaceId)) {
    throw new ValidationError("The enrolled agent could not read the new hosted workspace.", { field: "agent" });
  }
  const name = typeof receipt.agent.name === "string" && receipt.agent.name.length > 0
    ? receipt.agent.name
    : pending.harness === "codex" ? "Codex" : "OpenCode";
  return { id: receipt.agent.id, name, harness: pending.harness, token: pending.token };
}

async function agentsForNewWorkspace(
  input: {
    endpoint: string;
    humanId: string;
    workspaceId: string;
    humanToken: string;
    call?: HostedTokenCall;
  },
  env: NodeJS.ProcessEnv,
): Promise<{ agents: Array<ProfileAgent & { token: string }>; enrolled: boolean }> {
  const existing = matchingHostedAgents(input.endpoint, input.humanId, env);
  if (existing.length > 0) {
    for (const agent of existing) await grantExistingAgent(input, agent);
    return { agents: existing, enrolled: false };
  }
  const profile = loadAnyProfile(env);
  const named = profile === undefined ? [] : profile.mode === "remote" ? profile.agents : profile.agents ?? [];
  const harness = enrollHarness(named);
  return { agents: [await enrollOwnedWorkspaceAgent({ ...input, harness }, env)], enrolled: true };
}

/**
 * Invite and join an existing agent, or enroll one owned agent, and prove that
 * agent can read the new workspace. Only then keep the previous profile and
 * select the new one. A failed read writes no new profile.
 */
export async function selectHostedWorkspaceProfile(
  input: {
    endpoint: string;
    humanId: string;
    humanName: string;
    workspaceId: string;
    workspaceName: string;
    humanToken: string;
    allowLoopbackHttp: boolean;
    call?: HostedTokenCall;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const remote = loadRemoteProfile(env);
  if (remote?.workspaceId === input.workspaceId && remote.url === input.endpoint && remote.humanId === input.humanId) {
    const existing = matchingHostedAgents(input.endpoint, input.humanId, env);
    if (existing.length === 0) throw hostedAgentAccessError(input.workspaceId);
    try {
      for (const agent of existing) await grantExistingAgent(input, agent);
    } catch (error) {
      throw error instanceof ValidationError && error.details?.nextAction === "retry_hosted_create"
        ? error
        : hostedAgentAccessError(input.workspaceId, error);
    }
    return;
  }
  const pendingPath = pendingHostedAgentPath(env, input.workspaceId);
  let prepared: { agents: Array<ProfileAgent & { token: string }>; enrolled: boolean };
  try {
    prepared = await agentsForNewWorkspace(input, env);
  } catch (error) {
    throw hostedAgentAccessError(input.workspaceId, error);
  }
  const current = loadAnyProfile(env);
  const credentials = loadCredentials(env);
  const key = hostedProfileKey(input.workspaceId);
  // Resolve the join directory before any profile write so a nested path is refused first.
  const target = current === undefined && credentials === undefined ? env : joinProfileEnvironment(env, key);
  if (target !== env) {
    const dir = target.CAMPFIRE_CONFIG_DIR;
    if (dir === undefined) throw hostedAgentAccessError(input.workspaceId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dirname(dir), 0o700);
    chmodSync(dir, 0o700);
  }
  try {
    persistPublishedProfile({
      url: input.endpoint,
      humanId: input.humanId,
      humanName: input.humanName,
      workspaceId: input.workspaceId,
      workspaceName: input.workspaceName,
      humanToken: input.humanToken,
      agents: prepared.agents,
      allowLoopbackHttp: input.allowLoopbackHttp,
    }, target);
    if (target !== env) activateJoinProfile(env, key);
  } catch (error) {
    throw hostedAgentAccessError(input.workspaceId, error);
  }
  if (prepared.enrolled) rmSync(pendingPath, { force: true });
}

function configBase(env: NodeJS.ProcessEnv): string {
  const home = env.HOME?.trim() || homedir();
  const configured = env.CAMPFIRE_CONFIG_DIR?.trim();
  const dir = resolve(configured && configured.length > 0
    ? configured
    : join(env.XDG_CONFIG_HOME?.trim() || join(home, ".config"), "campfire"));
  if (basename(dirname(dir)) === "profiles" && /^join-ein_[A-Za-z0-9_.-]{1,124}$/.test(basename(dir))) {
    return dirname(dirname(dir));
  }
  return dir;
}

function savedProductProfileId(env: NodeJS.ProcessEnv): string | undefined {
  const base = configBase(env);
  let active = "default";
  const marker = join(base, "active-profile.json");
  if (existsSync(marker)) {
    try {
      const parsed = JSON.parse(readFileSync(marker, "utf8")) as { active?: unknown };
      if (typeof parsed.active === "string") active = parsed.active;
    } catch {
      active = "default";
    }
  }
  const product = (configPath: string): boolean => {
    try {
      const stat = lstatSync(configPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) return false;
      const parsed = JSON.parse(readFileSync(configPath, "utf8")) as { mode?: unknown; url?: unknown };
      return parsed.mode === "remote" && parsed.url === HOSTED_PRODUCT_ORIGIN;
    } catch {
      return false;
    }
  };
  if (active !== "default" && product(join(base, "config.json"))) return "default";
  const directory = join(base, "profiles");
  let names: string[] = [];
  try {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return undefined;
    names = readdirSync(directory);
  } catch {
    return undefined;
  }
  for (const id of names.sort()) {
    if (id === active || !/^join-ein_[A-Za-z0-9_.-]{1,124}$/.test(id)) continue;
    if (product(join(directory, id, "config.json"))) return id;
  }
  return undefined;
}

function withProfileHint(error: ValidationError, env: NodeJS.ProcessEnv): ValidationError {
  if (error.message.includes("campfire profiles use")) return error;
  const saved = savedProductProfileId(env);
  if (saved === undefined) return error;
  return new ValidationError(
    `${error.message} A saved profile for ${HOSTED_PRODUCT_ORIGIN} was not selected. Select it with \`campfire profiles use ${saved}\`.`,
    error.details,
  );
}

interface AdmittedHostedSession {
  endpoint: string;
  token: string;
  actorId: string;
  humanName?: string;
  teamId: string;
  call: HostedCall;
}

async function openAdmittedHostedSession(input: {
  url?: string;
  token?: string;
  teamId?: string;
  allowLoopback: boolean;
  env: NodeJS.ProcessEnv;
}): Promise<AdmittedHostedSession> {
  const credential = resolveHostedCredential({
    url: input.url,
    token: input.token,
    allowLoopback: input.allowLoopback,
  }, input.env);
  if (credential === undefined) throw admissionRequired(input.env);
  try {
    assertHostedTarget(credential.endpoint, input.allowLoopback);
  } catch (error) {
    if (error instanceof ValidationError) throw withProfileHint(error, input.env);
    throw error;
  }
  const call: HostedCall = (method, params) => campfireHttpCall({
    baseUrl: credential.endpoint,
    token: credential.token,
    method,
    params: params ?? {},
  });
  let who: { actor?: { actorId?: string; actorType?: string } };
  try {
    who = await call("whoami") as { actor?: { actorId?: string; actorType?: string } };
  } catch (error) {
    if (error instanceof CampfireError && error.code === "Unauthorized") throw admissionRequired(input.env);
    throw error;
  }
  if (who.actor?.actorType !== "human" || typeof who.actor.actorId !== "string" || who.actor.actorId.length === 0) {
    throw admissionRequired(input.env);
  }
  const teamId = await hostedTeamId(call, input.teamId, loadRemoteProfile(input.env)?.workspaceId);
  return {
    endpoint: credential.endpoint,
    token: credential.token,
    actorId: who.actor.actorId,
    humanName: credential.humanName,
    teamId,
    call,
  };
}

const RESUME_WORKSPACE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const MAX_OWNER_PAGES = 8;

function resumeIdRequired(): ValidationError {
  return new ValidationError("Pass the existing workspace id with --resume. No workspace was created.", { field: "resume" });
}

function resumeRefused(): ValidationError {
  return new ValidationError("That hosted workspace cannot be resumed. Nothing was changed.", { field: "workspace" });
}

interface ParticipantPage {
  items?: Array<{ role?: string; name?: string; actor?: { actorId?: string; actorType?: string } }>;
  nextCursor?: string;
}

function ownerOnPage(page: ParticipantPage, humanId: string): boolean {
  return page.items?.some((item) =>
    item.role === "owner" && item.actor?.actorType === "human" && item.actor.actorId === humanId,
  ) === true;
}

async function humanOwnsWorkspace(call: HostedCall, workspaceId: string, humanId: string): Promise<boolean> {
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_OWNER_PAGES; pageNumber += 1) {
    const page = await call("list_workspace_participants", {
      workspaceId,
      ...(cursor === undefined ? {} : { cursor }),
    }) as ParticipantPage;
    if (ownerOnPage(page, humanId)) return true;
    const next = typeof page.nextCursor === "string" && page.nextCursor.length > 0 ? page.nextCursor : undefined;
    if (next === undefined || seen.has(next)) return false;
    seen.add(next);
    cursor = next;
  }
  return false;
}

async function loadResumableWorkspace(call: HostedCall, workspaceId: string, teamId: string, humanId: string): Promise<Workspace> {
  let view: { workspace?: Partial<Workspace> };
  try {
    view = await call("get_workspace", { workspaceId }) as { workspace?: Partial<Workspace> };
  } catch (error) {
    if (error instanceof CampfireError && (error.code === "WorkspaceNotFound" || error.code === "Unauthorized" || error.code === "ParticipantRequired")) {
      throw resumeRefused();
    }
    throw error;
  }
  const workspace = view.workspace;
  if (workspace?.id !== workspaceId || workspace.teamId !== teamId || workspace.status !== "active" ||
      typeof workspace.name !== "string" || workspace.name.length === 0) {
    throw resumeRefused();
  }
  let owner = false;
  try {
    owner = await humanOwnsWorkspace(call, workspaceId, humanId);
  } catch (error) {
    if (error instanceof CampfireError) throw resumeRefused();
    throw error;
  }
  if (!owner) throw resumeRefused();
  return workspace as Workspace;
}

async function hostedHumanName(session: AdmittedHostedSession, workspaceId: string, env: NodeJS.ProcessEnv): Promise<string> {
  const remote = loadRemoteProfile(env);
  let humanName = remote?.humanId === session.actorId ? remote.humanName : session.humanName;
  if (humanName === undefined || remote?.humanId !== session.actorId) {
    const page = await session.call("list_workspace_participants", { workspaceId }) as ParticipantPage;
    const self = page.items?.find((item) => item.actor?.actorId === session.actorId && item.actor?.actorType === "human");
    if (typeof self?.name === "string" && self.name.length > 0) humanName = self.name;
  }
  if (humanName === undefined) throw hostedAgentAccessError(workspaceId);
  return humanName;
}

export async function createHostedWorkspace(
  input: {
    name: string;
    teamId?: string;
    description?: string;
    url?: string;
    token?: string;
    allowLoopback: boolean;
    env?: NodeJS.ProcessEnv;
    onBeforeWrite?: (endpoint: string) => void;
  },
): Promise<Workspace> {
  const env = input.env ?? process.env;
  const session = await openAdmittedHostedSession({
    url: input.url,
    token: input.token,
    teamId: input.teamId,
    allowLoopback: input.allowLoopback,
    env,
  });
  input.onBeforeWrite?.(session.endpoint);
  const workspace = await session.call("create_workspace", {
    teamId: session.teamId,
    name: input.name,
    ...(input.description === undefined ? {} : { description: input.description }),
  }) as Workspace;
  const humanName = await hostedHumanName(session, workspace.id, env);
  await selectHostedWorkspaceProfile({
    endpoint: session.endpoint,
    humanId: session.actorId,
    humanName,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    humanToken: session.token,
    allowLoopbackHttp: input.allowLoopback,
  }, env);
  return workspace;
}

/**
 * Finish agent access for a workspace that already exists. Does not call
 * create_workspace, rename the workspace, or create a team, human, or account.
 */
export async function resumeHostedWorkspace(
  input: {
    workspaceId: string;
    teamId?: string;
    url?: string;
    token?: string;
    allowLoopback: boolean;
    env?: NodeJS.ProcessEnv;
    onBeforeAgent?: (endpoint: string) => void;
  },
): Promise<Workspace> {
  if (!RESUME_WORKSPACE_ID.test(input.workspaceId)) throw resumeIdRequired();
  const env = input.env ?? process.env;
  const session = await openAdmittedHostedSession({
    url: input.url,
    token: input.token,
    teamId: input.teamId,
    allowLoopback: input.allowLoopback,
    env,
  });
  const workspace = await loadResumableWorkspace(session.call, input.workspaceId, session.teamId, session.actorId);
  const humanName = await hostedHumanName(session, workspace.id, env);
  input.onBeforeAgent?.(session.endpoint);
  await selectHostedWorkspaceProfile({
    endpoint: session.endpoint,
    humanId: session.actorId,
    humanName,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    humanToken: session.token,
    allowLoopbackHttp: input.allowLoopback,
  }, env);
  return workspace;
}

function requireHostedInviteAccess(
  endpoint: string,
  workspaceId: string,
  env: NodeJS.ProcessEnv,
): { endpoint: string; token: string } {
  const remote = loadRemoteProfile(env);
  const credentials = loadCredentials(env);
  if (remote === undefined || remote.url !== endpoint || remote.workspaceId !== workspaceId ||
      credentials?.endpoint !== endpoint || credentials.humanToken.trim().length === 0) {
    throw notVerified();
  }
  return { endpoint: remote.url, token: credentials.humanToken };
}

export async function publishLocalForInvite(input: {
  endpoint: string;
  workspaceId: string;
  allowLoopbackHttp: boolean;
  rehearsalCode?: string;
  connect: boolean;
  mcpCommand?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<PublishResult> {
  const env = input.env ?? process.env;
  const profile = loadAnyProfile(env);
  if (profile === undefined || profile.mode === "remote") {
    throw new ValidationError("No local workspace is selected to host.", {
      field: "profile",
      nextAction: "confirm_host_workspace",
    });
  }
  const credentials = loadCredentials(env);
  if (credentials?.humanToken === undefined) {
    throw new ValidationError("Hosting this workspace requires the local human owner credential.", {
      field: "credentials",
      nextAction: "run_campfire_onboard",
    });
  }
  const config = loadConfig(env);
  mkdirSync(dirname(profile.databasePath), { recursive: true });
  const runtime = createRuntime({ ...config, databasePath: profile.databasePath });
  try {
    const actor = runtime.service.resolveToken(credentials.humanToken);
    if (actor.actorType !== "human" || actor.actorId !== profile.humanId) {
      throw new ValidationError("Only the current local human owner can host this workspace.", {
        field: "credentials",
        nextAction: "use_local_owner_credential",
      });
    }
  } finally {
    runtime.close();
  }
  return hostedPublish.run({
    endpoint: input.endpoint,
    databasePath: profile.databasePath,
    localUrl: profile.url,
    ownerHumanId: profile.humanId,
    ownerHumanName: profile.humanName,
    packageVersion: installedCampfireVersion(),
    workspaceId: input.workspaceId,
    allowLoopbackHttp: input.allowLoopbackHttp,
    connect: input.connect,
    dryRun: false,
    rehearsalCode: input.rehearsalCode,
    mcpCommand: input.mcpCommand,
    env,
  });
}

export async function hostLocalWorkspaceForInvite(input: {
  workspaceId: string;
  url?: string;
  allowLoopback: boolean;
  confirmed: boolean;
  stdinIsTty: boolean;
  rehearsalCode?: string;
  connect: boolean;
  requestId: string;
  outPath?: string;
  mcpCommand?: string;
  env?: NodeJS.ProcessEnv;
  prompt?: (endpoint: string) => Promise<boolean>;
  onBeforeWrite?: (endpoint: string) => void;
}): Promise<{ endpoint: string; invitation: IssuedEnrollmentInvitation; path?: string }> {
  const env = input.env ?? process.env;
  const endpoint = canonicalEndpoint(input.url ?? HOSTED_PRODUCT_ORIGIN, { allowLoopbackHttp: input.allowLoopback });
  assertHostedTarget(endpoint, input.allowLoopback);
  let confirmed = input.confirmed;
  if (!confirmed && input.stdinIsTty) confirmed = await (input.prompt ?? promptConfirmHost)(endpoint);
  if (!confirmed) throw unconfirmed(endpoint);
  input.onBeforeWrite?.(endpoint);
  const invitation = await afterVerifiedCutover(
    () => publishLocalForInvite({
      endpoint,
      workspaceId: input.workspaceId,
      allowLoopbackHttp: input.allowLoopback,
      rehearsalCode: input.rehearsalCode,
      connect: input.connect,
      mcpCommand: input.mcpCommand,
      env,
    }),
    async () => {
      const access = requireHostedInviteAccess(endpoint, input.workspaceId, env);
      return campfireHttpCall<IssuedEnrollmentInvitation>({
        baseUrl: access.endpoint,
        token: access.token,
        method: "issue_enrollment_invitation",
        params: { workspaceId: input.workspaceId, requestId: input.requestId },
      });
    },
  );
  let path: string | undefined;
  if (input.outPath !== undefined) {
    try {
      path = saveInvitationFile(input.outPath, invitation, endpoint, input.allowLoopback).path;
    } catch (error) {
      try {
        const access = requireHostedInviteAccess(endpoint, input.workspaceId, env);
        await campfireHttpCall({
          baseUrl: access.endpoint,
          token: access.token,
          method: "revoke_enrollment_invitation",
          params: { workspaceId: input.workspaceId, invitationId: invitation.invitationId },
        });
      } catch {
        // The caller still reports the file failure.
      }
      throw error;
    }
  }
  return { endpoint, invitation, ...(path === undefined ? {} : { path }) };
}
