"use strict";

const STORAGE_KEY = "campfire.viewer.workspaceId";
const CURSOR_PREFIX = "campfire.viewer.lastSeen.";
// SWH-001: local UI preference only. Never workspace content.
const PERSPECTIVE_KEY = "campfire.viewer.perspective";
const POLL_MS = 2000;
const LIMIT = 50;

const FIRST_VISIT_MESSAGE = "First visit — new activity will appear here.";
const NO_NEW_MESSAGE = "No new activity since you were here.";

const els = {
  whoami: document.getElementById("whoami"),
  error: document.getElementById("error"),
  workspace: document.getElementById("workspace"),
  generatedViewLink: document.getElementById("generated-view-link"),
  perspectiveMine: document.getElementById("perspective-mine"),
  perspectiveTeam: document.getElementById("perspective-team"),
  orientation: document.getElementById("orientation"),
  currentWorkTitle: document.getElementById("current-work-title"),
  mast: document.getElementById("mast"),
  people: document.getElementById("people"),
  goal: document.getElementById("goal"),
  alignment: document.getElementById("alignment"),
  nextAction: document.getElementById("next-action"),
  needsYou: document.getElementById("needs-you"),
  needsAttention: document.getElementById("needs-attention"),
  currentWork: document.getElementById("current-work"),
  sources: document.getElementById("sources"),
  since: document.getElementById("since"),
  stream: document.getElementById("stream"),
  hint: document.getElementById("hint"),
  recordNotes: document.getElementById("record-notes"),
};

const state = {
  whoami: null,
  workspaces: [],
  workspaceId: null,
  context: null,
  view: null,
  activity: null,
  perspective: readStoredPerspective(),
  // "Since You Were Here" is a client-held cursor. sincePending is true until
  // the first context fetch resolves for the current workspace; sinceView is
  // the frozen snapshot rendered from that fetch.
  sincePending: true,
  sinceRequested: false,
  sinceView: null,
  selectedId: null,
  expandedId: null,
  foldOpen: new Set(),
  olderItems: [],
  olderBefore: null,
  olderExhausted: false,
  loadingOlder: false,
  error: null,
};

let gen = 0;
let nameMap = Object.create(null);
let streamPinned = true;
let selectKey = "";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso ?? "");
  return [String(date.getHours()).padStart(2, "0"), String(date.getMinutes()).padStart(2, "0")].join(":");
}

function payloadOf(item) {
  return item && item.payload && typeof item.payload === "object" ? item.payload : {};
}

function strField(...values) {
  for (const value of values) {
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// --- SWH-001 one home, two perspectives -------------------------------------
// Both perspectives project the same authorized get_workspace_context read.
// They are navigation over already-authorized records, not privacy modes.

function perspectiveLabel(value) {
  return value === "team" ? "Team work" : "My work";
}

function readStoredPerspective() {
  try {
    if (typeof localStorage !== "undefined" && localStorage) {
      return localStorage.getItem(PERSPECTIVE_KEY) === "team" ? "team" : "mine";
    }
  } catch (err) {
    // A UI preference is a convenience; storage may be unavailable.
  }
  return "mine";
}

function persistPerspective(value) {
  try {
    if (typeof localStorage !== "undefined" && localStorage) {
      localStorage.setItem(PERSPECTIVE_KEY, value);
    }
  } catch (err) {
    // Never fail a render over a preference.
  }
}

function renderPerspective() {
  const value = state.perspective === "team" ? "team" : "mine";
  if (els.perspectiveMine) {
    els.perspectiveMine.setAttribute("aria-pressed", value === "mine" ? "true" : "false");
  }
  if (els.perspectiveTeam) {
    els.perspectiveTeam.setAttribute("aria-pressed", value === "team" ? "true" : "false");
  }
  if (els.orientation) els.orientation.setAttribute("data-perspective", value);
  if (els.currentWorkTitle) els.currentWorkTitle.textContent = perspectiveLabel(value);
}

function setPerspective(value) {
  state.perspective = value === "team" ? "team" : "mine";
  persistPerspective(state.perspective);
  renderPerspective();
  renderOrientation();
}

// The caller is the authenticated whoami actor. A role never comes from it.
// The whoami defaults to current state so the render pipeline is unchanged;
// the parameter is the seam the wiring tests drive directly.
function callerRef(whoami = state.whoami) {
  const actor = whoami && whoami.actor;
  if (!actor || typeof actor.actorId !== "string" || !actor.actorId) return null;
  const actorType = strField(actor.actorType);
  if (actorType !== "human" && actorType !== "agent") return null;
  return { actorId: actor.actorId, actorType };
}

// Ownership is only the participant's recorded humanOwnerId. An agent with no
// owner, or an owner who is not a participant, stays ownership-unknown; it is
// never silently attributed to the current caller.
function ownedAgentIds(participants, who) {
  if (!who || who.actorType !== "human") return [];
  const ids = [];
  for (const participant of asArray(participants)) {
    if (!isRecord(participant) || !isRecord(participant.actor)) continue;
    if (participant.actor.actorType !== "agent") continue;
    if (strField(participant.humanOwnerId) !== who.actorId) continue;
    const id = strField(participant.actor.actorId);
    if (id && ids.indexOf(id) === -1) ids.push(id);
  }
  return ids;
}

// Assignment is the task's stored assignee, matched on id AND type. A task's
// createdBy is provenance, never assignment.
function taskAssignedToActor(task, ref) {
  if (!isRecord(task) || !ref) return false;
  const assignee = isRecord(task.assignee) ? task.assignee : null;
  if (!assignee) return false;
  return assignee.actorId === ref.actorId && assignee.actorType === ref.actorType;
}

// --- Sprint 008 orientation projection (read-only) --------------------------
// The service is the single source of authorization-aware attention. These
// helpers only normalize the service-projected WorkspaceContext; the Viewer
// never recomputes who may act. Every field is read defensively so an older
// context (without these sections) still renders.

function normalizeAttentionItem(item) {
  return {
    kind: strField(item.kind),
    id: strField(item.id),
    summary: strField(item.summary, item.title),
    status: strField(item.status),
    reason: strField(item.reason),
    assignee: isRecord(item.assignee) ? item.assignee : null,
    // ATT-001: an accepted-decision review cue carries the cited non-current
    // finding ids. Dropping them here would hide the basis of the cue.
    needsReviewFindingIds: reviewFindingIds(item),
  };
}

function deriveAttentionList(context, key) {
  return asArray(context && context[key])
    .filter((item) => isRecord(item))
    .map(normalizeAttentionItem);
}

function deriveNeedsYou(context) {
  return deriveAttentionList(context, "needsYou");
}

function deriveNeedsAttention(context) {
  return deriveAttentionList(context, "needsAttention");
}

function deriveCurrentWork(context) {
  const work = isRecord(context && context.currentWork) ? context.currentWork : {};
  return {
    inProgressTasks: asArray(work.inProgressTasks),
    blockedTasks: asArray(work.blockedTasks),
    acceptedDecisions: asArray(work.acceptedDecisions),
  };
}

function deriveSince(context) {
  const since = isRecord(context && context.since) ? context.since : null;
  if (!since) return { present: false, items: [], truncated: false, cursor: "" };
  return {
    present: true,
    items: asArray(since.items),
    truncated: since.truncated === true,
    cursor: strField(since.cursor),
  };
}

// hasCursor reflects a stored client cursor (a return visit), not the context.
function deriveSinceView(context, hasCursor) {
  if (!hasCursor) return { state: "first-visit", items: [], truncated: false };
  const since = deriveSince(context);
  if (!since.present || !since.items.length) {
    return { state: "empty", items: [], truncated: false };
  }
  return { state: "items", items: since.items, truncated: since.truncated };
}

function deriveSuggestedNextAction(context) {
  const action = isRecord(context && context.suggestedNextAction)
    ? context.suggestedNextAction
    : null;
  if (!action) return null;
  const kind = strField(action.kind);
  if (!kind || kind === "none") return null;
  return {
    kind,
    id: strField(action.id),
    summary: strField(action.summary),
    reason: strField(action.reason),
  };
}

// Sprint 009 recorded alignment boundary. Status comes only from the service
// projection. The Viewer never recomputes it from decisions.
const ALIGNMENT_BOUNDARY_SENTENCE =
  "Records what the team has proposed, accepted, or left unspecified. Not permission to execute.";

function stringIds(value) {
  return asArray(value).filter((id) => typeof id === "string");
}

function deriveAlignment(context) {
  const alignment = isRecord(context) && isRecord(context.alignment) ? context.alignment : null;
  if (!alignment) return null;
  const status = alignment.status;
  if (status !== "open" && status !== "established" && status !== "unspecified") {
    return null;
  }
  return {
    status,
    proposedDecisionIds: stringIds(alignment.proposedDecisionIds),
    acceptedDecisionIds: stringIds(alignment.acceptedDecisionIds),
    unresolvedBlockedTaskIds: stringIds(alignment.unresolvedBlockedTaskIds),
  };
}

function summaryForDecisionId(decisions, id) {
  for (const decision of asArray(decisions)) {
    if (isRecord(decision) && decision.id === id) return strField(decision.summary);
  }
  return "";
}

function titleForBlockedTaskId(context, id) {
  const work = isRecord(context) && isRecord(context.currentWork) ? context.currentWork : null;
  if (work) {
    for (const task of asArray(work.blockedTasks)) {
      if (!isRecord(task) || task.id !== id) continue;
      const title = strField(task.title);
      if (title) return title;
    }
  }
  for (const task of asArray(isRecord(context) ? context.openTasks : undefined)) {
    if (!isRecord(task) || task.id !== id) continue;
    if (strField(task.status) !== "blocked") continue;
    const title = strField(task.title);
    if (title) return title;
  }
  return "";
}

function alignmentItemHtml(id, detail) {
  if (detail) {
    return `<li class="oitem"><span class="ometa">${esc(id)}</span><span class="osentence">${esc(detail)}</span></li>`;
  }
  return `<li class="oitem"><span class="osentence">${esc(id)}</span></li>`;
}

// Contributions are chronological, so the newest id is the last one present.
function newestContributionId(context) {
  const since = deriveSince(context);
  for (let i = since.items.length - 1; i >= 0; i -= 1) {
    const id = strField(since.items[i] && since.items[i].id);
    if (id) return id;
  }
  if (since.cursor) return since.cursor;
  const provenance = asArray(context && context.provenance);
  for (let i = provenance.length - 1; i >= 0; i -= 1) {
    const id = strField(provenance[i] && provenance[i].id);
    if (id) return id;
  }
  return "";
}

function cursorStore() {
  try {
    if (typeof localStorage !== "undefined" && localStorage) return localStorage;
  } catch (err) {
    // localStorage can throw (private mode); fall back to session scope.
  }
  return sessionStorage;
}

function cursorKey(workspaceId) {
  return `${CURSOR_PREFIX}${workspaceId}`;
}

function readCursor(workspaceId) {
  if (!workspaceId) return "";
  try {
    return cursorStore().getItem(cursorKey(workspaceId)) || "";
  } catch (err) {
    return "";
  }
}

function writeCursor(workspaceId, cursor) {
  if (!workspaceId || !cursor) return;
  try {
    cursorStore().setItem(cursorKey(workspaceId), cursor);
  } catch (err) {
    // The cursor is a convenience, never a source of truth.
  }
}

function actorName(actor) {
  if (!actor || typeof actor !== "object") return "";
  return nameMap[actor.actorId] || actor.actorId || "";
}

function rebuildNames() {
  nameMap = Object.create(null);
  const add = (p) => {
    if (p && p.actor && p.name) nameMap[p.actor.actorId] = p.name;
  };
  (state.context && state.context.participants ? state.context.participants : []).forEach(add);
  (state.view && state.view.participants ? state.view.participants : []).forEach(add);
}

function pickById(list, id) {
  if (!Array.isArray(list)) return null;
  return list.find((row) => row && row.id === id) || null;
}

function matchObject(item) {
  const id = item.objectId;
  const type = item.objectType;
  const view = state.view;
  const ctx = state.context;
  if (type === "task") {
    const work = deriveCurrentWork(ctx);
    return (
      pickById(view && view.tasks, id) ||
      pickById(work.inProgressTasks, id) ||
      pickById(work.blockedTasks, id) ||
      pickById(ctx && ctx.openTasks, id)
    );
  }
  if (type === "finding") {
    return pickById(view && view.findings, id) || pickById(ctx && ctx.findings, id);
  }
  if (type === "decision") {
    const work = deriveCurrentWork(ctx);
    return (
      pickById(view && view.decisions, id) ||
      pickById(work.acceptedDecisions, id) ||
      pickById(ctx && ctx.proposedDecisions, id) ||
      pickById(ctx && ctx.acceptedDecisions, id) ||
      pickById(ctx && ctx.supersededDecisions, id)
    );
  }
  if (type === "artifact") {
    return pickById(view && view.artifacts, id) || pickById(ctx && ctx.artifacts, id);
  }
  if (type === "goal") {
    const goal = (view && view.goal) || (ctx && ctx.goal);
    return goal && goal.id === id ? goal : null;
  }
  return null;
}

function itemSentence(item) {
  const payload = payloadOf(item);
  const fromPayload = strField(payload.summary, payload.title, payload.name);
  if (fromPayload) return fromPayload;
  const obj = matchObject(item);
  if (obj) {
    const fromObject = strField(obj.summary, obj.title, obj.name);
    if (fromObject) return fromObject;
  }
  return item.objectId || item.id || "";
}

const TASK_STATUSES = ["open", "in_progress", "blocked", "completed"];
const DECISION_STATUSES = ["proposed", "accepted", "superseded"];

function kindLabel(item) {
  const payload = payloadOf(item);
  const type = item.objectType;
  const action = item.action;
  if (type === "task" && (action === "create" || action === "update")) {
    const resolved = matchObject(item);
    const status = strField(payload.status, resolved && resolved.status);
    return TASK_STATUSES.includes(status) ? status : "task";
  }
  if (type === "decision" && (action === "create" || action === "update" || action === "accept" || action === "retire")) {
    const resolved = matchObject(item);
    const status = strField(payload.status, resolved && resolved.status);
    return DECISION_STATUSES.includes(status) ? status : "decision";
  }
  if (type === "finding") {
    const resolved = matchObject(item);
    const currentness = strField(payload.currentness, resolved && resolved.currentness);
    if (currentness) return `finding ${currentness}`;
    if (action === "create" || action === "correct" || action === "withdraw") return "finding";
  }
  if (action === "create" && type === "artifact") return "artifact";
  if (action === "create" && type === "goal") return "goal";
  return type || "";
}

// Membership/session noise is not the workstream. Consecutive plumbing collapses.
function isPlumbing(item) {
  if (!item) return false;
  if (item.action === "join" || item.objectType === "participant") return true;
  if (item.objectType === "workspace" && item.action === "create") return true;
  if (item.objectType === "invite") return true;
  if (item.action === "register_session" || item.objectType === "agent_session") return true;
  return false;
}

// Inspect only extra fields. Never dump objectId, actorId, ISO time, or JSON payload.
function extras(item) {
  const payload = payloadOf(item);
  const obj = matchObject(item) || {};
  const type = item.objectType;
  const lines = [];
  const summary = strField(payload.summary, obj.summary);

  if (type === "finding" || type === "decision") {
    lines.push(...compactRecordLines(payload, obj));
  }
  if (type === "finding") {
    const detail = strField(payload.detail, obj.detail);
    if (detail && detail !== summary) lines.push(detail);
  }
  if (type === "decision") {
    const rationale = strField(payload.rationale, obj.rationale);
    if (rationale) lines.push(rationale);
    const approvedBy = payload.approvedBy || obj.approvedBy;
    const by = actorName(approvedBy);
    if (by) lines.push(`accepted by ${by}`);
  }
  if (type === "artifact") {
    const uri = strField(payload.uriOrPath, obj.uriOrPath);
    if (uri) lines.push(uri);
  }
  if (type === "task") {
    const description = strField(payload.description, obj.description);
    if (description) lines.push(description);
    const assignee = payload.assignee !== undefined ? payload.assignee : obj.assignee;
    const who = actorName(assignee);
    if (who) lines.push(`assigned ${who}`);
  }
  return lines;
}

function participants() {
  if (state.context && Array.isArray(state.context.participants)) return state.context.participants;
  if (state.view && Array.isArray(state.view.participants)) return state.view.participants;
  return [];
}

function currentGoal() {
  if (state.context && state.context.goal) return state.context.goal;
  if (state.view && state.view.goal) return state.view.goal;
  return null;
}

function isPinned(el) {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 24;
}

async function api(method, params) {
  let body;
  try {
    const res = await fetch("/api/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, params: params || {} }),
    });
    body = await res.json();
  } catch (err) {
    throw { error: "network", message: err instanceof Error ? err.message : "request failed" };
  }
  if (!body || body.ok !== true) {
    throw {
      error: (body && body.error) || "error",
      message: (body && body.message) || "request failed",
    };
  }
  return body.result;
}

function resetSelection() {
  state.selectedId = null;
  state.expandedId = null;
  state.foldOpen = new Set();
  state.olderItems = [];
  state.olderBefore = null;
  state.olderExhausted = false;
  state.loadingOlder = false;
  state.sincePending = true;
  state.sinceRequested = false;
  state.sinceView = null;
  streamPinned = true;
}

function ensureWorkspace(list) {
  const ids = new Set(list.map((w) => w.id));
  if (state.workspaceId && ids.has(state.workspaceId)) return;
  const stored = sessionStorage.getItem(STORAGE_KEY);
  const next = stored && ids.has(stored) ? stored : list[0] ? list[0].id : null;
  if (next !== state.workspaceId) resetSelection();
  state.workspaceId = next;
  if (next) sessionStorage.setItem(STORAGE_KEY, next);
}

function setWorkspace(id) {
  if (!id || id === state.workspaceId) return;
  state.workspaceId = id;
  sessionStorage.setItem(STORAGE_KEY, id);
  resetSelection();
  state.context = null;
  state.view = null;
  state.activity = null;
  render();
  refresh();
}

function renderHeader() {
  const me = state.whoami && state.whoami.actor;
  if (els.whoami) {
    els.whoami.textContent = me ? `${actorName(me)}  ${me.actorType || ""}`.trim() : "";
  }
  if (els.error) {
    if (state.error) {
      els.error.hidden = false;
      els.error.textContent = state.error;
    } else {
      els.error.hidden = true;
      els.error.textContent = "";
    }
  }

  if (!els.workspace) return;
  const list = state.workspaces;
  const key = list.map((w) => `${w.id}\0${w.name}`).join("\n");
  if (key !== selectKey) {
    selectKey = key;
    if (!list.length) {
      els.workspace.innerHTML = `<option value="">Waiting for an agent to start work.</option>`;
    } else {
      els.workspace.innerHTML = list
        .map((w) => `<option value="${esc(w.id)}">${esc(w.name)}</option>`)
        .join("");
    }
  }
  const value = state.workspaceId || "";
  if (els.workspace.value !== value) els.workspace.value = value;
  if (els.generatedViewLink) {
    els.generatedViewLink.hidden = !value;
    if (value) els.generatedViewLink.href = `/generated/workspaces/${encodeURIComponent(value)}`;
  }
}

function renderMast() {
  if (els.people) {
    if (!state.workspaces.length) {
      els.people.innerHTML = "";
    } else {
      els.people.innerHTML = participants()
        .map((p) => {
          const human = p.actor && p.actor.actorType === "human";
          const mark = human ? "●" : "◇";
          const name = p.name || actorName(p.actor);
          return `<span class="person"><span class="mark ${human ? "human" : "agent"}">${mark}</span>${esc(name)}</span>`;
        })
        .join("");
    }
  }
  if (els.goal) {
    const goal = currentGoal();
    if (goal && goal.title) {
      els.goal.innerHTML = `<span class="glabel">GOAL</span> ${esc(goal.title)}`;
    } else {
      els.goal.innerHTML = "";
    }
  }
}

// ATT-001: the service reason codes are stable identifiers for drill-down;
// the human surface shows plain language. Unknown codes fall through as
// themselves rather than being hidden.
const ATTENTION_REASON_LABELS = {
  proposed_decision_actionable: "proposed decision — actionable by you, not accepted",
  assigned_blocked_task: "blocked task assigned to you",
  assigned_open_task: "open task assigned to you",
  unassigned_blocked_task: "blocked task with no recorded assignee",
  team_proposed_decision: "proposed decision recorded by the team — not accepted",
  team_blocked_task: "blocked task assigned to another participant",
  team_open_task: "open task — orientation hint only",
  accepted_decision_needs_review: "accepted decision cites non-current evidence — needs human review",
};

function attentionReasonLabel(reason) {
  return Object.prototype.hasOwnProperty.call(ATTENTION_REASON_LABELS, reason)
    ? ATTENTION_REASON_LABELS[reason]
    : reason;
}

// ATT-001: coverage of the two source pages attention is selected from. The
// service projects `attentionCoverage`; an older context only carries the
// `slices` values, so the same shape is derived from those. No read is issued.
function attentionCoverageFrom(context) {
  if (!isRecord(context)) return undefined;
  if (isRecord(context.attentionCoverage)) return context.attentionCoverage;
  const slices = isRecord(context.slices) ? context.slices : null;
  if (!slices) return undefined;
  const read = (name) => {
    const slice = slices[name];
    if (!isRecord(slice)) return null;
    return {
      total: typeof slice.total === "number" ? slice.total : 0,
      returned: typeof slice.returned === "number" ? slice.returned : 0,
      truncated: slice.truncated === true,
    };
  };
  const tasks = read("tasks");
  const decisions = read("decisions");
  if (!tasks && !decisions) return undefined;
  const absent = { total: 0, returned: 0, truncated: false };
  const coverage = { tasks: tasks || absent, decisions: decisions || absent };
  coverage.completeUnderRules = !coverage.tasks.truncated && !coverage.decisions.truncated;
  return coverage;
}

// ATT-001: one coverage line for both attention lists, from the same two
// source pages. Nonempty lists are qualified too: a visible cue does not
// prove the list exhaustive.
function attentionCoverageText(coverage) {
  if (!isRecord(coverage)) return "";
  const part = (slice) => {
    const returned = isRecord(slice) && typeof slice.returned === "number" ? slice.returned : "?";
    const total = isRecord(slice) && typeof slice.total === "number" ? slice.total : "?";
    const truncated = isRecord(slice) && slice.truncated === true;
    return `${returned} of ${total}${truncated ? " (truncated)" : ""}`;
  };
  const truncated =
    (isRecord(coverage.tasks) && coverage.tasks.truncated === true) ||
    (isRecord(coverage.decisions) && coverage.decisions.truncated === true);
  const text = `Attention coverage: tasks ${part(coverage.tasks)}, decisions ${part(coverage.decisions)}.`;
  return truncated
    ? `${text} Cues beyond the returned pages may exist.`
    : `${text} Both source pages are complete.`;
}

// ATT-001: an empty attention list is not an all-clear. Complete pages mean no
// recorded cue matches the rules; incomplete or unreported pages mean only
// that none was found in the returned records.
function attentionEmptyText(coverage) {
  if (!isRecord(coverage)) {
    return "No recorded attention cues in the returned records; completeness was not reported.";
  }
  if (coverage.completeUnderRules === true) {
    return "No recorded attention cues match these rules. This does not mean all work is done.";
  }
  return "No cue found in the returned records; more matching records may exist.";
}

function attentionItemHtml(item) {
  return `<li class="oitem">${attentionItemBodyHtml(item)}</li>`;
}

function attentionItemBodyHtml(item) {
  const meta = [item.kind, item.status].filter(Boolean).join(" · ");
  const metaHtml = meta ? `<span class="ometa">${esc(meta)}</span>` : "";
  const sentence = item.summary || item.id || "";
  // SWH-001: the source id stays visible even when a summary exists, so an
  // attention cue can always be tied back to its recorded object.
  const sourceHtml = item.id ? `<span class="osource">${esc(item.id)}</span>` : "";
  // ATT-001: the raw code stays in data-reason for drill-down; the visible
  // text is plain language.
  const reason = strField(item.reason);
  const reasonHtml = reason
    ? `<span class="oreason" data-reason="${esc(reason)}">${esc(attentionReasonLabel(reason))}</span>`
    : "";
  // The cited non-current findings come from the returned decorated decision.
  // They are shown only when the service set them; nothing is invented.
  const cited = reviewFindingIds(item);
  const citedHtml = cited.length
    ? `<span class="ocited">${esc(`non-current citations: ${cited.join(", ")}`)}</span>`
    : "";
  // Recorded assignment, stated as a record. It is never a permission claim.
  const assigneeId = isRecord(item.assignee) ? strField(item.assignee.actorId) : "";
  const assigneeHtml = assigneeId
    ? `<span class="oassignee">${esc(`assignee: ${assigneeId}`)}</span>`
    : "";
  return `${metaHtml}${sourceHtml}<span class="osentence">${esc(sentence)}</span>${reasonHtml}${citedHtml}${assigneeHtml}`;
}

function renderAttentionList(el, items, emptyText, coverageText) {
  if (!el) return;
  const coverageHtml =
    typeof coverageText === "string" && coverageText.length
      ? `<div class="coverage">${esc(coverageText)}</div>`
      : "";
  if (!items.length) {
    el.innerHTML = `<div class="empty">${esc(emptyText)}</div>` + coverageHtml;
    return;
  }
  el.innerHTML = `<ul class="olist">${items.map((item) => attentionItemHtml(item)).join("")}</ul>` + coverageHtml;
}

function workTaskHtml(task) {
  const status = strField(task.status);
  const title = strField(task.title, task.summary, task.id);
  return `<li class="oitem">${status ? `<span class="ometa">${esc(status)}</span>` : ""}<span class="osentence">${esc(title)}</span></li>`;
}

function reviewFindingIds(decision) {
  return Array.isArray(decision.needsReviewFindingIds)
    ? decision.needsReviewFindingIds.filter((id) => typeof id === "string" && id)
    : [];
}

function needsReview(decision) {
  return decision.needsReview === true || reviewFindingIds(decision).length > 0;
}

// Recorded replacement links and the stored reason only. Absent fields render
// nothing: the page never invents why a decision changed.
function decisionTransitionParts(decision) {
  const parts = [];
  const predecessorId = strField(decision.predecessorId);
  if (predecessorId) parts.push(`replaces ${predecessorId}`);
  const successorId = strField(decision.successorId);
  if (successorId) parts.push(`replaced by ${successorId}`);
  const reason = strField(decision.supersedeReason);
  if (reason) parts.push(`reason: ${reason}`);
  return parts;
}

function decisionTransitionHtml(decision) {
  const parts = decisionTransitionParts(decision);
  if (!parts.length) return "";
  return `<span class="oreason">${esc(parts.join(" · "))}</span>`;
}

// An accepted decision that needs review is not the team's current position.
// It is separated from the accepted list and marked by a bordered badge plus an
// aria label, so the distinction survives without color and without relying on
// row order.
function workDecisionHtml(decision) {
  const title = strField(decision.summary, decision.title, decision.id);
  const ids = reviewFindingIds(decision);
  const flagged = needsReview(decision);
  const marker = flagged
    ? `<span class="oreason"><span class="oreview" aria-label="accepted decision needing review">needs review</span>${
        // "non-current", not "withdrawn": a stale citation is any finding whose
        // currentness is not "current", which includes superseded findings.
        ids.length ? ` cites non-current finding${ids.length > 1 ? "s" : ""} ${esc(ids.join(", "))}` : ""
      }</span>`
    : "";
  return `<li class="oitem"><span class="ometa">accepted</span><span class="osentence">${esc(title)}</span>${marker}${decisionTransitionHtml(decision)}</li>`;
}

function acceptedDecisionGroupsHtml(decisions) {
  const accepted = partitionAcceptedDecisions(decisions);
  return (
    workGroup("accepted decisions", accepted.settled, workDecisionHtml) +
    workGroup("accepted decisions needing review", accepted.flagged, workDecisionHtml)
  );
}

function partitionAcceptedDecisions(decisions) {
  const settled = [];
  const flagged = [];
  for (const decision of decisions) {
    (needsReview(decision) ? flagged : settled).push(decision);
  }
  return { settled, flagged };
}

// A section with zero rows and a section with undisplayed rows must look
// different. Slices the service already returns are never discarded.
function sliceTotals(context) {
  const slices = isRecord(context) && isRecord(context.slices) ? context.slices : {};
  const read = (name) => {
    const slice = slices[name];
    if (!isRecord(slice)) return null;
    const total = slice.total;
    const returned = slice.returned;
    if (typeof total !== "number" && typeof returned !== "number") return null;
    return {
      total: typeof total === "number" ? total : undefined,
      returned: typeof returned === "number" ? returned : undefined,
      truncated: slice.truncated === true,
    };
  };
  return {
    tasks: read("tasks"),
    decisions: read("decisions"),
    findings: read("findings"),
    artifacts: read("artifacts"),
  };
}

// Counts describe a whole slice, not the group being rendered.
function completenessNote(totals) {
  if (!totals) return "";
  const shown = typeof totals.returned === "number" ? totals.returned : undefined;
  const total = typeof totals.total === "number" ? totals.total : undefined;
  const parts = [];
  if (shown !== undefined && total !== undefined) parts.push(`showing ${shown} of ${total}`);
  else if (total !== undefined) parts.push(`${total} total`);
  if (totals.truncated) parts.push("more available — open the list for the rest");
  return parts.join(" · ");
}

// One row per bounded slice the service reported. Rendered unconditionally so
// completeness never depends on a group happening to have rows.
function renderSliceCompleteness(totals) {
  const names = ["tasks", "decisions", "findings", "artifacts"];
  const rows = [];
  for (const name of names) {
    const note = completenessNote(totals[name]);
    if (!note) continue;
    rows.push(`<div class="oslice-complete"><span class="ometa">${esc(name)}</span><span class="osentence">${esc(note)}</span></div>`);
  }
  if (!rows.length) return "";
  return `<div class="ogroup"><div class="ogroup-label">orientation completeness</div><div class="olist">${rows.join("")}</div></div>`;
}

function workGroup(label, items, renderItem) {
  if (!items.length) return "";
  return `<div class="ogroup"><div class="ogroup-label">${esc(label)}</div><ul class="olist">${items.map(renderItem).join("")}</ul></div>`;
}

function compareByUpdatedDescThenId(a, b) {
  const left = strField(a.updatedAt, a.createdAt);
  const right = strField(b.updatedAt, b.createdAt);
  if (left !== right) return left < right ? 1 : -1;
  const leftId = strField(a.id);
  const rightId = strField(b.id);
  if (leftId === rightId) return 0;
  return leftId < rightId ? -1 : 1;
}

function renderCurrentWork(el, work, context) {
  if (!el) return;
  // Frozen VIS-001 surface: this stays the 3-arg current-work renderer. The
  // accepted-decision groups were extracted so the SWH-001 perspectives can
  // share them without changing this output.
  const acceptedGroups = acceptedDecisionGroupsHtml(work.acceptedDecisions);
  // Open tasks are enumerated, not left to id lookup. Previously they were
  // returned by the service but never listed, so the next action was
  // unreachable whenever nothing was in progress or blocked.
  const listed = new Set();
  for (const task of [...work.inProgressTasks, ...work.blockedTasks]) {
    if (isRecord(task) && typeof task.id === "string") listed.add(task.id);
  }
  const openTasks = asArray(isRecord(context) ? context.openTasks : undefined)
    .filter((task) => isRecord(task) && strField(task.status) === "open" && !listed.has(task.id))
    .sort(compareByUpdatedDescThenId);
  const totals = sliceTotals(context);
  const groups =
    workGroup("in progress", work.inProgressTasks, workTaskHtml) +
    workGroup("blocked", work.blockedTasks, workTaskHtml) +
    workGroup("open", openTasks, workTaskHtml) +
    acceptedGroups;
  // Stated once per bounded slice, outside the groups. Attaching counts to a
  // group made them vanish whenever that group had no rows — a flagged-only
  // decision list lost its decision count — which left a truncated section
  // looking empty.
  const html = groups + renderSliceCompleteness(totals);
  el.innerHTML = groups.length > 0 ? html : `<div class="empty">No current work</div>` + renderSliceCompleteness(totals);
}

// --- SWH-001 Shared Work Home renderers -------------------------------------
// All of these read the already-fetched authorized context. They never call
// the service, never fetch a reference, and never infer live agent state.

function participantKey(ref) {
  return ref ? `${strField(ref.actorType)}:${strField(ref.actorId)}` : "";
}

function refByKey(participants, ref) {
  const key = participantKey(ref);
  if (!key) return null;
  for (const participant of asArray(participants)) {
    if (!isRecord(participant) || !isRecord(participant.actor)) continue;
    if (participantKey(participant.actor) === key) return participant;
  }
  return null;
}

// The tasks page plus the current-work page, deduped by id. Completed tasks
// are historical; they are inspected through the workstream, not counted here.
function collectOpenTasks(context) {
  const work = deriveCurrentWork(context);
  const rows = [];
  const seen = new Set();
  const candidates = [
    ...asArray(isRecord(context) ? context.openTasks : undefined),
    ...work.inProgressTasks,
    ...work.blockedTasks,
  ];
  for (const task of candidates) {
    if (!isRecord(task)) continue;
    if (strField(task.status) === "completed") continue;
    const id = strField(task.id);
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    rows.push(task);
  }
  return rows.sort(compareByUpdatedDescThenId);
}

function myWorkGroups(context, who) {
  const participants = isRecord(context) ? context.participants : [];
  const owned = ownedAgentIds(participants, who);
  const isMine = (task) => {
    if (taskAssignedToActor(task, who)) return true;
    for (const id of owned) {
      if (taskAssignedToActor(task, { actorId: id, actorType: "agent" })) return true;
    }
    return false;
  };
  const rows = collectOpenTasks(context).filter(isMine);
  const known = ["in_progress", "blocked", "open"];
  return {
    ownedAgentIds: owned,
    inProgress: rows.filter((task) => strField(task.status) === "in_progress"),
    blocked: rows.filter((task) => strField(task.status) === "blocked"),
    open: rows.filter((task) => strField(task.status) === "open"),
    other: rows.filter((task) => known.indexOf(strField(task.status)) === -1),
  };
}

function teamWorkGroups(context) {
  const participants = asArray(isRecord(context) ? context.participants : [])
    .filter((row) => isRecord(row) && isRecord(row.actor));
  const tasks = collectOpenTasks(context);
  const humans = participants.filter((row) => row.actor.actorType === "human");
  const agents = participants.filter((row) => row.actor.actorType === "agent");

  const agentsOf = new Map();
  const unowned = [];
  for (const participant of agents) {
    const ownerId = strField(participant.humanOwnerId);
    const owner = ownerId ? refByKey(participants, { actorId: ownerId, actorType: "human" }) : null;
    if (owner) {
      const list = agentsOf.get(ownerId) || [];
      list.push(participant);
      agentsOf.set(ownerId, list);
    } else {
      unowned.push({
        participant,
        recordedOwnerId: ownerId,
        tasks: tasks.filter((task) => taskAssignedToActor(task, participant.actor)),
      });
    }
  }

  const grouped = humans.map((human) => ({
    participant: human,
    tasks: tasks.filter((task) => taskAssignedToActor(task, human.actor)),
    agents: (agentsOf.get(human.actor.actorId) || []).map((agent) => ({
      participant: agent,
      tasks: tasks.filter((task) => taskAssignedToActor(task, agent.actor)),
    })),
  }));

  const foreign = new Map();
  const unassigned = [];
  for (const task of tasks) {
    const assignee = isRecord(task.assignee) ? task.assignee : null;
    if (!assignee) {
      unassigned.push(task);
      continue;
    }
    if (refByKey(participants, assignee)) continue;
    const key = participantKey(assignee);
    const row = foreign.get(key) || { assignee, tasks: [] };
    row.tasks.push(task);
    foreign.set(key, row);
  }
  const foreignGroups = Array.from(foreign.values()).sort((a, b) =>
    participantKey(a.assignee) < participantKey(b.assignee) ? -1 : 1,
  );
  return { humans: grouped, unowned, foreign: foreignGroups, unassigned };
}

// A filtered group drawn from a truncated slice cannot claim "none". The
// wording mirrors the bounded-read completeness boundary (§4.4).
function taskGroupEmptyNote(totals) {
  const slice = totals && totals.tasks ? totals.tasks : null;
  if (!slice) return "none recorded in the returned orientation; completeness not reported";
  if (slice.truncated === true) {
    const shown = typeof slice.returned === "number" ? slice.returned : "?";
    const total = typeof slice.total === "number" ? slice.total : "?";
    return `no matching tasks in the returned ${shown} of ${total}; more may exist`;
  }
  return "none";
}

function completenessRowHtml(name, totals) {
  const note = completenessNote(totals);
  if (!note) return "";
  return `<div class="oslice-complete"><span class="ometa">${esc(name)}</span><span class="osentence">${esc(note)}</span></div>`;
}

// Assignee identity is the recorded actor, matched on id and type. An unknown
// name is stated as unknown; it is never guessed from another record.
function assigneeIdentity(participants, assignee) {
  const id = strField(assignee.actorId);
  const type = strField(assignee.actorType, "unknown");
  const match = refByKey(participants, assignee);
  const name = match ? strField(match.name) : "";
  return `${name || "(name not recorded)"} (${type}) ${id}`;
}

function homeTaskRowHtml(context, task) {
  const participants = isRecord(context) ? context.participants : [];
  const status = strField(task.status);
  const title = strField(task.title, task.summary, task.id);
  const id = strField(task.id);
  const assignee = isRecord(task.assignee) ? task.assignee : null;
  const assigned = assignee
    ? `assigned to ${esc(assigneeIdentity(participants, assignee))}`
    : "unassigned";
  return `<li class="oitem"><span class="ometa">${esc(status)}</span><span class="osentence">${esc(title)}</span><span class="oreason">id ${esc(id)} · ${assigned}</span></li>`;
}

function groupTasksHtml(context, tasks, emptyNote) {
  if (!tasks.length) return `<div class="empty">${esc(emptyNote)}</div>`;
  return `<ul class="olist">${tasks.map((task) => homeTaskRowHtml(context, task)).join("")}</ul>`;
}

function participantGroupLabel(participant) {
  const name = strField(participant.name, participant.actor.actorId);
  if (participant.actor.actorType === "human") return `${name} (human)`;
  const harness = strField(participant.harness);
  return harness ? `${name} (agent · ${harness})` : `${name} (agent)`;
}

function ownedAgentsSectionHtml(context, who, groups) {
  const participants = isRecord(context) ? context.participants : [];
  if (who && who.actorType === "agent") {
    // An agent-bound Viewer shows that agent's tasks only; it never acquires a
    // human owner's other work.
    const match = refByKey(participants, who);
    const name = match ? strField(match.name, who.actorId) : who.actorId;
    return `<div class="ogroup"><div class="ogroup-label">caller</div><ul class="olist"><li class="oitem"><span class="osentence">${esc(`Viewer bound to agent ${name}; showing tasks assigned to this agent only`)}</span></li></ul></div>`;
  }
  if (!who) {
    return `<div class="ogroup"><div class="ogroup-label">your agents</div><ul class="olist"><li class="oitem"><span class="osentence">No caller identity recorded; owned agents cannot be derived</span></li></ul></div>`;
  }
  const rows = [];
  for (const id of groups.ownedAgentIds) {
    const match = refByKey(participants, { actorId: id, actorType: "agent" });
    const name = match ? strField(match.name, id) : id;
    const harness = match ? strField(match.harness, "harness not recorded") : "harness not recorded";
    rows.push(`<li class="oitem"><span class="osentence">${esc(`${name} · harness ${harness} · owned by you`)}</span></li>`);
  }
  if (!rows.length) rows.push(`<li class="oitem"><span class="osentence">none recorded</span></li>`);
  return `<div class="ogroup"><div class="ogroup-label">your agents</div><ul class="olist">${rows.join("")}</ul></div>`;
}

function taskStatusGroupsHtml(context, groups, emptyNote) {
  const parts = [];
  parts.push(`<div class="ogroup"><div class="ogroup-label">in progress</div>${groupTasksHtml(context, groups.inProgress, emptyNote)}</div>`);
  parts.push(`<div class="ogroup"><div class="ogroup-label">blocked</div>${groupTasksHtml(context, groups.blocked, emptyNote)}</div>`);
  parts.push(`<div class="ogroup"><div class="ogroup-label">open</div>${groupTasksHtml(context, groups.open, emptyNote)}</div>`);
  if (groups.other.length) {
    parts.push(`<div class="ogroup"><div class="ogroup-label">other status</div>${groupTasksHtml(context, groups.other, emptyNote)}</div>`);
  }
  return parts.join("");
}

function proposedDecisionHtml(decision) {
  const title = strField(decision.summary, decision.title, decision.id);
  const lines = [`id ${strField(decision.id)}`].concat(decisionTransitionParts(decision));
  return `<li class="oitem"><span class="ometa">proposed</span><span class="osentence">${esc(title)}</span><span class="oreason">${esc(lines.join(" · "))}</span></li>`;
}

function supersededDecisionHtml(decision) {
  const title = strField(decision.summary, decision.title, decision.id);
  const lines = [`id ${strField(decision.id)}`].concat(decisionTransitionParts(decision));
  return `<li class="oitem"><span class="ometa">superseded (historical)</span><span class="osentence">${esc(title)}</span><span class="oreason">${esc(lines.join(" · "))}</span></li>`;
}

function historicalLineHtml(context) {
  const counts = isRecord(context && context.historicalCounts) ? context.historicalCounts : null;
  if (!counts) return "";
  const decisions = typeof counts.decisions === "number" ? counts.decisions : 0;
  const findings = typeof counts.findings === "number" ? counts.findings : 0;
  return `<div class="oslice-complete"><span class="ometa">historical</span><span class="osentence">${esc(`Historical: ${decisions} superseded decisions / ${findings} corrected findings recorded — inspect the workstream`)}</span></div>`;
}

// Shared by My work and Team work: both perspectives show the same accepted,
// proposed, and historical decision facts. No accepted decision is picked as
// "the" current one.
function decisionBoundaryHtml(work, context) {
  const totals = sliceTotals(context);
  const proposed = asArray(isRecord(context) ? context.proposedDecisions : undefined).filter(isRecord);
  const superseded = asArray(isRecord(context) ? context.supersededDecisions : undefined).filter(isRecord);
  return (
    acceptedDecisionGroupsHtml(work.acceptedDecisions) +
    workGroup("proposed decisions — not accepted, not permission to act", proposed, proposedDecisionHtml) +
    workGroup("superseded (historical)", superseded, supersededDecisionHtml) +
    completenessRowHtml("decisions", totals.decisions) +
    historicalLineHtml(context)
  );
}

function renderMyWork(el, context, who) {
  if (!el) return;
  const groups = myWorkGroups(context, who);
  const totals = sliceTotals(context);
  const emptyNote = taskGroupEmptyNote(totals);
  const parts = [];
  parts.push(ownedAgentsSectionHtml(context, who, groups));
  parts.push(`<div class="ogroup"><div class="ogroup-label">my tasks</div>`);
  parts.push(taskStatusGroupsHtml(context, groups, emptyNote));
  parts.push(`</div>`);
  parts.push(completenessRowHtml("tasks", totals.tasks));
  parts.push(decisionBoundaryHtml(deriveCurrentWork(context), context));
  el.innerHTML = parts.join("");
}

function renderTeamWork(el, context, who) {
  if (!el) return;
  const groups = teamWorkGroups(context);
  const totals = sliceTotals(context);
  const emptyNote = taskGroupEmptyNote(totals);
  const parts = [];
  for (const human of groups.humans) {
    const name = strField(human.participant.name, human.participant.actor.actorId);
    parts.push(`<div class="ogroup"><div class="ogroup-label">${esc(participantGroupLabel(human.participant))}</div>`);
    parts.push(groupTasksHtml(context, human.tasks, emptyNote));
    for (const agent of human.agents) {
      parts.push(`<div class="ogroup-label">${esc(participantGroupLabel(agent.participant))} · owned by ${esc(name)}</div>`);
      parts.push(groupTasksHtml(context, agent.tasks, emptyNote));
    }
    parts.push(`</div>`);
  }
  if (groups.unowned.length) {
    parts.push(`<div class="ogroup"><div class="ogroup-label">Unowned agents (ownership unknown)</div>`);
    for (const entry of groups.unowned) {
      const label = entry.recordedOwnerId
        ? `${participantGroupLabel(entry.participant)} — ownership unknown; recorded owner ${entry.recordedOwnerId} is not a participant (unresolvable)`
        : `${participantGroupLabel(entry.participant)} — ownership unknown`;
      parts.push(`<div class="ogroup-label">${esc(label)}</div>`);
      parts.push(groupTasksHtml(context, entry.tasks, emptyNote));
    }
    parts.push(`</div>`);
  }
  for (const entry of groups.foreign) {
    const label = `${strField(entry.assignee.actorType, "unknown")} ${strField(entry.assignee.actorId)} — (name not recorded)`;
    parts.push(`<div class="ogroup"><div class="ogroup-label">${esc(label)}</div>`);
    parts.push(groupTasksHtml(context, entry.tasks, emptyNote));
    parts.push(`</div>`);
  }
  parts.push(`<div class="ogroup"><div class="ogroup-label">Unassigned</div>${groupTasksHtml(context, groups.unassigned, emptyNote)}</div>`);
  parts.push(completenessRowHtml("tasks", totals.tasks));
  parts.push(decisionBoundaryHtml(deriveCurrentWork(context), context));
  el.innerHTML = parts.join("");
}

function findingSourceHtml(finding) {
  const id = strField(finding.id);
  const summary = strField(finding.summary, id);
  const currentness = strField(finding.currentness, "current");
  const evidence = asArray(finding.evidence)
    .filter(isRecord)
    .map((row) => {
      const artifactId = strField(row.artifactId);
      if (!artifactId) return "";
      const relation = strField(row.relation);
      return relation ? `${artifactId} (${relation})` : artifactId;
    })
    .filter((text) => text);
  const evidenceText = evidence.length ? `evidence: ${evidence.join(", ")}` : "evidence: none recorded";
  return `<li class="oitem"><span class="ometa">${esc(currentness)}</span><span class="osentence">${esc(summary)}</span><span class="oreason">id ${esc(id)} · ${esc(evidenceText)}</span></li>`;
}

function artifactSourceHtml(artifact) {
  const id = strField(artifact.id);
  const type = strField(artifact.type);
  const title = strField(artifact.title, id);
  // The stored reference is inert text. It is never fetched, previewed, or
  // linked, and listing it does not claim the target exists or is accessible.
  const reference = strField(artifact.uriOrPath);
  const referenceHtml = reference
    ? `reference: <code>${esc(reference)}</code> (stored reference, not fetched)`
    : "no reference recorded";
  return `<li class="oitem"><span class="ometa">${esc(type)}</span><span class="osentence">${esc(title)}</span><span class="oreason">id ${esc(id)} · ${referenceHtml}</span></li>`;
}

function sourceListHtml(rows, name, totals) {
  const note = completenessRowHtml(name, totals && totals[name] ? totals[name] : null);
  if (rows.length) return `<ul class="olist">${rows.join("")}</ul>${note}`;
  const slice = totals && totals[name] ? totals[name] : null;
  if (slice && slice.truncated === true) return `<div class="empty">more available</div>${note}`;
  if (slice) return `<div class="empty">none</div>${note}`;
  return `<div class="empty">none recorded in the returned orientation</div>`;
}

// Shared sources: current findings and artifact references, both perspectives.
function renderSources(el, context) {
  if (!el) return;
  const totals = sliceTotals(context);
  const slices = isRecord(context) && isRecord(context.slices) ? context.slices : {};
  const findings = asArray(isRecord(slices.findings) ? slices.findings.items : undefined).filter(isRecord);
  const artifacts = asArray(isRecord(slices.artifacts) ? slices.artifacts.items : undefined).filter(isRecord);
  const parts = [];
  parts.push(`<div class="ogroup"><div class="ogroup-label">current findings</div>${sourceListHtml(findings.map(findingSourceHtml), "findings", totals)}</div>`);
  parts.push(`<div class="ogroup"><div class="ogroup-label">artifact references</div>${sourceListHtml(artifacts.map(artifactSourceHtml), "artifacts", totals)}</div>`);
  el.innerHTML = parts.join("");
}

function sinceItemHtml(item) {
  return `<li class="oitem"><span class="ometa">${esc(kindLabel(item))}</span><span class="osentence">${esc(itemSentence(item))}</span></li>`;
}

function renderSince(el, view) {
  if (!el) return;
  if (!view || view.state === "first-visit") {
    el.innerHTML = `<div class="empty">${esc(FIRST_VISIT_MESSAGE)}</div>`;
    return;
  }
  if (view.state !== "items" || !view.items.length) {
    el.innerHTML = `<div class="empty">${esc(NO_NEW_MESSAGE)}</div>`;
    return;
  }
  const trunc = view.truncated ? `<div class="trunc">older changes omitted</div>` : "";
  el.innerHTML = trunc + `<ul class="olist">${view.items.map(sinceItemHtml).join("")}</ul>`;
}

// Orientation hint only: plain text, never an actionable control. The kind and
// id are shown so the hint cannot read as a work step when it points at a
// proposed decision.
function renderNextAction(el, action) {
  if (!el) return;
  if (!action) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML =
    `<span class="hint-label">SUGGESTED NEXT — orientation hint, not an action</span>` +
    `<span class="hint-summary">${esc(action.summary || action.id)}</span>` +
    (action.kind ? `<span class="hint-reason">${esc(action.kind)}${action.id ? ` ${esc(action.id)}` : ""}</span>` : "") +
    (action.reason ? `<span class="hint-reason">${esc(action.reason)}</span>` : "");
}

function renderAlignment(el, alignment, context) {
  if (!el) return;
  if (!alignment) {
    el.innerHTML = `<div class="empty">No recorded alignment boundary.</div>`;
    return;
  }
  const proposed = workGroup("proposed", alignment.proposedDecisionIds, (id) =>
    alignmentItemHtml(id, summaryForDecisionId(context && context.proposedDecisions, id)),
  );
  // Same needs-review distinction as the current-work panel, so one decision
  // cannot read as settled in one list and suspect in the other.
  const acceptedRecords = asArray(context && context.acceptedDecisions);
  const acceptedIds = alignment.acceptedDecisionIds;
  const flaggedIds = acceptedIds.filter((id) => needsReview(pickById(acceptedRecords, id) || {}));
  const settledIds = acceptedIds.filter((id) => !flaggedIds.includes(id));
  const accepted = workGroup("accepted", settledIds, (id) =>
    alignmentItemHtml(id, summaryForDecisionId(context && context.acceptedDecisions, id)),
  );
  const acceptedFlagged = workGroup("accepted needing review", flaggedIds, (id) =>
    alignmentItemHtml(id, summaryForDecisionId(context && context.acceptedDecisions, id)),
  );
  const blocked = workGroup("unresolved blocked tasks", alignment.unresolvedBlockedTaskIds, (id) =>
    alignmentItemHtml(id, titleForBlockedTaskId(context, id)),
  );
  el.innerHTML =
    `<div class="oitem"><span class="ometa">status</span><span class="osentence">${esc(alignment.status)}</span></div>` +
    `<div class="oitem"><span class="osentence">${esc(ALIGNMENT_BOUNDARY_SENTENCE)}</span></div>` +
    proposed +
    accepted +
    acceptedFlagged +
    blocked;
}

function scalarText(value) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (!isRecord(value)) return "";
  const bits = [];
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (typeof child === "string" || typeof child === "number" || typeof child === "boolean") {
      bits.push(`${key} ${child}`);
    }
  }
  return bits.join("  ");
}

function compactRecordLines(payload, obj) {
  const lines = [];
  const currentness = strField(payload.currentness, obj.currentness);
  if (currentness) lines.push(currentness);
  // Labelled. Unlabelled, this read as the finding's own summary, because the
  // same text renders on both the superseded and the current row.
  const reason = strField(
    payload.reason,
    payload.correctionReason,
    payload.supersedeReason,
    obj.reason,
    obj.correctionReason,
    obj.supersedeReason,
  );
  if (reason) lines.push(`reason: ${reason}`);
  const predecessorId = strField(payload.predecessorId, obj.predecessorId);
  if (predecessorId) lines.push(`predecessor ${predecessorId}`);
  const successorId = strField(payload.successorId, obj.successorId);
  if (successorId) lines.push(`successor ${successorId}`);
  const reviewIds = []
    .concat(Array.isArray(payload.needsReviewFindingIds) ? payload.needsReviewFindingIds : [])
    .concat(Array.isArray(obj.needsReviewFindingIds) ? obj.needsReviewFindingIds : [])
    .filter((id, index, all) => typeof id === "string" && id && all.indexOf(id) === index);
  if (reviewIds.length) lines.push(`needs review ${reviewIds.join(", ")}`);
  else if (payload.needsReview === true || obj.needsReview === true) lines.push("needs review");
  // Cited references, not bare counts. "evidence 1" did not let a reader name the
  // basis of a decision; the ids are already authorized records in this workspace.
  const evidenceRows = Array.isArray(payload.evidence)
    ? payload.evidence
    : Array.isArray(obj.evidence)
      ? obj.evidence
      : [];
  if (evidenceRows.length) {
    const ids = evidenceRows
      .map((row) => strField(isRecord(row) ? row.findingId || row.artifactId || row.id : ""))
      .filter((id) => id);
    lines.push(`evidence (${evidenceRows.length})${ids.length ? `: ${ids.join(", ")}` : ""}`);
  }
  const citationRows = Array.isArray(payload.citations)
    ? payload.citations
    : Array.isArray(obj.citations)
      ? obj.citations
      : [];
  if (citationRows.length) {
    const ids = citationRows
      .map((row) => strField(isRecord(row) ? row.findingId || row.id : ""))
      .filter((id) => id);
    lines.push(`cites (${citationRows.length})${ids.length ? `: ${ids.join(", ")}` : ""}`);
  }
  return lines;
}

// Compact orientation text only. Nested objects are not printed, so artifact
// bodies and transcripts never appear here. No controls.
function recordNotesText(context) {
  if (!isRecord(context)) return "";
  const parts = [];
  const currentness = scalarText(context.currentness);
  if (currentness) parts.push(`currentness ${currentness}`);
  const historical = scalarText(context.historicalCounts);
  if (historical) parts.push(`historical ${historical}`);
  if (typeof context.correctionReason === "string" && context.correctionReason) {
    parts.push(`correction ${context.correctionReason}`);
  }
  if (context.needsReview === true) parts.push("needs review");
  else if (typeof context.needsReview === "number") parts.push(`needs review ${context.needsReview}`);
  else if (typeof context.needsReview === "string" && context.needsReview) parts.push(`needs review ${context.needsReview}`);
  else if (Array.isArray(context.needsReview)) {
    const ids = context.needsReview.filter((id) => typeof id === "string" && id);
    if (ids.length) parts.push(`needs review ${ids.join(", ")}`);
  }
  return parts.join(" · ");
}

function renderRecordNotes(el, context) {
  if (!el) return;
  const text = recordNotesText(context);
  el.textContent = text;
  el.hidden = text.length === 0;
}

// The els/state parameters default to the live globals; render() and
// setPerspective() keep calling this with no arguments. The seam exists so the
// wiring (whoami -> My work, perspective -> renderer) is testable without a DOM.
function renderOrientation(homeEls = els, homeState = state) {
  // ATT-001: both attention lists report the same source-page coverage, and an
  // empty list is qualified by it. No extra read is made.
  const coverage = attentionCoverageFrom(homeState.context);
  const coverageText = attentionCoverageText(coverage);
  const emptyText = attentionEmptyText(coverage);
  renderRecordNotes(homeEls.recordNotes, homeState.context);
  renderAlignment(homeEls.alignment, deriveAlignment(homeState.context), homeState.context);
  renderAttentionList(homeEls.needsYou, deriveNeedsYou(homeState.context), emptyText, coverageText);
  renderAttentionList(homeEls.needsAttention, deriveNeedsAttention(homeState.context), emptyText, coverageText);
  // Both perspectives render from this same context; only the leading panel
  // differs (CSS order/visibility). No section makes its own read.
  const who = callerRef(homeState.whoami);
  if (homeState.perspective === "team") {
    renderTeamWork(homeEls.currentWork, homeState.context, who);
  } else {
    renderMyWork(homeEls.currentWork, homeState.context, who);
  }
  renderSources(homeEls.sources, homeState.context);
  renderSince(homeEls.since, homeState.sinceView);
  renderNextAction(homeEls.nextAction, deriveSuggestedNextAction(homeState.context));
}

function renderDetail(lines) {
  return `<div class="detail">${lines.map((line) => `<div>${esc(line)}</div>`).join("")}</div>`;
}

function foldKey(start) {
  return `fold:${start}`;
}

function visibleRows() {
  const list = items();
  const rows = [];
  let i = 0;
  while (i < list.length) {
    if (isPlumbing(list[i])) {
      const start = i;
      const group = [];
      while (i < list.length && isPlumbing(list[i])) {
        group.push(list[i]);
        i += 1;
      }
      const startKey = String(start);
      rows.push({ type: "fold", key: foldKey(startKey), start: startKey, count: group.length, items: group });
      if (state.foldOpen.has(startKey)) {
        for (const item of group) {
          rows.push({ type: "item", key: item.id, item, muted: true });
        }
      }
    } else {
      rows.push({ type: "item", key: list[i].id, item: list[i], muted: false });
      i += 1;
    }
  }
  return rows;
}

function renderItem(item, muted) {
  // .selected lives on the outer .item so `.item.selected .who` (app.css)
  // draws the highlight. The inner row carries no data-id so
  // selectorFor(`[data-id]`) matches exactly one node.
  const selected = item.id === state.selectedId ? " selected" : "";
  const extraLines = extras(item);
  const expanded = item.id === state.expandedId && extraLines.length > 0;
  const mutedClass = muted ? " muted" : "";
  return `<div class="item${mutedClass}${selected}" data-id="${esc(item.id)}">
    <div class="who row">
      <span class="name">${esc(actorName(item.actor))}</span>
      <span class="time">${esc(fmtTime(item.createdAt))}</span>
    </div>
    <div class="body">
      └ <span class="kind">${esc(kindLabel(item))}</span>
      <div class="sentence">${esc(itemSentence(item))}</div>
    </div>
    ${expanded ? renderDetail(extraLines) : ""}
  </div>`;
}

function renderStream() {
  const el = els.stream;
  if (!el) return;
  const pinned = streamPinned || isPinned(el);
  const top = el.scrollTop;

  if (!state.workspaces.length) {
    el.innerHTML = `<div class="empty">Waiting for an agent to start work.</div>`;
    return;
  }

  const page = state.activity;
  const list = page && Array.isArray(page.items) ? page.items : null;
  if (!list) {
    el.innerHTML = "";
    return;
  }
  if (!list.length) {
    el.innerHTML = `<div class="empty">No activity</div>`;
    return;
  }

  const head = (() => {
    if (!page.truncated && !state.olderItems.length) return "";
    const shown = visibleCount();
    const total = page.total || 0;
    const more = !state.olderExhausted && oldestBefore()
      ? ` <button id="older" type="button"${state.loadingOlder ? " disabled" : ""}>${state.loadingOlder ? "loading…" : "older activity"}</button>`
      : "";
    return `<div class="trunc">showing latest ${shown} of ${total}${more}</div>`;
  })();
  el.innerHTML =
    head +
    visibleRows()
      .map((row) => {
        if (row.type === "fold") {
          const selected = state.selectedId === row.key ? " selected" : "";
          return `<div class="fold row${selected}" data-fold="${esc(row.start)}">membership  ${row.count} events</div>`;
        }
        return renderItem(row.item, row.muted);
      })
      .join("");

  if (pinned) {
    el.scrollTop = el.scrollHeight;
    streamPinned = true;
  } else {
    el.scrollTop = top;
  }
}

function render() {
  rebuildNames();
  renderHeader();
  renderMast();
  renderOrientation();
  renderStream();
}

function items() {
  const latest = state.activity && Array.isArray(state.activity.items) ? state.activity.items : [];
  const older = Array.isArray(state.olderItems) ? state.olderItems : [];
  return older.concat(latest);
}

function visibleCount() {
  return items().length;
}

function oldestBefore() {
  if (state.olderExhausted) return null;
  if (state.olderBefore) return state.olderBefore;
  return state.activity && typeof state.activity.nextBefore === "string"
    ? state.activity.nextBefore
    : null;
}

async function loadOlder() {
  const before = oldestBefore();
  if (!before || state.loadingOlder) return;
  const id = state.workspaceId;
  if (!id) return;
  state.loadingOlder = true;
  render();
  try {
    const page = await api("get_activity", { workspaceId: id, limit: LIMIT, before });
    const older = Array.isArray(page.items) ? page.items : [];
    state.olderItems = older.concat(state.olderItems);
    if (page.truncated && typeof page.nextBefore === "string") {
      state.olderBefore = page.nextBefore;
    } else {
      state.olderBefore = null;
      state.olderExhausted = true;
    }
  } catch (err) {
    state.error = err.message || String(err);
  } finally {
    state.loadingOlder = false;
    render();
  }
}

function toggleFold(key) {
  const k = String(key);
  if (state.foldOpen.has(k)) state.foldOpen.delete(k);
  else state.foldOpen.add(k);
}

function selectorFor(id) {
  if (!id) return null;
  if (id.startsWith("fold:")) return `[data-fold="${CSS.escape(id.slice(5))}"]`;
  // data-id exists only on the outer .item (inner .who has none), so this
  // matches exactly one node and j/k scrolls the highlighted row.
  return `.item[data-id="${CSS.escape(id)}"]`;
}

function moveSelection(delta) {
  const rows = visibleRows();
  if (!rows.length) return;
  const index = rows.findIndex((row) => row.key === state.selectedId);
  let next;
  if (index === -1) next = delta > 0 ? 0 : rows.length - 1;
  else next = Math.max(0, Math.min(rows.length - 1, index + delta));
  state.selectedId = rows[next].key;
  render();
  if (!els.stream) return;
  const sel = selectorFor(state.selectedId);
  const row = sel ? els.stream.querySelector(sel) : null;
  if (row) row.scrollIntoView({ block: "nearest" });
  streamPinned = isPinned(els.stream);
}

function toggleExpand() {
  if (!state.selectedId) return;
  if (state.selectedId.startsWith("fold:")) {
    toggleFold(state.selectedId.slice(5));
    render();
    return;
  }
  const item = items().find((row) => row.id === state.selectedId);
  if (!item || extras(item).length === 0) {
    state.expandedId = null;
    render();
    return;
  }
  state.expandedId = state.expandedId === state.selectedId ? null : state.selectedId;
  render();
}

function shiftWorkspace(delta) {
  const list = state.workspaces;
  if (list.length < 2) return;
  const index = list.findIndex((w) => w.id === state.workspaceId);
  const from = index === -1 ? 0 : index;
  const next = (from + delta + list.length) % list.length;
  setWorkspace(list[next].id);
}

async function refresh() {
  const g = ++gen;
  try {
    const list = await api("list_workspaces");
    if (g !== gen) return;
    state.workspaces = Array.isArray(list) ? list : [];
    ensureWorkspace(state.workspaces);

    const id = state.workspaceId;
    if (!id) {
      state.context = null;
      state.view = null;
      state.activity = null;
      state.error = null;
      render();
      return;
    }

    const cursor = readCursor(id);
    const useSince = Boolean(cursor) && state.sincePending;
    const contextParams = { workspaceId: id };
    if (useSince) contextParams.since = cursor;

    const [context, activity] = await Promise.all([
      api("get_workspace_context", contextParams),
      api("get_activity", { workspaceId: id, limit: LIMIT }),
    ]);
    if (g !== gen || state.workspaceId !== id) return;
    state.context = context;
    if (state.sincePending) {
      // Snapshot the diff only on the first context fetch for this workspace;
      // polling afterwards keeps the frozen "since you were here" view.
      state.sinceRequested = useSince;
      state.sinceView = deriveSinceView(context, useSince);
      state.sincePending = false;
    }
    // Client-side last-seen cursor only; read state is never persisted server-side.
    writeCursor(id, newestContributionId(context));
    // Poll refresh replaces only the latest page; older pages loaded via
    // "older activity" are preserved so history is not silently dropped.
    // If the workspace shrank below what we hold, reset the older cache.
    if (state.olderItems.length) {
      const latestIds = new Set((activity.items || []).map((row) => row.id));
      const overlap = state.olderItems.some((row) => latestIds.has(row.id));
      const total = typeof activity.total === "number" ? activity.total : 0;
      if (!overlap && total < state.olderItems.length + (activity.items || []).length) {
        state.olderItems = [];
        state.olderBefore = typeof activity.nextBefore === "string" ? activity.nextBefore : null;
        state.olderExhausted = !activity.truncated;
      } else {
        state.olderItems = state.olderItems.filter((row) => !latestIds.has(row.id));
      }
    } else {
      state.olderBefore = typeof activity.nextBefore === "string" ? activity.nextBefore : null;
      state.olderExhausted = !activity.truncated;
    }
    state.activity = activity;
    state.error = null;
    render();

    api("get_workspace", { workspaceId: id }).then(
      (view) => {
        if (g !== gen || state.workspaceId !== id) return;
        state.view = view;
        render();
      },
      () => {},
    );
  } catch (err) {
    if (g !== gen) return;
    state.error = err.message || String(err);
    render();
  }
}

if (els.workspace) {
  els.workspace.addEventListener("change", (event) => {
    const id = event.target.value;
    if (id) setWorkspace(id);
  });
}

// Native buttons handle Enter/Space themselves; click keeps one code path.
if (els.perspectiveMine) {
  els.perspectiveMine.addEventListener("click", () => setPerspective("mine"));
}
if (els.perspectiveTeam) {
  els.perspectiveTeam.addEventListener("click", () => setPerspective("team"));
}

if (els.stream) {
  els.stream.addEventListener("click", (event) => {
    const older = event.target.closest("#older");
    if (older && els.stream.contains(older)) {
      event.preventDefault();
      void loadOlder();
      return;
    }
    const fold = event.target.closest("[data-fold]");
    if (fold && els.stream.contains(fold)) {
      const key = fold.getAttribute("data-fold");
      toggleFold(key);
      state.selectedId = foldKey(key);
      state.expandedId = null;
      render();
      return;
    }
    const row = event.target.closest("[data-id]");
    if (!row || !els.stream.contains(row)) return;
    const id = row.getAttribute("data-id");
    state.selectedId = id;
    const item = items().find((entry) => entry.id === id);
    if (!item || extras(item).length === 0) {
      state.expandedId = null;
    } else {
      state.expandedId = state.expandedId === id ? null : id;
    }
    render();
  });

  els.stream.addEventListener("scroll", () => {
    streamPinned = isPinned(els.stream);
  });
}

document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  const tag = target && target.tagName;
  const inField = tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA";

  if (!inField && (event.key === "j" || event.key === "ArrowDown")) {
    event.preventDefault();
    moveSelection(1);
    return;
  }
  if (!inField && (event.key === "k" || event.key === "ArrowUp")) {
    event.preventDefault();
    moveSelection(-1);
    return;
  }
  if (!inField && event.key === "Enter") {
    // A focused native control keeps its own activation; the perspective
    // buttons must stay keyboard-operable.
    if (tag === "BUTTON") return;
    event.preventDefault();
    toggleExpand();
    return;
  }
  if (!inField && (event.key === "p" || event.key === "P")) {
    event.preventDefault();
    setPerspective(state.perspective === "team" ? "mine" : "team");
    return;
  }
  if (event.key === "[") {
    event.preventDefault();
    shiftWorkspace(-1);
    return;
  }
  if (event.key === "]") {
    event.preventDefault();
    shiftWorkspace(1);
    return;
  }
  if (!inField && event.key >= "1" && event.key <= "9") {
    const index = Number(event.key) - 1;
    const ws = state.workspaces[index];
    if (ws) {
      event.preventDefault();
      setWorkspace(ws.id);
    }
  }
});

// Apply the stored perspective before the first render so the shell, the
// aria state, and the panel order cannot disagree.
renderPerspective();

async function boot() {
  try {
    state.whoami = await api("whoami");
  } catch (err) {
    state.error = err.message || String(err);
    render();
  }
  await refresh();
  setInterval(refresh, POLL_MS);
}

boot();
