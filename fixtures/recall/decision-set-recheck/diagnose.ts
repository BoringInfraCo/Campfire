/**
 * Unscored recipient diagnostic for the RCL-003 §0 decision-projection correction.
 *
 * This is NOT a pilot. It scores nothing, produces no verdict, and does not
 * rerun, rescore, or read as a rerun of any RCL pilot. Its only question is
 * behavioural: does a fresh OpenCode recipient handed the CORRECTED offline
 * packet still lift a superseded decision's rationale into a live condition?
 *
 *   npx tsx fixtures/recall/decision-set-recheck/diagnose.ts
 *
 * Shape follows `fixtures/recall/rcl-002/diagnose.ts` (seed through the real
 * service, project, delete the credential and database, spawn a fresh sandboxed
 * harness process with nothing but a packet) and the sandbox-profile discipline
 * of `fixtures/recall/rcl-003/run.ts` (both path spellings, `.git` denied, host
 * OpenCode/Codex state denied, `PWD` pinned to the arm directory).
 *
 * Output lives outside the checkout at `~/.campfire-pilot/decision-set-recheck`
 * and never inside `~/.campfire-pilot/rcl-003`.
 *
 * The five checks are declared below, before any run, and are recorded pass or
 * fail. They are not assertions that abort the diagnostic when they fail: a
 * failing check is the measurement.
 */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { parseOpencodeEvents } from "../../../src/acceptance/real/opencode-events.js";
import { DECISION_SET_LINKED_NEXT_STEP, type CampfireHandoffPacket } from "../../../src/domain/recall.js";
import type { ActorRef } from "../../../src/domain/types.js";
import { createCampfireService } from "../../../src/service/campfire-service.js";
import type { ActorContext } from "../../../src/service/authorization.js";
import { openSqliteStore } from "../../../src/store/sqlite-store.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = resolve(homedir(), ".campfire-pilot/decision-set-recheck");
const ARM_DIR = join(OUT, "arm");
const WORK_DIR = join(ARM_DIR, "work");
const PRIVATE_DIR = join(ARM_DIR, "private");
const INSPECT_DIR = join(OUT, "inspect");
const DB_PATH = join(PRIVATE_DIR, "campfire.db");
/** The recipient harness and model the RCL-003 recipients used (RUN-LOCK.md). */
const OPENCODE_BIN = "/Users/sergio/.opencode/bin/opencode";
const OPENCODE_VERSION = "2.0.26";
const OPENCODE_MODEL = "opencode-go/glm-5.2#max";
const RECIPIENT_BUDGET_MINUTES = 10;
/** Prior pilot roots hold prior packets, answers, and event streams. */
const OLD_PILOT_ROOTS = ["rcl-001", "rcl-002", "rcl-003"].map((name) => resolve(homedir(), `.campfire-pilot/${name}`));

const TEAM_ID = "team_dsr";
const QUERY = "the ledger export";
const GOAL = "Ship the ledger export.";
const TASK = "Set the ledger export release rule.";
const FINDING = "The release log for the ledger export stops at 02:00 and no page follows it.";
const PREDECESSOR_SUMMARY = "Release the ledger export nightly at 02:00.";
/**
 * The trap. It lives only in the superseded predecessor's rationale and reads
 * like a live operational precondition, which is the whole point: the text is
 * entirely reasonable, and lifting it is the RCL-003 S2 recipient failure.
 */
const PREDECESSOR_RATIONALE =
  "The nightly run hid a two-hour outage before anyone was paged, so keep the 02:00 job disabled until two on-request releases have run twice with no operator escalation.";
const REPLACEMENT_SUMMARY = "Release the ledger export on operator request only.";
const REPLACEMENT_RATIONALE = "Operator-requested releases only, and keep the 02:00 job disabled.";
const SUPERSEDE_REASON = "the nightly run hid a two-hour outage before anyone was paged";
const DECOY_SUMMARY = "Publish the ledger export changelog weekly.";
/** The distinct clause the recipient must never apply as a current condition. */
const PRECONDITION = "until two on-request releases have run twice with no operator escalation";
/** Newer accepted decisions on other topics, so the keyed pair is off page one. */
const FILLER_COUNT = 11;

/**
 * The recipient prompt. It mirrors the RCL-003 recipient continuation shape and
 * says nothing about supersession, history, or rationales. Any signal about a
 * superseded rationale must come from the packet, not from here.
 */
const PROMPT = [
  "Using only the offline packet, continue the ledger export release work. State the goal, the prior evidence you rely on, the decision status, the next action, and any uncertainty. The packet is the file packet.json in this directory.",
  "",
  "The offline packet is the file packet.json in this directory. Do not use a Campfire credential or a live workspace.",
].join("\n");

interface SeedFacts {
  workspaceId: string;
  predecessorId: string;
  replacementId: string;
  decoyId: string;
  findingId: string;
  readerId: string;
  query: string;
}

/* ------------------------------------------------------------------------- *
 * Checks. Declared here, before the run, and never tuned to an outcome.
 * ------------------------------------------------------------------------- */

/** Distinctive fragments of the superseded-only precondition. */
const PRECONDITION_MARKERS = ["two on-request releases", "twice with no operator escalation", "have run twice"];
/** Wording that frames the clause as superseded explanation rather than a live condition. */
const HISTORICAL_QUALIFIERS = [
  "superseded", "supersede", "no longer", "not current", "not a current condition",
  "historical", "former", "formerly", "was replaced", "has been replaced", "does not apply",
  "do not apply", "must not", "not a live", "explains why", "only explain", "not applicable",
  "not in force", "no longer applies",
];
/** Asking for progress toward a condition is applying it, however it is labelled. */
const TRACKING = /\b(log|logs|logged|logging|track|tracking|tracked|count|counts|counting|tally|towards?|work toward|make progress on)\b/i;
const REQUEST_VERB = /\b(seek|seeks|seeking|request|requests|requesting|ask|asks|require|requires|required|need|needs|needed|await|awaits|pending|outstanding|before acting|before executing|before running|should be recorded|recommend)\b/i;
const REQUEST_TARGET = /\b(retire|retirement|retired|review|reviewed|replace|replacement|supersede|supersession|transition|resolve|resolution)\b/i;
/** A sentence that denies or records-already the need is not a request for one. */
const NOT_A_REQUEST = /\b(no|not|never|none|neither|already|without|recorded|does not|do not|isn't|aren't|nothing|unneeded|unnecessary)\b/i;
const OPERATIVE_WORDING = /\b(operative|replacement|replaced|supersedes|governs|governing|takes precedence|current rule|in force|is the rule|must apply|shall apply)\b/i;
/** The decoy is a proposal. Mentioning it as a proposal is not promoting it. */
const PROPOSAL_QUALIFIER = /\b(proposed|proposal|not accepted|unaccepted|no accepted|is not a rule|not a release rule|suggestion|pending|not yet|never accepted)\b/i;

interface CheckResult {
  id: string;
  question: string;
  pass: boolean;
  detail: string;
  evidence: string[];
}

function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function hits(haystack: string, needles: readonly string[]): boolean {
  const lowered = haystack.toLowerCase();
  return needles.some((needle) => lowered.includes(needle.toLowerCase()));
}

/**
 * 1. The decisive check. The superseded precondition must not be stated, or
 *    acted on, as a live condition. A sentence carrying the clause passes only
 *    when it also frames it as historical and does not ask for progress toward
 *    it. This mirrors the RCL-003 failure sentence, which asserted the
 *    condition and attributed it to "both rationales".
 */
function checkSupersededPreconditionNotLive(answer: string): CheckResult {
  const clauses = sentences(answer).filter((sentence) => hits(sentence, PRECONDITION_MARKERS));
  const live = clauses.filter((sentence) => !hits(sentence, HISTORICAL_QUALIFIERS) || TRACKING.test(sentence));
  return {
    id: "1-superseded-precondition-not-live",
    question: "Does the answer state the superseded precondition as a live condition?",
    pass: clauses.length === 0 || live.length === 0,
    detail: clauses.length === 0
      ? "the answer never mentions the superseded precondition"
      : live.length === 0
        ? "the precondition appears only as historical explanation"
        : "the precondition is asserted or tracked as a live condition",
    evidence: [...live, ...clauses.filter((sentence) => !live.includes(sentence))],
  };
}

/** 2. The accepted replacement is named as the rule that governs. */
function checkReplacementIsOperative(answer: string, facts: SeedFacts): CheckResult {
  const byId = answer.includes(facts.replacementId);
  const byText = /operator request only/i.test(answer);
  const operative = OPERATIVE_WORDING.test(answer);
  return {
    id: "2-replacement-named-operative",
    question: "Does the answer name the accepted replacement as the operative rule?",
    pass: (byId || byText) && operative,
    detail: `replacementId cited: ${byId}; replacement rule described: ${byText}; operativeness stated: ${operative}`,
    evidence: sentences(answer).filter((sentence) => sentence.includes(facts.replacementId) || /operator request only/i.test(sentence) || OPERATIVE_WORDING.test(sentence)),
  };
}

/** 3. No new transition is requested when one is already recorded. */
function checkNoFurtherTransitionRequested(answer: string): CheckResult {
  const flagged = sentences(answer).filter(
    (sentence) => REQUEST_VERB.test(sentence) && REQUEST_TARGET.test(sentence) && !NOT_A_REQUEST.test(sentence),
  );
  return {
    id: "3-no-further-transition-requested",
    question: "Does the answer request a retirement, review, or replacement when one is already recorded?",
    pass: flagged.length === 0,
    detail: flagged.length === 0 ? "no sentence requests a further transition" : `${flagged.length} sentence(s) request a further transition`,
    evidence: flagged,
  };
}

/** 4. The proposed decoy is not promoted into a rule. */
function checkDecoyNotPromoted(answer: string, facts: SeedFacts): CheckResult {
  const mentions = sentences(answer).filter((sentence) => sentence.includes(facts.decoyId) || /changelog/i.test(sentence));
  const promoted = mentions.filter((sentence) => !PROPOSAL_QUALIFIER.test(sentence));
  return {
    id: "4-proposed-decoy-not-promoted",
    question: "Does the answer promote the proposed decoy into a current rule?",
    pass: mentions.length === 0 || promoted.length === 0,
    detail: mentions.length === 0
      ? "the answer never mentions the proposal"
      : promoted.length === 0
        ? "the proposal is mentioned only as an unaccepted proposal"
        : "the proposal is presented as a rule",
    evidence: [...promoted, ...mentions.filter((sentence) => !promoted.includes(sentence))],
  };
}

/** 5. At least one keyed decision id is cited. */
function checkCitesKeyedId(answer: string, facts: SeedFacts): CheckResult {
  const keyed = [facts.predecessorId, facts.replacementId, facts.decoyId];
  const cited = keyed.filter((id) => answer.includes(id));
  return {
    id: "5-cites-keyed-decision-id",
    question: "Does the answer cite at least one keyed decision id?",
    pass: cited.length > 0,
    detail: `cited: ${cited.length === 0 ? "none" : cited.join(", ")}`,
    evidence: cited,
  };
}

/* ------------------------------------------------------------------------- *
 * Sandbox
 * ------------------------------------------------------------------------- */

/** A denied path is denied under the spelling given and its lowercased spelling. */
function pathSpellings(path: string): string[] {
  return [...new Set([path, path.toLowerCase()])];
}

function sandboxProfile(workDir: string, profilePath: string, isolatedHome: string, opencodeData: string): string[] {
  const denies = [
    // The whole checkout, both spellings, reads and writes. The recipient has no
    // reason to see any of it, including .git.
    REPO_ROOT,
    join(REPO_ROOT, ".git"),
    join(REPO_ROOT, "fixtures"),
    join(REPO_ROOT, "docs"),
    join(REPO_ROOT, "evidence"),
    join(REPO_ROOT, "src"),
    join(REPO_ROOT, "tests"),
    join(REPO_ROOT, "dist"),
    // Host harness state and prior session data.
    join(homedir(), ".config/opencode"),
    join(homedir(), ".local/share/opencode"),
    join(homedir(), ".local/state/opencode"),
    join(homedir(), ".codex"),
    join(homedir(), ".config/campfire"),
    join(homedir(), ".local/share/campfire"),
    join(homedir(), ".campfire"),
    // This diagnostic's own inspection output: never let the recipient read its
    // own seed facts or the packet projection outside the working directory.
    INSPECT_DIR,
    ...OLD_PILOT_ROOTS,
  ];
  const lines = ["(version 1)", "(allow default)"];
  for (const path of denies) {
    for (const spelling of pathSpellings(path)) {
      lines.push(`(deny file-read* (subpath ${JSON.stringify(spelling)}))`);
      lines.push(`(deny file-write* (subpath ${JSON.stringify(spelling)}))`);
    }
  }
  // Only the arm directory and the isolated harness home are readable/writable.
  lines.push(`(allow file-read* (subpath ${JSON.stringify(workDir)}))`);
  lines.push(`(allow file-read* (subpath ${JSON.stringify(isolatedHome)}))`);
  lines.push(`(allow file-read* (subpath ${JSON.stringify(opencodeData)}))`);
  mkdirSync(dirname(profilePath), { recursive: true, mode: 0o700 });
  writeFileSync(profilePath, `${lines.join("\n")}\n`, { mode: 0o600 });
  return denies;
}

function baseEnv(isolatedHome: string, opencodeData: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("CAMPFIRE_") || key.startsWith("OPENCODE_CONFIG") || key.startsWith("GIT_")) delete env[key];
  }
  for (const key of ["OLDPWD", "INIT_CWD", "CODEX_HOME"]) delete env[key];
  env.HOME = isolatedHome;
  env.PATH = `${dirname(process.execPath)}:${env.PATH ?? "/usr/bin:/bin"}`;
  env.XDG_CONFIG_HOME = join(isolatedHome, ".config");
  env.XDG_DATA_HOME = dirname(opencodeData);
  env.XDG_STATE_HOME = join(isolatedHome, ".local/state");
  env.XDG_CACHE_HOME = join(isolatedHome, ".cache");
  return env;
}

/**
 * Recreate OpenCode's routing database in the isolated data directory, copying
 * only authentication and model-routing rows. Never back up or VACUUM INTO the
 * host database: that would make a transient copy of private host sessions.
 */
function copyOpencodeAuth(opencodeData: string): void {
  mkdirSync(opencodeData, { recursive: true, mode: 0o700 });
  const hostData = join(homedir(), ".local/share/opencode");
  for (const name of ["auth.json", "account.json"]) {
    const source = join(hostData, name);
    if (!existsSync(source)) continue;
    const dest = join(opencodeData, name);
    copyFileSync(source, dest);
    chmodSync(dest, 0o600);
  }
  const sourcePath = join(hostData, "opencode.db");
  const isolatedPath = join(opencodeData, "opencode.db");
  if (!existsSync(sourcePath) || existsSync(isolatedPath)) fail("host OpenCode route source is missing, or the isolated copy already exists");
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const copy = new Database(isolatedPath);
  try {
    copy.pragma("foreign_keys = OFF");
    const rows = source
      .prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND type IN ('table', 'index', 'trigger', 'view') ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, name")
      .all() as Array<{ type: string; name: string; sql: string }>;
    for (const row of rows) copy.exec(row.sql);
    const allow = new Set(["__drizzle_migrations", "migration", "account", "account_state", "control_account", "credential", "kv"]);
    for (const table of allow) {
      if (!rows.some((row) => row.type === "table" && row.name === table)) fail(`OpenCode routing table ${table} is missing`);
    }
    copy.transaction(() => {
      for (const table of allow) {
        const columns = source.prepare(`PRAGMA table_info("${table.replaceAll('"', '""')}")`).all() as Array<{ name: string }>;
        const names = columns.map((column) => column.name);
        const quoted = names.map((name) => `"${name.replaceAll('"', '""')}"`);
        const query = table === "kv" ? "SELECT * FROM kv WHERE key = 'models-dev:catalog'" : `SELECT * FROM "${table.replaceAll('"', '""')}"`;
        const values = source.prepare(query).all() as Array<Record<string, unknown>>;
        const insert = copy.prepare(`INSERT INTO "${table.replaceAll('"', '""')}" (${quoted.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`);
        for (const value of values) insert.run(...names.map((name) => value[name] as string | number | bigint | Buffer | null));
      }
    })();
    for (const row of rows.filter((candidate) => candidate.type === "table" && !allow.has(candidate.name))) {
      const count = copy.prepare(`SELECT COUNT(*) AS n FROM "${row.name.replaceAll('"', '""')}"`).get() as { n: number };
      if (count.n !== 0) fail(`isolated OpenCode ${row.name} retained host history`);
    }
  } finally {
    copy.close();
    source.close();
  }
  chmodSync(isolatedPath, 0o600);
}

function writeOpencodeConfig(workDir: string): void {
  const config = {
    $schema: "https://opencode.ai/config.json",
    share: "disabled",
    autoupdate: false,
    snapshot: false,
    permission: {
      bash: "deny",
      edit: "deny",
      webfetch: "deny",
      websearch: "deny",
      codesearch: "deny",
      task: "deny",
      skill: "deny",
      external_directory: "deny",
    },
  };
  writeFileSync(join(workDir, "opencode.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function sandboxAttempt(
  profile: string,
  cwd: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("sandbox-exec", ["-f", profile, command, ...args], { cwd, env, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

interface IsolationReport {
  denials: string[];
}

function probeIsolation(profile: string, env: NodeJS.ProcessEnv): IsolationReport {
  const denials: string[] = [];
  const expectDenied = (command: string, args: string[], label: string, mustNotContain?: string): void => {
    const result = sandboxAttempt(profile, WORK_DIR, command, args, env);
    if (result.status === 0 && (mustNotContain === undefined || !result.stdout.includes(mustNotContain))) {
      fail(`isolation hole: ${label} was readable under the profile`);
    }
    denials.push(`${label}: denied`);
  };
  const expectWriteDenied = (directory: string, label: string): void => {
    const target = join(directory, ".decision-set-recheck-write-probe");
    const result = sandboxAttempt(profile, WORK_DIR, "/bin/sh", ["-c", 'printf probe > "$1"', "sh", target], env);
    const created = existsSync(target);
    if (created) rmSync(target, { force: true });
    if (result.status === 0 || created) fail(`isolation hole: ${label} was writable under the profile`);
    denials.push(`${label}: write denied`);
  };

  // A denied `.git` read proves isolation only if the key is really committed.
  // RCL-002 found that `git show HEAD:fixtures/.../ground-truth.md` otherwise
  // reads the committed answer key straight out of `.git`.
  for (const key of ["fixtures/recall/rcl-003/ground-truth.md", "fixtures/recall/rcl-002/ground-truth.md"]) {
    const baseline = spawnSync("git", ["-C", REPO_ROOT, "show", `HEAD:${key}`], { encoding: "utf8" });
    if (baseline.status !== 0 || baseline.stdout.trim().length === 0) fail(`committed key ${key} is missing; cannot prove the git read denial`);
    expectDenied("git", ["-C", REPO_ROOT, "show", `HEAD:${key}`], `git show ${key}`, "Correct next action");
  }
  for (const spelling of pathSpellings(REPO_ROOT)) {
    expectDenied("/bin/cat", [join(spelling, "src/domain/recall.ts")], `checkout source ${spelling}`);
    expectWriteDenied(spelling, `checkout write ${spelling}`);
  }
  expectDenied("/bin/ls", [join(REPO_ROOT, ".git")], "checkout .git");
  expectDenied("/bin/cat", [join(INSPECT_DIR, "seed-facts.json")], "diagnostic inspection output");
  for (const root of OLD_PILOT_ROOTS) {
    expectDenied("/bin/ls", [root], `pilot root ${root}`);
    expectDenied("/bin/ls", [root.toLowerCase()], `pilot root ${root.toLowerCase()}`);
    expectWriteDenied(root, `pilot root ${root}`);
  }
  expectDenied("/bin/cat", [join(homedir(), ".local/share/opencode/auth.json")], "host OpenCode auth");
  expectDenied("/bin/ls", [join(homedir(), ".local/share/opencode/opencode.db")], "host OpenCode database");
  expectDenied("/bin/ls", [join(homedir(), ".config/opencode")], "host OpenCode config");
  expectDenied("/bin/ls", [join(homedir(), ".local/state/opencode")], "host OpenCode state");
  expectDenied("/bin/cat", [join(homedir(), ".codex/history.jsonl")], "host Codex history");
  expectDenied("/bin/cat", [join(homedir(), ".codex/auth.json")], "host Codex auth");
  expectDenied("/bin/ls", [join(homedir(), ".codex/memories")], "host Codex memories");
  expectDenied("/bin/ls", [join(homedir(), ".config/campfire")], "operator Campfire config");

  const allowed = sandboxAttempt(profile, WORK_DIR, "/bin/cat", [join(WORK_DIR, "packet.json")], env);
  if (allowed.status !== 0) fail("the profile blocked the recipient's own packet");
  denials.push("own packet: readable");
  return { denials };
}

/* ------------------------------------------------------------------------- *
 * Seed and projection
 * ------------------------------------------------------------------------- */

function fail(message: string): never {
  throw new Error(`decision-set-recheck: ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function human(actorId: string): ActorContext {
  return { actor: { actorId, actorType: "human" } };
}

function acceptedDecision(
  service: ReturnType<typeof createCampfireService>,
  ctx: ActorContext,
  workspaceId: string,
  summary: string,
  rationale: string,
): string {
  const added = service.addDecision(ctx, { workspaceId, summary, rationale });
  service.acceptDecision(ctx, added.id);
  return added.id;
}

function seedAndProjectPacket(): { facts: SeedFacts; packet: CampfireHandoffPacket; receipt: Record<string, unknown> } {
  for (const path of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) rmSync(path, { force: true });
  const store = openSqliteStore(DB_PATH);
  const service = createCampfireService({ store });
  let closed = false;
  try {
    store.createOrganization({ id: "org_dsr", name: "Decision-set recheck", createdAt: "2026-10-12T00:00:00.000Z" });
    store.createTeam({ id: TEAM_ID, organizationId: "org_dsr", name: "Decision-set recheck", createdAt: "2026-10-12T00:00:00.000Z" });
    const owner = service.createHuman(undefined, { teamId: TEAM_ID, displayName: "Recheck owner" });
    const ownerCtx = human(owner.human.id);
    const agent = service.createAgent(ownerCtx, { teamId: TEAM_ID, humanId: owner.human.id, name: "recheck fixture", harness: "fixture" });
    const reader = service.createHuman(ownerCtx, { teamId: TEAM_ID, displayName: "Recheck reader" });
    const readerRef: ActorRef = { actorId: reader.human.id, actorType: "human" };
    const agentRef: ActorRef = { actorId: agent.agent.id, actorType: "agent" };

    const workspace = service.createWorkspace(ownerCtx, { teamId: TEAM_ID, name: "Decision-set recheck" });
    service.createGoal(ownerCtx, { workspaceId: workspace.id, title: GOAL });
    service.createTask(ownerCtx, { workspaceId: workspace.id, title: TASK });
    service.inviteToWorkspace(ownerCtx, { workspaceId: workspace.id, actor: agentRef, role: "agent" });
    service.inviteToWorkspace(ownerCtx, { workspaceId: workspace.id, actor: readerRef, role: "viewer" });
    service.joinWorkspace({ actor: agentRef }, { workspaceId: workspace.id });
    service.joinWorkspace({ actor: readerRef }, { workspaceId: workspace.id });
    const registered = service.registerAgentSession({ actor: agentRef }, { agentId: agent.agent.id, workspaceId: workspace.id, harness: "fixture" });
    const acting: ActorContext = { actor: agentRef, agentSessionId: registered.id };

    const finding = service.addFinding(acting, { workspaceId: workspace.id, summary: FINDING });
    const predecessor = acceptedDecision(service, ownerCtx, workspace.id, PREDECESSOR_SUMMARY, PREDECESSOR_RATIONALE);
    service.citeDecisionBasis(ownerCtx, { decisionId: predecessor, findingId: finding.id });
    // The real accept-with-predecessor path: addDecision({ replacesDecisionId })
    // then acceptDecision(ctx, id, { reason }).
    const replacement = service.addDecision(acting, {
      workspaceId: workspace.id,
      summary: REPLACEMENT_SUMMARY,
      rationale: REPLACEMENT_RATIONALE,
      replacesDecisionId: predecessor,
    });
    service.acceptDecision(acting, replacement.id, { reason: SUPERSEDE_REASON });
    service.citeDecisionBasis(acting, { decisionId: replacement.id, findingId: finding.id });
    // Matches the query, lands in the decision set, and is not a release rule.
    const decoy = service.addDecision(acting, {
      workspaceId: workspace.id,
      summary: DECOY_SUMMARY,
      rationale: "This is a suggestion, not a release rule.",
    });
    for (let index = 1; index <= FILLER_COUNT; index += 1) {
      acceptedDecision(service, ownerCtx, workspace.id,
        `Document the runbook step ${String(index).padStart(2, "0")}.`,
        `Keep the ordinary runbook step ${String(index).padStart(2, "0")} current.`);
    }

    const facts: SeedFacts = {
      workspaceId: workspace.id,
      predecessorId: predecessor,
      replacementId: replacement.id,
      decoyId: decoy.id,
      findingId: finding.id,
      readerId: reader.human.id,
      query: QUERY,
    };
    // The real service projection. The issuer is the workspace owner; the
    // recipient is the invited viewer, who never authors anything in the key.
    const packet = service.projectHandoffPacket(ownerCtx, {
      workspaceId: workspace.id,
      query: QUERY,
      recipient: readerRef,
    });
    service.close();
    closed = true;

    const packetPath = join(WORK_DIR, "packet.json");
    writeFileSync(packetPath, `${JSON.stringify(packet, null, 2)}\n`, { mode: 0o600 });
    assert((statSync(packetPath).mode & 0o777) === 0o600, "packet mode is not 0600");

    const text = readFileSync(packetPath, "utf8");
    assert(!text.includes("cft_"), "packet contains a cft_ bearer string");
    assert(!text.includes(owner.token), "packet contains the issuer credential");
    for (const local of [REPO_ROOT, REPO_ROOT.toLowerCase(), homedir(), OUT, DB_PATH]) {
      assert(!text.includes(local), `packet contains the local path ${local}`);
    }
    assertPacketShape(packet, facts);

    const receipt = {
      workspaceId: facts.workspaceId,
      predecessorId: facts.predecessorId,
      replacementId: facts.replacementId,
      decoyId: facts.decoyId,
      findingId: facts.findingId,
      readerId: facts.readerId,
      query: facts.query,
      preconditionClause: PRECONDITION,
    };
    return { facts, packet, receipt };
  } finally {
    if (!closed) service.close();
    // The credential and the database leave the disk exactly as rcl-002 does.
    // Only packet.json survives for the recipient.
    for (const path of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) rmSync(path, { force: true });
  }
}

/** Fixture preconditions. These are facts about the seed, not about the answer. */
function assertPacketShape(packet: CampfireHandoffPacket, facts: SeedFacts): void {
  const set = packet.decisionSet;
  assert(set !== undefined, "packet has no decisionSet");
  assert(set.state === "linked-accepted-decisions", `decision set state is ${set.state}`);
  assert(set.operativeDecisionId === facts.replacementId, `operativeDecisionId is ${String(set.operativeDecisionId)}`);
  assert(set.beforeActing === undefined, "a linked set must not carry beforeActing");
  assert(set.linkedNextStep === DECISION_SET_LINKED_NEXT_STEP, "linkedNextStep is missing or altered");
  assert(set.truncated === false, "the decision set is truncated");
  assert(set.recordedTransitions.length === 1, `recordedTransitions has ${set.recordedTransitions.length} entries`);
  const transition = set.recordedTransitions[0]!;
  assert(transition.supersededDecisionId === facts.predecessorId && transition.supersedingDecisionId === facts.replacementId,
    "the recorded transition is not predecessor to replacement");

  const member = (id: string): CampfireHandoffPacket["records"][number] | undefined => set.members.find((row) => row.id === id);
  const superseded = member(facts.predecessorId);
  const operative = member(facts.replacementId);
  const proposed = member(facts.decoyId);
  assert(superseded !== undefined, "predecessor is missing from the decision set");
  assert(superseded.lifecycle === "superseded", `predecessor lifecycle is ${String(superseded.lifecycle)}`);
  assert(superseded.section === "historical", `predecessor section is ${superseded.section}`);
  assert(superseded.rationale === undefined && superseded.rationaleTruncated === undefined,
    "a superseded member must not carry rationale");
  assert(typeof superseded.historicalExplanation === "string", "a superseded member must carry historicalExplanation");
  assert(operative !== undefined, "replacement is missing from the decision set");
  assert(operative.lifecycle === "accepted", `replacement lifecycle is ${String(operative.lifecycle)}`);
  assert(operative.section === "current", `replacement section is ${operative.section}`);
  assert(operative.rationale === REPLACEMENT_RATIONALE, "the operative member lost its own rationale");
  assert(proposed !== undefined, "the proposed decoy is missing from the decision set");
  assert(proposed.lifecycle === "proposed" && proposed.section === "current", "the decoy is projected as a live rule");

  // The correction's own replay property: the trap clause is gone from the set.
  assert(!JSON.stringify(set).includes(PRECONDITION), "the precondition clause still appears inside decisionSet");
  assert(!set.members.some((row) => row.rationale !== undefined && row.rationale.includes("no operator escalation")),
    "a decision-set member still carries the superseded precondition text");

  // The keyed pair must be off the anchor page, or the answer would not have to
  // come from the corrected decision set at all.
  const anchored = packet.anchors.acceptedDecisions.map((row) => row.id);
  assert(!anchored.includes(facts.replacementId), "the replacement leaked into the accepted anchors");
  assert(!anchored.includes(facts.predecessorId), "the predecessor leaked into the accepted anchors");
}

/* ------------------------------------------------------------------------- *
 * Recipient
 * ------------------------------------------------------------------------- */

function rawToolCalls(events: string): Array<{ tool: string; input: unknown; output: string; status: string }> {
  const calls: Array<{ tool: string; input: unknown; output: string; status: string }> = [];
  for (const line of events.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const part = (parsed as { part?: unknown }).part;
    if (typeof part !== "object" || part === null) continue;
    const record = part as { type?: unknown; tool?: unknown; state?: unknown };
    if (record.type !== "tool" || typeof record.tool !== "string") continue;
    const state = (typeof record.state === "object" && record.state !== null ? record.state : {}) as {
      input?: unknown;
      output?: unknown;
      status?: unknown;
    };
    let output = "";
    if (typeof state.output === "string") output = state.output;
    else if (state.output !== undefined && state.output !== null) {
      try {
        output = JSON.stringify(state.output);
      } catch {
        output = String(state.output);
      }
    }
    calls.push({
      tool: record.tool,
      input: state.input ?? {},
      output: output.slice(0, 4000),
      status: typeof state.status === "string" ? state.status : "unknown",
    });
  }
  return calls;
}

function runRecipient(profile: string, env: NodeJS.ProcessEnv, eventsPath: string): Promise<{ code: number | null; timedOut: boolean }> {
  return new Promise((resolvePromise, reject) => {
    // Direct file descriptors, as the RCL-002 and RCL-003 runners do. The child
    // writes the stream itself, so when it exits every byte is already flushed
    // and there is no stream teardown to race with the result write.
    const out = openSync(eventsPath, "w");
    const err = openSync(`${eventsPath}.err`, "w");
    for (const path of [eventsPath, `${eventsPath}.err`]) chmodSync(path, 0o600);
    const child = spawn(
      "sandbox-exec",
      ["-f", profile, OPENCODE_BIN, "run", "--standalone", "--format", "json", "--auto", "--model", OPENCODE_MODEL, PROMPT],
      { cwd: WORK_DIR, env, detached: true, stdio: ["ignore", out, err] },
    );
    let timedOut = false;
    // Detached, so the timer signals the whole process group.
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          // already gone
        }
      }
    }, RECIPIENT_BUDGET_MINUTES * 60_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      closeSync(out);
      closeSync(err);
      resolvePromise({ code, timedOut });
    });
  });
}

/* ------------------------------------------------------------------------- *
 * Main
 * ------------------------------------------------------------------------- */

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  for (const dir of [WORK_DIR, PRIVATE_DIR, INSPECT_DIR]) mkdirSync(dir, { recursive: true, mode: 0o700 });

  const version = spawnSync(OPENCODE_BIN, ["--version"], { encoding: "utf8" });
  assert(version.status === 0, `the recipient harness ${OPENCODE_BIN} is unavailable: ${(version.stderr || "").slice(0, 300)}`);
  const opencodeVersion = (version.stdout || "").trim();
  assert(opencodeVersion.includes(OPENCODE_VERSION),
    `recipient harness is ${opencodeVersion}, not the RCL-003 recipient's ${OPENCODE_VERSION}`);

  writeFileSync(join(WORK_DIR, "prompt.txt"), PROMPT, { mode: 0o600 });
  const { facts, packet, receipt } = seedAndProjectPacket();
  writeFileSync(join(INSPECT_DIR, "seed-facts.json"), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(INSPECT_DIR, "decision-set.json"), `${JSON.stringify(packet.decisionSet, null, 2)}\n`, { mode: 0o600 });

  // The recipient working directory holds the packet and nothing else.
  const armEntries = readdirSync(WORK_DIR).sort();
  assert(armEntries.includes("packet.json"), "packet.json is missing from the arm directory");
  assert(!armEntries.some((name) => name.includes("token") || name.endsWith(".db") || name.endsWith(".db-wal") || name.endsWith(".db-shm")),
    `the recipient directory holds a credential or database: ${armEntries.join(", ")}`);
  for (const path of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) assert(!existsSync(path), `${path} survived the seed`);

  const isolatedHome = join(PRIVATE_DIR, "home");
  const opencodeData = join(PRIVATE_DIR, "share", "opencode");
  copyOpencodeAuth(opencodeData);
  const profile = join(PRIVATE_DIR, "sandbox.sb");
  const denies = sandboxProfile(WORK_DIR, profile, isolatedHome, opencodeData);

  const env = baseEnv(isolatedHome, opencodeData);
  // OpenCode follows PWD. The parent shell's PWD is the checkout.
  env.PWD = WORK_DIR;
  const isolation = probeIsolation(profile, env);
  writeOpencodeConfig(WORK_DIR);

  const eventsPath = join(OUT, "events.jsonl");
  process.stdout.write(`RECIPIENT_START ${OPENCODE_BIN} ${opencodeVersion} ${OPENCODE_MODEL} budget=${RECIPIENT_BUDGET_MINUTES}m\n`);
  const stopped = await runRecipient(profile, env, eventsPath);
  const events = existsSync(eventsPath) ? readFileSync(eventsPath, "utf8") : "";
  const parsed = parseOpencodeEvents(events);
  const answer = parsed.finalMessage.trim();
  const calls = rawToolCalls(events);

  const inputs = calls.map((call) => JSON.stringify(call.input ?? {}));
  const outputs = calls.map((call) => call.output);
  const packetRead = inputs.some((input) => input.includes("packet.json"));
  const packetContentObserved = outputs.some((output) => output.includes(facts.replacementId) && output.includes(facts.predecessorId));
  const checkoutAttempts = calls
    .map((call, index) => ({ call, input: inputs[index] ?? "", output: outputs[index] ?? "" }))
    .filter(({ input, output }) => [input, output].some((text) => text.includes(REPO_ROOT) || text.includes("Campfire-Internal")));
  const checkoutReads = checkoutAttempts.filter(({ call, output }) =>
    call.status !== "error" && !/not permitted|unable to read|no such file|permission denied/i.test(output));
  const campfireCalls = calls.filter((call) => /^campfire|recall_workspace|get_workspace/i.test(call.tool));

  const checks: CheckResult[] = [
    checkSupersededPreconditionNotLive(answer),
    checkReplacementIsOperative(answer, facts),
    checkNoFurtherTransitionRequested(answer),
    checkDecoyNotPromoted(answer, facts),
    checkCitesKeyedId(answer, facts),
  ];

  const preconditionLocations = ((): string[] => {
    const locations: string[] = [];
    if (JSON.stringify(packet.decisionSet).includes(PRECONDITION)) locations.push("decisionSet");
    if (JSON.stringify(packet.records).includes(PRECONDITION)) locations.push("records");
    if (JSON.stringify(packet.anchors).includes(PRECONDITION)) locations.push("anchors");
    return locations;
  })();

  const result = {
    unscored: true,
    isPilot: false,
    verdict: null,
    note: "Unscored diagnostic. Not a pilot, no verdict, no RCL-003 rerun or rescore.",
    ranAt: new Date().toISOString(),
    harness: { command: OPENCODE_BIN, version: opencodeVersion, model: OPENCODE_MODEL, matchesRcl003Recipient: opencodeVersion.includes(OPENCODE_VERSION) },
    exitCode: stopped.code,
    timedOut: stopped.timedOut,
    answerBytes: Buffer.byteLength(answer),
    toolCallCount: calls.length,
    packetRead,
    packetContentObserved,
    campfireMcpCalls: campfireCalls.length,
    checkoutReadAttempted: checkoutAttempts.length,
    checkoutReadsSucceeded: checkoutReads.length,
    checks,
    packet: {
      bytes: statSync(join(WORK_DIR, "packet.json")).size,
      decisionSetState: packet.decisionSet?.state ?? null,
      operativeDecisionId: packet.decisionSet?.operativeDecisionId ?? null,
      memberSections: (packet.decisionSet?.members ?? []).map((row) => ({ id: row.id, lifecycle: row.lifecycle ?? null, section: row.section })),
      preconditionClauseLocations: preconditionLocations,
      containsCftBearer: readFileSync(join(WORK_DIR, "packet.json"), "utf8").includes("cft_"),
    },
    isolation: { denies: denies.length, denials: isolation.denials, armDirectory: WORK_DIR },
  };

  writeFileSync(join(OUT, "answer.txt"), `${answer}\n`, { mode: 0o600 });
  writeFileSync(join(OUT, "tool-calls.json"), `${JSON.stringify(calls, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(OUT, "result.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });

  for (const check of checks) {
    process.stdout.write(`CHECK ${check.pass ? "PASS" : "FAIL"} ${check.id} — ${check.detail}\n`);
  }
  process.stdout.write(
    `UNSCORED_RESULT exit=${String(stopped.code)} tools=${calls.length} answerBytes=${Buffer.byteLength(answer)} `
    + `packetRead=${packetRead} mcp=${campfireCalls.length} checkoutAttempts=${checkoutAttempts.length} checkoutReads=${checkoutReads.length}\n`,
  );

  if (answer === "") {
    fail("the recipient produced no answer; the diagnostic could not measure anything. See events.jsonl and events.jsonl.err");
  }
  if (stopped.code !== 0) fail(`the recipient harness exited ${String(stopped.code)}; see events.jsonl.err`);
  if (!packetRead && !packetContentObserved) fail("the recipient never read packet.json; the diagnostic did not measure anything");
  // A failing check is a measurement, not an error. Exiting zero here means
  // "the diagnostic ran", not "the correction worked".
  process.stdout.write("UNSCORED_DIAGNOSE_OK\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});