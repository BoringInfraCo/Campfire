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
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROBE_PROMPT,
  REPO_ROOT,
  agentDockerfile,
  assertOutsideRepo,
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
  type Arm,
  type GateReport,
  type Role,
  type Scenario,
} from "./pilot-lib.js";

const PILOT_USAGE =
  "usage: pilot.ts <build-image|stage|probe-fs|probe-gates|probe-agent|sanitize> [flags]";
const SCENARIOS: readonly Scenario[] = ["S1", "S2", "S3"];
const ARMS: readonly Arm[] = ["control", "treatment"];
const ROLES: readonly Role[] = ["first", "second"];
const PILOT_MODEL = "opencode-go/deepseek-v4.1-flash";
const PROBE_GATES_MARKER = "WOW001_GATE_REPORT ";
const DOCKER_MAX_BUFFER = 64 * 1024 * 1024;
const PROBE_AGENT_TIMEOUT_MS = 15 * 60 * 1000;
const PROBE_AGENT_KILL_GRACE_MS = 10_000;

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
}

function runDockerWithTimeout(args: string[], name: string, timeoutMs: number): Promise<TimeoutResult> {
  return new Promise((resolvePromise) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let forceKill: NodeJS.Timeout | undefined;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKill = setTimeout(() => {
        child.kill("SIGKILL");
      }, PROBE_AGENT_KILL_GRACE_MS);
    }, timeoutMs);
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKill !== undefined) clearTimeout(forceKill);
      if (timedOut) removeContainer(name);
      resolvePromise({ code, stdout, stderr, timedOut });
    };
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      stderr += `${String(error)}\n`;
      finish(null);
    });
    child.on("close", (code) => {
      finish(code);
    });
  });
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
      case "probe-fs":
        return cmdProbeFs(parsed.flags);
      case "probe-gates":
        return cmdProbeGates(parsed.flags);
      case "probe-agent":
        return await cmdProbeAgent(parsed.flags);
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
