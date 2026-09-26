/**
 * Local operator profile and credentials.
 *
 * Config is not secret. Credentials are mode 0600 and must never be logged,
 * put in the Viewer, or copied into a handoff. MCP must not read this file:
 * an agent process gets CAMPFIRE_TOKEN from its own harness env.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { ValidationError } from "../domain/errors.js";

export const PROFILE_VERSION = 1 as const;

export interface ProfileAgent {
  id: string;
  name: string;
  harness: string;
}

export interface CampfireProfile {
  version: typeof PROFILE_VERSION;
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

export interface CampfireCredentials {
  humanToken: string;
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

export function resolveProfilePaths(env: NodeJS.ProcessEnv = process.env): ProfilePaths {
  const home = homeDir(env);
  const configDir =
    envDir(env, "CAMPFIRE_CONFIG_DIR") ??
    join(envDir(env, "XDG_CONFIG_HOME") ?? join(home, ".config"), "campfire");
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

export function loadProfile(
  env: NodeJS.ProcessEnv = process.env,
): CampfireProfile | undefined {
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
  const databasePath = requiredString(parsed, "databasePath");
  const profile: CampfireProfile = {
    version: PROFILE_VERSION,
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

export function saveProfile(profile: CampfireProfile, env: NodeJS.ProcessEnv = process.env): ProfilePaths {
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
  const token = loadCredentials(env)?.humanToken.trim();
  return token && token.length > 0 ? token : undefined;
}

export function readOperatorAgentToken(
  env: NodeJS.ProcessEnv = process.env,
  harness?: string,
): string | undefined {
  const credentials = loadCredentials(env);
  if (credentials === undefined) return undefined;
  if (harness !== undefined) {
    const specific = credentials.agents?.[harness]?.trim();
    if (specific !== undefined && specific.length > 0) return specific;
  }
  const legacy = credentials.agentToken?.trim();
  return legacy !== undefined && legacy.length > 0 ? legacy : undefined;
}

export function formatStatus(profile: CampfireProfile): string {
  const lines = [`  You        ${profile.humanName}`];
  const named =
    profile.agents !== undefined && profile.agents.length > 0
      ? profile.agents.map((agent) => `${agent.name} (${agent.harness})`).join(", ")
      : profile.agentName !== undefined && profile.harness !== undefined
        ? `${profile.agentName} (${profile.harness})`
        : undefined;
  if (named !== undefined) lines.push(`  Agents     ${named}`);
  if (profile.workspaceName !== undefined) {
    lines.push(`  Workspace  ${profile.workspaceName}`);
    if (profile.goalTitle !== undefined) lines.push(`  Goal       ${profile.goalTitle}`);
  } else {
    lines.push("  Waiting for an agent to start work.");
    lines.push("  Past sessions are not imported.");
  }
  lines.push("", "  campfire up     start the local API and Viewer", "  campfire --help", "");
  return lines.join("\n");
}
