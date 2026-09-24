/**
 * Sprint 002 real-harness acceptance orchestrator.
 *
 * Runs a genuine Codex process as Agent A and a genuine OpenCode process as
 * Agent B against one Campfire SQLite database, captures both runs, evaluates
 * the Sprint 002 checks, and writes the evidence tree. Agent A's process is
 * fully terminated before Agent B starts.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE, seedFixture } from "../../bootstrap/seed.js";
import { CampfireError } from "../../domain/errors.js";
import { createCampfireService } from "../../service/campfire-service.js";
import type { ActorContext } from "../../service/authorization.js";
import type { CampfireService } from "../../service/service.js";
import { openSqliteStore } from "../../store/sqlite-store.js";
import { computeChecks, recommend } from "./checks.js";
import { writeRealEvidence } from "./evidence.js";
import { detectVersion } from "./harness-common.js";
import { runCodexHarness } from "./harness-codex.js";
import { runOpencodeHarness } from "./harness-opencode.js";
import { analyzeErgonomics } from "./ergonomics.js";
import { AGENT_A_INSTRUCTION, AGENT_B_INSTRUCTION, PRIVATE_TRANSCRIPT_SENTINEL_A } from "./prompts.js";
import { SESSION_A_ID, SESSION_B_ID, createHarnessSessions } from "./sessions.js";
import type {
  CampfireSnapshot,
  HarnessRunResult,
  RealAcceptanceEvidence,
} from "./types.js";

const CAMPFIRE_REPO = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

export const UNRELATED_WORKSPACE_ID = FIXTURE.workspaces.unrelated;
export const UNRELATED_SENTINEL = FIXTURE.unrelatedFindingSentinel;

export interface RunRealAcceptanceOptions {
  /** Explicit root directory (created if absent). Defaults to a temp dir. */
  rootDir?: string;
  /** Keep the temporary workspace + raw harness captures after the run. */
  keepArtifacts?: boolean;
  codexModel?: string;
  opencodeModel?: string;
  timeoutMsA?: number;
  timeoutMsB?: number;
  evidenceDir?: string;
  /**
   * Test seam: replace a real harness process with a stub. Production callers
   * never set these; the acceptance run uses the real vendor CLIs.
   */
  runHarnessA?: HarnessRunner;
  runHarnessB?: HarnessRunner;
}

export interface HarnessInvocation {
  databasePath: string;
  workdir: string;
  actorId: string;
  agentSessionId: string;
  prompt: string;
}

export type HarnessRunner = (invocation: HarnessInvocation) => HarnessRunResult;

export interface RealAcceptanceResult {
  evidence: RealAcceptanceEvidence;
  evidenceDir: string;
  rootDir: string;
}

function capture(service: CampfireService, ctx: ActorContext, workspaceId: string): CampfireSnapshot {
  return {
    workspaceId,
    capturedAt: new Date().toISOString(),
    view: service.getWorkspace(ctx, workspaceId),
  };
}

function prepareWorkdir(root: string, name: string): string {
  const workdir = join(root, name);
  rmSync(workdir, { recursive: true, force: true });
  // Expose only the task-relevant billing fixture. The unrelated-workspace
  // fixture and the reference split plan must not be handed to either agent:
  // the first is a private-workspace sentinel, the second is the answer the
  // incoming agent is supposed to reason toward.
  mkdirSync(join(workdir, "fixtures"), { recursive: true });
  cpSync(join(CAMPFIRE_REPO, "fixtures", "billing"), join(workdir, "fixtures", "billing"), {
    recursive: true,
  });
  return workdir;
}

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/** Run the full Sprint 002 acceptance and return the captured evidence. */
export async function runRealAcceptance(
  options: RunRealAcceptanceOptions = {},
): Promise<RealAcceptanceResult> {
  const startedAt = new Date().toISOString();
  const root = options.rootDir ?? mkdtempSync(join(tmpdir(), "campfire-sprint002-"));
  const dbPath = join(root, "campfire.db");
  for (const sibling of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    rmSync(sibling, { force: true });
  }

  const workdirA = prepareWorkdir(root, "harness-a-work");
  const workdirB = prepareWorkdir(root, "harness-b-work");

  const store = openSqliteStore(dbPath);
  seedFixture(store);
  createHarnessSessions(store);
  const service = createCampfireService({ store });

  const ctxSergio: ActorContext = {
    actor: { actorId: FIXTURE.humans.sergio, actorType: "human" },
  };
  const ctxAgentB: ActorContext = {
    actor: { actorId: FIXTURE.agents.opencodeAlice, actorType: "agent" },
    agentSessionId: SESSION_B_ID,
  };

  const rawA = join(root, "harness-a.jsonl");
  const rawAErr = join(root, "harness-a.stderr.log");
  const lastA = join(root, "harness-a.last-message.txt");
  const rawB = join(root, "harness-b.jsonl");
  const rawBErr = join(root, "harness-b.stderr.log");

  let harnessA: HarnessRunResult;
  let harnessB: HarnessRunResult;
  let stateBeforeB: CampfireSnapshot;
  let stateAfterB: CampfireSnapshot;
  let visibleWorkspaceIds: string[] = [];
  let unrelatedReadDenied = false;

  const runnerA: HarnessRunner =
    options.runHarnessA ??
    ((invocation) =>
      runCodexHarness({
        actorId: invocation.actorId,
        agentSessionId: invocation.agentSessionId,
        databasePath: invocation.databasePath,
        campfireRepo: CAMPFIRE_REPO,
        workdir: invocation.workdir,
        prompt: invocation.prompt,
        rawStdoutPath: rawA,
        rawStderrPath: rawAErr,
        lastMessagePath: lastA,
        model: options.codexModel,
        timeoutMs: options.timeoutMsA ?? 15 * 60_000,
      }));

  const runnerB: HarnessRunner =
    options.runHarnessB ??
    ((invocation) =>
      runOpencodeHarness({
        actorId: invocation.actorId,
        agentSessionId: invocation.agentSessionId,
        databasePath: invocation.databasePath,
        campfireRepo: CAMPFIRE_REPO,
        workdir: invocation.workdir,
        prompt: invocation.prompt,
        rawStdoutPath: rawB,
        rawStderrPath: rawBErr,
        model: options.opencodeModel,
        timeoutMs: options.timeoutMsB ?? 20 * 60_000,
      }));

  try {
    harnessA = runnerA({
      databasePath: dbPath,
      workdir: workdirA,
      actorId: FIXTURE.agents.codexSergio,
      agentSessionId: SESSION_A_ID,
      prompt: AGENT_A_INSTRUCTION,
    });

    // Snapshot after Agent A, before Agent B: this is the state Agent B must
    // recover unaided.
    stateBeforeB = capture(service, ctxSergio, FIXTURE.workspaces.billing);

    harnessB = runnerB({
      databasePath: dbPath,
      workdir: workdirB,
      actorId: FIXTURE.agents.opencodeAlice,
      agentSessionId: SESSION_B_ID,
      prompt: AGENT_B_INSTRUCTION,
    });

    stateAfterB = capture(service, ctxSergio, FIXTURE.workspaces.billing);

    visibleWorkspaceIds = service.listWorkspaces(ctxAgentB).map((workspace) => workspace.id);
    try {
      service.getWorkspaceContext(ctxAgentB, UNRELATED_WORKSPACE_ID);
      unrelatedReadDenied = false;
    } catch (error) {
      unrelatedReadDenied = error instanceof CampfireError;
    }
  } finally {
    service.close();
  }

  const before = stateBeforeB.view;
  const acceptedDecision = before.decisions.find((decision) => decision.status === "accepted");
  const openTask = before.tasks.find((task) => task.status === "open");
  const agentAOriginal = {
    findingIds: before.findings.map((finding) => finding.id),
    decisionId: acceptedDecision?.id ?? "",
    taskId: openTask?.id ?? "",
    artifactId: before.artifacts[0]?.id ?? "",
  };

  const ergonomics = analyzeErgonomics(harnessB.mcpCalls);
  const humanInterventions: RealAcceptanceEvidence["humanInterventions"] = [];

  const checks = computeChecks({
    harnessA,
    harnessB,
    stateBeforeB,
    stateAfterB,
    agentAOriginal,
    sentinels: {
      privateSentinel: PRIVATE_TRANSCRIPT_SENTINEL_A,
      unrelatedSentinel: UNRELATED_SENTINEL,
    },
    unrelatedWorkspaceId: UNRELATED_WORKSPACE_ID,
    visibleWorkspaceIds,
    unrelatedReadDenied,
    humanInterventions,
    ergonomics,
  });
  const recommendation = recommend(checks);

  const finishedAt = new Date().toISOString();
  const evidence: RealAcceptanceEvidence = {
    sprint: "002",
    scenario:
      "Real Codex (Agent A) investigates a billing deploy failure and records team state in Campfire; a separate real OpenCode process (Agent B) must recover and continue it without Agent A's transcript.",
    startedAt,
    finishedAt,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      harnessA: {
        kind: "codex",
        version: detectVersion("codex"),
        model: options.codexModel,
        actorId: FIXTURE.agents.codexSergio,
        sessionId: SESSION_A_ID,
      },
      harnessB: {
        kind: "opencode",
        version: detectVersion("opencode"),
        model: options.opencodeModel,
        actorId: FIXTURE.agents.opencodeAlice,
        sessionId: SESSION_B_ID,
      },
    },
    prompts: { agentA: AGENT_A_INSTRUCTION, agentB: AGENT_B_INSTRUCTION },
    stateBeforeB,
    stateAfterB,
    harnessA,
    harnessB,
    ergonomics,
    transcriptIsolation: {
      sentinel: PRIVATE_TRANSCRIPT_SENTINEL_A,
      presentInHarnessBRetrieval: false,
      presentInCampfire: false,
      checkedSources: [
        "harnessB.finalMessage",
        "harnessB.mcpCalls.output",
        "harnessB.rawStdoutPath",
        "stateAfterB.view",
      ],
    },
    workspaceIsolation: {
      unrelatedWorkspaceId: UNRELATED_WORKSPACE_ID,
      unrelatedSentinel: UNRELATED_SENTINEL,
      visibleWorkspaceIds,
      unrelatedReadDenied,
      unrelatedSentinelAbsent: !JSON.stringify(stateAfterB.view).includes(UNRELATED_SENTINEL),
    },
    humanInterventions,
    checks,
    limitations: [
      "Harness B is a second real vendor harness (OpenCode) rather than Claude Code because Claude Code's OAuth token had expired and required interactive re-authentication; Codex remained Harness A as originally planned.",
      "The Campfire database and pre-bound agent sessions are prepared in-process before the harnesses start; this is setup, not a handoff substitution.",
      "Artifacts are references only; Campfire does not read or authorize the referenced file contents.",
      "The Agent B task instruction is minimal but names Campfire and the fixture directory; it reveals none of Agent A's findings, decision, task, or artifact.",
    ],
    recommendation,
  };

  // Derive the isolation flags the checks actually observed, for the record.
  evidence.transcriptIsolation.presentInHarnessBRetrieval =
    harnessB.rawStdoutPath !== "" &&
    readIfExists(harnessB.rawStdoutPath).includes(PRIVATE_TRANSCRIPT_SENTINEL_A);
  evidence.transcriptIsolation.presentInCampfire = JSON.stringify(stateAfterB.view).includes(
    PRIVATE_TRANSCRIPT_SENTINEL_A,
  );

  const written = writeRealEvidence(evidence, options.evidenceDir);

  if (options.keepArtifacts === false) {
    rmSync(root, { recursive: true, force: true });
  }

  return { evidence, evidenceDir: written.directory, rootDir: root };
}

export { CAMPFIRE_REPO };
