import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { dispatchCampfireMethod } from "../../src/http/dispatch.js";
import { createRuntimeFromPath } from "../../src/runtime.js";
import type { CampfireRuntime } from "../../src/runtime.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { startCampfireViewer } from "../../src/viewer/server.js";
import type { RunningViewer } from "../../src/viewer/server.js";

interface CallOutcome {
  status: number;
  body: { ok: true; result: any } | { ok: false; error: string; message: string };
}

async function call(
  baseUrl: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<CallOutcome> {
  const response = await fetch(`${baseUrl}/api/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  return { status: response.status, body: (await response.json()) as CallOutcome["body"] };
}

let dir: string;
let runtime: CampfireRuntime;
let running: RunningViewer;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "campfire-viewer-"));
  runtime = createRuntimeFromPath(join(dir, "campfire.db"));
  seedFixture(runtime.store);
  const ctx: ActorContext = {
    actor: { actorId: FIXTURE.humans.sergio, actorType: "human" },
  };
  running = await startCampfireViewer({
    call: (method, params) =>
      Promise.resolve(dispatchCampfireMethod(runtime.service, ctx, method, params ?? {})),
    port: 0,
  });
});

afterEach(async () => {
  await running.close();
  runtime.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Campfire Viewer", () => {
  it("serves HTML at GET /", async () => {
    const response = await fetch(`${running.url}/`);
    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(contentType).toMatch(/html/);
    expect(body).toContain("Campfire");
    expect(body).toContain("Workstream");
    expect(body).toContain('id="mast"');
    expect(body).not.toContain('id="context"');
  });

  it("lists the billing workspace through POST /api/call", async () => {
    const result = await call(running.url, "list_workspaces");
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    if (!result.body.ok) return;
    expect(result.body.result.map((workspace: { id: string }) => workspace.id)).toContain(
      FIXTURE.workspaces.billing,
    );
  });

  it("rejects add_finding as read-only", async () => {
    const result = await call(running.url, "add_finding", {
      workspaceId: FIXTURE.workspaces.billing,
      summary: "viewer must not write",
    });
    expect(result.status).toBe(403);
    expect(result.body.ok).toBe(false);
    if (result.body.ok) return;
    expect(result.body.error).toBe("Unauthorized");
    expect(result.body.message).toBe("Viewer is read-only");
  });

  it("returns workspace context with a goal", async () => {
    const result = await call(running.url, "get_workspace_context", {
      workspaceId: FIXTURE.workspaces.billing,
    });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    if (!result.body.ok) return;
    expect(result.body.result.goal).toBeDefined();
  });

  it("defaults to the Campfire theme with an fx fallback", async () => {
    const html = await (await fetch(`${running.url}/`)).text();
    expect(html).toContain('data-theme="campfire"');
    const css = await (await fetch(`${running.url}/app.css`)).text();
    expect(css).toContain("--accent: #fc6142");
    expect(css).toContain('[data-theme="fx"]');
  });

  it("serves the Campfire logomark and uses the brand accent colors", async () => {
    const html = await (await fetch(`${running.url}/`)).text();
    expect(html).toContain('src="/campfire-mark.svg"');
    expect(html).not.toContain('<span class="brand">Campfire</span>');

    const mark = await fetch(`${running.url}/campfire-mark.svg`);
    expect(mark.status).toBe(200);
    expect(mark.headers.get("content-type") ?? "").toMatch(/svg/);
    expect(await mark.text()).toContain("#FC6142");

    const css = await (await fetch(`${running.url}/app.css`)).text();
    expect(css).toContain("--human: #f9b2d7");
    expect(css).toContain("--agent: #ffd166");
  });

  it("shows a finding written through the service, not through the Viewer", async () => {
    const ctx: ActorContext = {
      actor: { actorId: FIXTURE.humans.sergio, actorType: "human" },
    };
    const finding = runtime.service.addFinding(ctx, {
      workspaceId: FIXTURE.workspaces.billing,
      summary: "Viewer should project this finding",
    });
    const result = await call(running.url, "get_activity", {
      workspaceId: FIXTURE.workspaces.billing,
      limit: 50,
    });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    if (!result.body.ok) return;
    const ids = result.body.result.items.map((item: { objectId: string }) => item.objectId);
    expect(ids).toContain(finding.id);
  });

  it("honors the fx theme option for the legacy palette", async () => {
    const ctx: ActorContext = {
      actor: { actorId: FIXTURE.humans.sergio, actorType: "human" },
    };
    const legacy = await startCampfireViewer({
      call: (method, params) =>
        Promise.resolve(dispatchCampfireMethod(runtime.service, ctx, method, params ?? {})),
      port: 0,
      theme: "fx",
    });
    try {
      const html = await (await fetch(`${legacy.url}/`)).text();
      expect(html).toContain('data-theme="fx"');
    } finally {
      await legacy.close();
    }
  });
});
