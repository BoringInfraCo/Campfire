/**
 * ONB-001 Step 0 — invitation join baseline capture (journey D).
 *
 * FIXTURE EVIDENCE — scripted engineering captures of the published v1.22.0
 * CLI. A scripted PTY run is a debugging rehearsal, never human evidence.
 *
 *   npx tsx fixtures/onb-001/capture-join.ts \
 *     --root <clean v1.22.0 worktree> [--out docs/evidence/onb-001]
 *
 * Ownership model: one owner scenario (scripted `onboard` + local `serve` on an
 * ephemeral loopback port) issues real single-use invitations; every join case
 * uses a fresh recipient scenario with its own invitation, except the shared
 * recipient used by D12–D17 to pin the return surfaces of one enrollment. The
 * owner listener lives for the whole run and is stopped in a finally.
 *
 * Cases:
 *   D1  invite-teammate receipt + masked invitation-file copy (0600)
 *   D2  successful join in a terminal (human receipt)
 *   D3  successful join piped (auto -> JSON receipt: stages, no token field)
 *   D4  successful join with explicit --output human piped (human receipt bytes)
 *   D5  used invitation denied (already-claimed conflict, fresh recipient)
 *   D6  expired invitation denied (client-side expiry check)
 *   D7  wrong-endpoint invitation denied + no local first-run fallback after
 *   D8  unreadable (non-JSON) invitation denied
 *   D9  wrong-shape invitation denied
 *   D10 non-private (0644) invitation denied (masked as a parse failure)
 *   D11 initialized local profile refusal (no covert merge)
 *   D12 recipient bare `campfire` piped after join (remote summary, human)
 *   D13 recipient bare `campfire --output json` after join (remote summary JSON)
 *   D14 recipient `campfire status` after join (authorized remote read JSON)
 *   D15 recipient `campfire status --output human` after join (human read view)
 *   D16 recipient `up --no-connect` remote (daemon, JSON receipt)
 *   D17 recipient `up --no-connect` remote in a terminal (human receipt)
 *   D18 successful join with --harness opencode (human receipt, Connected opencode.)
 *
 * No real harness process runs. Join with an explicit --harness prepares
 * harness config inside the isolated scenario HOME/XDG only. The owner
 * invitation secret is read solely to add it to the leak needles and to write
 * the masked D1 copy; it is never written raw.
 */
import { chmodSync, copyFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Evidence,
  createScenario,
  destroyScenario,
  runPiped,
  scenarioEnv,
  sleep,
  startDaemon,
  type Daemon,
  type Scenario,
} from "./lib/capture.js";
import { runPty } from "./lib/pty.js";
import {
  machineFacts,
  newCase,
  parseToolArgs,
  ToolRun,
  verifyBaselineRoot,
  type CaseRecord,
} from "./lib/tool.js";

const NAME = "onb-001 capture-join";
const args = parseToolArgs(process.argv.slice(2), NAME);
const baseline = verifyBaselineRoot(NAME, args.root);
const evidence = new Evidence(args.out, [process.env.HOME ?? ""]);
const run = new ToolRun(NAME, baseline);

const WORKSPACE_NAME = "billing-deploy-failure";
const GOAL = "Restore the billing deploy pipeline";

const scenarios: Scenario[] = [];
function acquireScenario(name: string): Scenario {
  const created = createScenario(name);
  scenarios.push(created);
  return created;
}

function cliArgv(argv: string[]): string[] {
  return [join(args.root, "node_modules/.bin/tsx"), join(args.root, "src/cli/index.ts"), ...argv];
}

async function waitFor(condition: () => boolean, label: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function captureFile(
  record: CaseRecord,
  relPath: string,
  content: string,
  kind: string,
  expectContains: string[] = [],
  expectAbsent: string[] = [],
): void {
  const options = { kind, expectContains, expectAbsent };
  const failed = evidence.evaluate(content, options);
  run.markFailed(
    record,
    failed.map((failure) => `${relPath}: ${failure}`),
  );
  record.files.push(evidence.write(relPath, content, options));
}

interface CaseMeta {
  id: string;
  journey: "D";
  title: string;
  method: "pty" | "piped";
  argvDisplay: string[];
  envCase?: Record<string, string>;
  simulated?: string[];
  real?: string[];
  notCaptured?: string[];
  /** Reuses a pre-built scenario (e.g. the shared joined recipient). */
  scenarioFactory?: () => Scenario;
}

async function runCase(
  meta: CaseMeta,
  body: (record: CaseRecord, s: Scenario) => Promise<void> | void,
): Promise<CaseRecord> {
  const s = meta.scenarioFactory !== undefined ? meta.scenarioFactory() : acquireScenario(meta.id.toLowerCase());
  const record = newCase({
    id: meta.id,
    journey: meta.journey,
    title: meta.title,
    method: meta.method,
    argvDisplay: meta.argvDisplay,
    envCase: meta.envCase ?? {},
    simulated: meta.simulated ?? [],
    real: meta.real ?? [],
    notCaptured: meta.notCaptured ?? [],
  });
  try {
    await body(record, s);
  } catch (error) {
    run.markFailed(record, [error instanceof Error ? error.message : String(error)]);
  }
  run.add(record);
  return record;
}

// ---------------------------------------------------------------------------
// Owner listener and invitation helpers
// ---------------------------------------------------------------------------

interface OwnerContext {
  scenario: Scenario;
  token: string;
  workspaceId: string;
  url: string;
  serve: Daemon;
}

let owner: OwnerContext | undefined;
let ownerServeExit: number | null = null;

const OWNER_SIMULATED = [
  "owner profile, workspace, goal, and invitations are created by shipped v1.22.0 commands in an isolated CAMPFIRE_CONFIG_DIR (no real profile exists or is touched)",
];
const OWNER_REAL = [
  "campfire v1.22.0 CLI run from the pinned worktree via tsx",
  "the owner `serve` listener is a real loopback server bound with --port 0",
];

async function startOwner(): Promise<void> {
  const scenario = acquireScenario("join-owner");
  const onboard = runPiped({
    root: args.root,
    scenario,
    argv: [
      "onboard",
      "--human-name", "Ada",
      "--agent-name", "Codex",
      "--harness", "codex",
      "--workspace-name", WORKSPACE_NAME,
      "--goal", GOAL,
      "--output", "json",
    ],
  });
  if (onboard.exitCode !== 0) {
    throw new Error(`owner onboard failed: ${onboard.stderr.slice(0, 300)}`);
  }
  const receipt = JSON.parse(onboard.stdout) as { human: { token: string }; workspace: { id: string } };
  evidence.addNeedle(receipt.human.token);
  const serve = startDaemon({ root: args.root, scenario, argv: ["serve", "--port", "0"] });
  const line = await serve.waitStderr(/\[campfire\] HTTP server listening on http:\/\/127\.0\.0\.1:\d+/);
  const url = /https?:\/\/127\.0\.0\.1:\d+/.exec(line)![0];
  owner = { scenario, token: receipt.human.token, workspaceId: receipt.workspace.id, url, serve };
}

/** Issues one real single-use invitation to a fresh private file. */
function issueInvitation(slug: string): { result: ReturnType<typeof runPiped>; path: string } {
  if (owner === undefined) throw new Error("owner listener is not running");
  const path = join(owner.scenario.base, `invitation-${slug}.json`);
  const result = runPiped({
    root: args.root,
    scenario: owner.scenario,
    argv: ["invite-teammate", owner.workspaceId, "--out", path, "--allow-loopback"],
    extraEnv: { CAMPFIRE_URL: owner.url, CAMPFIRE_TOKEN: owner.token },
  });
  if (result.exitCode !== 0) throw new Error(`invite ${slug} failed: ${result.stderr.slice(0, 300)}`);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { secret?: string };
    if (typeof parsed.secret === "string") evidence.addNeedle(parsed.secret);
  } catch {
    throw new Error(`invitation ${slug} is not readable JSON`);
  }
  return { result, path };
}

function joinArgv(file: string, extra: string[] = [], harness = "codex"): string[] {
  return [
    "join",
    "--invitation-file", file,
    "--human-name", "Ben",
    "--harness", harness,
    "--allow-loopback",
    ...extra,
  ];
}

/** Fresh recipient: issue an invitation, join it, and fail the case on refusal. */
function joinRecipient(s: Scenario, slug: string): void {
  const invitation = issueInvitation(slug);
  const result = runPiped({ root: args.root, scenario: s, argv: joinArgv(invitation.path) });
  if (result.exitCode !== 0) throw new Error(`join ${slug} failed: ${result.stderr.slice(0, 300)}`);
}

const JOIN_RECIPIENT_SIMULATED = [
  "the recipient profile is created by the shipped `campfire join` path in an isolated CAMPFIRE_CONFIG_DIR",
  "harness config is prepared at the simulated harness config path inside the isolated scenario HOME/XDG; no real harness is launched or detected",
];

let sharedRecipient: Scenario | undefined;
let sharedRecipientJoined = false;
function sharedRecipientScenario(): Scenario {
  if (sharedRecipient === undefined) sharedRecipient = acquireScenario("join-shared-recipient");
  return sharedRecipient;
}

const usedInvitations: Record<string, string> = {};

// ---------------------------------------------------------------------------
// Captures
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await startOwner();

  // ---- D1 — invite-teammate receipt + masked invitation file -----------------
  await runCase(
    {
      id: "D1",
      journey: "D",
      title: "invite-teammate receipt and the private invitation file it writes (secret masked)",
      method: "file",
      argvDisplay: ["campfire", "invite-teammate", "<workspace-id>", "--out", "<private-file>", "--allow-loopback"],
      envCase: { CAMPFIRE_URL: "http://127.0.0.1:<port> (owner serve)", CAMPFIRE_TOKEN: "<owner human token> (never captured)" },
      simulated: OWNER_SIMULATED,
      real: OWNER_REAL,
      notCaptured: [
        "the raw invitation file (its cfe-shaped secret is masked before writing)",
        "any real email or chat delivery of the invitation (the owner hands over the file out of band)",
      ],
    },
    (record) => {
      const invitation = issueInvitation("d1");
      const receipt = invitation.result;
      record.exitCode = receipt.exitCode;
      captureFile(record, "machine/D1-invite-receipt.stdout.txt", receipt.stdout, "piped-stdout", [
        '"invitationId":"ein_inv_[id]"',
        `"workspaceId":"ws_[id]"`,
        '"expiresAt":"[timestamp]"',
        '"path":"[path]"',
        '"url":"http://127.0.0.1:[port]"',
      ], ["cft_", "cfe_", '"secret"']);
      captureFile(record, "machine/D1-invite-receipt.stderr.txt", receipt.stderr, "piped-stderr", [], ["cft_", "cfe_"]);
      const raw = readFileSync(invitation.path, "utf8");
      const mode = (statSync(invitation.path).mode & 0o777).toString(8);
      record.checks = { fileMode: mode, rawBytes: Buffer.byteLength(raw, "utf8"), secretShape: /cfe_[a-f0-9]{32}/.test(raw) };
      captureFile(record, "machine/D1-invitation-file.masked.json", raw, "invitation-file-masked", [
        '"version": 1',
        '"kind": "enrollment_invitation"',
        '"secret": "[one-time-credential: redacted]"',
        '"codex"',
        '"opencode"',
        '"url": "http://127.0.0.1:[port]"',
      ], ["cft_", "cfe_"]);
      run.markFailed(record, [
        ...(receipt.exitCode !== 0 ? [`invite exitCode ${String(receipt.exitCode)}`] : []),
        ...(mode !== "600" ? [`invitation file mode was ${mode}, expected 600`] : []),
      ]);
    },
  );

  // ---- D2 — successful join in a terminal ------------------------------------
  await runCase(
    {
      id: "D2",
      journey: "D",
      title: "successful join in a terminal (human receipt)",
      method: "pty",
      argvDisplay: ["campfire", "join", "--invitation-file", "<private-file>", "--human-name", "Ben", "--harness", "codex", "--allow-loopback"],
      simulated: JOIN_RECIPIENT_SIMULATED,
      real: OWNER_REAL,
      notCaptured: ["a harness reload or tool approval (join writes config only; it cannot reload codex)"],
    },
    (record, s) => {
      const invitation = issueInvitation("d2");
      usedInvitations.d2 = invitation.path;
      const result = runPty({
        argv: cliArgv(joinArgv(invitation.path)),
        cwd: s.base,
        env: scenarioEnv(s),
        steps: [],
        timeoutMs: 30_000,
      });
      record.exitCode = result.exitCode;
      record.timedOut = result.timedOut;
      record.checks = { stepsSent: result.stepsSent, stepsTotal: result.stepsTotal, driverError: result.driverError ?? null };
      captureFile(record, "terminal/D2-join-success-pty.stream.txt", result.stream.toString("utf8"), "pty-stream", [
        `Joined ${WORKSPACE_NAME} as Ben.`,
        "Completed: enrolled, credentials_saved, connection_prepared, reload_required.",
        "Connected codex. Reload the harness and approve Campfire tools.",
        "Next: campfire up",
      ], ["cft_", "cfe_", "[campfire]"]);
      run.markFailed(record, [
        ...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : []),
        ...(result.driverError !== undefined ? [`pty driver error: ${result.driverError}`] : []),
      ]);
    },
  );

  // ---- D3 — successful join piped (auto -> JSON) -----------------------------
  await runCase(
    {
      id: "D3",
      journey: "D",
      title: "successful join piped (auto -> JSON receipt with stages, no token field)",
      method: "piped",
      argvDisplay: ["campfire", "join", "--invitation-file", "<private-file>", "--human-name", "Ben", "--harness", "codex", "--allow-loopback"],
      envCase: { stdoutIsTty: "false (piped)" },
      simulated: JOIN_RECIPIENT_SIMULATED,
      real: OWNER_REAL,
      notCaptured: ["a harness reload or tool approval (join writes config only; it cannot reload codex)"],
    },
    (record, s) => {
      const invitation = issueInvitation("d3");
      usedInvitations.d3 = invitation.path;
      const result = runPiped({ root: args.root, scenario: s, argv: joinArgv(invitation.path) });
      record.exitCode = result.exitCode;
      let payload: Record<string, unknown> | null = null;
      try {
        payload = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
      } catch {
        payload = null;
      }
      record.checks = {
        payloadParsed: payload !== null,
        stages: payload?.stages ?? null,
        hasTokenField: /"(token|secret|credential)"\s*:/.test(result.stdout),
      };
      captureFile(record, "machine/D3-join-success-auto-json.stdout.txt", result.stdout, "piped-stdout", [
        '"version":1,"kind":"workspace_enrollment"',
        '"invitationId":"ein_inv_[id]"',
        '"requestId":"[uuid]"',
        `"workspace":{"id":"ws_[id]","name":"${WORKSPACE_NAME}","teamId":"team_engineering"}`,
        '"human":{"id":"hum_[id]","name":"Ben"}',
        '"agents":[{"id":"agt_[id]","name":"Codex","harness":"codex"}]',
        '"enrolledAt":"[timestamp]"',
        '"stages":["enrolled","credentials_saved","connection_prepared","reload_required"]',
      ], ["cft_", "cfe_"]);
      captureFile(record, "machine/D3-join-success-auto-json.stderr.txt", result.stderr, "piped-stderr", [], ["cft_", "cfe_"]);
      run.markFailed(record, [
        ...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : []),
        ...(payload === null ? ["stdout did not parse as one JSON object"] : []),
      ]);
    },
  );

  // ---- D4 — successful join with explicit --output human ---------------------
  await runCase(
    {
      id: "D4",
      journey: "D",
      title: "successful join with explicit --output human piped (human receipt bytes, no terminal)",
      method: "piped",
      argvDisplay: ["campfire", "join", "--invitation-file", "<private-file>", "--human-name", "Ben", "--harness", "codex", "--allow-loopback", "--output", "human"],
      envCase: { stdoutIsTty: "false (piped)" },
      simulated: JOIN_RECIPIENT_SIMULATED,
      real: OWNER_REAL,
      notCaptured: ["a harness reload or tool approval (join writes config only; it cannot reload codex)"],
    },
    (record, s) => {
      const invitation = issueInvitation("d4");
      const result = runPiped({ root: args.root, scenario: s, argv: joinArgv(invitation.path, ["--output", "human"]) });
      record.exitCode = result.exitCode;
      captureFile(record, "machine/D4-join-success-human.stdout.txt", result.stdout, "piped-stdout", [
        `Joined ${WORKSPACE_NAME} as Ben.`,
        "Completed: enrolled, credentials_saved, connection_prepared, reload_required.",
        "Connected codex. Reload the harness and approve Campfire tools.",
        "Next: campfire up",
      ], ["cft_", "cfe_", '"kind"']);
      captureFile(record, "machine/D4-join-success-human.stderr.txt", result.stderr, "piped-stderr", [], ["cft_", "cfe_"]);
      run.markFailed(record, [...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : [])]);
    },
  );

  // ---- D5 — used invitation denied -------------------------------------------
  await runCase(
    {
      id: "D5",
      journey: "D",
      title: "used invitation denied for a different recipient (claimed conflict, no success screen)",
      method: "piped",
      argvDisplay: ["campfire", "join", "--invitation-file", "<already-claimed private file>", "--human-name", "Ben", "--harness", "codex", "--allow-loopback"],
      envCase: { stdoutIsTty: "false (piped)" },
      simulated: JOIN_RECIPIENT_SIMULATED,
      real: OWNER_REAL,
      notCaptured: ["the recipient's pending-enrollment state on disk (it may exist; never captured or copied into evidence)"],
    },
    (record, s) => {
      const claimed = usedInvitations.d3;
      if (claimed === undefined) throw new Error("D5 requires the D3 invitation to have been claimed first");
      const result = runPiped({ root: args.root, scenario: s, argv: joinArgv(claimed) });
      record.exitCode = result.exitCode;
      captureFile(record, "machine/D5-used-invitation.stderr.txt", result.stderr, "piped-stderr", [
        '"code":"Conflict"',
        '"message":"Invitation was claimed by a different enrollment request"',
        '"recoveryCode":"invitation_already_claimed"',
        '"httpStatus":400',
        '"command":"campfire join --help"',
      ], ["cft_", "cfe_"]);
      captureFile(record, "machine/D5-used-invitation.stdout.txt", result.stdout, "piped-stdout", [], ["Joined "]);
      run.markFailed(record, [
        ...(result.exitCode !== 1 ? [`exitCode ${String(result.exitCode)}, expected 1`] : []),
        ...(result.stdout.trim().length !== 0 ? ["stdout was not empty"] : []),
      ]);
    },
  );

  // ---- D6 — expired invitation denied ----------------------------------------
  await runCase(
    {
      id: "D6",
      journey: "D",
      title: "expired invitation denied before any server claim (expiresAt rewritten in a private copy)",
      method: "piped",
      argvDisplay: ["campfire", "join", "--invitation-file", "<expired private file>", "--human-name", "Ben", "--harness", "codex", "--allow-loopback"],
      envCase: { stdoutIsTty: "false (piped)", expiresAt: "rewritten to 2020-01-01T00:00:00Z (masked as [timestamp])" },
      simulated: JOIN_RECIPIENT_SIMULATED,
      real: OWNER_REAL,
      notCaptured: ["any server-side claim attempt (the expiry check is client-side; the invitation stays unclaimed)"],
    },
    (record, s) => {
      const invitation = issueInvitation("d6");
      const raw = JSON.parse(readFileSync(invitation.path, "utf8")) as Record<string, unknown>;
      const expiredPath = join(s.base, "invitation-expired.json");
      writeFileSync(expiredPath, `${JSON.stringify({ ...raw, expiresAt: "2020-01-01T00:00:00Z" }, null, 2)}\n`, { mode: 0o600 });
      captureFile(record, "machine/D6-expired-invitation-input.masked.json", readFileSync(expiredPath, "utf8"), "invitation-file-masked",
        ['"kind": "enrollment_invitation"', '"secret": "[one-time-credential: redacted]"', '"expiresAt": "[timestamp]"'], ["cft_", "cfe_"]);
      const result = runPiped({ root: args.root, scenario: s, argv: joinArgv(expiredPath) });
      record.exitCode = result.exitCode;
      captureFile(record, "machine/D6-expired-invitation.stderr.txt", result.stderr, "piped-stderr", [
        '"message":"Invitation has expired; ask the owner for a new invitation"',
        '"nextAction":"request_new_invitation"',
        '"command":"campfire join --invitation-file <original-private-file> --human-name <original-name> --harness codex|opencode"',
      ], ["cft_", "cfe_"]);
      run.markFailed(record, [
        ...(result.exitCode !== 1 ? [`exitCode ${String(result.exitCode)}, expected 1`] : []),
        ...(result.stdout.trim().length !== 0 ? ["stdout was not empty"] : []),
      ]);
    },
  );

  // ---- D7 — wrong endpoint denied + no local fallback ------------------------
  await runCase(
    {
      id: "D7",
      journey: "D",
      title: "wrong-endpoint invitation denied as an uncertain commit; bare campfire after the failure shows the uninitialized-profile error, not a success screen",
      method: "piped",
      argvDisplay: ["campfire", "join", "--invitation-file", "<rewritten-endpoint private file>", "--human-name", "Ben", "--harness", "codex", "--allow-loopback"],
      envCase: { stdoutIsTty: "false (piped)", url: "rewritten to http://127.0.0.1:1 (nothing listens there)" },
      simulated: JOIN_RECIPIENT_SIMULATED,
      real: OWNER_REAL,
      notCaptured: ["the recipient's pending-enrollment state on disk (never captured or copied into evidence)"],
    },
    (record, s) => {
      const invitation = issueInvitation("d7");
      const raw = JSON.parse(readFileSync(invitation.path, "utf8")) as Record<string, unknown>;
      const wrongPath = join(s.base, "invitation-wrong-endpoint.json");
      writeFileSync(wrongPath, `${JSON.stringify({ ...raw, url: "http://127.0.0.1:1" }, null, 2)}\n`, { mode: 0o600 });
      captureFile(record, "machine/D7-wrong-endpoint-invitation-input.masked.json", readFileSync(wrongPath, "utf8"), "invitation-file-masked",
        ['"kind": "enrollment_invitation"', '"secret": "[one-time-credential: redacted]"', '"url": "http://127.0.0.1:[port]"'], ["cft_", "cfe_"]);
      const result = runPiped({ root: args.root, scenario: s, argv: joinArgv(wrongPath) });
      captureFile(record, "machine/D7-wrong-endpoint.stderr.txt", result.stderr, "piped-stderr", [
        '"code":"ValidationError"',
        '"message":"Enrollment commit is uncertain: the response was lost. Retry the same invitation with the saved request"',
        '"nextAction":"retry_saved_enrollment"',
      ], ["cft_", "cfe_"]);
      const bare = runPiped({ root: args.root, scenario: s, argv: [] });
      captureFile(record, "machine/D7-post-failure-bare.stdout.txt", bare.stdout, "piped-stdout", [], ["Joined ", "campfire up"]);
      captureFile(record, "machine/D7-post-failure-bare.stderr.txt", bare.stderr, "piped-stderr", [
        "[ValidationError] Run campfire in a terminal to confirm your name, or pass --human-name. Agents and workspaces appear when a harness connects.",
        "Next:",
        "  campfire --human-name <name>",
      ], ["cft_", "cfe_"]);
      record.exitCode = result.exitCode;
      record.checks = { joinExit: result.exitCode, postFailureBareExit: bare.exitCode };
      run.markFailed(record, [
        ...(result.exitCode !== 1 ? [`join exitCode ${String(result.exitCode)}, expected 1`] : []),
        ...(bare.exitCode !== 1 ? [`post-failure bare exitCode ${String(bare.exitCode)}, expected 1`] : []),
      ]);
    },
  );

  // ---- D8 — unreadable invitation denied -------------------------------------
  await runCase(
    {
      id: "D8",
      journey: "D",
      title: "non-JSON invitation file denied (parse failure, check_invitation_file recovery)",
      method: "piped",
      argvDisplay: ["campfire", "join", "--invitation-file", "<non-JSON private file>", "--human-name", "Ben", "--harness", "codex", "--allow-loopback"],
      envCase: { stdoutIsTty: "false (piped)" },
      simulated: ["a synthetic 0600 private file containing `not json at all`"],
      real: ["campfire v1.22.0 CLI run from the pinned worktree via tsx"],
      notCaptured: ["any server contact (the parse check happens before the claim)"],
    },
    (record, s) => {
      const badPath = join(s.base, "invitation-garbage.json");
      writeFileSync(badPath, "not json at all\n", { mode: 0o600 });
      captureFile(record, "machine/D8-non-json-invitation.input.txt", readFileSync(badPath, "utf8"), "synthetic-invitation-input", [], []);
      const result = runPiped({ root: args.root, scenario: s, argv: joinArgv(badPath) });
      record.exitCode = result.exitCode;
      captureFile(record, "machine/D8-non-json-invitation.stderr.txt", result.stderr, "piped-stderr", [
        '"message":"Enrollment file is missing or invalid; use the original private file"',
        '"nextAction":"check_invitation_file"',
      ], ["cft_", "cfe_"]);
      run.markFailed(record, [...(result.exitCode !== 1 ? [`exitCode ${String(result.exitCode)}, expected 1`] : [])]);
    },
  );

  // ---- D9 — wrong-shape invitation denied ------------------------------------
  await runCase(
    {
      id: "D9",
      journey: "D",
      title: "wrong-shape invitation file denied (unsupported invitation, check_invitation_file recovery)",
      method: "piped",
      argvDisplay: ["campfire", "join", "--invitation-file", "<wrong-shape private file>", "--human-name", "Ben", "--harness", "codex", "--allow-loopback"],
      envCase: { stdoutIsTty: "false (piped)" },
      simulated: ["a synthetic 0600 private file containing `{\"version\": 1, \"kind\": \"something_else\"}`"],
      real: ["campfire v1.22.0 CLI run from the pinned worktree via tsx"],
      notCaptured: ["any server contact (the shape check happens before the claim)"],
    },
    (record, s) => {
      const shapePath = join(s.base, "invitation-shape.json");
      writeFileSync(shapePath, `${JSON.stringify({ version: 1, kind: "something_else" }, null, 2)}\n`, { mode: 0o600 });
      captureFile(record, "machine/D9-wrong-shape-invitation.input.txt", readFileSync(shapePath, "utf8"), "synthetic-invitation-input", [], []);
      const result = runPiped({ root: args.root, scenario: s, argv: joinArgv(shapePath) });
      record.exitCode = result.exitCode;
      captureFile(record, "machine/D9-wrong-shape-invitation.stderr.txt", result.stderr, "piped-stderr", [
        '"message":"Unsupported or invalid invitation file"',
        '"nextAction":"check_invitation_file"',
      ], ["cft_", "cfe_"]);
      run.markFailed(record, [...(result.exitCode !== 1 ? [`exitCode ${String(result.exitCode)}, expected 1`] : [])]);
    },
  );

  // ---- D10 — non-private permissions denied ----------------------------------
  await runCase(
    {
      id: "D10",
      journey: "D",
      title: "0644 invitation copy denied; the intended private-file message is swallowed by the parse catch in v1.22.0 (observed as a parse failure)",
      method: "piped",
      argvDisplay: ["campfire", "join", "--invitation-file", "<0644 private-file copy>", "--human-name", "Ben", "--harness", "codex", "--allow-loopback"],
      envCase: { stdoutIsTty: "false (piped)", fileMode: "0600 copy chmod 0644 before the join" },
      simulated: ["a valid invitation file copied and chmod 0644 inside the recipient scenario"],
      real: ["campfire v1.22.0 CLI run from the pinned worktree via tsx"],
      notCaptured: ["any server contact (the permission check happens before the claim)"],
    },
    (record, s) => {
      const invitation = issueInvitation("d10");
      const permPath = join(s.base, "invitation-perms.json");
      copyFileSync(invitation.path, permPath);
      chmodSync(permPath, 0o644);
      const mode = (statSync(permPath).mode & 0o777).toString(8);
      const result = runPiped({ root: args.root, scenario: s, argv: joinArgv(permPath) });
      record.exitCode = result.exitCode;
      record.checks = { fileMode: mode };
      record.notes.push(
        "source at v1.22.0: src/bootstrap/enrollment-client.ts:35 fails with `Enrollment file must be a bounded private file`, but failure() throws inside the try and the catch at :38 rewrites every failure to `Enrollment file is missing or invalid; use the original private file` — the observed message is the swallowed one.",
      );
      captureFile(record, "machine/D10-non-private-invitation.stderr.txt", result.stderr, "piped-stderr", [
        '"message":"Enrollment file is missing or invalid; use the original private file"',
        '"nextAction":"check_invitation_file"',
      ], ["cft_", "cfe_"]);
      run.markFailed(record, [
        ...(mode !== "644" ? [`file mode was ${mode}, expected 644`] : []),
        ...(result.exitCode !== 1 ? [`exitCode ${String(result.exitCode)}, expected 1`] : []),
      ]);
    },
  );

  // ---- D11 — initialized local profile refusal -------------------------------
  await runCase(
    {
      id: "D11",
      journey: "D",
      title: "join against an initialized local profile is refused and the profile is unchanged (no covert merge)",
      method: "piped",
      argvDisplay: ["campfire", "join", "--invitation-file", "<valid private file>", "--human-name", "Ben", "--harness", "codex", "--allow-loopback"],
      envCase: { stdoutIsTty: "false (piped)", localProfile: "created first with `campfire --human-name Rob --output json`" },
      simulated: JOIN_RECIPIENT_SIMULATED,
      real: OWNER_REAL,
      notCaptured: ["any server contact (the profile check refuses before the claim)"],
    },
    (record, s) => {
      const prep = runPiped({ root: args.root, scenario: s, argv: ["--human-name", "Rob", "--output", "json"] });
      if (prep.exitCode !== 0) throw new Error(`local profile precondition failed: ${prep.stderr.slice(0, 300)}`);
      const invitation = issueInvitation("d11");
      const result = runPiped({ root: args.root, scenario: s, argv: joinArgv(invitation.path) });
      record.exitCode = result.exitCode;
      captureFile(record, "machine/D11-initialized-profile.stderr.txt", result.stderr, "piped-stderr", [
        '"message":"An existing profile or credential bundle would be replaced; use an isolated CAMPFIRE_CONFIG_DIR"',
        '"nextAction":"use_isolated_profile"',
      ], ["cft_", "cfe_"]);
      const after = runPiped({ root: args.root, scenario: s, argv: ["--output", "json"] });
      // `printStatus(asJson)` (src/cli/index.ts:2477) prints
      // {workspace, workspaceId, goal, human, agent, harness, databasePath};
      // JSON.stringify omits the undefined workspace fields of an
      // awaiting-workspace profile, so the local summary is just
      // {"human":"Rob","databasePath":"..."} — and the absence of any
      // workspace/workspaceId string proves the refused join never attached one.
      captureFile(record, "machine/D11-after-refusal-profile.stdout.txt", after.stdout, "piped-stdout", [
        '"human":"Rob"',
        '"databasePath":"[path]"',
      ], ["cft_", "cfe_", WORKSPACE_NAME, '"workspaceId"', '"harness"']);
      let afterPayload: Record<string, unknown> | null = null;
      try {
        afterPayload = JSON.parse(after.stdout.trim()) as Record<string, unknown>;
      } catch {
        afterPayload = null;
      }
      record.checks = {
        postRefusalProfileParsed: afterPayload !== null,
        postRefusalWorkspaceFieldPresent:
          afterPayload !== null && ("workspaceId" in afterPayload || "workspace" in afterPayload),
      };
      run.markFailed(record, [
        ...(result.exitCode !== 1 ? [`join exitCode ${String(result.exitCode)}, expected 1`] : []),
        ...(after.exitCode !== 0 ? [`post-refusal profile exitCode ${String(after.exitCode)}`] : []),
        ...(afterPayload === null ? ["post-refusal profile stdout did not parse as one JSON object"] : []),
        ...(afterPayload !== null && ("workspaceId" in afterPayload || "workspace" in afterPayload)
          ? ["post-refusal profile gained a workspace field"]
          : []),
      ]);
    },
  );

  // ---- D12–D17 — one joined recipient and its return surfaces ----------------
  const SHARED_NOTES = {
    simulated: JOIN_RECIPIENT_SIMULATED,
    real: OWNER_REAL,
    notCaptured: ["a harness reload or agent session (the recipient profile exists; no harness runs)"],
  };
  await runCase(
    {
      id: "D12",
      journey: "D",
      title: "joined recipient, bare `campfire` piped (remote summary with the remote next actions)",
      method: "piped",
      argvDisplay: ["campfire"],
      envCase: { stdoutIsTty: "false (piped)" },
      scenarioFactory: sharedRecipientScenario,
      ...SHARED_NOTES,
    },
    (record, s) => {
      if (!sharedRecipientJoined) {
        joinRecipient(s, "shared");
        sharedRecipientJoined = true;
      }
      const result = runPiped({ root: args.root, scenario: s, argv: [] });
      record.exitCode = result.exitCode;
      captureFile(record, "machine/D12-recipient-bare.stdout.txt", result.stdout, "piped-stdout", [
        "  the shared workspace for people and their agents\n",
        "  You        Ben\n",
        `  Workspace  ${WORKSPACE_NAME}\n`,
        "  Agents     Codex (codex)\n",
        "  campfire up     open the shared workspace journal and prepare your agents",
        "  campfire status read current authorized work",
      ], ["cft_", "cfe_", "http://127.0.0.1"]);
      captureFile(record, "machine/D12-recipient-bare.stderr.txt", result.stderr, "piped-stderr", [], ["cft_", "cfe_"]);
      run.markFailed(record, [
        ...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : []),
        ...(result.stderr.length !== 0 ? ["stderr was not empty"] : []),
      ]);
    },
  );

  await runCase(
    {
      id: "D13",
      journey: "D",
      title: "joined recipient, bare `campfire --output json` (remote summary JSON)",
      method: "piped",
      argvDisplay: ["campfire", "--output", "json"],
      envCase: { stdoutIsTty: "false (piped)" },
      scenarioFactory: sharedRecipientScenario,
      ...SHARED_NOTES,
    },
    (record, s) => {
      const result = runPiped({ root: args.root, scenario: s, argv: ["--output", "json"] });
      record.exitCode = result.exitCode;
      captureFile(record, "machine/D13-recipient-bare-json.stdout.txt", result.stdout, "piped-stdout", [
        '"mode":"remote"',
        '"human":"Ben"',
        '"humanId":"hum_[id]"',
        '"workspaceId":"ws_[id]"',
        `"workspace":"${WORKSPACE_NAME}"`,
        '"name":"Codex"',
        '"harness":"codex"',
        '"nextAction":"campfire up"',
        '"pastSessionsImported":false',
      ], ["cft_", "cfe_", "http://127.0.0.1"]);
      captureFile(record, "machine/D13-recipient-bare-json.stderr.txt", result.stderr, "piped-stderr", [], ["cft_", "cfe_"]);
      run.markFailed(record, [...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : [])]);
    },
  );

  await runCase(
    {
      id: "D14",
      journey: "D",
      title: "joined recipient, `campfire status` piped (authorized remote read JSON)",
      method: "piped",
      argvDisplay: ["campfire", "status"],
      envCase: { stdoutIsTty: "false (piped)" },
      scenarioFactory: sharedRecipientScenario,
      ...SHARED_NOTES,
    },
    (record, s) => {
      const result = runPiped({ root: args.root, scenario: s, argv: ["status"] });
      record.exitCode = result.exitCode;
      captureFile(record, "machine/D14-recipient-status-json.stdout.txt", result.stdout, "piped-stdout", [
        '"version":1,"kind":"workspace_status"',
        '"state":"ready"',
        `"workspace":{"id":"ws_[id]","name":"${WORKSPACE_NAME}","status":"active"}`,
        `"goal":{"id":"goal_[id]","title":"${GOAL}","status":"active"}`,
        // 5 humans / 5 agents: owner Ada+Codex plus one human/agent pair from
        // each successful join so far (D2, D3, D4, and the shared D12 join).
        // Joins do not dedupe by name, so "Ben"/"Codex" stand for four
        // distinct pairs. Deterministic given the fixed case order.
        '"participants":{"humans":5,"agents":5}',
        '"newestContributionId":"con_[id]"',
        '"truncated":true',
      ], ["cft_", "cfe_", "http://127.0.0.1"]);
      captureFile(record, "machine/D14-recipient-status-json.stderr.txt", result.stderr, "piped-stderr", [], ["cft_", "cfe_"]);
      run.markFailed(record, [
        ...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : []),
        ...(result.stderr.length !== 0 ? ["stderr was not empty (the remote read is authorized server-side, so no local authz line is expected)"] : []),
      ]);
    },
  );

  await runCase(
    {
      id: "D15",
      journey: "D",
      title: "joined recipient, `campfire status --output human` piped (human read view)",
      method: "piped",
      argvDisplay: ["campfire", "status", "--output", "human"],
      envCase: { stdoutIsTty: "false (piped)" },
      scenarioFactory: sharedRecipientScenario,
      ...SHARED_NOTES,
    },
    (record, s) => {
      const result = runPiped({ root: args.root, scenario: s, argv: ["status", "--output", "human"] });
      record.exitCode = result.exitCode;
      captureFile(record, "machine/D15-recipient-status-human.stdout.txt", result.stdout, "piped-stdout", [
        `Workspace  ${WORKSPACE_NAME}  [active]  ws_[id]`,
        `Goal       ${GOAL}  [active]`,
        // see D14: one human/agent pair per successful join, no name dedupe.
        "Participants  5 humans  5 agents",
        "Work       open 0  in progress 0  blocked 0",
        "Decisions  proposed 0  accepted 0",
        "Activity   ",
        " contributions  newest con_[id]  (recent window truncated)",
      ], ["cft_", "cfe_", "http://127.0.0.1"]);
      captureFile(record, "machine/D15-recipient-status-human.stderr.txt", result.stderr, "piped-stderr", [], ["cft_", "cfe_"]);
      run.markFailed(record, [...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : [])]);
    },
  );

  await runCase(
    {
      id: "D16",
      journey: "D",
      title: "joined recipient, `up --no-connect` remote (daemon JSON receipt, viewerUrl distinct from apiUrl)",
      method: "piped",
      argvDisplay: ["campfire", "up", "--no-connect", "--port", "0", "--viewer-port", "0"],
      envCase: { stdoutIsTty: "false (piped)" },
      scenarioFactory: sharedRecipientScenario,
      ...SHARED_NOTES,
      notCaptured: ["a browser launch (pip lines: non-TTY stdout does not open a browser; openedBrowser stays false)"],
    },
    async (record, s) => {
      const daemon = startDaemon({
        root: args.root,
        scenario: s,
        argv: ["up", "--no-connect", "--port", "0", "--viewer-port", "0"],
      });
      await waitFor(() => daemon.stdout().includes('"openedBrowser"'), "up JSON output");
      await daemon.waitStderr(/\[campfire\] remote workspace/);
      await sleep(300);
      const final = await daemon.sigint();
      record.exitCode = final.exitCode;
      record.timedOut = final.timedOut;
      let payload: Record<string, unknown> | null = null;
      try {
        payload = JSON.parse(final.stdout.trim()) as Record<string, unknown>;
      } catch {
        payload = null;
      }
      record.checks = {
        payloadParsed: payload !== null,
        openedBrowser: payload?.openedBrowser ?? null,
        apiUrl: payload?.apiUrl ?? null,
        viewerUrl: payload?.viewerUrl ?? null,
        viewerDistinctFromApi: payload !== null && payload.apiUrl !== payload.viewerUrl,
      };
      captureFile(record, "machine/D16-recipient-up-remote-json.stdout.txt", final.stdout, "piped-stdout", [
        '"mode":"remote"',
        '"human":"Ben"',
        '"workspaceId":"ws_[id]"',
        `"workspaces":[{"id":"ws_[id]","name":"${WORKSPACE_NAME}","goal":"${GOAL}"}]`,
        '"agents":[]',
        '"connectionPrepared":false',
        '"reloadRequired":false',
        '"sessionRegistered":false',
        '"apiUrl":"http://127.0.0.1:[port]"',
        '"viewerUrl":"http://127.0.0.1:[port]"',
        '"openedBrowser":false',
        '"pastSessionsImported":false',
      ], ["cft_", "cfe_"]);
      captureFile(record, "machine/D16-recipient-up-remote-json.stderr.txt", final.stderr, "daemon-stderr", [
        "[campfire] remote workspace  viewer http://127.0.0.1:[port]",
      ], ["cft_", "cfe_"]);
      run.markFailed(record, [
        ...(payload === null ? ["stdout did not parse as one JSON object"] : []),
        ...(payload !== null && payload.openedBrowser !== false ? ["openedBrowser was not false"] : []),
        ...(final.exitCode !== 0 ? [`exitCode ${String(final.exitCode)}`] : []),
      ]);
    },
  );

  await runCase(
    {
      id: "D17",
      journey: "D",
      title: "joined recipient, `up --no-connect --no-open` remote in a terminal (human receipt, silent shutdown)",
      method: "pty",
      argvDisplay: ["campfire", "up", "--no-connect", "--no-open", "--port", "0", "--viewer-port", "0"],
      scenarioFactory: sharedRecipientScenario,
      ...SHARED_NOTES,
      notCaptured: ["a browser launch (suppressed by --no-open)"],
    },
    (record, s) => {
      const result = runPty({
        argv: cliArgv(["up", "--no-connect", "--no-open", "--port", "0", "--viewer-port", "0"]),
        cwd: s.base,
        env: scenarioEnv(s),
        steps: [{ expect: "[campfire] remote workspace", send: "\u0003", sendDelayMs: 300 }],
        timeoutMs: 30_000,
      });
      record.exitCode = result.exitCode;
      record.timedOut = result.timedOut;
      record.checks = { stepsSent: result.stepsSent, stepsTotal: result.stepsTotal, driverError: result.driverError ?? null };
      captureFile(record, "terminal/D17-recipient-up-remote-pty.stream.txt", result.stream.toString("utf8"), "pty-stream", [
        "  campfire\n",
        "  the shared workspace for people and their agents\n",
        "  You        Ben\n",
        "  Agents     no connection prepared\n",
        `  Workspace  ${WORKSPACE_NAME}\n`,
        "  Viewer     http://127.0.0.1:[port]\n",
        "  The Viewer is read-only; an agent registers its own session before contributing.\n",
        "[campfire] remote workspace  viewer http://127.0.0.1:[port]",
      ], ["cft_", "cfe_", "[campfire] received SIGINT"]);
      run.markFailed(record, [
        ...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : []),
        ...(result.stepsSent !== result.stepsTotal ? ["pty steps never all matched"] : []),
        ...(result.driverError !== undefined ? [`pty driver error: ${result.driverError}`] : []),
      ]);
    },
  );

  // ---- D18 — join with --harness opencode ------------------------------------
  await runCase(
    {
      id: "D18",
      journey: "D",
      title: "successful join with --harness opencode (human receipt names the prepared opencode config)",
      method: "piped",
      argvDisplay: ["campfire", "join", "--invitation-file", "<private-file>", "--human-name", "Ben", "--harness", "opencode", "--allow-loopback", "--output", "human"],
      envCase: { stdoutIsTty: "false (piped)" },
      simulated: JOIN_RECIPIENT_SIMULATED,
      real: OWNER_REAL,
      notCaptured: ["a harness reload or tool approval (join writes config only; it cannot reload opencode)"],
    },
    (record, s) => {
      const invitation = issueInvitation("d18");
      const result = runPiped({ root: args.root, scenario: s, argv: joinArgv(invitation.path, ["--output", "human"], "opencode") });
      record.exitCode = result.exitCode;
      captureFile(record, "machine/D18-join-opencode-human.stdout.txt", result.stdout, "piped-stdout", [
        `Joined ${WORKSPACE_NAME} as Ben.`,
        "Completed: enrolled, credentials_saved, connection_prepared, reload_required.",
        "Connected opencode. Reload the harness and approve Campfire tools.",
        "Next: campfire up",
      ], ["cft_", "cfe_", '"kind"']);
      captureFile(record, "machine/D18-join-opencode-human.stderr.txt", result.stderr, "piped-stderr", [], ["cft_", "cfe_"]);
      run.markFailed(record, [...(result.exitCode !== 0 ? [`exitCode ${String(result.exitCode)}`] : [])]);
    },
  );

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const summary = run.summary({
    capturedOn: "2026-10-18",
    machineFacts: machineFacts(),
    methodNotes: {
      ownerListener:
        "one owner scenario runs `campfire onboard` (scripted) and then `campfire serve --port 0`; every invitation is a real single-use v1.22.0 invitation issued against that loopback listener. The listener is stopped with SIGINT before scenarios are destroyed.",
      sharedRecipient:
        "D12–D17 share one recipient scenario joined with a fresh invitation by D12; each case still asserts its own surface. All other D cases use a fresh recipient scenario.",
      pty: "python3 pty, 24x100, child session leader with controlling pty; stderr shares the terminal stream; D2 exits on its own; D17 waits for the `[campfire] remote workspace` line, then sends a real SIGINT (\\u0003) after a 300 ms delay",
      piped: "spawnSync with piped stdin/stdout/stderr; no terminal anywhere",
      daemon: "detached child; SIGINT to its process group; stderr/stdout collected",
      joinOutputMode:
        "`campfire join` piped resolves to JSON unless --output human is passed; the human receipt is the same string in a terminal or with explicit --output human (src/cli/index.ts:2102)",
      participantCounts:
        "each successful join adds a new human/agent pair to the workspace and joins do not dedupe by name, so D14/D15 observe 5 humans / 5 agents = owner Ada+Codex plus the Ben+codex pairs from D2, D3, D4, and the shared D12 join. The count is deterministic for the fixed case order and is re-asserted on every run.",
      expiryCheck:
        "the expiry check is client-side before the claim (src/bootstrap/enrollment-client.ts:175), so D6 cannot consume the invitation",
      permissionMessage:
        "D10: the intended `Enrollment file must be a bounded private file` failure (src/bootstrap/enrollment-client.ts:35) throws inside the try and is re-wrapped by the catch at :38, so v1.22.0 reports the generic `Enrollment file is missing or invalid; use the original private file` for non-private modes as well",
      ownerStderr:
        "the owner listener prints its own authz lines; they are not captured as evidence. A `{\"allow\":false,...,\"method\":\"whoami\"}` line can appear on the owner listener stderr during recipient activity; it is recorded in the summary observations, not asserted.",
      ttyDetection:
        "non-TTY stdout suppresses the browser branch (`up` piped records openedBrowser:false without --no-open); D17 additionally passes --no-open so no browser can launch from a terminal",
    },
    observations: {
      ownerServeExit: ownerServeExit,
      ownerStderrHadUnauthorizedWhoami: owner !== undefined && /"allow":false/.test(owner.serve.stderr()),
    },
    maskingRules:
      "see BASELINE_PIN.md — cft-shaped credential tokens -> [redacted]; cfe-shaped invitation secrets -> [one-time-credential: redacted]; enrollment invitation ids (ein_inv_<16 hex>) -> ein_inv_[id]; absolute /Users, /private, /var/folders, /tmp paths -> [path]; loopback ports -> [port]; ISO timestamps -> [timestamp]; UUIDs -> [uuid]; object ids (<prefix>_<16 hex>) -> <prefix>_[id]",
  });
  evidence.writeSummary("summaries/join.json", summary);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${NAME}: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    const finish = async (): Promise<void> => {
      if (owner !== undefined) {
        const stopped = await owner.serve.sigint();
        ownerServeExit = stopped.exitCode;
      }
      for (const s of scenarios) destroyScenario(s);
      const failedIds = run.cases.filter((record) => record.status === "failed").map((record) => record.id);
      process.stdout.write(
        `${JSON.stringify({ tool: NAME, cases: run.cases.length, failed: failedIds, files: evidence.files().length, failedWrites: evidence.failed().length }, null, 2)}\n`,
      );
      if (process.exitCode !== 1) process.exitCode = run.exitCode();
    };
    void finish();
  });
