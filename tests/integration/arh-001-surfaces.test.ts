/**
 * ARH-001 deterministic surface checks over the frozen artifact-handoff
 * fixture (candidate scope §6, D1–D6 mapping, plus the §0 additions).
 *
 * The frozen fixture is seeded into a throwaway directory and read through the
 * real service exactly as the candidate's serving reads work; both changed
 * heads are then projected from that one authorized read:
 *
 *  1. the terminal dashboard module — inspect-only reference rows (class,
 *     host for openables, cited-by relations, external-unverified caveat) at
 *     wide and narrow sizes with real fit bounds, and deliberately NO open
 *     action anywhere;
 *  2. the Viewer client (`src/viewer/static/app.js` `renderSources`) in the
 *     same vm sandbox the frozen suites use — exactly three anchors, one per
 *     openable-https lab artifact, each opener/referrer-safe and host-labeled;
 *     every other class stays inert labeled text; hostile markup stays
 *     escaped; rendering fetches nothing and navigates nothing.
 *
 * Denied reads (non-participant, unrelated workspace, foreign artifact id)
 * gain no artifact/class/host/relation/count fact (D1), and no surface claims
 * the target is open, verified, or accessible (D4). Fixture evidence — this
 * file cannot establish Gate B, C, or E and is not a human observation.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDashboardState,
  reduceDashboardKey,
  renderDashboard,
  sectionRows,
  type DashboardState,
} from "../../src/cli/dashboard.js";
import type { ActorRef, Contribution } from "../../src/domain/types.js";
import { dispatchCampfireMethod } from "../../src/http/dispatch.js";
import {
  ARTIFACT_EXTERNAL_UNVERIFIED_LABEL,
  ARTIFACT_OPEN_CONTROL_SUFFIX,
  ARTIFACT_REFERENCE_LABEL,
  ARTIFACT_UNSAFE_CONTROL_LABEL,
  classifyArtifactReference,
} from "../../src/presentation/work-console.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService, WorkspaceContext } from "../../src/service/service.js";
import { openReadonlySqliteStore } from "../../src/store/sqlite-store.js";
import { VIEWER_READ_METHODS } from "../../src/viewer/server.js";
import {
  SCENARIO,
  SERVED_AT,
  UNRELATED_FINDING_SENTINEL,
  seedDatabase,
} from "../../fixtures/artifact-handoff/arh-001/seed.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_JS = readFileSync(join(HERE, "../../src/viewer/static/app.js"), "utf8");
const APP_CSS = readFileSync(join(HERE, "../../src/viewer/static/app.css"), "utf8");
const PUBLIC_APP_JS = readFileSync(join(HERE, "../../public/app.js"), "utf8");
const PUBLIC_APP_CSS = readFileSync(join(HERE, "../../public/app.css"), "utf8");

const REFRESHED_AT = SERVED_AT;
/** The seven lab reference classes (the §3.1 artifact set). */
const LAB_ARTIFACT_IDS = [
  SCENARIO.artifacts.safeOutput,
  SCENARIO.artifacts.safeOldReport,
  SCENARIO.artifacts.stale,
  SCENARIO.artifacts.path,
  SCENARIO.artifacts.insecureScheme,
  SCENARIO.artifacts.credentialed,
  SCENARIO.artifacts.hostileMarkup,
] as const;
const HOSTILE_STORED = 'https://example.com/arh-001/report"><img src=x onerror=alert(1)>';

function human(actorId: string): ActorContext {
  const actor: ActorRef = { actorId, actorType: "human" };
  return { actor };
}

/** The real typed denial surface of an unauthorized read. */
function captureDenialMessage(read: () => unknown): { name: string; message: string; throw: true } {
  try {
    read();
  } catch (error) {
    return {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      throw: true,
    };
  }
  throw new Error("expected the unauthorized read to be denied");
}

/**
 * Logical frame text: wrap/pin never split or alter a row token, so a
 * whitespace-normalized join is safe for content assertions (record() only
 * ever breaks at spaces and re-uses the original characters otherwise).
 */
function flat(frame: string): string {
  return frame.split("\n").join(" ").replace(/\s+/g, " ").trim();
}

function count(text: string, token: string): number {
  let total = 0;
  let at = text.indexOf(token);
  while (at >= 0) {
    total += 1;
    at = text.indexOf(token, at + token.length);
  }
  return total;
}

function expectFrameFits(frame: string, columns: number, rows: number): void {
  const lines = frame.split("\n");
  expect(lines.length, "viewport rows").toBeLessThanOrEqual(rows);
  for (const line of lines) expect(line.length, `columns at ${columns}`).toBeLessThanOrEqual(columns);
}

function loadAppSandbox() {
  let fetchCalls = 0;
  const sandbox: Record<string, unknown> = {
    document: {
      documentElement: { dataset: {} as Record<string, string> },
      getElementById: () => null,
      addEventListener: () => {},
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("no fetch in sandbox");
    },
    setInterval: () => 0,
    URL,
    CSS: { escape: (value: string) => value },
    console,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const cut = APP_JS.lastIndexOf("async function boot()");
  vm.runInContext(cut === -1 ? APP_JS : APP_JS.slice(0, cut), sandbox, { filename: "app.js" });
  return { sandbox, fetchCalls: () => fetchCalls };
}

/** Decode a source-list render into visible text (entity-safe). */
function visible(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function renderSourcesRaw(context: WorkspaceContext): { html: string; fetches: () => number } {
  const { sandbox, fetchCalls } = loadAppSandbox();
  sandbox.el = { innerHTML: "" };
  vm.runInContext(`renderSources(el, ${JSON.stringify(context)});`, sandbox);
  const element = sandbox.el as { innerHTML: string };
  return { html: element.innerHTML, fetches: fetchCalls };
}

describe("ARH-001 artifact-reference surfaces", () => {
  let dir: string;
  let service: CampfireService;
  let anaCtx: ActorContext;
  let anaLab: WorkspaceContext;
  let anaTrunc: WorkspaceContext;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "campfire-arh-001-surfaces-"));
    const seeded = seedDatabase(dir, true);
    const store = openReadonlySqliteStore(seeded.databasePath);
    service = createCampfireService({ store, clock: () => SERVED_AT });
    anaCtx = human(SCENARIO.humans.ana);
    anaLab = dispatchCampfireMethod(service, anaCtx, "get_workspace_context", {
      workspaceId: SCENARIO.workspaces.lab,
    }) as WorkspaceContext;
    anaTrunc = dispatchCampfireMethod(service, anaCtx, "get_workspace_context", {
      workspaceId: SCENARIO.workspaces.truncArtifacts,
    }) as WorkspaceContext;
  }, 120_000);

  afterAll(() => {
    service?.close();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  function dashboardState(context: WorkspaceContext): DashboardState {
    return createDashboardState({
      workspaceId: SCENARIO.workspaces.lab,
      actorId: SCENARIO.humans.ana,
      actorType: "human",
      context,
      refreshedAt: REFRESHED_AT,
    });
  }

  /**
   * The fixture's returned provenance page holds decisions and tasks but no
   * artifact entries, so the create-artifact contribution record is placed on
   * the page like one the read could return — same type, actor, action, and
   * object id — and the real change-row path drives from it.
   */
  function withArtifactContribution(
    context: WorkspaceContext,
    artifactId: string,
    topContribution: boolean,
  ): WorkspaceContext {
    const actor: ActorRef = { actorId: SCENARIO.humans.ana, actorType: "human" };
    const contribution: Contribution = {
      id: `con_arh001_probe_${artifactId}`,
      workspaceId: SCENARIO.workspaces.lab,
      actor,
      action: "create",
      objectType: "artifact",
      objectId: artifactId,
      appendPosition: 0,
      createdAt: SERVED_AT,
    };
    const provenance = topContribution
      ? [contribution, ...context.provenance]
      : [...context.provenance, contribution];
    return { ...context, provenance };
  }

  function selectArtifactChangeRow(state: DashboardState): { state: DashboardState; rowId: string } {
    let moved = state;
    while (moved.section !== "changes") moved = reduceDashboardKey(moved, "tab");
    const rows = sectionRows(moved);
    const index = rows.findIndex(
      (row) => row.objectType === "artifact" && row.objectId === SCENARIO.artifacts.safeOutput,
    );
    expect(index, "artifact change row present").toBeGreaterThanOrEqual(0);
    for (let steps = 0; steps < index; steps += 1) moved = reduceDashboardKey(moved, "j");
    return { state: moved, rowId: sectionRows(moved)[index]!.id };
  }

  describe("terminal dashboard — inspect-only reference projection (D2/D3, no open action)", () => {
    it("shows every frozen class, the openable hosts, the recorded cited-by relations, and the caveat", () => {
      const frame = renderDashboard(dashboardState(anaLab), 200, 80);
      expectFrameFits(frame, 200, 80);
      const text = flat(frame);

      // The exact stored reference texts, verbatim, with the retained label.
      expect(text).toContain("https://example.com/arh-001/q3-handoff-analysis.html");
      expect(text).toContain("https://example.com/arh-001/q3-handoff-analysis-draft.html");
      expect(text).toContain("https://example.com/arh-001/deployments/old-preview");
      expect(text).toContain("reports/arh-001/working-notes.md");
      expect(text).toContain("ftp://files.example.com/arh-001/export.tar.gz");
      expect(text).toContain("https://arh001-demo-user:arh001-demo-pass@example.com/arh-001/private-view");
      expect(text).toContain(HOSTILE_STORED);
      expect(count(text, ARTIFACT_REFERENCE_LABEL)).toBe(7);

      // One row per class; host only for openable rows, and never the raw
      // userinfo or a non-https scheme authority.
      expect(count(text, "class openable https")).toBe(3);
      expect(count(text, "host example.com")).toBe(3);
      expect(text).toContain("class local path");
      expect(text).toContain("class other scheme");
      expect(text).toContain("class credential-bearing");
      expect(text).toContain("class unparsed");
      expect(text).not.toContain("class none");
      expect(text).not.toContain("host files.example.com");
      expect(text).not.toContain("host arh001-demo-user");

      // Recorded relations only, exactly as the serving read carries them.
      expect(text).toContain("cited by find_arh001_current (supports)");
      expect(text).toContain("cited by find_arh001_contradicts (contradicts)");
      expect(count(text, "cited by")).toBe(2);

      // The external boundary labels every artifact row.
      expect(count(text, ARTIFACT_EXTERNAL_UNVERIFIED_LABEL)).toBe(7);
      // No lab reference carries control characters, so the hostile sweep
      // label belongs to none of these rows.
      expect(text).not.toContain(ARTIFACT_UNSAFE_CONTROL_LABEL);

      // The terminal is inspect-only: no open control, no navigation target.
      expect(text).not.toContain("Open example.com");
      expect(text).not.toContain(ARTIFACT_OPEN_CONTROL_SUFFIX);
      expect(text).not.toContain("<a ");
      expect(text).not.toContain("href=");
    });

    it("keeps hostile markup as raw stored text, classified unparsed, never openable", () => {
      const text = flat(renderDashboard(dashboardState(anaLab), 200, 80));
      const at = text.indexOf(HOSTILE_STORED);
      const span = at < 0 ? "" : text.slice(at, at + 260);
      expect(at).toBeGreaterThanOrEqual(0);
      // The row itself names the class; the strict contract refused to parse
      // the quotes and angles, so the row stays text, never an open control.
      expect(span).toContain("class unparsed");
      expect(span).not.toContain(ARTIFACT_OPEN_CONTROL_SUFFIX);
      expect(span).not.toContain("Open example.com");
    });

    it("opens the recorded artifact detail on enter over this read and never grows an open action", () => {
      const link = withArtifactContribution(anaLab, SCENARIO.artifacts.safeOutput, true);
      const { state: moved, rowId } = selectArtifactChangeRow(dashboardState(link));
      const state = reduceDashboardKey(moved, "\r");
      // Contribution rows are complete records: the event opens the detail
      // view over what this read already holds, dispatching no extra request.
      expect(state.detailOpen).toBe(true);
      expect(state.inspectRequest).toBeUndefined();

      const frame = renderDashboard(state, 200, 80);
      expectFrameFits(frame, 200, 80);
      const text = flat(frame);
      expect(text).toContain(`get_workspace_context ${rowId}`);
      expect(text).toContain(ARTIFACT_REFERENCE_LABEL);
      expect(text).toContain("class openable https");
      expect(text).toContain("cited by find_arh001_current (supports)");
      expect(text).toContain(ARTIFACT_EXTERNAL_UNVERIFIED_LABEL);
      expect(text).not.toContain(ARTIFACT_OPEN_CONTROL_SUFFIX);
      expect(text).not.toContain("<a ");
    });

    it("renders the get_artifact detail body with class, host, caveat, and no invented cited-by", () => {
      const record = dispatchCampfireMethod(service, anaCtx, "get_artifact", {
        workspaceId: SCENARIO.workspaces.lab,
        artifactId: SCENARIO.artifacts.safeOutput,
      }) as Record<string, unknown>;
      // The detail read carries no evidence rows, so no relation may be
      // derived there — the projection has nothing to invent from.
      expect(record.evidence).toBeUndefined();

      // Detail over a read whose returned artifact slice is empty: every
      // class/host/caveat/cited-by token in the frame can then come only from
      // this record's own detail body.
      const link = withArtifactContribution(
        { ...anaLab, artifacts: [] } as WorkspaceContext,
        SCENARIO.artifacts.safeOutput,
        true,
      );
      const { state: moved, rowId } = selectArtifactChangeRow(dashboardState(link));
      const opened = reduceDashboardKey(moved, "\r");
      const state = { ...opened, inspected: { method: "get_artifact", sourceId: rowId, record } };

      const frame = renderDashboard(state, 200, 80);
      expectFrameFits(frame, 200, 80);
      const text = flat(frame);
      expect(text).toContain(`get_artifact ${rowId}`);
      expect(text).toContain("uriOrPath https://example.com/arh-001/q3-handoff-analysis.html");
      expect(count(text, "class openable https")).toBe(1);
      expect(count(text, "host example.com")).toBe(1);
      expect(count(text, ARTIFACT_EXTERNAL_UNVERIFIED_LABEL)).toBe(1);
      expect(text).not.toContain("cited by");
      expect(text).not.toContain(ARTIFACT_OPEN_CONTROL_SUFFIX);
      // The detail view never claims the target opened, verified, or accessible.
      expect(text).not.toMatch(/\bopened\b/);
      expect(text).not.toMatch(/\bverified\b/);
      expect(text).not.toMatch(/\baccessible\b/);
      expect(text).not.toMatch(/\breachable\b/);
      expect(text).not.toMatch(/\bis open\b/);
    });

    it("renders a missing class row honestly when the artifact left the returned page", () => {
      // An artifact referenced by a change row but absent from the returned
      // orientation: ids and the stored-reference label alone are shown, no
      // class/host/relation is invented (D2: missing links stay missing).
      const stripped = withArtifactContribution(
        { ...anaLab, artifacts: [] } as WorkspaceContext,
        SCENARIO.artifacts.safeOutput,
        true,
      );
      const { state: moved } = selectArtifactChangeRow(dashboardState(stripped));
      const state = reduceDashboardKey(moved, "\r");
      const text = flat(renderDashboard(state, 200, 80));
      expect(text).toContain(`${SCENARIO.artifacts.safeOutput} ${ARTIFACT_REFERENCE_LABEL}`);
      expect(text).not.toContain("class openable https");
      expect(text).not.toContain("host example.com");
      expect(text).not.toContain("cited by");
    });

    it("fits and keeps the first reference row at narrow sizes (120x36, 80x24)", () => {
      for (const [columns, rows] of [
        [120, 36],
        [80, 24],
      ] as const) {
        const frame = renderDashboard(dashboardState(anaLab), columns, rows);
        expectFrameFits(frame, columns, rows);
        const text = flat(frame);
        // The cited report is the first artifact row, so its row (with the
        // class token) is on screen even in the narrow frames when the frame
        // leaves room for it; the caveat labels every shown artifact row.
        expect(text, `narrow ${columns}x${rows} artifact row`).toContain("class openable https");
        expect(text, `narrow ${columns}x${rows} caveat`).toContain(ARTIFACT_EXTERNAL_UNVERIFIED_LABEL);
      }
    });
  });

  describe("Viewer artifact source rendering (D3 deliberate open, D2 inert rest)", () => {
    it("renders exactly the three openable-https anchors, opener-safe and host-labeled", () => {
      const { html, fetches } = renderSourcesRaw(anaLab);
      expect(fetches()).toBe(0);

      expect((html.match(/<a /g) ?? []).length).toBe(3);
      expect(count(html, 'target="_blank"')).toBe(3);
      expect(count(html, 'rel="noopener noreferrer"')).toBe(3);
      expect(count(html, 'referrerpolicy="no-referrer"')).toBe(3);
      expect(count(html, ARTIFACT_EXTERNAL_UNVERIFIED_LABEL)).toBe(7);

      // Each anchor carries the stored href and states host + boundary in the
      // label itself, so nothing is color-only.
      for (const reference of [
        "https://example.com/arh-001/q3-handoff-analysis.html",
        "https://example.com/arh-001/q3-handoff-analysis-draft.html",
        "https://example.com/arh-001/deployments/old-preview",
      ]) {
        expect(html).toContain(
          `href="${reference}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"`,
        );
      }
      expect(count(html, `Open example.com ${ARTIFACT_OPEN_CONTROL_SUFFIX}`)).toBe(3);

      const text = visible(html);
      expect(count(text, "class openable https")).toBe(3);
      expect(count(text, "host example.com")).toBe(3);
      expect(text).toContain("class local path");
      expect(text).toContain("class other scheme");
      expect(text).toContain("class credential-bearing");
      expect(text).toContain("class unparsed");
      expect(text).not.toContain("host files.example.com");
      expect(text).not.toContain("host arh001-demo-user");
      expect(count(text, ARTIFACT_REFERENCE_LABEL)).toBe(7);
      expect(text).not.toContain(ARTIFACT_UNSAFE_CONTROL_LABEL);
      expect(text).toContain("cited by find_arh001_current (supports)");
      expect(text).toContain("cited by find_arh001_contradicts (contradicts)");
      expect(count(text, "cited by")).toBe(2);
    });

    it("keeps hostile markup escaped and unanchored; a missing reference gets no class invention", () => {
      const withNone = {
        ...anaLab,
        slices: {
          ...anaLab.slices,
          artifacts: {
            ...anaLab.slices.artifacts,
            items: [
              ...anaLab.slices.artifacts.items,
              { id: "art_arh001_probe_none", type: "other", title: "Bare record", uriOrPath: "" },
            ],
          },
        },
      } as WorkspaceContext;
      const { html } = renderSourcesRaw(withNone);
      expect(html).not.toMatch(/<img/i);
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      // Hostile text is inert: no anchor points at the refused reference.
      expect(html).not.toContain('href="https://example.com/arh-001/report');
      expect(html).not.toContain("onerror=alert(1)>");
      // The missing reference renders nothing beyond the existing label.
      expect(html).toContain("no reference recorded");
      expect(count(html, "class openable https")).toBe(3);
      expect(count(html, "host example.com")).toBe(3);
      expect(count(html, ARTIFACT_EXTERNAL_UNVERIFIED_LABEL)).toBe(7);
      expect(count(html, ARTIFACT_REFERENCE_LABEL)).toBe(7);
      expect(count(html, "cited by")).toBe(2);
    });

    it("classifies the served rows identically on both surfaces (parity over the real DB rows)", () => {
      const { sandbox } = loadAppSandbox();
      for (const context of [anaLab, anaTrunc]) {
        for (const artifact of context.slices.artifacts.items) {
          const terminal = classifyArtifactReference(artifact.uriOrPath);
          const browser = JSON.parse(
            vm.runInContext(
              `JSON.stringify(classifyArtifactReference(${JSON.stringify(artifact.uriOrPath)}))`,
              sandbox,
            ) as string,
          ) as unknown;
          expect(browser, `mirror for ${artifact.uriOrPath}`).toEqual(terminal);
        }
      }
    });

    it("agrees with the dashboard on counts per frozen token from the same read (D5)", () => {
      const { html } = renderSourcesRaw(anaLab);
      const viewer = visible(html);
      const frame = flat(renderDashboard(dashboardState(anaLab), 200, 80));
      for (const token of [
        "class openable https",
        "class local path",
        "class other scheme",
        "class credential-bearing",
        "class unparsed",
        "host example.com",
        ARTIFACT_EXTERNAL_UNVERIFIED_LABEL,
        ARTIFACT_REFERENCE_LABEL,
        "cited by find_arh001_current (supports)",
        "cited by find_arh001_contradicts (contradicts)",
      ]) {
        expect(count(frame, token), `token ${token}`).toBe(count(viewer, token));
      }
    });
  });

  describe("D1 authorization — denied reads gain no artifact fact", () => {
    it("denies a non-participant lab read with no artifact, class, host, relation, or caveat detail", () => {
      const denied = captureDenialMessage(() =>
        dispatchCampfireMethod(service, human(SCENARIO.humans.zed), "get_workspace_context", {
          workspaceId: SCENARIO.workspaces.lab,
        }),
      );
      const text = `${denied.name}: ${denied.message}`;
      expect(denied.throw).toBe(true);
      for (const artifactId of LAB_ARTIFACT_IDS) {
        expect(text).not.toContain(artifactId);
      }
      expect(text).not.toContain("example.com");
      expect(text).not.toContain("arh001-demo-user");
      expect(text).not.toContain("class openable");
      expect(text).not.toContain("class unparsed");
      expect(text).not.toContain("credential-bearing");
      expect(text).not.toContain(ARTIFACT_EXTERNAL_UNVERIFIED_LABEL);
      expect(text).not.toContain(ARTIFACT_UNSAFE_CONTROL_LABEL);
      expect(text).not.toContain("cited by");
      expect(text).not.toContain("Q3 handoff analysis");
      expect(text).not.toContain(UNRELATED_FINDING_SENTINEL);
    });

    it("denies a foreign artifact id through the lab route with no other-workspace payload", () => {
      let message = "";
      try {
        service.getArtifactInWorkspace(
          anaCtx,
          SCENARIO.workspaces.lab,
          SCENARIO.artifacts.truncLinked,
        );
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message.length).toBeGreaterThan(0);
      // Message stays a boundary error: it names at most the caller-supplied
      // route, never the other workspace's artifact facts or new projection
      // vocabulary, and it does not grant, describe, or suggest access.
      for (const artifactId of LAB_ARTIFACT_IDS) {
        expect(message).not.toContain(artifactId);
      }
      expect(message).not.toContain("example.com");
      expect(message).not.toContain("class openable");
      expect(message).not.toContain("credential-bearing");
      expect(message).not.toContain(ARTIFACT_EXTERNAL_UNVERIFIED_LABEL);
      expect(message).not.toContain(ARTIFACT_OPEN_CONTROL_SUFFIX);
      expect(message).not.toContain("cited by");
      expect(message).not.toMatch(/\bopened\b/);
      expect(message).not.toMatch(/\baccessible\b/);
    });

    it("denies the unrelated workspace with the sentinel staying put", () => {
      const denied = captureDenialMessage(() =>
        dispatchCampfireMethod(service, anaCtx, "get_workspace_context", {
          workspaceId: SCENARIO.workspaces.unrelated,
        }),
      );
      const text = `${denied.name}: ${denied.message}`;
      expect(denied.throw).toBe(true);
      expect(text).not.toContain(UNRELATED_FINDING_SENTINEL);
      expect(text).not.toContain(SCENARIO.workspaceNames.unrelated);
      expect(text).not.toContain("example.com");
      expect(text).not.toContain(ARTIFACT_EXTERNAL_UNVERIFIED_LABEL);
      expect(text).not.toContain("class openable");
    });
  });

  describe("D4/D6 boundaries", () => {
    it("claims nothing about the external target on either surface (D4)", () => {
      const frame = flat(renderDashboard(dashboardState(anaLab), 200, 80));
      const { html } = renderSourcesRaw(anaLab);
      const viewer = visible(html);
      for (const text of [frame, viewer]) {
        expect(text).toContain(ARTIFACT_EXTERNAL_UNVERIFIED_LABEL);
        expect(text).toContain("workspace membership does not grant access");
        expect(text).not.toMatch(/\bopened\b/);
        expect(text).not.toMatch(/\bverified\b/);
        expect(text).not.toMatch(/\baccessible\b/);
        expect(text).not.toMatch(/\breachable\b/);
        expect(text).not.toMatch(/\bis open\b/);
      }
    });

    it("keeps the five Viewer read methods, the static shell, and the synced public copies (D6)", () => {
      expect([...VIEWER_READ_METHODS]).toEqual([
        "whoami",
        "list_workspaces",
        "get_workspace",
        "get_workspace_context",
        "get_activity",
      ]);
      expect(PUBLIC_APP_JS).toBe(APP_JS);
      expect(PUBLIC_APP_CSS).toBe(APP_CSS);
      // The one anchor style is named in text and keeps the underline
      // affordance for hover and keyboard focus (no color-only state).
      expect(APP_CSS).toContain(".oopen {");
      expect(APP_CSS).toContain(".oopen:hover,\n.oopen:focus-visible {\n  text-decoration: underline;\n}");
      expect(PUBLIC_APP_CSS).toContain(".oopen {");
    });
  });
});
