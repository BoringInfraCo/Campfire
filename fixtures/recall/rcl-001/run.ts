/**
 * RCL-001 pilot runner.
 *
 * Private. Do not mount this directory into an agent session. The runner reads
 * one task prompt at a time and passes only that string to the harness.
 *
 *   npx tsx fixtures/recall/rcl-001/run.ts probe
 *   npx tsx fixtures/recall/rcl-001/run.ts run
 *
 * Scored output stays in ~/.campfire-pilot/rcl-001. This process does not score.
 */
import { spawn, spawnSync } from "node:child_process";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { parseCodexEvents } from "../../../src/acceptance/real/codex-events.js";
import { parseOpencodeEvents } from "../../../src/acceptance/real/opencode-events.js";
import { seedDatabase } from "./seed.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PILOT_ROOT = resolve(homedir(), ".campfire-pilot/rcl-001");
const SEED_DIR = join(PILOT_ROOT, "seed");
const RUNS_DIR = join(PILOT_ROOT, "runs");
const CONTROL_SRC = join(PILOT_ROOT, "control-src");

const IMPLEMENTATION_COMMIT = "b6fc55865244ef4fc82db2d46c42b633f4017ab0";
const CONTROL_COMMIT = "bb3bb61d716f52bb36e5f1c6e6514ece71abc555";
const CODEX_BIN = "/Users/sergio/.local/bin/codex";
const OPENCODE_BIN = "/Users/sergio/.opencode/bin/opencode";
const CODEX_VERSION = "0.150.1";
const OPENCODE_VERSION = "2.0.26";
const CODEX_MODEL = "gpt-5.6-sol";
const CODEX_REASONING = "high";
const OPENCODE_MODEL = "opencode/space-bunny-free#xhigh";
const MATCHED_BUDGET = { minutes: 20, toolCalls: 40 };
const RECIPIENT_BUDGET = { minutes: 10, toolCalls: 20 };
const READER_ID = "hum_rcl001_reader";

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

const WORKSPACES = {
  S1: { id: "ws_rcl001_s1", token: "s1", query: "partner callback" },
  S2: { id: "ws_rcl001_s2", token: "s2", query: "checkout retry" },
  S3: { id: "ws_rcl001_s3", token: "s3", query: "partner callback limit" },
} as const;

type Scenario = keyof typeof WORKSPACES;
type Arm = "control" | "treatment" | "recipient";

const TREATMENT_ADDENDUM =
  "Use recall_workspace with that query before you answer. You may also use orientation, catch-up, and drill-down. Do not write or update Campfire records.";
const CONTROL_ADDENDUM =
  "Use orientation, catch-up, and drill-down. Do not write or update Campfire records.";
const RECIPIENT_ADDENDUM =
  "The offline packet is the file packet.json in this directory. Do not use a Campfire credential or a live workspace.";

function fail(message: string): never {
  throw new Error(`rcl-001 run: ${message}`);
}

function execSyncText(command: string, args: string[], cwd = REPO_ROOT): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    fail(`${command} ${args[0] ?? ""} failed: ${(result.stderr || result.stdout || "").slice(0, 400)}`);
  }
  return (result.stdout || "").trim();
}

function assertProductTree(): void {
  const srcDiff = execSyncText("git", ["diff", "--stat", IMPLEMENTATION_COMMIT, "--", "src", "package.json", "package-lock.json"]);
  if (srcDiff !== "") fail(`product tree differs from ${IMPLEMENTATION_COMMIT}`);
  const lockDiff = execSyncText("git", ["diff", "--stat", CONTROL_COMMIT, IMPLEMENTATION_COMMIT, "--", "package-lock.json"]);
  if (lockDiff !== "") fail("control and treatment dependency locks differ");
  const lockText = readFileSync(join(REPO_ROOT, "fixtures/recall/rcl-001/RUN-LOCK.md"), "utf8");
  for (const needle of [
    IMPLEMENTATION_COMMIT,
    CONTROL_COMMIT,
    CODEX_VERSION,
    OPENCODE_VERSION,
    CODEX_MODEL,
    OPENCODE_MODEL,
    "20 minutes or 40 tool calls",
    "10 minutes or 20 tool calls",
    "S1 control, then treatment, then recipient",
    TREATMENT_ADDENDUM,
    CONTROL_ADDENDUM,
    RECIPIENT_ADDENDUM,
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
  if (!existsSync(databasePath) || !existsSync(tokenPath)) {
    seedDatabase(SEED_DIR, false);
  }
  const tokens = JSON.parse(readFileSync(tokenPath, "utf8")) as { s1: string; s2: string; s3: string };
  for (const key of ["s1", "s2", "s3"] as const) {
    if (typeof tokens[key] !== "string" || !tokens[key].startsWith("cft_")) fail(`seed token ${key} is missing`);
  }
  return { databasePath, tokens };
}

interface ScenarioText {
  task: string;
  query: string;
  continuation: string;
}

function parseScenarios(): Record<Scenario, ScenarioText> {
  const text = readFileSync(join(REPO_ROOT, "fixtures/recall/rcl-001/scenarios.md"), "utf8");
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
  for (const name of Object.keys(WORKSPACES) as Scenario[]) {
    if (found[name] === undefined) fail(`scenarios.md is missing ${name}`);
    if (found[name].query !== WORKSPACES[name].query) fail(`${name} query drifted`);
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
  const denies = [
    join(REPO_ROOT, "fixtures"),
    join(REPO_ROOT, "docs"),
    join(REPO_ROOT, "evidence"),
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
  ];
  for (const [scenario, arm] of ORDER) {
    const dir = join(RUNS_DIR, `${scenario}-${arm}`);
    if (dir !== runDir) denies.push(dir);
  }
  // Recipients stay outside the checkout. Matched arms still launch the MCP server from it.
  if (arm === "recipient") {
    denies.push(REPO_ROOT);
    if (REPO_ROOT.toLowerCase() !== REPO_ROOT) denies.push(REPO_ROOT.toLowerCase());
  }
  const lines = ["(version 1)", "(allow default)"];
  for (const path of denies) {
    lines.push(`(deny file-read* (subpath ${JSON.stringify(path)}))`);
  }
  lines.push(`(deny file-read* (literal ${JSON.stringify(join(homedir(), ".codex/config.toml"))}))`);
  lines.push(`(deny file-read* (literal ${JSON.stringify(join(homedir(), ".codex/memories_1.sqlite"))}))`);
  lines.push(`(deny file-read* (literal ${JSON.stringify(join(homedir(), ".codex/session_index.jsonl"))}))`);
  if (arm === "recipient") lines.push(`(deny file-write* (subpath ${JSON.stringify(REPO_ROOT)}))`);
  const profile = join(runDir, "private", "sandbox.sb");
  mkdirSync(dirname(profile), { recursive: true, mode: 0o700 });
  writeFileSync(profile, `${lines.join("\n")}\n`, { mode: 0o600 });
  return profile;
}

function copyAuth(codexHome: string, opencodeData: string): void {
  mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  mkdirSync(opencodeData, { recursive: true, mode: 0o700 });
  const codexAuth = join(homedir(), ".codex/auth.json");
  const opencodeAuth = join(homedir(), ".local/share/opencode/auth.json");
  if (!existsSync(codexAuth) || !existsSync(opencodeAuth)) fail("harness auth file is missing");
  copyFileSync(codexAuth, join(codexHome, "auth.json"));
  copyFileSync(opencodeAuth, join(opencodeData, "auth.json"));
  const account = join(homedir(), ".local/share/opencode/account.json");
  if (existsSync(account)) copyFileSync(account, join(opencodeData, "account.json"));
}

function writeCodexConfig(
  home: string,
  dbPath: string | undefined,
  token: string | undefined,
  actorId: string | undefined,
  stdio: string | undefined,
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
      `command = ${JSON.stringify(join(REPO_ROOT, "node_modules/.bin/tsx"))}`,
      `args = [${JSON.stringify(stdio)}]`,
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
  ]) {
    delete env[key];
  }
  env.HOME = isolatedHome;
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
  const env = { ...process.env, CAMPFIRE_DB: dbPath, CAMPFIRE_TOKEN: token };
  delete env.CAMPFIRE_URL;
  const result = spawnSync(
    join(REPO_ROOT, "node_modules/.bin/tsx"),
    [
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
  rmSync(runDir, { recursive: true, force: true });
  const workDir = join(runDir, "work");
  const privateDir = join(runDir, "private");
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  const prompt = promptFor(arm, text);
  writeFileSync(join(runDir, "prompt.txt"), prompt, { mode: 0o600 });
  if (arm === "recipient") {
    const dbCopy = join(privateDir, "packet-source.db");
    copyDatabase(seedDb, dbCopy);
    writePacket(dbCopy, token, WORKSPACES[scenario].id, text.query, join(workDir, "packet.json"));
    rmSync(dbCopy);
  } else {
    copyDatabase(seedDb, join(privateDir, "campfire.db"));
    writeFileSync(join(privateDir, "token"), token, { mode: 0o600 });
  }
  return runDir;
}

async function executeArm(scenario: Scenario, arm: Arm, text: ScenarioText, replacement: boolean): Promise<void> {
  const runDir = join(RUNS_DIR, `${scenario}-${arm}`);
  const workDir = join(runDir, "work");
  const privateDir = join(runDir, "private");
  const isolatedHome = join(privateDir, "home");
  const codexHome = join(privateDir, "codex-home");
  const opencodeData = join(privateDir, "opencode-data");
  mkdirSync(isolatedHome, { recursive: true, mode: 0o700 });
  copyAuth(codexHome, opencodeData);
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
          actorId: WORKSPACES[scenario].id.replace("ws_rcl001_", "hum_rcl001_"),
        }),
    isolatedHome,
    codexHome,
    opencodeData,
  });
  const budget = arm === "recipient" ? RECIPIENT_BUDGET : MATCHED_BUDGET;
  process.stdout.write(`ARM_START ${scenario} ${arm}\n`);
  const stopped = await runHarness(profile, launch, arm, eventsPath, budget);
  const answer = finalAnswer(arm, eventsPath, answerPath);
  if (answer !== "") writeFileSync(answerPath, `${answer}\n`, { mode: 0o600 });
  const tools = arm === "recipient"
    ? parseOpencodeEvents(existsSync(eventsPath) ? readFileSync(eventsPath, "utf8") : "")
    : parseCodexEvents(existsSync(eventsPath) ? readFileSync(eventsPath, "utf8") : "");
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
    campfireTools: tools.mcpCalls.map((call) => call.tool),
    otherTools: tools.nonMcpToolCalls.map((call) => call.tool),
    startedAt: stopped.startedAt,
    finishedAt: stopped.finishedAt,
    answerBytes: Buffer.byteLength(answer),
    recallCalls: tools.mcpCalls.filter((call) => call.tool.includes("recall")).length,
  };
  writeFileSync(join(runDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`ARM_DONE ${scenario} ${arm} ${stopped.stopReason} tools=${stopped.toolCalls} answerBytes=${meta.answerBytes}\n`);
  if (answer === "") {
    const invalid = `${runDir}-invalid${replacement ? "-2" : ""}`;
    rmSync(invalid, { recursive: true, force: true });
    renameSync(runDir, invalid);
    fail(`empty answer for ${scenario} ${arm}; invalid attempt kept at ${invalid}`);
  }
}

function probeSandbox(): void {
  const profile = join(PILOT_ROOT, "probe.sb");
  mkdirSync(PILOT_ROOT, { recursive: true, mode: 0o700 });
  const target = join(REPO_ROOT, "fixtures/recall/rcl-001/ground-truth.md");
  writeFileSync(
    profile,
    `(version 1)\n(allow default)\n(deny file-read* (subpath ${JSON.stringify(join(REPO_ROOT, "fixtures"))}))\n`,
    { mode: 0o600 },
  );
  const result = spawnSync("sandbox-exec", ["-f", profile, "/bin/cat", target], { encoding: "utf8" });
  if (result.status === 0 || result.stdout.includes("Correct next action")) {
    fail("sandbox allowed a read of the answer key");
  }
  process.stdout.write("PROBE_SANDBOX denied the answer key\n");
}

async function probeModels(): Promise<void> {
  const runDir = join(PILOT_ROOT, "probe-ready");
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(join(runDir, "work"), { recursive: true, mode: 0o700 });
  const privateDir = join(runDir, "private");
  mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  const codexHome = join(privateDir, "codex-home");
  const opencodeData = join(privateDir, "opencode-data");
  copyAuth(codexHome, opencodeData);
  writeCodexConfig(codexHome, undefined, undefined, undefined);
  writeOpencodeConfig(join(runDir, "work"));
  const profile = sandboxProfile(runDir);
  const prompt = "Reply with the single word READY. Do not use tools.";
  for (const arm of ["control", "recipient"] as const) {
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
    const stopped = await runHarness(profile, launch, arm, eventsPath, { minutes: 5, toolCalls: 8 });
    const answer = finalAnswer(arm, eventsPath, answerPath);
    process.stdout.write(`PROBE_MODEL ${arm} ${stopped.stopReason} exit=${stopped.exitCode} answer=${JSON.stringify(answer.slice(0, 80))}\n`);
    if (!answer.toUpperCase().includes("READY")) fail(`${arm} probe did not answer READY`);
  }
  process.stdout.write("PROBE_DONE\n");
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "probe-sandbox") {
    probeSandbox();
    return;
  }
  assertProductTree();
  ensureControlTree();
  if (command === "probe") {
    probeSandbox();
    await probeModels();
    return;
  }
  if (command !== "run") fail("expected probe-sandbox, probe, or run");
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
  const scenarios = parseScenarios();
  const seed = ensureSeed();
  for (const [scenario, arm] of ORDER) {
    const name = `${scenario}-${arm}`;
    if (only !== undefined && only !== name) continue;
    const metaPath = join(RUNS_DIR, name, "meta.json");
    if (only === undefined && existsSync(metaPath)) {
      const existing = JSON.parse(readFileSync(metaPath, "utf8")) as { answerBytes?: number };
      if ((existing.answerBytes ?? 0) > 0) {
        process.stdout.write(`ARM_SKIP ${scenario} ${arm}\n`);
        continue;
      }
    }
    const text = scenarios[scenario];
    const token = seed.tokens[WORKSPACES[scenario].token];
    prepareArm(scenario, arm, seed.databasePath, token, text);
    try {
      await executeArm(scenario, arm, text, false);
    } catch (error) {
      process.stdout.write(`ARM_RETRY ${name}\n`);
      prepareArm(scenario, arm, seed.databasePath, token, text);
      await executeArm(scenario, arm, text, true);
      if (!(error instanceof Error)) throw error;
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
