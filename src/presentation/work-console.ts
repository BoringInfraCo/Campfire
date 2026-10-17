/**
 * UIX-001 shared presentation map.
 *
 * One label table for the terminal dashboard and the local Viewer. This module
 * does not decide attention, lifecycle, permission, or presence. It only names
 * fields the service already returned. The Viewer keeps the same sentences in
 * `src/viewer/static/app.js`; tests fail when those sentences drift.
 */

export const ATTENTION_REASON_LABELS = {
  proposed_decision_actionable: "proposed decision — actionable by you, not accepted",
  assigned_blocked_task: "blocked task assigned to you",
  assigned_open_task: "open task assigned to you",
  unassigned_blocked_task: "blocked task with no recorded assignee",
  team_proposed_decision: "proposed decision recorded by the team — not accepted",
  team_blocked_task: "blocked task assigned to another participant",
  team_open_task: "open task — orientation hint only",
  accepted_decision_needs_review: "accepted decision cites non-current evidence — needs human review",
} as const;

export type AttentionReasonCode = keyof typeof ATTENTION_REASON_LABELS;

/** Task and decision lifecycle tokens stay visible. These phrases sit beside them. */
export const TASK_STATUS_LABELS = {
  open: "open",
  in_progress: "in progress",
  blocked: "blocked",
  completed: "completed",
} as const;

export const DECISION_STATUS_LABELS = {
  proposed: "proposed — not accepted, not an instruction",
  accepted: "accepted",
  superseded: "superseded — historical",
  rejected: "rejected — historical",
  retired: "retired — historical",
} as const;

export const ORIENTATION_HINT_LABEL = "orientation hint, not an action";

export const ASSIGNMENT_RECORD_NOTE =
  "Recorded assignment is a record, not a permission: it does not grant or deny a write.";

export const ARTIFACT_REFERENCE_LABEL = "stored reference, not fetched";

/**
 * ARH-001 access caveat, shown on both human surfaces beside an artifact that
 * carries a stored reference. Campfire authorizes reading an Artifact record
 * only; an external target is outside this boundary (AGENTS.md: artifact
 * reference != artifact permission; membership never bypasses the target).
 */
export const ARTIFACT_EXTERNAL_UNVERIFIED_LABEL =
  "external and unverified by Campfire; workspace membership does not grant access";

/** Hostile sweep label: the row is inert because controls were found. */
export const ARTIFACT_UNSAFE_CONTROL_LABEL = "unsafe — control characters; rendered inert";

/**
 * The only deliberate external-open control text. Shown with the parsed
 * destination host, on the Viewer alone; the terminal keeps no open action.
 */
export const ARTIFACT_OPEN_CONTROL_SUFFIX = "(external, unverified)";

export function artifactOpenControlLabel(host: string): string {
  return `Open ${host} ${ARTIFACT_OPEN_CONTROL_SUFFIX}`;
}

export const REGISTERED_AGENTS_LABEL = "registered agents — recorded participants, not live presence";

export const DASHBOARD_COMMAND = "dashboard";

export const DASHBOARD_NON_TTY_MESSAGE =
  "campfire dashboard runs only in an interactive terminal. Use campfire status --output human or campfire status --output json.";

const CONTROL_ESCAPE =
  /\u001B(?:\[[0-?]*[ -/]*[@-~]|\].*?(?:\u0007|\u001B\\)|[@-Z\\-_])/gs;

/** Drop ANSI/OSC/C1 and other controls so record text cannot move the cursor or forge chrome. */
export function stripTerminalControls(value: string): string {
  const withoutEscapes = value.replace(CONTROL_ESCAPE, "");
  let out = "";
  for (const char of withoutEscapes) {
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

export function attentionReasonLabel(reason: string): string {
  if (Object.prototype.hasOwnProperty.call(ATTENTION_REASON_LABELS, reason)) {
    return ATTENTION_REASON_LABELS[reason as AttentionReasonCode];
  }
  return stripTerminalControls(reason);
}

export interface CoverageSlice {
  total: number;
  returned: number;
  truncated: boolean;
}

export interface AttentionCoverageView {
  tasks: CoverageSlice;
  decisions: CoverageSlice;
  completeUnderRules?: boolean;
}

function slicePart(slice: CoverageSlice | undefined): string {
  const returned = slice && typeof slice.returned === "number" ? slice.returned : "?";
  const total = slice && typeof slice.total === "number" ? slice.total : "?";
  const truncated = slice?.truncated === true;
  return `${returned} of ${total}${truncated ? " (truncated)" : ""}`;
}

/** Same sentence the Viewer `attentionCoverageText` renders. */
export function attentionCoverageText(coverage: AttentionCoverageView | undefined): string {
  if (coverage === undefined) return "";
  const truncated = coverage.tasks?.truncated === true || coverage.decisions?.truncated === true;
  const text = `Attention coverage: tasks ${slicePart(coverage.tasks)}, decisions ${slicePart(coverage.decisions)}.`;
  return truncated
    ? `${text} Cues beyond the returned pages may exist.`
    : `${text} Both source pages are complete.`;
}

/** Fraction line for the dashboard header. Counts come from the same coverage object. */
export function attentionCoverageCounts(coverage: AttentionCoverageView | undefined): string {
  if (coverage === undefined) return "coverage not reported";
  const fraction = (slice: CoverageSlice | undefined): string => {
    const returned = slice && typeof slice.returned === "number" ? slice.returned : "?";
    const total = slice && typeof slice.total === "number" ? slice.total : "?";
    return `${returned}/${total}${slice?.truncated === true ? " truncated" : ""}`;
  };
  return `${fraction(coverage.tasks)} tasks · ${fraction(coverage.decisions)} decisions`;
}

/** Same sentences the Viewer `attentionEmptyText` renders. */
export function attentionEmptyText(coverage: AttentionCoverageView | undefined): string {
  if (coverage === undefined) {
    return "No recorded attention cues in the returned records; completeness was not reported.";
  }
  if (coverage.completeUnderRules === true) {
    return "No recorded attention cues match these rules. This does not mean all work is done.";
  }
  return "No cue found in the returned records; more matching records may exist.";
}

export function recordedParticipantLine(humans: number, agents: number): string {
  return `${humans} people · ${agents} registered agents`;
}

export function taskStatusLabel(status: string): string {
  if (Object.prototype.hasOwnProperty.call(TASK_STATUS_LABELS, status)) {
    return TASK_STATUS_LABELS[status as keyof typeof TASK_STATUS_LABELS];
  }
  return stripTerminalControls(status);
}

// --- ARH-001 frozen reference-class taxonomy ---------------------------------
//
// One deterministic classification of the stored Artifact `uriOrPath` (scope
// "CAMPFIRE v1.21 ARH-001 candidate scope" §2, recorded before any code). No
// model, no fetching, no reachability probe, no claim that the target exists.
//
// Frozen precedence (first match wins; this mirrors the code order):
//   none               -> missing/empty reference
//   credential-bearing -> hierarchical userinfo (`user[:pass]@`), or any
//                         `?…` query parameter whose lowercase name is in
//                         the frozen deny-set
//   local path (early) -> single-letter scheme plus a drive-letter form
//                         (`C:\…`, `C:/…`): scheme-shaped text the taxonomy
//                         assigns to local path before any scheme class
//   insecure http      -> scheme `http`, or scheme-relative `//host`
//   openable https     -> scheme `https` AND the strict URL contract below
//   other scheme       -> any other parseable scheme: `file:`, `ftp:`,
//                         `javascript:`, `data:`, and internal record forms
//                         such as `git:<sha>`
//   local path         -> no scheme and path-like: leading `/`, `./`, `../`,
//                         `~/`, or any embedded `/` (relative workspace
//                         paths like `reports/arh-001/working-notes.md`)
//   unparsed           -> anything else, INCLUDING https-shaped references
//                         the strict contract rejects (hostile markup,
//                         spaces, percent-encodings, non-ASCII) — all of
//                         which stay inert labeled text either way
//
// Strict `openable https` contract, the conservative seed the browser anchor
// may trust:
//   - authority over `[A-Za-z0-9._-]+`, optional `:<digits>` port; empty
//     always rejected (non-empty hostname requirement);
//   - everything after the authority must stay inside the frozen safe charset
//     `[A-Za-z0-9\-._~:/?#@!$&()*+,;=]` — no space, quotes, angle brackets,
//     backtick, backslash, `%`, or non-ASCII, so neither a terminal, an
//     attribute boundary, nor a URL re-decode can reinterpret it;
//   - the scheme compare is case-insensitive (WHATWG lowercases schemes); the
//     displayed host stays the stored authority text. A browser parse must
//     accept that URL without changing the announced host.
//
// The hostile sweep (`unsafe`) applies to every class: C0/C1 control
// characters (U+0000–U+001F, U+007F–U+009F) or a newline force the row inert
// labeled unsafe. On the https shape it also removes `openable https`
// eligibility — the row reports `unparsed` instead (Campfire refuses to parse
// a reference it cannot hold inert). It can never become an open control.
//
// Fidelity contract: `src/viewer/static/app.js` carries a direct mirror
// (`classifyArtifactReference`) and
// `fixtures/artifact-handoff/arh-001/reference-samples.json` is the shared
// frozen sample set; a parity test runs both implementations over it so the
// two surfaces cannot drift.
export type ArtifactReferenceClass =
  | "openable https"
  | "insecure http"
  | "credential-bearing"
  | "local path"
  | "other scheme"
  | "unparsed"
  | "none";

export interface ArtifactReferenceClassification {
  class: ArtifactReferenceClass;
  /** Hostile sweep: controls/newline present; row must stay inert. */
  unsafe: boolean;
  /** Stored authority text for "openable https" rows, otherwise null. */
  host: string | null;
  /** The Viewer may render the deliberate open control for this row. */
  openable: boolean;
}

/** Scope §2 query deny-set plus the dated §9 signed-URL correction. */
export const ARTIFACT_CREDENTIAL_QUERY_DENY_SET: ReadonlySet<string> = new Set([
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

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;
const SCHEME_PREFIX = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const OPENABLE_AUTHORITY = /^[A-Za-z0-9._-]+(?::[0-9]{1,5})?$/;
const OPENABLE_REST = /^[A-Za-z0-9\-._~:/?#@!$&()*+,;=]*$/;
const DRIVE_LETTER_PATH = /^[A-Za-z]:[\\/]/;

/** Authority segment of a hierarchical reference: text before any /, ?, or #. */
function authoritySegment(afterSchemeSlashes: string): { authority: string; remainder: string } {
  for (let index = 0; index < afterSchemeSlashes.length; index += 1) {
    const char = afterSchemeSlashes[index];
    if (char === "/" || char === "?" || char === "#") {
      return { authority: afterSchemeSlashes.slice(0, index), remainder: afterSchemeSlashes.slice(index) };
    }
  }
  return { authority: afterSchemeSlashes, remainder: "" };
}

function credentialQueryPresent(reference: string): boolean {
  const queryStart = reference.indexOf("?");
  if (queryStart < 0) return false;
  for (const pair of reference.slice(queryStart + 1).split("&")) {
    const valueStart = pair.indexOf("=");
    const name = (valueStart >= 0 ? pair.slice(0, valueStart) : pair).toLowerCase();
    if (name.length > 0 && ARTIFACT_CREDENTIAL_QUERY_DENY_SET.has(name)) return true;
  }
  return false;
}

function pathLike(reference: string): boolean {
  if (
    reference.startsWith("/") ||
    reference.startsWith("./") ||
    reference.startsWith("../") ||
    reference.startsWith("~/") ||
    DRIVE_LETTER_PATH.test(reference)
  ) {
    return true;
  }
  return reference.includes("/");
}

/** An open control must point to the same host its label announces. */
function browserDestinationMatches(reference: string, authority: string): boolean {
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

export function classifyArtifactReference(reference: unknown): ArtifactReferenceClassification {
  if (typeof reference !== "string" || reference.length === 0 || reference.trim().length === 0) {
    return { class: "none", unsafe: false, host: null, openable: false };
  }
  const unsafe = CONTROL_CHARACTERS.test(reference);
  const schemeMatch = SCHEME_PREFIX.exec(reference);
  const scheme = schemeMatch === null ? null : (schemeMatch[1] ?? "").toLowerCase();
  const schemeLength = schemeMatch === null ? 0 : schemeMatch[1]?.length ?? 0;
  const rest = scheme === null ? reference : reference.slice(schemeLength + 1);
  const hierarchical = rest.startsWith("//");
  let authority = "";
  let remainder = "";
  if (hierarchical) {
    const segment = authoritySegment(rest.slice(2));
    authority = segment.authority;
    remainder = segment.remainder;
  }
  // Userinfo is a structural fact of hierarchical references only, so a
  // non-hierarchical `@` (mailto address, data: payload) never reads as a
  // credential; a deny-set query parameter counts on any reference.
  if (credentialQueryPresent(reference) || (hierarchical && authority.includes("@"))) {
    return { class: "credential-bearing", unsafe, host: null, openable: false };
  }
  // A Windows drive-letter form is a local path even though `C:` is formally
  // scheme-shaped under RFC 3986 — the frozen taxonomy puts it in local path.
  if (scheme !== null && scheme.length === 1 && DRIVE_LETTER_PATH.test(reference)) {
    return { class: "local path", unsafe, host: null, openable: false };
  }
  if (scheme === "http") {
    return { class: "insecure http", unsafe, host: null, openable: false };
  }
  if (scheme === null && hierarchical) {
    return { class: "insecure http", unsafe, host: null, openable: false };
  }
  if (scheme === "https") {
    if (
      authority.length > 0 &&
      OPENABLE_AUTHORITY.test(authority) &&
      OPENABLE_REST.test(remainder) &&
      browserDestinationMatches(reference, authority)
    ) {
      // The strict charset excludes controls, so an eligible row is never unsafe;
      // the explicit check keeps the invariant local to the decision.
      return { class: "openable https", unsafe, host: authority, openable: !unsafe };
    }
    return { class: "unparsed", unsafe, host: null, openable: false };
  }
  if (scheme !== null) {
    return { class: "other scheme", unsafe, host: null, openable: false };
  }
  if (pathLike(reference)) {
    return { class: "local path", unsafe, host: null, openable: false };
  }
  return { class: "unparsed", unsafe, host: null, openable: false };
}

export function decisionStatusLabel(status: string): string {
  if (Object.prototype.hasOwnProperty.call(DECISION_STATUS_LABELS, status)) {
    return DECISION_STATUS_LABELS[status as keyof typeof DECISION_STATUS_LABELS];
  }
  return stripTerminalControls(status);
}

/** Returns labels missing from a Viewer source file. Empty means the sentences match. */
export function viewerLabelDrift(source: string): string[] {
  const expected = [
    ...Object.values(ATTENTION_REASON_LABELS),
    attentionEmptyText(undefined),
    attentionEmptyText({
      tasks: { total: 0, returned: 0, truncated: false },
      decisions: { total: 0, returned: 0, truncated: false },
      completeUnderRules: true,
    }),
    attentionEmptyText({
      tasks: { total: 1, returned: 0, truncated: true },
      decisions: { total: 1, returned: 1, truncated: false },
      completeUnderRules: false,
    }),
    "Attention coverage: tasks ",
    "Cues beyond the returned pages may exist.",
    "Both source pages are complete.",
    ARTIFACT_REFERENCE_LABEL,
    ARTIFACT_EXTERNAL_UNVERIFIED_LABEL,
    ARTIFACT_UNSAFE_CONTROL_LABEL,
    ARTIFACT_OPEN_CONTROL_SUFFIX,
    "Open ",
    ORIENTATION_HINT_LABEL,
  ];
  return expected.filter((label) => !source.includes(label));
}
