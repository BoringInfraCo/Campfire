/**
 * ACT-001 Step 0 synthetic workspace.
 *
 * FIXTURE EVIDENCE — frozen ids from docs/evidence/act-001/step-0/workspace-fixture.json.
 * Not live GitHub, not a human observation, and not a sprint verdict.
 *
 *   CAMPFIRE_TELEMETRY=0 npx tsx fixtures/act-001/seed.ts --out fixtures/act-001/.tmp/served --force
 *
 * Writes campfire.db under the output directory. Does not write GitHub
 * credentials. Tokens in the returned object are local actor secrets for
 * isolated tests only.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CampfireError } from "../../src/domain/errors.js";
import { ID_PREFIXES, type IdKind, type IdSource } from "../../src/domain/ids.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";

const DEFAULT_OUT = resolve(new URL(".", import.meta.url).pathname, ".tmp", "served");
export const ACT001_SEED_CLOCK = "2026-10-21T12:00:00.000Z";
const SEED_BASE_MS = Date.parse(ACT001_SEED_CLOCK);
const CLOCK_STEP_MS = 1000;

export const ACT001 = {
  org: "org_act001",
  team: "team_act001",
  workspace: "ws_act001_lab",
  otherWorkspace: "ws_act001_other",
  goal: "goal_act001_verify",
  task: "task_act001_verify",
  findings: {
    logs: "find_act001_logs",
    stale: "find_act001_stale",
    baseline: "find_act001_baseline",
  },
  artifact: "art_act001_runref",
  humans: {
    owner: "hum_act001_ada",
    member: "hum_act001_ben",
    viewer: "hum_act001_val",
    nonParticipant: "hum_act001_zed",
  },
  agents: {
    proposing: "agt_act001_codex_ada",
    executing: "agt_act001_opencode_ben",
    expired: "agt_act001_old_codex",
    unregistered: "agt_act001_ghost",
    integration: "agt_act001_integration",
  },
  sessions: {
    proposing: "ses_act001_codex_01",
    executing: "ses_act001_opencode_01",
    expired: "ses_act001_expired_01",
    integration: "ses_act001_integration_01",
  },
  target: {
    repositoryId: "123456789",
    repositoryName: "example-org/verification-sandbox",
    workflowId: "9876543",
    runId: "11223344",
    commitSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    expectedAttempt: 2,
    observedFailedAttempt: 1,
  },
  sourceId: "src_act001_github",
} as const;

const PLANNED: Partial<Record<IdKind, string[]>> = {
  human: [ACT001.humans.owner, ACT001.humans.member, ACT001.humans.viewer, ACT001.humans.nonParticipant],
  workspace: [ACT001.workspace, ACT001.otherWorkspace],
  goal: [ACT001.goal],
  finding: [ACT001.findings.stale, ACT001.findings.baseline, ACT001.findings.logs],
  artifact: [ACT001.artifact],
  task: [ACT001.task],
  agent: [
    ACT001.agents.proposing,
    ACT001.agents.executing,
    ACT001.agents.expired,
    ACT001.agents.unregistered,
    ACT001.agents.integration,
  ],
  agentSession: [
    ACT001.sessions.proposing,
    ACT001.sessions.executing,
    ACT001.sessions.expired,
    ACT001.sessions.integration,
  ],
};

function fail(message: string): never {
  throw new Error(`act-001 seed: ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function queueSource(): { source: IdSource; assertEmpty: () => void } {
  const pending: Partial<Record<IdKind, string[]>> = {};
  for (const [kind, ids] of Object.entries(PLANNED) as Array<[IdKind, string[]]>) pending[kind] = [...ids];
  const counters = new Map<IdKind, number>();
  return {
    source: (kind) => {
      const pinned = pending[kind]?.shift();
      if (pinned !== undefined) return pinned;
      const next = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, next);
      return `${ID_PREFIXES[kind]}_act001_${String(next).padStart(4, "0")}`;
    },
    assertEmpty: () => {
      for (const [kind, ids] of Object.entries(pending)) {
        if (ids.length !== 0) fail(`unused ${kind} ids: ${ids.join(", ")}`);
      }
    },
  };
}

function seedClock(): { tick: () => string; next: () => string } {
  let current = SEED_BASE_MS;
  return {
    tick: () => {
      const value = new Date(current).toISOString();
      current += CLOCK_STEP_MS;
      return value;
    },
    next: () => new Date(current).toISOString(),
  };
}

function human(id: string): ActorContext {
  return { actor: { actorId: id, actorType: "human" } };
}

function agent(id: string, sessionId?: string): ActorContext {
  return sessionId === undefined
    ? { actor: { actorId: id, actorType: "agent" } }
    : { actor: { actorId: id, actorType: "agent" }, agentSessionId: sessionId };
}

function caught(fn: () => unknown): { code: string; message: string } {
  try {
    fn();
  } catch (error) {
    if (error instanceof CampfireError) {
      return { code: error.code, message: error.message };
    }
    throw error;
  }
  fail("expected a domain error");
}

export interface Act001SeedResult {
  label: "FIXTURE EVIDENCE";
  seedClock: string;
  workspaceId: string;
  otherWorkspaceId: string;
  goalId: string;
  taskId: string;
  findings: { logs: string; stale: string; baseline: string };
  artifactId: string;
  humans: typeof ACT001.humans;
  agents: typeof ACT001.agents;
  sessions: typeof ACT001.sessions;
  tokens: {
    owner: string;
    member: string;
    proposing: string;
    executing: string;
    integration: string;
  };
  contributionCounts: { lab: number; other: number };
}

export function seedAct001Database(databasePath: string): Act001SeedResult {
  const queued = queueSource();
  const { tick } = seedClock();
  const store = openSqliteStore(databasePath);
  const service = createCampfireService({ store, idSource: queued.source, clock: tick });
  const ada = human(ACT001.humans.owner);
  const ben = human(ACT001.humans.member);
  const val = human(ACT001.humans.viewer);
  const zed = human(ACT001.humans.nonParticipant);
  try {
    const now = tick();
    store.createOrganization({ id: ACT001.org, name: "ACT-001 fixture", createdAt: now });
    store.createTeam({
      id: ACT001.team,
      organizationId: ACT001.org,
      name: "ACT-001 fixture team",
      createdAt: tick(),
    });

    const adaHuman = service.createHuman(undefined, { teamId: ACT001.team, displayName: "Ada" });
    assertEqual(adaHuman.human.id, ACT001.humans.owner, "Ada id");
    const benHuman = service.createHuman(ada, { teamId: ACT001.team, displayName: "Ben" });
    assertEqual(benHuman.human.id, ACT001.humans.member, "Ben id");
    const valCreated = service.createHuman(ada, { teamId: ACT001.team, displayName: "Val" });
    assertEqual(valCreated.human.id, ACT001.humans.viewer, "Val id");
    const zedHuman = service.createHuman(ada, { teamId: ACT001.team, displayName: "Zed" });
    assertEqual(zedHuman.human.id, ACT001.humans.nonParticipant, "Zed id");

    const proposing = service.createAgent(ada, {
      teamId: ACT001.team,
      humanId: ACT001.humans.owner,
      name: "proposing-codex",
      harness: "codex",
    });
    assertEqual(proposing.agent.id, ACT001.agents.proposing, "proposing agent");
    const executing = service.createAgent(ben, {
      teamId: ACT001.team,
      humanId: ACT001.humans.member,
      name: "executing-opencode",
      harness: "opencode",
    });
    assertEqual(executing.agent.id, ACT001.agents.executing, "executing agent");
    const expired = service.createAgent(ada, {
      teamId: ACT001.team,
      humanId: ACT001.humans.owner,
      name: "expired-codex",
      harness: "codex",
    });
    assertEqual(expired.agent.id, ACT001.agents.expired, "expired agent");
    const unregistered = service.createAgent(ben, {
      teamId: ACT001.team,
      humanId: ACT001.humans.member,
      name: "unregistered-opencode",
      harness: "opencode",
    });
    assertEqual(unregistered.agent.id, ACT001.agents.unregistered, "unregistered agent");
    const integration = service.createAgent(ada, {
      teamId: ACT001.team,
      humanId: ACT001.humans.owner,
      name: "integration",
      harness: "campfire-integration",
    });
    assertEqual(integration.agent.id, ACT001.agents.integration, "integration agent");

    const lab = service.createWorkspace(ada, { teamId: ACT001.team, name: "act-001 lab" });
    assertEqual(lab.id, ACT001.workspace, "lab id");

    const grant = (actor: ActorContext["actor"], role: "member" | "viewer") => {
      service.inviteToWorkspace(ada, { workspaceId: ACT001.workspace, actor, role });
      service.joinWorkspace({ actor }, { workspaceId: ACT001.workspace });
    };
    grant({ actorId: ACT001.humans.member, actorType: "human" }, "member");
    grant({ actorId: ACT001.humans.viewer, actorType: "human" }, "viewer");
    grant({ actorId: ACT001.agents.proposing, actorType: "agent" }, "member");
    grant({ actorId: ACT001.agents.executing, actorType: "agent" }, "member");
    grant({ actorId: ACT001.agents.expired, actorType: "agent" }, "member");
    grant({ actorId: ACT001.agents.unregistered, actorType: "agent" }, "member");
    grant({ actorId: ACT001.agents.integration, actorType: "agent" }, "member");

    const goal = service.createGoal(ada, {
      workspaceId: ACT001.workspace,
      title: "Retry one failed verification run under human approval",
    });
    assertEqual(goal.id, ACT001.goal, "goal id");

    const proposingSession = service.registerAgentSession(agent(ACT001.agents.proposing), {
      agentId: ACT001.agents.proposing,
      workspaceId: ACT001.workspace,
      harness: "codex",
    });
    assertEqual(proposingSession.id, ACT001.sessions.proposing, "proposing session");
    const executingSession = service.registerAgentSession(agent(ACT001.agents.executing), {
      agentId: ACT001.agents.executing,
      workspaceId: ACT001.workspace,
      harness: "opencode",
    });
    assertEqual(executingSession.id, ACT001.sessions.executing, "executing session");
    const expiredSession = service.registerAgentSession(agent(ACT001.agents.expired), {
      agentId: ACT001.agents.expired,
      workspaceId: ACT001.workspace,
      harness: "codex",
    });
    assertEqual(expiredSession.id, ACT001.sessions.expired, "expired session");
    service.endAgentSession(agent(ACT001.agents.expired, ACT001.sessions.expired), ACT001.sessions.expired);
    const integrationSession = service.registerAgentSession(agent(ACT001.agents.integration), {
      agentId: ACT001.agents.integration,
      workspaceId: ACT001.workspace,
      harness: "campfire-integration",
    });
    assertEqual(integrationSession.id, ACT001.sessions.integration, "integration session");

    const proposeCtx = agent(ACT001.agents.proposing, ACT001.sessions.proposing);
    service.addFinding(proposeCtx, {
      workspaceId: ACT001.workspace,
      summary: "The failure looked environmental.",
      detail: "Superseded after the pinned SHA reproduced the failure.",
    });
    service.correctFinding(proposeCtx, {
      findingId: ACT001.findings.stale,
      summary: "The failure reproduces on the pinned SHA; a retry is meaningful.",
      reason: "The same jobs failed again on the frozen commit.",
    });
    service.addArtifact(proposeCtx, {
      workspaceId: ACT001.workspace,
      type: "pull_request",
      title: "Failed verification run 11223344 attempt 1",
      uriOrPath: "https://github.com/example-org/verification-sandbox/actions/runs/11223344",
    });
    const task = service.createTask(ben, {
      workspaceId: ACT001.workspace,
      title: "Inspect the failed verify run and propose a retry",
    });
    assertEqual(task.id, ACT001.task, "task id");
    service.updateTask(ben, { taskId: ACT001.task, status: "in_progress" });
    service.addFinding(proposeCtx, {
      workspaceId: ACT001.workspace,
      summary: "Jobs verify-unit and verify-build failed on the pinned SHA; no deploy step exists at that revision.",
      sourceArtifactId: ACT001.artifact,
    });

    const other = service.createWorkspace(zed, { teamId: ACT001.team, name: "act-001 other" });
    assertEqual(other.id, ACT001.otherWorkspace, "other workspace");

    queued.assertEmpty();

    const stale = service.getFindingInWorkspace(ada, ACT001.workspace, ACT001.findings.stale);
    const baseline = service.getFindingInWorkspace(ada, ACT001.workspace, ACT001.findings.baseline);
    const logs = service.getFindingInWorkspace(ada, ACT001.workspace, ACT001.findings.logs);
    const artifact = service.getArtifactInWorkspace(ada, ACT001.workspace, ACT001.artifact);
    const savedTask = service.getTaskInWorkspace(ada, ACT001.workspace, ACT001.task);
    assertEqual(stale.currentness, "superseded", "stale currentness");
    assertEqual(stale.successorId, ACT001.findings.baseline, "stale successor");
    assertEqual(baseline.currentness, "current", "baseline currentness");
    assertEqual(logs.currentness, "current", "logs currentness");
    assertEqual(artifact.id, ACT001.artifact, "artifact id");
    assertEqual(savedTask.status, "in_progress", "task status");
    assert(store.getAgentSession(ACT001.sessions.expired)?.endedAt !== undefined, "expired session ended");
    assertEqual(store.getAgentSession(ACT001.sessions.proposing)?.endedAt, undefined, "proposing session open");
    assert(
      store.listAgentSessions(ACT001.workspace).every((session) => session.agentId !== ACT001.agents.unregistered),
      "unregistered agent has no session",
    );

    const adaOnOther = caught(() => service.getWorkspaceContext(ada, ACT001.otherWorkspace));
    const zedOnLab = caught(() => service.getWorkspaceContext(zed, ACT001.workspace));
    assertEqual(adaOnOther.code, "ParticipantRequired", "Ada denial");
    assertEqual(zedOnLab.code, "ParticipantRequired", "Zed denial");

    return {
      label: "FIXTURE EVIDENCE",
      seedClock: ACT001_SEED_CLOCK,
      workspaceId: ACT001.workspace,
      otherWorkspaceId: ACT001.otherWorkspace,
      goalId: ACT001.goal,
      taskId: ACT001.task,
      findings: { ...ACT001.findings },
      artifactId: ACT001.artifact,
      humans: ACT001.humans,
      agents: ACT001.agents,
      sessions: ACT001.sessions,
      tokens: {
        owner: adaHuman.token,
        member: benHuman.token,
        proposing: proposing.token,
        executing: executing.token,
        integration: integration.token,
      },
      contributionCounts: {
        lab: store.listContributions(ACT001.workspace).length,
        other: store.listContributions(ACT001.otherWorkspace).length,
      },
    };
  } finally {
    service.close();
  }
}

function parseArgs(argv: string[]): { out: string; force: boolean } {
  let out = DEFAULT_OUT;
  let force = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--out") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) fail("--out requires a directory");
      out = isAbsolute(value) ? value : resolve(value);
      index += 1;
      continue;
    }
    fail(`unknown argument ${arg ?? ""}`);
  }
  return { out, force };
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const databasePath = resolve(args.out, "campfire.db");
  if (!args.force && existsSync(databasePath)) {
    fail(`seed already exists at ${args.out}; pass --force to replace it`);
  }
  mkdirSync(args.out, { recursive: true });
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (existsSync(path)) rmSync(path);
  }
  const answer = seedAct001Database(databasePath);
  process.stdout.write(`${JSON.stringify({ ...answer, tokens: undefined }, null, 2)}\n`);
}
