import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { vendoredBunPath } from "../../src/cli/opentui-launch.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
it("keeps the selected attention cue visible at 80x24 despite long coverage and catch-up", async () => {
  const dir = mkdtempSync(join(tmpdir(), "campfire-opentui-viewport-")); let server: Server | undefined;
  try {
    server = createServer((request,response) => {
      const chunks:Buffer[]=[]; request.on("data", (chunk:Buffer)=>chunks.push(chunk)); request.on("end",()=>{
        const body=JSON.parse(Buffer.concat(chunks).toString("utf8")) as {method:string};
        const cue=(id:string,audience:string,reason:string,summary:string)=>({id,audience,reason,subjectType:"task",subjectId:id,summary,relatedIds:[]});
        const result=body.method === "get_workspace_context" ? {workspace:{id:"ws_viewport",name:"Viewport"},goal:{title:"Visible work"},needsYou:[]} : body.method === "get_workspace_attention" ? {
          workspaceId:"ws_viewport",orientationCursor:"cf1.tip",nextCursor:"fa1.next",returned:2,
          cues:[cue("task_a","you","assigned_blocked_task","Alpha"),cue("task_b","team","team_blocked_task","Beta")],
          coverage:{completeUnderRules:false,perSource:Array.from({length:8},()=>({reason:"unassigned_blocked_task",total:150,scanned:100,truncated:true}))},
          catchUp:{status:"complete",toCursor:"cf1.end",changedCount:100,examined:100,affectedIds:Array.from({length:80},(_,i)=>`task_${i}`),affectedTruncated:true,tipAdvanced:true},
        } : [];
        response.writeHead(200,{"content-type":"application/json"}); response.end(JSON.stringify({ok:true,result}));
      });
    });
    await new Promise<void>((resolve,reject)=>server!.once("error",reject).listen(0,"127.0.0.1",resolve));
    const addr=server.address(); if(!addr || typeof addr === "string") throw new Error("no address");
    const config=join(dir,"config.json"); writeFileSync(config,JSON.stringify({bun:vendoredBunPath(join(ROOT,"tui")),script:join(ROOT,"tui/src/main.ts"),cwd:join(ROOT,"tui"),name:"Viewport",goal:"Visible work",env:{CAMPFIRE_URL:`http://127.0.0.1:${addr.port}`,CAMPFIRE_TOKEN:"fixture",CAMPFIRE_WORKSPACE_ID:"ws_viewport"}}));
    const source=readFileSync(new URL("./opentui-nav-pty.test.ts",import.meta.url),"utf8"); const marker="const PTY_DRIVER = String.raw`\n"; const begin=source.indexOf(marker)+marker.length; const end=source.indexOf("\n`;",begin); if(begin<marker.length||end<begin) throw new Error("missing PTY driver");
    let driver=source.slice(begin,end).replace("rows = 32\ncols = 100","rows = 24\ncols = 80"); const first=driver.indexOf('try:\n    if not wait_until("ready"'); const last=driver.indexOf("    if proc.poll() is None:",first); if(first<0||last<0) throw new Error("missing PTY actions");
    const actions=String.raw`try:
    if not wait_until("overview", lambda text: "Attention coverage: incomplete" in text and "More attention cues" in text, 12): failed = "overview"
    else:
        send(b"j\r")
        if not wait_until("first", lambda text: any("> " in line and "Assigned task is blocked" in line and "Alpha" in line for line in text.splitlines()), 6): failed = "first"
        else:
            send(b"p")
            if not wait_until("second", lambda text: any("> " in line and "Team task is blocked" in line and "Beta" in line for line in text.splitlines()), 6): failed = "second"
            else:
                send(b"i")
                if not wait_until("info", lambda text: "scanned 100 of 150" in text, 6): failed = "info"
                else: send(b"q")
`;
    driver=driver.slice(0,first)+actions+driver.slice(last);
    const report=await new Promise<{failed:string|null;last:string;stderr:string;screens:Record<string,string>}>((resolve,reject)=>{const child=spawn("python3",["-c",driver,config],{stdio:["ignore","pipe","pipe"]}); const out:Buffer[]=[],err:Buffer[]=[]; child.stdout.on("data",(b:Buffer)=>out.push(b)); child.stderr.on("data",(b:Buffer)=>err.push(b)); child.on("error",reject); child.on("close",code=>code===0?resolve(JSON.parse(Buffer.concat(out).toString("utf8"))):reject(new Error(Buffer.concat(err).toString("utf8"))));});
    expect(report.failed,`${report.last}\n${report.stderr}`).toBeNull();
    expect(report.screens.second?.split("\n").some((line) => line.includes("> ") && line.includes("Team task is blocked") && line.includes("Beta"))).toBe(true);
    expect(report.screens.info).toContain("scanned 100 of 150");
  } finally { if(server) await new Promise<void>(resolve=>server!.close(()=>resolve())); rmSync(dir,{recursive:true,force:true}); }
},45_000);
