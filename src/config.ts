/**
 * Local configuration.
 *
 * Sprint 001 is a single local service with a SQLite file. No cloud control
 * plane is required (AGENTS.md constraint 10, ARCHITECTURE section 4).
 */
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

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
  return join(process.cwd(), ".campfire", "campfire.db");
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
