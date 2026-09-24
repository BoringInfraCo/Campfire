"use strict";

const STORAGE_KEY = "campfire.viewer.workspaceId";
const POLL_MS = 2000;
const LIMIT = 50;

const els = {
  whoami: document.getElementById("whoami"),
  error: document.getElementById("error"),
  workspace: document.getElementById("workspace"),
  mast: document.getElementById("mast"),
  people: document.getElementById("people"),
  goal: document.getElementById("goal"),
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
    return pickById(view && view.tasks, id) || pickById(ctx && ctx.openTasks, id);
  }
  if (type === "finding") {
    return pickById(view && view.findings, id) || pickById(ctx && ctx.findings, id);
  }
  if (type === "decision") {
    return (
      pickById(view && view.decisions, id) ||
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

function kindLabel(item) {
  const payload = payloadOf(item);
  const type = item.objectType;
  const action = item.action;
  if (action === "create" && type === "finding") return "finding";
  if (action === "update" && type === "task" && payload.status === "completed") return "completed";
  if (action === "update" && type === "task") return "task";
  if (action === "create" && type === "task") return "task";
  if (action === "create" && type === "decision") return "decision";
  if ((action === "update" || action === "accept") && type === "decision" && payload.status === "accepted") {
    return "accepted";
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

    const [context, activity] = await Promise.all([
      api("get_workspace_context", { workspaceId: id }),
      api("get_activity", { workspaceId: id, limit: LIMIT }),
    ]);
    if (g !== gen || state.workspaceId !== id) return;
    state.context = context;
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
