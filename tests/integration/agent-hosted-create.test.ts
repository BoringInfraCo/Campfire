import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import * as profiles from "../../src/bootstrap/profile.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { Conflict, ParticipantRequired, SessionNotFound, ValidationError } from "../../src/domain/errors.js";
import { startCampfireHttpServer, type RunningHttpServer } from "../../src/http/server.js";
import { createCampfireMcpServer } from "../../src/mcp/tools.js";
import { createRuntimeFromPath, type CampfireRuntime } from "../../src/runtime.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { ActorContext } from "../../src/service/authorization.js";
import type { CampfireService, CreatedWorkspace } from "../../src/service/service.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { createAsyncCampfireService, type AsyncCampfireService } from "../../src/worker/async-service.js";
import { dispatchCampfireMethodAsync } from "../../src/worker/async-dispatch.js";
import { CAMPFIRE_D1_SCHEMA_SQL } from "../../src/worker/schema.js";
import { createD1Store, migrateD1 } from "../../src/worker/d1-store.js";
import type { D1Database, D1PreparedStatement } from "../../src/worker/d1-types.js";
import { ENROLLMENT_ISSUE_REQUEST_COLUMN_SQL, V13_SQL } from "../../src/store/enrollment-issue-request-schema.js";
import { V14_SQL } from "../../src/store/workspace-create-request-schema.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";

const NOW = "2026-11-17T00:00:00.000Z";
const TEAM = FIXTURE.teamId;
const AGENT: ActorContext = { actor: { actorId: FIXTURE.agents.codexSergio, actorType: "agent" } };
const HUMAN: ActorContext = { actor: { actorId: FIXTURE.humans.sergio, actorType: "human" } };
const ALICE: ActorContext = { actor: { actorId: FIXTURE.humans.alice, actorType: "human" } };

function wrapSync(store: CampfireStore) {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === "transaction") return (fn: () => Promise<unknown>) => fn();
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function"
        ? (...args: unknown[]) => Promise.resolve((value as (...args: unknown[]) => unknown).apply(target, args))
        : value;
    },
  });
}

function names(store: CampfireStore, name: string): string[] {
  return store.listWorkspaces().filter((workspace) => workspace.name === name).map((workspace) => workspace.id);
}

async function callHttp(baseUrl: string, token: string, method: string, params: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}/v1/call`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ method, params }),
  });
  return { status: response.status, body: await response.json() as { ok: boolean; result?: CreatedWorkspace; error?: string; message?: string } };
}

for (const mode of ["sync", "async"] as const) {
  describe(`agent hosted create (${mode})`, () => {
    let sqlite: CampfireStore;
    let service: CampfireService | AsyncCampfireService;

    afterEach(() => service.close());

    function setup(): void {
      sqlite = openInMemoryStore();
      seedFixture(sqlite, { clock: () => NOW });
      const options = { idSource: createCounterIdSource(), clock: () => NOW, store: sqlite };
      service = mode === "sync"
        ? createCampfireService(options)
        : createAsyncCampfireService({ ...options, store: wrapSync(sqlite) as never });
    }

    async function create(ctx: ActorContext, input: { teamId: string; name: string; description?: string; requestId?: string; workspaceId?: string }): Promise<CreatedWorkspace> {
      if (mode === "async" && ctx === AGENT && input.requestId !== undefined && input.workspaceId === undefined) {
        return await dispatchCampfireMethodAsync(service as AsyncCampfireService, ctx, "create_workspace", input) as CreatedWorkspace;
      }
      return service.createWorkspace(ctx, input);
    }

    it("creates one shared workspace and reuses the open session on the same requestId", async () => {
      setup();
      const before = sqlite.listWorkspaces().length;
      const first = await create(AGENT, { teamId: TEAM, name: "Shared", requestId: "req-shared-1" });
      const second = await create(AGENT, { teamId: TEAM, name: "Shared", requestId: "req-shared-1" });
      expect(first.id).toBeTruthy();
      expect(second.id).toBe(first.id);
      expect(first.resumed).toBe(false);
      expect(second.resumed).toBe(true);
      expect(second.sessionId).toBe(first.sessionId);
      expect(sqlite.listWorkspaces()).toHaveLength(before + 1);
      expect(names(sqlite, "Shared")).toEqual([first.id]);
      const owners = sqlite.listParticipants(first.id).map((participant) => [participant.actor.actorId, participant.actor.actorType, participant.role]);
      expect(owners).toEqual(expect.arrayContaining([
        [FIXTURE.agents.codexSergio, "agent", "owner"],
        [FIXTURE.humans.sergio, "human", "owner"],
      ]));
      expect(sqlite.listAgentSessions(first.id).filter((session) => session.endedAt === undefined)).toHaveLength(1);
      const row = sqlite.getWorkspaceCreateRequest(AGENT.actor, "req-shared-1");
      expect(row?.workspaceId).toBe(first.id);
      expect(JSON.stringify(row)).not.toContain("cft_");
    });

    it("conflicts when the same requestId is reused with a different name", async () => {
      setup();
      const first = await create(AGENT, { teamId: TEAM, name: "Shared", requestId: "req-shared-2" });
      await expect(create(AGENT, { teamId: TEAM, name: "Other", requestId: "req-shared-2" })).rejects.toBeInstanceOf(Conflict);
      expect(names(sqlite, "Shared")).toEqual([first.id]);
      expect(names(sqlite, "Other")).toEqual([]);
    });

    it("resumes by workspaceId without inserting another workspace", async () => {
      setup();
      const first = await create(AGENT, { teamId: TEAM, name: "Shared", requestId: "req-shared-3" });
      const before = sqlite.listWorkspaces().length;
      const resumed = await service.createWorkspace(AGENT, { teamId: TEAM, name: "Shared", workspaceId: first.id });
      expect(sqlite.listWorkspaces()).toHaveLength(before);
      expect(resumed.id).toBe(first.id);
      expect(resumed.resumed).toBe(true);
      expect(resumed.sessionId).toBe(first.sessionId);
      expect(sqlite.listParticipants(first.id)).toHaveLength(2);
    });

    it("does not add or reveal the workspace to an actor who only knows the id", async () => {
      setup();
      const first = await create(AGENT, { teamId: TEAM, name: "Shared", requestId: "req-shared-4" });
      const before = sqlite.listParticipants(first.id).map((participant) => participant.actor.actorId);
      await expect(async () => { await service.createWorkspace(ALICE, { teamId: TEAM, name: "Shared", workspaceId: first.id }); }).rejects.toBeInstanceOf(ParticipantRequired);
      await expect(async () => { await service.getWorkspace(ALICE, first.id); }).rejects.toBeInstanceOf(ParticipantRequired);
      expect(sqlite.listParticipants(first.id).map((participant) => participant.actor.actorId)).toEqual(before);
      expect(sqlite.listWorkspacesForActor(ALICE.actor).map((workspace) => workspace.id)).not.toContain(first.id);
    });

    it("still creates a workspace for a legacy agent with no owning human", async () => {
      setup();
      const before = sqlite.listWorkspaces().length;
      sqlite.createAgent({
        id: "agt_orphan",
        teamId: TEAM,
        name: "Orphan",
        harness: "codex",
        createdAt: NOW,
      });
      const orphan = { actor: { actorId: "agt_orphan", actorType: "agent" as const } };
      const first = await service.createWorkspace(orphan, { teamId: TEAM, name: "Legacy orphan" });
      const second = await service.createWorkspace(orphan, { teamId: TEAM, name: "Legacy orphan again" });
      expect(sqlite.listWorkspaces()).toHaveLength(before + 2);
      expect(first.id).not.toBe(second.id);
      expect(first).not.toHaveProperty("sessionId");
      expect(second).not.toHaveProperty("sessionId");
      expect(sqlite.listAgentSessions(first.id)).toHaveLength(0);
      expect(sqlite.listAgentSessions(second.id)).toHaveLength(0);
      expect(sqlite.getWorkspaceCreateRequest(orphan.actor, "req-orphan")).toBeUndefined();
    });

    it("refuses an agent with no owning human before creating a workspace", async () => {
      setup();
      const before = sqlite.listWorkspaces().length;
      sqlite.createAgent({
        id: "agt_orphan",
        teamId: TEAM,
        name: "Orphan",
        harness: "codex",
        createdAt: NOW,
      });
      await expect(async () => {
        await service.createWorkspace(
          { actor: { actorId: "agt_orphan", actorType: "agent" } },
          { teamId: TEAM, name: "Not shared", requestId: "req-orphan" },
        );
      }).rejects.toBeInstanceOf(ValidationError);
      expect(sqlite.listWorkspaces()).toHaveLength(before);
      expect(sqlite.getWorkspaceCreateRequest({ actorId: "agt_orphan", actorType: "agent" }, "req-orphan")).toBeUndefined();
    });

    it("retries a committed workspace after session registration fails once", async () => {
      setup();
      const original = sqlite.createAgentSession.bind(sqlite);
      let failed = false;
      sqlite.createAgentSession = (session) => {
        if (!failed) {
          failed = true;
          throw new Error("session write failed once");
        }
        return original(session);
      };
      await expect(async () => {
        await service.createWorkspace(AGENT, { teamId: TEAM, name: "Shared", requestId: "req-retry" });
      }).rejects.toThrow(/session write failed once/);
      expect(names(sqlite, "Shared")).toHaveLength(1);
      expect(sqlite.listAgentSessions(names(sqlite, "Shared")[0]!).filter((session) => session.endedAt === undefined)).toHaveLength(0);
      const retried = await service.createWorkspace(AGENT, { teamId: TEAM, name: "Shared", requestId: "req-retry" });
      expect(retried.resumed).toBe(true);
      expect(retried.sessionId).toBeTruthy();
      expect(names(sqlite, "Shared")).toEqual([retried.id]);
      expect(sqlite.listAgentSessions(retried.id).filter((session) => session.endedAt === undefined)).toHaveLength(1);
    });

    it("still creates a distinct workspace for each human call without requestId", async () => {
      setup();
      const first = await service.createWorkspace(HUMAN, { teamId: TEAM, name: "Human one" });
      const second = await service.createWorkspace(HUMAN, { teamId: TEAM, name: "Human two" });
      expect(first.id).not.toBe(second.id);
      expect(first).not.toHaveProperty("sessionId");
      expect(first).not.toHaveProperty("resumed");
      expect(second).not.toHaveProperty("sessionId");
      expect(sqlite.listAgentSessions(first.id)).toHaveLength(0);
    });

    it("keeps a legacy agent create free of a session and still adds the owning human", async () => {
      setup();
      const created = await service.createWorkspace(AGENT, { teamId: TEAM, name: "Legacy" });
      expect(created).not.toHaveProperty("sessionId");
      expect(created).not.toHaveProperty("resumed");
      expect(sqlite.listParticipants(created.id).map((participant) => participant.actor.actorId).sort()).toEqual(
        [FIXTURE.agents.codexSergio, FIXTURE.humans.sergio].sort(),
      );
      expect(sqlite.listAgentSessions(created.id)).toHaveLength(0);
      const again = await service.createWorkspace(AGENT, { teamId: TEAM, name: "Legacy" });
      expect(again.id).not.toBe(created.id);
    });
  });
}

describe("agent hosted create over loopback", () => {
  let dir: string;
  let runtime: CampfireRuntime;
  let running: RunningHttpServer;

  afterEach(async () => {
    await running?.close();
    runtime?.close();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  it("uses the agent token only and does not read a human credential", async () => {
    const loadCredentials = vi.spyOn(profiles, "loadCredentials");
    dir = mkdtempSync(join(tmpdir(), "campfire-agent-create-"));
    runtime = createRuntimeFromPath(join(dir, "campfire.db"));
    seedFixture(runtime.store, { clock: () => NOW });
    running = await startCampfireHttpServer({ runtime, host: "127.0.0.1", port: 0 });
    const agentToken = FIXTURE.tokens.codexSergio;
    const created = await callHttp(running.url, agentToken, "create_workspace", {
      teamId: TEAM,
      name: "From the agent",
      requestId: "req-http-1",
    });
    expect(loadCredentials).not.toHaveBeenCalled();
    expect(created.status).toBe(200);
    expect(created.body.ok).toBe(true);
    const workspace = created.body.result!;
    expect(workspace.sessionId).toBeTruthy();
    expect(workspace.resumed).toBe(false);
    expect(JSON.stringify(created.body)).not.toContain(FIXTURE.tokens.sergio);
    const again = await callHttp(running.url, agentToken, "create_workspace", {
      teamId: TEAM,
      name: "From the agent",
      requestId: "req-http-1",
    });
    expect(again.body.result?.id).toBe(workspace.id);
    expect(again.body.result?.sessionId).toBe(workspace.sessionId);
    expect(again.body.result?.resumed).toBe(true);
    const goal = await callHttp(running.url, agentToken, "create_goal", {
      workspaceId: workspace.id,
      title: "Start shared work",
      agentSessionId: workspace.sessionId,
    });
    expect(goal.body.ok).toBe(true);
    const denied = await callHttp(running.url, FIXTURE.tokens.alice, "get_workspace", { workspaceId: workspace.id });
    expect(denied.body.ok).toBe(false);
    expect(denied.body.error).toBe("ParticipantRequired");
    expect(runtime.store.listParticipants(workspace.id).map((participant) => participant.actor.actorId)).not.toContain(FIXTURE.humans.alice);
    loadCredentials.mockRestore();
  });
});

describe("agent hosted create MCP binding", () => {
  it("binds the connection session so the next tool call can write", async () => {
    const store = openInMemoryStore();
    const service = createCampfireService({ store, idSource: createCounterIdSource(), clock: () => NOW });
    seedFixture(store, { clock: () => NOW });
    const server = createCampfireMcpServer({
      service,
      identity: { ctx: { actor: AGENT.actor }, harness: "codex" },
    });
    const client = new Client({ name: "agent-hosted-create", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const created = await client.callTool({
        name: "create_workspace",
        arguments: { teamId: TEAM, name: "Bound", requestId: "req-mcp-1" },
      });
      const text = (created.content as Array<{ text?: string }>)[0]?.text ?? "";
      const workspace = JSON.parse(text) as CreatedWorkspace;
      expect(created.isError).not.toBe(true);
      const who = await client.callTool({ name: "whoami", arguments: {} });
      const identity = JSON.parse((who.content as Array<{ text?: string }>)[0]?.text ?? "") as { sessionId?: string };
      expect(identity.sessionId).toBe(workspace.sessionId);
      const goal = await client.callTool({
        name: "create_goal",
        arguments: { workspaceId: workspace.id, title: "Continue" },
      });
      expect(goal.isError).not.toBe(true);
    } finally {
      await client.close();
      await server.close();
      service.close();
    }
  });
});

describe("agent hosted create request index", () => {
  it("replays a lost unique-index race without a second workspace", () => {
    const store = openInMemoryStore();
    const service = createCampfireService({ store, idSource: createCounterIdSource(), clock: () => NOW });
    seedFixture(store, { clock: () => NOW });
    const first = service.createWorkspace(AGENT, { teamId: TEAM, name: "Shared", requestId: "req-race" });
    const original = store.getWorkspaceCreateRequest.bind(store);
    let skipped = false;
    store.getWorkspaceCreateRequest = (actor, requestId) => {
      if (!skipped) {
        skipped = true;
        return undefined;
      }
      return original(actor, requestId);
    };
    const second = service.createWorkspace(AGENT, { teamId: TEAM, name: "Shared", requestId: "req-race" });
    expect(second.id).toBe(first.id);
    expect(second.resumed).toBe(true);
    expect(names(store, "Shared")).toEqual([first.id]);
    service.close();
  });

  it("matches the worker batch on injected D1", async () => {
    const adapter = sqliteD1();
    await migrateD1(adapter.binding);
    const store = createD1Store(adapter.binding);
    const service = createAsyncCampfireService({ store, idSource: createCounterIdSource(), clock: () => NOW });
    await store.createOrganization({ id: "org_1", name: "Org", createdAt: NOW });
    await store.createTeam({ id: "team_1", organizationId: "org_1", name: "Eng", createdAt: NOW });
    const { human } = await service.createHuman(undefined, { teamId: "team_1", displayName: "Ada" });
    const { agent } = await service.createAgent(
      { actor: { actorId: human.id, actorType: "human" } },
      { teamId: "team_1", humanId: human.id, name: "Codex", harness: "codex" },
    );
    const actor: ActorContext = { actor: { actorId: agent.id, actorType: "agent" } };
    const input = { teamId: "team_1", name: "Shared", requestId: "req-d1" };
    const first = await dispatchCampfireMethodAsync(service, actor, "create_workspace", input) as CreatedWorkspace;
    const second = await service.createWorkspace(actor, input);
    expect(second.id).toBe(first.id);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.resumed).toBe(true);
    const participants = await store.listParticipants(first.id);
    expect(participants.map((participant) => [participant.actor.actorId, participant.role]).sort()).toEqual([
      [agent.id, "owner"],
      [human.id, "owner"],
    ].sort());
    const original = store.getWorkspaceCreateRequest.bind(store);
    let skipped = false;
    store.getWorkspaceCreateRequest = async (who, requestId) => {
      if (!skipped) {
        skipped = true;
        return undefined;
      }
      return original(who, requestId);
    };
    const raced = await service.createWorkspace(actor, input);
    expect(raced.id).toBe(first.id);
    const count = adapter.database.prepare("SELECT COUNT(*) AS n FROM workspaces").get() as { n: number };
    expect(count.n).toBe(1);
    const index = adapter.database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_workspace_create_request'",
    ).get();
    expect(index).toBeDefined();
    adapter.database.close();
  });
});

describe("retryable session claim race", () => {
  it("overlaps two retryable creates onto one claimed session", async () => {
    const adapter = sqliteD1();
    const originalPrepare = adapter.binding.prepare.bind(adapter.binding);
    adapter.binding.prepare = (sql: string) => {
      const statement = originalPrepare(sql) as D1PreparedStatement & { sql?: string };
      statement.sql = sql;
      return statement;
    };
    await migrateD1(adapter.binding);
    const ids = createCounterIdSource();
    const storeA = createD1Store(adapter.binding);
    const storeB = createD1Store(adapter.binding);
    const serviceA = createAsyncCampfireService({ store: storeA, idSource: ids, clock: () => NOW });
    const serviceB = createAsyncCampfireService({ store: storeB, idSource: ids, clock: () => NOW });
    try {
      await storeA.createOrganization({ id: "org_1", name: "Org", createdAt: NOW });
      await storeA.createTeam({ id: "team_1", organizationId: "org_1", name: "Eng", createdAt: NOW });
      const { human } = await serviceA.createHuman(undefined, { teamId: "team_1", displayName: "Ada" });
      const { agent } = await serviceA.createAgent(
        { actor: { actorId: human.id, actorType: "human" } },
        { teamId: "team_1", humanId: human.id, name: "Codex", harness: "codex" },
      );
      const actor: ActorContext = { actor: { actorId: agent.id, actorType: "agent" } };
      const input = { teamId: "team_1", name: "Shared", requestId: "req-overlap" };
      const createSession = storeA.createAgentSession.bind(storeA);
      storeA.createAgentSession = async () => {
        throw new Error("session write failed once");
      };
      await expect(serviceA.createWorkspace(actor, input)).rejects.toThrow(/session write failed once/);
      storeA.createAgentSession = createSession;
      expect(await storeA.listAgentSessions((await storeA.listWorkspaces())[0]!.id)).toHaveLength(0);

      const originalBatch = adapter.binding.batch.bind(adapter.binding);
      const overlap = new Promise<CreatedWorkspace>((resolve, reject) => {
        const waiters: Array<() => void> = [];
        let started = false;
        adapter.binding.batch = async (statements: D1PreparedStatement[]) => {
          const sql = statements.map((statement) => (statement as { sql?: string }).sql ?? "").join("\n");
          if (sql.includes("INSERT INTO agent_sessions")) {
            if (!started) {
              started = true;
              adapter.beforeBatch = () => {
                adapter.beforeBatch = undefined;
                void serviceB.createWorkspace(actor, input).then(resolve, reject);
              };
              adapter.beforeBatch();
              await new Promise<void>((resume) => waiters.push(resume));
            } else if (waiters.length > 0) {
              waiters.shift()?.();
            }
          }
          return originalBatch(statements);
        };
      });
      const first = serviceA.createWorkspace(actor, input);
      const [a, b] = await Promise.all([first, overlap]);
      expect(a.id).toBe(b.id);
      expect(a.sessionId).toBe(b.sessionId);
      expect(a.sessionId).toBeTruthy();
      expect(a.resumed).toBe(true);
      expect(b.resumed).toBe(true);
      const open = (await storeA.listAgentSessions(a.id)).filter((session) => session.endedAt === undefined);
      expect(open.map((session) => session.id)).toEqual([a.sessionId]);
      const claims = adapter.database.prepare(
        "SELECT session_id FROM workspace_create_session_claims WHERE agent_id = ? AND workspace_id = ?",
      ).all(agent.id, a.id) as Array<{ session_id: string }>;
      expect(claims).toEqual([{ session_id: a.sessionId }]);
      const workspaces = adapter.database.prepare("SELECT COUNT(*) AS n FROM workspaces").get() as { n: number };
      expect(workspaces.n).toBe(1);

      const extra = await serviceA.registerAgentSession(actor, {
        agentId: agent.id,
        workspaceId: a.id,
        harness: "codex",
      });
      expect(extra.id).not.toBe(a.sessionId);
      await serviceA.endAgentSession(actor, a.sessionId!);
      const replaced = await serviceA.createWorkspace(actor, input);
      expect(replaced.id).toBe(a.id);
      expect(replaced.sessionId).not.toBe(a.sessionId);
      expect(replaced.sessionId).not.toBe(extra.id);
      const openAfter = (await storeA.listAgentSessions(a.id)).filter((session) => session.endedAt === undefined);
      expect(openAfter.map((session) => session.id).sort()).toEqual([extra.id, replaced.sessionId].sort());
    } finally {
      adapter.database.close();
    }
  });
});

describe("losing claim conflict validates the winning session", () => {
  const ENDED_AT = "2026-11-17T00:01:00.000Z";

  /**
   * A loser reads `prior` before the winner's claim is visible to it. Hide that
   * first read so the create enters the transaction and its claim insert really
   * collides with the winner's committed claim. Every later read is the real
   * one, which is what the conflict branch uses to find the winner.
   */
  function hidePriorClaimOnce<T extends {
    getWorkspaceCreateSessionClaim: (agentId: string, workspaceId: string) => unknown;
  }>(store: T): void {
    const read = store.getWorkspaceCreateSessionClaim.bind(store);
    let hidden = false;
    store.getWorkspaceCreateSessionClaim = ((agentId: string, workspaceId: string) => {
      if (!hidden) {
        hidden = true;
        return undefined;
      }
      return read(agentId, workspaceId);
    }) as T["getWorkspaceCreateSessionClaim"];
  }

  it("sync: the loser returns the open winner and its rollback leaves that session open", () => {
    const store = openInMemoryStore();
    const service = createCampfireService({ store, idSource: createCounterIdSource(), clock: () => NOW });
    try {
      seedFixture(store, { clock: () => NOW });
      const input = { teamId: TEAM, name: "Claimed", requestId: "req-claim-sync-open" };
      const first = service.createWorkspace(AGENT, input);
      const winnerId = first.sessionId!;
      expect(store.getAgentSession(winnerId)?.endedAt).toBeUndefined();

      hidePriorClaimOnce(store);
      const loser = service.createWorkspace(AGENT, input);

      expect(loser.id).toBe(first.id);
      expect(loser.sessionId).toBe(winnerId);
      expect(store.getAgentSession(winnerId)?.endedAt).toBeUndefined();
      expect(store.listAgentSessions(first.id).filter(
        (session) => session.agentId === FIXTURE.agents.codexSergio && session.endedAt === undefined,
      ).map((session) => session.id)).toEqual([winnerId]);
      expect(store.getWorkspaceCreateSessionClaim(FIXTURE.agents.codexSergio, first.id)?.sessionId).toBe(winnerId);
    } finally {
      service.close();
    }
  });

  it("sync: the loser fails closed when the winning claimed session is ended", () => {
    const store = openInMemoryStore();
    const service = createCampfireService({ store, idSource: createCounterIdSource(), clock: () => NOW });
    try {
      seedFixture(store, { clock: () => NOW });
      const input = { teamId: TEAM, name: "Claimed", requestId: "req-claim-sync-ended" };
      const first = service.createWorkspace(AGENT, input);
      const winnerId = first.sessionId!;
      store.endAgentSession(winnerId, ENDED_AT);
      expect(store.getAgentSession(winnerId)?.endedAt).toBe(ENDED_AT);

      hidePriorClaimOnce(store);
      let thrown: unknown;
      try {
        service.createWorkspace(AGENT, input);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Conflict);
      expect((thrown as Error).message).toMatch(/already ended/);

      expect(store.getAgentSession(winnerId)?.endedAt).toBe(ENDED_AT);
      expect(store.listAgentSessions(first.id).filter((session) => session.endedAt === undefined)).toHaveLength(0);
      expect(store.getWorkspaceCreateSessionClaim(FIXTURE.agents.codexSergio, first.id)?.sessionId).toBe(winnerId);
    } finally {
      service.close();
    }
  });

  it("sync: the loser fails closed when the winning claimed session is missing", () => {
    const store = openInMemoryStore();
    const service = createCampfireService({ store, idSource: createCounterIdSource(), clock: () => NOW });
    try {
      seedFixture(store, { clock: () => NOW });
      const input = { teamId: TEAM, name: "Claimed", requestId: "req-claim-sync-missing" };
      const first = service.createWorkspace(AGENT, input);
      const winnerId = first.sessionId!;

      const readSession = store.getAgentSession.bind(store);
      let hidden = false;
      store.getAgentSession = ((id: string) => {
        if (!hidden && id === winnerId) {
          hidden = true;
          return undefined;
        }
        return readSession(id);
      }) as typeof store.getAgentSession;
      hidePriorClaimOnce(store);

      expect(() => service.createWorkspace(AGENT, input)).toThrow(SessionNotFound);
      expect(store.getWorkspaceCreateSessionClaim(FIXTURE.agents.codexSergio, first.id)?.sessionId).toBe(winnerId);
    } finally {
      service.close();
    }
  });

  async function setupD1(requestId: string) {
    const adapter = sqliteD1();
    await migrateD1(adapter.binding);
    const store = createD1Store(adapter.binding);
    const service = createAsyncCampfireService({ store, idSource: createCounterIdSource(), clock: () => NOW });
    await store.createOrganization({ id: "org_claim", name: "Org", createdAt: NOW });
    await store.createTeam({ id: "team_claim", organizationId: "org_claim", name: "Eng", createdAt: NOW });
    const { human } = await service.createHuman(undefined, { teamId: "team_claim", displayName: "Ada" });
    const { agent } = await service.createAgent(
      { actor: { actorId: human.id, actorType: "human" } },
      { teamId: "team_claim", humanId: human.id, name: "Codex", harness: "codex" },
    );
    const actor: ActorContext = { actor: { actorId: agent.id, actorType: "agent" } };
    return { adapter, store, service, agent, actor, input: { teamId: "team_claim", name: "Claimed", requestId } };
  }

  it("async: the loser returns the open winner and its rollback leaves that session open", async () => {
    const { adapter, store, service, agent, actor, input } = await setupD1("req-claim-d1-open");
    try {
      const first = await service.createWorkspace(actor, input) as CreatedWorkspace;
      const winnerId = first.sessionId!;
      expect((await store.getAgentSession(winnerId))?.endedAt).toBeUndefined();

      hidePriorClaimOnce(store);
      const loser = await service.createWorkspace(actor, input);

      expect(loser.id).toBe(first.id);
      expect(loser.sessionId).toBe(winnerId);
      expect((await store.getAgentSession(winnerId))?.endedAt).toBeUndefined();
      const open = (await store.listAgentSessions(first.id)).filter(
        (session) => session.agentId === agent.id && session.endedAt === undefined,
      ).map((session) => session.id);
      expect(open).toEqual([winnerId]);
      const claims = adapter.database.prepare(
        "SELECT session_id FROM workspace_create_session_claims WHERE agent_id = ? AND workspace_id = ?",
      ).all(agent.id, first.id) as Array<{ session_id: string }>;
      expect(claims).toEqual([{ session_id: winnerId }]);
    } finally {
      adapter.database.close();
    }
  });

  it("async: the loser fails closed when the winning claimed session is ended", async () => {
    const { adapter, store, service, actor, input } = await setupD1("req-claim-d1-ended");
    try {
      const first = await service.createWorkspace(actor, input) as CreatedWorkspace;
      const winnerId = first.sessionId!;
      await store.endAgentSession(winnerId, ENDED_AT);
      expect((await store.getAgentSession(winnerId))?.endedAt).toBe(ENDED_AT);

      hidePriorClaimOnce(store);
      const thrown = await service.createWorkspace(actor, input).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(thrown).toBeInstanceOf(Conflict);
      expect((thrown as Error).message).toMatch(/already ended/);

      expect((await store.getAgentSession(winnerId))?.endedAt).toBe(ENDED_AT);
      expect((await store.listAgentSessions(first.id)).filter((session) => session.endedAt === undefined)).toHaveLength(0);
      const claims = adapter.database.prepare(
        "SELECT session_id FROM workspace_create_session_claims WHERE agent_id = ? AND workspace_id = ?",
      ).all(actor.actor.actorId, first.id) as Array<{ session_id: string }>;
      expect(claims).toEqual([{ session_id: winnerId }]);
    } finally {
      adapter.database.close();
    }
  });
});

async function applySchemaThrough0013(db: D1Database): Promise<void> {
  const present = await db.prepare(
    "SELECT COUNT(*) AS n FROM pragma_table_info('enrollment_invitations') WHERE name = 'issue_request_id'",
  ).first<{ n: number }>();
  const alter = (present?.n ?? 0) === 0 ? `${ENROLLMENT_ISSUE_REQUEST_COLUMN_SQL};\n` : "";
  await db.exec(`${CAMPFIRE_D1_SCHEMA_SQL}${alter}${V13_SQL};\n`);
}

describe("workspace create request migration 0014", () => {
  it("adds the request table and unique index to a database stopped at 0013", async () => {
    const upgraded = sqliteD1();
    const fresh = sqliteD1();
    try {
      await applySchemaThrough0013(upgraded.binding);
      const absent = upgraded.database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspace_create_requests'",
      ).get();
      expect(absent).toBeUndefined();
      await upgraded.binding.exec(`${V14_SQL};\n`);
      const table = upgraded.database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspace_create_requests'",
      ).get();
      const index = upgraded.database.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_workspace_create_request'",
      ).get() as { sql: string } | undefined;
      expect(table).toBeDefined();
      expect(index?.sql.toLowerCase()).toContain("unique");
      upgraded.database.prepare(
        "INSERT INTO workspace_create_requests (actor_id, actor_type, request_id, body_digest, workspace_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("agt_upgrade", "agent", "req-upgrade", "digest-1", "ws_upgrade_1", NOW);
      expect(() => upgraded.database.prepare(
        "INSERT INTO workspace_create_requests (actor_id, actor_type, request_id, body_digest, workspace_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("agt_upgrade", "agent", "req-upgrade", "digest-1", "ws_other", NOW)).toThrow(/unique/i);
      const replay = upgraded.database.prepare(
        "SELECT workspace_id FROM workspace_create_requests WHERE actor_id = ? AND actor_type = ? AND request_id = ?",
      ).get("agt_upgrade", "agent", "req-upgrade") as { workspace_id: string };
      expect(replay.workspace_id).toBe("ws_upgrade_1");

      await migrateD1(fresh.binding);
      const created = fresh.database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspace_create_requests'",
      ).get();
      expect(created).toBeDefined();
    } finally {
      upgraded.database.close();
      fresh.database.close();
    }
  });
});
