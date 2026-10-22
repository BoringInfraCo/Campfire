/**
 * GitHub workflow_run ingress adapter.
 *
 * Verifies HMAC-SHA256 over exact raw bytes and normalizes a bounded
 * completion event. No store, no authorization, no provider network call.
 * Discard raw webhook bytes after the caller finishes verification.
 */
export const GITHUB_INGRESS_MAX_BODY_BYTES = 256 * 1024;
export const GITHUB_INGRESS_BODY_DEADLINE_MS = 10_000;

export const GITHUB_WORKFLOW_RUN_EVENT = "workflow_run";
export const GITHUB_PING_EVENT = "ping";

const DECIMAL_ID = /^[0-9]{1,20}$/;
const COMMIT_SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const EXPLICIT_CONCLUSIONS = new Set(["success", "failure", "cancelled", "skipped"]);

export type GithubWorkflowConclusion = "success" | "failure" | "cancelled" | "skipped" | "unknown";

export interface NormalizedGithubWorkflowRun {
  action: "completed";
  repositoryId: string;
  repositoryName: string;
  workflowId: string;
  runId: string;
  runAttempt: number;
  headSha: string;
  conclusion: GithubWorkflowConclusion;
  providerTimestamp: string;
}

export type GithubPayloadKind =
  | { kind: "ping" }
  | { kind: "ignored" }
  | { kind: "malformed"; reason: string }
  | { kind: "completed"; event: NormalizedGithubWorkflowRun };

export function timingSafeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

function hexToBytes(hex: string): Uint8Array | undefined {
  if (hex.length === 0 || hex.length % 2 !== 0) return undefined;
  if (!/^[0-9a-fA-F]+$/.test(hex)) return undefined;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacSha256Bytes(secret: string, body: Uint8Array): Promise<Uint8Array> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, body);
  return new Uint8Array(signature);
}

/**
 * Verify `X-Hub-Signature-256` against the exact raw body. Missing or invalid
 * signatures fail closed. The compare is timing-safe and length-checked.
 */
export async function verifyGithubSignature(
  secret: string,
  rawBody: Uint8Array,
  signatureHeader: string | undefined,
): Promise<boolean> {
  if (secret.length === 0 || signatureHeader === undefined) return false;
  const match = /^sha256=([0-9a-fA-F]{64})$/.exec(signatureHeader.trim());
  if (match === null) return false;
  const provided = hexToBytes(match[1]!);
  if (provided === undefined) return false;
  const expected = await hmacSha256Bytes(secret, rawBody);
  return timingSafeEqualBytes(provided, expected);
}

export function githubSignatureHeader(hexDigest: string): string {
  return `sha256=${hexDigest}`;
}

export async function githubSignatureFor(secret: string, rawBody: Uint8Array): Promise<string> {
  const digest = await hmacSha256Bytes(secret, rawBody);
  return githubSignatureHeader(bytesToHex(digest));
}

export function ingressContentTypeAllowed(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  const [media, ...params] = contentType.split(";").map((part) => part.trim().toLowerCase());
  if (media !== "application/json") return false;
  for (const param of params) {
    if (param.startsWith("charset=") && param !== "charset=utf-8" && param !== "charset=utf8") {
      return false;
    }
  }
  return true;
}

/** Identity encoding only. Chunked transfer and compressed bodies are rejected. */
export function ingressEncodingAllowed(
  contentEncoding: string | undefined,
  transferEncoding: string | undefined,
): boolean {
  const content = (contentEncoding ?? "").trim().toLowerCase();
  if (content.length > 0 && content !== "identity") return false;
  const transfer = (transferEncoding ?? "").trim().toLowerCase();
  if (transfer.length > 0 && transfer !== "identity") return false;
  return true;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function ingressTransportAllowed(url: URL): boolean {
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname);
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decimalId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER) {
    return String(value);
  }
  if (typeof value === "string" && DECIMAL_ID.test(value)) return value;
  return undefined;
}

function repositoryName(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) || value.length > 200) {
    return undefined;
  }
  return value;
}

export function normalizeGithubConclusion(raw: unknown): GithubWorkflowConclusion {
  if (typeof raw !== "string") return "unknown";
  if (EXPLICIT_CONCLUSIONS.has(raw)) return raw as GithubWorkflowConclusion;
  return "unknown";
}

/**
 * Artifact URL is constructed from the configured owner/name and a validated
 * numeric run id. Never fetch or store a payload-supplied URL.
 */
export function githubRunArtifactUrl(repositoryNameValue: string, runId: string): string {
  return `https://github.com/${repositoryNameValue}/actions/runs/${runId}`;
}

/** Semantic identity of one completion attempt. Independent of source id and secret. */
export function githubAttemptKey(input: {
  repositoryId: string;
  workflowId: string;
  runId: string;
  attempt: number;
}): string {
  return `act001:github:${input.repositoryId}:${input.workflowId}:${input.runId}:${input.attempt}:workflow_run.completed`;
}

/** Display/semantic key including conclusion (Step 0 digest-vectors example). */
export function githubSemanticKey(input: {
  repositoryId: string;
  workflowId: string;
  runId: string;
  attempt: number;
  conclusion: string;
}): string {
  return `act001:github:${input.repositoryId}:${input.workflowId}:${input.runId}:${input.attempt}:${input.conclusion}`;
}

export function classifyGithubPayload(eventName: string, parsed: unknown): GithubPayloadKind {
  const event = eventName.trim().toLowerCase();
  if (event === GITHUB_PING_EVENT) return { kind: "ping" };
  if (event !== GITHUB_WORKFLOW_RUN_EVENT) return { kind: "ignored" };
  if (!isRecord(parsed)) return { kind: "malformed", reason: "body" };
  const action = parsed.action;
  if (action !== "completed") return { kind: "ignored" };
  const run = parsed.workflow_run;
  if (!isRecord(run)) return { kind: "malformed", reason: "workflow_run" };
  const repository = isRecord(run.repository) ? run.repository : undefined;
  const repositoryId = decimalId(repository?.id);
  const repositoryFullName = repositoryName(repository?.full_name);
  const workflowId = decimalId(run.workflow_id);
  const runId = decimalId(run.id);
  const attempt = run.run_attempt;
  const headSha = typeof run.head_sha === "string" ? run.head_sha.toLowerCase() : "";
  const timestamp =
    typeof run.updated_at === "string"
      ? run.updated_at
      : typeof run.completed_at === "string"
        ? run.completed_at
        : undefined;
  if (
    repositoryId === undefined ||
    repositoryFullName === undefined ||
    workflowId === undefined ||
    runId === undefined ||
    typeof attempt !== "number" ||
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    !COMMIT_SHA.test(headSha) ||
    timestamp === undefined ||
    !Number.isFinite(Date.parse(timestamp))
  ) {
    return { kind: "malformed", reason: "workflow_run" };
  }
  return {
    kind: "completed",
    event: {
      action: "completed",
      repositoryId,
      repositoryName: repositoryFullName,
      workflowId,
      runId,
      runAttempt: attempt,
      headSha,
      conclusion: normalizeGithubConclusion(run.conclusion),
      providerTimestamp: new Date(Date.parse(timestamp)).toISOString(),
    },
  };
}

export function parseGithubJsonBody(raw: Uint8Array): { ok: true; value: unknown } | { ok: false } {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

export function findingSummaryForObservation(attempt: number, conclusion: GithubWorkflowConclusion): string {
  return `Verification attempt ${attempt} completed: ${conclusion}`;
}

export const SIGNED_OBSERVATION_DETAIL =
  "Signed GitHub workflow_run completion. Provider observation, not a participant assessment.";
