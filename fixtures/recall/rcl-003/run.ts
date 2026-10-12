/**
 * RCL-003 pilot runner.
 *
 * Private. Do not mount this directory into an agent session. The runner reads
 * one task prompt at a time and passes only that string to the harness.
 *
 *   npx tsx fixtures/recall/rcl-003/run.ts probe
 *   npx tsx fixtures/recall/rcl-003/run.ts preflight
 *   npx tsx fixtures/recall/rcl-003/run.ts run
 *
 * No override flags are accepted. The preflight runs in full before any scored
 * arm and prints PREFLIGHT_OK. This process does not score.
 */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { parseCodexEvents } from "../../../src/acceptance/real/codex-events.js";
import { parseOpencodeEvents } from "../../../src/acceptance/real/opencode-events.js";
import { DECISION_SET_UNRESOLVED_NEXT_STEP, deriveDecisionSetState, type CampfireHandoffPacket, type RecallDecisionSetState } from "../../../src/domain/recall.js";
import { createCampfireService } from "../../../src/service/campfire-service.js";
import { openReadonlySqliteStore } from "../../../src/store/sqlite-store.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PILOT_ROOT = resolve(homedir(), ".campfire-pilot/rcl-003");
const SEED_DIR = join(PILOT_ROOT, "seed");
const RUNS_DIR = join(PILOT_ROOT, "runs");
const CONTROL_SRC = join(PILOT_ROOT, "control-src");
const FIXTURE_DIR = join(REPO_ROOT, "fixtures/recall/rcl-003");
/** Both earlier pilot roots hold prior packets, answers, and event streams. */
const OLD_PILOT_ROOTS = [
  resolve(homedir(), ".campfire-pilot/rcl-001"),
  resolve(homedir(), ".campfire-pilot/rcl-002"),
];

/**
 * Replaced by a dated amendment in RUN-LOCK.md once the decision-set
 * implementation is committed. The runner refuses to start while the
 * placeholder is in place.
 */
const IMPLEMENTATION_COMMIT = "PLACEHOLDER_NOT_YET_COMMITTED_0000000000000000";
const CONTROL_COMMIT = "bb3bb61d716f52bb36e5f1c6e6514ece71abc555";
const CODEX_BIN = "/Users/sergio/.local/bin/codex";
const OPENCODE_BIN = "/Users/sergio/.opencode/bin/opencode";
const CODEX_VERSION = "0.150.1";
const OPENCODE_VERSION = "2.0.26";
const CODEX_MODEL = "gpt-5.6-sol";
const CODEX_REASONING = "high";
const OPENCODE_MODEL = "opencode-go/glm-5.2#max";
const TSX_CLI = join(REPO_ROOT, "node_modules/tsx/dist/cli.mjs");
const MATCHED_BUDGET = { minutes: 20, toolCalls: 40 };
const RECIPIENT_BUDGET = { minutes: 10, toolCalls: 20 };
const READER_ID = "hum_rcl003_reader";

const ORDER = [
  ["S1", "control"],
  ["S1", "treatment"],
  ["S1", "recipient"],
  ["S2", "treatment"],
  ["S2", "control"],
  ["S2", "recipient"],
  ["S3", "control"],
  ["S3", "treatment"],
  ["S3", "recipient"],
] as const;

interface ScenarioFacts {
  id: string;
  token: "s1" | "s2" | "s3";
  query: string;
  counts: { accepted: number; proposed: number; superseded: number };
  orientation: { total: number; returned: number; truncated: boolean };
  offPage: string[];
  /** A string that exists only in one off-page decision's rationale. */
  absence?: string;
  /** The keyed decision whose rationale carries `absence`. */
  absenceOwner?: string;
  finding: string;
  proposal: string;
  set: {
    state: RecallDecisionSetState;
    members: Record<string, string>;
    transitions: Array<{ supersededDecisionId: string; supersedingDecisionId: string }>;
    operative?: string;
    beforeActing?: string;
  };
}

/** Frozen in RUN-LOCK.md and in ground-truth.md before the first scored arm. */
const SCENARIOS: Record<"S1" | "S2" | "S3", ScenarioFacts> = {
  S1: {
    id: "ws_rcl003_s1",
    token: "s1",
    query: "the ledger close",
    counts: { accepted: 12, proposed: 1, superseded: 0 },
    orientation: { total: 13, returned: 10, truncated: true },
    offPage: ["dec_rcl003_s1_fixed", "dec_rcl003_s1_rolling"],
    absence: "thirty minutes",
    absenceOwner: "dec_rcl003_s1_fixed",
    finding: "find_rcl003_s1_current",
    proposal: "dec_rcl003_s1_proposed",
    set: {
      state: "unresolved-accepted-decisions",
      members: {
        dec_rcl003_s1_proposed: "proposed",
        dec_rcl003_s1_fixed: "accepted",
        dec_rcl003_s1_rolling: "accepted",
      },
      transitions: [],
      beforeActing: DECISION_SET_UNRESOLVED_NEXT_STEP,
    },
  },
  S2: {
    id: "ws_rcl003_s2",
    token: "s2",
    query: "the ledger export",
    counts: { accepted: 12, proposed: 1, superseded: 1 },
    orientation: { total: 13, returned: 10, truncated: true },
    offPage: ["dec_rcl003_s2_predecessor", "dec_rcl003_s2_replacement"],
    absence: "two-hour outage",
    absenceOwner: "dec_rcl003_s2_predecessor",
    finding: "find_rcl003_s2_current",
    proposal: "dec_rcl003_s2_proposed",
    set: {
      state: "linked-accepted-decisions",
      members: {
        dec_rcl003_s2_replacement: "accepted",
        dec_rcl003_s2_predecessor: "superseded",
        dec_rcl003_s2_proposed: "proposed",
      },
      transitions: [
        { supersededDecisionId: "dec_rcl003_s2_predecessor", supersedingDecisionId: "dec_rcl003_s2_replacement" },
      ],
      operative: "dec_rcl003_s2_replacement",
    },
  },
  S3: {
    id: "ws_rcl003_s3",
    token: "s3",
    query: "the batch cap",
    counts: { accepted: 9, proposed: 1, superseded: 0 },
    orientation: { total: 10, returned: 10, truncated: false },
    offPage: [],
    finding: "find_rcl003_s3_current",
    proposal: "dec_rcl003_s3_proposed",
    set: {
      state: "no-accepted-decision",
      members: { dec_rcl003_s3_proposed: "proposed" },
      transitions: [],
    },
  },
};

type Scenario = keyof typeof SCENARIOS;
type Arm = "control" | "treatment" | "recipient";

const TREATMENT_ADDENDUM =
  "Use recall_workspace with that query before you answer. You may also use orientation, catch-up, and drill-down. Do not call get_workspace. Do not write or update Campfire records.";
const CONTROL_ADDENDUM =
  "Use orientation, catch-up, and drill-down. Do not call get_workspace. Do not write or update Campfire records.";
const RECIPIENT_ADDENDUM =
  "The offline packet is the file packet.json in this directory. Do not use a Campfire credential or a live workspace.";

function fail(message: string): never {
  throw new Error(`rcl-003 run: ${message}`);
}

/** A denied path is denied under its given spelling and its lowercased spelling. */
function pathSpellings(path: string): string[] {
  return [...new Set([path, path.toLowerCase()])];
}

function execSyncText(command: string, args: string[], cwd = REPO_ROOT): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    fail(`${command} ${args[0] ?? ""} failed: ${(result.stderr || result.stdout || "").slice(0, 400)}`);
  }
  return (result.stdout || "").trim();
}

function assertProductTree(): void {
  if (IMPLEMENTATION_COMMIT.startsWith("PLACEHOLDER")) {
    fail(`RUN-LOCK.md still carries the placeholder treatment commit (${IMPLEMENTATION_COMMIT}); record the real hash in a dated amendment before the first scored run`);
  }
  if (Number(process.versions.node.split(".")[0]) < 22) fail(`Node ${process.version} is below the package's >=22 requirement`);
  const srcDiff = execSyncText("git", ["diff", "--stat", IMPLEMENTATION_COMMIT, "--", "src", "package.json", "package-lock.json"]);
  if (srcDiff !== "") fail(`product tree differs from ${IMPLEMENTATION_COMMIT}`);
  const untracked = execSyncText("git", ["ls-files", "--others", "--exclude-standard", "--", "src", "package.json", "package-lock.json"]);
  if (untracked !== "") fail("untracked product files are present");
  const lockDiff = execSyncText("git", ["diff", "--stat", CONTROL_COMMIT, IMPLEMENTATION_COMMIT, "--", "package-lock.json"]);
  if (lockDiff !== "") fail("control and treatment dependency locks differ");
  const lockText = readFileSync(join(FIXTURE_DIR, "RUN-LOCK.md"), "utf8");
  for (const needle of [
    IMPLEMENTATION_COMMIT,
    CONTROL_COMMIT,
    CODEX_VERSION,
    OPENCODE_VERSION,
    CODEX_MODEL,
    OPENCODE_MODEL,
    CODEX_REASONING,
    "20 minutes or 40 tool calls",
    "10 minutes or 20 tool calls",
    "S1 control, then treatment, then recipient",
    "~/.campfire-pilot/rcl-003",
  ]) {
    if (!lockText.includes(needle)) fail(`RUN-LOCK.md is missing ${needle}`);
  }
  const codexVersion = execSyncText(CODEX_BIN, ["--version"]);
  if (!codexVersion.includes(CODEX_VERSION)) fail(`codex version ${codexVersion}`);
  const opencodeVersion = execSyncText(OPENCODE_BIN, ["--version"]);
  if (!opencodeVersion.includes(OPENCODE_VERSION)) fail(`opencode version ${opencodeVersion}`);
}

function ensureControlTree(): void {
  if (!existsSync(join(CONTROL_SRC, "src/mcp/tools.ts"))) {
    mkdirSync(PILOT_ROOT, { recursive: true, mode: 0o700 });
    execSyncText("git", ["worktree", "add", "--detach", CONTROL_SRC, CONTROL_COMMIT]);
  }
  const head = execSyncText("git", ["rev-parse", "HEAD"], CONTROL_SRC);
  if (head !== CONTROL_COMMIT) fail(`control tree is ${head}`);
  const modules = join(CONTROL_SRC, "node_modules");
  if (!existsSync(modules)) {
    // Same lockfile as the implementation commit, so the main install is the runtime.
    spawnLink(join(REPO_ROOT, "node_modules"), modules);
  }
  const tools = readFileSync(join(CONTROL_SRC, "src/mcp/tools.ts"), "utf8");
  if (tools.includes("recall_workspace")) fail("control tree registers recall_workspace");
  const treatment = readFileSync(join(REPO_ROOT, "src/mcp/tools.ts"), "utf8");
  if (!treatment.includes("recall_workspace")) fail("treatment tree does not register recall_workspace");
}

function spawnLink(target: string, path: string): void {
  symlinkSync(target, path);
}

function copyDatabase(source: string, dest: string): void {
  if (existsSync(dest)) rmSync(dest);
  mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    db.exec(`VACUUM INTO '${dest.replaceAll("'", "''")}'`);
  } finally {
    db.close();
  }
}

function ensureSeed(): { databasePath: string; tokens: { s1: string; s2: string; s3: string } } {
  const databasePath = join(SEED_DIR, "campfire.db");
  const tokenPath = join(SEED_DIR, "tokens.json");
  if (!existsSync(databasePath) || !existsSync(tokenPath)) fail("seed is missing; run seed.ts explicitly before preflight");
  const tokens = JSON.parse(readFileSync(tokenPath, "utf8")) as { s1: string; s2: string; s3: string };
  for (const key of ["s1", "s2", "s3"] as const) {
    if (typeof tokens[key] !== "string" || !tokens[key].startsWith("cft_")) fail(`seed token ${key} is missing`);
  }
  return { databasePath, tokens };
}

function sortedMap(entries: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(entries).sort());
}

/** Re-derive the set state instead of trusting the response, then compare with the key. */
function assertDecisionSet(facts: ScenarioFacts, recallJson: string, label: string): void {
  const recall = JSON.parse(recallJson) as {
    decisionSet?: {
      state: RecallDecisionSetState;
      members: Array<{ id: string; lifecycle: string; summary: string; summaryTruncated: boolean }>;
      total: number;
      returned: number;
      truncated: boolean;
      operativeDecisionId?: string;
      beforeActing?: string;
      recordedTransitions: Array<{ supersededDecisionId: string; supersedingDecisionId: string }>;
    };
  };
  const set = recall.decisionSet;
  if (set === undefined) fail(`${label} recall has no decisionSet`);
  const derived = deriveDecisionSetState({
    members: set.members,
    recordedTransitions: set.recordedTransitions,
    truncated: set.truncated,
  });
  if (set.state !== derived.state) fail(`${label} set state disagrees with deriveDecisionSetState`);
  if (set.operativeDecisionId !== derived.operativeDecisionId) fail(`${label} set operative id disagrees`);
  if (set.beforeActing !== derived.beforeActing) fail(`${label} set beforeActing disagrees`);
  if (set.state !== facts.set.state) fail(`${label} decision set state is ${set.state}, expected ${facts.set.state}`);
  if (set.total !== Object.keys(facts.set.members).length) fail(`${label} decision set total ${set.total}`);
  if (set.returned !== set.members.length || set.truncated !== false) fail(`${label} decision set truncation`);
  const actual = sortedMap(Object.fromEntries(set.members.map((member) => [member.id, member.lifecycle])));
  if (JSON.stringify(actual) !== JSON.stringify(sortedMap(facts.set.members))) {
    fail(`${label} decision set members ${JSON.stringify(actual)}`);
  }
  if (JSON.stringify(set.recordedTransitions) !== JSON.stringify(facts.set.transitions)) {
    fail(`${label} recorded transitions ${JSON.stringify(set.recordedTransitions)}`);
  }
  if ((set.operativeDecisionId ?? undefined) !== (facts.set.operative ?? undefined)) {
    fail(`${label} operativeDecisionId is ${String(set.operativeDecisionId)}, expected ${String(facts.set.operative)}`);
  }
  if ((set.beforeActing ?? undefined) !== (facts.set.beforeActing ?? undefined)) fail(`${label} beforeActing presence`);
  if (facts.set.beforeActing !== undefined && set.beforeActing !== DECISION_SET_UNRESOLVED_NEXT_STEP) {
    fail(`${label} beforeActing is not the frozen literal`);
  }
  if (facts.set.operative !== undefined && set.operativeDecisionId !== facts.set.operative) {
    fail(`${label} operative decision is not the survivor`);
  }
}

function assertSeedFacts(databasePath: string, tokens: { s1: string; s2: string; s3: string }): void {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  const service = createCampfireService({ store: openReadonlySqliteStore(databasePath) });
  try {
    for (const scenario of Object.keys(SCENARIOS) as Scenario[]) {
      const facts = SCENARIOS[scenario];
      const { id, query, token } = facts;
      const ownerId = id.replace("ws_rcl003_", "hum_rcl003_");
      const actor = service.resolveToken(tokens[token]);
      if (actor.actorId !== ownerId || actor.actorType !== "human") fail(`${scenario} owner token resolves incorrectly`);
      const ctx = { actor };
      const counts = db.prepare("SELECT status, COUNT(*) AS count FROM decisions WHERE workspace_id = ? GROUP BY status").all(id) as Array<{ status: string; count: number }>;
      const countOf = (status: string): number => counts.find((row) => row.status === status)?.count ?? 0;
      if (countOf("accepted") !== facts.counts.accepted || countOf("proposed") !== facts.counts.proposed
        || countOf("superseded") !== facts.counts.superseded) {
        fail(`${scenario} decision counts ${JSON.stringify(counts)}`);
      }

      const orientation = service.getWorkspaceContext(ctx, id);
      const decisionSlice = orientation.slices.decisions;
      if (decisionSlice.total !== facts.orientation.total || decisionSlice.returned !== facts.orientation.returned
        || decisionSlice.truncated !== facts.orientation.truncated) {
        fail(`${scenario} orientation decision page mismatch`);
      }
      if (!decisionSlice.items.some((decision) => decision.id === facts.proposal && decision.status === "proposed")) {
        fail(`${scenario} proposal missing from orientation`);
      }
      if (!orientation.slices.findings.items.some((finding) => finding.id === facts.finding)) {
        fail(`${scenario} current finding missing from orientation`);
      }
      const defaultPage = service.listDecisionsPage(ctx, { workspaceId: id });
      if (defaultPage.returned !== 10) fail(`${scenario} default decision page size drifted`);
      if (facts.counts.superseded > 0 && defaultPage.items.some((decision) => decision.status === "superseded")) {
        fail(`${scenario} superseded decision on the default page`);
      }
      const acceptedRows = db.prepare("SELECT id, updated_at FROM decisions WHERE workspace_id = ? AND status = 'accepted'")
        .all(id) as Array<{ id: string; updated_at: string }>;
      for (const offPageId of facts.offPage) {
        if (decisionSlice.items.some((decision) => decision.id === offPageId) || defaultPage.items.some((decision) => decision.id === offPageId)) {
          fail(`${scenario} ${offPageId} is on a first page`);
        }
        if (orientation.slices.recentChanges.items.some((change) => JSON.stringify(change).includes(offPageId))
          || orientation.provenanceSummary.some((summary) => summary.includes(offPageId))) {
          fail(`${scenario} ${offPageId} leaked into recent changes or provenance`);
        }
        // The unassisted view must lack it for a reason, not by luck: both pages
        // rank accepted decisions by `updated_at DESC, id ASC`, so a keyed
        // decision needs ten strictly newer accepted decisions to be past them.
        const row = db.prepare("SELECT updated_at FROM decisions WHERE id = ?").get(offPageId) as { updated_at: string } | undefined;
        if (row === undefined) fail(`${scenario} ${offPageId} is missing from the database`);
        const newerAccepted = acceptedRows.filter((other) => other.updated_at > row.updated_at).length;
        if (newerAccepted < 10) fail(`${scenario} ${offPageId} has only ${newerAccepted} newer accepted decisions`);
        if (facts.absence !== undefined && JSON.stringify(defaultPage).includes(facts.absence)) {
          fail(`${scenario} absence string leaked into the first decision page`);
        }
      }
      if (facts.absence !== undefined && JSON.stringify(orientation).includes(facts.absence)) {
        fail(`${scenario} absence string leaked into orientation`);
      }
      if (scenario === "S3" && orientation.acceptedDecisions.some((decision) =>
        /(?:fifty|50 rows|rows per run|batch cap)/i.test(`${decision.summary} ${decision.rationale ?? ""}`))) {
        fail("S3 accepted decision states a cap");
      }

      const recall = service.recallWorkspace(ctx, { workspaceId: id, query });
      const recallJson = JSON.stringify(recall);
      if (/(?:https?:\/\/|file:\/\/|\/Users\/|\/private\/|\/tmp\/)/.test(recallJson) || recallJson.includes("uriOrPath")) {
        fail(`${scenario} recall contains an artifact uri or a filesystem path`);
      }
      const hits = [...recall.current.items, ...recall.historical.items, ...recall.artifacts.items];
      for (const offPageId of facts.offPage) {
        const hit = hits.find((row) => row.id === offPageId);
        if (hit === undefined) fail(`${scenario} recall omitted ${offPageId}`);
        if (hit.kind !== "decision") fail(`${scenario} ${offPageId} is not a decision hit`);
      }
      assertDecisionSet(facts, recallJson, scenario);
      // Grouped for safety, not ranked: paging the sections cannot change the set.
      const paged = service.recallWorkspace(ctx, { workspaceId: id, query, limit: 1 });
      if (JSON.stringify(paged.decisionSet?.members.map((member) => member.id))
        !== JSON.stringify(recall.decisionSet?.members.map((member) => member.id))) {
        fail(`${scenario} decision set changed under limit=1`);
      }

      const packetDir = join(PILOT_ROOT, "preflight", scenario);
      mkdirSync(packetDir, { recursive: true, mode: 0o700 });
      const packetPath = join(packetDir, "packet.json");
      const packetDb = join(packetDir, "packet-source.db");
      if (existsSync(packetPath)) rmSync(packetPath);
      copyDatabase(databasePath, packetDb);
      let receipt: string;
      try {
        receipt = writePacket(packetDb, tokens[token], id, query, packetPath).receipt;
      } finally {
        for (const path of [packetDb, `${packetDb}-wal`, `${packetDb}-shm`]) rmSync(path, { force: true });
      }
      const packetText = readFileSync(packetPath, "utf8");
      const packet = JSON.parse(packetText) as CampfireHandoffPacket;
      if (receipt.includes(query) || packetText.includes("cft_") || packetText.includes(REPO_ROOT)
        || packetText.includes("/Users/") || /(?:file|https?):\/\//i.test(packetText)) {
        fail(`${scenario} packet or receipt leaked query, credential, URI, or filesystem path`);
      }
      if (packet.recipient.actorId !== READER_ID || packet.workspace.id !== id) fail(`${scenario} packet boundary mismatch`);
      if (packet.decisionSet?.state !== recall.decisionSet?.state
        || packet.decisionSet?.operativeDecisionId !== recall.decisionSet?.operativeDecisionId
        || packet.decisionSet?.beforeActing !== recall.decisionSet?.beforeActing
        || JSON.stringify(packet.decisionSet?.recordedTransitions) !== JSON.stringify(recall.decisionSet?.recordedTransitions)) {
        fail(`${scenario} packet decision set does not mirror the recall set`);
      }
      for (const member of recall.decisionSet?.members ?? []) {
        const record = packet.decisionSet?.members.find((row) => row.id === member.id);
        if (record?.section !== "decision-set" || record.kind !== "decision" || record.lifecycle !== member.lifecycle
          || record.text !== member.summary) {
          fail(`${scenario} packet set member ${member.id} does not match the recall set`);
        }
      }
      if (facts.absence !== undefined) {
        const owner = facts.absenceOwner ?? facts.offPage[0]!;
        const record = packet.records.find((row) => row.id === owner)
          ?? packet.decisionSet?.members.find((row) => row.id === owner);
        if (record?.rationale?.includes(facts.absence) !== true) {
          fail(`${scenario} packet lacks the off-page rationale for ${owner}`);
        }
      }
      // No keyed off-page decision may reach the packet as an accepted anchor.
      // In S1 and S2 that means the newest ten accepted anchors do not include
      // the decision the correct next action depends on.
      for (const offPageId of facts.offPage) {
        if (packet.anchors.acceptedDecisions.some((row) => row.id === offPageId)) {
          fail(`${scenario} ${offPageId} appears in accepted anchors`);
        }
      }
      if (facts.offPage.length > 0) {
        const anchors = packet.completeness.anchors.acceptedDecisions;
        if (anchors.total !== facts.counts.accepted || anchors.returned !== 10 || anchors.truncated !== true) {
          fail(`${scenario} accepted anchor completeness ${JSON.stringify(anchors)}`);
        }
      }
      if (scenario === "S2") {
        // The survivor is off every first page, so the packet must still carry it
        // as an accepted record and as the resolved decision of the set.
        if (packet.anchors.acceptedDecisions.some((row) => row.id === "dec_rcl003_s2_replacement")) {
          fail("S2 survivor reached the accepted anchors without being on a first page");
        }
        const replacement = packet.records.find((row) => row.id === "dec_rcl003_s2_replacement");
        if (replacement?.lifecycle !== "accepted") fail("S2 survivor is missing from the packet as accepted");
        if (packet.decisionSet?.members.some((row) => row.id === "dec_rcl003_s2_predecessor" && row.lifecycle !== "superseded")) {
          fail("S2 predecessor is not reported as superseded");
        }
      }
      if (scenario === "S3") {
        const proposal = packet.records.find((row) => row.id === facts.proposal)
          ?? packet.anchors.proposedDecisions.find((row) => row.id === facts.proposal);
        if (proposal?.lifecycle !== "proposed") fail("S3 proposal status changed in packet");
      }
      process.stdout.write(`PREFLIGHT_SEED ${scenario} OK\n`);
    }
  } finally {
    service.close();
    db.close();
  }
}

interface ScenarioText {
  task: string;
  query: string;
  continuation: string;
}

function parseScenarios(): Record<Scenario, ScenarioText> {
  const text = readFileSync(join(FIXTURE_DIR, "scenarios.md"), "utf8");
  const parts = text.split(/^## /m).slice(1);
  const found = {} as Record<Scenario, ScenarioText>;
  for (const part of parts) {
    const name = part.startsWith("S1") ? "S1" : part.startsWith("S2") ? "S2" : part.startsWith("S3") ? "S3" : undefined;
    if (name === undefined) continue;
    const task = quoteAfter(part, "Task prompt:");
    const continuation = quoteAfter(part, "Recipient continuation:");
    const queryMatch = part.match(/Recall query: `([^`]+)`/);
    if (queryMatch === null) fail(`${name} query missing`);
    found[name] = { task, query: queryMatch[1]!, continuation };
  }
  for (const name of Object.keys(SCENARIOS) as Scenario[]) {
    if (found[name] === undefined) fail(`scenarios.md is missing ${name}`);
    if (found[name].query !== SCENARIOS[name].query) fail(`${name} query drifted`);
  }
  return found;
}

function quoteAfter(part: string, label: string): string {
  const start = part.indexOf(label);
  if (start < 0) fail(`missing ${label}`);
  const lines = part.slice(start + label.length).split("\n");
  const quoted: string[] = [];
  let seen = false;
  for (const line of lines) {
    if (!seen) {
      if (line.startsWith("> ")) {
        seen = true;
        quoted.push(line.slice(2));
      }
      continue;
    }
    if (line.startsWith("> ")) {
      quoted.push(line.slice(2));
      continue;
    }
    if (line.trim() === "") break;
    break;
  }
  if (quoted.length === 0) fail(`empty ${label}`);
  return quoted.join("\n");
}

function promptFor(arm: Arm, text: ScenarioText): string {
  if (arm === "control") return `${text.task}\n\n${CONTROL_ADDENDUM}`;
  if (arm === "treatment") return `${text.task}\n\nRecall query: ${text.query}\n${TREATMENT_ADDENDUM}`;
  return `${text.continuation}\n\n${RECIPIENT_ADDENDUM}`;
}

function sandboxProfile(runDir: string, arm: Arm = "control"): string {
  const codexRoot = join(homedir(), ".codex");
  if (!existsSync(codexRoot)) fail("host Codex directory is missing");
  const codexEntries = readdirSync(codexRoot, { withFileTypes: true });
  const privateRoots = ["preflight", "probe-ready", "sandbox-check"].map((name) => join(PILOT_ROOT, name));
  const denies = [
    join(REPO_ROOT, "fixtures"),
    join(REPO_ROOT, "docs"),
    join(REPO_ROOT, "evidence"),
    join(REPO_ROOT, ".git"),
    join(homedir(), ".config/opencode"),
    join(homedir(), ".local/share/opencode"),
    join(homedir(), ".local/state/opencode"),
    join(homedir(), ".config/campfire"),
    join(homedir(), ".local/share/campfire"),
    join(homedir(), ".codex/memories"),
    join(homedir(), ".codex/sessions"),
    join(homedir(), ".codex/skills"),
    join(homedir(), ".codex/rules"),
    SEED_DIR,
    ...OLD_PILOT_ROOTS,
  ];
  for (const privateRoot of privateRoots) {
    if (runDir !== privateRoot && !runDir.startsWith(`${privateRoot}/`)) denies.push(privateRoot);
  }
  if (arm !== "control") denies.push(CONTROL_SRC);
  else {
    denies.push(join(CONTROL_SRC, ".git"));
  }
  for (const [scenario, otherArm] of ORDER) {
    const dir = join(RUNS_DIR, `${scenario}-${otherArm}`);
    if (dir !== runDir) denies.push(dir);
    denies.push(`${dir}-invalid`, `${dir}-invalid-2`);
  }
  if (arm === "control") denies.push(join(REPO_ROOT, "src"), join(REPO_ROOT, "dist"));
  // Recipients stay outside the checkout. Matched arms still launch the MCP server from it.
  if (arm === "recipient") {
    denies.push(REPO_ROOT);
    if (REPO_ROOT.toLowerCase() !== REPO_ROOT) denies.push(REPO_ROOT.toLowerCase());
  }
  const lines = ["(version 1)", "(allow default)"];
  for (const path of denies) {
    for (const spelling of pathSpellings(path)) lines.push(`(deny file-read* (subpath ${JSON.stringify(spelling)}))`);
  }
  // The locked Codex binary resolves under ~/.codex/packages. Deny every
  // other current top-level entry, including history, attachments, SQLite
  // state, auth, and global config. The needed auth is copied before launch.
  for (const entry of codexEntries) {
    if (entry.name === "packages") continue;
    const path = join(codexRoot, entry.name);
    for (const spelling of pathSpellings(path)) {
      lines.push(`(deny file-read* (${entry.isDirectory() ? "subpath" : "literal"} ${JSON.stringify(spelling)}))`);
    }
  }
  const writeDenies = new Set([
    REPO_ROOT,
    CONTROL_SRC,
    SEED_DIR,
    ...OLD_PILOT_ROOTS,
    ...privateRoots,
    join(homedir(), ".codex"),
    join(homedir(), ".config/opencode"),
    join(homedir(), ".local/share/opencode"),
  ]);
  for (const [scenario, otherArm] of ORDER) {
    const dir = join(RUNS_DIR, `${scenario}-${otherArm}`);
    if (dir !== runDir) writeDenies.add(dir);
    writeDenies.add(`${dir}-invalid`);
    writeDenies.add(`${dir}-invalid-2`);
  }
  for (const path of writeDenies) {
    if (runDir === path || runDir.startsWith(`${path}/`)) continue;
    for (const spelling of pathSpellings(path)) lines.push(`(deny file-write* (subpath ${JSON.stringify(spelling)}))`);
  }
  lines.push(`(deny file-read* (literal ${JSON.stringify(join(homedir(), ".codex/config.toml"))}))`);
  lines.push(`(deny file-read* (literal ${JSON.stringify(join(homedir(), ".codex/memories_1.sqlite"))}))`);
  lines.push(`(deny file-read* (literal ${JSON.stringify(join(homedir(), ".codex/session_index.jsonl"))}))`);
  const profile = join(runDir, "private", "sandbox.sb");
  mkdirSync(dirname(profile), { recursive: true, mode: 0o700 });
  writeFileSync(profile, `${lines.join("\n")}\n`, { mode: 0o600 });
  return profile;
}

function copyCodexAuth(codexHome: string): void {
  mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  const codexAuth = join(homedir(), ".codex/auth.json");
  if (!existsSync(codexAuth)) fail("Codex auth file is missing");
  const dest = join(codexHome, "auth.json");
  copyFileSync(codexAuth, dest);
  chmodSync(dest, 0o600);
}

function copyOpencodeAuth(opencodeData: string): void {
  mkdirSync(opencodeData, { recursive: true, mode: 0o700 });
  const opencodeAuth = join(homedir(), ".local/share/opencode/auth.json");
  if (!existsSync(opencodeAuth)) fail("OpenCode auth file is missing");
  const dest = join(opencodeData, "auth.json");
  copyFileSync(opencodeAuth, dest);
  chmodSync(dest, 0o600);
  const account = join(homedir(), ".local/share/opencode/account.json");
  if (existsSync(account)) {
    const accountDest = join(opencodeData, "account.json");
    copyFileSync(account, accountDest);
    chmodSync(accountDest, 0o600);
  }
  // Recreate the schema in a new database and copy only allowlisted routing
  // rows. Never back up or VACUUM INTO the global database: that would create
  // a transient copy of private sessions before history could be deleted.
  const sourcePath = join(homedir(), ".local/share/opencode/opencode.db");
  const isolatedPath = join(opencodeData, "opencode.db");
  if (!existsSync(sourcePath) || existsSync(isolatedPath)) fail("OpenCode route source is missing or isolated copy already exists");
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const copy = new Database(isolatedPath);
  try {
    copy.pragma("foreign_keys = OFF");
    const rows = source.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND type IN ('table', 'index', 'trigger', 'view') ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, name").all() as Array<{ type: string; name: string; sql: string }>;
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
    const excluded = rows.filter((row) => row.type === "table" && !allow.has(row.name));
    for (const { name } of excluded) {
      const count = copy.prepare(`SELECT COUNT(*) AS n FROM "${name.replaceAll('"', '""')}"`).get() as { n: number };
      if (count.n !== 0) fail(`isolated OpenCode ${name} retained history`);
    }
  } finally {
    copy.close();
    source.close();
  }
  chmodSync(isolatedPath, 0o600);
}

function writeCodexConfig(
  home: string,
  dbPath?: string,
  token?: string,
  actorId?: string,
  stdio?: string,
): void {
  const lines = [
    `model = ${JSON.stringify(CODEX_MODEL)}`,
    `model_reasoning_effort = ${JSON.stringify(CODEX_REASONING)}`,
    `approval_policy = "never"`,
    `sandbox_mode = "workspace-write"`,
  ];
  if (dbPath !== undefined && token !== undefined && actorId !== undefined && stdio !== undefined) {
    // Local MCP resolves an actor id before it applies the token. The token
    // then replaces that actor, so a missing or mismatched token cannot start.
    lines.push(
      "",
      "[mcp_servers.campfire]",
      `command = ${JSON.stringify(process.execPath)}`,
      `args = [${JSON.stringify(TSX_CLI)}, ${JSON.stringify(stdio)}]`,
      `default_tools_approval_mode = "approve"`,
      "",
      "[mcp_servers.campfire.env]",
      `CAMPFIRE_DB = ${JSON.stringify(dbPath)}`,
      `CAMPFIRE_ACTOR_ID = ${JSON.stringify(actorId)}`,
      `CAMPFIRE_ACTOR_TYPE = "human"`,
      `CAMPFIRE_TOKEN = ${JSON.stringify(token)}`,
    );
  }
  writeFileSync(join(home, "config.toml"), `${lines.join("\n")}\n`, { mode: 0o600 });
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

interface HarnessLaunch {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

function baseEnv(isolatedHome: string, opencodeData: string, codexHome: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    "CAMPFIRE_URL",
    "CAMPFIRE_TOKEN",
    "CAMPFIRE_DB",
    "CAMPFIRE_ACTOR_ID",
    "CAMPFIRE_ACTOR_TYPE",
    "CAMPFIRE_SESSION_ID",
    "CAMPFIRE_HARNESS",
    "CAMPFIRE_CONFIG_DIR",
    "CAMPFIRE_DATA_DIR",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "INIT_CWD",
  ]) {
    delete env[key];
  }
  for (const key of Object.keys(env)) {
    if (key.startsWith("OPENCODE_CONFIG") || key.startsWith("GIT_") || key.startsWith("CAMPFIRE_")) delete env[key];
  }
  env.HOME = isolatedHome;
  env.PATH = `${dirname(process.execPath)}:${env.PATH ?? "/usr/bin:/bin"}`;
  delete env.OLDPWD;
  env.CODEX_HOME = codexHome;
  env.XDG_CONFIG_HOME = join(isolatedHome, ".config");
  env.XDG_DATA_HOME = dirname(opencodeData);
  env.XDG_STATE_HOME = join(isolatedHome, ".local/state");
  return env;
}

function launchFor(input: {
  arm: Arm;
  prompt: string;
  workDir: string;
  eventsPath: string;
  answerPath: string;
  dbPath?: string;
  token?: string;
  actorId?: string;
  isolatedHome: string;
  codexHome: string;
  opencodeData: string;
}): HarnessLaunch {
  const env = baseEnv(input.isolatedHome, input.opencodeData, input.codexHome);
  // OpenCode follows PWD. The parent shell's PWD is the checkout, so set it to the arm directory.
  env.PWD = input.workDir;
  if (input.arm === "recipient") {
    writeOpencodeConfig(input.workDir);
    return {
      command: OPENCODE_BIN,
      args: ["run", "--standalone", "--format", "json", "--auto", "--model", OPENCODE_MODEL, input.prompt],
      cwd: input.workDir,
      env,
    };
  }
  const stdio = input.arm === "control"
    ? join(CONTROL_SRC, "src/mcp/stdio.ts")
    : join(REPO_ROOT, "src/mcp/stdio.ts");
  writeCodexConfig(input.codexHome, input.dbPath, input.token, input.actorId, stdio);
  return {
    command: CODEX_BIN,
    args: [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--ephemeral",
      "-m",
      CODEX_MODEL,
      "-s",
      "workspace-write",
      "-C",
      input.workDir,
      "-o",
      input.answerPath,
      input.prompt,
    ],
    cwd: input.workDir,
    env,
  };
}

function toolCount(arm: Arm, eventsPath: string): number {
  if (!existsSync(eventsPath)) return 0;
  const raw = readFileSync(eventsPath, "utf8");
  if (arm === "recipient") {
    const parsed = parseOpencodeEvents(raw);
    return parsed.mcpCalls.length + parsed.nonMcpToolCalls.length;
  }
  const parsed = parseCodexEvents(raw);
  return parsed.mcpCalls.length + parsed.nonMcpToolCalls.length;
}

function finalAnswer(arm: Arm, eventsPath: string, answerPath: string): string {
  if (arm !== "recipient" && existsSync(answerPath)) {
    const filed = readFileSync(answerPath, "utf8").trim();
    if (filed !== "") return filed;
  }
  if (!existsSync(eventsPath)) return "";
  const raw = readFileSync(eventsPath, "utf8");
  return arm === "recipient" ? parseOpencodeEvents(raw).finalMessage.trim() : parseCodexEvents(raw).finalMessage.trim();
}

interface StopResult {
  stopReason: "completed" | "tool_budget" | "time_budget" | "exit_error";
  exitCode: number | null;
  toolCalls: number;
  startedAt: string;
  finishedAt: string;
}

function runHarness(
  profile: string,
  launch: HarnessLaunch,
  arm: Arm,
  eventsPath: string,
  budget: { minutes: number; toolCalls: number },
): Promise<StopResult> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const out = openSync(eventsPath, "w");
  const err = openSync(`${eventsPath}.err`, "w");
  for (const path of [eventsPath, `${eventsPath}.err`]) chmodSync(path, 0o600);
  // Detached, so the 1 Hz poll signals the whole process group.
  const child = spawn("sandbox-exec", ["-f", profile, launch.command, ...launch.args], {
    cwd: launch.cwd,
    env: launch.env,
    detached: true,
    stdio: ["ignore", out, err],
  });
  const limitMs = budget.minutes * 60_000;
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let stopReason: StopResult["stopReason"] = "completed";
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      closeSync(out);
      closeSync(err);
      resolvePromise({
        stopReason,
        exitCode: code,
        toolCalls: toolCount(arm, eventsPath),
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    };
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearInterval(timer);
        reject(error);
      }
    });
    child.on("exit", (code) => {
      if (code !== 0 && stopReason === "completed") stopReason = "exit_error";
      finish(code);
    });
    const timer = setInterval(() => {
      try {
        const calls = toolCount(arm, eventsPath);
        if (calls >= budget.toolCalls) {
          stopReason = "tool_budget";
          if (child.pid !== undefined) process.kill(-child.pid, "SIGTERM");
        } else if (Date.now() - started >= limitMs) {
          stopReason = "time_budget";
          if (child.pid !== undefined) process.kill(-child.pid, "SIGTERM");
        }
      } catch {
        // The process group can exit between the poll and the signal.
      }
    }, 1000);
  });
}

function writePacket(dbPath: string, token: string, workspaceId: string, query: string, outPath: string): { bytes: number; receipt: string } {
  mkdirSync(dirname(outPath), { recursive: true, mode: 0o700 });
  const env: NodeJS.ProcessEnv = { ...process.env, CAMPFIRE_DB: dbPath, CAMPFIRE_TOKEN: token };
  delete env.CAMPFIRE_URL;
  const result = spawnSync(
    process.execPath,
    [
      TSX_CLI,
      join(REPO_ROOT, "src/cli/index.ts"),
      "handoff-packet",
      workspaceId,
      "--query",
      query,
      "--recipient-type",
      "human",
      "--recipient",
      READER_ID,
      "--out",
      outPath,
      "--output",
      "json",
    ],
    { cwd: REPO_ROOT, env, encoding: "utf8" },
  );
  if (result.status !== 0) fail(`handoff-packet failed: ${(result.stderr || "").slice(0, 400)}`);
  const mode = statSync(outPath).mode & 0o777;
  if (mode !== 0o600) fail(`packet mode is ${mode.toString(8)}`);
  const receipt = result.stdout;
  if (receipt.includes(query)) fail("receipt includes the query");
  return { bytes: statSync(outPath).size, receipt };
}

function prepareArm(scenario: Scenario, arm: Arm, seedDb: string, token: string, text: ScenarioText): string {
  const runDir = join(RUNS_DIR, `${scenario}-${arm}`);
  if (existsSync(runDir)) fail(`refusing to replace existing arm directory ${scenario}-${arm}`);
  const workDir = join(runDir, "work");
  const privateDir = join(runDir, "private");
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  const prompt = promptFor(arm, text);
  writeFileSync(join(runDir, "prompt.txt"), prompt, { mode: 0o600 });
  if (arm === "recipient") {
    const dbCopy = join(privateDir, "packet-source.db");
    copyDatabase(seedDb, dbCopy);
    writePacket(dbCopy, token, SCENARIOS[scenario].id, text.query, join(workDir, "packet.json"));
    for (const path of [dbCopy, `${dbCopy}-wal`, `${dbCopy}-shm`]) rmSync(path, { force: true });
    for (const path of [join(privateDir, "token"), join(privateDir, "campfire.db"), join(privateDir, "codex-home", "auth.json")]) {
      if (existsSync(path)) fail(`recipient private directory contains ${path}`);
    }
  } else {
    copyDatabase(seedDb, join(privateDir, "campfire.db"));
    writeFileSync(join(privateDir, "token"), token, { mode: 0o600 });
  }
  return runDir;
}

function readArmPacket(workDir: string): CampfireHandoffPacket {
  const path = join(workDir, "packet.json");
  if (!existsSync(path)) fail("recipient packet is missing");
  return JSON.parse(readFileSync(path, "utf8")) as CampfireHandoffPacket;
}

/**
 * Did the recipient act on the decision set at all?
 *
 * RCL-003's question is whether surfacing the set as a group changes the next
 * action. An answer that engages no member id, no set state, no operative id,
 * and none of the frozen instruction did not test that, so it is recorded as an
 * evidence-validity flag. The answer is still scored and still reported.
 */
function actsOnDecisionSet(answer: string, packet: CampfireHandoffPacket): boolean {
  const set = packet.decisionSet;
  if (set === undefined || set.members.length === 0) return true;
  for (const member of set.members) {
    if (answer.includes(member.id)) return true;
  }
  if (set.operativeDecisionId !== undefined && answer.includes(set.operativeDecisionId)) return true;
  if (answer.includes(set.state)) return true;
  const lowered = answer.toLowerCase();
  if (set.beforeActing !== undefined) {
    for (const clause of [
      "has not selected an operative decision",
      "do not execute either rule",
      "seek a recorded retirement",
    ]) {
      if (lowered.includes(clause)) return true;
    }
  }
  for (const clause of ["supersedes", "superseded", "already recorded", "accepted replacement", "no accepted decision"]) {
    if (lowered.includes(clause)) return true;
  }
  return false;
}

async function executeArm(scenario: Scenario, arm: Arm, replacement: boolean): Promise<boolean> {
  const runDir = join(RUNS_DIR, `${scenario}-${arm}`);
  const workDir = join(runDir, "work");
  const privateDir = join(runDir, "private");
  const isolatedHome = join(privateDir, "home");
  const codexHome = join(privateDir, "codex-home");
  const opencodeData = join(privateDir, "share", "opencode");
  mkdirSync(isolatedHome, { recursive: true, mode: 0o700 });
  if (arm === "recipient") copyOpencodeAuth(opencodeData);
  else copyCodexAuth(codexHome);
  const profile = sandboxProfile(runDir, arm);
  const eventsPath = join(runDir, "events.jsonl");
  const answerPath = join(runDir, "answer.txt");
  const token = arm === "recipient" ? undefined : readFileSync(join(privateDir, "token"), "utf8").trim();
  const launch = launchFor({
    arm,
    prompt: readFileSync(join(runDir, "prompt.txt"), "utf8"),
    workDir,
    eventsPath,
    answerPath,
    ...(arm === "recipient"
      ? {}
      : {
          dbPath: join(privateDir, "campfire.db"),
          token,
          actorId: SCENARIOS[scenario].id.replace("ws_rcl003_", "hum_rcl003_"),
        }),
    isolatedHome,
    codexHome,
    opencodeData,
  });
  const budget = arm === "recipient" ? RECIPIENT_BUDGET : MATCHED_BUDGET;
  // Read the packet the recipient was actually given, before the harness can
  // touch it, so the decision-set check judges that document and not a
  // rewritten one.
  const packet = arm === "recipient" ? readArmPacket(workDir) : undefined;
  process.stdout.write(`ARM_START ${scenario} ${arm}\n`);
  const stopped = await runHarness(profile, launch, arm, eventsPath, budget);
  const answer = finalAnswer(arm, eventsPath, answerPath);
  if (answer !== "") {
    // Codex writes answer.txt itself with `-o`, so the mode is not ours to set
    // at creation. The captured answer is evidence: force it to 0600.
    writeFileSync(answerPath, `${answer}\n`, { mode: 0o600 });
    chmodSync(answerPath, 0o600);
  }
  const tools = arm === "recipient"
    ? parseOpencodeEvents(existsSync(eventsPath) ? readFileSync(eventsPath, "utf8") : "")
    : parseCodexEvents(existsSync(eventsPath) ? readFileSync(eventsPath, "utf8") : "");
  const bypasses: string[] = [];
  const elapsedMs = Date.parse(stopped.finishedAt) - Date.parse(stopped.startedAt);
  if (stopped.toolCalls > budget.toolCalls) bypasses.push(`tool budget exceeded: ${stopped.toolCalls}/${budget.toolCalls}`);
  if (elapsedMs > budget.minutes * 60_000 + 2_000 && stopped.stopReason !== "time_budget") {
    bypasses.push(`time budget exceeded: ${elapsedMs}ms`);
  }
  if (tools.mcpCalls.some((call) => call.tool === "get_workspace")) bypasses.push("get_workspace used");
  let decisionSetEngaged: boolean | undefined;
  if (arm !== "recipient") {
    for (const call of tools.nonMcpToolCalls) {
      const input = JSON.stringify(call.input ?? {});
      if (/campfire\.db|CAMPFIRE_DB|\/private\/token\b|\/private\/codex-home\b|config\.toml|sqlite3|better-sqlite3/i.test(input)) {
        bypasses.push(`direct private-state access via ${call.tool}`);
      }
    }
  } else {
    if (tools.mcpCalls.length > 0) bypasses.push("recipient called Campfire MCP");
    const packetRead = tools.nonMcpToolCalls.some((call) => JSON.stringify(call.input ?? {}).includes("packet.json"));
    if (!packetRead) bypasses.push("recipient did not read packet.json");
    for (const call of tools.nonMcpToolCalls) {
      const input = JSON.stringify(call.input ?? {});
      if (input.includes(REPO_ROOT) || input.includes(REPO_ROOT.toLowerCase()) || input.includes("Campfire-Internal")) {
        bypasses.push(`recipient attempted checkout access via ${call.tool}`);
      }
    }
    const packetPath = join(workDir, "packet.json");
    if (!existsSync(packetPath)) fail(`${scenario} recipient packet is missing`);
    decisionSetEngaged = actsOnDecisionSet(answer, packet!);
    if (!decisionSetEngaged) bypasses.push("recipient answer did not act on the decision set");
  }
  const meta = {
    scenario,
    arm,
    replacement,
    harness: arm === "recipient" ? "opencode" : "codex",
    model: arm === "recipient" ? OPENCODE_MODEL : CODEX_MODEL,
    reasoning: arm === "recipient" ? undefined : CODEX_REASONING,
    stopReason: stopped.stopReason,
    exitCode: stopped.exitCode,
    toolCalls: stopped.toolCalls,
    elapsedMs,
    campfireTools: tools.mcpCalls.map((call) => call.tool),
    otherTools: tools.nonMcpToolCalls.map((call) => call.tool),
    startedAt: stopped.startedAt,
    finishedAt: stopped.finishedAt,
    answerBytes: Buffer.byteLength(answer),
    recallCalls: tools.mcpCalls.filter((call) => call.tool.includes("recall")).length,
    decisionSetEngaged,
    invalidForScoring: [...new Set(bypasses)],
  };
  writeFileSync(join(runDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`ARM_DONE ${scenario} ${arm} ${stopped.stopReason} tools=${stopped.toolCalls} answerBytes=${meta.answerBytes}\n`);
  if (answer === "") {
    const invalid = `${runDir}-invalid${replacement ? "-2" : ""}`;
    if (existsSync(invalid)) fail(`invalid attempt directory already exists at ${invalid}`);
    renameSync(runDir, invalid);
    process.stdout.write(`ARM_EMPTY ${scenario} ${arm}; invalid attempt kept at ${invalid}\n`);
    return false;
  }
  return true;
}

function sandboxAttempt(profile: string, cwd: string, command: string, args: string[]): { status: number | null; stdout: string } {
  const env = baseEnv(join(dirname(cwd), "private", "home"), join(dirname(cwd), "private", "share", "opencode"), join(dirname(cwd), "private", "codex-home"));
  env.PWD = cwd;
  const result = spawnSync("sandbox-exec", ["-f", profile, command, ...args], { cwd, env, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout || "" };
}

function expectDenied(profile: string, cwd: string, command: string, args: string[], label: string): void {
  const result = sandboxAttempt(profile, cwd, command, args);
  if (result.status === 0 || result.stdout.includes("Correct next action")) fail(`${label} was readable under sandbox`);
}

function expectWriteDenied(profile: string, cwd: string, directory: string, label: string): void {
  const target = join(directory, ".rcl003-preflight-write-probe");
  const result = sandboxAttempt(profile, cwd, "/bin/sh", ["-c", 'printf probe > "$1"', "sh", target]);
  const created = existsSync(target);
  if (created) rmSync(target);
  if (result.status === 0 || created) fail(`${label} was writable under sandbox`);
}

function probeSandbox(packetPath: string): void {
  const keyPath = join(FIXTURE_DIR, "ground-truth.md");
  // A denied git read proves isolation only if the key exists in the object store.
  const baseline = spawnSync("git", ["-C", REPO_ROOT, "show", "HEAD:fixtures/recall/rcl-002/ground-truth.md"], { encoding: "utf8" });
  if (baseline.status !== 0) fail("committed key is missing; cannot prove the git read denial");
  const ownBaseline = spawnSync("git", ["-C", REPO_ROOT, "show", "HEAD:fixtures/recall/rcl-003/ground-truth.md"], { encoding: "utf8" });
  if (ownBaseline.status !== 0) fail("RCL-003 committed key is missing; cannot prove the git read denial");
  for (const root of [join(PILOT_ROOT, "probe-ready")]) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  const invalidPaths = [join(RUNS_DIR, "S1-control-invalid"), join(RUNS_DIR, "S1-control-invalid-2")];
  const otherArmPath = join(RUNS_DIR, "S3-recipient");
  const createdOtherArm = !existsSync(otherArmPath);
  if (createdOtherArm) mkdirSync(otherArmPath, { recursive: true, mode: 0o700 });
  const createdInvalid: string[] = [];
  for (const path of invalidPaths) {
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true, mode: 0o700 });
      createdInvalid.push(path);
    }
  }
  const arms: Arm[] = ["control", "treatment", "recipient"];
  try {
  for (const arm of arms) {
    const runDir = join(PILOT_ROOT, "sandbox-check", arm);
    const workDir = join(runDir, "work");
    mkdirSync(workDir, { recursive: true, mode: 0o700 });
    const profile = sandboxProfile(runDir, arm);
    expectDenied(profile, workDir, "/bin/cat", [keyPath], `${arm} direct key`);
    expectDenied(profile, workDir, "/bin/cat", [keyPath.toLowerCase()], `${arm} lowercase direct key`);
    expectDenied(profile, workDir, "git", ["-C", REPO_ROOT, "show", "HEAD:fixtures/recall/rcl-003/ground-truth.md"], `${arm} git key`);
    expectDenied(profile, workDir, "git", ["-C", REPO_ROOT, "show", "HEAD:fixtures/recall/rcl-002/ground-truth.md"], `${arm} git prior key`);
    for (const root of OLD_PILOT_ROOTS) {
      expectDenied(profile, workDir, "/bin/ls", [root], `${arm} prior pilot ${root}`);
      expectDenied(profile, workDir, "/bin/ls", [root.toLowerCase()], `${arm} lowercase prior pilot ${root}`);
      expectWriteDenied(profile, workDir, root, `${arm} prior pilot ${root}`);
    }
    expectDenied(profile, workDir, "/bin/cat", [packetPath], `${arm} preflight packet`);
    expectDenied(profile, workDir, "/bin/cat", [packetPath.toLowerCase()], `${arm} lowercase preflight packet`);
    expectDenied(profile, workDir, "/bin/ls", [join(PILOT_ROOT, "probe-ready")], `${arm} model probe history`);
    for (const path of invalidPaths) expectDenied(profile, workDir, "/bin/ls", [path], `${arm} invalid attempt`);
    expectDenied(profile, workDir, "/bin/ls", [otherArmPath], `${arm} other arm`);
    expectDenied(profile, workDir, "/bin/ls", [otherArmPath.toLowerCase()], `${arm} lowercase other arm`);
    expectWriteDenied(profile, workDir, otherArmPath, `${arm} other arm`);
    expectWriteDenied(profile, workDir, invalidPaths[0]!, `${arm} invalid attempt`);
    expectDenied(profile, workDir, "/bin/cat", [join(homedir(), ".local/share/opencode/auth.json")], `${arm} host OpenCode auth`);
    expectDenied(profile, workDir, "/bin/ls", [join(homedir(), ".local/share/opencode/opencode.db")], `${arm} host OpenCode database`);
    expectDenied(profile, workDir, "/bin/ls", [join(homedir(), ".config/opencode")], `${arm} host OpenCode config`);
    expectDenied(profile, workDir, "/bin/ls", [join(homedir(), ".local/state/opencode")], `${arm} host OpenCode state`);
    expectDenied(profile, workDir, "/bin/cat", [join(homedir(), ".codex/history.jsonl")], `${arm} host Codex history`);
    expectDenied(profile, workDir, "/bin/cat", [join(homedir(), ".codex/history.jsonl").toLowerCase()], `${arm} lowercase Codex history`);
    expectDenied(profile, workDir, "/bin/cat", [join(homedir(), ".codex/auth.json")], `${arm} host Codex auth`);
    expectWriteDenied(profile, workDir, SEED_DIR, `${arm} seed`);
    expectWriteDenied(profile, workDir, join(PILOT_ROOT, "preflight"), `${arm} preflight`);
    expectWriteDenied(profile, workDir, REPO_ROOT, `${arm} checkout`);
    const source = sandboxAttempt(profile, workDir, "/bin/cat", [join(REPO_ROOT, "src/mcp/stdio.ts")]);
    const controlSource = sandboxAttempt(profile, workDir, "/bin/cat", [join(CONTROL_SRC, "src/mcp/stdio.ts")]);
    if ((arm === "control") !== (controlSource.status === 0)) fail(`${arm} control source visibility is wrong`);
    expectDenied(profile, workDir, "/bin/cat", [join(CONTROL_SRC, ".git")], `${arm} control git pointer`);
    if ((arm === "treatment") !== (source.status === 0)) fail(`${arm} treatment source visibility is wrong`);
    if (arm === "recipient") {
      const copy = join(workDir, "packet.json");
      copyFileSync(packetPath, copy);
      if (sandboxAttempt(profile, workDir, "/bin/cat", [copy]).status !== 0) fail("recipient cannot read packet");
    }
    process.stdout.write(`PREFLIGHT_SANDBOX ${arm} OK\n`);
  }
  } finally {
    for (const path of createdInvalid) rmSync(path, { recursive: true, force: true });
    if (createdOtherArm) rmSync(otherArmPath, { recursive: true, force: true });
  }
}

async function probeModels(): Promise<void> {
  const prompt = "Reply with the single word READY. Do not use tools.";
  for (const arm of ["control", "recipient"] as const) {
    const runDir = join(PILOT_ROOT, "probe-ready", arm);
    rmSync(runDir, { recursive: true, force: true });
    mkdirSync(join(runDir, "work"), { recursive: true, mode: 0o700 });
    const privateDir = join(runDir, "private");
    mkdirSync(privateDir, { recursive: true, mode: 0o700 });
    const codexHome = join(privateDir, "codex-home");
    const opencodeData = join(privateDir, "share", "opencode");
    if (arm === "recipient") copyOpencodeAuth(opencodeData);
    else {
      copyCodexAuth(codexHome);
      writeCodexConfig(codexHome, undefined, undefined, undefined);
    }
    const profile = sandboxProfile(runDir, arm);
    const eventsPath = join(runDir, `${arm}-events.jsonl`);
    const answerPath = join(runDir, `${arm}-answer.txt`);
    const launch = launchFor({
      arm,
      prompt,
      workDir: join(runDir, "work"),
      eventsPath,
      answerPath,
      isolatedHome: join(privateDir, "home"),
      codexHome,
      opencodeData,
    });
    const stopped = await runHarness(profile, launch, arm, eventsPath, { minutes: 2, toolCalls: 8 });
    const answer = finalAnswer(arm, eventsPath, answerPath);
    process.stdout.write(`PROBE_MODEL ${arm} ${stopped.stopReason} exit=${stopped.exitCode} answer=${JSON.stringify(answer.slice(0, 80))}\n`);
    if (stopped.stopReason !== "completed" || stopped.exitCode !== 0 || !answer.toUpperCase().includes("READY")) {
      fail(`${arm} probe did not complete with READY`);
    }
  }
  process.stdout.write("PROBE_DONE\n");
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!["probe", "preflight", "run"].includes(command ?? "") || process.argv.length !== 3) {
    fail("expected probe, preflight, or run with no override flags");
  }
  assertProductTree();
  ensureControlTree();
  const scenarios = parseScenarios();
  const seed = ensureSeed();
  assertSeedFacts(seed.databasePath, seed.tokens);
  const packetPath = join(PILOT_ROOT, "preflight", "S1", "packet.json");
  probeSandbox(packetPath);
  if (command === "probe") {
    await probeModels();
    return;
  }
  await probeModels();
  process.stdout.write("PREFLIGHT_OK\n");
  if (command === "preflight") return;
  for (const [scenario, arm] of ORDER) {
    const name = `${scenario}-${arm}`;
    const runDir = join(RUNS_DIR, name);
    const metaPath = join(RUNS_DIR, name, "meta.json");
    if (existsSync(metaPath)) {
      const existing = JSON.parse(readFileSync(metaPath, "utf8")) as { answerBytes?: number };
      if ((existing.answerBytes ?? 0) > 0) {
        process.stdout.write(`ARM_SKIP ${scenario} ${arm}\n`);
        continue;
      }
    }
    if (existsSync(runDir)) fail(`unfinished arm directory ${name}; inspect it without deleting a completed run`);
    const text = scenarios[scenario];
    const token = seed.tokens[SCENARIOS[scenario].token];
    const firstInvalid = existsSync(`${runDir}-invalid`);
    const secondInvalid = existsSync(`${runDir}-invalid-2`);
    if (secondInvalid) fail(`two empty attempts already exist for ${name}`);
    if (firstInvalid) {
      process.stdout.write(`ARM_RETRY ${name}\n`);
      prepareArm(scenario, arm, seed.databasePath, token, text);
      if (!(await executeArm(scenario, arm, true))) fail(`second empty answer for ${name}`);
      continue;
    }
    prepareArm(scenario, arm, seed.databasePath, token, text);
    if (!(await executeArm(scenario, arm, false))) {
      process.stdout.write(`ARM_RETRY ${name}\n`);
      prepareArm(scenario, arm, seed.databasePath, token, text);
      if (!(await executeArm(scenario, arm, true))) fail(`second empty answer for ${name}`);
    }
  }
  process.stdout.write("PILOT_DONE\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.stdout.write("PILOT_FAILED\n");
  process.exit(1);
});
