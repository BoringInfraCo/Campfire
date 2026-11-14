/**
 * FAC-001 slice 3. Local Viewer parity against the service read.
 * Not a human observation, not hosted D1, not a release.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixture, READ_CLOCKS } from "../../fixtures/attention/fac-001/seed.js";
import { dispatchCampfireMethod } from "../../src/http/dispatch.js";
import { ATTENTION_VIEW_STRINGS, FAC_ATTENTION_REASON_LABELS, renderAttentionLines } from "../../src/presentation/attention-view.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { startCampfireViewer, type RunningViewer } from "../../src/viewer/server.js";

const ANA: ActorContext = { actor: { actorId: "hum_fac001_ana", actorType: "human" } };
const APP_JS = readFileSync(new URL("../../src/viewer/static/app.js", import.meta.url), "utf8");

function loadApp() {
  const elements: Record<string, { innerHTML: string; textContent: string; hidden: boolean; disabled: boolean; value: string }> = {};
  const element = (id: string) => {
    elements[id] ??= {
      innerHTML: "",
      textContent: "",
      hidden: false,
      disabled: false,
      value: "",
      setAttribute() {},
      addEventListener() {},
      focus() {},
      getAttribute: () => null,
      removeAttribute() {},
    } as { innerHTML: string; textContent: string; hidden: boolean; disabled: boolean; value: string };
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
    sessionStorage: { getItem: () => null, setItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: async () => {
      throw new Error("no fetch");
    },
    setInterval: () => 0,
    CSS: { escape: (value: string) => value },
    console,
    elements,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const cut = APP_JS.lastIndexOf("async function boot()");
  const harness = `${APP_JS.slice(0, cut)}\nfunction testDetail(){ return state.detail; }\nfunction testBaseline(){ return state.attentionBaseline; }\nfunction testAttentionFailed(){ return state.attentionFailed; }\n`;
  vm.runInContext(harness, sandbox, { filename: "app.js" });
  return sandbox;
}

function renderHome(sandbox: Record<string, unknown>, homeState: Record<string, unknown>) {
  const make = () => ({ innerHTML: "", textContent: "", hidden: false });
  sandbox.fakeEls = {
    recordNotes: make(),
    alignment: make(),
    needsYou: make(),
    needsYouTitle: make(),
    needsAttention: make(),
    needsAttentionTitle: make(),
    currentWork: make(),
    sources: make(),
    since: make(),
    nextAction: make(),
  };
  sandbox.fakeState = {
    whoami: ANA,
    perspective: "mine",
    sinceView: null,
    rowFilter: "",
    sectionSelection: { attention: null },
    ...homeState,
  };
  vm.runInContext("renderOrientation(fakeEls, fakeState)", sandbox);
  return {
    you: vm.runInContext("fakeEls.needsYou.innerHTML", sandbox) as string,
    team: vm.runInContext("fakeEls.needsAttention.innerHTML", sandbox) as string,
    youTitle: vm.runInContext("fakeEls.needsYouTitle.textContent", sandbox) as string,
  };
}

describe("FAC-001 viewer surface", () => {
  let dir: string;
  let store: CampfireStore;
  let service: CampfireService;
  let viewer: RunningViewer;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "fac001-viewer-"));
    buildFixture(join(dir, "campfire.db"));
    store = openSqliteStore(join(dir, "campfire.db"));
    service = createCampfireService({ store, clock: () => READ_CLOCKS.T1_before_any_expiry });
    viewer = await startCampfireViewer({
      port: 0,
      host: "127.0.0.1",
      call: (method, params) => Promise.resolve(dispatchCampfireMethod(service, ANA, method, params ?? {})),
    });
  }, 120_000);

  afterAll(async () => {
    await viewer?.close();
    service?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("pins the browser strings to the Terminal renderer", () => {
    for (const [key, value] of Object.entries(FAC_ATTENTION_REASON_LABELS)) {
      expect(APP_JS).toContain(`${key}: ${JSON.stringify(value)}`);
    }
    for (const value of Object.values(ATTENTION_VIEW_STRINGS)) expect(APP_JS).toContain(value);
    expect(APP_JS).not.toContain("setItem(state.attentionBaseline");
    expect(APP_JS).toContain("limit: 100");
  });

  it("serves the same cue order as the local service for the trunc workspace", async () => {
    const direct = dispatchCampfireMethod(service, ANA, "get_workspace_attention", { workspaceId: "ws_fac001_trunc", limit: 100 });
    const response = await fetch(`${viewer.url}/api/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "get_workspace_attention", params: { workspaceId: "ws_fac001_trunc", limit: 100 } }),
    });
    const body = (await response.json()) as { ok: boolean; result: { cues: Array<{ id: string; audience: string; subjectId: string }> } };
    expect(body.ok).toBe(true);
    expect(body.result.cues.map((cue) => cue.id)).toEqual((direct as { cues: Array<{ id: string }> }).cues.map((cue) => cue.id));
    const rendered = renderHome(loadApp(), { context: { goal: null }, attention: body.result, attentionFailed: false });
    const youIds = body.result.cues.filter((cue) => cue.audience === "you").map((cue) => cue.subjectId);
    let at = 0;
    for (const id of youIds) {
      const next = rendered.you.indexOf(id, at);
      expect(next).toBeGreaterThanOrEqual(0);
      at = next + id.length;
    }
    expect(rendered.youTitle).toContain("100+ (more pages or incomplete coverage)");
    expect(rendered.you).toContain("More cues exist beyond this page.");
    expect(rendered.you).toContain("scanned 100 of 103");
    expect(rendered.you).not.toContain("No recorded attention cues match these rules");
    for (const line of renderAttentionLines(body.result as never)) {
      if (line.startsWith("[you]") || line.startsWith("  ")) continue;
      expect(rendered.you + rendered.team).toContain(line.trim().slice(0, 40));
    }
  });

  it("shows the older list alone when the attention read fails", () => {
    const rendered = renderHome(loadApp(), {
      context: { attention: { tasks: [], decisions: [] }, attentionCoverage: { completeUnderRules: true } },
      attention: null,
      attentionFailed: true,
      attentionFailureText: "Attention read failed. Showing the older list.",
    });
    expect(rendered.you).toContain("Attention read failed. Showing the older list.");
    expect(rendered.you).not.toContain("100+ (more pages or incomplete coverage)");
  });

  it("rejects a proposal write and accepts a proposal read", async () => {
    const denied = await fetch(`${viewer.url}/api/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "propose_action", params: {} }),
    });
    expect(denied.status).toBe(403);
    const trunc = dispatchCampfireMethod(service, ANA, "get_workspace_attention", { workspaceId: "ws_fac001_trunc", limit: 100 }) as {
      cues: Array<{ subjectType: string; subjectId: string }>;
    };
    const proposal = trunc.cues.find((cue) => cue.subjectType === "action_proposal");
    expect(proposal).toBeDefined();
    const read = await fetch(`${viewer.url}/api/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        method: "get_action_proposal",
        params: { workspaceId: "ws_fac001_trunc", proposalId: proposal!.subjectId },
      }),
    });
    const body = (await read.json()) as { ok: boolean; result: { proposal: { id: string } } };
    expect(body.ok).toBe(true);
    expect(body.result.proposal.id).toBe(proposal!.subjectId);
  });

  it("keeps the session baseline and strips a proposal drill-down", async () => {
    const sandbox = loadApp();
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    let attentionStep = 0;
    const attention = (step: number) => {
      const base = {
        workspaceId: "ws_lab",
        cues: [],
        coverage: { completeUnderRules: true, perSource: [] },
        orientationCursor: "cur-b",
        catchUp: { status: "not_requested", changedCount: 0, examined: 0, tipAdvanced: false, affectedIds: [], affectedTruncated: false },
      };
      if (step === 2) {
        return { ...base, catchUp: { status: "partial", toCursor: "cur-c", changedCount: 1, examined: 1, tipAdvanced: false, affectedIds: ["task_1"], affectedTruncated: false } };
      }
      if (step === 3) return { ...base, orientationCursor: "cur-other" };
      if (step === 4) return { ...base, workspaceId: "ws_other" };
      if (step === 5) return { ...base, orientationCursor: "cur-after-fail" };
      return base;
    };
    sandbox.fetch = async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { method: string; params: Record<string, unknown> };
      calls.push(body);
      if (body.method === "list_workspaces") return { json: async () => ({ ok: true, result: [{ id: "ws_lab", name: "lab" }] }) };
      if (body.method === "get_workspace_context") {
        return { json: async () => ({ ok: true, result: { goal: null, openTasks: [], currentWork: { inProgressTasks: [], blockedTasks: [], acceptedDecisions: [] } } }) };
      }
      if (body.method === "get_activity") return { json: async () => ({ ok: true, result: { items: [], total: 0, truncated: false } }) };
      if (body.method === "get_workspace_attention") {
        attentionStep += 1;
        return { json: async () => ({ ok: true, result: attention(attentionStep) }) };
      }
      if (body.method === "get_action_proposal") {
        return {
          json: async () => ({
            ok: true,
            result: {
              proposal: {
                id: body.params.proposalId,
                status: "proposed",
                uri: "file:///tmp/fac-secret",
                token: "sekrit-token",
                transcript: "secret transcript",
                uriOrPath: "/U\x73ers/secret/path",
              },
            },
          }),
        };
      }
      return { json: async () => ({ ok: true, result: {} }) };
    };
    const attentionParams = () => calls.filter((row) => row.method === "get_workspace_attention").map((row) => row.params);
    await vm.runInContext("refresh()", sandbox);
    expect(attentionParams()[0]).toEqual({ workspaceId: "ws_lab", limit: 100 });
    expect(vm.runInContext("testBaseline()", sandbox)).toBe("cur-b");
    await vm.runInContext("refresh()", sandbox);
    expect(attentionParams()[1]).toEqual({ workspaceId: "ws_lab", limit: 100, since: "cur-b" });
    expect(vm.runInContext("testBaseline()", sandbox)).toBe("cur-c");
    await vm.runInContext("refresh()", sandbox);
    expect(attentionParams()[2]).toEqual({ workspaceId: "ws_lab", limit: 100, since: "cur-c" });
    expect(vm.runInContext("testBaseline()", sandbox)).toBe("cur-c");
    await vm.runInContext("refresh()", sandbox);
    expect(vm.runInContext("testBaseline()", sandbox)).toBe(null);
    expect(vm.runInContext("testAttentionFailed()", sandbox)).toBe(true);
    await vm.runInContext("refresh()", sandbox);
    expect(attentionParams()[4]).toEqual({ workspaceId: "ws_lab", limit: 100 });
    expect(vm.runInContext("testBaseline()", sandbox)).toBe("cur-after-fail");

    await vm.runInContext('selectRecord("action_proposal", "pro_secret")', sandbox);
    const detail = vm.runInContext("testDetail()", sandbox) as { record: Record<string, unknown> };
    expect(detail.record).toEqual({ id: "pro_secret", status: "proposed", title: "Proposal awaiting review by an owner" });
    const heading = vm.runInContext('sourceHeadingHtml("action_proposal", { id: "pro_secret", status: "proposed", title: "secret title", uri: "file:///tmp/fac-secret", token: "sekrit-token" })', sandbox) as string;
    const html = vm.runInContext('sourceRecordHtml("action_proposal", { id: "pro_secret", status: "proposed", uri: "file:///tmp/fac-secret", token: "sekrit-token", transcript: "secret transcript", uriOrPath: "/U\x73ers/secret/path" })', sandbox) as string;
    expect(heading).toContain("Proposal awaiting review by an owner");
    expect(heading).not.toContain("sekrit-token");
    expect(heading).not.toContain("secret title");
    expect(html).toContain("proposed");
    expect(html).not.toContain("sekrit-token");
    expect(html).not.toContain("file:///tmp");
    expect(html).not.toContain("/Users/secret");
    expect(html).not.toContain("secret transcript");
    const stored = JSON.stringify(detail.record);
    expect(stored).not.toContain("sekrit-token");
    expect(stored).not.toContain("transcript");
  });
});
