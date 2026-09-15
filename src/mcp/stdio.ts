/**
 * Campfire MCP stdio entrypoint.
 *
 * stdout is the MCP protocol channel: never write logs there. All diagnostics
 * go to stderr (AGENTS.md "Observability"). The exported `startStdioServer` is
 * reusable by the CLI; the module also runs directly via
 * `npx tsx src/mcp/stdio.ts`.
 *
 * When CAMPFIRE_URL is set this process is an adapter only: tool calls POST
 * /v1/call with CAMPFIRE_TOKEN and no local SQLite is opened for writes.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CampfireError, ValidationError } from "../domain/errors.js";
import type { ActorRef } from "../domain/types.js";
import { campfireHttpCall } from "../http/client.js";
import { createRuntime } from "../runtime.js";
import type { CampfireRuntime } from "../runtime.js";
import {
  readCampfireToken,
  readCampfireUrl,
  readHarness,
  resolveServerIdentity,
} from "./context.js";
import type { ServerIdentity } from "./context.js";
import { createCampfireMcpServer } from "./tools.js";

export interface RunningStdioServer {
  runtime?: CampfireRuntime;
  close(): Promise<void>;
}

function isActorRef(value: unknown): value is ActorRef {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { actorId?: unknown; actorType?: unknown };
  return (
    typeof record.actorId === "string" &&
    (record.actorType === "human" || record.actorType === "agent")
  );
}

async function resolveRemoteIdentity(
  url: string,
  token: string,
  env: NodeJS.ProcessEnv,
  argv: string[],
): Promise<ServerIdentity> {
  const who = (await campfireHttpCall({
    baseUrl: url,
    token,
    method: "whoami",
    params: {},
  })) as { actor?: unknown; sessionId?: unknown; harness?: unknown };
  if (!isActorRef(who.actor)) {
    throw new ValidationError("Remote whoami did not return an actor");
  }
  const ctx: ServerIdentity["ctx"] = { actor: who.actor };
  if (typeof who.sessionId === "string" && who.sessionId.length > 0) {
    ctx.agentSessionId = who.sessionId;
  }
  const identity: ServerIdentity = { ctx };
  const harness = readHarness(env, argv) ?? (typeof who.harness === "string" ? who.harness : undefined);
  if (harness !== undefined && harness.length > 0) {
    identity.harness = harness;
  }
  return identity;
}

export async function startStdioServer(
  identity?: ServerIdentity,
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2),
): Promise<RunningStdioServer> {
  const url = readCampfireUrl(env);
  const token = readCampfireToken(env, argv);

  if (url !== undefined) {
    if (token === undefined) {
      throw new ValidationError("CAMPFIRE_TOKEN is required when CAMPFIRE_URL is set", {
        field: "token",
      });
    }
    const resolved = await resolveRemoteIdentity(url, token, env, argv);
    const server = createCampfireMcpServer({ remote: { url, token }, identity: resolved });
    const transport = new StdioServerTransport();

    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await server.close();
    };

    const shutdown = (signal: NodeJS.Signals): void => {
      console.error(`[campfire] received ${signal}, shutting down`);
      void close().finally(() => {
        process.exit(0);
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    await server.connect(transport);
    console.error(
      `[campfire] MCP stdio adapter ready: actor=${resolved.ctx.actor.actorId} (${resolved.ctx.actor.actorType}) url=${url}`,
    );
    return { close };
  }

  const runtime = createRuntime();
  let resolved = identity ?? resolveServerIdentity(env, argv);
  if (token !== undefined) {
    // Token wins over CAMPFIRE_ACTOR_ID / --actor for the local process identity.
    const actor = runtime.service.resolveToken(token);
    resolved = {
      ctx: { actor, agentSessionId: resolved.ctx.agentSessionId },
      harness: resolved.harness ?? readHarness(env, argv),
    };
  }

  if (resolved.ctx.actor.actorType === "agent" && resolved.ctx.agentSessionId === undefined) {
    console.error(
      `[campfire] agent ${resolved.ctx.actor.actorId} started without a bound session; use register_agent_session`,
    );
  }

  const server = createCampfireMcpServer({ service: runtime.service, identity: resolved });
  const transport = new StdioServerTransport();

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await server.close();
    runtime.close();
  };

  const shutdown = (signal: NodeJS.Signals): void => {
    console.error(`[campfire] received ${signal}, shutting down`);
    void close().finally(() => {
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await server.connect(transport);
  console.error(
    `[campfire] MCP stdio server ready: actor=${resolved.ctx.actor.actorId} (${resolved.ctx.actor.actorType}) db=${runtime.config.databasePath}`,
  );

  return { runtime, close };
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    // Compare real paths (see src/cli/index.ts): symlinked or ".." entry
    // paths must still start the server instead of silently no-op-ing.
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  startStdioServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof CampfireError ? error.code : "InternalError";
    console.error(`[campfire] failed to start MCP server (${code}): ${message}`);
    process.exit(1);
  });
}
