/**
 * GE-17 regression tests for `scripts/gate-e/packet-evidence.ts`.
 *
 * The adversarial review in `docs/evidence/gate-e/RED-TEAM-REVIEW.md` found eight
 * defects in the Gate E packet-evidence helper and fixed them, but the probe
 * harness that verified the fixes lived outside the repository and was deleted.
 * This file is that harness. Every case below is either a reproduction from the
 * review or the review's own remedy assertion, so a future edit that reintroduces
 * GE-01, GE-03, GE-04, GE-05, or GE-06 turns this file red.
 *
 * The helper runs its CLI at module load, so it is guarded by `isMainModule()`
 * and this file imports the pure exports directly. The three cases that cannot
 * be reached from an export — the emitted-record scan in `main`, and the fact
 * that importing does not run the CLI — drive the real script through a
 * subprocess. Only CLI boundary cases use subprocesses; everything else is a
 * direct call into `buildPacketEvidence`, which is a pure function of the packet.
 *
 * Nothing here reads or writes `~/.campfire-pilot/`, opens a socket, or needs a
 * live harness. Crafted packets are built in memory; the two packets that must
 * exist on disk for a subprocess live in a per-test temp dir that is removed.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { hostname, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ValidationError } from "../../src/domain/errors.js";
import {
  DECISION_SET_LINKED_NEXT_STEP,
  RECALL_EXCERPT_MAX_BYTES,
  RECALL_GOAL_TEXT_MAX_BYTES,
  RECALL_NAME_MAX_BYTES,
  RECALL_QUERY_MAX_CHARS,
} from "../../src/domain/recall.js";
import {
  ARTIFACT_TYPES,
  DECISION_STATUSES,
  FINDING_CURRENTNESSES,
  TASK_STATUSES,
  buildPacketEvidence,
  renderHuman,
} from "../../scripts/gate-e/packet-evidence.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const helperPath = join(repoRoot, "scripts", "gate-e", "packet-evidence.ts");

/** The frozen evidence packets. Read-only, never written back. */
function frozen(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repoRoot, "docs", "evidence", "rcl-003", `packet-${name}.json`), "utf8"));
}

function packet(name: "S1" | "S2" | "S3"): Record<string, unknown> {
  return frozen(name);
}

type Json = Record<string, unknown>;
type Row = Json & { id: string };
type Packet = Json & {
  records: Row[];
  decisionSet?: Json & { members: Row[] };
  goal?: Json;
};

const tempDirs: Array<string> = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
});

/** A temp dir for this test only. Nothing outside it is ever written. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "campfire-gate-e-"));
  tempDirs.push(dir);
  return dir;
}

/** S1 as a typed shell. The RCL-003 S1 packet: three members, no transition. */
function s1(): Packet {
  return packet("S1") as Packet;
}

/**
 * S2 with the two post-RCL-003 projection defects repaired, exactly the way the
 * review's GE-01 reproduction repairs them: the superseded member goes
 * historical with no `rationale` and an `historicalExplanation`, and the set
 * carries the frozen `linkedNextStep`. What survives is the genuine transition
 * the members' own relation ids already record.
 */
function s2Projected(): Packet {
  const p = packet("S2") as Packet;
  const set = p.decisionSet as Json;
  set.linkedNextStep = DECISION_SET_LINKED_NEXT_STEP;
  for (const member of (set as { members: Row[] }).members) {
    if (member.lifecycle !== "superseded") continue;
    member.section = "historical";
    delete member.rationale;
    member.historicalExplanation = `Decision ${member.id as string} is superseded.`;
  }
  return p;
}

/** Build and return the record, asserting there were no refusals. */
function emit(parsed: unknown, packetBytes = 4096) {
  const { record, refusals } = buildPacketEvidence(parsed, packetBytes);
  expect(refusals).toEqual([]);
  expect(record).not.toBeNull();
  return record!;
}

/** Build and return the refusals, asserting the packet did not emit. */
function refuse(parsed: unknown): ReturnType<typeof buildPacketEvidence>["refusals"] {
  const { record, refusals } = buildPacketEvidence(parsed, 4096);
  expect(record).toBeNull();
  expect(refusals.length).toBeGreaterThan(0);
  return refusals;
}

/** Assert the packet is rejected as malformed, and return the offending field. */
function rejectedField(parsed: unknown): string {
  let field: unknown;
  try {
    buildPacketEvidence(parsed, 4096);
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    field = (error as ValidationError).details?.field;
  }
  expect(typeof field, "expected a ValidationError carrying a field path").toBe("string");
  return field as string;
}

/** Run the real script with the tsx loader, without tsx CLI's IPC server. */
function runHelper(args: string[], cwd = repoRoot) {
  const home = mkdtempSync(join(tmpdir(), "campfire-gate-e-home-"));
  tempDirs.push(home);
  const result = spawnSync(process.execPath, ["--import", "tsx", helperPath, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      CAMPFIRE_CONFIG_DIR: join(home, "config"),
      CAMPFIRE_DATA_DIR: join(home, "data"),
    },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe("gate E packet evidence — frozen evidence", () => {
  // GE-17 remedy: the frozen packets are the regression corpus. S2 is refused for
  // the reason the review verified — it predates the `linkedNextStep` fix — and
  // the refusal names the field, so the operator can act on it.
  it("emits S1 and S3 and refuses S2 at packet.decisionSet.linkedNextStep", () => {
    const s1Record = emit(s1(), 9591);
    expect(s1Record.packet.workspace.id).toBe("ws_rcl003_s1");
    expect(s1Record.records).toHaveLength(6);
    expect(s1Record.decisionSet?.state).toBe("unresolved-accepted-decisions");
    expect(s1Record.decisionSet?.guidance.beforeActing).toBe("unresolved");
    expect(s1Record.receipt.packetBytes).toBe(9591);

    const s3Record = emit(packet("S3"), 6827);
    expect(s3Record.decisionSet?.state).toBe("no-accepted-decision");
    expect(s3Record.decisionSet?.guidance).toEqual({ beforeActing: "absent", linkedNextStep: "absent" });

    expect(rejectedField(packet("S2"))).toBe("packet.decisionSet.linkedNextStep");
  });

  // The record is a committed evidence artefact, so the only text it copies is
  // checked here once: none of the packet's record text or rationale reaches it.
  it("carries no record text and no rationale, only their sizes", () => {
    const source = s1();
    const record = emit(source, 9591);
    const json = JSON.stringify(record);
    for (const row of source.records as Row[]) {
      expect(json).not.toContain(row.text as string);
      expect(json).not.toContain(row.rationale as string);
      expect(json).not.toContain(row.historicalExplanation as string);
    }
    const copy = record.records[0]!;
    expect(copy.text).toEqual({ bytes: 48, truncated: false });
    expect(copy.rationale).toEqual({ present: false, bytes: 0, truncated: false });
  });
});

describe("gate E packet evidence — GE-01 transition reconciliation", () => {
  // The exploit. S1 is an unresolved two-accepted-decision conflict. Declaring a
  // transition between those two members while leaving every member's own
  // predecessorId/successorId empty turns it into `linked-accepted-decisions`
  // with an operative decision — the exact RCL-003 failure class, where the
  // apparatus re-derives a safety claim from a packet-controlled input and
  // prints "re-derived and matched". Under the pre-fix code this exits 0.
  it("refuses a declared transition that no member's own relation ids record", () => {
    const p = s1();
    const set = p.decisionSet as Json;
    set.recordedTransitions = [
      { supersededDecisionId: "dec_rcl003_s1_rolling", supersedingDecisionId: "dec_rcl003_s1_fixed" },
    ];
    set.state = "linked-accepted-decisions";
    set.operativeDecisionId = "dec_rcl003_s1_fixed";
    set.linkedNextStep = DECISION_SET_LINKED_NEXT_STEP;
    delete set.beforeActing;

    // The state, operative id, and guidance the packet now claims are exactly
    // what its members derive. Only the transition list is unsupported.
    expect(rejectedField(p)).toBe("packet.decisionSet.recordedTransitions");
  });

  // The declared list is not a second, unauthenticated channel: a transition
  // whose ends are not both members of this set is refused before it is even
  // compared, whether or not it matches anything.
  it("refuses a declared transition whose two ends are not both members", () => {
    const p = s2Projected();
    (p.decisionSet as Json).recordedTransitions = [
      { supersededDecisionId: "dec_outside_this_set", supersedingDecisionId: "dec_rcl003_s2_replacement" },
    ];
    let message = "";
    try {
      buildPacketEvidence(p, 4096);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      message = (error as ValidationError).message;
    }
    expect(message).toContain("not both members");
  });

  // The other direction: the packet dropped a transition its members record.
  // Derived-from-relations is the only source, so emptying the declared list is
  // a disagreement, not a simplification.
  it("refuses an emptied declared list when the members still record the transition", () => {
    const p = s2Projected();
    const members = (p.decisionSet as { members: Row[] }).members;
    expect(members.filter((m) => m.predecessorId !== undefined || m.successorId !== undefined)).toHaveLength(2);
    (p.decisionSet as Json).recordedTransitions = [];
    expect(rejectedField(p)).toBe("packet.decisionSet.recordedTransitions");
  });

  // The guard must not cost the positive case: a set whose declared list IS the
  // one its members record still emits, and says so in the record.
  it("emits a genuine member-backed transition and reports it as reconciled", () => {
    const record = emit(s2Projected(), 9370);
    const set = record.decisionSet!;
    expect(set.state).toBe("linked-accepted-decisions");
    expect(set.operativeDecisionId).toBe("dec_rcl003_s2_replacement");
    expect(set.guidance).toEqual({ beforeActing: "absent", linkedNextStep: "linked" });
    expect(set.reconciliation).toEqual({
      transitionsFromMemberRelations: true,
      declaredTransitionCount: 1,
      derivedTransitionCount: 1,
    });
    expect(set.reDerived.derivedFrom).toBe("members-own-relation-ids");
    expect(set.recordedTransitions).toEqual([
      { supersededDecisionId: "dec_rcl003_s2_predecessor", supersedingDecisionId: "dec_rcl003_s2_replacement" },
    ]);
    expect(renderHuman(record)).toContain("transitions from the members' own relation ids: yes");
  });

  // A packet that derives a state its own members contradict stays refused. The
  // reconciliation above is what makes this reachable as a refusal rather than a
  // certified verdict.
  it("refuses a state the reconciled members do not derive", () => {
    const p = s2Projected();
    const set = p.decisionSet as Json;
    set.state = "single-accepted-decision";
    delete set.linkedNextStep;
    expect(rejectedField(p)).toBe("packet.decisionSet.state");

    const other = s2Projected();
    const otherSet = other.decisionSet as Json;
    otherSet.operativeDecisionId = "dec_rcl003_s2_proposed";
    expect(rejectedField(other)).toBe("packet.decisionSet.operativeDecisionId");
  });

  // The RCL-003 projection defect, asserted on the frozen member: a superseded
  // decision that still sits in the live section carrying its live `rationale`
  // is the shape the S2 offline recipient promoted into a condition.
  it("refuses a superseded member that keeps the live projection", () => {
    const p = s2Projected();
    const superseded = (p.decisionSet as { members: Row[] }).members.find((m) => m.lifecycle === "superseded")!;
    superseded.section = "decision-set";
    expect(rejectedField(p)).toBe("packet.decisionSet.members[1]");

    const withRationale = s2Projected();
    const target = (withRationale.decisionSet as { members: Row[] }).members.find((m) => m.lifecycle === "superseded")!;
    target.rationale = "keep the 02:00 job disabled until two clean runs have landed";
    expect(rejectedField(withRationale)).toBe("packet.decisionSet.members[1]");
  });
});

describe("gate E packet evidence — GE-03 credential shapes", () => {
  // `_` is a word character, so the pre-fix `\b` anchor missed every credential
  // that follows an id prefix — and those are exactly the fields the record
  // copies verbatim into the committed file.
  it("refuses an id-shaped credential in every field the record copies verbatim", () => {
    const cases: Array<[string, (p: Packet) => void, string]> = [
      ["agent_cft_ZZZ999", (p) => ((p.recipient as Json).actorId = "agent_cft_ZZZ999"), "packet.recipient.actorId"],
      [
        "dec_cft_ABCD1234",
        (p) => (p.records[2]!.id = "dec_cft_ABCD1234"),
        "packet.records[2].id",
      ],
      [
        "ses_cft_QQQWWW111",
        (p) => ((p.records[0]!.provenance as Json).agentSessionId = "ses_cft_QQQWWW111"),
        "packet.records[0].provenance.agentSessionId",
      ],
      ["x_cft_ABCD1234", (p) => (p.records[1]!.lifecycle = "x_cft_ABCD1234"), "packet.records[1].lifecycle"],
      ["agent_cfe_ZZZ999", (p) => ((p.issuer as Json).actorId = "agent_cfe_ZZZ999"), "packet.issuer.actorId"],
    ];
    for (const [value, plant, where] of cases) {
      const p = s1();
      plant(p);
      const refusals = refuse(p);
      expect(refusals.map((r) => r.rule), value).toEqual(["credential"]);
      expect(refusals.map((r) => r.where), value).toEqual([where]);
      // The reason never quotes the matched string.
      expect(refusals[0]!.why, value).not.toContain(value);
    }
  });

  // The placements that already worked, so the fix is not mistaken for the
  // only thing being tested: value-initial tokens in id-shaped and free-text
  // fields, and a token in a field the record drops.
  it("still refuses value-initial credentials and credentials in dropped text", () => {
    const cases: Array<[string, (p: Packet) => void]> = [
      ["cft_ABCD1234", (p) => ((p.goal as Json).title = "cft_ABCD1234")],
      ["cfe_ENROLL1234", (p) => ((p.records[1]!.provenance as Json).agentSessionId = "cfe_ENROLL1234")],
      ["a cft_ABCD1234 b", (p) => (p.omissions = ["records: a cft_ABCD1234 b not included"])],
      ["cft_ABCD1234", (p) => (p.records[0]!.text = "cft_ABCD1234 in a field the record never copies")],
    ];
    for (const [value, plant] of cases) {
      const p = s1();
      plant(p);
      expect(refuse(p).map((r) => r.rule), value).toEqual(["credential"]);
    }
  });

  // A foreign workspace id is refused on the same non-alphanumeric anchor.
  it("refuses a foreign workspace id next to a word character", () => {
    const p = s1();
    (p.records[0]!.relations as Json | undefined) ??= {};
    (p.records[0] as Json).predecessorId = "hum_other_ws_zzz";
    expect(refuse(p).map((r) => r.rule)).toEqual(["foreign-workspace-id"]);
  });
});

describe("gate E packet evidence — GE-04 URI and path shapes", () => {
  // Three separate gaps in the review, all producing exit 0 with the string in
  // the record: single-slash URIs, `~user/`, and non-ASCII path spellings.
  // `goal.title` and `query.text` are the two fields the record copies verbatim
  // and bounded, so each shape is planted in both.
  it("refuses single-slash URIs, named homes, and fullwidth path spellings", () => {
    const shapes: Array<[string, string]> = [
      ["uri-opaque-scheme", "file:/Users/sergio/.campfire"],
      ["uri-opaque-scheme", "path:/private/var/db"],
      ["uri-opaque-scheme", "sqlite:/var/lib/x.db"],
      ["uri-authority", "postgres:///db"],
      ["uri-opaque-scheme", "notes in file:/Users/sergio/x"],
      ["absolute-path", "／Users／sergio／.campfire"],
      ["home-path", "～sergio／private"],
      ["relative-segment-path", "src／file.ts"],
      ["uri-opaque-scheme", "file：／Users"],
    ];
    for (const [rule, value] of shapes) {
      for (const field of ["goal.title", "query.text"] as const) {
        const p = s1();
        if (field === "goal.title") (p.goal as Json).title = value;
        else Object.assign(p.query as Json, { text: value, normalized: value });
        const refusals = refuse(p);
        const where = field === "goal.title" ? "packet.goal.title" : "packet.query.text";
        expect(refusals.map((r) => `${r.rule}@${r.where}`), `${value} in ${field}`).toContain(`${rule}@${where}`);
        expect(refusals[0]!.why, value).not.toContain(value);
      }
    }
  });

  // The conservative bias cuts both ways: an over-eager URI rule that reads a
  // timestamp as a `scheme:` or an omission line as a path segment costs an
  // operator a run they cannot explain, which is GE-05's failure mode.
  it("does not refuse an ISO timestamp, the writer's own omission lines, or label prose", () => {
    const timestamps = ["Verified 2026-10-11T15:00:22.000Z by the operator.", "opened 2026-10-11T15:00:22Z"];
    for (const value of timestamps) {
      const p = s1();
      (p.goal as Json).title = value;
      expect(buildPacketEvidence(p, 4096).refusals, value).toEqual([]);
    }

    const omissions = s1();
    omissions.omissions = [
      "anchors.openTasks: 1 not included",
      "anchors.acceptedDecisions: 2 not included",
      "records: 1 not included",
      "decisionSet: 1 not included",
    ];
    expect(buildPacketEvidence(omissions, 4096).refusals).toEqual([]);

    const prose = s1();
    (prose.goal as Json).title = "label: prose about the month-end close";
    expect(buildPacketEvidence(prose, 4096).refusals).toEqual([]);
    const note = s1();
    (note.goal as Json).title = "note: the close runs twice daily";
    expect(buildPacketEvidence(note, 4096).refusals).toEqual([]);
  });
});

describe("gate E packet evidence — GE-05 truncation must not self-reject", () => {
  // The reachable case. `prepareRecallQuery` bounds `query.text` at
  // `RECALL_QUERY_MAX_CHARS` characters and stores it unchanged, so a 200-char
  // Japanese query is legal at the writer and the recipient sees all of it.
  // Re-bounding it in bytes would cut it at a point the recipient never saw.
  it("emits a 200-character query whole, bounded in characters rather than bytes", () => {
    expect(RECALL_QUERY_MAX_CHARS).toBe(200);
    const p = s1();
    const query = "記".repeat(RECALL_QUERY_MAX_CHARS);
    Object.assign(p.query as Json, { text: query, normalized: query });

    const record = emit(p);
    expect(record.packet.query.text).toBe(query);
    expect(record.packet.query.truncated).toBe(false);
    expect(record.packet.query.unit).toBe("characters");
    expect(record.packet.query.limit).toBe(RECALL_QUERY_MAX_CHARS);
    // 200 three-byte characters: a byte bound at the same number would have cut
    // this to 66 characters and understated what the recipient had.
    expect(record.packet.query.bytes).toBe(600);
    expect(Buffer.byteLength(record.packet.query.text, "utf8")).toBe(600);
  });

  it("truncates and marks a query past the character bound", () => {
    const p = s1();
    const query = "記".repeat(RECALL_QUERY_MAX_CHARS * 2);
    Object.assign(p.query as Json, { text: query, normalized: query });

    const record = emit(p);
    expect(record.packet.query.text).toBe("記".repeat(RECALL_QUERY_MAX_CHARS));
    expect(record.packet.query.truncated).toBe(true);
    expect(record.packet.query.unit).toBe("characters");
    const human = renderHuman(record);
    expect(human).toContain(`[truncated at ${RECALL_QUERY_MAX_CHARS} characters]`);
  });

  // The bug itself. `main` builds BOTH renderings, scans both, and refuses on
  // either regardless of `--output`. The pre-fix marker rendered a bare `N/M`
  // fraction, which the `relative-segment-path` rule matched, so a well-formed
  // packet with any truncated bounded field was refused with the tool's own
  // output named as the leaked path. This reaches the real `main`, so it runs the
  // script in a subprocess.
  it("emits a packet with truncated bounded fields in both renderings", () => {
    const dir = tempDir();
    const p = s1();
    const query = "記".repeat(RECALL_QUERY_MAX_CHARS);
    Object.assign(p.query as Json, { text: query, normalized: query });
    (p.workspace as Json).name = "W".repeat(RECALL_NAME_MAX_BYTES + 44);
    (p.goal as Json).description = "D".repeat(RECALL_GOAL_TEXT_MAX_BYTES + 76);
    p.omissions = ["O".repeat(RECALL_EXCERPT_MAX_BYTES + 60)];
    // Every one of these is a bound the domain applies, cut by a limit the
    // product's own writer also applies. None of them is a path.
    const file = join(dir, "packet.json");
    writeFileSync(file, JSON.stringify(p));

    for (const mode of ["json", "human"] as const) {
      const run = runHelper([file, "--output", mode]);
      expect(run.status, `${mode}: ${run.stderr}`).toBe(0);
      expect(run.stderr, mode).toBe("");
      expect(run.stdout.length, mode).toBeGreaterThan(0);
      // The marker names the bound and its unit; it is never a bare fraction.
      expect(run.stdout, mode).not.toMatch(/\[\s*truncated\s+\d+\/\d+/);
      expect(run.stdout, mode).not.toContain("REFUSED");
    }

    const human = runHelper([file, "--output", "human"]);
    expect(human.stdout).toContain(`[truncated at ${RECALL_EXCERPT_MAX_BYTES} bytes]`);
    expect(human.stdout).toContain(`[truncated at ${RECALL_NAME_MAX_BYTES} bytes]`);
    expect(human.stdout).toContain(`[truncated at ${RECALL_GOAL_TEXT_MAX_BYTES} bytes]`);
    // The query is at the bound, not past it, so it carries no marker at all:
    // a byte bound at the same number would have cut it and printed one.
    expect(human.stdout).toContain("記".repeat(RECALL_QUERY_MAX_CHARS));
    expect(human.stdout).not.toContain(`[truncated at ${RECALL_QUERY_MAX_CHARS} characters]`);
  });

  // The record itself carries the truncation flags, so a reviewer checking the
  // recipient's work knows the field they relied on was cut.
  it("marks each truncated bounded field in the record", () => {
    const p = s1();
    (p.workspace as Json).name = "W".repeat(RECALL_NAME_MAX_BYTES + 1);
    const record = emit(p);
    expect(record.packet.workspace.name.truncated).toBe(true);
    expect(record.packet.workspace.name.bytes).toBe(RECALL_NAME_MAX_BYTES);
    expect(record.packet.workspace.name.unit).toBe("bytes");
    expect(renderHuman(record)).toContain(`[truncated at ${RECALL_NAME_MAX_BYTES} bytes]`);

    const omission = s1();
    omission.omissions = ["O".repeat(RECALL_EXCERPT_MAX_BYTES + 1)];
    const marked = emit(omission);
    expect(marked.omissions[0]!.truncated).toBe(true);
    expect(marked.omissions[0]!.bytes).toBe(RECALL_EXCERPT_MAX_BYTES);
  });
});

describe("gate E packet evidence — GE-06 lifecycle vocabulary", () => {
  // `HandoffRecord.lifecycle` is one string column carrying four different domain
  // unions. Read as a free string, a relabelled member changes the derived
  // safety state while staying internally consistent, and the projection guard
  // keyed on the literal "superseded" never fires.
  it("refuses a decision or finding lifecycle on a task, finding, or artifact record", () => {
    const cases: Array<[number, string]> = [
      [4, "accepted"], // a task is not a decision
      [4, "superseded"],
      [0, "open"], // a finding is not a task
      [0, "accepted"],
      [1, "current"], // a decision is not a finding
      [1, "withdrawn"],
      [5, "accepted"], // a finding in the historical section
    ];
    for (const [index, lifecycle] of cases) {
      const p = s1();
      const row = p.records[index]!;
      row.lifecycle = lifecycle;
      expect(rejectedField(p), `${row.kind} -> ${lifecycle}`).toBe(`packet.records[${index}].lifecycle`);
    }
  });

  it("refuses a relabelled decision-set member and an artifact mislabelled as a decision", () => {
    const p = s1();
    (p.decisionSet as { members: Row[] }).members[0]!.lifecycle = "retired";
    expect(rejectedField(p)).toBe("packet.decisionSet.members[0].lifecycle");

    const artifact = s1();
    artifact.records.push({
      section: "artifacts",
      kind: "artifact",
      id: "art_rcl003_s1",
      lifecycle: "accepted",
      text: "a pull request that carried the rule",
      textTruncated: false,
      provenance: { createdBy: { actorId: "agt_rcl003_s1", actorType: "agent" }, createdAt: "2026-10-11T15:00:30.000Z" },
    });
    expect(rejectedField(artifact)).toBe("packet.records[6].lifecycle");
  });

  // Every value of all four unions is still legal for its own kind. A vocabulary
  // that is merely stricter than the domain would satisfy the refusals above.
  it("accepts every legal lifecycle for its own kind", () => {
    const p = s1();
    const kinds: Array<["finding" | "decision" | "task" | "artifact", readonly string[]]> = [
      ["finding", FINDING_CURRENTNESSES],
      ["decision", DECISION_STATUSES],
      ["task", TASK_STATUSES],
      ["artifact", ARTIFACT_TYPES],
    ];
    let index = p.records.length;
    for (const [kind, lifecycles] of kinds) {
      for (const lifecycle of lifecycles) {
        const row: Row = {
          section: kind === "artifact" ? "artifacts" : kind === "finding" ? "historical" : "current",
          kind,
          id: `probe_${kind}_${lifecycle}`,
          lifecycle,
          text: `a ${kind} in the ${lifecycle} state`,
          textTruncated: false,
          provenance: { createdBy: { actorId: "agt_rcl003_s1", actorType: "agent" }, createdAt: "2026-10-11T15:00:30.000Z" },
        };
        p.records.push(row);
        expect(buildPacketEvidence(p, 4096).refusals, `${kind} ${lifecycle}`).toEqual([]);
        p.records.splice(index, 1);
      }
      index = p.records.length;
    }
    // The vocabularies this file validates against are the domain's, not a
    // second list that could drift. `superseded` is a member of two unions.
    expect(new Set([...DECISION_STATUSES, ...FINDING_CURRENTNESSES, ...TASK_STATUSES, ...ARTIFACT_TYPES])).toEqual(
      new Set([
        "accepted",
        "blocked",
        "commit",
        "completed",
        "current",
        "deployment",
        "document",
        "file",
        "in_progress",
        "log",
        "open",
        "other",
        "proposed",
        "pull_request",
        "report",
        "screenshot",
        "superseded",
        "trace",
        "withdrawn",
      ]),
    );
  });
});

describe("gate E packet evidence — determinism", () => {
  it("renders the same packet twice byte-identically in both renderings", () => {
    const first = emit(s1(), 9591);
    const second = emit(s1(), 9591);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(renderHuman(second)).toBe(renderHuman(first));

    // ...and independent of the byte count the caller happens to report for the
    // same file, apart from the one receipt field that reports it.
    const other = emit(s1(), 8192);
    expect(other.receipt.packetBytes).toBe(8192);
    expect(renderHuman(other)).toBe(renderHuman(first).replace(`${first.receipt.packetBytes}`, "8192"));
  });

  // §9 keeps private packet bytes out of the repository. The record names the
  // workspace, never the file it came from, the run, or the machine.
  it("carries no input path, file name, or machine identity", () => {
    const dir = tempDir();
    const file = join(dir, "confidential-packet-S1.json");
    writeFileSync(file, JSON.stringify(s1()));
    const parsed = JSON.parse(readFileSync(file, "utf8"));

    const record = emit(parsed, 4321);
    const rendered = `${JSON.stringify(record)}\n${renderHuman(record)}`;
    for (const forbidden of [
      "confidential-packet-S1.json",
      "packet-S1.json",
      dir,
      repoRoot,
      "Campfire-Internal",
      tmpdir(),
      process.cwd(),
      hostname(),
      userInfo().username,
      String(process.pid),
    ]) {
      if (forbidden.length < 4) continue;
      expect(rendered, forbidden).not.toContain(forbidden);
    }
    expect(record.receipt).toMatchObject({
      deterministic: true,
      pathRecorded: false,
      tokenRecorded: false,
      offlineCopy: true,
      sensitiveOfflineCopy: true,
      fullHistoryIncluded: false,
    });
    expect(record.deterministic).toBe(true);
    expect(record.carriesPacketText).toBe(false);
  });
});

describe("gate E packet evidence — module load", () => {
  // The reason the exports above can be called directly at all. Without
  // `isMainModule()` this module runs its CLI at load, feeding the importing
  // process's argv to `main` and setting its exit code. A child process that
  // merely imports it must therefore print nothing, exit 0, and stay silent.
  it("does not run the CLI when it is imported rather than executed", () => {
    const dir = tempDir();
    const probe = join(dir, "import-probe.mts");
    writeFileSync(
      probe,
      'const m = await import("file://' + helperPath + '");\n' +
        'process.stdout.write(`IMPORTED ${typeof m.buildPacketEvidence} ${typeof m.renderHuman} ${m.DECISION_STATUSES.length}\\n`);\n',
    );
    const run = spawnSync(process.execPath, ["--import", "tsx", probe], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, CAMPFIRE_CONFIG_DIR: join(dir, "config"), CAMPFIRE_DATA_DIR: join(dir, "data") },
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.stdout).toBe("IMPORTED function function 3\n");
  });

  // The guard must not break the entrypoint it protects.
  it("still runs the CLI, refuses nothing, and prints usage when executed", () => {
    const s1File = join(tempDir(), "packet.json");
    writeFileSync(s1File, JSON.stringify(s1()));
    const run = runHelper([s1File, "--output", "json"]);
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout).packet.workspace.id).toBe("ws_rcl003_s1");

    const help = runHelper(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage: npx tsx scripts/gate-e/packet-evidence.ts");

    const missing = runHelper([]);
    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toContain("A packet file is required.");
  });
});
