/**
 * Dashboard shell paint: plain overview text, rail harness alignment, and the
 * color layer over that frame.
 *
 * Pure renderer checks over a hand-built authorized context. This is unit
 * evidence for the shell, not human observation evidence.
 */
import { describe, expect, it } from "vitest";
import {
  applyWorkspaceChoices,
  createDashboardState,
  paintDashboardFrame,
  renderDashboard,
  type DashboardState,
} from "../../src/cli/dashboard.js";
import type { ContextSlice } from "../../src/domain/context-policy.js";
import type { ActorRef } from "../../src/domain/types.js";
import type { AttentionCoverage, AttentionItem, WorkspaceContext } from "../../src/service/service.js";

/** Fixed rail width when the terminal is at least 72 columns. Below that the rail is 0. */
const RAIL_AT_120 = 24;
const COLUMNS = 120;
const ROWS = 36;

const GOLD = "\u001b[38;2;230;176;110m";
const BROWN_BAR = "\u001b[48;2;48;42;30m";
const ORANGE_BADGE = "\u001b[48;2;196;122;48m";
const DIM = "\u001b[2m";
const INVERSE = "\u001b[7m";
const RESET_AFTER = /\u001b\[(?:0|39)?m/;

const SELECTED_CUE = "> blocked  Blocked for Ana";
const CUE_TITLE = "Blocked for Ana";
const STATUS_WORD = "blocked";

interface PaintStyle {
  gold: boolean;
  orange: boolean;
  inverse: boolean;
}

interface Glyph extends PaintStyle {
  char: string;
}

function slice<T>(items: T[] = [], extra?: { total?: number; returned?: number; truncated?: boolean }): ContextSlice<T> {
  return {
    items,
    total: extra?.total ?? items.length,
    returned: extra?.returned ?? items.length,
    truncated: extra?.truncated ?? false,
  };
}

function actor(actorId: string, actorType: ActorRef["actorType"] = "human"): ActorRef {
  return { actorId, actorType };
}

function cue(id: string, reason: AttentionItem["reason"], summary: string): AttentionItem {
  return {
    kind: reason.includes("decision") ? "decision" : "task",
    id,
    summary,
    status: reason.includes("blocked") ? "blocked" : reason.includes("decision") ? "proposed" : "open",
    reason,
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
  const workspaceId = partial.workspace?.id ?? "ws_nav";
  return {
    schemaVersion: 1,
    generatedAt: "2026-10-16T00:00:00.000Z",
    orientationCursor: "cur_nav",
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
      teamId: "team_nav",
      name: "Navigator lab",
      status: "active",
      createdBy: actor("hum_ana"),
      createdAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:00:00.000Z",
    },
    goal: {
      id: "goal_nav",
      workspaceId,
      title: "Give the terminal one focused screen over the recorded work.",
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

function stateFor(value: WorkspaceContext): DashboardState {
  return createDashboardState({
    workspaceId: value.workspace.id,
    actorId: "hum_ana",
    actorType: "human",
    context: value,
    refreshedAt: "2026-10-16T12:00:00.000Z",
  });
}

/** Overview: one blocked cue, Ana, and her agent Rex on the codex harness. */
function overviewContext(): WorkspaceContext {
  return context({
    workspace: {
      id: "ws_nav",
      teamId: "team_nav",
      name: "billing-migration",
      status: "active",
      createdBy: actor("hum_ana"),
      createdAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:00:00.000Z",
    },
    goal: {
      id: "goal_nav",
      workspaceId: "ws_nav",
      title: "One focused screen",
      status: "active",
      createdBy: actor("hum_ana"),
      createdAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:00:00.000Z",
    },
    needsYou: [cue("task_attention_blocked", "assigned_blocked_task", "Blocked for Ana")],
    participants: [
      {
        actor: actor("hum_ana"),
        name: "Ana",
        role: "member",
        joinedAt: "2026-10-16T00:00:00.000Z",
      },
      {
        actor: actor("agt_rex", "agent"),
        name: "Rex",
        role: "agent",
        harness: "codex",
        humanOwnerId: "hum_ana",
        joinedAt: "2026-10-16T00:00:00.000Z",
      },
    ],
  });
}

function plainOverview(): string {
  return renderDashboard(stateFor(overviewContext()), COLUMNS, ROWS);
}

function cleared(): PaintStyle {
  return { gold: false, orange: false, inverse: false };
}

function applySgr(params: string, style: PaintStyle): void {
  const parts = params.length === 0 ? ["0"] : params.split(";");
  for (let index = 0; index < parts.length; index += 1) {
    const code = parts[index] ?? "";
    if (code === "0") {
      style.gold = false;
      style.orange = false;
      style.inverse = false;
      continue;
    }
    if (code === "" || code === "2" || code === "22") continue;
    if (code === "7") {
      style.inverse = true;
      continue;
    }
    if (code === "27") {
      style.inverse = false;
      continue;
    }
    if (code === "39") {
      style.gold = false;
      continue;
    }
    if (code === "49") {
      style.orange = false;
      continue;
    }
    if ((code === "38" || code === "48") && parts[index + 1] === "2") {
      const color = `${parts[index + 2] ?? ""};${parts[index + 3] ?? ""};${parts[index + 4] ?? ""}`;
      if (code === "38") style.gold = color === "230;176;110";
      if (code === "48") style.orange = color === "196;122;48";
      index += 4;
      continue;
    }
    if (code === "38") style.gold = false;
    if (code === "48") style.orange = false;
  }
}

/** Visible cells with the SGR state that applies to each one. */
function glyphs(line: string): Glyph[] {
  const style = cleared();
  const out: Glyph[] = [];
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== "\u001b" || line[index + 1] !== "[") {
      out.push({ char: line[index] ?? "", ...style });
      continue;
    }
    let end = index + 2;
    while (end < line.length && line.charCodeAt(end) >= 0x30 && line.charCodeAt(end) <= 0x3f) end += 1;
    while (end < line.length && line.charCodeAt(end) >= 0x20 && line.charCodeAt(end) <= 0x2f) end += 1;
    const final = line[end];
    if (final === undefined) break;
    if (final === "m") applySgr(line.slice(index + 2, end), style);
    index = end;
  }
  return out;
}

function stripCsi(text: string): string {
  return text.replace(/\u001b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "");
}

function withColorEnabled<T>(run: () => T): T {
  const previous = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previous;
  }
}

function paintedOverview(): { plain: string; plainLines: string[]; painted: string; paintedLines: string[] } {
  const plain = plainOverview();
  const painted = withColorEnabled(() => paintDashboardFrame(plain, COLUMNS));
  const plainLines = plain.split("\n");
  const paintedLines = painted.split("\n");
  expect(paintedLines).toHaveLength(plainLines.length);
  return { plain, plainLines, painted, paintedLines };
}

describe("dashboard shell paint", () => {
  it("renders the overview frame without escape sequences", () => {
    const plain = plainOverview();
    expect(plain).not.toContain("\u001b");
    expect(RAIL_AT_120).toBe(24);
  });

  it("keeps the goal, blocked cue, agent, and filter box in the plain frame", () => {
    const plain = plainOverview();
    expect(plain).toContain("GOAL");
    expect(plain).toContain("NEEDS YOU");
    expect(plain).toContain(SELECTED_CUE);
    expect(plain).toContain("task_attention_blocked");
    expect(plain).toContain("Rex");
    expect(plain).toContain("codex");
    expect(plain).toContain("│ > filter shown records");
    expect(plain).toContain("> filter shown records");
    expect(plain).not.toContain("recorded, not present");
    expect(plain.indexOf("Ana")).toBeGreaterThanOrEqual(0);
    expect(plain.indexOf("Rex")).toBeGreaterThan(plain.indexOf("Ana"));
  });

  it("pads the harness name to the right edge of the rail", () => {
    const plain = plainOverview();
    const line = plain.split("\n").find((entry) => entry.includes("Rex"));
    expect(line).toBeDefined();
    if (line === undefined) return;
    const railSlice = line.slice(0, RAIL_AT_120);
    const trimmed = railSlice.trimEnd();
    expect(trimmed.endsWith("codex")).toBe(true);
    expect(railSlice.endsWith("codex")).toBe(true);
    expect(railSlice).toContain("Rex");
    expect(railSlice).not.toContain("Rex  codex");
    const rexAt = trimmed.indexOf("Rex");
    const codexAt = trimmed.lastIndexOf("codex");
    expect(rexAt).toBeGreaterThanOrEqual(0);
    expect(codexAt).toBeGreaterThan(rexAt);
    expect(trimmed.slice(rexAt + "Rex".length, codexAt)).toMatch(/^ {3,}$/);
  });

  it("paints the same list mark on every agent and keeps the harness at the rail edge", () => {
    const { paintedLines } = paintedOverview();
    const painted = paintedLines.find((entry) => stripCsi(entry).includes("Rex"));
    expect(painted).toBeDefined();
    const visible = stripCsi(painted ?? "");
    const rail = visible.slice(0, RAIL_AT_120);
    expect(rail).toContain("◦ Rex");
    expect(rail.trimEnd().endsWith("codex")).toBe(true);
    expect(rail).not.toMatch(/online|working|idle|present/);
    expect(stripCsi(painted ?? "").length).toBeLessThanOrEqual(COLUMNS);
  });

  it("paints GOAL with the gold foreground", () => {
    const { plainLines, paintedLines } = paintedOverview();
    const goalAt = plainLines.findIndex((line) => line.includes("GOAL"));
    expect(goalAt).toBeGreaterThanOrEqual(0);
    const painted = paintedLines[goalAt] ?? "";
    expect(stripCsi(painted)).toContain("GOAL");
    const wordAt = painted.indexOf("GOAL");
    expect(wordAt).toBeGreaterThan(0);
    expect(painted.slice(0, wordAt).endsWith(GOLD)).toBe(true);
    expect(painted.slice(wordAt + "GOAL".length)).toMatch(RESET_AFTER);
    const row = glyphs(painted);
    const visible = row.map((glyph) => glyph.char).join("");
    const visibleAt = visible.indexOf("GOAL");
    expect(visibleAt).toBeGreaterThanOrEqual(0);
    for (let index = visibleAt; index < visibleAt + "GOAL".length; index += 1) {
      expect(row[index]?.gold).toBe(true);
    }
  });

  it("paints the selected cue and the following id line with the brown bar", () => {
    const { plainLines, paintedLines } = paintedOverview();
    const selectedAt = plainLines.findIndex((line) => line.includes(SELECTED_CUE));
    expect(selectedAt).toBeGreaterThanOrEqual(0);
    const next = plainLines[selectedAt + 1] ?? "";
    expect(next).toContain("task_attention_blocked");
    expect(paintedLines[selectedAt]).toContain(BROWN_BAR);
    expect(paintedLines[selectedAt + 1]).toContain(BROWN_BAR);
    expect(plainLines[selectedAt]).toContain(SELECTED_CUE);
    const visibleCue = stripCsi(paintedLines[selectedAt] ?? "");
    expect(visibleCue).toContain("blocked  Blocked for Ana");
    expect(visibleCue).not.toContain("> blocked");
    expect(stripCsi(paintedLines[selectedAt + 1] ?? "")).toContain("task_attention_blocked");
  });

  it("paints the status word gold and not the cue title", () => {
    const { plainLines, paintedLines } = paintedOverview();
    const selectedAt = plainLines.findIndex((line) => line.includes(SELECTED_CUE));
    expect(selectedAt).toBeGreaterThanOrEqual(0);
    const painted = paintedLines[selectedAt] ?? "";
    const statusAt = painted.indexOf(STATUS_WORD);
    const titleAt = painted.indexOf(CUE_TITLE);
    expect(statusAt).toBeGreaterThan(0);
    expect(titleAt).toBeGreaterThan(statusAt);
    expect(painted.slice(0, statusAt).endsWith(GOLD)).toBe(true);
    expect(painted.slice(statusAt, statusAt + STATUS_WORD.length)).toBe(STATUS_WORD);
    expect(painted.slice(titleAt, titleAt + CUE_TITLE.length)).toBe(CUE_TITLE);
    const between = painted.slice(statusAt + STATUS_WORD.length, titleAt);
    expect(between).toMatch(RESET_AFTER);
    expect(between).not.toContain(GOLD);
    const row = glyphs(painted);
    const visible = row.map((glyph) => glyph.char).join("");
    const phraseAt = visible.indexOf("blocked  Blocked for Ana");
    expect(phraseAt).toBeGreaterThanOrEqual(0);
    const visibleStatus = phraseAt;
    for (let index = visibleStatus; index < visibleStatus + STATUS_WORD.length; index += 1) {
      expect(row[index]?.gold).toBe(true);
    }
    const visibleTitle = visible.indexOf(CUE_TITLE, visibleStatus);
    expect(visibleTitle).toBeGreaterThan(visibleStatus);
    for (let index = visibleTitle; index < visibleTitle + CUE_TITLE.length; index += 1) {
      expect(row[index]?.gold).toBe(false);
    }
  });

  it("dims the footer line", () => {
    const { plainLines, paintedLines } = paintedOverview();
    const footerAt = plainLines.findIndex((line) => line.includes("q quit"));
    expect(footerAt).toBeGreaterThanOrEqual(0);
    expect(paintedLines[footerAt]).toContain(DIM);
    expect(stripCsi(paintedLines[footerAt] ?? "")).toContain("q quit");
  });

  it("does not invert the painted frame", () => {
    const { painted } = paintedOverview();
    expect(painted).not.toContain(INVERSE);
  });

  it("paints the needs-you count on the selected workspace rail", () => {
    const { plainLines, paintedLines } = paintedOverview();
    const workspaceAt = plainLines.findIndex((line) => line.startsWith("> "));
    expect(workspaceAt).toBeGreaterThanOrEqual(0);
    const plainLine = plainLines[workspaceAt] ?? "";
    const paintedLine = paintedLines[workspaceAt] ?? "";
    expect(plainLine.startsWith("> billing-migration 1")).toBe(true);
    expect(plainLine.slice(0, RAIL_AT_120).trimEnd().length).toBeLessThan(RAIL_AT_120);
    expect(paintedLine).toContain(ORANGE_BADGE);
    expect(paintedLine).not.toContain(INVERSE);
    const row = glyphs(paintedLine);
    const visible = row.map((glyph) => glyph.char).join("");
    expect(visible.startsWith("● billing-migration 1")).toBe(true);
    const rail = visible.slice(0, RAIL_AT_120);
    const trimmed = rail.trimEnd();
    expect(trimmed.endsWith("1")).toBe(true);
    const digitAt = trimmed.length - 1;
    expect(row[digitAt]?.char).toBe("1");
    expect(row[digitAt]?.orange).toBe(true);
    expect(row[RAIL_AT_120 - 1]?.orange).toBe(false);
    expect(row.slice(0, RAIL_AT_120).every((glyph) => glyph.inverse === false)).toBe(true);
    const nameAt = visible.indexOf("billing-migration");
    expect(nameAt).toBeGreaterThanOrEqual(0);
    expect(nameAt).toBeLessThan(digitAt);
  });

  it("lists every workspace and the new and menu labels", () => {
    const state = applyWorkspaceChoices(stateFor(overviewContext()), [
      { id: "ws_nav", name: "billing-migration" },
      { id: "ws_docs", name: "docs" },
    ]);
    const plain = renderDashboard(state, COLUMNS, ROWS);
    const railLines = plain.split("\n").map((line) => line.slice(0, RAIL_AT_120));
    const selected = railLines.find((line) => line.startsWith("> "));
    const other = railLines.find((line) => line.trimEnd() === "  docs" || line.startsWith("  docs"));
    const actions = railLines.find((line) => line.startsWith("new"));
    expect(selected?.trimEnd()).toBe("> billing-migration 1");
    expect(other?.startsWith("  docs")).toBe(true);
    expect(actions?.trimEnd().endsWith("menu")).toBe(true);
    expect(actions?.startsWith("new")).toBe(true);
    const painted = withColorEnabled(() => paintDashboardFrame(plain, COLUMNS));
    const visible = stripCsi(painted).split("\n").map((line) => line.slice(0, RAIL_AT_120));
    expect(visible.some((line) => line.startsWith("● billing-migration"))).toBe(true);
    expect(visible.some((line) => line.startsWith("◦ docs"))).toBe(true);
    expect(plain).not.toContain("online");
    expect(plain).not.toContain("is present");
  });

  it("returns the plain frame when NO_COLOR is set", () => {
    const plain = plainOverview();
    const previous = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    try {
      expect(paintDashboardFrame(plain, COLUMNS)).toBe(plain);
    } finally {
      if (previous === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = previous;
    }
  });

  it("keeps painted lines within the column width", () => {
    const { paintedLines } = paintedOverview();
    paintedLines.forEach((line, index) => {
      expect(stripCsi(line).length, `line ${index}`).toBeLessThanOrEqual(COLUMNS);
    });
  });
});
