/**
 * NAV-003 Step 1 — Viewer read boundary.
 *
 * The seven added methods stay the existing service JSON. This file checks
 * the allowlist, denial through the served Viewer, and the refresh trace.
 * It is not a human observation.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import vm from "node:vm";
import { encodeContextCursor } from "../../src/domain/context-policy.js";
import {
  SCENARIO,
  SERVED_AT,
  UNRELATED_FINDING_SENTINEL,
  seedDatabase,
} from "../../fixtures/navigator/nav-001/seed.js";
import { dispatchCampfireMethod } from "../../src/http/dispatch.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { isViewerReadMethod as isWorkerViewerRead } from "../../src/worker/handler.js";
import {
  assertViewerHost,
  isLoopbackHost,
  isViewerReadMethod,
  startCampfireViewer,
  VIEWER_READ_METHODS,
  type RunningViewer,
} from "../../src/viewer/server.js";

const LAB = SCENARIO.workspaces.lab;
const UNRELATED = SCENARIO.workspaces.unrelated;
const READS = [
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
] as const;

const WORKSPACE_READS: Array<[string, Record<string, unknown>]> = [
  ["get_workspace", { workspaceId: LAB }],
  ["get_workspace_context", { workspaceId: LAB, participants: "omit" }],
  ["get_activity", { workspaceId: LAB, limit: 10 }],
  ["list_tasks", { workspaceId: LAB, limit: 20 }],
  ["list_workspace_participants", { workspaceId: LAB, limit: 20 }],
  ["get_task", { workspaceId: LAB, taskId: SCENARIO.tasks.assignedOpenAna }],
  ["get_decision", { workspaceId: LAB, decisionId: SCENARIO.decisions.review }],
  ["get_finding", { workspaceId: LAB, findingId: SCENARIO.findings.labCurrent }],
  ["get_artifact", { workspaceId: LAB, artifactId: SCENARIO.artifacts.runbook }],
  ["get_record_history", {
    workspaceId: LAB,
    objectType: "decision",
    objectId: SCENARIO.decisions.review,
    limit: 10,
  }],
];

const LEAKS = [
  UNRELATED_FINDING_SENTINEL,
  SCENARIO.workspaceNames.lab,
  SCENARIO.workspaceNames.unrelated,
  "Give the terminal one focused screen",
  "Ana",
  "cft_",
  "cfe_",
  "tokenHash",
  "secretHash",
  "transcript",
  "Bearer ",
  "20 people",
  "37 registered",
];

const APP_JS = readFileSync(new URL("../../src/viewer/static/app.js", import.meta.url), "utf8");
const PUBLIC_APP_JS = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");

const ana: ActorContext = { actor: { actorId: SCENARIO.humans.ana, actorType: "human" } };
const zed: ActorContext = { actor: { actorId: SCENARIO.humans.zed, actorType: "human" } };

let dir: string;
let store: CampfireStore;
let service: CampfireService;
let anaViewer: RunningViewer;
let zedViewer: RunningViewer;
let anaCalls = 0;

function bind(actor: ActorContext): (method: string, params?: Record<string, unknown>) => Promise<unknown> {
  return (method, params) =>
    Promise.resolve().then(() => {
      if (actor === ana) anaCalls += 1;
      return dispatchCampfireMethod(service, actor, method, params ?? {});
    });
}

async function post(
  viewer: RunningViewer,
  method: string,
  params: Record<string, unknown>,
): Promise<{ status: number; text: string; body: { ok?: boolean; error?: string; message?: string; result?: unknown } }> {
  const response = await fetch(`${viewer.url}/api/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) as { ok?: boolean; error?: string; message?: string; result?: unknown } };
}

function assertNoLeak(text: string): void {
  for (const marker of LEAKS) expect(text).not.toContain(marker);
  expect(text).not.toMatch(/\b57\b/);
  expect(text).not.toContain('"items"');
  expect(text).not.toContain('"total"');
  expect(text).not.toContain('"payload"');
  expect(text).not.toContain('"title"');
  expect(Object.keys(JSON.parse(text) as object).sort()).toEqual(["error", "message", "ok"]);
}

function rawRequest(port: number, hostHeader: string, body: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/api/call",
        method: "POST",
        headers: {
          host: hostHeader,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "nav-003-viewer-"));
  const seeded = seedDatabase(dir, true);
  store = openSqliteStore(seeded.databasePath);
  service = createCampfireService({ store, clock: () => SERVED_AT });
  anaViewer = await startCampfireViewer({ port: 0, host: "127.0.0.1", call: bind(ana) });
  zedViewer = await startCampfireViewer({ port: 0, host: "127.0.0.1", call: bind(zed) });
});

afterAll(async () => {
  await anaViewer?.close();
  await zedViewer?.close();
  service?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("NAV-003 viewer read boundary", () => {
  it("allowlists exactly twelve reads and mirrors them on the worker", () => {
    expect([...VIEWER_READ_METHODS]).toEqual([...READS]);
    expect(VIEWER_READ_METHODS).toHaveLength(12);
    const handler = readFileSync(new URL("../../src/worker/handler.ts", import.meta.url), "utf8");
    const match = /const VIEWER_READ_METHODS = \[([\s\S]*?)\] as const/.exec(handler);
    expect(match).not.toBeNull();
    const workerReads = [...match![1]!.matchAll(/"([a-z_]+)"/g)].map((item) => item[1]);
    expect(workerReads).toEqual([...READS]);
    for (const method of READS) {
      expect(isViewerReadMethod(method)).toBe(true);
      expect(isWorkerViewerRead(method)).toBe(true);
    }
    expect(isViewerReadMethod("add_finding")).toBe(false);
    expect(isWorkerViewerRead("add_finding")).toBe(false);
    expect(isViewerReadMethod("not_a_campfire_method")).toBe(false);
    expect(PUBLIC_APP_JS).toBe(APP_JS);
  });

  it("keeps loopback Host checks and refuses a remote bind without opt-in", async () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(() => assertViewerHost("127.0.0.1")).not.toThrow();
    expect(() => assertViewerHost("0.0.0.0")).toThrow(/--allow-remote/);
    expect(() => assertViewerHost("0.0.0.0", true)).not.toThrow();
    await expect(startCampfireViewer({ call: async () => ({}), host: "0.0.0.0", port: 0 })).rejects.toThrow(
      /--allow-remote/,
    );

    const before = anaCalls;
    const body = JSON.stringify({
      method: "get_workspace_context",
      params: { workspaceId: LAB, participants: "omit" },
    });
    const rejected = await rawRequest(anaViewer.port, `evil.example:${anaViewer.port}`, body);
    expect(rejected.status).toBe(403);
    expect(rejected.text).toContain("Request Host is not the viewer's listening address");
    assertNoLeak(rejected.text);
    expect(anaCalls).toBe(before);

    const allowed = await rawRequest(anaViewer.port, `127.0.0.1:${anaViewer.port}`, body);
    expect(allowed.status).toBe(200);
    expect(anaCalls).toBe(before + 1);
  });

  it("rejects a write and an unknown method before options.call", async () => {
    const calls: string[] = [];
    const viewer = await startCampfireViewer({
      port: 0,
      host: "127.0.0.1",
      call: (method) => {
        calls.push(method);
        return Promise.resolve({ leaked: true });
      },
    });
    try {
      for (const method of ["add_finding", "create_task", "not_a_campfire_method"]) {
        const response = await fetch(`${viewer.url}/api/call`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method, params: { summary: UNRELATED_FINDING_SENTINEL } }),
        });
        const text = await response.text();
        expect(response.status).toBe(403);
        expect(JSON.parse(text)).toEqual({ ok: false, error: "Unauthorized", message: "Viewer is read-only" });
        assertNoLeak(text);
      }
      expect(calls).toEqual([]);
    } finally {
      await viewer.close();
    }
  });

  it("serves no count, name, title, payload, or secret to a denied actor or wrong workspace", async () => {
    for (const [method, params] of WORKSPACE_READS) {
      const denied = await post(zedViewer, method, params);
      expect(denied.status, method).toBe(403);
      expect(denied.body.error).toBe("ParticipantRequired");
      assertNoLeak(denied.text);

      const wrongWorkspace = await post(anaViewer, method, { ...params, workspaceId: UNRELATED });
      expect(wrongWorkspace.status, method).toBe(403);
      expect(wrongWorkspace.body.error).toBe("ParticipantRequired");
      assertNoLeak(wrongWorkspace.text);
    }

    const wrongFinding = await post(anaViewer, "get_finding", {
      workspaceId: LAB,
      findingId: SCENARIO.findings.unrelatedSentinel,
    });
    expect(wrongFinding.status).toBe(404);
    expect(wrongFinding.body.error).toBe("FindingNotFound");
    expect(wrongFinding.text).toContain(SCENARIO.findings.unrelatedSentinel);
    assertNoLeak(wrongFinding.text);

    const foreignPeople = encodeContextCursor({
      v: 1,
      kind: "participant",
      workspaceId: UNRELATED,
      humanOwnerId: null,
      actorType: "agent",
      actorId: "agt_nav001_01",
    });
    const peopleCursor = await post(anaViewer, "list_workspace_participants", {
      workspaceId: LAB,
      limit: 20,
      cursor: foreignPeople,
    });
    expect(peopleCursor.status).toBe(400);
    expect(peopleCursor.body.error).toBe("ValidationError");
    expect(peopleCursor.text).not.toContain(foreignPeople);
    assertNoLeak(peopleCursor.text);

    const foreignHistory = encodeContextCursor({
      v: 1,
      kind: "record-history",
      workspaceId: UNRELATED,
      objectType: "decision",
      objectId: SCENARIO.decisions.review,
      order: "append-position-desc",
      tip: 217,
      beforePosition: 10,
    });
    const historyCursor = await post(anaViewer, "get_record_history", {
      workspaceId: LAB,
      objectType: "decision",
      objectId: SCENARIO.decisions.review,
      limit: 10,
      cursor: foreignHistory,
    });
    expect(historyCursor.status).toBe(400);
    expect(historyCursor.body.error).toBe("ValidationError");
    expect(historyCursor.text).not.toContain(foreignHistory);
    assertNoLeak(historyCursor.text);
  });

  it("returns the existing service JSON for the seven reads without credential fields", async () => {
    const tasks = await post(anaViewer, "list_tasks", { workspaceId: LAB, limit: 20 });
    const people = await post(anaViewer, "list_workspace_participants", { workspaceId: LAB, limit: 20 });
    const task = await post(anaViewer, "get_task", { workspaceId: LAB, taskId: SCENARIO.tasks.assignedOpenAna });
    const decision = await post(anaViewer, "get_decision", {
      workspaceId: LAB,
      decisionId: SCENARIO.decisions.review,
    });
    const finding = await post(anaViewer, "get_finding", {
      workspaceId: LAB,
      findingId: SCENARIO.findings.labCurrent,
    });
    const artifact = await post(anaViewer, "get_artifact", {
      workspaceId: LAB,
      artifactId: SCENARIO.artifacts.runbook,
    });
    const history = await post(anaViewer, "get_record_history", {
      workspaceId: LAB,
      objectType: "decision",
      objectId: SCENARIO.decisions.review,
      limit: 10,
    });
    expect(tasks.status).toBe(200);
    expect(tasks.body.result).toMatchObject({ total: 64, returned: 20 });
    expect(people.body.result).toMatchObject({ total: 57, returned: 20 });
    expect(task.body.result).toMatchObject({ id: SCENARIO.tasks.assignedOpenAna });
    expect(decision.body.result).toMatchObject({ id: SCENARIO.decisions.review });
    expect(finding.body.result).toMatchObject({ id: SCENARIO.findings.labCurrent });
    expect(artifact.body.result).toMatchObject({ id: SCENARIO.artifacts.runbook });
    expect(history.body.result).toMatchObject({ returned: 3, total: 3 });
    const historyResult = history.body.result as {
      items: Array<{ id: string; payload?: unknown; payloadSummary?: string }>;
    };
    expect(historyResult.items.map((item) => item.id)).toEqual([
      "con_nav001_0283",
      "con_nav001_0279",
      "con_nav001_0276",
    ]);
    expect(JSON.stringify(historyResult)).not.toContain('"payload"');
    expect(history.text).not.toContain("original observation");
    expect(history.text).not.toContain("The terminal screen lists every recorded task");
    expect(history.text).not.toContain("<script>");
    expect(historyResult.items.map((item) => item.payloadSummary)).toEqual([
      "findingId find_nav001_superseded",
      "status accepted",
      "status proposed",
    ]);
    const direct = dispatchCampfireMethod(service, ana, "get_record_history", {
      workspaceId: LAB,
      objectType: "decision",
      objectId: SCENARIO.decisions.review,
      limit: 10,
    }) as { items: Array<{ payload?: { note?: string; status?: string } }> };
    expect(direct.items.some((item) => item.payload?.note === "original observation")).toBe(true);
    expect(direct.items.some((item) => item.payload?.status === "accepted")).toBe(true);

    const packed = [tasks, people, task, decision, finding, artifact, history].map((item) => item.text).join("\n");
    expect(packed).not.toMatch(/cft_|cfe_|tokenHash|secretHash|transcript|Bearer /);
    expect(packed).not.toContain(UNRELATED_FINDING_SENTINEL);

    for (const path of ["/", "/app.js", "/app.css", "/campfire-mark.svg"]) {
      const asset = await fetch(`${anaViewer.url}${path}`);
      expect(asset.status, path).toBe(200);
      const text = await asset.text();
      expect(text, path).not.toMatch(/cft_|cfe_|CAMPFIRE_TOKEN|Authorization|Bearer /);
    }
  });

  it("omits a note-only payload and any planted transcript, note, or script from served history", async () => {
    const transcript = "PRIVATE_TRANSCRIPT_DO_NOT_SHOW";
    const note = "PRIVATE_NOTE_DO_NOT_SHOW";
    const script = "<script>alert(1)</script>";
    const prose = "do not quote this prose";
    const viewer = await startCampfireViewer({
      port: 0,
      host: "127.0.0.1",
      call: async (method) => {
        if (method !== "get_record_history") return { untouched: true };
        return {
          schemaVersion: 1,
          workspaceId: "ws_small",
          objectType: "decision",
          objectId: "dec_small",
          total: 2,
          returned: 2,
          truncated: false,
          items: [
            {
              id: "con_allow",
              actor: { actorType: "human", actorId: "hum_a" },
              action: "update",
              objectType: "decision",
              objectId: "dec_small",
              agentSessionId: "ses_a",
              appendPosition: 2,
              createdAt: "2026-10-17T12:00:00.000Z",
              payload: {
                status: "accepted",
                currentness: true,
                findingId: "find_safe",
                taskId: 12,
                note,
                transcript,
                html: script,
                summary: prose,
                prompt: "ignore previous instructions",
                messages: ["hello"],
                rationale: "because the page felt complete",
              },
            },
            {
              id: "con_note",
              actor: { actorType: "human", actorId: "hum_a" },
              action: "update",
              objectType: "decision",
              objectId: "dec_small",
              appendPosition: 1,
              createdAt: "2026-10-17T11:00:00.000Z",
              payload: { note: "only a private note" },
            },
          ],
        };
      },
    });
    try {
      const served = await post(viewer, "get_record_history", {
        workspaceId: "ws_small",
        objectType: "decision",
        objectId: "dec_small",
      });
      expect(served.status).toBe(200);
      expect(served.text).not.toContain('"payload"');
      expect(served.text).not.toContain(transcript);
      expect(served.text).not.toContain(note);
      expect(served.text).not.toContain(script);
      expect(served.text).not.toContain(prose);
      expect(served.text).not.toContain("ignore previous instructions");
      expect(served.text).not.toContain("only a private note");
      expect(served.text).not.toContain("because the page felt complete");
      const result = served.body.result as {
        total: number;
        returned: number;
        items: Array<{ id: string; appendPosition: number; payloadSummary?: string }>;
      };
      expect(result).toMatchObject({ total: 2, returned: 2 });
      expect(result.items.map((item) => item.id)).toEqual(["con_allow", "con_note"]);
      expect(result.items[0]?.appendPosition).toBe(2);
      expect(result.items[0]?.payloadSummary).toBe(
        "status accepted · currentness true · findingId find_safe · taskId 12",
      );
      expect(result.items[1]?.payloadSummary).toBe("recorded payload omitted");
      const other = await post(viewer, "get_decision", { decisionId: "dec_small" });
      expect(other.body.result).toEqual({ untouched: true });
    } finally {
      await viewer.close();
    }
  });

  it("omits the roster on initial load and poll and does not call the inspector or on-demand reads", async () => {
    expect(APP_JS).not.toMatch(/api\("get_workspace"/);
    expect(APP_JS).toContain('api("list_tasks"');
    expect(APP_JS).toContain('api("list_workspace_participants"');
    expect(APP_JS).toContain('api("get_record_history"');
    expect(APP_JS).toContain('participants: "omit"');

    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const elements: Record<string, { textContent: string; innerHTML: string; hidden: boolean; value: string }> = {};
    const element = (id: string) => {
      elements[id] ??= {
        textContent: "",
        innerHTML: "",
        hidden: false,
        value: "",
        setAttribute() {},
        addEventListener() {},
      } as { textContent: string; innerHTML: string; hidden: boolean; value: string };
      return elements[id];
    };
    const memory = new Map<string, string>([["campfire.viewer.lastSeen.ws_nav001_lab", "con_saved"]]);
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, String(value));
      },
    };
    let fail = false;
    let poll: (() => Promise<void>) | undefined;
    const sandbox: Record<string, unknown> = {
      document: {
        documentElement: { dataset: {} as Record<string, string> },
        getElementById: (id: string) => element(id),
        addEventListener() {},
      },
      localStorage: storage,
      sessionStorage: storage,
      fetch: async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { method: string; params: Record<string, unknown> };
        calls.push(body);
        if (fail) throw new Error("offline");
        let result: unknown = {};
        if (body.method === "whoami") {
          result = { actor: { actorId: "hum_nav001_ana", actorType: "human" }, name: "Ana" };
        } else if (body.method === "list_workspaces") {
          result = [{ id: "ws_nav001_lab", name: "lab" }];
        } else if (body.method === "get_workspace_context") {
          result = {
            participants: [],
            participantsCoverage: { returned: 0, total: 57, truncated: true, omitted: true },
            goal: { id: "goal_nav001_focus", title: "Keep the count" },
            openTasks: [],
            currentWork: { inProgressTasks: [], blockedTasks: [], acceptedDecisions: [] },
            slices: { tasks: { total: 64, returned: 20, truncated: true } },
          };
        } else if (body.method === "get_activity") {
          result = { items: [], total: 0, truncated: false };
        }
        return { json: async () => ({ ok: true, result }) };
      },
      setInterval: (fn: () => Promise<void>) => {
        poll = fn;
        return 1;
      },
      CSS: { escape: (value: string) => value },
      console,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    const source = APP_JS.replace(/\nboot\(\);\s*$/, "\n");
    vm.runInContext(source, sandbox, { filename: "app.js" });
    await vm.runInContext("boot()", sandbox);

    const methodsOf = (rows: Array<{ method: string }>) => rows.map((row) => row.method);
    expect(methodsOf(calls)).toEqual(["whoami", "list_workspaces", "get_workspace_context", "get_activity"]);
    expect(calls[2]?.params).toEqual({ workspaceId: "ws_nav001_lab", participants: "omit", since: "con_saved" });
    expect(elements["recorded-counts"]?.textContent).toBe("57 workspace participants");
    expect(elements["people"]?.textContent).toBe("Participant roster is not in this read.");
    expect(elements["current-work"]?.innerHTML).toContain("Owned-agent relationship is not loaded yet.");
    expect(elements["current-work"]?.innerHTML).not.toContain("none recorded");
    expect(elements["recorded-counts"]?.textContent).not.toContain("0 people");
    expect(elements["recorded-counts"]?.textContent).not.toContain("20 people");
    expect(elements["recorded-counts"]?.textContent).not.toContain("registered agents");

    vm.runInContext('setPerspective("team")', sandbox);
    expect(elements["current-work"]?.innerHTML).toContain("Participant roster is not in this read.");
    expect(elements["current-work"]?.innerHTML).not.toContain("name not recorded");
    expect(elements["current-work"]?.innerHTML).not.toContain("0 people");

    const afterInitial = calls.length;
    expect(poll).toBeTypeOf("function");
    await poll!();
    expect(methodsOf(calls.slice(afterInitial))).toEqual([
      "list_workspaces",
      "get_workspace_context",
      "get_activity",
    ]);
    expect(calls.at(-2)?.params).toEqual({ workspaceId: "ws_nav001_lab", participants: "omit" });
    expect(calls.at(-2)?.params).not.toHaveProperty("since");

    vm.runInContext("state.view = { goal: { title: 'leftover inspector' }, participants: [] }", sandbox);
    fail = true;
    await poll!();
    expect(methodsOf(calls.slice(afterInitial + 3))).toEqual(["list_workspaces"]);
    expect(vm.runInContext("state.context.goal.title", sandbox)).toBe("Keep the count");
    expect(vm.runInContext("state.view.goal.title", sandbox)).toBe("leftover inspector");
    // The thrown Error is from outside the page realm, so api() keeps its
    // generic network message. The last good view must still stay.
    expect(vm.runInContext("state.error", sandbox)).toBe("request failed");
    expect(elements["recorded-counts"]?.textContent).toBe("57 workspace participants");
    expect(elements["people"]?.textContent).not.toContain("0 people");
    for (const row of calls) {
      expect(["whoami", "list_workspaces", "get_workspace_context", "get_activity"]).toContain(row.method);
    }
  });
});

describe("NAV-003 viewer navigation", () => {
  const INDEX_HTML = readFileSync(new URL("../../src/viewer/static/index.html", import.meta.url), "utf8");
  const APP_CSS = readFileSync(new URL("../../src/viewer/static/app.css", import.meta.url), "utf8");

  function loadNav(handler: (body: { method: string; params: Record<string, unknown> }) => Promise<unknown> | unknown) {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const elements: Record<string, { textContent: string; innerHTML: string; hidden: boolean; disabled: boolean; value: string }> = {};
    const element = (id: string) => {
      elements[id] ??= {
        textContent: "",
        innerHTML: "",
        hidden: false,
        disabled: false,
        value: "",
        setAttribute() {},
        addEventListener() {},
        focus() {},
        getAttribute: () => null,
      } as { textContent: string; innerHTML: string; hidden: boolean; disabled: boolean; value: string };
      return elements[id];
    };
    const sandbox: Record<string, unknown> = {
      document: {
        documentElement: { dataset: {} as Record<string, string> },
        getElementById: (id: string) => element(id),
        addEventListener() {},
        querySelectorAll: () => [],
        activeElement: null,
      },
      localStorage: { getItem: () => null, setItem: () => {} },
      sessionStorage: { getItem: () => null, setItem: () => {} },
      fetch: async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { method: string; params: Record<string, unknown> };
        calls.push(body);
        const result = await handler(body);
        return { json: async () => ({ ok: true, result }) };
      },
      setInterval: () => 1,
      CSS: { escape: (value: string) => value },
      console,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    const cut = APP_JS.lastIndexOf("async function boot()");
    vm.runInContext(APP_JS.slice(0, cut), sandbox, { filename: "app.js" });
    return { sandbox, calls, elements };
  }

  it("pages Work by 20 and reaches task_nav001_f051 without loading 64 tasks", async () => {
    const page1 = {
      items: [{ id: "task_nav001_blocked_agent", title: "blocked", status: "blocked", createdAt: "2026-10-17T12:00:00.000Z" }],
      total: 64,
      returned: 20,
      truncated: true,
      nextCursor: "cursor-page-2",
    };
    const page2 = {
      items: [{ id: "task_nav001_f051", title: "Display-pressure filler task 51", status: "open", createdAt: "2026-10-17T12:04:09.000Z", createdBy: { actorType: "human", actorId: "hum_nav001_ana" } }],
      total: 64,
      returned: 20,
      truncated: true,
      nextCursor: "cursor-page-3",
    };
    const { sandbox, calls, elements } = loadNav((body) => {
      if (body.method !== "list_tasks") return {};
      return body.params.cursor === "cursor-page-2" ? page2 : page1;
    });
    vm.runInContext('state.workspaceId = "ws_nav001_lab"; state.section = "attention";', sandbox);
    await vm.runInContext('setSection("work")', sandbox);
    expect(calls.map((row) => row.method)).toEqual(["list_tasks"]);
    expect(calls[0]?.params).toEqual({ workspaceId: "ws_nav001_lab", limit: 20 });
    expect(elements["work-list"]?.innerHTML).toContain("task_nav001_blocked_agent");
    expect(elements["work-list"]?.innerHTML).not.toContain("task_nav001_f051");
    await vm.runInContext('pageWork("next")', sandbox);
    expect(calls[1]?.params).toEqual({ workspaceId: "ws_nav001_lab", limit: 20, cursor: "cursor-page-2" });
    expect(calls.every((row) => row.params.limit === 20)).toBe(true);
    expect(elements["work-list"]?.innerHTML).toContain("task_nav001_f051");
    expect(elements["work-coverage"]?.textContent).toContain("returned 20 of 64");
    expect(elements["work-coverage"]?.textContent).toContain("page 2");
    expect(elements["work-coverage"]?.textContent).toContain("another API page exists");
  });

  it("filters People by humanOwnerId and does not insert an owner who is outside the roster", async () => {
    const agent03 = {
      actor: { actorId: "agt_nav001_03", actorType: "agent" },
      name: "Agent 03",
      role: "agent",
      harness: "codex",
      joinedAt: "2026-10-17T12:01:45.000Z",
      humanOwnerId: "hum_nav001_zed",
      humanOwnerIsParticipant: false,
    };
    const anaAgents = [
      {
        actor: { actorId: "agt_nav001_01", actorType: "agent" },
        name: "Agent 01",
        role: "agent",
        harness: "codex",
        joinedAt: "2026-10-17T12:01:41.000Z",
        humanOwnerId: "hum_nav001_ana",
        humanOwnerIsParticipant: true,
      },
      {
        actor: { actorId: "agt_nav001_21", actorType: "agent" },
        name: "Agent 21",
        role: "agent",
        harness: "codex",
        joinedAt: "2026-10-17T12:02:21.000Z",
        humanOwnerId: "hum_nav001_ana",
        humanOwnerIsParticipant: true,
      },
    ];
    const { sandbox, calls, elements } = loadNav((body) => {
      if (body.method !== "list_workspace_participants") return {};
      if (body.params.humanOwnerId === "hum_nav001_ana") {
        return { items: anaAgents, total: 2, returned: 2, truncated: false };
      }
      return { items: [agent03], total: 57, returned: 20, truncated: true, nextCursor: "people-2" };
    });
    vm.runInContext('state.workspaceId = "ws_nav001_lab";', sandbox);
    await vm.runInContext('setSection("people")', sandbox);
    expect(calls[0]?.params).toEqual({ workspaceId: "ws_nav001_lab", limit: 20 });
    expect(calls[0]?.params).not.toHaveProperty("humanOwnerId");
    await vm.runInContext('selectRecord("agent", "agt_nav001_03")', sandbox);
    expect(elements["source-view"]?.innerHTML).toContain("hum_nav001_zed");
    expect(elements["source-view"]?.innerHTML).toContain("owner is outside the roster");
    expect(elements["people-list"]?.innerHTML).not.toContain('data-record-id="hum_nav001_zed"');
    expect(elements["people-list"]?.innerHTML).not.toContain('data-record-kind="human"');
    await vm.runInContext('openHumanAgents("hum_nav001_ana")', sandbox);
    expect(calls.at(-1)?.params).toMatchObject({
      workspaceId: "ws_nav001_lab",
      limit: 20,
      humanOwnerId: "hum_nav001_ana",
    });
    expect(elements["people-list"]?.innerHTML).toContain("agt_nav001_01");
    expect(elements["people-list"]?.innerHTML).toContain("agt_nav001_21");
    expect(elements["people-coverage"]?.textContent).toContain("returned 2 of 2");
    expect(elements["people-list"]?.innerHTML).not.toContain('data-record-id="hum_nav001_zed"');
    expect(elements["recorded-counts"]?.textContent ?? "").not.toContain("20 people");
  });

  it("reserves the unchanged-acceptance sentence for an accepted decision", () => {
    const { sandbox } = loadNav(() => ({}));
    vm.runInContext("state.context = { proposedDecisions: [], acceptedDecisions: [], findings: [] };", sandbox);
    const proposed = {
      id: "dec_proposed_stale",
      status: "proposed",
      createdAt: "2026-10-17T12:00:00.000Z",
      rationale: "Still a proposal.",
      needsReview: true,
      needsReviewFindingIds: ["find_old"],
      citations: [{ id: "cit_1", findingId: "find_old", note: "old" }],
    };
    const accepted = {
      id: "dec_nav001_review",
      status: "accepted",
      createdAt: "2026-10-17T12:05:00.000Z",
      rationale: "Assumed the default task page returned every recorded task.",
      needsReview: true,
      needsReviewFindingIds: ["find_nav001_superseded"],
    };
    const proposedHtml = vm.runInContext(
      `sourceRecordHtml("decision", ${JSON.stringify(proposed)})`,
      sandbox,
    ) as string;
    const acceptedHtml = vm.runInContext(
      `sourceRecordHtml("decision", ${JSON.stringify(accepted)})`,
      sandbox,
    ) as string;
    const proposedRow = vm.runInContext(`decisionRowHtml(${JSON.stringify(proposed)})`, sandbox) as string;
    expect(proposedHtml).toContain("proposed — not accepted, not an instruction");
    expect(proposedHtml).toContain("find_old");
    expect(proposedHtml).not.toContain("acceptance is unchanged");
    expect(proposedRow).not.toContain("acceptance is unchanged");
    expect(acceptedHtml).toContain("needs review — acceptance is unchanged");
  });

  it("says a failed Work or People refresh is not complete", () => {
    const { sandbox, elements } = loadNav(() => ({}));
    vm.runInContext(
      `state.workPage = {
         items: [{ id: "task_nav001_f051", title: "Display-pressure filler task 51", status: "open" }],
         total: 64, returned: 20, truncated: true, nextCursor: "cursor-page-3",
         pageNumber: 2, cursorStack: [], readAt: "2026-10-19T00:00:00.000Z",
         error: "request failed", stale: true, loading: false,
       };
       state.peoplePage = {
         items: [], total: 57, returned: 20, truncated: false, nextCursor: null,
         pageNumber: 1, cursorStack: [], readAt: "2026-10-19T00:00:00.000Z",
         error: "request failed", stale: true, loading: false,
       };
       renderNavigation();`,
      sandbox,
    );
    const work = elements["work-coverage"]?.textContent ?? "";
    const people = elements["people-coverage"]?.textContent ?? "";
    expect(work).toContain("returned 20 of 64");
    expect(work).toContain("not complete");
    expect(work).not.toContain("another API page exists");
    expect(work).not.toContain("no further API page");
    expect(people).toContain("returned 20 of 57");
    expect(people).toContain("not complete");
    expect(people).not.toContain("no further API page");
  });

  it("shows dec_nav001_review history as returned 3 of 3, newest first", async () => {
    const contributions = [
      { id: "con_nav001_0283", action: "update", actor: { actorType: "human", actorId: "hum_nav001_ana" }, createdAt: "2026-10-17T12:08:00.000Z", payload: { note: "original observation" } },
      { id: "con_nav001_0279", action: "update", actor: { actorType: "human", actorId: "hum_nav001_ana" }, createdAt: "2026-10-17T12:07:00.000Z", payload: { status: "accepted" } },
      { id: "con_nav001_0276", action: "create", actor: { actorType: "human", actorId: "hum_nav001_ana" }, createdAt: "2026-10-17T12:06:00.000Z", payload: { status: "proposed" } },
    ];
    const { sandbox, calls, elements } = loadNav((body) => {
      if (body.method !== "get_record_history") return {};
      return { items: contributions, total: 3, returned: 3, truncated: false };
    });
    vm.runInContext(
      `state.workspaceId = "ws_nav001_lab";
       state.layer = "source";
       state.detail = { id: "dec_nav001_review", kind: "decision", record: { id: "dec_nav001_review", status: "accepted", createdAt: "2026-10-17T12:05:00.000Z", rationale: "Assumed the default task page returned every recorded task." }, loading: false };`,
      sandbox,
    );
    await vm.runInContext("openRecordedChanges()", sandbox);
    expect(calls[0]?.params).toEqual({
      workspaceId: "ws_nav001_lab",
      objectType: "decision",
      objectId: "dec_nav001_review",
      limit: 10,
    });
    const heading = elements["history-heading"]?.textContent ?? "";
    const list = elements["history-list"]?.innerHTML ?? "";
    expect(heading).toContain("returned 3 of 3");
    expect(heading).not.toMatch(/complete/i);
    const order = ["con_nav001_0283", "con_nav001_0279", "con_nav001_0276"].map((id) => list.indexOf(id));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order[0]).toBeLessThan(order[1] ?? 0);
    expect(order[1]).toBeLessThan(order[2] ?? 0);
  });

  it("renders payloadSummary only and does not keep a payload on history state", async () => {
    expect(APP_JS).not.toContain("OMIT_PAYLOAD_KEY");
    expect(APP_JS).not.toContain("scrubPayload");
    expect(APP_JS).not.toContain("JSON.stringify(scrubPayload");
    const { sandbox, elements } = loadNav((body) => {
      if (body.method !== "get_record_history") return {};
      return {
        items: [
          {
            id: "con_nav001_0283",
            action: "update",
            actor: { actorType: "human", actorId: "hum_nav001_ana" },
            createdAt: "2026-10-17T12:08:00.000Z",
            payloadSummary: "status accepted",
            payload: {
              note: "PRIVATE_NOTE_DO_NOT_SHOW",
              transcript: "PRIVATE_TRANSCRIPT_DO_NOT_SHOW",
              html: "<script>alert(1)</script>",
            },
          },
        ],
        total: 1,
        returned: 1,
        truncated: false,
      };
    });
    vm.runInContext(
      `state.workspaceId = "ws_nav001_lab";
       state.layer = "source";
       state.detail = { id: "dec_nav001_review", kind: "decision", record: { id: "dec_nav001_review", status: "accepted", createdAt: "t" }, loading: false };`,
      sandbox,
    );
    await vm.runInContext("openRecordedChanges()", sandbox);
    const list = elements["history-list"]?.innerHTML ?? "";
    expect(list).toContain("status accepted");
    expect(list).not.toContain("PRIVATE_NOTE_DO_NOT_SHOW");
    expect(list).not.toContain("PRIVATE_TRANSCRIPT_DO_NOT_SHOW");
    expect(list).not.toContain("<script>");
    expect(list).not.toContain("alert(1)");
    const stored = vm.runInContext("state.history.page.items[0]", sandbox) as Record<string, unknown>;
    expect(stored.payload).toBeUndefined();
    expect(Object.keys(stored)).not.toContain("payload");
    expect(JSON.stringify(stored)).not.toContain("PRIVATE_NOTE_DO_NOT_SHOW");
  });

  it("does not call an empty truncated history recorded-empty", () => {
    const { sandbox, elements } = loadNav(() => ({}));
    vm.runInContext(
      `state.layer = "history";
       state.history = {
         open: true,
         objectType: "decision",
         objectId: "dec_empty",
         error: null,
         selectedId: null,
         page: {
           items: [],
           total: 0,
           returned: 0,
           truncated: true,
           nextCursor: null,
           pageNumber: 1,
           cursorStack: [],
           readAt: "2026-10-19T00:00:00.000Z",
           stale: false,
           loading: false,
         },
       };
       renderNavigation();`,
      sandbox,
    );
    const heading = elements["history-heading"]?.textContent ?? "";
    const list = elements["history-list"]?.innerHTML ?? "";
    expect(heading).not.toContain("No contributions were recorded");
    expect(list).not.toContain("No contributions were recorded");
    expect(heading).toContain("not complete");
    expect(list).toContain("not complete");
    expect(heading).not.toMatch(/(?<!not )complete/i);
    expect(list).not.toMatch(/(?<!not )complete/i);

    vm.runInContext(
      `state.history.page.truncated = false;
       renderNavigation();`,
      sandbox,
    );
    expect(elements["history-heading"]?.textContent ?? "").toContain("No contributions were recorded for this record.");
    expect(elements["history-list"]?.innerHTML ?? "").toContain("No contributions were recorded for this record.");
  });

  it("drops a late read for a record or history the person already left", async () => {
    const pending: Array<{ id: string; method: string; resolve: (value: { json: () => Promise<{ ok: true; result: unknown }> }) => void }> = [];
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const elements: Record<string, { textContent: string; innerHTML: string; hidden: boolean }> = {};
    const element = (id: string) => {
      elements[id] ??= { textContent: "", innerHTML: "", hidden: false, setAttribute() {}, addEventListener() {}, focus() {}, getAttribute: () => null } as {
        textContent: string;
        innerHTML: string;
        hidden: boolean;
      };
      return elements[id];
    };
    const sandbox: Record<string, unknown> = {
      document: {
        documentElement: { dataset: {} },
        getElementById: (id: string) => element(id),
        addEventListener() {},
        querySelectorAll: () => [],
        activeElement: null,
      },
      localStorage: { getItem: () => null, setItem: () => {} },
      sessionStorage: { getItem: () => null, setItem: () => {} },
      fetch: (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { method: string; params: Record<string, unknown> };
        calls.push(body);
        return new Promise((resolve) => {
          pending.push({
            id: String(body.params.decisionId ?? body.params.objectId ?? ""),
            method: body.method,
            resolve,
          });
        });
      },
      setInterval: () => 1,
      CSS: { escape: (value: string) => value },
      console,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    const cut = APP_JS.lastIndexOf("async function boot()");
    vm.runInContext(APP_JS.slice(0, cut), sandbox, { filename: "app.js" });
    vm.runInContext('state.workspaceId = "ws_nav001_lab"; state.section = "decisions"; state.context = { proposedDecisions: [], acceptedDecisions: [], supersededDecisions: [] };', sandbox);

    const late = vm.runInContext('selectRecord("decision", "dec_closed")', sandbox) as Promise<unknown>;
    await viWait(pending, 1);
    const current = vm.runInContext('selectRecord("decision", "dec_open")', sandbox) as Promise<unknown>;
    await viWait(pending, 2);
    pending[0]?.resolve({
      json: async () => ({ ok: true, result: { id: "dec_closed", status: "accepted", createdAt: "t", rationale: "LATE_RATIONALE" } }),
    });
    await late;
    expect(vm.runInContext("state.detail.id", sandbox)).toBe("dec_open");
    expect(elements["source-view"]?.innerHTML ?? "").not.toContain("LATE_RATIONALE");
    pending[1]?.resolve({
      json: async () => ({ ok: true, result: { id: "dec_open", status: "accepted", createdAt: "t", rationale: "OPEN_RATIONALE" } }),
    });
    await current;
    expect(elements["source-view"]?.innerHTML).toContain("OPEN_RATIONALE");
    expect(elements["source-view"]?.innerHTML).not.toContain("LATE_RATIONALE");

    vm.runInContext(
      'state.detail = { id: "dec_nav001_review", kind: "decision", record: { id: "dec_nav001_review", status: "accepted", createdAt: "t", rationale: "kept" }, loading: false }; state.layer = "source";',
      sandbox,
    );
    const history = vm.runInContext("openRecordedChanges()", sandbox) as Promise<unknown>;
    await viWait(pending, 3);
    vm.runInContext('selectRecord("decision", "dec_other")', sandbox);
    pending.find((row) => row.method === "get_record_history")?.resolve({
      json: async () => ({
        ok: true,
        result: { items: [{ id: "con_late", action: "create", actor: { actorType: "human", actorId: "hum_nav001_ana" }, createdAt: "t" }], total: 1, returned: 1, truncated: false },
      }),
    });
    await history;
    expect(elements["history-list"]?.innerHTML ?? "").not.toContain("con_late");
    expect(vm.runInContext("state.history", sandbox)).toBeNull();
  });

  it("renders hostile record text as inert text", () => {
    const { sandbox } = loadNav(() => ({}));
    const hostile = "nav-001 \u001b[31mhostile\u001b[0m\u0007 title <img src=x onerror=alert(1)>";
    const html = vm.runInContext(
      `workRowHtml(${JSON.stringify({ id: "task_nav001_hostile", title: hostile, status: "open" })})`,
      sandbox,
    ) as string;
    expect(html).toContain("task_nav001_hostile");
    expect(html).toContain("hostile");
    expect(html).not.toContain("\u001b");
    expect(html).not.toContain("\u0007");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("onerror=alert(1)>");
    const injected = vm.runInContext(
      `workRowHtml(${JSON.stringify({ id: "task_quote", title: '"><button type="button" id="injected">', status: "open" })})`,
      sandbox,
    ) as string;
    expect(injected).not.toContain('id="injected"');
    expect(injected).toContain("&lt;button");
  });

  it("keeps a narrow Back control and does not clip record ids", () => {
    expect(INDEX_HTML).toContain('id="panel-back"');
    expect(INDEX_HTML).toContain(">Back<");
    expect(INDEX_HTML).toContain('id="sections"');
    expect(INDEX_HTML).toContain("Needs You");
    expect(INDEX_HTML).toContain("Recent changes");
    expect(INDEX_HTML).toContain("Workstream");
    expect(INDEX_HTML).toContain('id="since-title"');
    const narrow = APP_CSS.slice(APP_CSS.indexOf("@media (max-width: 719px)"));
    expect(narrow).toContain('#stage[data-layer="source"] #list-pane');
    expect(narrow).toContain('#stage[data-layer="history"] #list-pane');
    expect(narrow).toContain("overflow-wrap: anywhere");
    expect(narrow).toContain(".record-id");
    expect(APP_CSS).toContain("grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr)");
    expect(APP_CSS).toContain('#stage[data-section="attention"]');
    expect(APP_CSS).toContain('#stage[data-section="changes"]');
  });
});

async function viWait(
  pending: unknown[],
  count: number,
): Promise<void> {
  for (let attempt = 0; attempt < 20 && pending.length < count; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (pending.length < count) throw new Error(`expected ${count} pending reads, saw ${pending.length}`);
}
