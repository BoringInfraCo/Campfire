/**
 * Canonicalization of Campfire MCP tool names across harnesses.
 *
 * Harnesses expose MCP tools differently: OpenCode yields
 * `campfire_list_workspaces` (or the legacy `campfire_campfire_list_workspaces`),
 * Claude Code yields `mcp__campfire__list_workspaces`, Codex may keep the short
 * name. Evaluation must compare calls regardless of that surface difference.
 */

export const CAMPFIRE_TOOL_NAMES = [
  "preflight",
  "whoami",
  "list_workspaces",
  "create_workspace",
  "update_workspace",
  "get_workspace",
  "get_workspace_context",
  "get_activity",
  "join_workspace",
  "invite_workspace",
  "register_agent_session",
  "create_goal",
  "update_goal",
  "add_finding",
  "add_decision",
  "accept_decision",
  "create_task",
  "update_task",
  "add_artifact",
] as const;

export type CampfireToolName = (typeof CAMPFIRE_TOOL_NAMES)[number];

const READ_TOOLS: ReadonlySet<CampfireToolName> = new Set<CampfireToolName>([
  "preflight",
  "whoami",
  "list_workspaces",
  "get_workspace",
  "get_workspace_context",
  "get_activity",
]);

/** Strip harness-added namespace prefixes (mcp__server__, server_, etc.). */
function stripNamespacePrefixes(raw: string): string {
  let value = raw.trim();
  value = value.replace(/^mcp__[^_]+__/i, "");
  value = value.replace(/^mcp[._-]/i, "");
  return value;
}

/** True when `raw` can be recognized as a Campfire MCP tool call. */
export function canonicalToolName(raw: string): string {
  const candidate = stripNamespacePrefixes(raw);
  for (const name of CAMPFIRE_TOOL_NAMES) {
    if (candidate === name || candidate.endsWith(`_${name}`) || candidate.endsWith(`.${name}`)) {
      return `campfire.${name}`;
    }
  }
  return raw;
}

export function isCampfireTool(raw: string): boolean {
  return canonicalToolName(raw).startsWith("campfire.");
}

export function campfireToolName(raw: string): CampfireToolName | undefined {
  const canonical = canonicalToolName(raw);
  if (!canonical.startsWith("campfire.")) return undefined;
  const short = canonical.slice("campfire.".length) as CampfireToolName;
  return CAMPFIRE_TOOL_NAMES.includes(short) ? short : undefined;
}

export function isReadTool(raw: string): boolean {
  const short = campfireToolName(raw);
  return short !== undefined && READ_TOOLS.has(short);
}

export function isWriteTool(raw: string): boolean {
  const short = campfireToolName(raw);
  return short !== undefined && !READ_TOOLS.has(short);
}
