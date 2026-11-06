import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  assertPublicationSnapshotConsistent,
  parsePublicationSnapshot,
} from "../../src/domain/publication.js";
import {
  Conflict,
  ParticipantRequired,
  SessionNotFound,
  Unauthorized,
  ValidationError,
} from "../../src/domain/errors.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { SESSION_LEASE_MS } from "../../src/domain/session-runtime.js";
import type { ActorRef } from "../../src/domain/types.js";
import { dispatchCampfireMethod } from "../../src/http/dispatch.js";
import { readWorkspaceSnapshot } from "../../src/publication/snapshot.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { projectAgentSessionPage } from "../../src/service/session-list.js";
import type { CampfireService } from "../../src/service/service.js";
import { applyMigrations, CURRENT_SCHEMA_VERSION } from "../../src/store/migrations.js";
import { openInMemoryStore, openSqliteStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";

const START = "2026-11-05T12:00:00.000Z";
const HUMAN: ActorRef = { actorId: "hum_1", actorType: "human" };
const OUTSIDER: ActorRef = { actorId: "hum_2", actorType: "human" };
const AGENT: ActorRef = { actorId: "agt_1", actorType: "agent" };
const OTHER: ActorRef = { actorId: "agt_2", actorType: "agent" };
const humanCtx: ActorContext = { actor: HUMAN };
const outsiderCtx: ActorContext = { actor: OUTSIDER };
const agentCtx: ActorContext = { actor: AGENT };
const otherCtx: ActorContext = { actor: OTHER };

function thrown(fn: () => unknown): { message: string; details?: Record<string, unknown> } {
  try {
    fn();
  } catch (error) {
    if (error instanceof ValidationError || error instanceof Conflict || error instanceof Unauthorized || error instanceof ParticipantRequired || error instanceof SessionNotFound) {
      return { message: error.message, details: error.details };
    }
    throw error;
  }
  throw new Error("expected a Campfire error");
}

describe("SES-001 session attachment and runtime reports", () => {
  const roots: string[] = [];
  const databases: Database.Database[] = [];
  let now = START;
  let store: CampfireStore;
  let service: CampfireService;
  let workspaceId = "";
  let otherWorkspaceId = "";
  let taskId = "";
  let foreignTaskId = "";

  afterEach(() => {
    service?.close();
    for (const db of databases.splice(0)) db.close();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function advance(ms: number): void {
    now = new Date(Date.parse(now) + ms).toISOString();
  }

  function arrange(existing?: CampfireStore): void {
    now = START;
    store = existing ?? openInMemoryStore();
    service = createCampfireService({
      store,
      idSource: createCounterIdSource(),
      clock: () => now,
    });
    store.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: START });
    store.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: START });
    store.createHuman({ id: HUMAN.actorId, teamId: "team_1", displayName: "Ada", createdAt: START });
    store.createHuman({ id: OUTSIDER.actorId, teamId: "team_1", displayName: "Grace", createdAt: START });
    store.createAgent({
      id: AGENT.actorId,
      teamId: "team_1",
      humanId: HUMAN.actorId,
      name: "Codex",
      harness: "codex",
      createdAt: START,
    });
    store.createAgent({
      id: OTHER.actorId,
      teamId: "team_1",
      humanId: OUTSIDER.actorId,
      name: "Other",
      harness: "codex",
      createdAt: START,
    });
    workspaceId = service.createWorkspace(humanCtx, { teamId: "team_1", name: "Billing" }).id;
    otherWorkspaceId = service.createWorkspace(humanCtx, { teamId: "team_1", name: "Other" }).id;
    service.inviteToWorkspace(humanCtx, { workspaceId, actor: AGENT, role: "agent" });
    service.joinWorkspace(agentCtx, { workspaceId });
    service.inviteToWorkspace(humanCtx, { workspaceId: otherWorkspaceId, actor: AGENT, role: "agent" });
    service.joinWorkspace(agentCtx, { workspaceId: otherWorkspaceId });
    service.inviteToWorkspace(humanCtx, { workspaceId, actor: OTHER, role: "agent" });
    service.joinWorkspace(otherCtx, { workspaceId });
    taskId = service.createTask(humanCtx, { workspaceId, title: "Attach the session" }).id;
    foreignTaskId = service.createTask(humanCtx, { workspaceId: otherWorkspaceId, title: "Elsewhere" }).id;
  }

  function register(attached = taskId) {
    return service.registerAgentSession(agentCtx, {
      agentId: AGENT.actorId,
      workspaceId,
      harness: "codex",
      taskId: attached,
    });
  }

  it("keeps an omitted taskId compatible and refuses a task from another workspace", () => {
    arrange();
    const open = service.registerAgentSession(agentCtx, {
      agentId: AGENT.actorId,
      workspaceId,
      harness: "codex",
    });
    expect(open.taskId).toBeUndefined();
    const missing = thrown(() => service.reportAgentSessionRuntime(agentCtx, {
      sessionId: open.id,
      state: "running",
      sequence: 1,
    }));
    expect(missing.message).toMatch(/attached to a task/);

    const crossed = thrown(() => register(foreignTaskId));
    expect(crossed.message).toBe("Task is not in this workspace");
    expect(JSON.stringify(crossed)).not.toContain(otherWorkspaceId);
    const absent = thrown(() => register("task_missing"));
    expect(absent.message).toBe("Task is not in this workspace");
  });

  it("rejects a harness that is not the registered agent", () => {
    arrange();
    const error = thrown(() => service.registerAgentSession(agentCtx, {
      agentId: AGENT.actorId,
      workspaceId,
      harness: "claude",
      taskId,
    }));
    expect(error.details?.field).toBe("harness");
    expect(service.listAgentSessions(humanCtx, { workspaceId }).sessions).toHaveLength(0);
  });

  it("accepts one fresh report, ignores an identical repeat, and refuses a rewrite or a burst", () => {
    arrange();
    const session = register();
    const before = service.getActivity(humanCtx, { workspaceId }).total;
    const taskBefore = store.getTask(taskId)?.status;
    const first = service.reportAgentSessionRuntime(agentCtx, {
      sessionId: session.id,
      state: "running",
      sequence: 1,
    });
    expect(first.expiresAt).toBe(new Date(Date.parse(now) + SESSION_LEASE_MS).toISOString());
    expect(first.origin).toBe("local_supervisor");
    expect(service.getActivity(humanCtx, { workspaceId }).total).toBe(before);
    expect(store.getTask(taskId)?.status).toBe(taskBefore);

    advance(1_000);
    expect(service.reportAgentSessionRuntime(agentCtx, {
      sessionId: session.id,
      state: "running",
      sequence: 1,
    })).toEqual(first);
    expect(service.getActivity(humanCtx, { workspaceId }).total).toBe(before);

    const rewrite = thrown(() => service.reportAgentSessionRuntime(agentCtx, {
      sessionId: session.id,
      state: "stopping",
      sequence: 1,
    }));
    expect(rewrite.details?.reason).toBe("conflict");

    const burst = thrown(() => service.reportAgentSessionRuntime(agentCtx, {
      sessionId: session.id,
      state: "stopping",
      sequence: 2,
    }));
    expect(burst.details?.field).toBe("sequence");

    advance(SESSION_LEASE_MS);
    const listed = service.listAgentSessions(humanCtx, { workspaceId });
    expect(listed.sessions[0]?.state).toBe("unknown");
    expect(listed.serverTime).toBe(now);

    const stopped = service.reportAgentSessionRuntime(agentCtx, {
      sessionId: session.id,
      state: "failed",
      sequence: 2,
      failureKind: "nonzero_exit",
      exitCode: 2,
    });
    expect(stopped.failureKind).toBe("exited_nonzero");
    expect(stopped.expiresAt).toBeUndefined();
    expect(store.getTask(taskId)?.status).toBe(taskBefore);
    expect(service.listAgentSessions(humanCtx, { workspaceId }).sessions[0]?.state).toBe("failed");
    const stale = thrown(() => service.reportAgentSessionRuntime(agentCtx, {
      sessionId: session.id,
      state: "running",
      sequence: 1,
    }));
    expect(stale.details?.reason).toBe("stale_sequence");
  });

  it("lets only the owning agent report and lists for a workspace reader without counting first", () => {
    arrange();
    const session = register();
    expect(thrown(() => service.reportAgentSessionRuntime(otherCtx, {
      sessionId: session.id,
      state: "running",
      sequence: 1,
    })).message).toMatch(/may not report/);
    expect(thrown(() => service.reportAgentSessionRuntime(agentCtx, {
      sessionId: "ses_missing",
      state: "running",
      sequence: 1,
    })).message).toMatch(/not found/i);

    let counted = false;
    const original = store.countSessionContributions.bind(store);
    store.countSessionContributions = (workspace, sessionId) => {
      counted = true;
      return original(workspace, sessionId);
    };
    expect(() => service.listAgentSessions(outsiderCtx, { workspaceId })).toThrow(ParticipantRequired);
    expect(counted).toBe(false);

    const page = service.listAgentSessions(humanCtx, { workspaceId, limit: 1 });
    expect(page.sessions[0]?.taskId).toBe(taskId);
    expect(JSON.stringify(page)).not.toMatch(/pid|argv|\/tmp|local_supervisor/);
  });

  it("bounds titles and pages by started time without treating an ended session as running", () => {
    arrange();
    const longTitle = "t".repeat(241);
    const longTask = service.createTask(humanCtx, { workspaceId, title: longTitle }).id;
    advance(1_000);
    const older = register();
    advance(1_000);
    const newer = service.registerAgentSession(agentCtx, {
      agentId: AGENT.actorId,
      workspaceId,
      harness: "codex",
      taskId: longTask,
    });
    service.endAgentSession(agentCtx, older.id);
    const rejected = thrown(() => service.reportAgentSessionRuntime(agentCtx, {
      sessionId: older.id,
      state: "running",
      sequence: 1,
    }));
    expect(rejected.details?.field).toBe("state");
    service.reportAgentSessionRuntime(agentCtx, {
      sessionId: older.id,
      state: "exited",
      sequence: 1,
      exitCode: 0,
    });

    const page = service.listAgentSessions(humanCtx, { workspaceId, limit: 1 });
    expect(page.returned).toBe(1);
    expect(page.truncated).toBe(true);
    expect(page.sessions.map((session) => session.id)).toEqual([older.id]);
    const next = service.listAgentSessions(humanCtx, { workspaceId, limit: 1, cursor: page.nextCursor });
    expect(next.sessions.map((session) => session.id)).toEqual([newer.id]);
    expect(next.sessions[0]?.taskTitle).toHaveLength(240);
    expect(next.sessions[0]?.state).toBe("unknown");
    expect(page.sessions[0]?.state).toBe("exited");
  });

  it("dispatches the report and the list without adding them to the delivery bridge", () => {
    arrange();
    const session = dispatchCampfireMethod(service, agentCtx, "register_agent_session", {
      workspaceId,
      harness: "codex",
      taskId,
    }) as { id: string; taskId?: string };
    expect(session.taskId).toBe(taskId);
    const report = dispatchCampfireMethod(service, agentCtx, "report_agent_session_runtime", {
      sessionId: session.id,
      state: "starting",
      sequence: 1,
    }) as { state: string };
    expect(report.state).toBe("starting");
    const page = dispatchCampfireMethod(service, humanCtx, "list_agent_sessions", {
      workspaceId,
    }) as { sessions: Array<{ id: string; state: string }> };
    expect(page.sessions[0]).toMatchObject({ id: session.id, state: "starting" });
  });

  it("projects a bounded page and never copies a private field", () => {
    const title = "n".repeat(300);
    const page = projectAgentSessionPage({
      workspaceId: "ws_1",
      now: START,
      sessions: [
        {
          id: "ses_1",
          agentId: "agt_1",
          humanId: "hum_1",
          workspaceId: "ws_1",
          taskId: "task_1",
          harness: "codex",
          startedAt: START,
        },
        {
          id: "ses_other",
          agentId: "agt_1",
          humanId: "hum_1",
          workspaceId: "ws_other",
          harness: "codex",
          startedAt: START,
        },
      ],
      tasks: new Map([["task_1", { title, status: "open" }]]),
      agents: new Map([["agt_1", { name: "Codex" }]]),
      humans: new Map([["hum_1", { displayName: "Ada" }]]),
      reports: new Map(),
      contributions: new Map([["ses_1", { count: 2, newestPosition: 4 }]]),
      limit: 25,
    });
    expect(page.sessions).toHaveLength(1);
    expect(page.sessions[0]?.taskTitle).toHaveLength(240);
    expect(page.sessions[0]?.state).toBe("unknown");
    expect(page.sessions[0]?.sharedContributionCount).toBe(2);
    expect(JSON.stringify(page)).not.toMatch(/pid|argv|cwd|prompt/);
  });

  it("upgrades a version-10 database with a guarded task column and runtime table", () => {
    const db = new Database(":memory:");
    databases.push(db);
    applyMigrations(db, () => START);
    expect(CURRENT_SCHEMA_VERSION).toBe(11);
    db.exec("ALTER TABLE agent_sessions DROP COLUMN task_id");
    db.exec("DROP TABLE agent_session_runtime_reports");
    db.prepare("DELETE FROM schema_migrations WHERE version = 11").run();
    applyMigrations(db, () => START);
    const columns = db.prepare("PRAGMA table_info(agent_sessions)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain("task_id");
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_session_runtime_reports'").get(),
    ).toEqual({ name: "agent_session_runtime_reports" });
    applyMigrations(db, () => START);
    expect(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 11").get()).toEqual({ count: 1 });
  });

  it("publishes the historical task attachment and leaves the runtime report behind", () => {
    const root = mkdtempSync(join(tmpdir(), "ses-001-publish-"));
    roots.push(root);
    const databasePath = join(root, "campfire.db");
    arrange(openSqliteStore(databasePath));
    const session = register();
    service.reportAgentSessionRuntime(agentCtx, {
      sessionId: session.id,
      state: "running",
      sequence: 1,
    });
    const snapshot = readWorkspaceSnapshot({
      databasePath,
      workspaceId,
      ownerHumanId: HUMAN.actorId,
      packageVersion: "1.28.1",
      exportedAt: now,
    });
    expect(snapshot.source.schemaVersion).toBe(11);
    expect(snapshot.sessions.find((row) => row.id === session.id)?.taskId).toBe(taskId);
    expect(JSON.stringify(snapshot)).not.toContain("local_supervisor");
    expect(parsePublicationSnapshot(snapshot).sessions.find((row) => row.id === session.id)?.taskId).toBe(taskId);

    const older = structuredClone(snapshot);
    older.source.schemaVersion = 10;
    const published = older.sessions.find((row) => row.id === session.id);
    if (published !== undefined) delete published.taskId;
    expect(parsePublicationSnapshot(older).source.schemaVersion).toBe(10);

    older.source.schemaVersion = 9;
    expect(() => parsePublicationSnapshot(older)).toThrow(/Unsupported local schema version 9/);

    const dangling = structuredClone(snapshot);
    const attached = dangling.sessions.find((row) => row.id === session.id);
    if (attached !== undefined) attached.taskId = "task_missing";
    expect(() => assertPublicationSnapshotConsistent(dangling)).toThrow(/Session task is missing/);
  });
});
