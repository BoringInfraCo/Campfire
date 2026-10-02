import { afterEach, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliEntry } from "../../src/cli/index.js";
import { createRuntimeFromPath } from "../../src/runtime.js";
import { seedFixture, FIXTURE } from "../../src/bootstrap/seed.js";
import { startCampfireHttpServer } from "../../src/http/server.js";
import { resolveProfilePaths } from "../../src/bootstrap/profile.js";
import { loadRemoteProfile } from "../../src/bootstrap/remote-profile.js";
const cleanup:Array<()=>void|Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.reverse()) await close();cleanup.length=0;vi.unstubAllEnvs();vi.restoreAllMocks();vi.unstubAllGlobals();});
it("issues privately, joins through CLI, preserves legacy join mode, and recovers after a committed lost response",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"campfire-cli-join-"));
 const runtime=createRuntimeFromPath(join(dir,"owner.db"));seedFixture(runtime.store);
 const server=await startCampfireHttpServer({runtime,port:0});
 cleanup.push(()=>rmSync(dir,{recursive:true,force:true}),()=>runtime.close(),()=>server.close());
 vi.stubEnv("CAMPFIRE_CONFIG_DIR",join(dir,"recipient"));vi.stubEnv("CAMPFIRE_DATA_DIR",join(dir,"no-db"));vi.stubEnv("HOME",join(dir,"home"));vi.stubEnv("XDG_CONFIG_HOME",join(dir,"xdg"));
 vi.stubEnv("CAMPFIRE_URL",server.url);vi.stubEnv("CAMPFIRE_TOKEN",FIXTURE.tokens.sergio);
 const output:string[]=[];const errors:string[]=[];
 vi.spyOn(console,"log").mockImplementation(value=>output.push(String(value)));vi.spyOn(console,"error").mockImplementation(value=>errors.push(String(value)));
 const file=join(dir,"invite.json");
 expect(await runCliEntry(["invite-teammate",FIXTURE.workspaces.billing,"--out",file,"--allow-loopback","--output","json"])).toBe(0);
 const invitation=JSON.parse(readFileSync(file,"utf8"));expect(statSync(file).mode & 0o777).toBe(0o600);
 expect(output.join("\n")).not.toContain(invitation.secret);
 vi.stubEnv("CAMPFIRE_URL","");vi.stubEnv("CAMPFIRE_TOKEN","");
 const original=fetch;let dropped=false;
 vi.stubGlobal("fetch",async(...args:Parameters<typeof fetch>)=>{
  const result=await original(...args);
  if(String(args[0]).endsWith("/v1/enrollment/redeem")&&!dropped){dropped=true;throw new Error("Lost response");}
  return result;
 });
 const args=["join","--invitation-file",file,"--human-name","Alice Two","--harness","codex","--harness","opencode","--allow-loopback","--output","human"];
 expect(await runCliEntry(args)).toBe(1);
 const pendingPath=join(resolveProfilePaths().configDir,"pending-enrollment.json");const pending=JSON.parse(readFileSync(pendingPath,"utf8"));
 const humanCount=runtime.store.listHumans(FIXTURE.teamId).length;
 // Revoke capability replay after commit; actor credentials must recover local setup.
 runtime.service.revokeEnrollmentInvitation({actor:{actorId:FIXTURE.humans.sergio,actorType:"human"}},{workspaceId:FIXTURE.workspaces.billing,invitationId:invitation.invitationId});
 expect(await runCliEntry(args)).toBe(0);
 expect(runtime.store.listHumans(FIXTURE.teamId)).toHaveLength(humanCount);
 expect(loadRemoteProfile()?.agents).toHaveLength(2);expect(existsSync(resolveProfilePaths().defaultDatabasePath)).toBe(false);
 expect(existsSync(pendingPath)).toBe(false);
 expect(output.join("\n")+errors.join("\n")).not.toContain(pending.humanToken);
 expect(await runCliEntry(["status","--output","json"])).toBe(0);
 expect(await runCliEntry(["join",FIXTURE.workspaces.billing,"--output","human"])).toBe(1);
});
