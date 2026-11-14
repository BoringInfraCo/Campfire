/** Real OpenTUI screen parity with an independent HTTP fixture (not renderer output). */
import { spawn, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { vendoredBunPath } from "../../src/cli/opentui-launch.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const bun = vendoredBunPath(join(ROOT, "tui"));

it("displays ordered mixed-audience cues, expiry, coverage and navigable full IDs", async () => {
  expect(spawnSync(bun, ["--version"]).status, "vendored Bun must be installed").toBe(0);
  const dir = mkdtempSync(join(tmpdir(), "campfire-opentui-attention-pty-"));
  let server: Server | undefined;
  try {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {method: string};
        const cue = (id: string, audience: string, reason: string, subjectType: string, subjectId: string, summary: string, expired?: boolean) =>
          ({ id, audience, reason, subjectType, subjectId, summary, relatedIds: [], ...(expired ? { expired } : {}) });
        const payload = body.method === "get_workspace_context"
          ? { workspace: { id: "ws_pty", name: "Northwind Bench" }, goal: { title: "Keep the bench honest" }, needsYou: [] }
          : body.method === "get_workspace_attention"
          ? { workspaceId: "ws_pty", orientationCursor: "cf1.tip", nextCursor: "fa1.page2", returned: 3,
            coverage: { completeUnderRules: false, perSource: [
              { reason: "action_proposal_awaiting_review", total: 103, scanned: 100, truncated: true },
              { reason: "unassigned_blocked_task", skipped: "workspace_not_active" },
            ] },
            catchUp: { status: "not_requested", changedCount: 0, examined: 0, affectedIds: [], tipAdvanced: false, affectedTruncated: false },
            cues: [
              cue("fac1_expired_proposal", "you", "action_proposal_awaiting_review", "action_proposal", "proposal_pty", "Awaiting proposal summary", true),
              cue("fac1_team_blocked", "team", "team_blocked_task", "task", "task_team", "Team blocked summary"),
              cue("fac1_you_open", "you", "assigned_open_task", "task", "task_open", "Open task summary"),
            ] }
          : [];
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, result: payload }));
      });
    });
    await new Promise<void>((resolve, reject) => server!.once("error", reject).listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("HTTP server did not bind");
    const config = join(dir, "pty.json");
    writeFileSync(config, JSON.stringify({ bun, script: join(ROOT, "tui/src/main.ts"), cwd: join(ROOT, "tui"), name: "Northwind Bench", goal: "Keep the bench honest", env: { CAMPFIRE_URL: `http://127.0.0.1:${addr.port}`, CAMPFIRE_TOKEN: "fixture-token", CAMPFIRE_WORKSPACE_ID: "ws_pty", CAMPFIRE_ACTOR_ID: "hum_pty", CAMPFIRE_ACTOR_TYPE: "human" } }));
    // Share the existing PTY emulator with the navigation test, but drive a
    // distinct fixture and assert literals from the response independently.
    const source = readFileSync(new URL("./opentui-nav-pty.test.ts", import.meta.url), "utf8");
    const begin = source.indexOf("const PTY_DRIVER = String.raw`\n") + "const PTY_DRIVER = String.raw`\n".length;
    const end = source.indexOf("\n`;", begin);
    if (begin < 40 || end < begin) throw new Error("PTY driver not found");
    const original = source.slice(begin, end);
    const actionStart = original.indexOf('try:\n    if not wait_until("ready"');
    const actionEnd = original.indexOf("    if proc.poll() is None:", actionStart);
    if (actionStart < 0 || actionEnd < 0) throw new Error("PTY action block not found");
    const action = String.raw`try:
    if not wait_until("ready", lambda text: "Northwind Bench" in text, 12): failed = "ready"
    else:
        send(b"j")
        if not wait_until("list", lambda text: "Proposal awaiting review" in text and "Open task summary" in text and "Team blocked summary" not in text, 6): failed = "list"
        else:
            send(b"\r\r")
            if not wait_until("first", lambda text: "fac1_expired_proposal" in text and "proposal_pty" in text, 6): failed = "first"
            else:
                send(b"hp")
                if not wait_until("team", lambda text: "Needs attention" in text and "1+ (more pages or incomplete coverage)" in text and "Team blocked summary" in text and "Showing team attention" in text and "Open task summary" not in text, 6): failed = "team"
                else:
                    send(b"\r")
                    if not wait_until("second", lambda text: "fac1_team_blocked" in text and "task_team" in text, 6): failed = "second"
                    else:
                        send(b"hp")
                        if not wait_until("mine", lambda text: "Needs you" in text and "Open task summary" in text and "Showing needs you" in text and "Team blocked summary" not in text, 6): failed = "mine"
                        else:
                            send(b"j\r")
                            if not wait_until("third", lambda text: "fac1_you_open" in text and "task_open" in text, 6): failed = "third"
                            else:
                                send(b"hi")
                                if not wait_until("coverage", lambda text: "scanned 100 of 103" in text and "skipped (workspace_not_active)" in text, 6): failed = "coverage"
                                else: send(b"q")
`;
    const driver = original.slice(0, actionStart) + action + original.slice(actionEnd);
    const report = await new Promise<{failed: string | null; screens: Record<string, string>; stderr: string; last: string}>((resolve, reject) => {
      const child = spawn("python3", ["-c", driver, config], { stdio: ["ignore", "pipe", "pipe"] });
      const out: Buffer[] = [], err: Buffer[] = [];
      child.stdout.on("data", (part: Buffer) => out.push(part));
      child.stderr.on("data", (part: Buffer) => err.push(part));
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(JSON.parse(Buffer.concat(out).toString("utf8"))) : reject(new Error(Buffer.concat(err).toString("utf8"))));
    });
    expect(report.failed, `${report.last}\n${report.stderr}`).toBeNull();
    const list = report.screens.list!;
    expect(list).toContain("2+ (more pages or incomplete coverage)");
    expect(list).toContain("More cues exist beyond this page.");
    expect(list.indexOf("Proposal awaiting review")).toBeLessThan(list.indexOf("Open task summary"));
    expect(report.screens.first).toContain("Proposal awaiting review by an owner (expired)");
    expect(report.screens.first).toContain("[you]");
    expect(report.screens.first).toContain("Awaiting proposal summary");
    expect(report.screens.second).toContain("[team]");
    expect(report.screens.second).toContain("Team task is blocked");
    expect(report.screens.second).toContain("Team blocked summary");
    expect(report.screens.third).toContain("[you]");
    expect(report.screens.third).toContain("Assigned task is open");
    expect(report.screens.third).toContain("Open task summary");
    expect(report.screens.coverage).toContain("Coverage: incomplete under the rules.");
    expect(report.screens.coverage).toContain("More cues exist beyond this page.");
    expect(report.screens.team).toContain("More cues exist beyond this page.");
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
}, 45_000);
