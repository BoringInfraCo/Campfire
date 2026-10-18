/**
 * ONB-001 Step 0 — returning-operator baseline capture (journey C) and the
 * scripted `onboard` receipts.
 *
 * FIXTURE EVIDENCE — scripted engineering captures of the published v1.22.0
 * CLI. A scripted PTY run is a debugging rehearsal, never human evidence.
 *
 *   npx tsx fixtures/onb-001/capture-return.ts \
 *     --root <clean v1.22.0 worktree> [--out docs/evidence/onb-001]
 *
 * Cases:
 *   C1  returning, no workspace, bare `campfire` in a terminal (human receipt)
 *   C2  returning, no workspace, bare `campfire` piped (human stays human)
 *   C3  returning, no workspace, `--output json` (profile status JSON)
 *   C4  returning, no workspace, `campfire status` in a terminal (human)
 *   C5  returning, no workspace, `campfire status --output json`
 *   C6  returning, stored workspace, bare `campfire` in a terminal
 *   C7  returning, stored workspace, bare `campfire` piped
 *   C8  returning, stored workspace, `--output json`
 *   C9  returning, stored workspace, `campfire status` in a terminal
 *   C10 returning, stored workspace, `campfire status --output json`
 *   C11 returning, stored workspace, `campfire up --no-connect` in a terminal
 *   C12 returning, stored workspace, `up --no-connect --no-open --output json`
 *   C13 `onboard --output json` on a fresh installation (one-time tokens shown)
 *   C14 `onboard` on a fresh installation, human receipt (tokens not shown)
 *
 * Preconditions use only shipped commands in isolated scenarios: C1–C5 start
 * from `campfire --human-name Ada --output json` (profile, no workspace);
 * C6–C12 start from the scripted `campfire onboard ... --output json`.
 * No harness process runs; `up` cases use --no-connect and --no-open or
 * CAMPFIRE_NO_BROWSER=1.
 */
import { join } from "node:path";
import {
  Evidence,
  createScenario,
  destroyScenario,
  runPiped,
  scenarioEnv,
  sleep,
  startDaemon,
  type Scenario,
} from "./lib/capture.js";
import { runPty } from "./lib/pty.js";
import {
  machineFacts,
  newCase,
  parseToolArgs,
  ToolRun,
  verifyBaselineRoot,
  type CaseRecord,
} from "./lib/tool.js";

const NAME = "onb-001 capture-return";
const args = parseToolArgs(process.argv.slice(2), NAME);
const baseline = verifyBaselineRoot(NAME, args.root);
const evidence = new Evidence(args.out, [process.env.HOME ?? ""]);
const run = new ToolRun(NAME, baseline);

const WORKSPACE_NAME = "billing-deploy-failure";
const GOAL = "Restore the billing deploy pipeline";

const scenarios: Scenario[] = [];
function acquireScenario(name: string): Scenario {
  const created = createScenario(name);
  scenarios.push(created);
  return created;
}

function cliArgv(argv: string[]): string[] {
  return [join(args.root, "node_modules/.bin/tsx"), join(args.root, "src/cli/index.ts"), ...argv];
}

async function waitFor(condition: () => boolean, label: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function captureFile(
  record: CaseRecord,
  relPath: string,
  content: string,
  kind: string,
  expectContains: string[] = [],
  expectAbsent: string[] = [],
): void {
  const options = { kind, expectContains, expectAbsent };
  const failed = evidence.evaluate(content, options);
  run.markFailed(
    record,
    failed.map((failure) => `${relPath}: ${failure}`),
  );
  record.files.push(evidence.write(relPath, content, options));
}

interface CaseMeta {
  id: string;
  journey: "A" | "C";
  title: string;
  method: "pty" | "piped";
  argvDisplay: string[];
  fileBase: string;
  envCase?: Record<string, string>;
  simulated?: string[];
  real?: string[];
  notCaptured?: string[];
}

/** Creates the returning no-workspace profile precondition in this scenario. */
function prepareProfile(s: Scenario): void {
  const prep = runPiped({ root: args.root, scenario: s, argv: ["--human-name", "Ada", "--output", "json"] });
  if (prep.exitCode !== 0) throw new Error(`profile precondition failed: ${prep.stderr.slice(0, 300)}`);
}

/** Creates the scripted onboarded profile (workspace + goal + agent) precondition. */
function prepareOnboarded(s: Scenario): void {
  const prep = runPiped({ root: args.root, scenario: s, argv: onboardArgv([]) });
  if (prep.exitCode !== 0) throw new Error(`onboard precondition failed: ${prep.stderr.slice(0, 300)}`);
}

function onboardArgv(extra: string[]): string[] {
  return [
    "onboard",
    "--human-name", "Ada",
    "--agent-name", "Codex",
    "--harness", "codex",
    "--workspace-name", WORKSPACE_NAME,
    "--goal", GOAL,
    ...extra,
  ];
}

const PREP_NOTES = {
  simulated: [
    "the returning profile/database is created by shipped commands in an isolated CAMPFIRE_CONFIG_DIR (no real profile exists or is touched)",
  ],
  real: [
    "campfire v1.22.0 CLI run from the pinned worktree via tsx",
    "loopback listeners bound with --port 0 / --viewer-port 0",
  ],
};

async function runCase(
  meta: CaseMeta,
  body: (record: CaseRecord, s: Scenario) => Promise<void> | void,
): Promise<CaseRecord> {
  const s = acquireScenario(meta.id.toLowerCase());
  const record = newCase({
    id: meta.id,
    journey: meta.journey,
    title: meta.title,
    method: meta.method,
    argvDisplay: meta.argvDisplay,
    envCase: meta.envCase ?? {},
    simulated: meta.simulated ?? [],
    real: meta.real ?? [],
    notCaptured: meta.notCaptured ?? [],
  });
  try {
    await body(record, s);
  } catch (error) {
    run.markFailed(record, [error instanceof Error ? error.message : String(error)]);
  }
  run.add(record);
  return record;
}

/** Shared label set for every bare/status return case (no listener involved). */
const NO_LISTENER_ABSENT = ["[campfire] HTTP", "http://127.0.0.1", "cft_", "cfe_"];

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  // C1–C3 — returning profile, no workspace
  // -------------------------------------------------------------------------
  await runCase(
    {
      id: "C1",
      journey: "C",
      title: "returning profile, no workspace, bare campfire in a terminal (human receipt, no listener)",
      method: "pty",
      argvDisplay: ["campfire"],
      fileBase: "C1-return-no-workspace-pty",
      ...PREP_NOTES,
      notCaptured: ["any listener (a returning bare `campfire` prints status only)"],
    },
    (record, s) => {
      prepareProfile(s);
      const result = runPty({ argv: cliArgv([]), cwd: s.base, env: scenarioEnv(s), steps: [], timeoutMs: 30_000 });
      record.exitCode = result.exitCode;
      record.timedOut = result.timedOut;
      record.checks = { stepsSent: result.stepsSent, stepsTotal: result.stepsTotal, driverError: result.driverError ?? null };
      captureFile(
        record,
        "terminal/C1-return-no-workspace-pty.stream.txt",
        result.stream.toString("utf8"),
        "pty-stream",
        [
          "  campfire\n",
          "  the shared workspace for people and their agents\n",
          "  You        Ada\n",
          "  Waiting for an agent to start work.",
          "  Past sessions are not imported.",
          "  campfire up     start the local API and Viewer",
          "  campfire --help",
        ],
        NO_LISTENER_ABSENT,
      );
      run.markFailed(record, [
        ...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : []),
        ...(result.driverError !== undefined ? [`pty driver error: ${result.driverError}`] : []),
      ]);
    },
  );

  await runCase(
    {
      id: "C2",
      journey: "C",
      title: "returning profile, no workspace, bare campfire piped (bare stays human)",
      method: "piped",
      argvDisplay: ["campfire"],
      fileBase: "C2-return-no-workspace-piped",
      envCase: { stdoutIsTty: "false (piped)" },
      ...PREP_NOTES,
    },
    (record, s) => {
      prepareProfile(s);
      const result = runPiped({ root: args.root, scenario: s, argv: [] });
      record.exitCode = result.exitCode;
      captureFile(record, "machine/C2-return-no-workspace-piped.stdout.txt", result.stdout, "piped-stdout", [
        "  campfire\n",
        "  You        Ada\n",
        "  Waiting for an agent to start work.",
        "  campfire up     start the local API and Viewer",
      ], ["cft_", "cfe_", "http://127.0.0.1"]);
      captureFile(record, "machine/C2-return-no-workspace-piped.stderr.txt", result.stderr, "piped-stderr", [], ["cft_"]);
      run.markFailed(record, [
        ...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : []),
        ...(result.stderr.length !== 0 ? ["stderr was not empty"] : []),
      ]);
    },
  );

  await runCase(
    {
      id: "C3",
      journey: "C",
      title: "returning profile, no workspace, explicit JSON (profile status JSON)",
      method: "piped",
      argvDisplay: ["campfire", "--output", "json"],
      fileBase: "C3-return-no-workspace-json",
      envCase: { stdoutIsTty: "false (piped)" },
      ...PREP_NOTES,
    },
    (record, s) => {
      prepareProfile(s);
      const result = runPiped({ root: args.root, scenario: s, argv: ["--output", "json"] });
      record.exitCode = result.exitCode;
      captureFile(record, "machine/C3-return-no-workspace-json.stdout.txt", result.stdout, "piped-stdout", [
        '"human":"Ada"',
        '"databasePath":"[path]"',
      ], ["cft_", '"workspace"', '"workspaceId"', '"pastSessionsImported"']);
      captureFile(record, "machine/C3-return-no-workspace-json.stderr.txt", result.stderr, "piped-stderr", [], ["cft_"]);
      run.markFailed(record, [
        ...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : []),
        ...(result.stderr.length !== 0 ? ["stderr was not empty"] : []),
      ]);
    },
  );

  // -------------------------------------------------------------------------
  // C4–C5 — returning profile, no workspace, `campfire status`
  // -------------------------------------------------------------------------
  await runCase(
    {
      id: "C4",
      journey: "C",
      title: "returning profile, no workspace, `campfire status` in a terminal (awaiting_workspace human)",
      method: "pty",
      argvDisplay: ["campfire", "status"],
      fileBase: "C4-return-no-workspace-status-pty",
      ...PREP_NOTES,
      notCaptured: ["any listener (status reads the local store in-process)"],
    },
    (record, s) => {
      prepareProfile(s);
      const result = runPty({
        argv: cliArgv(["status"]),
        cwd: s.base,
        env: scenarioEnv(s),
        steps: [],
        timeoutMs: 30_000,
      });
      record.exitCode = result.exitCode;
      record.timedOut = result.timedOut;
      record.checks = { stepsSent: result.stepsSent, stepsTotal: result.stepsTotal, driverError: result.driverError ?? null };
      captureFile(
        record,
        "terminal/C4-return-no-workspace-status-pty.stream.txt",
        result.stream.toString("utf8"),
        "pty-stream",
        [
          '{"event":"authz","allow":true,"actorId":"hum_[id]","operation":"workspace:list"}',
          "You        Ada\n",
          "Waiting for an agent to start work.\n",
          "Past sessions are not imported.\n",
          "campfire up  Start the local API and Viewer so an agent can connect",
          "campfire --help  See the command list",
        ],
        [...NO_LISTENER_ABSENT, "  campfire\n"],
      );
      run.markFailed(record, [
        ...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : []),
        ...(result.driverError !== undefined ? [`pty driver error: ${result.driverError}`] : []),
      ]);
    },
  );

  await runCase(
    {
      id: "C5",
      journey: "C",
      title: "returning profile, no workspace, `campfire status --output json`",
      method: "piped",
      argvDisplay: ["campfire", "status", "--output", "json"],
      fileBase: "C5-return-no-workspace-status-json",
      envCase: { stdoutIsTty: "false (piped)" },
      ...PREP_NOTES,
    },
    (record, s) => {
      prepareProfile(s);
      const result = runPiped({ root: args.root, scenario: s, argv: ["status", "--output", "json"] });
      record.exitCode = result.exitCode;
      captureFile(record, "machine/C5-return-no-workspace-status-json.stdout.txt", result.stdout, "piped-stdout", [
        '"version":1',
        '"kind":"workspace_status"',
        '"state":"awaiting_workspace"',
        '"human":{"id":"hum_[id]","name":"Ada"}',
        '"command":"campfire up"',
      ], ["cft_"]);
      captureFile(record, "machine/C5-return-no-workspace-status-json.stderr.txt", result.stderr, "piped-stderr", [
        '"operation":"workspace:list"',
      ], ["cft_"]);
      run.markFailed(record, [...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : [])]);
    },
  );

  // -------------------------------------------------------------------------
  // C6–C8 — returning profile with a stored workspace, bare campfire
  // -------------------------------------------------------------------------
  await runCase(
    {
      id: "C6",
      journey: "C",
      title: "returning profile with stored workspace, bare campfire in a terminal (human receipt, no listener)",
      method: "pty",
      argvDisplay: ["campfire"],
      fileBase: "C6-return-workspace-pty",
      ...PREP_NOTES,
      notCaptured: ["any listener (a returning bare `campfire` prints status only)"],
    },
    (record, s) => {
      prepareOnboarded(s);
      const result = runPty({ argv: cliArgv([]), cwd: s.base, env: scenarioEnv(s), steps: [], timeoutMs: 30_000 });
      record.exitCode = result.exitCode;
      record.timedOut = result.timedOut;
      record.checks = { stepsSent: result.stepsSent, stepsTotal: result.stepsTotal, driverError: result.driverError ?? null };
      captureFile(
        record,
        "terminal/C6-return-workspace-pty.stream.txt",
        result.stream.toString("utf8"),
        "pty-stream",
        [
          "  You        Ada\n",
          "  Agents     Codex (codex)\n",
          `  Workspace  ${WORKSPACE_NAME}\n`,
          `  Goal       ${GOAL}\n`,
          "  campfire up     start the local API and Viewer",
        ],
        NO_LISTENER_ABSENT,
      );
      run.markFailed(record, [
        ...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : []),
        ...(result.driverError !== undefined ? [`pty driver error: ${result.driverError}`] : []),
      ]);
    },
  );

  await runCase(
    {
      id: "C7",
      journey: "C",
      title: "returning profile with stored workspace, bare campfire piped (bare stays human)",
      method: "piped",
      argvDisplay: ["campfire"],
      fileBase: "C7-return-workspace-piped",
      envCase: { stdoutIsTty: "false (piped)" },
      ...PREP_NOTES,
    },
    (record, s) => {
      prepareOnboarded(s);
      const result = runPiped({ root: args.root, scenario: s, argv: [] });
      record.exitCode = result.exitCode;
      captureFile(record, "machine/C7-return-workspace-piped.stdout.txt", result.stdout, "piped-stdout", [
        "  You        Ada\n",
        "  Agents     Codex (codex)\n",
        `  Workspace  ${WORKSPACE_NAME}\n`,
        `  Goal       ${GOAL}\n`,
      ], ["cft_", "cfe_", "http://127.0.0.1"]);
      captureFile(record, "machine/C7-return-workspace-piped.stderr.txt", result.stderr, "piped-stderr", [], ["cft_"]);
      run.markFailed(record, [
        ...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : []),
        ...(result.stderr.length !== 0 ? ["stderr was not empty"] : []),
      ]);
    },
  );

  await runCase(
    {
      id: "C8",
      journey: "C",
      title: "returning profile with stored workspace, explicit JSON",
      method: "piped",
      argvDisplay: ["campfire", "--output", "json"],
      fileBase: "C8-return-workspace-json",
      envCase: { stdoutIsTty: "false (piped)" },
      ...PREP_NOTES,
    },
    (record, s) => {
      prepareOnboarded(s);
      const result = runPiped({ root: args.root, scenario: s, argv: ["--output", "json"] });
      record.exitCode = result.exitCode;
      captureFile(record, "machine/C8-return-workspace-json.stdout.txt", result.stdout, "piped-stdout", [
        `"workspace":"${WORKSPACE_NAME}"`,
        '"workspaceId":"ws_[id]"',
        `"goal":"${GOAL}"`,
        '"human":"Ada"',
        '"agent":"Codex"',
        '"harness":"codex"',
        '"databasePath":"[path]"',
      ], ["cft_"]);
      captureFile(record, "machine/C8-return-workspace-json.stderr.txt", result.stderr, "piped-stderr", [], ["cft_"]);
      run.markFailed(record, [
        ...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : []),
        ...(result.stderr.length !== 0 ? ["stderr was not empty"] : []),
      ]);
    },
  );

  // -------------------------------------------------------------------------
  // C9–C10 — returning profile with a stored workspace, `campfire status`
  // -------------------------------------------------------------------------
  await runCase(
    {
      id: "C9",
      journey: "C",
      title: "returning profile with stored workspace, `campfire status` in a terminal (ready human)",
      method: "pty",
      argvDisplay: ["campfire", "status"],
      fileBase: "C9-return-workspace-status-pty",
      ...PREP_NOTES,
      notCaptured: ["any listener (status reads the local store in-process)"],
    },
    (record, s) => {
      prepareOnboarded(s);
      const result = runPty({
        argv: cliArgv(["status"]),
        cwd: s.base,
        env: scenarioEnv(s),
        steps: [],
        timeoutMs: 30_000,
      });
      record.exitCode = result.exitCode;
      record.timedOut = result.timedOut;
      record.checks = { stepsSent: result.stepsSent, stepsTotal: result.stepsTotal, driverError: result.driverError ?? null };
      captureFile(
        record,
        "terminal/C9-return-workspace-status-pty.stream.txt",
        result.stream.toString("utf8"),
        "pty-stream",
        [
          '"operation":"workspace:read"',
          `Workspace  ${WORKSPACE_NAME}  [active]  ws_[id]`,
          `Goal       ${GOAL}  [active]`,
          "Participants  1 human  1 agent",
          "Work       open 0  in progress 0  blocked 0",
          "Decisions  proposed 0  accepted 0",
          "Activity   5 contributions  newest con_[id]",
        ],
        [...NO_LISTENER_ABSENT, "  campfire\n"],
      );
      run.markFailed(record, [
        ...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : []),
        ...(result.driverError !== undefined ? [`pty driver error: ${result.driverError}`] : []),
      ]);
    },
  );

  await runCase(
    {
      id: "C10",
      journey: "C",
      title: "returning profile with stored workspace, `campfire status --output json`",
      method: "piped",
      argvDisplay: ["campfire", "status", "--output", "json"],
      fileBase: "C10-return-workspace-status-json",
      envCase: { stdoutIsTty: "false (piped)" },
      ...PREP_NOTES,
    },
    (record, s) => {
      prepareOnboarded(s);
      const result = runPiped({ root: args.root, scenario: s, argv: ["status", "--output", "json"] });
      record.exitCode = result.exitCode;
      captureFile(record, "machine/C10-return-workspace-status-json.stdout.txt", result.stdout, "piped-stdout", [
        '"kind":"workspace_status"',
        '"state":"ready"',
        `"workspace":{"id":"ws_[id]","name":"${WORKSPACE_NAME}","status":"active"}`,
        '"participants":{"humans":1,"agents":1}',
        '"activity":{"total":5',
      ], ["cft_"]);
      captureFile(record, "machine/C10-return-workspace-status-json.stderr.txt", result.stderr, "piped-stderr", [
        '"operation":"workspace:read"',
      ], ["cft_"]);
      run.markFailed(record, [...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : [])]);
    },
  );

  // -------------------------------------------------------------------------
  // C11–C12 — returning profile with a stored workspace, `campfire up`
  // -------------------------------------------------------------------------
  await runCase(
    {
      id: "C11",
      journey: "C",
      title: "returning profile with stored workspace, `up --no-connect` in a terminal (human receipt)",
      method: "pty",
      argvDisplay: ["campfire", "up", "--no-connect", "--port", "0", "--viewer-port", "0"],
      fileBase: "C11-return-workspace-up-pty",
      envCase: { CAMPFIRE_NO_BROWSER: "1" },
      ...PREP_NOTES,
      notCaptured: ["a browser launch (suppressed by CAMPFIRE_NO_BROWSER=1)", "a harness reload or session registration"],
    },
    (record, s) => {
      prepareOnboarded(s);
      const result = runPty({
        argv: cliArgv(["up", "--no-connect", "--port", "0", "--viewer-port", "0"]),
        cwd: s.base,
        env: scenarioEnv(s, { CAMPFIRE_NO_BROWSER: "1" }),
        steps: [{ expect: "[campfire] HTTP http://127.0.0.1:", send: "\u0003", sendDelayMs: 300 }],
        timeoutMs: 30_000,
      });
      record.exitCode = result.exitCode;
      record.timedOut = result.timedOut;
      record.checks = { stepsSent: result.stepsSent, stepsTotal: result.stepsTotal, driverError: result.driverError ?? null };
      captureFile(
        record,
        "terminal/C11-return-workspace-up-pty.stream.txt",
        result.stream.toString("utf8"),
        "pty-stream",
        [
          "  Agents     none connected yet",
          `  Workspace  ${WORKSPACE_NAME}  ${GOAL}`,
          "  Past sessions are not imported.",
          "  You        http://127.0.0.1:[port]",
          "[campfire] HTTP http://127.0.0.1:[port]  viewer http://127.0.0.1:[port]",
          "[campfire] received SIGINT, shutting down",
        ],
        ["cft_", "cfe_"],
      );
      run.markFailed(record, [
        ...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : []),
        ...(result.stepsSent !== result.stepsTotal ? ["pty steps never all matched"] : []),
        ...(result.driverError !== undefined ? [`pty driver error: ${result.driverError}`] : []),
      ]);
    },
  );

  await runCase(
    {
      id: "C12",
      journey: "C",
      title: "returning profile with stored workspace, `up --no-connect --no-open --output json`",
      method: "piped",
      argvDisplay: ["campfire", "up", "--no-connect", "--no-open", "--port", "0", "--viewer-port", "0", "--output", "json"],
      fileBase: "C12-return-workspace-up-json",
      envCase: { CAMPFIRE_NO_BROWSER: "1" },
      ...PREP_NOTES,
      notCaptured: ["a browser launch (suppressed by --no-open)", "a harness reload or session registration"],
    },
    async (record, s) => {
      prepareOnboarded(s);
      const daemon = startDaemon({
        root: args.root,
        scenario: s,
        argv: ["up", "--no-connect", "--no-open", "--port", "0", "--viewer-port", "0", "--output", "json"],
        extraEnv: { CAMPFIRE_NO_BROWSER: "1" },
      });
      await waitFor(() => daemon.stdout().includes('"openedBrowser"'), "up JSON output");
      await daemon.waitStderr(/\[campfire\] HTTP http:\/\/127\.0\.0\.1:\d+/);
      const final = await daemon.sigint();
      record.exitCode = final.exitCode;
      record.timedOut = final.timedOut;
      let payload: Record<string, unknown> | null = null;
      try {
        payload = JSON.parse(final.stdout.trim()) as Record<string, unknown>;
      } catch {
        payload = null;
      }
      record.checks = {
        payloadParsed: payload !== null,
        openedBrowser: payload?.openedBrowser ?? null,
        workspaces: payload?.workspaces ?? null,
      };
      captureFile(record, "machine/C12-return-workspace-up-json.stdout.txt", final.stdout, "piped-stdout", [
        '"openedBrowser":false',
        `"workspaces":[{"id":"ws_[id]","name":"${WORKSPACE_NAME}","goal":"${GOAL}"}]`,
        '"agents":[]',
        '"pastSessionsImported":false',
      ], ["cft_"]);
      captureFile(record, "machine/C12-return-workspace-up-json.stderr.txt", final.stderr, "daemon-stderr", [
        '"operation":"workspace:list"',
        "[campfire] HTTP http://127.0.0.1:[port]  viewer http://127.0.0.1:[port]",
        "[campfire] received SIGINT, shutting down",
      ], ["cft_"]);
      run.markFailed(record, [
        ...(payload === null ? ["stdout did not parse as one JSON object"] : []),
        ...(payload !== null && payload.openedBrowser !== false ? ["openedBrowser was not false"] : []),
        ...(final.exitCode !== 0 ? [`exitCode ${String(final.exitCode)}`] : []),
      ]);
    },
  );

  // -------------------------------------------------------------------------
  // C13–C14 — the scripted `onboard` receipts (JSON vs human credential rule)
  // -------------------------------------------------------------------------
  await runCase(
    {
      id: "C13",
      journey: "A",
      title: "scripted onboard with explicit JSON shows the one-time credential receipt",
      method: "piped",
      argvDisplay: ["campfire", ...onboardArgv(["--output", "json"])],
      fileBase: "C13-onboard-json",
      envCase: { stdoutIsTty: "false (piped)" },
      simulated: ["a fresh isolated installation created by the scripted onboard path"],
      real: ["campfire v1.22.0 CLI run from the pinned worktree via tsx"],
      notCaptured: ["a listener, harness reload, or agent session (onboard does none of these)"],
    },
    (record, s) => {
      const result = runPiped({ root: args.root, scenario: s, argv: onboardArgv(["--output", "json"]) });
      record.exitCode = result.exitCode;
      captureFile(record, "machine/C13-onboard-json.stdout.txt", result.stdout, "piped-stdout", [
        '"displayName":"Ada"',
        '"token":"[redacted]"',
        '"actorType":"agent"',
        '"harness":"codex"',
        `"workspace":{"id":"ws_[id]","name":"${WORKSPACE_NAME}","status":"active"}`,
        `"goal":{"id":"goal_[id]","title":"${GOAL}","status":"active"}`,
        '"version":"1.22.0"',
        '"reloadRequired":true',
        '"approvalMayBeRequired":true',
      ], ["cft_"]);
      captureFile(record, "machine/C13-onboard-json.stderr.txt", result.stderr, "piped-stderr", [
        '"operation":"workspace:list"',
        '"operation":"goal:create"',
        '"operation":"invite:create"',
        '"operation":"workspace:join"',
      ], ["cft_"]);
      run.markFailed(record, [...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : [])]);
    },
  );

  await runCase(
    {
      id: "C14",
      journey: "A",
      title: "scripted onboard human receipt prints no token (credential-bearing command stays human under auto)",
      method: "piped",
      argvDisplay: ["campfire", ...onboardArgv([])],
      fileBase: "C14-onboard-human",
      envCase: { stdoutIsTty: "false (piped)" },
      simulated: ["a fresh isolated installation created by the scripted onboard path"],
      real: ["campfire v1.22.0 CLI run from the pinned worktree via tsx"],
      notCaptured: ["a listener, harness reload, or agent session (onboard does none of these)"],
    },
    (record, s) => {
      const result = runPiped({ root: args.root, scenario: s, argv: onboardArgv([]) });
      record.exitCode = result.exitCode;
      captureFile(record, "machine/C14-onboard-human.stdout.txt", result.stdout, "piped-stdout", [
        `Workspace ${WORKSPACE_NAME} is ready.`,
        `  Goal     ${GOAL}`,
        "  You      Ada",
        "  Agent    Codex (codex)",
        "Credentials are stored locally (mode 0600) and are not printed here.",
        "Pass --json for one-time tokens.",
        "Next: campfire up",
        "      Reload codex after connect. Approval may be required.",
        "      As the agent: register_agent_session, then preflight.",
      ], ["cft_", "cfe_", '"token"']);
      captureFile(record, "machine/C14-onboard-human.stderr.txt", result.stderr, "piped-stderr", [
        '"operation":"workspace:list"',
        '"operation":"workspace:join"',
      ], ["cft_"]);
      run.markFailed(record, [...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : [])]);
    },
  );

  // -------------------------------------------------------------------------
  // Summary, teardown, exit status
  // -------------------------------------------------------------------------
  const summary = run.summary({
    capturedOn: "2026-10-18",
    machineFacts: machineFacts(),
    methodNotes: {
      pty: "python3 pty, 24x100, child session leader with controlling pty; stderr shares the terminal stream; an interactive step is only used for C11 (wait for the `[campfire] HTTP …` listener line, then a real SIGINT (\\u0003) after a 300 ms delay so the signal cannot race the shutdown-handler registration); frames are the raw stream text (CRLF line endings; expectation matching normalizes \\r\\n to \\n)",
      ptyTermios:
        "check `termiosRestored` is recorded false in every PTY case, including clean exit-0 runs: on macOS, tcgetattr on the pty slave fails with ENOTTY once the session leader has exited, so the post-exit snapshot is unreadable. This is a driver limitation, not a dirty-terminal observation.",
      piped: "spawnSync with piped stdin/stdout/stderr; no terminal anywhere",
      daemon: "detached child; SIGINT to its process group; stderr/stdout collected",
      statusOutputMode:
        "`campfire status` has outputModes auto/human/json (src/cli/catalog.ts spec + src/cli/output.ts resolveOutputMode): stdout TTY renders human, a pipe renders JSON unless --output human is passed. Bare `campfire` is outside that rule and stays human unless explicit JSON (src/cli/index.ts commandOutput).",
    },
    maskingRules:
      "see BASELINE_PIN.md — cft-shaped credential tokens -> [redacted]; cfe-shaped invitation secrets -> [one-time-credential: redacted]; absolute /Users, /private, /var/folders, /tmp paths -> [path]; loopback ports -> [port]; ISO timestamps -> [timestamp]; UUIDs -> [uuid]; object ids (<prefix>_<16 hex>) -> <prefix>_[id]",
  });
  evidence.writeSummary("summaries/return.json", summary);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${NAME}: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const s of scenarios) destroyScenario(s);
    const failedIds = run.cases.filter((record) => record.status === "failed").map((record) => record.id);
    process.stdout.write(
      `${JSON.stringify({ tool: NAME, cases: run.cases.length, failed: failedIds, files: evidence.files().length, failedWrites: evidence.failed().length }, null, 2)}\n`,
    );
    if (process.exitCode !== 1) process.exitCode = run.exitCode();
  });
