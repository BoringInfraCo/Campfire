/**
 * ARH-001 artifact-reference handoff fixture (contract §3.1 fixture / §5 D1–D6).
 *
 * FIXTURE EVIDENCE — calibrates the frozen key; cannot establish Gate B, C, or E.
 *
 * Builds the frozen deterministic scenario for
 * `docs/Campfire-v1.21-ARH-001-Artifact-Reference-Handoff.md` §3.1: three
 * workspaces, three humans, two owned agents on different harnesses. Both the
 * id source and the clock are deterministic, so re-running into a fresh output
 * directory produces byte-identical serves and dumps. Raw actor tokens are
 * random by construction (`mintToken` uses WebCrypto); only the token values
 * and their stored hashes differ between runs, they never appear in the
 * served-state dumps, and the key excludes them. The raw database also varies
 * in `schema_migrations.applied_at` (wall-clock), which is invisible to the
 * dumps and the key.
 *
 *   npx tsx fixtures/artifact-handoff/arh-001/seed.ts [--out <dir>] [--force]
 *
 * Default output: `fixtures/artifact-handoff/arh-001/.tmp/served` (gitignored;
 * no database is committed). `tokens.json` is written mode 0600 for the local
 * trace runbook; the evidence docs and answer key never carry tokens.
 *
 * Keyed facts always verified before the seed writes its receipt (contract §3.1):
 * - lab `ws_arh001_lab`: artifacts 7/7 complete (the cited report ranks first);
 *   the exact stored `uriOrPath` for all seven reference classes; tasks 6/6,
 *   findings 3/3, decisions 5/5 complete; `find_arh001_current` carries
 *   `sourceArtifactId = art_arh001_safe_output`; the two evidence relations
 *   (`supports` / `contradicts`) with their pinned ids; accepted/needsReview/
 *   superseded decision states and `historicalCounts` exactly as served.
 * - trunc `ws_arh001_trunc_artifacts`: 12 artifacts, 10 returned, truncated,
 *   with `nextCursor`; `art_arh001_beyond_page` (no finding link, oldest
 *   creation) sorts beyond the returned page; the linked artifact stays inside
 *   the returned page.
 * - unrelated `ws_arh001_unrelated`: the sentinel string lives only there and
 *   never crosses into an authorized read; Zed (not a lab member) is denied a
 *   lab read through the real authorization error path with no lab facts in
 *   the error.
 * - both agents are registered on the lab workspace with their actual harness
 *   values (`opencode` for Ana's agent, `codex` for Ben's agent) and each has a
 *   registered session, so an agent-authored finding carries session provenance.
 */
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeArtifactUri } from "../../../src/domain/artifacts.js";
import { ID_PREFIXES, createId, type IdKind, type IdSource } from "../../../src/domain/ids.js";
import type { ActorRef, ArtifactType, ParticipantRole } from "../../../src/domain/types.js";
import type { ActorContext } from "../../../src/service/authorization.js";
import { createCampfireService } from "../../../src/service/campfire-service.js";
import type { AttentionItem, CampfireService, WorkspaceContext } from "../../../src/service/service.js";
import { openSqliteStore } from "../../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../../src/store/store.js";

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(FIXTURE_DIR, ".tmp", "served");

/** Fixed seed clock. Every write advances by one second. */
export const SEED_BASE_ISO = "2026-10-16T16:00:00.000Z";
const SEED_BASE_MS = Date.parse(SEED_BASE_ISO);
const CLOCK_STEP_MS = 1000;

/**
 * Frozen read clock for `dump.ts`. Sits after every seed timestamp, so the
 * served-state dumps are byte-identical across two fresh seeds instead of
 * differing only in `generatedAt`.
 */
export const SERVED_AT = "2026-10-16T18:00:00.000Z";

/** Exact string planted only in the unauthorized workspace's finding. */
export const UNRELATED_FINDING_SENTINEL = "UNRELATED_FINDING_SENTINEL_arh001_do_not_leak";

function fillerIds(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(2, "0")}`);
}

/** Frozen scenario ids. The answer key and dump script cite these exact values. */
export const SCENARIO = {
  organizationId: "org_arh001",
  teamId: "team_arh001",
  humans: { ana: "hum_arh001_ana", ben: "hum_arh001_ben", zed: "hum_arh001_zed" },
  // Ana's agent runs on opencode; Ben's agent runs on codex. Two distinct
  // engineers and two distinct harnesses are what contract §6 requires; the
  // harness value is asserted on both the agent identity and its session.
  agents: { opencode: "agt_arh001_opencode", codex: "agt_arh001_codex" },
  agentSessions: { opencode: "ses_arh001_opencode", codex: "ses_arh001_codex" },
  workspaces: {
    lab: "ws_arh001_lab",
    truncArtifacts: "ws_arh001_trunc_artifacts",
    unrelated: "ws_arh001_unrelated",
  },
  workspaceNames: {
    lab: "ARH-001 artifact handoff lab",
    truncArtifacts: "ARH-001 truncated artifacts",
    unrelated: "ARH-001 unrelated",
  },
  goal: { lab: "goal_arh001_handoff" },
  artifacts: {
    safeOutput: "art_arh001_safe_output",
    safeOldReport: "art_arh001_safe_old_report",
    stale: "art_arh001_stale",
    path: "art_arh001_path",
    insecureScheme: "art_arh001_insecure_scheme",
    credentialed: "art_arh001_credentialed",
    hostileMarkup: "art_arh001_hostile_markup",
    // Truncation workspace. `beyond_page` is the keyed beyond-the-page case:
    // no finding links it and it is the oldest creation, so ARTIFACT_RANK_SQL
    // plus the created_at DESC keyset pushes it past the 10-item page.
    truncBeyondPage: "art_arh001_beyond_page",
    truncOlder: "art_arh001_trunc_older",
    truncLinked: "art_arh001_trunc_linked",
  },
  findings: {
    labCurrent: "find_arh001_current",
    labSuperseded: "find_arh001_superseded",
    labSupersededFix: "find_arh001_superseded_fix",
    labContradicts: "find_arh001_contradicts",
    truncLinked: "find_arh001_trunc",
    unrelatedSentinel: "find_arh001_unrelated_sentinel",
  },
  evidence: {
    currentSupportsSafeOutput: "fev_arh001_current_supports",
    contradictsStale: "fev_arh001_contradicts_stale",
  },
  citations: {
    currentBasis: "cit_arh001_current_basis",
    reviewBasis: "cit_arh001_review_basis",
  },
  decisions: {
    current: "dec_arh001_current",
    review: "dec_arh001_review",
    competingA: "dec_arh001_competing_a",
    competingB: "dec_arh001_competing_b",
    old: "dec_arh001_old",
    new: "dec_arh001_new",
  },
  tasks: {
    followup: "task_arh001_followup",
    verifyChain: "task_arh001_verify_chain",
    waitingAccess: "task_arh001_waiting_access",
    workingNotes: "task_arh001_working_notes",
    archiveDraft: "task_arh001_archive_draft",
    wrapUp: "task_arh001_wrap_up",
  },
} as const;

const TRUNC_FILLER_IDS = fillerIds("art_arh001_trunc_filler_", 9);

/** Unknown workspace id used for the wrong-workspace denial capture. */
export const UNKNOWN_WORKSPACE_ID = "ws_arh001_unknown";

/**
 * The seven lab reference classes. `input` is what the seed writes;
 * `storedUriOrPath` is what `normalizeArtifactUri` must produce and what the
 * dump and the key cite. Any scheme except `file:` is stored verbatim;
 * relative paths are kept; `~` and absolute paths outside cwd are rejected.
 */
const LAB_ARTIFACTS: ReadonlyArray<{
  id: string;
  type: ArtifactType;
  title: string;
  input: string;
  storedUriOrPath: string;
  metadata?: Record<string, unknown>;
}> = [
  {
    id: SCENARIO.artifacts.safeOutput,
    type: "report",
    title: "Q3 handoff analysis (external report)",
    input: "https://example.com/arh-001/q3-handoff-analysis.html",
    storedUriOrPath: "https://example.com/arh-001/q3-handoff-analysis.html",
    metadata: { period: "2026-Q3", source: "external-reporting" },
  },
  {
    id: SCENARIO.artifacts.safeOldReport,
    type: "report",
    title: "Q3 handoff analysis (external report) — earlier draft",
    input: "https://example.com/arh-001/q3-handoff-analysis-draft.html",
    storedUriOrPath: "https://example.com/arh-001/q3-handoff-analysis-draft.html",
  },
  {
    id: SCENARIO.artifacts.stale,
    type: "deployment",
    title: "Preview deployment (stale)",
    input: "https://example.com/arh-001/deployments/old-preview",
    storedUriOrPath: "https://example.com/arh-001/deployments/old-preview",
    metadata: { environment: "preview", note: "superseded" },
  },
  {
    id: SCENARIO.artifacts.path,
    type: "document",
    title: "Local working notes",
    input: "reports/arh-001/working-notes.md",
    storedUriOrPath: "reports/arh-001/working-notes.md",
  },
  {
    id: SCENARIO.artifacts.insecureScheme,
    type: "file",
    title: "Legacy FTP archive",
    input: "ftp://files.example.com/arh-001/export.tar.gz",
    storedUriOrPath: "ftp://files.example.com/arh-001/export.tar.gz",
  },
  {
    id: SCENARIO.artifacts.credentialed,
    type: "other",
    title: "Protected analytics view",
    input: "https://arh001-demo-user:arh001-demo-pass@example.com/arh-001/private-view",
    storedUriOrPath: "https://arh001-demo-user:arh001-demo-pass@example.com/arh-001/private-view",
  },
  {
    id: SCENARIO.artifacts.hostileMarkup,
    type: "other",
    title: 'Report <script>alert(1)</script>',
    input: 'https://example.com/arh-001/report"><img src=x onerror=alert(1)>',
    storedUriOrPath: 'https://example.com/arh-001/report"><img src=x onerror=alert(1)>',
  },
];

/** Creation order. Artifact pages order by rank then created_at DESC. */
const LAB_ARTIFACT_PAGE_ORDER = [
  SCENARIO.artifacts.safeOutput, // rank 0: the only artifact cited by a finding
  SCENARIO.artifacts.hostileMarkup,
  SCENARIO.artifacts.credentialed,
  SCENARIO.artifacts.insecureScheme,
  SCENARIO.artifacts.path,
  SCENARIO.artifacts.stale,
  SCENARIO.artifacts.safeOldReport,
] as const;

const PLANNED: Partial<Record<IdKind, string[]>> = {
  human: [SCENARIO.humans.ana, SCENARIO.humans.ben, SCENARIO.humans.zed],
  agent: [SCENARIO.agents.opencode, SCENARIO.agents.codex],
  workspace: [SCENARIO.workspaces.lab, SCENARIO.workspaces.truncArtifacts, SCENARIO.workspaces.unrelated],
  goal: [SCENARIO.goal.lab],
  agentSession: [SCENARIO.agentSessions.opencode, SCENARIO.agentSessions.codex],
  // Creation order pins each reference class. The lab list is the §3.1 set:
  // safe HTTPS, similar/historical, stale/denied, inert path, non-HTTPS,
  // credential-bearing, hostile markup.
  artifact: [
    SCENARIO.artifacts.safeOutput,
    SCENARIO.artifacts.safeOldReport,
    SCENARIO.artifacts.stale,
    SCENARIO.artifacts.path,
    SCENARIO.artifacts.insecureScheme,
    SCENARIO.artifacts.credentialed,
    SCENARIO.artifacts.hostileMarkup,
    // Truncation workspace: beyond-page pair first (oldest creations), then
    // the nine returned fillers, then the finding-linked artifact last.
    SCENARIO.artifacts.truncBeyondPage,
    SCENARIO.artifacts.truncOlder,
    ...TRUNC_FILLER_IDS,
    SCENARIO.artifacts.truncLinked,
  ],
  // Creation order fixes the `correct_finding` successor: the second queued
  // id is consumed by the correction of the first.
  finding: [
    SCENARIO.findings.labSuperseded,
    SCENARIO.findings.labSupersededFix,
    SCENARIO.findings.labCurrent,
    SCENARIO.findings.labContradicts,
    SCENARIO.findings.truncLinked,
    SCENARIO.findings.unrelatedSentinel,
  ],
  findingEvidence: [SCENARIO.evidence.currentSupportsSafeOutput, SCENARIO.evidence.contradictsStale],
  decisionCitation: [SCENARIO.citations.currentBasis, SCENARIO.citations.reviewBasis],
  // Accept order = creation order = ascending updatedAt, so the returned page
  // is [new, competing_b, competing_a, review, current] newest-first.
  decision: [
    SCENARIO.decisions.current,
    SCENARIO.decisions.review,
    SCENARIO.decisions.competingA,
    SCENARIO.decisions.competingB,
    SCENARIO.decisions.old,
    SCENARIO.decisions.new,
  ],
  task: [
    SCENARIO.tasks.followup,
    SCENARIO.tasks.verifyChain,
    SCENARIO.tasks.waitingAccess,
    SCENARIO.tasks.workingNotes,
    SCENARIO.tasks.archiveDraft,
    SCENARIO.tasks.wrapUp,
  ],
};

function fail(message: string): never {
  throw new Error(`arh-001 seed: ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** Assert an error message carries none of the listed forbidden facts. */
function assertNoLeak(text: string, forbidden: readonly string[], message: string): void {
  for (const fragment of forbidden) {
    assert(!text.includes(fragment), `${message}: leaked "${fragment}"`);
  }
}

function queueSource(): { source: IdSource; assertEmpty: () => void } {
  const pending: Partial<Record<IdKind, string[]>> = {};
  for (const [kind, ids] of Object.entries(PLANNED) as Array<[IdKind, string[]]>) pending[kind] = [...ids];
  let spare = 0;
  return {
    source: (kind) => {
      const pinned = pending[kind]?.shift();
      if (pinned !== undefined) return pinned;
      spare += 1;
      return createId(kind, () => `${ID_PREFIXES[kind]}_arh001_${String(spare).padStart(4, "0")}`);
    },
    assertEmpty: () => {
      for (const [kind, ids] of Object.entries(pending)) {
        if (ids.length !== 0) fail(`unused ${kind} ids: ${ids.join(", ")}`);
      }
    },
  };
}

function seedClock(): { tick: () => string; next: () => string } {
  let current = SEED_BASE_MS;
  return {
    tick: () => {
      const value = new Date(current).toISOString();
      current += CLOCK_STEP_MS;
      return value;
    },
    next: () => new Date(current).toISOString(),
  };
}

function human(id: string): ActorContext {
  return { actor: { actorId: id, actorType: "human" } };
}

function agent(id: string, agentSessionId?: string): ActorContext {
  return agentSessionId === undefined
    ? { actor: { actorId: id, actorType: "agent" } }
    : { actor: { actorId: id, actorType: "agent" }, agentSessionId };
}

const ANA_REF: ActorRef = { actorId: SCENARIO.humans.ana, actorType: "human" };
const BEN_REF: ActorRef = { actorId: SCENARIO.humans.ben, actorType: "human" };
const CODEX_REF: ActorRef = { actorId: SCENARIO.agents.codex, actorType: "agent" };
const OPENCODE_REF: ActorRef = { actorId: SCENARIO.agents.opencode, actorType: "agent" };

export interface ScenarioTokens {
  ana: string;
  ben: string;
  zed: string;
  opencode: string;
  codex: string;
}

/** Ana invites and the named actor consumes the invite. Ids stay deterministic. */
function inviteAndJoin(
  service: CampfireService,
  anaCtx: ActorContext,
  workspaceId: string,
  entries: ReadonlyArray<[ActorRef, ParticipantRole]>,
): void {
  for (const [actor, role] of entries) {
    service.inviteToWorkspace(anaCtx, { workspaceId, actor, role });
    service.joinWorkspace(
      actor.actorType === "human" ? human(actor.actorId) : agent(actor.actorId),
      { workspaceId },
    );
  }
}

/**
 * Lab artifacts: the seven §3.1 reference classes in creation order. The stored
 * `uriOrPath` is asserted against `normalizeArtifactUri` and against the pinned
 * literal so the key can cite the exact stored string.
 */
function seedLabArtifacts(service: CampfireService, anaCtx: ActorContext): void {
  const lab = SCENARIO.workspaces.lab;
  for (const artifact of LAB_ARTIFACTS) {
    // The expected stored value must be exactly what the domain normalizer
    // produces. Proving it here means the key never guesses.
    assertEqual(
      normalizeArtifactUri(artifact.input),
      artifact.storedUriOrPath,
      `normalizer output for ${artifact.id}`,
    );
    const created = service.addArtifact(anaCtx, {
      workspaceId: lab,
      type: artifact.type,
      title: artifact.title,
      uriOrPath: artifact.input,
      ...(artifact.metadata === undefined ? {} : { metadata: artifact.metadata }),
    });
    assertEqual(created.id, artifact.id, `lab artifact id ${artifact.id}`);
  }
}

function seedLab(
  service: CampfireService,
  anaCtx: ActorContext,
  opencodeCtx: ActorContext,
  codexCtx: ActorContext,
): void {
  const lab = SCENARIO.workspaces.lab;

  // --- Artifacts: seven reference classes ------------------------------------
  seedLabArtifacts(service, anaCtx);

  // --- Findings: superseded pair, the current chain source, a contradiction --
  // The original reading is corrected through the real COR-001 path: the old
  // text stays in place, a successor row records the reason, and citations to
  // the old row become needsReview at read time.
  service.addFinding(anaCtx, {
    workspaceId: lab,
    summary: "The Q3 handoff analysis is an internal dashboard export.",
    detail: "Read from the preview deployment page during the first pass.",
  });
  service.correctFinding(anaCtx, {
    findingId: SCENARIO.findings.labSuperseded,
    summary: "The Q3 handoff analysis is an external report, not an internal export.",
    detail: "The stored reference points at an external site; the internal dashboard does not carry this report.",
    reason: "The first reading confused the external report with the internal dashboard export.",
  });

  // Agent A (opencode) records the current finding and its supports relation —
  // the recorded chain the handoff depends on. The agent writes through its
  // registered session so provenance shows which session produced the record.
  service.addFinding(opencodeCtx, {
    workspaceId: lab,
    summary: "The recorded Q3 handoff analysis reference points outside Campfire.",
    detail: "Campfire stores the reference only; the external system owns the report bytes and its access rules.",
    sourceArtifactId: SCENARIO.artifacts.safeOutput,
  });
  const supports = service.citeFindingEvidence(opencodeCtx, {
    findingId: SCENARIO.findings.labCurrent,
    artifactId: SCENARIO.artifacts.safeOutput,
    relation: "supports",
    note: "external report is the recorded source",
  });
  assertEqual(supports.id, SCENARIO.evidence.currentSupportsSafeOutput, "supports evidence id");

  // Agent B (codex) records the contradicting relation against the stale
  // deployment reference, so the lab carries evidence from both harnesses.
  service.addFinding(codexCtx, {
    workspaceId: lab,
    summary: "The old preview deployment no longer matches the handoff analysis.",
    detail: "The deployment reference is stale and must not be offered as the handoff source.",
  });
  const contradicts = service.citeFindingEvidence(codexCtx, {
    findingId: SCENARIO.findings.labContradicts,
    artifactId: SCENARIO.artifacts.stale,
    relation: "contradicts",
    note: "stale preview contradicts the current source",
  });
  assertEqual(contradicts.id, SCENARIO.evidence.contradictsStale, "contradicts evidence id");

  // --- Decisions: the recorded chain, a review row, competing pair, history ---
  service.addDecision(anaCtx, {
    workspaceId: lab,
    summary: "Treat the Q3 handoff report as the recorded source for the follow-up work.",
    rationale: "Agent A recorded the finding against the external report reference; the citation chain is the handoff.",
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.current);
  const currentBasis = service.citeDecisionBasis(anaCtx, {
    decisionId: SCENARIO.decisions.current,
    findingId: SCENARIO.findings.labCurrent,
    note: "recorded source chain",
  });
  assertEqual(currentBasis.id, SCENARIO.citations.currentBasis, "current basis citation id");

  /** Cites the superseded finding; stays accepted and needsReview at read time. */
  service.addDecision(anaCtx, {
    workspaceId: lab,
    summary: "The handoff needs no second source: the Q3 report covers the period.",
    rationale: "Accepted while the lab believed the report was an internal export.",
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.review);
  const reviewBasis = service.citeDecisionBasis(anaCtx, {
    decisionId: SCENARIO.decisions.review,
    findingId: SCENARIO.findings.labSuperseded,
    note: "original reading",
  });
  assertEqual(reviewBasis.id, SCENARIO.citations.reviewBasis, "review basis citation id");

  // Competing accepted pair: conflicting rationales, no recorded transition.
  // Decision safety requires the reader to surface the conflict, not to pick.
  service.addDecision(anaCtx, {
    workspaceId: lab,
    summary: "Open the external report from the stored reference when the recipient is ready.",
    rationale: "A deliberate open keeps the recipient inside their own authority.",
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.competingA);
  service.addDecision(anaCtx, {
    workspaceId: lab,
    summary: "Keep every external reference inert and hand off by copying the stored URI.",
    rationale: "Manual copying keeps Campfire out of the navigation path.",
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.competingB);

  // Historical pair: created as a proposal, accepted, then replaced by an
  // explicit accepted replacement with a recorded reason (the only path that
  // records `predecessorId` on the replacement). dec_arh001_old ends
  // superseded, excluded from the orientation decisions slice.
  service.addDecision(anaCtx, {
    workspaceId: lab,
    summary: "Route handoff questions through the weekly recap thread.",
    rationale: "A recurring recap was assumed to be the safest transfer.",
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.old);
  service.addDecision(anaCtx, {
    workspaceId: lab,
    summary: "Replace the recap thread with the recorded artifact reference chain.",
    rationale: "The stored reference and its recorded evidence replace the private recap.",
    replacesDecisionId: SCENARIO.decisions.old,
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.new, {
    reason: "The ARH-001 contract replaces the weekly recap; the recorded reference chain is the handoff source.",
  });

  // --- Tasks: ordinary work context around the handoff ----------------------
  const tasks: Array<[string, string, ActorRef | undefined]> = [
    // The follow-up touchpoint: open and assigned to Ben's agent, so Agent B's
    // orientation surfaces it under needsYou and a suggested next action.
    [SCENARIO.tasks.followup, "Follow up on the Q3 handoff analysis reference", CODEX_REF],
    [SCENARIO.tasks.verifyChain, "Verify the recorded evidence chain before handoff", undefined],
    [SCENARIO.tasks.waitingAccess, "Confirm the recipient's access to the external report", ANA_REF],
    [SCENARIO.tasks.workingNotes, "Draft the handoff checklist from the stored references", undefined],
    [SCENARIO.tasks.archiveDraft, "Archive the earlier draft reference", undefined],
    [SCENARIO.tasks.wrapUp, "Close the ARH-001 lab setup", undefined],
  ];
  for (const [id, title, assignee] of tasks) {
    const created = service.createTask(anaCtx, {
      workspaceId: lab,
      title,
      ...(assignee === undefined ? {} : { assignee }),
    });
    assertEqual(created.id, id, `lab task id ${id}`);
  }
  service.updateTask(anaCtx, { taskId: SCENARIO.tasks.verifyChain, status: "completed" });
  service.updateTask(anaCtx, { taskId: SCENARIO.tasks.waitingAccess, status: "blocked" });
  service.updateTask(anaCtx, { taskId: SCENARIO.tasks.workingNotes, status: "in_progress" });
  service.updateTask(anaCtx, { taskId: SCENARIO.tasks.wrapUp, status: "completed" });
}

/**
 * 12 artifacts: one cited (rank 0) artifact and eleven uncited ones. The two
 * oldest uncited artifacts fall beyond the default 10-item artifacts page;
 * `art_arh001_beyond_page` is the oldest, so it sorts last and can never leak
 * into the returned page while the rank and recency rules are unchanged.
 */
function seedTruncArtifacts(service: CampfireService, anaCtx: ActorContext): void {
  const workspaceId = SCENARIO.workspaces.truncArtifacts;
  const beyond = service.addArtifact(anaCtx, {
    workspaceId,
    type: "log",
    title: "Archived intake log (earliest)",
    uriOrPath: "https://example.com/arh-001/archive/intake-0001.log",
  });
  assertEqual(beyond.id, SCENARIO.artifacts.truncBeyondPage, "beyond-page artifact id");
  const older = service.addArtifact(anaCtx, {
    workspaceId,
    type: "log",
    title: "Archived intake log (second)",
    uriOrPath: "https://example.com/arh-001/archive/intake-0002.log",
  });
  assertEqual(older.id, SCENARIO.artifacts.truncOlder, "second beyond-page artifact id");
  for (const [index, id] of TRUNC_FILLER_IDS.entries()) {
    const created = service.addArtifact(anaCtx, {
      workspaceId,
      type: "document",
      title: `Truncation filler ${String(index + 1).padStart(2, "0")}`,
      uriOrPath: `https://example.com/arh-001/trunc/filler-${String(index + 1).padStart(2, "0")}.md`,
    });
    assertEqual(created.id, id, `trunc filler artifact id ${id}`);
  }
  const linked = service.addArtifact(anaCtx, {
    workspaceId,
    type: "document",
    title: "Truncation runbook (returned page source)",
    uriOrPath: "references/arh-001/trunc/runbook.md",
  });
  assertEqual(linked.id, SCENARIO.artifacts.truncLinked, "linked artifact id");

  // The one recorded link keeps its artifact on the returned page (rank 0),
  // while the keyed beyond-page artifact stays uncited and out of the page.
  service.addFinding(anaCtx, {
    workspaceId,
    summary: "The truncation runbook is the recorded source for the page-boundary check.",
    detail: "Linked to the artifact that stays inside the returned page.",
    sourceArtifactId: SCENARIO.artifacts.truncLinked,
  });
}

function seedScenario(service: CampfireService): ScenarioTokens {
  const anaCtx = human(SCENARIO.humans.ana);
  const benCtx = human(SCENARIO.humans.ben);
  const zedCtx = human(SCENARIO.humans.zed);

  // --- Identities -----------------------------------------------------------
  const ana = service.createHuman(undefined, { teamId: SCENARIO.teamId, displayName: "Ana" });
  const ben = service.createHuman(anaCtx, { teamId: SCENARIO.teamId, displayName: "Ben" });
  const zed = service.createHuman(anaCtx, { teamId: SCENARIO.teamId, displayName: "Zed" });
  assertEqual(ana.human.id, SCENARIO.humans.ana, "Ana id");
  assertEqual(ben.human.id, SCENARIO.humans.ben, "Ben id");
  assertEqual(zed.human.id, SCENARIO.humans.zed, "Zed id");
  // Owners create their own agents; harness is the vendor-neutral string the
  // contract's two-harness requirement is keyed on.
  const opencode = service.createAgent(anaCtx, {
    teamId: SCENARIO.teamId,
    humanId: ana.human.id,
    name: "OpenCode",
    harness: "opencode",
  });
  const codex = service.createAgent(benCtx, {
    teamId: SCENARIO.teamId,
    humanId: ben.human.id,
    name: "Codex",
    harness: "codex",
  });
  assertEqual(opencode.agent.id, SCENARIO.agents.opencode, "OpenCode id");
  assertEqual(codex.agent.id, SCENARIO.agents.codex, "Codex id");

  // --- Workspace 1: the handoff lab -----------------------------------------
  const lab = service.createWorkspace(anaCtx, {
    teamId: SCENARIO.teamId,
    name: SCENARIO.workspaceNames.lab,
  });
  assertEqual(lab.id, SCENARIO.workspaces.lab, "lab workspace id");
  const goal = service.createGoal(anaCtx, {
    workspaceId: lab.id,
    title: "Hand the recorded Q3 artifact reference chain to a second teammate and their agent.",
    description: "Two humans and two owned agents share one lab while the ARH-001 artifact reference boundary is frozen.",
  });
  assertEqual(goal.id, SCENARIO.goal.lab, "lab goal id");
  inviteAndJoin(service, anaCtx, lab.id, [
    [BEN_REF, "member"],
    [CODEX_REF, "agent"],
    [OPENCODE_REF, "agent"],
  ]);
  // One registered session per agent: a write through an agent identity needs
  // a session so provenance can name the session (AGENTS.md invariant 5).
  const opencodeSession = service.registerAgentSession(agent(SCENARIO.agents.opencode), {
    agentId: SCENARIO.agents.opencode,
    workspaceId: lab.id,
    harness: "opencode",
  });
  assertEqual(opencodeSession.id, SCENARIO.agentSessions.opencode, "opencode session id");
  const codexSession = service.registerAgentSession(agent(SCENARIO.agents.codex), {
    agentId: SCENARIO.agents.codex,
    workspaceId: lab.id,
    harness: "codex",
  });
  assertEqual(codexSession.id, SCENARIO.agentSessions.codex, "codex session id");
  seedLab(
    service,
    anaCtx,
    agent(SCENARIO.agents.opencode, opencodeSession.id),
    agent(SCENARIO.agents.codex, codexSession.id),
  );

  // --- Workspace 2: truncated artifacts page --------------------------------
  const truncArtifacts = service.createWorkspace(anaCtx, {
    teamId: SCENARIO.teamId,
    name: SCENARIO.workspaceNames.truncArtifacts,
  });
  assertEqual(truncArtifacts.id, SCENARIO.workspaces.truncArtifacts, "trunc workspace id");
  inviteAndJoin(service, anaCtx, truncArtifacts.id, [[BEN_REF, "member"]]);
  seedTruncArtifacts(service, anaCtx);

  // --- Workspace 3: unrelated, owned by Zed only ----------------------------
  // Ana and Ben are deliberately not members: this is the D1 boundary case.
  const unrelated = service.createWorkspace(zedCtx, {
    teamId: SCENARIO.teamId,
    name: SCENARIO.workspaceNames.unrelated,
  });
  assertEqual(unrelated.id, SCENARIO.workspaces.unrelated, "unrelated workspace id");
  service.addFinding(zedCtx, {
    workspaceId: unrelated.id,
    summary: `Old signing key retired before the replica flush. ${UNRELATED_FINDING_SENTINEL}`,
    detail: "Never returned to a non-participant; the denial must not leak this workspace.",
  });

  return {
    ana: ana.token,
    ben: ben.token,
    zed: zed.token,
    opencode: opencode.token,
    codex: codex.token,
  };
}

function attentionSummary(items: readonly AttentionItem[]): Array<{ reason: string; id: string }> {
  return items.map((item) => ({ reason: item.reason, id: item.id }));
}

function decisionItem(context: WorkspaceContext, id: string) {
  const item = context.slices.decisions.items.find((decision) => decision.id === id);
  assert(item !== undefined, `decision ${id} outside the returned orientation page`);
  return item;
}

function sliceFacts(slice: { total: number; returned: number; truncated: boolean; nextCursor?: string }): {
  total: number;
  returned: number;
  truncated: boolean;
  nextCursorPresent: boolean;
} {
  return {
    total: slice.total,
    returned: slice.returned,
    truncated: slice.truncated,
    nextCursorPresent: slice.nextCursor !== undefined,
  };
}

interface CapturedDenial {
  name: string;
  code?: string;
  message: string;
}

/** Capture the real typed error surface of a denied read. */
function captureDenial(action: () => unknown, message: string): CapturedDenial {
  try {
    action();
  } catch (error) {
    const name = error instanceof Error ? error.name : typeof error;
    const code =
      error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
    const text = error instanceof Error ? error.message : String(error);
    return { name, ...(code === undefined ? {} : { code }), message: text };
  }
  return fail(message);
}

/**
 * Verify the served projection matches the frozen scenario before returning.
 * Every keyed fact from the contract's fixture scope is checked here, so a
 * drifting fixture fails the seed instead of silently producing a wrong key.
 */
function verifyScenario(service: CampfireService, store: CampfireStore): Record<string, unknown> {
  const anaCtx = human(SCENARIO.humans.ana);
  const benCtx = human(SCENARIO.humans.ben);
  const zedCtx = human(SCENARIO.humans.zed);
  const opencodeCtx = agent(SCENARIO.agents.opencode);
  const codexCtx = agent(SCENARIO.agents.codex);
  const lab = SCENARIO.workspaces.lab;
  const trunc = SCENARIO.workspaces.truncArtifacts;
  const unrelated = SCENARIO.workspaces.unrelated;

  // --- Lab: page coverage ----------------------------------------------------
  const labAna = service.getWorkspaceContext(anaCtx, lab);
  const labBen = service.getWorkspaceContext(benCtx, lab);
  const labCodex = service.getWorkspaceContext(codexCtx, lab);
  const labOpencode = service.getWorkspaceContext(opencodeCtx, lab);

  assertEqual(labAna.slices.artifacts.total, 7, "lab artifact total");
  assertEqual(labAna.slices.artifacts.returned, 7, "lab artifact returned");
  assertEqual(labAna.slices.artifacts.truncated, false, "lab artifact truncated");
  const labArtifactIds = labAna.slices.artifacts.items.map((artifact) => artifact.id);
  assertEqual(labArtifactIds, [...LAB_ARTIFACT_PAGE_ORDER], "lab artifact page order (cited report first)");

  assertEqual(labAna.slices.tasks.total, 6, "lab task total");
  assertEqual(labAna.slices.tasks.returned, 6, "lab task returned");
  assertEqual(labAna.slices.tasks.truncated, false, "lab task truncated");
  assertEqual(
    labAna.slices.tasks.items.map((task) => task.id),
    [
      SCENARIO.tasks.waitingAccess,
      SCENARIO.tasks.workingNotes,
      SCENARIO.tasks.archiveDraft,
      SCENARIO.tasks.followup,
      SCENARIO.tasks.wrapUp,
      SCENARIO.tasks.verifyChain,
    ],
    "lab task page order",
  );
  const followup = labAna.slices.tasks.items.find((task) => task.id === SCENARIO.tasks.followup);
  assert(followup !== undefined, "follow-up task outside the returned page");
  assertEqual(followup.status, "open", "follow-up task status");
  assertEqual(followup.assignee, CODEX_REF, "follow-up task assignee (Ben's agent)");

  assertEqual(labAna.slices.findings.total, 3, "lab current finding total");
  assertEqual(labAna.slices.findings.returned, 3, "lab current finding returned");
  assertEqual(labAna.slices.findings.truncated, false, "lab current finding truncated");
  assertEqual(
    labAna.slices.findings.items.map((finding) => finding.id),
    [SCENARIO.findings.labCurrent, SCENARIO.findings.labContradicts, SCENARIO.findings.labSupersededFix],
    "lab current finding page order",
  );

  assertEqual(labAna.slices.decisions.total, 5, "lab decision total");
  assertEqual(labAna.slices.decisions.returned, 5, "lab decision returned");
  assertEqual(labAna.slices.decisions.truncated, false, "lab decision truncated");
  const labDecisionIds = labAna.slices.decisions.items.map((decision) => decision.id);
  assertEqual(
    labDecisionIds,
    [
      SCENARIO.decisions.new,
      SCENARIO.decisions.competingB,
      SCENARIO.decisions.competingA,
      SCENARIO.decisions.review,
      SCENARIO.decisions.current,
    ],
    "lab decision page order",
  );
  assert(!labDecisionIds.includes(SCENARIO.decisions.old), "superseded decision replayed in orientation");
  assertEqual(labAna.historicalCounts, { findings: 1, decisions: 1 }, "lab historical counts");
  assertEqual(labAna.supersededDecisions, [], "orientation does not replay superseded decisions");

  // Authorized readers see the same source facts (D1): Ana and Ben share every
  // slice id list; the caller-specific attention lists are asserted separately.
  for (const slice of ["artifacts", "tasks", "findings", "decisions"] as const) {
    assertEqual(
      labBen.slices[slice].items.map((item) => item.id),
      labAna.slices[slice].items.map((item) => item.id),
      `lab ${slice} slice parity between Ana and Ben`,
    );
  }

  // --- Lab: exact stored uriOrPath per reference class -----------------------
  const storedUriOrPath: Record<string, string> = {};
  const artifactTypes: Record<string, string> = {};
  for (const expected of LAB_ARTIFACTS) {
    const artifact = service.getArtifactInWorkspace(anaCtx, lab, expected.id);
    assertEqual(artifact.type, expected.type, `stored artifact type ${expected.id}`);
    assertEqual(artifact.uriOrPath, expected.storedUriOrPath, `stored uriOrPath ${expected.id}`);
    storedUriOrPath[expected.id] = artifact.uriOrPath;
    artifactTypes[expected.id] = artifact.type;
  }
  assertEqual(
    service.getArtifactInWorkspace(anaCtx, lab, SCENARIO.artifacts.safeOutput).metadata,
    { period: "2026-Q3", source: "external-reporting" },
    "safe output metadata",
  );
  assertEqual(
    service.getArtifactInWorkspace(anaCtx, lab, SCENARIO.artifacts.stale).metadata,
    { environment: "preview", note: "superseded" },
    "stale artifact metadata",
  );
  assertEqual(
    service.getArtifactInWorkspace(anaCtx, lab, SCENARIO.artifacts.hostileMarkup).title,
    'Report <script>alert(1)</script>',
    "hostile markup title stored verbatim",
  );

  // --- Lab: recorded finding chain -------------------------------------------
  const currentFinding = labAna.slices.findings.items.find((finding) => finding.id === SCENARIO.findings.labCurrent);
  assert(currentFinding !== undefined, "current finding outside the returned page");
  assertEqual(currentFinding.sourceArtifactId, SCENARIO.artifacts.safeOutput, "current finding source artifact");
  assertEqual(currentFinding.currentness, "current", "current finding currentness");
  assertEqual(currentFinding.createdBy, OPENCODE_REF, "current finding creator (Ana's agent)");
  assertEqual(currentFinding.agentSessionId, SCENARIO.agentSessions.opencode, "current finding session");
  assertEqual(currentFinding.evidence?.length, 1, "current finding evidence count");
  const supportsRow = currentFinding.evidence![0]!;
  assertEqual(supportsRow.id, SCENARIO.evidence.currentSupportsSafeOutput, "supports evidence id");
  assertEqual(supportsRow.relation, "supports", "supports evidence relation");
  assertEqual(supportsRow.artifactId, SCENARIO.artifacts.safeOutput, "supports evidence artifact");
  assertEqual(supportsRow.findingId, SCENARIO.findings.labCurrent, "supports evidence finding");

  const contradictsFinding = labAna.slices.findings.items.find(
    (finding) => finding.id === SCENARIO.findings.labContradicts,
  );
  assert(contradictsFinding !== undefined, "contradicts finding outside the returned page");
  assertEqual(contradictsFinding.evidence?.length, 1, "contradicts finding evidence count");
  const contradictsRow = contradictsFinding.evidence![0]!;
  assertEqual(contradictsRow.id, SCENARIO.evidence.contradictsStale, "contradicts evidence id");
  assertEqual(contradictsRow.relation, "contradicts", "contradicts evidence relation");
  assertEqual(contradictsRow.artifactId, SCENARIO.artifacts.stale, "contradicts evidence artifact");
  assertEqual(contradictsFinding.createdBy, CODEX_REF, "contradicts finding creator (Ben's agent)");
  assertEqual(contradictsFinding.agentSessionId, SCENARIO.agentSessions.codex, "contradicts finding session");

  const supersededOriginal = service.getFindingInWorkspace(anaCtx, lab, SCENARIO.findings.labSuperseded);
  assertEqual(supersededOriginal.currentness, "superseded", "superseded finding currentness");
  assertEqual(supersededOriginal.successorId, SCENARIO.findings.labSupersededFix, "superseded finding successor");
  assertEqual(
    supersededOriginal.summary,
    "The Q3 handoff analysis is an internal dashboard export.",
    "superseded finding text is not rewritten (COR-001)",
  );
  assert(
    typeof supersededOriginal.correctionReason === "string" && supersededOriginal.correctionReason.length > 0,
    "superseded finding correction reason",
  );
  const supersededFix = service.getFindingInWorkspace(anaCtx, lab, SCENARIO.findings.labSupersededFix);
  assertEqual(supersededFix.currentness, "current", "fix finding currentness");
  assertEqual(supersededFix.predecessorId, SCENARIO.findings.labSuperseded, "fix finding predecessor");

  // --- Lab: decision states, citations, and lifecycle ------------------------
  const currentDecision = decisionItem(labAna, SCENARIO.decisions.current);
  assertEqual(currentDecision.status, "accepted", "current decision status");
  assertEqual(currentDecision.needsReview, undefined, "current decision needsReview");
  assertEqual(currentDecision.needsReviewFindingIds, undefined, "current decision review ids");
  assertEqual(currentDecision.citations?.[0]?.id, SCENARIO.citations.currentBasis, "current decision citation id");
  assertEqual(currentDecision.citations?.[0]?.findingId, SCENARIO.findings.labCurrent, "current decision cited finding");

  const reviewDecision = decisionItem(labAna, SCENARIO.decisions.review);
  assertEqual(reviewDecision.status, "accepted", "review decision status");
  assertEqual(reviewDecision.needsReview, true, "review decision needsReview");
  assertEqual(
    reviewDecision.needsReviewFindingIds,
    [SCENARIO.findings.labSuperseded],
    "review decision review finding ids",
  );
  assertEqual(reviewDecision.citations?.[0]?.id, SCENARIO.citations.reviewBasis, "review decision citation id");
  assertEqual(reviewDecision.citations?.[0]?.findingId, SCENARIO.findings.labSuperseded, "review decision cited finding");

  assertEqual(decisionItem(labAna, SCENARIO.decisions.competingA).status, "accepted", "competing A status");
  assertEqual(decisionItem(labAna, SCENARIO.decisions.competingB).status, "accepted", "competing B status");

  const oldRow = service.getDecisionInWorkspace(anaCtx, lab, SCENARIO.decisions.old);
  assertEqual(oldRow.status, "superseded", "old decision status");
  assertEqual(oldRow.successorId, SCENARIO.decisions.new, "old decision successor");
  assert(typeof oldRow.supersedeReason === "string" && oldRow.supersedeReason.length > 0, "old supersede reason");
  const newRow = service.getDecisionInWorkspace(anaCtx, lab, SCENARIO.decisions.new);
  assertEqual(newRow.status, "accepted", "new decision status");
  assertEqual(newRow.predecessorId, SCENARIO.decisions.old, "new decision predecessor");

  // --- Lab: attention touchpoints --------------------------------------------
  // The follow-up touchpoint: Agent B's orientation surfaces the assigned open
  // task under needsYou and as the rule-based next action.
  assertEqual(
    attentionSummary(labCodex.needsYou),
    [{ reason: "assigned_open_task", id: SCENARIO.tasks.followup }],
    "codex needsYou",
  );
  assertEqual(labCodex.suggestedNextAction.kind, "task", "codex next action kind");
  assertEqual(labCodex.suggestedNextAction.id, SCENARIO.tasks.followup, "codex next action id");
  assertEqual(labCodex.suggestedNextAction.reason, "assigned_open_task", "codex next action reason");
  const reviewCue = labAna.needsAttention.find((item) => item.id === SCENARIO.decisions.review);
  assert(reviewCue !== undefined, "review decision missing from Ana's team attention");
  assertEqual(reviewCue.reason, "accepted_decision_needs_review", "review cue reason");
  assertEqual(reviewCue.needsReviewFindingIds, [SCENARIO.findings.labSuperseded], "review cue finding ids");
  assertEqual(labOpencode.needsYou.length, 0, "opencode needsYou");

  // --- Lab: identities, harnesses, sessions ----------------------------------
  assertEqual(
    store
      .listParticipants(lab)
      .map((row) => row.actor.actorId)
      .sort(),
    [SCENARIO.humans.ana, SCENARIO.humans.ben, SCENARIO.agents.codex, SCENARIO.agents.opencode].sort(),
    "lab participant set",
  );
  assertEqual(store.getAgent(SCENARIO.agents.opencode)?.harness, "opencode", "opencode harness");
  assertEqual(store.getAgent(SCENARIO.agents.codex)?.harness, "codex", "codex harness");
  assertEqual(store.getAgent(SCENARIO.agents.opencode)?.humanId, SCENARIO.humans.ana, "opencode owner");
  assertEqual(store.getAgent(SCENARIO.agents.codex)?.humanId, SCENARIO.humans.ben, "codex owner");
  const opencodeSessionRow = store.getAgentSession(SCENARIO.agentSessions.opencode);
  assertEqual(opencodeSessionRow?.harness, "opencode", "opencode session harness");
  assertEqual(opencodeSessionRow?.workspaceId, lab, "opencode session workspace");
  const codexSessionRow = store.getAgentSession(SCENARIO.agentSessions.codex);
  assertEqual(codexSessionRow?.harness, "codex", "codex session harness");
  assertEqual(codexSessionRow?.workspaceId, lab, "codex session workspace");

  // --- Trunc: bounded artifacts page -----------------------------------------
  const truncAna = service.getWorkspaceContext(anaCtx, trunc);
  const truncBen = service.getWorkspaceContext(benCtx, trunc);
  assertEqual(truncAna.slices.artifacts.total, 12, "trunc artifact total");
  assertEqual(truncAna.slices.artifacts.returned, 10, "trunc artifact returned");
  assertEqual(truncAna.slices.artifacts.truncated, true, "trunc artifact truncated");
  assert(
    typeof truncAna.slices.artifacts.nextCursor === "string" && truncAna.slices.artifacts.nextCursor.length > 0,
    "trunc artifact nextCursor missing",
  );
  const truncArtifactIds = truncAna.slices.artifacts.items.map((artifact) => artifact.id);
  assertEqual(
    truncArtifactIds,
    [SCENARIO.artifacts.truncLinked, ...[...TRUNC_FILLER_IDS].reverse()],
    "trunc artifact page order (cited artifact first, then newest uncited)",
  );
  assert(
    !truncArtifactIds.includes(SCENARIO.artifacts.truncBeyondPage),
    "beyond-page artifact appeared inside the returned page",
  );
  assert(
    !truncArtifactIds.includes(SCENARIO.artifacts.truncOlder),
    "second beyond-page artifact appeared inside the returned page",
  );
  assertEqual(
    truncBen.slices.artifacts.items.map((artifact) => artifact.id),
    truncArtifactIds,
    "trunc artifact slice parity between Ana and Ben",
  );
  const truncFinding = service.getFindingInWorkspace(anaCtx, trunc, SCENARIO.findings.truncLinked);
  assertEqual(truncFinding.sourceArtifactId, SCENARIO.artifacts.truncLinked, "trunc finding source artifact");
  assert(
    truncArtifactIds.includes(truncFinding.sourceArtifactId!),
    "trunc finding links an artifact outside the returned page",
  );

  // --- Unrelated: the sentinel stays inside its own workspace ----------------
  const unrelatedZed = service.getWorkspaceContext(zedCtx, unrelated);
  assertEqual(unrelatedZed.slices.findings.total, 1, "unrelated finding total");
  assert(
    unrelatedZed.slices.findings.items[0]?.summary.includes(UNRELATED_FINDING_SENTINEL) === true,
    "unrelated sentinel missing from its own workspace",
  );
  assertEqual(
    store.listParticipants(unrelated).map((row) => row.actor.actorId),
    [SCENARIO.humans.zed],
    "unrelated workspace participant set",
  );
  for (const context of [labAna, labBen, labCodex, labOpencode, truncAna, truncBen]) {
    assert(!JSON.stringify(context).includes(UNRELATED_FINDING_SENTINEL), "unrelated sentinel leaked into an authorized context");
  }

  // --- Denials: authorization precedes projection (D1) -----------------------
  const zedLabRead = captureDenial(
    () => service.getWorkspaceContext(zedCtx, lab),
    "Zed was allowed to read the lab workspace",
  );
  assertEqual(zedLabRead.name, "ParticipantRequired", "Zed lab denial error name");
  assertEqual(zedLabRead.code, "ParticipantRequired", "Zed lab denial error code");
  assertNoLeak(
    zedLabRead.message,
    [
      SCENARIO.workspaceNames.lab,
      "Hand the recorded Q3 artifact reference chain",
      "Q3 handoff analysis",
      "https://",
      "ftp://",
      "reports/arh-001",
    ],
    "Zed lab denial",
  );

  const anaUnrelatedRead = captureDenial(
    () => service.getWorkspaceContext(anaCtx, unrelated),
    "Ana was allowed to read the unrelated workspace",
  );
  assertEqual(anaUnrelatedRead.name, "ParticipantRequired", "Ana unrelated denial error name");
  assertEqual(anaUnrelatedRead.code, "ParticipantRequired", "Ana unrelated denial error code");
  assertNoLeak(
    anaUnrelatedRead.message,
    [UNRELATED_FINDING_SENTINEL, "Token rotation", SCENARIO.workspaceNames.unrelated, "Zed"],
    "Ana unrelated denial",
  );

  const anaUnknownRead = captureDenial(
    () => service.getWorkspaceContext(anaCtx, UNKNOWN_WORKSPACE_ID),
    "Ana was allowed to read an unknown workspace",
  );
  assertEqual(anaUnknownRead.name, "WorkspaceNotFound", "unknown workspace error name");
  assertEqual(anaUnknownRead.code, "WorkspaceNotFound", "unknown workspace error code");

  // Wrong-workspace object id: the trunc artifact id through the lab route.
  // The error names only the caller-supplied id; nothing from the other
  // workspace crosses the boundary.
  const anaWrongWorkspaceArtifact = captureDenial(
    () => service.getArtifactInWorkspace(anaCtx, lab, SCENARIO.artifacts.truncLinked),
    "Ana was allowed to read a cross-workspace artifact id",
  );
  assertEqual(anaWrongWorkspaceArtifact.name, "ArtifactNotFound", "wrong-workspace artifact error name");
  assertEqual(anaWrongWorkspaceArtifact.code, "ArtifactNotFound", "wrong-workspace artifact error code");
  assertNoLeak(
    anaWrongWorkspaceArtifact.message,
    [SCENARIO.workspaceNames.truncArtifacts, "Truncation runbook", "references/arh-001"],
    "wrong-workspace artifact denial",
  );

  return {
    provenance: "FIXTURE EVIDENCE — cannot establish Gate B, C, or E.",
    lab: {
      artifacts: {
        ...sliceFacts(labAna.slices.artifacts),
        returnedIds: labArtifactIds,
        storedUriOrPath,
        artifactTypes,
        citedArtifactRanksFirst: labArtifactIds[0] === SCENARIO.artifacts.safeOutput,
      },
      tasks: {
        ...sliceFacts(labAna.slices.tasks),
        followup: {
          id: SCENARIO.tasks.followup,
          status: followup.status,
          assignee: followup.assignee,
        },
      },
      findings: {
        ...sliceFacts(labAna.slices.findings),
        current: {
          id: SCENARIO.findings.labCurrent,
          sourceArtifactId: currentFinding.sourceArtifactId,
          createdBy: currentFinding.createdBy,
          agentSessionId: currentFinding.agentSessionId,
          evidence: [
            {
              id: supportsRow.id,
              relation: supportsRow.relation,
              artifactId: supportsRow.artifactId,
              findingId: supportsRow.findingId,
            },
          ],
        },
        contradicts: {
          id: SCENARIO.findings.labContradicts,
          createdBy: contradictsFinding.createdBy,
          agentSessionId: contradictsFinding.agentSessionId,
          evidence: [
            {
              id: contradictsRow.id,
              relation: contradictsRow.relation,
              artifactId: contradictsRow.artifactId,
              findingId: contradictsRow.findingId,
            },
          ],
        },
        superseded: {
          id: SCENARIO.findings.labSuperseded,
          successorId: supersededOriginal.successorId,
          textPreserved: supersededOriginal.summary === "The Q3 handoff analysis is an internal dashboard export.",
          correctionReason: supersededOriginal.correctionReason,
          fixId: supersededFix.id,
          fixPredecessorId: supersededFix.predecessorId,
        },
      },
      decisions: {
        ...sliceFacts(labAna.slices.decisions),
        returnedIds: labDecisionIds,
        states: [
          {
            id: SCENARIO.decisions.current,
            status: currentDecision.status,
            needsReview: currentDecision.needsReview === true,
            citationId: currentDecision.citations?.[0]?.id,
            citedFindingId: currentDecision.citations?.[0]?.findingId,
          },
          {
            id: SCENARIO.decisions.review,
            status: reviewDecision.status,
            needsReview: reviewDecision.needsReview === true,
            needsReviewFindingIds: reviewDecision.needsReviewFindingIds ?? [],
            citationId: reviewDecision.citations?.[0]?.id,
            citedFindingId: reviewDecision.citations?.[0]?.findingId,
          },
          { id: SCENARIO.decisions.competingA, status: "accepted" },
          { id: SCENARIO.decisions.competingB, status: "accepted" },
          {
            id: SCENARIO.decisions.old,
            status: oldRow.status,
            successorId: oldRow.successorId,
            supersedeReason: oldRow.supersedeReason,
          },
          {
            id: SCENARIO.decisions.new,
            status: newRow.status,
            predecessorId: newRow.predecessorId,
          },
        ],
        historicalCounts: labAna.historicalCounts,
        supersededDecisionsInOrientation: labAna.supersededDecisions.length,
      },
      attention: {
        codexNeedsYou: attentionSummary(labCodex.needsYou),
        codexNextAction: {
          kind: labCodex.suggestedNextAction.kind,
          id: labCodex.suggestedNextAction.id,
          reason: labCodex.suggestedNextAction.reason,
        },
        anaReviewCue: {
          id: reviewCue.id,
          reason: reviewCue.reason,
          needsReviewFindingIds: reviewCue.needsReviewFindingIds ?? [],
        },
        anaNeedsAttention: attentionSummary(labAna.needsAttention),
        benNeedsAttention: attentionSummary(labBen.needsAttention),
      },
      participants: store
        .listParticipants(lab)
        .map((row) => ({ actorId: row.actor.actorId, actorType: row.actor.actorType, role: row.role })),
      agents: {
        opencode: { id: SCENARIO.agents.opencode, harness: "opencode", humanId: SCENARIO.humans.ana },
        codex: { id: SCENARIO.agents.codex, harness: "codex", humanId: SCENARIO.humans.ben },
      },
      sessions: {
        opencode: {
          id: opencodeSessionRow?.id,
          workspaceId: opencodeSessionRow?.workspaceId,
          harness: opencodeSessionRow?.harness,
        },
        codex: {
          id: codexSessionRow?.id,
          workspaceId: codexSessionRow?.workspaceId,
          harness: codexSessionRow?.harness,
        },
      },
    },
    trunc: {
      artifacts: {
        ...sliceFacts(truncAna.slices.artifacts),
        returnedIds: truncArtifactIds,
        beyondPageAbsent: !truncArtifactIds.includes(SCENARIO.artifacts.truncBeyondPage),
        secondBeyondPageAbsent: !truncArtifactIds.includes(SCENARIO.artifacts.truncOlder),
        findingLinkedArtifactId: truncFinding.sourceArtifactId,
        findingLinkedArtifactReturned: truncArtifactIds.includes(truncFinding.sourceArtifactId!),
      },
    },
    unrelated: {
      sentinelInOwnWorkspace: true,
      sentinelInAuthorizedReads: false,
      participantCount: store.listParticipants(unrelated).length,
    },
    denials: [
      { case: "zed-reads-lab-context", ...zedLabRead },
      { case: "ana-reads-unrelated-context", ...anaUnrelatedRead },
      { case: "ana-reads-unknown-workspace", ...anaUnknownRead },
      { case: "ana-reads-trunc-artifact-through-lab", ...anaWrongWorkspaceArtifact },
    ],
  };
}

function keyIdMap(): Record<string, unknown> {
  return {
    organization: SCENARIO.organizationId,
    team: SCENARIO.teamId,
    humans: SCENARIO.humans,
    agents: SCENARIO.agents,
    agentSessions: SCENARIO.agentSessions,
    workspaces: SCENARIO.workspaces,
    workspaceNames: SCENARIO.workspaceNames,
    goal: SCENARIO.goal.lab,
    artifacts: SCENARIO.artifacts,
    findings: SCENARIO.findings,
    evidence: SCENARIO.evidence,
    citations: SCENARIO.citations,
    decisions: SCENARIO.decisions,
    tasks: SCENARIO.tasks,
    unrelatedSentinel: UNRELATED_FINDING_SENTINEL,
    unknownWorkspaceId: UNKNOWN_WORKSPACE_ID,
  };
}

export interface SeedReceipt {
  databasePath: string;
  workspaces: typeof SCENARIO.workspaces;
  seedClock: { base: string; final: string; servedAt: string };
  deterministic: { ids: string; clock: string; tokens: string };
  keyIds: Record<string, unknown>;
  verification: Record<string, unknown>;
}

export interface SeedResult {
  databasePath: string;
  tokensPath: string;
  receiptPath: string;
  tokens: ScenarioTokens;
  receipt: SeedReceipt;
}

function seedAt(databasePath: string): SeedReceipt & { tokens: ScenarioTokens } {
  const queued = queueSource();
  const { tick, next } = seedClock();
  const store = openSqliteStore(databasePath);
  const service = createCampfireService({ store, idSource: queued.source, clock: tick });
  try {
    const now = tick();
    store.createOrganization({ id: SCENARIO.organizationId, name: "Boring Infra Co. fixture", createdAt: now });
    store.createTeam({
      id: SCENARIO.teamId,
      organizationId: SCENARIO.organizationId,
      name: "Engineering fixture",
      createdAt: tick(),
    });
    const tokens = seedScenario(service);
    queued.assertEmpty();
    const verification = verifyScenario(service, store);
    return {
      databasePath,
      workspaces: SCENARIO.workspaces,
      seedClock: { base: SEED_BASE_ISO, final: next(), servedAt: SERVED_AT },
      deterministic: {
        ids: "pinned+sequential",
        clock: "fixed base, +1s per write",
        tokens: "random by construction; excluded from dumps and key",
      },
      keyIds: keyIdMap(),
      verification,
      tokens,
    };
  } finally {
    service.close();
  }
}

export function seedDatabase(outDir: string, force: boolean): SeedResult {
  const databasePath = resolve(outDir, "campfire.db");
  const tokensPath = resolve(outDir, "tokens.json");
  const receiptPath = resolve(outDir, "seed-receipt.json");
  if (!force && [databasePath, tokensPath, receiptPath].some(existsSync)) {
    fail(`seed already exists at ${outDir}; pass --force to replace it`);
  }
  mkdirSync(outDir, { recursive: true });
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`, tokensPath, receiptPath]) {
    if (existsSync(path)) rmSync(path);
  }
  const seeded = seedAt(databasePath);
  const { tokens, ...receipt } = seeded;
  writeFileSync(tokensPath, `${JSON.stringify(tokens)}\n`, { mode: 0o600 });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  assert((statSync(tokensPath).mode & 0o777) === 0o600, "token file mode");
  assert((statSync(receiptPath).mode & 0o777) === 0o600, "receipt file mode");
  return { databasePath, tokensPath, receiptPath, tokens, receipt };
}

function parseArgs(argv: string[]): { out: string; force: boolean } {
  let out = DEFAULT_OUT;
  let force = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--out") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) fail("--out requires a directory");
      out = isAbsolute(value) ? value : resolve(value);
      index += 1;
      continue;
    }
    fail(`unknown argument ${arg}`);
  }
  return { out, force };
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const result = seedDatabase(args.out, args.force);
  process.stdout.write(
    `${JSON.stringify(
      {
        databasePath: result.databasePath,
        tokensPath: result.tokensPath,
        receiptPath: result.receiptPath,
        workspaces: SCENARIO.workspaces,
        tokens: result.tokens,
        keyIds: keyIdMap(),
        servedAt: SERVED_AT,
      },
      null,
      2,
    )}\n`,
  );
}
