/** User-visible selection and authorization regressions on the real sidecar PTY. */
import { spawn, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { OPENTUI_UPDATE_EXIT_CODE, vendoredBunPath } from "../../src/cli/opentui-launch.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const bun = vendoredBunPath(join(ROOT, "tui"));
type Mode = "denial" | "reorder" | "picker_denial" | "refresh_stale" | "empty_skipped" | "wrong_page" | "wrong_detail" | "wrong_attention" | "update" | "overview";

async function run(mode: Mode): Promise<{ failed: string | null; screens: Record<string, string>; last: string; stderr: string; exitCode: number | null; leftAlt: boolean; termiosSame: boolean }> {
  expect(spawnSync(bun, ["--version"]).status).toBe(0);
  const dir = mkdtempSync(join(tmpdir(), "campfire-opentui-races-"));
  let server: Server | undefined;
  let contextReads = 0, attentionReads = 0, pickerReads = 0;
  try {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (part: Buffer) => chunks.push(part));
      request.on("end", () => {
        const { method } = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method: string };
        const reply = (value: unknown) => { response.writeHead(200, {"content-type": "application/json"}); response.end(JSON.stringify(value)); };
        if (method === "list_workspaces") {
          pickerReads++;
          if (mode === "picker_denial" && pickerReads === 1) { setTimeout(() => reply({ok:false,error:"Unauthorized",message:"revoked"}), 900); return; }
          setTimeout(() => reply({ok:true, result:[{id:"ws_private",name:"Previously visible workspace"}]}), mode === "picker_denial" ? 50 : 700); return;
        }
        if (method === "get_workspace_context") {
          contextReads++;
          if (mode === "denial" && contextReads >= 2) { reply({ok:false,error:"Unauthorized",message:"revoked"}); return; }
          reply({ok:true,result:{workspace:{id:"ws_pty",name:"Northwind Bench"},goal:{title:"Keep the bench honest"},needsYou:[]}}); return;
        }
        if (method === "get_workspace_attention") {
          attentionReads++;
          const a = {id:"cue_alpha", audience:"you",reason:"assigned_open_task",subjectType:"task",subjectId:"task_alpha",summary:"Alpha cue",relatedIds:[]};
          const b = {id:"cue_beta", audience:mode === "reorder" ? "you" : "team",reason:"team_blocked_task",subjectType:"task",subjectId:"task_beta",summary:"Beta cue",relatedIds:[]};
          const value = {ok:true,result:{workspaceId:mode === "wrong_attention" ? "ws_other" : "ws_pty",orientationCursor:"cf1.tip",coverage:{completeUnderRules:true,perSource:mode === "empty_skipped" ? [{reason:"action_proposal_awaiting_review",skipped:"workspace_not_active"}] : []},cues:mode === "empty_skipped" ? [] : mode === "reorder" && attentionReads > 1 ? [b,a] : mode === "refresh_stale" && attentionReads > 1 ? [{...a,summary:"Alpha refreshed"},b] : [a,b],catchUp:{status:"not_requested",changedCount:0,examined:0,affectedIds:[],tipAdvanced:false,affectedTruncated:false}}};
          if (mode === "refresh_stale" && attentionReads > 1) setTimeout(() => reply(value), 900); else reply(value);
          return;
        }
        if (method === "list_tasks" && mode === "wrong_page") { reply({ok:true,result:{workspaceId:"ws_other",items:[{id:"task_other",workspaceId:"ws_other",title:"OTHER WORKSPACE PRIVATE TASK"}]}}); return; }
        if (method === "get_task" && mode === "wrong_detail") { reply({ok:true,result:{id:"task_alpha",workspaceId:"ws_other",title:"OTHER WORKSPACE PRIVATE DETAIL"}}); return; }
        reply({ok:true,result:[]});
      });
    });
    await new Promise<void>((resolve,reject) => server!.once("error",reject).listen(0,"127.0.0.1",resolve));
    const addr = server.address(); if (!addr || typeof addr === "string") throw new Error("bind failed");
    const config = join(dir,"pty.json");
    writeFileSync(config,JSON.stringify({bun, script:join(ROOT,"tui/src/main.ts"), cwd:join(ROOT,"tui"),name:"Northwind Bench",goal:"Keep the bench honest",env:{CAMPFIRE_URL:`http://127.0.0.1:${addr.port}`,CAMPFIRE_TOKEN:"fixture",CAMPFIRE_WORKSPACE_ID:"ws_pty",CAMPFIRE_ACTOR_ID:"hum_pty",CAMPFIRE_ACTOR_TYPE:"human"}}));
    const file = readFileSync(new URL("./opentui-nav-pty.test.ts",import.meta.url),"utf8");
    const marker = "const PTY_DRIVER = String.raw`\n"; const begin = file.indexOf(marker) + marker.length; const end = file.indexOf("\n`;",begin);
    if (begin < marker.length || end < begin) throw new Error("PTY driver missing");
    const original = file.slice(begin,end); const first = original.indexOf('try:\n    if not wait_until("ready"'); const last = original.indexOf("    if proc.poll() is None:",first);
    if (first < 0 || last < 0) throw new Error("PTY actions missing");
    const actions = mode === "overview" ? String.raw`try:
    if not wait_until("ready", lambda t: "Select a section to explore" in t and "Needs you" in t, 12): failed = "ready"
    else:
        send(b"\r\r")
        if not wait_until("attention", lambda t: "> Needs you" in t and "Alpha cue" in t and "h back" in t, 6): failed = "attention"
        else: send(b"q")
` : mode === "update" ? String.raw`try:
    if not wait_until("ready", lambda t: "Northwind Bench" in t, 12): failed = "ready"
    else:
        send(b"j")
        if not wait_until("attention", lambda t: "Alpha cue" in t, 6): failed = "attention"
        else:
            send(b"\r/updates\r")
            if not wait_until("filter", lambda t: "No shown row matches this filter." in t, 6): failed = "filter"
            else:
                send(b"\x1b")
                pump(0.2)
                send(b"/update\r")
                pump(3)
` : mode === "wrong_attention" ? String.raw`try:
    if not wait_until("refusal", lambda t: "Authorization refused" in t, 12): failed = "refusal"
    else: send(b"q")
` : mode === "wrong_page" ? String.raw`try:
    if not wait_until("ready", lambda t: "Northwind Bench" in t, 12): failed = "ready"
    else:
        send(b"jj")
        if not wait_until("refusal", lambda t: "Workspace response did not match" in t, 6): failed = "refusal"
        else: send(b"q")
` : mode === "wrong_detail" ? String.raw`try:
    if not wait_until("ready", lambda t: "Northwind Bench" in t, 12): failed = "ready"
    else:
        send(b"j")
        if not wait_until("attention", lambda t: "Alpha cue" in t, 6): failed = "attention"
        else:
            send(b"\r\r")
            if not wait_until("cue", lambda t: "cue_alpha" in t, 6): failed = "cue"
            else:
                send(b"\r")
                if not wait_until("refusal", lambda t: "Record response did not match" in t, 6): failed = "refusal"
                else: send(b"q")
` : mode === "picker_denial" ? String.raw`try:
    if not wait_until("ready", lambda t: "Northwind Bench" in t, 12): failed = "ready"
    else:
        send(b"w")
        pump(0.05)
        send(b"w")
        if not wait_until("picker", lambda t: "Previously visible workspace" in t, 6): failed = "picker"
        elif not wait_until("refusal", lambda t: "Authorization refused" in t and "Previously visible workspace" not in t, 6): failed = "refusal"
        else: send(b"q")
` : mode === "refresh_stale" ? String.raw`try:
    if not wait_until("ready", lambda t: "Northwind Bench" in t, 12): failed = "ready"
    else:
        send(b"j")
        if not wait_until("attention", lambda t: "Alpha cue" in t, 6): failed = "attention"
        else:
            send(b"r")
            if not wait_until("refreshing", lambda t: "STALE" in t and "refreshing" in t, 2): failed = "refreshing"
            elif not wait_until("refreshed", lambda t: "refreshed" in t and "refreshing" not in t, 6): failed = "refreshed"
            else: send(b"q")
` : mode === "empty_skipped" ? String.raw`try:
    if not wait_until("ready", lambda t: "Northwind Bench" in t, 12): failed = "ready"
    else:
        send(b"j")
        if not wait_until("empty", lambda t: "No recorded cue matches these rules." in t and "skipped (workspace_not_activ" in t, 6): failed = "empty"
        else: send(b"q")
` : mode === "denial" ? String.raw`try:
    if not wait_until("ready", lambda t: "Northwind Bench" in t, 12): failed = "ready"
    else:
        send(b"w")
        pump(0.05)
        send(b"r")
        if not wait_until("refusal", lambda t: "Authorization refused" in t, 6): failed = "refusal"
        else:
            pump(1.2)
            screens["after"] = screen.text()
            send(b"q")
` : String.raw`try:
    if not wait_until("ready", lambda t: "Northwind Bench" in t, 12): failed = "ready"
    else:
        send(b"j")
        if not wait_until("attention", lambda t: "Alpha cue" in t, 6): failed = "attention"
        else:
            send(b"\rj")
            def order(t):
                ls = t.splitlines()
                a = [i for i, l in enumerate(ls) if "Alpha cue" in l]
                b = [i for i, l in enumerate(ls) if "Beta cue" in l]
                return (a[0], b[0]) if a and b else None
            if not wait_until("selected", lambda t: order(t) is not None and order(t)[0] < order(t)[1] and any("> " in l and "Beta cue" in l for l in t.splitlines()), 6): failed = "selected"
            else:
                send(b"r")
                if not wait_until("reordered", lambda t: order(t) is not None and order(t)[1] < order(t)[0] and any("> " in l and "Beta cue" in l for l in t.splitlines()) and not any("> " in l and "Alpha cue" in l for l in t.splitlines()) and "no longer" not in t, 6): failed = "reordered"
                else: send(b"q")
`;
    const driver = original.slice(0,first) + actions + original.slice(last);
    return await new Promise((resolve,reject) => {
      const child = spawn("python3",["-c",driver,config],{stdio:["ignore","pipe","pipe"]}); const out: Buffer[] = [], err: Buffer[] = [];
      child.stdout.on("data",(b:Buffer)=>out.push(b)); child.stderr.on("data",(b:Buffer)=>err.push(b)); child.on("error",reject);
      child.on("close",code=>code === 0 ? resolve(JSON.parse(Buffer.concat(out).toString("utf8"))) : reject(new Error(Buffer.concat(err).toString("utf8"))));
    });
  } finally { if (server) await new Promise<void>(resolve=>server!.close(()=>resolve())); rmSync(dir,{recursive:true,force:true}); }
}

it("does not reopen a delayed workspace picker after authorization is refused",async()=>{
  const report = await run("denial");
  expect(report.failed, report.last).toBeNull();
  expect(report.screens.after).toContain("Authorization refused");
  expect(report.screens.after).not.toContain("Previously visible workspace");
},45_000);

it("keeps the same cue selected when a refresh reorders attention",async()=>{
  const report = await run("reorder");
  expect(report.failed, report.last).toBeNull();
  const before = report.screens.selected!.split("\n"), after = report.screens.reordered!.split("\n");
  const at = (lines: string[], text: string) => lines.findIndex(line=>line.includes(text));
  expect(at(before,"Alpha cue")).toBeGreaterThanOrEqual(0);
  expect(at(before,"Alpha cue")).toBeLessThan(at(before,"Beta cue"));
  expect(at(after,"Beta cue")).toBeGreaterThanOrEqual(0);
  expect(at(after,"Beta cue")).toBeLessThan(at(after,"Alpha cue"));
  expect(after[at(after,"Beta cue")]).toContain("> ");
  expect(after[at(after,"Alpha cue")]).not.toContain("> ");
},45_000);

it("honors a delayed same-workspace picker refusal after a newer picker succeeds",async()=>{
  const report = await run("picker_denial");
  expect(report.failed, report.last).toBeNull();
  expect(report.screens.refusal).toContain("Authorization refused");
  expect(report.screens.refusal).not.toContain("Previously visible workspace");
},45_000);

it("labels the previous attention result while a refresh is in flight",async()=>{
  const report = await run("refresh_stale");
  expect(report.failed, report.last).toBeNull();
  expect(report.screens.refreshing).toContain("STALE");
  expect(report.screens.refreshing).toContain("refreshing");
  expect(report.screens.refreshed).toContain("refreshed");
},45_000);

it("shows both skipped coverage and the complete empty-state wording",async()=>{
  const report = await run("empty_skipped");
  expect(report.failed, report.last).toBeNull();
  expect(report.screens.empty).toContain("No recorded cue matches these rules.");
  expect(report.screens.empty).toContain("skipped (workspace_not_activ");
  expect(report.screens.empty).not.toContain("Coverage: incomplete");
},45_000);

it("clears the screen instead of showing a task page from another workspace",async()=>{
  const report = await run("wrong_page");
  expect(report.failed, report.last).toBeNull();
  expect(report.screens.refusal).toContain("Workspace response did not match");
  expect(report.screens.refusal).not.toContain("OTHER WORKSPACE PRIVATE TASK");
},45_000);

it("clears the screen instead of showing a selected record from another workspace",async()=>{
  const report = await run("wrong_detail");
  expect(report.failed, report.last).toBeNull();
  expect(report.screens.refusal).toContain("Record response did not match");
  expect(report.screens.refusal).not.toContain("OTHER WORKSPACE PRIVATE DETAIL");
},45_000);

it("clears the screen when attention belongs to another workspace",async()=>{
  const report = await run("wrong_attention");
  expect(report.failed, report.last).toBeNull();
  expect(report.screens.refusal).toContain("Authorization refused");
  expect(report.screens.refusal).not.toContain("Alpha cue");
  expect(report.screens.refusal).not.toContain("Northwind Bench");
},45_000);

it("exits with the reserved update status on /update while other slash input remains a filter",async()=>{
  const report = await run("update");
  expect(report.failed, report.last).toBeNull();
  expect(report.screens.filter).toContain("No shown row matches this filter.");
  expect(report.exitCode).toBe(OPENTUI_UPDATE_EXIT_CODE);
  expect(report.leftAlt).toBe(true);
  expect(report.termiosSame).toBe(true);
},45_000);

it("opens Needs you from its Overview summary with the keyboard",async()=>{
  const report = await run("overview");
  expect(report.failed, report.last).toBeNull();
  expect(report.screens.attention).toContain("Alpha cue");
},45_000);
