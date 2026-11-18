/**
 * Projection of one owner-shared session watch (SES-001 A2).
 *
 * Pure: the caller supplies already-authorized facts. The result never includes
 * terminal bytes, prompts, argv, environment, PID, paths, or any transcript.
 */
import { deriveSessionRuntimeState, type AgentSessionRuntimeReport } from "../domain/session-runtime.js";
import { boundWatchText, deriveSessionWatchState, projectWatchActivityItem } from "../domain/session-watch.js";
import type { AgentSession, Contribution } from "../domain/types.js";
import type { AgentSessionWatch } from "./service.js";

export interface SessionWatchFacts {
  now: string;
  session: AgentSession;
  shared: boolean;
  report?: AgentSessionRuntimeReport;
  taskTitle?: string;
  agentName: string;
  humanName: string;
  /** Up to `limit + 1` contributions after the cursor, oldest first. */
  contributions: Contribution[];
  limit: number;
}

export function projectAgentSessionWatch(facts: SessionWatchFacts): AgentSessionWatch {
  const { session, report } = facts;
  const page = facts.contributions.slice(0, facts.limit);
  const more = facts.contributions.length > facts.limit;
  const last = page.at(-1);
  return {
    serverTime: facts.now,
    session: {
      id: session.id,
      shared: facts.shared,
      human: { id: session.humanId, name: facts.humanName },
      agent: { id: session.agentId, name: facts.agentName },
      task:
        session.taskId === undefined
          ? null
          : {
              id: session.taskId,
              title: boundWatchText(facts.taskTitle ?? ""),
            },
      startedAt: session.startedAt,
      ...(session.endedAt === undefined ? {} : { endedAt: session.endedAt }),
      watchState: deriveSessionWatchState({ endedAt: session.endedAt, report, now: facts.now }),
      runtime: {
        state: deriveSessionRuntimeState({ report, now: facts.now }),
        ...(report?.reportedAt === undefined ? {} : { reportedAt: report.reportedAt }),
        ...(report?.expiresAt === undefined ? {} : { expiresAt: report.expiresAt }),
      },
    },
    activity: {
      items: page.map(projectWatchActivityItem),
      nextCursor: more && last !== undefined ? last.appendPosition : null,
    },
  };
}
