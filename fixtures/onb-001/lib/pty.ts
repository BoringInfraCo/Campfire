/**
 * ONB-001 PTY driver.
 *
 * FIXTURE EVIDENCE TOOLING — not product code. Runs the REAL campfire CLI
 * inside a python3 pty so interactive first-run paths (name prompt, terminal
 * SIGINT shutdown, browser-open branch) can be captured with terminal
 * fidelity. A scripted PTY run is a debugging rehearsal, never human evidence.
 *
 * Mechanics proven for the v1.22.0 baseline:
 *  - The child is made a session leader with `os.login_tty(0)`, so the pty is
 *    its controlling terminal and a written `\u0003` delivers a real SIGINT.
 *  - On macOS an exited session leader can stay unreaped until the pty master
 *    is closed; the driver therefore drains, snapshots termios, closes the
 *    master, and only then calls wait().
 *  - stderr is routed to the same pty slave so the captured stream is what a
 *    terminal user would actually see (stdout and stderr interleaved).
 *
 * Steps are executed in order: when `expect` appears anywhere in the stream so
 * far, `send` (raw bytes, base64-encoded for python) is written to the master.
 * If a step never matches the run is reported with stepsSent < stepsTotal and
 * the caller must fail loudly.
 */
import { spawnSync } from "node:child_process";

export interface PtyStep {
  /** Substring (raw, pre-redaction) to wait for before sending. */
  expect: string;
  /** Raw bytes to write (usually text plus "\n" or "\u0003" for ^C). */
  send: string;
  /**
   * Milliseconds to keep draining output after `expect` matched, before the
   * bytes are written. Interactive ^C must not race the shutdown-handler
   * registration that happens just after a marker line is written, so steps
   * that send "\u0003" use a short delay.
   */
  sendDelayMs?: number;
}

export interface PtyRunInput {
  argv: string[];
  cwd: string;
  /** Complete child environment (the driver passes it through verbatim). */
  env: Record<string, string>;
  steps: PtyStep[];
  rows?: number;
  cols?: number;
  timeoutMs?: number;
  quietMs?: number;
}

export interface PtyRunResult {
  exitCode: number | null;
  timedOut: boolean;
  stepsSent: number;
  stepsTotal: number;
  /** before/after termios snapshots are equal (tty state restored on exit). */
  termiosRestored: boolean;
  stream: Buffer;
  driverError?: string;
}

const PTY_DRIVER = `
import base64, fcntl, json, os, select, signal, struct, subprocess, sys, termios, time

cfg = json.loads(sys.argv[1])

def freeze(attr):
    out = []
    for item in attr:
        if isinstance(item, list):
            row = []
            for cell in item:
                row.append(list(cell) if isinstance(cell, bytes) else cell)
            out.append(row)
        elif isinstance(item, bytes):
            out.append(list(item))
        else:
            out.append(item)
    return out

master, slave = os.openpty()
rows = int(cfg["rows"]); cols = int(cfg["cols"])
winsz = struct.pack("HHHH", rows, cols, 0, 0)
fcntl.ioctl(slave, termios.TIOCSWINSZ, winsz)
fcntl.ioctl(master, termios.TIOCSWINSZ, winsz)
before = termios.tcgetattr(slave)

steps = [(s["expect"].encode("utf-8"), base64.b64decode(s["send"]), float(s.get("sendDelayMs", 0)) / 1000.0) for s in cfg["steps"]]

def child_setup():
    os.login_tty(0)  # child session leader; the pty becomes its controlling tty

proc = subprocess.Popen(
    cfg["argv"], stdin=slave, stdout=slave, stderr=slave,
    env=dict(cfg["env"]), cwd=cfg["cwd"], preexec_fn=child_setup, close_fds=True,
)

buf = b""
idx = 0
timed = False
eof = False
quiet = float(cfg["quietMs"]) / 1000.0
deadline = time.monotonic() + float(cfg["timeoutMs"]) / 1000.0
settle_until = None

while True:
    now = time.monotonic()
    if now >= deadline:
        timed = True
        break
    if idx >= len(steps):
        if settle_until is None:
            settle_until = now + quiet
        elif now >= settle_until:
            break
    ready, _, _ = select.select([master], [], [], 0.05)
    if master in ready:
        try:
            chunk = os.read(master, 65536)
        except OSError:
            chunk = b""
        if chunk:
            buf += chunk
            settle_until = time.monotonic() + quiet  # any output extends the quiet window
        else:
            eof = True
            break
    if idx < len(steps):
        expect, send, send_delay = steps[idx]
        if expect in buf:
            if send_delay > 0:
                time.sleep(send_delay)  # let the child finish registering its signal handler
            try:
                os.write(master, send)
            except OSError:
                pass
            idx += 1
            settle_until = None

# Drain whatever is buffered, snapshot termios, then close the master (macOS
# reap quirk: an exited session leader is only reaped after the master closes).
# tcgetattr on the slave can fail with ENOTTY once the session leader is gone;
# that is recorded, not fatal.
result = None
try:
    flags = fcntl.fcntl(master, fcntl.F_GETFL)
    fcntl.fcntl(master, fcntl.F_SETFL, flags | os.O_NONBLOCK)
    while True:
        try:
            chunk = os.read(master, 65536)
        except OSError:
            break
        if not chunk:
            break
        buf += chunk
    after = None
    try:
        after = termios.tcgetattr(slave)
    except termios.error:
        after = None
    os.close(master)
    os.close(slave)
    master = None
    slave = None

    code = None
    try:
        code = proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            pass
        try:
            code = proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            code = None

    result = {
        "exitCode": code,
        "timedOut": timed,
        "eof": eof,
        "stepsSent": idx,
        "termiosAfterReadable": after is not None,
        "termiosRestored": after is not None and freeze(before) == freeze(after),
        "stream": base64.b64encode(buf).decode("ascii"),
    }
except Exception as exc:  # never lose the captured stream to a driver error
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except OSError:
        pass
    result = {
        "exitCode": None,
        "timedOut": timed,
        "eof": False,
        "stepsSent": idx,
        "termiosAfterReadable": False,
        "termiosRestored": False,
        "stream": base64.b64encode(buf).decode("ascii"),
        "driverException": repr(exc),
    }
finally:
    for fd in (master, slave):
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass

sys.stdout.write(json.dumps(result))
`;

export function runPty(input: PtyRunInput): PtyRunResult {
  const payload = {
    argv: input.argv,
    cwd: input.cwd,
    env: input.env,
    steps: input.steps.map((step) => ({
      expect: step.expect,
      send: Buffer.from(step.send, "utf8").toString("base64"),
      sendDelayMs: step.sendDelayMs ?? 0,
    })),
    rows: input.rows ?? 24,
    cols: input.cols ?? 100,
    timeoutMs: input.timeoutMs ?? 30_000,
    quietMs: input.quietMs ?? 900,
  };
  const child = spawnSync("python3", ["-c", PTY_DRIVER, JSON.stringify(payload)], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (child.error !== undefined) {
    return {
      exitCode: null,
      timedOut: false,
      stepsSent: 0,
      stepsTotal: input.steps.length,
      termiosRestored: false,
      stream: Buffer.alloc(0),
      driverError: String(child.error),
    };
  }
  if (child.status !== 0 || (child.stdout ?? "").trim().length === 0) {
    return {
      exitCode: null,
      timedOut: false,
      stepsSent: 0,
      stepsTotal: input.steps.length,
      termiosRestored: false,
      stream: Buffer.alloc(0),
      driverError: `pty driver exit=${String(child.status)} stderr=${(child.stderr ?? "").slice(0, 2000)}`,
    };
  }
  const parsed = JSON.parse(child.stdout) as {
    exitCode: number | null;
    timedOut: boolean;
    eof: boolean;
    stepsSent: number;
    termiosAfterReadable: boolean;
    termiosRestored: boolean;
    stream: string;
    driverException?: string;
  };
  if (parsed.driverException !== undefined) {
    return {
      exitCode: parsed.exitCode,
      timedOut: parsed.timedOut,
      stepsSent: parsed.stepsSent,
      stepsTotal: input.steps.length,
      termiosRestored: false,
      stream: Buffer.from(parsed.stream, "base64"),
      driverError: `python driver exception: ${parsed.driverException}`,
    };
  }
  return {
    exitCode: parsed.exitCode,
    timedOut: parsed.timedOut,
    stepsSent: parsed.stepsSent,
    stepsTotal: input.steps.length,
    termiosRestored: parsed.termiosRestored,
    stream: Buffer.from(parsed.stream, "base64"),
  };
}
