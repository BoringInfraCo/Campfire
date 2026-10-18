/**
 * ONB-001 capture library.
 *
 * FIXTURE EVIDENCE TOOLING — not product code. Everything here exists to make
 * the v1.22.0 first-run/return/join/Viewer captures reproducible and
 * leak-proof:
 *
 *  - `createScenario` builds an isolated installation (HOME, XDG_CONFIG_HOME,
 *    CAMPFIRE_CONFIG_DIR, CAMPFIRE_DATA_DIR, TMPDIR) under the system temp
 *    directory so no capture can touch a real `~/.campfire*`, `~/.codex`,
 *    `~/.config/opencode`, `~/.opencode`, or browser.
 *  - Scenario temp roots are kept short (`cfo-XXXXXXXX`). tsx binds a unix
 *    socket at `$TMPDIR/tsx-<uid>/<pid>.pipe`, and the kernel truncates socket
 *    paths to 104 bytes (`sun_path`). With a long scenario base every tsx pipe
 *    in the scenario truncates to one address, so a command overlapping a
 *    running listener (for example `invite-teammate` against `serve`) dies with
 *    `EADDRINUSE`; `assertTsxPipeFits` now fails fast instead.
 *  - `redact` applies the recorded deterministic masking rules. Secrets are
 *    removed BEFORE a file is written; a surviving forbidden string aborts
 *    that write (nothing is written for that capture).
 *  - `Evidence` writes, verifies (read-back + leak re-scan), and hashes every
 *    file, and records per-file masking counts for the summary.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/**
 * Deterministic masking rules, in application order. Every rule is recorded in
 * the packet docs; port/timestamp/id rules normalize dynamic values, secret
 * rules remove credential material entirely.
 */
const REDACTION_RULES: ReadonlyArray<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: "bearer_token", pattern: /cft_[a-f0-9]{32}/g, replacement: "[redacted]" },
  { name: "bearer_token_shape", pattern: /cft_[A-Za-z0-9_-]+/g, replacement: "[redacted]" },
  {
    name: "invitation_secret",
    pattern: /cfe_[a-f0-9]{32}/g,
    replacement: "[one-time-credential: redacted]",
  },
  {
    name: "invitation_secret_shape",
    pattern: /cfe_[A-Za-z0-9_-]+/g,
    replacement: "[one-time-credential: redacted]",
  },
  { name: "path_users", pattern: /\/Users\/[^\s"'`)\]},;]*/g, replacement: "[path]" },
  { name: "path_private", pattern: /\/private\/[^\s"'`)\]},;]*/g, replacement: "[path]" },
  { name: "path_var_folders", pattern: /\/var\/folders\/[^\s"'`)\]},;]*/g, replacement: "[path]" },
  { name: "path_tmp", pattern: /\/tmp\/[^\s"'`)\]},;]*/g, replacement: "[path]" },
  { name: "loopback_port", pattern: /127\.0\.0\.1:\d{1,5}/g, replacement: "127.0.0.1:[port]" },
  { name: "loopback_port_localhost", pattern: /localhost:\d{1,5}/g, replacement: "localhost:[port]" },
  {
    name: "iso_timestamp",
    pattern: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})/g,
    replacement: "[timestamp]",
  },
  {
    name: "uuid",
    pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
    replacement: "[uuid]",
  },
  {
    name: "object_id",
    pattern: /\b(org|team|hum|agt|ses|ws|goal|task|find|dec|fev|cit|art|con|tok|inv|evt|dlv)_[0-9a-f]{16}\b/g,
    replacement: "$1_[id]",
  },
  {
    // Enrollment invitations carry a nested prefix (`ein_` + `inv`); the
    // generic object_id rule cannot match it because of the word boundary.
    name: "object_id_enrollment_invite",
    pattern: /\bein_inv_[0-9a-f]{16}\b/g,
    replacement: "ein_inv_[id]",
  },
];

export interface RedactionResult {
  text: string;
  rules: Record<string, number>;
}

/** Apply the recorded masking rules; counts are per rule. */
export function redact(text: string): RedactionResult {
  const rules: Record<string, number> = {};
  let out = text;
  for (const rule of REDACTION_RULES) {
    const matches = out.match(rule.pattern);
    if (matches !== null && matches.length > 0) {
      rules[rule.name] = (rules[rule.name] ?? 0) + matches.length;
      out = out.replace(rule.pattern, rule.replacement);
    }
  }
  return { text: out, rules };
}

/** Forbidden byte sequences that must never survive into evidence. */
export function leakCheck(text: string, extraNeedles: readonly string[] = []): string[] {
  const needles = ["cft_", "cfe_", "/Users/", "/private/", "/var/folders/", ...extraNeedles];
  return needles.filter((needle) => needle.length > 0 && text.includes(needle));
}

export class LeakError extends Error {
  readonly needles: string[];
  constructor(file: string, needles: string[]) {
    super(
      `refusing to write ${file}: forbidden string(s) survived redaction: ${
        needles.map((n) => JSON.stringify(safeMention(n))).join(", ")
      }`,
    );
    this.name = "LeakError";
    this.needles = needles;
  }
}

/**
 * Encodes a forbidden literal for use in human-readable MESSAGES (never in
 * captured content): `cft_` -> `cft~` etc. Keeps failure text describable
 * without embedding the forbidden sequence itself in the packet.
 */
export function safeMention(text: string): string {
  return text
    .replaceAll("cft_", "cft~")
    .replaceAll("cfe_", "cfe~")
    .replaceAll("/Users/", "/Users~")
    .replaceAll("/private/", "/private~")
    .replaceAll("/var/folders/", "/var/folders~");
}

export interface WrittenFile {
  file: string;
  kind: string;
  bytes: number;
  sha256: string;
  rules: Record<string, number>;
  verified: boolean;
}

export interface WriteOptions {
  kind: string;
  /** Strings that MUST appear after masking; failures are recorded, not fatal. */
  expectContains?: readonly string[];
  /** Strings that must NOT appear after masking (in addition to the defaults). */
  expectAbsent?: readonly string[];
}

export class Evidence {
  private readonly records: WrittenFile[] = [];
  private readonly failures: Array<{ file: string; error: string }> = [];
  private readonly extraNeedles: string[] = [];

  constructor(
    readonly outDir: string,
    /** Dynamic secret values observed this run; used as exact leak needles. */
    extraNeedles: readonly string[] = [],
  ) {
    this.extraNeedles.push(...extraNeedles.filter((needle) => needle.length > 0));
  }

  addNeedle(needle: string | undefined): void {
    if (needle !== undefined && needle.length > 0) this.extraNeedles.push(needle);
  }

  /** Writes one evidence file. Throws LeakError (and writes nothing) on leaks. */
  write(relPath: string, raw: string | Buffer, options: WriteOptions): WrittenFile {
    const rawText = typeof raw === "string" ? raw : raw.toString("utf8");
    const { text, rules } = redact(rawText);
    const leaked = leakCheck(text, this.extraNeedles);
    if (leaked.length > 0) {
      const error = new LeakError(relPath, leaked);
      this.failures.push({ file: relPath, error: error.message });
      throw error;
    }
    const abs = join(this.outDir, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text, "utf8");
    // Verify every written file: read back and re-scan for forbidden strings.
    const back = readFileSync(abs, "utf8");
    const leakedBack = leakCheck(back, this.extraNeedles);
    if (leakedBack.length > 0) throw new LeakError(relPath, leakedBack);
    if (back !== text) throw new Error(`verification mismatch for ${relPath}`);
    const record: WrittenFile = {
      file: relPath,
      kind: options.kind,
      bytes: Buffer.byteLength(text, "utf8"),
      sha256: sha256(text),
      rules,
      verified: true,
    };
    this.records.push(record);
    return record;
  }

  /**
   * Evaluation of expectations for a capture; returns the failing list.
   *
   * PTY streams are raw terminal bytes with CRLF line endings (ONLCR), so
   * matching normalizes "\r\n" -> "\n" first. The evidence files stay raw;
   * only this comparison is normalized.
   */
  evaluate(text: string, options: WriteOptions): string[] {
    const { text: masked } = redact(text);
    const normalized = masked.replace(/\r\n/g, "\n");
    const failed: string[] = [];
    for (const want of options.expectContains ?? []) {
      if (!normalized.includes(want)) failed.push(`missing ${JSON.stringify(want)}`);
    }
    for (const absent of options.expectAbsent ?? []) {
      if (normalized.includes(absent)) failed.push(`unexpected ${JSON.stringify(absent)}`);
    }
    return failed;
  }

  recordFailure(file: string, message: string): void {
    this.failures.push({ file, error: message });
  }

  files(): readonly WrittenFile[] {
    return this.records;
  }

  failed(): readonly { file: string; error: string }[] {
    return this.failures;
  }

  writeSummary(relPath: string, summary: unknown): WrittenFile {
    const text = `${JSON.stringify(summary, null, 2)}\n`;
    return this.write(relPath, text, { kind: "summary" });
  }
}

// ---------------------------------------------------------------------------
// Isolated scenario (one simulated installation)
// ---------------------------------------------------------------------------

export interface Scenario {
  name: string;
  base: string;
  home: string;
  xdgConfig: string;
  config: string;
  data: string;
  tmp: string;
  bin: string;
}

export function createScenario(name: string): Scenario {
  // Short temp root on purpose: see the header note about tsx's IPC pipe and
  // the 104-byte unix socket path limit. The descriptive `name` survives on
  // the Scenario object for logging and summaries only.
  const base = mkdtempSync(join(tmpdir(), "cfo-"));
  const scenario: Scenario = {
    name,
    base,
    home: join(base, "home"),
    xdgConfig: join(base, "xdg-config"),
    config: join(base, "config"),
    data: join(base, "data"),
    tmp: join(base, "tmp"),
    bin: join(base, "bin"),
  };
  for (const dir of [scenario.home, scenario.xdgConfig, scenario.config, scenario.data, scenario.tmp, scenario.bin]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return scenario;
}

export function destroyScenario(scenario: Scenario): void {
  rmSync(scenario.base, { recursive: true, force: true });
}

/**
 * Fails fast when a `TMPDIR` is long enough that tsx's IPC pipe path
 * (`<TMPDIR>/tsx-<uid>/<pid>.pipe`) would cross the 104-byte unix socket
 * `sun_path` limit and be silently truncated by the kernel. A truncated pipe
 * path is shared by every tsx process in that temp dir, which turns an
 * overlapping listener into `EADDRINUSE`.
 */
export function assertTsxPipeFits(tmpDir: string): void {
  const uid = typeof process.getuid === "function" ? process.getuid() : 501;
  const worstCase = join(tmpDir, `tsx-${uid}`, "99999.pipe");
  if (worstCase.length > 104) {
    throw new Error(
      `TMPDIR is too long for tsx's unix-socket IPC pipe: worst-case path is ` +
        `${worstCase.length} bytes (limit 104). Use a shorter temp root.`,
    );
  }
}

/**
 * The complete child environment. `CAMPFIRE_URL`/`CAMPFIRE_TOKEN` and other
 * ambient switches are removed; every capture starts from a known state.
 * Case-specific values are applied last.
 */
export function scenarioEnv(
  scenario: Scenario,
  extra: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  for (const key of [
    "CAMPFIRE_URL",
    "CAMPFIRE_TOKEN",
    "CAMPFIRE_OUTPUT",
    "CAMPFIRE_NONINTERACTIVE",
    "CAMPFIRE_NO_BROWSER",
    "CAMPFIRE_DB",
    "CAMPFIRE_ACTOR_TYPE",
    "CAMPFIRE_HARNESS",
    "CI",
  ]) {
    delete env[key];
  }
  env.HOME = scenario.home;
  env.XDG_CONFIG_HOME = scenario.xdgConfig;
  env.CAMPFIRE_CONFIG_DIR = scenario.config;
  env.CAMPFIRE_DATA_DIR = scenario.data;
  env.TMPDIR = scenario.tmp;
  env.USER = "owner";
  env.LOGNAME = "owner";
  env.NO_COLOR = "1";
  env.CAMPFIRE_TELEMETRY = "0";
  env.TERM = "xterm-256color";
  env.TZ = "UTC";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.PATH = `${scenario.bin}:${env.PATH ?? ""}`;
  const complete = { ...env, ...extra };
  assertTsxPipeFits(complete.TMPDIR);
  return complete;
}

export interface PipedResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export function runPiped(input: {
  root: string;
  scenario: Scenario;
  argv: string[];
  extraEnv?: Record<string, string>;
  timeoutMs?: number;
}): PipedResult {
  const child = spawnSync(
    join(input.root, "node_modules/.bin/tsx"),
    [join(input.root, "src/cli/index.ts"), ...input.argv],
    {
      cwd: input.scenario.base,
      env: scenarioEnv(input.scenario, input.extraEnv),
      encoding: "utf8",
      timeout: input.timeoutMs ?? 30_000,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const timedOut = child.error !== undefined && (child.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  return {
    stdout: child.stdout ?? "",
    stderr: child.stderr ?? "",
    exitCode: child.status,
    timedOut,
  };
}

// ---------------------------------------------------------------------------
// Long-running listener (`serve`, `view`, `up`) with a real SIGINT
// ---------------------------------------------------------------------------

export interface Daemon {
  child: ChildProcess;
  stderr(): string;
  stdout(): string;
  /** Waits until `pattern` matches the accumulated stderr (or times out). */
  waitStderr(pattern: RegExp, timeoutMs?: number): Promise<string>;
  /** Sends SIGINT to the process group and resolves with the final state. */
  sigint(timeoutMs?: number): Promise<PipedResult>;
}

export function startDaemon(input: {
  root: string;
  scenario: Scenario;
  argv: string[];
  extraEnv?: Record<string, string>;
}): Daemon {
  const child = spawn(
    join(input.root, "node_modules/.bin/tsx"),
    [join(input.root, "src/cli/index.ts"), ...input.argv],
    {
      cwd: input.scenario.base,
      env: scenarioEnv(input.scenario, input.extraEnv),
      stdio: ["ignore", "pipe", "pipe"],
      // detached so SIGINT can be delivered to the whole wrapper+node group.
      detached: true,
    },
  );
  let out = "";
  let err = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    out += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    err += chunk.toString("utf8");
  });
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolvePromise) => {
    child.once("exit", (code, signal) => resolvePromise({ code, signal }));
  });

  return {
    child,
    stderr: () => err,
    stdout: () => out,
    async waitStderr(pattern: RegExp, timeoutMs = 20_000): Promise<string> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const match = pattern.exec(err);
        if (match !== null) return match[0];
        if (child.exitCode !== null) break;
        await sleep(50);
      }
      throw new Error(
        `listener never reported ${pattern}; stderr tail: ${err.slice(-600) || "(empty)"}`,
      );
    },
    async sigint(timeoutMs = 10_000): Promise<PipedResult> {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(-child.pid!, "SIGINT");
        } catch {
          child.kill("SIGINT");
        }
      }
      const waited = await Promise.race([
        exited,
        sleep(timeoutMs).then(() => "timeout" as const),
      ]);
      if (waited === "timeout") {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          /* already gone */
        }
        await Promise.race([exited, sleep(3000)]);
        return { stdout: out, stderr: err, exitCode: null, timedOut: true };
      }
      // Give the piped streams a moment to flush after exit.
      await sleep(120);
      return { stdout: out, stderr: err, exitCode: waited.code, timedOut: false };
    },
  };
}
