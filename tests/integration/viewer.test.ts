import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
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

const EMPTY_STATE_SENTENCE =
  "No workspace to show yet. After your agent has the Campfire tools loaded, describe the work you want to do; your agent can create the workspace and goal.";

/** Boot the served app.js in a vm sandbox with the boot() tail cut. */
function loadAppSandbox(source: string) {
  const sandbox: Record<string, unknown> = {
    document: { getElementById: () => null, addEventListener: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    fetch: async () => {
      throw new Error("no fetch in sandbox");
    },
    setInterval: () => 0,
    CSS: { escape: (value: string) => value },
    console,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const cut = source.lastIndexOf("async function boot()");
  vm.runInContext(cut === -1 ? source : source.slice(0, cut), sandbox, { filename: "app.js" });
  return sandbox;
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

describe("Campfire Viewer no-workspace empty state (ONB-001)", () => {
  it("serves the truthful next action and no longer the bare waiting text", async () => {
    const appJs = await (await fetch(`${running.url}/app.js`)).text();
    const html = await (await fetch(`${running.url}/`)).text();

    expect(html).toContain('/app.js');
    expect(html).toContain('data-workspace-hint="local"');
    expect(appJs).toContain(EMPTY_STATE_SENTENCE);
    expect(appJs).toContain("This Viewer is for work you joined. It does not create a local workspace.");
    expect(appJs).not.toContain("Waiting for an agent to start work.");
    expect(html).not.toContain("Waiting for an agent to start work.");
    // The workspace <select> placeholder while the actor has no workspace.
    expect(appJs).toContain('<option value="">No workspace yet</option>');
  });

  it("renders the empty div for a workspace-less actor and keeps escaping workspace names", async () => {
    const appJs = await (await fetch(`${running.url}/app.js`)).text();
    const sandbox = loadAppSandbox(appJs);

    const stream = vm.runInContext(
      `els.stream = { innerHTML: "", scrollTop: 0, scrollHeight: 0, clientHeight: 0, querySelector: () => null };
       state.workspaces = [];
       state.activity = null;
       renderStream();
       els.stream.innerHTML`,
      sandbox,
      { filename: "app.js" },
    ) as string;
    expect(stream).toBe(`<div class="empty">${EMPTY_STATE_SENTENCE}</div>`);

    const joined = vm.runInContext(
      `document.documentElement = { getAttribute: (name) => name === "data-workspace-hint" ? "joined" : null };
       state.workspaces = [];
       renderStream();
       els.stream.innerHTML`,
      sandbox,
      { filename: "app.js" },
    ) as string;
    expect(joined).toBe(
      '<div class="empty">No workspace to show yet. This Viewer is for work you joined. It does not create a local workspace.</div>',
    );
    expect(joined).not.toContain("create the workspace");

    // The same render path still escapes listed workspace names: if a listed
    // workspace later empties, the select shows the placeholder, not markup.
    const select = vm.runInContext(
      `els.whoami = { textContent: "" };
       els.error = { hidden: true, textContent: "" };
       els.workspace = { innerHTML: "", value: "" };
       els.generatedViewLink = { hidden: true, href: "" };
       state.whoami = null;
       state.error = null;
       state.workspaces = [{ id: "ws_1", name: "<img src=x onerror=alert(1)>" }];
       renderHeader();
       const withName = els.workspace.innerHTML;
       state.workspaces = [];
       renderHeader();
       JSON.stringify({ withName, empty: els.workspace.innerHTML });`,
      sandbox,
      { filename: "app.js" },
    ) as string;
    const parsed = JSON.parse(select) as { withName: string; empty: string };
    expect(parsed.withName).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(parsed.withName).not.toContain("<img");
    expect(parsed.empty).toBe('<option value="">No workspace yet</option>');
  });
});
