import { expect, it } from "vitest";
import { commandSpecForArgs, formatCommandUsage } from "../../src/cli/catalog.js";
import { buildCommandManifest } from "../../src/cli/projections.js";
import { parseArgs } from "../../src/cli/args.js";
import { resolveCommandOutput } from "../../src/cli/output.js";
it("advertises invitation and enrollment variants without changing legacy join output",()=>{
 const manifest=buildCommandManifest('1.9.0');
 expect(manifest.commands.find(command=>command.name==='join')?.variants?.[0]).toMatchObject({selector:'--invitation-file',mutates:true,outputModes:['auto','human','json']});
 expect(manifest.commands.find(command=>command.name==='connect')?.variants?.[0]).toMatchObject({selector:'--enroll',mutates:true});
 expect(formatCommandUsage('join')).toContain('--invitation-file');expect(formatCommandUsage('connect')).toContain('--enroll');
 expect(commandSpecForArgs('join',{}).alwaysJson).toBe(true);
 expect(()=>resolveCommandOutput(parseArgs(['join','ws_test','--output','human']))).toThrow(/JSON only/);
 expect(resolveCommandOutput(parseArgs(['join','--invitation-file','private.json','--output','human']))).toBe('human');
});
