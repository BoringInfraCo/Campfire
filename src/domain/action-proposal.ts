/**
 * ACT-001 ActionProposal domain (Step 1 core).
 *
 * One workspace-owned aggregate for a single concrete external verification
 * retry (`ci.retry_verification`). The proposal records an immutable approved
 * intent, cited task/evidence, a designated executor, human review, one
 * dispatch reservation, and append-only submission/reconciliation receipts.
 *
 * Core treats provider data as bounded validated display text; provider-side
 * validation belongs in an integration adapter. No executable command,
 * credential, free-form URL, or script is modeled here.
 *
 * The canonical digest binds the exact approved effect: SHA-256 over a
 * fixed-order normalized UTF-8 encoding (see `canonicalIntentEnvelope`).
 * Implemented as dependency-free synchronous SHA-256 so the local SQLite path
 * and the Workers/D1 path compute identical digests.
 */

export const ACTION_PROPOSAL_KIND = "ci.retry_verification" as const;
export const ACTION_PROPOSAL_INTENT_VERSION = 1 as const;

/** Server-clock approval/dispatch deadline: at most 24h after creation. */
export const ACTION_PROPOSAL_MAX_TTL_MS = 24 * 3_600_000;

/** Byte bounds from the ACT-001 contract. */
export const ACTION_INTENT_MAX_BYTES = 4_096;
export const ACTION_RECEIPT_MAX_BYTES = 2_048;
export const ACTION_PROJECTION_MAX_BYTES = 16_384;
export const ACTION_PAGE_MAX_BYTES = 65_536;

/** Read paging: default 20, hard max 100. */
export const ACTION_DEFAULT_PAGE_SIZE = 20;
export const ACTION_MAX_PAGE_SIZE = 100;

/** Required short reason bound. */
export const ACTION_REASON_MAX_CHARS = 500;

/** At least one cited finding or artifact, at most 10 total references. */
export const ACTION_EVIDENCE_MAX_REFS = 10;

/** Caller-generated mutation key: 1-128 printable ASCII. */
const REQUEST_KEY_PATTERN = /^[\x20-\x7E]{1,128}$/;

/** Numeric provider ids are validated decimal strings, never numbers. */
const DECIMAL_ID_PATTERN = /^[0-9]{1,20}$/;

/** Full commit SHA: 40-char SHA-1 or 64-char SHA-256 hex. A moving branch is never a target. */
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

export type ActionProposalStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "cancelled"
  | "dispatch_reserved"
  | "submission_accepted"
  | "submission_failed"
  | "submission_unknown";

export const ACTION_PROPOSAL_STATUSES: readonly ActionProposalStatus[] = [
  "proposed",
  "approved",
  "rejected",
  "cancelled",
  "dispatch_reserved",
  "submission_accepted",
  "submission_failed",
  "submission_unknown",
];

export type ActionSubmissionOutcome =
  | "accepted"
  | "definite_failure"
  | "unknown"
  | "reconciled_accepted"
  | "reconciled_failure";

export const ACTION_SUBMISSION_OUTCOMES: readonly ActionSubmissionOutcome[] = [
  "accepted",
  "definite_failure",
  "unknown",
  "reconciled_accepted",
  "reconciled_failure",
];

export interface ActionTarget {
  repositoryId: string;
  repositoryName: string;
  workflowId: string;
  runId: string;
  commitSha: string;
  expectedAttempt: number;
}

export interface ActionExecutor {
  actorId: string;
  actorType: "human" | "agent";
}

export interface ActionTaskSnapshot {
  id: string;
  status: string;
  updatedAt: string;
}

export interface ActionFindingSnapshot {
  id: string;
  currentness: string;
}

export interface ActionArtifactSnapshot {
  id: string;
}

/**
 * Evidence captured at reservation so later corrections stay inspectable
 * without pretending they retroactively prevented an already dispatched action.
 */
export interface ActionEvidenceSnapshot {
  task: ActionTaskSnapshot;
  findings: ActionFindingSnapshot[];
  artifacts: ActionArtifactSnapshot[];
  intentDigest: string;
  revision: number;
  capturedAt: string;
}

export interface ActionProposal {
  id: string;
  workspaceId: string;
  kind: typeof ACTION_PROPOSAL_KIND;
  intentVersion: typeof ACTION_PROPOSAL_INTENT_VERSION;
  target: ActionTarget;
  executor: ActionExecutor;
  /** Canonical envelope bytes are the approval subject; digest is SHA-256 hex. */
  intentDigest: string;
  expiresAt: string;
  reason: string;
  taskId: string;
  findingIds: string[];
  artifactIds: string[];
  /** Authority revision of the operator-bound source at proposal time. */
  sourceAuthorityRevision: string;
  proposedBy: ActionExecutor;
  proposedSessionId?: string;
  review?: {
    actor: ActionExecutor;
    sessionId?: string;
    decision: "approved" | "rejected" | "cancelled";
    reason?: string;
    at: string;
    revision: number;
    intentDigest: string;
  };
  reservation?: {
    actor: ActionExecutor;
    sessionId?: string;
    reservationId: string;
    evidenceSnapshot: ActionEvidenceSnapshot;
    at: string;
    revision: number;
    intentDigest: string;
  };
  status: ActionProposalStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** Bounded safe provider reference. No headers, bodies, logs, tokens, or shell text. */
export interface ActionProviderRef {
  repositoryId: string;
  workflowId: string;
  runId: string;
  attempt?: number;
  conclusion?: string;
}

export interface ActionReceipt {
  id: string;
  proposalId: string;
  workspaceId: string;
  reservationId: string;
  intentDigest: string;
  outcome: ActionSubmissionOutcome;
  /** Set on reconciliation receipts: the unknown receipt being resolved. */
  resolvesReceiptId?: string;
  providerRef: ActionProviderRef;
  recordedBy: ActionExecutor;
  recordedSessionId?: string;
  recordedAt: string;
  requestKey: string;
}

/**
 * Bounded signed provider observation. Finding/artifact ids only; never a
 * flattened success boolean, raw payload, or credential.
 */
export interface SignedObservationRef {
  findingId: string;
  artifactId: string;
  conclusion: string;
  attempt: number;
  receivedAt: string;
}

// --- validation -----------------------------------------------------------

export function assertRequestKey(value: unknown): string {
  if (typeof value !== "string" || !REQUEST_KEY_PATTERN.test(value)) {
    throw new Error("requestKey must be 1-128 printable ASCII characters");
  }
  return value;
}

function assertDecimalId(value: unknown, field: string): string {
  if (typeof value !== "string" || !DECIMAL_ID_PATTERN.test(value)) {
    throw new Error(`${field} must be a validated decimal string`);
  }
  return value;
}

function assertRepositoryName(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 200) {
    throw new Error("repositoryName must be 1-200 characters");
  }
  // Configured `owner/name` display text. Never a URL, command, or script.
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error("repositoryName must be a configured owner/name pair");
  }
  return value;
}

export function normalizeActionTarget(raw: unknown): ActionTarget {
  if (typeof raw !== "object" || raw === null) throw new Error("target is required");
  const t = raw as Record<string, unknown>;
  const expectedAttempt = t.expectedAttempt;
  if (typeof expectedAttempt !== "number" || !Number.isInteger(expectedAttempt) || expectedAttempt < 1) {
    throw new Error("target.expectedAttempt must be a positive integer");
  }
  const commitSha = t.commitSha;
  if (typeof commitSha !== "string" || !COMMIT_SHA_PATTERN.test(commitSha)) {
    throw new Error("target.commitSha must be a full 40- or 64-char hex commit SHA");
  }
  return {
    repositoryId: assertDecimalId(t.repositoryId, "target.repositoryId"),
    repositoryName: assertRepositoryName(t.repositoryName),
    workflowId: assertDecimalId(t.workflowId, "target.workflowId"),
    runId: assertDecimalId(t.runId, "target.runId"),
    commitSha,
    expectedAttempt,
  };
}

export function normalizeActionExecutor(raw: unknown): ActionExecutor {
  if (typeof raw !== "object" || raw === null) throw new Error("executor is required");
  const e = raw as Record<string, unknown>;
  if (e.actorType !== "human" && e.actorType !== "agent") {
    throw new Error("executor.actorType must be human or agent");
  }
  if (typeof e.actorId !== "string" || e.actorId.length === 0) {
    throw new Error("executor.actorId is required");
  }
  return { actorId: e.actorId, actorType: e.actorType };
}

export function normalizeActionReason(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error("reason must not be empty");
  }
  if (raw.length > ACTION_REASON_MAX_CHARS) {
    throw new Error(`reason must be at most ${ACTION_REASON_MAX_CHARS} characters`);
  }
  return raw;
}

export function normalizeActionProviderRef(raw: unknown): ActionProviderRef {
  if (typeof raw !== "object" || raw === null) throw new Error("providerRef is required");
  const r = raw as Record<string, unknown>;
  const ref: ActionProviderRef = {
    repositoryId: assertDecimalId(r.repositoryId, "providerRef.repositoryId"),
    workflowId: assertDecimalId(r.workflowId, "providerRef.workflowId"),
    runId: assertDecimalId(r.runId, "providerRef.runId"),
  };
  if (r.attempt !== undefined) {
    if (typeof r.attempt !== "number" || !Number.isInteger(r.attempt) || r.attempt < 1) {
      throw new Error("providerRef.attempt must be a positive integer");
    }
    ref.attempt = r.attempt;
  }
  if (r.conclusion !== undefined) {
    if (typeof r.conclusion !== "string" || r.conclusion.length === 0 || r.conclusion.length > 64) {
      throw new Error("providerRef.conclusion must be 1-64 characters");
    }
    ref.conclusion = r.conclusion;
  }
  return ref;
}

/**
 * Workspace-wide unique provider target key. Survives terminal receipts and
 * crashes: one dispatch reservation per exact target/attempt.
 */
export function actionTargetKey(target: ActionTarget): string {
  return [
    target.repositoryId,
    target.workflowId,
    target.runId,
    String(target.expectedAttempt),
  ].join(":");
}

// --- canonical digest -----------------------------------------------------

/**
 * Fixed-order normalized envelope. The wire format is frozen by Step-0
 * evidence (docs/evidence/act-001/step-0/proposal/canonical-proposal.json,
 * encoding ACT001-INTENT-V1): fixed-order key=value lines joined by U+000A,
 * no trailing newline, UTF-8 bytes; SHA-256 hex of those bytes is the
 * intentDigest. Key order, task binding (taskId@updatedAt only), executor
 * binding (actorType:actorId), and lexicographic finding/artifact sorts are
 * part of the contract and pinned by digest test vectors; do not reorder,
 * add whitespace, or switch to a generic serializer.
 *
 * Decimal provider ids stay validated decimal strings at the boundary
 * (assertDecimalId); the digest emits the same bytes as the frozen numeric
 * form by stripping leading zeros ("007" -> "7").
 */
function normalizeDecimalBytes(value: string): string {
  const stripped = value.replace(/^0+(?=\d)/, "");
  return stripped.length > 0 ? stripped : "0";
}

function compareLexicographic(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function canonicalIntentEnvelope(input: {
  target: ActionTarget;
  executor: ActionExecutor;
  expiresAt: string;
  reason: string;
  task: ActionTaskSnapshot;
  findings: readonly ActionFindingSnapshot[];
  artifacts: readonly ActionArtifactSnapshot[];
  sourceAuthorityRevision: string;
}): string {
  const findingParts = input.findings.map((f) => `${f.id}:${f.currentness}`).sort(compareLexicographic);
  const artifactParts = input.artifacts.map((a) => a.id).sort(compareLexicographic);
  return [
    "ACT001-INTENT-V1",
    `intentVersion=${ACTION_PROPOSAL_INTENT_VERSION}`,
    `kind=${ACTION_PROPOSAL_KIND}`,
    `repoId=${normalizeDecimalBytes(input.target.repositoryId)}`,
    `repoName=${input.target.repositoryName}`,
    `workflowId=${normalizeDecimalBytes(input.target.workflowId)}`,
    `runId=${normalizeDecimalBytes(input.target.runId)}`,
    `sha=${input.target.commitSha}`,
    `expectedAttempt=${input.target.expectedAttempt}`,
    `executor=${input.executor.actorType}:${input.executor.actorId}`,
    `expiresAt=${input.expiresAt}`,
    `reason=${input.reason}`,
    `task=${input.task.id}@${input.task.updatedAt}`,
    `findings=${findingParts.join(",")}`,
    `artifacts=${artifactParts.join(",")}`,
    `sourceAuthorityRev=${input.sourceAuthorityRevision}`,
  ].join("\n");
}

function sha256HexUtf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const bitLen = bytes.length * 8;
  const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLen >>> 0, false);
  view.setUint32(paddedLength - 8, Math.floor(bitLen / 0x100000000), false);
  const w = new Array<number>(64);
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < paddedLength; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i]! + w[i]!) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => (x >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

/** SHA-256 hex over the fixed-order normalized envelope UTF-8 bytes. */
export function actionIntentDigest(envelope: string): string {
  return sha256HexUtf8(envelope);
}

/**
 * Storage codec for `intent_json`. The column carries
 * `CHECK (json_valid(intent_json))` on SQLite and D1 with no migration
 * budget for this fix, so the frozen key=value envelope bytes are stored as
 * a JSON string literal (decode once to recover the exact digest bytes).
 * Reads accept the legacy JSON-object envelope so pre-fix dev databases
 * keep rehydrating.
 */
export function encodeIntentEnvelopeStorage(envelope: string): string {
  return JSON.stringify(envelope);
}

export interface ParsedIntentEnvelope {
  target: ActionTarget;
  executor: ActionExecutor;
  expiresAt: string;
  reason: string;
  taskId: string;
  taskUpdatedAt: string;
  findings: ActionFindingSnapshot[];
  artifacts: ActionArtifactSnapshot[];
  sourceAuthorityRevision: string;
}

/** Inverse of `canonicalIntentEnvelope` for the frozen ACT001-INTENT-V1 lines. */
export function parseIntentEnvelope(envelope: string): ParsedIntentEnvelope {
  const lines = envelope.split("\n");
  if (lines.length < 16 || lines[0] !== "ACT001-INTENT-V1") {
    throw new Error("Stored intent envelope is not a frozen ACT001-INTENT-V1 encoding");
  }
  const fixedPrefix = lines.slice(1, 11);
  const fixedSuffix = lines.slice(-4);
  const reasonLines = lines.slice(11, -4);
  const field = (line: string | undefined, key: string): string => {
    if (line === undefined || !line.startsWith(`${key}=`)) {
      throw new Error(`Stored intent envelope is missing ${key}`);
    }
    return line.slice(key.length + 1);
  };
  const [intentVersion, kind, repoId, repoName, workflowId, runId, sha, expectedAttempt, executor, expiresAt] =
    fixedPrefix as [string, string, string, string, string, string, string, string, string, string];
  if (field(intentVersion, "intentVersion") !== "1" || field(kind, "kind") !== ACTION_PROPOSAL_KIND) {
    throw new Error("Stored intent envelope has an unsupported intent version or kind");
  }
  const executorRaw = field(executor, "executor");
  const separator = executorRaw.indexOf(":");
  if (separator < 1) throw new Error("Stored intent envelope has a malformed executor");
  const actorType = executorRaw.slice(0, separator);
  if (actorType !== "human" && actorType !== "agent") {
    throw new Error("Stored intent envelope has a malformed executor");
  }
  const taskRaw = field(fixedSuffix[0], "task");
  const taskSeparator = taskRaw.lastIndexOf("@");
  if (taskSeparator < 1) throw new Error("Stored intent envelope has a malformed task binding");
  const findingsRaw = field(fixedSuffix[1], "findings");
  const artifactsRaw = field(fixedSuffix[2], "artifacts");
  const attempt = Number(field(expectedAttempt, "expectedAttempt"));
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error("Stored intent envelope has a malformed expectedAttempt");
  }
  const reasonJoined = reasonLines.join("\n");
  if (!reasonJoined.startsWith("reason=")) {
    throw new Error("Stored intent envelope is missing reason");
  }
  const reason = reasonJoined.slice("reason=".length);
  return {
    target: {
      repositoryId: field(repoId, "repoId"),
      repositoryName: field(repoName, "repoName"),
      workflowId: field(workflowId, "workflowId"),
      runId: field(runId, "runId"),
      commitSha: field(sha, "sha"),
      expectedAttempt: attempt,
    },
    executor: { actorId: executorRaw.slice(separator + 1), actorType },
    expiresAt: field(expiresAt, "expiresAt"),
    reason,
    taskId: taskRaw.slice(0, taskSeparator),
    taskUpdatedAt: taskRaw.slice(taskSeparator + 1),
    findings: findingsRaw.length > 0
      ? findingsRaw.split(",").map((part) => {
        const mark = part.lastIndexOf(":");
        if (mark < 1) throw new Error("Stored intent envelope has a malformed finding");
        return { id: part.slice(0, mark), currentness: part.slice(mark + 1) };
      })
      : [],
    artifacts: artifactsRaw.length > 0 ? artifactsRaw.split(",").map((id) => ({ id })) : [],
    sourceAuthorityRevision: field(fixedSuffix[3], "sourceAuthorityRev"),
  };
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

// --- transitions ----------------------------------------------------------

const ALLOWED_TRANSITIONS: Record<ActionProposalStatus, readonly ActionProposalStatus[]> = {
  proposed: ["approved", "rejected", "cancelled"],
  approved: ["cancelled", "dispatch_reserved"],
  rejected: [],
  cancelled: [],
  dispatch_reserved: ["submission_accepted", "submission_failed", "submission_unknown"],
  submission_accepted: [],
  submission_failed: [],
  submission_unknown: ["submission_accepted", "submission_failed"],
};

export function assertActionTransition(from: ActionProposalStatus, to: ActionProposalStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    const error = new Error(`Invalid action transition from ${from} to ${to}`);
    (error as Error & { code?: string }).code = "InvalidTransition";
    throw error;
  }
}

export function outcomeStatus(outcome: ActionSubmissionOutcome): ActionProposalStatus {
  switch (outcome) {
    case "accepted":
    case "reconciled_accepted":
      return "submission_accepted";
    case "definite_failure":
    case "reconciled_failure":
      return "submission_failed";
    case "unknown":
      return "submission_unknown";
  }
}

/** Reconciliation receipts only resolve an unknown submission. */
export function assertReceiptAllowed(
  status: ActionProposalStatus,
  outcome: ActionSubmissionOutcome,
  resolvesReceiptId: string | undefined,
): void {
  const reconciled = outcome === "reconciled_accepted" || outcome === "reconciled_failure";
  if (reconciled) {
    // A missing citation is malformed input however far the proposal has gone.
    if (resolvesReceiptId === undefined || resolvesReceiptId.length === 0) {
      throw new Error("Reconciliation must cite the unknown receipt it resolves");
    }
    if (status !== "submission_unknown") {
      const error = new Error(`Reconciliation requires submission_unknown, not ${status}`);
      (error as Error & { code?: string }).code = "InvalidTransition";
      throw error;
    }
    return;
  }
  if (resolvesReceiptId !== undefined) {
    throw new Error("Only reconciliation receipts cite a resolved receipt");
  }
  if (outcome === "unknown" || outcome === "accepted" || outcome === "definite_failure") {
    if (status !== "dispatch_reserved") {
      const error = new Error(`Outcome ${outcome} requires dispatch_reserved, not ${status}`);
      (error as Error & { code?: string }).code = "InvalidTransition";
      throw error;
    }
    return;
  }
}
