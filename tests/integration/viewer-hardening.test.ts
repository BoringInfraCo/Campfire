import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { campfireHttpCall } from "../../src/http/client.js";
import { startCampfireHttpServer } from "../../src/http/server.js";
import type { RunningHttpServer } from "../../src/http/server.js";
import { createRuntimeFromPath } from "../../src/runtime.js";
import type { CampfireRuntime } from "../../src/runtime.js";
import {
  assertViewerHost,
  isLoopbackHost,
  startCampfireViewer,
} from "../../src/viewer/server.js";
import type { RunningViewer } from "../../src/viewer/server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_JS = readFileSync(join(HERE, "../../src/viewer/static/app.js"), "utf8");

/** Evaluate the real app.js pure helpers with a stubbed DOM. */
function loadAppSandbox() {
  const store: Record<string, unknown> = {};
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const stubEl = () => ({
    addEventListener: (name: string, fn: (...args: unknown[]) => void) => {
      (listeners[name] ??= []).push(fn);
    },
    contains: () => false,
    closest: () => null,
    querySelector: () => null,
  });
  const sandbox: Record<string, unknown> = {
    document: {
      getElementById: () => null,
      addEventListener: (name: string, fn: (...args: unknown[]) => void) => {
        (listeners[name] ??= []).push(fn);
      },
    },
    sessionStorage: {
      getItem: (k: string) => (typeof store[k] === "string" ? (store[k] as string) : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    },
    fetch: async () => {
      throw new Error("no fetch in sandbox");
    },
    setInterval: () => 0,
    CSS: { escape: (s: string) => s.replace(/"/g, '\\"') },
    console,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // Cut the boot() tail (network) — keep every function declaration.
  const cut = APP_JS.lastIndexOf("async function boot()");
  vm.runInContext(cut === -1 ? APP_JS : APP_JS.slice(0, cut), sandbox, {
    filename: "app.js",
  });
  return { sandbox, listeners };
}

describe("viewer loopback guard", () => {
  it("treats only 127.0.0.1, ::1, and localhost as loopback", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.10")).toBe(false);
    expect(isLoopbackHost("example.com")).toBe(false);
  });

  it("rejects non-loopback hosts without --allow-remote", () => {
    expect(() => assertViewerHost("0.0.0.0")).toThrow(/--allow-remote/);
    expect(() => assertViewerHost("0.0.0.0", false)).toThrow(/--allow-remote/);
    expect(() => assertViewerHost("0.0.0.0", true)).not.toThrow();
    expect(() => assertViewerHost("127.0.0.1")).not.toThrow();
  });

  it("refuses to start on a non-loopback host without allowRemote", async () => {
    await expect(
      startCampfireViewer({ call: async () => ({}), host: "0.0.0.0", port: 0 }),
    ).rejects.toThrow(/--allow-remote/);
  });
});

describe("viewer app.js structure (real file)", () => {
  it("puts .selected on the outer .item to match app.css `.item.selected .who`", () => {
    // Outer item carries the highlight; inner .who row must not.
    expect(APP_JS).toMatch(/<div class="item\$\{mutedClass\}\$\{selected\}"/);
    expect(APP_JS).not.toMatch(/<div class="who row\$\{selected\}"/);
  });

  it("gives data-id only to the outer .item so selectorFor is unambiguous", () => {
    expect(APP_JS).toMatch(/return `\.item\[data-id="/);
    const whoWithDataId = (APP_JS.match(/<div class="who row" data-id/g) ?? []).length;
    expect(whoWithDataId).toBe(0);
  });

  it("allows digits 1-9 for the first nine workspaces regardless of list size", () => {
    expect(APP_JS).not.toMatch(/state\.workspaces\.length <= 9/);
    expect(APP_JS).toMatch(/event\.key >= "1" && event\.key <= "9"/);
  });

  it("labels truncation and offers older activity via before/nextBefore", () => {
    expect(APP_JS).toMatch(/showing latest/);
    expect(APP_JS).toMatch(/older activity/);
    expect(APP_JS).toMatch(/before/);
    expect(APP_JS).toMatch(/nextBefore/);
  });

  it("prefers title/summary over raw object ids, keeping ids as fallback only", () => {
    expect(APP_JS).toMatch(/item\.objectId \|\| item\.id \|\| ""/);
    expect(APP_JS).toMatch(/payload\.summary, payload\.title, payload\.name/);
  });
});

describe("viewer pure logic (real app.js functions)", () => {
  it("escapes HTML-significant characters", () => {
    const { sandbox } = loadAppSandbox();
    const esc = vm.runInContext("esc", sandbox) as (v: unknown) => string;
    expect(esc('<b>"a"&</b>')).toBe("&lt;b&gt;&quot;a&quot;&amp;&lt;/b&gt;");
    expect(esc(null)).toBe("");
  });

  it("folds consecutive plumbing and keeps work rows visible", () => {
    const { sandbox } = loadAppSandbox();
    vm.runInContext(
      `state.activity = { items: [
        { id: "c1", action: "join", objectType: "participant" },
        { id: "c2", action: "join", objectType: "participant" },
        { id: "c3", action: "create", objectType: "finding", objectId: "f1",
          payload: { summary: "lock found" }, actor: { actorId: "a1" } },
      ]};`,
      sandbox,
    );
    const rows = vm.runInContext("visibleRows()", sandbox) as Array<{
      type: string;
      count?: number;
    }>;
    expect(rows.map((r) => r.type)).toEqual(["fold", "item"]);
    expect(rows[0]?.count).toBe(2);
  });

  it("moves j/k selection across visible rows including folds", () => {
    const { sandbox } = loadAppSandbox();
    vm.runInContext(
      `state.activity = { items: [
        { id: "c1", action: "create", objectType: "finding", objectId: "f1",
          payload: { summary: "one" }, actor: { actorId: "a1" } },
        { id: "c2", action: "create", objectType: "finding", objectId: "f2",
          payload: { summary: "two" }, actor: { actorId: "a1" } },
      ]};
       state.selectedId = null;`,
      sandbox,
    );
    vm.runInContext("moveSelection(1)", sandbox);
    expect(vm.runInContext("state.selectedId", sandbox)).toBe("c1");
    vm.runInContext("moveSelection(1)", sandbox);
    expect(vm.runInContext("state.selectedId", sandbox)).toBe("c2");
    vm.runInContext("moveSelection(-1)", sandbox);
    expect(vm.runInContext("state.selectedId", sandbox)).toBe("c1");
  });

  it("selectorFor targets the outer .item for j/k scrollIntoView", () => {
    const { sandbox } = loadAppSandbox();
    const sel = vm.runInContext('selectorFor("c9")', sandbox) as string;
    expect(sel).toContain(".item[data-id=");
    const fold = vm.runInContext('selectorFor("fold:3")', sandbox) as string;
    expect(fold).toContain("[data-fold=");
  });
});

describe("remote MCP token-only path (CAMPFIRE_URL + CAMPFIRE_TOKEN -> whoami)", () => {
  let dir: string;
  let runtime: CampfireRuntime;
  let http: RunningHttpServer;
  let viewer: RunningViewer | undefined;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "campfire-viewer-remote-"));
    runtime = createRuntimeFromPath(join(dir, "campfire.db"));
    seedFixture(runtime.store);
    vi.spyOn(console, "error").mockImplementation(() => {});
    http = await startCampfireHttpServer({ runtime, host: "127.0.0.1", port: 0 });
  });

  afterEach(async () => {
    await viewer?.close();
    viewer = undefined;
    await http.close();
    runtime.close();
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves identity from the bearer token alone, ignoring spoofed actor ids", async () => {
    // This is the exact call src/mcp/stdio.ts resolveRemoteIdentity makes
    // when CAMPFIRE_URL is set: POST /v1/call whoami with CAMPFIRE_TOKEN.
    const url = http.url;
    const token = FIXTURE.tokens.sergio;
    const who = (await campfireHttpCall({
      baseUrl: url,
      token,
      method: "whoami",
      params: {
        actorId: FIXTURE.humans.alice,
        actorType: "human",
      },
    })) as { actor: { actorId: string; actorType: string } };
    expect(who.actor).toEqual({ actorId: FIXTURE.humans.sergio, actorType: "human" });

    // A Viewer bound to that remote identity serves reads over the same path.
    const { dispatchCampfireMethod } = await import("../../src/http/dispatch.js");
    void dispatchCampfireMethod;
    viewer = await startCampfireViewer({
      call: (method, params) =>
        campfireHttpCall({ baseUrl: url, token, method, params: params ?? {} }),
      port: 0,
    });
    const res = await fetch(`${viewer.url}/api/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "list_workspaces", params: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result: Array<{ id: string }> };
    expect(body.ok).toBe(true);
    expect(body.result.map((w) => w.id)).toContain(FIXTURE.workspaces.billing);
  });

  it("rejects the remote path without a token", async () => {
    await expect(
      campfireHttpCall({ baseUrl: http.url, token: "", method: "whoami", params: {} }),
    ).rejects.toThrow();
  });
});
