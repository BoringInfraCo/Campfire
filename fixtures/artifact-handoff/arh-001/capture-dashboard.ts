/**
 * ARH-001 dashboard capture for the frozen v1.20.1 baseline (contract §3.1).
 *
 * FIXTURE EVIDENCE — calibrates the surface record; cannot establish Gate B, C, or E.
 *
 * Drives the real `campfire dashboard` command inside a PTY (python3 pty, the
 * same approach as tests/unit/uix-001-dashboard-pty.test.ts), sends `q` once
 * the expected frame marker appears, and extracts the last screen clear as the
 * stable frame. Frames are captured for the fixture's lab workspace at 120x36
 * and 80x24 and for the truncated-artifacts workspace at 120x36.
 *
 *   npx tsx fixtures/artifact-handoff/arh-001/capture-dashboard.ts \
 *     --db fixtures/artifact-handoff/arh-001/.tmp/served/campfire.db \
 *     --out docs/evidence/arh-001/baseline/captures/dashboard
 *
 * If the PTY cannot run in this environment, the exact failure is recorded in
 * the summary and the frame falls back to the exported renderer
 * (`createDashboardState` + `renderDashboard`) at the same fixed size; the
 * summary states which method produced each text file. The fallback is
 * clearly labeled and never passed off as a PTY frame.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDashboardState, renderDashboard } from "../../../src/cli/dashboard.js";
import { dispatchCampfireMethod } from "../../../src/http/dispatch.js";
import { createRuntimeFromPath } from "../../../src/runtime.js";
import type { WorkspaceContext } from "../../../src/service/service.js";
import { SCENARIO } from "./seed.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function fail(message: string): never {
  throw new Error(`arh-001 capture-dashboard: ${message}`);
}

function redact(text: string): string {
  return text
    .replace(/cft_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\/Users\/\S+/g, "[path]")
    .replace(/\/private\/\S+/g, "[path]")
    .replace(/\/var\/folders\/\S+/g, "[path]");
}

function parseArgs(argv: string[]): { db: string; out: string } {
  let db: string | undefined;
  let out: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--db" || arg === "--out") {
      if (value === undefined || value.startsWith("--")) fail(`${arg} requires a value`);
      if (arg === "--db") db = isAbsolute(value) ? value : resolve(value);
      else out = isAbsolute(value) ? value : resolve(value);
      index += 1;
      continue;
    }
    fail(`unknown argument ${arg}`);
  }
  if (db === undefined) fail("--db is required");
  if (out === undefined) fail("--out is required");
  return { db, out };
}

const ENTER = "\u001b[?1049h";
const HIDE = "\u001b[?25l";
const SHOW = "\u001b[?25h";
const LEAVE = "\u001b[?1049l";
const CLEAR = "\u001b[2J";

/** python3 PTY driver (adapted from tests/unit/uix-001-dashboard-pty.test.ts). */
const PTY_DRIVER = `
import base64, fcntl, json, os, select, signal, struct, subprocess, sys, termios, time

cfg = json.loads(sys.argv[1])
master, slave = os.openpty()
rows = int(cfg["rows"])
cols = int(cfg["cols"])
winsz = struct.pack("HHHH", rows, cols, 0, 0)
fcntl.ioctl(slave, termios.TIOCSWINSZ, winsz)
fcntl.ioctl(master, termios.TIOCSWINSZ, winsz)
before = termios.tcgetattr(slave)
env = os.environ.copy()
env["CAMPFIRE_TELEMETRY"] = "0"
env["CAMPFIRE_CONFIG_DIR"] = cfg["configDir"]
env["CAMPFIRE_DATA_DIR"] = cfg["configDir"]
env.pop("CAMPFIRE_URL", None)
env.pop("CAMPFIRE_TOKEN", None)
proc = subprocess.Popen(
    cfg["argv"],
    stdin=slave,
    stdout=slave,
    stderr=subprocess.PIPE,
    env=env,
    cwd=cfg["cwd"],
    start_new_session=True,
    close_fds=True,
)
buf = b""
err = b""
sent = False
timed_out = False
deadline = time.monotonic() + float(cfg["timeout"])
expect = cfg["expect"].encode("utf-8")

def pull(fd):
    try:
        return os.read(fd, 65536)
    except OSError:
        return b""

try:
    while proc.poll() is None:
        if time.monotonic() >= deadline:
            timed_out = True
            break
        watch = [master]
        if proc.stderr is not None:
            watch.append(proc.stderr)
        ready, _, _ = select.select(watch, [], [], 0.1)
        if master in ready:
            chunk = pull(master)
            if chunk:
                buf += chunk
        if proc.stderr is not None and proc.stderr in ready:
            chunk = pull(proc.stderr.fileno())
            if chunk:
                err += chunk
        if (not sent) and expect in buf:
            sent = True
            try:
                os.write(master, b"q")
            except OSError:
                pass
    if timed_out:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            pass
        proc.wait(timeout=2)
    flags = fcntl.fcntl(master, fcntl.F_GETFL)
    fcntl.fcntl(master, fcntl.F_SETFL, flags | os.O_NONBLOCK)
    while True:
        chunk = pull(master)
        if not chunk:
            break
        buf += chunk
    if proc.stderr is not None:
        flags = fcntl.fcntl(proc.stderr.fileno(), fcntl.F_GETFL)
        fcntl.fcntl(proc.stderr.fileno(), fcntl.F_SETFL, flags | os.O_NONBLOCK)
        while True:
            chunk = pull(proc.stderr.fileno())
            if not chunk:
                break
            err += chunk
    after = termios.tcgetattr(slave)
    frozen = lambda attr: [
        [list(cell) if isinstance(cell, bytes) else cell for cell in item] if isinstance(item, list)
        else list(item) if isinstance(item, bytes) else item
        for item in attr
    ]
    sys.stdout.write(json.dumps({
        "exitCode": proc.returncode,
        "timedOut": timed_out,
        "sent": sent,
        "termiosRestored": frozen(before) == frozen(after),
        "stream": base64.b64encode(buf).decode("ascii"),
        "stderr": err.decode("utf-8", "replace"),
    }))
finally:
    for fd in (master, slave):
        try:
            os.close(fd)
        except OSError:
            pass
`;

interface PtyResult {
  exitCode: number | null;
  timedOut: boolean;
  sent: boolean;
  termiosRestored: boolean;
  stream: Buffer;
  stderr: string;
}

function runDashboard(input: {
  db: string;
  workspaceId: string;
  actorId: string;
  rows: number;
  columns: number;
  configDir: string;
  expect: string;
}): PtyResult {
  const argv = [
    join(ROOT, "node_modules/.bin/tsx"),
    join(ROOT, "src/cli/index.ts"),
    "dashboard",
    input.workspaceId,
    "--db",
    input.db,
    "--actor",
    input.actorId,
    "--type",
    "human",
  ];
  const child = spawnSync(
    "python3",
    [
      "-c",
      PTY_DRIVER,
      JSON.stringify({
        argv,
        cwd: ROOT,
        configDir: input.configDir,
        rows: input.rows,
        cols: input.columns,
        expect: input.expect,
        timeout: 25,
      }),
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  if (child.error !== undefined) throw new Error(redact(String(child.error)));
  if (child.status !== 0 || child.stdout.trim().length === 0) {
    throw new Error(redact(`pty driver failed status=${child.status} stderr=${child.stderr}`));
  }
  const parsed = JSON.parse(child.stdout) as {
    exitCode: number | null;
    timedOut: boolean;
    sent: boolean;
    termiosRestored: boolean;
    stream: string;
    stderr: string;
  };
  return {
    exitCode: parsed.exitCode,
    timedOut: parsed.timedOut,
    sent: parsed.sent,
    termiosRestored: parsed.termiosRestored,
    stream: Buffer.from(parsed.stream, "base64"),
    stderr: parsed.stderr,
  };
}

function stripControls(text: string): string {
  return text
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[\x20-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "")
    .replace(/\u001b[@-_]/g, "");
}

/** The last screen clear in the PTY stream is the stable (post-load) frame. */
function lastFrame(stream: Buffer, rows: number, columns: number): string {
  const clearAt = stream.lastIndexOf(CLEAR);
  if (clearAt < 0) fail("no screen clear in the pty stream");
  const text = stripControls(stream.subarray(clearAt + CLEAR.length).toString("utf8")).replace(/\r/g, "");
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  const lines = trimmed.length === 0 ? [] : trimmed.split("\n");
  while (lines.length > rows && lines[lines.length - 1] === "") lines.pop();
  if (lines.length > rows) fail(`frame taller than the window (${lines.length} > ${rows})`);
  while (lines.length < rows) lines.push("");
  for (const line of lines) {
    if (line.length > columns) fail(`frame line wider than the window (${line.length} > ${columns})`);
    if (line.includes("\u001b")) fail("frame line still carries an escape sequence");
  }
  return `${lines.join("\n")}\n`;
}

/** Artifact record rows start with exactly two spaces, then the id, then two spaces. */
function artifactRowIds(frame: string): string[] {
  const ids: string[] = [];
  for (const line of frame.split("\n")) {
    const match = /^  (art_[a-z0-9_]+?)  /.exec(line);
    if (match !== null && match[1] !== undefined && !ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
}

interface CaptureSpec {
  name: string;
  workspaceId: string;
  expect: string;
  columns: number;
  rows: number;
  /** Artifact ids expected as artifact-record rows (order-insensitive). */
  expectedArtifactRows: readonly string[];
  /** Artifact ids that must NOT appear as artifact-record rows. */
  absentArtifactRows: readonly string[];
  /** True when the shipped renderer is expected to draw the section title. */
  sectionTitleExpected: boolean;
}

const CAPTURES: readonly CaptureSpec[] = [
  {
    name: "lab-ana-120x36",
    workspaceId: SCENARIO.workspaces.lab,
    expect: SCENARIO.goal.lab,
    columns: 120,
    rows: 36,
    expectedArtifactRows: [
      SCENARIO.artifacts.safeOutput,
      SCENARIO.artifacts.safeOldReport,
      SCENARIO.artifacts.stale,
      SCENARIO.artifacts.path,
      SCENARIO.artifacts.insecureScheme,
      SCENARIO.artifacts.credentialed,
      SCENARIO.artifacts.hostileMarkup,
    ],
    absentArtifactRows: [],
    sectionTitleExpected: true,
  },
  {
    name: "lab-ana-80x24",
    workspaceId: SCENARIO.workspaces.lab,
    expect: SCENARIO.goal.lab,
    columns: 80,
    rows: 24,
    expectedArtifactRows: [SCENARIO.artifacts.safeOutput],
    absentArtifactRows: [],
    // At 80x24 the shared fit policy drops rank-1 chrome (including the
    // section title) before rank-0 record lines; the artifact record lines
    // themselves still carry the label. Recorded, not asserted.
    sectionTitleExpected: false,
  },
  {
    name: "trunc-ana-120x36",
    workspaceId: SCENARIO.workspaces.truncArtifacts,
    expect: SCENARIO.artifacts.truncLinked,
    columns: 120,
    rows: 36,
    expectedArtifactRows: [
      SCENARIO.artifacts.truncLinked,
      "art_arh001_trunc_filler_09",
      "art_arh001_trunc_filler_08",
      "art_arh001_trunc_filler_07",
      "art_arh001_trunc_filler_06",
      "art_arh001_trunc_filler_05",
      "art_arh001_trunc_filler_04",
      "art_arh001_trunc_filler_03",
      "art_arh001_trunc_filler_02",
      "art_arh001_trunc_filler_01",
    ],
    absentArtifactRows: [SCENARIO.artifacts.truncBeyondPage, SCENARIO.artifacts.truncOlder],
    sectionTitleExpected: true,
  },
];

function rendererFallback(db: string, spec: CaptureSpec): string {
  const runtime = createRuntimeFromPath(db);
  try {
    const context = dispatchCampfireMethod(
      runtime.service,
      { actor: { actorId: SCENARIO.humans.ana, actorType: "human" } },
      "get_workspace_context",
      { workspaceId: spec.workspaceId },
    ) as WorkspaceContext;
    const state = createDashboardState({
      workspaceId: spec.workspaceId,
      actorId: SCENARIO.humans.ana,
      actorType: "human",
      context,
      refreshedAt: new Date().toISOString(),
    });
    const frame = renderDashboard(state, spec.columns, spec.rows);
    return frame.endsWith("\n") ? frame : `${frame}\n`;
  } finally {
    runtime.close();
  }
}

const args = parseArgs(process.argv.slice(2));
mkdirSync(args.out, { recursive: true });
const configDir = resolve(args.out, "..", "pty-config");
mkdirSync(configDir, { recursive: true });

const summary: Array<Record<string, unknown>> = [];
let exitFailures = 0;

for (const spec of CAPTURES) {
  const record: Record<string, unknown> = {
    name: spec.name,
    workspaceId: spec.workspaceId,
    actorId: SCENARIO.humans.ana,
    actorType: "human",
    columns: spec.columns,
    rows: spec.rows,
  };
  let frame: string | undefined;
  let method: "pty" | "renderer-fallback" = "pty";
  try {
    const result = runDashboard({
      db: args.db,
      workspaceId: spec.workspaceId,
      actorId: SCENARIO.humans.ana,
      rows: spec.rows,
      columns: spec.columns,
      configDir,
      expect: spec.expect,
    });
    record.pty = {
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      sent: result.sent,
      termiosRestored: result.termiosRestored,
      stderr: redact(result.stderr),
      enterAltScreen: result.stream.includes(ENTER),
      leaveAltScreen: result.stream.includes(LEAVE),
      hideCursor: result.stream.includes(HIDE),
      showCursor: result.stream.includes(SHOW),
    };
    frame = lastFrame(result.stream, spec.rows, spec.columns);
    writeFileSync(resolve(args.out, `${spec.name}.raw`), result.stream);
  } catch (error) {
    record.pty = { error: redact(error instanceof Error ? error.message : String(error)) };
    method = "renderer-fallback";
    record.fallbackReason = "pty capture failed in this environment; see pty.error";
    frame = rendererFallback(args.db, spec);
  }
  if (frame === undefined) fail(`no frame produced for ${spec.name}`);
  const rowsSeen = artifactRowIds(frame);
  const checks: Record<string, unknown> = {
    lineCount: frame.split("\n").length - 1,
    sectionTitleDrawn: frame.includes("ARTIFACT REFERENCES"),
    referenceLabelDrawn: frame.includes("stored reference, not fetched"),
    artifactRowsDrawn: rowsSeen,
    expectedArtifactRowsPresent: spec.expectedArtifactRows.every((id) => rowsSeen.includes(id)),
    absentArtifactRowsAbsent: spec.absentArtifactRows.every((id) => !rowsSeen.includes(id)),
    moreAvailableDrawn: frame.includes("more available"),
    showingTruncCountDrawn: /showing 10 of 12/.test(frame),
    noEscapeControls: !frame.includes("\u001b"),
    noCredentialShape: !frame.includes("cft_"),
    noHomePath: !frame.includes("/Users/"),
    noUnrelatedSentinel: !frame.includes("UNRELATED_FINDING_SENTINEL_arh001_do_not_leak"),
  };
  record.checks = checks;
  record.method = method;
  // The .txt is the rendered frame; the method that produced it is stated in
  // the summary file (and in SURFACE_FACTS.md) — never passed off as a PTY frame.
  writeFileSync(resolve(args.out, `${spec.name}.txt`), frame);

  const critical =
    checks.lineCount === spec.rows &&
    checks.referenceLabelDrawn === true &&
    checks.expectedArtifactRowsPresent === true &&
    checks.absentArtifactRowsAbsent === true &&
    checks.noEscapeControls === true &&
    checks.noCredentialShape === true &&
    checks.noHomePath === true &&
    checks.noUnrelatedSentinel === true;
  record.passed = critical;
  if (!critical) exitFailures += 1;
  summary.push(record);
  process.stdout.write(`${spec.name}: method=${method} passed=${critical}\n`);
}

writeFileSync(
  resolve(args.out, "capture-summary.json"),
  `${JSON.stringify(
    {
      provenance: "FIXTURE EVIDENCE — cannot establish Gate B, C, or E.",
      methodNote:
        "pty = real `campfire dashboard` in a python3 pty at the stated winsize, last screen clear, controls stripped; renderer-fallback = exported renderDashboard at the stated size (labeled per capture).",
      captures: summary,
    },
    null,
    2,
  )}\n`,
);
if (exitFailures > 0) {
  fail(`${exitFailures} capture(s) failed a critical check; see capture-summary.json`);
}
process.stdout.write(`${JSON.stringify({ outDir: args.out, captures: summary.length }, null, 2)}\n`);
