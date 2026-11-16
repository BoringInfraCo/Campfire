/**
 * Local operator profile and credentials.
 *
 * Config is not secret. Credentials are mode 0600 and must never be logged,
 * put in the Viewer, or copied into a handoff. MCP must not read this file:
 * an agent process gets CAMPFIRE_TOKEN from its own harness env.
 */
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { ValidationError } from "../domain/errors.js";
import { formatLocalStatusReceipt } from "../presentation/receipts.js";
import { canonicalEndpoint } from "./endpoint.js";

export const PROFILE_VERSION = 1 as const;

export interface ProfileAgent {
  id: string;
  name: string;
  harness: string;
}

export interface CampfireProfile {
  version: typeof PROFILE_VERSION | 2;
  mode?: "local";
  databasePath: string;
  url: string;
  humanId: string;
  humanName: string;
  /** Set by the one-shot onboard path. Absent until an agent creates a workspace. */
  workspaceId?: string;
  workspaceName?: string;
  goalTitle?: string;
  agentId?: string;
  agentName?: string;
  harness?: string;
  /** Harnesses this human owns. Tokens stay in the credential file. */
  agents?: ProfileAgent[];
}

/** Remote enrollment records no local collaboration database. */
export interface RemoteCampfireProfile {
  version: 2;
  mode: "remote";
  url: string;
  humanId: string;
  humanName: string;
  workspaceId: string;
  workspaceName?: string;
  goalTitle?: string;
  agents: ProfileAgent[];
}

export type AnyCampfireProfile = CampfireProfile | RemoteCampfireProfile;

export interface CampfireCredentials {
  humanToken: string;
  /** Remote credentials are bound to the complete canonical API endpoint. */
  endpoint?: string;
  humanId?: string;
  workspaceId?: string;
  agentIds?: Record<string, string>;
  /** Single-agent onboard compatibility. Prefer `agents` when more than one harness is connected. */
  agentToken?: string;
  agents?: Record<string, string>;
}

export interface ProfilePaths {
  configDir: string;
  configPath: string;
  credentialsPath: string;
  dataDir: string;
  defaultDatabasePath: string;
}

function envDir(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function homeDir(env: NodeJS.ProcessEnv): string {
  return envDir(env, "HOME") ?? homedir();
}

function baseConfigDir(env: NodeJS.ProcessEnv): string {
  const home = homeDir(env);
  return resolve(
    envDir(env, "CAMPFIRE_CONFIG_DIR") ??
    join(envDir(env, "XDG_CONFIG_HOME") ?? join(home, ".config"), "campfire"),
  );
}

const DEFAULT_PROFILE_ID = "default";
const JOIN_PROFILE_ID = /^join-ein_[A-Za-z0-9_.-]{1,124}$/;
const ACTIVE_PROFILE_FILE = "active-profile.json";
const pinnedEnvironments = new WeakSet<object>();

function profileSelectionError(): never {
  throw new ValidationError("Campfire profile selection is invalid; the existing profile was not changed", {
    field: "profile", nextAction: "inspect_profile_selection",
  });
}

function joinedProfileDir(base: string, id: string): string {
  if (!JOIN_PROFILE_ID.test(id)) return profileSelectionError();
  return join(base, "profiles", id);
}

/** Joined profile directories are private; never chmod a pre-existing path. */
function assertPrivateDirectory(path: string, required = true): void {
  let stat;
  try { stat = lstatSync(path); } catch (error) {
    if (!required && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    return profileSelectionError();
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o077) !== 0) profileSelectionError();
}

/** Config is nonsecret inside a private directory; credentials are secret. */
function assertJoinedProfileFile(path: string, secret: boolean): void {
  let stat;
  try { stat = lstatSync(path); } catch { return profileSelectionError(); }
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & (secret ? 0o077 : 0o022)) !== 0) profileSelectionError();
}

function pathExists(path: string): boolean {
  try { lstatSync(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    return profileSelectionError();
  }
}

function isJoinedProfilePath(base: string): boolean {
  return basename(dirname(base)) === "profiles" && JOIN_PROFILE_ID.test(basename(base));
}

function activeProfileId(base: string): string {
  const marker = join(base, ACTIVE_PROFILE_FILE);
  if (!pathExists(marker)) return DEFAULT_PROFILE_ID;
  // An explicitly selected child is already resolved. A nested marker is
  // never followed, even if it was introduced by a damaged or foreign file.
  if (isJoinedProfilePath(base)) return profileSelectionError();
  let value: unknown;
  try {
    const stat = lstatSync(marker);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096 || (stat.mode & 0o077) !== 0) return profileSelectionError();
    value = JSON.parse(readFileSync(marker, "utf8"));
  } catch { return profileSelectionError(); }
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "active,version" || value.version !== 1 ||
      typeof value.active !== "string" || (value.active !== DEFAULT_PROFILE_ID && !JOIN_PROFILE_ID.test(value.active))) return profileSelectionError();
  return value.active;
}

export function resolveProfilePaths(env: NodeJS.ProcessEnv = process.env): ProfilePaths {
  const home = homeDir(env);
  const base = baseConfigDir(env);
  if (isJoinedProfilePath(base)) {
    // An explicit child environment can refer to an in-progress enrollment;
    // its directory may not exist yet, but existing parents must be private.
    assertPrivateDirectory(dirname(base), false);
    assertPrivateDirectory(base, false);
  }
  const active = pinnedEnvironments.has(env) ? DEFAULT_PROFILE_ID : activeProfileId(base);
  let configDir = base;
  if (active !== DEFAULT_PROFILE_ID) {
    assertPrivateDirectory(join(base, "profiles"));
    configDir = joinedProfileDir(base, active);
    assertPrivateDirectory(configDir);
    // Reject nested pointers rather than silently selecting another identity.
    if (pathExists(join(configDir, ACTIVE_PROFILE_FILE))) return profileSelectionError();
    // The marker may survive file loss or tampering. Never treat a damaged
    // selected child as an empty local profile, and never follow file links.
    assertJoinedProfileFile(join(configDir, "config.json"), false);
    assertJoinedProfileFile(join(configDir, "credentials.json"), true);
    // Recheck endpoint, human, workspace and agent binding every time the
    // active selection is resolved. Explicit-child reads do not recurse here.
    assertCompletedJoinedProfile(env, active);
  }
  const dataDir =
    envDir(env, "CAMPFIRE_DATA_DIR") ??
    join(envDir(env, "XDG_DATA_HOME") ?? join(home, ".local", "share"), "campfire");
  return {
    configDir,
    configPath: join(configDir, "config.json"),
    credentialsPath: join(configDir, "credentials.json"),
    dataDir,
    defaultDatabasePath: join(dataDir, "campfire.db"),
  };
}

/** Select one completed profile directly, without consulting its active pointer. */
export function pinnedMcpProfileEnvironment(path: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!isAbsolute(path) || resolve(path) !== path) return profileSelectionError();
  let directory;
  try { directory = lstatSync(path); } catch { return profileSelectionError(); }
  if (directory.isSymbolicLink() || !directory.isDirectory() || (directory.mode & 0o022) !== 0) return profileSelectionError();
  if (isJoinedProfilePath(path)) { assertPrivateDirectory(dirname(path)); assertPrivateDirectory(path); }
  assertJoinedProfileFile(join(path, "config.json"), false);
  assertJoinedProfileFile(join(path, "credentials.json"), true);
  const pinned = { ...env, CAMPFIRE_CONFIG_DIR: path };
  pinnedEnvironments.add(pinned);
  return pinned;
}

/** A stable, isolated location for retrying one invitation; does not select it. */
export function joinProfileEnvironment(env: NodeJS.ProcessEnv, invitationId: string): NodeJS.ProcessEnv {
  const base = baseConfigDir(env);
  if (isJoinedProfilePath(base)) return profileSelectionError();
  // Do not create a new enrollment under a damaged active selection. The user
  // can explicitly switch to the original profile to recover first.
  resolveProfilePaths(env);
  const id = `join-${invitationId}`;
  const dir = joinedProfileDir(base, id);
  assertPrivateDirectory(join(base, "profiles"), false);
  assertPrivateDirectory(dir, false);
  return { ...env, CAMPFIRE_CONFIG_DIR: dir };
}

/** Profile summaries contain no credentials or invitation capabilities. */
export interface LocalProfileSummary {
  id: string;
  active: boolean;
  mode?: "local" | "remote";
  workspaceId?: string;
  workspaceName?: string;
}

function joinedEnvironment(env: NodeJS.ProcessEnv, id: string): NodeJS.ProcessEnv {
  return { ...env, CAMPFIRE_CONFIG_DIR: joinedProfileDir(baseConfigDir(env), id) };
}

function assertCompletedJoinedProfile(env: NodeJS.ProcessEnv, id: string): RemoteCampfireProfile {
  const base = baseConfigDir(env);
  assertPrivateDirectory(join(base, "profiles"));
  const dir = joinedProfileDir(base, id);
  assertPrivateDirectory(dir);
  if (pathExists(join(dir, ACTIVE_PROFILE_FILE))) return profileSelectionError();
  assertJoinedProfileFile(join(dir, "config.json"), false);
  assertJoinedProfileFile(join(dir, "credentials.json"), true);
  const selected = joinedEnvironment(env, id);
  const profile = loadAnyProfile(selected);
  const credentials = loadCredentials(selected);
  if (profile?.mode !== "remote" || credentials === undefined || credentials.endpoint !== profile.url ||
      credentials.humanId !== profile.humanId || credentials.workspaceId !== profile.workspaceId ||
      profile.agents.some((agent) => credentials.agentIds?.[agent.harness] !== agent.id || !credentials.agents?.[agent.harness])) return profileSelectionError();
  return profile;
}

/**
 * Atomically switch only to a completely verified profile; default is never
 * moved. Concurrent successful switches are last-rename-wins, so callers must
 * not assume a switch remains selected after another process acts. A failed
 * directory fsync can occur after rename: callers should re-read the marker
 * before retrying and must reuse the same saved enrollment, not re-enroll.
 */
export function activateLocalProfile(env: NodeJS.ProcessEnv, id: string): void {
  const base = baseConfigDir(env);
  if (isJoinedProfilePath(base)) return profileSelectionError();
  if (id !== DEFAULT_PROFILE_ID) assertCompletedJoinedProfile(env, id);
  // An explicit return to the original profile can recover from a damaged
  // marker without following or discarding it. Other switches fail closed.
  try { activeProfileId(base); }
  catch (error) {
    if (id !== DEFAULT_PROFILE_ID || !(error instanceof ValidationError)) throw error;
    const marker = join(base, ACTIVE_PROFILE_FILE);
    if (!pathExists(marker)) throw error;
    const backup = join(base, `.active-profile-invalid-${randomUUID()}.backup`);
    if (pathExists(backup)) return profileSelectionError();
    // rename moves a symlink itself; it never follows its target.
    renameSync(marker, backup);
    const parent = openSync(base, "r");
    try { fsyncSync(parent); } finally { closeSync(parent); }
  }
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const target = join(base, ACTIVE_PROFILE_FILE);
  const temp = join(base, `.active-profile-${randomUUID()}.tmp`);
  try {
    const fd = openSync(temp, "wx", 0o600);
    try { writeFileSync(fd, `${JSON.stringify({ version: 1, active: id })}\n`); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temp, target);
    const directory = openSync(base, "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally { rmSync(temp, { force: true }); }
}

export function activateJoinProfile(env: NodeJS.ProcessEnv, invitationId: string): void {
  activateLocalProfile(env, `join-${invitationId}`);
}

export function listLocalProfiles(env: NodeJS.ProcessEnv = process.env): LocalProfileSummary[] {
  const base = baseConfigDir(env);
  if (isJoinedProfilePath(base)) return profileSelectionError();
  const active = activeProfileId(base);
  const originalEnv = { ...env, CAMPFIRE_CONFIG_DIR: base };
  // Ignore the marker when reading the original: an empty, separate root env
  // cannot be used here because the files must remain at their original path.
  const entries: LocalProfileSummary[] = [{ id: DEFAULT_PROFILE_ID, active: active === DEFAULT_PROFILE_ID }];
  const directory = join(base, "profiles");
  if (!pathExists(directory)) {
    if (active !== DEFAULT_PROFILE_ID) return profileSelectionError();
    return entries;
  }
  assertPrivateDirectory(directory);
  for (const id of readdirSync(directory).sort()) {
    if (!JOIN_PROFILE_ID.test(id)) continue;
    const dir = joinedProfileDir(base, id);
    assertPrivateDirectory(dir);
    // A failed/interrupted join may legitimately leave a private pending file.
    // It is not selectable until both profile and credentials were persisted.
    if (!pathExists(join(dir, "config.json")) || !pathExists(join(dir, "credentials.json"))) {
      if (active === id) return profileSelectionError();
      continue;
    }
    const profile = assertCompletedJoinedProfile(originalEnv, id);
    entries.push({ id, active: active === id, mode: "remote", workspaceId: profile.workspaceId, ...(profile.workspaceName ? { workspaceName: profile.workspaceName } : {}) });
  }
  if (active !== DEFAULT_PROFILE_ID && !entries.some((entry) => entry.id === active)) return profileSelectionError();
  return entries;
}

export function cwdDatabasePath(cwd: string = process.cwd()): string {
  return join(cwd, ".campfire", "campfire.db");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`Profile ${field} is missing`, { field });
  }
  return value;
}

function optionalString(record: Record<string, unknown>, field: string): string | undefined {
  if (record[field] === undefined) return undefined;
  return requiredString(record, field);
}

function readAgents(value: unknown): ProfileAgent[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ValidationError("Profile agents must be a list", { field: "agents" });
  }
  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new ValidationError("Profile agent must be an object", { field: "agents" });
    }
    return {
      id: requiredString(entry, "id"),
      name: requiredString(entry, "name"),
      harness: requiredString(entry, "harness"),
    };
  });
}

export function loadAnyProfile(
  env: NodeJS.ProcessEnv = process.env,
): AnyCampfireProfile | undefined {
  const { configPath } = resolveProfilePaths(env);
  if (!existsSync(configPath)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    throw new ValidationError("Campfire profile is not strict JSON; refusing to guess", {
      field: "profile",
    });
  }
  if (!isRecord(parsed)) {
    throw new ValidationError("Campfire profile must be a JSON object", { field: "profile" });
  }
  if (parsed.version !== 1 && parsed.version !== 2) {
    throw new ValidationError("Unsupported Campfire profile version", { field: "profile" });
  }
  if (parsed.version === 1 && parsed.mode !== undefined && parsed.mode !== "local" ||
      parsed.version === 2 && parsed.mode !== "local" && parsed.mode !== "remote") {
    throw new ValidationError("Campfire profile mode is invalid", { field: "profile" });
  }
  if (parsed.version === 2 && parsed.mode === "remote") {
    if (parsed.databasePath !== undefined) {
      throw new ValidationError("Remote profile cannot select a local database", { field: "profile" });
    }
    const agents = readAgents(parsed.agents);
    if (agents === undefined || agents.length === 0 ||
        agents.some((agent) => agent.harness !== "codex" && agent.harness !== "opencode") ||
        new Set(agents.map((agent) => agent.harness)).size !== agents.length ||
        new Set(agents.map((agent) => agent.id)).size !== agents.length) {
      throw new ValidationError("Remote profile requires distinct supported owned agents", { field: "agents" });
    }
    return {
      version: 2,
      mode: "remote",
      // Loopback profiles can only be created via explicit test opt-in. Reading
      // their recorded endpoint must remain possible in a fresh process.
      url: canonicalEndpoint(requiredString(parsed, "url"), { allowLoopbackHttp: true }),
      humanId: requiredString(parsed, "humanId"),
      humanName: requiredString(parsed, "humanName"),
      workspaceId: requiredString(parsed, "workspaceId"),
      ...(parsed.workspaceName === undefined ? {} : { workspaceName: requiredString(parsed, "workspaceName") }),
      ...(parsed.goalTitle === undefined ? {} : { goalTitle: requiredString(parsed, "goalTitle") }),
      agents,
    };
  }
  const databasePath = requiredString(parsed, "databasePath");
  const profile: CampfireProfile = {
    version: parsed.version,
    ...(parsed.version === 2 ? { mode: "local" as const } : {}),
    databasePath: isAbsolute(databasePath) ? databasePath : resolve(databasePath),
    url: requiredString(parsed, "url"),
    humanId: requiredString(parsed, "humanId"),
    humanName: requiredString(parsed, "humanName"),
  };
  const workspaceId = optionalString(parsed, "workspaceId");
  const workspaceName = optionalString(parsed, "workspaceName");
  const goalTitle = optionalString(parsed, "goalTitle");
  const agentId = optionalString(parsed, "agentId");
  const agentName = optionalString(parsed, "agentName");
  const harness = optionalString(parsed, "harness");
  const agents = readAgents(parsed.agents);
  if (workspaceId !== undefined) profile.workspaceId = workspaceId;
  if (workspaceName !== undefined) profile.workspaceName = workspaceName;
  if (goalTitle !== undefined) profile.goalTitle = goalTitle;
  if (agentId !== undefined) profile.agentId = agentId;
  if (agentName !== undefined) profile.agentName = agentName;
  if (harness !== undefined) profile.harness = harness;
  if (agents !== undefined) profile.agents = agents;
  return profile;
}

/** Local callers must fail before implicitly opening SQLite for a remote profile. */
export function loadProfile(env: NodeJS.ProcessEnv = process.env): CampfireProfile | undefined {
  const profile = loadAnyProfile(env);
  if (profile?.mode === "remote") {
    throw new ValidationError("Remote Campfire profile requires the shared backend; no local database is selected", {
      field: "profile",
      nextAction: "use_remote_profile_backend",
    });
  }
  return profile;
}

export function loadCredentials(
  env: NodeJS.ProcessEnv = process.env,
): CampfireCredentials | undefined {
  const { credentialsPath } = resolveProfilePaths(env);
  if (!existsSync(credentialsPath)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(credentialsPath, "utf8"));
  } catch {
    throw new ValidationError("Campfire credentials are not strict JSON; refusing to guess", {
      field: "credentials",
    });
  }
  if (!isRecord(parsed)) {
    throw new ValidationError("Campfire credentials must be a JSON object", { field: "credentials" });
  }
  const credentials: CampfireCredentials = {
    humanToken: requiredString(parsed, "humanToken"),
  };
  if (parsed.endpoint !== undefined) {
    credentials.endpoint = canonicalEndpoint(requiredString(parsed, "endpoint"), { allowLoopbackHttp: true });
    credentials.humanId = requiredString(parsed, "humanId");
    credentials.workspaceId = requiredString(parsed, "workspaceId");
    if (!isRecord(parsed.agentIds)) {
      throw new ValidationError("Remote credential agent identity binding is missing", { field: "credentials" });
    }
    credentials.agentIds = {};
    for (const harness of Object.keys(parsed.agentIds)) credentials.agentIds[harness] = requiredString(parsed.agentIds, harness);
  }
  const agentToken = optionalString(parsed, "agentToken");
  if (agentToken !== undefined) credentials.agentToken = agentToken;
  if (parsed.agents !== undefined) {
    if (!isRecord(parsed.agents)) {
      throw new ValidationError("Credential agents must be an object", { field: "agents" });
    }
    const agents: Record<string, string> = {};
    for (const [harness, token] of Object.entries(parsed.agents)) {
      if (typeof token !== "string" || token.trim().length === 0) {
        throw new ValidationError(`Credential for ${harness} is missing`, { field: harness });
      }
      agents[harness] = token;
    }
    credentials.agents = agents;
  }
  return credentials;
}

function writePrivateJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function pathInside(root: string, target: string): boolean {
  const bases = new Set<string>([resolve(root)]);
  try {
    bases.add(realpathSync(root));
  } catch {
    // The root may not exist yet. The resolved path is enough.
  }
  const resolvedTarget = resolve(target);
  let realTarget = resolvedTarget;
  try {
    realTarget = realpathSync(target);
  } catch {
    // A database file may not exist until the first run.
  }
  for (const base of bases) {
    const prefix = base.endsWith(sep) ? base : `${base}${sep}`;
    if (resolvedTarget === base || resolvedTarget.startsWith(prefix)) return true;
    if (realTarget === base || realTarget.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * A temp database must not become the operator profile. Tests isolate
 * CAMPFIRE_CONFIG_DIR under the OS temp directory. A process that forgets
 * that isolation used to replace ~/.config/campfire with a fixture whose
 * token matches no real database, and the next `campfire` then failed closed.
 */
function assertProfileDatabaseIsDurable(profile: CampfireProfile, env: NodeJS.ProcessEnv): void {
  const configDir = resolveProfilePaths(env).configDir;
  if (pathInside(tmpdir(), configDir)) return;
  if (!pathInside(tmpdir(), profile.databasePath)) return;
  throw new ValidationError(
    "Refusing to point the operator profile at a temporary database. The current profile was not changed.",
    { field: "databasePath", nextAction: "keep_the_operator_database" },
  );
}

export function saveProfile(profile: CampfireProfile, env: NodeJS.ProcessEnv = process.env): ProfilePaths {
  assertProfileDatabaseIsDurable(profile, env);
  const paths = resolveProfilePaths(env);
  mkdirSync(paths.configDir, { recursive: true });
  writeFileSync(paths.configPath, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o644 });
  return paths;
}

export function saveCredentials(
  credentials: CampfireCredentials,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const { credentialsPath, configDir } = resolveProfilePaths(env);
  mkdirSync(configDir, { recursive: true });
  writePrivateJson(credentialsPath, credentials);
  return credentialsPath;
}

export function persistHumanProfile(
  input: {
    databasePath: string;
    url?: string;
    humanId: string;
    humanName: string;
    humanToken: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): ProfilePaths {
  const paths = saveProfile(
    {
      version: PROFILE_VERSION,
      databasePath: input.databasePath,
      url: input.url ?? "http://127.0.0.1:9414",
      humanId: input.humanId,
      humanName: input.humanName,
    },
    env,
  );
  saveCredentials({ humanToken: input.humanToken }, env);
  return paths;
}

export function rememberAgentCredential(
  harness: string,
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const existing = loadCredentials(env);
  if (existing === undefined) {
    throw new ValidationError("Missing operator credential. Run campfire before connecting an agent.", {
      field: "credentials",
    });
  }
  const agents = { ...(existing.agents ?? {}), [harness]: token };
  const next: CampfireCredentials = { humanToken: existing.humanToken, agents };
  if (existing.agentToken !== undefined) next.agentToken = existing.agentToken;
  saveCredentials(next, env);
}

export function rememberProfileAgents(agents: ProfileAgent[], env: NodeJS.ProcessEnv = process.env): void {
  const profile = loadProfile(env);
  if (profile === undefined) {
    throw new ValidationError("No Campfire profile yet. Run campfire in a terminal.", { field: "profile" });
  }
  saveProfile({ ...profile, agents }, env);
}

/**
 * Record one locally created agent on the operator profile and keep its token
 * in the credential file. A remote profile is left untouched. The onboard
 * agent stays in the list so a later harness does not hide it.
 */
export function rememberOwnedLocalAgent(
  agent: ProfileAgent,
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const profile = loadAnyProfile(env);
  if (profile === undefined || profile.mode === "remote") return;
  if (loadCredentials(env) === undefined) return;
  rememberAgentCredential(agent.harness, token, env);
  const onboard: ProfileAgent[] =
    profile.agentId !== undefined && profile.agentName !== undefined && profile.harness !== undefined
      ? [{ id: profile.agentId, name: profile.agentName, harness: profile.harness }]
      : [];
  const merged: ProfileAgent[] = [];
  const seen = new Set<string>();
  for (const entry of [...onboard, ...(profile.agents ?? []), agent]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
  }
  rememberProfileAgents(merged, env);
}

export function persistOnboardProfile(
  input: {
    databasePath: string;
    url?: string;
    workspaceId: string;
    workspaceName: string;
    goalTitle: string;
    humanId: string;
    humanName: string;
    agentId: string;
    agentName: string;
    harness: string;
    humanToken: string;
    agentToken: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): ProfilePaths {
  const paths = saveProfile(
    {
      version: PROFILE_VERSION,
      databasePath: input.databasePath,
      url: input.url ?? "http://127.0.0.1:9414",
      workspaceId: input.workspaceId,
      workspaceName: input.workspaceName,
      goalTitle: input.goalTitle,
      humanId: input.humanId,
      humanName: input.humanName,
      agentId: input.agentId,
      agentName: input.agentName,
      harness: input.harness,
    },
    env,
  );
  saveCredentials({ humanToken: input.humanToken, agentToken: input.agentToken }, env);
  return paths;
}

/** Operator CLI only. Never use this inside MCP stdio. */
export function readOperatorHumanToken(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!storedEndpointMatches(env)) return undefined;
  const token = loadCredentials(env)?.humanToken.trim();
  return token && token.length > 0 ? token : undefined;
}

export function readOperatorAgentToken(
  env: NodeJS.ProcessEnv = process.env,
  harness?: string,
): string | undefined {
  if (!storedEndpointMatches(env)) return undefined;
  const credentials = loadCredentials(env);
  if (credentials === undefined) return undefined;
  const profile = loadAnyProfile(env);
  if (profile?.mode === "remote") {
    if (harness === undefined) return undefined;
    const agent = profile.agents.find((entry) => entry.harness === harness);
    if (agent === undefined || credentials.agentIds?.[harness] !== agent.id) return undefined;
    return credentials.agents?.[harness]?.trim() || undefined;
  }
  if (harness !== undefined) {
    const specific = credentials.agents?.[harness]?.trim();
    if (specific !== undefined && specific.length > 0) return specific;
  }
  const legacy = credentials.agentToken?.trim();
  return legacy !== undefined && legacy.length > 0 ? legacy : undefined;
}

function storedEndpointMatches(env: NodeJS.ProcessEnv): boolean {
  const profile = loadAnyProfile(env);
  if (profile?.mode !== "remote") return true;
  const url = canonicalEndpoint(env.CAMPFIRE_URL?.trim() || profile.url, { allowLoopbackHttp: true });
  const credentials = loadCredentials(env);
  return url === profile.url && credentials?.endpoint === profile.url &&
    credentials.humanId === profile.humanId && credentials.workspaceId === profile.workspaceId;
}

export function formatStatus(profile: CampfireProfile): string {
  const named =
    profile.agents !== undefined && profile.agents.length > 0
      ? profile.agents.map((agent) => `${agent.name} (${agent.harness})`).join(", ")
      : profile.agentName !== undefined && profile.harness !== undefined
        ? `${profile.agentName} (${profile.harness})`
        : undefined;
  // The receipt says what the profile records and one next action per state;
  // it never treats the stored selection as live service or agent state.
  return formatLocalStatusReceipt({
    humanName: profile.humanName,
    ...(named === undefined ? {} : { agents: named }),
    ...(profile.workspaceName === undefined ? {} : { workspaceName: profile.workspaceName }),
    ...(profile.goalTitle === undefined ? {} : { goalTitle: profile.goalTitle }),
  });
}
