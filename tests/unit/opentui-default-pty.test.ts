import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SCENARIO, seedDatabase } from "../../fixtures/attention/att-001/seed.js";
import { vendoredBunPath, resolveTuiRoot } from "../../src/cli/opentui-launch.js";

/**
 * Bare `campfire` in a pseudo-terminal: OpenTUI is the default, --classic and
 * CAMPFIRE_TUI=classic opt out. Scratch HOME/XDG/config, ports 19914/19915.
 * The real profile and ports 9414/9415 are never touched.
 */
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REQUIRED = process.env.CAMPFIRE_REQUIRE_OPENTUI_PTY === "1";
let sidecarReady = false;
try {
  const tui = resolveTuiRoot();
  sidecarReady = readFileSync(vendoredBunPath(tui)).length > 0;
} catch { sidecarReady = false; }
const maybe = sidecarReady || REQUIRED ? describe : describe.skip;

const DRIVER = `
import base64, fcntl, json, os, select, struct, subprocess, sys, termios, time
cfg = json.loads(sys.argv[1])
master, slave = os.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 36, 120, 0, 0))
env = os.environ.copy()
for key in ("CAMPFIRE_HOME", "CAMPFIRE_DB", "CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_TUI"):
    env.pop(key, None)
env.update(cfg["env"])
proc = subprocess.Popen(cfg["argv"], stdin=slave, stdout=slave, stderr=subprocess.PIPE, env=env, cwd=cfg["cwd"], start_new_session=True, close_fds=True)
buf = b""
sent = False
deadline = time.monotonic() + 25
def pull(fd):
    try: return os.read(fd, 65536)
    except OSError: return b""
while proc.poll() is None and time.monotonic() < deadline:
    r, _, _ = select.select([master], [], [], 0.1)
    if master in r: buf += pull(master)
    if not sent and cfg["ready"].encode() in buf:
        sent = True
        time.sleep(0.5)
        os.write(master, b"q")
timed_out = proc.poll() is None
if timed_out:
    import signal
    os.killpg(proc.pid, signal.SIGKILL); proc.wait()
fcntl.fcntl(master, fcntl.F_SETFL, fcntl.fcntl(master, fcntl.F_GETFL) | os.O_NONBLOCK)
while True:
    c = pull(master)
    if not c: break
    buf += c
err = proc.stderr.read().decode("utf-8", "replace")
print(json.dumps({"exit": proc.returncode, "timedOut": timed_out, "sent": sent, "out": base64.b64encode(buf).decode(), "err": err}))
`;

let scratch: string | undefined;
afterEach(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

interface Run { exit: number | null; timedOut: boolean; sent: boolean; out: string; err: string }

function run(extraArgs: string[], extraEnv: Record<string, string>, ready: string): Run {
  scratch = mkdtempSync(join(tmpdir(), "campfire-default-pty-"));
  const seeded = seedDatabase(scratch, true, "none");
  const tokens = JSON.parse(readFileSync(join(scratch, "tokens.json"), "utf8")) as { ana: string };
  writeFileSync(join(scratch, "config.json"), JSON.stringify({
    version: 1, mode: "local", databasePath: seeded.databasePath, url: "http://127.0.0.1:19914",
    humanId: SCENARIO.humans.ana, humanName: "Ana", workspaceId: SCENARIO.workspaces.lab, workspaceName: "ATT-001 attention lab",
  }));
  writeFileSync(join(scratch, "credentials.json"), JSON.stringify({ humanToken: tokens.ana }), { mode: 0o600 });
  const home = join(scratch, "home");
  const result = spawnSync("python3", ["-c", DRIVER, JSON.stringify({
    argv: [join(ROOT, "node_modules/.bin/tsx"), join(ROOT, "src/cli/index.ts"), "--no-connect", "--port", "19914", "--viewer-port", "19915", "--db", seeded.databasePath, ...extraArgs],
    cwd: ROOT,
    ready,
    env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local"), CAMPFIRE_TELEMETRY: "0", CAMPFIRE_CONFIG_DIR: scratch, CAMPFIRE_DATA_DIR: scratch, ...extraEnv },
  })], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`pty driver failed: ${result.stderr}`);
  return JSON.parse(result.stdout) as Run;
}

const text = (r: Run): string => Buffer.from(r.out, "base64").toString("utf8");

maybe("bare campfire dashboard selection (pty)", () => {
  it("launches the OpenTUI sidecar by default", () => {
    const r = run([], {}, "Overview");
    const screen = text(r);
    expect(r.timedOut, screen).toBe(false);
    expect(r.exit).toBe(0);
    expect(screen).toContain("Overview");
    expect(screen).toContain("\u001b[?1049h");
    expect(r.err).not.toContain("classic dashboard");
  }, 60_000);

  it("--classic launches the classic dashboard", () => {
    const r = run(["--classic"], {}, "GOAL");
    const screen = text(r);
    expect(r.timedOut, screen).toBe(false);
    expect(r.exit).toBe(0);
    expect(screen).toContain("GOAL");
    expect(screen).not.toContain("Overview");
  }, 60_000);

  it("CAMPFIRE_TUI=classic launches the classic dashboard", () => {
    const r = run([], { CAMPFIRE_TUI: "classic" }, "GOAL");
    const screen = text(r);
    expect(r.timedOut, screen).toBe(false);
    expect(r.exit).toBe(0);
    expect(screen).not.toContain("Overview");
  }, 60_000);
});
