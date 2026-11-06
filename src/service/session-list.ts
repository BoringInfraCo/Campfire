/**
 * Workspace-scoped projection of agent sessions.
 *
 * The page is derived at read time. It never includes a PID, path, argv,
 * environment, prompt, or terminal byte.
 */
import {
  SESSION_LIST_DEFAULT_LIMIT,
  SESSION_LIST_MAX_LIMIT,
  SESSION_TITLE_MAX,
  deriveSessionRuntimeState,
  type AgentSessionRuntimeReport,
} from "../domain/session-runtime.js";
import type { AgentSession, TaskStatus } from "../domain/types.js";
import type { AgentSessionListPage, ListedAgentSession } from "./service.js";

export interface SessionListFacts {
  workspaceId: string;
  now: string;
  sessions: AgentSession[];
  tasks: ReadonlyMap<string, { title: string; status: TaskStatus }>;
  agents: ReadonlyMap<string, { name: string }>;
  humans: ReadonlyMap<string, { displayName: string }>;
  reports: ReadonlyMap<string, AgentSessionRuntimeReport>;
  contributions: ReadonlyMap<string, { count: number; newestPosition: number | null }>;
  cursor?: string;
  limit?: number;
}

function cursorOf(session: AgentSession): string {
  return `${session.startedAt}\n${session.id}`;
}

function boundTitle(title: string): string {
  return title.length <= SESSION_TITLE_MAX ? title : title.slice(0, SESSION_TITLE_MAX);
}

export function projectAgentSessionPage(facts: SessionListFacts): AgentSessionListPage {
  const limit = Math.min(
    SESSION_LIST_MAX_LIMIT,
    Math.max(1, facts.limit ?? SESSION_LIST_DEFAULT_LIMIT),
  );
  const ordered = facts.sessions
    .filter((session) => session.workspaceId === facts.workspaceId)
    .slice()
    .sort((a, b) => cursorOf(a).localeCompare(cursorOf(b)));
  const start = facts.cursor === undefined ? 0 : ordered.findIndex((session) => cursorOf(session) === facts.cursor) + 1;
  const window = ordered.slice(Math.max(0, start), Math.max(0, start) + limit + 1);
  const page = window.slice(0, limit);
  const truncated = window.length > limit;
  const sessions: ListedAgentSession[] = page.map((session) => {
    const report = facts.reports.get(session.id);
    const task = session.taskId === undefined ? undefined : facts.tasks.get(session.taskId);
    const agent = facts.agents.get(session.agentId);
    const human = facts.humans.get(session.humanId);
    const contributions = facts.contributions.get(session.id);
    const state = deriveSessionRuntimeState({ report, now: facts.now });
    return {
      id: session.id,
      workspaceId: session.workspaceId,
      ...(session.taskId === undefined ? {} : { taskId: session.taskId }),
      ...(task === undefined ? {} : { taskTitle: boundTitle(task.title), taskStatus: task.status }),
      agentId: session.agentId,
      agentDisplayName: agent?.name ?? session.agentId,
      harness: session.harness,
      humanId: session.humanId,
      humanDisplayName: human?.displayName ?? session.humanId,
      startedAt: session.startedAt,
      ...(session.endedAt === undefined ? {} : { endedAt: session.endedAt }),
      state,
      ...(report?.reportedAt === undefined ? {} : { reportedAt: report.reportedAt }),
      ...(report?.expiresAt === undefined ? {} : { expiresAt: report.expiresAt }),
      ...(report?.exitCode === undefined ? {} : { exitCode: report.exitCode }),
      ...(report?.failureKind === undefined ? {} : { failureKind: report.failureKind }),
      sharedContributionCount: contributions?.count ?? 0,
      ...(contributions?.newestPosition == null ? {} : { newestContributionPosition: contributions.newestPosition }),
    };
  });
  const last = page.at(-1);
  return {
    workspaceId: facts.workspaceId,
    serverTime: facts.now,
    sessions,
    returned: sessions.length,
    truncated,
    ...(truncated && last !== undefined ? { nextCursor: cursorOf(last) } : {}),
  };
}
