/**
 * Local → remote profile cutover.
 *
 * The remote profile is written before credentials. A crash between the two
 * leaves an inspectable remote profile with missing credentials, which the
 * saved publication receipt can repair without creating another workspace.
 * The local database is never deleted.
 */
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { ValidationError } from "../domain/errors.js";
import {
  loadAnyProfile,
  loadCredentials,
  resolveProfilePaths,
  type CampfireCredentials,
  type ProfileAgent,
  type ProfilePaths,
  type RemoteCampfireProfile,
} from "../bootstrap/profile.js";
import { canonicalEndpoint } from "../bootstrap/endpoint.js";

export interface PersistPublishedProfileInput {
  url: string;
  humanId: string;
  humanName: string;
  workspaceId: string;
  workspaceName: string;
  goalTitle?: string;
  sourceDatabasePath: string;
  humanToken: string;
  agents: Array<ProfileAgent & { token: string }>;
  allowLoopbackHttp?: boolean;
}

function conflict(message: string): never {
  throw new ValidationError(message, { field: "profile", nextAction: "inspect_publication_state" });
}

function writePrivate(path: string, contents: string): void {
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
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporary, { force: true });
  }
}

function writePublic(path: string, contents: string): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", 0o644);
    writeFileSync(fd, contents);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporary, { force: true });
  }
}

function flushDirectory(directory: string): void {
  const fd = openSync(directory, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/**
 * Idempotent: an already-remote profile is accepted only when every identity,
 * endpoint, workspace, agent, and credential matches the prepared publication.
 */
export function persistPublishedProfile(input: PersistPublishedProfileInput, env: NodeJS.ProcessEnv = process.env): ProfilePaths {
  const url = canonicalEndpoint(input.url, { allowLoopbackHttp: input.allowLoopbackHttp });
  if (input.agents.length > 16) conflict("Too many owned agents for one published profile");
  const expectedAgentIds = new Set(input.agents.map((agent) => agent.id));
  const profile = loadAnyProfile(env);
  if (profile !== undefined && profile.mode !== "remote" &&
      (profile.humanId !== input.humanId ||
       (profile.workspaceId !== undefined && profile.workspaceId !== input.workspaceId))) {
    conflict("The local profile changed after publication started; refusing to overwrite a different workspace");
  }
  if (profile !== undefined && profile.mode === "local" && profile.databasePath !== input.sourceDatabasePath) {
    conflict("The local database path changed after publication started");
  }
  if (profile !== undefined && profile.mode === "remote" &&
      (profile.url !== url || profile.humanId !== input.humanId || profile.workspaceId !== input.workspaceId ||
       profile.agents.length !== input.agents.length || profile.agents.some((agent) => !expectedAgentIds.has(agent.id)))) {
    conflict("An unrelated remote profile already exists");
  }
  const prior = loadCredentials(env);
  if (prior !== undefined && profile?.mode === "remote" && prior.endpoint !== undefined &&
      (prior.endpoint !== url || prior.humanId !== input.humanId || prior.workspaceId !== input.workspaceId ||
       prior.humanToken !== input.humanToken ||
       input.agents.some((agent) => prior.agentIds?.[agent.harness] !== agent.id || prior.agents?.[agent.harness] !== agent.token))) {
    conflict("Remote credentials do not match the prepared publication");
  }

  const remote: RemoteCampfireProfile = {
    version: 2,
    mode: "remote",
    url,
    humanId: input.humanId,
    humanName: input.humanName,
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    ...(input.goalTitle === undefined ? {} : { goalTitle: input.goalTitle }),
    agents: input.agents.map(({ id, name, harness }) => ({ id, name, harness })),
  };
  const credentials: CampfireCredentials = {
    endpoint: url,
    humanId: input.humanId,
    workspaceId: input.workspaceId,
    humanToken: input.humanToken,
    agentIds: Object.fromEntries(input.agents.map((agent) => [agent.harness, agent.id])),
    agents: Object.fromEntries(input.agents.map((agent) => [agent.harness, agent.token])),
  };
  const paths = resolveProfilePaths(env);
  mkdirSync(paths.configDir, { recursive: true, mode: 0o700 });
  // Profile first: a crash cannot leave a local profile pointing at a hosted
  // credential while the local database remains the selected authority.
  writePublic(paths.configPath, `${JSON.stringify(remote, null, 2)}\n`);
  flushDirectory(paths.configDir);
  writePrivate(paths.credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`);
  flushDirectory(paths.configDir);
  if (!existsSync(paths.configPath) || !existsSync(paths.credentialsPath)) {
    conflict("Published profile files are incomplete; retry from the saved publication receipt");
  }
  return paths;
}
