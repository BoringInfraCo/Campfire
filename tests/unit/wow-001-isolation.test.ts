/**
 * WOW-001 pilot isolation tests.
 *
 * These tests pin the boundary primitives: frozen prompts, run staging
 * outside the repository, sealed-path detection, the playbook env gate,
 * container mounts, image context, and credential redaction. Every sealed
 * file used here is synthetic and created under a temp directory; the real
 * sealed fixtures under fixtures/incidents/wow-001 are never read.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ValidationError } from "../../src/domain/errors.js";
import { parsePilotArgs } from "../../scripts/wow-001/pilot.js";
import {
  AGENT_IMAGE_CONTEXT_ALLOWLIST,
  FIRST_AGENT_PROMPT,
  PROBE_PROMPT,
  REPO_ROOT,
  SECOND_AGENT_PROMPT,
  SEALED_BASENAMES,
  SEALED_RELATIVE_PREFIXES,
  TREATMENT_ADDED_SENTENCE,
  agentDockerfile,
  assertOutsideRepo,
  buildAgentConfig,
  containerEnv,
  containerName,
  containerSpec,
  evaluateGateReport,
  findSealedMatches,
  firstAgentPrompt,
  hasCredentialShape,
  isAllowedContextEntry,
  isSealedPath,
  resolvePilotRoot,
  sanitizeText,
  secondAgentPrompt,
  sha256File,
  stageRun,
  type Arm,
  type GateReport,
  type PromptValues,
  type Role,
  type Scenario,
  type StageRunInput,
} from "../../scripts/wow-001/pilot-lib.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "campfire-wow-001-isolation-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const promptValues: PromptValues = {
  scenarioPath: "/run/scenario",
  workspaceId: "ws_pilot_001",
  deadline: "2026-10-08T00:00:00Z",
};

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

/** Synthetic scenario bundle; no real fixture is ever touched. */
function makeFakeRepo(scenario: Scenario = "S1"): string {
  const repoRoot = join(workDir, "fake-repo");
  const scenarioDir = join(repoRoot, "fixtures", "incidents", "wow-001", scenario);
  writeFile(join(scenarioDir, "scenario.md"), "# Synthetic scenario\n");
  writeFile(join(scenarioDir, "evidence", "a.csv"), "observed,value\nedge,500\n");
  writeFile(join(scenarioDir, "evidence", "nested", "b.txt"), "nested evidence\n");
  writeFile(join(scenarioDir, "ground-truth.md"), "SEALED ground truth\n");
  writeFile(join(scenarioDir, "scoring-key.md"), "SEALED scoring key\n");
  writeFile(join(scenarioDir, "setup.md"), "SEALED setup\n");
  return repoRoot;
}

function stageInput(overrides: Partial<StageRunInput> = {}): StageRunInput {
  return {
    repoRoot: makeFakeRepo(),
    pilotRoot: join(workDir, "pilot"),
    scenario: "S1",
    arm: "control",
    role: "first",
    runId: "run-001",
    promptValues,
    ...overrides,
  };
}

describe("frozen prompts", () => {
  it("substitutes every placeholder for the first agent in both arms", () => {
    for (const arm of ["control", "treatment"] as const) {
      const prompt = firstAgentPrompt(arm, promptValues);
      expect(prompt).toContain("/run/scenario/scenario.md");
      expect(prompt).toContain("ws_pilot_001");
      expect(prompt).toContain("2026-10-08T00:00:00Z");
      expect(prompt).not.toMatch(/<scenario-path>|<workspace-id>|<deadline>/);
    }
    expect(FIRST_AGENT_PROMPT).toContain("<scenario-path>");
    expect(FIRST_AGENT_PROMPT).toContain("<workspace-id>");
    expect(FIRST_AGENT_PROMPT).toContain("<deadline>");
  });

  it("differs between arms by exactly the one treatment sentence", () => {
    const control = firstAgentPrompt("control", promptValues);
    const treatment = firstAgentPrompt("treatment", promptValues);
    expect(treatment).toBe(`${control}\n\n${TREATMENT_ADDED_SENTENCE}`);
    expect(treatment.length - control.length).toBe(TREATMENT_ADDED_SENTENCE.length + 2);
    expect(control).not.toContain("get_playbook");
    expect(treatment).toContain("get_playbook");
    expect(treatment.split(TREATMENT_ADDED_SENTENCE)).toHaveLength(2);
  });

  it("substitutes the second-agent prompt without offering the scenario or playbook", () => {
    const prompt = secondAgentPrompt(promptValues);
    expect(prompt).toContain("ws_pilot_001");
    expect(prompt).not.toMatch(/<scenario-path>|<workspace-id>|<deadline>/);
    expect(prompt).not.toContain("get_playbook");
    expect(SECOND_AGENT_PROMPT).toContain("<workspace-id>");
  });

  it("keeps the probe prompt a short, read-only boundary check", () => {
    expect(PROBE_PROMPT.trim().split(/\s+/).length).toBeLessThan(200);
    expect(PROBE_PROMPT).toContain("ground-truth.md");
    expect(PROBE_PROMPT).toContain("scoring-key.md");
    expect(PROBE_PROMPT).toContain("setup.md");
    expect(PROBE_PROMPT).toContain("incident-investigation");
    expect(PROBE_PROMPT.toLowerCase()).toContain("write nothing");
  });
});

describe("pilot root and repository boundary", () => {
  it("resolves the pilot root from env or the home default", () => {
    expect(resolvePilotRoot({})).toBe(join(homedir(), ".campfire-pilot", "wow-001"));
    expect(resolvePilotRoot({ CAMPFIRE_PILOT_ROOT: "/tmp/pilot" })).toBe("/tmp/pilot");
  });

  it("exports the repository root", () => {
    expect(REPO_ROOT).toBe(resolve(REPO_ROOT));
    expect(existsSync(join(REPO_ROOT, "package.json"))).toBe(true);
  });

  it("rejects the repository root, its children, and a trailing-separator form", () => {
    expect(() => assertOutsideRepo(REPO_ROOT)).toThrow(ValidationError);
    expect(() => assertOutsideRepo(join(REPO_ROOT, "src", "cli"))).toThrow(ValidationError);
    expect(() => assertOutsideRepo(`${REPO_ROOT}/`)).toThrow(ValidationError);
    expect(() => assertOutsideRepo(join(workDir, "pilot"))).not.toThrow();
  });
});

describe("stageRun", () => {
  it("stages only scenario.md and evidence outside the repo", () => {
    const input = stageInput();
    const result = stageRun(input);

    expect(result.stagedFiles).toEqual([
      "evidence/a.csv",
      "evidence/nested/b.txt",
      "scenario.md",
    ]);
    expect(result.sealedMatches).toEqual([]);
    expect(existsSync(join(result.runDir, "run", "ground-truth.md"))).toBe(false);
    expect(existsSync(join(result.runDir, "run", "scoring-key.md"))).toBe(false);
    expect(existsSync(join(result.runDir, "run", "setup.md"))).toBe(false);

    const prompt = readFileSync(join(result.runDir, "prompt.txt"), "utf8");
    expect(prompt).toBe(firstAgentPrompt("control", promptValues));
    expect(existsSync(join(result.runDir, "run", "prompt.txt"))).toBe(false);
    expect(existsSync(join(result.runDir, "MANIFEST.json"))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(result.runDir, "MANIFEST.json"), "utf8")) as {
      scenario: string;
      arm: string;
      role: string;
      stagedAt: string;
      files: Array<{ path: string; sha256: string }>;
      sealedMatches: string[];
    };
    expect(manifest.scenario).toBe("S1");
    expect(manifest.arm).toBe("control");
    expect(manifest.role).toBe("first");
    expect(manifest.sealedMatches).toEqual([]);
    expect(manifest.stagedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(manifest.files.map((file) => file.path)).toEqual(result.stagedFiles);
    for (const file of manifest.files) {
      expect(file.sha256).toBe(sha256File(join(result.runDir, "run", ...file.path.split("/"))));
    }
  });

  it("uses the second-agent prompt for the second role", () => {
    const result = stageRun(stageInput({ role: "second", runId: "run-002" }));
    expect(readFileSync(join(result.runDir, "prompt.txt"), "utf8")).toBe(
      secondAgentPrompt(promptValues),
    );
  });

  it("throws and leaves nothing behind when a sealed basename is planted in evidence", () => {
    const input = stageInput();
    writeFile(
      join(input.repoRoot, "fixtures", "incidents", "wow-001", "S1", "evidence", "ground-truth.md"),
      "planted sealed file\n",
    );
    const runDir = join(input.pilotRoot, "runs", input.runId);
    expect(() => stageRun(input)).toThrow(ValidationError);
    expect(existsSync(runDir)).toBe(false);
  });

  it("throws when the run directory already exists", () => {
    const input = stageInput();
    mkdirSync(join(input.pilotRoot, "runs", input.runId), { recursive: true });
    expect(() => stageRun(input)).toThrow(ValidationError);
  });
});

describe("sealed path detection", () => {
  it("matches sealed basenames and relative prefixes on either separator", () => {
    expect(SEALED_BASENAMES).toContain("ground-truth.md");
    expect(SEALED_RELATIVE_PREFIXES).toContain("src/playbooks/");
    expect(isSealedPath("ground-truth.md")).toBe(true);
    expect(isSealedPath("evidence/ground-truth.md")).toBe(true);
    expect(isSealedPath("evidence\\ground-truth.md")).toBe(true);
    expect(isSealedPath("deep/setup.md")).toBe(true);
    expect(isSealedPath("src/playbooks/incident-investigation.ts")).toBe(true);
    expect(isSealedPath("docs/evidence/wow-001/anything.md")).toBe(true);
    expect(isSealedPath("fixtures/incidents/wow-001/README.md")).toBe(true);
    expect(isSealedPath("fixtures/incidents/wow-001/README.md.bak")).toBe(false);
    expect(isSealedPath("src/index.ts")).toBe(false);
    expect(isSealedPath("README.md")).toBe(false);
  });

  it("walks a tree for seeded sealed paths and ignores symlinks", () => {
    const root = join(workDir, "tree");
    const outside = join(workDir, "outside");
    writeFile(join(root, "ground-truth.md"), "sealed\n");
    writeFile(join(root, "src", "playbooks", "incident-investigation.ts"), "sealed\n");
    writeFile(join(root, "docs", "evidence", "wow-001", "note.md"), "sealed\n");
    writeFile(join(root, "fixtures", "incidents", "wow-001", "README.md"), "sealed\n");
    writeFile(join(root, "nested", "deep", "scoring-key.md"), "sealed\n");
    writeFile(join(root, "src", "index.ts"), "open\n");
    writeFile(join(root, "README.md"), "open\n");
    writeFile(join(outside, "sealed-dir", "ground-truth.md"), "sealed outside\n");
    writeFile(join(outside, "ground-truth.md"), "sealed outside\n");
    symlinkSync(join(outside, "sealed-dir"), join(root, "linked-dir"), "dir");
    symlinkSync(join(outside, "ground-truth.md"), join(root, "linked-ground-truth.md"), "file");

    expect(findSealedMatches(root)).toEqual([
      "docs/evidence/wow-001/note.md",
      "fixtures/incidents/wow-001/README.md",
      "ground-truth.md",
      "nested/deep/scoring-key.md",
      "src/playbooks/incident-investigation.ts",
    ]);
    expect(findSealedMatches(join(root, "missing"))).toEqual([]);
  });
});

describe("agent harness config and playbook gate", () => {
  const roles: Role[] = ["first", "second"];
  const arms: Arm[] = ["control", "treatment"];

  it("keeps the config identical for every role and arm", () => {
    const configs = roles.flatMap((role) => arms.map((arm) => buildAgentConfig({ role, arm })));
    for (const config of configs) {
      expect(config).toEqual(configs[0]);
      expect(config.model).toBe("opencode-go/deepseek-v4.1-flash");
      expect(config.share).toBe("disabled");
      const json = JSON.stringify(config);
      expect(json).not.toContain("CAMPFIRE_PLAYBOOK");
      expect(json).not.toContain("--with-playbook");
    }
  });

  it("points real runs at the mounted database and token file", () => {
    const config = buildAgentConfig({
      role: "first",
      arm: "control",
      campfireDb: "/campfire/campfire.db",
      campfireTokenFile: "/campfire/agent.token",
    });
    const mcp = config.mcp as { campfire: { environment: Record<string, string> } };
    expect(mcp.campfire.environment).toEqual({
      CAMPFIRE_DB: "/campfire/campfire.db",
      CAMPFIRE_TOKEN: "{file:/campfire/agent.token}",
      CAMPFIRE_ACTOR_TYPE: "agent",
    });
    expect(JSON.stringify(config)).not.toContain("CAMPFIRE_PLAYBOOK");
  });

  it("gates CAMPFIRE_PLAYBOOK to the treatment first agent only", () => {
    expect(containerEnv({ role: "first", arm: "control" })).toEqual({ HOME: "/home/agent" });
    expect(containerEnv({ role: "first", arm: "treatment" })).toEqual({
      HOME: "/home/agent",
      CAMPFIRE_PLAYBOOK: "1",
    });
    expect(containerEnv({ role: "second", arm: "control" })).toEqual({ HOME: "/home/agent" });
    expect(containerEnv({ role: "second", arm: "treatment" })).toEqual({ HOME: "/home/agent" });
    expect(
      containerEnv({ role: "first", arm: "treatment", baseEnv: { FOO: "bar", HOME: "/tmp/wrong" } }),
    ).toEqual({ FOO: "bar", HOME: "/home/agent", CAMPFIRE_PLAYBOOK: "1" });
  });

  it("mounts the scenario read-only for first agents and never exposes the repo", () => {
    const runRoot = join(workDir, "pilot", "runs", "run-001");
    const first = containerSpec({
      imageTag: "campfire-agent:test",
      runId: "run-001",
      runRoot,
      role: "first",
      arm: "control",
    });
    const treatmentFirst = containerSpec({
      imageTag: "campfire-agent:test",
      runId: "run-001",
      runRoot,
      role: "first",
      arm: "treatment",
    });
    const second = containerSpec({
      imageTag: "campfire-agent:test",
      runId: "run-001",
      runRoot,
      role: "second",
      arm: "treatment",
    });

    expect(first.slice(0, 3)).toEqual(["run", "--init", "--name"]);
    expect(first.at(-1)).toBe("campfire-agent:test");
    expect(first.join(" ")).toContain(`type=bind,src=${join(runRoot, "run")},dst=/run,readonly`);
    expect(first).toContain("HOME=/home/agent");
    expect(first.join(" ")).not.toContain("CAMPFIRE_PLAYBOOK=1");
    expect(treatmentFirst.join(" ")).toContain("CAMPFIRE_PLAYBOOK=1");

    expect(second.join(" ")).not.toContain("dst=/run");
    expect(second.join(" ")).toContain(`type=bind,src=${join(runRoot, "campfire")},dst=/campfire`);
    expect(second.join(" ")).not.toContain("CAMPFIRE_PLAYBOOK=1");
    expect(second.join(" ")).toContain("HOME=/home/agent");

    const sources = [...first, ...second]
      .filter((arg) => arg.startsWith("type=bind,"))
      .map((arg) => arg.split(",").find((part) => part.startsWith("src="))?.slice(4) ?? "");
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source.startsWith(REPO_ROOT)).toBe(false);
    }
  });
});

describe("agent image context and Dockerfile", () => {
  it("allows only package manifests and dist", () => {
    expect(AGENT_IMAGE_CONTEXT_ALLOWLIST).toEqual(["package.json", "package-lock.json", "dist"]);
    expect(isAllowedContextEntry("package.json")).toBe(true);
    expect(isAllowedContextEntry("package-lock.json")).toBe(true);
    expect(isAllowedContextEntry("dist")).toBe(true);
    expect(isAllowedContextEntry("dist/src/cli/index.js")).toBe(true);
    expect(isAllowedContextEntry("./dist/x.js")).toBe(true);
    expect(isAllowedContextEntry("src/index.ts")).toBe(false);
    expect(isAllowedContextEntry("fixtures/incidents/wow-001/S1/scenario.md")).toBe(false);
    expect(isAllowedContextEntry("dist-backup/x.js")).toBe(false);
    expect(isAllowedContextEntry("package.json.bak")).toBe(false);
    expect(isAllowedContextEntry("dist/../src/x.ts")).toBe(false);
    expect(isAllowedContextEntry("")).toBe(false);
  });

  it("builds a self-contained image pinned to the lock versions", () => {
    const dockerfile = agentDockerfile();
    expect(dockerfile).toContain("FROM node:22-bookworm");
    expect(dockerfile).toContain("ENV HOME=/home/agent");
    expect(dockerfile).toContain("useradd -m -d /home/agent -s /bin/bash agent");
    expect(dockerfile).toContain(
      "npm ci --omit=dev --ignore-scripts && npm rebuild better-sqlite3",
    );
    expect(dockerfile).toContain("opencode-ai@1.18.35");
    expect(dockerfile).toContain("exec node /opt/campfire/dist/src/cli/index.js");
    expect(dockerfile).toContain("USER agent");
    expect(dockerfile).toContain("WORKDIR /run");
    expect(dockerfile).toContain("campfire --help >/dev/null && opencode --version");
    expect(dockerfile).not.toContain(REPO_ROOT);
  });
});

describe("container naming", () => {
  it("derives the probed and removed container name from the run identity", () => {
    expect(containerName("run-001", "first", "control")).toBe(
      "campfire-wow001-run-001-first-control",
    );
    expect(containerName("run 001/x", "second", "treatment")).toBe(
      "campfire-wow001-run-001-x-second-treatment",
    );
  });
});

describe("probe-gates evaluation", () => {
  function gateReport(overrides: Partial<GateReport> = {}): GateReport {
    return {
      tools: ["get_workspace"],
      hasGetPlaybook: false,
      flagTools: ["get_workspace", "get_playbook"],
      flagHasGetPlaybook: true,
      playbookCli: { exitCode: 1, stdout: "" },
      playbookFlagCli: { exitCode: 1, stdout: "" },
      capabilities: {
        exitCode: 0,
        stdout: JSON.stringify({
          kind: "cli_command_manifest",
          commands: [{ name: "status" }, { name: "capabilities" }],
        }),
      },
      ...overrides,
    };
  }

  it("passes a closed control whose flag-only MCP path still lists get_playbook", () => {
    expect(evaluateGateReport(gateReport(), "control")).toEqual({ ok: true, failures: [] });
  });

  it("fails a control that leaks the playbook through any surface", () => {
    const result = evaluateGateReport(
      gateReport({
        tools: ["get_workspace", "get_playbook"],
        hasGetPlaybook: true,
        flagHasGetPlaybook: false,
        playbookCli: { exitCode: 0, stdout: JSON.stringify({ kind: "campfire_playbook_list" }) },
        capabilities: {
          exitCode: 0,
          stdout: JSON.stringify({
            kind: "cli_command_manifest",
            commands: [{ name: "status" }, { name: "playbook" }],
          }),
        },
      }),
      "control",
    );
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(4);
  });

  it("passes a treatment whose env path opens MCP and CLI", () => {
    const result = evaluateGateReport(
      gateReport({
        hasGetPlaybook: true,
        playbookCli: {
          exitCode: 0,
          stdout: JSON.stringify({
            kind: "campfire_playbook_list",
            schemaVersion: 1,
            playbooks: [{ name: "incident-investigation", version: "1.0.0" }],
          }),
        },
        playbookFlagCli: { exitCode: 0, stdout: "{}" },
        capabilities: {
          exitCode: 0,
          stdout: JSON.stringify({
            kind: "cli_command_manifest",
            commands: [{ name: "status" }, { name: "playbook" }],
          }),
        },
      }),
      "treatment",
    );
    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("fails a treatment whose env path does not open the gates", () => {
    const result = evaluateGateReport(gateReport(), "treatment");
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(4);
  });
});

describe("parsePilotArgs", () => {
  it("parses a command, --flag value pairs, and boolean flags", () => {
    expect(parsePilotArgs([])).toEqual({ command: undefined, flags: {}, positionals: [] });
    expect(
      parsePilotArgs(["probe-agent", "--run-id", "run-001", "--arm", "control", "--role", "first"]),
    ).toEqual({
      command: "probe-agent",
      flags: { "run-id": "run-001", arm: "control", role: "first" },
      positionals: [],
    });
    expect(parsePilotArgs(["build-image", "--dry-run"])).toEqual({
      command: "build-image",
      flags: { "dry-run": true },
      positionals: [],
    });
  });
});

describe("credential redaction", () => {
  it("redacts home, repo, and credential shapes", () => {
    const homeDir = "/Users/pilot";
    const repoRoot = "/Users/pilot/work/campfire";
    const raw = [
      `home=${homeDir}/logs/run.txt`,
      `repo=${repoRoot}/src/secret.ts`,
      "token cft_AbC123def",
      "key sk-live_ABC-123",
      "auth Bearer abc.def-123_XYZ",
    ].join("\n");

    const clean = sanitizeText(raw, { homeDir, repoRoot });
    expect(clean).toContain("home=<home>/logs/run.txt");
    expect(clean).toContain("repo=<repo>/src/secret.ts");
    expect(clean).not.toContain("cft_AbC123def");
    expect(clean).not.toContain("sk-live_ABC-123");
    expect(clean).not.toContain("Bearer abc.def-123_XYZ");
    expect(clean.match(/<redacted>/g)).toHaveLength(3);
    expect(hasCredentialShape(clean)).toBe(false);
  });

  it("detects credential shapes before redaction", () => {
    expect(hasCredentialShape("token cft_AbC123def")).toBe(true);
    expect(hasCredentialShape("key sk-live_ABC-123")).toBe(true);
    expect(hasCredentialShape("auth Bearer abc.def-123_XYZ")).toBe(true);
    expect(hasCredentialShape("nothing secret here")).toBe(false);
  });
});
