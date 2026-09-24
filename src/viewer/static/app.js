"use strict";

const STORAGE_KEY = "campfire.viewer.workspaceId";
const CURSOR_PREFIX = "campfire.viewer.lastSeen.";
const POLL_MS = 2000;
const LIMIT = 50;

const FIRST_VISIT_MESSAGE = "First visit — new activity will appear here.";
const NO_NEW_MESSAGE = "No new activity since you were here.";

const els = {
  whoami: document.getElementById("whoami"),
  error: document.getElementById("error"),
  workspace: document.getElementById("workspace"),
  mast: document.getElementById("mast"),
  people: document.getElementById("people"),
  goal: document.getElementById("goal"),
  alignment: document.getElementById("alignment"),
  nextAction: document.getElementById("next-action"),
  needsYou: document.getElementById("needs-you"),
  needsAttention: document.getElementById("needs-attention"),
  currentWork: document.getElementById("current-work"),
  since: document.getElementById("since"),
  stream: document.getElementById("stream"),
  hint: document.getElementById("hint"),
};

const state = {
  whoami: null,
  workspaces: [],
  workspaceId: null,
  context: null,
  view: null,
  activity: null,
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
  if (type === "decision" && (action === "create" || action === "update" || action === "accept")) {
    const resolved = matchObject(item);
    const status = strField(payload.status, resolved && resolved.status);
    return DECISION_STATUSES.includes(status) ? status : "decision";
  }
  if (action === "create" && type === "finding") return "finding";
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
      els.workspace.innerHTML = `<option value="">No workspaces</option>`;
    } else {
      els.workspace.innerHTML = list
        .map((w) => `<option value="${esc(w.id)}">${esc(w.name)}</option>`)
        .join("");
    }
  }
  const value = state.workspaceId || "";
  if (els.workspace.value !== value) els.workspace.value = value;
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

function attentionItemHtml(item) {
  const meta = [item.kind, item.status].filter(Boolean).join(" · ");
  const metaHtml = meta ? `<span class="ometa">${esc(meta)}</span>` : "";
  const sentence = item.summary || item.id || "";
  const reasonHtml = item.reason ? `<span class="oreason">${esc(item.reason)}</span>` : "";
  return `<li class="oitem">${metaHtml}<span class="osentence">${esc(sentence)}</span>${reasonHtml}</li>`;
}

function renderAttentionList(el, items, emptyText) {
  if (!el) return;
  if (!items.length) {
    el.innerHTML = `<div class="empty">${esc(emptyText)}</div>`;
    return;
  }
  el.innerHTML = `<ul class="olist">${items.map(attentionItemHtml).join("")}</ul>`;
}

function workTaskHtml(task) {
  const status = strField(task.status);
  const title = strField(task.title, task.summary, task.id);
  return `<li class="oitem">${status ? `<span class="ometa">${esc(status)}</span>` : ""}<span class="osentence">${esc(title)}</span></li>`;
}

function workDecisionHtml(decision) {
  const title = strField(decision.summary, decision.title, decision.id);
  return `<li class="oitem"><span class="ometa">accepted</span><span class="osentence">${esc(title)}</span></li>`;
}

function workGroup(label, items, renderItem) {
  if (!items.length) return "";
  return `<div class="ogroup"><div class="ogroup-label">${esc(label)}</div><ul class="olist">${items.map(renderItem).join("")}</ul></div>`;
}

function renderCurrentWork(el, work) {
  if (!el) return;
  const html =
    workGroup("in progress", work.inProgressTasks, workTaskHtml) +
    workGroup("blocked", work.blockedTasks, workTaskHtml) +
    workGroup("accepted decisions", work.acceptedDecisions, workDecisionHtml);
  el.innerHTML = html || `<div class="empty">No current work</div>`;
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

// Orientation hint only: plain text, never an actionable control.
function renderNextAction(el, action) {
  if (!el) return;
  if (!action) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML =
    `<span class="hint-label">SUGGESTED NEXT — orientation hint, not an action</span>` +
    `<span class="hint-summary">${esc(action.summary || action.id)}</span>` +
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
  const accepted = workGroup("accepted", alignment.acceptedDecisionIds, (id) =>
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
    blocked;
}

function renderOrientation() {
  renderAlignment(els.alignment, deriveAlignment(state.context), state.context);
  renderAttentionList(els.needsYou, deriveNeedsYou(state.context), "You're all caught up");
  renderAttentionList(els.needsAttention, deriveNeedsAttention(state.context), "Nothing needs attention");
  renderCurrentWork(els.currentWork, deriveCurrentWork(state.context));
  renderSince(els.since, state.sinceView);
  renderNextAction(els.nextAction, deriveSuggestedNextAction(state.context));
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
    el.innerHTML = `<div class="empty">No workspaces</div>`;
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
    event.preventDefault();
    toggleExpand();
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
