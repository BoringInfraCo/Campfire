import { describe, expect, it } from "vitest";
import worker from "../../src/worker/index.js";
import type { D1Database } from "../../src/worker/d1-types.js";

describe("worker webhook dispatch", () => {
  it("uses the scheduled trigger to read due deliveries", async () => {
    const seen: string[] = [];
    const db: D1Database = {
      prepare(query: string) {
        const stmt = {
          bind() {
            seen.push(query);
            return stmt;
          },
          async first() {
            return null;
          },
          async all() {
            return { results: [], success: true };
          },
          async run() {
            return { success: true, meta: { changes: 0 } };
          },
        };
        return stmt as unknown as ReturnType<D1Database["prepare"]>;
      },
      async batch() {
        return [];
      },
      async exec() {
        return { success: true };
      },
    };
    const waits: Array<Promise<unknown>> = [];
    await worker.scheduled(
      undefined,
      {
        DB: db,
        ASSETS: { fetch: async () => new Response("unused") },
        CAMPFIRE_WEBHOOK_ID: "bridge_worker",
        CAMPFIRE_WEBHOOK_URL: "http://127.0.0.1:9/hook",
        CAMPFIRE_WEBHOOK_SECRET: "worker-secret",
        CAMPFIRE_WEBHOOK_EVENTS: "finding.recorded",
        CAMPFIRE_WEBHOOK_WORKSPACES: "ws_1",
      },
      { waitUntil(promise) { waits.push(promise); } },
    );
    await Promise.all(waits);
    expect(seen.some((query) => query.includes("webhook_deliveries"))).toBe(true);
    expect(seen.join("\n")).not.toContain("worker-secret");
  });
});
