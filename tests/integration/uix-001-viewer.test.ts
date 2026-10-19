/**
 * UIX-001 Viewer slice. Deterministic checks of the local shell: recorded
 * participant counts and the density preference. Not a human observation
 * and not a release verdict.
 *
 * Renderers run from the real app.js text with the boot() tail cut, the same
 * vm sandbox the other Viewer suites use.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { VIEWER_READ_METHODS } from "../../src/viewer/server.js";

const APP_JS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/viewer/static/app.js"), "utf8");

function loadAppSandbox() {
  let fetchCalls = 0;
  const store = new Map<string, string>();
  const sandbox: Record<string, unknown> = {
    document: {
      documentElement: { dataset: {} as Record<string, string> },
      getElementById: () => null,
      addEventListener: () => {},
    },
    localStorage: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("no fetch in sandbox");
    },
    setInterval: () => 0,
    CSS: { escape: (value: string) => value },
    console,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const cut = APP_JS.lastIndexOf("async function boot()");
  vm.runInContext(cut === -1 ? APP_JS : APP_JS.slice(0, cut), sandbox, { filename: "app.js" });
  return { sandbox, store, fetchCalls: () => fetchCalls };
}

describe("UIX-001 viewer shell", () => {
  it("counts recorded participants and keeps the goal id escaped", () => {
    const { sandbox, fetchCalls } = loadAppSandbox();
    const context = {
      participants: [
        { name: "Ana", actor: { actorId: "hum_ana", actorType: "human" } },
        { name: "Ben", actor: { actorId: "hum_ben", actorType: "human" } },
        { name: "Cara", actor: { actorId: "hum_cara", actorType: "human" } },
        { name: "Rex", actor: { actorId: "agt_rex", actorType: "agent" } },
        { name: "Nova", actor: { actorId: "agt_nova", actorType: "agent" } },
      ],
      goal: { id: "goal_<att001>", title: "Make team attention cues trustworthy" },
    };
    const counts = { textContent: "" };
    const people = { innerHTML: "" };
    const goal = { innerHTML: "" };
    sandbox.counts = counts;
    sandbox.people = people;
    sandbox.goal = goal;
    vm.runInContext(
      `state.workspaces = ${JSON.stringify([{ id: "ws_att001_lab", name: "Lab" }])};
       state.context = ${JSON.stringify(context)};
       state.view = null;
       els.recordedCounts = counts; els.people = people; els.goal = goal; renderMast();`,
      sandbox,
    );
    expect(counts.textContent).toBe("3 people · 2 registered agents");
    expect(counts.textContent).toContain("registered");
    expect(counts.textContent).not.toContain("online");
    expect(counts.textContent).not.toMatch(/working|idle|live agents/);
    expect(people.innerHTML).toContain("Ana");
    expect(goal.innerHTML).toContain("GOAL");
    expect(goal.innerHTML).toContain("Make team attention cues trustworthy");
    expect(goal.innerHTML).toContain("goal_&lt;att001&gt;");
    expect(goal.innerHTML).not.toContain("<att001>");
    expect(fetchCalls()).toBe(0);
  });

  it("toggles density in localStorage and dataset.density without calling fetch", () => {
    const { sandbox, store, fetchCalls } = loadAppSandbox();
    const document = sandbox.document as { documentElement: { dataset: Record<string, string> } };
    expect(document.documentElement.dataset.density).toBe("comfortable");
    const density = {
      attrs: {} as Record<string, string>,
      setAttribute(name: string, value: string) {
        this.attrs[name] = value;
      },
    };
    sandbox.density = density;
    vm.runInContext("els.density = density; toggleDensity();", sandbox);
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(store.get("campfire-viewer-density")).toBe("compact");
    expect(density.attrs["aria-pressed"]).toBe("true");
    vm.runInContext("toggleDensity();", sandbox);
    expect(document.documentElement.dataset.density).toBe("comfortable");
    expect(store.get("campfire-viewer-density")).toBe("comfortable");
    expect(density.attrs["aria-pressed"]).toBe("false");
    expect(fetchCalls()).toBe(0);
  });

  it("keeps the Viewer read allowlist at the twelve NAV-003 methods", () => {
    expect(VIEWER_READ_METHODS).toHaveLength(12);
    expect([...VIEWER_READ_METHODS]).toEqual([
      "whoami",
      "list_workspaces",
      "get_workspace",
      "get_workspace_context",
      "get_activity",
      "list_tasks",
      "list_workspace_participants",
      "get_task",
      "get_decision",
      "get_finding",
      "get_artifact",
      "get_record_history",
    ]);
  });
});
