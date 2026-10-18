/**
 * ONB-001 capture tool scaffolding.
 *
 * FIXTURE EVIDENCE TOOLING — not product code. Every capture tool shares:
 *  - `--root <worktree>` argument handling; the worktree is verified to be the
 *    clean v1.22.0 baseline before anything runs.
 *  - a per-case record shape with explicit simulated/real/not-captured labels.
 *  - an exit code that is nonzero if any capture failed, while still writing
 *    the captures that succeeded.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { safeMention, type WrittenFile } from "./capture.js";

export interface ToolArgs {
  root: string;
  out: string;
}

export function toolFail(name: string, message: string): never {
  throw new Error(`${name}: ${message}`);
}

export function parseToolArgs(argv: string[], name: string): ToolArgs {
  let root: string | undefined;
  let out: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--root" || arg === "--out") {
      if (value === undefined || value.startsWith("--")) toolFail(name, `${arg} requires a value`);
      if (arg === "--root") root = isAbsolute(value) ? value : resolve(value);
      else out = isAbsolute(value) ? value : resolve(value);
      index += 1;
      continue;
    }
    toolFail(name, `unknown argument ${arg}`);
  }
  if (root === undefined) toolFail(name, "--root <v1.22.0 worktree> is required");
  if (out === undefined) {
    out = fileURLToPath(new URL("../../../docs/evidence/onb-001/", import.meta.url));
  }
  return { root, out };
}

export interface BaselineRootFacts {
  root: string;
  describeTag: string;
  packageVersion: string;
  worktreeClean: boolean;
  trackedChanges: string[];
  diffAgainstTag: string[];
  srcMatchesTag: boolean;
  tsxPath: string | null;
  ok: boolean;
  notes: string[];
}

/** Verifies the target is the clean v1.22.0 worktree, not an edited checkout. */
export function verifyBaselineRoot(name: string, root: string): BaselineRootFacts {
  const note = (text: string): void => {
    facts.notes.push(text);
  };
  const facts: BaselineRootFacts = {
    root,
    describeTag: "",
    packageVersion: "",
    worktreeClean: false,
    trackedChanges: [],
    diffAgainstTag: [],
    srcMatchesTag: false,
    tsxPath: null,
    ok: false,
    notes: [],
  };
  const git = (args: string[]): string =>
    (spawnSync("git", ["-C", root, ...args], { encoding: "utf8" }).stdout ?? "").trim();
  facts.describeTag = git(["describe", "--tags"]);
  // Untracked files are ignored: the allowed node_modules symlink is untracked
  // because the v1.22.0 .gitignore pattern does not match a symlink.
  facts.trackedChanges = git(["status", "--porcelain", "-uno"]).split("\n").filter((line) => line.length > 0);
  facts.diffAgainstTag = git(["diff", "v1.22.0", "--stat"]).split("\n").filter((line) => line.length > 0);
  facts.srcMatchesTag = git(["diff", "v1.22.0", "--stat", "--", "src"]).length === 0;
  facts.worktreeClean = facts.trackedChanges.length === 0 && facts.diffAgainstTag.length === 0;
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string };
    facts.packageVersion = pkg.version ?? "";
  } catch {
    note("package.json unreadable");
  }
  const tsx = join(root, "node_modules/.bin/tsx");
  facts.tsxPath = existsSync(tsx) ? tsx : null;
  if (facts.describeTag !== "v1.22.0") note(`git describe returned ${JSON.stringify(facts.describeTag)}`);
  if (facts.packageVersion !== "1.22.0") note(`package.json version is ${JSON.stringify(facts.packageVersion)}`);
  if (!facts.worktreeClean) note(`tracked changes: ${facts.trackedChanges.concat(facts.diffAgainstTag).join("; ")}`);
  if (!facts.srcMatchesTag) note("src/ differs from v1.22.0");
  if (facts.tsxPath === null) note("node_modules/.bin/tsx is missing; run npm ci in the worktree");
  facts.ok =
    facts.describeTag === "v1.22.0" &&
    facts.packageVersion === "1.22.0" &&
    facts.worktreeClean &&
    facts.srcMatchesTag &&
    facts.tsxPath !== null;
  if (!facts.ok) toolFail(name, `refusing to capture: ${facts.notes.join("; ")}`);
  return facts;
}

/** Observational environment record; never used as capture input. */
export function machineFacts(): Record<string, string | null> {
  const version = (command: string, args: string[]): string | null => {
    const child = spawnSync(command, args, { encoding: "utf8", timeout: 5000 });
    if (child.error !== undefined || child.status !== 0) return null;
    return `${child.stdout ?? ""}${child.stderr ?? ""}`.trim().split("\n")[0] ?? null;
  };
  return {
    platform: process.platform,
    kernel: version("uname", ["-srm"]),
    node: process.version,
    python3: version("python3", ["--version"]),
    git: version("git", ["--version"]),
    codexCli: version("codex", ["--version"]),
    opencode: version("opencode", ["--version"]),
  };
}

export interface CaseRecord {
  id: string;
  journey: "A" | "B" | "C" | "D" | "E";
  title: string;
  method: "pty" | "piped" | "http" | "browser" | "file";
  status: "captured" | "failed";
  command: string[];
  argvDisplay: string[];
  envCase: Record<string, string>;
  simulated: string[];
  real: string[];
  notCaptured: string[];
  exitCode: number | null;
  timedOut: boolean;
  files: WrittenFile[];
  checks: Record<string, unknown>;
  failed: string[];
  notes: string[];
}

export function newCase(input: {
  id: string;
  journey: CaseRecord["journey"];
  title: string;
  method: CaseRecord["method"];
  argvDisplay: string[];
  envCase?: Record<string, string>;
  simulated?: string[];
  real?: string[];
  notCaptured?: string[];
}): CaseRecord {
  return {
    id: input.id,
    journey: input.journey,
    title: input.title,
    method: input.method,
    status: "captured",
    command: ["campfire", ...input.argvDisplay.slice(1)],
    argvDisplay: input.argvDisplay,
    envCase: input.envCase ?? {},
    simulated: input.simulated ?? [],
    real: input.real ?? [],
    notCaptured: input.notCaptured ?? [],
    exitCode: null,
    timedOut: false,
    files: [],
    checks: {},
    failed: [],
    notes: [],
  };
}

export class ToolRun {
  readonly cases: CaseRecord[] = [];

  constructor(
    readonly name: string,
    readonly baseline: BaselineRootFacts,
  ) {}

  add(record: CaseRecord): void {
    this.cases.push(record);
    const files = record.files.map((file) => file.file).join(", ");
    process.stdout.write(
      `[${record.id}] ${record.status}${record.failed.length > 0 ? ` (${record.failed.length} failed checks)` : ""} files=[${files}]\n`,
    );
  }

  markFailed(record: CaseRecord, messages: readonly string[]): void {
    if (messages.length === 0) return;
    record.status = "failed";
    record.failed.push(...messages.map((message) => safeMention(message)));
  }

  summary(extra: Record<string, unknown>): Record<string, unknown> {
    return {
      tool: this.name,
      provenance:
        "FIXTURE EVIDENCE — scripted engineering captures of the published v1.22.0 CLI and Viewer. Not human-observation evidence.",
      baseline: {
        tag: "v1.22.0",
        root: "[path]",
        describeTag: this.baseline.describeTag,
        packageVersion: this.baseline.packageVersion,
        worktreeClean: this.baseline.worktreeClean,
        srcMatchesTag: this.baseline.srcMatchesTag,
      },
      simulatedHarnessNote:
        "Harness detection in v1.22.0 is configuration-path based (src/bootstrap/connect.ts detectInstalledHarnesses). Every harness presence this run is a simulated marker directory in an isolated HOME/XDG; no real codex or opencode process was launched and no real harness config was touched.",
      assertions: {
        telemetryDisabled: "CAMPFIRE_TELEMETRY=0 in every child environment",
        ambientEndpointsRemoved: "CAMPFIRE_URL and CAMPFIRE_TOKEN removed from every child environment",
        loopbackOnly: "every listener used --port 0 / --viewer-port 0 on loopback",
        isolatedDirs: "HOME, XDG_CONFIG_HOME, CAMPFIRE_CONFIG_DIR, CAMPFIRE_DATA_DIR, TMPDIR per scenario",
        colorDisabled: "NO_COLOR=1 for deterministic bytes",
        userIdentity: "USER=LOGNAME=owner for a deterministic name-prompt default",
        noRealBrowser: "CAMPFIRE_NO_BROWSER=1, --no-open, or a PATH `open` shim that only logs the URL",
        noLastingHarness: "no harness process is started; detection is filesystem-only",
      },
      cases: this.cases,
      ...extra,
    };
  }

  exitCode(): number {
    return this.cases.some((record) => record.status === "failed") ? 1 : 0;
  }
}
