/**
 * Gate E evidence helper — sanitized packet record for a claim-H observation.
 *
 *   npx tsx scripts/gate-e/packet-evidence.ts <packet-file> [--output auto|human|json]
 *
 * It takes an already-written handoff packet file and prints a sanitized,
 * committable evidence record. It writes nothing to disk, spawns nothing,
 * touches no Campfire record, and modifies no packet.
 *
 * Why it exists. `docs/GATE_E_PROTOCOL.md` §9 requires an H observation to
 * retain "a sanitized account of the packet fields used and a checkable
 * reference to the recipient's resulting work", and §9 keeps private packet
 * bytes out of the repository. Before this helper, nothing in the repository
 * could produce the first half of that pairing. This produces it.
 *
 * What it is not. §3.1.4 and §5.4 are explicit that a packet is not resulting
 * work: an H observation also needs a dated, recipient-authored work product or
 * action that can be checked against the packet. This record does not
 * establish that, does not check for it, and is not by itself an observation.
 * The README beside this file states the limits in full.
 *
 * Determinism. The record is a pure function of the packet. It carries no run
 * timestamp, no input path, no file name, and no machine identity, so two runs
 * over the same packet produce byte-identical output. That is what makes the
 * emitted record checkable later.
 *
 * What is reused, not re-implemented:
 *   - `serializeHandoffPacket` — re-serializes the object this helper read and
 *     enforces `HANDOFF_PACKET_MAX_BYTES`, so the byte cap stays the domain's.
 *   - `deriveDecisionSetState` — the packet's own `state`, `operativeDecisionId`,
 *     `beforeActing`, and `linkedNextStep` are re-derived and compared. The
 *     packet is never trusted about its own decision safety.
 *   - `recordedDecisionTransitions` — the transition list the verdict is derived
 *     from is rebuilt from the members' own `predecessorId` / `successorId`.
 *     A packet whose `recordedTransitions` disagrees with its own members is
 *     refused, so "re-derived" cannot mean "the packet agreed with itself".
 *   - `decodeContextCursor` + `assertCursorWorkspace` — the pre-action cursor
 *     is decoded and its workspace checked against the packet's.
 *   - `boundRecallText` with the `RECALL_*_MAX_*` constants — every copied text
 *     field is bounded by the domain's own limits and marked truncated.
 *   - `capIdList` — relation id lists are capped at the domain's limit.
 *   - `ID_PREFIXES`, `HANDOFF_PACKET_SCHEMA_VERSION`, `RECALL_ORDERING_VERSION`,
 *     and `ValidationError`.
 *
 * The one rule this helper cannot delegate is refusing to commit a packet that
 * carries a credential, a path or URI, or a foreign workspace id. The packet
 * writer never puts those in a packet, but this helper reads packets written by
 * other means, so it checks rather than assumes.
 */
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertCursorWorkspace, decodeContextCursor } from "../../src/domain/context-policy.js";
import { ValidationError } from "../../src/domain/errors.js";
import { ID_PREFIXES } from "../../src/domain/ids.js";
import {
  HANDOFF_PACKET_MAX_BYTES,
  HANDOFF_PACKET_SCHEMA_VERSION,
  RECALL_EXCERPT_MAX_BYTES,
  RECALL_GOAL_TEXT_MAX_BYTES,
  RECALL_NAME_MAX_BYTES,
  RECALL_QUERY_MAX_CHARS,
  RECALL_ORDERING_VERSION,
  boundRecallText,
  capIdList,
  deriveDecisionSetState,
  recordedDecisionTransitions,
  serializeHandoffPacket,
  type CampfireHandoffPacket,
  type HandoffCount,
  type RecallDecisionSetState,
  type RecallDecisionTransition,
} from "../../src/domain/recall.js";
import type {
  ActorType,
  ArtifactType,
  DecisionStatus,
  FindingCurrentness,
  GoalStatus,
  TaskStatus,
} from "../../src/domain/types.js";

/** The protocol version this record is written against. `docs/GATE_E_PROTOCOL.md` §0. */
const PROTOCOL_VERSION = "gate-e-1";
const RECORD_KIND = "GateEPacketEvidence";
const RECEIPT_KIND = "GateEPacketEvidenceReceipt";
const USAGE = [
  "Usage: npx tsx scripts/gate-e/packet-evidence.ts <packet-file> [--output auto|human|json]",
  "",
  "Reads one already-written Campfire handoff packet file and prints a sanitized,",
  "committable Gate E evidence record for a claim-H observation. Writes nothing.",
  "",
  "Options:",
  "  --output <mode>   auto|human|json (default auto). auto prints human on a TTY.",
  "  --json            Compatibility alias for --output json.",
  "  --help            Print this text.",
  "",
  "Exit codes: 0 record emitted, 1 invalid packet or unreadable file,",
  "2 refused (the packet is well formed but must not be committed).",
].join("\n");

/* ------------------------------------------------------------------------- *
 * Refusals
 *
 * A refusal writes nothing and prints why. Every detector is deliberately
 * conservative: a false refusal costs one edited text field, a false pass puts
 * a credential or a private path into a committed file.
 * ------------------------------------------------------------------------- */

interface Refusal {
  rule: string;
  why: string;
  where: string;
}

/**
 * `cft_` raw tokens and `cfe_` enrollment secrets, per `generateRawToken`.
 *
 * The anchor is "not preceded by an alphanumeric", not `\b`. `_` is a word
 * character, so a `\b` anchor silently misses every credential that appears
 * after an id prefix — `agent_cft_ZZZ999`, `dec_cft_ABCD1234`,
 * `ses_cft_QQQWWW111` — and those are exactly the fields the record copies
 * verbatim into the committed record.
 */
const CREDENTIAL_SHAPE = /(?<![A-Za-z0-9])cf[te]_[A-Za-z0-9_-]+/;

/**
 * Path-like look-alikes are normalized before any path rule runs.
 *
 * Every path pattern below is ASCII. A string spelled with a fullwidth slash
 * or a fullwidth full stop is the same path, and is copied into the record
 * verbatim, so the detectors must see the ASCII form to have a chance at it.
 */
const PATH_LOOKALIKES: ReadonlyArray<readonly [string, string]> = [
  ["／", "/"], // FULLWIDTH SOLIDUS
  ["＼", "\\"], // FULLWIDTH REVERSE SOLIDUS
  ["∕", "/"], // DIVISION SLASH
  ["⁄", "/"], // FRACTION SLASH
  ["⧵", "/"], // REVERSE SOLIDUS OPERATOR
  ["．", "."], // FULLWIDTH FULL STOP
  ["～", "~"], // FULLWIDTH TILDE
  ["：", ":"], // FULLWIDTH COLON
];

function normalizePathLookalikes(value: string): string {
  return value.replace(/[／＼∕⁄⧵．～：]/gu, (char) =>
    PATH_LOOKALIKES.find(([from]) => from === char)?.[1] ?? char,
  );
}

/**
 * Any `scheme:` prefix. Schemes are not enumerable, so the rule classifies the
 * *shape* rather than the scheme: a scheme token, a colon, and a slash-ish
 * continuation anywhere in the same run with no whitespace. `file:/…`,
 * `sqlite:/var/lib/x.db`, `postgres:///db`, and `path:/private/var/db` all
 * reach the record otherwise, because `uri-authority` needs `://` and the
 * delimiter-anchored path rules exclude `:` as a preceding character.
 *
 * The left anchor excludes alphanumerics, `.`, `-`, and `+` so this cannot fire
 * on an ISO timestamp (`…T15:00:22Z`), a domain prose line, or the id-shaped
 * `agent_…:…` shapes. The right anchor requires a `/`, `\`, or `~`, so ordinary
 * `label: prose` text is not treated as a URI.
 */
const OPAQUE_SCHEME_SHAPE = /(?<![A-Za-z0-9.+-])[a-zA-Z][a-zA-Z0-9+.-]{1,31}:(?=[^\s]*[/\\~])/;

const PATH_RULES: ReadonlyArray<{ rule: string; why: string; pattern: RegExp }> = [
  { rule: "uri-authority", why: "a URI with an authority", pattern: /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s]*/ },
  { rule: "uri-opaque", why: "a URI without an authority", pattern: /\b(?:mailto|tel|data|javascript|vscode|obsidian):[^\s]*/i },
  { rule: "uri-opaque-scheme", why: "a URI scheme with an opaque path", pattern: OPAQUE_SCHEME_SHAPE },
  // A drive letter can follow any delimiter, so the anchor is "not preceded by
  // an alphanumeric" rather than `\b`: `\b` does not fire inside `xC:\`.
  { rule: "windows-drive-path", why: "a Windows drive path", pattern: /(?<![A-Za-z0-9])[A-Za-z]:[\\/]/ },
  // `\\` at the start is the UNC lead-in; the rest of the run is enough to fire.
  { rule: "unc-path", why: "a UNC network path", pattern: /\\\\[^\s]+/ },
  // `~user/…` as well as `~/…`: a named home is a home.
  { rule: "home-path", why: "a home directory reference", pattern: /(?:^|[\s("'\[=,;])~(?:[A-Za-z0-9._-]+[\\/]|[\\/]|$)/ },
  { rule: "root-reference", why: "a bare home directory reference", pattern: /(?:^|[\s("'\[=,;])~(?:$|\s)/ },
  // The separator is a whitespace or an opening delimiter, never `:` or `/`:
  // those belong to a URI, which the first rule above already reports.
  { rule: "absolute-path", why: "an absolute filesystem path", pattern: /(?:^|[\s("'\[=,;])\/[^\s"'<>|*?]+/ },
  { rule: "root-path", why: "the filesystem root path", pattern: /(?:^|[\s("'\[=,;])\/(?:$|[\s)"'\],;])/ },
  { rule: "relative-path", why: "a relative filesystem path", pattern: /(?:^|[\s("'\[=,;])\.{1,2}(?:\/[^\s"'<>|*?]+)+/ },
  // The tool's own truncation marker is `[truncated at N bytes]`, never a bare
  // `N/M` fraction, so it cannot match this rule. It must not: a packet whose
  // own bounded field was cut is legitimate, and refusing it names the tool's
  // rendering as the leaked path.
  { rule: "relative-segment-path", why: "a slash-separated relative path", pattern: /(?:^|[\s("'\[=,;])(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+(?=$|[\s)"'\],;])/ },
];

/** Every string value and field name, with a path that never quotes untrusted keys. */
function stringValues(value: unknown, path: string, out: Array<{ path: string; value: string }>): void {
  if (typeof value === "string") {
    out.push({ path, value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => stringValues(entry, `${path}[${index}]`, out));
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      const segment = /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(key) ? key : "<field>";
      out.push({ path: `${path}.${segment} (field name)`, value: key });
      stringValues(entry, `${path}.${segment}`, out);
    }
  }
}

/**
 * Refusal reasons never quote the matched text. A reason that printed the
 * string it refused would put the credential on stderr and into whatever log
 * captured it; only the field path is reported.
 */
function credentialRefusals(strings: ReadonlyArray<{ path: string; value: string }>): Refusal[] {
  return strings
    .filter((entry) => CREDENTIAL_SHAPE.test(entry.value))
    .map((entry) => ({
      rule: "credential",
      why: "a Campfire credential shape (cft_ or cfe_)",
      where: entry.path,
    }));
}

function pathRefusals(strings: ReadonlyArray<{ path: string; value: string }>): Refusal[] {
  const found: Refusal[] = [];
  for (const { pattern, rule, why } of PATH_RULES) {
    for (const entry of strings) {
      pattern.lastIndex = 0;
      if (pattern.test(normalizePathLookalikes(entry.value))) {
        found.push({ rule, why, where: entry.path });
        break;
      }
    }
  }
  return found;
}

/**
 * Any workspace id in the content must be the packet's own workspace id.
 *
 * Anchored on "not preceded by an alphanumeric" rather than `\b`, for the same
 * reason `CREDENTIAL_SHAPE` is: `\b` does not fire between `x` and `ws_`, so
 * `hum_other_ws_zzz` would pass.
 */
function foreignWorkspaceRefusals(
  strings: ReadonlyArray<{ path: string; value: string }>,
  ownWorkspaceId: string,
): Refusal[] {
  const pattern = new RegExp(`(?<![A-Za-z0-9])${ID_PREFIXES.workspace}_[A-Za-z0-9][A-Za-z0-9_-]*`, "g");
  const found: Refusal[] = [];
  for (const entry of strings) {
    pattern.lastIndex = 0;
    for (const match of entry.value.matchAll(pattern)) {
      if (match[0] !== ownWorkspaceId) {
        found.push({
          rule: "foreign-workspace-id",
          why: "a workspace id other than this packet's own",
          where: entry.path,
        });
        break;
      }
    }
  }
  return found;
}

function describeRefusals(refusals: readonly Refusal[]): string {
  const lines = refusals.map((refusal) => `  ${refusal.rule}: ${refusal.why} — ${refusal.where}`);
  return [`REFUSED — ${refusals.length} rule(s) matched. No record was written.`, ...lines].join("\n");
}

/* ------------------------------------------------------------------------- *
 * Shape guard
 *
 * A packet file is untrusted input. This checks that the fields the record
 * copies are present and correctly typed, and that no unknown key hides
 * alongside them. It is not a second copy of the domain rules: the rules this
 * helper must not re-derive are delegated to the domain above.
 * ------------------------------------------------------------------------- */

function invalid(message: string, field: string): never {
  throw new ValidationError(message, { field });
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(`${path} must be an object`, path);
  }
  return value as Record<string, unknown>;
}

function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) return invalid(`${path} must be an array`, path);
  return value;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    return invalid(`${path} must be a non-empty string`, path);
  }
  return value;
}

function optionalStringAt(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return stringAt(value, path);
}

function numberAt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return invalid(`${path} must be a number`, path);
  return value;
}

function countAt(value: unknown, path: string): number {
  const count = numberAt(value, path);
  if (!Number.isInteger(count) || count < 0) return invalid(`${path} must be a non-negative integer`, path);
  return count;
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return invalid(`${path} must be a boolean`, path);
  return value;
}

function required(value: unknown, path: string): unknown {
  if (value === undefined) return invalid(`${path} is required`, path);
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return invalid(`${path} must be one of ${allowed.join("|")}`, path);
  }
  return value as T;
}

/** An unknown key is refused: the record copies nothing it has not read. */
function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalid(`${path} has an unknown field`, path);
  }
}

const PACKET_KEYS = [
  "schemaVersion",
  "kind",
  "orderingVersion",
  "offlineCopy",
  "sensitiveOfflineCopy",
  "fullHistoryIncluded",
  "authority",
  "workspace",
  "query",
  "generatedAt",
  "sourceCursor",
  "sourcePosition",
  "issuer",
  "recipient",
  "goal",
  "records",
  "decisionSet",
  "anchors",
  "completeness",
  "omissions",
] as const;

const RECORD_KEYS = [
  "section",
  "kind",
  "id",
  "lifecycle",
  "text",
  "textTruncated",
  "provenance",
  "predecessorId",
  "successorId",
  "evidenceArtifactIds",
  "basisFindingIds",
  "relationshipIdsTruncated",
  "needsReview",
  "needsReviewFindingIds",
  "rationale",
  "rationaleTruncated",
  "historicalExplanation",
] as const;

const DECISION_SET_KEYS = [
  "members",
  "total",
  "returned",
  "truncated",
  "state",
  "operativeDecisionId",
  "recordedTransitions",
  "beforeActing",
  "linkedNextStep",
] as const;

const TRANSITION_KEYS = ["supersededDecisionId", "supersedingDecisionId"] as const;

const PROVENANCE_KEYS = ["createdBy", "agentSessionId", "createdAt"] as const;

const GOAL_KEYS = ["id", "title", "description", "status", "matched", "textTruncated"] as const;

const COMPLETENESS_KEYS = ["fullHistoryIncluded", "anchors", "recall", "drillDown", "catchUp"] as const;

const COUNT_KEYS = ["total", "returned", "truncated"] as const;

const ANCHOR_NAMES = ["openTasks", "blockedTasks", "proposedDecisions", "acceptedDecisions"] as const;

const RECALL_SECTIONS = ["current", "historical", "artifacts"] as const;

const RECORD_SECTIONS = [...RECALL_SECTIONS, "anchor", "decision-set"] as const;

const RECORD_KINDS = ["task", "finding", "decision", "artifact"] as const;

/**
 * The closed `lifecycle` vocabulary, per kind.
 *
 * `HandoffRecord.lifecycle` is a single string column carrying four different
 * domain unions — task status, finding currentness, decision status, artifact
 * type — and `deriveDecisionSetState` decides the packet's entire decision-safety
 * verdict on `lifecycle === "accepted"` alone. Read as a free string, relabelling
 * an accepted decision as anything else changes the derived safety state while
 * staying internally consistent, and the superseded-projection guard, keyed on
 * the literal `"superseded"`, never fires. So it is validated here, kind-aware.
 *
 * The `satisfies` and `Exhaustive` checks below are compile-time: they fail the
 * typecheck if `src/domain/types.ts` gains a member that is not listed here, so
 * this cannot drift into a second, looser vocabulary than the domain's.
 */
export const DECISION_STATUSES = ["proposed", "accepted", "superseded"] as const satisfies readonly DecisionStatus[];
export const FINDING_CURRENTNESSES = ["current", "superseded", "withdrawn"] as const satisfies readonly FindingCurrentness[];
export const TASK_STATUSES = ["open", "in_progress", "blocked", "completed"] as const satisfies readonly TaskStatus[];
export const ARTIFACT_TYPES = [
  "file",
  "pull_request",
  "commit",
  "log",
  "trace",
  "document",
  "deployment",
  "screenshot",
  "report",
  "other",
] as const satisfies readonly ArtifactType[];

/** Both directions: every listed value is in the union, and every union value is listed. */
type Exhaustive<Union, Listed extends readonly Union[]> = Listed[number] extends Union
  ? Union extends Listed[number]
    ? true
    : { listedVocabularyIsMissingADomainMember: Union }
  : { listedVocabularyHasAMemberTheDomainDoesNot: Listed[number] };

/**
 * A type error here is a build failure, not a runtime one: `true` only
 * typechecks when the four lists above are exactly the four domain unions.
 * Deliberately unreferenced at runtime — it exists to be typechecked.
 */
const LIFECYCLE_VOCABULARY_IS_COMPLETE: {
  decision: Exhaustive<DecisionStatus, typeof DECISION_STATUSES>;
  finding: Exhaustive<FindingCurrentness, typeof FINDING_CURRENTNESSES>;
  task: Exhaustive<TaskStatus, typeof TASK_STATUSES>;
  artifact: Exhaustive<ArtifactType, typeof ARTIFACT_TYPES>;
} = { decision: true, finding: true, task: true, artifact: true };

const DECISION_SET_STATES: readonly RecallDecisionSetState[] = [
  "no-accepted-decision",
  "single-accepted-decision",
  "linked-accepted-decisions",
  "unresolved-accepted-decisions",
  "truncated",
];

/* ------------------------------------------------------------------------- *
 * The record
 * ------------------------------------------------------------------------- */

/** A copied text field: the domain bound, the size, and whether it cost anything. */
interface EvidenceText {
  text: string;
  truncated: boolean;
  /** Bytes of UTF-8 actually kept. */
  bytes: number;
  /** The bound that was applied, in the unit the domain applies it. */
  limit: number;
  unit: "bytes" | "characters";
}

interface EvidenceActor {
  actorId: string;
  actorType: ActorType;
}

interface EvidenceProvenance {
  createdBy: EvidenceActor;
  agentSessionId?: string;
  createdAt: string;
}

/**
 * One packet record: structural facts and provenance only.
 *
 * There is deliberately no `text` and no `rationale` string here. §9 asks for a
 * sanitized account of the packet *fields*; decision and finding text is
 * workspace content, not structure, and committing it would put workspace
 * content into a public evidence tree. The sizes are kept because a reviewer
 * checking a recipient's work against the packet needs to know whether the
 * field they claim to have relied on was whole or was cut by a byte cap.
 */
interface EvidenceRecord {
  id: string;
  kind: string;
  section: string;
  lifecycle: string;
  text: { bytes: number; truncated: boolean };
  rationale: { present: boolean; bytes: number; truncated: boolean };
  historicalExplanation: { present: boolean };
  needsReview: { present: boolean; findingIds: string[] };
  provenance: EvidenceProvenance;
  relations: {
    predecessorId?: string;
    successorId?: string;
    basisFindingIds: string[];
    evidenceArtifactIds: string[];
    truncated: boolean;
  };
}

interface EvidenceDecisionSet {
  total: number;
  returned: number;
  truncated: boolean;
  state: RecallDecisionSetState;
  operativeDecisionId: string | null;
  recordedTransitions: RecallDecisionTransition[];
  guidance: {
    beforeActing: "unresolved" | "absent";
    linkedNextStep: "linked" | "absent";
  };
  /**
   * Whether the packet's declared `recordedTransitions` were corroborated by
   * the members' own `predecessorId` / `successorId` before the verdict was
   * derived. A record is only emitted when this is true, so a reader of the
   * JSON alone can see that the transition list was not taken on trust.
   */
  reconciliation: {
    transitionsFromMemberRelations: boolean;
    declaredTransitionCount: number;
    derivedTransitionCount: number;
  };
  /**
   * Re-derived from the members' own relations. Never copied.
   *
   * This is an internal-consistency check on one packet, not a Campfire read
   * and not evidence about any decision outside these members.
   */
  reDerived: {
    state: RecallDecisionSetState;
    operativeDecisionId: string | null;
    /** A closed enum, not prose: prose in this record can trip the path rules. */
    derivedFrom: "members-own-relation-ids";
  };
  members: EvidenceRecord[];
}

type EvidenceAnchors = Record<string, { count: HandoffCount; recordIds: string[] }>;

export interface GateEPacketEvidenceReceipt {
  kind: typeof RECEIPT_KIND;
  protocolVersion: typeof PROTOCOL_VERSION;
  claimShape: "H";
  deterministic: true;
  pathRecorded: false;
  tokenRecorded: false;
  offlineCopy: true;
  sensitiveOfflineCopy: true;
  fullHistoryIncluded: false;
  workspaceId: string;
  recipient: EvidenceActor;
  packetBytes: number;
  omissions: number;
}

export interface GateEPacketEvidence {
  kind: typeof RECORD_KIND;
  protocolVersion: typeof PROTOCOL_VERSION;
  claimShape: "H";
  producedBy: "CampfireGateEPacketEvidenceHelper";
  purpose: "Sanitized account of the packet fields a Gate E claim-H observation retains (GATE_E_PROTOCOL §9).";
  notEvidenceOf: "Recipient work or semantic correspondence. GATE_E_PROTOCOL §3.1.4 and §5.4: a packet is not resulting work, and this record is not an observation.";
  deterministic: true;
  carriesPacketText: false;
  packet: {
    schemaVersion: number;
    orderingVersion: string;
    authorityPresent: boolean;
    workspace: { id: string; name: EvidenceText; nameTruncated: boolean };
    query: EvidenceText;
    generatedAt: string;
    sourcePosition: number;
    sourceCursor: {
      decoded: true;
      workspaceMatches: true;
      position: number;
      phase: string;
      tip: number;
      matchesSourcePosition: boolean;
    };
    issuer: EvidenceActor;
    recipient: EvidenceActor;
    goal: {
      id: string;
      title: EvidenceText;
      description: EvidenceText | null;
      status: GoalStatus;
      matched: boolean;
      textTruncated: boolean;
    } | null;
  };
  records: EvidenceRecord[];
  decisionSet: EvidenceDecisionSet | null;
  anchors: EvidenceAnchors;
  completeness: {
    fullHistoryIncluded: boolean;
    anchors: Record<string, HandoffCount>;
    recall: Record<string, HandoffCount>;
    drillDownPresent: boolean;
    catchUpPresent: boolean;
  };
  omissions: EvidenceText[];
  receipt: GateEPacketEvidenceReceipt;
}

/* ------------------------------------------------------------------------- *
 * Field readers
 * ------------------------------------------------------------------------- */

function boundedText(value: string | undefined, maxBytes: number): EvidenceText {
  const bounded = boundRecallText(value, maxBytes);
  const text = bounded.text ?? "";
  return { text, truncated: bounded.truncated, bytes: Buffer.byteLength(text, "utf8"), limit: maxBytes, unit: "bytes" };
}

/**
 * A field the domain bounds in **characters**, not bytes.
 *
 * `prepareRecallQuery` bounds `query.text` at `RECALL_QUERY_MAX_CHARS`
 * characters and stores it unchanged, so a 200-character Japanese, Arabic, or
 * emoji query is legal at the writer and the recipient sees all of it. Re-bound
 * in bytes at the same numeric limit, the record would silently cut the query
 * at a point the recipient never saw and would understate what they had. The
 * unit is carried in the record so a reviewer can tell which bound applied.
 */
function boundedChars(value: string, maxChars: number): EvidenceText {
  const truncated = value.length > maxChars;
  const text = truncated ? value.slice(0, maxChars) : value;
  return { text, truncated, bytes: Buffer.byteLength(text, "utf8"), limit: maxChars, unit: "characters" };
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function actorAt(value: unknown, path: string): EvidenceActor {
  const actor = objectAt(required(value, path), path);
  assertKnownKeys(actor, ["actorId", "actorType"], path);
  return {
    actorId: stringAt(actor.actorId, `${path}.actorId`),
    actorType: oneOf(actor.actorType, ["human", "agent"], `${path}.actorType`),
  };
}

function provenanceAt(value: unknown, path: string): EvidenceProvenance {
  const provenance = objectAt(required(value, path), path);
  assertKnownKeys(provenance, PROVENANCE_KEYS, path);
  const createdByPath = `${path}.createdBy`;
  const createdBy = objectAt(required(provenance.createdBy, createdByPath), createdByPath);
  assertKnownKeys(createdBy, ["actorId", "actorType"], createdByPath);
  const agentSessionId = optionalStringAt(provenance.agentSessionId, `${path}.agentSessionId`);
  return {
    createdBy: {
      actorId: stringAt(createdBy.actorId, `${createdByPath}.actorId`),
      actorType: oneOf(createdBy.actorType, ["human", "agent"], `${createdByPath}.actorType`),
    },
    ...(agentSessionId === undefined ? {} : { agentSessionId }),
    createdAt: stringAt(provenance.createdAt, `${path}.createdAt`),
  };
}

function idListAt(value: unknown, path: string): { ids: string[]; truncated: boolean } {
  if (value === undefined) return { ids: [], truncated: false };
  const raw = arrayAt(value, path).map((entry, index) => stringAt(entry, `${path}[${index}]`));
  return capIdList(raw);
}

function optionalBooleanAt(value: unknown, path: string): boolean {
  return value === undefined ? false : booleanAt(value, path);
}

/**
 * `lifecycle` against the vocabulary its `kind` implies.
 *
 * Keyed on `kind` because `HandoffRecord.lifecycle` carries four different
 * unions. Validating before the projection guard is what makes the guard's
 * `=== "superseded"` literal mean what it says: after this, no other string can
 * reach it.
 */
function lifecycleAt(value: unknown, kind: string, path: string): string {
  const allowed =
    kind === "decision"
      ? DECISION_STATUSES
      : kind === "finding"
        ? FINDING_CURRENTNESSES
        : kind === "task"
          ? TASK_STATUSES
          : ARTIFACT_TYPES;
  return oneOf(value, allowed, path);
}

function recordAt(value: unknown, path: string): EvidenceRecord {
  const record = objectAt(value, path);
  assertKnownKeys(record, RECORD_KEYS, path);
  const text = stringAt(record.text, `${path}.text`);
  const rationale = optionalStringAt(record.rationale, `${path}.rationale`);
  const basis = idListAt(record.basisFindingIds, `${path}.basisFindingIds`);
  const evidence = idListAt(record.evidenceArtifactIds, `${path}.evidenceArtifactIds`);
  const predecessorId = optionalStringAt(record.predecessorId, `${path}.predecessorId`);
  const successorId = optionalStringAt(record.successorId, `${path}.successorId`);
  const kind = oneOf(record.kind, RECORD_KINDS, `${path}.kind`);
  return {
    id: stringAt(record.id, `${path}.id`),
    kind,
    section: oneOf(record.section, RECORD_SECTIONS, `${path}.section`),
    lifecycle: lifecycleAt(record.lifecycle, kind, `${path}.lifecycle`),
    text: {
      bytes: byteLength(text),
      truncated: booleanAt(record.textTruncated, `${path}.textTruncated`),
    },
    rationale: {
      present: rationale !== undefined,
      bytes: rationale === undefined ? 0 : byteLength(rationale),
      truncated: optionalBooleanAt(record.rationaleTruncated, `${path}.rationaleTruncated`),
    },
    historicalExplanation: {
      present: optionalStringAt(record.historicalExplanation, `${path}.historicalExplanation`) !== undefined,
    },
    needsReview: {
      present: optionalBooleanAt(record.needsReview, `${path}.needsReview`),
      findingIds: idListAt(record.needsReviewFindingIds, `${path}.needsReviewFindingIds`).ids,
    },
    provenance: provenanceAt(record.provenance, `${path}.provenance`),
    relations: {
      ...(predecessorId === undefined ? {} : { predecessorId }),
      ...(successorId === undefined ? {} : { successorId }),
      basisFindingIds: basis.ids,
      evidenceArtifactIds: evidence.ids,
      truncated:
        basis.truncated ||
        evidence.truncated ||
        optionalBooleanAt(record.relationshipIdsTruncated, `${path}.relationshipIdsTruncated`),
    },
  };
}

function countObjectAt(value: unknown, path: string): HandoffCount {
  const count = objectAt(value, path);
  assertKnownKeys(count, COUNT_KEYS, path);
  return {
    total: countAt(count.total, `${path}.total`),
    returned: countAt(count.returned, `${path}.returned`),
    truncated: booleanAt(count.truncated, `${path}.truncated`),
  };
}

function transitionsAt(value: unknown, path: string): RecallDecisionTransition[] {
  return arrayAt(value, path).map((entry, index) => {
    const item = `${path}[${index}]`;
    const transition = objectAt(entry, item);
    assertKnownKeys(transition, TRANSITION_KEYS, item);
    return {
      supersededDecisionId: stringAt(transition.supersededDecisionId, `${item}.supersededDecisionId`),
      supersedingDecisionId: stringAt(transition.supersedingDecisionId, `${item}.supersersedingDecisionId`),
    };
  });
}

/**
 * Order-independent identity for one transition, for comparing the packet's
 * declared list against the one rebuilt from the members. JSON encoding, not
 * concatenation: a validated id is any non-empty string and may itself contain
 * a separator, so a joined key could collide.
 */
function transitionKey(transition: RecallDecisionTransition): string {
  return JSON.stringify([transition.supersededDecisionId, transition.supersedingDecisionId]);
}

/**
 * Read the decision set and re-derive its safety.
 *
 * The stated `state`, `operativeDecisionId`, `beforeActing`, and
 * `linkedNextStep` are compared against `deriveDecisionSetState` run on the
 * packet's own members and transitions. A packet that under- or over-claims
 * here is rejected rather than recorded: an H record repeating an
 * unauthenticated safety claim would be worse than no record at all.
 *
 * The transition list is not taken from the packet. It is rebuilt from the
 * members' own `predecessorId` / `successorId` with `recordedDecisionTransitions`
 * and the packet's declared list has to equal it. Deriving from the declared
 * list alone would let the packet certify its own claim: an invented transition
 * turns an unresolved two-accepted-decision conflict into a single operative
 * decision with no member carrying any link at all.
 */
function decisionSetAt(value: unknown, path: string): EvidenceDecisionSet {
  const set = objectAt(value, path);
  assertKnownKeys(set, DECISION_SET_KEYS, path);
  const memberPath = `${path}.members`;
  const members = arrayAt(required(set.members, memberPath), memberPath).map((member, index) =>
    recordAt(member, `${memberPath}[${index}]`),
  );
  const total = countAt(required(set.total, `${path}.total`), `${path}.total`);
  const returned = countAt(required(set.returned, `${path}.returned`), `${path}.returned`);
  const truncated = booleanAt(required(set.truncated, `${path}.truncated`), `${path}.truncated`);
  const state = oneOf(required(set.state, `${path}.state`), DECISION_SET_STATES, `${path}.state`);
  const operativeDecisionId = optionalStringAt(set.operativeDecisionId, `${path}.operativeDecisionId`);
  const transitionPath = `${path}.recordedTransitions`;
  const declaredTransitions = transitionsAt(required(set.recordedTransitions, transitionPath), transitionPath);
  if (returned !== members.length) {
    invalid(`${path}.returned is ${returned} but the set carries ${members.length} members`, path);
  }
  if (returned > total) {
    invalid(`${path}.returned is ${returned} and cannot exceed total ${total}`, path);
  }
  // The transition list the verdict is derived from: rebuilt from the members'
  // own relation ids, in the domain's own order.
  const recordedTransitions = recordedDecisionTransitions(
    members.map((member) => ({
      id: member.id,
      ...(member.relations.predecessorId === undefined ? {} : { predecessorId: member.relations.predecessorId }),
      ...(member.relations.successorId === undefined ? {} : { successorId: member.relations.successorId }),
    })),
  );
  // Two directions, both refused: a declared transition the members do not
  // support (fabricated), and a member relation the packet dropped (removed).
  // Either one changes the derived state, so either one changes the verdict.
  for (const transition of declaredTransitions) {
    const endsAreMembers =
      members.some((member) => member.id === transition.supersededDecisionId) &&
      members.some((member) => member.id === transition.supersedingDecisionId);
    if (!endsAreMembers) {
      invalid(
        `${transitionPath} declares a transition whose two ends are not both members of this set`,
        transitionPath,
      );
    }
  }
  const declared = declaredTransitions.map(transitionKey).sort();
  const derived = recordedTransitions.map(transitionKey).sort();
  if (declared.join("\n") !== derived.join("\n")) {
    invalid(
      `${transitionPath} does not match the supersessions the members' own predecessorId/successorId relations record`,
      transitionPath,
    );
  }
  // The same truncation rule `projectHandoffPacket` applies when it fits a set.
  const verdict = deriveDecisionSetState({
    members: members.map((member) => ({ id: member.id, lifecycle: member.lifecycle })),
    recordedTransitions,
    truncated: truncated || returned < total,
  });
  if (verdict.state !== state) {
    invalid(`${path}.state is ${state} but its own members derive ${verdict.state}`, `${path}.state`);
  }
  const derivedOperative = verdict.operativeDecisionId ?? null;
  if (derivedOperative !== (operativeDecisionId ?? null)) {
    invalid(
      `${path}.operativeDecisionId is ${String(operativeDecisionId)} and its own members derive ${String(derivedOperative)}`,
      `${path}.operativeDecisionId`,
    );
  }
  if ((set.beforeActing ?? null) !== (verdict.beforeActing ?? null)) {
    invalid(`${path}.beforeActing does not match the guidance its own members derive`, `${path}.beforeActing`);
  }
  if ((set.linkedNextStep ?? null) !== (verdict.linkedNextStep ?? null)) {
    invalid(`${path}.linkedNextStep does not match the guidance its own members derive`, `${path}.linkedNextStep`);
  }
  // Re-deriving the set state does not verify the historical/current projection.
  // This is the exact boundary the post-verdict S2 fix changed.
  for (const [index, member] of members.entries()) {
    const field = `${memberPath}[${index}]`;
    if (member.kind !== "decision") invalid(`${field} is not a decision`, field);
    if (member.lifecycle === "superseded") {
      if (member.section !== "historical" || member.rationale.present || !member.historicalExplanation.present) {
        invalid(`${field} does not preserve the historical superseded projection`, field);
      }
    }
  }
  return {
    total,
    returned,
    truncated,
    state,
    operativeDecisionId: operativeDecisionId ?? null,
    recordedTransitions,
    guidance: {
      beforeActing: set.beforeActing === undefined ? "absent" : "unresolved",
      linkedNextStep: set.linkedNextStep === undefined ? "absent" : "linked",
    },
    reconciliation: {
      transitionsFromMemberRelations: true,
      declaredTransitionCount: declaredTransitions.length,
      derivedTransitionCount: recordedTransitions.length,
    },
    reDerived: {
      state: verdict.state,
      operativeDecisionId: derivedOperative,
      derivedFrom: "members-own-relation-ids",
    },
    members,
  };
}

function goalAt(value: unknown, path: string): NonNullable<GateEPacketEvidence["packet"]["goal"]> {
  const goal = objectAt(required(value, path), path);
  assertKnownKeys(goal, GOAL_KEYS, path);
  const description = optionalStringAt(goal.description, `${path}.description`);
  return {
    id: stringAt(goal.id, `${path}.id`),
    title: boundedText(stringAt(goal.title, `${path}.title`), RECALL_GOAL_TEXT_MAX_BYTES),
    description: description === undefined ? null : boundedText(description, RECALL_GOAL_TEXT_MAX_BYTES),
    status: oneOf(goal.status, ["active", "completed", "abandoned"], `${path}.status`),
    matched: booleanAt(goal.matched, `${path}.matched`),
    textTruncated: booleanAt(goal.textTruncated, `${path}.textTruncated`),
  };
}

/**
 * The four anchor pages. The page itself is a list of records; its counts live
 * under `completeness.anchors`, so both are read here and kept together.
 */
function anchorsAt(value: unknown, counts: Record<string, unknown>, path: string): EvidenceAnchors {
  const anchors = objectAt(value, path);
  assertKnownKeys(anchors, ANCHOR_NAMES, path);
  const out: EvidenceAnchors = {};
  for (const name of ANCHOR_NAMES) {
    const itemPath = `${path}.${name}`;
    const countPath = `completeness.anchors.${name}`;
    const page = arrayAt(required(anchors[name], itemPath), itemPath);
    const count = countObjectAt(required(counts[name], countPath), countPath);
    const recordIds = page.map((entry, index) => stringAt(objectAt(entry, `${itemPath}[${index}]`).id, `${itemPath}[${index}].id`));
    if (recordIds.length !== count.returned) {
      invalid(`${itemPath} holds ${recordIds.length} records and completeness reports ${count.returned} returned`, itemPath);
    }
    out[name] = { count, recordIds };
  }
  return out;
}

/* ------------------------------------------------------------------------- *
 * Assembly
 * ------------------------------------------------------------------------- */

export interface BuiltPacketEvidence {
  /** Null when the packet is refused. No partial record is ever returned. */
  record: GateEPacketEvidence | null;
  refusals: Refusal[];
}

/**
 * Build the record from a parsed packet. Pure: the same packet always yields
 * the same record, and the same refusals.
 *
 * Throws `ValidationError` when the input is not a well-formed packet this build
 * writes. Returns refusals when it is well formed but must not be committed.
 */
export function buildPacketEvidence(parsed: unknown, packetBytes: number): BuiltPacketEvidence {
  const packet = objectAt(parsed, "packet");
  // Scan before shape validation. Otherwise a malformed field could reach an
  // error path before its credential or path content is refused.
  const strings: Array<{ path: string; value: string }> = [];
  stringValues(packet, "packet", strings);
  const sensitiveRefusals = [...credentialRefusals(strings), ...pathRefusals(strings)];
  if (sensitiveRefusals.length > 0) return { record: null, refusals: sensitiveRefusals };
  assertKnownKeys(packet, PACKET_KEYS, "packet");
  if (packet.kind !== "CampfireHandoffPacket") {
    invalid("packet.kind is not CampfireHandoffPacket", "packet.kind");
  }
  const schemaVersion = numberAt(required(packet.schemaVersion, "packet.schemaVersion"), "packet.schemaVersion");
  if (schemaVersion !== HANDOFF_PACKET_SCHEMA_VERSION) {
    invalid(`packet.schemaVersion is ${schemaVersion} and this build writes ${HANDOFF_PACKET_SCHEMA_VERSION}`, "packet.schemaVersion");
  }
  const orderingVersion = stringAt(packet.orderingVersion, "packet.orderingVersion");
  if (orderingVersion !== RECALL_ORDERING_VERSION) {
    invalid("packet.orderingVersion does not match this build", "packet.orderingVersion");
  }
  if (booleanAt(required(packet.offlineCopy, "packet.offlineCopy"), "packet.offlineCopy") !== true) {
    invalid("packet.offlineCopy must be true", "packet.offlineCopy");
  }
  if (booleanAt(required(packet.sensitiveOfflineCopy, "packet.sensitiveOfflineCopy"), "packet.sensitiveOfflineCopy") !== true) {
    invalid("packet.sensitiveOfflineCopy must be true", "packet.sensitiveOfflineCopy");
  }
  const fullHistoryIncluded = booleanAt(required(packet.fullHistoryIncluded, "packet.fullHistoryIncluded"), "packet.fullHistoryIncluded");
  if (fullHistoryIncluded !== false) {
    invalid("packet.fullHistoryIncluded must be false", "packet.fullHistoryIncluded");
  }
  if (typeof packet.authority !== "string" || packet.authority.length === 0) {
    invalid("packet.authority must be a non-empty string", "packet.authority");
  }

  const workspace = objectAt(required(packet.workspace, "packet.workspace"), "packet.workspace");
  assertKnownKeys(workspace, ["id", "name", "nameTruncated"], "packet.workspace");
  const workspaceId = stringAt(workspace.id, "packet.workspace.id");
  if (!new RegExp(`^${ID_PREFIXES.workspace}_[A-Za-z0-9][A-Za-z0-9_-]*$`).test(workspaceId)) {
    invalid("packet.workspace.id is not a Campfire workspace id", "packet.workspace.id");
  }

  const refusals = foreignWorkspaceRefusals(strings, workspaceId);

  // The pre-action position, decoded through the domain cursor codec. A cursor
  // that belongs to another workspace is a foreign-workspace refusal, not a
  // malformed packet: the packet is well formed and names the wrong workspace.
  const cursor = decodeContextCursor(stringAt(required(packet.sourceCursor, "packet.sourceCursor"), "packet.sourceCursor"));
  try {
    assertCursorWorkspace(cursor, workspaceId);
  } catch {
    refusals.push({
      rule: "foreign-workspace-id",
      why: "a pre-action cursor belonging to another workspace",
      where: "packet.sourceCursor",
    });
  }
  if (refusals.length > 0) return { record: null, refusals };

  const query = objectAt(required(packet.query, "packet.query"), "packet.query");
  assertKnownKeys(query, ["text", "normalized"], "packet.query");
  const sourcePosition = countAt(required(packet.sourcePosition, "packet.sourcePosition"), "packet.sourcePosition");
  const cursorPosition = cursor.kind === "contribution" ? cursor.position : -1;
  const records = arrayAt(required(packet.records, "packet.records"), "packet.records").map((record, index) =>
    recordAt(record, `packet.records[${index}]`),
  );
  const omissions = arrayAt(required(packet.omissions, "packet.omissions"), "packet.omissions").map((entry, index) =>
    // Bounded rather than copied verbatim: an omission line is domain prose,
    // but it is still text taken out of the packet, and a line cut by the bound
    // is marked cut rather than quietly shortened.
    boundedText(stringAt(entry, `packet.omissions[${index}]`), RECALL_EXCERPT_MAX_BYTES),
  );
  const completeness = objectAt(required(packet.completeness, "packet.completeness"), "packet.completeness");
  assertKnownKeys(completeness, COMPLETENESS_KEYS, "packet.completeness");
  const completenessAnchors = objectAt(required(completeness.anchors, "packet.completeness.anchors"), "packet.completeness.anchors");
  assertKnownKeys(completenessAnchors, ANCHOR_NAMES, "packet.completeness.anchors");
  const completenessRecall = objectAt(required(completeness.recall, "packet.completeness.recall"), "packet.completeness.recall");
  assertKnownKeys(completenessRecall, RECALL_SECTIONS, "packet.completeness.recall");
  const issuer = actorAt(packet.issuer, "packet.issuer");
  const recipient = actorAt(packet.recipient, "packet.recipient");
  const anchorCounts: Record<string, HandoffCount> = Object.fromEntries(
    ANCHOR_NAMES.map((name) => [
      name,
      countObjectAt(required(completenessAnchors[name], `packet.completeness.anchors.${name}`), `packet.completeness.anchors.${name}`),
    ]),
  );

  const record: GateEPacketEvidence = {
    kind: RECORD_KIND,
    protocolVersion: PROTOCOL_VERSION,
    claimShape: "H",
    producedBy: "CampfireGateEPacketEvidenceHelper",
    purpose: "Sanitized account of the packet fields a Gate E claim-H observation retains (GATE_E_PROTOCOL §9).",
    notEvidenceOf:
      "Recipient work or semantic correspondence. GATE_E_PROTOCOL §3.1.4 and §5.4: a packet is not resulting work, and this record is not an observation.",
    deterministic: true,
    carriesPacketText: false,
    packet: {
      schemaVersion,
      orderingVersion,
      authorityPresent: true,
      workspace: {
        id: workspaceId,
        name: boundedText(stringAt(workspace.name, "packet.workspace.name"), RECALL_NAME_MAX_BYTES),
        nameTruncated: booleanAt(workspace.nameTruncated, "packet.workspace.nameTruncated"),
      },
      query: boundedChars(stringAt(query.text, "packet.query.text"), RECALL_QUERY_MAX_CHARS),
      generatedAt: stringAt(packet.generatedAt, "packet.generatedAt"),
      sourcePosition,
      sourceCursor: {
        decoded: true,
        workspaceMatches: true,
        position: cursorPosition,
        phase: cursor.kind === "contribution" ? cursor.phase : "non-contribution",
        tip: cursor.kind === "contribution" ? cursor.tip : -1,
        matchesSourcePosition: cursorPosition === sourcePosition,
      },
      issuer,
      recipient,
      goal: packet.goal === undefined ? null : goalAt(packet.goal, "packet.goal"),
    },
    records,
    decisionSet: packet.decisionSet === undefined ? null : decisionSetAt(packet.decisionSet, "packet.decisionSet"),
    anchors: anchorsAt(packet.anchors, completenessAnchors, "packet.anchors"),
    completeness: {
      fullHistoryIncluded: booleanAt(completeness.fullHistoryIncluded, "packet.completeness.fullHistoryIncluded"),
      anchors: anchorCounts,
      recall: Object.fromEntries(
        RECALL_SECTIONS.map((name) => [
          name,
          countObjectAt(required(completenessRecall[name], `packet.completeness.recall.${name}`), `packet.completeness.recall.${name}`),
        ]),
      ),
      drillDownPresent: typeof completeness.drillDown === "string" && completeness.drillDown.length > 0,
      catchUpPresent: typeof completeness.catchUp === "string" && completeness.catchUp.length > 0,
    },
    omissions,
    receipt: {
      kind: RECEIPT_KIND,
      protocolVersion: PROTOCOL_VERSION,
      claimShape: "H",
      deterministic: true,
      pathRecorded: false,
      tokenRecorded: false,
      offlineCopy: true,
      sensitiveOfflineCopy: true,
      fullHistoryIncluded: false,
      workspaceId,
      recipient,
      packetBytes,
      omissions: omissions.length,
    },
  };
  return { record, refusals };
}

/* ------------------------------------------------------------------------- *
 * Rendering
 * ------------------------------------------------------------------------- */

const LABEL_WIDTH = 12;

function labeled(label: string, ...values: Array<string | undefined>): string {
  const kept = values.filter((value): value is string => value !== undefined && value.length > 0);
  return [label.padEnd(LABEL_WIDTH), ...kept].join("  ").trimEnd();
}

function joinFields(...parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => part !== undefined && part.length > 0).join("  ");
}

/**
 * A bounded field, marked with the bound that was applied.
 *
 * The marker is `[truncated at N bytes]` or `[truncated at N characters]`, never
 * `[truncated N/M bytes]`. A bare `N/M` fraction is exactly the shape
 * `relative-segment-path` matches, so the tool's own rendering used to refuse a
 * well-formed packet that had a legitimately truncated field — naming its own
 * output as the leaked path and giving the operator nothing to act on. The
 * unit is the domain's, not assumed: `query.text` is bounded in characters by
 * `prepareRecallQuery`, everything else in bytes.
 */
function markedText(text: EvidenceText): string {
  if (!text.truncated) return text.text;
  const bound = text.unit === "bytes" ? `${text.limit} bytes` : `${text.limit} characters`;
  return `${text.text} [truncated at ${bound}]`;
}

function renderRecordLine(record: EvidenceRecord): string {
  const rationale = record.rationale.present
    ? `rationale ${record.rationale.bytes}b${record.rationale.truncated ? " truncated" : ""}`
    : "no rationale";
  return `  ${joinFields(
    record.section,
    record.kind,
    record.id,
    record.lifecycle,
    `text ${record.text.bytes}b${record.text.truncated ? " truncated" : ""}`,
    rationale,
    record.historicalExplanation.present ? "historical explanation" : undefined,
    record.needsReview.present ? "needsReview" : undefined,
    record.relations.truncated ? "relations truncated" : undefined,
  )}`;
}

export function renderHuman(record: GateEPacketEvidence): string {
  const lines: string[] = [];
  lines.push(`Gate E packet evidence — claim ${record.claimShape} — protocol ${record.protocolVersion}`);
  lines.push(record.notEvidenceOf);
  lines.push("");
  lines.push(labeled("Packet", `schema ${record.packet.schemaVersion}`, `ordering ${record.packet.orderingVersion}`, `${record.records.length} records`));
  lines.push(labeled("Workspace", record.packet.workspace.id, markedText(record.packet.workspace.name)));
  lines.push(labeled("Query", markedText(record.packet.query)));
  lines.push(labeled("Generated", record.packet.generatedAt));
  lines.push(
    labeled(
      "Position",
      String(record.packet.sourcePosition),
      `cursor decoded, phase ${record.packet.sourceCursor.phase}, tip ${record.packet.sourceCursor.tip}`,
    ),
  );
  lines.push(labeled("Issuer", record.packet.issuer.actorType, record.packet.issuer.actorId));
  lines.push(labeled("Recipient", record.packet.recipient.actorType, record.packet.recipient.actorId));
  if (record.packet.goal !== null) {
    lines.push(labeled("Goal", record.packet.goal.id, record.packet.goal.status, markedText(record.packet.goal.title)));
    if (record.packet.goal.description !== null) lines.push(labeled("Goal detail", markedText(record.packet.goal.description)));
  }
  lines.push("");
  const set = record.decisionSet;
  if (set === null) {
    lines.push(labeled("Decision set", "none carried"));
  } else {
    lines.push(
      labeled("Decision set", set.state, `returned ${set.returned}`, `total ${set.total}`, set.truncated ? "truncated" : undefined),
    );
    lines.push(labeled("Operative", set.operativeDecisionId ?? "none named"));
    lines.push(
      labeled(
        "Guidance",
        `beforeActing ${set.guidance.beforeActing}`,
        `linkedNextStep ${set.guidance.linkedNextStep}`,
        "re-derived and matched",
      ),
    );
    // "re-derived and matched" above is a consistency check on one packet. The
    // line below says what it was derived from, so the words cannot be read as
    // an independent verification of the packet's decision safety.
    lines.push(
      labeled(
        "Reconciled",
        `transitions from the members' own relation ids: ${set.reconciliation.transitionsFromMemberRelations ? "yes" : "no"}`,
        `declared ${set.reconciliation.declaredTransitionCount}, derived ${set.reconciliation.derivedTransitionCount}`,
      ),
    );
    lines.push(labeled("Derived", `from ${set.reDerived.derivedFrom}`, "internal consistency only, not a Campfire read"));
    for (const transition of set.recordedTransitions) {
      lines.push(labeled("Supersedes", `${transition.supersededDecisionId} -> ${transition.supersedingDecisionId}`));
    }
    for (const member of set.members) lines.push(renderRecordLine(member));
  }
  lines.push("");
  lines.push(`Records (${record.records.length})`);
  for (const row of record.records) lines.push(renderRecordLine(row));
  lines.push("");
  lines.push("Anchors");
  for (const [name, anchor] of Object.entries(record.anchors)) {
    lines.push(labeled(name, `returned ${anchor.count.returned}`, `total ${anchor.count.total}`));
    for (const id of anchor.recordIds) lines.push(labeled("", id));
  }
  lines.push("");
  lines.push("Completeness");
  for (const [name, count] of Object.entries(record.completeness.recall)) {
    lines.push(labeled(name, `returned ${count.returned}`, `total ${count.total}`, count.truncated ? "truncated" : undefined));
  }
  lines.push(labeled("History", record.completeness.fullHistoryIncluded ? "included" : "not included"));
  lines.push(labeled("Omissions", String(record.omissions.length)));
  for (const line of record.omissions) lines.push(labeled("", markedText(line)));
  lines.push("");
  lines.push(labeled("Receipt", record.receipt.kind));
  lines.push(labeled("Packet bytes", String(record.receipt.packetBytes)));
  lines.push(labeled("Recorded", "no token, no path, no run timestamp"));
  return lines.join("\n");
}

/* ------------------------------------------------------------------------- *
 * Command line
 * ------------------------------------------------------------------------- */

type OutputMode = "auto" | "human" | "json";

function outputMode(value: string): OutputMode {
  if (value !== "auto" && value !== "human" && value !== "json") {
    throw new ValidationError(`Invalid --output: expected auto|human|json, got ${value}`, { field: "output" });
  }
  return value;
}

function parseArgv(argv: readonly string[]): { packetPath: string; mode: OutputMode; help: boolean } {
  let packetPath: string | undefined;
  let mode: OutputMode = "auto";
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--json") {
      mode = "json";
    } else if (arg === "--output") {
      const value = argv[index + 1];
      if (value === undefined) throw new ValidationError("--output requires auto|human|json", { field: "output" });
      mode = outputMode(value);
      index += 1;
    } else if (arg.startsWith("--output=")) {
      mode = outputMode(arg.slice("--output=".length));
    } else if (arg.startsWith("-")) {
      throw new ValidationError(`Unknown option: ${arg}`, { field: "option" });
    } else if (packetPath !== undefined) {
      throw new ValidationError(`Expected one packet file, got more than one: ${arg}`, { field: "packet" });
    } else {
      packetPath = arg;
    }
  }
  return { packetPath: packetPath ?? "", mode, help };
}

/**
 * Stop the run with an exit code and a printed reason.
 *
 * These throw rather than return, so the control-flow checker knows a call to
 * either one ends the path. Nothing is written to stdout on either branch.
 */
class Halt extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
    this.name = "Halt";
  }
}

function unusable(message: string): never {
  process.stderr.write(`INVALID — ${message}\n`);
  throw new Halt(1);
}

function refuse(reason: string): never {
  process.stderr.write(`${reason}\n`);
  throw new Halt(2);
}

/**
 * The emitted record is scanned by the same detectors as the packet, in both
 * renderings. This is a belt-and-braces check: the record copies no packet text
 * in the first place, so it should never fire. A leak means a future edit to
 * this file copied something it should not have.
 *
 * Only the record's own workspace id is permitted, exactly as for the packet.
 */
function refuseEmitted(record: GateEPacketEvidence, rendered: Array<{ path: string; value: string }>): Refusal[] | null {
  const refusals = [
    ...credentialRefusals(rendered),
    ...pathRefusals(rendered),
    ...foreignWorkspaceRefusals(rendered, record.packet.workspace.id),
  ];
  return refusals.length > 0 ? refusals : null;
}

/** Packet text a reader might claim to have acted on. Never copied verbatim. */
function packetTextValues(parsed: Record<string, unknown>): string[] {
  const texts: string[] = [];
  const records: unknown[] = [];
  if (Array.isArray(parsed.records)) records.push(...parsed.records);
  if (typeof parsed.decisionSet === "object" && parsed.decisionSet !== null) {
    const members = (parsed.decisionSet as Record<string, unknown>).members;
    if (Array.isArray(members)) records.push(...members);
  }
  for (const entry of records) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    for (const field of ["text", "rationale"]) {
      const value = row[field];
      // 16 bytes is the floor: shorter strings occur inside ids and prose
      // elsewhere in the record and would make the check meaningless.
      if (typeof value === "string" && byteLength(value) >= 16) texts.push(value);
    }
  }
  return texts;
}

function main(argv: readonly string[]): number {
  const { packetPath, mode, help } = parseArgv(argv);
  if (help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (packetPath === "") {
    process.stderr.write(`A packet file is required.\n${USAGE}\n`);
    return 1;
  }

  let raw: string;
  try {
    raw = readFileSync(packetPath, "utf8");
  } catch (error) {
    unusable(`the packet file could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  const packetBytes = byteLength(raw);
  if (packetBytes > HANDOFF_PACKET_MAX_BYTES) {
    unusable(`the packet file is ${packetBytes} bytes and exceeds the ${HANDOFF_PACKET_MAX_BYTES}-byte packet cap`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    unusable("the packet file is not valid JSON");
  }

  const { record, refusals } = buildPacketEvidence(parsed, packetBytes);
  if (refusals.length > 0) refuse(describeRefusals(refusals));
  if (record === null) unusable("the packet produced no record and no refusal");

  // The byte cap stays the domain's rule, applied by the domain's own writer,
  // to the object this helper read.
  try {
    serializeHandoffPacket(parsed as CampfireHandoffPacket);
  } catch {
    unusable("the packet does not satisfy the domain serializer");
  }

  const json = JSON.stringify(record);
  const human = renderHuman(record);

  const rendered: Array<{ path: string; value: string }> = [];
  stringValues({ json, human }, "record", rendered);
  const emittedRefusals = refuseEmitted(record, rendered);
  if (emittedRefusals !== null) refuse(describeRefusals(emittedRefusals));
  // §9 keeps private packet bytes out of the repository. The record is built
  // without any record text, so this can only fire on a future edit.
  const leaked = packetTextValues(parsed as Record<string, unknown>).filter((text) => json.includes(text) || human.includes(text));
  if (leaked.length > 0) unusable(`the record would carry ${leaked.length} packet text field(s) verbatim`);

  const resolved: "human" | "json" = mode === "auto" ? (process.stdout.isTTY ? "human" : "json") : mode;
  process.stdout.write(resolved === "json" ? `${json}\n` : `${human}\n`);
  return 0;
}

/**
 * True only when this file is the process entrypoint.
 *
 * `buildPacketEvidence`, `renderHuman`, and the four lifecycle vocabularies are
 * exported so a test can exercise them directly, but this module runs its CLI at
 * load. Without this guard, importing it from a test runner feeds that runner's
 * argv to `main`, which reads a file named after an argument the runner does not
 * own and sets its exit code — a test must never do that to the tree it runs in.
 *
 * Same shape and same real-path comparison as `src/cli/index.ts`, `src/mcp/stdio.ts`,
 * and `scripts/wow-001/pilot.ts`: argv[1] is verbatim, so a symlink or a `..`
 * segment must not silently no-op the entrypoint.
 */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  let exitCode: number;
  try {
    exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof Halt) {
      exitCode = error.code;
    } else {
      // Imported validators and malformed fields may embed packet content in
      // their messages. Keep only a checked field path, never their prose.
      const field = error instanceof ValidationError ? error.details?.field : undefined;
      const safeField = typeof field === "string" && /^packet(?:\.[A-Za-z][A-Za-z0-9]*|\[\d+\])*$/.test(field)
        ? field
        : undefined;
      process.stderr.write(`INVALID — packet validation failed${safeField === undefined ? "" : ` at ${safeField}`}\n`);
      exitCode = 1;
    }
  }
  process.exitCode = exitCode;
}
