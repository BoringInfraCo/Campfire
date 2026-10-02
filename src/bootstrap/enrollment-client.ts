/** Private, recoverable enrollment workflow. Raw credentials stay on this machine. */
import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, linkSync, openSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CampfireError, ValidationError } from "../domain/errors.js";
import { normalizeRedeemEnrollmentInput, type EnrollmentHarness, type EnrollmentReceipt, type IssuedEnrollmentInvitation, type OwnedAgentReceipt, type RedeemEnrollmentInput } from "../domain/enrollment.js";
import { campfireHttpCall, campfireHttpRedeemEnrollment } from "../http/client.js";
import { generateRawToken, hashToken } from "../service/tokens.js";
import { loadAnyProfile, loadCredentials, resolveProfilePaths } from "./profile.js";
import { canonicalEndpoint, loadRemoteProfile, persistRemoteProfile, resolveRemoteAccess } from "./remote-profile.js";
import { assertConnectionCompatible, defaultHarnessConfigPath, prepareConnection } from "./connect.js";

export interface InvitationFile extends IssuedEnrollmentInvitation { url: string }
interface ConnectionSettings { configPaths:Partial<Record<EnrollmentHarness,string>>; mcpCommand:string }
interface PendingEnrollment extends ConnectionSettings { version:1; invitation:InvitationFile; input:RedeemEnrollmentInput; humanToken:string; agentTokens:Partial<Record<EnrollmentHarness,string>> }
interface CompletedEnrollment extends ConnectionSettings { version:1; kind:"saved_enrollment"; receipt:EnrollmentReceipt }
export interface JoinFromInvitationInput {
  invitationFile:string; humanName:string; harnesses:EnrollmentHarness[]; allowLoopback?:boolean;
  configPaths?:Partial<Record<EnrollmentHarness,string>>; mcpCommand?:string;
}
function failure(message:string, nextAction = "retry_saved_enrollment",stage?:EnrollmentStage):never { throw new ValidationError(message, {nextAction,...(stage===undefined?{}:{stage})}); }

/**
 * Truthful local completion stages. The server commits before this machine
 * writes anything, so a partial run reports the last stage it actually
 * reached instead of implying a working connection.
 */
export const ENROLLMENT_STAGES = ["enrolled","credentials_saved","connection_prepared","reload_required"] as const;
export type EnrollmentStage = (typeof ENROLLMENT_STAGES)[number];
export type JoinOutcome = EnrollmentReceipt & { stages: EnrollmentStage[] };
function completedStages(reached: EnrollmentStage): EnrollmentStage[] { return ENROLLMENT_STAGES.slice(0, ENROLLMENT_STAGES.indexOf(reached)+1); }
function readPrivate<T>(path:string):T {
  try {
    const stat=statSync(path);
    if (!stat.isFile() || stat.size>65_536 || stat.size===0 || (stat.mode&0o077)!==0) failure("Enrollment file must be a bounded private file", "check_invitation_file");
    return JSON.parse(readFileSync(path,"utf8")) as T;
  }
  catch { return failure("Enrollment file is missing or invalid; use the original private file", "check_invitation_file"); }
}
function flushDirectory(path:string):void { const fd=openSync(path,"r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
function savePrivate(path:string, value:unknown, replace=false):void {
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { const fd=openSync(temporary,"wx",0o600); try { writeFileSync(fd,`${JSON.stringify(value,null,2)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    if (replace) renameSync(temporary,path); else linkSync(temporary,path); chmodSync(path,0o600); flushDirectory(dirname(path)); }
  catch { failure("Could not save private enrollment state; retry using the same profile directory"); }
  finally { rmSync(temporary,{force:true}); }
}
export function saveInvitationFile(path:string, input:IssuedEnrollmentInvitation, url:string, allowLoopback=false): { invitationId:string;workspaceId:string;expiresAt:string;path:string;url:string } {
  const endpoint = canonicalEndpoint(url,{allowLoopbackHttp:allowLoopback});
  try { savePrivate(path,{...input,url:endpoint}); }
  catch { failure("Invitation destination already exists or cannot be written; choose a new private file", "choose_invitation_output"); }
  return {invitationId:input.invitationId,workspaceId:input.workspace.id,expiresAt:input.expiresAt,path,url:endpoint};
}
function object(value:unknown, keys:string[]):value is Record<string,unknown> {
  return value!==null && typeof value==="object" && !Array.isArray(value) && Object.keys(value).every(key=>keys.includes(key));
}
function text(value:unknown,max=200):value is string {
  return typeof value==="string" && value.trim().length>0 && value.length<=max && !/[\u0000-\u001f\u007f]/.test(value);
}
function identifier(value:unknown):value is string { return text(value,128) && /^[a-zA-Z0-9_.-]+$/.test(value); }
function validTimestamp(value:unknown):value is string {
  return typeof value==="string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace(".000Z","Z")===value.replace(".000Z","Z");
}
function validateInvitation(value:unknown, allowLoopback:boolean):InvitationFile {
  if (!object(value,["version","kind","invitationId","secret","url","workspace","expiresAt","permittedHarnesses"]) ||
      value.version!==1 || value.kind!=="enrollment_invitation" || !identifier(value.invitationId) ||
      typeof value.secret!=="string" || !/^cfe_[a-f0-9]{32}$/.test(value.secret) ||
      !object(value.workspace,["id","name","teamId"]) || !identifier(value.workspace.id) || !identifier(value.workspace.teamId) || !text(value.workspace.name) ||
      !validTimestamp(value.expiresAt) || !Array.isArray(value.permittedHarnesses) || value.permittedHarnesses.length<1 || value.permittedHarnesses.length>2 ||
      value.permittedHarnesses.some(harness=>harness!=="codex" && harness!=="opencode") || new Set(value.permittedHarnesses).size!==value.permittedHarnesses.length ||
      typeof value.url!=="string") failure("Unsupported or invalid invitation file", "check_invitation_file");
  return {...value,url:canonicalEndpoint(value.url,{allowLoopbackHttp:allowLoopback})} as unknown as InvitationFile;
}
function invitationFromFile(path:string, allowLoopback:boolean):InvitationFile {
  return validateInvitation(readPrivate<unknown>(path),allowLoopback);
}
function connectionSettings(input:JoinFromInvitationInput,env:NodeJS.ProcessEnv):ConnectionSettings {
  if (input.configPaths!==undefined && (!object(input.configPaths,["codex","opencode"]) || Object.keys(input.configPaths).some(key=>!input.harnesses.includes(key as EnrollmentHarness)))) failure("Harness config selection is invalid", "select_harness_config");
  const configPaths:ConnectionSettings["configPaths"]={};
  for(const harness of input.harnesses) {
    const selected=input.configPaths?.[harness] ?? defaultHarnessConfigPath(harness,env);
    if(!text(selected,4096)) failure("Harness config path is invalid", "select_harness_config");
    configPaths[harness]=resolve(selected);
  }
  const mcpCommand=input.mcpCommand ?? process.argv[1] ?? "campfire";
  if(!text(mcpCommand,4096)) failure("MCP command is invalid", "select_harness_config");
  return {configPaths,mcpCommand};
}
function sameConnections(saved:ConnectionSettings,selected:ConnectionSettings,harnesses:EnrollmentHarness[]):boolean {
  return object(saved.configPaths,["codex","opencode"]) && saved.mcpCommand===selected.mcpCommand &&
    Object.keys(saved.configPaths).length===harnesses.length && harnesses.every(harness=>saved.configPaths[harness]===selected.configPaths[harness]);
}
function prepareEnrolledConnections(pending:PendingEnrollment,receipt:EnrollmentReceipt):void {
  for(const agent of receipt.agents) prepareConnection({harness:agent.harness,mcpCommand:pending.mcpCommand,configPath:pending.configPaths[agent.harness]!,
    url:pending.invitation.url,agentToken:pending.agentTokens[agent.harness]!,workspaceId:receipt.workspace.id,rejectConflicting:true});
}
async function verifyEnrollment(pending:PendingEnrollment, receipt:EnrollmentReceipt):Promise<void> {
  const call = (token:string,method:string,params?:Record<string,unknown>) => campfireHttpCall<any>({baseUrl:pending.invitation.url,token,method,params});
  if (receipt.kind!=="workspace_enrollment" || receipt.invitationId!==pending.input.invitationId || receipt.requestId!==pending.input.requestId || receipt.workspace.id!==pending.invitation.workspace.id || receipt.workspace.teamId!==pending.invitation.workspace.teamId || receipt.human.name!==pending.input.humanName || receipt.agents.length!==pending.input.agents.length) failure("Enrollment receipt does not match the saved request");
  const human = await call(pending.humanToken,"whoami");
  if (human.actor?.actorType!=="human" || human.actor.actorId!==receipt.human.id) failure("Prepared human credential does not match the enrolled identity");
  const context = await call(pending.humanToken,"get_workspace_context",{workspaceId:receipt.workspace.id});
  if (context.workspace?.id!==receipt.workspace.id || context.workspace.teamId!==receipt.workspace.teamId || !Array.isArray(context.participants)) failure("Enrolled workspace could not be verified");
  const humanParticipant=context.participants.find((entry:any)=>entry.actor?.actorType==="human" && entry.actor.actorId===receipt.human.id);
  if (!humanParticipant || humanParticipant.name!==receipt.human.name || humanParticipant.role!=="member" || humanParticipant.joinedAt!==receipt.enrolledAt) failure("Enrolled human membership could not be verified");
  for (const agent of receipt.agents) {
    const participant=context.participants.find((entry:any)=>entry.actor?.actorType==="agent" && entry.actor.actorId===agent.id);
    if (!participant || participant.humanOwnerId!==receipt.human.id || participant.harness!==agent.harness || participant.role!=="agent" || participant.name!==agent.name || !pending.input.agents.some(prepared=>prepared.harness===agent.harness)) failure("Enrolled agent ownership could not be verified");
    const token = pending.agentTokens[agent.harness]; if (!token) failure("Prepared agent credential is missing");
    const identity = await call(token,"whoami");
    if (identity.actor?.actorType!=="agent" || identity.actor.actorId!==agent.id) failure("Prepared agent credential does not match the enrolled identity");
  }
}
async function recoverEnrollment(pending:PendingEnrollment):Promise<EnrollmentReceipt> {
  const baseUrl = pending.invitation.url;
  const identity = await campfireHttpCall<any>({baseUrl,token:pending.humanToken,method:"whoami"});
  if (identity.actor?.actorType!=="human") failure("Saved human credential is not an enrolled human");
  const workspace = await campfireHttpCall<any>({baseUrl,token:pending.humanToken,method:"get_workspace",params:{workspaceId:pending.invitation.workspace.id}});
  if (workspace.workspace?.id!==pending.invitation.workspace.id || workspace.workspace.teamId!==pending.invitation.workspace.teamId || !Array.isArray(workspace.participants)) failure("Saved enrollment workspace does not match");
  const human=workspace.participants.find((entry:any)=>entry.actor?.actorType==="human" && entry.actor.actorId===identity.actor.actorId);
  if (!human || human.name!==pending.input.humanName || human.role!=="member") failure("Saved enrollment human membership does not match");
  const agents = [];
  for (const prepared of pending.input.agents) {
    const token = pending.agentTokens[prepared.harness]; if (!token) failure("Saved agent credential is missing");
    const agent = await campfireHttpCall<any>({baseUrl,token,method:"whoami"});
    if (agent.actor?.actorType!=="agent") failure("Saved agent credential is not an enrolled agent");
    const participant=workspace.participants.find((entry:any)=>entry.actor?.actorType==="agent" && entry.actor.actorId===agent.actor.actorId);
    if (!participant || participant.humanOwnerId!==human.actor.actorId || participant.harness!==prepared.harness || participant.role!=="agent") failure("Saved agent ownership does not match enrollment");
    agents.push({id:agent.actor.actorId,name:participant.name,harness:prepared.harness});
  }
  return {version:1,kind:"workspace_enrollment",invitationId:pending.input.invitationId,requestId:pending.input.requestId,workspace:pending.invitation.workspace,human:{id:identity.actor.actorId,name:pending.input.humanName},agents,enrolledAt:human.joinedAt};
}
export async function joinFromInvitation(input:JoinFromInvitationInput,env:NodeJS.ProcessEnv=process.env):Promise<JoinOutcome> {
  const invitation = invitationFromFile(input.invitationFile,input.allowLoopback===true);
  if(!Array.isArray(input.harnesses) || input.harnesses.length<1 || input.harnesses.length>2 ||
      input.harnesses.some(harness=>!invitation.permittedHarnesses.includes(harness)) || new Set(input.harnesses).size!==input.harnesses.length || !text(input.humanName)) failure("Requested enrollment is outside the invitation's supported scope", "check_invitation_scope");
  const selectedConnections=connectionSettings(input,env);
  const paths = resolveProfilePaths(env); const pendingPath = join(paths.configDir,"pending-enrollment.json");
  const receiptPath = join(paths.configDir,"enrollment-receipt.json");
  const profile = loadAnyProfile(env);
  if (existsSync(receiptPath) && profile?.mode==="remote") {
    const completed = readPrivate<CompletedEnrollment>(receiptPath);
    const receipt=completed.receipt;
    if(completed.version!==1 || completed.kind!=="saved_enrollment" || !receipt || receipt.version!==1 || receipt.kind!=="workspace_enrollment" ||
        receipt.invitationId!==invitation.invitationId || profile.url!==invitation.url || profile.humanName!==input.humanName.trim() ||
        receipt.human?.id!==profile.humanId || receipt.workspace?.id!==profile.workspaceId || !Array.isArray(receipt.agents) ||
        receipt.agents.length!==input.harnesses.length || !input.harnesses.every(harness=>receipt.agents.some(agent=>agent.harness===harness)) ||
        !sameConnections(completed,selectedConnections,input.harnesses)) failure("Saved enrollment does not match this invitation and connection selection", "recover_original_enrollment");
    const credentials=loadCredentials(env);
    if(credentials===undefined || credentials.endpoint!==profile.url || credentials.humanId!==profile.humanId || credentials.workspaceId!==profile.workspaceId ||
        receipt.agents.some(agent=>credentials.agentIds?.[agent.harness]!==agent.id || profile.agents.find(known=>known.harness===agent.harness)?.id!==agent.id || !credentials.agents?.[agent.harness])) failure("Enrolled credentials are missing; explicit credential recovery is required", "recover_enrollment_credentials");
    const prepared=normalizeRedeemEnrollmentInput({invitationId:receipt.invitationId,requestId:receipt.requestId,humanName:receipt.human.name,humanTokenHash:hashToken(credentials.humanToken),
      agents:receipt.agents.map(agent=>({harness:agent.harness,name:agent.name,tokenHash:hashToken(credentials.agents![agent.harness]!)}))});
    const recovered:PendingEnrollment={version:1,invitation,input:prepared,humanToken:credentials.humanToken,
      agentTokens:Object.fromEntries(receipt.agents.map(agent=>[agent.harness,credentials.agents![agent.harness]])),...selectedConnections};
    await verifyEnrollment(recovered,receipt);
    prepareEnrolledConnections(recovered,receipt);
    return { ...receipt, stages: completedStages("reload_required") };
  }
  let pending:PendingEnrollment;
  if (existsSync(pendingPath)) {
    pending = readPrivate<PendingEnrollment>(pendingPath);
    if(!object(pending,["version","invitation","input","humanToken","agentTokens","configPaths","mcpCommand"])) failure("Saved enrollment file is invalid", "recover_pending_enrollment");
    normalizeRedeemEnrollmentInput(pending.input);
    if (typeof pending.humanToken!=="string" || hashToken(pending.humanToken)!==pending.input.humanTokenHash || !pending.agentTokens || pending.input.agents.some(agent=>typeof pending.agentTokens[agent.harness]!=="string" || hashToken(pending.agentTokens[agent.harness]!)!==agent.tokenHash) || Object.keys(pending.agentTokens).length!==pending.input.agents.length) failure("Saved enrollment credentials do not match the prepared request; recover the original private pending file");
    const savedInvitation=validateInvitation(pending.invitation,input.allowLoopback===true);
    if (pending.version!==1 || savedInvitation.invitationId!==invitation.invitationId || savedInvitation.url!==invitation.url || savedInvitation.secret!==invitation.secret ||
        savedInvitation.workspace.id!==invitation.workspace.id || savedInvitation.workspace.teamId!==invitation.workspace.teamId ||
        pending.input.humanName!==input.humanName.trim() || [...input.harnesses].sort().join(",")!==pending.input.agents.map(agent=>agent.harness).sort().join(",") ||
        !sameConnections(pending,selectedConnections,input.harnesses)) failure("Another enrollment is pending; retry its original invitation, name, harness, and config selection", "recover_pending_enrollment");
  } else {
    if (profile!==undefined || loadCredentials(env)!==undefined) failure("An existing profile or credential bundle would be replaced; use an isolated CAMPFIRE_CONFIG_DIR", "use_isolated_profile");
    if(Date.parse(invitation.expiresAt)<=Date.now()) failure("Invitation has expired; ask the owner for a new invitation", "request_new_invitation");
    const humanToken = generateRawToken(); const agentTokens:PendingEnrollment["agentTokens"] = {};
    for (const harness of input.harnesses) agentTokens[harness]=generateRawToken();
    const prepared = normalizeRedeemEnrollmentInput({invitationId:invitation.invitationId,requestId:randomUUID(),humanName:input.humanName,humanTokenHash:hashToken(humanToken),agents:input.harnesses.map(harness=>({harness,tokenHash:hashToken(agentTokens[harness]!)}))});
    pending={version:1,invitation,input:prepared,humanToken,agentTokens,...selectedConnections};
    for (const agent of prepared.agents) assertConnectionCompatible({harness:agent.harness,configPath:pending.configPaths[agent.harness]!,url:invitation.url,agentToken:agentTokens[agent.harness]});
    savePrivate(pendingPath,pending);
  }
  // A previously committed request may have installed this exact profile.
  // Reject an unrelated profile introduced since credential preparation before
  // presenting the pending enrollment capability to a shared service again.
  if(profile!==undefined && (profile.mode!=="remote" || profile.url!==invitation.url || profile.workspaceId!==invitation.workspace.id ||
      profile.humanName!==pending.input.humanName || loadCredentials(env)?.humanToken!==pending.humanToken)) failure("Existing profile conflicts with the saved enrollment", "use_isolated_profile");
  let receipt:EnrollmentReceipt;
  try { receipt = await campfireHttpRedeemEnrollment({baseUrl:invitation.url,secret:invitation.secret,input:pending.input}); }
  catch (error) {
    // A structured rejection means this request did not commit, except when a
    // previously committed enrollment is now unreadable through the invitation;
    // in that case the same prepared credentials still prove the real state.
    if (error instanceof CampfireError && (error.code==="Unauthorized" || error.code==="Conflict")) {
      try { receipt = await recoverEnrollment(pending); }
      catch { throw error; }
    } else if (error instanceof CampfireError) throw error;
    else return failure("Enrollment commit is uncertain: the response was lost. Retry the same invitation with the saved request");
  }
  let reached:EnrollmentStage="enrolled";
  try {
    await verifyEnrollment(pending,receipt); reached="credentials_saved";
    persistRemoteProfile({url:invitation.url,humanId:receipt.human.id,humanName:receipt.human.name,workspaceId:receipt.workspace.id,workspaceName:receipt.workspace.name,humanToken:pending.humanToken,agents:receipt.agents.map(agent=>({...agent,token:pending.agentTokens[agent.harness]!})),allowLoopbackHttp:input.allowLoopback},env);
    reached="connection_prepared"; prepareEnrolledConnections(pending,receipt);
    savePrivate(receiptPath,{version:1,kind:"saved_enrollment",receipt,...selectedConnections},true); rmSync(pendingPath); flushDirectory(paths.configDir);
    return { ...receipt, stages: completedStages("reload_required") };
  } catch (error) {
    if (error instanceof CampfireError) throw error;
    return failure(`Enrollment committed (stage: ${reached}) but local setup is incomplete; retry the original invitation and saved request`,"retry_saved_enrollment",reached);
  }
}
export async function enrollRemoteAgent(input:{harness:EnrollmentHarness;name?:string;configPath?:string;mcpCommand?:string},env:NodeJS.ProcessEnv=process.env):Promise<OwnedAgentReceipt> {
  if(input.harness!=="codex" && input.harness!=="opencode" || input.name!==undefined && !text(input.name)) failure("Unsupported owned agent selection", "select_supported_harness");
  const settings=connectionSettings({invitationFile:"",humanName:"prepared",harnesses:[input.harness],
    ...(input.configPath===undefined?{}:{configPaths:{[input.harness]:input.configPath}}),mcpCommand:input.mcpCommand},env);
  const access = resolveRemoteAccess({},env); const profile=loadRemoteProfile(env)!;
  if (access.url!==profile.url) failure("Agent enrollment must use the enrolled endpoint", "use_enrolled_endpoint");
  if (!existsSync(join(resolveProfilePaths(env).configDir,`pending-agent-${input.harness}.json`)) && profile.agents.some(agent=>agent.harness===input.harness)) failure("This harness is already enrolled; reconnect it without --enroll", "reconnect_selected_harness");
  const path=join(resolveProfilePaths(env).configDir,`pending-agent-${input.harness}.json`);
  type Pending = {version:1;url:string;humanId:string;workspaceId:string;token:string;tokenHash:string;requestId:string;harness:EnrollmentHarness;name?:string;configPath:string;mcpCommand:string};
  let pending:Pending;
  if (existsSync(path)) pending=readPrivate<Pending>(path);
  else {
    const token=generateRawToken();
    pending={version:1,url:access.url,humanId:profile.humanId,workspaceId:profile.workspaceId,token,tokenHash:hashToken(token),requestId:randomUUID(),
      harness:input.harness,...(input.name===undefined?{}:{name:input.name}),configPath:settings.configPaths[input.harness]!,mcpCommand:settings.mcpCommand};
    assertConnectionCompatible({harness:input.harness,configPath:pending.configPath,url:access.url,agentToken:pending.token}); savePrivate(path,pending);
  }
  if(!object(pending,["version","url","humanId","workspaceId","token","tokenHash","requestId","harness","name","configPath","mcpCommand"]) || pending.version!==1 ||
      typeof pending.token!=="string" || !/^cft_[a-f0-9]{32}$/.test(pending.token) || hashToken(pending.token)!==pending.tokenHash || !identifier(pending.requestId) ||
      pending.url!==access.url || pending.humanId!==profile.humanId || pending.workspaceId!==profile.workspaceId || pending.harness!==input.harness || pending.name!==input.name ||
      pending.configPath!==settings.configPaths[input.harness] || pending.mcpCommand!==settings.mcpCommand) failure("Another agent enrollment is pending; retry the original harness, name, config path, and command");
  try {
    const owner = await campfireHttpCall<any>({baseUrl:access.url,token:access.token,method:"whoami"});
    if (owner.actor?.actorType!=="human" || owner.actor.actorId!==profile.humanId) failure("Agent enrollment credential does not belong to the recipient human");
    const receipt = await campfireHttpCall<OwnedAgentReceipt>({baseUrl:access.url,token:access.token,method:"enroll_owned_agent",params:{workspaceId:pending.workspaceId,requestId:pending.requestId,harness:pending.harness,name:pending.name,tokenHash:pending.tokenHash}});
    const identity = await campfireHttpCall<any>({baseUrl:access.url,token:pending.token,method:"whoami"});
    if (receipt.workspaceId!==profile.workspaceId || receipt.humanId!==profile.humanId || receipt.requestId!==pending.requestId || receipt.agent.harness!==input.harness || identity.actor?.actorId!==receipt.agent.id || identity.actor?.actorType!=="agent") failure("Agent enrollment identity could not be verified");
    const credentials=loadCredentials(env)!;
    persistRemoteProfile({url:profile.url,humanId:profile.humanId,humanName:profile.humanName,workspaceId:profile.workspaceId,workspaceName:profile.workspaceName,humanToken:credentials.humanToken,agents:[{...receipt.agent,token:pending.token}],allowLoopbackHttp:true},env);
    prepareConnection({harness:input.harness,mcpCommand:pending.mcpCommand,configPath:pending.configPath,url:profile.url,agentToken:pending.token,workspaceId:profile.workspaceId,rejectConflicting:true});
    rmSync(path); flushDirectory(resolveProfilePaths(env).configDir); return receipt;
  } catch(error) { if(error instanceof CampfireError) throw error; return failure("Agent enrollment response unavailable; retry --enroll with the saved request"); }
}
