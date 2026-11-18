/**
 * SES-001 A2 owner-shared session watch: the same scenarios on the sync SQLite
 * service and on the async service over D1 (SQLite-backed), so the share record,
 * authority and projection stay aligned.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { CampfireError } from "../../src/domain/errors.js";
import type { ActorRef } from "../../src/domain/types.js";
import { dispatchCampfireMethod } from "../../src/http/dispatch.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import { createAsyncCampfireService, type AsyncCampfireService } from "../../src/worker/async-service.js";
import { dispatchCampfireMethodAsync } from "../../src/worker/async-dispatch.js";
import { createD1Store, migrateD1 } from "../../src/worker/d1-store.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";

const START = "2026-11-17T12:00:00.000Z";
const OWNER: ActorRef = { actorId: "hum_owner", actorType: "human" };
const MEMBER: ActorRef = { actorId: "hum_member", actorType: "human" };
const OTHER_OWNER: ActorRef = { actorId: "hum_other", actorType: "human" };
const STRANGER: ActorRef = { actorId: "hum_stranger", actorType: "human" };
const AGENT: ActorRef = { actorId: "agt_owner", actorType: "agent" };
const ctx = (actor: ActorRef, agentSessionId?: string): ActorContext => (agentSessionId === undefined ? { actor } : { actor, agentSessionId });

// Anything that would mean a terminal, launch, or local-machine fact leaked.
const FORBIDDEN = /terminal|argv|environment|"env"|\bpid\b|"path"|\bcwd\b|prompt|transcript|worktree|repositoryRoot|locator/i;

interface Env {
  service: AsyncCampfireService;
  call(c: ActorContext, method: string, params?: Record<string, unknown>): Promise<any>;
  advance(ms: number): void;
  workspaceId: string;
  otherWorkspaceId: string;
  taskId: string;
  sessionId: string;
  close(): void;
}

type Kind = "sync" | "d1";

function promisify<T extends object>(target: T): AsyncCampfireService {
  return new Proxy(target, {
    get(t, property, receiver) {
      const value = Reflect.get(t, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => (value as (...a: unknown[]) => unknown).apply(t, args);
    },
  }) as unknown as AsyncCampfireService;
}

async function build(kind: Kind): Promise<Env> {
  let now = START;
  const clock = () => now;
  const ids = createCounterIdSource();
  let service: AsyncCampfireService;
  let seed: any;
  let call: Env["call"];
  let close = () => {};
  if (kind === "sync") {
    const store = openInMemoryStore();
    const sync = createCampfireService({ store, idSource: ids, clock });
    service = promisify(sync);
    seed = store;
    call = async (c, method, params = {}) => dispatchCampfireMethod(sync, c, method, params);
    close = () => sync.close();
  } else {
    const adapter = sqliteD1();
    await migrateD1(adapter.binding);
    const store = createD1Store(adapter.binding);
    service = createAsyncCampfireService({ store, idSource: ids, clock });
    seed = store;
    call = (c, method, params = {}) => dispatchCampfireMethodAsync(service, c, method, params);
    close = () => adapter.database.close();
  }
  await seed.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: START });
  await seed.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: START });
  for (const [actor, name] of [[OWNER, "Ada"], [MEMBER, "Grace"], [OTHER_OWNER, "Linus"], [STRANGER, "Eve"]] as const) {
    await seed.createHuman({ id: actor.actorId, teamId: "team_1", displayName: name, createdAt: START });
  }
  await seed.createAgent({ id: AGENT.actorId, teamId: "team_1", humanId: OWNER.actorId, name: "Codex", harness: "codex", createdAt: START });
  await seed.createAgent({ id: "agt_viewer_owned", teamId: "team_1", humanId: OTHER_OWNER.actorId, name: "Viewer agent", harness: "codex", createdAt: START });
  const workspaceId = (await service.createWorkspace(ctx(OWNER), { teamId: "team_1", name: "Billing" })).id;
  const otherWorkspaceId = (await service.createWorkspace(ctx(OWNER), { teamId: "team_1", name: "Elsewhere" })).id;
  await service.inviteToWorkspace(ctx(OWNER), { workspaceId, actor: MEMBER, role: "member" });
  await service.joinWorkspace(ctx(MEMBER), { workspaceId });
  await service.inviteToWorkspace(ctx(OWNER), { workspaceId, actor: OTHER_OWNER, role: "viewer" });
  await service.joinWorkspace(ctx(OTHER_OWNER), { workspaceId });
  await service.inviteToWorkspace(ctx(OWNER), { workspaceId, actor: AGENT, role: "agent" });
  await service.joinWorkspace(ctx(AGENT), { workspaceId });
  const taskId = (await service.createTask(ctx(OWNER), { workspaceId, title: "Fix the invoice rounding" })).id;
  const session = await service.registerAgentSession(ctx(AGENT), { agentId: AGENT.actorId, workspaceId, harness: "codex", taskId });
  return {
    service,
    call,
    advance(ms) { now = new Date(Date.parse(now) + ms).toISOString(); },
    workspaceId,
    otherWorkspaceId,
    taskId,
    sessionId: session.id,
    close,
  };
}

async function failure(promise: Promise<unknown>): Promise<CampfireError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CampfireError) return error;
    throw error;
  }
  throw new Error("expected a Campfire error");
}

function errorBody(error: CampfireError): string {
  return JSON.stringify({ name: error.name, code: error.code, message: error.message, details: error.details });
}

describe.each<Kind>(["sync", "d1"])("SES-001 A2 owner-shared session watch (%s)", (kind) => {
  const open: Env[] = [];
  afterEach(() => { for (const env of open.splice(0)) env.close(); });
  async function arrange(): Promise<Env> {
    const env = await build(kind);
    open.push(env);
    return env;
  }
  const watch = (env: Env, actor: ActorRef, params: Record<string, unknown> = {}) =>
    env.call(ctx(actor), "get_agent_session_watch", { workspaceId: env.workspaceId, sessionId: env.sessionId, ...params });
  const share = (env: Env, actor: ActorRef = OWNER) =>
    env.call(ctx(actor), "share_agent_session", { workspaceId: env.workspaceId, sessionId: env.sessionId });
  const unshare = (env: Env, actor: ActorRef = OWNER) =>
    env.call(ctx(actor), "unshare_agent_session", { workspaceId: env.workspaceId, sessionId: env.sessionId });
  const agentWork = (env: Env, summary: string) =>
    env.service.addFinding(ctx(AGENT, env.sessionId), { workspaceId: env.workspaceId, summary });
  const report = (env: Env, state: string, sequence: number) =>
    env.service.reportAgentSessionRuntime(ctx(AGENT, env.sessionId), { sessionId: env.sessionId, state, sequence });

  it("shares idempotently, lists the marker, re-shares with a fresh sharedAt", async () => {
    const env = await arrange();
    const first = await share(env);
    expect(first).toEqual({ sessionId: env.sessionId, shared: true, sharedAt: START });
    env.advance(60_000);
    expect(await share(env)).toEqual(first);
    const listed = await env.call(ctx(MEMBER), "list_agent_sessions", { workspaceId: env.workspaceId });
    expect(listed.sessions[0].shared).toBe(true);

    env.advance(1_000);
    expect(await unshare(env)).toEqual({ sessionId: env.sessionId, shared: false });
    expect(await unshare(env)).toEqual({ sessionId: env.sessionId, shared: false });
    const after = await env.call(ctx(MEMBER), "list_agent_sessions", { workspaceId: env.workspaceId });
    expect(after.sessions[0].shared).toBe(false);

    env.advance(1_000);
    const again = await share(env);
    expect(again.sharedAt).toBe(new Date(Date.parse(START) + 62_000).toISOString());
    expect(again.sharedAt).not.toBe(first.sharedAt);
  });

  it("lets only the owning human share: agents and every other human (member, viewer, stranger) are refused", async () => {
    const env = await arrange();
    expect((await failure(share(env, AGENT))).name).toBe("Unauthorized");
    expect((await failure(env.call(ctx(AGENT, env.sessionId), "share_agent_session", { workspaceId: env.workspaceId, sessionId: env.sessionId }))).name).toBe("Unauthorized");
    expect((await failure(share(env, MEMBER))).name).toBe("Unauthorized");
    expect((await failure(share(env, OTHER_OWNER))).name).toBe("Unauthorized");
    expect((await failure(unshare(env, MEMBER))).name).toBe("Unauthorized");
    expect((await failure(share(env, STRANGER))).name).toBe("ParticipantRequired");
    const listed = await env.call(ctx(OWNER), "list_agent_sessions", { workspaceId: env.workspaceId });
    expect(listed.sessions[0].shared).toBe(false);
  });

  it("pins current behavior: a viewer-role human who owns a session can share and unshare it (owner-only rule, role not consulted)", async () => {
    const env = await arrange();
    const viewerAgent: ActorRef = { actorId: "agt_viewer_owned", actorType: "agent" };
    await env.service.inviteToWorkspace(ctx(OWNER), { workspaceId: env.workspaceId, actor: viewerAgent, role: "agent" });
    await env.service.joinWorkspace(ctx(viewerAgent), { workspaceId: env.workspaceId });
    const session = await env.service.registerAgentSession(ctx(viewerAgent), { agentId: viewerAgent.actorId, workspaceId: env.workspaceId, harness: "codex" });
    const asViewer = (method: string) => env.call(ctx(OTHER_OWNER), method, { workspaceId: env.workspaceId, sessionId: session.id });
    expect(await asViewer("share_agent_session")).toMatchObject({ sessionId: session.id, shared: true });
    expect(await asViewer("unshare_agent_session")).toEqual({ sessionId: session.id, shared: false });
    // Not the owner of the other session, so still refused.
    expect((await failure(share(env, OTHER_OWNER))).name).toBe("Unauthorized");
  });

  it("answers not-found for an unknown session or one named under another workspace", async () => {
    const env = await arrange();
    expect((await failure(env.call(ctx(OWNER), "share_agent_session", { workspaceId: env.workspaceId, sessionId: "ses_missing" }))).name).toBe("SessionNotFound");
    expect((await failure(env.call(ctx(OWNER), "share_agent_session", { workspaceId: env.otherWorkspaceId, sessionId: env.sessionId }))).name).toBe("SessionNotFound");
  });

  it("lets the owner read an unshared session, and gives everyone else the not-found shape", async () => {
    const env = await arrange();
    await agentWork(env, "Private until shared");
    const own = await watch(env, OWNER);
    expect(own.session.shared).toBe(false);
    expect(own.activity.items.length).toBeGreaterThan(0);

    const real = await failure(watch(env, MEMBER));
    const ghost = await failure(watch(env, MEMBER, { sessionId: "ses_ghost" }));
    expect(real.name).toBe("SessionNotFound");
    expect(errorBody(real).replaceAll(env.sessionId, "X")).toBe(errorBody(ghost).replaceAll("ses_ghost", "X"));
    expect(errorBody(real)).not.toMatch(/invoice|Fix the|Private until|count/i);
    // The workspace named must also match the session's own workspace.
    expect((await failure(env.call(ctx(OWNER), "get_agent_session_watch", { workspaceId: env.otherWorkspaceId, sessionId: env.sessionId }))).name).toBe("SessionNotFound");
    // The owner's agent is not the owning human.
    expect((await failure(env.call(ctx(AGENT), "get_agent_session_watch", { workspaceId: env.workspaceId, sessionId: env.sessionId }))).name).toBe("SessionNotFound");
  });

  it("refuses a non-member and a revoked unshare on the next read", async () => {
    const env = await arrange();
    await share(env);
    expect((await failure(watch(env, STRANGER))).name).toBe("ParticipantRequired");
    expect((await watch(env, MEMBER)).session.shared).toBe(true);
    await unshare(env);
    expect((await failure(watch(env, MEMBER))).name).toBe("SessionNotFound");
    await share(env);
    expect((await watch(env, MEMBER)).session.shared).toBe(true);
  });

  it("returns the watch shape with recorded work oldest first, bounded and cursored", async () => {
    const env = await arrange();
    await share(env);
    await agentWork(env, "First");
    await agentWork(env, "Second");
    await agentWork(env, "Third");
    // Work by someone else in the workspace is not attributed to the session.
    await env.service.addFinding(ctx(OWNER), { workspaceId: env.workspaceId, summary: "Human note" });

    const page1 = await watch(env, MEMBER, { limit: 2 });
    expect(page1.serverTime).toBe(START);
    expect(page1.session).toMatchObject({
      id: env.sessionId,
      shared: true,
      human: { id: OWNER.actorId, name: "Ada" },
      agent: { id: AGENT.actorId, name: "Codex" },
      task: { id: env.taskId, title: "Fix the invoice rounding" },
      startedAt: START,
      watchState: "disconnected",
      runtime: { state: "unknown" },
    });
    expect(page1.session.endedAt).toBeUndefined();
    expect(Object.keys(page1).sort()).toEqual(["activity", "serverTime", "session"]);
    const items1 = page1.activity.items as Array<{ position: number; type: string; summary: string; createdAt: string }>;
    expect(items1).toHaveLength(2);
    expect(items1[0]!.position).toBeLessThan(items1[1]!.position);
    expect(page1.activity.nextCursor).toBe(items1[1]!.position);
    const page2 = await watch(env, MEMBER, { after: page1.activity.nextCursor, limit: 50 });
    const summaries = [...items1, ...page2.activity.items].map((item) => item.summary);
    expect(summaries.filter((s) => ["First", "Second", "Third"].includes(s))).toEqual(["First", "Second", "Third"]);
    expect(summaries).not.toContain("Human note");
    expect(page2.activity.nextCursor).toBeNull();
    const positions = [...items1, ...page2.activity.items].map((item) => item.position);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(new Set(positions).size).toBe(positions.length);
    expect((await failure(watch(env, MEMBER, { after: -1 }))).name).toBe("ValidationError");
  });

  it("derives the watch state from server time through the lease, recovery and end", async () => {
    const env = await arrange();
    await share(env);
    expect((await watch(env, MEMBER)).session.watchState).toBe("disconnected");

    await report(env, "running", 1);
    let view = await watch(env, MEMBER);
    expect(view.session.watchState).toBe("live");
    expect(view.session.runtime).toEqual({ state: "running", reportedAt: START, expiresAt: new Date(Date.parse(START) + 180_000).toISOString() });

    env.advance(179_999);
    expect((await watch(env, MEMBER)).session.watchState).toBe("live");
    env.advance(1);
    view = await watch(env, MEMBER);
    expect(view.session.watchState).toBe("disconnected");
    expect(view.session.runtime.state).toBe("unknown");

    await report(env, "running", 2);
    expect((await watch(env, MEMBER)).session.watchState).toBe("live");

    env.advance(10_000);
    await agentWork(env, "Final note");
    await env.service.endAgentSession(ctx(AGENT), env.sessionId);
    view = await watch(env, MEMBER);
    expect(view.session.watchState).toBe("ended");
    expect(view.session.endedAt).toBeDefined();
    // Ended stays readable while shared, with the final recorded work.
    expect(view.activity.items.map((item: { summary: string }) => item.summary)).toEqual(["Final note"]);
  });

  it("carries no terminal, launch or local-machine field in any watch response or error", async () => {
    const env = await arrange();
    await agentWork(env, "Rounded the cents");
    await report(env, "running", 1);
    await share(env);
    const bodies: string[] = [];
    for (const actor of [OWNER, MEMBER, OTHER_OWNER]) bodies.push(JSON.stringify(await watch(env, actor)));
    bodies.push(JSON.stringify(await env.call(ctx(MEMBER), "list_agent_sessions", { workspaceId: env.workspaceId })));
    bodies.push(JSON.stringify(await share(env)), JSON.stringify(await unshare(env)));
    for (const actor of [STRANGER, MEMBER, AGENT]) bodies.push(errorBody(await failure(watch(env, actor, { sessionId: "ses_ghost" }))));
    bodies.push(errorBody(await failure(share(env, MEMBER))), errorBody(await failure(share(env, STRANGER))));
    for (const body of bodies) expect(body).not.toMatch(FORBIDDEN);
  });

  it("adds shared to each list row without changing its other fields", async () => {
    const env = await arrange();
    const before = await env.call(ctx(MEMBER), "list_agent_sessions", { workspaceId: env.workspaceId });
    await share(env);
    const after = await env.call(ctx(MEMBER), "list_agent_sessions", { workspaceId: env.workspaceId });
    const { shared: a, ...rowBefore } = before.sessions[0];
    const { shared: b, ...rowAfter } = after.sessions[0];
    expect([a, b]).toEqual([false, true]);
    expect(rowAfter).toEqual(rowBefore);
  });
});
