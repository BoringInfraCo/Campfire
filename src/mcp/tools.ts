/**
 * Campfire MCP tools.
 *
 * Every handler is deliberately thin: it maps validated input to an
 * application-service call (or an HTTP /v1/call) and serializes the result.
 * Business logic lives in the service, not here (AGENTS.md invariant 7). The
 * actor identity is bound at server construction; no tool accepts an acting
 * actor id.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CampfireError, ValidationError } from "../domain/errors.js";
import { campfireHttpCall, hostedIdentityError, hostedPreflightError } from "../http/client.js";
import { dispatchCampfireMethod } from "../http/dispatch.js";
import type { ActorContext } from "../service/authorization.js";
import type { CampfireService } from "../service/service.js";
import type { ServerIdentity } from "./context.js";

export interface CampfireMcpOptions {
  service?: CampfireService;
  remote?: { url: string; token: string };
  identity: ServerIdentity;
}

const ACTOR_TYPES = ["human", "agent"] as const;
const PARTICIPANT_ROLES = ["owner", "member", "agent", "viewer"] as const;
const WORKSPACE_STATUSES = ["active", "completed", "archived"] as const;
const GOAL_STATUSES = ["active", "completed", "abandoned"] as const;
const TASK_STATUSES = ["open", "in_progress", "blocked", "completed"] as const;
const DECISION_STATUSES = ["proposed", "accepted", "superseded"] as const;
const ARTIFACT_TYPES = [
  "file",
  "pull_request",
  "commit",
  "log",
  "trace",
  "document",
  "deployment",
  "screenshot",
  "report",
  "other",
] as const;

const actorRefSchema = z.object({
  actorId: z.string(),
  actorType: z.enum(ACTOR_TYPES),
});

function ok(result: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

function fail(code: string, message: string, details?: Record<string, unknown>): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: code, message, details: details ?? null }),
      },
    ],
  };
}

export function createCampfireMcpServer(options: CampfireMcpOptions): McpServer {
  const { identity, remote } = options;
  const service = options.service;
  if (remote === undefined && service === undefined) {
    throw new ValidationError("Campfire MCP server requires a service or remote HTTP target");
  }

  const server = new McpServer({ name: "campfire", version: "1.0.0" });
  // The server owns its own actor context so registering a session can bind to
  // this connection without mutating a caller-supplied identity object.
  const ctx: ActorContext = {
    actor: { ...identity.ctx.actor },
    agentSessionId: identity.ctx.agentSessionId,
  };

  async function invoke(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (remote !== undefined) {
      const merged = { ...params };
      if (ctx.agentSessionId !== undefined) {
        merged.agentSessionId = ctx.agentSessionId;
      }
      try {
        return await campfireHttpCall({
          baseUrl: remote.url,
          token: remote.token,
          method,
          params: merged,
        });
      } catch (error) {
        if (error instanceof CampfireError && method === "preflight") {
          throw hostedPreflightError(error);
        }
        if (error instanceof CampfireError && method === "whoami") {
          throw hostedIdentityError(error);
        }
        throw error;
      }
    }
    if (service === undefined) {
      throw new ValidationError("Campfire MCP server is missing a service");
    }
    return dispatchCampfireMethod(service, ctx, method, params);
  }

  async function run(fn: () => unknown | Promise<unknown>): Promise<CallToolResult> {
    try {
      return ok(await fn());
    } catch (error) {
      if (error instanceof CampfireError) {
        return fail(error.code, error.message, error.details);
      }
      console.error("[campfire-mcp] unexpected tool error:", error);
      return fail("InternalError", error instanceof Error ? error.message : String(error));
    }
  }

  server.registerTool(
    "preflight",
    {
      description:
        "Check endpoint, authenticated identity, and agent-session readiness without changing Campfire state.",
      inputSchema: { workspaceId: z.string().min(1) },
    },
    (args) =>
      run(async () => {
        const status = (await invoke("preflight", {
          workspaceId: args.workspaceId,
        })) as Record<string, unknown>;
        return identity.harness === undefined ? status : { ...status, harness: identity.harness };
      }),
  );

  server.registerTool(
    "whoami",
    {
      description: "Report the Campfire actor identity bound to this server process.",
      inputSchema: {},
    },
    () =>
      run(async () => {
        if (remote !== undefined) {
          return invoke("whoami", {});
        }
        return {
          actor: ctx.actor,
          sessionId: ctx.agentSessionId,
          harness: identity.harness,
        };
      }),
  );

  server.registerTool(
    "list_workspaces",
    {
      description: "List the workspaces the acting actor participates in.",
      inputSchema: {},
    },
    () => run(() => invoke("list_workspaces", {})),
  );

  server.registerTool(
    "create_workspace",
    {
      description: "Create a workspace. The acting actor becomes the owner.",
      inputSchema: {
        teamId: z.string(),
        name: z.string(),
        description: z.string().optional(),
      },
    },
    (args) => run(() => invoke("create_workspace", args)),
  );

  server.registerTool(
    "update_workspace",
    {
      description:
        "Change a workspace lifecycle status explicitly after inspecting its recorded state. Use completed only when the recorded goal is finished and no recorded work or proposal remains; completion preserves the workspace and its history. Use active for ongoing or deliberately reopened work. Archived is terminal retirement, not a synonym for completed. Quiet state alone never grants permission and never proves success.",
      inputSchema: {
        workspaceId: z.string(),
        status: z.enum(WORKSPACE_STATUSES),
      },
    },
    (args) => run(() => invoke("update_workspace", args)),
  );

  server.registerTool(
    "get_workspace",
    {
      description: "Read the full current-state projection of a workspace, including provenance.",
      inputSchema: { workspaceId: z.string() },
    },
    (args) => run(() => invoke("get_workspace", args)),
  );

  server.registerTool(
    "get_workspace_context",
    {
      description:
        "Retrieve the compact orientation projection for continuing work: goal, proposed and accepted decisions, open tasks, findings, artifacts, recent provenance, authorization-aware needsYou/needsAttention, current work, and an orientation hint. Pass `since` (a contribution id) to also receive contributions strictly after it.",
      inputSchema: { workspaceId: z.string(), since: z.string().optional() },
    },
    (args) => run(() => invoke("get_workspace_context", args)),
  );

  server.registerTool(
    "get_activity",
    {
      description: "List the append-only contribution history for a workspace.",
      inputSchema: {
        workspaceId: z.string(),
        limit: z.number().int().positive().optional(),
        before: z.string().optional(),
      },
    },
    (args) => run(() => invoke("get_activity", args)),
  );

  server.registerTool(
    "join_workspace",
    {
      description:
        "Join a workspace as the acting actor. Requires a pending invite; the role comes from the invite, not this request.",
      inputSchema: {
        workspaceId: z.string(),
        role: z.enum(PARTICIPANT_ROLES).optional(),
      },
    },
    (args) => run(() => invoke("join_workspace", { workspaceId: args.workspaceId })),
  );

  server.registerTool(
    "invite_workspace",
    {
      description:
        "Invite an actor to a workspace. Owner and member may invite; viewer and agent may not. Role is taken from the invite when the actor joins.",
      inputSchema: {
        workspaceId: z.string(),
        actorId: z.string(),
        actorType: z.enum(ACTOR_TYPES),
        role: z.enum(PARTICIPANT_ROLES),
      },
    },
    (args) => run(() => invoke("invite_workspace", args)),
  );

  server.registerTool(
    "register_agent_session",
    {
      description: "Register an agent session in a workspace for a human principal.",
      inputSchema: {
        agentId: z.string(),
        humanId: z.string().optional(),
        workspaceId: z.string(),
        harness: z.string().optional(),
      },
    },
    (args) =>
      run(async () => {
        const harness = args.harness ?? identity.harness;
        if (harness === undefined || harness.trim().length === 0) {
          throw new ValidationError(
            "harness is required: pass harness or set --harness / CAMPFIRE_HARNESS",
            { field: "harness" },
          );
        }
        const session = (await invoke("register_agent_session", {
          agentId: args.agentId,
          humanId: args.humanId,
          workspaceId: args.workspaceId,
          harness,
        })) as { id: string };
        ctx.agentSessionId = session.id;
        return session;
      }),
  );

  server.registerTool(
    "create_goal",
    {
      description: "Create the current goal for a workspace. Fails if an active goal already exists.",
      inputSchema: {
        workspaceId: z.string(),
        title: z.string(),
        description: z.string().optional(),
      },
    },
    (args) => run(() => invoke("create_goal", args)),
  );

  server.registerTool(
    "update_goal",
    {
      description:
        "Change shared team intent only when the goal itself changed. Do not use it to narrate progress; progress belongs in findings, tasks, or artifacts.",
      inputSchema: {
        goalId: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(GOAL_STATUSES).optional(),
      },
    },
    (args) => run(() => invoke("update_goal", args)),
  );

  server.registerTool(
    "add_finding",
    {
      description:
        "Record a durable fact or conclusion useful to later participants. Include evidence or confidence when useful. Do not paste a private transcript or scratch reasoning.",
      inputSchema: {
        workspaceId: z.string(),
        summary: z.string(),
        detail: z.string().optional(),
        confidence: z.number().optional(),
        sourceArtifactId: z.string().optional(),
      },
    },
    (args) => run(() => invoke("add_finding", args)),
  );

  server.registerTool(
    "add_decision",
    {
      description:
        "Record a direction that still needs explicit acceptance. Creating a decision only proposes it; it does not approve it.",
      inputSchema: {
        workspaceId: z.string(),
        summary: z.string(),
        rationale: z.string().optional(),
        status: z.enum(DECISION_STATUSES).optional(),
      },
    },
    (args) => run(() => invoke("add_decision", args)),
  );

  server.registerTool(
    "accept_decision",
    {
      description:
        "Accept a proposed decision only for an explicit approval. Never call it as an automatic follow-up to proposing.",
      inputSchema: { decisionId: z.string() },
    },
    (args) => run(() => invoke("accept_decision", args)),
  );

  server.registerTool(
    "create_task",
    {
      description:
        "Create actionable shared work with a truthful initial lifecycle state and assignee.",
      inputSchema: {
        workspaceId: z.string(),
        title: z.string(),
        description: z.string().optional(),
        assignee: actorRefSchema.optional(),
      },
    },
    (args) => run(() => invoke("create_task", args)),
  );

  server.registerTool(
    "update_task",
    {
      description:
        "Update shared work to its truthful current lifecycle status, title, description, or assignee. Move to in_progress when started, blocked when waiting, completed only when the completion condition is met. Pass assignee null to clear.",
      inputSchema: {
        taskId: z.string(),
        status: z.enum(TASK_STATUSES).optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        assignee: actorRefSchema.nullable().optional(),
      },
    },
    (args) => run(() => invoke("update_task", args)),
  );

  server.registerTool(
    "add_artifact",
    {
      description:
        "Attach a stable reference to a useful output or source with metadata. Store the reference, not copied secret material or private session content.",
      inputSchema: {
        workspaceId: z.string(),
        type: z.enum(ARTIFACT_TYPES),
        title: z.string(),
        uriOrPath: z.string(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      },
    },
    (args) => run(() => invoke("add_artifact", args)),
  );

  return server;
}
