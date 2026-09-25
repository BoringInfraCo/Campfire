/**
 * MCP server identity.
 *
 * The actor a server process acts as is resolved once at startup and fixed for
 * the lifetime of the process. Tools never accept an actor id, so a client
 * cannot spoof another actor (AGENTS.md invariant 2 and 4). A registered agent
 * session may still be supplied through `--session`/`CAMPFIRE_SESSION_ID`.
 */
import { ValidationError } from "../domain/errors.js";
import type { ActorContext } from "../service/authorization.js";

export interface ServerIdentity {
  ctx: ActorContext;
  harness?: string;
}

function readFlag(argv: string[], name: string): string | undefined {
  const prefixed = `--${name}`;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token === prefixed) {
      const next = argv[i + 1];
      return next !== undefined && !next.startsWith("-") ? next : undefined;
    }
    if (token.startsWith(`${prefixed}=`)) {
      return token.slice(prefixed.length + 1);
    }
  }
  return undefined;
}

function pickFlagOrEnv(
  argv: string[],
  flag: string,
  env: NodeJS.ProcessEnv,
  envVar: string,
): string {
  return (readFlag(argv, flag) ?? env[envVar] ?? "").trim();
}

export function readCampfireToken(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2),
): string | undefined {
  const token = pickFlagOrEnv(argv, "token", env, "CAMPFIRE_TOKEN");
  return token.length > 0 ? token : undefined;
}

export function readCampfireUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const url = (env.CAMPFIRE_URL ?? "").trim();
  return url.length > 0 ? url : undefined;
}

export function readHarness(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2),
): string | undefined {
  const harness = pickFlagOrEnv(argv, "harness", env, "CAMPFIRE_HARNESS");
  return harness.length > 0 ? harness : undefined;
}

export function readCampfireSessionId(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2),
): string | undefined {
  const sessionId = pickFlagOrEnv(argv, "session", env, "CAMPFIRE_SESSION_ID");
  return sessionId.length > 0 ? sessionId : undefined;
}

export function resolveServerIdentity(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2),
): ServerIdentity {
  const actorId = pickFlagOrEnv(argv, "actor", env, "CAMPFIRE_ACTOR_ID");
  const actorType = pickFlagOrEnv(argv, "type", env, "CAMPFIRE_ACTOR_TYPE").toLowerCase();
  const sessionId = readCampfireSessionId(env, argv) ?? "";
  const harness = pickFlagOrEnv(argv, "harness", env, "CAMPFIRE_HARNESS");

  if (actorId.length === 0) {
    throw new ValidationError(
      "Missing actor identity: pass --actor <id> or set CAMPFIRE_ACTOR_ID",
      { field: "actorId" },
    );
  }
  if (actorType !== "human" && actorType !== "agent") {
    throw new ValidationError(
      `Invalid actor type "${actorType}": expected "human" or "agent" (--type / CAMPFIRE_ACTOR_TYPE)`,
      { field: "actorType", value: actorType },
    );
  }

  const ctx: ActorContext = { actor: { actorId, actorType } };
  if (sessionId.length > 0) {
    ctx.agentSessionId = sessionId;
  }

  const identity: ServerIdentity = { ctx };
  if (harness.length > 0) {
    identity.harness = harness;
  }
  return identity;
}
