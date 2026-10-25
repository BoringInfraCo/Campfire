import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../helpers/sqlite-d1.js";
import { createD1Store, migrateD1 } from "../../src/worker/d1-store.js";
import { createAsyncCampfireService } from "../../src/worker/async-service.js";
import { createD1WorkerHandler } from "../../src/worker/handler.js";

const NOW = "2026-10-25T12:00:00.000Z";

describe("deployed alpha budget wiring", () => {
  it("preserves reads when paused and shares one strict budget across call and Viewer routes", async () => {
    const d1 = sqliteD1();
    await migrateD1(d1.binding);
    const store = createD1Store(d1.binding);
    const service = createAsyncCampfireService({ store, clock: () => NOW });
    await store.createOrganization({ id: "org_1", name: "Alpha", createdAt: NOW });
    await store.createTeam({ id: "team_1", organizationId: "org_1", name: "Alpha", createdAt: NOW });
    const { human, token } = await service.createHuman(undefined, { teamId: "team_1", displayName: "Owner" });
    const workspace = await service.createWorkspace({ actor: { actorId: human.id, actorType: "human" } }, {
      teamId: "team_1", name: "Published",
    });
    d1.database.prepare(
      `INSERT INTO workspace_publications
       (id, owner_human_id, workspace_id, request_id, request_digest, source_tip,
        counts_json, receipt_json, committed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("pub_1", human.id, workspace.id, "req_1", "digest", 0, "{}", "{}", NOW);

    const request = (method: string, params: Record<string, unknown>) => new Request("https://campfire.test/v1/call", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ method, params }),
    });
    const params = { workspaceId: workspace.id };
    const closed = createD1WorkerHandler({ store, alphaUsage: {
      db: d1.binding, expensiveWritesEnabled: false, now: () => NOW,
      limits: { write: 1, invitation: 1, read: 1 },
    } });
    expect((await closed(request("create_goal", { ...params, title: "Paused" }))).status).toBe(503);
    expect((await closed(request("get_workspace_context", params))).status).toBe(200);

    const open = createD1WorkerHandler({ store, alphaUsage: {
      db: d1.binding, expensiveWritesEnabled: true, now: () => NOW,
      limits: { write: 1, invitation: 1, read: 1 },
    } });
    expect((await open(request("create_goal", { ...params, title: "One" }))).status).toBe(200);
    expect((await open(request("create_goal", { ...params, title: "Two" }))).status).toBe(429);
    expect((await open(new Request(`https://campfire.test/api/get_workspace_context?workspaceId=${workspace.id}`, {
      headers: { authorization: `Bearer ${token}` },
    }))).status).toBe(429);
  });
});
