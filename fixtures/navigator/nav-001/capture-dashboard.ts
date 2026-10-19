/**
 * NAV-001 dashboard capture for pinned baselines (Step 0, contract §3).
 *
 * FIXTURE EVIDENCE — frames are engineering evidence; cannot establish Gate B,
 * C, or E, and a scripted capture is never human-observation evidence.
 *
 * Drives the REAL `campfire dashboard` command inside a python3 pty (the same
 * approach as tests/unit/uix-001-dashboard-pty.test.ts and
 * fixtures/artifact-handoff/arh-001/capture-dashboard.ts): it waits for the
 * workspace goal-id marker, optionally applies a scripted key sequence, then
 * sends `q` and extracts the last screen clear as the stable frame.
 *
 * The dashboard that runs is the one belonging to the repo root that contains
 * this fixture file:
 *
 *   npx tsx fixtures/navigator/nav-001/capture-dashboard.ts \
 *     --db <campfire.db> --workspace <wsId> --actor <actorId> \
 *     [--actor-type human] [--out <dir>] [--label <name>] \
 *     [--keys "<k1,k2,...>"] [--key-delay 0.15] [--sizes 80x24,120x36]
 *
 * `--root <worktree>` retargets the spawn so a v1.21.0 git worktree can be
 * captured without modifying the main checkout: argv becomes
 * `<root>/node_modules/.bin/tsx <root>/src/cli/index.ts dashboard ...` and the
 * process cwd becomes `<root>`.
 *
 * Named keys: tab, enter, esc (single control bytes). A token `wait:<text>`
 * pauses until that text is in the pty stream. Every other token is sent
 * literally. `--until <text>` sends q only after that text appears. With no
 * --keys only the wake-up `q` is sent (the UIX-001 default). One file per
 * size is written: `<label>-<columns>x<rows>.txt` plus
 * `capture-summary.json` (method, sizes, key script, sha256 per file).
 *
 * REDACT + hard-fail: credential-shaped `cft_*` strings and absolute
 * /Users/, /private/, /var/folders/ paths are redacted before writing, and
 * the unrelated-workspace sentinels of both sprints must never appear in any
 * written capture file — if any forbidden string survives redaction the tool
 * fails without writing anything.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCampfireService } from "../../../src/service/campfire-service.js";
import { openReadonlySqliteStore } from "../../../src/store/sqlite-store.js";
import { UNRELATED_FINDING_SENTINEL as ATT_001_SENTINEL } from "../../attention/att-001/seed.js";
import { UNRELATED_FINDING_SENTINEL as NAV_001_SENTINEL } from "./seed.js";

/** Repo root of THIS fixture file; the default dashboard root. */
const DEFAULT_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const FORBIDDEN_STRINGS: readonly string[] = [
  "cft_",
  "/Users/",
  "/private/",
  "/var/folders/",
  ATT_001_SENTINEL,
  NAV_001_SENTINEL,
];

const ENTER = "\u001b[?1049h";
const HIDE = "\u001b[?25l";
const SHOW = "\u001b[?25h";
const LEAVE = "\u001b[?1049l";
const CLEAR = "\u001b[2J";

/** python3 PTY driver (adapted from tests/unit/uix-001-dashboard-pty.test.ts). */
const PTY_DRIVER = `
import base64, fcntl, json, os, select, signal, struct, subprocess, sys, termios, time

def freeze_termios(attr):
    frozen = []
    for item in attr:
        if isinstance(item, list):
            row = []
            for cell in item:
                if isinstance(cell, bytes):
                    row.append(list(cell))
                else:
                    row.append(cell)
            frozen.append(row)
        elif isinstance(item, bytes):
            frozen.append(list(item))
        else:
            frozen.append(item)
    return frozen

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
armed = False
timed_out = False
deadline = time.monotonic() + float(cfg["timeout"])
expect = cfg["expect"].encode("utf-8")
until = cfg.get("until") or ""
until_bytes = until.encode("utf-8")

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
                for key in cfg["keys"]:
                    if key.startswith("wait:"):
                        needle = key[5:].encode("utf-8")
                        while needle not in buf and proc.poll() is None:
                            if time.monotonic() >= deadline:
                                timed_out = True
                                break
                            ready, _, _ = select.select([master], [], [], 0.1)
                            if master in ready:
                                chunk = pull(master)
                                if chunk:
                                    buf += chunk
                        if timed_out or needle not in buf:
                            break
                        continue
                    os.write(master, key.encode("utf-8"))
                    time.sleep(float(cfg["keyDelay"]))
                if until_bytes == b"" and not timed_out:
                    os.write(master, b"q")
                    armed = True
            except OSError:
                pass
        if sent and (not armed) and until_bytes != b"" and until_bytes in buf:
            try:
                os.write(master, b"q")
            except OSError:
                pass
            armed = True
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
    sys.stdout.write(json.dumps({
        "exitCode": proc.returncode,
        "timedOut": timed_out,
        "sent": sent,
        "termiosBefore": freeze_termios(before),
        "termiosAfter": freeze_termios(after),
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

function fail(message: string): never {
  throw new Error(`nav-001 capture-dashboard: ${message}`);
}

function redact(text: string): string {
  return text
    .replace(/cft_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\/Users\/\S+/g, "[path]")
    .replace(/\/private\/\S+/g, "[path]")
    .replace(/\/var\/folders\/\S+/g, "[path]");
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

interface CaptureArgs {
  db: string;
  workspaceId: string;
  actorId: string;
  actorType: "human" | "agent";
  out: string;
  label: string;
  keys: string[];
  keysLiteral: boolean;
  keyDelay: string;
  until: string;
  sizes: Array<{ columns: number; rows: number }>;
  root: string;
}

const KEY_NAMES: Record<string, string> = { tab: "\t", enter: "\r", esc: "\u001b" };

function parseArgs(argv: string[]): CaptureArgs {
  const parsed: Partial<CaptureArgs> = {
    actorType: "human",
    out: resolve(process.cwd(), ".tmp", "dashboard-capture"),
    label: "capture",
    keyDelay: "0.15",
    until: "",
    sizes: [
      { columns: 80, rows: 24 },
      { columns: 120, rows: 36 },
    ],
    root: DEFAULT_ROOT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--actor-type") {
      if (value !== "human" && value !== "agent") fail("--actor-type requires human|agent");
      parsed.actorType = value;
      index += 1;
      continue;
    }
    if (arg === "--out" || arg === "--label" || arg === "--root" || arg === "--workspace") {
      if (value === undefined || value.startsWith("--")) fail(`${arg} requires a value`);
      if (arg === "--out") parsed.out = isAbsolute(value) ? value : resolve(value);
      else if (arg === "--label") parsed.label = value;
      else if (arg === "--root") parsed.root = isAbsolute(value) ? value : resolve(value);
      else parsed.workspaceId = value;
      index += 1;
      continue;
    }
    if (arg === "--until") {
      if (value === undefined || value.startsWith("--")) fail("--until requires a marker that must appear before quit");
      parsed.until = value;
      index += 1;
      continue;
    }
    if (arg === "--key-delay") {
      if (value === undefined || !/^\d+(\.\d+)?$/.test(value)) fail("--key-delay requires a number of seconds");
      parsed.keyDelay = value;
      index += 1;
      continue;
    }
    if (arg === "--keys") {
      if (value === undefined || value.startsWith("--")) fail("--keys requires a value");
      const keys = value
        .split(",")
        .filter((token) => token.length > 0)
        .map((token) => KEY_NAMES[token] ?? token);
      parsed.keysLiteral = true;
      parsed.keys = keys;
      index += 1;
      continue;
    }
    if (arg === "--sizes") {
      if (value === undefined || value.startsWith("--")) fail("--sizes requires a value");
      const sizes = value.split(",").filter((token) => token.length > 0).map((token) => {
        const match = /^(\d+)x(\d+)$/.exec(token);
        if (match === null) fail(`--sizes entries must be <columns>x<rows>, got ${JSON.stringify(token)}`);
        return { columns: Number(match[1]), rows: Number(match[2]) };
      });
      if (sizes.length === 0) fail("--sizes produced no captures");
      parsed.sizes = sizes;
      index += 1;
      continue;
    }
    if (arg === "--db") {
      if (value === undefined || value.startsWith("--")) fail("--db requires a value");
      parsed.db = isAbsolute(value) ? value : resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--actor") {
      if (value === undefined || value.startsWith("--")) fail("--actor requires a value");
      parsed.actorId = value;
      index += 1;
      continue;
    }
    fail(`unknown argument ${arg}`);
  }
  if (parsed.db === undefined) fail("--db is required");
  if (parsed.workspaceId === undefined) fail("--workspace is required");
  if (parsed.actorId === undefined) fail("--actor is required");
  return parsed as CaptureArgs;
}

/** The marker the UIX-001 harness waits for: the workspace's recorded goal id. */
function resolveMarker(args: CaptureArgs): string {
  if (!existsSync(args.db)) fail(`--db not found: ${redact(args.db)}`);
  const store = openReadonlySqliteStore(args.db);
  const service = createCampfireService({
    store,
    clock: () => "2026-01-01T00:00:00.000Z",
  });
  try {
    const context = service.getWorkspaceContext(
      { actor: { actorId: args.actorId, actorType: args.actorType } },
      args.workspaceId,
    );
    return context.goal?.id ?? args.workspaceId;
  } catch (error) {
    fail(
      `could not resolve the goal-id marker for ${JSON.stringify(args.workspaceId)} as ${args.actorId}: ${
        error instanceof Error ? redact(error.message) : String(error)
      }`,
    );
  } finally {
    service.close();
  }
}

function runDashboard(input: {
  root: string;
  db: string;
  workspaceId: string;
  actorId: string;
  actorType: string;
  rows: number;
  columns: number;
  configDir: string;
  expect: string;
  keys: string[];
  keyDelay: string;
  until: string;
}): PtyResult {
  const argv = [
    join(input.root, "node_modules/.bin/tsx"),
    join(input.root, "src/cli/index.ts"),
    "dashboard",
    input.workspaceId,
    "--db",
    input.db,
    "--actor",
    input.actorId,
    "--type",
    input.actorType,
  ];
  if (!existsSync(argv[0]!)) fail(`dashboard runtime not found at ${redact(argv[0])}; run npm ci in --root first`);
  const child = spawnSync(
    "python3",
    [
      "-c",
      PTY_DRIVER,
      JSON.stringify({
        argv,
        cwd: input.root,
        configDir: input.configDir,
        rows: input.rows,
        cols: input.columns,
        expect: input.expect,
        keys: input.keys,
        keyDelay: input.keyDelay,
        until: input.until,
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
    termiosBefore: unknown;
    termiosAfter: unknown;
    stream: string;
    stderr: string;
  };
  return {
    exitCode: parsed.exitCode,
    timedOut: parsed.timedOut,
    sent: parsed.sent,
    termiosRestored: JSON.stringify(parsed.termiosBefore) === JSON.stringify(parsed.termiosAfter),
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

/** Defense in depth: redact credential/home-path shapes before any write. */
function redactForWrite(text: string): { text: string; redactions: number } {
  const before = text;
  const after = redact(text);
  return { text: after, redactions: countDifference(before, after) };
}

function countDifference(before: string, after: string): number {
  if (before === after) return 0;
  const beforeTokens = before.match(/cft_[A-Za-z0-9_-]+|\/Users\/\S+|\/private\/\S+|\/var\/folders\/\S+/g) ?? [];
  const afterTokens = after.match(/cft_[A-Za-z0-9_-]+|\/Users\/\S+|\/private\/\S+|\/var\/folders\/\S+/g) ?? [];
  return Math.max(beforeTokens.length - afterTokens.length, 0);
}

function assertNoLeaks(name: string, text: string): void {
  for (const forbidden of FORBIDDEN_STRINGS) {
    if (text.includes(forbidden)) fail(`${name} would leak ${JSON.stringify(forbidden)}`);
  }
}

const args = parseArgs(process.argv.slice(2));

let configDir: string | undefined;
try {
  const marker = resolveMarker(args);
  configDir = mkdtempSync(join(tmpdir(), "campfire-nav-pty-"));
  mkdirSync(args.out, { recursive: true });

  interface CaptureRecord {
    file: string;
    columns: number;
    rows: number;
    sha256: string;
    text: string;
    pty: Record<string, unknown>;
    checks: Record<string, unknown>;
    redactions: number;
  }

  const captures: CaptureRecord[] = [];
  for (const size of args.sizes) {
    const result = runDashboard({
      root: args.root,
      db: args.db,
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      actorType: args.actorType,
      rows: size.rows,
      columns: size.columns,
      configDir,
      expect: marker,
      keys: args.keysLiteral ? args.keys : [],
      keyDelay: args.keyDelay,
      until: args.until,
    });
    if (result.timedOut) fail(`dashboard never drew the marker ${JSON.stringify(marker)}; see summary notes`);
    if (!result.sent) fail("the key script was never sent (marker never appeared)");
    if (result.exitCode !== 0) fail(`dashboard exited ${String(result.exitCode)}: ${redact(result.stderr)}`);
    const rawFrame = lastFrame(result.stream, size.rows, size.columns);
    const { text: frame, redactions } = redactForWrite(rawFrame);
    assertNoLeaks(`${args.label}-${size.columns}x${size.rows}.txt`, frame);
    const lines = frame.slice(0, -1).split("\n");
    const record: CaptureRecord = {
      file: `${args.label}-${size.columns}x${size.rows}.txt`,
      columns: size.columns,
      rows: size.rows,
      sha256: sha256(frame),
      text: frame,
      pty: {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        sent: result.sent,
        termiosRestored: result.termiosRestored,
        stderr: redact(result.stderr),
        enterAltScreen: result.stream.includes(ENTER),
        leaveAltScreen: result.stream.includes(LEAVE),
        hideCursor: result.stream.includes(HIDE),
        showCursor: result.stream.includes(SHOW),
      },
      checks: {
        lineCount: lines.length,
        widestLine: lines.reduce((max, line) => Math.max(max, line.length), 0),
        noEscapeControls: !frame.includes("\u001b"),
        bellRemaining: frame.includes("\u0007"),
        noCredentialShape: !frame.includes("cft_"),
        noHomePath: !frame.includes("/Users/"),
        noPrivatePath: !frame.includes("/private/") && !frame.includes("/var/folders/"),
        noUnrelatedSentinel: !frame.includes(ATT_001_SENTINEL) && !frame.includes(NAV_001_SENTINEL),
      },
      redactions,
    };
    captures.push(record);
    process.stdout.write(
      `${record.file}: lines=${record.checks.lineCount} widest=${record.checks.widestLine} sha256=${record.sha256}\n`,
    );
  }

  for (const capture of captures) {
    writeFileSync(resolve(args.out, capture.file), capture.text);
  }
  const summary = {
    provenance: "FIXTURE EVIDENCE — frames are engineering evidence, not human evidence; cannot establish Gate B, C, or E.",
    method: "pty",
    methodNote:
      "Real `campfire dashboard` spawned in a python3 pty at the stated winsize, CAMPFIRE_TELEMETRY=0 and an isolated CAMPFIRE_CONFIG_DIR/CAMPFIRE_DATA_DIR; waits for the workspace goal-id marker, applies the scripted key sequence when present, then sends q; the frame is the text after the last \\u001b[2J with controls stripped.",
    label: args.label,
    root: redact(args.root),
    db: redact(args.db),
    workspaceId: args.workspaceId,
    actorId: args.actorId,
    actorType: args.actorType,
    marker,
    keys: args.keysLiteral ? args.keys : "default",
    keyDelaySeconds: args.keyDelay,
    until: args.until.length > 0 ? args.until : "quit immediately after keys",
    keyNote:
      "Named keys: tab, enter, esc (single control bytes); every other key is sent literally as its characters. The default key script is the wake-up q only, like the UIX-001 harness. SCRIPTED CAPTURES ARE NOT HUMAN OBSERVATION EVIDENCE.",
    sizes: args.sizes.map((size) => ({ columns: size.columns, rows: size.rows })),
    captures: captures.map((capture) => ({
      file: capture.file,
      columns: capture.columns,
      rows: capture.rows,
      sha256: capture.sha256,
      pty: capture.pty,
      checks: capture.checks,
      redactionsAppliedBeforeWrite: capture.redactions,
    })),
    notes: [
      "Frames are engineering evidence, not human evidence. They cannot establish Gate B, C, or E.",
      "Scripted captures are not human observation evidence; a scripted PTY run is a debugging rehearsal.",
      "cft-shaped tokens and absolute home/system-temp paths are redacted before writing; both sprint sentinels must never appear and abort the capture instead.",
    ],
  };
  const summaryText = `${JSON.stringify(summary, null, 2)}\n`;
  assertNoLeaks("capture-summary.json", summaryText);
  writeFileSync(resolve(args.out, "capture-summary.json"), summaryText);
  process.stdout.write(`${JSON.stringify({ outDir: args.out, captures: captures.length }, null, 2)}\n`);
} finally {
  if (configDir !== undefined) rmSync(configDir, { recursive: true, force: true });
}
