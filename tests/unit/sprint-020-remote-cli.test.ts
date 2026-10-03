import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { persistRemoteProfile } from "../../src/bootstrap/remote-profile.js";
import { runCliEntry } from "../../src/cli/index.js";
import * as localWorkspace from "../../src/bootstrap/local-workspace.js";
import * as viewerServer from "../../src/viewer/server.js";

vi.mock("../../src/viewer/server.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/viewer/server.js")>(),
  startCampfireViewer: vi.fn(async () => ({ url: "http://127.0.0.1:9499", host: "127.0.0.1", port: 9499, close: vi.fn(async () => {}) })),
}));

let dir: string;
let output: string[];
let errors: string[];
let calls: Array<{ token: string; method: string }>;
let previous: NodeJS.ProcessEnv;
const profile = {
  url: "https://shared.example.test/team-a", humanId: "hum_alice", humanName: "Alice",
  workspaceId: "ws_existing", workspaceName: "Old receipt name", humanToken: "human-secret-sentinel",
  agents: [
    { id: "agt_alice_codex", name: "Alice Codex", harness: "codex", token: "codex-secret-sentinel" },
    { id: "agt_alice_opencode", name: "Alice OpenCode", harness: "opencode", token: "opencode-secret-sentinel" },
  ],
};
const workspace = { id: profile.workspaceId, name: "Live workspace name", status: "active" };
const view = {
  workspace, goal: { title: "Live goal" },
  participants: [
    { actor: { actorId: "hum_sergio", actorType: "human" }, name: "Sergio", role: "owner" },
    { actor: { actorId: "agt_sergio_codex", actorType: "agent" }, name: "Owner Codex", harness: "codex", humanOwnerId: "hum_sergio", role: "agent" },
    { actor: { actorId: profile.humanId, actorType: "human" }, name: "Alice", role: "member" },
    { actor: { actorId: profile.agents[0]!.id, actorType: "agent" }, name: "Alice Codex", harness: "codex", humanOwnerId: profile.humanId, role: "agent" },
  ],
};
beforeEach(() => {
  previous = { ...process.env };
  dir = mkdtempSync(join(tmpdir(), "campfire-s020-remote-cli-"));
  process.env.CAMPFIRE_CONFIG_DIR = join(dir, "config");
  process.env.CAMPFIRE_DATA_DIR = join(dir, "data");
  for (const key of ["CAMPFIRE_DB", "CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_SESSION_ID", "CAMPFIRE_HARNESS"]) delete process.env[key];
  persistRemoteProfile(profile);
  output = []; errors = []; calls = [];
  vi.spyOn(console, "log").mockImplementation((...args) => { output.push(args.map(String).join(" ")); });
  vi.spyOn(console, "error").mockImplementation((...args) => { errors.push(args.map(String).join(" ")); });
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const headers = new Headers(init?.headers);
    const token = (headers.get("authorization") ?? "").replace(/^Bearer /, "");
    const { method } = JSON.parse(String(init?.body)) as { method: string };
    calls.push({ token, method });
    let result: unknown;
    if (method === "whoami") result = { actor: { actorType: token === profile.humanToken ? "human" : "agent", actorId: token === profile.humanToken ? profile.humanId : token === profile.agents[0]!.token ? profile.agents[0]!.id : profile.agents[1]!.id } };
    else if (method === "list_workspaces") result = [{ ...workspace, goalTitle: "Live goal" }];
    else if (method === "get_workspace" || method === "get_workspace_context") result = view;
    else if (method === "get_activity") result = { items: [{ action: "register_session", objectId: "session-codex", payload: { harness: "codex" } }] };
    else if (method === "preflight") result = { ready: true };
    else throw new Error(`Unexpected mutation ${method}`);
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  }));
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  process.env = previous;
  rmSync(dir, { recursive: true, force: true });
});

describe("Sprint 020 remote recipient CLI", () => {
  it("connects each requested harness with only its own credential and no local database", async () => {
    const path = join(dir, "opencode.json");
    expect(await runCliEntry(["connect", "--harness", "opencode", "--config", path, "--json"])).toBe(0);
    const contents = readFileSync(path, "utf8");
    expect(contents).toContain(profile.agents[1]!.token);
    expect(contents).not.toContain(profile.humanToken);
    expect(contents).not.toContain(profile.agents[0]!.token);
    expect(output.join("\n") + errors.join("\n")).not.toContain("secret-sentinel");
    expect(existsSync(join(dir, "data"))).toBe(false);
    expect(calls).toEqual([]);
  });
  it("rejects a different API base path before network calls or harness writes", async () => {
    const path = join(dir, "opencode.json");
    expect(await runCliEntry(["connect", "--harness", "opencode", "--config", path, "--url", "https://shared.example.test/team-b", "--json"])).toBe(1);
    expect(existsSync(path)).toBe(false);
    expect(calls).toEqual([]);
    expect(errors.join("\n")).not.toContain("secret-sentinel");
  });
  it("never writes an explicitly supplied human credential into a harness", async () => {
    const path = join(dir, "opencode.json");
    expect(await runCliEntry(["connect", "--harness", "opencode", "--config", path, "--token", profile.humanToken, "--json"])).toBe(1);
    expect(existsSync(path)).toBe(false);
    expect(errors.join("\n")).not.toContain(profile.humanToken);
    expect(calls.map((call) => call.method)).toEqual(["whoami"]);
  });
  it("doctor selects the recipient's exact harness and workspace without environment plumbing", async () => {
    expect(await runCliEntry(["doctor", "--harness", "codex", "--session", "session-codex", "--json"])).toBe(0);
    expect(JSON.parse(output.at(-1)!)).toMatchObject({ ready: true, mode: "hosted" });
    expect(calls.every((call) => call.token === profile.agents[0]!.token)).toBe(true);
    expect(calls.every((call) => !call.method.includes("register"))).toBe(true);
    expect(existsSync(join(dir, "data"))).toBe(false);
  });
  it("handoff names the recipient rather than the first owner or first same-harness participant", async () => {
    expect(await runCliEntry(["handoff", "--harness", "codex", "--session", "session-codex", "--viewer-url", "http://127.0.0.1:9499", "--json"])).toBe(0);
    const receipt = JSON.parse(output.at(-1)!);
    expect(receipt).toMatchObject({ humanName: "Alice", agentName: "Alice Codex", workspaceName: "Live workspace name", goalTitle: "Live goal" });
    expect(JSON.stringify(receipt)).not.toContain("session-codex");
    expect(JSON.stringify(receipt)).not.toContain("secret-sentinel");
  });
  it("bare campfire recognizes its remote profile without creating local state", async () => {
    expect(await runCliEntry(["--json"])).toBe(0);
    expect(JSON.parse(output.at(-1)!)).toMatchObject({ mode: "remote", humanId: profile.humanId, workspaceId: profile.workspaceId });
    expect(existsSync(join(dir, "data"))).toBe(false);
    expect(calls).toEqual([]);
  });
  it("remote up starts only a read-only loopback proxy and never a shared SQLite listener", async () => {
    const local = vi.spyOn(localWorkspace, "startLocalWorkspace");
    const execution = runCliEntry(["up", "--no-connect", "--no-open", "--viewer-port", "0", "--json"]);
    await vi.waitFor(() => expect(output.length).toBe(1));
    process.emit("SIGTERM");
    expect(await execution).toBe(0);
    expect(local).not.toHaveBeenCalled();
    expect(existsSync(join(dir, "data"))).toBe(false);
    const receipt = JSON.parse(output[0]!);
    expect(receipt).toMatchObject({ mode: "remote", sessionRegistered: false, viewerUrl: "http://127.0.0.1:9499", apiUrl: profile.url });
    const options = vi.mocked(viewerServer.startCampfireViewer).mock.calls.at(-1)![0];
    expect(options.host).toBe("127.0.0.1");
    expect(options.allowRemote).toBeUndefined();
    await options.call("get_workspace", { workspaceId: profile.workspaceId });
    expect(calls.every((call) => call.token === profile.humanToken)).toBe(true);
    expect(output.join("\n") + errors.join("\n")).not.toContain("secret-sentinel");
  });
  it("remote up reconnects the enrolled agent without forwarding the human environment credential", async () => {
    const path = join(dir, "opencode.json");
    process.env.CAMPFIRE_TOKEN = profile.humanToken;
    const execution = runCliEntry(["up", "--harness", "opencode", "--config", path, "--no-open", "--json"]);
    await vi.waitFor(() => expect(output.length).toBe(1));
    process.emit("SIGTERM");
    expect(await execution).toBe(0);
    const contents = readFileSync(path, "utf8");
    expect(contents).toContain(profile.agents[1]!.token);
    expect(contents).not.toContain(profile.humanToken);
    expect(contents).not.toContain(profile.agents[0]!.token);
    expect(JSON.parse(output[0]!)).toMatchObject({ mode: "remote", agents: ["opencode"], reloadRequired: true, sessionRegistered: false });
    expect(calls.map((call) => call.method)).toEqual(["whoami", "list_workspaces"]);
  });
});
