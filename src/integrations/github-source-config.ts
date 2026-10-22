/**
 * Operator-bound GitHub inbound source configuration.
 *
 * Read from the process environment. This is not an MCP tool and not an
 * agent-editable workspace setting. Secrets are never logged or returned.
 */
import { ACTION_PROPOSAL_KIND } from "../domain/action-proposal.js";
import { sha256HexBytes } from "./github-workflow-run.js";

export const GITHUB_SOURCE_ENV = {
  id: "CAMPFIRE_GITHUB_SOURCE_ID",
  workspaceId: "CAMPFIRE_GITHUB_SOURCE_WORKSPACE_ID",
  repositoryId: "CAMPFIRE_GITHUB_SOURCE_REPOSITORY_ID",
  repositoryName: "CAMPFIRE_GITHUB_SOURCE_REPOSITORY_NAME",
  workflowId: "CAMPFIRE_GITHUB_SOURCE_WORKFLOW_ID",
  kind: "CAMPFIRE_GITHUB_SOURCE_KIND",
  secret: "CAMPFIRE_GITHUB_SOURCE_SECRET",
  agentId: "CAMPFIRE_GITHUB_SOURCE_AGENT_ID",
  sessionId: "CAMPFIRE_GITHUB_SOURCE_SESSION_ID",
} as const;

const ENV_NAMES = [
  GITHUB_SOURCE_ENV.id,
  GITHUB_SOURCE_ENV.workspaceId,
  GITHUB_SOURCE_ENV.repositoryId,
  GITHUB_SOURCE_ENV.repositoryName,
  GITHUB_SOURCE_ENV.workflowId,
  GITHUB_SOURCE_ENV.kind,
  GITHUB_SOURCE_ENV.secret,
  GITHUB_SOURCE_ENV.agentId,
  GITHUB_SOURCE_ENV.sessionId,
] as const;

const DECIMAL_ID = /^[0-9]{1,20}$/;
const SOURCE_ID = /^[A-Za-z0-9._-]{1,128}$/;
const REPOSITORY_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export interface GithubSourceBinding {
  sourceId: string;
  workspaceId: string;
  repositoryId: string;
  repositoryName: string;
  workflowId: string;
  actionKind: typeof ACTION_PROPOSAL_KIND;
  secret: string;
  agentId: string;
  sessionId: string;
}

export type GithubSourceConfigResult =
  | { configured: false; problem?: string }
  | { configured: true; source: GithubSourceBinding };

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

/**
 * Canonical non-secret authority fingerprint (Step 0 digest-vectors).
 * Secret material is excluded so rotation keeps the binding.
 */
export function sourceAuthorityFingerprintBytes(input: {
  sourceId: string;
  workspaceId: string;
  repositoryId: string;
  repositoryName: string;
  workflowId: string;
  actionKind: string;
  agentId: string;
  sessionId: string;
}): Uint8Array {
  const lines = [
    "ACT001-SOURCE-V1",
    `sourceId=${input.sourceId}`,
    `workspaceId=${input.workspaceId}`,
    `repoId=${input.repositoryId}`,
    `repoName=${input.repositoryName}`,
    `workflowId=${input.workflowId}`,
    `actionKind=${input.actionKind}`,
    `integrationAgent=agent:${input.agentId}:${input.sessionId}`,
  ].join("\n");
  return new TextEncoder().encode(lines);
}

export async function sourceAuthorityFingerprint(input: {
  sourceId: string;
  workspaceId: string;
  repositoryId: string;
  repositoryName: string;
  workflowId: string;
  actionKind: string;
  agentId: string;
  sessionId: string;
}): Promise<string> {
  return sha256HexBytes(sourceAuthorityFingerprintBytes(input));
}

export function sourceAuthorityEquals(
  stored: {
    workspaceId: string;
    repositoryId: string;
    repositoryName: string;
    workflowId: string;
    actionKind: string;
    integrationAgentId: string;
  },
  source: GithubSourceBinding,
): boolean {
  // Session/secret renewal may keep the same authority binding. Workspace,
  // provider target, and integration actor may not change under one source id.
  return (
    stored.workspaceId === source.workspaceId &&
    stored.repositoryId === source.repositoryId &&
    stored.repositoryName === source.repositoryName &&
    stored.workflowId === source.workflowId &&
    stored.actionKind === source.actionKind &&
    stored.integrationAgentId === source.agentId
  );
}

export type SourceAuthorityVerdict = "match" | "session-rotation" | "rebinding-conflict";

/**
 * Fingerprint enforcement for a previously used source id.
 *
 * `sourceAuthorityEquals` covers every authority field except the renewable
 * session id (secret is never stored). The stored `authorityFingerprint`
 * covers those fields plus `sessionId`, so once equality passes any
 * fingerprint mismatch can only be a session renewal: update the stored
 * fingerprint and keep the binding. A failed equality check is a rebinding
 * attempt (workspace/target/kind/agent changed) and must conflict, even if
 * the caller also rotated the session.
 */
export function classifySourceAuthority(
  stored: {
    workspaceId: string;
    repositoryId: string;
    repositoryName: string;
    workflowId: string;
    actionKind: string;
    integrationAgentId: string;
    authorityFingerprint: string;
  },
  source: GithubSourceBinding,
  recomputedFingerprint: string,
): SourceAuthorityVerdict {
  if (!sourceAuthorityEquals(stored, source)) return "rebinding-conflict";
  if (stored.authorityFingerprint === recomputedFingerprint) return "match";
  return "session-rotation";
}

export function readGithubSourceConfig(env: Record<string, string | undefined>): GithubSourceConfigResult {
  const values = ENV_NAMES.map((name) => env[name]);
  if (values.every((value) => value === undefined)) {
    return { configured: false };
  }
  if (values.some((value) => isBlank(value))) {
    return { configured: false, problem: "incomplete github source configuration" };
  }

  const sourceId = (env[GITHUB_SOURCE_ENV.id] ?? "").trim();
  const workspaceId = (env[GITHUB_SOURCE_ENV.workspaceId] ?? "").trim();
  const repositoryId = (env[GITHUB_SOURCE_ENV.repositoryId] ?? "").trim();
  const repositoryName = (env[GITHUB_SOURCE_ENV.repositoryName] ?? "").trim();
  const workflowId = (env[GITHUB_SOURCE_ENV.workflowId] ?? "").trim();
  const actionKind = (env[GITHUB_SOURCE_ENV.kind] ?? "").trim();
  const secret = env[GITHUB_SOURCE_ENV.secret] ?? "";
  const agentId = (env[GITHUB_SOURCE_ENV.agentId] ?? "").trim();
  const sessionId = (env[GITHUB_SOURCE_ENV.sessionId] ?? "").trim();

  if (!SOURCE_ID.test(sourceId) || workspaceId.length === 0 || agentId.length === 0 || sessionId.length === 0) {
    return { configured: false, problem: "incomplete github source configuration" };
  }
  if (!DECIMAL_ID.test(repositoryId) || !DECIMAL_ID.test(workflowId) || !REPOSITORY_NAME.test(repositoryName)) {
    return { configured: false, problem: "incomplete github source configuration" };
  }
  if (actionKind !== ACTION_PROPOSAL_KIND) {
    return { configured: false, problem: "unsupported github source kind" };
  }
  if (secret.length === 0) {
    return { configured: false, problem: "incomplete github source configuration" };
  }
  const outbound = env.CAMPFIRE_WEBHOOK_SECRET;
  if (outbound !== undefined && outbound.length > 0 && outbound === secret) {
    return { configured: false, problem: "inbound github secret must differ from outbound webhook secret" };
  }

  return {
    configured: true,
    source: {
      sourceId,
      workspaceId,
      repositoryId,
      repositoryName,
      workflowId,
      actionKind: ACTION_PROPOSAL_KIND,
      secret,
      agentId,
      sessionId,
    },
  };
}
