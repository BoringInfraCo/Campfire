/**
 * WOW-001 contract tests: the shared incident-investigation playbook module and
 * the opt-in CLI surface from
 * docs/Campfire-v1.13-WOW-001-Prove-a-Way-of-Working.md sections 4.1-4.3, 5, 6.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../../src/cli/args.js";
import {
  commandDiscoverable,
  discoverableCommandNames,
  formatUsage,
} from "../../src/cli/catalog.js";
import { runCliEntry } from "../../src/cli/index.js";
import { ValidationError } from "../../src/domain/errors.js";
import { INCIDENT_INVESTIGATION_PLAYBOOK } from "../../src/playbooks/incident-investigation.js";
import {
  PLAYBOOKS,
  getPlaybook,
  listPlaybooks,
  playbookEnabled,
} from "../../src/playbooks/index.js";

const STAGE_IDS = [
  "frame",
  "facts",
  "hypotheses",
  "corrections",
  "converge",
  "decide",
  "continuable",
];

/** Each stage's required semantics from contract section 4.1, pinned as text. */
const STAGE_PHRASES: Record<string, readonly string[]> = {
  frame: [
    "Reuse the incident goal or create one.",
    "summary states the user-visible failure",
    "impact, affected surface, start and latest observed time, and scope",
    "Register the alert, log excerpt, or report as an artifact",
    "Never state a cause in the symptom finding.",
  ],
  facts: [
    "Record each observed fact as its own finding as it is learned.",
    "detail carries the observation time and the exact signal.",
    "Cite evidence promptly",
    "Do not merge inference into a fact.",
  ],
  hypotheses: [
    "with confidence and a detail that states what would confirm or refute it",
    "A hypothesis is never stated as fact.",
    "Record the step that tests it as a task; record the result as a new finding or a correction.",
  ],
  corrections: [
    "correct or withdraw it through the existing path with a reason",
    "Never silently overwrite a record and never leave a refuted hypothesis current.",
    "propose a new decision with replacesDecisionId",
    "Retire a choice through retire_decision with a reason.",
  ],
  converge: [
    "Record the cause as a finding with confidence and cited evidence.",
    "If the evidence is inconclusive, say so explicitly and record what remains unknown and what test would resolve it.",
    "Never present an uncited cause as fact.",
  ],
  decide: [
    "Propose the response as a decision with rationale and basis citations",
    "Acceptance requires explicit approval from an authorized actor; never approve your own proposal automatically.",
    "A replacement names its predecessor and, if accepted, records the reason.",
  ],
  continuable: [
    "Record follow-up work as tasks with assignees where known.",
    "Check that the workspace answers: what happened, what is believed, what response is proposed or approved, what is next, what is uncertain.",
    "Do not paste transcripts or unrelated conversation into state.",
  ],
};

let dir: string;
let dbPath: string;
let logs: string[];
let errors: string[];

const previousEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "CAMPFIRE_PLAYBOOK",
  "CAMPFIRE_OUTPUT",
  "CAMPFIRE_URL",
  "CAMPFIRE_TOKEN",
  "CAMPFIRE_DB",
];

function stdout(): string {
  return logs.join("\n");
}

function stderr(): string {
  return errors.join("\n");
}

function entry(args: string[]): Promise<number> {
  return runCliEntry(["--db", dbPath, ...args]);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campfire-wow-001-"));
  dbPath = join(dir, "campfire.db");
  logs = [];
  errors = [];
  for (const key of ENV_KEYS) {
    previousEnv[key] = process.env[key];
    delete process.env[key];
  }
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  for (const key of ENV_KEYS) {
    const value = previousEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("playbook module", () => {
  it("ships the frozen incident-investigation definition", () => {
    const playbook = INCIDENT_INVESTIGATION_PLAYBOOK;
    expect(playbook.kind).toBe("campfire_playbook");
    expect(playbook.schemaVersion).toBe(1);
    expect(playbook.name).toBe("incident-investigation");
    expect(playbook.version).toBe("1.0.0");
    expect(playbook.stages).toHaveLength(7);
    expect(playbook.stages.map((stage) => stage.id)).toEqual(STAGE_IDS);
    for (const stage of playbook.stages) {
      expect(stage.title.length, stage.id).toBeGreaterThan(0);
      expect(stage.guidance.length, stage.id).toBeGreaterThan(0);
    }
    for (const stage of playbook.stages) {
      expect(STAGE_PHRASES[stage.id], stage.id).toBeDefined();
      const text = stage.guidance.join("\n");
      for (const phrase of STAGE_PHRASES[stage.id] ?? []) {
        expect(text, `${stage.id}: ${phrase}`).toContain(phrase);
      }
    }
    expect(playbook.rules).toEqual([
      "One statement per finding and one choice per decision.",
      "Register evidence and cite it promptly through the available operations.",
      "Distinguish observation, inference, and choice.",
      "Record the acting identity and session honestly.",
      "Keep uncertainty visible.",
      "needsReview remains a read-time result and is never faked.",
      "Acceptance of a decision requires explicit approval from an authorized actor; an agent never approves its own proposal automatically.",
    ]);
  });

  it("returns the frozen definition and rejects an unknown name with ValidationError", () => {
    expect(listPlaybooks()).toBe(PLAYBOOKS);
    expect(getPlaybook("incident-investigation")).toBe(INCIDENT_INVESTIGATION_PLAYBOOK);

    let caught: unknown;
    try {
      getPlaybook("sorcery");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).code).toBe("ValidationError");
    expect((caught as ValidationError).message).toContain("Unknown playbook: sorcery");
    expect((caught as ValidationError).details?.available).toEqual(["incident-investigation"]);
  });

  it("enables only on an exact 1 or the MCP flag", () => {
    expect(playbookEnabled({})).toBe(false);
    expect(playbookEnabled({ CAMPFIRE_PLAYBOOK: "1" })).toBe(true);
    expect(playbookEnabled({ CAMPFIRE_PLAYBOOK: " 1 " })).toBe(true);
    expect(playbookEnabled({ CAMPFIRE_PLAYBOOK: "true" })).toBe(false);
    expect(playbookEnabled({ CAMPFIRE_PLAYBOOK: "yes" })).toBe(false);
    expect(playbookEnabled({ CAMPFIRE_PLAYBOOK: "" })).toBe(false);
    expect(playbookEnabled({}, ["--with-playbook"])).toBe(true);
  });

  it("parses --with-playbook as a boolean without consuming a token", () => {
    expect(parseArgs(["--with-playbook"]).flags["with-playbook"]).toBe(true);
    const parsed = parseArgs(["mcp", "--with-playbook", "list"]);
    expect(parsed.flags["with-playbook"]).toBe(true);
    expect(parsed.positionals).toEqual(["list"]);
  });
});

describe("playbook CLI gate closed", () => {
  it("rejects the playbook command and hides it from discovery", async () => {
    const code = await entry(["playbook", "list", "--output", "json"]);
    expect(code).toBe(1);
    const failure = JSON.parse(stderr()) as {
      error: { code: string; message: string };
      next?: Array<{ command: string }>;
    };
    expect(failure.error.code).toBe("ValidationError");
    expect(failure.error.message).toContain("Unknown command");
    expect(failure.next?.some((step) => step.command.includes("playbook")) ?? false).toBe(false);
    expect(stdout()).toBe("");

    logs = [];
    errors = [];
    expect(await entry(["capabilities", "--output", "json"])).toBe(0);
    const manifest = JSON.parse(stdout()) as { commands: Array<{ name: string }> };
    expect(manifest.commands.map((command) => command.name)).not.toContain("playbook");
    expect(stdout()).not.toContain("campfire playbook");

    expect(formatUsage()).not.toContain("campfire playbook");

    expect(await entry(["help", "playbook"])).toBe(1);
    expect(await entry(["playbook", "--help"])).toBe(1);
  });

  it("does not open the CLI gate through the MCP-only flag", async () => {
    const code = await entry(["playbook", "list", "--with-playbook", "--output", "json"]);
    expect(code).toBe(1);
    const failure = JSON.parse(stderr()) as { error: { code: string } };
    expect(failure.error.code).toBe("ValidationError");
  });
});

describe("playbook CLI gate open", () => {
  beforeEach(() => {
    process.env.CAMPFIRE_PLAYBOOK = "1";
  });

  it("adds exactly the playbook command to discovery and the manifest", async () => {
    const disabled = discoverableCommandNames({});
    const enabled = discoverableCommandNames();
    expect(enabled.filter((name) => !disabled.includes(name))).toEqual(["playbook"]);
    expect(commandDiscoverable("playbook")).toBe(true);
    expect(commandDiscoverable("capabilities")).toBe(true);

    expect(await entry(["capabilities", "--output", "json"])).toBe(0);
    const manifest = JSON.parse(stdout()) as { commands: Array<{ name: string }> };
    expect(manifest.commands.map((command) => command.name)).toContain("playbook");
    expect(formatUsage()).toContain("campfire playbook");
  });

  it("lists and returns the frozen definition", async () => {
    expect(await entry(["playbook", "list", "--output", "json"])).toBe(0);
    expect(JSON.parse(stdout())).toEqual({
      kind: "campfire_playbook_list",
      schemaVersion: 1,
      playbooks: [{ name: "incident-investigation", version: "1.0.0" }],
    });

    logs = [];
    expect(await entry(["playbook", "incident-investigation", "--output", "json"])).toBe(0);
    expect(JSON.parse(stdout())).toEqual(JSON.parse(JSON.stringify(INCIDENT_INVESTIGATION_PLAYBOOK)));

    logs = [];
    expect(await entry(["playbook", "incident-investigation", "--output", "human"])).toBe(0);
    expect(stdout()).toContain("Frame");
    expect(stdout()).toContain("Rules:");
    expect(stdout()).toContain("   - ");

    logs = [];
    errors = [];
    expect(await entry(["playbook", "sorcery", "--output", "json"])).toBe(1);
    const failure = JSON.parse(stderr()) as { error: { code: string; message: string } };
    expect(failure.error.code).toBe("ValidationError");
    expect(failure.error.message).toContain("Unknown playbook: sorcery");
    expect(stdout()).toBe("");
  });

  it("reads the static definition without creating a database", async () => {
    const nested = join(dir, "missing", "campfire.db");
    expect(existsSync(nested)).toBe(false);
    expect(await runCliEntry(["--db", nested, "playbook", "list", "--output", "json"])).toBe(0);
    expect(
      await runCliEntry(["--db", nested, "playbook", "incident-investigation", "--output", "json"]),
    ).toBe(0);
    expect(
      await runCliEntry(["--db", nested, "playbook", "incident-investigation", "--output", "human"]),
    ).toBe(0);
    expect(existsSync(nested)).toBe(false);
    expect(existsSync(join(dir, "missing"))).toBe(false);
  });

  it("requires a selector", async () => {
    const code = await entry(["playbook", "--output", "json"]);
    expect(code).toBe(1);
    const failure = JSON.parse(stderr()) as { error: { code: string; message: string } };
    expect(failure.error.code).toBe("ValidationError");
    expect(failure.error.message).toContain("Missing playbook selector");
  });
});
