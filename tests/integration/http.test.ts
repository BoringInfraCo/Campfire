import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { startCampfireHttpServer } from "../../src/http/server.js";
import type { RunningHttpServer } from "../../src/http/server.js";
import { createRuntimeFromPath } from "../../src/runtime.js";
import type { CampfireRuntime } from "../../src/runtime.js";

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
