import { expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { joinFromInvitation } from "../../src/bootstrap/enrollment-client.js";
import { resolveProfilePaths } from "../../src/bootstrap/profile.js";
it("persists prepared credentials privately before sending and preserves exact request after a lost response", async () => {
 const env = process.env; const paths = resolveProfilePaths(env);
 mkdirSync(paths.configDir,{recursive:true});
 const file = join(paths.configDir, 'invitation.json');
 const secret = `cfe_${"a".repeat(32)}`;
  writeFileSync(file, JSON.stringify({version:1,kind:'enrollment_invitation',invitationId:'ein_test',secret,url:'https://campfire.example/campfire',workspace:{id:'ws_test',name:'Work',teamId:'team_test'},expiresAt:'2099-01-01T00:00:00Z',permittedHarnesses:['codex','opencode']}),{mode:0o600});
 const bodies:string[]=[];
 vi.stubGlobal('fetch', vi.fn(async (url, init) => { const pending = join(paths.configDir,'pending-enrollment.json'); expect(existsSync(pending)).toBe(true); expect(statSync(pending).mode & 0o777).toBe(0o600); bodies.push(String(init.body)); expect(String(url)).not.toContain(secret); throw new Error(`network failure with ${secret}`); }));
 try {
   await expect(joinFromInvitation({invitationFile:file,humanName:'Alice',harnesses:['opencode']},env)).rejects.toThrow(/retry/i);
   await expect(joinFromInvitation({invitationFile:file,humanName:'Alice',harnesses:['opencode']},env)).rejects.toThrow(/retry/i);
   expect(bodies[0]).toBe(bodies[1]); expect(bodies[0]).not.toContain(secret);
   expect(readFileSync(join(paths.configDir,'pending-enrollment.json'),'utf8')).toContain('humanToken');
 } finally { vi.unstubAllGlobals(); }
});
