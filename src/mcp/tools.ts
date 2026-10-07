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
import { reportActivated, reportActive, telemetryInBackground } from "../telemetry/report.js";
import type { ServerIdentity } from "./context.js";
import { SESSION_INSTRUCTIONS } from "./instructions.js";

export interface CampfireMcpOptions {
  service?: CampfireService;
  remote?: { url: string; token: string };
  identity?: ServerIdentity;
  /** Set when the listener is down. Tools return this error and do not call out. */
  unavailable?: { message: string; details?: Record<string, unknown> };
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

/**
 * MCP methods whose *success* is the TEL-001 section 9 activation boundary:
 * "successful workspace bootstrap/join" and "the first successful
 * authenticated workspace-context operation". Everything else in this file is
 * either trivial (`whoami`, `preflight`, `list_workspaces`), a diagnostic read
 * (`get_workspace`, `get_activity`), or a write that presumes a workspace the
 * agent already has. Activation is a statement that Campfire is *usable*, not
 * that the binary started, so `--help`-class and failed paths are excluded by
 * construction: the caller only reaches this set after `fn()` resolved.
 *
 * This is deliberately not per-tool instrumentation. TEL-001 section 4 forbids
 * instrumenting every command, and per-tool events would turn a bounded
 * activation signal into behavioural analytics of an agent's session.
 */
const ACTIVATION_METHODS: ReadonlySet<string> = new Set([
  "get_workspace_context",
  "join_workspace",
  "create_workspace",
]);

/**
 * Methods that also count as meaningful *activity*, and therefore carry the
 * daily `active` event. This is a narrower set than activation on purpose:
 * `join_workspace` / `create_workspace` are meaningful once, and the one-time
 * `activated` event already records that day's use of them. Reporting `active`
 * from them too would spend the installation's daily activity budget on a
 * bootstrap step rather than on a returning participant reading the workspace.
 */
const ACTIVITY_METHODS: ReadonlySet<string> = new Set(["get_workspace_context"]);

/**
 * Attach to an MCP success boundary without changing its result.
 *
 * Both reporters are bounded internally — `activated` once per installation,
 * `active` once per UTC day — so an agent loop calling a tool hundreds of times
 * still produces at most one of each. That bound is the reason this hook can sit
 * on the shared post-success path without any sampling or debounce here.
 *
 * Fire-and-forget is mandatory: an MCP tool result must never be delayed or
 * rejected by measurement (TEL-001 sections 8 and 12).
 */
function reportMcpSuccess(method: string): void {
  if (ACTIVATION_METHODS.has(method)) {
    telemetryInBackground(reportActivated("mcp"));
  }
  if (ACTIVITY_METHODS.has(method)) {
    telemetryInBackground(reportActive("mcp"));
  }
}

export function createCampfireMcpServer(options: CampfireMcpOptions): McpServer {
  const { identity, remote, unavailable } = options;
  const service = options.service;
  if (unavailable === undefined && remote === undefined && service === undefined) {
    throw new ValidationError("Campfire MCP server requires a service or remote HTTP target");
  }
  if (unavailable === undefined && identity === undefined) {
    throw new ValidationError("Campfire MCP server requires an identity");
  }

  const server = new McpServer({ name: "campfire", version: "1.0.0" }, { instructions: SESSION_INSTRUCTIONS });
  // The server owns its own actor context so registering a session can bind to
  // this connection without mutating a caller-supplied identity object.
  // A down listener has no actor: tools return before this is read.
  const ctx: ActorContext | undefined =
    identity === undefined
      ? undefined
      : {
          actor: { ...identity.ctx.actor },
          agentSessionId: identity.ctx.agentSessionId,
        };

  function requireCtx(): ActorContext {
    if (ctx === undefined) {
      throw new ValidationError("Campfire MCP server is missing an identity");
    }
    return ctx;
  }

  async function invoke(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const actorCtx = requireCtx();
    if (remote !== undefined) {
      const merged = { ...params };
      if (actorCtx.agentSessionId !== undefined) {
        merged.agentSessionId = actorCtx.agentSessionId;
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
    return dispatchCampfireMethod(service, actorCtx, method, params);
  }

  /**
   * The single funnel every tool result passes through. `method` names the tool
   * so the post-success telemetry hook can decide whether the call was a
   * meaningful Campfire success; it never reaches the payload, because the
   * telemetry contract is a closed vocabulary of events and dimensions.
   */
  async function run(method: string, fn: () => unknown | Promise<unknown>): Promise<CallToolResult> {
    if (unavailable !== undefined) {
      return fail("ValidationError", unavailable.message, unavailable.details);
    }
    try {
      const result = await fn();
      // Success only. A throw below is a failed setup or failed authentication
      // (section 9) and must never activate.
      reportMcpSuccess(method);
      return ok(result);
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
      run("preflight", async () => {
        const status = (await invoke("preflight", {
          workspaceId: args.workspaceId,
        })) as Record<string, unknown>;
        return identity?.harness === undefined ? status : { ...status, harness: identity.harness };
      }),
  );

  server.registerTool(
    "whoami",
    {
      description: "Report the Campfire actor identity bound to this server process.",
      inputSchema: {},
    },
    () =>
      run("whoami", async () => {
        if (remote !== undefined) {
          return invoke("whoami", {});
        }
        const actorCtx = requireCtx();
        return {
          actor: actorCtx.actor,
          sessionId: actorCtx.agentSessionId,
          harness: identity?.harness,
        };
      }),
  );

  server.registerTool(
    "list_workspaces",
    {
      description: "List the workspaces the acting actor participates in.",
      inputSchema: {},
    },
    () => run("list_workspaces", () => invoke("list_workspaces", {})),
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
    (args) => run("create_workspace", () => invoke("create_workspace", args)),
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
    (args) => run("update_workspace", () => invoke("update_workspace", args)),
  );

  server.registerTool(
    "get_workspace",
    {
      description: "Read the full current-state projection of a workspace, including provenance.",
      inputSchema: { workspaceId: z.string() },
    },
    (args) => run("get_workspace", () => invoke("get_workspace", args)),
  );

  server.registerTool(
    "get_workspace_context",
    {
      description:
        "Retrieve the bounded orientation projection for continuing work: goal, proposed and accepted decisions, open tasks, findings, artifacts, recent provenance, authorization-aware needsYou/needsAttention, current work, and an orientation hint. Each slice carries total, returned, and truncated. Pass orientationCursor to get_workspace_changes to catch up. Pass `since` (a contribution id) to also receive contributions strictly after it.",
      inputSchema: { workspaceId: z.string(), since: z.string().optional() },
    },
    (args) => run("get_workspace_context", () => invoke("get_workspace_context", args)),
  );

  server.registerTool(
    "get_workspace_changes",
    {
      description:
        "Read the bounded catch-up after an orientationCursor or a previous catch-up cursor. The result is bounded; pass the returned cursor to continue.",
      inputSchema: {
        workspaceId: z.string(),
        after: z.string(),
        limit: z.number().int().positive().optional(),
      },
    },
    (args) => run("get_workspace_changes", () => invoke("get_workspace_changes", args)),
  );

  server.registerTool(
    "list_decisions",
    {
      description:
        "List a bounded page of decisions in a workspace. The result is bounded; pass the returned cursor to continue the list.",
      inputSchema: {
        workspaceId: z.string(),
        limit: z.number().int().positive().optional(),
        cursor: z.string().optional(),
        status: z.enum(DECISION_STATUSES).optional(),
      },
    },
    (args) => run("list_decisions", () => invoke("list_decisions", args)),
  );

  server.registerTool(
    "list_findings",
    {
      description:
        "List a bounded page of findings in a workspace. Pass currentness current, superseded, withdrawn, or all. The result is bounded; pass the returned cursor to continue the list.",
      inputSchema: {
        workspaceId: z.string(),
        limit: z.number().int().positive().optional(),
        cursor: z.string().optional(),
        currentness: z.enum(["current", "superseded", "withdrawn", "all"]).optional(),
      },
    },
    (args) => run("list_findings", () => invoke("list_findings", args)),
  );

  server.registerTool(
    "list_tasks",
    {
      description:
        "List a bounded page of tasks in a workspace. The result is bounded; pass the returned cursor to continue the list.",
      inputSchema: {
        workspaceId: z.string(),
        limit: z.number().int().positive().optional(),
        cursor: z.string().optional(),
        status: z.enum(TASK_STATUSES).optional(),
      },
    },
    (args) => run("list_tasks", () => invoke("list_tasks", args)),
  );

  server.registerTool(
    "list_artifacts",
    {
      description:
        "List a bounded page of artifacts in a workspace. The result is bounded; pass the returned cursor to continue the list.",
      inputSchema: {
        workspaceId: z.string(),
        limit: z.number().int().positive().optional(),
        cursor: z.string().optional(),
      },
    },
    (args) => run("list_artifacts", () => invoke("list_artifacts", args)),
  );

  server.registerTool(
    "get_decision",
    {
      description: "Read one decision in a workspace.",
      inputSchema: { workspaceId: z.string(), decisionId: z.string() },
    },
    (args) => run("get_decision", () => invoke("get_decision", args)),
  );

  server.registerTool(
    "get_finding",
    {
      description: "Read one finding in a workspace.",
      inputSchema: { workspaceId: z.string(), findingId: z.string() },
    },
    (args) => run("get_finding", () => invoke("get_finding", args)),
  );

  server.registerTool(
    "get_task",
    {
      description: "Read one task in a workspace.",
      inputSchema: { workspaceId: z.string(), taskId: z.string() },
    },
    (args) => run("get_task", () => invoke("get_task", args)),
  );

  server.registerTool(
    "get_artifact",
    {
      description: "Read one artifact in a workspace.",
      inputSchema: { workspaceId: z.string(), artifactId: z.string() },
    },
    (args) => run("get_artifact", () => invoke("get_artifact", args)),
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
    (args) => run("get_activity", () => invoke("get_activity", args)),
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
    (args) => run("join_workspace", () => invoke("join_workspace", { workspaceId: args.workspaceId })),
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
    (args) => run("invite_workspace", () => invoke("invite_workspace", args)),
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
      run("register_agent_session", async () => {
        const harness = args.harness ?? identity?.harness;
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
        requireCtx().agentSessionId = session.id;
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
    (args) => run("create_goal", () => invoke("create_goal", args)),
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
    (args) => run("update_goal", () => invoke("update_goal", args)),
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
    (args) => run("add_finding", () => invoke("add_finding", args)),
  );

  server.registerTool(
    "correct_finding",
    {
      description:
        "Record a new correction of a finding. It does not edit the old assertion. The predecessor remains; the returned finding is the successor.",
      inputSchema: {
        findingId: z.string(),
        summary: z.string(),
        reason: z.string(),
        detail: z.string().optional(),
        confidence: z.number().optional(),
        sourceArtifactId: z.string().optional(),
        evidence: z
          .array(z.object({ artifactId: z.string(), relation: z.string(), note: z.string().optional() }))
          .optional(),
      },
    },
    (args) => run("correct_finding", () => invoke("correct_finding", args)),
  );

  server.registerTool(
    "withdraw_finding",
    {
      description:
        "Withdraw a finding by an explicit transition. It does not edit the old assertion.",
      inputSchema: { findingId: z.string(), reason: z.string() },
    },
    (args) => run("withdraw_finding", () => invoke("withdraw_finding", args)),
  );

  server.registerTool(
    "cite_finding_evidence",
    {
      description:
        "Cite an artifact as evidence for a finding. Records an explicit citation and does not edit the old assertion.",
      inputSchema: {
        findingId: z.string(),
        artifactId: z.string(),
        relation: z.string(),
        note: z.string().optional(),
      },
    },
    (args) => run("cite_finding_evidence", () => invoke("cite_finding_evidence", args)),
  );

  server.registerTool(
    "remove_finding_evidence",
    {
      description:
        "Remove one finding evidence citation by an explicit transition. It does not edit the old assertion.",
      inputSchema: { evidenceId: z.string() },
    },
    (args) => run("remove_finding_evidence", () => invoke("remove_finding_evidence", args)),
  );

  server.registerTool(
    "add_decision",
    {
      description:
        "Record a direction that still needs explicit acceptance. Creating a decision only proposes it; it does not approve it. replacesDecisionId records a new decision and does not edit the old assertion.",
      inputSchema: {
        workspaceId: z.string(),
        summary: z.string(),
        rationale: z.string().optional(),
        status: z.enum(DECISION_STATUSES).optional(),
        replacesDecisionId: z.string().optional(),
      },
    },
    (args) => run("add_decision", () => invoke("add_decision", args)),
  );

  server.registerTool(
    "cite_decision_basis",
    {
      description:
        "Cite a finding as a basis for a decision. Records an explicit citation and does not edit the old assertion.",
      inputSchema: {
        decisionId: z.string(),
        findingId: z.string(),
        note: z.string().optional(),
      },
    },
    (args) => run("cite_decision_basis", () => invoke("cite_decision_basis", args)),
  );

  server.registerTool(
    "remove_decision_basis",
    {
      description:
        "Remove one decision basis citation by an explicit transition. It does not edit the old assertion.",
      inputSchema: { citationId: z.string() },
    },
    (args) => run("remove_decision_basis", () => invoke("remove_decision_basis", args)),
  );

  server.registerTool(
    "accept_decision",
    {
      description:
        "Accept a proposed decision only for an explicit approval. Never call it as an automatic follow-up to proposing. reason records why this acceptance happened and does not edit the old assertion.",
      inputSchema: { decisionId: z.string(), reason: z.string().optional() },
    },
    (args) => run("accept_decision", () => invoke("accept_decision", args)),
  );

  server.registerTool(
    "retire_decision",
    {
      description:
        "Retire a decision by an explicit transition. It does not edit the old assertion.",
      inputSchema: { decisionId: z.string(), reason: z.string() },
    },
    (args) => run("retire_decision", () => invoke("retire_decision", args)),
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
    (args) => run("create_task", () => invoke("create_task", args)),
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
    (args) => run("update_task", () => invoke("update_task", args)),
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
    (args) => run("add_artifact", () => invoke("add_artifact", args)),
  );

  return server;
}
