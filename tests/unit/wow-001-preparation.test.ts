import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { prepareArm, prepareSecond } from "../../scripts/wow-001/prepare.js";

let root: string;
let previousRoot: string | undefined;
let authSource: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "campfire-wow-001-prep-"));
  previousRoot = process.env.CAMPFIRE_PILOT_ROOT;
  process.env.CAMPFIRE_PILOT_ROOT = root;
  authSource = join(root, "test-auth.json");
  writeFileSync(authSource, "{}\n");
  chmodSync(authSource, 0o600);
});

afterEach(() => {
  if (previousRoot === undefined) delete process.env.CAMPFIRE_PILOT_ROOT;
  else process.env.CAMPFIRE_PILOT_ROOT = previousRoot;
  rmSync(root, { recursive: true, force: true });
});

describe("WOW-001 scored-arm preparation", () => {
  it("creates a fresh S1 record with two distinct private agent credentials", () => {
    const prepared = prepareArm("S1", "control", "pilot-s1-control", { authSource });
    expect(prepared.setupStreamTip).toBe(7);
    const runDir = prepared.runDir;
    const manifest = JSON.parse(readFileSync(join(runDir, "MANIFEST.json"), "utf8")) as {
      files: Array<{ path: string }>;
      sealedMatches: string[];
    };
    expect(manifest.files.some((entry) => entry.path === "scenario.md")).toBe(true);
    expect(manifest.files.every((entry) => entry.path === "scenario.md" || entry.path.startsWith("evidence/"))).toBe(true);
    expect(manifest.sealedMatches).toEqual([]);
    const prompt = readFileSync(join(runDir, "prompt.txt"), "utf8");
    expect(prompt).toContain(prepared.workspaceId);
    expect(prompt).not.toContain("<workspace-id>");
    expect(prompt).not.toContain("get_playbook");
    expect(statSync(join(runDir, "campfire", "agent.token")).mode & 0o777).toBe(0o600);
    expect(statSync(join(runDir, "private", "second.token")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(runDir, "campfire", "agent.token"), "utf8"))
      .not.toBe(readFileSync(join(runDir, "private", "second.token"), "utf8"));
    const db = new Database(join(runDir, "campfire", "campfire.db"), { readonly: true });
    try {
      const participants = db.prepare(
        "SELECT actor_id FROM workspace_participants WHERE workspace_id = ? AND actor_type = 'agent' AND joined_at IS NOT NULL",
      ).all(prepared.workspaceId) as Array<{ actor_id: string }>;
      expect(participants.map((row) => row.actor_id).sort()).toEqual(
        [prepared.firstAgentId, prepared.secondAgentId].sort(),
      );
    } finally {
      db.close();
    }
  });

  it("seeds exactly the S2 prior-shift record with agent-session provenance", () => {
    const prepared = prepareArm("S2", "treatment", "pilot-s2-treatment", { authSource });
    expect(prepared.setupStreamTip).toBe(13);
    expect(prepared.seeded).toBeDefined();
    const prompt = readFileSync(join(prepared.runDir, "prompt.txt"), "utf8");
    expect(prompt).toContain("get_playbook");
    const db = new Database(join(prepared.runDir, "campfire", "campfire.db"), { readonly: true });
    try {
      const findings = db.prepare("SELECT id, created_by_actor_id, agent_session_id FROM findings WHERE workspace_id = ?")
        .all(prepared.workspaceId) as Array<{ id: string; created_by_actor_id: string; agent_session_id: string }>;
      expect(findings).toHaveLength(1);
      expect(findings[0]?.id).toBe(prepared.seeded?.findingId);
      expect(findings[0]?.created_by_actor_id).toBe(prepared.seeded?.priorAgentId);
      expect(findings[0]?.agent_session_id).toBe(prepared.seeded?.sessionId);
      const artifact = db.prepare("SELECT uri_or_path FROM artifacts WHERE id = ?")
        .get(prepared.seeded?.artifactId) as { uri_or_path: string };
      expect(artifact.uri_or_path).toBe("evidence/02-database-dashboard.md");
    } finally {
      db.close();
    }
  });

  it("freezes a consistent database and stages a fresh second-agent run", async () => {
    const first = prepareArm("S1", "control", "pilot-s1-control", { authSource });
    writeFileSync(join(first.runDir, "run-first.json"), JSON.stringify({
      role: "first", scenario: "S1", arm: "control", stopReason: "completed",
      exitCode: 0, overshoot: false, valid: true, toolCallCount: 0, sessionToolCallCount: 0,
    }));
    const second = await prepareSecond("pilot-s1-control", "pilot-s1-control-second", { authSource });
    expect(second.frozenStreamTip).toBe(first.setupStreamTip);
    expect(statSync(join(first.runDir, "frozen.db")).mode & 0o777).toBe(0o444);
    expect(readFileSync(join(second.runDir, "campfire", "agent.token"), "utf8"))
      .toBe(readFileSync(join(first.runDir, "private", "second.token"), "utf8"));
    expect(readFileSync(join(second.runDir, "prompt.txt"), "utf8")).not.toContain("scenario.md");
  });

  it("refuses to hand off an invalid first run", async () => {
    const first = prepareArm("S1", "control", "pilot-invalid", { authSource });
    writeFileSync(join(first.runDir, "run-first.json"), JSON.stringify({
      role: "first", scenario: "S1", arm: "control", stopReason: "tool_budget",
      exitCode: 137, overshoot: false, valid: false, toolCallCount: 3, sessionToolCallCount: 4,
    }));
    await expect(prepareSecond("pilot-invalid", "pilot-invalid-second", { authSource }))
      .rejects.toThrow("invalid attempt");
  });
});
