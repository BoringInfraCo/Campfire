/**
 * FAC-001 slice 2 P3: runDashboardSession attention read (A4.1-A4.3).
 * Drives the real session with a fake TTY (no PTY). Unit evidence over
 * hand-built AttentionResult values; not fixture, CLI/MCP or human evidence.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  AUTHORIZATION_REFUSED_LINE,
  discardForAuthorization,
  failAttentionRead,
  failContextLoad,
  isAuthorizationFailure,
  runDashboardSession,
} from "../../src/cli/dashboard.js";
import type { DashboardState } from "../../src/cli/dashboard.js";
import { ParticipantRequired, Unauthorized, ValidationError, WorkspaceNotFound } from "../../src/domain/errors.js";
import type { AttentionCue, AttentionResult } from "../../src/domain/attention.js";
import { ATTENTION_REASONS } from "../../src/domain/attention.js";
import type { ContextSlice } from "../../src/domain/context-policy.js";
import type { ActorRef } from "../../src/domain/types.js";
import type { WorkspaceContext } from "../../src/service/service.js";

type AttentionCall = { since?: string };

function actor(actorId: string): ActorRef {
  return { actorId, actorType: "human" };
}

function slice<T>(): ContextSlice<T> {
  return { items: [], total: 0, returned: 0, truncated: false };
}

function context(workspaceId: string): WorkspaceContext {
  return {
    schemaVersion: 1,
    generatedAt: "2026-10-16T00:00:00.000Z",
    orientationCursor: "cur_ctx",
    completeness: { fullHistoryIncluded: false, drillDownAvailable: true },
    slices: {
      decisions: slice(),
      findings: slice(),
      tasks: slice(),
      blockers: slice(),
      artifacts: slice(),
      recentChanges: slice(),
    },
    budget: { goals: 1, decisions: 10, findings: 10, tasks: 20, blockers: 10, artifacts: 10, recentChanges: 20 },
    workspace: {
      id: workspaceId,
      teamId: "team_x",
      name: `Name ${workspaceId}`,
      status: "active",
      createdBy: actor("hum_ana"),
      createdAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:00:00.000Z",
    },
    goal: {
      id: "goal_x",
      workspaceId,
      title: "Goal for the session test.",
      status: "active",
      createdBy: actor("hum_ana"),
      createdAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:00:00.000Z",
    },
    participants: [],
    proposedDecisions: [],
    acceptedDecisions: [],
    supersededDecisions: [],
    openTasks: [],
    findings: [],
    artifacts: [],
    provenance: [],
    provenanceTotal: 0,
    provenanceTruncated: false,
    needsYou: [],
    needsAttention: [],
    attentionCoverage: {
      tasks: { total: 0, returned: 0, truncated: false },
      decisions: { total: 0, returned: 0, truncated: false },
      completeUnderRules: true,
    },
    currentWork: { inProgressTasks: [], blockedTasks: [], acceptedDecisions: [] },
    suggestedNextAction: { kind: "none", summary: "", reason: "none", orientationHint: true },
    alignment: { status: "unspecified", proposedDecisionIds: [], acceptedDecisionIds: [], unresolvedBlockedTaskIds: [] },
    historicalCounts: { findings: 0, decisions: 0 },
    provenanceSummary: [],
  };
}

function cue(summary: string, taskId: string): AttentionCue {
  return {
    id: `fac1:cue-${taskId}`,
    identityKey: ["assigned_open_task", "task", taskId],
    audience: "you",
    reason: "assigned_open_task",
    subjectType: "task",
    subjectId: taskId,
    relatedIds: [],
    sourceUpdatedAt: "2026-10-16T00:00:00.000Z",
    summary,
  };
}

function result(
  workspaceId: string,
  orientationCursor: string,
  summary: string,
  catchUp: Partial<AttentionResult["catchUp"]> = {},
): AttentionResult {
  return {
    schemaVersion: 1,
    orderingVersion: "fac-1",
    rulesEvaluated: [...ATTENTION_REASONS],
    workspaceId,
    observedAt: "2026-10-16T00:00:00.000Z",
    contributionTip: 5,
    orientationCursor,
    coverage: {
      perSource: ATTENTION_REASONS.map((reason) => ({ reason, total: 0, scanned: 0, truncated: false })),
      completeUnderRules: true,
    },
    total: 1,
    returned: 1,
    truncated: false,
    cues: [cue(summary, `task_${summary}`)],
    catchUp: {
      status: "not_requested",
      changedCount: 0,
      examined: 0,
      affectedIds: [],
      affectedTruncated: false,
      tipAdvanced: false,
      ...catchUp,
    },
  };
}

const PICKER_OPEN = "enter switches to the selected workspace";
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

function harness() {
  const stdin = new EventEmitter() as EventEmitter & {
    isTTY: boolean;
    setRawMode: (mode: boolean) => void;
    resume: () => void;
    pause: () => void;
  };
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.resume = () => {};
  stdin.pause = () => {};
  const stdout = new EventEmitter() as EventEmitter & { columns: number; rows: number; write: (chunk: unknown) => boolean };
  stdout.columns = 120;
  stdout.rows = 40;
  const frames: string[] = [];
  stdout.write = (chunk: unknown) => {
    const text = String(chunk).replace(ANSI, "");
    if (text.split("\n").length > 10) frames.push(text);
    return true;
  };
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const press = async (key: string): Promise<void> => {
    stdin.emit("data", key);
    await settle();
  };
  return { stdin, stdout, frames, settle, press, last: () => frames.at(-1) ?? "" };
}

interface Run {
  h: ReturnType<typeof harness>;
  calls: AttentionCall[];
  loads: { count: number };
  done: Promise<void>;
}

function start(
  loadAttention: ((input: AttentionCall) => Promise<AttentionResult>) | undefined,
  extra: Partial<Parameters<typeof runDashboardSession>[0]> = {},
): Run {
  const h = harness();
  const calls: AttentionCall[] = [];
  const loads = { count: 0 };
  const base: Parameters<typeof runDashboardSession>[0] = {
    workspaceId: "ws_a",
    actorId: "hum_ana",
    actorType: "human",
    stdin: h.stdin as unknown as NodeJS.ReadStream,
    stdout: h.stdout as unknown as NodeJS.WriteStream,
    load: async () => context("ws_a"),
    ...(loadAttention === undefined
      ? {}
      : {
          loadAttention: (input: AttentionCall) => {
            calls.push(input);
            return loadAttention(input);
          },
        }),
    ...extra,
  };
  const inner = base.load;
  base.load = async () => {
    loads.count += 1;
    return inner();
  };
  const done = runDashboardSession(base);
  return { h, calls, loads, done };
}

async function quit(run: Run): Promise<void> {
  run.h.stdin.emit("data", "q");
  await run.done;
}

describe("FAC-001 dashboard session attention read", () => {
  it("sends no since on the first read, then the prior orientationCursor, never a cursor", async () => {
    const results = [result("ws_a", "cur_1", "ONE"), result("ws_a", "cur_2", "TWO")];
    const run = start(async () => results.shift()!);
    await run.h.settle();
    expect(run.calls).toHaveLength(1);
    expect(run.calls[0]).toEqual({});
    expect("since" in run.calls[0]!).toBe(false);
    expect(run.h.last()).toContain("ONE");
    await run.h.press("r");
    expect(run.calls).toHaveLength(2);
    expect(run.calls[1]).toEqual({ since: "cur_1" });
    for (const call of run.calls) expect("cursor" in call).toBe(false);
    expect(run.h.last()).toContain("TWO");
    await quit(run);
  });

  it("advances the baseline to toCursor for partial and complete catch-ups", async () => {
    const results = [
      result("ws_a", "cur_1", "ONE"),
      result("ws_a", "cur_2", "TWO", { status: "partial", toCursor: "cur_X" }),
      result("ws_a", "cur_3", "THREE", { status: "complete", toCursor: "cur_Y" }),
      result("ws_a", "cur_4", "FOUR", { status: "complete", toCursor: "cur_Z" }),
    ];
    const run = start(async () => results.shift()!);
    await run.h.settle();
    await run.h.press("r");
    await run.h.press("r");
    expect(run.calls[2]).toEqual({ since: "cur_X" });
    await run.h.press("r");
    expect(run.calls[3]).toEqual({ since: "cur_Y" });
    for (const call of run.calls) expect("cursor" in call).toBe(false);
    await quit(run);
  });

  it("shows a labelled fallback on rejection and clears the baseline", async () => {
    const script: Array<() => Promise<AttentionResult>> = [
      async () => result("ws_a", "cur_1", "ONE"),
      async () => {
        throw new Error("cursor_ahead_of_tip: since ahead of tip");
      },
      async () => result("ws_a", "cur_9", "NINE"),
      async () => result("ws_a", "cur_10", "TEN"),
    ];
    const run = start(async () => script.shift()!());
    await run.h.settle();
    await run.h.press("r");
    expect(run.calls[1]).toEqual({ since: "cur_1" });
    const frame = run.h.last();
    expect(frame).toContain("Attention read failed:");
    expect(frame).toContain("cursor_ahead_of_tip");
    expect(frame).toContain("Showing the older list.");
    expect(frame).not.toContain("ONE");
    await run.h.press("r");
    expect(run.calls[2]).toEqual({});
    expect("since" in run.calls[2]!).toBe(false);
    expect(run.h.last()).toContain("NINE");
    expect(run.h.last()).not.toContain("Attention read failed:");
    await run.h.press("r");
    expect(run.calls[3]).toEqual({ since: "cur_9" });
    await quit(run);
  });

  it("refuses a result for a different workspace", async () => {
    const run = start(async () => result("ws_other", "cur_o", "FOREIGN"));
    await run.h.settle();
    const frame = run.h.last();
    expect(frame).not.toContain("FOREIGN");
    expect(frame).toContain("Attention read failed:");
    await run.h.press("r");
    expect(run.calls[1]).toEqual({});
    expect(run.h.last()).not.toContain("FOREIGN");
    await quit(run);
  });

  it("never shows workspace A cues or fallback after switching to B, and B's first read has no since", async () => {
    let current = "ws_a";
    const bFails = { on: false };
    const run = start(
      async () => {
        if (current === "ws_a") return result("ws_a", "cur_a1", "ALPHA-CUE");
        if (bFails.on) throw new Error("beta read broke");
        return result("ws_b", "cur_b1", "BETA-CUE");
      },
      {
        load: async () => context(current),
        listWorkspaces: async () => [
          { id: "ws_a", name: "Alpha" },
          { id: "ws_b", name: "Beta" },
        ],
        adoptWorkspace: (id: string) => {
          current = id;
        },
      },
    );
    await run.h.settle();
    expect(run.h.last()).toContain("ALPHA-CUE");
    await run.h.press("r");
    expect(run.calls[1]).toEqual({ since: "cur_a1" });
    await run.h.press("w");
    await run.h.press("j");
    // The first draw after enter is the key echo, still showing the old workspace.
    const before = run.h.frames.length;
    await run.h.press("\r");
    expect(current).toBe("ws_b");
    const last = run.calls.at(-1)!;
    expect(last).toEqual({});
    expect("since" in last).toBe(false);
    const after = run.h.frames.slice(before + 1).filter((frame) => !frame.includes(PICKER_OPEN));
    expect(after.length).toBeGreaterThan(0);
    for (const frame of after) expect(frame).not.toContain("ALPHA-CUE");
    expect(run.h.last()).toContain("BETA-CUE");
    // B fails: no A cues, no B cues, labelled fallback only.
    bFails.on = true;
    await run.h.press("r");
    expect(run.calls.at(-1)).toEqual({ since: "cur_b1" });
    expect(run.h.last()).not.toContain("ALPHA-CUE");
    expect(run.h.last()).not.toContain("BETA-CUE");
    expect(run.h.last()).toContain("Attention read failed:");
    await quit(run);
  });

  it("does not leak workspace A's fallback into B's first frames", async () => {
    let current = "ws_a";
    const run = start(
      async () => {
        if (current === "ws_a") throw new Error("alpha attention broke");
        return result("ws_b", "cur_b1", "BETA-CUE");
      },
      {
        load: async () => context(current),
        listWorkspaces: async () => [
          { id: "ws_a", name: "Alpha" },
          { id: "ws_b", name: "Beta" },
        ],
        adoptWorkspace: (id: string) => {
          current = id;
        },
      },
    );
    await run.h.settle();
    expect(run.h.last()).toContain("Attention read failed:");
    await run.h.press("w");
    await run.h.press("j");
    // The first draw after enter is the key echo, still showing the old workspace.
    const before = run.h.frames.length;
    await run.h.press("\r");
    expect(current).toBe("ws_b");
    expect(run.calls.at(-1)).toEqual({});
    const after = run.h.frames.slice(before + 1).filter((frame) => !frame.includes(PICKER_OPEN));
    expect(after.length).toBeGreaterThan(0);
    for (const frame of after) expect(frame).not.toContain("alpha attention broke");
    expect(run.h.last()).toContain("BETA-CUE");
    await quit(run);
  });

  it("clears the previous result when a failed load is followed by an attention failure", async () => {
    const fail = { on: false };
    const run = start(
      async () => {
        if (fail.on) throw new Error("not authorized for attention");
        return result("ws_a", "cur_1", "STALE-CUE");
      },
      {
        load: async () => {
          if (fail.on) throw new Error("not authorized for context");
          return context("ws_a");
        },
      },
    );
    await run.h.settle();
    expect(run.h.last()).toContain("STALE-CUE");
    fail.on = true;
    await run.h.press("r");
    expect(run.calls).toHaveLength(2);
    expect(run.calls[1]).toEqual({ since: "cur_1" });
    expect(run.h.last()).not.toContain("STALE-CUE");
    expect(run.h.last()).toContain("Attention read failed:");
    fail.on = false;
    await run.h.press("r");
    expect(run.calls[2]).toEqual({});
    await quit(run);
  });

  it("keeps the legacy attention list and makes no extra calls without loadAttention", async () => {
    const run = start(undefined, {
      load: async () => ({
        ...context("ws_a"),
        needsYou: [{ kind: "task", id: "task_legacy", summary: "LEGACY-CUE", status: "open", reason: "assigned_open_task" }],
      }),
    });
    await run.h.settle();
    expect(run.calls).toHaveLength(0);
    expect(run.h.last()).toContain("LEGACY-CUE");
    expect(run.h.last()).not.toContain("Attention read failed:");
    await run.h.press("r");
    expect(run.calls).toHaveLength(0);
    expect(run.loads.count).toBe(2);
    await quit(run);
  });

  it("never calls loadAttention while awaiting a workspace", async () => {
    const run = start(async () => result("ws_a", "cur_1", "ONE"), {
      workspaceId: "",
      awaitingWorkspace: true,
      load: async () => {
        throw new Error("load must not be called");
      },
    });
    await run.h.settle();
    await run.h.press("r");
    await run.h.press("j");
    expect(run.calls).toHaveLength(0);
    expect(run.h.last()).toContain("No workspace yet");
    await quit(run);
    expect(run.calls).toHaveLength(0);
  });

  it("makes exactly one attention request per context load, including when load fails", async () => {
    const fail = { on: false };
    const run = start(async () => result("ws_a", "cur_1", "ONE"), {
      load: async () => {
        if (fail.on) throw new Error("load broke");
        return context("ws_a");
      },
    });
    await run.h.settle();
    expect(run.calls).toHaveLength(run.loads.count);
    await run.h.press("r");
    expect(run.calls).toHaveLength(2);
    fail.on = true;
    await run.h.press("r");
    expect(run.calls).toHaveLength(3);
    fail.on = false;
    await run.h.press("r");
    await run.h.press("r");
    expect(run.calls).toHaveLength(5);
    await quit(run);
  });

  describe("authorization failures (A4.1(4)/A4.3)", () => {
    const OLD_LIST = "OLD-LEGACY-LIST-ITEM";
    const populated = (id: string): WorkspaceContext => ({
      ...context(id),
      needsYou: [{ kind: "task", id: "task_old", summary: OLD_LIST, status: "open", reason: "assigned_open_task" }],
      needsAttention: [{ kind: "task", id: "task_old2", summary: "OLD-ATTN-ITEM", status: "open", reason: "assigned_open_task" }],
      attentionCoverage: {
        tasks: { total: 7, returned: 7, truncated: false },
        decisions: { total: 0, returned: 0, truncated: false },
        completeUnderRules: true,
      },
    });
    const OLD_CUE = "OLD-FAC-CUE";
    const gone = (frame: string): void => {
      expect(frame).not.toContain(OLD_CUE);
      expect(frame).not.toContain(OLD_LIST);
      expect(frame).not.toContain("OLD-ATTN-ITEM");
      expect(frame).not.toContain("Showing the older list.");
      expect(frame).not.toContain(`Name ws_a`);
      expect(frame).not.toContain("Goal for the session test.");
    };

    it("discards context, result, fallback list, counts, badge and baseline when load and attention are both refused", async () => {
      for (const make of [
        () => new Unauthorized("actor is not allowed"),
        () => new ParticipantRequired("actor is not a participant"),
      ]) {
        const fail = { on: false };
        const run = start(
          async () => {
            if (fail.on) throw make();
            return result("ws_a", "cur_1", OLD_CUE);
          },
          {
            load: async () => {
              if (fail.on) throw make();
              return populated("ws_a");
            },
          },
        );
        await run.h.settle();
        expect(run.h.last()).toContain(OLD_CUE);
        expect(run.h.last()).toContain("Name ws_a");
        fail.on = true;
        const before = run.h.frames.length;
        await run.h.press("r");
        // The refused load already discarded the baseline, so the same-pass read sends no since.
        expect(run.calls[1]).toEqual({});
        const after = run.h.frames.slice(before + 1);
        expect(after.length).toBeGreaterThan(0);
        for (const frame of after) gone(frame);
        expect(run.h.last()).toContain("STALE");
        expect(run.h.last()).toContain("Authorization refused");
        // Other sections do not resurrect the old data either.
        for (const key of ["\t", "j"]) {
          await run.h.press(key);
          gone(run.h.last());
        }
        fail.on = false;
        await run.h.press("r");
        expect(run.calls.at(-1)).toEqual({});
        expect("since" in run.calls.at(-1)!).toBe(false);
        expect(run.h.last()).toContain("Name ws_a");
        expect(run.h.last()).not.toContain("Authorization refused");
        await quit(run);
      }
    });

    it("discards when only the attention read is refused after a successful load", async () => {
      const fail = { on: false };
      const run = start(
        async () => {
          if (fail.on) throw new Unauthorized("revoked");
          return result("ws_a", "cur_1", OLD_CUE);
        },
        { load: async () => populated("ws_a") },
      );
      await run.h.settle();
      fail.on = true;
      const before = run.h.frames.length;
      await run.h.press("r");
      for (const frame of run.h.frames.slice(before + 1)) gone(frame);
      expect(run.h.last()).toContain("Authorization refused");
      fail.on = false;
      await run.h.press("r");
      expect(run.calls.at(-1)).toEqual({});
      expect(run.h.last()).toContain(OLD_CUE);
      await quit(run);
    });

    it("discards when load is refused and the attention read then succeeds", async () => {
      const fail = { on: false };
      const run = start(async () => result("ws_a", fail.on ? "cur_2" : "cur_1", fail.on ? "FRESH-CUE" : OLD_CUE), {
        load: async () => {
          if (fail.on) throw new ParticipantRequired("not a participant");
          return populated("ws_a");
        },
      });
      await run.h.settle();
      fail.on = true;
      const before = run.h.frames.length;
      await run.h.press("r");
      for (const frame of run.h.frames.slice(before + 1)) gone(frame);
      expect(run.h.last()).toContain("Authorization refused");
      fail.on = false;
      await run.h.press("r");
      expect(run.h.last()).toContain("Name ws_a");
      expect(run.h.last()).not.toContain("Authorization refused");
      await quit(run);
    });

    it("never swallows an authorization refusal behind a generation bump while the load is in flight", async () => {
      for (const make of [
        () => new Unauthorized("actor is not allowed"),
        () => new ParticipantRequired("actor is not a participant"),
      ]) {
        let rejectLoad: ((error: unknown) => void) | undefined;
        const gate = { on: false };
        const run = start(async () => result("ws_a", gate.on ? "cur_2" : "cur_1", gate.on ? "FRESH-CUE" : OLD_CUE), {
          load: () => {
            if (!gate.on) return Promise.resolve(populated("ws_a"));
            return new Promise<WorkspaceContext>((_resolve, reject) => {
              rejectLoad = reject;
            });
          },
        });
        await run.h.settle();
        expect(run.h.last()).toContain(OLD_CUE);
        gate.on = true;
        await run.h.press("r");
        expect(rejectLoad).toBeDefined();
        // A key while the load is in flight bumps the generation.
        await run.h.press("\t");
        const before = run.h.frames.length;
        rejectLoad!(make());
        await run.h.settle();
        const after = run.h.frames.slice(before);
        expect(after.length).toBeGreaterThan(0);
        for (const frame of after) gone(frame);
        expect(run.h.last()).toContain("Authorization refused");
        // The refused load already discarded the baseline, so the same-pass read sends no since.
        expect(run.calls.at(-1)).toEqual({});
        expect("since" in run.calls.at(-1)!).toBe(false);
        gate.on = false;
        await quit(run);
      }
    });

    it("clears notes and closes the picker on a session refusal, keeping nothing of the old workspace visible", async () => {
      let rejectLoad: ((error: unknown) => void) | undefined;
      const gate = { on: false };
      const run = start(async () => result("ws_a", "cur_1", OLD_CUE), {
        listWorkspaces: async () => [{ id: "ws_a", name: "Name ws_a" }],
        load: () => {
          if (!gate.on) return Promise.resolve(populated("ws_a"));
          return new Promise<WorkspaceContext>((_resolve, reject) => {
            rejectLoad = reject;
          });
        },
      });
      await run.h.settle();
      gate.on = true;
      await run.h.press("r");
      await run.h.press("n");
      await run.h.press("w");
      const before = run.h.frames.length;
      rejectLoad!(new Unauthorized("revoked"));
      await run.h.settle();
      const after = run.h.frames.slice(before);
      expect(after.length).toBeGreaterThan(0);
      for (const frame of after) {
        gone(frame);
        expect(frame).not.toContain(PICKER_OPEN);
        expect(frame).not.toContain("Paging is unavailable");
      }
      expect(run.h.last()).toContain("Authorization refused");
      gate.on = false;
      await quit(run);
    });

    it("keeps the labelled older list on a transient double failure", async () => {
      const fail = { on: false };
      const run = start(
        async () => {
          if (fail.on) throw new Error("not authorized (prose only)");
          return result("ws_a", "cur_1", OLD_CUE);
        },
        {
          load: async () => {
            if (fail.on) throw new WorkspaceNotFound("transient store hiccup");
            return populated("ws_a");
          },
        },
      );
      await run.h.settle();
      fail.on = true;
      await run.h.press("r");
      const frame = run.h.last();
      expect(frame).toContain("STALE");
      expect(frame).toContain("Attention read failed:");
      expect(frame).toContain("Showing the older list.");
      expect(frame).toContain(OLD_LIST);
      expect(frame).not.toContain(OLD_CUE);
      expect(frame).not.toContain("Authorization refused");
      expect(run.calls[1]).toEqual({ since: "cur_1" });
      await run.h.press("r");
      expect(run.calls[2]).toEqual({});
      await quit(run);
    });
  });
});

describe("authorization failure reducers", () => {
  const base = (): DashboardState => ({
    workspaceId: "ws_a",
    actorId: "hum_ana",
    actorType: "human",
    context: context("ws_a"),
    perspective: "mine",
    section: "attention",
    row: 3,
    help: false,
    quit: false,
    refreshRequested: false,
    updateRequested: false,
    detailOpen: true,
    filter: "",
    filterMode: false,
    generation: 1,
    boundedReads: false,
    attention: { workspaceId: "ws_a", result: result("ws_a", "cur_1", "X"), baseline: "cur_1" },
    refreshedAt: "t",
    workspaceListOpen: false,
    workspaceChoices: [],
    workspaceListRow: 0,
  });

  it("isAuthorizationFailure keys on the typed code, not on message text", () => {
    expect(isAuthorizationFailure(new Unauthorized("x"))).toBe(true);
    expect(isAuthorizationFailure(new ParticipantRequired("x"))).toBe(true);
    expect(isAuthorizationFailure(Object.assign(new Error("x"), { code: "Unauthorized" }))).toBe(true);
    expect(isAuthorizationFailure(new ValidationError("unauthorized forbidden revoked"))).toBe(false);
    expect(isAuthorizationFailure(new WorkspaceNotFound("x"))).toBe(false);
    expect(isAuthorizationFailure(new Error("Unauthorized: not a participant"))).toBe(false);
    expect(isAuthorizationFailure("Unauthorized")).toBe(false);
    expect(isAuthorizationFailure(undefined)).toBe(false);
  });

  const populatedState = (): DashboardState => {
    const page = <T>(items: T[]) => ({
      items,
      total: 1,
      returned: 1,
      truncated: false,
      pageNumber: 1,
      readAt: "t",
      cursorStack: [],
      stale: false,
    });
    const pageRequest = { generation: 1, pageNumber: 1, cursorStack: [], recoverOnRejectedCursor: false };
    return {
      ...base(),
      detailOpen: true,
      taskPage: page([{ id: "task_old" }]) as unknown as DashboardState["taskPage"],
      taskPageRequest: pageRequest,
      peoplePage: page([{ id: "hum_old" }]) as unknown as DashboardState["peoplePage"],
      peoplePageRequest: pageRequest,
      history: {
        open: true,
        objectType: "task",
        objectId: "task_old",
        row: 0,
        page: page([{ id: "con_old" }]) as unknown as NonNullable<DashboardState["history"]>["page"],
      } as DashboardState["history"],
      historyRequest: pageRequest,
      inspected: { method: "get_task", sourceId: "task_old", record: { title: "OLD" } },
      inspectRequest: { kind: "task", id: "task_old" } as unknown as DashboardState["inspectRequest"],
      statusNote: "OLD-STATUS-NOTE",
      selectionNote: "OLD-SELECTION-NOTE",
      workspaceListOpen: true,
      workspaceListRequest: { generation: 1 },
      workspaceChoices: [{ id: "ws_a", name: "Name ws_a" }],
      filter: "keep-me",
    };
  };

  it("discardForAuthorization clears context, attention, pages, history, notes and the picker", () => {
    const start = populatedState();
    for (const key of [
      "context",
      "attention",
      "taskPage",
      "peoplePage",
      "history",
      "inspected",
      "statusNote",
      "selectionNote",
      "taskPageRequest",
      "peoplePageRequest",
      "historyRequest",
      "inspectRequest",
    ] as const) {
      expect(start[key], `${key} defined before`).toBeDefined();
    }
    expect(start.detailOpen).toBe(true);
    const next = discardForAuthorization(start, "denied");
    for (const key of [
      "context",
      "attention",
      "taskPage",
      "peoplePage",
      "history",
      "inspected",
      "statusNote",
      "selectionNote",
      "taskPageRequest",
      "peoplePageRequest",
      "historyRequest",
      "inspectRequest",
    ] as const) {
      expect(next[key], `${key} undefined after`).toBeUndefined();
    }
    expect(next.detailOpen).toBe(false);
    expect(next.row).toBe(0);
    expect(next.workspaceListOpen).toBe(false);
    expect(next.workspaceListRequest).toBeUndefined();
    // Policy: the actor's own workspace list and the local filter are kept.
    expect(next.workspaceChoices).toEqual(start.workspaceChoices);
    expect(next.filter).toBe("keep-me");
    expect(next.staleError).toBe(AUTHORIZATION_REFUSED_LINE);
  });

  it("failContextLoad discards an authorization refusal despite a generation mismatch, but not a transient one", () => {
    const stale = populatedState();
    const refused = failContextLoad(stale, 0, "denied", true);
    expect(refused.context).toBeUndefined();
    expect(refused.statusNote).toBeUndefined();
    expect(refused.workspaceListOpen).toBe(false);
    const transient = failContextLoad(stale, 0, "boom");
    expect(transient).toBe(stale);
  });

  it("failContextLoad and failAttentionRead only discard when told it is an authorization failure", () => {
    expect(failContextLoad(base(), 1, "boom").context).toBeDefined();
    expect(failContextLoad(base(), 1, "boom", true).context).toBeUndefined();
    const transient = failAttentionRead(base(), "ws_a", "boom");
    expect(transient.context).toBeDefined();
    expect(transient.attention?.baseline).toBeUndefined();
    expect(failAttentionRead(base(), "ws_a", "boom", true).context).toBeUndefined();
    expect(failAttentionRead(base(), "ws_other", "boom", true).context).toBeDefined();
  });
});

describe("authorization refusal never displays the server message", () => {
  const SECRET_MSG = "Actor hum_secret_actor is not a participant of workspace ws_secret_other";
  const SECRETS = ["hum_secret_actor", "ws_secret_other", SECRET_MSG];
  const FIXED = "Authorization refused; workspace data cleared.";

  it("the exported line is the fixed string", () => {
    expect(AUTHORIZATION_REFUSED_LINE).toBe(FIXED);
  });

  for (const [name, make] of [
    ["ParticipantRequired", () => new ParticipantRequired(SECRET_MSG, { workspaceId: "ws_secret_other", actorId: "hum_secret_actor" })],
    ["Unauthorized", () => new Unauthorized(SECRET_MSG)],
  ] as const) {
    it(`${name}: load and attention refusals show only the fixed line, no message or ids in any later frame`, async () => {
      const fail = { on: false };
      const run = start(
        async () => {
          if (fail.on) throw make();
          return result("ws_a", "cur_1", "OLD-CUE");
        },
        {
          load: async () => {
            if (fail.on) throw make();
            return context("ws_a");
          },
        },
      );
      await run.h.settle();
      fail.on = true;
      const before = run.h.frames.length;
      await run.h.press("r");
      const after = run.h.frames.slice(before);
      expect(after.length).toBeGreaterThan(0);
      expect(run.h.last()).toContain(FIXED);
      expect(run.h.last().split(FIXED).length - 1).toBe(1);
      for (const frame of after) {
        for (const secret of SECRETS) expect(frame).not.toContain(secret);
      }
      // later keys and a second refused read keep showing the fixed line only
      for (const key of ["\t", "j", "r"]) {
        await run.h.press(key);
        expect(run.h.last()).toContain(FIXED);
        for (const secret of SECRETS) expect(run.h.last()).not.toContain(secret);
      }
      await quit(run);
    });

    it(`${name}: attention-only refusal after a successful load shows only the fixed line`, async () => {
      const fail = { on: false };
      const run = start(
        async () => {
          if (fail.on) throw make();
          return result("ws_a", "cur_1", "OLD-CUE");
        },
        { load: async () => context("ws_a") },
      );
      await run.h.settle();
      fail.on = true;
      const before = run.h.frames.length;
      await run.h.press("r");
      expect(run.h.last()).toContain(FIXED);
      for (const frame of run.h.frames.slice(before)) {
        for (const secret of SECRETS) expect(frame).not.toContain(secret);
      }
      await quit(run);
    });
  }

  it("discardForAuthorization sets staleError to the fixed string regardless of the message", () => {
    const state: DashboardState = {
      workspaceId: "ws_a",
      actorId: "hum_ana",
      actorType: "human",
      context: context("ws_a"),
      perspective: "mine",
      section: "attention",
      row: 0,
      help: false,
      quit: false,
      refreshRequested: false,
      updateRequested: false,
      detailOpen: false,
      filter: "",
      filterMode: false,
      generation: 1,
      boundedReads: false,
      workspaceListOpen: false,
      workspaceChoices: [],
      workspaceListRow: 0,
    };
    expect(discardForAuthorization(state, "msg with ws_secret_other").staleError).toBe(FIXED);
    expect(failContextLoad(state, 1, SECRET_MSG, true).staleError).toBe(FIXED);
    expect(failAttentionRead(state, "ws_a", SECRET_MSG, true).staleError).toBe(FIXED);
  });
});
