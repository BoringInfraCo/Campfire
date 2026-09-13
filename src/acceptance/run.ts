/**
 * Sprint 001 end-to-end acceptance run.
 *
 * Drives two independent, real MCP client processes (labelled "codex" and
 * "opencode") against a real Campfire MCP stdio server sharing one SQLite
 * database, then computes deterministic GO / CONDITIONAL GO / NO-GO evidence
 * (docs/SPRINT_001.md sections 14 and 15).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE, seedFixture } from "../bootstrap/seed.js";
import type { AgentSession, Artifact, Contribution, Decision, Finding, Task } from "../domain/types.js";
import { openSqliteStore } from "../store/sqlite-store.js";
import { connectHarness } from "./client.js";
import type { HarnessClient } from "./client.js";
import { PRIVATE_TRANSCRIPT_SENTINEL_A, runHarnessA } from "./harness-a.js";
import type { HarnessAResult } from "./harness-a.js";
import { UNRELATED_WORKSPACE_ID, runHarnessB } from "./harness-b.js";
import type { HarnessBResult } from "./harness-b.js";

export type Recommendation = "GO" | "CONDITIONAL GO" | "NO-GO";

export type CheckCategory =
  | "comprehension"
  | "continuation"
  | "preservation"
  | "isolation"
  | "transcript";

export interface AcceptanceCheck {
  name: string;
  category: CheckCategory;
  passed: boolean;
  detail?: string;
}

export interface FinalState {
  findings: Finding[];
  decisions: Decision[];
  tasks: Task[];
  artifacts: Artifact[];
  contributions: Contribution[];
}

export interface EnvironmentInfo {
  node: string;
  platform: string;
  arch: string;
  mcpSdk: string;
  vitest: string;
  typescript: string;
}

export interface HarnessInfo {
  actorId: string;
  actorType: string;
  harness: string;
  label: string;
  sessionId: string;
}

export interface AcceptanceEvidence {
  sprint: "001";
  scenario: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  environment: EnvironmentInfo;
  harnesses: { a: HarnessInfo; b: HarnessInfo };
  database: { path: string; seeded: boolean; kept: boolean };
  harnessA: HarnessAResult;
  harnessB: HarnessBResult;
  finalState: FinalState;
  transcriptIsolation: {
    sentinel: string;
    presentInHarnessBRetrieval: boolean;
    checkedSources: string[];
  };
  workspaceIsolation: {
    unrelatedWorkspaceId: string;
    unrelatedSentinel: string;
    visibleWorkspaceIds: string[];
    unrelatedCallDenied: boolean;
  };
  checks: AcceptanceCheck[];
  limitations: string[];
  recommendation: Recommendation;
}

export interface RunAcceptanceOptions {
  databasePath?: string;
  keepDatabase?: boolean;
}

function readPackageVersion(pkg: string): string {
  try {
    const path = fileURLToPath(new URL(`../../node_modules/${pkg}/package.json`, import.meta.url));
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { version?: string };
    return parsed.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function collectEnvironment(): EnvironmentInfo {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    mcpSdk: readPackageVersion("@modelcontextprotocol/sdk"),
    vitest: readPackageVersion("vitest"),
    typescript: readPackageVersion("typescript"),
  };
}

function removeDatabaseFiles(databasePath: string): void {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

function snapshot(databasePath: string): FinalState {
  const store = openSqliteStore(databasePath);
  try {
    return {
      findings: store.listFindings(FIXTURE.workspaces.billing),
      decisions: store.listDecisions(FIXTURE.workspaces.billing),
      tasks: store.listTasks(FIXTURE.workspaces.billing),
      artifacts: store.listArtifacts(FIXTURE.workspaces.billing),
      contributions: store.listContributions(FIXTURE.workspaces.billing),
    };
  } finally {
    store.close();
  }
}

function sameActor(
  value: { actorId: string; actorType: string } | undefined,
  actorId: string,
): boolean {
  return value !== undefined && value.actorId === actorId;
}

export async function runAcceptance(options: RunAcceptanceOptions = {}): Promise<AcceptanceEvidence> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const keepDatabase = options.keepDatabase === true;
  const cwd = process.cwd();

  let databasePath = options.databasePath;
  let ownsTempDir = false;
  if (databasePath === undefined) {
    const dir = mkdtempSync(join(tmpdir(), "campfire-acceptance-"));
    databasePath = join(dir, "campfire.db");
    ownsTempDir = true;
  }
  removeDatabaseFiles(databasePath);

  // Prepare the fixture in-process. The CLI is intentionally not spawned so the
  // acceptance run has one fewer moving part.
  const seedStore = openSqliteStore(databasePath);
  try {
    seedFixture(seedStore);
  } finally {
    seedStore.close();
  }

  const connect = (config: {
    actorId: string;
    actorType: "human" | "agent";
    harness: string;
  }): Promise<HarnessClient> =>
    connectHarness({ ...config, databasePath: databasePath as string, cwd });

  const withClient = async <T>(
    config: { actorId: string; actorType: "human" | "agent"; harness: string },
    fn: (client: HarnessClient) => Promise<T>,
  ): Promise<T> => {
    const client = await connect(config);
    try {
      return await fn(client);
    } finally {
      // Closing the client terminates the child process before the next
      // harness starts, so the two harnesses never share a live session.
      await client.close();
    }
  };

  // Harness A runs and its process fully exits before Harness B starts.
  const harnessA: HarnessAResult = await withClient(
    { actorId: FIXTURE.agents.codexSergio, actorType: "agent", harness: "codex" },
    runHarnessA,
  );

  // A fresh, independent process with a different actor identity and harness.
  const harnessB: HarnessBResult = await withClient(
    { actorId: FIXTURE.agents.opencodeAlice, actorType: "agent", harness: "opencode" },
    runHarnessB,
  );

  // Read the durable final state directly to prove the writes survived both
  // processes and that provenance was preserved.
  const finalState = snapshot(databasePath);

  const checks: AcceptanceCheck[] = [];
  const check = (name: string, category: CheckCategory, passed: boolean, detail?: string): void => {
    checks.push(detail === undefined ? { name, category, passed } : { name, category, passed, detail });
  };

  // --- required comprehension (docs/SPRINT_001.md section 15) ---
  const context = harnessB.context;
  const goalOk = context.goal?.title.includes("billing-service deploys fail") ?? false;
  check(
    "comprehension.workspace_goal",
    "comprehension",
    goalOk,
    goalOk ? undefined : `goal=${context.goal?.title ?? "missing"}`,
  );

  const seenFinding = context.findings.find((finding) => finding.id === harnessA.coreFinding.id);
  check(
    "comprehension.core_finding",
    "comprehension",
    seenFinding !== undefined && seenFinding.summary === harnessA.coreFinding.summary,
    seenFinding === undefined ? "core finding not present in Agent B context" : undefined,
  );

  const seenDecision = context.acceptedDecisions.find(
    (decision) => decision.id === harnessA.decision.id,
  );
  check(
    "comprehension.accepted_decision",
    "comprehension",
    seenDecision !== undefined && seenDecision.status === "accepted",
    seenDecision === undefined ? "accepted decision not present in Agent B context" : undefined,
  );

  const seenTask = context.openTasks.find((task) => task.id === harnessA.task.id);
  check(
    "comprehension.outstanding_task",
    "comprehension",
    seenTask !== undefined && seenTask.status !== "completed",
    seenTask === undefined ? "outstanding task not present in Agent B context" : undefined,
  );

  const seenArtifact = context.artifacts.find((artifact) => artifact.id === harnessA.artifact.id);
  check(
    "comprehension.referenced_artifact",
    "comprehension",
    seenArtifact !== undefined && seenArtifact.uriOrPath === "fixtures/billing/migration-284.sql",
    seenArtifact === undefined ? "artifact not present in Agent B context" : undefined,
  );

  const seenProvenance = context.provenance.find(
    (entry) => entry.objectType === "finding" && entry.objectId === harnessA.coreFinding.id,
  );
  check(
    "comprehension.provenance_producer",
    "comprehension",
    seenProvenance !== undefined &&
      seenProvenance.actor.actorId === FIXTURE.agents.codexSergio &&
      seenProvenance.agentSessionId === harnessA.session.id,
    seenProvenance === undefined ? "no provenance entry for the core finding" : undefined,
  );

  // --- required continuation ---
  const finalTask = finalState.tasks.find((task) => task.id === harnessA.task.id);
  check(
    "continuation.task_advanced",
    "continuation",
    finalTask !== undefined && finalTask.status === "in_progress",
    finalTask === undefined ? "task missing after Agent B writes" : `task status=${finalTask.status}`,
  );

  const finalNewFinding = finalState.findings.find((finding) => finding.id === harnessB.newFinding.id);
  check(
    "continuation.new_finding_recorded",
    "continuation",
    finalNewFinding !== undefined &&
      sameActor(finalNewFinding.createdBy, FIXTURE.agents.opencodeAlice) &&
      finalNewFinding.agentSessionId === harnessB.session.id,
    finalNewFinding === undefined ? "Agent B finding missing" : undefined,
  );

  const finalNewArtifact = finalState.artifacts.find(
    (artifact) => artifact.id === harnessB.newArtifact.id,
  );
  check(
    "continuation.new_artifact_recorded",
    "continuation",
    finalNewArtifact !== undefined &&
      finalNewArtifact.uriOrPath === "fixtures/billing/migration-284-split-plan.md" &&
      sameActor(finalNewArtifact.createdBy, FIXTURE.agents.opencodeAlice),
    finalNewArtifact === undefined ? "Agent B artifact missing" : undefined,
  );

  const bContribution = finalState.contributions.find(
    (entry) =>
      entry.agentSessionId === harnessB.session.id &&
      entry.actor.actorId === FIXTURE.agents.opencodeAlice,
  );
  check(
    "continuation.contribution_recorded",
    "continuation",
    bContribution !== undefined,
    bContribution === undefined ? "no Agent B contribution in activity" : undefined,
  );

  // --- required preservation (docs/SPRINT_001.md section 15) ---
  const preservedFinding = finalState.findings.find(
    (finding) => finding.id === harnessA.coreFinding.id,
  );
  check(
    "preservation.original_finding_intact",
    "preservation",
    preservedFinding !== undefined &&
      preservedFinding.summary === harnessA.coreFinding.summary &&
      preservedFinding.createdAt === harnessA.coreFinding.createdAt &&
      sameActor(preservedFinding.createdBy, FIXTURE.agents.codexSergio) &&
      preservedFinding.agentSessionId === harnessA.session.id,
    preservedFinding === undefined ? "Agent A core finding missing" : undefined,
  );

  const preservedDecision = finalState.decisions.find(
    (decision) => decision.id === harnessA.decision.id,
  );
  check(
    "preservation.original_decision_intact",
    "preservation",
    preservedDecision !== undefined &&
      preservedDecision.status === "accepted" &&
      preservedDecision.createdAt === harnessA.decision.createdAt &&
      sameActor(preservedDecision.createdBy, FIXTURE.agents.codexSergio),
    preservedDecision === undefined ? "Agent A decision missing" : undefined,
  );

  const preservedArtifact = finalState.artifacts.find(
    (artifact) => artifact.id === harnessA.artifact.id,
  );
  check(
    "preservation.original_artifact_intact",
    "preservation",
    preservedArtifact !== undefined &&
      preservedArtifact.uriOrPath === harnessA.artifact.uriOrPath &&
      preservedArtifact.createdAt === harnessA.artifact.createdAt &&
      sameActor(preservedArtifact.createdBy, FIXTURE.agents.codexSergio),
    preservedArtifact === undefined ? "Agent A artifact missing" : undefined,
  );

  const aContributions = finalState.contributions.filter(
    (entry) => entry.agentSessionId === harnessA.session.id,
  );
  const bContributions = finalState.contributions.filter(
    (entry) => entry.agentSessionId === harnessB.session.id,
  );
  check(
    "preservation.provenance_distinct",
    "preservation",
    harnessA.session.id !== harnessB.session.id &&
      aContributions.length > 0 &&
      bContributions.length > 0 &&
      aContributions.every((entry) => entry.actor.actorId === FIXTURE.agents.codexSergio) &&
      bContributions.every((entry) => entry.actor.actorId === FIXTURE.agents.opencodeAlice),
    `a=${aContributions.length} b=${bContributions.length}`,
  );

  const firstA = finalState.contributions.findIndex(
    (entry) => entry.agentSessionId === harnessA.session.id,
  );
  const lastA = finalState.contributions.reduce(
    (last, entry, index) => (entry.agentSessionId === harnessA.session.id ? index : last),
    -1,
  );
  const firstB = finalState.contributions.findIndex(
    (entry) => entry.agentSessionId === harnessB.session.id,
  );
  check(
    "preservation.activity_append_only_ordered",
    "preservation",
    firstA >= 0 && firstB >= 0 && firstB > lastA,
    `firstA=${firstA} lastA=${lastA} firstB=${firstB}`,
  );

  // --- workspace boundary (docs/SPRINT_001.md section 9) ---
  const visibleWorkspaceIds = harnessB.workspaceIds;
  check(
    "isolation.workspace_list_scoped",
    "isolation",
    visibleWorkspaceIds.length === 1 &&
      visibleWorkspaceIds[0] === FIXTURE.workspaces.billing &&
      !visibleWorkspaceIds.includes(UNRELATED_WORKSPACE_ID),
    `visible=${JSON.stringify(visibleWorkspaceIds)}`,
  );

  const deniedAttempt = harnessB.unauthorizedAttempt;
  check(
    "isolation.unrelated_workspace_denied",
    "isolation",
    deniedAttempt.ok === false &&
      (deniedAttempt.error === "ParticipantRequired" || deniedAttempt.error === "Unauthorized"),
    `ok=${deniedAttempt.ok} error=${deniedAttempt.error ?? "none"}`,
  );

  const harnessBRetrieval = JSON.stringify({
    workspaceIds: harnessB.workspaceIds,
    context: harnessB.context,
    workspace: harnessB.workspace,
    activity: harnessB.activity,
    activityAfterWrites: harnessB.activityAfterWrites,
  });

  check(
    "isolation.no_unrelated_sentinel",
    "isolation",
    !harnessBRetrieval.includes(FIXTURE.unrelatedFindingSentinel),
    undefined,
  );

  // --- transcript isolation (hard constraint) ---
  const sentinelPresent = harnessBRetrieval.includes(PRIVATE_TRANSCRIPT_SENTINEL_A);
  check(
    "transcript.sentinel_absent_from_harness_b",
    "transcript",
    !sentinelPresent,
    sentinelPresent ? "private transcript sentinel leaked into Agent B retrieval" : undefined,
  );

  const comprehensionFailed = checks.some(
    (entry) => entry.category === "comprehension" && !entry.passed,
  );
  const continuationFailed = checks.some(
    (entry) => entry.category === "continuation" && !entry.passed,
  );

  let recommendation: Recommendation;
  if (comprehensionFailed || continuationFailed) {
    recommendation = "NO-GO";
  } else if (checks.some((entry) => !entry.passed)) {
    recommendation = "CONDITIONAL GO";
  } else {
    recommendation = "GO";
  }

  const limitations = [
    'The two harnesses are independent MCP client processes labelled "codex" and "opencode". They exercise the real Campfire stdio MCP server but are not the vendor Codex/OpenCode binaries.',
    "The fixture database is prepared in-process with openSqliteStore/seedFixture rather than by spawning the CLI; this is a setup substitution, not a handoff substitution.",
    "Agent B's continuation is deterministic fixture logic rather than an LLM reasoning over the retrieved state.",
    "Artifacts are references only; Campfire does not read or authorize the referenced file contents in Sprint 001.",
  ];

  const evidence: AcceptanceEvidence = {
    sprint: "001",
    scenario: "Billing deploy investigation handed from Human A + Agent A (codex) to Human B + Agent B (opencode).",
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    environment: collectEnvironment(),
    harnesses: {
      a: {
        actorId: FIXTURE.agents.codexSergio,
        actorType: "agent",
        harness: "codex",
        label: "codex",
        sessionId: harnessA.session.id,
      },
      b: {
        actorId: FIXTURE.agents.opencodeAlice,
        actorType: "agent",
        harness: "opencode",
        label: "opencode",
        sessionId: harnessB.session.id,
      },
    },
    database: { path: databasePath, seeded: true, kept: keepDatabase },
    harnessA,
    harnessB,
    finalState,
    transcriptIsolation: {
      sentinel: PRIVATE_TRANSCRIPT_SENTINEL_A,
      presentInHarnessBRetrieval: sentinelPresent,
      checkedSources: [
        "harnessB.workspaceIds",
        "harnessB.context",
        "harnessB.workspace",
        "harnessB.activity",
        "harnessB.activityAfterWrites",
      ],
    },
    workspaceIsolation: {
      unrelatedWorkspaceId: UNRELATED_WORKSPACE_ID,
      unrelatedSentinel: FIXTURE.unrelatedFindingSentinel,
      visibleWorkspaceIds,
      unrelatedCallDenied: deniedAttempt.ok === false,
    },
    checks,
    limitations,
    recommendation,
  };

  if (!keepDatabase) {
    removeDatabaseFiles(databasePath);
    if (ownsTempDir) {
      rmSync(resolve(databasePath, ".."), { recursive: true, force: true });
    }
  }

  return evidence;
}

export function writeEvidence(evidence: AcceptanceEvidence, directory = "evidence"): string {
  const target = resolve(directory);
  mkdirSync(target, { recursive: true });
  const filePath = join(target, "sprint-001-acceptance.json");
  writeFileSync(filePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return filePath;
}
