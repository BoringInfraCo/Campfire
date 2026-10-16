import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SCENARIO, UNRELATED_FINDING_SENTINEL, seedDatabase } from "../../fixtures/attention/att-001/seed.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EVIDENCE = join(ROOT, "docs/evidence/uix-001/candidate/terminal");
// Evidence capture is an explicit opt-in step. The default suite asserts the
// PTY behavior without Playwright (not a repo dependency) and never writes
// into docs/; regenerate the committed captures with CAMPFIRE_UIX_CAPTURE=1
// and CAMPFIRE_PLAYWRIGHT_NODE_PATH pointing at an external node_modules
// directory that contains playwright.
const CAPTURE_ENABLED = process.env.CAMPFIRE_UIX_CAPTURE === "1";
const PLAYWRIGHT_NODE_PATH = process.env.CAMPFIRE_PLAYWRIGHT_NODE_PATH ?? "";
const FRAME_SIZES = [
  { columns: 80, rows: 24, name: "ana-lab-80x24" },
  { columns: 120, rows: 36, name: "ana-lab-120x36" },
] as const;
const GOAL_ID = SCENARIO.goal.lab;
const WORKSPACE_ID = SCENARIO.workspaces.lab;
const ACTOR_ID = SCENARIO.humans.ana;

const ENTER = "\u001b[?1049h";
const HIDE = "\u001b[?25l";
const SHOW = "\u001b[?25h";
const LEAVE = "\u001b[?1049l";
const CLEAR = "\u001b[2J";

interface PtyResult {
  exitCode: number | null;
  timedOut: boolean;
  sent: boolean;
  termiosBefore: unknown;
  termiosAfter: unknown;
  stream: Buffer;
  stderr: string;
}

let scratch: string | undefined;

afterEach(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

function seedScratch(): string {
  scratch = mkdtempSync(join(tmpdir(), "campfire-uix-pty-"));
  const seeded = seedDatabase(scratch, true, "none");
  return seeded.databasePath;
}

function redact(text: string): string {
  return text
    .replace(/cft_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\/Users\/\S+/g, "[path]")
    .replace(/\/private\/\S+/g, "[path]")
    .replace(/\/var\/folders\/\S+/g, "[path]");
}

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
timed_out = False
deadline = time.monotonic() + float(cfg["timeout"])
goal = cfg["goal"].encode("utf-8")
mode = cfg["mode"]

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
        if (not sent) and goal in buf:
            sent = True
            try:
                if mode == "q":
                    os.write(master, b"q")
                elif mode == "ctrl-c":
                    os.write(master, b"\\x03")
                elif mode == "sigint":
                    os.kill(proc.pid, signal.SIGINT)
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

function runDashboard(db: string, configDir: string, rows: number, cols: number, mode: "q" | "ctrl-c" | "sigint"): PtyResult {
  const argv = [
    join(ROOT, "node_modules/.bin/tsx"),
    join(ROOT, "src/cli/index.ts"),
    "dashboard",
    WORKSPACE_ID,
    "--db",
    db,
    "--actor",
    ACTOR_ID,
    "--type",
    "human",
  ];
  const child = spawnSync("python3", ["-c", PTY_DRIVER, JSON.stringify({
    argv,
    cwd: ROOT,
    configDir,
    rows,
    cols,
    mode,
    goal: GOAL_ID,
    timeout: 20,
  })], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (child.error !== undefined) {
    throw new Error(redact(String(child.error)));
  }
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
    termiosBefore: parsed.termiosBefore,
    termiosAfter: parsed.termiosAfter,
    stream: Buffer.from(parsed.stream, "base64"),
    stderr: parsed.stderr,
  };
}

function assertRestored(result: PtyResult, exitCodes: number[]): void {
  expect(result.timedOut, redact(result.stderr)).toBe(false);
  expect(result.sent, redact(result.stderr)).toBe(true);
  expect(exitCodes, redact(result.stderr)).toContain(result.exitCode);
  expect(result.termiosAfter, "slave termios was not restored").toEqual(result.termiosBefore);
  const enter = result.stream.indexOf(ENTER);
  const hide = result.stream.indexOf(HIDE, Math.max(0, enter));
  const show = result.stream.indexOf(SHOW, Math.max(0, hide));
  const leave = result.stream.indexOf(LEAVE, Math.max(0, show));
  const goal = result.stream.indexOf(GOAL_ID);
  expect(enter, "missing enter alternate screen").toBeGreaterThanOrEqual(0);
  expect(hide, "missing hide cursor").toBeGreaterThan(enter);
  expect(show, "missing show cursor").toBeGreaterThan(hide);
  expect(leave, "missing leave alternate screen").toBeGreaterThan(show);
  expect(goal, "goal was not drawn").toBeGreaterThanOrEqual(0);
  expect(goal, "goal was not drawn before leaving the screen").toBeLessThan(leave);
}

function stripControls(text: string): string {
  return text
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[\x20-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "")
    .replace(/\u001b[@-_]/g, "");
}

function lastFrame(stream: Buffer, rows: number, columns: number): string {
  const clearAt = stream.lastIndexOf(CLEAR);
  expect(clearAt, "no screen clear in the pty stream").toBeGreaterThanOrEqual(0);
  const text = stripControls(stream.subarray(clearAt + CLEAR.length).toString("utf8")).replace(/\r/g, "");
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  const lines = trimmed.length === 0 ? [] : trimmed.split("\n");
  while (lines.length > rows && lines[lines.length - 1] === "") lines.pop();
  expect(lines.length, "frame taller than the window").toBeLessThanOrEqual(rows);
  while (lines.length < rows) lines.push("");
  for (const line of lines) {
    expect(line.length).toBeLessThanOrEqual(columns);
    expect(line.includes("\u001b")).toBe(false);
  }
  return `${lines.join("\n")}\n`;
}

function assertFrameFacts(text: string, size: { columns: number; rows: number }): void {
  expect(text).toContain(GOAL_ID);
  expect(text).toContain("Make team attention cues trustworthy without changing recorded work.");
  expect(text).toContain("q quit");
  expect(text).toContain(WORKSPACE_ID);
  expect(text).toMatch(/20\/21|20 of 21/);
  expect(text.includes("\u001b")).toBe(false);
  expect(text.includes("cft_")).toBe(false);
  expect(text.includes("/Users/")).toBe(false);
  expect(text.includes(UNRELATED_FINDING_SENTINEL)).toBe(false);
  const lines = text.slice(0, -1).split("\n");
  expect(lines).toHaveLength(size.rows);
  if (size.columns === 120) {
    expect(lines.some((line) => line.length > 80)).toBe(true);
  }
}

describe("UIX-001 dashboard pty", () => {
  it("restores the terminal after q", () => {
    const db = seedScratch();
    assertRestored(runDashboard(db, scratch ?? "", 24, 80, "q"), [0]);
  }, 90_000);

  it("restores the terminal after raw Ctrl-C", () => {
    const db = seedScratch();
    assertRestored(runDashboard(db, scratch ?? "", 24, 80, "ctrl-c"), [0]);
  }, 90_000);

  it("restores the terminal after external SIGINT", () => {
    const db = seedScratch();
    assertRestored(runDashboard(db, scratch ?? "", 24, 80, "sigint"), [0, 130]);
  }, 90_000);

  it("renders truthful frames at 80x24 and 120x36", () => {
    const db = seedScratch();
    for (const size of FRAME_SIZES) {
      const result = runDashboard(db, scratch ?? "", size.rows, size.columns, "q");
      assertRestored(result, [0]);
      assertFrameFacts(lastFrame(result.stream, size.rows, size.columns), size);
    }
  }, 120_000);

  // Optional evidence step; skipped unless CAMPFIRE_UIX_CAPTURE=1. Regenerate
  // the committed captures with:
  //   CAMPFIRE_UIX_CAPTURE=1 \
  //   CAMPFIRE_PLAYWRIGHT_NODE_PATH=<node_modules containing playwright> \
  //   npx vitest run tests/unit/uix-001-dashboard-pty.test.ts
  it.skipIf(!CAPTURE_ENABLED)("captures terminal evidence frames (opt-in)", () => {
    expect(
      PLAYWRIGHT_NODE_PATH.length > 0 && existsSync(join(PLAYWRIGHT_NODE_PATH, "playwright")),
      "set CAMPFIRE_PLAYWRIGHT_NODE_PATH to an external node_modules directory containing playwright",
    ).toBe(true);
    const db = seedScratch();
    mkdirSync(EVIDENCE, { recursive: true });
    const frames: Array<{ name: string; columns: number; rows: number; text: string }> = [];
    for (const size of FRAME_SIZES) {
      const result = runDashboard(db, scratch ?? "", size.rows, size.columns, "q");
      assertRestored(result, [0]);
      const text = lastFrame(result.stream, size.rows, size.columns);
      assertFrameFacts(text, size);
      writeFileSync(join(EVIDENCE, `${size.name}.txt`), text);
      frames.push({ name: size.name, columns: size.columns, rows: size.rows, text });
    }
    const shot = spawnSync(
      process.execPath,
      ["-e", SHOT_SCRIPT],
      {
        input: JSON.stringify({ frames, outDir: EVIDENCE }),
        encoding: "utf8",
        env: { ...process.env, NODE_PATH: PLAYWRIGHT_NODE_PATH, HOME: userInfo().homedir },
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    expect(shot.status, redact(shot.stderr ?? shot.stdout ?? "")).toBe(0);
    for (const size of FRAME_SIZES) {
      const png = readFileSync(join(EVIDENCE, `${size.name}.png`));
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    }
  }, 120_000);
});

const SHOT_SCRIPT = `
const { Module } = require("module");
Module._initPaths();
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

function escapeHtml(value) {
  return value.replace(/[&<>]/g, (ch) => (ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : "&gt;"));
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  const payload = JSON.parse(raw);
  chromium.launch({ headless: true }).then(async (browser) => {
    for (const frame of payload.frames) {
      const width = frame.columns * 9;
      const height = frame.rows * 18;
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      const html = "<!doctype html><html><head><meta charset=\\"utf-8\\"><style>"
        + "html,body,pre{margin:0;background:#171717;color:#e8eef0;}"
        + "pre{font-family:ui-monospace,Menlo,monospace;white-space:pre;line-height:18px;font-size:15px;}"
        + "</style></head><body><pre>" + escapeHtml(frame.text.replace(/\\n$/, "")) + "</pre></body></html>";
      await page.setContent(html, { waitUntil: "load" });
      let size = 15;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await page.evaluate((px) => { document.querySelector("pre").style.fontSize = px + "px"; }, size);
        const scrollWidth = await page.evaluate(() => document.querySelector("pre").scrollWidth);
        if (scrollWidth <= width) break;
        size -= 1;
      }
      await page.screenshot({ path: path.join(payload.outDir, frame.name + ".png"), fullPage: false });
      await page.close();
    }
    await browser.close();
  }).catch((error) => {
    console.error(String(error && error.stack ? error.stack : error));
    process.exit(1);
  });
});
`;
