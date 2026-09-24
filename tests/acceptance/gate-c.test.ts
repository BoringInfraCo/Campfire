/**
 * Sprint 006 Gate C acceptance: hosted multi-participant value.
 *
 * A third human (Marcus, created via create_human — not a seed identity)
 * contributes durable state on one HTTP server. OpenCode continues from
 * that state. No transcript, Slack paste, or SQLite copy is shared.
 *
 * Private transcript sentinel — invented only here, never sent to Campfire:
 * GATE_C_PRIVATE_TRANSCRIPT_SENTINEL_oauth_client_secret_never_shared
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { startCampfireHttpServer } from "../../src/http/server.js";
import type { RunningHttpServer } from "../../src/http/server.js";
import { createRuntimeFromPath } from "../../src/runtime.js";
import type { CampfireRuntime } from "../../src/runtime.js";

const PRIVATE_TRANSCRIPT_SENTINEL =
  "GATE_C_PRIVATE_TRANSCRIPT_SENTINEL_oauth_client_secret_never_shared";

const MARCUS_FINDING =
  "Do not change the public API; keep existing session cookie name.";

interface HttpOutcome {
  status: number;
  body: { ok: true; result: any } | { ok: false; error: string; message: string };
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

function expectOk(outcome: HttpOutcome, label: string): any {
  if (!outcome.body.ok) {
    throw new Error(
      `${label} failed (${outcome.status} ${outcome.body.error}): ${outcome.body.message}`,
    );
  }
  expect(outcome.status).toBe(200);
  return outcome.body.result;
}

let dir: string;
let runtime: CampfireRuntime;
let running: RunningHttpServer;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "campfire-gate-c-"));
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

describe("Sprint 006 Gate C hosted proof", () => {
  it("lets a third human contribute and a second harness continue from that state", async () => {
    const url = running.url;
    const sergio = FIXTURE.tokens.sergio;
    const alice = FIXTURE.tokens.alice;
    const codex = FIXTURE.tokens.codexSergio;
    const opencode = FIXTURE.tokens.opencodeAlice;
    let orientationCalls = 0;
    let inspectorCalls = 0;

    const created = expectOk(
      await call(url, sergio, "create_workspace", {
        teamId: FIXTURE.teamId,
        name: "gate-c-oauth",
      }),
      "create_workspace",
    );
    const workspaceId = created.id as string;

    const goal = expectOk(
      await call(url, sergio, "create_goal", {
        workspaceId,
        title: "Add OAuth without breaking existing session auth",
        description: "Hosted Gate C workspace created through the product, not seed.",
      }),
      "create_goal",
    );

    async function inviteAndJoin(
      actorId: string,
      actorType: "human" | "agent",
      role: "member" | "agent",
      joinerToken: string,
    ): Promise<void> {
      expectOk(
        await call(url, sergio, "invite_workspace", {
          workspaceId,
          actorId,
          actorType,
          role,
        }),
        `invite ${actorId}`,
      );
      expectOk(
        await call(url, joinerToken, "join_workspace", { workspaceId }),
        `join ${actorId}`,
      );
    }

    await inviteAndJoin(FIXTURE.humans.alice, "human", "member", alice);
    await inviteAndJoin(FIXTURE.agents.opencodeAlice, "agent", "agent", opencode);

    const marcusCreated = expectOk(
      await call(url, sergio, "create_human", {
        teamId: FIXTURE.teamId,
        displayName: "Marcus",
      }),
      "create_human Marcus",
    );
    const marcusId = marcusCreated.human.id as string;
    const marcusToken = marcusCreated.token as string;
    expect(marcusId).not.toBe(FIXTURE.humans.sergio);
    expect(marcusId).not.toBe(FIXTURE.humans.alice);

    await inviteAndJoin(marcusId, "human", "member", marcusToken);
    await inviteAndJoin(FIXTURE.agents.codexSergio, "agent", "agent", codex);

    const session = expectOk(
      await call(url, codex, "register_agent_session", {
        agentId: FIXTURE.agents.codexSergio,
        workspaceId,
        harness: "codex",
      }),
      "register_agent_session Codex",
    );
    const codexSessionId = session.id as string;

    const authFinding = expectOk(
      await call(url, codex, "add_finding", {
        workspaceId,
        agentSessionId: codexSessionId,
        summary: "Auth middleware currently binds the session cookie before any OAuth handshake.",
        detail: "The login path sets the cookie in the existing middleware stack.",
      }),
      "Codex add_finding",
    );
    expect(String(authFinding.summary)).not.toContain("Do not change the public API");
    expect(String(authFinding.summary)).not.toContain("session cookie name");

    const decision = expectOk(
      await call(url, codex, "add_decision", {
        workspaceId,
        agentSessionId: codexSessionId,
        summary: "Add OAuth as an additional identity provider next to the existing session.",
        rationale: "Avoid a flag-day cutover of the login path.",
      }),
      "Codex add_decision",
    );
    expectOk(
      await call(url, codex, "accept_decision", {
        decisionId: decision.id,
        agentSessionId: codexSessionId,
      }),
      "Codex accept_decision",
    );

    const task = expectOk(
      await call(url, codex, "create_task", {
        workspaceId,
        agentSessionId: codexSessionId,
        title: "Implement OAuth support",
        description: "Wire the OAuth callback into the existing auth middleware.",
      }),
      "Codex create_task",
    );

    expectOk(
      await call(url, codex, "add_artifact", {
        workspaceId,
        agentSessionId: codexSessionId,
        type: "document",
        title: "Billing service README",
        uriOrPath: "fixtures/billing/README.md",
      }),
      "Codex add_artifact",
    );

    const marcusFinding = expectOk(
      await call(url, marcusToken, "add_finding", {
        workspaceId,
        summary: MARCUS_FINDING,
      }),
      "Marcus add_finding",
    );
    expect(marcusFinding.createdBy).toEqual({ actorId: marcusId, actorType: "human" });
    expect(marcusFinding.agentSessionId).toBeUndefined();

    const assigned = expectOk(
      await call(url, marcusToken, "update_task", {
        taskId: task.id,
        assignee: { actorId: FIXTURE.agents.opencodeAlice, actorType: "agent" },
      }),
      "assign task to OpenCode",
    );
    expect(assigned.assignee).toEqual({
      actorId: FIXTURE.agents.opencodeAlice,
      actorType: "agent",
    });

    const unrelated = await call(url, opencode, "get_workspace_context", {
      workspaceId: FIXTURE.workspaces.unrelated,
    });
    expect(unrelated.body.ok).toBe(false);
    expect(unrelated.status).toBe(403);
    if (!unrelated.body.ok) {
      expect(["ParticipantRequired", "Unauthorized"]).toContain(unrelated.body.error);
    }

    orientationCalls += 1;
    const context = expectOk(
      await call(url, opencode, "get_workspace_context", { workspaceId }),
      "OpenCode get_workspace_context",
    );

    expect(context.goal).toBeDefined();
    expect(context.goal.id).toBe(goal.id);
    expect(context.findings.map((item: { id: string }) => item.id)).toContain(marcusFinding.id);
    expect(context.acceptedDecisions.map((item: { id: string }) => item.id)).toContain(decision.id);
    expect(context.openTasks.map((item: { id: string }) => item.id)).toContain(task.id);
    expect(
      context.provenance.some(
        (entry: { actor: { actorId: string } }) => entry.actor.actorId === FIXTURE.agents.codexSergio,
      ),
    ).toBe(true);

    const contextJson = JSON.stringify(context);
    expect(contextJson).not.toContain(FIXTURE.unrelatedFindingSentinel);
    expect(contextJson).not.toContain(PRIVATE_TRANSCRIPT_SENTINEL);
    expect(context.provenanceTruncated).toBe(context.provenanceTotal > 20);

    // Hardening A3: agent writes require a registered session.
    const opencodeSession = expectOk(
      await call(url, opencode, "register_agent_session", {
        agentId: FIXTURE.agents.opencodeAlice,
        workspaceId,
        harness: "opencode",
      }),
      "OpenCode register_agent_session",
    );
    const opencodeSessionId = opencodeSession.id as string;

    expectOk(
      await call(url, opencode, "update_task", {
        taskId: task.id,
        status: "in_progress",
        agentSessionId: opencodeSessionId,
      }),
      "OpenCode update_task in_progress",
    );
    expectOk(
      await call(url, opencode, "update_task", {
        taskId: task.id,
        status: "completed",
        agentSessionId: opencodeSessionId,
      }),
      "OpenCode update_task completed",
    );

    const continuationFinding = expectOk(
      await call(url, opencode, "add_finding", {
        workspaceId,
        agentSessionId: opencodeSessionId,
        summary:
          "Continued OAuth implementation given the public API constraint; kept the existing session cookie name.",
      }),
      "OpenCode add_finding",
    );
    expect(String(continuationFinding.summary).toLowerCase()).toMatch(/public api|session cookie/);

    expectOk(
      await call(url, opencode, "add_artifact", {
        workspaceId,
        agentSessionId: opencodeSessionId,
        type: "log",
        title: "OAuth callback sketch",
        uriOrPath: "fixtures/billing/deploy.log",
      }),
      "OpenCode add_artifact",
    );

    const eveCreated = expectOk(
      await call(url, sergio, "create_human", {
        teamId: FIXTURE.teamId,
        displayName: "Eve",
      }),
      "create_human Eve",
    );
    const eveDenied = await call(url, eveCreated.token, "get_workspace_context", { workspaceId });
    expect(eveDenied.body.ok).toBe(false);
    expect(eveDenied.status).toBe(403);
    if (!eveDenied.body.ok) {
      expect(["ParticipantRequired", "Unauthorized"]).toContain(eveDenied.body.error);
    }

    inspectorCalls += 1;
    const inspector = expectOk(
      await call(url, sergio, "get_workspace", { workspaceId }),
      "get_workspace inspector",
    );
    const participants: Array<{ actor: { actorId: string; actorType: string } }> =
      inspector.participants;
    const participantIds = participants.map((item) => item.actor.actorId);
    expect(participantIds).toEqual(
      expect.arrayContaining([
        FIXTURE.humans.sergio,
        FIXTURE.humans.alice,
        marcusId,
        FIXTURE.agents.codexSergio,
        FIXTURE.agents.opencodeAlice,
      ]),
    );

    const activityPage = expectOk(
      await call(url, opencode, "get_activity", { workspaceId, limit: 20 }),
      "get_activity limit 20",
    );
    expect(typeof activityPage.truncated).toBe("boolean");
    expect(activityPage.truncated).toBe(activityPage.total > 20);
    expect(activityPage.items.length).toBeLessThanOrEqual(20);

    const smallPage = expectOk(
      await call(url, opencode, "get_activity", { workspaceId, limit: 2 }),
      "get_activity limit 2",
    );
    expect(smallPage.truncated).toBe(true);
    expect(smallPage.items.length).toBe(2);

    const contributionCountsByActor: Record<string, number> = {};
    for (const entry of inspector.activity as Array<{ actor: { actorId: string } }>) {
      const key = entry.actor.actorId;
      contributionCountsByActor[key] = (contributionCountsByActor[key] ?? 0) + 1;
    }

    const metrics = {
      distinctHumans: participants.filter((item) => item.actor.actorType === "human").length,
      distinctAgents: participants.filter((item) => item.actor.actorType === "agent").length,
      humanCFindingUsed:
        String(continuationFinding.summary).includes("public API") ||
        String(continuationFinding.summary).includes("session cookie"),
      orientationCalls,
      inspectorCalls,
      contributionCountsByActor,
    };

    expect(metrics.distinctHumans).toBeGreaterThanOrEqual(3);
    expect(metrics.distinctAgents).toBeGreaterThanOrEqual(2);
    expect(metrics.humanCFindingUsed).toBe(true);
    expect(metrics.orientationCalls).toBeGreaterThanOrEqual(1);
    expect(Object.keys(metrics.contributionCountsByActor).length).toBeGreaterThan(0);
  });
});
