/**
 * Sprint 002 real-harness acceptance checks.
 *
 * Pure evaluation functions: they take captured harness runs plus Campfire
 * before/after snapshots and return inspectable checks. No network, no LLM, no
 * filesystem mutation. The only filesystem reads are the raw harness stdout
 * captures, used to prove transcript isolation from the actual process output.
 *
 * Heuristics are intentionally simple and documented: the real acceptance run
 * is the evidence, these functions only make the judgement deterministic and
 * reproducible.
 */
import { existsSync, readFileSync } from "node:fs";
import type { Artifact, Contribution, Decision, Finding } from "../../domain/types.js";
import { isCampfireTool, isReadTool } from "./tools.js";
import type {
  CampfireSnapshot,
  ErgonomicsMetrics,
  HarnessRunResult,
  HumanIntervention,
  RealAcceptanceCheck,
} from "./types.js";

export interface CheckInput {
  harnessA: HarnessRunResult;
  harnessB: HarnessRunResult;
  stateBeforeB: CampfireSnapshot;
  stateAfterB: CampfireSnapshot;
  agentAOriginal: { findingIds: string[]; decisionId: string; taskId: string; artifactId: string };
  sentinels: { privateSentinel: string; unrelatedSentinel: string };
  unrelatedWorkspaceId: string;
  visibleWorkspaceIds: string[];
  unrelatedReadDenied: boolean;
  humanInterventions: HumanIntervention[];
  /** Observational ergonomics metrics; recorded as passing checks. */
  ergonomics: ErgonomicsMetrics;
}

const REAL_HARNESS_KINDS: ReadonlySet<string> = new Set(["codex", "opencode", "claude-code"]);

/**
 * The accepted decision is "do not raise the timeout; split the migration".
 * Real agents express this as split / separated / staged / phased /
 * expand-contract with bounded or batched backfill. Semantic correctness
 * matters more than exact strings (SPRINT_002 section 13), so match the
 * concept, not one word.
 */
const SPLIT_SEMANTICS = /split|separat|phase|staged|stage|expand[ ._/-]?contract|schema-?only|bounded|batch|resumable|decompos/i;
const MIGRATION_WORK = /migration|schema|backfill|batch|column|constraint|index|rollout|deploy/i;
const TIMEOUT_REFERENCE = /timeout|120/i;
const TIMEOUT_INCREASE =
  /(increase|raise|extend|lengthen).{0,30}(global\s+)?(deploy(ment)?\s+)?timeout|timeout.{0,20}(increase|raise|300)/i;

function check(name: string, passed: boolean, detail?: string): RealAcceptanceCheck {
  return detail === undefined ? { name, passed } : { name, passed, detail };
}

function readText(path: string | undefined): string {
  if (path === undefined || path === "") return "";
  try {
    if (!existsSync(path)) return "";
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** Final message plus every MCP output (and optionally raw stdout). */
function harnessOutputBlob(harness: HarnessRunResult, includeRawStdout = true): string {
  const parts: string[] = [harness.finalMessage];
  for (const call of harness.mcpCalls) {
    if (call.output !== undefined) parts.push(call.output);
  }
  if (includeRawStdout) {
    const raw = readText(harness.rawStdoutPath);
    if (raw !== "") parts.push(raw);
  }
  return parts.join("\n");
}

function hasCampfireCall(harness: HarnessRunResult): boolean {
  return harness.mcpCalls.some(
    (call) => call.tool.startsWith("campfire.") || isCampfireTool(call.rawTool) || isCampfireTool(call.tool),
  );
}

/** A harness is "real" when a genuine vendor CLI exited cleanly and used Campfire. */
function isRealHarness(harness: HarnessRunResult): boolean {
  return (
    REAL_HARNESS_KINDS.has(harness.harness) &&
    harness.exitCode === 0 &&
    (harness.error === undefined || harness.error === "") &&
    hasCampfireCall(harness)
  );
}

/** B must have actually read from Campfire, not merely been handed state. */
function madeReadCall(harness: HarnessRunResult): boolean {
  return harness.mcpCalls.some((call) => isReadTool(call.rawTool) || isReadTool(call.tool));
}

function findingText(finding: Finding): string {
  return `${finding.summary} ${finding.detail ?? ""}`;
}

function artifactText(artifact: Artifact): string {
  return `${artifact.title} ${artifact.uriOrPath}`;
}

function normalizeSummary(summary: string): string {
  return summary.trim().toLowerCase();
}

function matchesIdentity(contribution: Contribution, actorId: string, sessionId: string | undefined): boolean {
  if (contribution.actor.actorId !== actorId) return false;
  // Seed membership joins share the actor but not the harness session. Ordering
  // and provenance checks are about that session's writes.
  if (sessionId !== undefined) return contribution.agentSessionId === sessionId;
  return true;
}

function stateOrMessage(statePass: boolean, message: string, pattern: RegExp): boolean {
  return statePass || pattern.test(message);
}

function computeEnvironmentChecks(input: CheckInput): RealAcceptanceCheck[] {
  const { harnessA, harnessB } = input;

  const harnessAReal = check(
    "environment.harness_a_real",
    isRealHarness(harnessA),
    `kind=${harnessA.harness} exit=${harnessA.exitCode} error=${harnessA.error ?? "none"} campfireCalls=${harnessA.mcpCalls.length}`,
  );

  const harnessBReal = check(
    "environment.harness_b_real",
    isRealHarness(harnessB),
    `kind=${harnessB.harness} exit=${harnessB.exitCode} error=${harnessB.error ?? "none"} campfireCalls=${harnessB.mcpCalls.length}`,
  );

  // Distinct harnesses: different vendor, or at minimum a different native thread.
  const distinct =
    harnessA.harness !== harnessB.harness ||
    harnessA.harnessSessionId !== harnessB.harnessSessionId;
  const harnessesDistinct = check(
    "environment.harnesses_distinct",
    distinct,
    `A=${harnessA.harness}/${harnessA.harnessSessionId ?? "?"} B=${harnessB.harness}/${harnessB.harnessSessionId ?? "?"}`,
  );

  // Agent sessions must differ and B's raw stdout must not contain A's native session id.
  const sessionsDiffer = harnessA.agentSessionId !== harnessB.agentSessionId;
  const aNativeSession = harnessA.harnessSessionId;
  const bStdout = readText(harnessB.rawStdoutPath);
  const leakedSession = aNativeSession !== undefined && aNativeSession !== "" && bStdout.includes(aNativeSession);
  const sessionsIsolated = check(
    "environment.sessions_isolated",
    sessionsDiffer && !leakedSession,
    `A=${harnessA.agentSessionId ?? "?"} B=${harnessB.agentSessionId ?? "?"} nativeSessionLeaked=${leakedSession}`,
  );

  return [harnessAReal, harnessBReal, harnessesDistinct, sessionsIsolated];
}

function computeComprehensionChecks(input: CheckInput): RealAcceptanceCheck[] {
  const before = input.stateBeforeB.view;
  const message = input.harnessB.finalMessage;
  const bRead = madeReadCall(input.harnessB);
  const provenancePass =
    before.findings.some(
      (finding) =>
        input.agentAOriginal.findingIds.includes(finding.id) && finding.createdBy.actorType === "agent",
    ) ||
    before.decisions.some(
      (decision) =>
        input.agentAOriginal.decisionId === decision.id && decision.createdBy.actorType === "agent",
    );

  const workspaceGoal = stateOrMessage(
    before.goal !== undefined && before.goal.title.trim() !== "",
    message,
    /billing/i,
  );

  const coreFindingState = before.findings.some(
    (finding) => /migration\s*284/i.test(findingText(finding)) || /lock/i.test(findingText(finding)),
  );
  const coreFinding = stateOrMessage(coreFindingState, message, /migration\s*284|lock/i);

  const acceptedDecisionState = before.decisions.some(
    (decision) =>
      decision.status === "accepted" &&
      TIMEOUT_REFERENCE.test(decision.summary) &&
      SPLIT_SEMANTICS.test(decision.summary),
  );
  const acceptedDecision = stateOrMessage(
    acceptedDecisionState,
    message,
    TIMEOUT_REFERENCE,
  );

  const outstandingTaskState = before.tasks.some((task) => task.status === "open");
  const outstandingTask = stateOrMessage(outstandingTaskState, message, /migration split|prepare/i);

  const referencedArtifactState = before.artifacts.length > 0;
  const referencedArtifact = stateOrMessage(referencedArtifactState, message, /migration-?284/i);

  const provenance = stateOrMessage(provenancePass, message, /provenance|recorded by an agent/i);

  return [
    check("comprehension.workspace_goal", bRead && workspaceGoal, `state=${before.goal !== undefined} bRead=${bRead}`),
    check("comprehension.core_finding", bRead && coreFinding, `state=${coreFindingState} bRead=${bRead}`),
    check(
      "comprehension.accepted_decision",
      bRead && acceptedDecision,
      `state=${acceptedDecisionState} bRead=${bRead}`,
    ),
    check(
      "comprehension.outstanding_task",
      bRead && outstandingTask,
      `state=${outstandingTaskState} bRead=${bRead}`,
    ),
    check(
      "comprehension.referenced_artifact",
      bRead && referencedArtifact,
      `state=${referencedArtifactState} bRead=${bRead}`,
    ),
    check("comprehension.provenance", bRead && provenance, `agentProvenance=${provenancePass} bRead=${bRead}`),
  ];
}

interface Additions {
  findings: Finding[];
  artifacts: Artifact[];
  decisions: Decision[];
}

function collectAdditions(input: CheckInput): Additions {
  const after = input.stateAfterB.view;
  const { findingIds, decisionId, artifactId } = input.agentAOriginal;
  return {
    findings: after.findings.filter((finding) => !findingIds.includes(finding.id)),
    artifacts: after.artifacts.filter((artifact) => artifact.id !== artifactId),
    decisions: after.decisions.filter((decision) => decision.id !== decisionId),
  };
}

function computeReasoningChecks(input: CheckInput, additions: Additions): RealAcceptanceCheck[] {
  const after = input.stateAfterB.view;
  const before = input.stateBeforeB.view;
  const originalTask = after.tasks.find((task) => task.id === input.agentAOriginal.taskId);
  const taskAdvanced = originalTask !== undefined && originalTask.status !== "open";

  const nextStepFinding = additions.findings.some(
    (finding) => SPLIT_SEMANTICS.test(findingText(finding)) && MIGRATION_WORK.test(findingText(finding)),
  );
  // Semantic correctness matters more than exact strings (SPRINT_002 section
  // 13): the same next step may be described as "staged", "schema-only", or
  // "expand/contract" rather than literally "split".
  const nextStepMessage =
    SPLIT_SEMANTICS.test(input.harnessB.finalMessage) && MIGRATION_WORK.test(input.harnessB.finalMessage);
  const correctNextStep = check(
    "reasoning.correct_next_step",
    (nextStepFinding || nextStepMessage) && taskAdvanced,
    `nextStepFinding=${nextStepFinding} nextStepMessage=${nextStepMessage} taskAdvanced=${taskAdvanced}`,
  );

  const increaseTimeout = TIMEOUT_INCREASE;
  const additionsBlob = [...additions.findings.map(findingText), ...additions.artifacts.map(artifactText)].join("\n");
  const violatesDecision = increaseTimeout.test(additionsBlob);
  const mentionsSplit =
    SPLIT_SEMANTICS.test(additionsBlob) || SPLIT_SEMANTICS.test(input.harnessB.finalMessage);
  const respectsPriorDecision = check(
    "reasoning.respects_prior_decision",
    !violatesDecision && mentionsSplit,
    `violatesIncreaseTimeout=${violatesDecision} mentionsSplit=${mentionsSplit}`,
  );

  const aSummaries = new Set(
    before.findings
      .filter((finding) => input.agentAOriginal.findingIds.includes(finding.id))
      .map((finding) => normalizeSummary(finding.summary)),
  );
  const duplicated = additions.findings.some((finding) => aSummaries.has(normalizeSummary(finding.summary)));
  const avoidsRedundant = check(
    "reasoning.avoids_redundant_investigation",
    !duplicated,
    `duplicatedFindings=${duplicated}`,
  );

  const pattern = /migration-?284/i;
  const readArtifact = input.harnessB.nonMcpToolCalls.some(
    (call) =>
      /read|glob|grep/i.test(`${call.tool} ${call.rawTool}`) &&
      pattern.test(JSON.stringify(call.input ?? {})),
  );
  const addedArtifact = additions.artifacts.some((artifact) => pattern.test(artifactText(artifact)));
  const usesArtifact = check(
    "reasoning.uses_relevant_artifact",
    readArtifact || addedArtifact,
    `readArtifact=${readArtifact} addedArtifact=${addedArtifact}`,
  );

  return [correctNextStep, respectsPriorDecision, avoidsRedundant, usesArtifact];
}

function computeContinuationChecks(input: CheckInput, additions: Additions): RealAcceptanceCheck[] {
  const after = input.stateAfterB.view;
  const before = input.stateBeforeB.view;
  const originalTask = after.tasks.find((task) => task.id === input.agentAOriginal.taskId);
  const taskAdvanced = originalTask !== undefined && originalTask.status !== "open";

  const meaningful =
    additions.findings.length > 0 || additions.artifacts.length > 0 || taskAdvanced;
  const meaningfulWork = check(
    "continuation.meaningful_work_performed",
    meaningful,
    `newFindings=${additions.findings.length} newArtifacts=${additions.artifacts.length} taskAdvanced=${taskAdvanced}`,
  );

  const taskStateAdvanced = check(
    "continuation.task_state_advanced",
    taskAdvanced,
    `task=${input.agentAOriginal.taskId} status=${originalTask?.status ?? "missing"}`,
  );

  const newStateRecorded =
    additions.findings.length > 0 || additions.artifacts.length > 0 || additions.decisions.length > 0;
  const newState = check(
    "continuation.new_state_recorded",
    newStateRecorded,
    `newFindings=${additions.findings.length} newArtifacts=${additions.artifacts.length} newDecisions=${additions.decisions.length}`,
  );

  const bBefore = before.activity.filter((contribution) =>
    matchesIdentity(contribution, input.harnessB.actorId, input.harnessB.agentSessionId),
  ).length;
  const bAfter = after.activity.filter((contribution) =>
    matchesIdentity(contribution, input.harnessB.actorId, input.harnessB.agentSessionId),
  ).length;
  const newProvenance = check(
    "continuation.new_provenance_recorded",
    bAfter > bBefore && bAfter > 0,
    `B contributions before=${bBefore} after=${bAfter}`,
  );

  return [meaningfulWork, taskStateAdvanced, newState, newProvenance];
}

function computePreservationChecks(input: CheckInput): RealAcceptanceCheck[] {
  const before = input.stateBeforeB.view;
  const after = input.stateAfterB.view;
  const { findingIds, decisionId, taskId, artifactId } = input.agentAOriginal;

  const aFindings = before.findings.filter((finding) => findingIds.includes(finding.id));
  const findingsIntact =
    aFindings.length > 0 &&
    aFindings.every((finding) => {
      const current = after.findings.find((candidate) => candidate.id === finding.id);
      return current !== undefined && current.summary === finding.summary;
    });

  const decisionBefore = before.decisions.find((decision) => decision.id === decisionId);
  const decisionAfter = after.decisions.find((decision) => decision.id === decisionId);
  const decisionIntact =
    decisionAfter !== undefined &&
    decisionAfter.status === "accepted" &&
    (decisionBefore === undefined || decisionAfter.summary === decisionBefore.summary);

  const taskPresent = after.tasks.some((task) => task.id === taskId);
  const artifactPresent = after.artifacts.some((artifact) => artifact.id === artifactId);
  const stateIntact = check(
    "preservation.agent_a_state_intact",
    findingsIntact && decisionIntact && taskPresent && artifactPresent,
    `findings=${findingsIntact} decision=${decisionIntact} task=${taskPresent} artifact=${artifactPresent}`,
  );

  const aContributions = after.activity.filter((contribution) =>
    matchesIdentity(contribution, input.harnessA.actorId, input.harnessA.agentSessionId),
  );
  const bContributions = after.activity.filter((contribution) =>
    matchesIdentity(contribution, input.harnessB.actorId, input.harnessB.agentSessionId),
  );
  const provenanceDistinct =
    aContributions.length > 0 &&
    bContributions.length > 0 &&
    aContributions.some((a) =>
      bContributions.some(
        (b) => a.actor.actorId !== b.actor.actorId || a.agentSessionId !== b.agentSessionId,
      ),
    );
  const distinct = check(
    "preservation.provenance_distinct",
    provenanceDistinct,
    `A contributions=${aContributions.length} B contributions=${bContributions.length}`,
  );

  const aIndices: number[] = [];
  const bIndices: number[] = [];
  after.activity.forEach((contribution, index) => {
    if (matchesIdentity(contribution, input.harnessA.actorId, input.harnessA.agentSessionId)) {
      aIndices.push(index);
    } else if (matchesIdentity(contribution, input.harnessB.actorId, input.harnessB.agentSessionId)) {
      bIndices.push(index);
    }
  });
  const ordered =
    aIndices.length > 0 &&
    bIndices.length > 0 &&
    Math.max(...aIndices) < Math.min(...bIndices);
  const activityOrdered = check(
    "preservation.activity_ordered",
    ordered,
    `lastA=${aIndices.length > 0 ? Math.max(...aIndices) : "none"} firstB=${bIndices.length > 0 ? Math.min(...bIndices) : "none"}`,
  );

  return [stateIntact, distinct, activityOrdered];
}

function computeIsolationChecks(input: CheckInput): RealAcceptanceCheck[] {
  const { privateSentinel, unrelatedSentinel } = input.sentinels;
  const blob = harnessOutputBlob(input.harnessB);
  const stateJson = JSON.stringify(input.stateAfterB.view);

  const privatePresent =
    privateSentinel !== "" &&
    (input.harnessB.finalMessage.includes(privateSentinel) ||
      input.harnessB.mcpCalls.some((call) => (call.output ?? "").includes(privateSentinel)) ||
      readText(input.harnessB.rawStdoutPath).includes(privateSentinel) ||
      stateJson.includes(privateSentinel));
  const privateAbsent = check(
    "isolation.private_transcript_absent",
    !privatePresent,
    `privateSentinelPresent=${privatePresent}`,
  );

  const unrelatedHidden = check(
    "isolation.unrelated_workspace_hidden",
    !input.visibleWorkspaceIds.includes(input.unrelatedWorkspaceId),
    `visible=${input.visibleWorkspaceIds.join(",") || "none"} unrelated=${input.unrelatedWorkspaceId}`,
  );

  const unrelatedDenied = check(
    "isolation.unrelated_workspace_denied",
    input.unrelatedReadDenied,
    `denied=${input.unrelatedReadDenied}`,
  );

  const unrelatedPresent =
    unrelatedSentinel !== "" &&
    (input.harnessB.finalMessage.includes(unrelatedSentinel) ||
      input.harnessB.mcpCalls.some((call) => (call.output ?? "").includes(unrelatedSentinel)) ||
      readText(input.harnessB.rawStdoutPath).includes(unrelatedSentinel) ||
      stateJson.includes(unrelatedSentinel));
  const unrelatedAbsent = check(
    "isolation.unrelated_sentinel_absent",
    !unrelatedPresent,
    `unrelatedSentinelPresent=${unrelatedPresent}`,
  );

  return [privateAbsent, unrelatedHidden, unrelatedDenied, unrelatedAbsent];
}

function computeInterventionChecks(input: CheckInput): RealAcceptanceCheck[] {
  const manualHandoff = input.humanInterventions.some(
    (intervention) => intervention.classification === "manual_handoff",
  );
  const leakage = input.humanInterventions.some(
    (intervention) => intervention.classification === "context_leakage",
  );

  return [
    check(
      "intervention.no_manual_handoff",
      !manualHandoff,
      `interventions=${input.humanInterventions.length}`,
    ),
    check("intervention.no_answer_leakage", !leakage, `interventions=${input.humanInterventions.length}`),
  ];
}

function computeErgonomicsChecks(ergonomics: ErgonomicsMetrics): RealAcceptanceCheck[] {
  const redundantTools = ergonomics.redundantReadTools.join(", ") || "none";
  const missing = ergonomics.missingContextSignals.join("; ") || "none";
  const noise = ergonomics.contextNoiseSignals.join("; ") || "none";

  return [
    check(
      "ergonomics.orientation_tool_calls",
      true,
      `orientation tool calls=${ergonomics.orientationToolCalls} first call=${ergonomics.firstCampfireCall ?? "unknown"}`,
    ),
    check(
      "ergonomics.redundant_reads",
      true,
      `redundant reads=${ergonomics.redundantReads} (${redundantTools})`,
    ),
    check("ergonomics.missing_context", true, `missing-context signals: ${missing}`),
    check("ergonomics.context_noise", true, `context-noise signals: ${noise}`),
  ];
}

/** Evaluate every Sprint 002 acceptance check against captured evidence. */
export function computeChecks(input: CheckInput): RealAcceptanceCheck[] {
  const additions = collectAdditions(input);
  return [
    ...computeEnvironmentChecks(input),
    ...computeComprehensionChecks(input),
    ...computeReasoningChecks(input, additions),
    ...computeContinuationChecks(input, additions),
    ...computePreservationChecks(input),
    ...computeIsolationChecks(input),
    ...computeInterventionChecks(input),
    ...computeErgonomicsChecks(input.ergonomics),
  ];
}

const SUBSTANTIVE_PREFIXES = [
  "environment.",
  "comprehension.",
  "reasoning.",
  "continuation.",
  "preservation.",
  "isolation.",
  "intervention.",
] as const;

function isSubstantive(name: string): boolean {
  return SUBSTANTIVE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function passed(checks: RealAcceptanceCheck[], name: string): boolean {
  return checks.find((candidate) => candidate.name === name)?.passed === true;
}

/**
 * GO only when every non-ergonomic check passes. CONDITIONAL GO when the core
 * experience (B did meaningful work and understood the goal) plus isolation hold
 * but a condition remains. Otherwise the thesis needs reframing.
 */
export function recommend(checks: RealAcceptanceCheck[]): "GO" | "CONDITIONAL GO" | "NO-GO / REFRAME" {
  const substantive = checks.filter((candidate) => isSubstantive(candidate.name));
  if (substantive.every((candidate) => candidate.passed)) return "GO";

  const isolationOk = checks
    .filter((candidate) => candidate.name.startsWith("isolation."))
    .every((candidate) => candidate.passed);
  const conditional =
    passed(checks, "continuation.meaningful_work_performed") &&
    passed(checks, "comprehension.workspace_goal") &&
    isolationOk;
  if (conditional) return "CONDITIONAL GO";

  return "NO-GO / REFRAME";
}
