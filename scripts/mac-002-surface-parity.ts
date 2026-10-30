/**
 * Reads one recorded, actor-authorized Viewer response and checks that the
 * terminal dashboard, SwiftUI prototype contract, and GPUIX client preserve
 * the same workspace identity, bounded counts, truncation, and record ids.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

import {
  createDashboardState,
  sectionRows,
} from "../src/cli/dashboard.js";
import type { WorkspaceContext } from "../src/service/service.js";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const desktopSource = join(root, "../campfire-desktop/apps/gpuix/src/campfire");
// Computed imports keep Campfire-Internal's TypeScript project boundary intact;
// tsx still executes the exact GPUIX sources in this sibling checkout.
const { CampfireViewerClient } = await import(
  pathToFileURL(join(desktopSource, "step1/viewer-client.ts")).href
);
const { campfireSection } = await import(
  pathToFileURL(join(desktopSource, "map-screen.ts")).href
);
const responsePath = join(
  root,
  "docs/evidence/nav-002/baseline/json/get-workspace-context-ana.json",
);
const responseText = readFileSync(responsePath, "utf8");
const envelope = JSON.parse(responseText) as {
  ok: true;
  result: WorkspaceContext;
};
const source = envelope.result;

const fetchRecorded: typeof fetch = async () =>
  new Response(responseText, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const gpuix: WorkspaceContext = await new CampfireViewerClient(
  fetchRecorded,
).getWorkspaceContext(
  source.workspace.id,
);
const gpuixWork = campfireSection(gpuix, "work");
const gpuixDecisions = campfireSection(gpuix, "decisions");

const terminal = createDashboardState({
  workspaceId: source.workspace.id,
  actorId: "hum_nav001_ana",
  actorType: "human",
  context: source,
  perspective: "mine",
  section: "work",
  refreshedAt: source.generatedAt,
});
const terminalWorkIds = sectionRows(terminal).map((row) => row.id);
const terminalDecisionIds = sectionRows({
  ...terminal,
  section: "decisions",
  row: 0,
}).map((row) => row.id);

const swift = JSON.parse(
  execFileSync(
    "xcrun",
    [
      "swift",
      join(root, "prototypes/mac-001/ParityDecode.swift"),
      responsePath,
    ],
    { encoding: "utf8" },
  ),
) as {
  workspaceId: string;
  workspaceName: string;
  goalTitle: string;
  taskIds: string[];
  findingIds: string[];
  tasks: { total: number; returned: number; truncated: boolean };
  findings: { total: number; returned: number; truncated: boolean };
};

const sourceTaskIds = source.slices.tasks.items.map((item) => item.id);
const sourceFindingIds = source.slices.findings.items.map((item) => item.id);
const sourceDecisionIds = source.slices.decisions.items.map((item) => item.id);

assert.equal(gpuix.workspace.id, source.workspace.id);
assert.equal(swift.workspaceId, source.workspace.id);
assert.deepEqual(swift.taskIds, sourceTaskIds);
assert.deepEqual(swift.findingIds, sourceFindingIds);
assert.deepEqual(swift.tasks, {
  total: source.slices.tasks.total,
  returned: source.slices.tasks.returned,
  truncated: source.slices.tasks.truncated,
});
assert.deepEqual(swift.findings, {
  total: source.slices.findings.total,
  returned: source.slices.findings.returned,
  truncated: source.slices.findings.truncated,
});

assert.deepEqual(
  gpuix.slices.tasks.items.map((item) => item.id),
  sourceTaskIds,
);
assert.deepEqual(
  gpuix.slices.findings.items.map((item) => item.id),
  sourceFindingIds,
);
assert.deepEqual(
  gpuix.slices.decisions?.items.map((item) => item.id),
  sourceDecisionIds,
);
assert.deepEqual(gpuix.slices.tasks, {
  items: gpuix.slices.tasks.items,
  total: source.slices.tasks.total,
  returned: source.slices.tasks.returned,
  truncated: source.slices.tasks.truncated,
});

// The terminal Work view is task-only; GPUIX and SwiftUI additionally expose
// findings. Every terminal task id must still come from this exact response.
assert.deepEqual(terminalWorkIds, sourceTaskIds);
assert.deepEqual(
  gpuixWork.rows
    .slice(0, sourceTaskIds.length)
    .map((row: { id: string }) => row.id),
  terminalWorkIds,
);
assert.deepEqual(
  gpuixWork.rows
    .slice(sourceTaskIds.length)
    .map((row: { id: string }) => row.id),
  sourceFindingIds,
);
const sorted = (ids: readonly string[]) => [...ids].sort();
const gpuixDecisionIds = gpuixDecisions.rows.map(
  (row: { id: string }) => row.id,
);

assert.deepEqual(sorted(terminalDecisionIds), sorted(sourceDecisionIds));
assert.deepEqual(sorted(gpuixDecisionIds), sorted(sourceDecisionIds));
assert.equal(terminalDecisionIds[0], gpuixDecisionIds[0]);

const report = {
  source: responsePath,
  workspaceId: source.workspace.id,
  selectedRecordId: sourceTaskIds[0],
  tasks: {
    total: source.slices.tasks.total,
    returned: source.slices.tasks.returned,
    truncated: source.slices.tasks.truncated,
  },
  findings: {
    total: source.slices.findings.total,
    returned: source.slices.findings.returned,
    truncated: source.slices.findings.truncated,
  },
  decisions: {
    total: source.slices.decisions.total,
    returned: source.slices.decisions.returned,
    truncated: source.slices.decisions.truncated,
  },
  surfaces: {
    cliTui: {
      workspaceId: terminal.workspaceId,
      taskIds: terminalWorkIds,
      decisionIds: terminalDecisionIds,
    },
    swiftUI: swift,
    gpuix: {
      workspaceId: gpuix.workspace.id,
      workIds: gpuixWork.rows.map((row: { id: string }) => row.id),
      decisionIds: gpuixDecisionIds,
    },
  },
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
