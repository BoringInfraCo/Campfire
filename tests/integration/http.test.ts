import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { ORIENTATION_PROVENANCE_LIMIT } from "../../src/service/service.js";
import { startCampfireHttpServer } from "../../src/http/server.js";
import type { RunningHttpServer } from "../../src/http/server.js";
import { createRuntimeFromPath } from "../../src/runtime.js";
import type { CampfireRuntime } from "../../src/runtime.js";

interface HttpOutcome {
  status: number;
  body:
    | { ok: true; result: any }
    | { ok: false; error: string; message: string; details?: Record<string, unknown> };
}

async function call(
  baseUrl: string,
  token: string | undefined,
  method: string,
  params: Record<string, unknown> = {},
): Promise<HttpOutcome> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${baseUrl}/v1/call`, {
    method: "POST",
    headers,
    body: JSON.stringify({ method, params }),
  });
  return { status: response.status, body: (await response.json()) as HttpOutcome["body"] };
}

let dir: string;
let runtime: CampfireRuntime;
let running: RunningHttpServer;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "campfire-http-"));
  runtime = createRuntimeFromPath(join(dir, "campfire.db"));
  seedFixture(runtime.store);
  vi.spyOn(console, "error").mockImplementation(() => {});
  running = await startCampfireHttpServer({ runtime, host: "127.0.0.1", port: 0 });
});

afterEach(async () => {
  await running.close();
  runtime.close();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("HTTP /v1/call", () => {
  it("requires a workspace ID for readiness", async () => {
    const result = await call(running.url, FIXTURE.tokens.sergio, "preflight");

    expect(result.status).toBe(400);
    expect(result.body.ok).toBe(false);
    if (result.body.ok) return;
    expect(result.body.error).toBe("ValidationError");
    expect(result.body.message).toContain("workspaceId");
  });

  it("checks workspace readiness without mutating collaboration state", async () => {
    const before = runtime.store.listContributions(FIXTURE.workspaces.billing).length;

    const result = await call(running.url, FIXTURE.tokens.sergio, "preflight", {
      workspaceId: FIXTURE.workspaces.billing,
    });

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    if (!result.body.ok) return;
    expect(result.body.result).toEqual({
      ready: true,
      workspaceId: FIXTURE.workspaces.billing,
      actor: { actorId: FIXTURE.humans.sergio, actorType: "human" },
    });
    expect(runtime.store.listContributions(FIXTURE.workspaces.billing)).toHaveLength(before);
  });

  it("keeps workspace existence and participation failures distinct", async () => {
    const missing = await call(running.url, FIXTURE.tokens.sergio, "preflight", {
      workspaceId: "ws_does_not_exist",
    });
    const notParticipant = await call(running.url, FIXTURE.tokens.opencodeAlice, "preflight", {
      workspaceId: FIXTURE.workspaces.unrelated,
    });

    expect(missing.status).toBe(404);
    expect(missing.body.ok).toBe(false);
    if (!missing.body.ok) expect(missing.body.error).toBe("WorkspaceNotFound");
    expect(notParticipant.status).toBe(403);
    expect(notParticipant.body.ok).toBe(false);
    if (!notParticipant.body.ok) expect(notParticipant.body.error).toBe("ParticipantRequired");
  });

  it("directs an unbound agent to register a session for the requested workspace", async () => {
    const result = await call(running.url, FIXTURE.tokens.opencodeAlice, "preflight", {
      workspaceId: FIXTURE.workspaces.billing,
    });

    expect(result.status).toBe(403);
    expect(result.body.ok).toBe(false);
    if (result.body.ok) return;
    expect(result.body.error).toBe("Unauthorized");
    expect(result.body.details?.nextAction).toBe("register_agent_session");
  });

  it("passes readiness for an agent with a valid registered session", async () => {
    const registered = await call(
      running.url,
      FIXTURE.tokens.opencodeAlice,
      "register_agent_session",
      {
        agentId: FIXTURE.agents.opencodeAlice,
        workspaceId: FIXTURE.workspaces.billing,
        harness: "opencode",
      },
    );
    expect(registered.body.ok).toBe(true);
    if (!registered.body.ok) return;

    const result = await call(running.url, FIXTURE.tokens.opencodeAlice, "preflight", {
      workspaceId: FIXTURE.workspaces.billing,
      agentSessionId: registered.body.result.id,
    });

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    if (!result.body.ok) return;
    expect(result.body.result).toEqual({
      ready: true,
      workspaceId: FIXTURE.workspaces.billing,
      actor: { actorId: FIXTURE.agents.opencodeAlice, actorType: "agent" },
      sessionId: registered.body.result.id,
    });
  });

  it("rejects a session registered for another workspace with a registration action", async () => {
    const invited = await call(running.url, FIXTURE.tokens.sergio, "invite_workspace", {
      workspaceId: FIXTURE.workspaces.unrelated,
      actorId: FIXTURE.agents.opencodeAlice,
      actorType: "agent",
      role: "agent",
    });
    expect(invited.body.ok).toBe(true);
    const joined = await call(running.url, FIXTURE.tokens.opencodeAlice, "join_workspace", {
      workspaceId: FIXTURE.workspaces.unrelated,
    });
    expect(joined.body.ok).toBe(true);

    const registered = await call(
      running.url,
      FIXTURE.tokens.opencodeAlice,
      "register_agent_session",
      {
        agentId: FIXTURE.agents.opencodeAlice,
        workspaceId: FIXTURE.workspaces.billing,
        harness: "opencode",
      },
    );
    expect(registered.body.ok).toBe(true);
    if (!registered.body.ok) return;

    const result = await call(running.url, FIXTURE.tokens.opencodeAlice, "preflight", {
      workspaceId: FIXTURE.workspaces.unrelated,
      agentSessionId: registered.body.result.id,
    });

    expect(result.status).toBe(403);
    expect(result.body.ok).toBe(false);
    if (result.body.ok) return;
    expect(result.body.error).toBe("Unauthorized");
    expect(result.body.details?.nextAction).toBe("register_agent_session");
  });

  it("rejects an ended session with a registration action", async () => {
    const registered = await call(
      running.url,
      FIXTURE.tokens.opencodeAlice,
      "register_agent_session",
      {
        agentId: FIXTURE.agents.opencodeAlice,
        workspaceId: FIXTURE.workspaces.billing,
        harness: "opencode",
      },
    );
    expect(registered.body.ok).toBe(true);
    if (!registered.body.ok) return;
    const ended = await call(running.url, FIXTURE.tokens.opencodeAlice, "end_agent_session", {
      sessionId: registered.body.result.id,
    });
    expect(ended.body.ok).toBe(true);

    const result = await call(running.url, FIXTURE.tokens.opencodeAlice, "preflight", {
      workspaceId: FIXTURE.workspaces.billing,
      agentSessionId: registered.body.result.id,
    });

    expect(result.status).toBe(403);
    expect(result.body.ok).toBe(false);
    if (result.body.ok) return;
    expect(result.body.error).toBe("Unauthorized");
    expect(result.body.details?.nextAction).toBe("register_agent_session");
  });

  it("rejects a session belonging to another actor with a registration action", async () => {
    const registered = await call(
      running.url,
      FIXTURE.tokens.codexSergio,
      "register_agent_session",
      {
        agentId: FIXTURE.agents.codexSergio,
        workspaceId: FIXTURE.workspaces.billing,
        harness: "codex",
      },
    );
    expect(registered.body.ok).toBe(true);
    if (!registered.body.ok) return;

    const result = await call(running.url, FIXTURE.tokens.opencodeAlice, "preflight", {
      workspaceId: FIXTURE.workspaces.billing,
      agentSessionId: registered.body.result.id,
    });

    expect(result.status).toBe(403);
    expect(result.body.ok).toBe(false);
    if (result.body.ok) return;
    expect(result.body.error).toBe("Unauthorized");
    expect(result.body.details?.nextAction).toBe("register_agent_session");
  });

  it("rejects a missing bearer token with 401", async () => {
    const result = await call(running.url, undefined, "whoami");
    expect(result.status).toBe(401);
    expect(result.body.ok).toBe(false);
    if (result.body.ok) return;
    expect(result.body.error).toBe("Unauthorized");
  });

  it("rejects an invalid bearer token with 401", async () => {
    const result = await call(running.url, "cft_not_a_real_token_0000000000000000", "whoami");
    expect(result.status).toBe(401);
    expect(result.body.ok).toBe(false);
    if (result.body.ok) return;
    expect(result.body.error).toBe("Unauthorized");
  });

  it("does not let alice's agent read ws_auth_migration", async () => {
    const result = await call(
      running.url,
      FIXTURE.tokens.opencodeAlice,
      "get_workspace_context",
      { workspaceId: FIXTURE.workspaces.unrelated },
    );
    expect(result.body.ok).toBe(false);
    expect(result.status).toBe(403);
    if (result.body.ok) return;
    expect(["ParticipantRequired", "Unauthorized"]).toContain(result.body.error);
  });

  it("does not let Sergio's token act as Alice", async () => {
    const who = await call(running.url, FIXTURE.tokens.sergio, "whoami", {
      actorId: FIXTURE.humans.alice,
      actorType: "human",
    });
    expect(who.status).toBe(200);
    expect(who.body.ok).toBe(true);
    if (!who.body.ok) return;
    expect(who.body.result.actor).toEqual({
      actorId: FIXTURE.humans.sergio,
      actorType: "human",
    });

    const finding = await call(running.url, FIXTURE.tokens.sergio, "add_finding", {
      workspaceId: FIXTURE.workspaces.billing,
      summary: "Sergio wrote this",
      actorId: FIXTURE.humans.alice,
      actorType: "human",
    });
    expect(finding.status).toBe(200);
    expect(finding.body.ok).toBe(true);
    if (!finding.body.ok) return;
    expect(finding.body.result.createdBy).toEqual({
      actorId: FIXTURE.humans.sergio,
      actorType: "human",
    });
  });

  it("creates a workspace, denies uninvited join, then lists it after invite+join", async () => {
    const created = await call(running.url, FIXTURE.tokens.sergio, "create_workspace", {
      teamId: FIXTURE.teamId,
      name: "http-shared",
    });
    expect(created.status).toBe(200);
    expect(created.body.ok).toBe(true);
    if (!created.body.ok) return;
    const workspaceId = created.body.result.id as string;

    const listedBefore = await call(running.url, FIXTURE.tokens.opencodeAlice, "list_workspaces");
    expect(listedBefore.body.ok).toBe(true);
    if (!listedBefore.body.ok) return;
    expect(listedBefore.body.result.map((workspace: { id: string }) => workspace.id)).not.toContain(
      workspaceId,
    );

    const uninvited = await call(running.url, FIXTURE.tokens.opencodeAlice, "join_workspace", {
      workspaceId,
    });
    expect(uninvited.body.ok).toBe(false);
    expect(uninvited.status).toBe(403);
    if (uninvited.body.ok) return;
    expect(["ParticipantRequired", "Unauthorized"]).toContain(uninvited.body.error);

    const invited = await call(running.url, FIXTURE.tokens.sergio, "invite_workspace", {
      workspaceId,
      actorId: FIXTURE.agents.opencodeAlice,
      actorType: "agent",
      role: "agent",
    });
    expect(invited.status).toBe(200);
    expect(invited.body.ok).toBe(true);

    const joined = await call(running.url, FIXTURE.tokens.opencodeAlice, "join_workspace", {
      workspaceId,
    });
    expect(joined.status).toBe(200);
    expect(joined.body.ok).toBe(true);

    const listedAfter = await call(running.url, FIXTURE.tokens.opencodeAlice, "list_workspaces");
    expect(listedAfter.body.ok).toBe(true);
    if (!listedAfter.body.ok) return;
    expect(listedAfter.body.result.map((workspace: { id: string }) => workspace.id)).toContain(
      workspaceId,
    );
  });

  it("does not honor a spoofed humanId on register_agent_session", async () => {
    const session = await call(running.url, FIXTURE.tokens.opencodeAlice, "register_agent_session", {
      agentId: FIXTURE.agents.opencodeAlice,
      humanId: FIXTURE.humans.sergio,
      workspaceId: FIXTURE.workspaces.billing,
      harness: "opencode",
    });
    if (session.body.ok) {
      expect(session.body.result.humanId).toBe(FIXTURE.humans.alice);
    } else {
      expect(session.status).toBe(403);
      expect(session.body.error).toBe("Unauthorized");
    }
  });
});

describe("HTTP /v1/call Sprint 008 orientation", () => {
  async function createPopulatedWorkspace(): Promise<{
    workspaceId: string;
    decisionId: string;
    taskId: string;
  }> {
    const created = await call(running.url, FIXTURE.tokens.sergio, "create_workspace", {
      teamId: FIXTURE.teamId,
      name: "sprint-008-orientation",
    });
    expect(created.body.ok).toBe(true);
    if (!created.body.ok) throw new Error("workspace creation failed");
    const workspaceId = created.body.result.id as string;

    await call(running.url, FIXTURE.tokens.sergio, "create_goal", {
      workspaceId,
      title: "Enter the room",
    });
    const decision = await call(running.url, FIXTURE.tokens.sergio, "add_decision", {
      workspaceId,
      summary: "Adopt the orientation projection",
    });
    if (!decision.body.ok) throw new Error("decision creation failed");
    const task = await call(running.url, FIXTURE.tokens.sergio, "create_task", {
      workspaceId,
      title: "Render Needs You",
      assignee: { actorId: FIXTURE.humans.sergio, actorType: "human" },
    });
    if (!task.body.ok) throw new Error("task creation failed");
    await call(running.url, FIXTURE.tokens.sergio, "update_task", {
      taskId: task.body.result.id,
      status: "blocked",
    });
    return {
      workspaceId,
      decisionId: decision.body.result.id as string,
      taskId: task.body.result.id as string,
    };
  }

  it("returns the orientation projection without since when none is supplied", async () => {
    const { workspaceId, decisionId, taskId } = await createPopulatedWorkspace();

    const result = await call(running.url, FIXTURE.tokens.sergio, "get_workspace_context", {
      workspaceId,
    });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    if (!result.body.ok) return;
    const context = result.body.result;
    expect(context.needsYou.map((item: { reason: string }) => item.reason)).toEqual([
      "proposed_decision_actionable",
      "assigned_blocked_task",
    ]);
    expect(context.needsYou.map((item: { id: string }) => item.id)).toEqual([decisionId, taskId]);
    expect(context.suggestedNextAction).toMatchObject({
      kind: "decision",
      id: decisionId,
      reason: "proposed_decision_actionable",
      orientationHint: true,
    });
    expect(Array.isArray(context.provenanceSummary)).toBe(true);
    expect(context.since).toBeUndefined();
    expect(context.alignment.status).toBe("open");
    expect(context.alignment.proposedDecisionIds).toEqual([decisionId]);
    expect(context.alignment.acceptedDecisionIds).toEqual([]);
    expect(context.alignment.unresolvedBlockedTaskIds).toEqual([taskId]);
  });

  it("projects contributions strictly after a since cursor and rejects an unknown one", async () => {
    const { workspaceId } = await createPopulatedWorkspace();

    const activity = await call(running.url, FIXTURE.tokens.sergio, "get_activity", {
      workspaceId,
    });
    expect(activity.body.ok).toBe(true);
    if (!activity.body.ok) return;
    const items = activity.body.result.items as Array<{ id: string }>;
    const anchor = items[0]!.id;

    const withSince = await call(running.url, FIXTURE.tokens.sergio, "get_workspace_context", {
      workspaceId,
      since: anchor,
    });
    expect(withSince.status).toBe(200);
    expect(withSince.body.ok).toBe(true);
    if (!withSince.body.ok) return;
    expect(withSince.body.result.since).toBeDefined();
    expect(
      withSince.body.result.since.items.map((item: { id: string }) => item.id),
    ).toEqual(items.slice(1).map((item) => item.id));

    const unknown = await call(running.url, FIXTURE.tokens.sergio, "get_workspace_context", {
      workspaceId,
      since: "con_missing",
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.ok).toBe(false);
    if (unknown.body.ok) return;
    expect(unknown.body.error).toBe("ValidationError");
    expect(unknown.body.message).toContain("since");
  });

  it("locks truncation, the empty window, and a foreign workspace cursor", async () => {
    const { workspaceId } = await createPopulatedWorkspace();
    for (let index = 0; index < ORIENTATION_PROVENANCE_LIMIT + 1; index += 1) {
      const finding = await call(running.url, FIXTURE.tokens.sergio, "add_finding", {
        workspaceId,
        summary: `http delta ${index}`,
      });
      expect(finding.body.ok).toBe(true);
    }

    const activity = await call(running.url, FIXTURE.tokens.sergio, "get_activity", { workspaceId });
    expect(activity.body.ok).toBe(true);
    if (!activity.body.ok) return;
    // Activity pages are chronological (oldest first).
    const items = activity.body.result.items as Array<{ id: string }>;
    const oldest = items[0]!.id;
    const newest = items.at(-1)!.id;

    const truncated = await call(running.url, FIXTURE.tokens.sergio, "get_workspace_context", {
      workspaceId,
      since: oldest,
    });
    expect(truncated.status).toBe(200);
    expect(truncated.body.ok).toBe(true);
    if (!truncated.body.ok) return;
    expect(truncated.body.result.since.truncated).toBe(true);
    expect(truncated.body.result.since.items).toHaveLength(ORIENTATION_PROVENANCE_LIMIT);
    expect(truncated.body.result.since.cursor).toBe(newest);

    const empty = await call(running.url, FIXTURE.tokens.sergio, "get_workspace_context", {
      workspaceId,
      since: newest,
    });
    expect(empty.status).toBe(200);
    expect(empty.body.ok).toBe(true);
    if (!empty.body.ok) return;
    expect(empty.body.result.since).toEqual({ cursor: newest, items: [], truncated: false });

    // A real contribution id from the billing workspace is unknown here.
    const billing = await call(running.url, FIXTURE.tokens.sergio, "get_activity", {
      workspaceId: FIXTURE.workspaces.billing,
    });
    expect(billing.body.ok).toBe(true);
    if (!billing.body.ok) return;
    const foreignId = (billing.body.result.items as Array<{ id: string }>)[0]!.id;

    const foreign = await call(running.url, FIXTURE.tokens.sergio, "get_workspace_context", {
      workspaceId: FIXTURE.workspaces.unrelated,
      since: foreignId,
    });
    expect(foreign.status).toBe(400);
    expect(foreign.body.ok).toBe(false);
    if (foreign.body.ok) return;
    expect(foreign.body.error).toBe("ValidationError");
    expect(JSON.stringify(foreign.body)).not.toContain(FIXTURE.unrelatedFindingSentinel);
  });
});
