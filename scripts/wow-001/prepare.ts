/** Fresh, isolated workspace setup for one WOW-001 scored arm. */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { onboardInstallation } from "../../src/bootstrap/onboard.js";
import { createRuntime } from "../../src/runtime.js";
import type { ActorContext } from "../../src/service/authorization.js";
import {
  REPO_ROOT,
  assertOutsideRepo,
  buildAgentConfig,
  resolvePilotRoot,
  stageRun,
  type Arm,
  type Scenario,
} from "./pilot-lib.js";

const PILOT_MODEL = "opencode-go/deepseek-v4.1-flash";

export interface PreparedArm {
  runId: string;
  runDir: string;
  scenario: Scenario;
  arm: Arm;
  workspaceId: string;
  goalId: string;
  firstAgentId: string;
  secondAgentId: string;
  model: string;
  setupStreamTip: number;
  seeded?: { priorAgentId: string; sessionId: string; artifactId: string; findingId: string };
}

function writePrivate(path: string, value: string): void {
  writeFileSync(path, value, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Creates exactly one fresh arm. No token is printed or placed in /run. */
export function prepareArm(
  scenario: Scenario,
  arm: Arm,
  runId: string,
  options: { authSource?: string } = {},
): PreparedArm {
  const pilotRoot = resolvePilotRoot();
  assertOutsideRepo(pilotRoot);
  const runDir = join(pilotRoot, "runs", runId);
  assertOutsideRepo(runDir);
  if (existsSync(runDir)) throw new Error(`Run directory already exists: ${runDir}`);

  const staged = stageRun({
    repoRoot: REPO_ROOT,
    pilotRoot,
    scenario,
    arm,
    role: "first",
    runId,
    promptValues: {
      scenarioPath: "/run",
      workspaceId: "<workspace-id>",
      deadline: "30 minutes from the start of this run",
    },
  });
  try {
    mkdirSync(join(staged.runDir, "config"), { recursive: true });
    mkdirSync(join(staged.runDir, "campfire"), { recursive: true });
    mkdirSync(join(staged.runDir, "private"), { recursive: true, mode: 0o700 });
    chmodSync(join(staged.runDir, "private"), 0o700);
    mkdirSync(join(staged.runDir, "opencode-data"), { recursive: true });

    const dbPath = join(staged.runDir, "campfire", "campfire.db");
    const runtime = createRuntime({ ...loadConfig(), databasePath: dbPath });
    let receipt: PreparedArm;
    let firstToken = "";
    let secondToken = "";
    try {
      const service = runtime.service;
      const initial = onboardInstallation(runtime.store, service, runtime.config, {
        humanName: "WOW-001 Pilot Owner",
        agentName: "Incident Investigator",
        harness: "opencode",
        workspaceName: `WOW-001 ${scenario} Incident`,
        goal: "Investigate the incident and record supported work",
      });
      const owner: ActorContext = { actor: { actorId: initial.human.id, actorType: "human" } };
      const second = service.createAgent(owner, {
        teamId: initial.team.id,
        humanId: initial.human.id,
        name: "Continuing Agent",
        harness: "opencode",
        model: PILOT_MODEL,
      });
      const secondActor: ActorContext = { actor: { actorId: second.agent.id, actorType: "agent" } };
      service.inviteToWorkspace(owner, {
        workspaceId: initial.workspace.id,
        actor: secondActor.actor,
        role: "agent",
      });
      service.joinWorkspace(secondActor, { workspaceId: initial.workspace.id });
      let seeded: PreparedArm["seeded"];
      if (scenario === "S2") {
        const priorHuman = service.createHuman(owner, {
          teamId: initial.team.id,
          displayName: "S2 Prior Shift Operator",
        });
        const priorOwner: ActorContext = {
          actor: { actorId: priorHuman.human.id, actorType: "human" },
        };
        const priorAgent = service.createAgent(priorOwner, {
          teamId: initial.team.id,
          humanId: priorHuman.human.id,
          name: "S2 Prior Shift Agent",
          harness: "fixture",
        });
        const priorCtx: ActorContext = {
          actor: { actorId: priorAgent.agent.id, actorType: "agent" },
        };
        service.inviteToWorkspace(owner, {
          workspaceId: initial.workspace.id,
          actor: priorCtx.actor,
          role: "agent",
        });
        service.joinWorkspace(priorCtx, { workspaceId: initial.workspace.id });
        const session = service.registerAgentSession(priorCtx, {
          agentId: priorAgent.agent.id,
          workspaceId: initial.workspace.id,
          harness: "fixture",
        });
        priorCtx.agentSessionId = session.id;
        const artifact = service.addArtifact(priorCtx, {
          workspaceId: initial.workspace.id,
          type: "report",
          title: "Payments database dashboard at 09:22 UTC",
          uriOrPath: "evidence/02-database-dashboard.md",
        });
        const finding = service.addFinding(priorCtx, {
          workspaceId: initial.workspace.id,
          summary: "Working hypothesis: EU checkout 503s originate inside checkout-api while it waits for a payments PostgreSQL connection.",
          detail: "Prior-shift note at 2026-10-06 09:23 UTC. The aggregate payments connection-acquisition panel rose during the checkout errors. This is provisional; split the panel by service and inspect failed-request traces to confirm or refute the request path.",
          confidence: 0.45,
        });
        service.citeFindingEvidence(priorCtx, {
          findingId: finding.id,
          artifactId: artifact.id,
          relation: "supports",
        });
        seeded = {
          priorAgentId: priorAgent.agent.id,
          sessionId: session.id,
          artifactId: artifact.id,
          findingId: finding.id,
        };
      }
      receipt = {
        runId,
        runDir,
        scenario,
        arm,
        workspaceId: initial.workspace.id,
        goalId: initial.goal.id,
        firstAgentId: initial.agent.id,
        secondAgentId: second.agent.id,
        model: PILOT_MODEL,
        setupStreamTip: runtime.store.maxAppendPosition(initial.workspace.id),
        ...(seeded === undefined ? {} : { seeded }),
      };
      firstToken = initial.agent.token;
      secondToken = second.token;
      writePrivate(join(staged.runDir, "private", "owner.token"), initial.human.token);
    } finally {
      runtime.close();
    }

    writePrivate(join(staged.runDir, "campfire", "agent.token"), firstToken);
    writePrivate(join(staged.runDir, "private", "second.token"), secondToken);
    const authSource = options.authSource ?? join(homedir(), ".local", "share", "opencode", "auth.json");
    if (!existsSync(authSource)) throw new Error(`Missing OpenCode auth: ${authSource}`);
    const authDestination = join(staged.runDir, "opencode-data", "auth.json");
    copyFileSync(authSource, authDestination);
    chmodSync(authDestination, 0o600);
    writeFileSync(
      join(staged.runDir, "config", "opencode.json"),
      `${JSON.stringify(buildAgentConfig({
        role: "first", arm,
        campfireDb: "/campfire/campfire.db",
        campfireTokenFile: "/campfire/agent.token",
      }), null, 2)}\n`,
    );
    writeFileSync(join(staged.runDir, "config", ".gitignore"),
      "node_modules\npackage.json\npackage-lock.json\nbun.lock\n.gitignore\n");
    const promptPath = join(staged.runDir, "prompt.txt");
    const prompt = readFileSync(promptPath, "utf8").replaceAll("<workspace-id>", receipt.workspaceId);
    writeFileSync(promptPath, prompt);
    writeFileSync(join(staged.runDir, "prepare.json"), `${JSON.stringify(receipt, null, 2)}\n`);
    return receipt;
  } catch (error) {
    // A failed setup is not an attempt. Remove its partial database and tokens
    // so a later operator cannot mistake it for a fresh scored workspace.
    rmSync(staged.runDir, { recursive: true, force: true });
    throw error;
  }
}

export interface PreparedSecond {
  firstRunId: string;
  secondRunId: string;
  runDir: string;
  workspaceId: string;
  scenario: Scenario;
  arm: Arm;
  frozenStreamTip: number;
}

/** Freeze a consistent database snapshot and stage a fresh second-agent run. */
export async function prepareSecond(
  firstRunId: string,
  secondRunId: string,
  options: { authSource?: string } = {},
): Promise<PreparedSecond> {
  const pilotRoot = resolvePilotRoot();
  assertOutsideRepo(pilotRoot);
  const firstRoot = join(pilotRoot, "runs", firstRunId);
  const secondRoot = join(pilotRoot, "runs", secondRunId);
  assertOutsideRepo(firstRoot);
  assertOutsideRepo(secondRoot);
  if (existsSync(secondRoot)) throw new Error(`Run directory already exists: ${secondRoot}`);
  const prep = JSON.parse(readFileSync(join(firstRoot, "prepare.json"), "utf8")) as PreparedArm;
  if (prep.runId !== firstRunId) throw new Error("First-run preparation receipt does not match its run ID");
  const outcome = JSON.parse(readFileSync(join(firstRoot, "run-first.json"), "utf8")) as {
    role?: string; scenario?: string; arm?: string; stopReason?: string;
    exitCode?: number | null; overshoot?: boolean; valid?: boolean;
    toolCallCount?: number; sessionToolCallCount?: number | null;
  };
  if (outcome.role !== "first" || outcome.scenario !== prep.scenario || outcome.arm !== prep.arm) {
    throw new Error("First-run result does not match the prepared arm");
  }
  if (outcome.valid !== true || outcome.overshoot ||
      !["completed", "tool_budget", "time_budget"].includes(outcome.stopReason ?? "") ||
      !Number.isInteger(outcome.toolCallCount) ||
      !Number.isInteger(outcome.sessionToolCallCount) ||
      outcome.toolCallCount !== outcome.sessionToolCallCount ||
      (outcome.stopReason === "completed" && outcome.exitCode !== 0)) {
    throw new Error("First run has an infrastructure or budget failure; preserve it as an invalid attempt");
  }

  const frozenPath = join(firstRoot, "frozen.db");
  if (existsSync(frozenPath)) throw new Error(`Frozen snapshot already exists: ${frozenPath}`);
  const original = new Database(join(firstRoot, "campfire", "campfire.db"), {
    readonly: true, fileMustExist: true,
  });
  let frozenStreamTip: number;
  try {
    const row = original.prepare(
      "SELECT COALESCE(MAX(append_position), 0) AS tip FROM contributions WHERE workspace_id = ?",
    ).get(prep.workspaceId) as { tip: number };
    frozenStreamTip = Number(row.tip);
    await original.backup(frozenPath);
  } finally {
    original.close();
  }
  chmodSync(frozenPath, 0o444);

  const staged = stageRun({
    repoRoot: REPO_ROOT,
    pilotRoot,
    scenario: prep.scenario,
    arm: prep.arm,
    role: "second",
    runId: secondRunId,
    promptValues: {
      scenarioPath: "/run",
      workspaceId: prep.workspaceId,
      deadline: "10 minutes from the start of this run",
    },
  });
  mkdirSync(join(staged.runDir, "config"), { recursive: true });
  mkdirSync(join(staged.runDir, "campfire"), { recursive: true });
  mkdirSync(join(staged.runDir, "opencode-data"), { recursive: true });
  copyFileSync(frozenPath, join(staged.runDir, "campfire", "campfire.db"));
  copyFileSync(join(firstRoot, "private", "second.token"), join(staged.runDir, "campfire", "agent.token"));
  chmodSync(join(staged.runDir, "campfire", "agent.token"), 0o600);
  const authSource = options.authSource ?? join(homedir(), ".local", "share", "opencode", "auth.json");
  copyFileSync(authSource, join(staged.runDir, "opencode-data", "auth.json"));
  chmodSync(join(staged.runDir, "opencode-data", "auth.json"), 0o600);
  writeFileSync(join(staged.runDir, "config", "opencode.json"),
    `${JSON.stringify(buildAgentConfig({
      role: "second", arm: prep.arm,
      campfireDb: "/campfire/campfire.db",
      campfireTokenFile: "/campfire/agent.token",
    }), null, 2)}\n`);
  writeFileSync(join(staged.runDir, "config", ".gitignore"),
    "node_modules\npackage.json\npackage-lock.json\nbun.lock\n.gitignore\n");
  const receipt: PreparedSecond = {
    firstRunId, secondRunId, runDir: staged.runDir,
    workspaceId: prep.workspaceId, scenario: prep.scenario, arm: prep.arm, frozenStreamTip,
  };
  writeFileSync(join(staged.runDir, "prepare-second.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}
