/**
 * Local configuration.
 *
 * Sprint 001 is a single local service with a SQLite file. No cloud control
 * plane is required (AGENTS.md constraint 10, ARCHITECTURE section 4).
 *
 * Database resolution, in order:
 * 1. CAMPFIRE_DB (and the CLI --db flag, which sets it)
 * 2. the operator profile written by onboard / first-run
 * 3. an existing $CWD/.campfire/campfire.db (compat with pre-017 installs)
 * 4. $XDG_DATA_HOME/campfire/campfire.db (or ~/.local/share/campfire)
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { cwdDatabasePath, loadProfile, resolveProfilePaths } from "./bootstrap/profile.js";

export interface CampfireConfig {
  /** Absolute path to the SQLite database file. */
  databasePath: string;
  /** Default organization/team used by the local bootstrap fixture. */
  organization: { id: string; name: string };
  team: { id: string; name: string };
}

export const DEFAULT_ORGANIZATION_ID = "org_boringinfra";
export const DEFAULT_TEAM_ID = "team_engineering";

export function resolveDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CAMPFIRE_DB;
  if (configured && configured.trim().length > 0) {
    return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
  }
  const profile = loadProfile(env);
  if (profile !== undefined) return profile.databasePath;
  const legacy = cwdDatabasePath();
  if (existsSync(legacy)) return legacy;
  return resolveProfilePaths(env).defaultDatabasePath;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CampfireConfig {
  return {
    databasePath: resolveDatabasePath(env),
    organization: { id: DEFAULT_ORGANIZATION_ID, name: "Boring Infra Co." },
    team: { id: DEFAULT_TEAM_ID, name: "Engineering" },
  };
}

export function describeDataLocation(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? path.replace(home, "~") : path;
}
