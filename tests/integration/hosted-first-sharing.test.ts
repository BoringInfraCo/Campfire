import { createServer, type IncomingMessage } from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runCliEntry } from "../../src/cli/index.js";
import { HOSTED_PRODUCT_ORIGIN, hostedPublish } from "../../src/cli/hosted-workspace.js";
import { createRuntimeFromPath } from "../../src/runtime.js";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { activateLocalProfile, loadAnyProfile, loadCredentials, resolveProfilePaths } from "../../src/bootstrap/profile.js";
import { campfireHttpCall } from "../../src/http/client.js";
import { startCampfireHttpServer } from "../../src/http/server.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { hashToken } from "../../src/service/tokens.js";
import { createD1Store, migrateD1 } from "../../src/worker/d1-store.js";
import { createD1WorkerHandler } from "../../src/worker/handler.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";
import { SHR, isolatedProfileEnv, seedShrLocalWorkspace, writeShrLocalProfile } from "../helpers/shr-001.js";
import { readPublicationState } from "../../src/publication/state.js";

const NOW = "2026-10-23T15:00:00.000Z";
const REHEARSAL_CODE = `cfrh_${"c".repeat(48)}`;
const roots: string[] = [];
const servers: Array<{ close: () => Promise<void> }> = [];
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const server of servers.splice(0)) await server.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

function isolateEnv(root: string): void {
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(root, "config"), { recursive: true, mode: 0o700 });
  mkdirSync(join(root, "data"), { recursive: true });
  process.env.HOME = home;
  process.env.CAMPFIRE_CONFIG_DIR = join(root, "config");
  process.env.CAMPFIRE_DATA_DIR = join(root, "data");
  delete process.env.CAMPFIRE_URL;
  delete process.env.CAMPFIRE_TOKEN;
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_DATA_HOME;
}

function tempRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), label));
  roots.push(root);
  isolateEnv(root);
  return root;
}

function capture() {
  const output: string[] = [];
  const errors: string[] = [];
  vi.spyOn(console, "log").mockImplementation((value) => output.push(String(value)));
  vi.spyOn(console, "error").mockImplementation((value) => errors.push(String(value)));
  return { output, errors };
}

function authorizationOf(headers: unknown): string | undefined {
  if (headers === undefined || headers === null) return undefined;
  if (typeof Headers !== "undefined" && headers instanceof Headers) return headers.get("authorization") ?? undefined;
  if (Array.isArray(headers)) {
    const found = headers.find((entry) => Array.isArray(entry) && String(entry[0]).toLowerCase() === "authorization");
    return found === undefined ? undefined : String(found[1]);
  }
  if (typeof headers === "object") {
    const record = headers as Record<string, string>;
    return record.authorization ?? record.Authorization;
  }
  return undefined;
}

function trackFetch(options?: {
  rejectMethod?: string;
  reject?: (input: { method?: string; params: Record<string, unknown>; authorization?: string }) => boolean;
  onCall?: (input: { method?: string; params: Record<string, unknown>; authorization?: string }) => void;
}) {
  const urls: string[] = [];
  const methods: string[] = [];
  const enrolledAgents: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (...args) => {
    urls.push(String(args[0]));
    const init = args[1];
    let method: string | undefined;
    let params: Record<string, unknown> = {};
    if (init?.body !== undefined) {
      try {
        const parsed = JSON.parse(String(init.body)) as { method?: string; params?: Record<string, unknown> };
        method = parsed.method;
        params = parsed.params ?? {};
        if (method !== undefined) methods.push(method);
      } catch { /* not a Campfire call */ }
    }
    const call = { method, params, authorization: authorizationOf(init?.headers) };
    options?.onCall?.(call);
    if ((options?.rejectMethod !== undefined && method === options.rejectMethod) || options?.reject?.(call) === true) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Unauthorized",
        message: "The agent could not join the new workspace.",
      }), { status: 401, headers: { "content-type": "application/json" } });
    }
    const response = await originalFetch(...args);
    if (method === "enroll_owned_agent") {
      const body = await response.clone().json() as { result?: { agent?: { id?: string } } };
      if (typeof body.result?.agent?.id === "string") enrolledAgents.push(body.result.agent.id);
    }
    return response;
  });
  return { urls, methods, enrolledAgents };
}

it("refuses a hosted workspace without an admitted human credential", async () => {
  tempRoot("campfire-hosted-refuse-");
  const { urls, methods } = trackFetch();
  const { output, errors } = capture();
  expect(await runCliEntry(["create-workspace", "--hosted", "--name", "Shared"])).toBe(1);
  const text = errors.join("\n");
  expect(text).toContain("shared workspace is hosted");
  expect(text).toContain("operator admission is still required");
  expect(text).toContain("hosted_admission_required");
  expect(text).not.toMatch(/wrangler|D1|DNS/i);
  expect(output.join("\n")).not.toContain("ws_");
  expect(urls.join("\n")).not.toContain("boringinfra.company");
  expect(methods).not.toContain("create_workspace");
});

it("still creates a local workspace with --local", async () => {
  const root = tempRoot("campfire-local-create-");
  const db = join(root, "campfire.db");
  const runtime = createRuntimeFromPath(db);
  seedFixture(runtime.store);
  runtime.close();
  const { methods } = trackFetch();
  const { output } = capture();
  expect(await runCliEntry(["create-workspace", "--local", "--team", FIXTURE.teamId, "--name", "Local only", "--db", db])).toBe(0);
  const created = JSON.parse(output.at(-1) ?? "{}") as { id: string; name: string; teamId: string };
  expect(created.id).toMatch(/^ws_/);
  expect(created.name).toBe("Local only");
  expect(created.teamId).toBe(FIXTURE.teamId);
  expect(methods).not.toContain("create_workspace");
});

it("creates a hosted workspace on a loopback credential and preserves the previous profile", async () => {
  const root = tempRoot("campfire-hosted-create-");
  const runtime = createRuntimeFromPath(join(root, "hosted.db"));
  seedFixture(runtime.store);
  const server = await startCampfireHttpServer({ runtime, port: 0 });
  servers.push({ close: async () => { await server.close(); runtime.close(); } });
  const { persistRemoteProfile } = await import("../../src/bootstrap/remote-profile.js");
  persistRemoteProfile({
    url: server.url,
    humanId: FIXTURE.humans.sergio,
    humanName: "Sergio",
    workspaceId: FIXTURE.workspaces.billing,
    workspaceName: "Billing",
    humanToken: FIXTURE.tokens.sergio,
    agents: [{ id: FIXTURE.agents.codexSergio, name: "Codex", harness: "codex", token: FIXTURE.tokens.codexSergio }],
    allowLoopbackHttp: true,
  });
  const previous = resolveProfilePaths();
  const oldProfile = readFileSync(previous.configPath, "utf8");
  const oldCredentials = readFileSync(previous.credentialsPath, "utf8");
  let agentReadWhilePrevious = false;
  const { urls, methods } = trackFetch({
    onCall: ({ method, params, authorization }) => {
      if (method === "get_workspace" && params.workspaceId !== FIXTURE.workspaces.billing &&
          authorization === `Bearer ${FIXTURE.tokens.codexSergio}`) {
        agentReadWhilePrevious = loadAnyProfile()?.workspaceId === FIXTURE.workspaces.billing;
      }
    },
  });
  const { output, errors } = capture();
  expect(await runCliEntry([
    "create-workspace", "--hosted", "--name", "Shared next",
    "--url", server.url, "--token", FIXTURE.tokens.sergio, "--allow-loopback",
  ])).toBe(0);
  expect(errors.join("\n")).not.toContain(FIXTURE.tokens.sergio);
  expect(errors.join("\n")).not.toContain(FIXTURE.tokens.codexSergio);
  const text = output.join("\n");
  expect(text).toContain(`Structured work for this shared workspace will be stored at ${server.url}.`);
  const created = JSON.parse(output.at(-1) ?? "{}") as { id: string; name: string; teamId: string };
  expect(created.name).toBe("Shared next");
  expect(created.teamId).toBe(FIXTURE.teamId);
  expect(created.id).not.toBe(FIXTURE.workspaces.billing);
  expect(agentReadWhilePrevious).toBe(true);
  expect(readFileSync(previous.configPath, "utf8")).toBe(oldProfile);
  expect(readFileSync(previous.credentialsPath, "utf8")).toBe(oldCredentials);
  expect(loadAnyProfile()?.workspaceId).toBe(created.id);
  const activeAgent = loadCredentials()?.agents?.codex;
  expect(activeAgent).toBe(FIXTURE.tokens.codexSergio);
  const agentView = await campfireHttpCall<{
    workspace: { id: string };
    participants: Array<{ actor: { actorId: string; actorType: string }; role: string }>;
  }>({
    baseUrl: server.url,
    token: activeAgent ?? "",
    method: "get_workspace",
    params: { workspaceId: created.id },
  });
  expect(agentView.workspace.id).toBe(created.id);
  expect(agentView.participants.some((participant) =>
    participant.actor.actorId === FIXTURE.agents.codexSergio && participant.actor.actorType === "agent" && participant.role === "agent",
  )).toBe(true);
  const selectedId = JSON.parse(readFileSync(join(process.env.CAMPFIRE_CONFIG_DIR ?? "", "active-profile.json"), "utf8")) as { active: string };
  activateLocalProfile(process.env, "default");
  expect(loadAnyProfile()?.workspaceId).toBe(FIXTURE.workspaces.billing);
  const previousHuman = await campfireHttpCall<{ workspace: { id: string } }>({
    baseUrl: server.url,
    token: FIXTURE.tokens.sergio,
    method: "get_workspace",
    params: { workspaceId: FIXTURE.workspaces.billing },
  });
  const previousAgent = await campfireHttpCall<{ workspace: { id: string } }>({
    baseUrl: server.url,
    token: FIXTURE.tokens.codexSergio,
    method: "get_workspace",
    params: { workspaceId: FIXTURE.workspaces.billing },
  });
  expect(previousHuman.workspace.id).toBe(FIXTURE.workspaces.billing);
  expect(previousAgent.workspace.id).toBe(FIXTURE.workspaces.billing);
  activateLocalProfile(process.env, selectedId.active);
  expect(loadAnyProfile()?.workspaceId).toBe(created.id);
  expect(urls.every((url) => url.startsWith(server.url))).toBe(true);
  expect(urls.join("\n")).not.toContain("boringinfra.company");
  expect(methods).toContain("create_workspace");
  expect(methods).toContain("invite_workspace");
  expect(methods).toContain("join_workspace");
  methods.length = 0;
  expect(await runCliEntry([
    "create-workspace", "--hosted", "--name", "Wrong team", "--team", "team_other",
    "--url", server.url, "--token", FIXTURE.tokens.sergio, "--allow-loopback",
  ])).toBe(1);
  expect(methods).not.toContain("create_workspace");
});

it("does not publish or issue when a local invite is not confirmed", async () => {
  tempRoot("campfire-host-unconfirmed-");
  const publish = vi.spyOn(hostedPublish, "run");
  const { urls, methods } = trackFetch();
  const { output, errors } = capture();
  expect(await runCliEntry(["invite-teammate", "ws_local", "--json"])).toBe(1);
  const text = errors.join("\n");
  expect(text).toContain("move structured records");
  expect(text).toContain("not move private chat transcripts");
  expect(text).toContain("recoverable backup");
  expect(text).toContain("freeze local writes");
  expect(text).toContain("confirm_host_workspace");
  expect(output.join("\n")).not.toContain("Private invitation link");
  expect(publish).not.toHaveBeenCalled();
  expect(methods).not.toContain("issue_enrollment_invitation");
  expect(urls.join("\n")).not.toContain("boringinfra.company");
});

it("does not issue when confirmed publication is not cut over", async () => {
  const root = tempRoot("campfire-host-unverified-");
  const env = isolatedProfileEnv(join(root, "mac"));
  const db = join(root, "mac", "campfire.db");
  seedShrLocalWorkspace(db);
  writeShrLocalProfile(env, db);
  process.env.CAMPFIRE_CONFIG_DIR = env.CAMPFIRE_CONFIG_DIR;
  process.env.CAMPFIRE_DATA_DIR = env.CAMPFIRE_DATA_DIR;
  process.env.HOME = env.HOME;
  vi.spyOn(hostedPublish, "run").mockResolvedValue({ receipt: { state: "verified" } as never, warnings: [] });
  const { methods } = trackFetch();
  const { output, errors } = capture();
  expect(await runCliEntry([
    "invite-teammate", SHR.workspaceId, "--confirm-host", "--no-connect",
    "--url", "http://127.0.0.1:9", "--allow-loopback", "--json",
  ])).toBe(1);
  expect(errors.join("\n")).toContain("no invitation was issued");
  expect(output.join("\n")).not.toContain("Private invitation link");
  expect(methods).not.toContain("issue_enrollment_invitation");
});

it("publishes a confirmed local workspace to loopback and then issues one invitation", async () => {
  const root = tempRoot("campfire-host-confirm-");
  const env = isolatedProfileEnv(join(root, "mac"));
  const db = join(root, "mac", "campfire.db");
  seedShrLocalWorkspace(db);
  writeShrLocalProfile(env, db);
  process.env.CAMPFIRE_CONFIG_DIR = env.CAMPFIRE_CONFIG_DIR;
  process.env.CAMPFIRE_DATA_DIR = env.CAMPFIRE_DATA_DIR;
  process.env.HOME = env.HOME;
  const endpoint = await hosted();
  const { urls } = trackFetch();
  const { output } = capture();
  expect(await runCliEntry([
    "invite-teammate", SHR.workspaceId, "--confirm-host", "--no-connect",
    "--url", endpoint, "--allow-loopback", "--rehearsal-code", REHEARSAL_CODE, "--json",
  ])).toBe(0);
  const text = output.join("\n");
  expect(text).toContain(`Structured work for this shared workspace will be stored at ${endpoint}.`);
  // A confirmed non-interactive run must print the full move disclosure before uploading.
  expect(text).toContain("move structured records");
  expect(text).toContain("not move private chat transcripts");
  expect(text).toContain("recoverable backup");
  expect(text).toContain("freeze local writes");
  const receipt = JSON.parse(output.at(-1) ?? "{}") as { link: string; workspaceId: string };
  expect(receipt.workspaceId).toBe(SHR.workspaceId);
  expect(receipt.link.startsWith(`${endpoint}/`)).toBe(true);
  expect(text).not.toContain(SHR.humanToken);
  expect(text).not.toContain(SHR.agentToken);
  expect(text).not.toContain("cfr_");
  expect(readPublicationState()?.receipt.state).toBe("cut_over");
  expect(urls.every((url) => url.startsWith(endpoint))).toBe(true);
  expect(urls.join("\n")).not.toContain("boringinfra.company");
});

it("enrolls one agent when the admitted profile has no agent credential", async () => {
  const root = tempRoot("campfire-hosted-enroll-");
  const runtime = createRuntimeFromPath(join(root, "hosted.db"));
  seedFixture(runtime.store);
  const server = await startCampfireHttpServer({ runtime, port: 0 });
  servers.push({ close: async () => { await server.close(); runtime.close(); } });
  const configDir = process.env.CAMPFIRE_CONFIG_DIR ?? "";
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(configDir, "config.json"), `${JSON.stringify({
    version: 2,
    mode: "remote",
    url: server.url,
    humanId: FIXTURE.humans.sergio,
    humanName: "Sergio",
    workspaceId: FIXTURE.workspaces.billing,
    workspaceName: "Billing",
    agents: [{ id: "agt_uncredentialed", name: "Codex", harness: "codex" }],
  }, null, 2)}\n`);
  writeFileSync(join(configDir, "credentials.json"), `${JSON.stringify({
    endpoint: server.url,
    humanId: FIXTURE.humans.sergio,
    workspaceId: FIXTURE.workspaces.billing,
    humanToken: FIXTURE.tokens.sergio,
    agentIds: {},
    agents: {},
  }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(join(configDir, "credentials.json"), 0o600);
  const previous = resolveProfilePaths();
  const oldProfile = readFileSync(previous.configPath, "utf8");
  let agentReadWhilePrevious = false;
  const { urls, methods, enrolledAgents } = trackFetch({
    onCall: ({ method, params, authorization }) => {
      if (method === "get_workspace" && params.workspaceId !== FIXTURE.workspaces.billing &&
          authorization !== `Bearer ${FIXTURE.tokens.sergio}`) {
        agentReadWhilePrevious = loadAnyProfile()?.workspaceId === FIXTURE.workspaces.billing;
      }
    },
  });
  const { output, errors } = capture();
  expect(await runCliEntry([
    "create-workspace", "--hosted", "--name", "Enrolled next",
    "--allow-loopback",
  ])).toBe(0);
  expect(errors.join("\n")).not.toContain(FIXTURE.tokens.sergio);
  const created = JSON.parse(output.at(-1) ?? "{}") as { id: string };
  expect(agentReadWhilePrevious).toBe(true);
  expect(readFileSync(previous.configPath, "utf8")).toBe(oldProfile);
  expect(loadAnyProfile()?.workspaceId).toBe(created.id);
  const enrolledId = enrolledAgents[0];
  expect(loadAnyProfile()?.agents?.[0]?.id).toBe(enrolledId);
  expect(methods).toContain("enroll_owned_agent");
  expect(methods).not.toContain("invite_workspace");
  const agentToken = loadCredentials()?.agents?.codex ?? "";
  expect(agentToken).not.toBe(FIXTURE.tokens.sergio);
  const agentView = await campfireHttpCall<{
    workspace: { id: string };
    participants: Array<{ actor: { actorId: string; actorType: string } }>;
  }>({
    baseUrl: server.url,
    token: agentToken,
    method: "get_workspace",
    params: { workspaceId: created.id },
  });
  expect(agentView.workspace.id).toBe(created.id);
  expect(agentView.participants.some((participant) =>
    participant.actor.actorId === enrolledId && participant.actor.actorType === "agent",
  )).toBe(true);
  activateLocalProfile(process.env, "default");
  expect(loadAnyProfile()?.workspaceId).toBe(FIXTURE.workspaces.billing);
  const previousHuman = await campfireHttpCall<{ workspace: { id: string } }>({
    baseUrl: server.url,
    token: FIXTURE.tokens.sergio,
    method: "get_workspace",
    params: { workspaceId: FIXTURE.workspaces.billing },
  });
  expect(previousHuman.workspace.id).toBe(FIXTURE.workspaces.billing);
  expect(urls.every((url) => url.startsWith(server.url))).toBe(true);
  expect(urls.join("\n")).not.toContain("boringinfra.company");
  expect(existsSync(join(configDir, `pending-hosted-agent-ein_${created.id}.json`))).toBe(false);
});

it("leaves the previous profile active when agent access fails after create", async () => {
  const root = tempRoot("campfire-hosted-access-fail-");
  const runtime = createRuntimeFromPath(join(root, "hosted.db"));
  seedFixture(runtime.store);
  const server = await startCampfireHttpServer({ runtime, port: 0 });
  servers.push({ close: async () => { await server.close(); runtime.close(); } });
  const { persistRemoteProfile } = await import("../../src/bootstrap/remote-profile.js");
  persistRemoteProfile({
    url: server.url,
    humanId: FIXTURE.humans.sergio,
    humanName: "Sergio",
    workspaceId: FIXTURE.workspaces.billing,
    workspaceName: "Billing",
    humanToken: FIXTURE.tokens.sergio,
    agents: [{ id: FIXTURE.agents.codexSergio, name: "Codex", harness: "codex", token: FIXTURE.tokens.codexSergio }],
    allowLoopbackHttp: true,
  });
  const previous = resolveProfilePaths();
  const oldProfile = readFileSync(previous.configPath, "utf8");
  const { methods } = trackFetch({ rejectMethod: "join_workspace" });
  const { output, errors } = capture();
  expect(await runCliEntry([
    "create-workspace", "--hosted", "--name", "Unreadable",
    "--allow-loopback",
  ])).toBe(1);
  const text = errors.join("\n");
  expect(text).toContain("may already exist");
  expect(text).toContain("active profile was not changed");
  expect(text).not.toContain(FIXTURE.tokens.sergio);
  expect(text).not.toContain(FIXTURE.tokens.codexSergio);
  expect(output.join("\n")).not.toContain("\"id\":");
  expect(loadAnyProfile()?.workspaceId).toBe(FIXTURE.workspaces.billing);
  expect(readFileSync(previous.configPath, "utf8")).toBe(oldProfile);
  expect(existsSync(join(process.env.CAMPFIRE_CONFIG_DIR ?? "", "profiles"))).toBe(false);
  expect(methods).toContain("create_workspace");
  expect(methods).toContain("join_workspace");
});

it("refuses a url and token when no remote profile is active", async () => {
  tempRoot("campfire-hosted-no-profile-");
  const { urls, methods } = trackFetch();
  const { errors } = capture();
  expect(await runCliEntry([
    "create-workspace", "--hosted", "--name", "Shared",
    "--url", HOSTED_PRODUCT_ORIGIN, "--token", `cft_${"e".repeat(32)}`,
  ])).toBe(1);
  const text = errors.join("\n");
  expect(text).toContain("operator admission is still required");
  expect(text).toContain("hosted_admission_required");
  expect(methods).not.toContain("create_workspace");
  expect(methods).not.toContain("whoami");
  expect(urls.join("\n")).not.toContain("boringinfra.company");
});

it("refuses to retarget a loopback profile before creating a workspace", async () => {
  tempRoot("campfire-hosted-retarget-");
  const { persistRemoteProfile } = await import("../../src/bootstrap/remote-profile.js");
  persistRemoteProfile({
    url: "http://127.0.0.1:9",
    humanId: "hum_sergio",
    humanName: "Sergio",
    workspaceId: "ws_loop",
    workspaceName: "Loop",
    humanToken: `cft_${"a".repeat(32)}`,
    agents: [{ id: "agt_codex", name: "Codex", harness: "codex", token: `cft_${"b".repeat(32)}` }],
    allowLoopbackHttp: true,
  });
  const { urls, methods } = trackFetch();
  const { errors } = capture();
  expect(await runCliEntry([
    "create-workspace", "--hosted", "--name", "Elsewhere",
    "--url", "https://example.com/campfire", "--token", `cft_${"d".repeat(32)}`, "--allow-loopback",
  ])).toBe(1);
  expect(errors.join("\n")).toContain("cannot be replaced");
  expect(loadAnyProfile()?.workspaceId).toBe("ws_loop");
  expect(methods).not.toContain("create_workspace");
  expect(methods).not.toContain("whoami");
  expect(urls.join("\n")).not.toContain("example.com");
  expect(urls.join("\n")).not.toContain("boringinfra.company");
});

it("names campfire profiles use and does not switch to another saved product profile", async () => {
  const root = tempRoot("campfire-hosted-saved-profile-");
  const configDir = process.env.CAMPFIRE_CONFIG_DIR ?? "";
  writeFileSync(join(configDir, "config.json"), `${JSON.stringify({
    version: 1,
    databasePath: join(root, "local.db"),
    url: "http://127.0.0.1:9",
    humanId: "hum_local",
    humanName: "Local",
    workspaceId: "ws_local",
  }, null, 2)}\n`);
  const savedDir = join(configDir, "profiles", "join-ein_savedproduct");
  mkdirSync(savedDir, { recursive: true, mode: 0o700 });
  chmodSync(join(configDir, "profiles"), 0o700);
  chmodSync(savedDir, 0o700);
  writeFileSync(join(savedDir, "config.json"), `${JSON.stringify({
    version: 2,
    mode: "remote",
    url: HOSTED_PRODUCT_ORIGIN,
    humanId: "hum_saved",
    humanName: "Saved",
    workspaceId: "ws_saved",
    workspaceName: "Saved",
    agents: [{ id: "agt_saved", name: "Codex", harness: "codex" }],
  }, null, 2)}\n`);
  const before = readFileSync(join(configDir, "config.json"), "utf8");
  const { urls, methods } = trackFetch();
  const { errors } = capture();
  expect(await runCliEntry([
    "create-workspace", "--hosted", "--name", "Shared",
    "--url", HOSTED_PRODUCT_ORIGIN, "--token", `cft_${"e".repeat(32)}`,
  ])).toBe(1);
  const text = errors.join("\n");
  expect(text).toContain("campfire profiles use");
  expect(text).toContain("operator admission is still required");
  expect(existsSync(join(configDir, "active-profile.json"))).toBe(false);
  expect(loadAnyProfile()?.workspaceId).toBe("ws_local");
  expect(readFileSync(join(configDir, "config.json"), "utf8")).toBe(before);
  expect(methods).not.toContain("create_workspace");
  expect(methods).not.toContain("whoami");
  expect(urls.join("\n")).not.toContain("boringinfra.company");
});

function createdWorkspaceId(text: string): string {
  const match = text.match(/Hosted workspace (ws_[A-Za-z0-9_-]+) was created/);
  expect(match?.[1]).toBeTruthy();
  return match![1]!;
}

it("resumes an existing agent after the new workspace read fails", async () => {
  const root = tempRoot("campfire-hosted-resume-agent-");
  const runtime = createRuntimeFromPath(join(root, "hosted.db"));
  seedFixture(runtime.store);
  const server = await startCampfireHttpServer({ runtime, port: 0 });
  servers.push({ close: async () => { await server.close(); runtime.close(); } });
  const { persistRemoteProfile } = await import("../../src/bootstrap/remote-profile.js");
  persistRemoteProfile({
    url: server.url,
    humanId: FIXTURE.humans.sergio,
    humanName: "Sergio",
    workspaceId: FIXTURE.workspaces.billing,
    workspaceName: "Billing",
    humanToken: FIXTURE.tokens.sergio,
    agents: [{ id: FIXTURE.agents.codexSergio, name: "Codex", harness: "codex", token: FIXTURE.tokens.codexSergio }],
    allowLoopbackHttp: true,
  });
  const previous = resolveProfilePaths();
  const oldProfile = readFileSync(previous.configPath, "utf8");
  const oldCredentials = readFileSync(previous.credentialsPath, "utf8");
  let blockAgentRead = true;
  let resumeStarted = false;
  let resumeLogStart = 0;
  let storageBeforeAgent = false;
  const { output, errors } = capture();
  const { urls, methods } = trackFetch({
    onCall: ({ method }) => {
      if (!resumeStarted) return;
      if (method === "invite_workspace" || method === "join_workspace" || method === "enroll_owned_agent") {
        storageBeforeAgent = output.slice(resumeLogStart).some((line) => line.includes("Structured work for this shared workspace will be stored at"));
      }
    },
    reject: ({ method, params, authorization }) => blockAgentRead && method === "get_workspace" &&
      authorization === `Bearer ${FIXTURE.tokens.codexSergio}` && params.workspaceId !== FIXTURE.workspaces.billing,
  });
  expect(await runCliEntry(["create-workspace", "--hosted", "--name", "Unreadable", "--allow-loopback"])).toBe(1);
  const failure = errors.join("\n");
  const createdId = createdWorkspaceId(failure);
  expect(failure).toContain(`create-workspace --hosted --resume ${createdId}`);
  expect(failure).not.toContain("create-workspace --hosted --name");
  expect(failure).not.toMatch(/create another workspace/i);
  expect(loadAnyProfile()?.workspaceId).toBe(FIXTURE.workspaces.billing);
  expect(readFileSync(previous.configPath, "utf8")).toBe(oldProfile);
  expect(methods.filter((method) => method === "create_workspace")).toHaveLength(1);
  blockAgentRead = false;
  const logged = output.length;
  resumeLogStart = output.length;
  resumeStarted = true;
  expect(await runCliEntry([
    "create-workspace", "--hosted", "--resume", createdId, "--name", "Renamed", "--allow-loopback",
  ])).toBe(0);
  expect(output.slice(logged).join("\n")).toContain(`Structured work for this shared workspace will be stored at ${server.url}.`);
  expect(storageBeforeAgent).toBe(true);
  expect(methods.filter((method) => method === "create_workspace")).toHaveLength(1);
  expect(methods).not.toContain("enroll_owned_agent");
  expect(methods).not.toContain("update_workspace");
  expect(methods).not.toContain("create_human");
  expect(methods).not.toContain("create_team");
  const resumed = JSON.parse(output.at(-1) ?? "{}") as { id: string; name: string };
  expect(resumed.id).toBe(createdId);
  expect(resumed.name).toBe("Unreadable");
  expect(loadAnyProfile()?.workspaceId).toBe(createdId);
  expect(loadCredentials()?.agents?.codex).toBe(FIXTURE.tokens.codexSergio);
  expect(readFileSync(previous.configPath, "utf8")).toBe(oldProfile);
  expect(readFileSync(previous.credentialsPath, "utf8")).toBe(oldCredentials);
  const previousRecord = JSON.parse(oldCredentials) as { humanToken: string; agents: { codex: string }; workspaceId: string };
  expect(previousRecord.workspaceId).toBe(FIXTURE.workspaces.billing);
  expect(previousRecord.humanToken).toBe(FIXTURE.tokens.sergio);
  expect(previousRecord.agents.codex).toBe(FIXTURE.tokens.codexSergio);
  const agentView = await campfireHttpCall<{ workspace: { id: string } }>({
    baseUrl: server.url,
    token: FIXTURE.tokens.codexSergio,
    method: "get_workspace",
    params: { workspaceId: createdId },
  });
  expect(agentView.workspace.id).toBe(createdId);
  const profileDir = join(process.env.CAMPFIRE_CONFIG_DIR ?? "", "profiles");
  expect(readdirSync(profileDir)).toHaveLength(1);
  const createsBeforeSecond = methods.filter((method) => method === "create_workspace").length;
  const enrollsBeforeSecond = methods.filter((method) => method === "enroll_owned_agent").length;
  expect(await runCliEntry([
    "create-workspace", "--hosted", "--resume", createdId, "--allow-loopback",
  ])).toBe(0);
  expect(methods.filter((method) => method === "create_workspace")).toHaveLength(createsBeforeSecond);
  expect(methods.filter((method) => method === "enroll_owned_agent")).toHaveLength(enrollsBeforeSecond);
  expect(loadAnyProfile()?.workspaceId).toBe(createdId);
  expect(readdirSync(profileDir)).toHaveLength(1);
  expect(existsSync(join(profileDir, readdirSync(profileDir)[0] ?? "", "profiles"))).toBe(false);
  expect(readFileSync(previous.configPath, "utf8")).toBe(oldProfile);
  expect(urls.every((url) => url.startsWith(server.url))).toBe(true);
  expect(urls.join("\n")).not.toContain("boringinfra.company");
});

it("reuses the pending agent enrollment when resume follows a failed enroll read", async () => {
  const root = tempRoot("campfire-hosted-resume-enroll-");
  const runtime = createRuntimeFromPath(join(root, "hosted.db"));
  seedFixture(runtime.store);
  const server = await startCampfireHttpServer({ runtime, port: 0 });
  servers.push({ close: async () => { await server.close(); runtime.close(); } });
  const configDir = process.env.CAMPFIRE_CONFIG_DIR ?? "";
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(configDir, "config.json"), `${JSON.stringify({
    version: 2,
    mode: "remote",
    url: server.url,
    humanId: FIXTURE.humans.sergio,
    humanName: "Sergio",
    workspaceId: FIXTURE.workspaces.billing,
    workspaceName: "Billing",
    agents: [{ id: "agt_uncredentialed", name: "Codex", harness: "codex" }],
  }, null, 2)}\n`);
  writeFileSync(join(configDir, "credentials.json"), `${JSON.stringify({
    endpoint: server.url,
    humanId: FIXTURE.humans.sergio,
    workspaceId: FIXTURE.workspaces.billing,
    humanToken: FIXTURE.tokens.sergio,
    agentIds: {},
    agents: {},
  }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(join(configDir, "credentials.json"), 0o600);
  const previous = resolveProfilePaths();
  const oldProfile = readFileSync(previous.configPath, "utf8");
  const oldCredentials = readFileSync(previous.credentialsPath, "utf8");
  let blockAgentRead = true;
  const enrolls: Array<{ requestId: string; tokenHash: string }> = [];
  const { methods } = trackFetch({
    onCall: ({ method, params }) => {
      if (method === "enroll_owned_agent") {
        enrolls.push({ requestId: String(params.requestId), tokenHash: String(params.tokenHash) });
      }
    },
    reject: ({ method, authorization }) => blockAgentRead && method === "get_workspace" &&
      authorization !== `Bearer ${FIXTURE.tokens.sergio}`,
  });
  const { output, errors } = capture();
  expect(await runCliEntry(["create-workspace", "--hosted", "--name", "Pending", "--allow-loopback"])).toBe(1);
  const createdId = createdWorkspaceId(errors.join("\n"));
  const pendingPath = join(configDir, `pending-hosted-agent-ein_${createdId}.json`);
  expect(existsSync(pendingPath)).toBe(true);
  const pending = JSON.parse(readFileSync(pendingPath, "utf8")) as { requestId: string; tokenHash: string };
  expect(loadAnyProfile()?.workspaceId).toBe(FIXTURE.workspaces.billing);
  expect(methods.filter((method) => method === "create_workspace")).toHaveLength(1);
  blockAgentRead = false;
  expect(await runCliEntry(["create-workspace", "--hosted", "--resume", createdId, "--allow-loopback"])).toBe(0);
  expect(enrolls.map((row) => row.requestId)).toEqual([pending.requestId, pending.requestId]);
  expect(enrolls.map((row) => row.tokenHash)).toEqual([pending.tokenHash, pending.tokenHash]);
  expect(methods.filter((method) => method === "create_workspace")).toHaveLength(1);
  expect(existsSync(pendingPath)).toBe(false);
  expect(loadAnyProfile()?.workspaceId).toBe(createdId);
  const created = JSON.parse(output.at(-1) ?? "{}") as { id: string };
  expect(created.id).toBe(createdId);
  const agentToken = loadCredentials()?.agents?.codex ?? "";
  expect(agentToken).not.toBe(FIXTURE.tokens.sergio);
  const agentView = await campfireHttpCall<{ workspace: { id: string } }>({
    baseUrl: server.url,
    token: agentToken,
    method: "get_workspace",
    params: { workspaceId: createdId },
  });
  expect(agentView.workspace.id).toBe(createdId);
  expect(readFileSync(previous.configPath, "utf8")).toBe(oldProfile);
  expect(readFileSync(previous.credentialsPath, "utf8")).toBe(oldCredentials);
  const previousHuman = await campfireHttpCall<{ workspace: { id: string } }>({
    baseUrl: server.url,
    token: FIXTURE.tokens.sergio,
    method: "get_workspace",
    params: { workspaceId: FIXTURE.workspaces.billing },
  });
  expect(previousHuman.workspace.id).toBe(FIXTURE.workspaces.billing);
});

it("refuses resume of an unknown workspace or a different team without writing", async () => {
  const root = tempRoot("campfire-hosted-resume-refuse-");
  const runtime = createRuntimeFromPath(join(root, "hosted.db"));
  seedFixture(runtime.store);
  const now = "2026-10-23T15:00:00.000Z";
  runtime.store.createTeam({
    id: "team_other",
    organizationId: FIXTURE.organizationId,
    name: "Other",
    createdAt: now,
  });
  runtime.store.createWorkspace({
    id: "ws_other_team",
    teamId: "team_other",
    name: "Other",
    status: "active",
    createdBy: { actorId: FIXTURE.humans.sergio, actorType: "human" },
    createdAt: now,
    updatedAt: now,
  });
  runtime.store.addParticipant({
    workspaceId: "ws_other_team",
    actor: { actorId: FIXTURE.humans.sergio, actorType: "human" },
    role: "owner",
    joinedAt: now,
  });
  const server = await startCampfireHttpServer({ runtime, port: 0 });
  servers.push({ close: async () => { await server.close(); runtime.close(); } });
  const { persistRemoteProfile } = await import("../../src/bootstrap/remote-profile.js");
  persistRemoteProfile({
    url: server.url,
    humanId: FIXTURE.humans.sergio,
    humanName: "Sergio",
    workspaceId: FIXTURE.workspaces.billing,
    workspaceName: "Billing",
    humanToken: FIXTURE.tokens.sergio,
    agents: [{ id: FIXTURE.agents.codexSergio, name: "Codex", harness: "codex", token: FIXTURE.tokens.codexSergio }],
    allowLoopbackHttp: true,
  });
  const previous = resolveProfilePaths();
  const oldProfile = readFileSync(previous.configPath, "utf8");
  const oldCredentials = readFileSync(previous.credentialsPath, "utf8");
  const { methods } = trackFetch();
  const { errors } = capture();
  expect(await runCliEntry(["create-workspace", "--hosted", "--resume", "ws_missing", "--allow-loopback"])).toBe(1);
  expect(await runCliEntry(["create-workspace", "--hosted", "--resume", "ws_other_team", "--allow-loopback"])).toBe(1);
  const text = errors.join("\n");
  expect(text).toContain("cannot be resumed");
  expect(text).not.toContain("create-workspace --hosted --resume");
  expect(loadAnyProfile()?.workspaceId).toBe(FIXTURE.workspaces.billing);
  expect(readFileSync(previous.configPath, "utf8")).toBe(oldProfile);
  expect(readFileSync(previous.credentialsPath, "utf8")).toBe(oldCredentials);
  expect(existsSync(join(process.env.CAMPFIRE_CONFIG_DIR ?? "", "profiles"))).toBe(false);
  for (const method of ["create_workspace", "invite_workspace", "join_workspace", "enroll_owned_agent", "update_workspace", "list_workspaces"]) {
    expect(methods).not.toContain(method);
  }
});

it("refuses resume when no admitted remote profile is active", async () => {
  const root = tempRoot("campfire-hosted-resume-no-profile-");
  const { urls, methods } = trackFetch();
  const { errors } = capture();
  expect(await runCliEntry([
    "create-workspace", "--hosted", "--resume", "ws_missing",
    "--url", HOSTED_PRODUCT_ORIGIN, "--token", `cft_${"e".repeat(32)}`,
  ])).toBe(1);
  const text = errors.join("\n");
  expect(text).toContain("operator admission is still required");
  expect(text).toContain("hosted_admission_required");
  expect(text).toContain("create-workspace --hosted --name");
  expect(text).not.toContain("--resume");
  expect(methods).toEqual([]);
  expect(existsSync(join(root, "config", "config.json"))).toBe(false);
  expect(existsSync(join(root, "data", "campfire.db"))).toBe(false);
  expect(urls.join("\n")).not.toContain("boringinfra.company");
});

it("refuses --resume without a workspace id before any write", async () => {
  const root = tempRoot("campfire-hosted-resume-missing-");
  const { methods } = trackFetch();
  const { errors } = capture();
  expect(await runCliEntry(["create-workspace", "--hosted", "--resume"])).toBe(1);
  expect(await runCliEntry(["create-workspace", "--resume", "--local", "--team", FIXTURE.teamId, "--name", "Local"])).toBe(1);
  expect(await runCliEntry(["create-workspace", "--resume", "ws_missing", "--local-only", "--team", FIXTURE.teamId, "--name", "Local"])).toBe(1);
  const text = errors.join("\n");
  expect(text).toContain("No workspace was created");
  expect(methods).toEqual([]);
  expect(existsSync(join(root, "config", "config.json"))).toBe(false);
  expect(existsSync(join(root, "data", "campfire.db"))).toBe(false);
  expect(existsSync(join(root, "config", "profiles"))).toBe(false);
});

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function hosted(): Promise<string> {
  const adapter = sqliteD1();
  const ids = createCounterIdSource();
  await migrateD1(adapter.binding);
  const store = createD1Store(adapter.binding);
  const handle = createD1WorkerHandler({
    store,
    clock: () => NOW,
    idSource: ids,
    publication: { db: adapter.binding, enabled: true, clock: () => NOW, idSource: ids, rehearsalCodeHash: hashToken(REHEARSAL_CODE) },
  });
  const server = createServer((req, res) => {
    void (async () => {
      const request = new Request(`http://127.0.0.1${req.url ?? "/"}`, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        ...(req.method === "GET" ? {} : { body: await body(req) }),
      });
      const response = await handle(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(new Uint8Array(await response.arrayBuffer())));
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("not bound");
  const url = `http://127.0.0.1:${address.port}`;
  servers.push({
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      adapter.database.close();
    },
  });
  return url;
}
