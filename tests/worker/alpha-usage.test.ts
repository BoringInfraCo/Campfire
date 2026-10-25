import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../helpers/sqlite-d1.js";
import { V12_SQL } from "../../src/store/alpha-usage-schema.js";
import { alphaUsageCategory, checkAlphaUsage, type AlphaUsageOptions } from "../../src/worker/alpha-usage.js";
import type { AsyncCampfireStore } from "../../src/worker/d1-store.js";

const ACTOR = { actorId: "hum_alpha", actorType: "human" as const };
const NOW = "2026-10-25T12:00:00.000Z";

function setup(published = true): AlphaUsageOptions {
  const d1 = sqliteD1();
  d1.database.exec(`
    CREATE TABLE teams (id TEXT PRIMARY KEY);
    CREATE TABLE workspaces (id TEXT PRIMARY KEY, team_id TEXT NOT NULL);
    CREATE TABLE workspace_publications (workspace_id TEXT PRIMARY KEY);
    INSERT INTO teams (id) VALUES ('team_alpha');
    INSERT INTO workspaces (id, team_id) VALUES ('ws_alpha', 'team_alpha');
    ${published ? "INSERT INTO workspace_publications (workspace_id) VALUES ('ws_alpha');" : ""}
    ${V12_SQL}
  `);
  const store = {
    getHuman: async () => ({ teamId: "team_alpha" }),
    getAgent: async () => undefined,
  } as unknown as AsyncCampfireStore;
  return { db: d1.binding, store, expensiveWritesEnabled: true, now: () => NOW };
}

describe("published alpha usage limits", () => {
  it("classifies every new method as a write and exempts safety operations", () => {
    expect(alphaUsageCategory("get_workspace_context")).toBe("read");
    expect(alphaUsageCategory("get_activity")).toBe("read");
    expect(alphaUsageCategory("issue_enrollment_invitation")).toBe("invitation");
    expect(alphaUsageCategory("invite_workspace")).toBe("invitation");
    expect(alphaUsageCategory("create_task")).toBe("write");
    expect(alphaUsageCategory("new_future_method")).toBe("write");
    expect(alphaUsageCategory("revoke_enrollment_invitation")).toBeUndefined();
    expect(alphaUsageCategory("revoke_token")).toBeUndefined();
    expect(alphaUsageCategory("whoami")).toBeUndefined();
  });

  it("atomically admits only the configured daily number across simultaneous calls", async () => {
    const options = { ...setup(), limits: { write: 3, invitation: 2, read: 4 } };
    const results = await Promise.all(Array.from({ length: 12 }, () => checkAlphaUsage(options, ACTOR, "create_task")));
    expect(results.filter((value) => value === "allowed")).toHaveLength(3);
    expect(results.filter((value) => value === "limited")).toHaveLength(9);
    expect(await checkAlphaUsage(options, ACTOR, "issue_enrollment_invitation")).toBe("allowed");
    expect(await checkAlphaUsage(options, ACTOR, "get_workspace_context")).toBe("allowed");
  });

  it("keeps existing nonpublication teams untouched and preserves reads and revocation when writes stop", async () => {
    const legacy = { ...setup(false), expensiveWritesEnabled: false, limits: { write: 1, invitation: 1, read: 1 } };
    expect(await checkAlphaUsage(legacy, ACTOR, "create_task")).toBe("allowed");
    const alpha = { ...setup(), expensiveWritesEnabled: false, limits: { write: 1, invitation: 1, read: 1 } };
    expect(await checkAlphaUsage(alpha, ACTOR, "create_task")).toBe("stopped");
    expect(await checkAlphaUsage(alpha, ACTOR, "issue_enrollment_invitation")).toBe("stopped");
    expect(await checkAlphaUsage(alpha, ACTOR, "get_workspace_context")).toBe("allowed");
    expect(await checkAlphaUsage(alpha, ACTOR, "get_workspace_context")).toBe("limited");
    expect(await checkAlphaUsage(alpha, ACTOR, "revoke_enrollment_invitation")).toBe("allowed");
    expect(await checkAlphaUsage(alpha, ACTOR, "revoke_token")).toBe("allowed");
  });

  it("fails closed if the counter migration or D1 is unavailable", async () => {
    const options = setup();
    await options.db.exec("DROP TABLE alpha_usage_buckets");
    expect(await checkAlphaUsage(options, ACTOR, "create_task")).toBe("unavailable");
    expect(await checkAlphaUsage(options, ACTOR, "revoke_token")).toBe("allowed");
  });

  it("uses a new UTC-day bucket without resetting previous evidence", async () => {
    const options = { ...setup(), limits: { write: 1, invitation: 1, read: 1 } };
    expect(await checkAlphaUsage(options, ACTOR, "create_task")).toBe("allowed");
    expect(await checkAlphaUsage(options, ACTOR, "create_task")).toBe("limited");
    options.now = () => "2026-10-26T00:00:00.000Z";
    expect(await checkAlphaUsage(options, ACTOR, "create_task")).toBe("allowed");
  });
});
