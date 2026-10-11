/**
 * Unscored recipient diagnostic.
 *
 * Confirms a fresh OpenCode process can read the offline packet and cannot
 * read the Campfire checkout. This does not score RCL-001 and does not write
 * into ~/.campfire-pilot/rcl-001/runs.
 *
 *   npx tsx fixtures/recall/rcl-002/diagnose.ts
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOpencodeEvents } from "../../../src/acceptance/real/opencode-events.js";
import type { ActorRef } from "../../../src/domain/types.js";
import { createCampfireService } from "../../../src/service/campfire-service.js";
import { openSqliteStore } from "../../../src/store/sqlite-store.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = resolve(homedir(), ".campfire-pilot/rcl-002/diagnose");
const OPENCODE_BIN = "/Users/sergio/.opencode/bin/opencode";
// The RCL-001 free model now returns FreeTierError 403 from `opencode run`.
// This unscored check uses a model the local account can route. It does not rescore RCL-001.
const OPENCODE_MODEL = "opencode-go/glm-5.2#max";
const SCORED_RUNS = resolve(homedir(), ".campfire-pilot/rcl-001/runs");
const SCORED_SEED = resolve(homedir(), ".campfire-pilot/rcl-001/seed");

function fail(message: string): never {
  throw new Error(`rcl-002 diagnose: ${message}`);
}

function sandboxProfile(workDir: string, profilePath: string): void {
  // Provider auth stays readable so a routable model can start. The checkout and the scored RCL-001 runs do not.
  const denies = [
    REPO_ROOT,
    REPO_ROOT.toLowerCase(),
    SCORED_RUNS,
    SCORED_SEED,
    join(homedir(), ".config/campfire"),
    join(homedir(), ".local/share/campfire"),
    join(homedir(), ".codex/memories"),
    join(homedir(), ".codex/sessions"),
    join(homedir(), ".codex/skills"),
    join(homedir(), ".codex/rules"),
  ];
  const lines = ["(version 1)", "(allow default)"];
  for (const path of denies) lines.push(`(deny file-read* (subpath ${JSON.stringify(path)}))`);
  // Seatbelt matches the spelling it is given. Deny both checkout spellings.
  for (const root of new Set([REPO_ROOT, REPO_ROOT.toLowerCase()])) {
    lines.push(`(deny file-write* (subpath ${JSON.stringify(root)}))`);
  }
  lines.push(`(allow file-read* (subpath ${JSON.stringify(workDir)}))`);
  mkdirSync(dirname(profilePath), { recursive: true, mode: 0o700 });
  writeFileSync(profilePath, `${lines.join("\n")}\n`, { mode: 0o600 });
}

function seedPacket(workDir: string, nonce: string): void {
  const dbPath = join(OUT, "private", "campfire.db");
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  const store = openSqliteStore(dbPath);
  const service = createCampfireService({ store });
  const now = "2026-10-11T18:00:00.000Z";
  let closed = false;
  try {
    store.createOrganization({ id: "org_diag", name: "Diagnostic", createdAt: now });
    store.createTeam({ id: "team_diag", organizationId: "org_diag", name: "Diagnostic", createdAt: now });
    const owner = service.createHuman(undefined, { teamId: "team_diag", displayName: "Diagnostic owner" });
    const ownerCtx = { actor: { actorId: owner.human.id, actorType: "human" as const } };
    const reader = service.createHuman(ownerCtx, { teamId: "team_diag", displayName: "Diagnostic reader" });
    const workspace = service.createWorkspace(ownerCtx, { teamId: "team_diag", name: "Diagnostic workspace" });
    const readerRef: ActorRef = { actorId: reader.human.id, actorType: "human" };
    service.inviteToWorkspace(ownerCtx, { workspaceId: workspace.id, actor: readerRef, role: "viewer" });
    service.joinWorkspace({ actor: readerRef }, { workspaceId: workspace.id });
    const created = service.addDecision(ownerCtx, {
      workspaceId: workspace.id,
      summary: "Ship the callback signature.",
      rationale: nonce,
    });
    service.acceptDecision(ownerCtx, created.id);
    service.close();
    closed = true;
    const packetPath = join(workDir, "packet.json");
    const env = { ...process.env, CAMPFIRE_DB: dbPath, CAMPFIRE_TOKEN: owner.token };
    delete env.CAMPFIRE_URL;
    const result = spawnSync(
      join(REPO_ROOT, "node_modules/.bin/tsx"),
      [
        join(REPO_ROOT, "src/cli/index.ts"),
        "handoff-packet",
        workspace.id,
        "--query",
        "callback signature",
        "--recipient-type",
        "human",
        "--recipient",
        reader.human.id,
        "--out",
        packetPath,
        "--output",
        "json",
      ],
      { cwd: REPO_ROOT, env, encoding: "utf8" },
    );
    if (result.status !== 0) fail(`handoff-packet failed: ${(result.stderr || "").slice(0, 400)}`);
    const mode = statSync(packetPath).mode & 0o777;
    if (mode !== 0o600) fail(`packet mode is ${mode.toString(8)}`);
    const packet = readFileSync(packetPath, "utf8");
    if (!packet.includes(nonce)) fail("packet omitted the decision rationale");
    if (packet.includes(owner.token) || packet.includes("cft_")) fail("packet contains a credential");
  } finally {
    if (!closed) service.close();
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }
}

function assertWriteDenied(profile: string, workDir: string, root: string): void {
  const probe = join(root, ".rcl002-write-probe");
  const result = spawnSync("sandbox-exec", ["-f", profile, "/bin/sh", "-c", 'printf probe > "$1"', "sh", probe], {
    cwd: workDir,
    encoding: "utf8",
  });
  const created = existsSync(probe);
  if (created) rmSync(probe, { force: true });
  if (result.status === 0 || created) fail("sandbox allowed a checkout write");
}

function assertSandboxDeniesRepo(profile: string, packetPath: string): void {
  const workDir = dirname(packetPath);
  const denied = spawnSync("sandbox-exec", ["-f", profile, "/bin/cat", join(REPO_ROOT, "src/domain/recall.ts")], {
    cwd: workDir,
    encoding: "utf8",
  });
  if (denied.status === 0 || denied.stdout.includes("HANDOFF_RATIONALE_MAX_BYTES")) {
    fail("sandbox allowed a read of the checkout");
  }
  for (const root of new Set([REPO_ROOT, REPO_ROOT.toLowerCase()])) assertWriteDenied(profile, workDir, root);
  const allowed = spawnSync("sandbox-exec", ["-f", profile, "/bin/cat", packetPath], {
    cwd: workDir,
    encoding: "utf8",
  });
  if (allowed.status !== 0) fail("sandbox blocked the packet");
  process.stdout.write("SANDBOX_WRITE_DENY_OK\n");
}

function runRecipient(workDir: string, profile: string, eventsPath: string): Promise<{ code: number | null }> {
  writeFileSync(
    join(workDir, "opencode.json"),
    `${JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      share: "disabled",
      autoupdate: false,
      snapshot: false,
      permission: { bash: "deny", edit: "deny", webfetch: "deny", websearch: "deny", external_directory: "deny" },
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
  const prompt = [
    "Read only packet.json in this directory.",
    "Reply with the decision rationale and nothing else.",
    "Do not run a shell. Do not search any other directory.",
  ].join(" ");
  const env = { ...process.env };
  for (const key of ["CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_DB", "CAMPFIRE_ACTOR_ID", "CAMPFIRE_ACTOR_TYPE", "OLDPWD", "INIT_CWD"]) {
    delete env[key];
  }
  env.PWD = workDir;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      "sandbox-exec",
      ["-f", profile, OPENCODE_BIN, "run", "--standalone", "--format", "json", "--auto", "--model", OPENCODE_MODEL, prompt],
      { cwd: workDir, env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const events = createWriteStream(eventsPath, { flags: "w", mode: 0o600 });
    child.stdout?.pipe(events);
    const timer = setTimeout(() => {
      if (child.pid !== undefined) process.kill(-child.pid, "SIGTERM");
    }, 5 * 60 * 1000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      events.end(() => resolvePromise({ code }));
    });
  });
}

function repoReadSucceeded(events: string): string | undefined {
  const parsed = parseOpencodeEvents(events);
  for (const call of parsed.nonMcpToolCalls) {
    const input = JSON.stringify(call.input ?? {});
    const output = call.output ?? "";
    const mentionsRepo = input.includes(REPO_ROOT) || output.includes(REPO_ROOT) || input.includes("Campfire-Internal");
    if (!mentionsRepo) continue;
    const denied = output.includes("Operation not permitted") || output.includes("Unable to read") || call.isError === true;
    if (!denied) return `${call.tool} read the checkout`;
  }
  if (parsed.mcpCalls.length > 0) return "recipient called Campfire";
  return undefined;
}

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  const workDir = join(OUT, "work");
  const privateDir = join(OUT, "private");
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  const nonce = `overlap-marker-${randomBytes(8).toString("hex")}`;
  seedPacket(workDir, nonce);
  const profile = join(privateDir, "sandbox.sb");
  sandboxProfile(workDir, profile);
  assertSandboxDeniesRepo(profile, join(workDir, "packet.json"));
  const eventsPath = join(OUT, "events.jsonl");
  const stopped = await runRecipient(workDir, profile, eventsPath);
  const events = existsSync(eventsPath) ? readFileSync(eventsPath, "utf8") : "";
  const answer = parseOpencodeEvents(events).finalMessage.trim();
  const repo = repoReadSucceeded(events);
  const readPacket = events.includes("packet.json");
  const meta = {
    unscored: true,
    exitCode: stopped.code,
    answerHasRationale: answer.includes(nonce),
    readPacket,
    repoRead: repo ?? null,
    toolCalls: parseOpencodeEvents(events).nonMcpToolCalls.length,
    answerBytes: Buffer.byteLength(answer),
  };
  writeFileSync(join(OUT, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(OUT, "answer.txt"), `${answer}\n`, { mode: 0o600 });
  process.stdout.write(`DIAGNOSE ${JSON.stringify(meta)}\n`);
  if (!meta.answerHasRationale || !readPacket || repo !== undefined) {
    fail("recipient did not stay with the packet");
  }
  process.stdout.write("DIAGNOSE_OK\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
