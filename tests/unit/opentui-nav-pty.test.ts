/**
 * Drives the OpenTUI sidecar under a PTY, the same way uix-001 drives the
 * Node dashboard: a Python pty, not a second terminal library.
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { vendoredBunPath } from "../../src/cli/opentui-launch.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BUN = vendoredBunPath(join(ROOT, "tui"));
const WORKSPACE_NAME = "Northwind Bench";
const GOAL_TITLE = "Keep the bench honest";
const WORKSPACE_ID = "ws_fixture_north";
const HIDDEN_ITEM = "SHOULD_NOT_RENDER_ITEM";
const TOKEN = "fixture-token";

const PTY_DRIVER = String.raw`
import fcntl, json, os, select, signal, struct, subprocess, sys, termios, time

def freeze(attr):
    frozen = []
    for item in attr:
        if isinstance(item, list):
            row = []
            for cell in item:
                row.append(list(cell) if isinstance(cell, bytes) else cell)
            frozen.append(row)
        elif isinstance(item, bytes):
            frozen.append(list(item))
        else:
            frozen.append(item)
    return frozen

class Screen:
    def __init__(self, rows, cols):
        self.resize(rows, cols)

    def resize(self, rows, cols):
        self.rows = rows
        self.cols = cols
        self.grid = [[" "] * cols for _ in range(rows)]
        self.x = 0
        self.y = 0
        self.saved = (0, 0)
        self.state = "ground"
        self.csi = bytearray()
        self.osc = bytearray()
        self.pending = bytearray()

    def text(self):
        return "\n".join("".join(row).rstrip() for row in self.grid)

    def put(self, ch):
        if ch == "\n":
            self.y = min(self.rows - 1, self.y + 1)
            self.x = 0
            return
        if ch == "\r":
            self.x = 0
            return
        if ch == "\b":
            self.x = max(0, self.x - 1)
            return
        if ch < " " or self.y >= self.rows:
            return
        if self.x >= self.cols:
            self.x = 0
            self.y = min(self.rows - 1, self.y + 1)
        if self.x < self.cols and self.y < self.rows:
            self.grid[self.y][self.x] = ch
            self.x += 1

    def apply_csi(self, seq):
        if not seq:
            return
        final = chr(seq[-1])
        body = seq[:-1].decode("ascii", "replace")
        if final in ("H", "f"):
            parts = [part for part in body.replace("?", "").split(";") if part != ""]
            row = int(parts[0]) if parts else 1
            col = int(parts[1]) if len(parts) > 1 else 1
            self.y = max(0, min(self.rows - 1, row - 1))
            self.x = max(0, min(self.cols - 1, col - 1))
            return
        if final == "J" and body.endswith("2"):
            self.grid = [[" "] * self.cols for _ in range(self.rows)]
            return
        if final == "K":
            for x in range(self.x, self.cols):
                self.grid[self.y][x] = " "
            return
        if final == "G":
            col = int(body or "1")
            self.x = max(0, min(self.cols - 1, col - 1))
            return
        if final == "d":
            row = int(body or "1")
            self.y = max(0, min(self.rows - 1, row - 1))
            return
        if final == "s":
            self.saved = (self.x, self.y)
            return
        if final == "u":
            self.x, self.y = self.saved
            return
        if final in ("A", "B", "C", "D"):
            amount = int(body or "1")
            if final == "A":
                self.y = max(0, self.y - amount)
            elif final == "B":
                self.y = min(self.rows - 1, self.y + amount)
            elif final == "C":
                self.x = min(self.cols - 1, self.x + amount)
            else:
                self.x = max(0, self.x - amount)

    def take_text(self, byte):
        if byte < 0x80 and not self.pending:
            self.put(chr(byte))
            return
        self.pending.append(byte)
        try:
            text = bytes(self.pending).decode("utf-8")
        except UnicodeDecodeError:
            if len(self.pending) > 4:
                self.pending.clear()
            return
        self.pending.clear()
        for ch in text:
            self.put(ch)

    def feed(self, data):
        for byte in data:
            if self.state == "ground":
                if byte == 0x1B:
                    self.pending.clear()
                    self.state = "esc"
                else:
                    self.take_text(byte)
                continue
            if self.state == "esc":
                if byte == ord("["):
                    self.state = "csi"
                    self.csi = bytearray()
                elif byte == ord("]"):
                    self.state = "osc"
                    self.osc = bytearray()
                else:
                    self.state = "ground"
                continue
            if self.state == "csi":
                self.csi.append(byte)
                if 0x40 <= byte <= 0x7E:
                    self.csi_done()
                elif len(self.csi) > 64:
                    self.state = "ground"
                continue
            if self.state == "osc":
                if byte == 0x07:
                    self.state = "ground"
                elif byte == 0x1B:
                    self.state = "osc-esc"
                continue
            if self.state == "osc-esc":
                self.state = "ground"

    def csi_done(self):
        seq = self.csi
        self.state = "ground"
        self.csi = bytearray()
        self.apply_csi(seq)

cfg = json.load(open(sys.argv[1], encoding="utf-8"))
rows = 32
cols = 100
master, slave = os.openpty()
winsz = struct.pack("HHHH", rows, cols, 0, 0)
fcntl.ioctl(slave, termios.TIOCSWINSZ, winsz)
before = termios.tcgetattr(slave)
screen = Screen(rows, cols)
env = os.environ.copy()
env.update(cfg["env"])
env["TERM"] = "xterm-256color"
proc = subprocess.Popen(
    [cfg["bun"], cfg["script"]],
    stdin=slave,
    stdout=slave,
    stderr=subprocess.PIPE,
    env=env,
    cwd=cfg["cwd"],
    start_new_session=True,
    close_fds=True,
)
raw = bytearray()
err = bytearray()
screens = {}
failed = None

def pull(fd):
    try:
        return os.read(fd, 65536)
    except OSError:
        return b""

def pump(seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline and proc.poll() is None:
        watch = [master]
        if proc.stderr is not None:
            watch.append(proc.stderr)
        ready, _, _ = select.select(watch, [], [], 0.05)
        if master in ready:
            chunk = pull(master)
            if chunk:
                raw.extend(chunk)
                screen.feed(chunk)
        if proc.stderr is not None and proc.stderr in ready:
            chunk = pull(proc.stderr.fileno())
            if chunk:
                err.extend(chunk)

def wait_until(label, predicate, seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        pump(0.05)
        if predicate(screen.text()):
            screens[label] = screen.text()
            return True
        if proc.poll() is not None:
            break
    screens[label] = screen.text()
    return False

def send(data):
    os.write(master, data)

def resize(next_cols, next_rows=32):
    global cols, rows
    cols = next_cols
    rows = next_rows
    packed = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(slave, termios.TIOCSWINSZ, packed)
    fcntl.ioctl(master, termios.TIOCSWINSZ, packed)
    screen.resize(rows, cols)
    try:
        os.killpg(proc.pid, signal.SIGWINCH)
    except OSError:
        pass

def people_test():
    send(b"h")  # leave history, stay in work
    pump(0.1)
    send(b"h")  # return to sidebar
    pump(0.1)
    send(b"jjj")
    if not wait_until("people", lambda text: "> People & agents" in text and "human_owner" in text, 6): return False
    send(b"\r")
    pump(0.1)
    send(b"\r")
    if not wait_until("human_detail", lambda text: "human: human_owner" in text and "not presence" in text, 6): return False
    send(b"\r")
    if not wait_until("owned1", lambda text: "Agents owned by human_owner" in text and "agent_one" in text, 6): return False
    send(b"n")
    if not wait_until("owned2", lambda text: "agent_two" in text, 6): return False
    send(b"r")
    pump(0.5)
    send(b"h")
    if not wait_until("roster_back", lambda text: "Updated owner" in text and "Agents owned by" not in text, 6): return False
    send(b"h")
    pump(0.1)
    send(b"kkk")
    return wait_until("work_back", lambda text: "> Work" in text, 6)

try:
    if not wait_until("ready", lambda text: "campfire" in text and "Overview" in text and cfg["name"] in text and cfg["goal"] in text, 12):
        failed = "ready"
    elif "> Overview" not in screen.text():
        failed = "ready-marker"
    else:
        send(b"j")
        if not wait_until("moved", lambda text: "> Needs you" in text and "Fixture attention cue" in text and "> Overview" not in text, 6):
            failed = "moved"
        else:
            send(b"\r")
            if not wait_until("content", lambda text: "h back" in text and "> Needs you" in text, 6):
                failed = "content"
            else:
                send(b"\r")
                if not wait_until("cue", lambda text: "fac1.fixture" in text and "task_fixture" in text, 6):
                    failed = "cue"
                else:
                    send(b"\r")
                    if not wait_until("detail", lambda text: "Fixture task detail" in text, 6):
                        failed = "detail"
                    else:
                        send(b"h")
                        pump(0.2)
                        send(b"h")
                        if not wait_until("back", lambda text: "j/k section  enter open" in text and "> Needs you" in text and "h back" not in text, 6):
                            failed = "back"
                        else:
                            resize(60, 24)
                            labels = ("Overview", "Needs you", "Work", "Decisions", "Sources", "People & agents", "Activity")
                            if not wait_until("narrow", lambda text: all(label in text for label in labels) and "> Needs you" in text and "Fixture attention cue" in text, 6):
                                failed = "narrow"
                            else:
                                resize(100)
                                if not wait_until("wide", lambda text: "> Needs you" in text and "Overview" in text and cfg["name"] in text, 6):
                                    failed = "wide"
                                else:
                                    send(b"j")
                                    if not wait_until("work", lambda text: "> Work" in text and "Task page one" in text, 6):
                                        failed = "work"
                                    else:
                                        send(b"\r")
                                        pump(0.1)
                                        send(b"j")
                                        pump(0.1)
                                        send(b"r")
                                        if not wait_until("reordered", lambda text: "> Task extra" in text and "Task page one" in text and text.find("Task extra") < text.find("Task page one"), 6):
                                            failed = "reordered"
                                        else:
                                            send(b"n")
                                            if not wait_until("page2", lambda text: "Task page two" in text, 6):
                                                failed = "page2"
                                            else:
                                                send(b"v")
                                                if not wait_until("history1", lambda text: "contribution_first" in text and "human_fixture" in text, 6):
                                                    failed = "history1"
                                                else:
                                                    send(b"n")
                                                    if not wait_until("history2", lambda text: "contribution_second" in text, 6):
                                                        failed = "history2"
                                                    else:
                                                        if not people_test(): failed = "people-owned-agents"
                                                        send(b"w")
                                                        if not wait_until("picker", lambda text: "Second workspace" in text, 6):
                                                            failed = "picker"
                                                        else:
                                                            send(b"j\r")
                                                            if not wait_until("switched", lambda text: "Second workspace" in text and "People & agents" in text and cfg["name"] not in text, 6):
                                                                failed = "switch"
                                                            else:
                                                                send(b"w")
                                                                pump(0.05)
                                                                send(b"r")
                                                                pump(0.05)
                                                                send(b"r")
                                                                if not wait_until("denied", lambda text: "Authorization refused" in text and "Second workspace" not in text and "task_second" not in text, 6):
                                                                    failed = "denial-race"
                                                                else:
                                                                    pump(0.7)
                                                                    screens["denied_after_picker"] = screen.text()
                                                                    if "Second workspace" in screen.text():
                                                                        failed = "picker-after-denial"
                                                                    else:
                                                                        send(b"q")
                                                                        pump(2)
    if proc.poll() is None:
        deadline = time.monotonic() + 5
        while proc.poll() is None and time.monotonic() < deadline:
            pump(0.1)
    if proc.poll() is None:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            pass
        proc.wait(timeout=2)
        if failed is None:
            failed = "quit"
    flags = fcntl.fcntl(master, fcntl.F_GETFL)
    fcntl.fcntl(master, fcntl.F_SETFL, flags | os.O_NONBLOCK)
    while True:
        chunk = pull(master)
        if not chunk:
            break
        raw.extend(chunk)
        screen.feed(chunk)
    after = termios.tcgetattr(slave)
    raw_bytes = bytes(raw)
    sys.stdout.write(json.dumps({
        "exitCode": proc.returncode,
        "failed": failed,
        "screens": screens,
        "last": screen.text(),
        "enteredAlt": b"\x1b[?1049h" in raw_bytes,
        "leftAlt": b"\x1b[?1049l" in raw_bytes,
        "stderr": bytes(err).decode("utf-8", "replace")[:2000],
        "termiosSame": freeze(before) == freeze(after),
    }))
finally:
    for fd in (master, slave):
        try:
            os.close(fd)
        except OSError:
            pass
`;

interface PtyReport {
  exitCode: number | null;
  failed: string | null;
  screens: Record<string, string>;
  last: string;
  enteredAlt: boolean;
  leftAlt: boolean;
  stderr: string;
  termiosSame: boolean;
}

let server: Server | undefined;
let scratch: string | undefined;
const methods: string[] = [];

afterEach(async () => {
  methods.splice(0, methods.length);
  if (server !== undefined) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error === undefined ? resolve() : reject(error)));
    });
    server = undefined;
  }
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

function startFixture(): Promise<string> {
  methods.splice(0, methods.length);
  let secondWorkspaceReads = 0;
  let listReads = 0;
  let taskFirstPageReads = 0;
  let unfilteredPeopleReads = 0;
  server = createServer((request, response) => {
    if (request.method !== "POST" || request.url?.split("?")[0] !== "/v1/call") {
      response.writeHead(404);
      response.end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      let method = "";
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method?: unknown; params?: unknown };
        method = typeof body.method === "string" ? body.method : "";
        methods.push(method);
        const authorized = request.headers.authorization === `Bearer ${TOKEN}`;
        if (!authorized) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ ok: false, error: "Unauthorized", message: "no" }));
          return;
        }
        if (method === "list_workspaces") {
          if (++listReads === 2) {
            setTimeout(() => { response.writeHead(200, {"content-type":"application/json"}); response.end(JSON.stringify({ok:true, result:[{id:"ws_second", name:"Second workspace"}]})); }, 500);
            return;
          }
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ ok: true, result: [{ id: WORKSPACE_ID, name: WORKSPACE_NAME }, {id: "ws_second", name: "Second workspace"}] }));
          return;
        }
        if (method === "get_workspace_context") {
          const params = body.params;
          const record = typeof params === "object" && params !== null ? (params as { participants?: unknown; workspaceId?: unknown }) : {};
          if (record.participants !== "omit") {
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify({ ok: false, error: "ValidationError", message: "participants must be omitted" }));
            return;
          }
          if (record.workspaceId === "ws_second" && ++secondWorkspaceReads === 2) {
            setTimeout(() => {
              response.writeHead(200, {"content-type": "application/json"});
              response.end(JSON.stringify({ok: false, error: "Unauthorized", message: "denied"}));
            }, 300);
            return;
          }
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              ok: true,
              result: {
                workspace: { id: record.workspaceId, name: record.workspaceId === "ws_second" ? "Second workspace" : WORKSPACE_NAME },
                goal: { title: GOAL_TITLE },
                needsYou: [{ summary: HIDDEN_ITEM }],
              },
            }),
          );
          return;
        }
        if (method === "get_workspace_attention") {
          const params = body.params as {workspaceId?: string};
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ ok: true, result: {
            workspaceId: params.workspaceId, orientationCursor: "cf1.fixture", returned: 1,
            coverage: { completeUnderRules: true, perSource: [] },
            catchUp: { status: "not_requested", changedCount: 0, examined: 0, affectedIds: [], affectedTruncated: false, tipAdvanced: false },
            cues: [{ id: "fac1.fixture", audience: "you", reason: "assigned_open_task", subjectType: "task", subjectId: "task_fixture", summary: "Fixture attention cue", relatedIds: [] }],
          }}));
          return;
        }
        if (method === "list_tasks") {
          const params = body.params as {workspaceId?: string; cursor?: string};
          const second = params.workspaceId === "ws_second";
          const task = second ? {id:"task_second", workspaceId: params.workspaceId, title:"Second workspace task"} : params.cursor ? {id:"task_two", workspaceId: params.workspaceId, title:"Task page two"} : {id:"task_one", workspaceId: params.workspaceId, title:"Task page one"};
          const extra = {id:"task_extra", workspaceId: params.workspaceId, title:"Task extra"};
          const items = second || params.cursor ? [task] : ++taskFirstPageReads === 1 ? [task, extra] : [extra, task];
          response.writeHead(200, {"content-type":"application/json"});
          response.end(JSON.stringify({ok:true, result:{workspaceId:params.workspaceId, items, ...(!second && !params.cursor ? {nextCursor:"cursor2"} : {})}}));
          return;
        }
        if (method === "get_record_history") {
          const params = body.params as {workspaceId?: string; objectId?: string; objectType?: string; cursor?: string};
          response.writeHead(200, {"content-type":"application/json"});
          if (params.objectId !== "task_two" || params.objectType !== "task") {
            response.end(JSON.stringify({ok:false, error:"ValidationError", message:"wrong history target"}));
            return;
          }
          const item = {id:params.cursor ? "contribution_second" : "contribution_first", workspaceId: params.workspaceId, objectType: "task", objectId: params.objectId, actor:{actorId:"human_fixture", actorType:"human"}};
          response.end(JSON.stringify({ok:true, result:{workspaceId: params.workspaceId, objectType: "task", objectId: params.objectId, items:[item], ...(params.cursor ? {} : {nextCursor:"history_page_2"})}}));
          return;
        }
        if (method === "list_workspace_participants") {
          const params = body.params as {workspaceId?: string; humanOwnerId?: string; cursor?: string};
          response.writeHead(200, {"content-type":"application/json"});
          if (params.humanOwnerId === "human_owner") {
            if (params.cursor !== undefined && params.cursor !== "owned_page_2") {
              response.end(JSON.stringify({ok:false, error:"ValidationError", message:"wrong owner cursor"}));
              return;
            }
            const actorId = params.cursor ? "agent_two" : "agent_one";
            response.end(JSON.stringify({ok:true, result:{workspaceId: params.workspaceId, filter: {humanOwnerId: "human_owner"}, total:2, returned:1, truncated: !params.cursor, ...(!params.cursor ? {nextCursor:"owned_page_2"} : {}), items:[{actor:{actorId, actorType:"agent"}, humanOwnerId:"human_owner", role:"agent"}]}}));
          } else {
            ++unfilteredPeopleReads;
            response.end(JSON.stringify({ok:true, result:{workspaceId:params.workspaceId, items:[{actor:{actorId:"human_owner", actorType:"human"}, role:"owner", ...(unfilteredPeopleReads > 1 ? {name:"Updated owner"} : {})}], total:1, returned:1, truncated:false}}));
          }
          return;
        }
        if (method === "get_task") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ok: true, result: {id: "task_fixture", workspaceId: (body.params as {workspaceId?: string}).workspaceId, title: "Fixture task detail", status: "open"}}));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: "ValidationError", message: `unexpected method ${method}` }));
      } catch {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: "ValidationError", message: "bad json" }));
      }
    });
  });
  return new Promise((resolve) => {
    server?.listen(0, "127.0.0.1", () => {
      const address = server?.address();
      if (address === null || typeof address === "string" || address === undefined) {
        throw new Error("fixture did not bind");
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function runPty(baseUrl: string): Promise<PtyReport> {
  scratch = mkdtempSync(join(tmpdir(), "campfire-opentui-pty-"));
  const configPath = join(scratch, "pty.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      bun: BUN,
      script: join(ROOT, "tui", "src", "main.ts"),
      cwd: join(ROOT, "tui"),
      name: WORKSPACE_NAME,
      goal: GOAL_TITLE,
      env: {
        CAMPFIRE_URL: baseUrl,
        CAMPFIRE_TOKEN: TOKEN,
        CAMPFIRE_WORKSPACE_ID: WORKSPACE_ID,
        CAMPFIRE_ACTOR_ID: "hum_fixture",
        CAMPFIRE_ACTOR_TYPE: "human",
        CAMPFIRE_AWAITING_WORKSPACE: "",
      },
    }),
  );
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", PTY_DRIVER, configPath], { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 45_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`pty driver failed (${code}): ${Buffer.concat(stderr).toString("utf8")}`));
        return;
      }
      resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")) as PtyReport);
    });
  });
}

const bunProbe = spawnSync(BUN, ["--version"], { encoding: "utf8" });
const hasVendoredBun = bunProbe.status === 0;
if (process.env.CAMPFIRE_REQUIRE_OPENTUI_PTY === "1" && !hasVendoredBun) {
  throw new Error("OpenTUI PTY is required but the vendored Bun is unavailable; install the tui dependencies first.");
}

describe.skipIf(!hasVendoredBun)("opentui navigation pty", () => {
  it("moves the sidebar, renders FAC attention, stacks below 72 columns, and restores the terminal", async () => {
    const baseUrl = await startFixture();
    const report = await runPty(baseUrl);
    const ready = report.screens.ready ?? report.last;
    expect(report.failed, `${report.failed}\n${JSON.stringify(report.screens)}\n${report.last}\n${report.stderr}`).toBeNull();
    expect(ready).toContain("campfire");
    expect(ready).toContain("Overview");
    expect(ready).toContain(WORKSPACE_NAME);
    expect(ready).toContain(GOAL_TITLE);
    expect(ready).not.toContain(HIDDEN_ITEM);
    expect(report.screens.moved).toContain("> Needs you");
    expect(report.screens.moved).toContain("Fixture attention cue");
    expect(report.screens.content).toContain("h back");
    expect(report.screens.detail).toContain("Fixture task detail");
    expect(report.screens.page2).toContain("Task page two");
    expect(report.screens.reordered).toContain("> Task extra");
    expect(report.screens.history1).toContain("human_fixture");
    expect(report.screens.history2).toContain("contribution_second");
    expect(report.screens.owned1).toContain("agent_one");
    expect(report.screens.owned2).toContain("agent_two");
    expect(report.screens.roster_back).toContain("Updated owner");
    expect(report.screens.switched).toContain("People & agents");
    expect(report.screens.switched).not.toContain(WORKSPACE_NAME);
    expect(report.screens.denied).toContain("Authorization refused");
    expect(report.screens.denied_after_picker).not.toContain("Second workspace");
    expect(report.screens.back).toContain("> Needs you");
    expect(report.screens.back).toContain("j/k section  enter open");
    expect(report.screens.narrow).toContain("People & agents");
    expect(report.screens.narrow).toContain("Activity");
    expect(report.screens.narrow).toContain("> Needs you");
    expect(report.exitCode).toBe(0);
    expect(report.enteredAlt).toBe(true);
    expect(report.leftAlt).toBe(true);
    expect(methods).toContain("get_workspace_attention");
    expect(methods).toContain("get_task");
    expect(methods.filter((method) => method === "get_record_history")).toHaveLength(2);
    expect(methods).toContain("get_workspace_context");
  }, 60_000);
});
