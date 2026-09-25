import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireService } from "../../src/service/service.js";
import type { CampfireStore } from "../../src/store/store.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { createWorkerHandler } from "../../src/worker/handler.js";

const NOW = "2026-01-01T00:00:00.000Z";

let store: CampfireStore;
let service: CampfireService;
let handle: (request: Request) => Promise<Response>;

async function post(path: string, token: string | undefined, method: string, params: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const response = await handle(
    new Request(`https://campfire.test${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ method, params }),
    }),
  );
  return { status: response.status, body: (await response.json()) as any };
}

async function get(path: string, token: string | undefined) {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const response = await handle(new Request(`https://campfire.test${path}`, { headers }));
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return { status: response.status, body: (await response.json()) as any };
  }
  return { status: response.status, body: await response.text() };
}

beforeEach(() => {
  store = openInMemoryStore();
  seedFixture(store);
  service = createCampfireService({ store, idSource: createCounterIdSource(), clock: () => NOW });
  handle = createWorkerHandler({ service });
});

describe("worker fetch handler (sync service)", () => {
  it("runs before public assets so the local-only journal cannot bypass the handler", () => {
    const config = readFileSync(new URL("../../wrangler.toml", import.meta.url), "utf8");
    expect(config).toMatch(/\[assets\][\s\S]*\brun_worker_first\s*=\s*true\b/);
  });

  it("serves only installer assets, never the browser journal", async () => {
    const fetched: string[] = [];
    handle = createWorkerHandler({
      service,
      assetsFetch: async (request) => {
        fetched.push(new URL(request.url).pathname);
        return new Response("installer", { headers: { "content-type": "text/x-shellscript" } });
      },
    });

    for (const path of ["/", "/index.html", "/app.js", "/app.css", "/campfire-mark.svg"]) {
      const result = await get(path, undefined);
      expect(result.status).toBe(404);
    }
    expect(fetched).toEqual([]);

    for (const path of ["/campfire/install.sh", "/campfire/v1.1.0/install.sh"]) {
      const result = await get(path, undefined);
      expect(result).toEqual({ status: 200, body: "installer" });
    }
    expect(fetched).toEqual(["/campfire/install.sh", "/campfire/v1.1.0/install.sh"]);
  });

  it("returns whoami for a valid token", async () => {
    const result = await post("/v1/call", FIXTURE.tokens.sergio, "whoami");
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.result.actor).toEqual({ actorId: FIXTURE.humans.sergio, actorType: "human" });
  });

  it("rejects missing and bad tokens with 401", async () => {
    const missing = await post("/v1/call", undefined, "whoami");
    expect(missing.status).toBe(401);
    expect(missing.body).toMatchObject({ ok: false, error: "Unauthorized" });

    const bad = await post("/v1/call", "cft_not_a_real_token_0000000000000000", "whoami");
    expect(bad.status).toBe(401);
    expect(bad.body).toMatchObject({ ok: false, error: "Unauthorized" });
  });

  it("denies unauthorized workspace reads (auth before retrieval)", async () => {
    const result = await post("/v1/call", FIXTURE.tokens.opencodeAlice, "get_workspace_context", {
      workspaceId: FIXTURE.workspaces.unrelated,
    });
    expect(result.status).toBe(403);
    expect(result.body.ok).toBe(false);
    expect(["ParticipantRequired", "Unauthorized"]).toContain(result.body.error);
  });

  it("gates viewer APIs to read-only and serves GET /api/*", async () => {
    const write = await post("/api/call", FIXTURE.tokens.sergio, "add_finding", {
      workspaceId: FIXTURE.workspaces.billing,
      summary: "viewer must not write",
    });
    expect(write.status).toBe(403);
    expect(write.body).toMatchObject({ ok: false, error: "Unauthorized" });

    const list = await get("/api/list_workspaces", FIXTURE.tokens.sergio);
    expect(list.status).toBe(200);
    expect(list.body.ok).toBe(true);
    expect(list.body.result.map((w: { id: string }) => w.id)).toContain(FIXTURE.workspaces.billing);

    const noToken = await get("/api/list_workspaces", undefined);
    expect(noToken.status).toBe(401);
  });
});
