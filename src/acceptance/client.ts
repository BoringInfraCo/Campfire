/**
 * Acceptance MCP stdio client.
 *
 * Spawns the real Campfire MCP server as a child process over stdio. Each
 * `connectHarness` call produces an independent process with its own actor
 * identity, which is what makes the Sprint 001 acceptance run a genuine
 * cross-harness proof rather than two mocked calls through one adapter
 * (docs/SPRINT_001.md sections 11 and 12).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

export interface HarnessConfig {
  actorId: string;
  actorType: "human" | "agent";
  harness: string;
  databasePath: string;
  sessionId?: string;
  cwd?: string;
}

export interface ToolError {
  error: string;
  message: string;
  details?: unknown;
}

export interface ToolCallResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: ToolError;
}

export interface HarnessClient {
  client: Client;
  call<T = unknown>(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<ToolCallResult<T>>;
  close(): Promise<void>;
}

/** Build the child environment, overriding any inherited Campfire identity. */
function buildEnv(config: HarnessConfig): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.CAMPFIRE_DB = config.databasePath;
  env.CAMPFIRE_ACTOR_ID = config.actorId;
  env.CAMPFIRE_ACTOR_TYPE = config.actorType;
  env.CAMPFIRE_HARNESS = config.harness;
  // Sprint 001 acceptance is in-process SQLite; never inherit a hosted adapter.
  delete env.CAMPFIRE_URL;
  delete env.CAMPFIRE_TOKEN;
  if (config.sessionId !== undefined) {
    env.CAMPFIRE_SESSION_ID = config.sessionId;
  }
  return env;
}

export async function connectHarness(config: HarnessConfig): Promise<HarnessClient> {
  const cwd = resolve(config.cwd ?? process.cwd());
  const transport = new StdioClientTransport({
    // Use the repository-local tsx binary so the server is the real
    // `src/mcp/stdio.ts` entrypoint, not a mock or a compiled stub.
    command: resolve(cwd, "node_modules", ".bin", "tsx"),
    args: ["src/mcp/stdio.ts"],
    cwd,
    env: buildEnv(config),
  });

  const client = new Client({
    name: `campfire-acceptance-${config.harness}`,
    version: "0.1.0",
  });
  await client.connect(transport);

  return {
    client,
    async call<T = unknown>(
      name: string,
      args: Record<string, unknown> = {},
    ): Promise<ToolCallResult<T>> {
      const result = (await client.callTool({ name, arguments: args })) as unknown as {
        isError?: boolean;
        content?: Array<{ type: string; text?: string }>;
      };
      const text = result.content?.find(
        (part) => part.type === "text" && typeof part.text === "string",
      )?.text;
      const parsed: unknown = text === undefined ? undefined : JSON.parse(text);

      if (result.isError === true) {
        const errorObject = (parsed ?? {}) as Partial<ToolError>;
        return {
          ok: false,
          error: {
            error: errorObject.error ?? "UnknownError",
            message: errorObject.message ?? "Campfire tool call failed",
            details: errorObject.details,
          },
        };
      }
      return { ok: true, data: parsed as T };
    },
    async close(): Promise<void> {
      // Closing the client closes the transport, which terminates the child.
      await client.close();
    },
  };
}

/** Call a tool and throw a descriptive error if it did not succeed. */
export async function requireOk<T = unknown>(
  hc: HarnessClient,
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const result = await hc.call<T>(name, args);
  if (!result.ok) {
    throw new Error(
      `Campfire tool ${name} failed: ${result.error?.error ?? "UnknownError"} - ${
        result.error?.message ?? "no message"
      }`,
    );
  }
  return result.data as T;
}
