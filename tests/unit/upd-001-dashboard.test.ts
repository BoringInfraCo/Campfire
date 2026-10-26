/**
 * UPD-001: exact `/update` plus Return requests an update. Every other
 * slash string remains a shown-row filter.
 *
 * Pure reducer and help-frame checks. This is not an install or a human trace.
 */
import { describe, expect, it } from "vitest";
import {
  createDashboardState,
  reduceDashboardChunk,
  reduceDashboardKey,
  renderDashboard,
  type DashboardState,
} from "../../src/cli/dashboard.js";

const PAGING_UNAVAILABLE = "Paging is unavailable here.";

function bare(): DashboardState {
  return createDashboardState({
    workspaceId: "ws_upd",
    actorId: "hum_upd",
    actorType: "human",
  });
}

describe("UPD-001 /update request", () => {
  it("starts with updateRequested false", () => {
    expect(bare().updateRequested).toBe(false);
  });

  it("requests an update from /update followed by Return and does not keep the filter", () => {
    const before = bare();
    for (const chunk of ["/update\n", "/update\r"]) {
      const next = reduceDashboardChunk(before, chunk);
      expect(next.updateRequested).toBe(true);
      expect(next.filter).toBe("");
      expect(next.filterMode).toBe(false);
      expect(next.section).toBe(before.section);
      expect(next.row).toBe(before.row);
      expect(next.generation).toBe(before.generation);
      expect(next.quit).toBe(false);
    }
  });

  it("treats every other slash string as a filter, including near-misses", () => {
    const cases: Array<{ chunk: string; filter: string }> = [
      { chunk: "/anything-else\n", filter: "anything-else" },
      { chunk: "/update-task\n", filter: "update-task" },
      { chunk: "/Update\n", filter: "Update" },
      { chunk: "/update \n", filter: "update " },
      { chunk: "/updating\n", filter: "updating" },
      { chunk: "/\n", filter: "" },
    ];
    for (const entry of cases) {
      const next = reduceDashboardChunk(bare(), entry.chunk);
      expect(next.filter).toBe(entry.filter);
      expect(next.filterMode).toBe(false);
      expect(next.updateRequested).toBe(false);
    }
  });

  it("keeps /update in filterMode until Return", () => {
    const next = reduceDashboardChunk(bare(), "/update");
    expect(next.filterMode).toBe(true);
    expect(next.filter).toBe("update");
    expect(next.updateRequested).toBe(false);

    for (const key of ["\r", "\n", "\r\n", "enter"]) {
      const requested = reduceDashboardKey(next, key);
      expect(requested.updateRequested).toBe(true);
      expect(requested.filter).toBe("");
      expect(requested.filterMode).toBe(false);
      expect(requested.row).toBe(next.row);
      expect(requested.section).toBe(next.section);
      expect(requested.generation).toBe(next.generation);
    }
  });

  it("still filters on n and still quits on Ctrl-C", () => {
    const paged = reduceDashboardKey(bare(), "n");
    expect(paged.statusNote).toBe(PAGING_UNAVAILABLE);
    expect(paged.filter).toBe("");

    const filtered = reduceDashboardChunk(bare(), "/n");
    expect(filtered.filterMode).toBe(true);
    expect(filtered.filter).toBe("n");
    expect(filtered.updateRequested).toBe(false);
    expect(filtered.statusNote).toBeUndefined();
    expect(filtered.section).toBe("attention");

    const quit = reduceDashboardKey(reduceDashboardKey(bare(), "/"), "\u0003");
    expect(quit.quit).toBe(true);
    expect(reduceDashboardChunk(reduceDashboardKey(bare(), "/"), "\u0003").quit).toBe(true);
  });

  it("does not clear updateRequested on a later key, and esc does", () => {
    let state = reduceDashboardChunk(bare(), "/update\n");
    state = reduceDashboardKey(state, "j");
    expect(state.updateRequested).toBe(true);
    state = reduceDashboardKey(state, "/");
    state = reduceDashboardKey(state, "x");
    expect(state.filter).toBe("x");
    expect(state.filterMode).toBe(true);
    expect(state.updateRequested).toBe(true);
    state = reduceDashboardKey(state, "esc");
    expect(state.updateRequested).toBe(false);
    expect(state.filter).toBe("");
    expect(state.filterMode).toBe(false);
  });

  it("does not set updateRequested when a different filter is confirmed", () => {
    const next = reduceDashboardChunk(bare(), "/beta\n");
    expect(next.filter).toBe("beta");
    expect(next.filterMode).toBe(false);
    expect(next.updateRequested).toBe(false);
  });

  it("renders help that names campfire update and keeps the existing help lines", () => {
    const state = reduceDashboardKey(bare(), "?");
    expect(state.help).toBe(true);
    const frame = renderDashboard(state, 160, 48);
    expect(frame).toContain("campfire update");
    expect(frame).toContain(
      "/update reviews a Campfire update. The canonical command is campfire update. Other / text still filters this page.",
    );
    expect(frame).toContain("? toggles this help. q quits.");
    expect(frame).toContain("/ filters the loaded page, not the workspace. enter confirms; esc clears. Letters stay text.");
  });
});
