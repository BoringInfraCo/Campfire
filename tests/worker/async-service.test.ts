import { describe, expect, it } from "vitest";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { createAsyncCampfireService } from "../../src/worker/async-service.js";
import type { AsyncCampfireStore } from "../../src/worker/d1-store.js";
import { dispatchCampfireMethodAsync } from "../../src/worker/async-dispatch.js";
import { createD1WorkerHandler } from "../../src/worker/handler.js";
import { ParticipantRequired } from "../../src/domain/errors.js";

const NOW = "2026-01-01T00:00:00.000Z";

/**
 * Adapt the sync SQLite store to the async boundary. Each call is deferred
 * through Promise.resolve so the async service/authorizer/dispatch port is
 * exercised end to end without emulating D1 SQL.
 */
function wrapSync(store: CampfireStore): AsyncCampfireStore {
  return new Proxy(store, {
    get(target, prop, receiver) {
      // Mirror D1 semantics: no interactive transactions, run sequentially.
      // better-sqlite3 rejects async transaction functions outright.
      if (prop === "transaction") {
        return (fn: () => Promise<unknown>) => fn();
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) =>
        Promise.resolve((value as (...a: unknown[]) => unknown).apply(target, args));
    },
  }) as unknown as AsyncCampfireStore;
}

async function setup() {
  const sync = openInMemoryStore();
  const store = wrapSync(sync);
  const service = createAsyncCampfireService({
    store,
    idSource: createCounterIdSource(),
    clock: () => NOW,
  });
  await store.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: NOW });
  await store.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: NOW });
  const { human, token } = await service.createHuman(undefined, {
    teamId: "team_1",
    displayName: "Ada",
  });
  return { sync, store, service, human, token };
}

describe("async service port (Workers/D1 logic)", () => {
  it("resolves a freshly minted token to its actor", async () => {
    const { service, human, token } = await setup();
    await expect(service.resolveToken(token)).resolves.toEqual({
      actorId: human.id,
      actorType: "human",
    });
  });

  it("creates a workspace, goal, finding, and projects context", async () => {
    const { service, human } = await setup();
    const ctx = { actor: { actorId: human.id, actorType: "human" as const } };

    const workspace = await service.createWorkspace(ctx, { teamId: "team_1", name: "A" });
    expect(workspace.status).toBe("active");

    await service.createGoal(ctx, { workspaceId: workspace.id, title: "Continuity" });
    const finding = await service.addFinding(ctx, {
      workspaceId: workspace.id,
      summary: "Async port works",
    });
    expect(finding.createdBy).toEqual(ctx.actor);

    const context = await service.getWorkspaceContext(ctx, workspace.id);
    expect(context.goal?.title).toBe("Continuity");
    expect(context.findings.map((f) => f.id)).toContain(finding.id);

    const resolved = await dispatchCampfireMethodAsync(service, ctx, "list_workspaces", {});
    expect(resolved as unknown[]).toHaveLength(1);
  });

  it("rejects reads by non-participants before retrieval", async () => {
    const { service, human } = await setup();
    const ctx = { actor: { actorId: human.id, actorType: "human" as const } };
    const workspace = await service.createWorkspace(ctx, { teamId: "team_1", name: "A" });

    const other = await service.createHuman(ctx, { teamId: "team_1", displayName: "Grace" });
    const otherCtx = { actor: { actorId: other.human.id, actorType: "human" as const } };
    await expect(service.getWorkspace(otherCtx, workspace.id)).rejects.toThrow(ParticipantRequired);
  });
});

describe("D1 worker handler (async production path)", () => {
  it("accepts a valid token, rejects missing/bad tokens, denies unauthorized reads", async () => {
    const { store, service, token, human } = await setup();
    const handle = createD1WorkerHandler({ store });

    async function call(auth: string | undefined, method: string, params: Record<string, unknown> = {}) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (auth !== undefined) headers.authorization = `Bearer ${auth}`;
      const res = await handle(
        new Request("https://campfire.test/v1/call", {
          method: "POST",
          headers,
          body: JSON.stringify({ method, params }),
        }),
      );
      return { status: res.status, body: (await res.json()) as any };
    }

    const whoami = await call(token, "whoami");
    expect(whoami.status).toBe(200);
    expect(whoami.body.result.actor).toEqual({ actorId: human.id, actorType: "human" });

    const missing = await call(undefined, "whoami");
    expect(missing.status).toBe(401);

    const bad = await call("cft_not_a_real_token_0000000000000000", "whoami");
    expect(bad.status).toBe(401);

    // Private workspace: the second human is not a participant.
    const ctx = { actor: { actorId: human.id, actorType: "human" as const } };
    const workspace = await service.createWorkspace(ctx, { teamId: "team_1", name: "Private" });
    const other = await service.createHuman(ctx, { teamId: "team_1", displayName: "Grace" });
    const denied = await call(other.token, "get_workspace_context", { workspaceId: workspace.id });
    expect(denied.status).toBe(403);
    expect(["ParticipantRequired", "Unauthorized"]).toContain(denied.body.error);

    service.close();
  });
});
