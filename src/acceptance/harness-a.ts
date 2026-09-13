/**
 * Acceptance Harness A (labelled "codex").
 *
 * Represents Human A + Agent A investigating the billing deploy failure. It
 * writes the reference scenario state to Campfire (docs/SPRINT_001.md section
 * 5). It holds a private transcript sentinel that is NEVER sent to Campfire;
 * the acceptance run uses it to prove Agent B does not receive this harness's
 * raw transcript (docs/SPRINT_001.md section 12).
 */
import type { Artifact, AgentSession, Decision, Finding, Task } from "../domain/types.js";
import type { HarnessClient } from "./client.js";
import { requireOk } from "./client.js";

export const PRIVATE_TRANSCRIPT_SENTINEL_A = "PRIVATE_TRANSCRIPT_SENTINEL_A_never_shared";

export const BILLING_WORKSPACE_ID = "ws_billing_deploy";

export interface HarnessAWhoAmI {
  actor: { actorId: string; actorType: string };
  sessionId?: string;
  harness?: string;
}

export interface HarnessAResult {
  whoami: HarnessAWhoAmI;
  session: AgentSession;
  coreFinding: Finding;
  secondaryFinding: Finding;
  decision: Decision;
  task: Task;
  artifact: Artifact;
  /** Evidence only: never transmitted to Campfire. */
  privateTranscriptSentinel: string;
  /** Evidence only: the private context A "would" have had in its session. */
  privateTranscript: string[];
}

export async function runHarnessA(hc: HarnessClient): Promise<HarnessAResult> {
  // Local, harness-private session context. This is the information that must
  // not reach Agent B.
  const privateTranscript = [
    "human: The billing deploy keeps failing. Can you dig in?",
    "agent: I'll inspect the migration runner and the deploy timeout.",
    `agent: [private working note ${PRIVATE_TRANSCRIPT_SENTINEL_A}]`,
  ];

  const whoami = await requireOk<HarnessAWhoAmI>(hc, "whoami");

  const session = await requireOk<AgentSession>(hc, "register_agent_session", {
    agentId: "agt_codex_sergio",
    humanId: "hum_sergio",
    workspaceId: BILLING_WORKSPACE_ID,
    harness: "codex",
  });

  const coreFinding = await requireOk<Finding>(hc, "add_finding", {
    workspaceId: BILLING_WORKSPACE_ID,
    summary: "Migration 284 holds a database lock longer than the deployment timeout.",
    detail:
      "fixtures/billing/migration-284.sql wraps an ALTER plus backfill in one transaction, so it holds an ACCESS EXCLUSIVE lock on invoices until COMMIT.",
    confidence: 0.9,
  });

  const secondaryFinding = await requireOk<Finding>(hc, "add_finding", {
    workspaceId: BILLING_WORKSPACE_ID,
    summary: "The billing deploy times out after 120 seconds.",
    detail: "Observed in fixtures/billing/deploy.log.",
    confidence: 0.8,
  });

  const decision = await requireOk<Decision>(hc, "add_decision", {
    workspaceId: BILLING_WORKSPACE_ID,
    summary: "Do not increase the global deployment timeout; split the migration instead.",
    rationale: "A global timeout increase previously caused unrelated deploy failures.",
  });

  const accepted = await requireOk<Decision>(hc, "accept_decision", {
    decisionId: decision.id,
  });

  const task = await requireOk<Task>(hc, "create_task", {
    workspaceId: BILLING_WORKSPACE_ID,
    title: "Prepare the migration split.",
    description: "Split migration 284 so the schema change and backfill run separately.",
  });

  const artifact = await requireOk<Artifact>(hc, "add_artifact", {
    workspaceId: BILLING_WORKSPACE_ID,
    type: "file",
    title: "migration-284.sql",
    uriOrPath: "fixtures/billing/migration-284.sql",
    metadata: { fixture: true },
  });

  return {
    whoami,
    session,
    coreFinding,
    secondaryFinding,
    decision: accepted,
    task,
    artifact,
    privateTranscriptSentinel: PRIVATE_TRANSCRIPT_SENTINEL_A,
    privateTranscript,
  };
}
