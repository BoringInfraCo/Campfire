import { describe, expect, it } from "vitest";
import { overviewSummaryRows } from "../../tui/src/overview.js";
import { initialAttention } from "../../tui/src/attention.js";

describe("OpenTUI overview summaries", () => {
  it("labels bounded counts accurately and links to sections", () => {
    const rows = overviewSummaryRows({ workspace: {id: "ws_1"}, slices: {tasks: {total: 4}, decisions: {total: 2}}, provenanceTotal: 0 }, initialAttention("ws_1"));
    expect(rows.map((row) => row.id)).toEqual(["attention", "work", "decisions", "changes"]);
    expect(rows[1]?.text).toContain("4 recorded");
    expect(rows[2]?.text).toContain("2 proposed or accepted");
    expect(rows[3]?.text).toContain("0 recorded changes");
  });

  it("does not invent counts or expose other-workspace activity", () => {
    const rows = overviewSummaryRows({ workspace: {id: "ws_1"}, provenance: [{workspaceId: "ws_2", action: "create", objectType: "secret"}] }, initialAttention("ws_1"));
    expect(rows[1]?.text).toContain("count unavailable");
    expect(rows[3]?.text).not.toContain("secret");
  });
});
