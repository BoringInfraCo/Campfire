/**
 * WOW-001 pilot runner.
 *
 * The runner owns the mechanical, checkable parts of the pilot lock: sealing
 * the image context, staging one run outside the repository, probing the
 * filesystem and playbook gates inside the container, running the OpenCode
 * boundary check, and sanitizing logs. Demonstration commands are deliberately
 * manual and explicit; nothing here decides a score.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import Database from "better-sqlite3";
import { prepareArm, prepareSecond } from "./prepare.js";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUDGET_PROBE_PROMPT,
  PROBE_PROMPT,
  REPO_ROOT,
  agentDockerfile,
  assertOutsideRepo,
  assertRealRunConfig,
  authCheckPrompt,
  budgetFor,
  buildAgentConfig,
  containerName,
  containerSpec,
  evaluateGateReport,
  findSealedMatches,
  hasCredentialShape,
  isAllowedContextEntry,
  LOCKED_AGENT_IMAGE,
  resolvePilotRoot,
  sanitizeText,
  sha256File,
  stageRun,
  toolUseFromJsonLine,
  type Arm,
  type GateReport,
  type Role,
  type Scenario,
} from "./pilot-lib.js";

const PILOT_USAGE =
  "usage: pilot.ts <build-image|stage|prepare|prepare-second|probe-fs|probe-gates|probe-agent|probe-budget|auth-check|run|sanitize> [flags]";
const SCENARIOS: readonly Scenario[] = ["S1", "S2", "S3"];
const ARMS: readonly Arm[] = ["control", "treatment"];
const ROLES: readonly Role[] = ["first", "second"];
const PILOT_MODEL = "opencode-go/deepseek-v4.1-flash";
const PROBE_GATES_MARKER = "WOW001_GATE_REPORT ";
const DOCKER_MAX_BUFFER = 64 * 1024 * 1024;
const PROBE_AGENT_TIMEOUT_MS = 15 * 60 * 1000;
const PROBE_AGENT_KILL_GRACE_MS = 10_000;
const PROBE_BUDGET_DEFAULT_TOOL_CALLS = 3;
const PROBE_BUDGET_MAX_TOOL_CALLS = 20;
const PROBE_BUDGET_DEFAULT_MINUTES = 2;
const AUTH_CHECK_TIMEOUT_MS = PROBE_AGENT_TIMEOUT_MS;
const AUTH_CHECK_FINDING_SUMMARY = "Disposable authenticated check";

export interface PilotArgs {
  command?: string;
  flags: Record<string, string | boolean>;
  positionals: string[];
}

export function parsePilotArgs(argv: string[]): PilotArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (token.startsWith("--")) {
      const name = token.slice(2);
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[name] = true;
      } else {
        flags[name] = next;
        index += 1;
      }
      continue;
    }
    positionals.push(token);
  }
  const [command, ...rest] = positionals;
  return { command, flags, positionals: rest };
}

function requireFlagValue(flags: Record<string, string | boolean>, name: string): string {
  const value = flags[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required --${name} <value>`);
  }
  return value.trim();
}

function optionalFlagValue(
  flags: Record<string, string | boolean>,
  name: string,
): string | undefined {
  const value = flags[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function requireChoice<T extends string>(
  flags: Record<string, string | boolean>,
  name: string,
  allowed: readonly T[],
): T {
  const value = requireFlagValue(flags, name);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`Invalid --${name}: expected ${allowed.join("|")} (got ${value})`);
  }
  return value as T;
}

function requireRunId(flags: Record<string, string | boolean>): string {
  const runId = requireFlagValue(flags, "run-id");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(runId)) {
    throw new Error(`Invalid --run-id: use letters, digits, dot, underscore, or dash (got ${runId})`);
  }
  return runId;
}

function pilotRoot(): string {
  const root = resolvePilotRoot();
  assertOutsideRepo(root);
  mkdirSync(root, { recursive: true });
  return root;
}

function runRoot(runId: string): string {
  const root = join(pilotRoot(), "runs", runId);
  assertOutsideRepo(root);
  if (!existsSync(root)) {
    throw new Error(`Run directory not found: ${root}; run stage --run-id ${runId} first`);
  }
  return root;
}

function gitOutput(args: string[]): string {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  if (result.error !== undefined) {
    throw new Error(`git ${args.join(" ")} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} exited ${result.status}: ${(result.stderr ?? "").trim()}`,
    );
  }
  return (result.stdout ?? "").trim();
}

function imageTag(): string {
  return LOCKED_AGENT_IMAGE.tag;
}

function requireCleanSource(): void {
  const paths = ["src", "package.json", "package-lock.json"];
  for (const args of [
    ["diff", "--quiet", "HEAD", "--", ...paths],
    ["diff", "--cached", "--quiet", "HEAD", "--", ...paths],
  ]) {
    const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
    if (result.error !== undefined) {
      throw new Error(`git ${args.join(" ")} failed to start: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(
        "Source tree differs from HEAD under src/, package.json, or package-lock.json. Commit the pilot source before building the agent image.",
      );
    }
  }
}

interface DockerCapture {
  status: number | null;
  stdout: string;
  stderr: string;
}

function dockerCapture(args: string[], opts: { cwd?: string } = {}): DockerCapture {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: DOCKER_MAX_BUFFER,
    cwd: opts.cwd ?? REPO_ROOT,
  });
  if (result.error !== undefined) {
    throw new Error(`docker ${args.join(" ")} failed to start: ${result.error.message}`);
  }
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function docker(args: string[], opts: { cwd?: string } = {}): string {
  const result = dockerCapture(args, opts);
  if (result.status !== 0) {
    const stderrLines = result.stderr.split("\n").slice(0, 40).join("\n");
    throw new Error(`docker ${args[0] ?? ""} exited ${result.status}:\n${stderrLines}`);
  }
  return result.stdout;
}

function assertLockedImage(): void {
  const actual = docker(["image", "inspect", "--format", "{{.Id}}", imageTag()]).trim();
  if (actual !== LOCKED_AGENT_IMAGE.id) {
    throw new Error(`Pilot image differs from RUN-LOCK.md: expected ${LOCKED_AGENT_IMAGE.id}, got ${actual}`);
  }
}

function removeContainer(name: string): void {
  spawnSync("docker", ["rm", "-f", name], { encoding: "utf8", maxBuffer: DOCKER_MAX_BUFFER });
}

/**
 * docker parses options only before IMAGE, so an entrypoint override is
 * inserted before the tag that containerSpec places last.
 */
function containerArgv(spec: string[], entrypoint: string, command: string[]): string[] {
  const image = spec[spec.length - 1];
  if (image === undefined) {
    throw new Error("Container spec is missing its image tag");
  }
  return [...spec.slice(0, -1), "--entrypoint", entrypoint, image, ...command];
}

function sanitizePilotText(text: string): string {
  return sanitizeText(text, { homeDir: homedir(), repoRoot: REPO_ROOT });
}

function collectFiles(root: string, prefix: string, out: string[]): void {
  for (const name of readdirSync(root)) {
    const absolutePath = join(root, name);
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink()) continue;
    const relativePath = prefix === "" ? name : `${prefix}/${name}`;
    if (stat.isDirectory()) collectFiles(absolutePath, relativePath, out);
    else if (stat.isFile()) out.push(relativePath);
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function parseJsonLine(stdout: string, marker?: string): Record<string, unknown> | undefined {
  if (marker !== undefined) {
    const markerIndex = stdout.lastIndexOf(marker);
    if (markerIndex < 0) return undefined;
    const start = markerIndex + marker.length;
    const end = stdout.indexOf("\n", start);
    const line = stdout.slice(start, end < 0 ? undefined : end).trim();
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  const lines = stdout.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("{"));
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]!) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return undefined;
}

function cmdBuildImage(): void {
  requireCleanSource();
  const distCli = join(REPO_ROOT, "dist", "src", "cli", "index.js");
  if (!existsSync(distCli)) {
    throw new Error(`Missing built CLI at ${distCli}; run npm run build before build-image`);
  }
  const contextDir = join(pilotRoot(), "image-context");
  rmSync(contextDir, { recursive: true, force: true });
  mkdirSync(contextDir, { recursive: true });

  const planned: string[] = ["package.json", "package-lock.json"];
  collectFiles(join(REPO_ROOT, "dist"), "dist", planned);
  for (const entry of planned) {
    if (!isAllowedContextEntry(entry)) {
      throw new Error(`Image context entry is not allowed: ${entry}`);
    }
  }
  for (const entry of planned) {
    const destination = join(contextDir, ...entry.split("/"));
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(REPO_ROOT, ...entry.split("/")), destination);
  }
  const sealedMatches = findSealedMatches(contextDir);
  if (sealedMatches.length > 0) {
    throw new Error(
      `Refusing to build an image with sealed material in the context: ${sealedMatches.join(", ")}`,
    );
  }
  writeFileSync(join(contextDir, "Dockerfile"), agentDockerfile(), "utf8");

  const tag = imageTag();
  // Never overwrite the locked tag with a rebuild until its bytes are checked.
  const candidateTag = `${tag}-candidate`;
  docker(["build", "-t", candidateTag, contextDir]);
  const imageId = docker(["image", "inspect", "--format", "{{.Id}}", candidateTag]).trim();
  if (imageId !== LOCKED_AGENT_IMAGE.id) {
    throw new Error(`Rebuilt image differs from RUN-LOCK.md: expected ${LOCKED_AGENT_IMAGE.id}, got ${imageId}`);
  }
  docker(["tag", candidateTag, tag]);
  const repoDigestsRaw = docker(["image", "inspect", "--format", "{{json .RepoDigests}}", tag]).trim();
  const repoDigests = JSON.parse(repoDigestsRaw) as string[];

  const contextFiles: string[] = [];
  collectFiles(contextDir, "", contextFiles);
  const hashedFiles = contextFiles.filter((entry) => entry !== "Dockerfile").sort();
  const contextTreeSha256 = createHash("sha256")
    .update(
      hashedFiles
        .map((entry) => `${entry}:${sha256File(join(contextDir, ...entry.split("/")))}`)
        .join("\n"),
    )
    .digest("hex");

  console.log(
    JSON.stringify({
      ok: true,
      tag,
      imageId,
      repoDigests,
      contextFileCount: hashedFiles.length,
      contextTreeSha256,
      gitHead: gitOutput(["rev-parse", "HEAD"]),
    }),
  );
}

function cmdStage(flags: Record<string, string | boolean>): void {
  const scenario = requireChoice(flags, "scenario", SCENARIOS);
  const arm = requireChoice(flags, "arm", ARMS);
  const role = requireChoice(flags, "role", ROLES);
  const runId = requireRunId(flags);
  const promptValues = {
    scenarioPath: optionalFlagValue(flags, "scenario-path") ?? "/run",
    workspaceId: optionalFlagValue(flags, "workspace-id") ?? "<workspace-id>",
    deadline: optionalFlagValue(flags, "deadline") ?? "30 minutes",
  };

  const result = stageRun({
    repoRoot: REPO_ROOT,
    pilotRoot: pilotRoot(),
    scenario,
    arm,
    role,
    runId,
    promptValues,
  });

  const campfireDb = optionalFlagValue(flags, "campfire-db");
  const campfireTokenFile = optionalFlagValue(flags, "campfire-token-file");
  mkdirSync(join(result.runDir, "config"), { recursive: true });
  writeFileSync(
    join(result.runDir, "config", "opencode.json"),
    `${JSON.stringify(
      buildAgentConfig({
        role,
        arm,
        ...(campfireDb === undefined ? {} : { campfireDb }),
        ...(campfireTokenFile === undefined ? {} : { campfireTokenFile }),
      }),
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(
    join(result.runDir, "config", ".gitignore"),
    "node_modules\npackage.json\npackage-lock.json\nbun.lock\n.gitignore\n",
    "utf8",
  );
  mkdirSync(join(result.runDir, "campfire"), { recursive: true });
  mkdirSync(join(result.runDir, "opencode-data"), { recursive: true });
  const authSource = join(homedir(), ".local", "share", "opencode", "auth.json");
  if (existsSync(authSource)) {
    const authDestination = join(result.runDir, "opencode-data", "auth.json");
    copyFileSync(authSource, authDestination);
    chmodSync(authDestination, 0o600);
  }

  console.log(
    JSON.stringify({
      ok: true,
      runDir: result.runDir,
      stagedFiles: result.stagedFiles,
      sealedMatches: [],
    }),
  );
}

function probeFsScript(repoPaths: string[]): string {
  const repoChecks = repoPaths
    .map(
      (repoPath) =>
        `if [ -e ${shellQuote(repoPath)} ]; then echo "REPO_PATH_PRESENT ${repoPath}"; present=1; else echo "REPO_PATH_ABSENT ${repoPath}"; fi`,
    )
    .join("\n");
  const findExpression = [
    "-name ground-truth.md",
    "-name scoring-key.md",
    "-name setup.md",
    `-name ${shellQuote("Campfire-v1.13-WOW-001-Prove-a-Way-of-Working.md")}`,
  ].join(" -o ");
  const reportProgram = [
    'const fs = require("node:fs");',
    'const sealed = fs.readFileSync("/tmp/wow001-sealed.txt", "utf8").split("\\n").filter((line) => line.length > 0);',
    'const repoPathPresent = process.env.PILOT_REPO_PRESENT === "1";',
    'process.stdout.write(JSON.stringify({ sealedFound: sealed, repoPathPresent }) + "\\n");',
  ].join(" ");
  return [
    "set -u",
    "id",
    "pwd",
    "ls -la /run",
    "present=0",
    repoChecks,
    "echo '--- sealed scan ---'",
    `find / -xdev \\( ${findExpression} \\) -not -path '/proc/*' 2>/dev/null > /tmp/wow001-sealed.txt`,
    "cat /tmp/wow001-sealed.txt",
    "echo '--- report ---'",
    `PILOT_REPO_PRESENT="$present" node -e ${shellQuote(reportProgram)}`,
  ].join("\n");
}

function cmdProbeFs(flags: Record<string, string | boolean>): number {
  assertLockedImage();
  const runId = requireRunId(flags);
  const root = runRoot(runId);
  const name = containerName(runId, "first", "control");
  removeContainer(name);
  const spec = containerSpec({
    imageTag: imageTag(),
    runId,
    runRoot: root,
    role: "first",
    arm: "control",
  });
  const repoPaths = [
    join(REPO_ROOT, "fixtures"),
    join(REPO_ROOT, "docs", "Campfire-v1.13-WOW-001-Prove-a-Way-of-Working.md"),
    join(REPO_ROOT, "src", "playbooks"),
  ];
  const argv = containerArgv(spec, "sh", ["-lc", probeFsScript(repoPaths)]);
  const result = dockerCapture(argv);
  const raw = sanitizePilotText(result.stdout);
  const report = parseJsonLine(result.stdout);
  if (report === undefined) {
    const stderr = sanitizePilotText(result.stderr);
    throw new Error(
      `probe-fs container did not print a JSON report (docker exit ${result.status}):\n${raw}\n${stderr}`,
    );
  }
  const sealedFound = Array.isArray(report.sealedFound)
    ? report.sealedFound.map((entry) => String(entry))
    : [];
  const repoPathPresent = report.repoPathPresent === true;
  const ok = sealedFound.length === 0 && !repoPathPresent && result.status === 0;
  console.log(JSON.stringify({ ok, sealedFound, repoPathPresent, raw }));
  return ok ? 0 : 1;
}

const PROBE_GATES_SCRIPT = [
  'import { Client } from "/opt/campfire/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";',
  'import { StdioClientTransport } from "/opt/campfire/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";',
  'import { spawnSync } from "node:child_process";',
  "",
  "const childEnv = {};",
  "for (const [key, value] of Object.entries(process.env)) {",
  '  if (typeof value === "string") childEnv[key] = value;',
  "}",
  "",
  "async function listToolNames(extraArgs) {",
  "  const transport = new StdioClientTransport({",
  '    command: "campfire",',
  '    args: ["mcp", "--actor", "hum_wow_probe", "--type", "human", "--db", "/tmp/probe.db"].concat(extraArgs),',
  '    env: childEnv,',
  '    stderr: "pipe",',
  "  });",
  '  const client = new Client({ name: "wow-001-probe", version: "1.0.0" });',
  "  try {",
  "    await client.connect(transport);",
  "    const listed = await client.listTools();",
  "    return listed.tools.map((tool) => tool.name);",
  "  } finally {",
  "    try {",
  "      await client.close();",
  "    } catch {}",
  "  }",
  "}",
  "",
  "function runCli(args) {",
  '  const result = spawnSync("campfire", args, { encoding: "utf8" });',
  '  return { exitCode: result.status === null ? -1 : result.status, stdout: result.stdout || "" };',
  "}",
  "",
  "const report = {",
  "  tools: [],",
  "  hasGetPlaybook: false,",
  "  flagTools: [],",
  "  flagHasGetPlaybook: false,",
  '  playbookCli: { exitCode: -1, stdout: "" },',
  '  playbookFlagCli: { exitCode: -1, stdout: "" },',
  '  capabilities: { exitCode: -1, stdout: "" },',
  "};",
  "",
  "try {",
  "  report.tools = await listToolNames([]);",
  "} catch (error) {",
  "  report.toolsError = String(error);",
  "}",
  'report.hasGetPlaybook = report.tools.includes("get_playbook");',
  "",
  "try {",
  '  report.flagTools = await listToolNames(["--with-playbook"]);',
  "} catch (error) {",
  "  report.flagToolsError = String(error);",
  "}",
  'report.flagHasGetPlaybook = report.flagTools.includes("get_playbook");',
  "",
  'report.playbookCli = runCli(["playbook", "list", "--output", "json"]);',
  'report.playbookFlagCli = runCli(["playbook", "list", "--with-playbook", "--output", "json"]);',
  'report.capabilities = runCli(["capabilities", "--output", "json"]);',
  "",
  'console.log("WOW001_GATE_REPORT " + JSON.stringify(report));',
  "",
].join("\n");

function runGateContainer(
  arm: Arm,
  runId: string,
  root: string,
): { report: GateReport; result: { ok: boolean; failures: string[] } } {
  const name = containerName(runId, "first", arm);
  removeContainer(name);
  const spec = containerSpec({
    imageTag: imageTag(),
    runId,
    runRoot: root,
    role: "first",
    arm,
  });
  const argv = containerArgv(spec, "node", ["--input-type=module", "-e", PROBE_GATES_SCRIPT]);
  const dockerResult = dockerCapture(argv);
  const raw = sanitizePilotText(dockerResult.stdout);
  const parsed = parseJsonLine(dockerResult.stdout, PROBE_GATES_MARKER);
  if (parsed === undefined) {
    const stderr = sanitizePilotText(dockerResult.stderr);
    throw new Error(
      `probe-gates ${arm} container did not print a JSON report (docker exit ${dockerResult.status}):\n${raw}\n${stderr}`,
    );
  }
  const report = parsed as unknown as GateReport;
  return { report, result: evaluateGateReport(report, arm) };
}

function cmdProbeGates(flags: Record<string, string | boolean>): number {
  assertLockedImage();
  const runId = requireRunId(flags);
  const root = runRoot(runId);
  const control = runGateContainer("control", runId, root);
  const treatment = runGateContainer("treatment", runId, root);
  const ok = control.result.ok && treatment.result.ok;
  console.log(
    JSON.stringify({
      ok,
      control: { report: control.report, result: control.result },
      treatment: { report: treatment.report, result: treatment.result },
    }),
  );
  return ok ? 0 : 1;
}

interface TimeoutResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  stoppedByHook: boolean;
  spawnFailed: boolean;
}

interface DockerStreamOptions {
  timeoutMs: number;
  /**
   * Called once per complete stdout line. Return true to stop the run at a
   * locked budget; the container is removed and docker is signalled.
   */
  onStdoutLine?: (line: string) => boolean;
}

/**
 * The one streaming docker runner for probe-agent, budget-probe, auth-check,
 * and scored runs. It keeps stdout/stderr in memory, splits stdout into lines
 * across chunk boundaries, enforces the timeout, removes the container on a
 * timeout or hook stop, and clears every timer before resolving.
 */
function runDockerStream(
  args: string[],
  name: string,
  options: DockerStreamOptions,
): Promise<TimeoutResult> {
  return new Promise((resolvePromise) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let stoppedByHook = false;
    let spawnFailed = false;
    let forceKill: NodeJS.Timeout | undefined;
    let settled = false;
    let lineBuffer = "";
    const stop = (): void => {
      if (settled) return;
      removeContainer(name);
      child.kill("SIGTERM");
      forceKill = setTimeout(() => {
        child.kill("SIGKILL");
      }, PROBE_AGENT_KILL_GRACE_MS);
    };
    const onLine = (line: string): void => {
      if (settled || stoppedByHook) return;
      if (options.onStdoutLine?.(line) === true) {
        stoppedByHook = true;
        stop();
      }
    };
    const consume = (text: string): void => {
      lineBuffer += text;
      let index = lineBuffer.indexOf("\n");
      while (index >= 0 && !stoppedByHook) {
        const line = lineBuffer.slice(0, index);
        lineBuffer = lineBuffer.slice(index + 1);
        onLine(line);
        index = lineBuffer.indexOf("\n");
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs);
    const finish = (code: number | null): void => {
      if (settled) return;
      const remainder = lineBuffer;
      lineBuffer = "";
      settled = true;
      // A final line without a trailing newline is still a raw line; the
      // callback records it, but a budget stop is moot once the process exits.
      if (!stoppedByHook && remainder.length > 0) options.onStdoutLine?.(remainder);
      clearTimeout(timer);
      if (forceKill !== undefined) clearTimeout(forceKill);
      resolvePromise({ code, stdout, stderr, timedOut, stoppedByHook, spawnFailed });
    };
    child.stdout?.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      consume(text);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      spawnFailed = true;
      stderr += `${String(error)}\n`;
      finish(null);
    });
    child.on("close", (code) => {
      finish(code);
    });
  });
}

function runDockerWithTimeout(args: string[], name: string, timeoutMs: number): Promise<TimeoutResult> {
  return runDockerStream(args, name, { timeoutMs });
}

function extractLastText(sanitizedStdout: string): string {
  const withoutAnsi = sanitizedStdout.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
  const chunks = withoutAnsi
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
  return chunks.length === 0 ? "" : chunks[chunks.length - 1]!;
}

async function cmdProbeAgent(flags: Record<string, string | boolean>): Promise<number> {
  assertLockedImage();
  const runId = requireRunId(flags);
  const arm = requireChoice(flags, "arm", ARMS);
  const role: Role = flags.role === undefined ? "first" : requireChoice(flags, "role", ROLES);
  const root = runRoot(runId);
  const authPath = join(root, "opencode-data", "auth.json");
  if (!existsSync(authPath)) {
    throw new Error(
      `Missing OpenCode auth: copy ~/.local/share/opencode/auth.json into ${authPath} (mode 600). This file must never be committed.`,
    );
  }
  const authMode = statSync(authPath).mode & 0o777;
  if (authMode !== 0o600) {
    throw new Error(
      `OpenCode auth must be mode 600: ${authPath} is mode ${authMode.toString(8)}. This file must never be committed.`,
    );
  }

  const name = containerName(runId, role, arm);
  removeContainer(name);
  const spec = containerSpec({ imageTag: imageTag(), runId, runRoot: root, role, arm });
  const argv = containerArgv(spec, "opencode", [
    "run",
    "--pure",
    "--format",
    "default",
    "--model",
    PILOT_MODEL,
    PROBE_PROMPT,
  ]);

  const startedAt = Date.now();
  const result = await runDockerWithTimeout(argv, name, PROBE_AGENT_TIMEOUT_MS);
  const durationMs = Date.now() - startedAt;

  const sanitizedStdout = sanitizePilotText(result.stdout);
  const sanitizedStderr = sanitizePilotText(result.stderr);
  const header = [
    `command: ${sanitizePilotText(`docker ${argv.join(" ")}`)}`,
    `exitCode: ${result.code === null ? "null" : result.code}`,
    `timedOut: ${result.timedOut}`,
    `durationMs: ${durationMs}`,
  ].join("\n");
  const logContent = `${header}\n\n${sanitizedStdout}${
    sanitizedStderr.length > 0 ? `\n[stderr]\n${sanitizedStderr}` : ""
  }`;
  if (hasCredentialShape(logContent)) {
    throw new Error(
      `Refusing to write probe-agent-${arm}.log: credential-shaped text survives sanitization`,
    );
  }
  const logPath = join(root, `probe-agent-${arm}.log`);
  writeFileSync(logPath, logContent, "utf8");

  const ok = !result.timedOut && result.code === 0;
  console.log(
    JSON.stringify({
      ok,
      arm,
      exitCode: result.code,
      durationMs,
      logPath,
      lastText: extractLastText(sanitizedStdout),
    }),
  );
  return ok ? 0 : 1;
}

function cmdSanitize(flags: Record<string, string | boolean>): void {
  const inputPath = resolve(requireFlagValue(flags, "in"));
  const sanitized = sanitizePilotText(readFileSync(inputPath, "utf8"));
  if (hasCredentialShape(sanitized)) {
    throw new Error(`Refusing to print ${inputPath}: credential-shaped text survives sanitization`);
  }
  process.stdout.write(sanitized.endsWith("\n") ? sanitized : `${sanitized}\n`);
}

/* ---------------------------------------------------------------------- */
/* Scored-run and budget-probe session path                               */
/* ---------------------------------------------------------------------- */

interface SessionRunInput {
  runId: string;
  runDir: string;
  role: Role;
  arm: Arm;
  prompt: string;
  /** Base name for the .jsonl capture and .log transcript, e.g. `run-first`. */
  fileBase: string;
  /** Locked tool-call budget; undefined means no tool stop rule. */
  maxToolCalls?: number;
  /** Locked time budget in minutes; undefined falls back to timeoutMs. */
  maxMinutes?: number;
  timeoutMs?: number;
  /** Bind source for /run (the auth-check mounts an empty workspace). */
  workDir?: string;
}

interface SessionOutcome {
  stopReason: "completed" | "tool_budget" | "time_budget" | "timeout";
  toolCallCount: number;
  exitCode: number | null;
  durationMs: number;
  startedAt: string;
  endedAt: string;
  stdout: string;
  stderr: string;
  spawnFailed: boolean;
  logPath: string;
  jsonlPath: string;
}

/**
 * One OpenCode session in one locked-image container, shared by `run` and
 * `probe-budget` (and `auth-check`). stdout is appended raw to the .jsonl
 * capture line by line while the budget check runs on the same stream; the
 * .log transcript is sanitized and refused if a credential shape survives.
 */
async function executeOpenCodeSession(input: SessionRunInput): Promise<SessionOutcome> {
  const name = containerName(input.runId, input.role, input.arm);
  removeContainer(name);
  const spec = containerSpec({
    imageTag: imageTag(),
    runId: input.runId,
    runRoot: input.runDir,
    role: input.role,
    arm: input.arm,
    ...(input.workDir === undefined ? {} : { workDir: input.workDir }),
  });
  const argv = containerArgv(spec, "opencode", [
    "run",
    "--pure",
    "--format",
    "json",
    "--model",
    PILOT_MODEL,
    input.prompt,
  ]);

  const jsonlPath = join(input.runDir, `${input.fileBase}.jsonl`);
  writeFileSync(jsonlPath, "", "utf8");
  let toolCallCount = 0;
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const result = await runDockerStream(argv, name, {
    timeoutMs:
      input.maxMinutes === undefined
        ? input.timeoutMs ?? PROBE_AGENT_TIMEOUT_MS
        : input.maxMinutes * 60_000,
    onStdoutLine: (line) => {
      appendFileSync(jsonlPath, `${line}\n`, "utf8");
      if (toolUseFromJsonLine(line) === undefined) return false;
      toolCallCount += 1;
      return input.maxToolCalls !== undefined && toolCallCount >= input.maxToolCalls;
    },
  });
  const endedMs = Date.now();
  const endedAt = new Date(endedMs).toISOString();
  const stopReason: SessionOutcome["stopReason"] = result.stoppedByHook
    ? "tool_budget"
    : result.timedOut
      ? input.maxMinutes === undefined
        ? "timeout"
        : "time_budget"
      : "completed";

  const sanitizedStdout = sanitizePilotText(result.stdout);
  const sanitizedStderr = sanitizePilotText(result.stderr);
  const header = [
    `command: ${sanitizePilotText(`docker ${argv.join(" ")}`)}`,
    `stopReason: ${stopReason}`,
    `toolCallCount: ${toolCallCount}`,
    `exitCode: ${result.code === null ? "null" : result.code}`,
    `durationMs: ${endedMs - startedMs}`,
  ].join("\n");
  const logContent = `${header}\n\n${sanitizedStdout}${
    sanitizedStderr.length > 0 ? `\n[stderr]\n${sanitizedStderr}` : ""
  }`;
  const logPath = join(input.runDir, `${input.fileBase}.log`);
  if (hasCredentialShape(logContent)) {
    throw new Error(`Refusing to write ${logPath}: credential-shaped text survives sanitization`);
  }
  writeFileSync(logPath, logContent, "utf8");

  return {
    stopReason,
    toolCallCount,
    exitCode: result.code,
    durationMs: endedMs - startedMs,
    startedAt,
    endedAt,
    stdout: result.stdout,
    stderr: result.stderr,
    spawnFailed: result.spawnFailed,
    logPath,
    jsonlPath,
  };
}

interface RunManifest {
  scenario: Scenario;
  arm: Arm;
}

function readRunManifest(root: string): RunManifest {
  const path = join(root, "MANIFEST.json");
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}; stage the run before running it`);
  }
  let parsed: { scenario?: unknown; arm?: unknown };
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as { scenario?: unknown; arm?: unknown };
  } catch {
    throw new Error(`MANIFEST.json is not valid JSON: ${path}`);
  }
  if (
    !(SCENARIOS as readonly unknown[]).includes(parsed.scenario) ||
    !(ARMS as readonly unknown[]).includes(parsed.arm)
  ) {
    throw new Error(`MANIFEST.json has an invalid scenario or arm: ${path}`);
  }
  return { scenario: parsed.scenario as Scenario, arm: parsed.arm as Arm };
}

function readStagedPrompt(root: string): string {
  const path = join(root, "prompt.txt");
  if (!existsSync(path)) {
    throw new Error(`Missing staged prompt: ${path}; stage the run before running it`);
  }
  const prompt = readFileSync(path, "utf8").trim();
  if (prompt.length === 0) {
    throw new Error(`Staged prompt is empty: ${path}`);
  }
  return prompt;
}

/**
 * The config guard and the sealed run material must both be real before a
 * scored run starts: the mounted database and the acting agent token. A probe
 * default config fails with the re-stage instruction from assertRealRunConfig.
 */
function assertRunArtifacts(root: string): void {
  const configPath = join(root, "config", "opencode.json");
  if (!existsSync(configPath)) {
    throw new Error(
      `Missing ${configPath}; re-stage with --campfire-db /campfire/campfire.db --campfire-token-file /campfire/agent.token`,
    );
  }
  let config: unknown;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    throw new Error(`Config is not valid JSON: ${configPath}`);
  }
  assertRealRunConfig(config);

  const dbPath = join(root, "campfire", "campfire.db");
  if (!existsSync(dbPath)) {
    throw new Error(
      `Missing run database: ${dbPath}. Place the frozen run database there before running.`,
    );
  }
  const tokenPath = join(root, "campfire", "agent.token");
  if (!existsSync(tokenPath)) {
    throw new Error(
      `Missing agent token: ${tokenPath}. Place the acting agent token there (mode 600) before running.`,
    );
  }
  const tokenMode = statSync(tokenPath).mode & 0o777;
  if (tokenMode !== 0o600) {
    throw new Error(
      `Agent token must be mode 600: ${tokenPath} is mode ${tokenMode.toString(8)}. This file must never be committed.`,
    );
  }
}

/**
 * Independent cross-check of the streamed count against the session database.
 * Only parts created at or after `sinceMs` count, so a reused opencode-data
 * directory or an earlier invalid attempt cannot inflate the run's count. A
 * missing file or table returns null instead of failing the run; overshoot is
 * recorded only from a readable count.
 */
function countSessionToolCalls(dbPath: string, sinceMs: number): number | null {
  if (!existsSync(dbPath)) return null;
  let db: Database.Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = db
      .prepare(
        "SELECT COUNT(*) AS count FROM part WHERE json_extract(data, '$.type') = 'tool' AND time_created >= ?",
      )
      .get(sinceMs) as { count?: unknown } | undefined;
    const count = Number(row?.count ?? 0);
    return Number.isFinite(count) ? count : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

interface ScoredRunReport {
  role: Role;
  scenario: Scenario;
  arm: Arm;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stopReason: SessionOutcome["stopReason"];
  toolCallCount: number;
  sessionToolCallCount: number | null;
  overshoot: boolean;
  valid: boolean;
  failures: string[];
  exitCode: number | null;
  logPath: string;
}

async function cmdRun(flags: Record<string, string | boolean>): Promise<number> {
  assertLockedImage();
  const runId = requireRunId(flags);
  const role: Role = flags.role === undefined ? "first" : requireChoice(flags, "role", ROLES);
  const root = runRoot(runId);
  const manifest = readRunManifest(root);
  const prompt = readStagedPrompt(root);
  assertRunArtifacts(root);
  const reportPath = join(root, `run-${role}.json`);
  if (existsSync(reportPath) || existsSync(join(root, `run-${role}.jsonl`))) {
    throw new Error(`Run evidence already exists for ${runId}/${role}; preserve it and use a fresh run ID`);
  }

  const budget = budgetFor(role);
  const outcome = await executeOpenCodeSession({
    runId,
    runDir: root,
    role,
    arm: manifest.arm,
    prompt,
    fileBase: `run-${role}`,
    maxToolCalls: budget.toolCalls,
    maxMinutes: budget.minutes,
  });

  const sessionToolCallCount = countSessionToolCalls(
    join(root, "opencode-data", "opencode.db"),
    Date.parse(outcome.startedAt),
  );
  const overshoot = sessionToolCallCount !== null && sessionToolCallCount > budget.toolCalls;
  const failures: string[] = [];
  if (outcome.spawnFailed) failures.push("OpenCode container failed to start");
  if (outcome.stopReason === "completed" && outcome.exitCode !== 0) {
    failures.push(`OpenCode exited ${outcome.exitCode ?? "without a code"}`);
  }
  if (sessionToolCallCount === null) failures.push("Session tool-call count unavailable");
  else if (sessionToolCallCount !== outcome.toolCallCount) {
    failures.push(`Stream/session tool-call mismatch: ${outcome.toolCallCount}/${sessionToolCallCount}`);
  }
  if (overshoot) failures.push(`Session exceeded the ${budget.toolCalls}-call budget`);
  const valid = failures.length === 0;
  const report: ScoredRunReport = {
    role,
    scenario: manifest.scenario,
    arm: manifest.arm,
    startedAt: outcome.startedAt,
    endedAt: outcome.endedAt,
    durationMs: outcome.durationMs,
    stopReason: outcome.stopReason,
    toolCallCount: outcome.toolCallCount,
    sessionToolCallCount,
    overshoot,
    valid,
    failures,
    exitCode: outcome.exitCode,
    logPath: outcome.logPath,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: valid, ...report }));
  return valid ? 0 : 1;
}

function requireIntegerFlag(
  flags: Record<string, string | boolean>,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = optionalFlagValue(flags, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid --${name}: expected an integer ${min}..${max} (got ${raw})`);
  }
  return value;
}

async function cmdProbeBudget(flags: Record<string, string | boolean>): Promise<number> {
  assertLockedImage();
  const runId = requireRunId(flags);
  const maxToolCalls = requireIntegerFlag(
    flags,
    "max-tool-calls",
    PROBE_BUDGET_DEFAULT_TOOL_CALLS,
    1,
    PROBE_BUDGET_MAX_TOOL_CALLS,
  );
  const maxMinutes = requireIntegerFlag(
    flags,
    "max-minutes",
    PROBE_BUDGET_DEFAULT_MINUTES,
    1,
    24 * 60,
  );
  const role: Role = flags.role === undefined ? "first" : requireChoice(flags, "role", ROLES);
  const root = runRoot(runId);
  const manifest = readRunManifest(root);
  assertRunArtifacts(root);

  const outcome = await executeOpenCodeSession({
    runId,
    runDir: root,
    role,
    arm: manifest.arm,
    prompt: BUDGET_PROBE_PROMPT,
    fileBase: `probe-budget-${role}`,
    maxToolCalls,
    maxMinutes,
  });
  const sessionToolCallCount = countSessionToolCalls(
    join(root, "opencode-data", "opencode.db"),
    Date.parse(outcome.startedAt),
  );

  const failures: string[] = [];
  if (outcome.stopReason === "completed") {
    failures.push("completed before reaching the tool-call budget");
  }
  if (outcome.stopReason === "time_budget" || outcome.stopReason === "timeout") {
    failures.push(`stopped on the time budget before the tool-call budget (${outcome.stopReason})`);
  }
  if (outcome.toolCallCount < 1) {
    failures.push("observed no tool calls");
  }
  if (outcome.toolCallCount > maxToolCalls) {
    failures.push(`streamed count overshot: ${outcome.toolCallCount} > ${maxToolCalls}`);
  }
  if (sessionToolCallCount === null) {
    failures.push("session database cross-check was unreadable");
  } else if (sessionToolCallCount > maxToolCalls) {
    failures.push(`session count overshot: ${sessionToolCallCount} > ${maxToolCalls}`);
  }
  const ok =
    outcome.stopReason === "tool_budget" &&
    outcome.toolCallCount >= 1 &&
    outcome.toolCallCount <= maxToolCalls &&
    sessionToolCallCount !== null &&
    sessionToolCallCount <= maxToolCalls;

  console.log(
    JSON.stringify({
      ok,
      role,
      scenario: manifest.scenario,
      arm: manifest.arm,
      startedAt: outcome.startedAt,
      endedAt: outcome.endedAt,
      durationMs: outcome.durationMs,
      stopReason: outcome.stopReason,
      toolCallCount: outcome.toolCallCount,
      sessionToolCallCount,
      overshoot: sessionToolCallCount !== null && sessionToolCallCount > maxToolCalls,
      exitCode: outcome.exitCode,
      logPath: outcome.logPath,
      budget: { toolCalls: maxToolCalls, minutes: maxMinutes },
      failures,
    }),
  );
  return ok ? 0 : 1;
}

/* ---------------------------------------------------------------------- */
/* Disposable authenticated check (auth-check)                            */
/* ---------------------------------------------------------------------- */

interface HostCliResult {
  status: number;
  stdout: string;
  stderr: string;
}

function parseLastJson(text: string): Record<string, unknown> | undefined {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"));
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]!) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Host-side Campfire CLI runner for auth-check setup and verification. The
 * environment is scrubbed of Campfire variables so the disposable database and
 * explicit tokens are the only inputs.
 */
function hostCli(args: string[]): HostCliResult {
  const cli = join(REPO_ROOT, "dist", "src", "cli", "index.js");
  if (!existsSync(cli)) {
    throw new Error(`Missing built host CLI at ${cli}; run npm run build first`);
  }
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of [
    "CAMPFIRE_URL",
    "CAMPFIRE_TOKEN",
    "CAMPFIRE_DB",
    "CAMPFIRE_ACTOR_ID",
    "CAMPFIRE_ACTOR_TYPE",
    "CAMPFIRE_SESSION_ID",
    "CAMPFIRE_HARNESS",
    "CAMPFIRE_OUTPUT",
  ]) {
    delete env[name];
  }
  // Isolate host-CLI profiles so an operator remote profile or saved credential
  // can never redirect a disposable command away from the temp database.
  const isolatedRoot = join(pilotRoot(), "auth-check", "host-cli");
  env.CAMPFIRE_CONFIG_DIR = join(isolatedRoot, "config");
  env.CAMPFIRE_DATA_DIR = join(isolatedRoot, "data");
  mkdirSync(env.CAMPFIRE_CONFIG_DIR, { recursive: true });
  mkdirSync(env.CAMPFIRE_DATA_DIR, { recursive: true });
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    maxBuffer: DOCKER_MAX_BUFFER,
    env,
  });
  if (result.error !== undefined) {
    throw new Error(`campfire ${args.join(" ")} failed to start: ${result.error.message}`);
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function hostCliJson<T>(args: string[]): T {
  const result = hostCli([...args, "--output", "json"]);
  const parsed = parseLastJson(result.stdout);
  if (result.status !== 0 || parsed === undefined) {
    throw new Error(
      `Host CLI step failed (exit ${result.status}): campfire ${args.join(" ")}\n${sanitizePilotText(result.stderr).trim()}\n${sanitizePilotText(result.stdout).trim()}`,
    );
  }
  return parsed as unknown as T;
}

interface BootstrapReceipt {
  teamId: string;
  human: { id: string };
  token: string;
}

interface WorkspaceReceipt {
  id: string;
}

interface AgentReceipt {
  agent: { id: string };
}

interface TokenReceipt {
  token: string;
}

interface HostWorkspaceView {
  goal?: { id?: string };
  findings?: Array<{
    id?: string;
    summary?: string;
    createdBy?: { actorId?: string };
    agentSessionId?: string;
  }>;
  activity?: Array<{
    id?: string;
    actor?: { actorId?: string };
    action?: string;
    objectType?: string;
    objectId?: string;
  }>;
}

const AUTH_CHECK_HUMAN_NAME = "Disposable Auth Check";
const AUTH_CHECK_AGENT_NAME = "Disposable Auth Check Agent";
const AUTH_CHECK_WORKSPACE_NAME = "Disposable Auth Check Workspace";
const AUTH_CHECK_GOAL_TITLE = "Disposable authenticated check goal";
const AUTH_CHECK_UNAUTHORIZED_WORKSPACE_NAME = "Disposable Auth Check Unauthorized";

/**
 * Build the disposable authenticated universe in one fresh SQLite database:
 * human, owned agent, authorized workspace with goal, agent invite + join, one
 * issued agent token, and a second workspace the agent is never invited to.
 */
function buildAuthCheckDatabase(root: string): {
  dbPath: string;
  humanId: string;
  humanToken: string;
  agentId: string;
  agentToken: string;
  workspaceId: string;
  unauthorizedWorkspaceId: string;
} {
  const dbPath = join(root, "campfire.db");
  const bootstrap = hostCliJson<BootstrapReceipt>([
    "bootstrap",
    "--db",
    dbPath,
    "--human-name",
    AUTH_CHECK_HUMAN_NAME,
  ]);
  const workspace = hostCliJson<WorkspaceReceipt>([
    "create-workspace",
    "--db",
    dbPath,
    "--team",
    bootstrap.teamId,
    "--name",
    AUTH_CHECK_WORKSPACE_NAME,
    "--token",
    bootstrap.token,
  ]);
  hostCliJson([
    "create-goal",
    "--db",
    dbPath,
    "--workspace",
    workspace.id,
    "--title",
    AUTH_CHECK_GOAL_TITLE,
    "--token",
    bootstrap.token,
  ]);
  const agent = hostCliJson<AgentReceipt>([
    "create-agent",
    "--db",
    dbPath,
    "--name",
    AUTH_CHECK_AGENT_NAME,
    "--human",
    bootstrap.human.id,
    "--harness",
    "opencode",
    "--team",
    bootstrap.teamId,
    "--token",
    bootstrap.token,
  ]);
  hostCliJson([
    "invite",
    workspace.id,
    "--db",
    dbPath,
    "--actor",
    agent.agent.id,
    "--type",
    "agent",
    "--role",
    "agent",
    "--token",
    bootstrap.token,
  ]);
  const issued = hostCliJson<TokenReceipt>([
    "issue-token",
    "--db",
    dbPath,
    "--actor",
    agent.agent.id,
    "--type",
    "agent",
    "--token",
    bootstrap.token,
  ]);
  // Join with the agent token: the acting identity comes from the token, and
  // the operator's default human token must never leak into this database.
  hostCliJson(["join", workspace.id, "--db", dbPath, "--token", issued.token]);
  const unauthorized = hostCliJson<WorkspaceReceipt>([
    "create-workspace",
    "--db",
    dbPath,
    "--team",
    bootstrap.teamId,
    "--name",
    AUTH_CHECK_UNAUTHORIZED_WORKSPACE_NAME,
    "--token",
    bootstrap.token,
  ]);

  return {
    dbPath,
    humanId: bootstrap.human.id,
    humanToken: bootstrap.token,
    agentId: agent.agent.id,
    agentToken: issued.token,
    workspaceId: workspace.id,
    unauthorizedWorkspaceId: unauthorized.id,
  };
}

function authCheckFailedChecks(checks: Record<string, boolean>): string[] {
  return Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

async function cmdAuthCheck(): Promise<number> {
  assertLockedImage();
  const authRoot = join(pilotRoot(), "auth-check");
  assertOutsideRepo(authRoot);
  rmSync(authRoot, { recursive: true, force: true });
  mkdirSync(join(authRoot, "config"), { recursive: true });
  mkdirSync(join(authRoot, "campfire"), { recursive: true });
  mkdirSync(join(authRoot, "opencode-data"), { recursive: true });
  mkdirSync(join(authRoot, "workspace"), { recursive: true });

  const built = buildAuthCheckDatabase(authRoot);

  const config = buildAgentConfig({
    role: "first",
    arm: "control",
    campfireDb: "/campfire/campfire.db",
    campfireTokenFile: "/campfire/agent.token",
  });
  writeFileSync(
    join(authRoot, "config", "opencode.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(authRoot, "config", ".gitignore"),
    "node_modules\npackage.json\npackage-lock.json\nbun.lock\n.gitignore\n",
    "utf8",
  );

  const mountedDb = join(authRoot, "campfire", "campfire.db");
  copyFileSync(built.dbPath, mountedDb);
  const tokenPath = join(authRoot, "campfire", "agent.token");
  writeFileSync(tokenPath, built.agentToken, "utf8");
  chmodSync(tokenPath, 0o600);

  const authSource = join(homedir(), ".local", "share", "opencode", "auth.json");
  if (!existsSync(authSource)) {
    throw new Error(
      `Missing OpenCode auth at ${authSource}; run opencode login on the host before auth-check.`,
    );
  }
  const authDestination = join(authRoot, "opencode-data", "auth.json");
  copyFileSync(authSource, authDestination);
  chmodSync(authDestination, 0o600);

  const prompt = authCheckPrompt(built.workspaceId, built.unauthorizedWorkspaceId);
  writeFileSync(join(authRoot, "prompt.txt"), `${prompt}\n`, "utf8");

  const outcome = await executeOpenCodeSession({
    runId: "auth-check",
    runDir: authRoot,
    role: "first",
    arm: "control",
    prompt,
    fileBase: "auth-check",
    timeoutMs: AUTH_CHECK_TIMEOUT_MS,
    workDir: join(authRoot, "workspace"),
  });

  const full = hostCliJson<HostWorkspaceView>([
    "show",
    built.workspaceId,
    "--full",
    "--db",
    mountedDb,
    "--token",
    built.agentToken,
  ]);
  const finding = full.findings?.find(
    (entry) => entry.summary === AUTH_CHECK_FINDING_SUMMARY,
  );
  const registeredSession = full.activity?.find(
    (entry) => entry.objectType === "agent_session" && entry.actor?.actorId === built.agentId,
  );
  const findingSessionId =
    typeof finding?.agentSessionId === "string" && finding.agentSessionId.length > 0
      ? finding.agentSessionId
      : undefined;
  const sessionId =
    findingSessionId ??
    (typeof registeredSession?.objectId === "string" ? registeredSession.objectId : undefined) ??
    null;

  const denied = hostCli([
    "show",
    built.unauthorizedWorkspaceId,
    "--db",
    mountedDb,
    "--token",
    built.agentToken,
    "--output",
    "json",
  ]);
  const deniedError = parseLastJson(denied.stderr);
  const deniedDetail =
    typeof deniedError?.error === "object" && deniedError.error !== null
      ? (deniedError.error as { code?: unknown; message?: unknown })
      : undefined;
  const deniedCode = deniedDetail?.code;

  const unauthorizedFull = hostCliJson<HostWorkspaceView>([
    "show",
    built.unauthorizedWorkspaceId,
    "--full",
    "--db",
    mountedDb,
    "--token",
    built.humanToken,
  ]);
  const unauthorizedAgentFinding = unauthorizedFull.findings?.some(
    (entry) =>
      entry.summary === AUTH_CHECK_FINDING_SUMMARY ||
      entry.agentSessionId === sessionId ||
      entry.createdBy?.actorId === built.agentId,
  );
  const unauthorizedAgentActivity = unauthorizedFull.activity?.some(
    (entry) => entry.actor?.actorId === built.agentId,
  );

  const checks = {
    sessionCompleted: outcome.stopReason === "completed" && outcome.exitCode === 0,
    goalPresent: typeof full.goal?.id === "string" && full.goal.id.length > 0,
    findingPresent: finding !== undefined,
    findingByAgent: finding?.createdBy?.actorId === built.agentId,
    sessionRegistered: registeredSession !== undefined,
    sessionOnFinding: findingSessionId !== undefined,
    unauthorizedDenied: denied.status !== 0 && deniedCode === "ParticipantRequired",
    unauthorizedHasNoAgentContent: !unauthorizedAgentFinding && !unauthorizedAgentActivity,
  };
  const ok = Object.values(checks).every(Boolean);
  const unauthorizedError =
    deniedCode !== undefined
      ? `${String(deniedCode)}${
          typeof deniedDetail?.message === "string" ? `: ${deniedDetail.message}` : ""
        }`
      : sanitizePilotText(denied.stderr.trim()).slice(0, 500);
  const report = {
    ok,
    agentId: built.agentId,
    workspaceId: built.workspaceId,
    goalPresent: checks.goalPresent,
    findingId: finding?.id ?? null,
    sessionId,
    unauthorizedError,
    checks,
  };
  const serialized = sanitizePilotText(JSON.stringify(report, null, 2));
  if (hasCredentialShape(serialized)) {
    throw new Error(
      `Refusing to write ${join(authRoot, "auth-check.json")}: credential-shaped text survives sanitization`,
    );
  }
  writeFileSync(join(authRoot, "auth-check.json"), `${serialized}\n`, "utf8");

  const failedChecks = authCheckFailedChecks(checks);
  console.log(JSON.stringify({ ...report, failedChecks }));
  return ok ? 0 : 1;
}

async function main(argv: string[]): Promise<number> {
  const parsed = parsePilotArgs(argv);
  try {
    switch (parsed.command) {
      case "build-image":
        cmdBuildImage();
        return 0;
      case "stage":
        cmdStage(parsed.flags);
        return 0;
      case "prepare": {
        assertLockedImage();
        const scenario = requireChoice(parsed.flags, "scenario", SCENARIOS);
        const arm = requireChoice(parsed.flags, "arm", ARMS);
        const runId = requireRunId(parsed.flags);
        console.log(JSON.stringify({ ok: true, ...prepareArm(scenario, arm, runId) }));
        return 0;
      }
      case "prepare-second": {
        assertLockedImage();
        const firstRunId = requireRunId(parsed.flags);
        const secondRunId = requireFlagValue(parsed.flags, "second-run-id");
        if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(secondRunId)) {
          throw new Error("Invalid --second-run-id");
        }
        console.log(JSON.stringify({ ok: true, ...await prepareSecond(firstRunId, secondRunId) }));
        return 0;
      }
      case "probe-fs":
        return cmdProbeFs(parsed.flags);
      case "probe-gates":
        return cmdProbeGates(parsed.flags);
      case "probe-agent":
        return await cmdProbeAgent(parsed.flags);
      case "probe-budget":
        return await cmdProbeBudget(parsed.flags);
      case "auth-check":
        return await cmdAuthCheck();
      case "run":
        return await cmdRun(parsed.flags);
      case "sanitize":
        cmdSanitize(parsed.flags);
        return 0;
      case undefined:
        console.error(PILOT_USAGE);
        return 1;
      default:
        console.error(`pilot.ts: unknown command: ${parsed.command}; ${PILOT_USAGE}`);
        return 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ ok: false, error: message }));
    return 1;
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
