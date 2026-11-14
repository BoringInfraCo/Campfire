/**
 * Campfire OpenTUI navigation slice.
 * Runs under the vendored Bun only. The Node CLI launches this file.
 */
import { createCliRenderer, BoxRenderable, ImageRenderable, TextRenderable, bold, fg, t, type CliRenderer, type StyledText } from "@opentui/core";
import { fileURLToPath } from "node:url";
import { postCall } from "./client.ts";
import { activityMatchesWorkspace, array, contributionText, coverage, detailMatchesSelection, fallbackAttentionCoverage, fallbackAttentionRows, historyMatchesRequest, object, pageMatchesWorkspace, safe, sectionEmptyMessage, sectionRows, taskPageMatchesWorkspace, type SectionRow } from "./sections.ts";
import { recordDetailLines } from "./details.ts";
import { overviewSummaryRows } from "./overview.ts";
import { activityDetails } from "./activity.ts";
import { UPDATE_EXIT_CODE } from "./exit-codes.ts";
import { ownedAgentsParams, participantFacts, validateOwnedAgentsPage } from "./people.ts";
import { attentionCount, attentionCompactSummaryLines, attentionCueLines, attentionCueRowText, attentionDetailLines, cuesFor, perspectiveHeading, type Perspective, attentionLines, attentionSummaryLines, initialAttention, readAttention } from "./attention.ts";

const MARK_FILE = fileURLToPath(new URL("../assets/campfire-logomark.png", import.meta.url));
import {
  CONTENT_HINT,
  SECTIONS,
  SIDEBAR_HINT,
  initialNav,
  reduceNav,
  sectionAt,
  type NavAction,
  type NavState,
} from "./nav-state.ts";

const NARROW_BELOW = 72;
const SIDEBAR_COLUMNS = 28;
const CANVAS = "#12131a";
const RAIL = "#161820";
const RULE = "#3a342c";
const ACTIVE_BG = "#302a1e";
const ACTIVE_FG = "#f4ecdc";
const IDLE_FG = "#b7b0a4";
const CREAM = "#f4ecdc";
const GOLD = "#e6b06e";
const DIM_FG = "#7d776e";
const EMBER = "#fc6142";

interface WorkspaceSnapshot {
  name: string;
  id: string;
  goal: string;
  /** Present only when `needsYou` is an array on the context. */
  needsYouCount?: number;
  context: unknown;
}

type Phase =
  | { kind: "awaiting" }
  | { kind: "loading" }
  | { kind: "ready"; snapshot: WorkspaceSnapshot }
  | { kind: "error"; message: string };

const NOTHING_LOADED_DENIED = "Not authorized to list workspaces. Check CAMPFIRE_TOKEN, then press r.";
const LIST_FAILED = "Could not list workspaces. Check the connection, then press r to retry.";
const UNAUTHORIZED_MESSAGE = "Authorization refused; workspace data cleared.";
const NOT_LOADED = "The section body is not loaded in this slice.";

function envValue(name: string): string {
  const value = process.env[name];
  return typeof value === "string" ? value : "";
}

function readSnapshot(result: unknown): WorkspaceSnapshot | { message: string } {
  if (typeof result !== "object" || result === null) {
    return { message: "Workspace response was not an object." };
  }
  const body = result as Record<string, unknown>;
  const workspace = body.workspace;
  if (typeof workspace !== "object" || workspace === null) {
    return { message: "Workspace response did not include a workspace." };
  }
  const record = workspace as Record<string, unknown>;
  const name = safe(record.name);
  const id = safe(record.id);
  if (name.length === 0 || id.length === 0) {
    return { message: "Workspace response did not include a name and id." };
  }
  let goal = "no recorded goal";
  const goalRecord = body.goal;
  if (typeof goalRecord === "object" && goalRecord !== null) {
    const title = (goalRecord as { title?: unknown }).title;
    if (safe(title)) goal = safe(title);
  }
  const snapshot: WorkspaceSnapshot = { name, id, goal, context: result };
  if (Array.isArray(body.needsYou)) snapshot.needsYouCount = body.needsYou.length;
  return snapshot;
}

function contentText(phase: Phase, nav: NavState, lines?: string[]): StyledText {
  if (lines !== undefined && phase.kind !== "ready") return t`${fg(CREAM)(lines.join("\n"))}`;
  const section = sectionAt(nav.index);
  if (phase.kind === "awaiting") return t`${fg(CREAM)("No workspace yet")}
${fg(DIM_FG)("Ask your agent to create a workspace and goal, or join an existing workspace.")}
${fg(DIM_FG)("Press r to check again or w to choose a workspace.")}
${fg(DIM_FG)("To create one yourself, quit and run campfire create-workspace --help.")}`;
  if (phase.kind === "loading") return t`${fg(DIM_FG)("Loading workspace…")}`;
  if (phase.kind === "error") return t`${fg(EMBER)(phase.message)}`;
  const snapshot = phase.snapshot;
  if (lines !== undefined) return t`${fg(CREAM)(snapshot.name)}
${fg(GOLD)(snapshot.goal.length > 70 ? `${snapshot.goal.slice(0, 69)}…` : snapshot.goal)}
${fg(CREAM)(lines.join("\n"))}`;
  const honest =
    section.id === "attention" && snapshot.needsYouCount !== undefined
      ? `Needs you  ${snapshot.needsYouCount}`
      : `${section.label}. ${NOT_LOADED}`;
  return t`${fg(CREAM)(snapshot.name)}
${fg(DIM_FG)(snapshot.id)}
${fg(GOLD)(snapshot.goal.length > 70 ? `${snapshot.goal.slice(0, 69)}…` : snapshot.goal)}
${fg(DIM_FG)(honest)}`;
}

function narrow(width: number): boolean {
  return width < NARROW_BELOW;
}

async function main(): Promise<void> {
  let renderer: CliRenderer | undefined;
  let stopping = false;
  const shutdown = async (code: number): Promise<void> => {
    if (stopping) return;
    stopping = true;
    try {
      if (renderer !== undefined && !renderer.isDestroyed) {
        renderer.destroy();
        await renderer.closed;
      }
    } catch {
      // destroy() is what restores the terminal. A second failure still exits.
    }
    process.exit(code);
  };

  try {
    renderer = await createCliRenderer({
      exitOnCtrlC: true,
      useMouse: true,
      consoleMode: "disabled",
    });
    const ui = renderer;
    ui.setBackgroundColor("#141414");

    let nav: NavState = initialNav();
    const awaitingWorkspace = envValue("CAMPFIRE_AWAITING_WORKSPACE") === "1";
    let workspaceId = envValue("CAMPFIRE_WORKSPACE_ID");
    const baseUrl = envValue("CAMPFIRE_URL");
    const token = envValue("CAMPFIRE_TOKEN");
    let phase: Phase = awaitingWorkspace ? { kind: "awaiting" } : { kind: "loading" };
    let pages: Record<string, unknown> = {};
    let workspaces: Array<{id: string; name: string}> = [];
    let picker = false;
    let pickerIndex = 0;
    let rowIndex = 0;
    let detail: string[] | undefined;
    let detailCue: SectionRow | undefined;
    let detailScroll = 0;
    let historyRow: SectionRow | undefined;
    let historyStack: string[] = [];
    let historyNext: string | undefined;
    let filter = "";
    let filtering = false;
    let generation = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    let attention = initialAttention(workspaceId);
    let cursors: Record<string, string[]> = {};
    let pageGeneration: Record<string, number> = {};
    let detailGeneration = 0;
    let authorityEpoch = 0;
    let pickerGeneration = 0;
    let stalePages = new Set<string>();
    let detailOwner: string | undefined;
    let peopleOwner: string | undefined;
    let previousPeoplePage: unknown;
    let previousPeopleCursors: string[] = [];
    let previousPeopleStale = false;
    let attentionRefreshing = false;
    let perspective: Perspective = "mine";
    let clickableRows: Array<{ line: number; index: number }> = [];
    const inPerspective = (rows: SectionRow[]): SectionRow[] => rows.filter((row) => row.text.startsWith(perspective === "mine" ? "[you]" : "[team]"));
    const cueRow = (cue: { id: string; subjectId: string; subjectType: string }): SectionRow => ({ id: cue.subjectId, kind: cue.subjectType, cueId: cue.id, text: attentionCueRowText(cue as Parameters<typeof attentionCueRowText>[0]) });
    const currentRows = (): SectionRow[] => {
      if (phase.kind !== "ready") return [];
      const section = sectionAt(nav.index).id;
      const failedAttention = attention.status === "error" || attention.status === "cursor_error";
      const rows = section === "attention" && attention.result
        ? cuesFor(attention.result, perspective).map((cue) => cueRow(cue))
        : section === "attention" && failedAttention ? inPerspective(fallbackAttentionRows(phase.snapshot.context))
        : section === "overview"
          ? overviewSummaryRows(phase.snapshot.context, attention)
        : sectionRows(section, phase.snapshot.context, pages);
      return rows.filter((row) => !filter || row.text.toLowerCase().includes(filter.toLowerCase()));
    };
    const selectedKey = (): string | undefined => {
      const selected = currentRows()[rowIndex];
      return selected ? (selected.cueId ?? selected.rowKey ?? `${selected.kind}:${selected.id}`) : undefined;
    };
    const reconcile = (key: string | undefined): void => {
      if (key === undefined) return;
      const index = currentRows().findIndex((row) => (row.cueId ?? row.rowKey ?? `${row.kind}:${row.id}`) === key);
      if (index >= 0) rowIndex = index;
      else { rowIndex = -1; detail = undefined; detailCue = undefined; detailGeneration++; nav = {...nav, status: "Selection is no longer in the loaded result."}; }
    };

    const root = new BoxRenderable(ui, {
      flexDirection: "column",
      width: ui.width,
      height: ui.height,
      backgroundColor: CANVAS,
    });
    const body = new BoxRenderable(ui, {
      flexDirection: "row",
      flexGrow: 1,
      width: "100%",
      columnGap: 2,
      backgroundColor: CANVAS,
    });
    const sidebar = new BoxRenderable(ui, {
      flexDirection: "column",
      width: SIDEBAR_COLUMNS,
      paddingTop: 1,
      paddingLeft: 2,
      paddingRight: 1,
      paddingBottom: 1,
      backgroundColor: RAIL,
      border: ["right"],
      borderColor: RULE,
    });
    const mark = new ImageRenderable(ui, {
      id: "mark",
      source: MARK_FILE,
      width: 18,
      height: 16,
      fit: "fit",
      protocol: "auto",
      onLoad: () => ui.requestRender(),
      onError: (error) => {
        const message = error instanceof Error ? error.message : "Campfire mark failed to load";
        console.error(message);
      },
    });
    const wordmark = new TextRenderable(ui, {
      id: "wordmark",
      content: t`${bold(fg(GOLD)("campfire"))}`,
      height: 1,
      width: "100%",
      selectable: false,
    });
    const navGap = new TextRenderable(ui, {
      id: "nav-gap",
      content: " ",
      height: 1,
      width: "100%",
      selectable: false,
    });
    const rows = SECTIONS.map(
      (section, index) =>
        new TextRenderable(ui, {
          id: `section-${section.id}`,
          content: index === 0 ? `> ${section.label}` : `  ${section.label}`,
          height: 1,
          width: "100%",
          fg: index === 0 ? ACTIVE_FG : IDLE_FG,
          bg: index === 0 ? ACTIVE_BG : RAIL,
          selectable: false,
        }),
    );
    sidebar.add(mark);
    sidebar.add(wordmark);
    sidebar.add(navGap);
    for (const row of rows) sidebar.add(row);
    const content = new TextRenderable(ui, {
      id: "content",
      content: contentText(phase, nav),
      flexGrow: 1,
      width: "100%",
      paddingTop: 1,
      paddingLeft: 2,
      wrapMode: "word",
      selectable: false,
    });
    const status = new TextRenderable(ui, {
      id: "status",
      content: " ",
      height: 1,
      width: "100%",
      paddingLeft: 2,
      fg: GOLD,
      selectable: false,
    });
    const footer = new TextRenderable(ui, {
      id: "footer",
      content: SIDEBAR_HINT,
      height: 1,
      width: "100%",
      paddingLeft: 2,
      paddingBottom: 1,
      fg: DIM_FG,
      selectable: false,
    });
    body.add(sidebar);
    body.add(content);
    root.add(body);
    root.add(status);
    root.add(footer);
    ui.root.add(root);

    const paint = (): void => {
      const width = ui.width;
      const height = ui.height;
      const stacked = narrow(width);
      root.width = width;
      root.height = height;
      body.flexDirection = stacked ? "column" : "row";
      body.width = width;
      sidebar.width = stacked ? width : SIDEBAR_COLUMNS;
      sidebar.flexGrow = 0;
      mark.height = stacked ? 0 : 16;
      navGap.height = stacked ? 0 : 1;
      sidebar.paddingTop = stacked ? 0 : 1;
      sidebar.paddingBottom = stacked ? 0 : 1;
      sidebar.border = stacked ? false : ["right"];
      content.flexGrow = 1;
      content.width = stacked ? width : Math.max(1, width - SIDEBAR_COLUMNS - 2);
      rows.forEach((row, index) => {
        const section = SECTIONS[index];
        if (section === undefined) return;
        const selected = index === nav.index;
        row.width = "100%";
        row.content = `${selected ? ">" : " "} ${section.label}`;
        row.fg = selected ? ACTIVE_FG : IDLE_FG;
        row.bg = selected ? ACTIVE_BG : RAIL;
      });
      const section = sectionAt(nav.index).id;
      const visibleRows = currentRows();
      const contentWidth = Math.max(10, (stacked ? width : width - SIDEBAR_COLUMNS - 2) - 4);
      // Keep the selected row visible even if coverage and catch-up contain many
      // lines. The `i` panel exposes the complete, scrollable source details.
      const fullSummary = section === "attention" && attention.status === "ready" ? attentionSummaryLines(attention, perspective) : [];
      const availableSummaryLines = Math.max(3, height - (stacked ? 19 : 10));
      const physicalLines = (lines: string[]): number => lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(Array.from(safe(line)).length / contentWidth)), 0);
      let summary = physicalLines(fullSummary) <= availableSummaryLines ? fullSummary : attentionCompactSummaryLines(attention, perspective);
      if (physicalLines(summary) > availableSummaryLines && attention.result) {
        const result = attention.result, catchUp = result.catchUp;
        const caveat = result.coverage.perSource.some((entry) => entry.truncated || entry.skipped !== undefined) || result.nextCursor;
        const changes = catchUp.status === "not_requested" ? "first read" : `${catchUp.status}: ${catchUp.changedCount} changed, ${catchUp.examined} examined`;
        summary = [
          ...(cuesFor(result, perspective).length ? [] : [result.cues.length ? "No cues in this view; p switches." : "No recorded cue matches these rules."]),
          `Coverage: ${result.coverage.completeUnderRules ? "complete under rules" : "incomplete"}${caveat ? "; i for source details" : ""}.`,
          `Catch-up: ${changes}${catchUp.tipAdvanced ? "; tip advanced" : ""}${catchUp.affectedTruncated ? "; affected list truncated" : ""}.`,
        ];
      }
      const compactSummary = summary.flatMap((line) => {
        const chars = Array.from(safe(line)); const chunks: string[] = [];
        while (chars.length) chunks.push(chars.splice(0, contentWidth).join(""));
        return chunks.length ? chunks : [""];
      });
      if (attention.result?.nextCursor && !compactSummary.includes("More cues exist beyond this page.")) {
        compactSummary.push("More cues exist beyond this page.");
      }
      const heading = perspectiveHeading(attention, perspective) ?? "";
      const qualifier = " (more pages or incomplete coverage)";
      const headingLines = heading.includes(qualifier)
        ? [`${attentionRefreshing ? "STALE · refreshing · " : ""}${perspective === "mine" ? "Needs you" : "Needs attention"}`, `${heading.slice(heading.lastIndexOf(" ", heading.indexOf(qualifier) - 1) + 1)} · i details`]
        : [`${attentionRefreshing ? "STALE · refreshing · " : ""}${heading} · i details`];
      const capacity = Math.max(1, height - (stacked ? 16 : 7) - (section === "attention" ? headingLines.length + compactSummary.length + (filter ? 2 : 0) : section === "overview" ? 2 + (attentionRefreshing || attention.status === "loading" ? 1 : 0) + (attention.status === "ready" && attention.result ? 1 + (attention.result.nextCursor ? 1 : 0) : 0) + (attention.status === "error" || attention.status === "cursor_error" ? 2 : 0) + (filter ? 1 : 0) : 2));
      const start = Math.max(0, Math.min(rowIndex - capacity + 1, visibleRows.length - capacity));
      const displayRows = visibleRows.slice(start, start + capacity).map((r, i) => {
        const limit = contentWidth - 2;
        const chars = Array.from(r.text);
        const text = chars.length > limit ? `${chars.slice(0, Math.max(0, limit - 1)).join("")}…` : r.text;
        return `${i + start === rowIndex && nav.focus === "content" ? ">" : " "} ${text}`;
      });
      const wrappedDetail = detail?.flatMap((line) => {
        const text = safe(line); const chunks: string[] = [];
        for (let i = 0; i < text.length; i += contentWidth) chunks.push(text.slice(i, i + contentWidth));
        return chunks.length ? chunks : [""];
      });
      const detailCapacity = Math.max(1, height - (stacked ? 16 : 7));
      if (wrappedDetail) detailScroll = Math.min(detailScroll, Math.max(0, wrappedDetail.length - detailCapacity));
      const pickerCapacity = Math.max(1, height - (stacked ? 17 : 8));
      const pickerStart = Math.max(0, Math.min(pickerIndex - pickerCapacity + 1, workspaces.length - pickerCapacity));
      const lines = picker
        ? ["Workspaces", ...workspaces.slice(pickerStart, pickerStart + pickerCapacity).map((w, i) => `${i + pickerStart === pickerIndex ? ">" : " "} ${w.name} · ${w.id}`)]
        : wrappedDetail ? wrappedDetail.slice(detailScroll, detailScroll + detailCapacity) : (phase.kind === "ready" && section === "attention"
          ? attention.status === "ready" ? [...headingLines, ...compactSummary, ...(filter ? [`Filter: ${filter}`, ...(visibleRows.length ? [] : ["No shown row matches this filter."])] : []), ...displayRows]
            : attention.status === "error" || attention.status === "cursor_error" ? [...attentionLines(attention), fallbackAttentionCoverage(phase.snapshot.context), ...(displayRows.length ? displayRows : [filter ? "No shown row matches this filter." : "No rows in the older list."])]
            : attentionLines(attention)
          : phase.kind === "ready"
          ? [peopleOwner && section === "people" ? `Agents owned by ${peopleOwner}` : sectionAt(nav.index).label, ...(section === "overview" ? ["Select a section to explore · i workspace details"] : [`${stalePages.has(section) ? "STALE · " : ""}${coverage(section, phase.snapshot.context, pages)}`]), ...(section === "overview" && attentionRefreshing ? ["Attention: STALE · refreshing."] : section === "overview" && attention.status === "loading" ? ["Attention: loading…"] : []), ...(section === "overview" && attention.status === "ready" && attention.result ? [`Attention coverage: ${attention.result.coverage.completeUnderRules ? "complete under the rules" : "incomplete"}.`, ...(attention.result.nextCursor ? ["More attention cues exist beyond this page."] : [])] : []), ...(section === "overview" && (attention.status === "error" || attention.status === "cursor_error") ? ["Attention read failed. Open Needs you for the older list.", fallbackAttentionCoverage(phase.snapshot.context)] : []), ...(filter ? [`Filter: ${filter}`] : []), ...(visibleRows.length ? displayRows : [filter ? "No shown row matches this filter." : sectionEmptyMessage(section, pages)])]
          : undefined);
      clickableRows = [];
      if (!picker && !detail && lines && displayRows.length && phase.kind === "ready") {
        const first = lines.indexOf(displayRows[0]!);
        // Do not guess at mouse hit positions if the terminal will wrap a heading.
        const header = [phase.snapshot.name, phase.snapshot.goal.length > 70 ? `${phase.snapshot.goal.slice(0, 69)}…` : phase.snapshot.goal];
        const singleWidth = (line: string): boolean => /^[\x20-\xff]*$/.test(line) && line.length <= contentWidth;
        if (first >= 0 && header.every(singleWidth) && lines.slice(0, first).every(singleWidth)) {
          clickableRows = displayRows.map((_, i) => ({ line: 2 + first + i, index: start + i }));
        }
      }
      content.content = contentText(phase, nav, lines);
      status.content = filtering ? `Filter: ${filter}_` : nav.status.length > 0 ? nav.status : " ";
      footer.content = picker ? "j/k workspace  enter select  esc back" : phase.kind !== "ready" && !detail ? "r check again  w workspaces  q quit" : detail ? "j/k scroll  n/b history page  enter source  h back  q quit" : nav.focus === "content" ? "j/k select  enter detail  p mine/team  v history  i info  n/b page  / filter  h back  q quit" : phase.kind !== "ready" ? "r check again  w workspaces  q quit" : "j/k section  enter open  r refresh  w workspace  q quit";
      ui.requestRender();
    };

    content.onMouseDown = (event): void => {
      if (picker || detail || filtering || phase.kind !== "ready") return;
      const hit = clickableRows.find((row) => row.line === event.y - content.y);
      if (hit) { rowIndex = hit.index; nav = {...nav, focus: "content", status: ""}; paint(); }
    };

    const apply = (action: NavAction): void => {
      nav = reduceNav(nav, action);
      paint();
    };

    const denied = (error: string): boolean => error === "Unauthorized" || error === "ParticipantRequired";
    const refuse = (message = UNAUTHORIZED_MESSAGE): void => { generation++; authorityEpoch++; pickerGeneration++; detailGeneration++; pages = {}; cursors = {}; stalePages.clear(); detail = undefined; detailCue = undefined; detailOwner = undefined; peopleOwner = undefined; previousPeoplePage = undefined; previousPeopleCursors = []; previousPeopleStale = false; attentionRefreshing = false; perspective = "mine"; picker = false; workspaces = []; attention = initialAttention(workspaceId); phase = {kind: "error", message}; paint(); };
    const openPicker = async (silent = false): Promise<boolean> => {
      if (baseUrl.length === 0 || token.length === 0) return false;
      const epoch = authorityEpoch, request = ++pickerGeneration, id = workspaceId;
      if (!silent && phase.kind !== "ready") { nav = {...nav, status: "Checking for workspaces…"}; paint(); }
      try {
        const result = await postCall<unknown>(baseUrl, token, "list_workspaces", {});
        if (!result.ok && denied(result.error) && epoch === authorityEpoch && id === workspaceId && !stopping) { refuse(id ? UNAUTHORIZED_MESSAGE : NOTHING_LOADED_DENIED); return false; }
        if (epoch !== authorityEpoch || request !== pickerGeneration || id !== workspaceId || stopping) return false;
        if (!result.ok) { if (denied(result.error)) refuse(id ? UNAUTHORIZED_MESSAGE : NOTHING_LOADED_DENIED); else if (phase.kind !== "ready") { phase = {kind:"error", message: LIST_FAILED}; paint(); } else { nav = {...nav, status: "Workspace list unavailable."}; paint(); } return false; }
        workspaces = array(result.result).map((item) => ({id: safe(object(item).id), name: safe(object(item).name)})).filter((w) => w.id);
        pickerIndex = Math.max(0, workspaces.findIndex((w) => w.id === workspaceId)); picker = workspaces.length > 0 && (!silent || workspaces.length === 1);
        if (silent && workspaces.length > 1 && phase.kind !== "ready") nav = {...nav, status: "Workspaces available. Press w to choose."};
        if (!picker && phase.kind !== "ready") { phase = {kind: "awaiting"}; if (!silent) nav = {...nav, status: `Checked ${new Date().toLocaleTimeString()}: no workspace for this account yet.`}; }
        if (!picker && phase.kind === "ready") nav = {...nav, status: "No workspaces available."};
        paint(); return true;
      } catch { if (epoch === authorityEpoch && request === pickerGeneration && id === workspaceId && !stopping) { if (phase.kind === "ready") { nav = {...nav, status: "Workspace list unavailable."}; paint(); } else { phase = {kind: "error", message: LIST_FAILED}; paint(); } } return false; }
    };
    const loadSection = async (cursor?: string, replace = false, nextStack?: string[]): Promise<void> => {
      if (phase.kind !== "ready") return;
      const section = sectionAt(nav.index).id;
      const method = section === "work" ? "list_tasks" : section === "people" ? "list_workspace_participants" : section === "changes" ? "get_activity" : undefined;
      if (!method || (pages[section] && !replace && !stalePages.has(section))) return;
      const id = workspaceId, run = generation;
      const request = (pageGeneration[section] ?? 0) + 1; pageGeneration = {...pageGeneration, [section]: request};
      try {
        const effectiveCursor = replace ? cursor : (cursor ?? cursors[section]?.at(-1));
        const owner = section === "people" ? peopleOwner : undefined;
        const params: Record<string, unknown> = owner ? ownedAgentsParams(id, owner, effectiveCursor) : {workspaceId: id, limit: 50};
        if (effectiveCursor && !owner) params[section === "changes" ? "before" : "cursor"] = effectiveCursor;
        const response = await postCall<unknown>(baseUrl, token, method, params);
        if (!response.ok && denied(response.error) && workspaceId === id && !stopping) { refuse(); return; }
        if (response.ok && workspaceId === id && !stopping && !(section === "work" ? taskPageMatchesWorkspace(response.result, id) : section === "changes" ? activityMatchesWorkspace(response.result, id) : pageMatchesWorkspace(response.result, id, true))) { refuse("Workspace response did not match; workspace data cleared."); return; }
        if (run !== generation || workspaceId !== id || stopping || pageGeneration[section] !== request || (section === "people" && owner !== peopleOwner)) return;
        if (!response.ok) {
          if (denied(response.error)) refuse();
          else if (response.error === "ValidationError" && effectiveCursor !== undefined) { cursors = {...cursors, [section]: []}; nav = {...nav, status: `${sectionAt(nav.index).label} cursor was rejected. Reloading the first page.`}; paint(); void loadSection(undefined, true, []); }
          else { nav = {...nav, status: `${sectionAt(nav.index).label} could not be loaded.`}; paint(); }
          return;
        }
        if (owner && !validateOwnedAgentsPage(response.result, id, owner)) { nav = {...nav, status: "Owned-agent response did not match the requested workspace and owner."}; paint(); return; }
        const key = selectedKey(); pages = {...pages, [section]: response.result}; stalePages.delete(section);
        if (nextStack) { cursors = {...cursors, [section]: nextStack}; rowIndex = 0; } else reconcile(key);
        paint();
      } catch { if (run === generation) { nav = {...nav, status: "Section could not be loaded."}; paint(); } }
    };
    const openDetail = async (row: SectionRow): Promise<void> => {
      if (row.kind === "participant") {
        const participant = array(object(pages.people).items).find((item) => safe(object(object(item).actor).actorId) === row.id);
        detail = participantFacts(participant); detailOwner = object(object(participant).actor).actorType === "human" ? row.id : undefined; detailScroll = 0; paint(); return;
      }
      if (!(row.kind === "task" || row.kind === "decision" || row.kind === "finding" || row.kind === "artifact" || row.kind === "action_proposal")) { detail = [row.text, "No detail view available for this record."]; paint(); return; }
      const method = `get_${row.kind}` as "get_task" | "get_decision" | "get_finding" | "get_artifact" | "get_action_proposal";
      const id = workspaceId, run = generation, selected = ++detailGeneration;
      try {
        const response = await postCall<unknown>(baseUrl, token, method, {workspaceId: id, [row.kind === "action_proposal" ? "proposalId" : `${row.kind}Id`]: row.id});
        if (!response.ok && denied(response.error) && workspaceId === id && !stopping) { refuse(); return; }
        const value = response.ok && row.kind === "action_proposal" ? object(response.result).proposal : response.ok ? response.result : undefined;
        if (response.ok && workspaceId === id && !stopping && !detailMatchesSelection(value, id, row.id)) { refuse("Record response did not match; workspace data cleared."); return; }
        if (run !== generation || workspaceId !== id || stopping || selected !== detailGeneration) return;
        if (!response.ok) { if (denied(response.error)) refuse(); else { detail = ["Record could not be loaded."]; paint(); } return; }
        detailCue = undefined; detailScroll = 0;
        if (row.kind === "action_proposal") {
          const view = object(response.result);
          const proposal = object(view.proposal);
          const receipt = object(view.latestReceipt);
          if (receipt.workspaceId !== undefined && safe(receipt.workspaceId) !== id) { refuse("Record response did not match; workspace data cleared."); return; }
          detail = [`id: ${safe(proposal.id) || row.id}`, `status: ${safe(proposal.status) || "unrecorded"}`, `task: ${safe(proposal.taskId) || "no recorded task"}`, view.latestReceipt === undefined ? "no recorded receipt" : `receipt: ${safe(receipt.id) || "unrecorded"} · ${safe(receipt.outcome) || "outcome unrecorded"} · ${safe(receipt.recordedAt) || "time unrecorded"}`];
        } else detail = recordDetailLines(response.result, row.kind);
        paint();
      } catch { if (run === generation && selected === detailGeneration) { detail = ["Record could not be loaded."]; paint(); } }
    };
    const loadHistory = async (row: SectionRow, cursor?: string, nextStack: string[] = []): Promise<void> => {
      if (!["task", "decision", "finding", "artifact"].includes(row.kind)) { nav = {...nav, status: "History is unavailable for this row."}; paint(); return; }
      const id = workspaceId, run = generation, request = ++detailGeneration;
      const params: Record<string, unknown> = { workspaceId: id, objectType: row.kind, objectId: row.id, limit: 50 };
      if (cursor) params.cursor = cursor;
      try {
        const response = await postCall<unknown>(baseUrl, token, "get_record_history", params);
        if (!response.ok && denied(response.error) && workspaceId === id && !stopping) { refuse(); return; }
        if (response.ok && workspaceId === id && !stopping && !historyMatchesRequest(response.result, id, row.kind, row.id)) { refuse("History response did not match; workspace data cleared."); return; }
        if (run !== generation || workspaceId !== id || stopping || request !== detailGeneration) return;
        if (!response.ok) { nav = {...nav, status: "History could not be loaded."}; paint(); return; }
        const page = object(response.result); const items = array(page.items);
        historyRow = row; historyStack = nextStack; historyNext = safe(page.nextCursor) || undefined;
        const total = typeof page.total === "number" ? page.total : undefined;
        const more = page.truncated === true || historyNext !== undefined || (total !== undefined && total > items.length);
        detailCue = undefined; detailScroll = 0;
        detail = [`History for ${row.kind} ${row.id}`, `returned ${items.length}${total === undefined ? "" : ` of ${total}`}${more ? "; more changes exist" : ""}`, ...items.map((item) => contributionText(item)), ...(items.length === 0 && (total === undefined || total === 0) ? ["No recorded history."] : []), ...(items.length === 0 && total !== undefined && total > 0 ? ["This page has no rows; more recorded changes exist."] : [])];
        paint();
      } catch { if (run === generation && request === detailGeneration) { nav = {...nav, status: "History could not be loaded."}; paint(); } }
    };
    const loadWorkspace = async (): Promise<void> => {
      const id = workspaceId, run = ++generation;
      if (phase.kind === "ready") { attentionRefreshing = true; stalePages = new Set(Object.keys(pages)); if (peopleOwner && previousPeoplePage !== undefined) previousPeopleStale = true; paint(); }
      try {
        const response = await postCall<unknown>(baseUrl, token, "get_workspace_context", {workspaceId: id, participants: "omit"});
        if (!response.ok && denied(response.error) && workspaceId === id && !stopping) { refuse(); return; }
        if (run !== generation || id !== workspaceId || stopping) return;
        if (!response.ok) {
          if (denied(response.error)) { refuse(); return; }
          if (phase.kind !== "ready") { phase = {kind: "error", message: "Workspace could not be loaded. Press r to retry."}; paint(); return; }
          nav = {...nav, status: "Workspace could not be refreshed. Showing the last result."};
        } else {
          const snapshot = readSnapshot(response.result);
          if ("message" in snapshot || snapshot.id !== id) { refuse(); return; }
          const key = selectedKey(); phase = {kind:"ready", snapshot}; stalePages = new Set(Object.keys(pages)); reconcile(key);
          if (detail) nav = {...nav, status: "Open record details may be stale; reopen to refresh."};
        }
        paint();
        const next = await readAttention(attention.workspaceId === id ? attention : initialAttention(id), (method, params) => postCall<unknown>(baseUrl, token, method, params));
        if (next.status === "denied" && id === workspaceId && !stopping) { refuse(); return; }
        if (run !== generation || id !== workspaceId || stopping) return;
        const attentionKey = selectedKey(); attention = next; attentionRefreshing = false; reconcile(attentionKey);
        if (next.status === "denied") { refuse(); return; }
        paint(); const section = sectionAt(nav.index).id; void loadSection(cursors[section]?.at(-1), true);
      } catch { if (run === generation && !stopping) { attentionRefreshing = false; phase = {kind:"error", message:"Workspace could not be loaded. Press r to retry."}; paint(); } }
    };

    // An empty installation can receive a workspace while this screen is open.
    // Discover it using the actor's authorized workspace list, never a made-up id.
    const discoverWorkspace = async (silent = false): Promise<void> => {
      if (!await openPicker(silent) || stopping || workspaceId || workspaces.length !== 1) return;
      const selected = workspaces[0];
      if (!selected) return;
      workspaceId = selected.id; authorityEpoch++; pickerGeneration++;
      picker = false; perspective = "mine"; attention = initialAttention(workspaceId); phase = {kind: "loading"};
      paint(); await loadWorkspace();
    };

    rows.forEach((row, index) => {
      row.onMouseDown = (): void => {
        if (stopping || picker || detail || filtering || phase.kind !== "ready") return;
        rowIndex = 0; filter = ""; nav = {index, focus: "sidebar", status: ""}; paint(); void loadSection();
      };
    });

    ui.on("resize", () => {
      paint();
    });
    ui.keyInput.on("keypress", (key) => {
      if (key.eventType === "release") return;
      if (key.name === "c" && key.ctrl) {
        void shutdown(0);
        return;
      }
      if (filtering) {
        if (key.name === "return" && filter === "update") {
          // Leave through destroy() so the terminal is restored; the launcher
          // runs the update after this process exits.
          filtering = false; filter = ""; rowIndex = 0;
          if (timer) clearInterval(timer);
          void shutdown(UPDATE_EXIT_CODE);
          return;
        }
        else if (key.name === "return" || key.name === "escape") filtering = false;
        else if (key.name === "backspace") filter = filter.slice(0, -1);
        else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) filter += key.sequence;
        rowIndex = 0; paint(); return;
      }
      if (key.name === "q" && !key.ctrl && !key.meta) {
        if (timer) clearInterval(timer);
        void shutdown(0);
        return;
      }
      if (picker) {
        if (key.name === "escape" || key.name === "h") { picker = false; pickerGeneration++; }
        else if (key.name === "j" || key.name === "down") pickerIndex = Math.min(workspaces.length - 1, pickerIndex + 1);
        else if (key.name === "k" || key.name === "up") pickerIndex = Math.max(0, pickerIndex - 1);
        else if (key.name === "return" && workspaces[pickerIndex]) { workspaceId = workspaces[pickerIndex]!.id; authorityEpoch++; pickerGeneration++; attention = initialAttention(workspaceId); attentionRefreshing = false; perspective = "mine"; picker = false; pages = {}; cursors = {}; stalePages.clear(); peopleOwner = undefined; detailOwner = undefined; previousPeoplePage = undefined; previousPeopleCursors = []; previousPeopleStale = false; phase = {kind:"loading"}; detail = undefined; detailGeneration++; filter = ""; rowIndex = 0; void loadWorkspace(); }
        paint(); return;
      }
      if (key.name === "p" && !key.ctrl && !key.meta && !detail && phase.kind === "ready" && sectionAt(nav.index).id === "attention") {
        perspective = perspective === "mine" ? "team" : "mine"; rowIndex = 0; detail = undefined; detailCue = undefined; detailGeneration++;
        nav = {...nav, status: perspective === "team" ? "Showing team attention" : "Showing needs you"}; paint(); return;
      }
      if (key.name === "w") { void openPicker(); return; }
      if (key.name === "r") { if (workspaceId) void loadWorkspace(); else void discoverWorkspace(); return; }
      if (key.name === "i" && nav.focus === "sidebar" && !detail && phase.kind === "ready") {
        const section = sectionAt(nav.index).id;
        if (section === "overview" || section === "attention") {
          detailCue = undefined; detailScroll = 0;
          detail = section === "overview" ? ["Workspace details", `Name: ${phase.snapshot.name}`, `ID: ${phase.snapshot.id}`, `Goal: ${phase.snapshot.goal}`] : attentionDetailLines(attention, perspective);
          nav = {...nav, focus: "content"}; paint(); return;
        }
      }
      if (key.sequence === "?" || key.name === "m") {
        detailCue = undefined; detailOwner = undefined; detailScroll = 0;
        detail = ["Campfire navigation", "j/k or arrow keys: move", "Enter: open a section, record, or cue source", "h / Escape: go back", "w: choose a workspace", "r: refresh", "/: filter current section", "/update + Enter: quit and run campfire update", "n/b: next/previous page", "v: record history", "i: attention coverage and catch-up", "p: toggle mine/team attention", "q: quit"];
        nav = {...nav, focus: "content"}; paint(); return;
      }
      if (nav.focus === "sidebar") {
        detailGeneration++;
        if (key.name === "j" || key.name === "down") { rowIndex = 0; filter = ""; apply("down"); void loadSection(); }
        else if (key.name === "k" || key.name === "up") { rowIndex = 0; filter = ""; apply("up"); void loadSection(); }
        else if (key.name === "tab" && !key.shift) { rowIndex = 0; filter = ""; apply("tab"); void loadSection(); }
        else if (key.name === "return" || key.name === "l" || key.name === "right") { if (phase.kind === "ready") apply("open"); }
        return;
      }
      if (key.name === "h" || key.name === "left" || key.name === "escape") { detailGeneration++; if (detail) { detail = undefined; detailCue = undefined; detailOwner = undefined; historyRow = undefined; historyStack = []; historyNext = undefined; detailScroll = 0; paint(); } else if (peopleOwner && sectionAt(nav.index).id === "people") { const stack = previousPeopleCursors; const stale = previousPeopleStale; pages = {...pages, people: previousPeoplePage}; cursors = {...cursors, people: stack}; peopleOwner = undefined; previousPeoplePage = undefined; previousPeopleCursors = []; previousPeopleStale = false; rowIndex = 0; if (stale) { stalePages.add("people"); void loadSection(stack.at(-1), true, stack); } paint(); } else if (key.name === "escape" && filter) { filter = ""; rowIndex = 0; paint(); } else apply("back"); }
      else if (key.sequence === "/") { filtering = true; paint(); }
      else if (key.name === "j" || key.name === "down" || key.name === "k" || key.name === "up") {
        detailGeneration++;
        if (detail) { detailScroll = Math.max(0, Math.min(detail.join("").length, detailScroll + (key.name === "j" || key.name === "down" ? 1 : -1))); paint(); return; }
        const current = currentRows();
        rowIndex = Math.max(0, Math.min(current.length - 1, rowIndex + (key.name === "j" || key.name === "down" ? 1 : -1))); paint();
      } else if (key.name === "n" || key.name === "b") {
        if (detail && historyRow) {
          if (key.name === "n" && historyNext) void loadHistory(historyRow, historyNext, [...historyStack, historyNext]);
          else if (key.name === "b" && historyStack.length) { const prev = historyStack.slice(0, -1); void loadHistory(historyRow, prev.at(-1), prev); }
          return;
        }
        const section = sectionAt(nav.index).id; const page = object(pages[section]);
        const current = cursors[section] ?? [];
        if (key.name === "n") {
          const next = safe(section === "changes" ? page.nextBefore : page.nextCursor);
          if (next) { rowIndex = 0; void loadSection(next, true, [...current, next]); }
          else { nav = {...nav, status: "No next page."}; paint(); }
        } else if (current.length) { const previous = current.slice(0, -1); rowIndex = 0; void loadSection(previous.at(-1), true, previous); }
        else { nav = {...nav, status: "No previous page."}; paint(); }
      } else if (key.name === "return") {
        if (detail) {
          if (detailOwner && sectionAt(nav.index).id === "people") { previousPeoplePage = pages.people; previousPeopleCursors = cursors.people ?? []; previousPeopleStale = stalePages.has("people"); peopleOwner = detailOwner; detailOwner = undefined; detail = undefined; pages = {...pages, people: undefined}; cursors = {...cursors, people: []}; rowIndex = 0; void loadSection(undefined, true, []); paint(); }
          else if (detailCue) void openDetail(detailCue);
          return;
        }
        const current = currentRows();
        const selected = current[rowIndex];
        if (selected?.kind === "section") { const index = SECTIONS.findIndex((section) => section.id === selected.id); if (index >= 0) { nav = {...nav, index, focus: "content", status: ""}; rowIndex = 0; filter = ""; void loadSection(); paint(); } }
        else if (selected?.kind === "contribution" && phase.kind === "ready") { const event = array(object(pages.changes).items).find((item) => safe(object(item).id) === selected.id); if (event) { detailCue = undefined; detailScroll = 0; detail = activityDetails(event, [...array(object(phase.snapshot.context).participants), ...array(object(pages.people).items)]); paint(); } }
        else if (selected?.cueId) { const cue = attention.result?.cues.find((c) => c.id === selected.cueId); if (cue) {detailCue = selected; detailScroll = 0; detail = attentionCueLines(cue); paint();} }
        else if (selected) void openDetail(selected);
      } else if (key.name === "i" && sectionAt(nav.index).id === "overview" && phase.kind === "ready") {
        detailCue = undefined; detailScroll = 0; detail = ["Workspace details", `Name: ${phase.snapshot.name}`, `ID: ${phase.snapshot.id}`, `Goal: ${phase.snapshot.goal}`]; paint();
      } else if (key.name === "i" && sectionAt(nav.index).id === "attention") {
        detailCue = undefined; detailScroll = 0; detail = attentionDetailLines(attention, perspective); paint();
      } else if (key.name === "v" && !detail) {
        const row = currentRows()[rowIndex]; if (row) void loadHistory(row);
      }
    });

    paint();
    ui.start();

    if (baseUrl.length === 0 || token.length === 0) {
      phase = { kind: "error", message: "CAMPFIRE_URL and CAMPFIRE_TOKEN are required." };
      paint();
      return;
    }

    if (!workspaceId) {
      await discoverWorkspace();
    } else {
      await loadWorkspace();
    }
    timer = setInterval(() => { if (!picker && !filtering && !stopping) { if (workspaceId) void loadWorkspace(); else void discoverWorkspace(true); } }, 15_000);
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenTUI failed";
    console.error(message);
    await shutdown(1);
  }
}

await main();
