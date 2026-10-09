import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EvidenceDirectoryConflictError,
  reserveRunDirectory,
  resolveRunDirectory,
  writeRealEvidence,
} from "../../src/acceptance/real/evidence.js";
import type { RealAcceptanceEvidence } from "../../src/acceptance/real/types.js";

/**
 * The evidence writer gives each acceptance run its own directory so a rerun
 * can never replace an earlier run's files. These tests pin the property that
 * makes that claim true rather than advisory: the reservation is one atomic
 * syscall, and the file writes are exclusive.
 *
 * The last block is the one that matters most. The defect being guarded against
 * is a check-then-act gap, and no in-process assertion can open that gap — the
 * old code passed every sequential test here. So the reservation is also driven
 * from several child processes released by a shared barrier, which is the only
 * way to observe two writers reaching the same name at the same moment.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EVIDENCE_MODULE = fileURLToPath(new URL("../../src/acceptance/real/evidence.ts", import.meta.url));
const TSX_LOADER = join(REPO_ROOT, "node_modules", "tsx", "dist", "loader.mjs");

const DAY = "2026-09-12";

function at(time: string): string {
  return `${DAY}T${time}.000Z`;
}

function evidenceAt(startedAt: string): RealAcceptanceEvidence {
  const view = {
    workspace: {
      id: "ws_billing",
      teamId: "team_engineering",
      name: "billing-deploy-failure",
      status: "active" as const,
      createdBy: { actorId: "hum_sergio", actorType: "human" as const },
      createdAt: at("00:00:00"),
      updatedAt: at("00:30:00"),
    },
    participants: [],
    tasks: [],
    findings: [],
    decisions: [],
    artifacts: [],
    activity: [],
    provenanceSummary: ["agent: Codex (Sergio)"],
  };

  const harness = (actorId: string) => ({
    harness: "codex" as const,
    actorId,
    agentSessionId: `sess_${actorId}`,
    command: ["codex", "exec", "--json", "prompt.md"],
    cwd: "/repo",
    startedAt: at("00:00:00"),
    finishedAt: at("00:10:00"),
    exitCode: 0,
    rawStdoutPath: "",
    rawStderrPath: "",
    finalMessage: "Recorded the migration 284 lock finding.",
    events: [],
    mcpCalls: [{ rawTool: "campfire_add_finding", tool: "campfire.add_finding" }],
    nonMcpToolCalls: [],
    harnessSessionId: `thread_${actorId}`,
    usage: { totalTokens: 100 },
  });

  return {
    sprint: "002",
    scenario: "billing-deploy-failure",
    startedAt,
    finishedAt: at("01:00:00"),
    durationMs: 3_600_000,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      harnessA: {
        kind: "codex",
        version: "test",
        model: "test-model",
        actorId: "agt_codex",
        sessionId: "sess_a",
      },
      harnessB: {
        kind: "opencode",
        version: "test",
        model: "test-model",
        actorId: "agt_opencode",
        sessionId: "sess_b",
      },
    },
    prompts: { agentA: "Investigate the deploy failure.", agentB: "Continue from the workspace." },
    stateBeforeB: { workspaceId: "ws_billing", capturedAt: at("00:20:00"), view },
    stateAfterB: { workspaceId: "ws_billing", capturedAt: at("00:50:00"), view },
    harnessA: harness("agt_codex"),
    harnessB: harness("agt_opencode"),
    ergonomics: {
      firstCampfireCall: "campfire.add_finding",
      sequence: ["campfire.add_finding"],
      totalCampfireCalls: 1,
      readCalls: 0,
      writeCalls: 1,
      orientationToolCalls: 0,
      redundantReads: 0,
      redundantReadTools: [],
      missingContextSignals: [],
      contextNoiseSignals: [],
    },
    transcriptIsolation: {
      sentinel: "PRIVATE_SENTINEL",
      presentInHarnessBRetrieval: false,
      presentInCampfire: false,
      checkedSources: ["finalMessage"],
    },
    workspaceIsolation: {
      unrelatedWorkspaceId: "ws_auth",
      unrelatedSentinel: "UNRELATED_SENTINEL",
      visibleWorkspaceIds: ["ws_billing"],
      unrelatedReadDenied: true,
      unrelatedSentinelAbsent: true,
    },
    humanInterventions: [],
    checks: [{ name: "isolation.private_transcript_absent", passed: true }],
    limitations: ["Synthetic fixture; not real-world evidence."],
    recommendation: "GO",
  };
}

const EVIDENCE_FILENAMES = [
  "acceptance.json",
  "campfire-state-before-b.json",
  "campfire-state-after-b.json",
  "environment.md",
  "harness-a.md",
  "harness-b.md",
  "notes.md",
];

const originalCwd = process.cwd();
const roots: string[] = [];

function makeRoot(): string {
  // realpath: child processes report process.cwd() resolved, and macOS temp
  // directories live behind a /var → /private/var symlink.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "campfire-evidence-writer-")));
  roots.push(root);
  return root;
}

beforeEach(() => {
  process.chdir(makeRoot());
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.doUnmock("node:fs");
  vi.resetModules();
});

describe("reserveRunDirectory", () => {
  it("reserves run-<date> for a fresh run and creates the parent chain", () => {
    const dir = reserveRunDirectory(evidenceAt(at("09:15:00")));

    expect(dir).toBe(resolve(`evidence/sprint-002/run-${DAY}`));
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(join(process.cwd(), "evidence", "sprint-002"))).toBe(true);
  });

  it("escalates a second run on the same date to the stamped name", () => {
    const first = reserveRunDirectory(evidenceAt(at("09:15:00")));
    const second = reserveRunDirectory(evidenceAt(at("09:15:00")));

    expect(first).toBe(resolve(`evidence/sprint-002/run-${DAY}`));
    expect(second).toBe(resolve(`evidence/sprint-002/run-${DAY}T091500`));
    expect(second).not.toBe(first);
  });

  it("throws naming the stamped directory when both candidates are taken", () => {
    reserveRunDirectory(evidenceAt(at("09:15:00")));
    reserveRunDirectory(evidenceAt(at("09:15:00")));

    let thrown: unknown;
    try {
      reserveRunDirectory(evidenceAt(at("09:15:00")));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EvidenceDirectoryConflictError);
    expect((thrown as Error).message).toContain(`run-${DAY}T091500`);
    expect((thrown as EvidenceDirectoryConflictError).directory).toBe(
      resolve(`evidence/sprint-002/run-${DAY}T091500`),
    );
  });

  it("honours a caller-supplied directory and creates its parents", () => {
    const dir = reserveRunDirectory(evidenceAt(at("09:15:00")), "custom/nested/evidence");

    expect(dir).toBe(resolve("custom/nested/evidence"));
    expect(existsSync(dir)).toBe(true);
  });

  it("throws rather than escalating a caller-supplied directory that already exists", () => {
    mkdirSync(resolve("custom/evidence"), { recursive: true });
    writeFileSync(resolve("custom/evidence/notes.md"), "an earlier run", "utf8");

    let thrown: unknown;
    try {
      reserveRunDirectory(evidenceAt(at("09:15:00")), "custom/evidence");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EvidenceDirectoryConflictError);
    expect((thrown as Error).message).toContain(resolve("custom/evidence"));
    expect(readFileSync(resolve("custom/evidence/notes.md"), "utf8")).toBe("an earlier run");
  });

  it("keeps resolveRunDirectory working as the reserving entry point", () => {
    const dir = resolveRunDirectory(evidenceAt(at("09:15:00")));

    expect(dir).toBe(resolve(`evidence/sprint-002/run-${DAY}`));
    expect(existsSync(dir)).toBe(true);
  });
});

describe("writeRealEvidence", () => {
  it("writes all seven files with correct contents", () => {
    const result = writeRealEvidence(evidenceAt(at("09:15:00")));

    expect(result.directory).toBe(resolve(`evidence/sprint-002/run-${DAY}`));
    expect(result.files).toHaveLength(EVIDENCE_FILENAMES.length);
    expect(readdirSync(result.directory).sort()).toEqual([...EVIDENCE_FILENAMES].sort());

    const acceptance = JSON.parse(readFileSync(join(result.directory, "acceptance.json"), "utf8")) as {
      startedAt: string;
      recommendation: string;
    };
    expect(acceptance.startedAt).toBe(at("09:15:00"));
    expect(acceptance.recommendation).toBe("GO");

    const before = JSON.parse(
      readFileSync(join(result.directory, "campfire-state-before-b.json"), "utf8"),
    ) as { workspaceId: string };
    expect(before.workspaceId).toBe("ws_billing");

    expect(readFileSync(join(result.directory, "environment.md"), "utf8")).toContain("- Node: ");
    expect(readFileSync(join(result.directory, "harness-a.md"), "utf8")).toContain(
      "Recorded the migration 284 lock finding.",
    );
    expect(readFileSync(join(result.directory, "harness-b.md"), "utf8")).toContain("## Ergonomics");
    expect(readFileSync(join(result.directory, "notes.md"), "utf8")).toContain("**GO**");
  });

  it("writes acceptance.json last so an interrupted run is visibly incomplete", () => {
    const result = writeRealEvidence(evidenceAt(at("09:15:00")));

    expect(result.files.at(-1)).toBe(join(result.directory, "acceptance.json"));
  });

  it("does not overwrite an earlier run's files when it escalates", () => {
    const first = writeRealEvidence(evidenceAt(at("09:15:00")));
    const firstNotes = readFileSync(join(first.directory, "notes.md"), "utf8");
    const second = writeRealEvidence(evidenceAt(at("09:15:00")));

    expect(second.directory).toBe(resolve(`evidence/sprint-002/run-${DAY}T091500`));
    expect(readFileSync(join(first.directory, "notes.md"), "utf8")).toBe(firstNotes);
    expect(readdirSync(second.directory)).toHaveLength(EVIDENCE_FILENAMES.length);
  });

  it("refuses to overwrite a caller-supplied directory that already holds a run", () => {
    const dir = join(makeRoot(), "explicit");
    writeRealEvidence(evidenceAt(at("09:15:00")), dir);
    const before = readFileSync(join(dir, "notes.md"), "utf8");

    expect(() => writeRealEvidence(evidenceAt(at("09:15:00")), dir)).toThrow(EvidenceDirectoryConflictError);
    expect(readFileSync(join(dir, "notes.md"), "utf8")).toBe(before);
  });

  it("releases the reservation when rendering throws before any file is written", () => {
    const circular = { view: {} } as unknown as RealAcceptanceEvidence["stateAfterB"];
    circular.view.workspace = circular as never;
    const evidence = evidenceAt(at("09:15:00"));
    evidence.stateAfterB = circular;

    expect(() => writeRealEvidence(evidence)).toThrow(TypeError);
    // The reservation is gone, so the next attempt takes the same clean name
    // rather than finding a stranded directory that looks like a run.
    expect(existsSync(resolve(`evidence/sprint-002/run-${DAY}`))).toBe(false);
    expect(readdirSync(resolve("evidence/sprint-002"))).toEqual([]);
  });

  it("removes a half-written run when a file write fails partway", async () => {
    let writes = 0;
    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return {
        ...actual,
        writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
          writes += 1;
          if (writes === 3) {
            const failure = new Error("EIO: simulated write failure") as NodeJS.ErrnoException;
            failure.code = "EIO";
            throw failure;
          }
          return actual.writeFileSync(...args);
        },
      };
    });
    const writer = await import("../../src/acceptance/real/evidence.js");

    expect(() => writer.writeRealEvidence(evidenceAt(at("09:15:00")))).toThrow("simulated write failure");
    expect(writes).toBe(3);
    // Two of seven files existed a moment ago; none of them may survive, because
    // a partial directory is indistinguishable from a complete run.
    expect(existsSync(resolve(`evidence/sprint-002/run-${DAY}`))).toBe(false);
    expect(readdirSync(resolve("evidence/sprint-002"))).toEqual([]);
  });
});

interface WriteOutcome {
  ok: boolean;
  marker?: string;
  dir?: string;
  message?: string;
}

/**
 * Child process body: write one run's evidence and report the outcome as JSON.
 *
 * Each child reads its own evidence file, tags it with a marker unique to that
 * child, waits on the shared barrier, and only then writes. A marker unique per
 * writer is what makes an interleaved directory detectable afterwards: if two
 * runs shared a directory, the seven files inside it would carry two markers.
 */
const CHILD_SOURCE = `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const [modulePath, evidencePath, directory, readyDir, index, marker] = process.argv.slice(2);
const { writeRealEvidence } = await import(modulePath);
const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
evidence.prompts.agentA = marker;
evidence.prompts.agentB = marker;
writeFileSync(readyDir + "/" + index, "ready");
while (!existsSync(readyDir + "/go")) await new Promise((r) => setTimeout(r, 5));
try {
  const result = writeRealEvidence(evidence, directory === "-" ? undefined : directory);
  process.stdout.write(JSON.stringify({ ok: true, marker, dir: result.directory }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, marker, message: error.message }));
}
`;

/**
 * Run `workers` child processes that all block on one barrier file, then release
 * them together so their reservations genuinely overlap.
 */
function writeConcurrently(
  root: string,
  workers: number,
  startedAt: string,
  directory?: string,
): Promise<WriteOutcome[]> {
  const readyDir = join(root, ".ready");
  mkdirSync(readyDir, { recursive: true });
  const script = join(root, ".write-evidence.mjs");
  writeFileSync(script, CHILD_SOURCE, "utf8");

  const exited = Array.from({ length: workers }, (_, index) => {
    const marker = `writer-${index}`;
    const evidencePath = join(root, `.evidence-${index}.json`);
    writeFileSync(evidencePath, `${JSON.stringify(evidenceAt(startedAt))}\n`, "utf8");
    const child = spawn(
      process.execPath,
      [
        "--import",
        TSX_LOADER,
        script,
        EVIDENCE_MODULE,
        evidencePath,
        directory ?? "-",
        readyDir,
        String(index),
        marker,
      ],
      { cwd: root },
    );
    return new Promise<{ stdout: string; stderr: string; code: number | null }>((done) => {
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
      child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
      child.on("close", (code) => done({ stdout, stderr, code }));
    });
  });

  const release = (async () => {
    for (let waited = 0; waited < 20_000 && readdirSync(readyDir).length < workers; waited += 10) {
      await new Promise((done) => setTimeout(done, 10));
    }
    if (readdirSync(readyDir).length < workers) throw new Error("child processes did not reach the barrier");
    writeFileSync(join(readyDir, "go"), "go", "utf8");
  })();

  return Promise.all(exited).then(async (results) => {
    await release;
    return results.map((result) => {
      if (result.code !== 0) throw new Error(`child failed: ${result.stderr}`);
      return JSON.parse(result.stdout) as WriteOutcome;
    });
  });
}

/** The writers whose marker appears in a run directory's rendered files. */
function markersIn(directory: string, names: string[]): Set<string> {
  const markers = new Set<string>();
  for (const name of names) {
    for (const match of readFileSync(join(directory, name), "utf8").matchAll(/writer-\d+/g)) {
      markers.add(match[0]);
    }
  }
  return markers;
}

describe("concurrent writers", () => {
  it("gives run-<date> to exactly one process and never interleaves two runs in one directory", async () => {
    const root = makeRoot();
    const outcomes = await writeConcurrently(root, 8, at("09:15:00"));

    const winners = outcomes.filter((outcome) => outcome.ok);
    // Only two names exist for the date, so exactly two writers succeed: one on
    // run-<date>, one escalated to the stamped name. The rest throw.
    expect(winners.map((outcome) => outcome.dir).sort()).toEqual([
      join(root, "evidence", "sprint-002", `run-${DAY}`),
      join(root, "evidence", "sprint-002", `run-${DAY}T091500`),
    ]);
    expect(outcomes.filter((outcome) => !outcome.ok)).toHaveLength(6);
    for (const loser of outcomes.filter((outcome) => !outcome.ok)) {
      expect(loser.message).toContain(`run-${DAY}T091500`);
    }

    // Each directory is one complete run from one writer, which is the whole
    // point: no directory holds a mix of two runs' files.
    for (const winner of winners) {
      const dir = winner.dir as string;
      expect(readdirSync(dir).sort()).toEqual([...EVIDENCE_FILENAMES].sort());
      expect(markersIn(dir, EVIDENCE_FILENAMES)).toEqual(new Set([winner.marker]));
    }
    expect(readdirSync(join(root, "evidence", "sprint-002")).sort()).toEqual([
      `run-${DAY}`,
      `run-${DAY}T091500`,
    ]);
  });

  it("never hands one caller-supplied directory to two writers", async () => {
    const root = makeRoot();
    const shared = join(root, "shared");
    const outcomes = await writeConcurrently(root, 8, at("09:15:00"), shared);

    // The explicit path is never escalated, so exactly one writer can hold it.
    expect(outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.dir)).toEqual([shared]);
    expect(outcomes.filter((outcome) => !outcome.ok)).toHaveLength(7);
    for (const loser of outcomes.filter((outcome) => !outcome.ok)) {
      expect(loser.message).toContain(shared);
    }

    expect(readdirSync(shared).sort()).toEqual([...EVIDENCE_FILENAMES].sort());
    expect(markersIn(shared, EVIDENCE_FILENAMES)).toEqual(
      new Set([outcomes.find((outcome) => outcome.ok)?.marker]),
    );
  });
});
