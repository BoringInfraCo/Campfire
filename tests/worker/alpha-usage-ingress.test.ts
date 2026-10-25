import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../helpers/sqlite-d1.js";
import { createD1Store, migrateD1 } from "../../src/worker/d1-store.js";
import { createAsyncCampfireService } from "../../src/worker/async-service.js";
import { createD1WorkerHandler } from "../../src/worker/handler.js";

const SIGNED = JSON.parse(readFileSync(
  new URL("../../fixtures/act-001/step-0/proposal/signed-payloads.json", import.meta.url), "utf8",
)) as { testOnlySecret: string; cases: Array<{ id: string; body: string; signature: string }> };
const MATCHING = SIGNED.cases.find((item) => item.id === "completed-matching")!;
const NOW = "2026-10-21T12:10:00.000Z";

describe("published alpha GitHub ingress budget", () => {
  it("gates signed writes, does not charge unsigned requests, and leaves legacy teams alone", async () => {
    const d1 = sqliteD1();
    try {
      await migrateD1(d1.binding);
      const store = createD1Store(d1.binding);
      const service = createAsyncCampfireService({ store, clock: () => NOW });
      await store.createOrganization({ id: "org_ingress", name: "Org", createdAt: NOW });
      await store.createTeam({ id: "team_ingress", organizationId: "org_ingress", name: "Team", createdAt: NOW });
      await store.createHuman({ id: "hum_ingress", teamId: "team_ingress", displayName: "Owner", createdAt: NOW });
      await store.createAgent({ id: "agt_ingress", teamId: "team_ingress", humanId: "hum_ingress", name: "GitHub", harness: "campfire-integration", createdAt: NOW });
      const workspace = await service.createWorkspace({ actor: { actorId: "hum_ingress", actorType: "human" } }, {
        teamId: "team_ingress", name: "Published",
      });
      d1.database.prepare(
        `INSERT INTO workspace_publications
         (id, owner_human_id, workspace_id, request_id, request_digest, source_tip,
          counts_json, receipt_json, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("pub_ingress", "hum_ingress", workspace.id, "req_ingress", "digest", 0, "{}", "{}", NOW);
      const sourceEnv = {
        CAMPFIRE_GITHUB_SOURCE_ID: "src_ingress",
        CAMPFIRE_GITHUB_SOURCE_WORKSPACE_ID: workspace.id,
        CAMPFIRE_GITHUB_SOURCE_REPOSITORY_ID: "123456789",
        CAMPFIRE_GITHUB_SOURCE_REPOSITORY_NAME: "example-org/verification-sandbox",
        CAMPFIRE_GITHUB_SOURCE_WORKFLOW_ID: "9876543",
        CAMPFIRE_GITHUB_SOURCE_KIND: "ci.retry_verification",
        CAMPFIRE_GITHUB_SOURCE_SECRET: SIGNED.testOnlySecret,
        CAMPFIRE_GITHUB_SOURCE_AGENT_ID: "agt_ingress",
        CAMPFIRE_GITHUB_SOURCE_SESSION_ID: "ses_ingress",
      };
      const request = (delivery: string, signature = MATCHING.signature) => new Request("https://campfire.test/v1/integrations/github/src_ingress", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "workflow_run",
          "x-github-delivery": delivery,
          "x-hub-signature-256": signature,
        },
        body: MATCHING.body,
      });
      const closed = createD1WorkerHandler({ store, sourceEnv, clock: () => NOW, alphaUsage: {
        db: d1.binding, expensiveWritesEnabled: false, now: () => NOW,
        limits: { write: 1, invitation: 1, read: 1 },
      } });
      expect((await closed(request("forged", "sha256=" + "0".repeat(64)))).status).toBe(401);
      expect((await closed(request("signed-paused"))).status).toBe(503);
      expect(d1.database.prepare("SELECT COUNT(*) AS n FROM alpha_usage_buckets").get()).toEqual({ n: 0 });

      const open = createD1WorkerHandler({ store, sourceEnv, clock: () => NOW, alphaUsage: {
        db: d1.binding, expensiveWritesEnabled: true, now: () => NOW,
        limits: { write: 1, invitation: 1, read: 1 },
      } });
      expect((await open(request("signed-one"))).status).toBe(200);
      expect((await open(request("signed-two"))).status).toBe(429);

      d1.database.prepare("DELETE FROM workspace_publications WHERE id = ?").run("pub_ingress");
      expect((await closed(request("legacy-signed"))).status).toBe(200);
    } finally {
      d1.database.close();
    }
  });
});
