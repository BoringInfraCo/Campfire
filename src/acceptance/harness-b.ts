/**
 * Acceptance Harness B (labelled "opencode").
 *
 * Represents Human B + Agent B in a fresh, independent harness process. It has
 * no access to Harness A's transcript: it must discover the billing workspace
 * through Campfire, retrieve the shared state, understand it, continue the
 * outstanding task, and write new state back (docs/SPRINT_001.md sections 5,
 * 11, 12).
 */
import type { Contribution, Finding, Artifact, AgentSession, Task } from "../domain/types.js";
import type {
  ActivityPage,
  WorkspaceContext,
  WorkspaceSummary,
  WorkspaceView,
} from "../service/service.js";
import type { HarnessClient } from "./client.js";
import { requireOk } from "./client.js";

export const UNRELATED_WORKSPACE_ID = "ws_auth_migration";

export interface HarnessBWhoAmI {
  actor: { actorId: string; actorType: string };
  sessionId?: string;
  harness?: string;
}

export interface UnauthorizedAttempt {
  workspaceId: string;
  ok: boolean;
  error?: string;
  message?: string;
}

export interface HarnessBResult {
  whoami: HarnessBWhoAmI;
  session: AgentSession;
  workspaceIds: string[];
  context: WorkspaceContext;
  workspace: WorkspaceView;
  activity: Contribution[];
  activityAfterWrites: Contribution[];
  unauthorizedAttempt: UnauthorizedAttempt;
  advancedTask: Task;
  newFinding: Finding;
  newArtifact: Artifact;
}

export async function runHarnessB(hc: HarnessClient): Promise<HarnessBResult> {
  const whoami = await requireOk<HarnessBWhoAmI>(hc, "whoami");

  const session = await requireOk<AgentSession>(hc, "register_agent_session", {
    agentId: "agt_opencode_alice",
    humanId: "hum_alice",
    workspaceId: "ws_billing_deploy",
    harness: "opencode",
  });

  const workspaces = await requireOk<WorkspaceSummary[]>(hc, "list_workspaces");
  const workspaceIds = workspaces.map((workspace) => workspace.id);

  const context = await requireOk<WorkspaceContext>(hc, "get_workspace_context", {
    workspaceId: "ws_billing_deploy",
  });
  const workspace = await requireOk<WorkspaceView>(hc, "get_workspace", {
    workspaceId: "ws_billing_deploy",
  });
  const activityPage = await requireOk<ActivityPage>(hc, "get_activity", {
    workspaceId: "ws_billing_deploy",
  });
  const activity = activityPage.items;

  // The unrelated workspace must be denied. This is an expected failure and is
  // recorded rather than thrown.
  const denied = await hc.call("get_workspace_context", {
    workspaceId: UNRELATED_WORKSPACE_ID,
  });
  const unauthorizedAttempt: UnauthorizedAttempt = {
    workspaceId: UNRELATED_WORKSPACE_ID,
    ok: denied.ok,
    error: denied.error?.error,
    message: denied.error?.message,
  };

  // Continue the outstanding task discovered from Campfire state, not from a
  // handoff summary or hard-coded id.
  const outstanding = context.openTasks.find((task) => task.title === "Prepare the migration split.");
  if (outstanding === undefined) {
    throw new Error(
      "Harness B could not find the outstanding 'Prepare the migration split.' task in Campfire context",
    );
  }
  const advancedTask = await requireOk<Task>(hc, "update_task", {
    taskId: outstanding.id,
    status: "in_progress",
  });

  const newFinding = await requireOk<Finding>(hc, "add_finding", {
    workspaceId: "ws_billing_deploy",
    summary: "Split migration 284 into two phases: schema change first, backfill second.",
    detail:
      "Phase 1 adds billing_status with a fast metadata-only change; phase 2 backfills in batches without an ACCESS EXCLUSIVE lock.",
    confidence: 0.85,
  });

  const newArtifact = await requireOk<Artifact>(hc, "add_artifact", {
    workspaceId: "ws_billing_deploy",
    type: "document",
    title: "Migration 284 split plan",
    uriOrPath: "fixtures/billing/migration-284-split-plan.md",
    metadata: { fixture: true, author: "opencode" },
  });

  const activityAfterWritesPage = await requireOk<ActivityPage>(hc, "get_activity", {
    workspaceId: "ws_billing_deploy",
  });
  const activityAfterWrites = activityAfterWritesPage.items;

  return {
    whoami,
    session,
    workspaceIds,
    context,
    workspace,
    activity,
    activityAfterWrites,
    unauthorizedAttempt,
    advancedTask,
    newFinding,
    newArtifact,
  };
}
