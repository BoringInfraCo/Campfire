/**
 * FAC-001 Step 0 synthetic fixture (contract section 11, "Fixture").
 *
 * FIXTURE ONLY. This script writes canonical records through the public service
 * API (plus two documented store-level calls). It computes NO expected cues,
 * order, coverage or counts: the answer key is authored separately from the
 * frozen contract (docs/evidence/fac-001/step-0/README.md) and is not exported.
 *
 *   npx tsx fixtures/attention/fac-001/seed.ts [--out <dir>] [--write-manifest] [--check]
 *
 * Default: seeds a fresh SQLite database in a new OS temp directory, writes
 * `manifest.json` next to it, and `tokens.json` (mode 0600, random bearer
 * tokens, never committed). `--check` regenerates the manifest and requires it
 * to equal the committed fixtures/attention/fac-001/manifest.json byte for byte
 * and requires docs/evidence/fac-001/step-0/scenarios.json (when present) to cite only manifest ids.
 * `--write-manifest` overwrites the committed manifest.json.
 *
 * Determinism: queued id source (counter fallback), a clock that advances one
 * second per write with explicit forward jumps, fixed workspace/proposal
 * expiries. Raw tokens are random and never appear in the manifest.
 * No network, no provider call, no real people or data. Artifact references
 * use the reserved example.invalid domain and are never fetched.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ID_PREFIXES, type IdKind } from "../../../src/domain/ids.js";
import type { ActorRef } from "../../../src/domain/types.js";
import type { ActorContext } from "../../../src/service/authorization.js";
import { createCampfireService } from "../../../src/service/campfire-service.js";
import { openSqliteStore } from "../../../src/store/sqlite-store.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export const SEED_BASE_ISO = "2026-11-10T09:00:00.000Z";
/** Read clocks for later runners. Seed writes finish before T1. */
export const READ_CLOCKS = {
  T1_before_any_expiry: "2026-11-10T10:15:00.000Z",
  T3_between_expiries: "2026-11-10T10:40:00.000Z",
  T2_after_all_expiries: "2026-11-10T12:00:00.000Z",
} as const;
const EXPIRY_A = "2026-11-10T10:30:00.000Z";
const EXPIRY_B = "2026-11-10T10:45:00.000Z";
/** Contract S = 100 per reason (frozen by Amendment 1, CS-15; MAX_PAGE_SIZE). Counts exceed it. */
export const TRUNC_TASKS = 105;
export const TRUNC_PROPOSALS = 103;

const SENTINEL_OTHER = "OTHER_WS_SENTINEL_fac001_do_not_leak";

const F = (name: string) => `fac001_${name}`;
const H = { ana: "hum_fac001_ana", ben: "hum_fac001_ben", val: "hum_fac001_val", rex: "hum_fac001_rex", nia: "hum_fac001_nia", zed: "hum_fac001_zed" } as const;
const A = {
  codex: "agt_fac001_codex",
  opencode: "agt_fac001_opencode",
  runner: "agt_fac001_runner",
  revoked: "agt_fac001_revoked",
  ghost: "agt_fac001_ghost",
  zedbot: "agt_fac001_zedbot",
  zedrunner: "agt_fac001_zedrunner",
} as const;
const W = {
  lab: "ws_fac001_lab",
  trunc: "ws_fac001_trunc",
  clean: "ws_fac001_clean",
  other: "ws_fac001_other",
  closed: "ws_fac001_closed",
  archived: "ws_fac001_archived",
} as const;

const human = (id: string): ActorRef => ({ actorId: id, actorType: "human" });
const agent = (id: string): ActorRef => ({ actorId: id, actorType: "agent" });
const ctxH = (id: string): ActorContext => ({ actor: human(id) });
const SES = (agentId: string, ws: string) => `ses_${agentId.slice(4)}_${ws.slice(3 + 7)}`;
const ctxA = (agentId: string, ws: string): ActorContext => ({ actor: agent(agentId), agentSessionId: SES(agentId, ws) });

interface RecordEntry {
  kind: string;
  workspaceId: string;
  id: string;
  seedCase: string;
}

export interface BuiltFixture {
  databasePath: string;
  manifest: unknown;
  tokens: Record<string, string>;
}

export function buildFixture(databasePath: string): BuiltFixture {
  let nowMs = Date.parse(SEED_BASE_ISO) - 1000;
  const clock = (): string => {
    nowMs += 1000;
    return new Date(nowMs).toISOString();
  };
  const jump = (iso: string): void => {
    const t = Date.parse(iso);
    if (t <= nowMs) throw new Error(`clock jump ${iso} not forward of ${new Date(nowMs).toISOString()}`);
    nowMs = t - 1000;
  };
  const wanted: Array<{ kind: IdKind; id: string }> = [];
  const counters = new Map<IdKind, number>();
  const idSource = (kind: IdKind): string => {
    const idx = wanted.findIndex((w) => w.kind === kind);
    if (idx >= 0) return wanted.splice(idx, 1)[0]!.id;
    const n = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, n);
    return `${ID_PREFIXES[kind]}_fac001_auto_${String(n).padStart(6, "0")}`;
  };
  const want = (kind: IdKind, id: string): string => {
    wanted.push({ kind, id });
    return id;
  };

  const store = openSqliteStore(databasePath);
  const svc = createCampfireService({ store, idSource, clock, webhookEnv: {} });
  const records: RecordEntry[] = [];
  const note = (kind: string, workspaceId: string, id: string, seedCase: string): string => {
    records.push({ kind, workspaceId, id, seedCase });
    return id;
  };
  const checkpoints: Record<string, Record<string, number>> = {};
  const checkpoint = (ws: string, name: string): void => {
    (checkpoints[ws] ??= {})[name] = store.maxAppendPosition(ws);
  };
  const tokens: Record<string, string> = {};
  const tokenStates: Record<string, string> = {};
  const sessions: Array<{ id: string; agentId: string; workspaceId: string }> = [];

  const ana = ctxH(H.ana);
  try {
    // ---- organization, team, identities -------------------------------------
    store.createOrganization({ id: "org_fac001", name: "FAC-001 fixture", createdAt: SEED_BASE_ISO });
    store.createTeam({ id: "team_fac001", organizationId: "org_fac001", name: "FAC-001 fixture", createdAt: SEED_BASE_ISO });
    const TEAM = "team_fac001";
    want("human", H.ana);
    tokens[H.ana] = svc.createHuman(undefined, { teamId: TEAM, displayName: "Ana Fixture" }).token;
    for (const [id, name] of [[H.ben, "Ben Fixture"], [H.val, "Val Fixture"], [H.rex, "Rex Fixture"], [H.nia, "Nia Fixture"], [H.zed, "Zed Fixture"]] as const) {
      want("human", id);
      tokens[id] = svc.createHuman(ana, { teamId: TEAM, displayName: name }).token;
    }
    const mkAgent = (id: string, ownerId: string, name: string): void => {
      want("agent", id);
      tokens[id] = svc.createAgent(ctxH(ownerId), { teamId: TEAM, humanId: ownerId, name, harness: "fixture" }).token;
    };
    mkAgent(A.codex, H.ana, "Codex Fixture");
    mkAgent(A.opencode, H.ben, "OpenCode Fixture");
    mkAgent(A.runner, H.ana, "Runner Fixture");
    mkAgent(A.revoked, H.ana, "Revoked Fixture");
    mkAgent(A.ghost, H.ana, "Ghost Fixture");
    mkAgent(A.zedbot, H.zed, "Zedbot Fixture");
    mkAgent(A.zedrunner, H.zed, "Zedrunner Fixture");

    // ---- workspace plumbing ----------------------------------------------------
    type Member = { id: string; type: "human" | "agent"; role: "member" | "viewer" | "agent" };
    const mkWorkspace = (wsId: string, ownerId: string, name: string, members: Member[]): void => {
      want("workspace", wsId);
      svc.createWorkspace(ctxH(ownerId), { teamId: TEAM, name });
      for (const m of members) {
        const actor = m.type === "human" ? human(m.id) : agent(m.id);
        svc.inviteToWorkspace(ctxH(ownerId), { workspaceId: wsId, actor, role: m.role });
        svc.joinWorkspace({ actor }, { workspaceId: wsId });
        if (m.type === "agent") {
          const sid = SES(m.id, wsId);
          want("agentSession", sid);
          svc.registerAgentSession({ actor }, { agentId: m.id, workspaceId: wsId, harness: "fixture" });
          sessions.push({ id: sid, agentId: m.id, workspaceId: wsId });
        }
      }
    };
    const hm = (id: string, role: "member" | "viewer"): Member => ({ id, type: "human", role });
    const ag = (id: string): Member => ({ id, type: "agent", role: "agent" });

    // ---- small helpers over the service ---------------------------------------
    const mkTask = (ws: string, id: string, title: string, o: { description?: string; assignee?: ActorRef; status?: "open" | "in_progress" | "blocked" | "completed"; seedCase: string; by?: ActorContext }): string => {
      const by = o.by ?? (ws === W.other ? ctxH(H.zed) : ana);
      want("task", id);
      svc.createTask(by, { workspaceId: ws, title, ...(o.description !== undefined ? { description: o.description } : {}), ...(o.assignee !== undefined ? { assignee: o.assignee } : {}) });
      if (o.status !== undefined && o.status !== "open") svc.updateTask(by, { taskId: id, status: o.status });
      return note("task", ws, id, o.seedCase);
    };
    const mkArtifact = (ws: string, id: string, title: string, by: ActorContext): string => {
      want("artifact", id);
      svc.addArtifact(by, { workspaceId: ws, type: "document", title, uriOrPath: `https://example.invalid/fac001/${id}` });
      return note("artifact", ws, id, "synthetic artifact reference");
    };
    const mkFinding = (ws: string, id: string, summary: string, by: ActorContext, seedCase: string): string => {
      want("finding", id);
      svc.addFinding(by, { workspaceId: ws, summary });
      return note("finding", ws, id, seedCase);
    };
    const cite = (by: ActorContext, id: string, findingId: string, artifactId: string, relation: "supports" | "contradicts", ws: string, seedCase: string): void => {
      want("findingEvidence", id);
      svc.citeFindingEvidence(by, { findingId, artifactId, relation });
      note("finding_evidence", ws, id, seedCase);
    };
    const mkDecision = (ws: string, id: string, summary: string, accepted: boolean, seedCase: string, by: ActorContext = ana): string => {
      want("decision", id);
      svc.addDecision(by, { workspaceId: ws, summary, rationale: "fixture rationale" });
      if (accepted) svc.acceptDecision(by, id);
      return note("decision", ws, id, seedCase);
    };
    const citeDecision = (by: ActorContext, id: string, decisionId: string, findingId: string, ws: string, seedCase: string): void => {
      want("decisionCitation", id);
      svc.citeDecisionBasis(by, { decisionId, findingId });
      note("decision_citation", ws, id, seedCase);
    };
    const target = (runId: number) => ({ repositoryId: "100000001", repositoryName: "fixture-org/verification-sandbox", workflowId: "100000002", runId: String(runId), commitSha: "0123456789abcdef0123456789abcdef01234567", expectedAttempt: 2 });
    let runSeq = 100000100;
    const propose = (ws: string, id: string, taskId: string, evidence: { findingId?: string; artifactId?: string }, o: { expiresAt?: string; seedCase: string; proposer?: string; executor?: string }): { revision: number; digest: string; runId: number } => {
      const proposer = o.proposer ?? A.codex;
      const executor = o.executor ?? A.runner;
      const runId = ++runSeq;
      want("actionProposal", id);
      const view = svc.propose_action(ctxA(proposer, ws), {
        workspaceId: ws,
        target: target(runId),
        executor: agent(executor),
        ...(o.expiresAt !== undefined ? { expiresAt: o.expiresAt } : {}),
        reason: "fixture only",
        taskId,
        ...(evidence.findingId !== undefined ? { findingIds: [evidence.findingId] } : {}),
        ...(evidence.artifactId !== undefined ? { artifactIds: [evidence.artifactId] } : {}),
        sourceAuthorityRevision: "fixture",
        requestKey: `${id}-propose`,
      });
      note("action_proposal", ws, id, o.seedCase);
      return { revision: view.proposal.revision, digest: view.proposal.intentDigest, runId };
    };
    type Driven = "approved" | "dispatch_reserved" | "submission_accepted" | "submission_failed" | "submission_unknown" | "reconciled";
    const drive = (ws: string, id: string, p: { revision: number; digest: string; runId: number }, upTo: Driven, ownerId: string, executor: string = A.runner): void => {
      const owner = ctxH(ownerId);
      const exec = ctxA(executor, ws);
      const approved = svc.review_action(owner, { workspaceId: ws, proposalId: id, revision: p.revision, intentDigest: p.digest, decision: "approve", requestKey: `${id}-approve` });
      if (upTo === "approved") return;
      want("actionReservation", `resv_${id.slice(5)}`);
      const reserved = svc.reserve_action_execution(exec, { workspaceId: ws, proposalId: id, revision: approved.proposal.revision, intentDigest: approved.proposal.intentDigest, requestKey: `${id}-reserve` });
      if (upTo === "dispatch_reserved") return;
      const providerRef = { repositoryId: "100000001", workflowId: "100000002", runId: String(p.runId), attempt: 2 };
      const outcome = upTo === "submission_accepted" ? "accepted" : upTo === "submission_failed" ? "definite_failure" : "unknown";
      want("actionReceipt", `arcp_${id.slice(5)}`);
      const receipt = svc.record_action_outcome(exec, { workspaceId: ws, proposalId: id, revision: reserved.proposal.revision, intentDigest: reserved.proposal.intentDigest, outcome, providerRef, requestKey: `${id}-outcome` });
      if (upTo !== "reconciled") return;
      want("actionReceipt", `arcp_${id.slice(5)}_recon`);
      const current = svc.get_action_proposal(owner, { workspaceId: ws, proposalId: id }).proposal;
      svc.record_action_outcome(exec, { workspaceId: ws, proposalId: id, revision: current.revision, intentDigest: current.intentDigest, outcome: "reconciled_accepted", providerRef, resolvesReceiptId: receipt.id, requestKey: `${id}-recon` });
    };

    // =========================================================================
    // ws_fac001_lab : the main case workspace (small enough to enumerate)
    // =========================================================================
    mkWorkspace(W.lab, H.ana, "FAC-001 lab", [
      hm(H.ben, "member"), hm(H.val, "viewer"), hm(H.rex, "member"),
      ag(A.codex), ag(A.opencode), ag(A.runner), ag(A.revoked),
    ]);
    const codexLab = ctxA(A.codex, W.lab);
    want("goal", "goal_fac001_lab_ship");
    svc.createGoal(ana, { workspaceId: W.lab, title: "Ship the fixture release", description: "Synthetic goal for current-work orientation." });
    note("goal", W.lab, "goal_fac001_lab_ship", "active goal (current work)");
    checkpoint(W.lab, "cp01_after_goal");

    // tasks (assignee matrix: caller / other / unassigned / viewer / agent)
    mkTask(W.lab, "task_fac001_lab_inprogress_ana", "Wire the export step", { description: "In progress, assigned to Ana.", assignee: human(H.ana), status: "in_progress", seedCase: "in_progress, assigned human owner" });
    mkTask(W.lab, "task_fac001_lab_blocked_ana", "Unblock signing", { description: "Waiting on a key ceremony.", assignee: human(H.ana), status: "blocked", seedCase: "blocked, description, assigned to owner" });
    mkTask(W.lab, "task_fac001_lab_blocked_ben", "Unblock packaging", { description: "Waiting on a runner.", assignee: human(H.ben), status: "blocked", seedCase: "blocked, description, assigned to member" });
    mkTask(W.lab, "task_fac001_lab_blocked_unassigned_desc", "Unblock docs build", { description: "Needs an owner but context is recorded.", status: "blocked", seedCase: "blocked, description, unassigned" });
    mkTask(W.lab, "task_fac001_lab_blocked_missing_a", "Blocked mystery A", { status: "blocked", seedCase: "blocked, no description, no assignee" });
    mkTask(W.lab, "task_fac001_lab_blocked_assignee_only", "Blocked assignee only", { assignee: human(H.ana), status: "blocked", seedCase: "blocked, no description, assigned to owner" });
    mkTask(W.lab, "task_fac001_lab_open_ana", "Review the changelog", { assignee: human(H.ana), seedCase: "open, assigned to owner" });
    mkTask(W.lab, "task_fac001_lab_open_ben", "Triage inbox", { assignee: human(H.ben), seedCase: "open, assigned to member" });
    mkTask(W.lab, "task_fac001_lab_open_val", "Read the handbook", { assignee: human(H.val), seedCase: "open, assigned to viewer (demotion case)" });
    mkTask(W.lab, "task_fac001_lab_blocked_val", "Blocked on a viewer", { description: "Viewer-assigned blocked work.", assignee: human(H.val), status: "blocked", seedCase: "blocked, description, assigned to viewer" });
    mkTask(W.lab, "task_fac001_lab_open_codex", "Draft the release notes", { assignee: agent(A.codex), seedCase: "open, assigned to agent" });
    mkTask(W.lab, "task_fac001_lab_open_rex", "Check the mirror", { assignee: human(H.rex), seedCase: "open, assigned to the revocable member" });
    mkTask(W.lab, "task_fac001_lab_open_unassigned", "Tidy the board", { seedCase: "open, unassigned (control)" });
    mkTask(W.lab, "task_fac001_lab_completed_ana", "Archive old drafts", { description: "Done.", assignee: human(H.ana), status: "completed", seedCase: "completed, assigned (control)" });
    mkTask(W.lab, "task_fac001_lab_inprogress_unassigned", "Spike the cache", { description: "Exploratory.", status: "in_progress", seedCase: "in_progress, unassigned (control)" });
    mkTask(W.lab, "task_fac001_lab_anchor", "Action anchor", { description: "Anchor for action proposals.", assignee: human(H.ana), status: "in_progress", seedCase: "in_progress anchor for proposals" });
    jump("2026-11-10T09:05:00.000Z");
    mkTask(W.lab, "task_fac001_lab_blocked_missing_b", "Blocked mystery B", { status: "blocked", seedCase: "blocked, no description, no assignee (later timestamp)" });
    checkpoint(W.lab, "cp02_after_tasks");

    // artifacts, findings, decisions
    for (const [n, t] of [["a", "Artifact A"], ["b", "Artifact B"], ["c", "Artifact C"], ["d", "Artifact D"]] as const) mkArtifact(W.lab, `art_fac001_lab_${n}`, t, codexLab);
    mkFinding(W.lab, "find_fac001_lab_current", "Current supported finding", codexLab, "current, to be supported");
    cite(codexLab, "fev_fac001_lab_current_supports", "find_fac001_lab_current", "art_fac001_lab_a", "supports", W.lab, "supports only");
    mkFinding(W.lab, "find_fac001_lab_contradicted", "Current finding with a contradicting artifact", codexLab, "current, contradicted");
    cite(codexLab, "fev_fac001_lab_contradicted_contradicts", "find_fac001_lab_contradicted", "art_fac001_lab_b", "contradicts", W.lab, "explicit contradicts relation");
    mkFinding(W.lab, "find_fac001_lab_contradicted_removed", "Finding whose contradiction was removed", codexLab, "current, contradiction removed (control)");
    cite(codexLab, "fev_fac001_lab_removed_contradicts", "find_fac001_lab_contradicted_removed", "art_fac001_lab_c", "contradicts", W.lab, "contradicts, then removed");
    svc.removeFindingEvidence(codexLab, { evidenceId: "fev_fac001_lab_removed_contradicts" });
    mkFinding(W.lab, "find_fac001_lab_supported_mixed", "Finding with support and contradiction", codexLab, "current, support plus contradiction");
    cite(codexLab, "fev_fac001_lab_mixed_supports", "find_fac001_lab_supported_mixed", "art_fac001_lab_a", "supports", W.lab, "supports");
    cite(codexLab, "fev_fac001_lab_mixed_contradicts", "find_fac001_lab_supported_mixed", "art_fac001_lab_d", "contradicts", W.lab, "contradicts alongside support");

    // three findings that become non-current (two superseded, one withdrawn)
    for (const n of ["s1", "s2", "s3", "s4"] as const) mkFinding(W.lab, `find_fac001_lab_${n}_old`, `Old finding ${n}`, codexLab, "to become superseded");
    mkFinding(W.lab, "find_fac001_lab_w1", "Finding to withdraw", codexLab, "to become withdrawn");
    for (const n of ["s1", "s2", "s3", "s4"] as const) {
      want("finding", `find_fac001_lab_${n}_new`);
      svc.correctFinding(codexLab, { findingId: `find_fac001_lab_${n}_old`, summary: `Corrected finding ${n}`, reason: "fixture correction" });
      note("finding", W.lab, `find_fac001_lab_${n}_new`, "current successor of a superseded finding");
    }
    svc.withdrawFinding(codexLab, { findingId: "find_fac001_lab_w1", reason: "fixture withdrawal" });
    checkpoint(W.lab, "cp03_after_findings");

    // decisions
    mkDecision(W.lab, "dec_fac001_lab_proposed_a", "Adopt the new naming scheme", false, "proposed");
    mkDecision(W.lab, "dec_fac001_lab_proposed_b", "Move the review meeting", false, "proposed (second)");
    mkDecision(W.lab, "dec_fac001_lab_accepted_clean", "Use SQLite for local state", true, "accepted, cites current finding (control)");
    citeDecision(ana, "cit_fac001_lab_clean", "dec_fac001_lab_accepted_clean", "find_fac001_lab_current", W.lab, "cites current finding");
    mkDecision(W.lab, "dec_fac001_lab_accepted_nocite", "Weekly sync on Mondays", true, "accepted, no citation (control)");
    mkDecision(W.lab, "dec_fac001_lab_accepted_removed", "Pin the toolchain", true, "accepted, citation removed (control)");
    citeDecision(ana, "cit_fac001_lab_removed", "dec_fac001_lab_accepted_removed", "find_fac001_lab_s4_old", W.lab, "cites superseded finding, then removed");
    svc.removeDecisionBasis(ana, { citationId: "cit_fac001_lab_removed" });
    mkDecision(W.lab, "dec_fac001_lab_old", "Old retention rule", true, "accepted, then superseded (control)");
    mkDecision(W.lab, "dec_fac001_lab_stale1", "Cache layer choice", true, "accepted, one stale citation");
    jump("2026-11-10T09:10:00.000Z");
    citeDecision(ana, "cit_fac001_lab_stale1_a", "dec_fac001_lab_stale1", "find_fac001_lab_s1_old", W.lab, "cites superseded finding");
    mkDecision(W.lab, "dec_fac001_lab_stale3", "Delivery architecture", true, "accepted, three stale citations (fold)");
    jump("2026-11-10T09:20:00.000Z");
    citeDecision(ana, "cit_fac001_lab_stale3_a", "dec_fac001_lab_stale3", "find_fac001_lab_s2_old", W.lab, "cites superseded finding (earliest trigger)");
    jump("2026-11-10T09:30:00.000Z");
    citeDecision(ana, "cit_fac001_lab_stale3_b", "dec_fac001_lab_stale3", "find_fac001_lab_s3_old", W.lab, "cites superseded finding (middle trigger)");
    jump("2026-11-10T09:40:00.000Z");
    citeDecision(ana, "cit_fac001_lab_stale3_c", "dec_fac001_lab_stale3", "find_fac001_lab_w1", W.lab, "cites withdrawn finding (latest trigger)");
    want("decision", "dec_fac001_lab_new");
    svc.addDecision(ana, { workspaceId: W.lab, summary: "New retention rule", rationale: "fixture rationale", replacesDecisionId: "dec_fac001_lab_old" });
    svc.acceptDecision(ana, "dec_fac001_lab_new", { reason: "fixture replacement" });
    note("decision", W.lab, "dec_fac001_lab_new", "accepted replacement of dec_fac001_lab_old (control)");
    checkpoint(W.lab, "cp04_after_decisions");

    // =========================================================================
    // ws_fac001_trunc : source truncation beyond the per-reason ceiling S = 100
    // =========================================================================
    mkWorkspace(W.trunc, H.ana, "FAC-001 truncation", [hm(H.ben, "member"), ag(A.codex), ag(A.runner)]);
    const codexTrunc = ctxA(A.codex, W.trunc);
    mkArtifact(W.trunc, "art_fac001_trunc_a", "Artifact A", codexTrunc);
    mkFinding(W.trunc, "find_fac001_trunc_current", "Current finding", codexTrunc, "current");
    cite(codexTrunc, "fev_fac001_trunc_supports", "find_fac001_trunc_current", "art_fac001_trunc_a", "supports", W.trunc, "supports");
    mkTask(W.trunc, "task_fac001_trunc_anchor", "Action anchor", { description: "Anchor.", assignee: human(H.ana), status: "in_progress", seedCase: "in_progress anchor" });
    mkTask(W.trunc, "task_fac001_trunc_blocked_ana_1", "Blocked on Ana 1", { description: "Recorded.", assignee: human(H.ana), status: "blocked", seedCase: "blocked, assigned to owner" });
    mkTask(W.trunc, "task_fac001_trunc_blocked_ana_2", "Blocked on Ana 2", { description: "Recorded.", assignee: human(H.ana), status: "blocked", seedCase: "blocked, assigned to owner" });
    mkTask(W.trunc, "task_fac001_trunc_blocked_ben_1", "Blocked on Ben 1", { description: "Recorded.", assignee: human(H.ben), status: "blocked", seedCase: "blocked, assigned to member" });
    mkDecision(W.trunc, "dec_fac001_trunc_proposed", "Truncation-workspace proposal", false, "proposed");
    mkFinding(W.trunc, "find_fac001_trunc_old", "Old finding", codexTrunc, "to become superseded");
    want("finding", "find_fac001_trunc_new");
    svc.correctFinding(codexTrunc, { findingId: "find_fac001_trunc_old", summary: "Corrected finding", reason: "fixture correction" });
    note("finding", W.trunc, "find_fac001_trunc_new", "current successor");
    mkDecision(W.trunc, "dec_fac001_trunc_stale", "Accepted on a superseded finding", true, "accepted, one stale citation");
    citeDecision(ana, "cit_fac001_trunc_stale", "dec_fac001_trunc_stale", "find_fac001_trunc_old", W.trunc, "cites superseded finding");
    for (let i = 1; i <= TRUNC_TASKS; i += 1) {
      const n = String(i).padStart(3, "0");
      mkTask(W.trunc, `task_fac001_trunc_bulk_${n}`, `Bulk blocked ${n}`, { description: "Recorded context.", status: "blocked", seedCase: "blocked, description, unassigned (bulk)" });
    }
    checkpoint(W.trunc, "cp01_after_tasks");
    for (let i = 1; i <= TRUNC_PROPOSALS; i += 1) {
      const n = String(i).padStart(3, "0");
      propose(W.trunc, `actp_fac001_trunc_bulk_${n}`, "task_fac001_trunc_anchor", { findingId: "find_fac001_trunc_current" }, { seedCase: "proposed, unexpired (bulk)" });
    }
    checkpoint(W.trunc, "cp02_after_proposals");

    // =========================================================================
    // ws_fac001_clean : complete workspace with nothing that matches any rule
    // =========================================================================
    mkWorkspace(W.clean, H.ana, "FAC-001 clean", [hm(H.ben, "member"), ag(A.codex)]);
    const codexClean = ctxA(A.codex, W.clean);
    mkArtifact(W.clean, "art_fac001_clean_a", "Artifact A", codexClean);
    mkFinding(W.clean, "find_fac001_clean_current", "Current supported finding", codexClean, "current, support only");
    cite(codexClean, "fev_fac001_clean_supports", "find_fac001_clean_current", "art_fac001_clean_a", "supports", W.clean, "supports");
    mkDecision(W.clean, "dec_fac001_clean_accepted", "Clean accepted decision", true, "accepted, cites current finding");
    citeDecision(ana, "cit_fac001_clean", "dec_fac001_clean_accepted", "find_fac001_clean_current", W.clean, "cites current finding");
    mkTask(W.clean, "task_fac001_clean_completed", "Done work", { description: "Done.", assignee: human(H.ana), status: "completed", seedCase: "completed" });
    mkTask(W.clean, "task_fac001_clean_inprogress", "Quiet work", { description: "Underway.", status: "in_progress", seedCase: "in_progress, unassigned" });
    mkTask(W.clean, "task_fac001_clean_open", "Unclaimed work", { seedCase: "open, unassigned" });
    checkpoint(W.clean, "cp01_complete");

    // =========================================================================
    // ws_fac001_other : second small workspace (leak target); Ben is a member
    // =========================================================================
    mkWorkspace(W.other, H.zed, "FAC-001 other", [hm(H.ben, "member"), ag(A.zedbot), ag(A.zedrunner)]);
    const zed = ctxH(H.zed);
    const botOther = ctxA(A.zedbot, W.other);
    mkArtifact(W.other, "art_fac001_other_a", `Artifact ${SENTINEL_OTHER}`, botOther);
    mkFinding(W.other, "find_fac001_other_old", `Old finding ${SENTINEL_OTHER}`, botOther, "to become superseded");
    want("finding", "find_fac001_other_new");
    svc.correctFinding(botOther, { findingId: "find_fac001_other_old", summary: `Corrected finding ${SENTINEL_OTHER}`, reason: "fixture correction" });
    note("finding", W.other, "find_fac001_other_new", "current successor");
    mkDecision(W.other, "dec_fac001_other_stale", `Accepted decision ${SENTINEL_OTHER}`, true, "accepted, one stale citation", zed);
    citeDecision(zed, "cit_fac001_other_stale", "dec_fac001_other_stale", "find_fac001_other_old", W.other, "cites superseded finding");
    mkDecision(W.other, "dec_fac001_other_proposed", `Proposed decision ${SENTINEL_OTHER}`, false, "proposed", zed);
    mkTask(W.other, "task_fac001_other_blocked_zed", `Blocked ${SENTINEL_OTHER}`, { description: "Sentinel.", assignee: human(H.zed), status: "blocked", seedCase: "blocked, assigned to other-workspace owner", by: zed });
    mkTask(W.other, "task_fac001_other_blocked_ben", `Ben blocked here ${SENTINEL_OTHER}`, { description: "Sentinel.", assignee: human(H.ben), status: "blocked", seedCase: "blocked, assigned to a member who also belongs to the lab", by: zed });
    mkTask(W.other, "task_fac001_other_missing", `Missing context ${SENTINEL_OTHER}`, { status: "blocked", seedCase: "blocked, no description, no assignee", by: zed });
    mkTask(W.other, "task_fac001_other_anchor", "Action anchor", { description: "Anchor.", assignee: human(H.zed), status: "in_progress", seedCase: "in_progress anchor", by: zed });
    {
      const p = propose(W.other, "actp_fac001_other_proposed", "task_fac001_other_anchor", { artifactId: "art_fac001_other_a" }, { seedCase: "proposed, unexpired", proposer: A.zedbot, executor: A.zedrunner });
      void p;
      const u = propose(W.other, "actp_fac001_other_unknown", "task_fac001_other_anchor", { artifactId: "art_fac001_other_a" }, { seedCase: "submission_unknown", proposer: A.zedbot, executor: A.zedrunner });
      drive(W.other, "actp_fac001_other_unknown", u, "submission_unknown", H.zed, A.zedrunner);
    }
    checkpoint(W.other, "cp01_complete");

    // =========================================================================
    // closed workspaces (completed, archived): proposals seeded while active
    // =========================================================================
    for (const [ws, status, tag] of [[W.closed, "completed", "closed"], [W.archived, "archived", "archived"]] as const) {
      mkWorkspace(ws, H.ana, `FAC-001 ${tag}`, [hm(H.ben, "member"), hm(H.val, "viewer"), ag(A.codex), ag(A.runner)]);
      const cx = ctxA(A.codex, ws);
      mkArtifact(ws, `art_fac001_${tag}_a`, "Artifact A", cx);
      mkTask(ws, `task_fac001_${tag}_anchor`, "Action anchor", { description: "Anchor.", assignee: human(H.ana), status: "in_progress", seedCase: "in_progress anchor" });
      mkTask(ws, `task_fac001_${tag}_blocked_ana`, "Blocked on Ana", { description: "Recorded.", assignee: human(H.ana), status: "blocked", seedCase: "blocked, assigned to owner (workspace later closed)" });
      const pp = propose(ws, `actp_fac001_${tag}_proposed`, `task_fac001_${tag}_anchor`, { artifactId: `art_fac001_${tag}_a` }, { seedCase: "proposed (workspace later closed)" });
      void pp;
      const uu = propose(ws, `actp_fac001_${tag}_unknown`, `task_fac001_${tag}_anchor`, { artifactId: `art_fac001_${tag}_a` }, { seedCase: "submission_unknown (workspace later closed)" });
      drive(ws, `actp_fac001_${tag}_unknown`, uu, "submission_unknown", H.ana);
      checkpoint(ws, "cp01_before_close");
      svc.updateWorkspace(ana, { workspaceId: ws, status });
      checkpoint(ws, "cp02_after_close");
    }

    // Review item 1 (key v3): an agent-assigned blocked task WITH context, so it is
    // not blocked_task_missing_context; it exercises the F12 `you` audience for an
    // agent (assigned_blocked_task) and team_blocked_task for everyone else. It is
    // written after the closed/archived workspaces (no other workspace's timestamps
    // move) and before the lab proposal block, so it lies in the (cp04, cp05] interval.
    mkTask(W.lab, "task_fac001_lab_blocked_codex", "Blocked on the agent", { description: "Agent-assigned blocked work with recorded context.", assignee: agent(A.codex), status: "blocked", seedCase: "blocked, description, assigned to agent (F12 you-audience case)" });

    // =========================================================================
    // lab action proposals (written last: expiries are relative to this block)
    // =========================================================================
    jump("2026-11-10T10:00:00.000Z");
    const lab = W.lab;
    const anchor = "task_fac001_lab_anchor";
    propose(lab, "actp_fac001_lab_proposed_fresh", anchor, { findingId: "find_fac001_lab_current" }, { seedCase: "proposed, default 24h expiry" });
    propose(lab, "actp_fac001_lab_proposed_expiring_a", anchor, { findingId: "find_fac001_lab_current" }, { expiresAt: EXPIRY_A, seedCase: `proposed, expires ${EXPIRY_A}` });
    propose(lab, "actp_fac001_lab_proposed_expiring_b", anchor, { findingId: "find_fac001_lab_current" }, { expiresAt: EXPIRY_B, seedCase: `proposed, expires ${EXPIRY_B}` });
    propose(lab, "actp_fac001_lab_proposed_by_opencode", anchor, { findingId: "find_fac001_lab_current" }, { proposer: A.opencode, seedCase: "proposed by the second agent" });
    const ctl = (id: string, upTo: Driven, seedCase: string): void => {
      const p = propose(lab, id, anchor, { findingId: "find_fac001_lab_current" }, { seedCase });
      drive(lab, id, p, upTo, H.ana);
    };
    ctl("actp_fac001_lab_approved", "approved", "approved, not dispatched (control)");
    ctl("actp_fac001_lab_reserved", "dispatch_reserved", "dispatch_reserved (control)");
    ctl("actp_fac001_lab_accepted", "submission_accepted", "submission_accepted (control)");
    ctl("actp_fac001_lab_failed", "submission_failed", "submission_failed, definite (control)");
    ctl("actp_fac001_lab_reconciled", "reconciled", "unknown then reconciled_accepted (control)");
    ctl("actp_fac001_lab_unknown_1", "submission_unknown", "submission_unknown");
    ctl("actp_fac001_lab_unknown_2", "submission_unknown", "submission_unknown (second)");
    {
      const r = propose(lab, "actp_fac001_lab_rejected", anchor, { findingId: "find_fac001_lab_current" }, { seedCase: "rejected (control)" });
      svc.review_action(ana, { workspaceId: lab, proposalId: "actp_fac001_lab_rejected", revision: r.revision, intentDigest: r.digest, decision: "reject", reason: "fixture rejection", requestKey: "actp_fac001_lab_rejected-reject" });
      const c = propose(lab, "actp_fac001_lab_cancelled", anchor, { findingId: "find_fac001_lab_current" }, { seedCase: "cancelled by owner (control)" });
      svc.cancel_action(ana, { workspaceId: lab, proposalId: "actp_fac001_lab_cancelled", revision: c.revision, intentDigest: c.digest, reason: "fixture cancel", requestKey: "actp_fac001_lab_cancelled-cancel" });
    }
    checkpoint(W.lab, "cp05_after_proposals");

    // ---- revocation at seed time (static revoked-token probe) -------------------
    svc.revokeToken(ana, tokens[A.revoked]!);
    tokenStates[A.revoked] = "revoked_at_seed";

    const endClock = new Date(nowMs).toISOString();
    if (Date.parse(endClock) >= Date.parse(READ_CLOCKS.T1_before_any_expiry)) throw new Error(`seed ended ${endClock}, after T1`);
    if (wanted.length > 0) throw new Error(`unconsumed queued ids: ${wanted.map((w) => w.id).join(",")}`);

    // ---- manifest (oracle input: ids, roles, token states; no expected cues) ----
    const actorsList = [
      { id: H.ana, type: "human", label: "owner human (action:review holder, owner of lab/trunc/clean/closed/archived)", ownerHuman: null },
      { id: H.ben, type: "human", label: "member human (no owner role; also member of ws_fac001_other)", ownerHuman: null },
      { id: H.val, type: "human", label: "viewer-role human with an assigned task (lab, closed, archived)", ownerHuman: null },
      { id: H.rex, type: "human", label: "member human whose token is revoked mid-traversal by a staging script", ownerHuman: null },
      { id: H.nia, type: "human", label: "non-participant everywhere", ownerHuman: null },
      { id: H.zed, type: "human", label: "owner of ws_fac001_other only (participant of ANOTHER workspace; non-participant in lab)", ownerHuman: null },
      { id: A.codex, type: "agent", label: "registered agent, proposer", ownerHuman: H.ana },
      { id: A.opencode, type: "agent", label: "registered agent in lab only (Ben's)", ownerHuman: H.ben },
      { id: A.runner, type: "agent", label: "registered agent, designated executor", ownerHuman: H.ana },
      { id: A.revoked, type: "agent", label: "participant agent whose token was revoked at seed time", ownerHuman: H.ana },
      { id: A.ghost, type: "agent", label: "owned agent that participates in no workspace", ownerHuman: H.ana },
      { id: A.zedbot, type: "agent", label: "agent of the other workspace (proposer)", ownerHuman: H.zed },
      { id: A.zedrunner, type: "agent", label: "agent of the other workspace (executor)", ownerHuman: H.zed },
    ].map((a) => ({ ...a, tokenState: tokenStates[a.id] ?? (a.id === H.rex ? "live_at_seed; revoked in scenario S07" : "live_at_seed") }));

    const workspacesOut = Object.values(W).map((id) => {
      const ws = store.getWorkspace(id)!;
      return {
        id,
        name: ws.name,
        status: ws.status,
        participants: store.listParticipants(id).map((p) => ({ actorId: p.actor.actorId, actorType: p.actor.actorType, role: p.role, joinedAt: p.joinedAt })),
        contributionTip: store.maxAppendPosition(id),
        checkpoints: checkpoints[id] ?? {},
      };
    });

    const read = (r: RecordEntry): Record<string, unknown> => {
      const base: Record<string, unknown> = { id: r.id, kind: r.kind, workspaceId: r.workspaceId, seedCase: r.seedCase };
      const ws = r.workspaceId;
      const reader = ws === W.other ? zed : ana;
      switch (r.kind) {
        case "task": {
          const t = svc.getTaskInWorkspace(reader, ws, r.id);
          return { ...base, status: t.status, assignee: t.assignee ?? null, descriptionPresent: typeof t.description === "string" && t.description.trim().length > 0, createdAt: t.createdAt, updatedAt: t.updatedAt };
        }
        case "decision": {
          const d = svc.getDecisionInWorkspace(reader, ws, r.id);
          return { ...base, status: d.status, createdAt: d.createdAt, updatedAt: d.updatedAt, citations: (d.citations ?? []).map((c) => ({ id: c.id, findingId: c.findingId, createdAt: c.createdAt })) };
        }
        case "finding": {
          const f = svc.getFindingInWorkspace(reader, ws, r.id);
          return { ...base, currentness: f.currentness, createdAt: f.createdAt, evidence: (f.evidence ?? []).map((e) => ({ id: e.id, artifactId: e.artifactId, relation: e.relation, createdAt: e.createdAt })) };
        }
        case "artifact": {
          const a = svc.getArtifactInWorkspace(reader, ws, r.id);
          return { ...base, createdAt: a.createdAt };
        }
        case "action_proposal": {
          const v = svc.get_action_proposal(reader, { workspaceId: ws, proposalId: r.id });
          const rc = v.latestReceipt;
          return { ...base, status: v.proposal.status, revision: v.proposal.revision, taskId: v.proposal.taskId, executor: v.proposal.executor, expiresAt: v.proposal.expiresAt, createdAt: v.proposal.createdAt, updatedAt: v.proposal.updatedAt, latestReceipt: rc === undefined ? null : { id: rc.id, outcome: rc.outcome, recordedAt: rc.recordedAt } };
        }
        default:
          return base;
      }
    };
    const recordsOut = records.filter((r) => ["task", "decision", "finding", "artifact", "action_proposal", "goal"].includes(r.kind)).map(read);
    // Oracle input for catch-up (key v3): one row per lab contribution (id, objectType,
    // objectId, append position). It records what was written, not any expected result.
    const contributionsOut = store.listContributions(W.lab)
      .map((c) => ({ id: c.id, workspaceId: c.workspaceId, objectType: c.objectType, objectId: c.objectId, position: c.appendPosition }))
      .sort((a, b) => a.position - b.position);
    const manifest = {
      schema: "fac-001-fixture-manifest/2",
      provenance: "FIXTURE ONLY. Synthetic seed facts: ids, roles, token states, workspaces, record states and timestamps. Contains no expected cues, order, coverage, counts or results; the answer key is authored separately from the frozen contract.",
      contract: "docs/Campfire-FAC-001-Deterministic-Facilitation.md (FROZEN 2026-11-11, Amendment 1 applied 2026-11-11)",
      seedClock: { base: SEED_BASE_ISO, step: "+1s per write", end: endClock },
      readClocks: READ_CLOCKS,
      proposalExpiries: { a: EXPIRY_A, b: EXPIRY_B, defaultTtl: "24h after creation" },
      counts: { truncTasks: TRUNC_TASKS, truncProposals: TRUNC_PROPOSALS, note: "Chosen above the contract's per-reason scan ceiling S = 100 (MAX_PAGE_SIZE), which Amendment 1 (CS-15) froze; 105 blocked tasks and 103 proposed proposals each exceed it." },
      sentinel: SENTINEL_OTHER,
      organizationId: "org_fac001",
      teamId: TEAM,
      actors: actorsList,
      sessions,
      workspaces: workspacesOut,
      records: recordsOut,
      contributions: contributionsOut,
    };
    return { databasePath, manifest, tokens };
  } finally {
    store.close();
  }
}

/** One record per line keeps the committed manifest reviewable and diff-stable. */
export function serializeManifest(manifest: unknown): string {
  const m = manifest as Record<string, unknown>;
  const lines: string[] = ["{"];
  const keys = Object.keys(m);
  keys.forEach((key, i) => {
    const value = m[key];
    const comma = i < keys.length - 1 ? "," : "";
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
      lines.push(`  ${JSON.stringify(key)}: [`);
      value.forEach((item, j) => lines.push(`    ${JSON.stringify(item)}${j < value.length - 1 ? "," : ""}`));
      lines.push(`  ]${comma}`);
    } else {
      lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)}${comma}`);
    }
  });
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

function collectIds(manifest: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk);
    else if (typeof v === "string") ids.add(v);
  };
  walk(manifest);
  return ids;
}

function main(): void {
  const argv = process.argv.slice(2);
  const flag = (name: string): boolean => argv.includes(name);
  const outIdx = argv.indexOf("--out");
  const outDir = outIdx >= 0 ? (isAbsolute(argv[outIdx + 1]!) ? argv[outIdx + 1]! : resolve(argv[outIdx + 1]!)) : mkdtempSync(join(tmpdir(), "fac001-"));
  mkdirSync(outDir, { recursive: true });
  const databasePath = join(outDir, "campfire.db");
  if (existsSync(databasePath)) throw new Error(`${databasePath} exists; use a fresh --out`);
  const built = buildFixture(databasePath);
  const text = serializeManifest(built.manifest);
  writeFileSync(join(outDir, "manifest.json"), text);
  writeFileSync(join(outDir, "tokens.json"), `${JSON.stringify(built.tokens)}\n`, { mode: 0o600 });
  const committed = join(HERE, "manifest.json");
  if (flag("--write-manifest")) writeFileSync(committed, text);
  if (flag("--check")) {
    if (readFileSync(committed, "utf8") !== text) throw new Error("manifest.json differs from a fresh seed");
    const ids = collectIds(JSON.parse(text) as Record<string, unknown>);
    // The staged scenarios live under docs/evidence (private, not exported); skip when absent (public snapshot).
    const scenariosPath = resolve(HERE, "../../../docs/evidence/fac-001/step-0/scenarios.json");
    if (existsSync(scenariosPath)) {
      const scenarios = JSON.parse(readFileSync(scenariosPath, "utf8")) as { referencedIds?: string[] };
      const missing = (scenarios.referencedIds ?? []).filter((id) => !ids.has(id));
      if (missing.length > 0) throw new Error(`scenarios.json cites ids absent from the manifest: ${missing.join(", ")}`);
    }
  }
  const digest = createHash("sha256").update(text).digest("hex");
  console.log(JSON.stringify({ out: outDir, manifestSha256: digest, tokensFile: "tokens.json (0600, random, not for commit)" }));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
