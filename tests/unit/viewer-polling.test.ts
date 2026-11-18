import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const APP_JS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/viewer/static/app.js"), "utf8");

function load(hint: "local" | "joined", visibility: string) {
  const doc = {
    visibilityState: visibility,
    getElementById: () => null,
    addEventListener: () => {},
    documentElement: { getAttribute: (name: string) => (name === "data-workspace-hint" ? hint : null) },
  };
  const sandbox: Record<string, unknown> = {
    document: doc,
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
  const cut = APP_JS.lastIndexOf("async function boot()");
  vm.runInContext(APP_JS.slice(0, cut), sandbox, { filename: "app.js" });
  vm.runInContext("var refreshCalls = 0; refresh = () => { refreshCalls += 1; };", sandbox);
  /** Simulate ticks every 2s for `seconds`, returning refreshes triggered. */
  return (seconds: number) => {
    vm.runInContext(
      `(() => { const real = Date.now; let t = 1_000_000; Date.now = () => t; lastRefreshAt = t;
        for (let i = 0; i < ${seconds / 2}; i += 1) { t += 2000; pollTick(); }
        Date.now = real; })()`,
      sandbox,
    );
    return vm.runInContext("refreshCalls", sandbox) as number;
  };
}

describe("Viewer polling", () => {
  it("local visible Viewer keeps the 2s cadence", () => {
    expect(load("local", "visible")(20)).toBe(10);
  });
  it("joined remote Viewer backs off to 10s", () => {
    expect(load("joined", "visible")(20)).toBe(2);
  });
  it("hidden tabs do not poll, local or remote", () => {
    expect(load("local", "hidden")(20)).toBe(0);
    expect(load("joined", "hidden")(20)).toBe(0);
  });
});
