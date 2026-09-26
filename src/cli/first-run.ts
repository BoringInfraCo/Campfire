/**
 * Interactive first-run prompt.
 *
 * Asks only for the human. Agents and workspaces appear later, when a
 * harness connects and that agent starts work.
 */
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { userInfo } from "node:os";
import { ValidationError } from "../domain/errors.js";

function requireAnswer(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(`${field} is required`, { field });
  }
  return trimmed;
}

export function defaultHumanName(env: NodeJS.ProcessEnv = process.env): string | undefined {
  try {
    const git = execFileSync("git", ["config", "--global", "user.name"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env,
    }).trim();
    if (git.length > 0) return git;
  } catch {
    // No git identity is not a failure. Fall through to the login name.
  }
  const login = (env.USER ?? env.LOGNAME ?? "").trim();
  if (login.length > 0 && login !== "root") return login;
  try {
    const name = userInfo().username.trim();
    if (name.length > 0 && name !== "root") return name;
  } catch {
    // userInfo can throw when the passwd entry is missing.
  }
  return undefined;
}

export async function promptHumanName(fallback?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = fallback !== undefined && fallback.length > 0 ? ` [${fallback}]` : "";
    const raw = (await rl.question(`Your name${suffix}: `)).trim();
    return requireAnswer(raw.length > 0 ? raw : (fallback ?? ""), "Your name");
  } finally {
    rl.close();
  }
}
