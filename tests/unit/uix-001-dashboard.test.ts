import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { CLI_COMMAND_NAMES, commandSpec, formatUsage } from "../../src/cli/catalog.js";
import { createDashboardState, reduceDashboardKey, renderDashboard } from "../../src/cli/dashboard.js";
import { runCliEntry } from "../../src/cli/index.js";
import type { ContextSlice } from "../../src/domain/context-policy.js";
import type { ActorRef, Decision, Task } from "../../src/domain/types.js";
import { viewerLabelDrift } from "../../src/presentation/work-console.js";
import type { AttentionCoverage, AttentionItem, WorkspaceContext } from "../../src/service/service.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";

const BILLING = FIXTURE.workspaces.billing;
const APP_JS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/viewer/static/app.js"),
  "utf8",
);

const ENV_KEYS = [
  "CAMPFIRE_URL",
  "CAMPFIRE_TOKEN",
  "CAMPFIRE_BRIDGE_TOKEN",
  "CAMPFIRE_OUTPUT",
  "CAMPFIRE_PLAYBOOK",
  "NO_COLOR",
  "CAMPFIRE_HARNESS",
  "CAMPFIRE_SESSION_ID",
  "CAMPFIRE_ACTOR_ID",
  "CAMPFIRE_ACTOR_TYPE",
  "CAMPFIRE_NONINTERACTIVE",
];

function slice<T>(items: T[] = []): ContextSlice<T> {
  return { items, total: items.length, returned: items.length, truncated: false };
}

function actor(actorId: string, actorType: ActorRef["actorType"] = "human"): ActorRef {
  return { actorId, actorType };
}

function task(id: string, status: Task["status"], title: string, assignee?: ActorRef): Task {
  return {
    id,
    workspaceId: "ws_dash",
    title,
    status,
    ...(assignee === undefined ? {} : { assignee }),
    createdBy: actor("hum_ana"),
    createdAt: "2026-10-16T00:00:00.000Z",
    updatedAt: "2026-10-16T00:00:00.000Z",
  };
}

function decision(
  id: string,
  status: Decision["status"],
  summary: string,
  extra?: { needsReview?: true; needsReviewFindingIds?: string[] },
): Decision {
  return {
    id,
    workspaceId: "ws_dash",
    summary,
    status,
    ...(extra?.needsReview === true ? { needsReview: true } : {}),
    ...(extra?.needsReviewFindingIds === undefined ? {} : { needsReviewFindingIds: extra.needsReviewFindingIds }),
    createdBy: actor("hum_ana"),
    createdAt: "2026-10-16T00:00:00.000Z",
    updatedAt: "2026-10-16T00:00:00.000Z",
  };
}

function cue(id: string, reason: AttentionItem["reason"], summary: string, assignee?: ActorRef): AttentionItem {
  return {
    kind: reason.includes("decision") ? "decision" : "task",
    id,
    summary,
    status: reason.includes("blocked") ? "blocked" : reason.includes("decision") ? "proposed" : "open",
    reason,
    ...(assignee === undefined ? {} : { assignee }),
  };
}

function coverage(partial?: Partial<AttentionCoverage>): AttentionCoverage {
  return {
    tasks: { total: 3, returned: 3, truncated: false },
    decisions: { total: 2, returned: 2, truncated: false },
    completeUnderRules: true,
    ...partial,
  };
}

function context(partial: Partial<WorkspaceContext> = {}): WorkspaceContext {
  const workspaceId = partial.workspace?.id ?? "ws_dash";
  return {
    schemaVersion: 1,
    generatedAt: "2026-10-16T00:00:00.000Z",
    orientationCursor: "cur_dash",
    completeness: { fullHistoryIncluded: false, drillDownAvailable: true },
    slices: {
      decisions: slice(),
      findings: slice(),
      tasks: slice(),
      blockers: slice(),
      artifacts: slice(),
      recentChanges: slice(),
    },
    budget: {
      goals: 1,
      decisions: 10,
      findings: 10,
      tasks: 20,
      blockers: 10,
      artifacts: 10,
      recentChanges: 20,
    },
    workspace: {
      id: workspaceId,
      teamId: "team_dash",
      name: "Lab",
      status: "active",
      createdBy: actor("hum_ana"),
      createdAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:00:00.000Z",
    },
    goal: {
      id: "goal_dash",
      workspaceId,
      title: "Keep the record trustworthy",
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
    attentionCoverage: coverage(),
    currentWork: { inProgressTasks: [], blockedTasks: [], acceptedDecisions: [] },
    suggestedNextAction: { kind: "none", summary: "", reason: "none", orientationHint: true },
    alignment: {
      status: "unspecified",
      proposedDecisionIds: [],
      acceptedDecisionIds: [],
      unresolvedBlockedTaskIds: [],
    },
    historicalCounts: { findings: 0, decisions: 0 },
    provenanceSummary: [],
    ...partial,
  };
}

function stateFor(value: WorkspaceContext, extra?: { staleError?: string; perspective?: "mine" | "team"; section?: "attention" | "work" | "decisions" | "references" | "changes" }) {
  return createDashboardState({
    workspaceId: value.workspace.id,
    actorId: "hum_ana",
    actorType: "human",
    context: value,
    refreshedAt: "2026-10-16T12:00:00.000Z",
    ...(extra?.staleError === undefined ? {} : { staleError: extra.staleError }),
    ...(extra?.perspective === undefined ? {} : { perspective: extra.perspective }),
    ...(extra?.section === undefined ? {} : { section: extra.section }),
  });
}

describe("UIX-001 dashboard", () => {
  it("strips CSI, OSC, and C1 out of the frame and keeps the visible id", () => {
    const poisoned = "\u001B[31m\u001B]0;title\u0007\u009B";
    const value = context({
      goal: {
        id: "goal_keep_id",
        workspaceId: "ws_dash",
        title: `Trustworthy ${poisoned} goal`,
        status: "active",
        createdBy: actor("hum_ana"),
        createdAt: "2026-10-16T00:00:00.000Z",
        updatedAt: "2026-10-16T00:00:00.000Z",
      },
      needsYou: [cue("id_keep", "assigned_open_task", `summary ${poisoned} stays`, actor(`${poisoned}hum_owner`))],
      openTasks: [task("id_keep", "open", `title ${poisoned} stays`, actor(`${poisoned}hum_owner`))],
    });
    const frame = renderDashboard(stateFor(value), 120, 40);
    expect(frame).toContain("id_keep");
    expect(frame).toContain("goal_keep_id");
    expect(frame).not.toContain("\u001B");
    expect(frame).not.toContain("\u009B");
    expect(frame).not.toContain("title\u0007");
  });

  it("renders a truncated empty Needs You list as incomplete, not finished", () => {
    const value = context({
      needsYou: [],
      attentionCoverage: coverage({
        tasks: { total: 21, returned: 20, truncated: true },
        decisions: { total: 7, returned: 7, truncated: false },
        completeUnderRules: false,
      }),
    });
    const frame = renderDashboard(stateFor(value), 120, 40);
    expect(frame).toContain("No cue found in the returned records; more matching records may exist.");
    expect(frame.includes("20/21") || frame.includes("20 of 21")).toBe(true);
    expect(frame).not.toContain("caught up");
    expect(frame.toLowerCase()).not.toContain("team is done");
  });

  it("renders a complete empty attention list without calling the work done", () => {
    const value = context({
      needsYou: [],
      attentionCoverage: coverage({ completeUnderRules: true }),
    });
    const frame = renderDashboard(stateFor(value), 120, 40);
    expect(frame).toContain("No recorded attention cues match these rules. This does not mean all work is done.");
  });

  it("keeps a needs-review accepted decision accepted and names the finding", () => {
    const value = context({
      acceptedDecisions: [
        decision("dec_att_review", "accepted", "Review the old citation", {
          needsReview: true,
          needsReviewFindingIds: ["find_att_old"],
        }),
      ],
    });
    let state = stateFor(value);
    state = reduceDashboardKey(state, "tab");
    state = reduceDashboardKey(state, "tab");
    expect(state.section).toBe("decisions");
    const frame = renderDashboard(state, 120, 40);
    expect(frame).toContain("dec_att_review");
    expect(frame).toContain("find_att_old");
    expect(frame).toContain("accepted");
    expect(frame).toContain("needs review");
    expect(frame).not.toContain("retired");
    expect(frame).not.toContain("superseded");
  });

  it("shows competing accepted decisions together without an operative choice", () => {
    const value = context({
      acceptedDecisions: [
        decision("dec_competing_a", "accepted", "Ship path A"),
        decision("dec_competing_b", "accepted", "Ship path B"),
      ],
    });
    let state = stateFor(value);
    state = reduceDashboardKey(state, "tab");
    state = reduceDashboardKey(state, "tab");
    const frame = renderDashboard(state, 120, 40);
    expect(frame).toContain("dec_competing_a");
    expect(frame).toContain("dec_competing_b");
    expect(frame).not.toContain("operative");
  });

  it("labels a proposed decision as not an instruction", () => {
    const value = context({
      proposedDecisions: [decision("dec_proposed", "proposed", "Consider the split")],
    });
    let state = stateFor(value);
    state = reduceDashboardKey(state, "tab");
    state = reduceDashboardKey(state, "tab");
    const frame = renderDashboard(state, 120, 40);
    expect(frame).toContain("dec_proposed");
    expect(frame).toContain("not an instruction");
  });

  it("does not enumerate agent rows on the default frame; registration is not presence", () => {
    const value = context({
      participants: [
        {
          actor: actor("agt_rex", "agent"),
          name: "Rex",
          role: "agent",
          harness: "codex",
          humanOwnerId: "hum_owner",
          joinedAt: "2026-10-16T00:00:00.000Z",
        },
        {
          actor: actor("hum_owner", "human"),
          name: "Owner",
          role: "owner",
          joinedAt: "2026-10-16T00:00:00.000Z",
        },
      ],
    });
    const frame = renderDashboard(stateFor(value), 120, 40);
    expect(frame).toContain("1 people · 1 registered agents");
    expect(frame).not.toContain("Rex");
    expect(frame).not.toContain("hum_owner");
    expect(frame).not.toContain("online");
    expect(frame).not.toContain("working");
  });

  it("switches the attention list with p and keeps the workspace id", () => {
    const value = context({
      needsYou: [cue("task_mine_only", "assigned_open_task", "Mine")],
      needsAttention: [cue("task_team_only", "team_open_task", "Team")],
    });
    const mine = stateFor(value);
    const team = reduceDashboardKey(mine, "p");
    expect(team.workspaceId).toBe(mine.workspaceId);
    expect(team.perspective).toBe("team");
    expect(team.context).toBe(mine.context);
    const mineFrame = renderDashboard(mine, 120, 40);
    const teamFrame = renderDashboard(team, 120, 40);
    expect(mineFrame).toContain("task_mine_only");
    expect(mineFrame).not.toContain("task_team_only");
    expect(teamFrame).toContain("task_team_only");
    expect(teamFrame).not.toContain("task_mine_only");
  });

  it("keeps the previous task id when a refresh is stale", () => {
    const value = context({
      openTasks: [task("task_prev_id", "open", "Still recorded")],
    });
    const frame = renderDashboard(
      stateFor(value, { staleError: "load failed \u001B[31mboom", section: "work" }),
      120,
      40,
    );
    expect(frame).toContain("load failed");
    expect(frame).toContain("boom");
    expect(frame).toContain("task_prev_id");
    expect(frame).not.toContain("\u001B");
  });

  it("keeps the goal id, selected source id, and coverage counts at 80x24 and 120x36", () => {
    const value = context({
      goal: {
        id: "goal_size_id",
        workspaceId: "ws_dash",
        title: "Make team attention cues trustworthy without changing recorded work",
        status: "active",
        createdBy: actor("hum_ana"),
        createdAt: "2026-10-16T00:00:00.000Z",
        updatedAt: "2026-10-16T00:00:00.000Z",
      },
      needsYou: [cue("task_size_id", "assigned_blocked_task", "Blocked for Ana", actor("hum_ana"))],
      openTasks: [task("task_size_id", "blocked", "Blocked for Ana", actor("hum_ana"))],
      attentionCoverage: coverage({
        tasks: { total: 21, returned: 20, truncated: true },
        decisions: { total: 7, returned: 7, truncated: false },
        completeUnderRules: false,
      }),
    });
    const state = stateFor(value);
    for (const [columns, rows] of [
      [80, 24],
      [120, 36],
    ] as const) {
      const frame = renderDashboard(state, columns, rows);
      expect(frame).toContain("goal_size_id");
      expect(frame).toContain("Make team attention cues trustworthy without changing recorded work");
      expect(frame).toContain("q quit");
      expect(frame).toContain("task_size_id");
      expect(frame.includes("20/21") || frame.includes("20 of 21")).toBe(true);
      expect(frame).not.toContain("\u001B");
      for (const line of frame.split("\n")) {
        expect(line.length).toBeLessThanOrEqual(columns);
      }
    }
  });

  it("keeps a later review-cue id when rank-0 lines fill 80x24", () => {
    const needsYou = Array.from({ length: 30 }, (_, index) =>
      cue(
        `dec_review_${String(index).padStart(2, "0")}`,
        "accepted_decision_needs_review",
        "Accepted decision cites non-current evidence",
      ),
    );
    let state = stateFor(context({ needsYou }));
    for (let step = 0; step < 29; step += 1) state = reduceDashboardKey(state, "j");
    const frame = renderDashboard(state, 80, 24);
    expect(frame).toContain("dec_review_29");
    expect(frame).toContain("goal_dash");
    expect(frame).toContain("ws_dash");
    expect(frame).toContain("q quit");
    expect(frame.split("\n").length).toBeLessThanOrEqual(24);
    for (const line of frame.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });

  it("matches Viewer label sentences", () => {
    expect(viewerLabelDrift(APP_JS)).toEqual([]);
  });

  it("catalogues dashboard as a read-only protocol command", () => {
    expect(CLI_COMMAND_NAMES).toContain("dashboard");
    const spec = commandSpec("dashboard");
    expect(spec.protocol).toBe(true);
    expect(spec.mutates).toBe(false);
    expect(spec.workspaceScoped).toBe(true);
    expect(formatUsage()).toContain("campfire dashboard [workspace]");
  });
});

describe("UIX-001 dashboard non-TTY", () => {
  let dir: string;
  let dbPath: string;
  let logs: string[];
  let errors: string[];
  let writes: string[];
  const previousEnv: Record<string, string | undefined> = {};
  const previousStdinTty = process.stdin.isTTY;
  const previousStdoutTty = process.stdout.isTTY;

  function setTty(stream: NodeJS.ReadStream | NodeJS.WriteStream, value: boolean | undefined): void {
    if (value === undefined) {
      delete (stream as { isTTY?: boolean }).isTTY;
      return;
    }
    Object.defineProperty(stream, "isTTY", { value, configurable: true });
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "campfire-uix-001-"));
    dbPath = join(dir, "campfire.db");
    const store = openSqliteStore(dbPath);
    let seeded = Date.parse("2026-01-01T00:00:00.000Z");
    seedFixture(store, { clock: () => new Date((seeded += 1000)).toISOString() });
    store.close();
    logs = [];
    errors = [];
    writes = [];
    for (const key of ENV_KEYS) {
      previousEnv[key] = process.env[key];
      delete process.env[key];
    }
    setTty(process.stdin, false);
    setTty(process.stdout, false);
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setTty(process.stdin, previousStdinTty);
    setTty(process.stdout, previousStdoutTty);
    rmSync(dir, { recursive: true, force: true });
    for (const key of ENV_KEYS) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("refuses a non-TTY and leaves status JSON unchanged", async () => {
    const code = await runCliEntry(["--db", dbPath, "dashboard"]);
    expect(code).not.toBe(0);
    const combined = `${logs.join("\n")}\n${errors.join("\n")}\n${writes.join("")}`;
    expect(combined).toContain("campfire status --output human");
    expect(combined).toContain("campfire status --output json");
    expect(combined).not.toContain("\u001B");

    logs = [];
    errors = [];
    writes = [];
    const status = await runCliEntry(["--db", dbPath, "status", BILLING, "--output", "json"]);
    expect(status).toBe(0);
    const parsed = JSON.parse(logs.join("\n")) as { kind: string };
    expect(parsed.kind).toBe("workspace_status");
    expect(`${logs.join("\n")}\n${errors.join("\n")}\n${writes.join("")}`).not.toContain("\u001B");
  });
});
