/** Whitelisted, sanitized WOW-001 pilot evidence. Never exports token tables. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  REPO_ROOT,
  hasCredentialShape,
  resolvePilotRoot,
  sanitizeText,
  sha256File,
} from "./pilot-lib.js";

const RUNS = [
  "s1-control-pilot1", "s1-treatment-pilot1",
  "s2-treatment-pilot1", "s2-control-pilot1",
  "s3-control-pilot1", "s3-treatment-pilot1",
] as const;

const outputRoot = join(REPO_ROOT, "docs", "evidence", "wow-001", "runs");
const sourceRoot = join(resolvePilotRoot(), "runs");
const replaceExisting = process.argv.includes("--replace");

function safeWrite(path: string, value: string): void {
  const sanitized = sanitizeText(value, { homeDir: homedir(), repoRoot: REPO_ROOT });
  if (hasCredentialShape(sanitized)) throw new Error(`Credential shape remains in ${path}`);
  writeFileSync(path, sanitized, "utf8");
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function toolEvents(path: string): Array<{ tool: string; status: string }> {
  return readFileSync(path, "utf8").trim().split("\n").flatMap((line) => {
    const parsed = JSON.parse(line) as {
      type?: string;
      part?: { tool?: string; state?: { status?: string } };
    };
    return parsed.type === "tool_use" && typeof parsed.part?.tool === "string"
      ? [{ tool: parsed.part.tool, status: parsed.part.state?.status ?? "unknown" }]
      : [];
  });
}

function textEvents(path: string): string[] {
  return readFileSync(path, "utf8").trim().split("\n").flatMap((line) => {
    const parsed = JSON.parse(line) as { type?: string; part?: { text?: string } };
    return parsed.type === "text" && typeof parsed.part?.text === "string"
      ? [parsed.part.text]
      : [];
  });
}

function workspaceExport(path: string, workspaceId: string): Record<string, unknown> {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const inWorkspace = (table: string): unknown[] =>
      db.prepare(`SELECT * FROM ${table} WHERE workspace_id = ? ORDER BY id`).all(workspaceId);
    const first = (table: string): unknown[] =>
      db.prepare(`SELECT * FROM ${table} WHERE workspace_id = ? ORDER BY append_position`).all(workspaceId);
    const byFinding = (table: string): unknown[] =>
      db.prepare(`SELECT * FROM ${table} WHERE finding_id IN (SELECT id FROM findings WHERE workspace_id = ?) ORDER BY rowid`).all(workspaceId);
    const byDecision = (table: string): unknown[] =>
      db.prepare(`SELECT * FROM ${table} WHERE decision_id IN (SELECT id FROM decisions WHERE workspace_id = ?) ORDER BY rowid`).all(workspaceId);
    const tip = db.prepare(
      "SELECT COALESCE(MAX(append_position), 0) AS tip FROM contributions WHERE workspace_id = ?",
    ).get(workspaceId) as { tip: number };
    return {
      workspaceId,
      streamTip: tip.tip,
      goals: inWorkspace("goals"),
      agentSessions: inWorkspace("agent_sessions"),
      findings: inWorkspace("findings"),
      findingEvidence: inWorkspace("finding_evidence"),
      findingTransitions: byFinding("finding_transitions"),
      decisions: inWorkspace("decisions"),
      decisionCitations: inWorkspace("decision_citations"),
      decisionTransitions: byDecision("decision_transitions"),
      tasks: inWorkspace("tasks"),
      artifacts: inWorkspace("artifacts"),
      contributions: first("contributions"),
    };
  } finally {
    db.close();
  }
}

for (const runId of RUNS) {
  const source = join(sourceRoot, runId);
  const second = join(sourceRoot, `${runId}-second`);
  const target = join(outputRoot, runId);
  if (existsSync(target) && !replaceExisting) throw new Error(`Evidence already exists: ${target}`);
  const prep = readJson(join(source, "prepare.json"));
  const first = readJson(join(source, "run-first.json"));
  const secondPrep = readJson(join(second, "prepare-second.json"));
  const secondRun = readJson(join(second, "run-second.json"));
  if (first.valid !== true || secondRun.valid !== true) throw new Error(`Invalid run: ${runId}`);
  const workspaceId = prep.workspaceId;
  if (typeof workspaceId !== "string" || workspaceId !== secondPrep.workspaceId) {
    throw new Error(`Workspace mismatch: ${runId}`);
  }
  const frozen = join(source, "frozen.db");
  const exported = workspaceExport(frozen, workspaceId);
  if (exported.streamTip !== secondPrep.frozenStreamTip) {
    throw new Error(`Frozen stream tip mismatch: ${runId}`);
  }
  const firstEvents = toolEvents(join(source, "run-first.jsonl"));
  const secondEvents = toolEvents(join(second, "run-second.jsonl"));
  const counts = (events: typeof firstEvents): Record<string, number> =>
    Object.fromEntries([...new Set(events.map((event) => event.tool))].sort().map((tool) => [
      tool, events.filter((event) => event.tool === tool).length,
    ]));
  const fetches = firstEvents.filter((event) =>
    event.tool === "campfire_get_playbook" && event.status === "completed").length;
  const firstText = textEvents(join(source, "run-first.jsonl"));
  const secondText = textEvents(join(second, "run-second.jsonl"));
  mkdirSync(target, { recursive: true });
  safeWrite(join(target, "workspace.json"), `${JSON.stringify(exported, null, 2)}\n`);
  safeWrite(join(target, "first-answer.md"), `${firstText.join("\n\n") || "(no text event)"}\n`);
  safeWrite(join(target, "second-answer.md"), `${secondText.join("\n\n") || "(no text event)"}\n`);
  safeWrite(join(target, "receipt.json"), `${JSON.stringify({
    runId,
    scenario: prep.scenario,
    arm: prep.arm,
    model: prep.model,
    harness: "OpenCode 1.18.35",
    imageId: "sha256:349b90635fd4b584599aba5e01f989f44c38689f857eb217b1fbcb3fc078943a",
    workspaceId,
    firstAgentId: prep.firstAgentId,
    secondAgentId: prep.secondAgentId,
    seeded: prep.seeded ?? null,
    setupStreamTip: prep.setupStreamTip,
    frozenStreamTip: exported.streamTip,
    stagedManifestSha256: sha256File(join(source, "MANIFEST.json")),
    first,
    second: secondRun,
    firstTools: counts(firstEvents),
    secondTools: counts(secondEvents),
    playbookFetches: fetches,
    firstTextEvents: firstText.length,
    secondTextEvents: secondText.length,
  }, null, 2)}\n`);
  const firstLog = readFileSync(join(source, "run-first.log"), "utf8");
  const secondLog = readFileSync(join(second, "run-second.log"), "utf8");
  safeWrite(join(target, "first.log"), firstLog);
  safeWrite(join(target, "second.log"), secondLog);
  console.log(`${runId}: tip ${exported.streamTip}, first ${firstEvents.length} tools, second ${secondEvents.length} tools, fetches ${fetches}`);
}
