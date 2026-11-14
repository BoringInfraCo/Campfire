/** Click the real OpenTUI sidebar with SGR mouse events in a pseudo-terminal. */
import { spawn, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { vendoredBunPath } from "../../src/cli/opentui-launch.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const bun = vendoredBunPath(join(root, "tui"));

it.each([false, true])("selects overview rows safely with wrapped header=%s", async (wrapped) => {
  expect(spawnSync(bun, ["--version"]).status, "vendored Bun is required").toBe(0);
  const dir = mkdtempSync(join(tmpdir(), "campfire-opentui-mouse-"));
  let server: Server | undefined;
  try {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method: string };
        const result = body.method === "get_workspace_context"
          ? { workspace: { id: "ws_mouse", name: "Mouse fixture" }, goal: { title: wrapped ? "A long workspace goal that wraps across the content area for a mouse selection test" : "Click a section" }, needsYou: [] }
          : body.method === "get_workspace_attention"
          ? { workspaceId: "ws_mouse", orientationCursor: "cf1.tip", returned: 0,
              coverage: { completeUnderRules: true, perSource: [] },
              catchUp: { status: "not_requested", changedCount: 0, examined: 0, affectedIds: [], tipAdvanced: false, affectedTruncated: false }, cues: [] }
          : body.method === "list_tasks"
          ? { workspaceId: "ws_mouse", items: [{ id: "task_mouse", workspaceId: "ws_mouse", title: "Clickable work item" }], returned: 1, total: 1, truncated: false }
          : [];
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, result }));
      });
    });
    await new Promise<void>((resolve, reject) => server!.once("error", reject).listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("fixture server did not bind");
    const config = join(dir, "pty.json");
    writeFileSync(config, JSON.stringify({ bun, script: join(root, "tui/src/main.ts"), cwd: join(root, "tui"), name: "Mouse fixture", goal: "Click a section", env: { CAMPFIRE_URL: `http://127.0.0.1:${addr.port}`, CAMPFIRE_TOKEN: "fixture", CAMPFIRE_WORKSPACE_ID: "ws_mouse", CAMPFIRE_ACTOR_ID: "hum_mouse", CAMPFIRE_ACTOR_TYPE: "human" } }));
    const source = readFileSync(new URL("./opentui-nav-pty.test.ts", import.meta.url), "utf8");
    const marker = "const PTY_DRIVER = String.raw`\n";
    const begin = source.indexOf(marker) + marker.length;
    const end = source.indexOf("\n`;", begin);
    const original = source.slice(begin, end);
    const actionStart = original.indexOf('try:\n    if not wait_until("ready"');
    const actionEnd = original.indexOf("    if proc.poll() is None:", actionStart);
    if (begin < marker.length || end < begin || actionStart < 0 || actionEnd < 0) throw new Error("PTY driver not found");
    const actions = String.raw`try:
    if not wait_until("ready", lambda text: "Mouse fixture" in text and "Work  ·" in text, 12): failed = "ready"
    else:
        lines = screen.text().split("\n")
        pos = next(((line.index("Work  "), i) for i, line in enumerate(lines) if "Work  ·" in line), None)
        if pos is None: failed = "work-position"
        else:
            x, y = pos
            send(("\x1b[<0;%d;%dM\x1b[<0;%d;%dm" % (x+1, y+1, x+1, y+1)).encode())
            ${wrapped ? String.raw`send(b"\r")
            pump(0.5)
            if "Clickable work item" in screen.text(): failed = "wrapped-click-selected-wrong-row"
            else: send(b"q")` : String.raw`send(b"\r")
            if not wait_until("clicked", lambda text: "> Work" in text and "Clickable work item" in text, 6): failed = "click"
            else:
                lines = screen.text().split("\n")
                pos = next(((line.index("Decisions"), i) for i, line in enumerate(lines) if "Decisions" in line), None)
                if pos is None: failed = "sidebar-position"
                else:
                    x, y = pos
                    send(("\x1b[<0;%d;%dM\x1b[<0;%d;%dm" % (x+1, y+1, x+1, y+1)).encode())
                    if not wait_until("sidebar", lambda text: "> Decisions" in text, 6): failed = "sidebar-click"
                    else:
                        send(b"j")
                        if not wait_until("keyboard", lambda text: "> Sources" in text, 6): failed = "keyboard"
                        else: send(b"q")`}
`;
    const driver = original.slice(0, actionStart) + actions + original.slice(actionEnd);
    const report = await new Promise<{ failed: string | null; last: string; stderr: string; exitCode: number; enteredAlt: boolean; leftAlt: boolean }>((resolve, reject) => {
      const child = spawn("python3", ["-c", driver, config], { stdio: ["ignore", "pipe", "pipe"] });
      const out: Buffer[] = [], err: Buffer[] = [];
      child.stdout.on("data", (part: Buffer) => out.push(part));
      child.stderr.on("data", (part: Buffer) => err.push(part));
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(JSON.parse(Buffer.concat(out).toString("utf8"))) : reject(new Error(Buffer.concat(err).toString("utf8"))));
    });
    expect(report.failed, `${report.last}\n${report.stderr}`).toBeNull();
    expect(report.exitCode).toBe(0);
    expect(report.enteredAlt).toBe(true);
    expect(report.leftAlt).toBe(true);
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
}, 45_000);
