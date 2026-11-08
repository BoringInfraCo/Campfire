/** Isolated canonical source fixture for MEM-001 ordering and controls.
 * Uses v1.29.7 service writes only; this is not a health projection.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ID_PREFIXES, type IdKind } from '../../src/domain/ids.js';
import { createCampfireService } from '../../src/service/campfire-service.js';
import { openSqliteStore } from '../../src/store/sqlite-store.js';
export interface SeedMem000Args { out?: string | undefined; databasePath?: string | undefined; privateOut?: string | undefined }
/** Same behavior as scripts/seed-mem-000-candidate.ts (which delegates here); lives in tests/helpers so public CI works without scripts/. */
export function seedMem000Candidate(a: SeedMem000Args): void {
const at = '2026-11-07T12:00:00.000Z';
let now = at;
const ids: Partial<Record<IdKind, string[]>> = {
  human:['hum_mempage_owner','hum_mempage_member'], agent:['agt_mempage_agent','agt_mempage_executor'], workspace:['ws_mempage','ws_mempage_empty'],
  agentSession:['ses_mempage_agent','ses_mempage_executor','ses_mempage_agent_empty'],
  artifact:['art_mempage_a','art_mempage_b','art_mempage_c'],
  finding:['find_mempage_old','find_mempage_new','find_mempage_a','find_mempage_b','find_mempage_supported','find_mempage_withdrawn'],
  findingEvidence:['fev_mempage_a1','fev_mempage_a2','fev_mempage_b1','fev_mempage_supported','fev_mempage_removed','fev_mempage_withdrawn'],
  decision:['dec_mempage_review','dec_mempage_current','dec_mempage_proposed','dec_mempage_removed','dec_mempage_old','dec_mempage_successor'],
  decisionCitation:['cit_mempage_review','cit_mempage_current','cit_mempage_proposed','cit_mempage_removed','cit_mempage_old'],
  task:['task_mempage_action','task_mempage_a','task_mempage_b','task_mempage_description','task_mempage_assignee','task_mempage_open','task_mempage_whitespace'],
  actionProposal:['actp_mempage_unknown','actp_mempage_accepted'], actionReservation:['resv_mempage_unknown','resv_mempage_accepted'], actionReceipt:['arcp_mempage_unknown','arcp_mempage_accepted'],
};
const counters = new Map<IdKind,number>();
const idSource = (kind: IdKind) => ids[kind]?.shift() ?? `${ID_PREFIXES[kind]}_mempage_${String(counters.set(kind,(counters.get(kind)??0)+1).get(kind)).padStart(4,'0')}`;
const databasePath = a.databasePath ?? join(mkdtempSync(join(tmpdir(),'mempage-')),'fixture.db');
const store=openSqliteStore(databasePath);
const svc=createCampfireService({store,idSource,clock:()=>now,webhookEnv:{}});
const owner={actor:{actorId:'hum_mempage_owner',actorType:'human' as const}};
const agent={actor:{actorId:'agt_mempage_agent',actorType:'agent' as const},agentSessionId:'ses_mempage_agent'};
const executor={actor:{actorId:'agt_mempage_executor',actorType:'agent' as const},agentSessionId:'ses_mempage_executor'};
try {
 store.createOrganization({id:'org_mempage',name:'Fixture',createdAt:at}); store.createTeam({id:'team_mempage',organizationId:'org_mempage',name:'Fixture',createdAt:at});
 const humanIdentity=svc.createHuman(undefined,{teamId:'team_mempage',displayName:'Owner'});
 const memberIdentity=svc.createHuman(owner,{teamId:'team_mempage',displayName:'Member'});
 const agentIdentity=svc.createAgent(owner,{teamId:'team_mempage',humanId:'hum_mempage_owner',name:'Agent',harness:'fixture'});
 svc.createAgent(owner,{teamId:'team_mempage',humanId:'hum_mempage_owner',name:'Executor',harness:'fixture'});
 svc.createWorkspace(owner,{teamId:'team_mempage',name:'Memory pagination fixture'});
 const memberActor={actorId:'hum_mempage_member',actorType:'human' as const}; svc.inviteToWorkspace(owner,{workspaceId:'ws_mempage',actor:memberActor,role:'member'}); svc.joinWorkspace({actor:memberActor},{workspaceId:'ws_mempage'});
 for (const actorId of ['agt_mempage_agent','agt_mempage_executor']) { const actor={actorId,actorType:'agent' as const}; svc.inviteToWorkspace(owner,{workspaceId:'ws_mempage',actor,role:'agent'}); svc.joinWorkspace({actor},{workspaceId:'ws_mempage'}); svc.registerAgentSession({actor},{agentId:actorId,workspaceId:'ws_mempage',harness:'fixture'}); }
 for (const title of ['A','B','C']) svc.addArtifact(agent,{workspaceId:'ws_mempage',type:'document',title,uriOrPath:`https://example.invalid/${title}`});
 svc.addFinding(agent,{workspaceId:'ws_mempage',summary:'old'}); svc.correctFinding(agent,{findingId:'find_mempage_old',summary:'new',reason:'fixture correction'});
 for (const summary of ['A','B','supported','withdrawn']) svc.addFinding(agent,{workspaceId:'ws_mempage',summary});
 svc.withdrawFinding(agent,{findingId:'find_mempage_withdrawn',reason:'fixture withdrawal'});
 for (const [findingId,artifactId,relation] of [['find_mempage_a','art_mempage_a','contradicts'],['find_mempage_a','art_mempage_b','contradicts'],['find_mempage_b','art_mempage_c','contradicts'],['find_mempage_supported','art_mempage_a','supports'],['find_mempage_supported','art_mempage_b','contradicts'],['find_mempage_withdrawn','art_mempage_c','contradicts']] as const) svc.citeFindingEvidence(agent,{findingId,artifactId,relation});
 svc.removeFindingEvidence(agent,{evidenceId:'fev_mempage_removed'});
 for (const summary of ['review','current','proposed','removed']) svc.addDecision(owner,{workspaceId:'ws_mempage',summary,rationale:'fixture'});
 for (const id of ['dec_mempage_review','dec_mempage_current','dec_mempage_removed']) svc.acceptDecision(owner,id);
 for (const [decisionId,findingId] of [['dec_mempage_review','find_mempage_old'],['dec_mempage_current','find_mempage_new'],['dec_mempage_proposed','find_mempage_old'],['dec_mempage_removed','find_mempage_old']] as const) svc.citeDecisionBasis(owner,{decisionId,findingId});
 svc.removeDecisionBasis(owner,{citationId:'cit_mempage_removed'});
 svc.addDecision(owner,{workspaceId:'ws_mempage',summary:'old rule',rationale:'fixture'}); svc.acceptDecision(owner,'dec_mempage_old'); svc.citeDecisionBasis(owner,{decisionId:'dec_mempage_old',findingId:'find_mempage_old'}); svc.addDecision(owner,{workspaceId:'ws_mempage',summary:'successor',rationale:'fixture',replacesDecisionId:'dec_mempage_old'}); svc.acceptDecision(owner,'dec_mempage_successor',{reason:'fixture replacement'});
 for (const [title,description,assignee,blocked] of [['action','complete',true,true],['missing A',undefined,false,true],['missing B',undefined,false,true],['description','complete',false,true],['assignee',undefined,true,true],['open',undefined,false,false]] as const) {
   const task=svc.createTask(owner,{workspaceId:'ws_mempage',title,...(description?{description}:{}),...(assignee?{assignee:owner.actor}:{})}); if(blocked) { now = task.id === 'task_mempage_b' ? '2026-11-07T12:01:00.000Z' : at; svc.updateTask(owner,{taskId:task.id,status:'blocked'}); now = at; }
 }
 let whitespace: string; try { const w=svc.createTask(owner,{workspaceId:'ws_mempage',title:'whitespace',description:'   '}); svc.updateTask(owner,{taskId:w.id,status:'blocked'}); whitespace='persisted:'+w.id; } catch (e) { whitespace='rejected:'+(e instanceof Error ? e.name : 'unknown'); }
 const proposed=svc.propose_action(agent,{workspaceId:'ws_mempage',target:{repositoryId:'100000001',repositoryName:'fixture-org/verification-sandbox',workflowId:'100000002',runId:'100000003',commitSha:'0123456789abcdef0123456789abcdef01234567',expectedAttempt:2},executor:executor.actor,expiresAt:'2026-11-08T12:00:00.000Z',reason:'fixture only',taskId:'task_mempage_action',findingIds:['find_mempage_supported'],artifactIds:['art_mempage_a'],sourceAuthorityRevision:'fixture',requestKey:'mempage-propose'});
 const approved=svc.review_action(owner,{workspaceId:'ws_mempage',proposalId:proposed.proposal.id,revision:proposed.proposal.revision,intentDigest:proposed.proposal.intentDigest,decision:'approve',requestKey:'mempage-approve'});
 const reserved=svc.reserve_action_execution(executor,{workspaceId:'ws_mempage',proposalId:proposed.proposal.id,revision:approved.proposal.revision,intentDigest:approved.proposal.intentDigest,requestKey:'mempage-reserve'});
 svc.record_action_outcome(executor,{workspaceId:'ws_mempage',proposalId:proposed.proposal.id,revision:reserved.proposal.revision,intentDigest:reserved.proposal.intentDigest,outcome:'unknown',providerRef:{repositoryId:'100000001',workflowId:'100000002',runId:'100000003',attempt:2},requestKey:'mempage-outcome'});
 const p2=svc.propose_action(agent,{workspaceId:'ws_mempage',target:{repositoryId:'100000001',repositoryName:'fixture-org/verification-sandbox',workflowId:'100000002',runId:'100000004',commitSha:'0123456789abcdef0123456789abcdef01234567',expectedAttempt:2},executor:executor.actor,expiresAt:'2026-11-08T12:00:00.000Z',reason:'fixture only',taskId:'task_mempage_action',findingIds:['find_mempage_supported'],artifactIds:['art_mempage_a'],sourceAuthorityRevision:'fixture',requestKey:'mempage-propose2'});
 const a2=svc.review_action(owner,{workspaceId:'ws_mempage',proposalId:p2.proposal.id,revision:p2.proposal.revision,intentDigest:p2.proposal.intentDigest,decision:'approve',requestKey:'mempage-approve2'});
 const r2=svc.reserve_action_execution(executor,{workspaceId:'ws_mempage',proposalId:p2.proposal.id,revision:a2.proposal.revision,intentDigest:a2.proposal.intentDigest,requestKey:'mempage-reserve2'});
 svc.record_action_outcome(executor,{workspaceId:'ws_mempage',proposalId:p2.proposal.id,revision:r2.proposal.revision,intentDigest:r2.proposal.intentDigest,outcome:'accepted',providerRef:{repositoryId:'100000001',workflowId:'100000002',runId:'100000004',attempt:2},requestKey:'mempage-outcome2'});
 const accepted=svc.get_action_proposal(owner,{workspaceId:'ws_mempage',proposalId:'actp_mempage_accepted'});
 svc.createWorkspace(owner,{teamId:'team_mempage',name:'Empty fixture'});
 svc.inviteToWorkspace(owner,{workspaceId:'ws_mempage_empty',actor:memberActor,role:'member'}); svc.joinWorkspace({actor:memberActor},{workspaceId:'ws_mempage_empty'});
 const emptyAgent={actorId:'agt_mempage_agent',actorType:'agent' as const}; svc.inviteToWorkspace(owner,{workspaceId:'ws_mempage_empty',actor:emptyAgent,role:'agent'}); svc.joinWorkspace({actor:emptyAgent},{workspaceId:'ws_mempage_empty'}); svc.registerAgentSession({actor:emptyAgent},{agentId:'agt_mempage_agent',workspaceId:'ws_mempage_empty',harness:'fixture'});
 const action=svc.get_action_proposal(owner,{workspaceId:'ws_mempage',proposalId:'actp_mempage_unknown'});
 const decisions=['dec_mempage_review','dec_mempage_current','dec_mempage_proposed','dec_mempage_removed','dec_mempage_old','dec_mempage_successor'].map(id=>svc.getDecisionInWorkspace(owner,'ws_mempage',id));
 const findings=['find_mempage_old','find_mempage_new','find_mempage_a','find_mempage_b','find_mempage_supported','find_mempage_withdrawn'].map(id=>svc.getFindingInWorkspace(owner,'ws_mempage',id));
 const tasks=['task_mempage_action','task_mempage_a','task_mempage_b','task_mempage_description','task_mempage_assignee','task_mempage_open','task_mempage_whitespace'].map(id=>svc.getTaskInWorkspace(owner,'ws_mempage',id));
 const result={schema:'mem-000-candidate-source/1',workspaceId:'ws_mempage',clock:at,tip:store.maxAppendPosition('ws_mempage'), emptyWorkspace:{id:'ws_mempage_empty',tip:store.maxAppendPosition('ws_mempage_empty')}, memberships:Object.fromEntries(['ws_mempage','ws_mempage_empty'].map(id=>[id,store.listParticipants(id).map(p=>({actor:p.actor,role:p.role,joinedAt:p.joinedAt}))])), sessions:{health:'ses_mempage_agent',empty:'ses_mempage_agent_empty'}, whitespace,acceptedAction:{id:accepted.proposal.id,status:accepted.proposal.status,receiptId:accepted.latestReceipt?.id,outcome:accepted.latestReceipt?.outcome},
  action:{proposal:{id:action.proposal.id,status:action.proposal.status,revision:action.proposal.revision,taskId:action.proposal.taskId,reservationId:action.proposal.reservation?.reservationId,createdAt:action.proposal.createdAt,updatedAt:action.proposal.updatedAt},receipt:{id:action.latestReceipt?.id,outcome:action.latestReceipt?.outcome,recordedAt:action.latestReceipt?.recordedAt}},
  decisions:decisions.map(d=>({id:d.id,status:d.status,createdAt:d.createdAt,updatedAt:d.updatedAt,citations:d.citations?.map(c=>({id:c.id,findingId:c.findingId,createdAt:c.createdAt}))})),
  findings:findings.map(f=>({id:f.id,currentness:f.currentness,createdAt:f.createdAt,correctedAt:f.correctedAt,evidence:f.evidence?.map(e=>({id:e.id,artifactId:e.artifactId,relation:e.relation,createdAt:e.createdAt}))})),
  tasks:tasks.map(t=>({id:t.id,status:t.status,descriptionPresent:typeof t.description==='string' && t.description.trim().length>0,assigneePresent:t.assignee!==undefined,createdAt:t.createdAt,updatedAt:t.updatedAt})),
  artifacts:['art_mempage_a','art_mempage_b','art_mempage_c'].map(id=>({id,createdAt:svc.getArtifactInWorkspace(owner,'ws_mempage',id).createdAt}))};
 const out=a.out; if(out) writeFileSync(out,JSON.stringify(result,null,2)+'\n'); else console.log(JSON.stringify(result,null,2));
 const privateOut=a.privateOut; if (privateOut) writeFileSync(privateOut,JSON.stringify({databasePath,workspaceId:'ws_mempage',owner:{actorId:'hum_mempage_owner',token:humanIdentity.token},member:{actorId:'hum_mempage_member',token:memberIdentity.token},agent:{actorId:'agt_mempage_agent',sessionId:'ses_mempage_agent',emptySessionId:'ses_mempage_agent_empty',token:agentIdentity.token}},null,2)+'\n',{mode:0o600});
} finally { store.close(); }
}
