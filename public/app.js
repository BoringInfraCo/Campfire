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
  recordedCounts: document.getElementById("recorded-counts"),
  people: document.getElementById("people"),
  goal: document.getElementById("goal"),
  density: document.getElementById("density"),
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
  stage: document.getElementById("stage"),
  lastRead: document.getElementById("last-read"),
  staleNote: document.getElementById("stale-note"),
  retryRefresh: document.getElementById("retry-refresh"),
  ownedNote: document.getElementById("owned-note"),
  sectionAttention: document.getElementById("section-attention"),
  workCoverage: document.getElementById("work-coverage"),
  workList: document.getElementById("work-list"),
  workPrev: document.getElementById("work-prev"),
  workNext: document.getElementById("work-next"),
  peopleCoverage: document.getElementById("people-coverage"),
  peopleList: document.getElementById("people-list"),
  peoplePrev: document.getElementById("people-prev"),
  peopleNext: document.getElementById("people-next"),
  decisionList: document.getElementById("decision-list"),
  sourceView: document.getElementById("source-view"),
  selectionLost: document.getElementById("selection-lost"),
  recordedChanges: document.getElementById("recorded-changes"),
  historyView: document.getElementById("history-view"),
  historyHeading: document.getElementById("history-heading"),
  historyList: document.getElementById("history-list"),
  historyPrev: document.getElementById("history-prev"),
  historyNext: document.getElementById("history-next"),
  panelBack: document.getElementById("panel-back"),
  rowFilter: document.getElementById("row-filter"),
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
  // NAV-003 navigation. Perspective is emphasis, not authorization.
  section: "attention",
  layer: "list",
  rowFilter: "",
  lastReadAt: null,
  stale: false,
  selectionLost: null,
  focusOriginId: null,
  sectionSelection: {
    attention: null,
    work: null,
    decisions: null,
    sources: null,
    people: null,
    changes: null,
  },
  workPage: null,
  peoplePage: null,
  detail: null,
  citedFindings: Object.create(null),
  history: null,
  workGen: 0,
  peopleGen: 0,
  detailGen: 0,
  historyGen: 0,
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

// --- ARH-001 frozen reference classes ----------------------------------------
// Direct mirror of `src/presentation/work-console.ts` (`classifyArtifactReference`,
// scope §2 taxonomy, recorded before code). Rendering fetches nothing, never
// navigates on render, and keeps every unsupported class inert; only the
// openable-https class may carry the explicitly labeled deliberate open
// control. `fixtures/artifact-handoff/arh-001/reference-samples.json` is the
// shared frozen sample set that a parity test runs through BOTH
// implementations so the two surfaces cannot drift.
const ARTIFACT_EXTERNAL_UNVERIFIED_LABEL =
  "external and unverified by Campfire; workspace membership does not grant access";
const ARTIFACT_UNSAFE_CONTROL_LABEL = "unsafe — control characters; rendered inert";
const ARTIFACT_OPEN_CONTROL_SUFFIX = "(external, unverified)";

const OPENABLE_AUTHORITY_RE = /^[A-Za-z0-9._-]+(?::[0-9]{1,5})?$/;
const OPENABLE_REST_RE = /^[A-Za-z0-9\-._~:/?#@!$&()*+,;=]*$/;
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F-\u009F]/;
const SCHEME_RE = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const DRIVE_LETTER_RE = /^[A-Za-z]:[\\/]/;

// Scope §2 query deny-set plus the dated §9 signed-URL correction.
const ARTIFACT_CREDENTIAL_QUERY_DENY_SET = new Set([
  "token",
  "access_token",
  "auth",
  "api_key",
  "apikey",
  "key",
  "password",
  "secret",
  "signature",
  "sig",
  "session",
  "sessionid",
  "x-amz-signature",
  "x-goog-signature",
  "x-amz-credential",
  "x-goog-credential",
  "x-amz-security-token",
  "awsaccesskeyid",
  "googleaccessid",
]);

/** The deliberate open control text: host first, boundary stated in the label. */
function artifactOpenControlLabel(host) {
  return `Open ${host} ${ARTIFACT_OPEN_CONTROL_SUFFIX}`;
}

/** Authority segment of a hierarchical reference: text before any /, ?, or #. */
function artifactReferenceAuthority(afterSlashes) {
  for (let index = 0; index < afterSlashes.length; index += 1) {
    const char = afterSlashes[index];
    if (char === "/" || char === "?" || char === "#") {
      return { authority: afterSlashes.slice(0, index), remainder: afterSlashes.slice(index) };
    }
  }
  return { authority: afterSlashes, remainder: "" };
}

function artifactCredentialQueryPresent(reference) {
  const queryStart = reference.indexOf("?");
  if (queryStart < 0) return false;
  const pairs = reference.slice(queryStart + 1).split("&");
  for (const pair of pairs) {
    const valueStart = pair.indexOf("=");
    const name = (valueStart >= 0 ? pair.slice(0, valueStart) : pair).toLowerCase();
    if (name.length > 0 && ARTIFACT_CREDENTIAL_QUERY_DENY_SET.has(name)) return true;
  }
  return false;
}

function artifactReferencePathLike(reference) {
  if (
    reference.startsWith("/") ||
    reference.startsWith("./") ||
    reference.startsWith("../") ||
    reference.startsWith("~/") ||
    DRIVE_LETTER_RE.test(reference)
  ) {
    return true;
  }
  return reference.includes("/");
}

/** An open control must point to the same host its label announces. */
function artifactBrowserDestinationMatches(reference, authority) {
  try {
    const parsed = new URL(reference);
    return (
      parsed.protocol === "https:" &&
      parsed.host.toLowerCase() === authority.toLowerCase() &&
      /[A-Za-z0-9]/.test(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function classifyArtifactReference(reference) {
  if (typeof reference !== "string" || reference.length === 0 || reference.trim().length === 0) {
    return { class: "none", unsafe: false, host: null, openable: false };
  }
  const unsafe = CONTROL_CHAR_RE.test(reference);
  const schemeMatch = reference.match(SCHEME_RE);
  const scheme = schemeMatch === null ? null : schemeMatch[1].toLowerCase();
  const rest = schemeMatch === null ? reference : reference.slice(schemeMatch[1].length + 1);
  const hierarchical = rest.startsWith("//");
  let authority = "";
  let remainder = "";
  if (hierarchical) {
    const segment = artifactReferenceAuthority(rest.slice(2));
    authority = segment.authority;
    remainder = segment.remainder;
  }
  // Userinfo is a structural fact of hierarchical references only, so a
  // non-hierarchical `@` (mailto address, data: payload) never reads as a
  // credential; a deny-set query parameter counts on any reference.
  if (artifactCredentialQueryPresent(reference) || (hierarchical && authority.indexOf("@") !== -1)) {
    return { class: "credential-bearing", unsafe, host: null, openable: false };
  }
  // A Windows drive-letter form is a local path even though `C:` is formally
  // scheme-shaped under RFC 3986 — the frozen taxonomy puts it in local path.
  if (scheme !== null && scheme.length === 1 && DRIVE_LETTER_RE.test(reference)) {
    return { class: "local path", unsafe, host: null, openable: false };
  }
  if (scheme === "http") {
    return { class: "insecure http", unsafe, host: null, openable: false };
  }
  if (scheme === null && hierarchical) {
    return { class: "insecure http", unsafe, host: null, openable: false };
  }
  if (scheme === "https") {
    if (authority.length > 0 && OPENABLE_AUTHORITY_RE.test(authority) && OPENABLE_REST_RE.test(remainder) && artifactBrowserDestinationMatches(reference, authority)) {
      return { class: "openable https", unsafe, host: authority, openable: !unsafe };
    }
    return { class: "unparsed", unsafe, host: null, openable: false };
  }
  if (scheme !== null) {
    return { class: "other scheme", unsafe, host: null, openable: false };
  }
  if (artifactReferencePathLike(reference)) {
    return { class: "local path", unsafe, host: null, openable: false };
  }
  return { class: "unparsed", unsafe, host: null, openable: false };
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
  if (els.sectionAttention) els.sectionAttention.textContent = value === "team" ? "Needs Attention" : "Needs You";
}

function setPerspective(value) {
  state.perspective = value === "team" ? "team" : "mine";
  persistPerspective(state.perspective);
  renderPerspective();
  reconcileSelection("attention");
  render();
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
  state.layer = "list";
  state.selectionLost = null;
  state.focusOriginId = null;
  state.sectionSelection = {
    attention: null,
    work: null,
    decisions: null,
    sources: null,
    people: null,
    changes: null,
  };
  state.workPage = null;
  state.peoplePage = null;
  state.detail = null;
  state.citedFindings = Object.create(null);
  state.history = null;
  state.workGen += 1;
  state.peopleGen += 1;
  state.detailGen += 1;
  state.historyGen += 1;
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
      els.workspace.innerHTML = `<option value="">No workspace yet</option>`;
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

// Recorded participants only. Registration is not a status.
function recordedCountText(list) {
  let people = 0;
  let agents = 0;
  for (const participant of asArray(list)) {
    const actor = isRecord(participant) ? participant.actor : null;
    const type = isRecord(actor) ? strField(actor.actorType) : "";
    if (type === "human") people += 1;
    else if (type === "agent") agents += 1;
  }
  return `${people} people · ${agents} registered agents`;
}

// `participants: []` with omitted coverage is not an empty roster. The total
// is the authorized count; the human/agent split was not loaded.
function omittedParticipantCoverage(context) {
  const coverage = isRecord(context) ? context.participantsCoverage : null;
  if (!isRecord(coverage) || coverage.omitted !== true) return null;
  return { total: typeof coverage.total === "number" ? coverage.total : null };
}

function renderMast() {
  const coverage = omittedParticipantCoverage(state.context);
  if (els.recordedCounts) {
    if (coverage) {
      els.recordedCounts.textContent =
        coverage.total === null
          ? "Workspace participant count is not in this read."
          : `${coverage.total} workspace participants`;
    } else {
      const list = state.context && Array.isArray(state.context.participants) ? state.context.participants : null;
      els.recordedCounts.textContent = list ? recordedCountText(list) : "";
    }
  }
  if (els.people) {
    if (!state.workspaces.length) {
      els.people.innerHTML = "";
    } else if (coverage) {
      els.people.textContent = "Participant roster is not in this read.";
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
      const idHtml = goal.id ? ` <span class="gid">${esc(goal.id)}</span>` : "";
      els.goal.innerHTML = `<span class="glabel">GOAL</span> ${esc(goal.title)}${idHtml}`;
    } else {
      els.goal.innerHTML = "";
    }
  }
  if (els.lastRead) {
    els.lastRead.textContent = state.lastReadAt ? `Last successful read ${state.lastReadAt}` : "";
  }
  if (els.staleNote) {
    const show = state.stale === true && Boolean(state.lastReadAt);
    els.staleNote.hidden = !show;
    els.staleNote.textContent = show
      ? `Stale. Last successful read ${state.lastReadAt}. The last good view is still shown.`
      : "";
  }
  if (els.retryRefresh) els.retryRefresh.hidden = state.stale !== true;
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
  const kind = esc(strField(item.kind));
  const id = esc(strField(item.id));
  return `<li class="oitem"><button type="button" class="row-btn" data-record-id="${id}" data-record-kind="${kind}">${attentionItemBodyHtml(item)}</button></li>`;
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
function assigneeIdentity(participants, assignee, rosterOmitted) {
  const id = strField(assignee.actorId);
  const type = strField(assignee.actorType, "unknown");
  const match = refByKey(participants, assignee);
  const name = match ? strField(match.name) : "";
  // A missing roster is not proof the name was never recorded.
  if (!name && rosterOmitted) return `(name not in this read) (${type}) ${id}`;
  return `${name || "(name not recorded)"} (${type}) ${id}`;
}

function homeTaskRowHtml(context, task) {
  const participants = isRecord(context) ? context.participants : [];
  const rosterOmitted = omittedParticipantCoverage(context) !== null;
  const status = strField(task.status);
  const title = strField(task.title, task.summary, task.id);
  const id = strField(task.id);
  const assignee = isRecord(task.assignee) ? task.assignee : null;
  const assigned = assignee
    ? `assigned to ${esc(assigneeIdentity(participants, assignee, rosterOmitted))}`
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
  // Ownership is a participant field. The omit read does not carry it, so an
  // empty participants array is not "no owned agents".
  if (omittedParticipantCoverage(context)) {
    return `<div class="ogroup"><div class="ogroup-label">your agents</div><ul class="olist"><li class="oitem"><span class="osentence">Owned-agent relationship is not loaded yet.</span></li></ul></div>`;
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

function myTaskEmptyNote(context, totals) {
  const base = taskGroupEmptyNote(totals);
  if (!omittedParticipantCoverage(context)) return base;
  return `${base}; owned-agent relationship is not loaded yet`;
}

function renderMyWork(el, context, who) {
  if (!el) return;
  const groups = myWorkGroups(context, who);
  const totals = sliceTotals(context);
  const emptyNote = myTaskEmptyNote(context, totals);
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
  const totals = sliceTotals(context);
  const emptyNote = taskGroupEmptyNote(totals);
  // Grouping by person needs the roster. Do not turn the omitted array into
  // an empty team or "name not recorded" for every assignee.
  if (omittedParticipantCoverage(context)) {
    const tasks = collectOpenTasks(context);
    const parts = [];
    parts.push(
      `<div class="ogroup"><div class="ogroup-label">participants</div><ul class="olist"><li class="oitem"><span class="osentence">Participant roster is not in this read.</span></li></ul></div>`,
    );
    parts.push(`<div class="ogroup"><div class="ogroup-label">tasks in this read</div>${groupTasksHtml(context, tasks, emptyNote)}</div>`);
    parts.push(completenessRowHtml("tasks", totals.tasks));
    parts.push(decisionBoundaryHtml(deriveCurrentWork(context), context));
    el.innerHTML = parts.join("");
    return;
  }
  const groups = teamWorkGroups(context);
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
  return `<li class="oitem"><button type="button" class="row-btn" data-record-id="${esc(id)}" data-record-kind="finding"><span class="record-id">${esc(id)}</span></button><span class="ometa">${esc(currentness)}</span><span class="osentence">${esc(summary)}</span><span class="oreason">id ${esc(id)} · ${esc(evidenceText)}</span></li>`;
}

/**
 * ARH-001 cited-by relations, exactly as the same authorized read records
 * them (Finding ID + relation, one entry per recorded evidence row). Nothing
 * is inferred from titles or proximity, and a missing relation is never
 * filled in: the row simply shows what the read carries.
 */
function artifactCitedByText(findings, artifactId) {
  const cites = [];
  const seen = new Set();
  for (const finding of asArray(findings).filter(isRecord)) {
    const findingId = strField(finding.id);
    for (const row of asArray(finding.evidence).filter(isRecord)) {
      if (strField(row.artifactId) !== artifactId) continue;
      const relation = strField(row.relation);
      if (!findingId || !relation) continue;
      const key = `${findingId}\u0000${relation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cites.push(`${findingId} (${relation})`);
    }
  }
  return cites;
}

/**
 * The single deliberate external-open control. Rendered only for the
 * `openable https` class: the stored URL, the destination host repeated in the
 * label, opener and referrer protections, no color-only cue (the label itself
 * states the boundary). Rendering only builds the anchor; navigating is the
 * user's own activation, and the anchor adds no Campfire token and cannot
 * receive one. Everything else stays inert labeled text.
 */
function artifactOpenControlHtml(reference, host) {
  return `<a class="oopen" href="${esc(reference)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${esc(artifactOpenControlLabel(host))}</a>`;
}

function artifactSourceHtml(artifact, findings) {
  const id = strField(artifact.id);
  const type = strField(artifact.type);
  const title = strField(artifact.title, id);
  // The stored reference is text. It is never fetched or previewed, and
  // listing it does not claim the target exists or is accessible.
  const reference = strField(artifact.uriOrPath);
  if (!reference) {
    // No reference recorded: nothing beyond the existing label renders —
    // no class, host, caveat, or open control is invented.
    return `<li class="oitem"><button type="button" class="row-btn" data-record-id="${esc(id)}" data-record-kind="artifact"><span class="record-id">${esc(id)}</span></button><span class="ometa">${esc(type)}</span><span class="osentence">${esc(title)}</span><span class="oreason">id ${esc(id)} · no reference recorded</span></li>`;
  }
  const classification = classifyArtifactReference(reference);
  const parts = [`id ${esc(id)}`, `reference: <code>${esc(reference)}</code> (stored reference, not fetched)`];
  // Class, host, and the open control describe the reference, so a missing
  // reference renders none of them; cited-by is a fact about the artifact
  // record, so it stays independent of the class. This mirrors the terminal
  // row tail in `src/cli/dashboard.ts` (`artifactReferenceTail`) field for
  // field, including the caveat/unsafe pairing.
  if (classification.class !== "none") {
    parts.push(`class ${esc(classification.class)}`);
    if (classification.host !== null) parts.push(`host ${esc(classification.host)}`);
  }
  const cites = artifactCitedByText(findings, id);
  if (cites.length) parts.push(`cited by ${esc(cites.join(", "))}`);
  if (classification.class !== "none") {
    parts.push(ARTIFACT_EXTERNAL_UNVERIFIED_LABEL);
    if (classification.unsafe) parts.push(ARTIFACT_UNSAFE_CONTROL_LABEL);
    if (classification.openable) parts.push(artifactOpenControlHtml(reference, classification.host));
  }
  return `<li class="oitem"><button type="button" class="row-btn" data-record-id="${esc(id)}" data-record-kind="artifact"><span class="record-id">${esc(id)}</span></button><span class="ometa">${esc(type)}</span><span class="osentence">${esc(title)}</span><span class="oreason">${parts.join(" · ")}</span></li>`;
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
// Findings are passed so artifact rows can show the cited-by relations the
// same read records; no extra read and no cross-record inference happens here.
function renderSources(el, context) {
  if (!el) return;
  const totals = sliceTotals(context);
  const slices = isRecord(context) && isRecord(context.slices) ? context.slices : {};
  const allFindings = asArray(isRecord(slices.findings) ? slices.findings.items : undefined).filter(isRecord);
  const allArtifacts = asArray(isRecord(slices.artifacts) ? slices.artifacts.items : undefined).filter(isRecord);
  const query = String(state.rowFilter || "").trim().toLowerCase();
  const findings = query
    ? allFindings.filter((row) => `${strField(row.id)} ${strField(row.summary)}`.toLowerCase().includes(query))
    : allFindings;
  const artifacts = query
    ? allArtifacts.filter((row) => `${strField(row.id)} ${strField(row.title)} ${strField(row.uriOrPath)}`.toLowerCase().includes(query))
    : allArtifacts;
  const parts = [];
  const findingBody =
    query && allFindings.length && !findings.length
      ? `<div class="empty">no shown row matches the filter. Filter matches loaded rows only.</div>`
      : sourceListHtml(findings.map(findingSourceHtml), "findings", totals);
  const artifactBody =
    query && allArtifacts.length && !artifacts.length
      ? `<div class="empty">no shown row matches the filter. Filter matches loaded rows only.</div>`
      : sourceListHtml(artifacts.map((artifact) => artifactSourceHtml(artifact, allFindings)), "artifacts", totals);
  parts.push(`<div class="ogroup"><div class="ogroup-label">current findings</div>${findingBody}</div>`);
  parts.push(`<div class="ogroup"><div class="ogroup-label">artifact references</div>${artifactBody}</div>`);
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
  renderOwnedNote(homeState);
  const filterQuery = String(homeState.rowFilter || "").trim().toLowerCase();
  const needsYou = deriveNeedsYou(homeState.context);
  const needsAttention = deriveNeedsAttention(homeState.context);
  const attentionText = (item) => `${strField(item.id)} ${strField(item.summary)} ${strField(item.status)} ${strField(item.reason)}`;
  const shownYou = filterQuery ? needsYou.filter((item) => attentionText(item).toLowerCase().includes(filterQuery)) : needsYou;
  const shownAttention = filterQuery
    ? needsAttention.filter((item) => attentionText(item).toLowerCase().includes(filterQuery))
    : needsAttention;
  if (filterQuery && needsYou.length && !shownYou.length) renderFilterMiss(homeEls.needsYou, coverageText);
  else renderAttentionList(homeEls.needsYou, shownYou, emptyText, coverageText);
  if (filterQuery && needsAttention.length && !shownAttention.length) renderFilterMiss(homeEls.needsAttention, coverageText);
  else renderAttentionList(homeEls.needsAttention, shownAttention, emptyText, coverageText);
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
  const objectType = strField(item.objectType);
  const objectId = strField(item.objectId);
  const recordAttr =
    (objectType === "task" || objectType === "decision" || objectType === "finding" || objectType === "artifact") && objectId
      ? ` data-record-id="${esc(objectId)}" data-record-kind="${esc(objectType)}"`
      : "";
  return `<div class="item${mutedClass}${selected}" data-id="${esc(item.id)}"${recordAttr}>
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

const LOCAL_EMPTY_WORKSPACE =
  "No workspace to show yet. After your agent has the Campfire tools loaded, describe the work you want to do; your agent can create the workspace and goal.";
const JOINED_EMPTY_WORKSPACE =
  "No workspace to show yet. This Viewer is for work you joined. It does not create a local workspace.";

function emptyWorkspaceSentence() {
  const root = typeof document !== "undefined" ? document.documentElement : null;
  const hint = root && typeof root.getAttribute === "function" ? root.getAttribute("data-workspace-hint") : null;
  return hint === "joined" ? JOINED_EMPTY_WORKSPACE : LOCAL_EMPTY_WORKSPACE;
}

function renderStream() {
  const el = els.stream;
  if (!el) return;
  const pinned = streamPinned || isPinned(el);
  const top = el.scrollTop;

  if (!state.workspaces.length) {
    el.innerHTML = `<div class="empty">${emptyWorkspaceSentence()}</div>`;
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

const NAV_SECTIONS = ["attention", "work", "decisions", "sources", "people", "changes"];
const WORK_PAGE_LIMIT = 20;
const PEOPLE_PAGE_LIMIT = 20;
const HISTORY_PAGE_LIMIT = 10;
const CURSOR_STACK_LIMIT = 32;
const RECORD_KINDS = ["task", "decision", "finding", "artifact"];
const DECISION_STATUS_LABELS = {
  proposed: "proposed — not accepted, not an instruction",
  accepted: "accepted",
  superseded: "superseded — historical",
  rejected: "rejected — historical",
  retired: "retired — historical",
};

function stripControls(value) {
  let out = "";
  for (const char of String(value ?? "")) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      out += " ";
      continue;
    }
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) continue;
    out += char;
  }
  return out;
}

function visibleText(value) {
  return stripControls(value);
}

function renderFilterMiss(el, coverageText) {
  if (!el) return;
  const coverageHtml =
    typeof coverageText === "string" && coverageText.length ? `<div class="coverage">${esc(coverageText)}</div>` : "";
  el.innerHTML = `<div class="empty">no shown row matches the filter. Filter matches loaded rows only.</div>${coverageHtml}`;
}

function renderOwnedNote(homeState) {
  if (!els.ownedNote) return;
  const view = homeState || state;
  if (view.perspective === "team" || !omittedParticipantCoverage(view.context)) {
    els.ownedNote.hidden = true;
    els.ownedNote.textContent = "";
    return;
  }
  const who = callerRef(view.whoami);
  const page = state.peoplePage;
  const ownerId = who && who.actorType === "human" ? who.actorId : "";
  if (
    page &&
    ownerId &&
    page.humanOwnerId === ownerId &&
    page.workspaceId === state.workspaceId &&
    !page.error
  ) {
    els.ownedNote.hidden = false;
    els.ownedNote.textContent =
      page.truncated === true
        ? "Owned-agent page is incomplete. More participating agents may exist."
        : `Owned agents in this workspace: returned ${page.returned} of ${page.total}. Registration is not presence.`;
    return;
  }
  els.ownedNote.hidden = false;
  els.ownedNote.textContent = "Owned-agent relationship is not loaded yet.";
}

function decisionStatusText(status) {
  const token = strField(status);
  if (Object.prototype.hasOwnProperty.call(DECISION_STATUS_LABELS, token)) return DECISION_STATUS_LABELS[token];
  return visibleText(token);
}

function pageContinuation(page, failed) {
  if (failed) return "not complete";
  if (!page) return "not loaded";
  if (page.truncated === true && page.nextCursor) return "another API page exists";
  if (page.truncated === true) return "truncated; no further cursor was returned";
  return "no further API page";
}

function canPageNext(page) {
  return Boolean(page && page.truncated === true && page.nextCursor);
}

function coverageSentence(page, failed) {
  if (!page) return "not loaded";
  if (page.loading && !page.readAt) return "loading";
  if (!page.readAt && page.error) return `unavailable — ${page.error}. This read is not complete.`;
  const returned = typeof page.returned === "number" ? page.returned : "?";
  const total = typeof page.total === "number" ? page.total : "?";
  const stale = page.stale || page.error ? " · stale" : "";
  return `returned ${returned} of ${total} · page ${page.pageNumber} · ${pageContinuation(page, failed)}${stale}`;
}

function matchesRowFilter(text) {
  const query = String(state.rowFilter || "").trim().toLowerCase();
  if (!query) return true;
  return String(text).toLowerCase().includes(query);
}

function workRowHtml(task) {
  const id = strField(task.id);
  const title = visibleText(strField(task.title, task.summary, id));
  const status = visibleText(strField(task.status));
  return `<button type="button" class="row-btn" data-record-id="${esc(id)}" data-record-kind="task"><span class="record-id">${esc(id)}</span> <span>${esc(status)}</span> <span>${esc(title)}</span></button>`;
}

function peopleRowHtml(item) {
  const actor = isRecord(item.actor) ? item.actor : {};
  const type = strField(actor.actorType);
  const id = strField(actor.actorId);
  const name = visibleText(strField(item.name, id));
  const kind = type === "human" ? "human" : "agent";
  const bits = [type === "human" ? "human" : "registered agent", id];
  const harness = strField(item.harness);
  if (harness) bits.push(`harness ${harness}`);
  if (type === "agent") {
    const owner = strField(item.humanOwnerId);
    bits.push(owner ? `owner ${owner}` : "no recorded owner");
    if (item.humanOwnerIsParticipant === false) bits.push("owner is outside the roster");
    else if (item.humanOwnerIsParticipant === true) bits.push("owner is a workspace participant");
  }
  bits.push("registration is not presence");
  return `<button type="button" class="row-btn" data-record-id="${esc(id)}" data-record-kind="${esc(kind)}"><span class="record-id">${esc(id)}</span> <span>${esc(name)}</span> <span>${esc(bits.join(" · "))}</span></button>`;
}

function decisionSectionRows(context) {
  if (!isRecord(context)) return [];
  const rows = [];
  const seen = new Set();
  const push = (decision) => {
    if (!isRecord(decision)) return;
    const id = strField(decision.id);
    if (!id || seen.has(id)) return;
    seen.add(id);
    rows.push(decision);
  };
  for (const decision of asArray(context.proposedDecisions)) push(decision);
  for (const decision of asArray(context.acceptedDecisions)) push(decision);
  for (const decision of asArray(context.supersededDecisions)) push(decision);
  const slices = isRecord(context.slices) ? context.slices : {};
  const decisions = isRecord(slices.decisions) ? slices.decisions.items : [];
  for (const decision of asArray(decisions)) push(decision);
  return rows;
}

function decisionRowHtml(decision) {
  const id = strField(decision.id);
  const status = strField(decision.status);
  const label = decisionStatusText(status);
  const summary = visibleText(strField(decision.summary, decision.title, id));
  const review = needsReview(decision);
  const cited = reviewFindingIds(decision);
  const parts = [`status ${status || "unrecorded"}`, label];
  if (review && status === "accepted") {
    parts.push("needs review — acceptance is unchanged");
    if (cited.length) parts.push(`non-current citations: ${cited.join(", ")}`);
  }
  const transitions = decisionTransitionParts(decision);
  if (transitions.length) parts.push(transitions.join(" · "));
  return `<button type="button" class="row-btn" data-record-id="${esc(id)}" data-record-kind="decision"><span class="record-id">${esc(id)}</span> <span>${esc(summary)}</span> <span>${esc(parts.join(" · "))}</span></button>`;
}

function idsInSection(section) {
  if (section === "work") return asArray(state.workPage && state.workPage.items).map((row) => strField(row.id));
  if (section === "people") {
    return asArray(state.peoplePage && state.peoplePage.items).map((row) =>
      strField(isRecord(row) && isRecord(row.actor) ? row.actor.actorId : ""),
    );
  }
  if (section === "attention") {
    const list = state.perspective === "team" ? deriveNeedsAttention(state.context) : deriveNeedsYou(state.context);
    return list.map((row) => strField(row.id));
  }
  if (section === "decisions") return decisionSectionRows(state.context).map((row) => strField(row.id));
  if (section === "sources") {
    const ids = [];
    if (isRecord(state.context)) {
      for (const row of asArray(state.context.findings)) if (isRecord(row)) ids.push(strField(row.id));
      for (const row of asArray(state.context.artifacts)) if (isRecord(row)) ids.push(strField(row.id));
    }
    return ids;
  }
  if (section === "changes") return items().map((row) => strField(row.id));
  return [];
}

function reconcileSelection(section) {
  const id = state.sectionSelection ? state.sectionSelection[section] : null;
  if (!id) return;
  if (idsInSection(section).indexOf(id) !== -1) return;
  state.sectionSelection[section] = null;
  state.selectionLost = `Selection ${id} is not in the loaded result.`;
  if (state.detail && state.detail.id === id) {
    state.layer = "list";
    state.detailGen += 1;
    state.historyGen += 1;
    state.history = null;
  }
}

function findIn(list, id) {
  for (const row of asArray(list)) {
    if (isRecord(row) && strField(row.id) === id) return row;
  }
  return null;
}

function findLocalRecord(kind, id) {
  if (kind === "human" || kind === "agent" || kind === "participant") {
    for (const item of asArray(state.peoplePage && state.peoplePage.items)) {
      if (isRecord(item) && isRecord(item.actor) && item.actor.actorId === id) return item;
    }
    return null;
  }
  const context = isRecord(state.context) ? state.context : {};
  const work = isRecord(context.currentWork) ? context.currentWork : {};
  const slices = isRecord(context.slices) ? context.slices : {};
  if (kind === "task") {
    return (
      findIn(state.workPage && state.workPage.items, id) ||
      findIn(context.openTasks, id) ||
      findIn(work.inProgressTasks, id) ||
      findIn(work.blockedTasks, id) ||
      findIn(isRecord(slices.tasks) ? slices.tasks.items : [], id)
    );
  }
  if (kind === "decision") {
    return (
      findIn(context.proposedDecisions, id) ||
      findIn(context.acceptedDecisions, id) ||
      findIn(context.supersededDecisions, id) ||
      findIn(isRecord(slices.decisions) ? slices.decisions.items : [], id)
    );
  }
  if (kind === "finding") {
    return findingById(id);
  }
  if (kind === "artifact") {
    return (
      findIn(context.artifacts, id) || findIn(isRecord(slices.artifacts) ? slices.artifacts.items : [], id)
    );
  }
  return null;
}

function recordIsFull(kind, record) {
  if (!isRecord(record)) return false;
  if (kind === "human" || kind === "agent" || kind === "participant") return isRecord(record.actor);
  if (kind === "task") return typeof record.createdAt === "string" || isRecord(record.createdBy);
  if (kind === "decision") {
    return typeof record.createdAt === "string" || typeof record.rationale === "string" || Array.isArray(record.citations);
  }
  if (kind === "finding") return typeof record.currentness === "string" && (typeof record.summary === "string" || typeof record.createdAt === "string");
  if (kind === "artifact") return typeof record.type === "string" || typeof record.uriOrPath === "string";
  return false;
}

function findingById(id) {
  if (state.citedFindings && isRecord(state.citedFindings[id])) return state.citedFindings[id];
  const context = isRecord(state.context) ? state.context : {};
  const slices = isRecord(context.slices) ? context.slices : {};
  return findIn(context.findings, id) || findIn(isRecord(slices.findings) ? slices.findings.items : [], id);
}

function attentionReasonFor(id) {
  const lists = deriveNeedsYou(state.context).concat(deriveNeedsAttention(state.context));
  for (const item of lists) {
    if (strField(item.id) === id && strField(item.reason)) return strField(item.reason);
  }
  return "";
}

function sourceRecordHtml(kind, record) {
  if (!isRecord(record)) return `<p>This read did not include the record.</p>`;
  if (kind === "human" || kind === "agent" || kind === "participant") {
    const actor = isRecord(record.actor) ? record.actor : {};
    const lines = [
      `<p class="record-id">id ${esc(strField(actor.actorId))}</p>`,
      `<p>type ${esc(strField(actor.actorType))}</p>`,
      `<p>role ${esc(visibleText(strField(record.role)))}</p>`,
    ];
    if (strField(record.harness)) lines.push(`<p>harness ${esc(visibleText(record.harness))}</p>`);
    if (strField(record.joinedAt)) lines.push(`<p>joinedAt ${esc(record.joinedAt)}</p>`);
    if (actor.actorType === "agent") {
      const owner = strField(record.humanOwnerId);
      lines.push(`<p>owner ${esc(owner || "no recorded owner")}</p>`);
      if (record.humanOwnerIsParticipant === false) lines.push("<p>owner is outside the roster</p>");
      else if (record.humanOwnerIsParticipant === true) lines.push("<p>owner is a workspace participant</p>");
      lines.push("<p>Registration is not presence.</p>");
    } else {
      lines.push("<p>Membership is not presence or permission to act.</p>");
    }
    return lines.join("");
  }
  const lines = [`<p class="record-id">id ${esc(strField(record.id))}</p>`, `<p>type ${esc(kind)}</p>`];
  const status = strField(record.status);
  if (status) lines.push(`<p>status ${esc(status)} · ${esc(decisionStatusText(kind === "decision" ? status : status))}</p>`);
  if (kind === "task" && status) lines.push(`<p>lifecycle ${esc(visibleText(status))}. A status is not a running process.</p>`);
  const currentness = strField(record.currentness);
  if (currentness) lines.push(`<p>currentness ${esc(visibleText(currentness))}</p>`);
  const title = strField(record.title, record.summary);
  if (title) lines.push(`<p>${esc(visibleText(title))}</p>`);
  const rationale = strField(record.rationale);
  if (rationale) lines.push(`<p>rationale ${esc(visibleText(rationale))}</p>`);
  lines.push(actorLine("recorded actor", record.createdBy) || actorLine("recorded actor", record.actor));
  if (strField(record.createdAt)) lines.push(`<p>createdAt ${esc(record.createdAt)}</p>`);
  if (strField(record.updatedAt)) lines.push(`<p>updatedAt ${esc(record.updatedAt)}</p>`);
  lines.push(actorLine("assignee", record.assignee));
  lines.push(actorLine("approved by", record.approvedBy));
  if (kind === "decision" && (record.needsReview === true || reviewFindingIds(record).length)) {
    // needsReview is computed for any non-superseded decision that cites
    // non-current evidence. Only an accepted decision has an acceptance to leave unchanged.
    if (status === "accepted") lines.push("<p>needs review — acceptance is unchanged</p>");
    const reason = attentionReasonFor(strField(record.id));
    if (reason) lines.push(`<p>review reason ${esc(attentionReasonLabel(reason))}</p>`);
    const cited = reviewFindingIds(record);
    if (cited.length) lines.push(`<p>non-current citations: ${esc(cited.join(", "))}</p>`);
    for (const findingId of cited) {
      const finding = findingById(findingId);
      if (!finding) {
        lines.push(`<p>cited finding ${esc(findingId)} currentness is not in this read</p>`);
        continue;
      }
      lines.push(
        `<p>cited finding ${esc(findingId)} currentness ${esc(visibleText(strField(finding.currentness, "unrecorded")))}</p>`,
      );
      if (strField(finding.successorId)) lines.push(`<p>successor ${esc(finding.successorId)}</p>`);
    }
  }
  for (const row of asArray(record.citations).filter(isRecord)) {
    const citeId = strField(row.id);
    const findingId = strField(row.findingId);
    const note = strField(row.note);
    if (!citeId && !findingId) continue;
    lines.push(
      `<p>citation ${esc(citeId)} finding ${esc(findingId)}${note ? ` note ${esc(visibleText(note))}` : ""}</p>`,
    );
  }
  for (const row of asArray(record.evidence).filter(isRecord)) {
    const artifactId = strField(row.artifactId);
    const relation = strField(row.relation);
    if (!artifactId && !strField(row.id)) continue;
    lines.push(`<p>evidence ${esc(strField(row.id))} artifact ${esc(artifactId)} relation ${esc(visibleText(relation))}</p>`);
  }
  const transitions = decisionTransitionParts(record);
  if (transitions.length) lines.push(`<p>${esc(transitions.join(" · "))}</p>`);
  if (kind === "artifact") {
    const findings = isRecord(state.context) ? asArray(state.context.findings) : [];
    lines.push(artifactSourceHtml(record, findings));
  }
  return lines.filter(Boolean).join("");
}

function actorLine(label, actor) {
  if (!isRecord(actor)) return "";
  const type = strField(actor.actorType);
  const id = strField(actor.actorId);
  if (!type && !id) return "";
  return `<p>${esc(label)} ${esc(type)} ${esc(id)}</p>`;
}

function applyPage(result, request, extra) {
  const items = asArray(result && result.items).filter(isRecord);
  return {
    workspaceId: state.workspaceId,
    items,
    total: result && typeof result.total === "number" ? result.total : null,
    returned: result && typeof result.returned === "number" ? result.returned : items.length,
    truncated: Boolean(result && result.truncated === true),
    nextCursor: result && typeof result.nextCursor === "string" ? result.nextCursor : null,
    pageNumber: request.pageNumber,
    cursor: request.cursor || null,
    cursorStack: asArray(request.cursorStack).slice(-CURSOR_STACK_LIMIT),
    readAt: new Date().toISOString(),
    error: null,
    stale: false,
    loading: false,
    ...extra,
  };
}

async function fetchWorkPage(request) {
  const workspaceId = state.workspaceId;
  if (!workspaceId) return;
  const gen = ++state.workGen;
  const params = { workspaceId, limit: WORK_PAGE_LIMIT };
  if (request.cursor) params.cursor = request.cursor;
  try {
    const result = await api("list_tasks", params);
    if (gen !== state.workGen || state.workspaceId !== workspaceId || state.section !== "work") return;
    state.workPage = applyPage(result, request, {});
    reconcileSelection("work");
  } catch (err) {
    if (gen !== state.workGen || state.workspaceId !== workspaceId || state.section !== "work") return;
    const message = err.message || String(err);
    if (state.workPage && state.workPage.workspaceId === workspaceId) {
      state.workPage.stale = true;
      state.workPage.error = message;
    } else {
      state.workPage = {
        workspaceId,
        items: [],
        total: null,
        returned: 0,
        truncated: false,
        nextCursor: null,
        pageNumber: request.pageNumber,
        cursor: request.cursor || null,
        cursorStack: asArray(request.cursorStack),
        readAt: null,
        error: message,
        stale: false,
        loading: false,
      };
    }
  }
  if (gen === state.workGen && state.section === "work" && state.workspaceId === workspaceId) render();
}

function ensureWorkPage() {
  if (!state.workspaceId) return null;
  if (state.workPage && state.workPage.workspaceId === state.workspaceId && state.workPage.readAt && !state.workPage.error) return null;
  return fetchWorkPage({ pageNumber: 1, cursor: null, cursorStack: [] });
}

function pageWork(direction) {
  const page = state.workPage;
  if (!page) return null;
  if (direction === "next") {
    if (!canPageNext(page)) return null;
    return fetchWorkPage({
      cursor: page.nextCursor,
      pageNumber: page.pageNumber + 1,
      cursorStack: page.cursorStack.concat([{ cursor: page.cursor, pageNumber: page.pageNumber }]),
    });
  }
  const previous = page.cursorStack[page.cursorStack.length - 1];
  if (!previous) return null;
  return fetchWorkPage({
    cursor: previous.cursor,
    pageNumber: previous.pageNumber,
    cursorStack: page.cursorStack.slice(0, -1),
  });
}

async function fetchPeoplePage(request) {
  const workspaceId = state.workspaceId;
  if (!workspaceId) return;
  const gen = ++state.peopleGen;
  const params = { workspaceId, limit: PEOPLE_PAGE_LIMIT };
  if (request.cursor) params.cursor = request.cursor;
  if (request.humanOwnerId) params.humanOwnerId = request.humanOwnerId;
  try {
    const result = await api("list_workspace_participants", params);
    if (gen !== state.peopleGen || state.workspaceId !== workspaceId || state.section !== "people") return;
    state.peoplePage = applyPage(result, request, { humanOwnerId: request.humanOwnerId || null });
    reconcileSelection("people");
  } catch (err) {
    if (gen !== state.peopleGen || state.workspaceId !== workspaceId || state.section !== "people") return;
    const message = err.message || String(err);
    if (state.peoplePage && state.peoplePage.workspaceId === workspaceId) {
      state.peoplePage.stale = true;
      state.peoplePage.error = message;
    } else {
      state.peoplePage = {
        workspaceId,
        items: [],
        total: null,
        returned: 0,
        truncated: false,
        nextCursor: null,
        pageNumber: request.pageNumber,
        cursor: request.cursor || null,
        cursorStack: asArray(request.cursorStack),
        humanOwnerId: request.humanOwnerId || null,
        readAt: null,
        error: message,
        stale: false,
        loading: false,
      };
    }
  }
  if (gen === state.peopleGen && state.section === "people" && state.workspaceId === workspaceId) render();
}

function ensurePeoplePage() {
  if (!state.workspaceId) return null;
  if (state.peoplePage && state.peoplePage.workspaceId === state.workspaceId && state.peoplePage.readAt && !state.peoplePage.error) return null;
  return fetchPeoplePage({ pageNumber: 1, cursor: null, cursorStack: [], humanOwnerId: null });
}

function openHumanAgents(humanId) {
  const page = state.peoplePage;
  const stack = page
    ? page.cursorStack.concat([{ cursor: page.cursor, pageNumber: page.pageNumber, humanOwnerId: page.humanOwnerId || null }])
    : [];
  return fetchPeoplePage({ humanOwnerId: humanId, pageNumber: 1, cursor: null, cursorStack: stack });
}

function pagePeople(direction) {
  const page = state.peoplePage;
  if (!page) return;
  if (direction === "next") {
    if (!canPageNext(page)) return;
    void fetchPeoplePage({
      cursor: page.nextCursor,
      pageNumber: page.pageNumber + 1,
      cursorStack: page.cursorStack.concat([
        { cursor: page.cursor, pageNumber: page.pageNumber, humanOwnerId: page.humanOwnerId || null },
      ]),
      humanOwnerId: page.humanOwnerId || null,
    });
    return;
  }
  const previous = page.cursorStack[page.cursorStack.length - 1];
  if (!previous) return;
  void fetchPeoplePage({
    cursor: previous.cursor,
    pageNumber: previous.pageNumber,
    cursorStack: page.cursorStack.slice(0, -1),
    humanOwnerId: previous.humanOwnerId || null,
  });
}

async function loadMissingFindings(gen, workspaceId, decision) {
  const ids = [];
  for (const id of reviewFindingIds(decision)) ids.push(id);
  for (const row of asArray(decision.citations).filter(isRecord)) {
    const id = strField(row.findingId);
    if (id) ids.push(id);
  }
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (gen !== state.detailGen || state.workspaceId !== workspaceId) return;
    if (!state.detail || state.detail.id !== strField(decision.id)) return;
    if (findingById(id)) continue;
    try {
      const finding = await api("get_finding", { workspaceId, findingId: id });
      if (gen !== state.detailGen || state.workspaceId !== workspaceId) return;
      if (!state.detail || state.detail.id !== strField(decision.id)) return;
      state.citedFindings[id] = finding;
      render();
    } catch (err) {
      if (gen !== state.detailGen) return;
    }
  }
}

async function selectRecord(kind, id) {
  if (!id) return;
  state.focusOriginId = id;
  if (state.sectionSelection) state.sectionSelection[state.section] = id;
  state.selectionLost = null;
  if (kind === "human") {
    state.layer = "list";
    state.historyGen += 1;
    state.history = null;
    openHumanAgents(id);
    render();
    return;
  }
  const gen = ++state.detailGen;
  state.historyGen += 1;
  state.history = null;
  state.layer = "source";
  const local = findLocalRecord(kind, id);
  const full = recordIsFull(kind, local);
  state.detail = { id, kind, record: local, loading: !full, error: null, method: full ? "loaded" : null };
  state.citedFindings = Object.create(null);
  render();
  if (!state.workspaceId) return;
  if (full) {
    if (kind === "decision" && local) void loadMissingFindings(gen, state.workspaceId, local);
    return;
  }
  if (RECORD_KINDS.indexOf(kind) === -1) {
    state.detail.loading = false;
    render();
    return;
  }
  const workspaceId = state.workspaceId;
  try {
    const record = await api(`get_${kind}`, { workspaceId, [`${kind}Id`]: id });
    if (gen !== state.detailGen || state.workspaceId !== workspaceId || !state.detail || state.detail.id !== id) return;
    state.detail = { id, kind, record, loading: false, error: null, method: `get_${kind}` };
    if (kind === "decision") void loadMissingFindings(gen, workspaceId, record);
  } catch (err) {
    if (gen !== state.detailGen || !state.detail || state.detail.id !== id) return;
    state.detail.loading = false;
    state.detail.error = err.message || String(err);
    state.detail.stale = Boolean(local);
  }
  if (gen === state.detailGen) render();
}

async function fetchHistory(request) {
  const workspaceId = state.workspaceId;
  const history = state.history;
  if (!workspaceId || !history || history.open !== true) return;
  const objectType = history.objectType;
  const objectId = history.objectId;
  const gen = ++state.historyGen;
  const params = { workspaceId, objectType, objectId, limit: HISTORY_PAGE_LIMIT };
  if (request.cursor) params.cursor = request.cursor;
  try {
    const result = await api("get_record_history", params);
    if (gen !== state.historyGen || state.workspaceId !== workspaceId) return;
    if (!state.history || state.history.open !== true || state.history.objectId !== objectId || state.history.objectType !== objectType) return;
    state.history.error = null;
    state.history.page = applyPage(historyPageResult(result), request, {});
  } catch (err) {
    if (gen !== state.historyGen || state.workspaceId !== workspaceId) return;
    if (!state.history || state.history.objectId !== objectId) return;
    state.history.error = err.message || String(err);
    if (state.history.page) state.history.page.stale = true;
  }
  if (gen === state.historyGen) render();
}

function openRecordedChanges() {
  const detail = state.detail;
  if (!detail || RECORD_KINDS.indexOf(detail.kind) === -1) return null;
  state.layer = "history";
  state.history = {
    open: true,
    objectType: detail.kind,
    objectId: detail.id,
    page: null,
    selectedId: null,
    error: null,
  };
  const pending = fetchHistory({ pageNumber: 1, cursor: null, cursorStack: [] });
  render();
  return pending;
}

function pageHistory(direction) {
  const history = state.history;
  const page = history && history.page;
  if (!history || history.open !== true || !page) return;
  if (direction === "next") {
    if (!canPageNext(page)) return;
    void fetchHistory({
      cursor: page.nextCursor,
      pageNumber: page.pageNumber + 1,
      cursorStack: page.cursorStack.concat([{ cursor: page.cursor, pageNumber: page.pageNumber }]),
    });
    return;
  }
  const previous = page.cursorStack[page.cursorStack.length - 1];
  if (!previous) return;
  void fetchHistory({
    cursor: previous.cursor,
    pageNumber: previous.pageNumber,
    cursorStack: page.cursorStack.slice(0, -1),
  });
}

function historyPageResult(result) {
  if (!isRecord(result)) return result;
  return {
    ...result,
    items: asArray(result.items).map((entry) => {
      if (!isRecord(entry) || !Object.prototype.hasOwnProperty.call(entry, "payload")) return entry;
      const copy = {};
      for (const key of Object.keys(entry)) {
        if (key === "payload") continue;
        copy[key] = entry[key];
      }
      return copy;
    }),
  };
}

function historyPayloadSummary(entry) {
  return typeof entry.payloadSummary === "string" ? visibleText(entry.payloadSummary) : "";
}

function historyRowHtml(entry) {
  const actor = isRecord(entry.actor) ? entry.actor : {};
  const session = strField(entry.agentSessionId);
  const summary = historyPayloadSummary(entry);
  const current = state.history && state.history.selectedId === entry.id ? ` aria-current="true"` : "";
  return `<button type="button" class="row-btn" data-history-id="${esc(strField(entry.id))}"${current}><span class="record-id">${esc(strField(entry.id))}</span> <span>${esc(strField(actor.actorType))} ${esc(strField(actor.actorId))}</span>${session ? ` <span>agent session ${esc(session)}</span>` : ""} <span>${esc(visibleText(strField(entry.action)))}</span> <span>${esc(strField(entry.createdAt))}</span>${summary ? ` <span>payload ${esc(summary)}</span>` : ""}</button>`;
}

function historyRecordedEmpty(page, errored) {
  return Boolean(page && page.total === 0 && !errored && page.stale !== true && page.truncated !== true);
}

function historyHeadingText(history) {
  if (!history) return "Recorded changes";
  if (history.error && !history.page) return `Recorded changes are unavailable. ${history.error} This read is not complete.`;
  const page = history.page;
  if (!page) return "Recorded changes are loading.";
  if (historyRecordedEmpty(page, history.error)) return "No contributions were recorded for this record.";
  const returned = typeof page.returned === "number" ? page.returned : "?";
  const total = typeof page.total === "number" ? page.total : "?";
  const stale = page.stale || history.error ? " stale" : "";
  const continuation =
    page.total === 0 && page.truncated === true && !history.error
      ? "This read is not complete"
      : pageContinuation(page, Boolean(history.error));
  return `Recorded changes returned ${returned} of ${total}. ${continuation}.${stale}`;
}

function filteredPageItems(items, textOf) {
  return asArray(items).filter((row) => matchesRowFilter(textOf(row)));
}

function listHtml(rows, emptyText) {
  if (!rows.length) {
    const query = String(state.rowFilter || "").trim();
    if (query) return `<div class="empty">no shown row matches the filter. Filter matches loaded rows only.</div>`;
    return `<div class="empty">${esc(emptyText)}</div>`;
  }
  return rows.join("");
}

function renderNavigation() {
  if (els.stage) {
    els.stage.setAttribute("data-section", state.section);
    els.stage.setAttribute("data-layer", state.layer);
  }
  if (typeof document !== "undefined" && document.getElementById) {
    for (const name of NAV_SECTIONS) {
      const button = document.getElementById(`section-${name}`);
      if (button && button.setAttribute) button.setAttribute("aria-pressed", state.section === name ? "true" : "false");
    }
  }
  const workFailed = Boolean(state.workPage && state.workPage.error);
  if (els.workCoverage) {
    const page = state.workPage;
    els.workCoverage.textContent = page ? coverageSentence(page, workFailed) : "not loaded";
  }
  if (els.workList) {
    const page = state.workPage;
    if (!page) els.workList.innerHTML = `<div class="empty">Work is not loaded.</div>`;
    else if (!page.readAt && page.error) els.workList.innerHTML = `<div class="empty">${esc(page.error)} This read is not complete.</div>`;
    else {
      const rows = filteredPageItems(page.items, (task) => `${strField(task.id)} ${strField(task.title)} ${strField(task.status)}`);
      const html = listHtml(rows.map(workRowHtml), "No tasks were returned on this page.");
      els.workList.innerHTML = page.items.length && !rows.length ? `<div class="empty">no shown row matches the filter. Filter matches loaded rows only.</div>` : html;
    }
  }
  if (els.workPrev) els.workPrev.disabled = !(state.workPage && state.workPage.cursorStack.length);
  if (els.workNext) els.workNext.disabled = !canPageNext(state.workPage);

  const people = state.peoplePage;
  if (els.peopleCoverage) {
    if (!people) els.peopleCoverage.textContent = "not loaded";
    else {
      const who = people.humanOwnerId ? `workspace-participating agents for ${people.humanOwnerId} · ` : "";
      els.peopleCoverage.textContent = `${who}${coverageSentence(people, Boolean(people.error))}`;
    }
  }
  if (els.peopleList) {
    if (!people) els.peopleList.innerHTML = `<div class="empty">People is not loaded.</div>`;
    else if (!people.readAt && people.error) els.peopleList.innerHTML = `<div class="empty">${esc(people.error)} This read is not complete.</div>`;
    else {
      const rows = filteredPageItems(people.items, (item) => {
        const actor = isRecord(item.actor) ? item.actor : {};
        return `${strField(actor.actorId)} ${strField(item.name)} ${strField(actor.actorType)} ${strField(item.humanOwnerId)}`;
      });
      const empty = people.humanOwnerId
        ? "No workspace-participating agents were returned for this owner."
        : "No participants were returned on this page.";
      els.peopleList.innerHTML =
        people.items.length && !rows.length
          ? `<div class="empty">no shown row matches the filter. Filter matches loaded rows only.</div>`
          : listHtml(rows.map(peopleRowHtml), empty);
    }
  }
  if (els.peoplePrev) els.peoplePrev.disabled = !(people && people.cursorStack.length);
  if (els.peopleNext) els.peopleNext.disabled = !canPageNext(people);

  if (els.decisionList) {
    const decisions = decisionSectionRows(state.context).filter((decision) =>
      matchesRowFilter(`${strField(decision.id)} ${strField(decision.summary)} ${strField(decision.status)}`),
    );
    const all = decisionSectionRows(state.context);
    els.decisionList.innerHTML =
      all.length && !decisions.length
        ? `<div class="empty">no shown row matches the filter. Filter matches loaded rows only.</div>`
        : listHtml(decisions.map(decisionRowHtml), "No decisions in this orientation read.");
  }

  if (els.selectionLost) {
    const text = state.selectionLost || "";
    els.selectionLost.hidden = !text;
    els.selectionLost.textContent = text;
  }
  if (els.sourceView) {
    const detail = state.detail;
    if (!detail || state.layer === "list") {
      els.sourceView.innerHTML = `<p>No selected record.</p>`;
    } else if (detail.loading && !detail.record) {
      els.sourceView.innerHTML = `<p class="record-id">id ${esc(detail.id)}</p><p>Loading this record.</p>`;
    } else {
      const failed = detail.error ? `<p>${esc(detail.error)} This read is not complete.</p>` : "";
      els.sourceView.innerHTML = sourceRecordHtml(detail.kind, detail.record) + failed;
    }
  }
  const historyOpen = Boolean(state.history && state.history.open && state.layer === "history");
  const canHistory = Boolean(state.detail && RECORD_KINDS.indexOf(state.detail.kind) !== -1 && state.layer !== "list");
  if (els.recordedChanges) els.recordedChanges.hidden = !canHistory;
  if (els.historyView) els.historyView.hidden = !historyOpen;
  if (els.historyHeading) els.historyHeading.textContent = historyHeadingText(state.history);
  if (els.historyList) {
    const page = state.history && state.history.page;
    if (!historyOpen) els.historyList.innerHTML = "";
    else if (state.history && state.history.error && !page) {
      els.historyList.innerHTML = `<div class="empty">${esc(state.history.error)} This read is not complete.</div>`;
    } else if (!page) els.historyList.innerHTML = `<div class="empty">Recorded changes are loading.</div>`;
    else if (page.total === 0 && page.truncated === true) {
      els.historyList.innerHTML = `<div class="empty">This read is not complete.</div>`;
    } else if (historyRecordedEmpty(page, state.history.error)) {
      els.historyList.innerHTML = `<div class="empty">No contributions were recorded for this record.</div>`;
    } else {
      const rows = filteredPageItems(page.items, (entry) => `${strField(entry.id)} ${strField(entry.action)}`);
      els.historyList.innerHTML = rows.length
        ? rows.map(historyRowHtml).join("")
        : `<div class="empty">no shown row matches the filter. Filter matches loaded rows only.</div>`;
    }
  }
  if (els.historyPrev) els.historyPrev.disabled = !(state.history && state.history.page && state.history.page.cursorStack.length);
  if (els.historyNext) els.historyNext.disabled = !canPageNext(state.history && state.history.page);
  if (els.panelBack) {
    const peopleBack = Boolean(state.section === "people" && people && people.cursorStack.length);
    els.panelBack.hidden = state.layer === "list" && !peopleBack;
  }
}

function setSection(name) {
  if (NAV_SECTIONS.indexOf(name) === -1 || name === state.section) return null;
  state.section = name;
  state.layer = "list";
  state.historyGen += 1;
  state.history = null;
  const pending = name === "work" ? ensureWorkPage() : name === "people" ? ensurePeoplePage() : null;
  render();
  return pending;
}

function focusRecordButton(id) {
  if (!id || typeof document === "undefined" || !document.querySelectorAll) return;
  const nodes = document.querySelectorAll("[data-record-id]");
  for (const node of nodes) {
    if (node.getAttribute("data-record-id") === id && node.focus) {
      node.focus();
      return;
    }
  }
}

function captureFocus() {
  try {
    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (!active || !active.getAttribute) return null;
    return {
      id: active.id || "",
      recordId: active.getAttribute("data-record-id"),
      historyId: active.getAttribute("data-history-id"),
    };
  } catch (err) {
    return null;
  }
}

function restoreFocus(saved) {
  if (!saved) return;
  if (saved.id && typeof document !== "undefined" && document.getElementById) {
    const node = document.getElementById(saved.id);
    if (node && node.focus) {
      node.focus();
      return;
    }
  }
  focusRecordButton(saved.recordId);
}

function closeTopLayer() {
  const origin = state.focusOriginId;
  if (state.layer === "history") {
    state.layer = "source";
    state.historyGen += 1;
    if (state.history) state.history.open = false;
    render();
    focusRecordButton(origin);
    return;
  }
  if (state.layer === "source") {
    state.layer = "list";
    state.detailGen += 1;
    render();
    focusRecordButton(origin);
  }
}

function panelBack() {
  if (state.layer === "history" || state.layer === "source") {
    closeTopLayer();
    return;
  }
  if (state.section === "people" && state.peoplePage && state.peoplePage.cursorStack.length) pagePeople("prev");
}

function render() {
  const savedFocus = captureFocus();
  rebuildNames();
  renderHeader();
  renderMast();
  renderPerspective();
  renderOrientation();
  renderStream();
  renderNavigation();
  restoreFocus(savedFocus);
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
    // Normal orientation omits the roster. get_workspace stays allowlisted
    // and is not requested on this path, including the poll.
    const contextParams = { workspaceId: id, participants: "omit" };
    if (useSince) contextParams.since = cursor;

    const [context, activity] = await Promise.all([
      api("get_workspace_context", contextParams),
      api("get_activity", { workspaceId: id, limit: LIMIT }),
    ]);
    if (g !== gen || state.workspaceId !== id) return;
    state.context = context;
    // The full inspector is not part of this refresh. Drop a leftover view
    // only after the orientation read succeeds, so a failure keeps the last
    // good state instead of a false empty roster.
    state.view = null;
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
    state.lastReadAt = new Date().toISOString();
    state.stale = false;
    reconcileSelection("attention");
    reconcileSelection("decisions");
    reconcileSelection("sources");
    render();
  } catch (err) {
    if (g !== gen) return;
    state.error = err.message || String(err);
    if (state.lastReadAt) state.stale = true;
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

// Local display preference only. It is not a workspace object and does not read
// or write Campfire state.
const DENSITY_KEY = "campfire-viewer-density";

function readStoredDensity() {
  try {
    if (typeof localStorage !== "undefined" && localStorage) {
      return localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
    }
  } catch (err) {
    // A display preference is a convenience; storage may be unavailable.
  }
  return "comfortable";
}

function persistDensity(value) {
  try {
    if (typeof localStorage !== "undefined" && localStorage) {
      localStorage.setItem(DENSITY_KEY, value);
    }
  } catch (err) {
    // Never fail a render over a preference.
  }
}

function applyDensity(mode) {
  const value = mode === "compact" ? "compact" : "comfortable";
  const root = typeof document !== "undefined" && document.documentElement ? document.documentElement : null;
  if (root) {
    if (!root.dataset) root.dataset = {};
    root.dataset.density = value;
  }
  if (els.density) els.density.setAttribute("aria-pressed", value === "compact" ? "true" : "false");
  return value;
}

function toggleDensity() {
  const root = typeof document !== "undefined" && document.documentElement ? document.documentElement : null;
  const current = root && root.dataset && root.dataset.density === "compact" ? "compact" : "comfortable";
  const next = current === "compact" ? "comfortable" : "compact";
  applyDensity(next);
  persistDensity(next);
}

if (els.density) {
  els.density.addEventListener("click", () => {
    toggleDensity();
  });
}

if (els.rowFilter) {
  els.rowFilter.addEventListener("input", (event) => {
    state.rowFilter = event.target && event.target.value ? event.target.value : "";
    render();
  });
}
if (els.workPrev) els.workPrev.addEventListener("click", () => pageWork("prev"));
if (els.workNext) els.workNext.addEventListener("click", () => pageWork("next"));
if (els.peoplePrev) els.peoplePrev.addEventListener("click", () => pagePeople("prev"));
if (els.peopleNext) els.peopleNext.addEventListener("click", () => pagePeople("next"));
if (els.historyPrev) els.historyPrev.addEventListener("click", () => pageHistory("prev"));
if (els.historyNext) els.historyNext.addEventListener("click", () => pageHistory("next"));
if (els.panelBack) els.panelBack.addEventListener("click", () => panelBack());
if (els.recordedChanges) els.recordedChanges.addEventListener("click", () => openRecordedChanges());
if (els.retryRefresh) els.retryRefresh.addEventListener("click", () => { void refresh(); });

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!target || !target.closest) return;
  if (target.closest(".oopen")) return;
  const sectionBtn = target.closest("#sections button[data-section]");
  if (sectionBtn) {
    setSection(sectionBtn.getAttribute("data-section"));
    return;
  }
  const historyBtn = target.closest("[data-history-id]");
  if (historyBtn && state.history) {
    state.history.selectedId = historyBtn.getAttribute("data-history-id");
    render();
    return;
  }
  const row = target.closest("[data-record-id]");
  if (!row) return;
  void selectRecord(row.getAttribute("data-record-kind") || "", row.getAttribute("data-record-id") || "");
});

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

function focusedKeyList(event) {
  const target = event && event.target;
  if (!target || !target.closest) return null;
  return target.closest("[data-key-list]");
}

function moveWithinList(list, delta) {
  if (!list || !list.querySelectorAll) return;
  const name = list.getAttribute ? list.getAttribute("data-key-list") : "";
  if (name === "history") {
    const buttons = list.querySelectorAll("[data-history-id]");
    if (!buttons.length || !state.history) return;
    let index = -1;
    buttons.forEach((button, position) => {
      if (button.getAttribute("data-history-id") === state.history.selectedId) index = position;
    });
    const next = index === -1 ? (delta > 0 ? 0 : buttons.length - 1) : Math.max(0, Math.min(buttons.length - 1, index + delta));
    const historyId = buttons[next].getAttribute("data-history-id");
    state.history.selectedId = historyId;
    render();
    if (typeof document !== "undefined" && document.querySelectorAll) {
      for (const node of document.querySelectorAll("[data-history-id]")) {
        if (node.getAttribute("data-history-id") === historyId && node.focus) {
          node.focus();
          return;
        }
      }
    }
    return;
  }
  const buttons = list.querySelectorAll("[data-record-id]");
  if (!buttons.length) return;
  const current = state.sectionSelection[state.section];
  let index = -1;
  buttons.forEach((button, position) => {
    if (button.getAttribute("data-record-id") === current) index = position;
  });
  const next = index === -1 ? (delta > 0 ? 0 : buttons.length - 1) : Math.max(0, Math.min(buttons.length - 1, index + delta));
  const recordId = buttons[next].getAttribute("data-record-id");
  state.sectionSelection[state.section] = recordId;
  render();
  focusRecordButton(recordId);
}

document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  const tag = target && target.tagName;
  const inField = tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA";

  if (event.key === "Escape") {
    if (inField) return;
    if (state.layer === "list" && !(state.section === "people" && state.peoplePage && state.peoplePage.cursorStack.length)) return;
    event.preventDefault();
    panelBack();
    return;
  }
  // j/k and arrows move only inside a list the person has focused. They do not
  // steal page scrolling, text entry, or a screen reader's browse cursor.
  if (!inField && (event.key === "j" || event.key === "ArrowDown" || event.key === "k" || event.key === "ArrowUp")) {
    const list = focusedKeyList(event);
    if (!list) return;
    event.preventDefault();
    moveWithinList(list, event.key === "j" || event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (!inField && event.key === "Enter") {
    // A focused native control keeps its own activation; the perspective
    // buttons must stay keyboard-operable.
    if (tag === "BUTTON" || tag === "A") return;
    const list = focusedKeyList(event);
    if (list && list.getAttribute("data-key-list") === "changes") {
      event.preventDefault();
      toggleExpand();
    }
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

// Apply stored display preferences before the first render so the shell and
// the aria state cannot disagree. Density is read again at the start of boot.
applyDensity(readStoredDensity());
renderPerspective();

async function boot() {
  applyDensity(readStoredDensity());
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
