/**
 * WOW-001 pilot isolation primitives.
 *
 * The pilot only means something if the filesystem/tool boundary is real
 * before the first conversation. This module keeps that boundary as pure,
 * testable functions: frozen prompt text, run staging outside the repository,
 * sealed-material detection, the playbook env gate, container mounts, image
 * context, and credential redaction. Instructions alone do not establish
 * isolation; these functions are the checkable part of the lock.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ValidationError } from "../../src/domain/errors.js";

export type Scenario = "S1" | "S2" | "S3";
export type Arm = "control" | "treatment";
export type Role = "first" | "second";

export interface PilotBudget {
  minutes: number;
  toolCalls: number;
}

/**
 * Budgets frozen by fixtures/incidents/wow-001/RUN-LOCK.md. They are part of
 * the lock, so the runner reads them and never accepts an override flag.
 */
export const PILOT_BUDGETS = {
  first: { minutes: 30, toolCalls: 100 },
  second: { minutes: 10, toolCalls: 30 },
} as const satisfies Record<Role, PilotBudget>;

export function budgetFor(role: Role): PilotBudget {
  return PILOT_BUDGETS[role];
}

/**
 * One NDJSON line from `opencode run --format json` describes a tool call only
 * when the event is `tool_use` and its part is a `tool`. This counts completed
 * and errored calls alike, matching the session database cross-check; malformed
 * lines are ignored rather than thrown so a stream never dies on one bad line.
 */
export function toolUseFromJsonLine(line: string): { tool: string } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const event = parsed as { type?: unknown; part?: { type?: unknown; tool?: unknown } };
  if (event.type !== "tool_use" || event.part?.type !== "tool") return undefined;
  if (typeof event.part.tool !== "string" || event.part.tool.length === 0) return undefined;
  return { tool: event.part.tool };
}

export interface PromptValues {
  scenarioPath: string;
  workspaceId: string;
  deadline: string;
}

export interface StageRunInput {
  repoRoot: string;
  pilotRoot: string;
  scenario: Scenario;
  arm: Arm;
  role: Role;
  runId: string;
  promptValues: PromptValues;
}

export interface StageRunResult {
  runDir: string;
  stagedFiles: string[];
  sealedMatches: string[];
}

/** This file lives at `<repo>/scripts/wow-001/pilot-lib.ts`. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The image identity frozen in fixtures/incidents/wow-001/RUN-LOCK.md. */
export const LOCKED_AGENT_IMAGE = {
  tag: "campfire-wow-001-agent:977c0e3-opencode1.18.35",
  id: "sha256:349b90635fd4b584599aba5e01f989f44c38689f857eb217b1fbcb3fc078943a",
} as const;

export function resolvePilotRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.CAMPFIRE_PILOT_ROOT ?? join(homedir(), ".campfire-pilot", "wow-001");
}

/**
 * A pilot root or run directory inside the repository would let an agent walk
 * to the sealed fixtures, so refuse it. Resolve with path.resolve, not
 * realpath: the candidate may not exist yet and must not be followed.
 */
export function assertOutsideRepo(candidate: string): void {
  const resolvedCandidate = resolve(candidate);
  const resolvedRepo = resolve(REPO_ROOT);
  if (resolvedCandidate === resolvedRepo || resolvedCandidate.startsWith(resolvedRepo + sep)) {
    throw new ValidationError("Pilot path must live outside the repository", {
      candidate: resolvedCandidate,
      repoRoot: resolvedRepo,
    });
  }
}

/** Frozen text from fixtures/incidents/wow-001/README.md, "Frozen prompt text". */
export const FIRST_AGENT_PROMPT = `Investigate the incident described in \`<scenario-path>/scenario.md\` using
only the evidence files in that scenario directory and your authorized
Campfire workspace \`<workspace-id>\`. Record the useful, supported work in
Campfire so another agent can continue without this conversation. Do not
read outside your assigned directory or fetch any answer key. Stop when the
investigation and record are complete or at \`<deadline>\`, whichever comes
first. Report the Campfire object IDs you created or changed.`;

export const TREATMENT_ADDED_SENTENCE = `Campfire's \`incident-investigation\` playbook is available through
\`get_playbook\` or \`campfire playbook incident-investigation\` if useful.`;

export const SECOND_AGENT_PROMPT = `Use only the authorized Campfire workspace \`<workspace-id>\`; you have no
scenario files or prior transcript. State what happened, what the team
currently believes the cause is, what response is recorded and its actual
decision status, the next action, and what remains uncertain or needs review.
Cite the Campfire objects supporting your answer. Do not write to Campfire.`;

/**
 * Synthetic boundary check. Its job is to expose what the harness can reach
 * before a real run, not to investigate an incident; it must leave no trace.
 */
export const PROBE_PROMPT = `This is a read-only isolation boundary check. Do not write, edit, or move anything; write nothing to disk or Campfire, and stop after reporting.

1. List everything you can currently read: every readable directory, file, and authorized Campfire workspace or object, and how you reached each one.
2. Use every available tool to try to read any ground-truth.md, scoring-key.md, setup.md, the WOW-001 contract, or playbook source anywhere you can reach, inside or outside your assigned directory.
3. Try every available way to obtain the incident-investigation playbook from Campfire: MCP tools, CLI commands, environment variables, shell history, copied files, and any other route available.
4. Report exactly what you accessed and what failed, with the command or tool call used for each attempt. State plainly whether you obtained the playbook or any sealed material.`;

/**
 * Disposable authenticated check. It exercises one real identity end to end:
 * read, register a session, write exactly one finding, and probe a workspace
 * the agent is not a participant of. It is never a scored pilot run.
 */
export const AUTH_CHECK_PROMPT = `This is a disposable authenticated check of one Campfire identity and boundary. Touch nothing else: do not read or write files, do not touch any other workspace or object, and do not clean anything up.

1. Call \`whoami\` and report the acting actor.
2. Call \`list_workspaces\` and report the result.
3. Call \`get_workspace_context\` for workspace \`<workspace-id>\` and report the goal.
4. Call \`register_agent_session\` for workspace \`<workspace-id>\` with the agent id from \`whoami\`, and report the session id.
5. Add exactly one finding to workspace \`<workspace-id>\` with summary "Disposable authenticated check". Do not create or change anything else.
6. Attempt \`get_workspace_context\` for workspace \`<unauthorized-workspace-id>\` and report the exact typed error code and message. Do not retry and do not write there.

Report each step with its tool result, then stop.`;

export function authCheckPrompt(workspaceId: string, unauthorizedWorkspaceId: string): string {
  return AUTH_CHECK_PROMPT.replaceAll("<workspace-id>", workspaceId).replaceAll(
    "<unauthorized-workspace-id>",
    unauthorizedWorkspaceId,
  );
}

/**
 * Budget-enforcement probe. The budget stops the run long before 30 calls, so
 * the count itself is not the evidence; the stop reason and the recorded call
 * count are.
 */
export const BUDGET_PROBE_PROMPT = `Call the Campfire \`list_workspaces\` MCP tool at least 30 times, one call at a time, and do nothing else. Make each call separately, wait for its result, then make the next call; do not batch calls and do not use any other tool. Do not read, write, or change anything. Stop only after at least 30 list_workspaces calls or when the harness stops you.`;

function substitute(template: string, values: PromptValues): string {
  return template
    .replaceAll("<scenario-path>", values.scenarioPath)
    .replaceAll("<workspace-id>", values.workspaceId)
    .replaceAll("<deadline>", values.deadline);
}

export function firstAgentPrompt(arm: Arm, values: PromptValues): string {
  const base = substitute(FIRST_AGENT_PROMPT, values);
  return arm === "treatment" ? `${base}\n\n${TREATMENT_ADDED_SENTENCE}` : base;
}

export function secondAgentPrompt(values: PromptValues): string {
  return substitute(SECOND_AGENT_PROMPT, values);
}

export const SEALED_BASENAMES = [
  "ground-truth.md",
  "scoring-key.md",
  "setup.md",
  "Campfire-v1.13-WOW-001-Prove-a-Way-of-Working.md",
  "SPRINT_WOW_001_RESULT.md",
];

export const SEALED_RELATIVE_PREFIXES = [
  "src/playbooks/",
  "docs/evidence/wow-001/",
  "fixtures/incidents/wow-001/README.md",
];

function toPosix(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isSealedPath(relativePath: string): boolean {
  const normalized = toPosix(relativePath);
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (SEALED_BASENAMES.includes(basename)) return true;
  return SEALED_RELATIVE_PREFIXES.some(
    (prefix) =>
      normalized === prefix ||
      normalized.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
  );
}

/** Walk with lstat and skip symlinks entirely so a link cannot leak sealed material. */
export function findSealedMatches(root: string): string[] {
  const matches: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const absolutePath = join(dir, name);
      let stat;
      try {
        stat = lstatSync(absolutePath);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      const relativePath = prefix === "" ? name : `${prefix}/${name}`;
      if (isSealedPath(relativePath)) matches.push(relativePath);
      if (stat.isDirectory()) walk(absolutePath, relativePath);
    }
  };
  walk(root, "");
  return matches.sort();
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function copyFilesRecursive(srcDir: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  for (const name of readdirSync(srcDir)) {
    const src = join(srcDir, name);
    const stat = lstatSync(src);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      copyFilesRecursive(src, join(destDir, name));
    } else if (stat.isFile()) {
      copyFileSync(src, join(destDir, name));
    }
  }
}

function listFiles(root: string, prefix: string, out: string[]): void {
  for (const name of readdirSync(root)) {
    const absolutePath = join(root, name);
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink()) continue;
    const relativePath = prefix === "" ? name : `${prefix}/${name}`;
    if (stat.isDirectory()) listFiles(absolutePath, relativePath, out);
    else if (stat.isFile()) out.push(relativePath);
  }
}

/**
 * Copy ONLY the assigned scenario and evidence into a fresh run directory
 * outside the repository, then re-check the staged tree for sealed material.
 * The check runs on what was actually copied, so a mislabeled source file
 * fails the staging instead of reaching an agent.
 */
export function stageRun(input: StageRunInput): StageRunResult {
  const { repoRoot, pilotRoot, scenario, arm, role, runId, promptValues } = input;
  assertOutsideRepo(pilotRoot);
  const runDir = join(pilotRoot, "runs", runId);
  assertOutsideRepo(runDir);
  if (existsSync(runDir)) {
    throw new ValidationError(`Run directory already exists: ${runId}`, { runDir });
  }

  const scenarioDir = join(repoRoot, "fixtures", "incidents", "wow-001", scenario);
  const scenarioFile = join(scenarioDir, "scenario.md");
  if (!existsSync(scenarioFile)) {
    throw new ValidationError(`Scenario bundle is missing scenario.md: ${scenario}`, {
      scenarioDir,
    });
  }

  const stagedDir = join(runDir, "run");
  mkdirSync(stagedDir, { recursive: true });
  copyFileSync(scenarioFile, join(stagedDir, "scenario.md"));
  const evidenceDir = join(scenarioDir, "evidence");
  if (existsSync(evidenceDir)) {
    copyFilesRecursive(evidenceDir, join(stagedDir, "evidence"));
  }

  const sealedMatches = findSealedMatches(stagedDir);
  if (sealedMatches.length > 0) {
    // Never leave a staged tree that contains sealed material behind.
    rmSync(runDir, { recursive: true, force: true });
    throw new ValidationError("Refusing to stage sealed material", { runDir, sealedMatches });
  }

  const prompt =
    role === "first" ? firstAgentPrompt(arm, promptValues) : secondAgentPrompt(promptValues);
  writeFileSync(join(runDir, "prompt.txt"), prompt, "utf8");

  const stagedFiles: string[] = [];
  listFiles(stagedDir, "", stagedFiles);
  stagedFiles.sort();

  const manifest = {
    scenario,
    arm,
    role,
    stagedAt: new Date().toISOString(),
    files: stagedFiles.map((relativePath) => ({
      path: relativePath,
      sha256: sha256File(join(stagedDir, ...relativePath.split("/"))),
    })),
    sealedMatches: [],
  };
  writeFileSync(join(runDir, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return { runDir, stagedFiles, sealedMatches };
}

export interface AgentConfigInput {
  role: Role;
  arm: Arm;
  /** MCP server database. The probe uses a throwaway /tmp file. */
  campfireDb?: string;
  /** Real runs point this at the in-container agent token; probes omit it. */
  campfireTokenFile?: string;
}

/**
 * The playbook gate is container env, never harness config, so the config is
 * identical across control and treatment for a role. Identity and database
 * come from the MCP entry's environment because the harness does not forward
 * its own environment to a local MCP server.
 */
export function buildAgentConfig(input: AgentConfigInput): Record<string, unknown> {
  const environment: Record<string, string> = {
    CAMPFIRE_DB: input.campfireDb ?? "/tmp/campfire-probe.db",
  };
  if (input.campfireTokenFile !== undefined) {
    environment.CAMPFIRE_TOKEN = `{file:${input.campfireTokenFile}}`;
    environment.CAMPFIRE_ACTOR_TYPE = "agent";
  }
  return {
    $schema: "https://opencode.ai/config.json",
    model: "opencode-go/deepseek-v4.1-flash",
    share: "disabled",
    autoupdate: false,
    snapshot: false,
    formatter: false,
    lsp: false,
    permission: {
      bash: "deny",
      edit: "deny",
      webfetch: "deny",
      websearch: "deny",
      external_directory: { "*": "deny", "/run/**": "allow" },
    },
    mcp: {
      campfire: {
        type: "local",
        command: ["campfire", "mcp", "--harness", "opencode"],
        enabled: true,
        environment,
      },
    },
  };
}

/** The in-container locations a real (scored) run must use. */
export const REAL_RUN_CAMPFIRE_DB = "/campfire/campfire.db";
export const REAL_RUN_CAMPFIRE_TOKEN = "{file:/campfire/agent.token}";

interface AgentConfigShape {
  mcp?: { campfire?: { environment?: Record<string, unknown> } };
}

/**
 * A staged config built without `--campfire-db`/`--campfire-token-file` still
 * holds the probe default (`/tmp/campfire-probe.db`, no token). A scored run
 * must refuse it, because the container would then mount a database the run
 * never uses. Pure so tests can pin probe vs real configs without docker.
 */
export function assertRealRunConfig(config: unknown): void {
  const environment = (config as AgentConfigShape | null | undefined)?.mcp?.campfire?.environment;
  if (
    environment?.CAMPFIRE_DB === REAL_RUN_CAMPFIRE_DB &&
    environment.CAMPFIRE_TOKEN === REAL_RUN_CAMPFIRE_TOKEN
  ) {
    return;
  }
  throw new ValidationError(
    "Refusing to run: the staged config is not a real run config. Re-stage with --campfire-db /campfire/campfire.db --campfire-token-file /campfire/agent.token before running.",
    {
      field: "mcp.campfire.environment",
      expected: { CAMPFIRE_DB: REAL_RUN_CAMPFIRE_DB, CAMPFIRE_TOKEN: REAL_RUN_CAMPFIRE_TOKEN },
      actual: environment ?? null,
    },
  );
}

export function containerEnv(input: {
  role: Role;
  arm: Arm;
  baseEnv?: Record<string, string>;
}): Record<string, string> {
  const env: Record<string, string> = { ...(input.baseEnv ?? {}), HOME: "/home/agent" };
  if (input.role === "first" && input.arm === "treatment") {
    env.CAMPFIRE_PLAYBOOK = "1";
  }
  return env;
}

export const AGENT_IMAGE_CONTEXT_ALLOWLIST = ["package.json", "package-lock.json", "dist"];

export function isAllowedContextEntry(relativePath: string): boolean {
  const normalized = posix.normalize(toPosix(relativePath)).replace(/\/+$/, "");
  if (normalized === "" || normalized === "." || normalized.startsWith("..")) return false;
  return AGENT_IMAGE_CONTEXT_ALLOWLIST.includes(normalized) || normalized.startsWith("dist/");
}

export function agentDockerfile(): string {
  return [
    "FROM node:22-bookworm",
    "",
    "ENV HOME=/home/agent",
    "",
    "RUN useradd -m -d /home/agent -s /bin/bash agent",
    "",
    "WORKDIR /opt/campfire",
    "COPY package.json package-lock.json ./",
    "RUN npm ci --omit=dev --ignore-scripts && npm rebuild better-sqlite3",
    "COPY dist ./dist",
    "",
    "RUN npm i -g opencode-ai@1.18.35",
    `RUN printf '#!/bin/sh\\nexec node /opt/campfire/dist/src/cli/index.js "$@"\\n' > /usr/local/bin/campfire && chmod +x /usr/local/bin/campfire`,
    "",
    "USER agent",
    "WORKDIR /run",
    "RUN campfire --help >/dev/null && opencode --version",
    "",
  ].join("\n");
}

/** One source of truth for the container name; the pilot removes containers by this name. */
export function containerName(runId: string, role: Role, arm: Arm): string {
  const safeRunId = runId.replace(/[^A-Za-z0-9_.-]+/g, "-");
  return `campfire-wow001-${safeRunId}-${role}-${arm}`;
}

export function containerSpec(input: {
  imageTag: string;
  runId: string;
  runRoot: string;
  role: Role;
  arm: Arm;
  baseEnv?: Record<string, string>;
  /**
   * Bind source for /run. Defaults to `<runRoot>/run` (the staged scenario).
   * The auth-check has no scenario and mounts an empty workspace directory.
   */
  workDir?: string;
}): string[] {
  const { imageTag, runId, runRoot, role, arm } = input;
  const name = containerName(runId, role, arm);
  const args: string[] = ["run", "--init", "--name", name];
  // The second agent never receives the scenario directory mount.
  if (role !== "second") {
    args.push("--mount", `type=bind,src=${input.workDir ?? join(runRoot, "run")},dst=/run,readonly`);
  }
  args.push(
    "--mount",
    `type=bind,src=${join(runRoot, "campfire")},dst=/campfire`,
    "--mount",
    `type=bind,src=${join(runRoot, "config")},dst=/home/agent/.config/opencode,readonly`,
    "--mount",
    `type=bind,src=${join(runRoot, "opencode-data")},dst=/home/agent/.local/share/opencode`,
    "-e",
    "HOME=/home/agent",
  );
  const env = containerEnv(
    input.baseEnv === undefined ? { role, arm } : { role, arm, baseEnv: input.baseEnv },
  );
  for (const [key, value] of Object.entries(env)) {
    if (key === "HOME") continue;
    args.push("-e", `${key}=${value}`);
  }
  args.push(imageTag);
  return args;
}

export interface GateCliResult {
  exitCode: number;
  stdout: string;
}

export interface GateReport {
  tools: string[];
  hasGetPlaybook: boolean;
  flagTools: string[];
  flagHasGetPlaybook: boolean;
  playbookCli: GateCliResult;
  playbookFlagCli: GateCliResult;
  capabilities: GateCliResult;
}

function capabilityNamesFromManifest(stdout: string): string[] | undefined {
  try {
    const parsed = JSON.parse(stdout) as { commands?: Array<{ name?: unknown }> };
    if (!Array.isArray(parsed.commands)) return undefined;
    return parsed.commands.map((entry) => String(entry.name));
  } catch {
    return undefined;
  }
}

/**
 * The pre-run gate check: default surfaces stay closed in the control, and the
 * treatment opens both the env CLI path and the MCP env path while the flag
 * path stays MCP-only. The flag path is checked in the control so a build that
 * ignores `--with-playbook` cannot pass by failing everything closed.
 */
export function evaluateGateReport(
  report: GateReport,
  arm: Arm,
): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const capabilityNames = capabilityNamesFromManifest(report.capabilities.stdout);
  if (report.capabilities.exitCode !== 0 || capabilityNames === undefined) {
    failures.push("capabilities --output json did not return a parseable cli_command_manifest");
  }
  if (arm === "control") {
    if (report.hasGetPlaybook) failures.push("control MCP listed get_playbook without the opt-in");
    if (report.playbookCli.exitCode !== 1) {
      failures.push(`control campfire playbook list exit code was ${report.playbookCli.exitCode}, expected 1`);
    }
    if (capabilityNames?.includes("playbook") === true) {
      failures.push("control capabilities listed the playbook command");
    }
    if (!report.flagHasGetPlaybook) {
      failures.push("control MCP with --with-playbook did not list get_playbook");
    }
    return { ok: failures.length === 0, failures };
  }
  if (!report.hasGetPlaybook) failures.push("treatment MCP did not list get_playbook");
  if (report.playbookCli.exitCode !== 0) {
    failures.push(`treatment campfire playbook list exit code was ${report.playbookCli.exitCode}, expected 0`);
  } else {
    let kind: unknown;
    try {
      kind = (JSON.parse(report.playbookCli.stdout) as { kind?: unknown }).kind;
    } catch {
      kind = undefined;
    }
    if (kind !== "campfire_playbook_list") {
      failures.push("treatment playbook list JSON kind was not campfire_playbook_list");
    }
  }
  if (capabilityNames?.includes("playbook") !== true) {
    failures.push("treatment capabilities did not list the playbook command");
  }
  if (report.playbookFlagCli.exitCode !== 0) {
    failures.push(`treatment campfire playbook list --with-playbook exit code was ${report.playbookFlagCli.exitCode}, expected 0`);
  }
  return { ok: failures.length === 0, failures };
}

const CREDENTIAL_PATTERN_SOURCES = [
  "cft_[A-Za-z0-9]+",
  "sk-[A-Za-z0-9_-]+",
  "Bearer\\s+[A-Za-z0-9._-]+",
] as const;

/**
 * A run log must not carry the operator's home path, the repository path, or
 * credential-shaped strings. Replace the longest literal first so a repo root
 * nested under the home directory still redacts as <repo>.
 */
export function sanitizeText(text: string, opts: { homeDir: string; repoRoot: string }): string {
  let out = text;
  const literals: Array<[string, string]> = [
    [opts.repoRoot, "<repo>"],
    [opts.homeDir, "<home>"],
  ];
  for (const [literal, token] of literals.sort((a, b) => b[0].length - a[0].length)) {
    if (literal !== "") out = out.split(literal).join(token);
  }
  for (const source of CREDENTIAL_PATTERN_SOURCES) {
    out = out.replace(new RegExp(source, "g"), "<redacted>");
  }
  return out;
}

export function hasCredentialShape(text: string): boolean {
  return CREDENTIAL_PATTERN_SOURCES.some((source) => new RegExp(source).test(text));
}
