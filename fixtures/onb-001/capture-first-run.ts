/**
 * ONB-001 Step 0 — first-run baseline capture (journey A; B shares A3/A4).
 *
 * FIXTURE EVIDENCE — scripted engineering captures of the published v1.22.0
 * CLI. A scripted PTY run is a debugging rehearsal, never human evidence.
 *
 *   npx tsx fixtures/onb-001/capture-first-run.ts \
 *     --root <clean v1.22.0 worktree> [--out docs/evidence/onb-001]
 *
 * Cases:
 *   A1 fresh interactive, both harnesses simulated (configured, not reloaded)
 *   A2 fresh interactive, codex simulated
 *   A3 fresh interactive, no harness
 *   A4 fresh interactive, --no-connect (pins receipt equality with A3)
 *   A5 piped, no name: human error            A6 piped, no name: JSON error
 *   A7 piped --human-name: JSON profile       A8 piped --human-name: human status
 *   A9 `up` JSON with --no-open               A10 `up` JSON opening (shimmed) browser
 *
 * Harness detection in v1.22.0 is configuration-path based
 * (src/bootstrap/connect.ts `detectInstalledHarnesses`); every harness
 * presence here is a simulated marker directory inside an isolated HOME/XDG.
 * No real Codex/OpenCode process runs and no real harness config is touched.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Evidence,
  createScenario,
  destroyScenario,
  redact,
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

const NAME = "onb-001 capture-first-run";
const args = parseToolArgs(process.argv.slice(2), NAME);
const baseline = verifyBaselineRoot(NAME, args.root);
const evidence = new Evidence(args.out, [process.env.HOME ?? ""]);
const run = new ToolRun(NAME, baseline);

const scenarios: Scenario[] = [];
function acquireScenario(name: string): Scenario {
  const created = createScenario(name);
  scenarios.push(created);
  return created;
}

/** Simulate a detected harness exactly as the v1.22.0 detector checks for it. */
function simulateHarness(s: Scenario, harness: "codex" | "opencode"): void {
  if (harness === "codex") mkdirSync(join(s.home, ".codex"), { recursive: true, mode: 0o700 });
  else mkdirSync(join(s.xdgConfig, "opencode"), { recursive: true, mode: 0o700 });
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

/** Writes one evidence file and merges expectation failures into the record. */
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
  journey: "A" | "B";
  title: string;
  method: "pty" | "piped";
  argvDisplay: string[];
  fileBase: string;
  envCase?: Record<string, string>;
  simulated?: string[];
  real?: string[];
  notCaptured?: string[];
}

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

const PTY_NOTES = {
  simulated: [
    "harness presence: marker directories at the exact v1.22.0 detector paths (HOME/.codex, XDG_CONFIG_HOME/opencode)",
    "human name typed by the script after the prompt",
  ],
  real: [
    "campfire v1.22.0 CLI run from the pinned worktree via tsx",
    "pty with a controlling terminal; written \\u0003 delivered as a real SIGINT",
    "loopback listeners bound with --port 0 / --viewer-port 0",
  ],
  notCaptured: [
    "a real Codex/OpenCode launch, reload, or tool approval (no harness process started)",
    "human comprehension of the screen",
  ],
};

interface FreshInteractiveOptions {
  harnesses: Array<"codex" | "opencode">;
  extraArgv?: string[];
  expectContains: string[];
}

const SIGINT_MARKER = "[campfire] HTTP http://127.0.0.1:";

async function freshInteractiveCase(
  meta: CaseMeta,
  options: FreshInteractiveOptions,
): Promise<{ record: CaseRecord; stream: string; scenario: Scenario }> {
  let stream = "";
  let scenario!: Scenario;
  const record = await runCase(meta, (rec, s) => {
    scenario = s;
    for (const harness of options.harnesses) simulateHarness(s, harness);
    const result = runPty({
      argv: cliArgv(["--port", "0", "--viewer-port", "0", ...(options.extraArgv ?? [])]),
      cwd: s.base,
      env: scenarioEnv(s, { CAMPFIRE_NO_BROWSER: "1" }),
      steps: [
        { expect: "Your name [owner]: ", send: "Ada\n" },
        // ^C only after the listener line: the shutdown handler is registered
        // in the same tick the listener line is written; the 300 ms send delay
        // keeps the signal from racing that registration (observed race in a
        // rehearsal run, see the summary notes).
        { expect: SIGINT_MARKER, send: "\u0003", sendDelayMs: 300 },
      ],
    });
    stream = result.stream.toString("utf8");
    rec.exitCode = result.exitCode;
    rec.timedOut = result.timedOut;
    rec.checks = {
      stepsSent: result.stepsSent,
      stepsTotal: result.stepsTotal,
      termiosRestored: result.termiosRestored,
      driverError: result.driverError ?? null,
      codexConfigWritten: existsSync(join(s.home, ".codex", "config.toml")),
      opencodeConfigWritten: existsSync(join(s.xdgConfig, "opencode", "opencode.json")),
    };
    captureFile(
      rec,
      `terminal/${meta.fileBase}.stream.txt`,
      stream,
      "pty-stream",
      [
        "Your name [owner]: ",
        "  campfire\n",
        ...options.expectContains,
        "  You        http://127.0.0.1:[port]",
        "[campfire] HTTP http://127.0.0.1:[port]  viewer http://127.0.0.1:[port]",
        "[campfire] received SIGINT, shutting down",
      ],
      ["cft_", "cfe_"],
    );
    run.markFailed(rec, [
      ...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : []),
      ...(result.stepsSent !== result.stepsTotal ? ["pty steps never all matched"] : []),
      ...(result.driverError !== undefined ? [`pty driver error: ${result.driverError}`] : []),
    ]);
  });
  return { record, stream, scenario };
}

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  // A1 — both harnesses simulated
  // -------------------------------------------------------------------------
  {
    const { record, scenario: s } = await freshInteractiveCase(
      {
        id: "A1",
        journey: "A",
        title: "fresh interactive both harnesses simulated (config prepared, not reloaded)",
        method: "pty",
        argvDisplay: ["campfire", "--port", "0", "--viewer-port", "0"],
        fileBase: "A1-fresh-both-harness-interactive",
        envCase: { CAMPFIRE_NO_BROWSER: "1" },
        ...PTY_NOTES,
      },
      {
        harnesses: ["codex", "opencode"],
        expectContains: [
          "  Agents     Codex, OpenCode",
          "  Waiting for an agent to start work.",
          "  Past sessions are not imported.",
          "  Agent      reload the harness, then continue in that session",
        ],
      },
    );
    const codexConfig = join(s.home, ".codex", "config.toml");
    const opencodeConfig = join(s.xdgConfig, "opencode", "opencode.json");
    if (existsSync(codexConfig)) {
      captureFile(record, "terminal/A1-codex-config-prepared.redacted.toml", readFileSync(codexConfig, "utf8"), "prepared-harness-config");
    }
    if (existsSync(opencodeConfig)) {
      captureFile(record, "terminal/A1-opencode-config-prepared.redacted.json", readFileSync(opencodeConfig, "utf8"), "prepared-harness-config");
    }
  }

  // -------------------------------------------------------------------------
  // A2 — codex only
  // -------------------------------------------------------------------------
  await freshInteractiveCase(
    {
      id: "A2",
      journey: "A",
      title: "fresh interactive codex simulated",
      method: "pty",
      argvDisplay: ["campfire", "--port", "0", "--viewer-port", "0"],
      fileBase: "A2-fresh-codex-only-interactive",
      envCase: { CAMPFIRE_NO_BROWSER: "1" },
      ...PTY_NOTES,
    },
    {
      harnesses: ["codex"],
      expectContains: [
        "  Agents     Codex",
        "  Agent      reload the harness, then continue in that session",
      ],
    },
  );

  // -------------------------------------------------------------------------
  // A3 — no harness, and A4 — --no-connect (receipt equality is pinned)
  // -------------------------------------------------------------------------
  const a3 = await freshInteractiveCase(
    {
      id: "A3",
      journey: "B",
      title: "fresh interactive no harness detected",
      method: "pty",
      argvDisplay: ["campfire", "--port", "0", "--viewer-port", "0"],
      fileBase: "A3-fresh-no-harness-interactive",
      envCase: { CAMPFIRE_NO_BROWSER: "1" },
      ...PTY_NOTES,
    },
    {
      harnesses: [],
      expectContains: [
        "  Agents     none connected yet",
        "  Waiting for an agent to start work.",
      ],
    },
  );
  run.markFailed(a3.record, [
    ...(a3.stream.includes("  Agent      reload the harness") ? ["unexpected reload line without a prepared harness"] : []),
    ...(existsSync(join(a3.scenario.home, ".codex", "config.toml")) ? ["unexpected codex config written"] : []),
  ]);

  const a4 = await freshInteractiveCase(
    {
      id: "A4",
      journey: "B",
      title: "fresh interactive with --no-connect (both harnesses simulated but skipped)",
      method: "pty",
      argvDisplay: ["campfire", "--no-connect", "--port", "0", "--viewer-port", "0"],
      fileBase: "A4-fresh-no-connect-interactive",
      envCase: { CAMPFIRE_NO_BROWSER: "1" },
      ...PTY_NOTES,
    },
    {
      harnesses: ["codex", "opencode"],
      extraArgv: ["--no-connect"],
      expectContains: [
        "  Agents     none connected yet",
        "  Waiting for an agent to start work.",
      ],
    },
  );
  run.markFailed(a4.record, [
    ...(a4.record.checks.codexConfigWritten === true ? ["--no-connect wrote a codex config"] : []),
    ...(a4.record.checks.opencodeConfigWritten === true ? ["--no-connect wrote an opencode config"] : []),
  ]);
  a4.record.checks.receiptEqualsA3AfterPortMasking = redact(a3.stream).text === redact(a4.stream).text;

  // -------------------------------------------------------------------------
  // A5/A6 — piped first run without a name (human and explicit JSON errors)
  // -------------------------------------------------------------------------
  for (const [id, fileBase, extraArgvTuple, isJson] of [
    ["A5", "A5-fresh-nontty-no-name-human", [], false],
    ["A6", "A6-fresh-nontty-no-name-json", ["--output", "json"], true],
  ] as const) {
    const extraArgv = [...extraArgvTuple];
    await runCase(
      {
        id,
        journey: "B",
        title: isJson ? "piped fresh run without a name (explicit JSON error)" : "piped fresh run without a name (human error)",
        method: "piped",
        argvDisplay: ["campfire", ...extraArgv],
        fileBase,
        envCase: { stdoutIsTty: "false (piped)" },
        simulated: ["no terminal on stdin/stdout"],
        real: ["campfire v1.22.0 CLI run from the pinned worktree via tsx"],
        notCaptured: [],
      },
      (record, s) => {
        const result = runPiped({ root: args.root, scenario: s, argv: extraArgv });
        record.exitCode = result.exitCode;
        record.timedOut = result.timedOut;
        captureFile(record, `machine/${fileBase}.stdout.txt`, result.stdout, "piped-stdout");
        const expected = isJson
          ? ['"code":"ValidationError"', "Run campfire in a terminal to confirm your name, or pass --human-name.", "Agents and workspaces appear when a harness connects."]
          : ["[ValidationError] Run campfire in a terminal to confirm your name, or pass --human-name.", "Agents and workspaces appear when a harness connects."];
        captureFile(record, `machine/${fileBase}.stderr.txt`, result.stderr, "piped-stderr", expected, ["cft_", "cfe_"]);
        run.markFailed(record, [
          ...(result.exitCode !== 1 ? [`exitCode ${String(result.exitCode)} (expected 1)`] : []),
          ...(result.stdout.length !== 0 ? ["stdout was not empty"] : []),
        ]);
      },
    );
  }

  // -------------------------------------------------------------------------
  // A7/A8 — piped first run with --human-name (JSON and human)
  // -------------------------------------------------------------------------
  await runCase(
    {
      id: "A7",
      journey: "A",
      title: "piped fresh run with --human-name and explicit JSON",
      method: "piped",
      argvDisplay: ["campfire", "--human-name", "Ada", "--output", "json"],
      fileBase: "A7-fresh-nontty-name-json",
      envCase: { stdoutIsTty: "false (piped)" },
      simulated: ["profile creation in an isolated CAMPFIRE_CONFIG_DIR"],
      real: ["campfire v1.22.0 CLI run from the pinned worktree via tsx"],
      notCaptured: ["a listener (first-run JSON profile creation does not start one)"],
    },
    (record, s) => {
      const result = runPiped({ root: args.root, scenario: s, argv: ["--human-name", "Ada", "--output", "json"] });
      record.exitCode = result.exitCode;
      captureFile(record, "machine/A7-fresh-nontty-name-json.stdout.txt", result.stdout, "piped-stdout", [
        '"human":"Ada"',
        '"humanId":"hum_[id]"',
        '"databasePath":"[path]"',
        '"waiting":"agent"',
        '"pastSessionsImported":false',
      ], ["cft_"]);
      captureFile(record, "machine/A7-fresh-nontty-name-json.stderr.txt", result.stderr, "piped-stderr", [], ["cft_"]);
      run.markFailed(record, [
        ...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : []),
        ...(result.stderr.length !== 0 ? ["stderr was not clean"] : []),
      ]);
    },
  );

  await runCase(
    {
      id: "A8",
      journey: "A",
      title: "piped fresh run with --human-name (bare campfire stays human when piped)",
      method: "piped",
      argvDisplay: ["campfire", "--human-name", "Ada"],
      fileBase: "A8-fresh-nontty-name-human",
      envCase: { stdoutIsTty: "false (piped)" },
      simulated: ["profile creation in an isolated CAMPFIRE_CONFIG_DIR"],
      real: ["campfire v1.22.0 CLI run from the pinned worktree via tsx"],
      notCaptured: ["a listener (first-run human status does not start one)"],
    },
    (record, s) => {
      const result = runPiped({ root: args.root, scenario: s, argv: ["--human-name", "Ada"] });
      record.exitCode = result.exitCode;
      captureFile(record, "machine/A8-fresh-nontty-name-human.stdout.txt", result.stdout, "piped-stdout", [
        "  campfire\n",
        "  You        Ada",
        "  Waiting for an agent to start work.",
        "  Past sessions are not imported.",
        "  campfire up     start the local API and Viewer",
      ], ["cft_", "\u001b"]);
      captureFile(record, "machine/A8-fresh-nontty-name-human.stderr.txt", result.stderr, "piped-stderr", [], ["cft_"]);
      run.markFailed(record, [...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : [])]);
    },
  );

  // -------------------------------------------------------------------------
  // A9 — `up --output json --no-open` reports openedBrowser:false
  // -------------------------------------------------------------------------
  await runCase(
    {
      id: "A9",
      journey: "A",
      title: "up explicit JSON with --no-open (openedBrowser:false)",
      method: "piped",
      argvDisplay: ["campfire", "up", "--no-connect", "--no-open", "--port", "0", "--viewer-port", "0", "--output", "json"],
      fileBase: "A9-up-json-no-open",
      envCase: { CAMPFIRE_NO_BROWSER: "1" },
      simulated: ["returning profile created by a prior piped `campfire --human-name Ada --output json` in the same isolated scenario"],
      real: ["campfire v1.22.0 CLI run from the pinned worktree via tsx", "loopback listeners", "real SIGINT (process-group signal)"],
      notCaptured: ["a browser launch (suppressed by --no-open)"],
    },
    async (record, s) => {
      const prep = runPiped({ root: args.root, scenario: s, argv: ["--human-name", "Ada", "--output", "json"] });
      if (prep.exitCode !== 0) throw new Error(`profile precondition failed: ${prep.stderr.slice(0, 300)}`);
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
        agents: payload?.agents ?? null,
      };
      captureFile(record, "machine/A9-up-json-no-open.stdout.txt", final.stdout, "piped-stdout", ['"openedBrowser":false', '"workspaces":[]', '"agents":[]'], ["cft_"]);
      captureFile(record, "machine/A9-up-json-no-open.stderr.txt", final.stderr, "daemon-stderr", [
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
  // A10 — `up` opens the Viewer in a browser; PATH `open` shim records the URL
  // -------------------------------------------------------------------------
  await runCase(
    {
      id: "A10",
      journey: "A",
      title: "up explicit JSON opens the browser (PATH `open` shim records the URL)",
      method: "pty",
      argvDisplay: ["campfire", "up", "--no-connect", "--port", "0", "--viewer-port", "0", "--output", "json"],
      fileBase: "A10-up-json-browser-open-shim",
      envCase: { CAMPFIRE_NO_BROWSER: "unset", PATH: "scenario bin dir first (contains an `open` shim)" },
      simulated: ["returning profile created by a prior piped `campfire --human-name Ada --output json`", "macOS `open` replaced by a PATH shim that only appends its argument to a log"],
      real: ["campfire v1.22.0 CLI run from the pinned worktree via tsx", "pty (stdout is a TTY, so the browser branch runs)", "real SIGINT"],
      notCaptured: ["a real browser window (deliberately avoided)"],
    },
    async (record, s) => {
      const prep = runPiped({ root: args.root, scenario: s, argv: ["--human-name", "Ada", "--output", "json"] });
      if (prep.exitCode !== 0) throw new Error(`profile precondition failed: ${prep.stderr.slice(0, 300)}`);
      const logPath = join(s.base, "open-shim.log");
      const shimPath = join(s.bin, "open");
      writeFileSync(shimPath, `#!/bin/sh\nprintf '%s\\n' "$1" >> '${logPath}'\n`);
      chmodSync(shimPath, 0o755);
      const result = runPty({
        argv: cliArgv(["up", "--no-connect", "--port", "0", "--viewer-port", "0", "--output", "json"]),
        cwd: s.base,
        env: scenarioEnv(s),
        steps: [
          // ^C only after the listener line plus a delay: the browser-open
          // spawn and the shutdown-handler registration both need to complete
          // first (a rehearsal ^C on the receipt raced both).
          { expect: SIGINT_MARKER, send: "\u0003", sendDelayMs: 400 },
        ],
      });
      record.exitCode = result.exitCode;
      record.timedOut = result.timedOut;
      await sleep(250); // let the detached shim flush
      const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
      const match = /"viewerUrl":"(http:\/\/127\.0\.0\.1:\d+)"/.exec(result.stream.toString("utf8"));
      record.checks = {
        stepsSent: result.stepsSent,
        stepsTotal: result.stepsTotal,
        openShimInvocations: log.trim() === "" ? 0 : log.trim().split("\n").length,
        openShimUrlMatchesViewerUrl: match !== null && log.trim() === match[1],
      };
      captureFile(record, "terminal/A10-up-json-browser-open-shim.stream.txt", result.stream.toString("utf8"), "pty-stream", [
        '"openedBrowser":true',
        "[campfire] HTTP http://127.0.0.1:[port]  viewer http://127.0.0.1:[port]",
        "[campfire] received SIGINT, shutting down",
      ], ["cft_", "cfe_"]);
      captureFile(record, "terminal/A10-open-shim.log.txt", log, "shim-log", ["http://127.0.0.1:[port]"], []);
      run.markFailed(record, [
        ...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : []),
        ...(result.stepsSent !== result.stepsTotal ? ["pty steps never all matched"] : []),
        ...(record.checks.openShimInvocations !== 1 ? ["expected exactly one shimmed `open` call"] : []),
      ]);
    },
  );

  // -------------------------------------------------------------------------
  // Summary, teardown, exit status
  // -------------------------------------------------------------------------
  const summary = run.summary({
    capturedOn: "2026-10-18",
    machineFacts: machineFacts(),
    methodNotes: {
      pty: "python3 pty, 24x100, child session leader with controlling pty; stderr shares the terminal stream; steps: type the name at the prompt, then wait for the `[campfire] HTTP …` listener line and send a real SIGINT (\\u0003) after a short fixed delay so the signal cannot race the shutdown-handler registration; frames are the raw stream text (CRLF line endings; expectation matching normalizes \\r\\n to \\n)",
      ptyTermios:
        "check `termiosRestored` is recorded false in every PTY case, including clean exit-0 runs: on macOS, tcgetattr on the pty slave fails with ENOTTY once the session leader has exited, so the post-exit snapshot is unreadable. This is a driver limitation, not a dirty-terminal observation.",
      piped: "spawnSync with piped stdin/stdout/stderr; no terminal anywhere",
      daemon: "detached child; SIGINT to its process group; stderr/stdout collected",
    },
    maskingRules:
      "see BASELINE_PIN.md — cft-shaped credential tokens -> [redacted]; cfe-shaped invitation secrets -> [one-time-credential: redacted]; absolute /Users, /private, /var/folders, /tmp paths -> [path]; loopback ports -> [port]; ISO timestamps -> [timestamp]; UUIDs -> [uuid]; object ids (<prefix>_<16 hex>) -> <prefix>_[id]",
  });
  evidence.writeSummary("summaries/first-run.json", summary);
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
