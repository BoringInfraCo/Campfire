import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { vendoredBunPath } from "../../src/cli/opentui-launch.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

it("explains an empty workspace and discovers an authorized workspace on refresh", async () => {
  const dir = mkdtempSync(join(tmpdir(), "campfire-opentui-empty-"));
  let server: Server | undefined;
  let listReads = 0;
  const workspaceRequests: string[] = [];
  try {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method: string; params: { workspaceId?: string } };
        let result: unknown = [];
        if (body.method === "list_workspaces") result = ++listReads >= 3 ? [{ id: "ws_new", name: "New Work" }] : [];
        if (body.method === "get_workspace_context") { workspaceRequests.push(body.params.workspaceId ?? ""); result = { workspace: { id: "ws_new", name: "New Work" }, goal: { title: "Start together" }, needsYou: [] }; }
        if (body.method === "get_workspace_attention") result = {workspaceId:"ws_new", orientationCursor:"cf1.tip", cues:[], coverage:{completeUnderRules:true,perSource:[]}, catchUp:{status:"not_requested",changedCount:0,examined:0,affectedIds:[],affectedTruncated:false,tipAdvanced:false}};
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, result }));
      });
    });
    await new Promise<void>((resolve, reject) => server!.once("error", reject).listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("no address");
    const config = join(dir, "config.json");
    writeFileSync(config, JSON.stringify({ bun: vendoredBunPath(join(ROOT,"tui")), script:join(ROOT,"tui/src/main.ts"), cwd:join(ROOT,"tui"), name:"New Work", goal:"Start together", env:{CAMPFIRE_URL:`http://127.0.0.1:${address.port}`,CAMPFIRE_TOKEN:"fixture",CAMPFIRE_WORKSPACE_ID:"",CAMPFIRE_AWAITING_WORKSPACE:"1"} }));
    const source = readFileSync(new URL("./opentui-nav-pty.test.ts", import.meta.url), "utf8");
    const marker = "const PTY_DRIVER = String.raw`\n"; const begin = source.indexOf(marker) + marker.length; const end = source.indexOf("\n`;", begin);
    if (begin < marker.length || end < begin) throw new Error("PTY driver missing");
    const original = source.slice(begin, end); const first = original.indexOf('try:\n    if not wait_until("ready"'); const last = original.indexOf("    if proc.poll() is None:", first);
    if (first < 0 || last < 0) throw new Error("PTY actions missing");
    const actions = String.raw`try:
    if not wait_until("empty", lambda text: "No workspace yet" in text and "Press r" in text and "r check again" in text, 12): failed = "empty"
    else:
        send(b"\r")
        send(b"r")
        if not wait_until("still-empty", lambda text: "no workspace for this account yet" in text and "r check again" in text and "enter detail" not in text, 8): failed = "still-empty"
        else:
          send(b"r")
          if not wait_until("ready", lambda text: "New Work" in text and "Start together" in text, 8): failed = "ready"
          else: send(b"q")
`;
    const report = await new Promise<{ failed: string | null; screens: Record<string,string>; last:string; stderr:string }>((resolve,reject) => {
      const child = spawn("python3", ["-c", original.slice(0,first) + actions + original.slice(last), config], {stdio:["ignore","pipe","pipe"]});
      const out: Buffer[] = [], err: Buffer[] = []; child.stdout.on("data", (part:Buffer) => out.push(part)); child.stderr.on("data", (part:Buffer) => err.push(part)); child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(JSON.parse(Buffer.concat(out).toString("utf8"))) : reject(new Error(Buffer.concat(err).toString("utf8"))));
    });
    expect(report.failed, `${report.last}\n${report.stderr}`).toBeNull();
    expect(report.screens.empty).toContain("Ask your agent");
    expect(report.screens.empty).toContain("r check again");
    expect(report.screens.empty).not.toContain("enter open");
    expect(listReads).toBeGreaterThanOrEqual(3);
    expect(workspaceRequests).toEqual(["ws_new"]);
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
}, 45_000);
