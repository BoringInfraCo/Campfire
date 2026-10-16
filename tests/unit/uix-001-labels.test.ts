import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  attentionCoverageCounts,
  attentionCoverageText,
  attentionEmptyText,
  attentionReasonLabel,
  DASHBOARD_NON_TTY_MESSAGE,
  stripTerminalControls,
  viewerLabelDrift,
} from "../../src/presentation/work-console.js";

const STATIC = join(dirname(fileURLToPath(import.meta.url)), "../../src/viewer/static");
const APP_JS = readFileSync(join(STATIC, "app.js"), "utf8");
const INDEX_HTML = readFileSync(join(STATIC, "index.html"), "utf8");

describe("UIX-001 shared labels", () => {
  it("strips CSI, OSC, and C1 without dropping the visible id", () => {
    const poisoned = "goal\u001B[31m\u001B]0;forged\u0007\u009B2J id_keep\r\n";
    const clean = stripTerminalControls(poisoned);
    expect(clean).not.toContain("\u001B");
    expect(clean).not.toContain("\u009B");
    expect(clean).toContain("id_keep");
    expect(clean).not.toContain("\n");
    expect(clean).not.toContain("forged");
  });

  it("uses the Viewer coverage and empty sentences", () => {
    const truncated = {
      tasks: { total: 21, returned: 20, truncated: true },
      decisions: { total: 7, returned: 7, truncated: false },
      completeUnderRules: false,
    };
    expect(attentionCoverageText(truncated)).toContain("tasks 20 of 21 (truncated)");
    expect(attentionCoverageText(truncated)).toContain("Cues beyond the returned pages may exist.");
    expect(attentionCoverageCounts(truncated)).toBe("20/21 truncated tasks · 7/7 decisions");
    expect(attentionEmptyText(truncated)).toContain("more matching records may exist");
    expect(attentionEmptyText({ ...truncated, completeUnderRules: true, tasks: { total: 3, returned: 3, truncated: false } })).toContain(
      "does not mean all work is done",
    );
    expect(attentionReasonLabel("accepted_decision_needs_review")).toContain("needs human review");
    expect(DASHBOARD_NON_TTY_MESSAGE).not.toContain("\u001B");
  });

  it("matches the Viewer source until the refresh edits labels", () => {
    expect(viewerLabelDrift(APP_JS)).toEqual([]);
    expect(INDEX_HTML).toContain("Recorded assignment is a record, not a permission");
  });
});
