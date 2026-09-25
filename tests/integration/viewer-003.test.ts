import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  VIEWER_READ_METHODS,
  isViewerReadMethod,
  startCampfireViewer,
} from "../../src/viewer/server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_JS = readFileSync(join(HERE, "../../src/viewer/static/app.js"), "utf8");

/**
 * Evaluate the real app.js pure helpers with a stubbed DOM, mirroring
 * tests/integration/viewer-hardening.test.ts. The boot() tail (network) is cut;
 * every function declaration stays available to call by name.
 */
function loadAppSandbox() {
  const store: Record<string, unknown> = {};
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
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
  const cut = APP_JS.lastIndexOf("async function boot()");
  vm.runInContext(cut === -1 ? APP_JS : APP_JS.slice(0, cut), sandbox, {
    filename: "app.js",
  });
  return { sandbox, listeners };
}

type Sandbox = ReturnType<typeof loadAppSandbox>["sandbox"];

function evalIn<T>(sandbox: Sandbox, expression: string): T {
  return vm.runInContext(expression, sandbox) as T;
}

/** A synthetic WorkspaceContext covering every Sprint 008 section. */
const CONTEXT = {
  needsYou: [
    {
      kind: "decision",
      id: "d-you",
      summary: "Accept pricing model",
      status: "proposed",
      reason: "you may accept this decision",
      assignee: { actorId: "actor-sergio", actorType: "human" },
    },
    {
      kind: "task",
      id: "t-you",
      summary: "Fix billing retry",
      status: "blocked",
      reason: "assigned to you and blocked",
      assignee: { actorId: "actor-sergio", actorType: "human" },
    },
  ],
  needsAttention: [
    {
      kind: "decision",
      id: "d-attn",
      summary: "Adopt vendor X",
      status: "proposed",
      reason: "you are not authorized to accept",
    },
    {
      kind: "task",
      id: "t-attn",
      summary: "Rotate credentials",
      status: "blocked",
      reason: "unassigned blocked task",
    },
  ],
  currentWork: {
    inProgressTasks: [
      { id: "t-wip", title: "Wire webhook", status: "in_progress" },
    ],
    blockedTasks: [{ id: "t-blk", title: "Fix billing retry", status: "blocked" }],
    acceptedDecisions: [
      { id: "d-acc", summary: "Use SQLite", status: "accepted" },
    ],
  },
  suggestedNextAction: {
    kind: "decision",
    id: "d-you",
    summary: "Accept pricing model",
    reason: "actionable proposed decision you may accept",
    orientationHint: true,
  },
  provenanceSummary: ["Sergio created task t-wip", "Ana accepted decision d-acc"],
  since: {
    cursor: "c3",
    truncated: false,
    items: [
      { id: "c2", objectType: "finding", action: "create", payload: { summary: "found lock" } },
      { id: "c3", objectType: "task", action: "update", payload: { summary: "task fixed", status: "completed" } },
    ],
  },
};

describe("viewer 003 derivation (real app.js functions)", () => {
  it("derives Needs You only from the service-provided needsYou list", () => {
    const { sandbox } = loadAppSandbox();
    sandbox.ctx = CONTEXT;
    const you = evalIn<Array<Record<string, unknown>>>(sandbox, "deriveNeedsYou(ctx)");
    expect(you.map((item) => item.id)).toEqual(["d-you", "t-you"]);
    expect(you[0]).toMatchObject({
      kind: "decision",
      status: "proposed",
      summary: "Accept pricing model",
      reason: "you may accept this decision",
    });
    // Needs Attention must not leak into Needs You; the Viewer never recomputes auth.
    expect(you.map((item) => item.id)).not.toContain("d-attn");
    expect(you.map((item) => item.id)).not.toContain("t-attn");
  });

  it("derives Needs Attention from the service-provided needsAttention list", () => {
    const { sandbox } = loadAppSandbox();
    sandbox.ctx = CONTEXT;
    const attn = evalIn<Array<Record<string, unknown>>>(sandbox, "deriveNeedsAttention(ctx)");
    expect(attn.map((item) => item.id)).toEqual(["d-attn", "t-attn"]);
    expect(attn.map((item) => item.id)).not.toContain("d-you");
  });

  it("returns empty attention lists for an older context without those sections", () => {
    const { sandbox } = loadAppSandbox();
    expect(evalIn<unknown[]>(sandbox, "deriveNeedsYou({})")).toEqual([]);
    expect(evalIn<unknown[]>(sandbox, "deriveNeedsAttention({})")).toEqual([]);
    expect(evalIn<unknown[]>(sandbox, "deriveNeedsYou(null)")).toEqual([]);
  });

  it("derives Current Work from in-progress, blocked, and accepted decisions", () => {
    const { sandbox } = loadAppSandbox();
    sandbox.ctx = CONTEXT;
    const work = evalIn<{
      inProgressTasks: Array<{ id: string }>;
      blockedTasks: Array<{ id: string }>;
      acceptedDecisions: Array<{ id: string }>;
    }>(sandbox, "deriveCurrentWork(ctx)");
    expect(work.inProgressTasks.map((t) => t.id)).toEqual(["t-wip"]);
    expect(work.blockedTasks.map((t) => t.id)).toEqual(["t-blk"]);
    expect(work.acceptedDecisions.map((d) => d.id)).toEqual(["d-acc"]);
  });

  it("returns empty Current Work when the section is absent", () => {
    const { sandbox } = loadAppSandbox();
    const work = evalIn<Record<string, unknown[]>>(sandbox, "deriveCurrentWork({})");
    expect(work.inProgressTasks).toEqual([]);
    expect(work.blockedTasks).toEqual([]);
    expect(work.acceptedDecisions).toEqual([]);
  });

  it("shows the first-visit empty state when there is no stored cursor", () => {
    const { sandbox } = loadAppSandbox();
    const view = evalIn<{ state: string; items: unknown[] }>(
      sandbox,
      "deriveSinceView({}, false)",
    );
    expect(view.state).toBe("first-visit");
    expect(view.items).toEqual([]);
  });

  it("derives the since-cursor diff from the service-provided since items", () => {
    const { sandbox } = loadAppSandbox();
    sandbox.ctx = CONTEXT;
    const view = evalIn<{ state: string; items: Array<{ id: string }>; truncated: boolean }>(
      sandbox,
      "deriveSinceView(ctx, true)",
    );
    expect(view.state).toBe("items");
    expect(view.items.map((item) => item.id)).toEqual(["c2", "c3"]);
    expect(view.truncated).toBe(false);
    expect(evalIn<string>(sandbox, "newestContributionId(ctx)")).toBe("c3");
  });

  it("flags a truncated since diff and treats an empty diff as no new activity", () => {
    const { sandbox } = loadAppSandbox();
    sandbox.ctx = { since: { cursor: "c9", items: [], truncated: true } };
    const empty = evalIn<{ state: string }>(sandbox, "deriveSinceView(ctx, true)");
    // No items means the empty state; truncation alone is not new activity.
    expect(empty.state).toBe("empty");

    sandbox.ctx = { since: { cursor: "c9", items: [{ id: "c8" }], truncated: true } };
    const truncated = evalIn<{ state: string; truncated: boolean }>(
      sandbox,
      "deriveSinceView(ctx, true)",
    );
    expect(truncated.state).toBe("items");
    expect(truncated.truncated).toBe(true);
  });

  it("falls back to the newest provenance id when no since cursor is present", () => {
    const { sandbox } = loadAppSandbox();
    sandbox.ctx = { provenance: [{ id: "p1" }, { id: "p2" }] };
    expect(evalIn<string>(sandbox, "newestContributionId(ctx)")).toBe("p2");
  });

  it("exposes the suggested next action as an orientation hint only", () => {
    const { sandbox } = loadAppSandbox();
    sandbox.ctx = CONTEXT;
    const action = evalIn<Record<string, unknown>>(sandbox, "deriveSuggestedNextAction(ctx)");
    expect(action).toMatchObject({
      kind: "decision",
      id: "d-you",
      summary: "Accept pricing model",
    });
    expect(evalIn<unknown>(sandbox, 'deriveSuggestedNextAction({ suggestedNextAction: { kind: "none" } })')).toBeNull();
    expect(evalIn<unknown>(sandbox, "deriveSuggestedNextAction({})")).toBeNull();
  });

  it("distinguishes open / in_progress / blocked / completed tasks", () => {
    const { sandbox } = loadAppSandbox();
    const label = (status: string) => {
      sandbox.item = { objectType: "task", action: "update", payload: { status } };
      return evalIn<string>(sandbox, "kindLabel(item)");
    };
    expect(label("open")).toBe("open");
    expect(label("in_progress")).toBe("in_progress");
    expect(label("blocked")).toBe("blocked");
    expect(label("completed")).toBe("completed");
  });

  it("distinguishes proposed / accepted / superseded decisions", () => {
    const { sandbox } = loadAppSandbox();
    const label = (status: string) => {
      sandbox.item = { objectType: "decision", action: "update", payload: { status } };
      return evalIn<string>(sandbox, "kindLabel(item)");
    };
    expect(label("proposed")).toBe("proposed");
    expect(label("accepted")).toBe("accepted");
    expect(label("superseded")).toBe("superseded");
  });

  it("does not invent task or decision statuses from an unknown value", () => {
    const { sandbox } = loadAppSandbox();
    sandbox.item = { objectType: "task", action: "create", payload: { status: "wat" } };
    expect(evalIn<string>(sandbox, "kindLabel(item)")).toBe("task");
    sandbox.item = { objectType: "decision", action: "create", payload: {} };
    expect(evalIn<string>(sandbox, "kindLabel(item)")).toBe("decision");
  });
});

describe("viewer recorded alignment boundary", () => {
  it("returns null from deriveAlignment when alignment is missing or not a record", () => {
    const { sandbox } = loadAppSandbox();
    expect(evalIn<unknown>(sandbox, "deriveAlignment({})")).toBeNull();
    expect(evalIn<unknown>(sandbox, "deriveAlignment(null)")).toBeNull();
    expect(evalIn<unknown>(sandbox, "deriveAlignment({ alignment: null })")).toBeNull();
    expect(evalIn<unknown>(sandbox, "deriveAlignment({ alignment: [] })")).toBeNull();
    expect(
      evalIn<unknown>(
        sandbox,
        'deriveAlignment({ alignment: { status: "agreed", proposedDecisionIds: ["d1"], acceptedDecisionIds: [], unresolvedBlockedTaskIds: [] } })',
      ),
    ).toBeNull();
  });

  it("returns the projected id arrays and does not invent status from decisions alone", () => {
    const { sandbox } = loadAppSandbox();
    sandbox.ctx = {
      proposedDecisions: [{ id: "d-prop", summary: "Raise retry budget" }],
      acceptedDecisions: [{ id: "d-acc", summary: "Use SQLite" }],
    };
    expect(evalIn<unknown>(sandbox, "deriveAlignment(ctx)")).toBeNull();

    sandbox.ctx = {
      proposedDecisions: [{ id: "d-prop", summary: "Raise retry budget" }],
      alignment: {
        status: "open",
        proposedDecisionIds: ["d-prop", 12, null],
        acceptedDecisionIds: ["d-acc"],
        unresolvedBlockedTaskIds: ["t-blk", { id: "nope" }],
      },
    };
    expect(evalIn<unknown>(sandbox, "deriveAlignment(ctx)")).toEqual({
      status: "open",
      proposedDecisionIds: ["d-prop"],
      acceptedDecisionIds: ["d-acc"],
      unresolvedBlockedTaskIds: ["t-blk"],
    });
  });

  it("renders the recorded boundary without actions or agreement language", () => {
    const { sandbox } = loadAppSandbox();
    sandbox.ctx = {
      alignment: {
        status: "open",
        proposedDecisionIds: ["d-prop"],
        acceptedDecisionIds: ["d-acc"],
        unresolvedBlockedTaskIds: ["t-blk"],
      },
      proposedDecisions: [{ id: "d-prop", summary: "Raise retry budget" }],
      acceptedDecisions: [{ id: "d-acc", summary: "Use SQLite" }],
      currentWork: {
        blockedTasks: [{ id: "t-blk", title: "Fix billing retry", status: "blocked" }],
      },
      openTasks: [{ id: "t-open", title: "Do not use this title", status: "open" }],
    };
    sandbox.el = { innerHTML: "" };
    evalIn(sandbox, "renderAlignment(el, deriveAlignment(ctx), ctx)");
    const html = evalIn<string>(sandbox, "el.innerHTML");
    expect(html).toContain("open");
    expect(html).toContain("Not permission to execute");
    expect(html).toContain("Raise retry budget");
    expect(html).toContain("Use SQLite");
    expect(html).toContain("Fix billing retry");
    expect(html).not.toContain("Do not use this title");
    expect(html).not.toContain("<button");
    expect(html.toLowerCase()).not.toContain("agreed");
  });

  it("renders unspecified with no groups when the id arrays are empty", () => {
    const { sandbox } = loadAppSandbox();
    sandbox.ctx = {
      alignment: {
        status: "unspecified",
        proposedDecisionIds: [],
        acceptedDecisionIds: [],
        unresolvedBlockedTaskIds: [],
      },
    };
    sandbox.el = { innerHTML: "" };
    evalIn(sandbox, "renderAlignment(el, deriveAlignment(ctx), ctx)");
    const html = evalIn<string>(sandbox, "el.innerHTML");
    expect(html).toContain("unspecified");
    expect(html).toContain("Not permission to execute");
    expect(html).not.toContain("ogroup");
    expect(html).not.toContain("No recorded alignment boundary.");
    expect(html).not.toContain("<button");
    expect(html.toLowerCase()).not.toContain("agreed");
  });

  it("shows the empty state when deriveAlignment returns null", () => {
    const { sandbox } = loadAppSandbox();
    sandbox.el = { innerHTML: "" };
    evalIn(sandbox, "renderAlignment(el, deriveAlignment({}), {})");
    expect(evalIn<string>(sandbox, "el.innerHTML")).toContain("No recorded alignment boundary.");
  });
});

describe("viewer 003 read-only boundary", () => {
  it("keeps the read allowlist exactly, with no write method added", () => {
    expect([...VIEWER_READ_METHODS]).toEqual([
      "whoami",
      "list_workspaces",
      "get_workspace",
      "get_workspace_context",
      "get_activity",
    ]);
    for (const method of VIEWER_READ_METHODS) {
      expect(isViewerReadMethod(method)).toBe(true);
    }
    for (const method of [
      "add_finding",
      "add_decision",
      "accept_decision",
      "create_task",
      "update_task",
      "add_artifact",
    ]) {
      expect(isViewerReadMethod(method)).toBe(false);
    }
  });

  it("rejects writes over HTTP and serves allowlisted reads", async () => {
    const calls: string[] = [];
    const viewer = await startCampfireViewer({
      call: async (method) => {
        calls.push(method);
        return { method };
      },
      port: 0,
    });
    try {
      const post = (method: string) =>
        fetch(`${viewer.url}/api/call`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method, params: {} }),
        });

      const write = await post("add_finding");
      expect(write.status).toBe(403);
      const writeBody = (await write.json()) as { ok: boolean; error: string; message: string };
      expect(writeBody.ok).toBe(false);
      expect(writeBody.error).toBe("Unauthorized");
      expect(writeBody.message).toBe("Viewer is read-only");
      expect(calls).not.toContain("add_finding");

      const read = await post("get_workspace_context");
      expect(read.status).toBe(200);
      const readBody = (await read.json()) as { ok: boolean; result: { method: string } };
      expect(readBody.ok).toBe(true);
      expect(readBody.result).toEqual({ method: "get_workspace_context" });
    } finally {
      await viewer.close();
    }
  });
});
