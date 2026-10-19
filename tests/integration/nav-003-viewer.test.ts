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

  it("omits the roster on initial load and poll and does not call the inspector or on-demand reads", async () => {
    expect(APP_JS).not.toMatch(/api\("get_workspace"/);
    expect(APP_JS).not.toMatch(/api\("list_tasks"/);
    expect(APP_JS).not.toMatch(/api\("list_workspace_participants"/);
    expect(APP_JS).not.toMatch(/api\("get_record_history"/);
    expect(APP_JS).not.toMatch(/api\("get_task"/);
    expect(APP_JS).not.toMatch(/api\("get_decision"/);
    expect(APP_JS).not.toMatch(/api\("get_finding"/);
    expect(APP_JS).not.toMatch(/api\("get_artifact"/);
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
