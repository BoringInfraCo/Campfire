/** Private, recoverable enrollment workflow. Raw credentials stay on this machine. */
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, linkSync, openSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { CampfireError, ValidationError } from "../domain/errors.js";
import { normalizeRedeemEnrollmentInput, type EnrollmentHarness, type EnrollmentReceipt, type IssuedEnrollmentInvitation, type OwnedAgentReceipt, type RedeemEnrollmentInput } from "../domain/enrollment.js";
import { campfireHttpCall, campfireHttpDeclineEnrollment, campfireHttpPreviewEnrollment, campfireHttpRedeemEnrollment } from "../http/client.js";
import { parseInvitationLink } from "./invitation-link.js";
import { generateRawToken, hashToken } from "../service/tokens.js";
import { activateJoinProfile, joinProfileEnvironment, loadAnyProfile, loadCredentials, resolveProfilePaths } from "./profile.js";
import { canonicalEndpoint, loadRemoteProfile, persistRemoteProfile, resolveRemoteAccess } from "./remote-profile.js";
import { assertConnectionCompatible, assertOpenCodeUnshadowed, assertOpenCodeV1Effective, defaultHarnessConfigPath, detectOpenCodeMajor, prepareConnection, type OpenCodeMajor } from "./connect.js";

export interface InvitationFile extends IssuedEnrollmentInvitation { url: string }
interface ConnectionSettings { configPaths:Partial<Record<EnrollmentHarness,string>>; mcpCommand:string; serverNames?:Partial<Record<EnrollmentHarness,string>>; opencodeMajor?:OpenCodeMajor }
interface PendingEnrollment extends ConnectionSettings { version:1; invitation:InvitationFile; input:RedeemEnrollmentInput; humanToken:string; agentTokens:Partial<Record<EnrollmentHarness,string>> }
interface CompletedEnrollment extends ConnectionSettings { version:1; kind:"saved_enrollment"; receipt:EnrollmentReceipt; invitationSecretHash?: string; invitationExpiresAt?: string }
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
export type JoinOutcome = EnrollmentReceipt & { stages: EnrollmentStage[]; profileId?: string; connectionNames?: Partial<Record<EnrollmentHarness, string>> };
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
function connectionSettings(input:JoinFromInvitationInput,env:NodeJS.ProcessEnv,opencodeMajor?:OpenCodeMajor,saved?:ConnectionSettings):ConnectionSettings {
  if (input.configPaths!==undefined && (!object(input.configPaths,["codex","opencode"]) || Object.keys(input.configPaths).some(key=>!input.harnesses.includes(key as EnrollmentHarness)))) failure("Harness config selection is invalid", "select_harness_config");
  const configPaths:ConnectionSettings["configPaths"]={};
  for(const harness of input.harnesses) {
    // Joining should make the connection available across projects; never
    // silently write credentials into a project configuration by default.
    const selected=input.configPaths?.[harness] ?? saved?.configPaths?.[harness] ?? defaultHarnessConfigPath(harness,env,process.cwd(),opencodeMajor,true);
    if(!text(selected,4096)) failure("Harness config path is invalid", "select_harness_config");
    configPaths[harness]=resolve(selected);
  }
  const mcpCommand=input.mcpCommand ?? saved?.mcpCommand ?? process.argv[1] ?? "campfire";
  if(!text(mcpCommand,4096)) failure("MCP command is invalid", "select_harness_config");
  return {configPaths,mcpCommand,...(opencodeMajor===undefined?{}:{opencodeMajor})};
}
function sameConnections(saved:ConnectionSettings,selected:ConnectionSettings,harnesses:EnrollmentHarness[]):boolean {
  return object(saved.configPaths,["codex","opencode"]) && saved.mcpCommand===selected.mcpCommand &&
    Object.keys(saved.configPaths).length===harnesses.length && harnesses.every(harness=>saved.configPaths[harness]===selected.configPaths[harness]);
}

/** Return non-secret, profile-bound connection settings for subsequent up/connect. */
export function savedEnrollmentConnection(harness: EnrollmentHarness, env: NodeJS.ProcessEnv = process.env): { configPath: string; mcpCommand: string; serverName?: string; opencodeMajor?: OpenCodeMajor } | undefined {
  const dir = resolveProfilePaths(env).configDir;
  if (existsSync(join(dir, "pending-enrollment.json"))) failure("Enrollment setup is incomplete; retry the original invitation before reconnecting", "retry_saved_enrollment");
  const path = join(dir, "enrollment-receipt.json");
  if (!existsSync(path)) return undefined;
  const saved = readPrivate<CompletedEnrollment>(path), profile = loadRemoteProfile(env), credentials = loadCredentials(env);
  const agent = profile?.agents.find((item) => item.harness === harness);
  if (agent === undefined) return undefined;
  if (saved.version !== 1 || saved.kind !== "saved_enrollment" || !saved.receipt || saved.receipt.workspace?.id !== profile?.workspaceId ||
      saved.receipt.human?.id !== profile.humanId || !saved.receipt.agents?.some((item) => item.id === agent.id && item.harness === harness) ||
      credentials?.endpoint !== profile.url || credentials.humanId !== profile.humanId || credentials.workspaceId !== profile.workspaceId ||
      credentials.agentIds?.[harness] !== agent.id || !credentials.agents?.[harness]) failure("Saved agent connection does not match the selected profile", "recover_enrollment_credentials");
  const configPath = saved.configPaths?.[harness];
  if (typeof configPath !== "string" || !isAbsolute(configPath) || !text(saved.mcpCommand, 4096) ||
      (saved.opencodeMajor !== undefined && saved.opencodeMajor !== 1 && saved.opencodeMajor !== 2)) failure("Saved agent connection is invalid", "recover_enrollment_credentials");
  const serverName = saved.serverNames?.[harness];
  if (serverName !== undefined && (typeof serverName !== "string" || !/^campfire(?:_[A-Za-z0-9_-]{1,120})?$/.test(serverName))) failure("Saved agent connection is invalid", "recover_enrollment_credentials");
  return { configPath, mcpCommand: saved.mcpCommand, ...(serverName === undefined ? {} : { serverName }), ...(harness !== "opencode" || saved.opencodeMajor === undefined ? {} : { opencodeMajor: saved.opencodeMajor }) };
}
function prepareEnrolledConnections(pending:PendingEnrollment,receipt:EnrollmentReceipt,env:NodeJS.ProcessEnv):void {
  for(const agent of receipt.agents) prepareConnection({harness:agent.harness,mcpCommand:pending.mcpCommand,configPath:pending.configPaths[agent.harness]!,
    url:pending.invitation.url,agentToken:pending.agentTokens[agent.harness]!,workspaceId:receipt.workspace.id,
    ...(agent.harness === "opencode" ? { credentialProfileDir: resolveProfilePaths(env).configDir } : {}),
    ...(pending.serverNames?.[agent.harness]===undefined?{}:{serverName:pending.serverNames[agent.harness]}),
    ...(agent.harness!=="opencode" || pending.opencodeMajor===undefined?{}:{opencodeMajor:pending.opencodeMajor}),env,rejectConflicting:true});
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
/** Actionable recipient text per non-pending status. Never names the workspace. */
export function invitationStatusAdvice(status: string): string {
  switch (status) {
    case "expired": return "This invitation has expired (invitations last 30 minutes). Ask the owner for a new link. Nothing joined and no local workspace was created.";
    case "consumed": return "This invitation was already used. If that was you, you are already a member. Otherwise ask the owner for a new link. Nothing joined.";
    case "revoked": return "This invitation was revoked by the owner. Ask them for a new link. Nothing joined.";
    case "unavailable": return "This invitation is not available right now. Ask the owner for a new link. Nothing joined.";
    default: return "This invitation link is not valid. Check that you pasted the whole link, or ask the owner for a new one. Nothing joined and no local workspace was created.";
  }
}
/** Map a server rejection of an invitation capability to a recipient-safe error. */
export function invitationRejection(error: unknown): unknown {
  if (error instanceof CampfireError && (error.code === "Unauthorized" || error.code === "Conflict" || error.code === "WorkspaceNotFound")) {
    return new CampfireError(error.code, invitationStatusAdvice("invalid"), { nextAction: "request_new_invitation" });
  }
  return error;
}
export async function previewInvitationLink(link: string, allowLoopback = false) {
  const parsed = parseInvitationLink(link, allowLoopback);
  let preview;
  try { preview = await campfireHttpPreviewEnrollment({ baseUrl: parsed.url, secret: parsed.secret, invitationId: parsed.invitationId }); }
  catch (error) { throw invitationRejection(error); }
  if (preview.kind !== "enrollment_invitation_preview" || preview.invitationId !== parsed.invitationId ||
      !["pending", "consumed", "expired", "revoked", "unavailable"].includes(preview.status) ||
      (preview.status === "pending" && (preview.workspace?.id === undefined || preview.inviter?.name === undefined))) {
    failure("Invitation preview did not match the link", "paste_invitation_link");
  }
  // Older endpoints may return extra metadata for an inactive invitation.
  return preview.status === "pending" ? preview : { version: 1 as const, kind: "enrollment_invitation_preview" as const, invitationId: preview.invitationId, status: preview.status };
}
export async function declineInvitationLink(link: string, allowLoopback = false) {
  const parsed = parseInvitationLink(link, allowLoopback);
  let receipt;
  try { receipt = await campfireHttpDeclineEnrollment({ baseUrl: parsed.url, secret: parsed.secret, invitationId: parsed.invitationId }); }
  catch (error) { throw invitationRejection(error); }
  if (receipt.kind !== "enrollment_invitation_decline" || receipt.membershipCreated !== false || receipt.invitationId !== parsed.invitationId) {
    failure("Invitation decline did not match the link", "paste_invitation_link");
  }
  return receipt;
}
export async function acceptInvitationLink(input: Omit<JoinFromInvitationInput, "invitationFile"> & { link: string }, env: NodeJS.ProcessEnv = process.env): Promise<JoinOutcome> {
  const parsed = parseInvitationLink(input.link, input.allowLoopback === true);
  const selected = enrollmentEnvironment(env, parsed.invitationId);
  // A committed enrollment can consume the invitation before the response
  // reaches this client. Resume only the exact locally saved capability; a
  // fresh caller must still preview a pending invitation before any write.
  const pendingPath = join(resolveProfilePaths(selected.env).configDir, "pending-enrollment.json");
  if (existsSync(pendingPath)) {
    const saved = readPrivate<PendingEnrollment>(pendingPath);
    const invitation = validateInvitation(saved.invitation, input.allowLoopback === true);
    if (invitation.invitationId === parsed.invitationId && invitation.url === parsed.url && invitation.secret === parsed.secret) {
      return finishEnrollment(invitation, { ...input, invitationFile: input.link }, env, selected);
    }
  }
  const receiptPath = join(resolveProfilePaths(selected.env).configDir, "enrollment-receipt.json");
  if (existsSync(receiptPath)) {
    const saved = readPrivate<CompletedEnrollment>(receiptPath);
    if (saved.receipt?.invitationId === parsed.invitationId && saved.invitationSecretHash === hashToken(parsed.secret) && saved.invitationExpiresAt !== undefined) {
      const invitation = validateInvitation({ version: 1, kind: "enrollment_invitation", invitationId: parsed.invitationId, secret: parsed.secret,
        url: parsed.url, workspace: saved.receipt.workspace, expiresAt: saved.invitationExpiresAt,
        permittedHarnesses: saved.receipt.agents.map((agent) => agent.harness) }, input.allowLoopback === true);
      return finishEnrollment(invitation, { ...input, invitationFile: input.link }, env, selected);
    }
  }
  const preview = await previewInvitationLink(input.link, input.allowLoopback === true);
  if (preview.status !== "pending") failure(invitationStatusAdvice(preview.status), preview.status === "expired" ? "request_new_invitation" : "paste_invitation_link");
  const invitation = validateInvitation({
    version: 1, kind: "enrollment_invitation", invitationId: preview.invitationId, secret: parsed.secret, url: parsed.url,
    workspace: preview.workspace, expiresAt: preview.expiresAt, permittedHarnesses: preview.permittedHarnesses,
  }, input.allowLoopback === true);
  return finishEnrollment(invitation, { ...input, invitationFile: input.link }, env, selected);
}
export async function joinFromInvitation(input:JoinFromInvitationInput,env:NodeJS.ProcessEnv=process.env):Promise<JoinOutcome> {
  const invitation = invitationFromFile(input.invitationFile, input.allowLoopback === true);
  return finishEnrollment(invitation, input, env, enrollmentEnvironment(env, invitation.invitationId));
}

function enrollmentEnvironment(env: NodeJS.ProcessEnv, invitationId: string): { env: NodeJS.ProcessEnv; isolated: boolean } {
  assertNoProfileOverrides(env);
  const current = resolveProfilePaths(env);
  // Always resume an in-flight operation in the profile where it started.
  if (existsSync(join(current.configDir, "pending-enrollment.json"))) return { env, isolated: false };
  const receiptPath = join(current.configDir, "enrollment-receipt.json");
  if (existsSync(receiptPath) && readPrivate<CompletedEnrollment>(receiptPath).receipt?.invitationId === invitationId) return { env, isolated: false };
  const childEnv = joinProfileEnvironment(env, invitationId);
  const child = resolveProfilePaths(childEnv);
  const useChild = existsSync(join(child.configDir, "pending-enrollment.json")) || existsSync(join(child.configDir, "enrollment-receipt.json")) || loadAnyProfile(env) !== undefined || loadCredentials(env) !== undefined;
  if (!useChild) return { env, isolated: false };
  return { env: childEnv, isolated: true };
}

/** A selected profile must not be silently redirected to an inherited actor. */
export function assertNoProfileOverrides(env: NodeJS.ProcessEnv): void {
  if (["CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_ACTOR_ID", "CAMPFIRE_ACTOR_TYPE", "CAMPFIRE_SESSION_ID", "CAMPFIRE_HARNESS"].some((key) => env[key]?.trim())) {
    failure("A Campfire identity or endpoint environment override is active. Remove it before joining or switching profiles so commands cannot use the wrong identity.", "clear_profile_overrides");
  }
}

async function finishEnrollment(invitation: InvitationFile, input: JoinFromInvitationInput, baseEnv: NodeJS.ProcessEnv, selected: { env: NodeJS.ProcessEnv; isolated: boolean }): Promise<JoinOutcome> {
  const receipt = await completeEnrollment(invitation, input, selected.env, selected.isolated);
  if (selected.isolated) {
    try { activateJoinProfile(baseEnv, invitation.invitationId); }
    catch { return failure("Enrollment succeeded, but Campfire could not switch to the new profile. Retry the original invitation to complete setup.", "retry_saved_enrollment", "connection_prepared"); }
    if (resolveProfilePaths(baseEnv).configDir !== resolveProfilePaths(selected.env).configDir) {
      return failure("Enrollment succeeded, but another profile was selected concurrently. Run campfire profiles to select the joined workspace.", "inspect_profile_selection", "connection_prepared");
    }
  }
  return selected.isolated ? { ...receipt, profileId: `join-${invitation.invitationId}` } : receipt;
}
async function completeEnrollment(invitation: InvitationFile, input: JoinFromInvitationInput, env: NodeJS.ProcessEnv, isolatedProfile: boolean): Promise<JoinOutcome> {
  if(!Array.isArray(input.harnesses) || input.harnesses.length<1 || input.harnesses.length>2 ||
      input.harnesses.some(harness=>!invitation.permittedHarnesses.includes(harness)) || new Set(input.harnesses).size!==input.harnesses.length || !text(input.humanName)) failure("Requested enrollment is outside the invitation's supported scope", "check_invitation_scope");
  const paths = resolveProfilePaths(env); const pendingPath = join(paths.configDir,"pending-enrollment.json");
  const receiptPath = join(paths.configDir,"enrollment-receipt.json");
  const savedSettings = existsSync(pendingPath) ? readPrivate<PendingEnrollment>(pendingPath) : existsSync(receiptPath) ? readPrivate<CompletedEnrollment>(receiptPath) : undefined;
  if (savedSettings?.opencodeMajor !== undefined && savedSettings.opencodeMajor !== 1 && savedSettings.opencodeMajor !== 2) failure("Saved harness configuration is invalid", "recover_pending_enrollment");
  const opencodeMajor = input.harnesses.includes("opencode") ? savedSettings?.opencodeMajor ?? detectOpenCodeMajor(env) : undefined;
  const selectedConnections=connectionSettings(input,env,opencodeMajor,savedSettings);
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
      agentTokens:Object.fromEntries(receipt.agents.map(agent=>[agent.harness,credentials.agents![agent.harness]])),...selectedConnections,
      ...(completed.serverNames===undefined?{}:{serverNames:completed.serverNames})};
    await verifyEnrollment(recovered,receipt);
    prepareEnrolledConnections(recovered,receipt,env);
    return { ...receipt, stages: completedStages("reload_required"), connectionNames: Object.fromEntries(receipt.agents.map((agent) => [agent.harness, recovered.serverNames?.[agent.harness] ?? "campfire"])) };
  }
  let pending:PendingEnrollment;
  if (existsSync(pendingPath)) {
    pending = readPrivate<PendingEnrollment>(pendingPath);
    if(!object(pending,["version","invitation","input","humanToken","agentTokens","configPaths","mcpCommand","serverNames","opencodeMajor"])) failure("Saved enrollment file is invalid", "recover_pending_enrollment");
    normalizeRedeemEnrollmentInput(pending.input);
    if (typeof pending.humanToken!=="string" || hashToken(pending.humanToken)!==pending.input.humanTokenHash || !pending.agentTokens || pending.input.agents.some(agent=>typeof pending.agentTokens[agent.harness]!=="string" || hashToken(pending.agentTokens[agent.harness]!)!==agent.tokenHash) || Object.keys(pending.agentTokens).length!==pending.input.agents.length) failure("Saved enrollment credentials do not match the prepared request; recover the original private pending file");
    const savedInvitation=validateInvitation(pending.invitation,input.allowLoopback===true);
    if (pending.version!==1 || savedInvitation.invitationId!==invitation.invitationId || savedInvitation.url!==invitation.url || savedInvitation.secret!==invitation.secret ||
        savedInvitation.workspace.id!==invitation.workspace.id || savedInvitation.workspace.teamId!==invitation.workspace.teamId ||
        pending.input.humanName!==input.humanName.trim() || [...input.harnesses].sort().join(",")!==pending.input.agents.map(agent=>agent.harness).sort().join(",") ||
        !sameConnections(pending,selectedConnections,input.harnesses)) failure("Another enrollment is pending; retry its original invitation, name, harness, and config selection", "recover_pending_enrollment");
    if (pending.opencodeMajor === undefined && opencodeMajor !== undefined) pending.opencodeMajor = opencodeMajor;
  } else {
    if (profile!==undefined || loadCredentials(env)!==undefined) failure("An existing profile or credential bundle would be replaced; use an isolated CAMPFIRE_CONFIG_DIR", "use_isolated_profile");
    if(Date.parse(invitation.expiresAt)<=Date.now()) failure("Invitation has expired; ask the owner for a new invitation", "request_new_invitation");
    const humanToken = generateRawToken(); const agentTokens:PendingEnrollment["agentTokens"] = {};
    for (const harness of input.harnesses) agentTokens[harness]=generateRawToken();
    const prepared = normalizeRedeemEnrollmentInput({invitationId:invitation.invitationId,requestId:randomUUID(),humanName:input.humanName,humanTokenHash:hashToken(humanToken),agents:input.harnesses.map(harness=>({harness,tokenHash:hashToken(agentTokens[harness]!)}))});
    pending={version:1,invitation,input:prepared,humanToken,agentTokens,...selectedConnections};
    for (const agent of prepared.agents) {
      const connection = {harness:agent.harness,configPath:pending.configPaths[agent.harness]!,url:invitation.url,agentToken:agentTokens[agent.harness],
        ...(agent.harness === "opencode" ? { credentialProfileDir: paths.configDir } : {}),
        ...(agent.harness!=="opencode" || opencodeMajor===undefined?{}:{opencodeMajor})};
      // A separately selectable profile must never occupy the legacy name:
      // switching back to the original profile may reconnect that name.
      let needsNamedConnection = isolatedProfile;
      if (!needsNamedConnection) {
        try { assertConnectionCompatible(connection); }
        catch (error) {
          if (!(error instanceof CampfireError) || error.details?.nextAction !== "use_isolated_harness_config") throw error;
          needsNamedConnection = true;
        }
      }
      if (needsNamedConnection) {
        const slug = invitation.workspace.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "workspace";
        // A later invitation to the same workspace may enroll a different
        // human/agent identity; its connection must not collide with this one.
        const digest = createHash("sha256").update(`${invitation.url}\n${invitation.workspace.id}\n${invitation.invitationId}`).digest("hex").slice(0, 12);
        const serverName = `campfire_${slug}_${digest}`;
        assertConnectionCompatible({ ...connection, serverName });
        pending.serverNames ??= {}; pending.serverNames[agent.harness] = serverName;
      }
    }
    if (opencodeMajor === 2) assertOpenCodeUnshadowed(pending.configPaths.opencode!, pending.serverNames?.opencode ?? "campfire", env);
    if (opencodeMajor === 1) assertOpenCodeV1Effective({ serverName: pending.serverNames?.opencode ?? "campfire", profileDir: paths.configDir, mcpCommand: pending.mcpCommand }, env);
    savePrivate(pendingPath,pending);
  }
  // A previously committed request may have installed this exact profile.
  // Reject an unrelated profile introduced since credential preparation before
  // presenting the pending enrollment capability to a shared service again.
  if(profile!==undefined && (profile.mode!=="remote" || profile.url!==invitation.url || profile.workspaceId!==invitation.workspace.id ||
      profile.humanName!==pending.input.humanName || loadCredentials(env)?.humanToken!==pending.humanToken)) failure("Existing profile conflicts with the saved enrollment", "use_isolated_profile");
  if (pending.opencodeMajor === 2) assertOpenCodeUnshadowed(pending.configPaths.opencode!, pending.serverNames?.opencode ?? "campfire", env);
  if (pending.opencodeMajor === 1) assertOpenCodeV1Effective({ serverName: pending.serverNames?.opencode ?? "campfire", profileDir: paths.configDir, mcpCommand: pending.mcpCommand }, env);
  let receipt:EnrollmentReceipt;
  try { receipt = await campfireHttpRedeemEnrollment({baseUrl:invitation.url,secret:invitation.secret,input:pending.input}); }
  catch (error) {
    // A structured rejection means this request did not commit, except when a
    // previously committed enrollment is now unreadable through the invitation;
    // in that case the same prepared credentials still prove the real state.
    if (error instanceof CampfireError && (error.code==="Unauthorized" || error.code==="Conflict")) {
      try { receipt = await recoverEnrollment(pending); }
      catch { throw invitationRejection(error); }
    } else if (error instanceof CampfireError) throw error;
    else return failure("Enrollment commit is uncertain: the response was lost. Retry the same invitation with the saved request");
  }
  let reached:EnrollmentStage="enrolled";
  try {
    await verifyEnrollment(pending,receipt);
    persistRemoteProfile({url:invitation.url,humanId:receipt.human.id,humanName:receipt.human.name,workspaceId:receipt.workspace.id,workspaceName:receipt.workspace.name,humanToken:pending.humanToken,agents:receipt.agents.map(agent=>({...agent,token:pending.agentTokens[agent.harness]!})),allowLoopbackHttp:input.allowLoopback},env);
    reached="credentials_saved";
    prepareEnrolledConnections(pending,receipt,env);
    reached="connection_prepared";
    savePrivate(receiptPath,{version:1,kind:"saved_enrollment",receipt,...selectedConnections,...(pending.serverNames===undefined?{}:{serverNames:pending.serverNames}),invitationSecretHash:hashToken(invitation.secret),invitationExpiresAt:invitation.expiresAt},true); rmSync(pendingPath); flushDirectory(paths.configDir);
    return { ...receipt, stages: completedStages("reload_required"), connectionNames: Object.fromEntries(receipt.agents.map((agent) => [agent.harness, pending.serverNames?.[agent.harness] ?? "campfire"])) };
  } catch (error) {
    // The remote enrollment has committed even when local verification or a
    // harness configuration write fails. Preserve the private pending request
    // and describe the real state rather than implying that nobody joined.
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
    prepareConnection({harness:input.harness,mcpCommand:pending.mcpCommand,configPath:pending.configPath,url:profile.url,agentToken:pending.token,workspaceId:profile.workspaceId,...(input.harness === "opencode" ? {credentialProfileDir:resolveProfilePaths(env).configDir} : {}),rejectConflicting:true});
    rmSync(path); flushDirectory(resolveProfilePaths(env).configDir); return receipt;
  } catch(error) { if(error instanceof CampfireError) throw error; return failure("Agent enrollment response unavailable; retry --enroll with the saved request"); }
}
