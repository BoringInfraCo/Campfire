/**
 * COR-001 Viewer surface. Read-only: the new correction methods are refused
 * before the call, and orientation text never becomes a write control.
 * This is not a live harness trace.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { isViewerReadMethod, startCampfireViewer, VIEWER_READ_METHODS } from "../../src/viewer/server.js";

const WRITE_METHODS = [
  "correct_finding",
  "withdraw_finding",
  "cite_finding_evidence",
  "remove_finding_evidence",
  "cite_decision_basis",
  "remove_decision_basis",
  "retire_decision",
  "add_decision",
  "accept_decision",
];

const APP_JS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/viewer/static/app.js"), "utf8");

function loadAppSandbox() {
  const sandbox: Record<string, unknown> = {
    document: {
      getElementById: () => null,
      addEventListener: () => {},
    },
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
  vm.runInContext(cut === -1 ? APP_JS : APP_JS.slice(0, cut), sandbox, { filename: "app.js" });
  return sandbox;
}

function evalIn<T>(sandbox: Record<string, unknown>, expression: string): T {
  return vm.runInContext(expression, sandbox) as T;
}

describe("COR-001 viewer stays read-only", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("does not allow the correction methods", () => {
    for (const method of WRITE_METHODS) {
      expect(VIEWER_READ_METHODS).not.toContain(method);
      expect(isViewerReadMethod(method)).toBe(false);
    }
  });

  it("rejects correction calls before the authorized call", async () => {
    const calls: string[] = [];
    const running = await startCampfireViewer({
      port: 0,
      call: (method) => {
        calls.push(method);
        return Promise.resolve({});
      },
    });
    close = () => running.close();
    for (const method of WRITE_METHODS) {
      const response = await fetch(`${running.url}/api/call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method, params: { findingId: "f1", reason: "no" } }),
      });
      const body = (await response.json()) as { ok: boolean; error?: string; message?: string };
      expect(response.status).toBe(403);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("Unauthorized");
      expect(body.message).toBe("Viewer is read-only");
    }
    expect(calls).toEqual([]);
  });
});

describe("COR-001 viewer orientation text", () => {
  it("shows currentness, historical counts, correction reason, and review as compact text", () => {
    const sandbox = loadAppSandbox();
    sandbox.ctx = {
      currentness: "current",
      historicalCounts: { superseded: 2, withdrawn: 1, body: { text: "transcript body" } },
      correctionReason: "the earlier count was wrong",
      needsReview: ["f9"],
    };
    const text = evalIn<string>(sandbox, "recordNotesText(ctx)");
    expect(text).toContain("currentness current");
    expect(text).toContain("historical superseded 2  withdrawn 1");
    expect(text).toContain("correction the earlier count was wrong");
    expect(text).toContain("needs review f9");
    expect(text).not.toContain("transcript");
    expect(text).not.toContain("<");

    sandbox.el = { textContent: "stale", hidden: false };
    evalIn(sandbox, "renderRecordNotes(el, ctx)");
    expect(evalIn<string>(sandbox, "el.textContent")).toBe(text);
    expect(evalIn<boolean>(sandbox, "el.hidden")).toBe(false);
    expect(evalIn<string>(sandbox, "el.innerHTML")).toBeUndefined();
  });

  it("renders nothing when the context has no correction fields", () => {
    const sandbox = loadAppSandbox();
    sandbox.el = { textContent: "stale", hidden: false };
    evalIn(sandbox, "renderRecordNotes(el, { goal: { title: 'Keep going' } })");
    expect(evalIn<string>(sandbox, "el.textContent")).toBe("");
    expect(evalIn<boolean>(sandbox, "el.hidden")).toBe(true);
  });

  it("labels a finding by its currentness and does not add a write control", () => {
    const sandbox = loadAppSandbox();
    sandbox.item = {
      objectType: "finding",
      action: "correct",
      payload: { currentness: "withdrawn", summary: "old count" },
    };
    expect(evalIn<string>(sandbox, "kindLabel(item)")).toBe("finding withdrawn");
    sandbox.item = { objectType: "decision", action: "retire", payload: { status: "superseded" } };
    expect(evalIn<string>(sandbox, "kindLabel(item)")).toBe("superseded");
    sandbox.item = {
      objectType: "finding",
      action: "create",
      payload: {
        summary: "fact",
        detail: "still the fact",
        currentness: "current",
        reason: "first record",
        evidence: [{ artifactId: "a1", note: "full artifact body" }],
      },
    };
    const lines = evalIn<string[]>(sandbox, "extras(item)");
    expect(lines).toContain("current");
    expect(lines).toContain("first record");
    expect(lines).toContain("evidence 1");
    expect(lines.join("\n")).not.toContain("full artifact body");
    expect(lines.join("\n")).not.toContain("<button");

    sandbox.decision = {
      id: "d2",
      summary: "Skip the cache flush",
      status: "accepted",
      needsReview: true,
      needsReviewFindingIds: ["f9"],
    };
    const decisionHtml = evalIn<string>(sandbox, "workDecisionHtml(decision)");
    expect(decisionHtml).toContain("Skip the cache flush");
    expect(decisionHtml).toContain("needs review f9");
    expect(decisionHtml).not.toContain("<button");

    sandbox.item = {
      objectType: "decision",
      action: "retire",
      payload: { supersedeReason: "the flush repeats the old workaround", needsReviewFindingIds: ["f9"] },
    };
    const retired = evalIn<string[]>(sandbox, "extras(item)");
    expect(retired.join("\n")).toContain("the flush repeats the old workaround");
    expect(retired.join("\n")).toContain("needs review f9");
  });
});
