/**
 * CAP-001 local capability catalog.
 *
 * Static installed-interface descriptions plus pure search and recipe lookup.
 * This module does not open a database, call the HTTP client, or read workspace
 * state. A match is not a grant. `available` is not a field and is not a
 * synonym of authorized.
 *
 * Step 0 said every discoverable command maps to exactly one operation.
 * `inspect` is one command with selectors, so get_task, get_decision,
 * get_finding, and get_artifact share it. A command is covered when any
 * included operation usage starts with `campfire <name>` as the command word.
 */
import { CLI_COMMAND_NAMES, commandSpec, isKnownCommand, type CliCommand } from "../cli/catalog.js";
import { ValidationError } from "../domain/errors.js";

export const CAPABILITY_QUERY_ERROR =
  "Query is empty, contains a control character, or is longer than 120 characters.";
export const CAPABILITY_LIMIT_ERROR = "Limit must be an integer from 1 to 10.";
export const CAPABILITY_RECIPE_ERROR = "Unknown read recipe id.";
export const CAPABILITY_SEARCH_MAX_BYTES = 16 * 1024;
export const READ_RECIPE_MAX_BYTES = 8 * 1024;

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 10;
const MAX_QUERY_LENGTH = 120;
const MAX_RECIPE_SUMMARIES = 2;

const FIELD_MAX = {
  id: 64,
  inputName: 64,
  inputType: 32,
  purpose: 400,
  text: 400,
} as const;

export const MCP_TOOL_NAMES = [
  "accept_decision",
  "add_artifact",
  "add_decision",
  "add_finding",
  "cite_decision_basis",
  "cite_finding_evidence",
  "correct_finding",
  "create_goal",
  "create_task",
  "create_workspace",
  "discover_capabilities",
  "get_action_proposal",
  "get_activity",
  "get_artifact",
  "get_decision",
  "get_finding",
  "get_read_recipe",
  "get_record_history",
  "get_task",
  "get_workspace",
  "get_workspace_changes",
  "get_workspace_context",
  "invite_workspace",
  "join_workspace",
  "list_action_proposals",
  "list_action_receipts",
  "list_artifacts",
  "list_decisions",
  "list_findings",
  "list_tasks",
  "list_workspace_participants",
  "list_workspaces",
  "preflight",
  "propose_action",
  "recall_workspace",
  "record_action_outcome",
  "register_agent_session",
  "remove_decision_basis",
  "remove_finding_evidence",
  "reserve_action_execution",
  "retire_decision",
  "update_goal",
  "update_task",
  "update_workspace",
  "whoami",
  "withdraw_finding",
] as const;

const LOCAL_CATALOG_TOOLS = new Set<string>(["discover_capabilities", "get_read_recipe"]);
const LOCAL_CATALOG_REASON = "Local catalog projection, not a workspace operation.";
const OUTSIDE_CORPUS_REASON =
  "Remains installed and authorized on its own path. Outside the v1 CAP-001 search corpus. Listing it in campfire capabilities or tools/list is not a grant.";

const PLAYBOOK_PURPOSE =
  "Return one static Campfire playbook definition by name. Read-only guidance for recording an investigation; it carries no workspace data, performs no workspace authorization, and changes no Campfire state.";

export type CapabilityEffect = "read" | "write" | "local-operation";
export type CapabilityScope = "installed" | "workspace" | "instance";

export interface CapabilityInput {
  name: string;
  type: string;
}

export interface CapabilityUsage {
  usage: string;
}

export interface CapabilityTool {
  tool: string;
}

export interface CapabilityUnavailable {
  unavailable: string;
}

export type CapabilitySurface = CapabilityUsage | CapabilityTool | CapabilityUnavailable;

export interface CapabilityOperation {
  id: string;
  purpose: string;
  effect: CapabilityEffect;
  scope: CapabilityScope;
  requiredInputs: CapabilityInput[];
  preconditions: string[];
  outputCaveat: string;
  surfaces: { cli: CapabilitySurface; mcp: CapabilitySurface };
}

export interface RecipeSummary {
  id: string;
  purpose: string;
}

export interface CapabilitySearch {
  kind: "capability_search";
  catalogVersion: 1;
  query: string;
  returned: number;
  totalMatches: number;
  truncated: boolean;
  entries: CapabilityOperation[];
  recipeSummaries: RecipeSummary[];
}

export interface ReadRecipeStep {
  operationId: string;
  inputsFrom: string;
  surfaces: { cli: CapabilitySurface; mcp: CapabilitySurface };
  stopWhen: string;
  coverageCaveat: string;
}

export interface ReadRecipe {
  kind: "read_recipe";
  recipeVersion: 1;
  id: string;
  goal: string;
  steps: ReadRecipeStep[];
  resultContract: string;
}

export interface CapabilityOmission {
  surface: "cli" | "mcp";
  name: string;
  reason: string;
}

interface CorpusOptions {
  playbookEnabled?: boolean;
}

const ALIASES: Readonly<Record<string, readonly string[]>> = {
  blocked: ["list_tasks", "get_task"],
  history: ["get_record_history"],
  decision: ["list_decisions", "get_decision"],
  context: ["get_workspace_context"],
  "action proposal": ["propose_action"],
  "approve action": ["review_action"],
  "execution receipt": ["record_action_outcome", "list_action_receipts"],
  "verification follow up": ["verification_follow_up"],
};

const RECIPE_ORDER = ["continue-blocked-work", "review-decision-basis"] as const;

const BASE_OPERATIONS_JSON = "[{\"id\":\"bridge\",\"purpose\":\"Inspect outbound webhook delivery state.\",\"effect\":\"read\",\"scope\":\"installed\",\"requiredInputs\":[],\"preconditions\":[\"Hosted inspection uses the operator bridge credential, not an actor token.\"],\"outputCaveat\":\"Origin only. Path, query credentials, and the signing secret are never printed. Not an authorization result.\",\"surfaces\":{\"cli\":{\"usage\":\"campfire bridge [--output auto|human|json] [--db <path>] [--token <operator-token>]\"},\"mcp\":{\"unavailable\":\"operator CLI only; not an agent MCP tool\"}}},{\"id\":\"capabilities\",\"purpose\":\"Describe the installed Campfire CLI commands.\",\"effect\":\"local-operation\",\"scope\":\"installed\",\"requiredInputs\":[],\"preconditions\":[],\"outputCaveat\":\"Unqualified JSON stays kind cli_command_manifest. This entry is not a grant. Search and recipe are separate projections.\",\"surfaces\":{\"cli\":{\"usage\":\"campfire capabilities [--output json]\"},\"mcp\":{\"unavailable\":\"CLI manifest only; MCP provides tools/list and discover_capabilities\"}}},{\"id\":\"dashboard\",\"purpose\":\"Read-only interactive terminal console for one workspace.\",\"effect\":\"read\",\"scope\":\"workspace\",\"requiredInputs\":[],\"preconditions\":[\"Interactive TTY. Non-TTY does not draw the console.\"],\"outputCaveat\":\"Projects an authorized read. Registered agents are not live presence. Attention cues are not permission.\",\"surfaces\":{\"cli\":{\"usage\":\"campfire dashboard [workspace]\"},\"mcp\":{\"unavailable\":\"interactive terminal command; not an MCP tool\"}}},{\"id\":\"get_activity\",\"purpose\":\"List the append-only contribution history for a workspace.\",\"effect\":\"read\",\"scope\":\"workspace\",\"requiredInputs\":[{\"name\":\"workspaceId\",\"type\":\"string\"}],\"preconditions\":[],\"outputCaveat\":\"Workspace-wide contribution page. Not a substitute for get_record_history.\",\"surfaces\":{\"cli\":{\"usage\":\"campfire activity [workspace] [--limit N] [--before <contributionId>] [--output auto|human|json]\"},\"mcp\":{\"tool\":\"get_activity\"}}},{\"id\":\"get_artifact\",\"purpose\":\"Read one artifact in a workspace.\",\"effect\":\"read\",\"scope\":\"workspace\",\"requiredInputs\":[{\"name\":\"workspaceId\",\"type\":\"string\"},{\"name\":\"artifactId\",\"type\":\"string\"}],\"preconditions\":[],\"outputCaveat\":\"One stored reference. A reference is not permission to open the external bytes.\",\"surfaces\":{\"cli\":{\"usage\":\"campfire inspect artifact <id> --workspace <workspaceId> [--output auto|human|json]\"},\"mcp\":{\"tool\":\"get_artifact\"}}},{\"id\":\"get_decision\",\"purpose\":\"Read one decision, including its recorded basis and currentness.\",\"effect\":\"read\",\"scope\":\"workspace\",\"requiredInputs\":[{\"name\":\"workspaceId\",\"type\":\"string\"},{\"name\":\"decisionId\",\"type\":\"string\"}],\"preconditions\":[],\"outputCaveat\":\"needsReview is computed at read time. It is not stored revocation and it is not permission to act.\",\"surfaces\":{\"cli\":{\"usage\":\"campfire inspect decision <id> --workspace <workspaceId> [--output auto|human|json]\"},\"mcp\":{\"tool\":\"get_decision\"}}},{\"id\":\"get_finding\",\"purpose\":\"Read one finding in a workspace.\",\"effect\":\"read\",\"scope\":\"workspace\",\"requiredInputs\":[{\"name\":\"workspaceId\",\"type\":\"string\"},{\"name\":\"findingId\",\"type\":\"string\"}],\"preconditions\":[],\"outputCaveat\":\"Returns that finding's currentness. Orientation's finding slice is not this read.\",\"surfaces\":{\"cli\":{\"usage\":\"campfire inspect finding <id> --workspace <workspaceId> [--output auto|human|json]\"},\"mcp\":{\"tool\":\"get_finding\"}}},{\"id\":\"get_record_history\",\"purpose\":\"Read bounded contributions for one selected task, decision, finding, or artifact.\",\"effect\":\"read\",\"scope\":\"workspace\",\"requiredInputs\":[{\"name\":\"workspaceId\",\"type\":\"string\"},{\"name\":\"objectType\",\"type\":\"string\"},{\"name\":\"objectId\",\"type\":\"string\"}],\"preconditions\":[],\"outputCaveat\":\"Matching contributions for that object only. Default page 10, maximum 50. Not workspace-wide activity.\",\"surfaces\":{\"cli\":{\"unavailable\":\"MCP-only read. campfire activity is workspace-wide and is not this record history.\"},\"mcp\":{\"tool\":\"get_record_history\"}}},{\"id\":\"get_task\",\"purpose\":\"Read one shared work task by id.\",\"effect\":\"read\",\"scope\":\"workspace\",\"requiredInputs\":[{\"name\":\"workspaceId\",\"type\":\"string\"},{\"name\":\"taskId\",\"type\":\"string\"}],\"preconditions\":[],\"outputCaveat\":\"One task. Status and assignee are recorded facts. An assignee is not a live presence, and this read does not change status.\",\"surfaces\":{\"cli\":{\"usage\":\"campfire inspect task <id> --workspace <workspaceId> [--output auto|human|json]\"},\"mcp\":{\"tool\":\"get_task\"}}},{\"id\":\"get_workspace_context\",\"purpose\":\"Show the bounded orientation projection for a workspace.\",\"effect\":\"read\",\"scope\":\"workspace\",\"requiredInputs\":[{\"name\":\"workspaceId\",\"type\":\"string\"}],\"preconditions\":[],\"outputCaveat\":\"Each slice reports total, returned, and truncated. Default task budget is 20. A truncated slice is not the whole workspace. needsReview is not revocation.\",\"surfaces\":{\"cli\":{\"usage\":\"campfire context [workspace] [--since <contributionId>] [--output auto|human|json]\"},\"mcp\":{\"tool\":\"get_workspace_context\"}}},{\"id\":\"help\",\"purpose\":\"Print the grouped help menu or one command's usage.\",\"effect\":\"local-operation\",\"scope\":\"installed\",\"requiredInputs\":[],\"preconditions\":[],\"outputCaveat\":\"Help stays text. It does not read a workspace and it is not a grant.\",\"surfaces\":{\"cli\":{\"usage\":\"campfire help [command]\"},\"mcp\":{\"unavailable\":\"CLI help text; not an MCP tool\"}}},{\"id\":\"list_decisions\",\"purpose\":\"List a bounded page of decisions.\",\"effect\":\"read\",\"scope\":\"workspace\",\"requiredInputs\":[{\"name\":\"workspaceId\",\"type\":\"string\"}],\"preconditions\":[],\"outputCaveat\":\"Page fields are total, returned, truncated, and nextCursor when another row exists. Acceptance is not permission for an external action.\",\"surfaces\":{\"cli\":{\"usage\":\"campfire decisions [workspace] [--status proposed|accepted|superseded] [--limit <n>] [--cursor <opaque>] [--output auto|human|json]\"},\"mcp\":{\"tool\":\"list_decisions\"}}},{\"id\":\"list_tasks\",\"purpose\":\"List a bounded page of shared work tasks.\",\"effect\":\"read\",\"scope\":\"workspace\",\"requiredInputs\":[{\"name\":\"workspaceId\",\"type\":\"string\"}],\"preconditions\":[],\"outputCaveat\":\"Default page is 20, ranked blocked first, then newest. truncated true with no nextCursor is not another page. Do not claim the first page is complete.\",\"surfaces\":{\"cli\":{\"usage\":\"campfire tasks [workspace] [--status open|in_progress|blocked|completed] [--limit <n>] [--cursor <opaque>] [--output auto|human|json]\"},\"mcp\":{\"tool\":\"list_tasks\"}}},{\"id\":\"list_workspaces\",\"purpose\":\"List the workspaces the acting actor participates in.\",\"effect\":\"read\",\"scope\":\"installed\",\"requiredInputs\":[],\"preconditions\":[],\"outputCaveat\":\"Membership list for this actor. Not a cursor page and not a directory of every workspace.\",\"surfaces\":{\"cli\":{\"usage\":\"campfire list [--actor <id>] [--type human|agent] [--db <path>] [--token <token>]\"},\"mcp\":{\"tool\":\"list_workspaces\"}}},{\"id\":\"preflight\",\"purpose\":\"Check endpoint, authenticated identity, and agent-session readiness without changing state.\",\"effect\":\"read\",\"scope\":\"workspace\",\"requiredInputs\":[{\"name\":\"workspaceId\",\"type\":\"string\"}],\"preconditions\":[\"Hosted endpoint. The CLI does not fall back to the local database.\"],\"outputCaveat\":\"Readiness is not a grant to skip later authorization, and a missing session is not a workspace dump.\",\"surfaces\":{\"cli\":{\"usage\":\"campfire preflight <workspaceId> [--session <id>] [--harness <name>] [--token <token>] [--output auto|human|json]\"},\"mcp\":{\"tool\":\"preflight\"}}},{\"id\":\"whoami\",\"purpose\":\"Report the actor identity bound to this client.\",\"effect\":\"read\",\"scope\":\"installed\",\"requiredInputs\":[],\"preconditions\":[],\"outputCaveat\":\"Identity only. No workspace names, membership verdict, or token.\",\"surfaces\":{\"cli\":{\"usage\":\"campfire whoami [--actor <id>] [--type human|agent] [--db <path>] [--token <token>]\"},\"mcp\":{\"tool\":\"whoami\"}}}]";
const CONTINUE_RECIPE_JSON = "{\n  \"kind\": \"read_recipe\",\n  \"recipeVersion\": 1,\n  \"id\": \"continue-blocked-work\",\n  \"goal\": \"Follow existing authorized reads until a selected task and its recorded evidence are identified, including a task that is not on the first bounded page.\",\n  \"steps\": [\n    {\n      \"operationId\": \"list_workspaces\",\n      \"inputsFrom\": \"client selection\",\n      \"surfaces\": {\n        \"cli\": { \"usage\": \"campfire list [--actor <id>] [--type human|agent] [--db <path>] [--token <token>]\" },\n        \"mcp\": { \"tool\": \"list_workspaces\" }\n      },\n      \"stopWhen\": \"Stop if the list is empty or the client has not selected one returned workspace id. This method is not a cursor page.\",\n      \"coverageCaveat\": \"The list is this actor's memberships from this call, not every workspace on the instance.\"\n    },\n    {\n      \"operationId\": \"get_workspace_context\",\n      \"inputsFrom\": \"client selection\",\n      \"surfaces\": {\n        \"cli\": { \"usage\": \"campfire context [workspace] [--since <contributionId>] [--output auto|human|json]\" },\n        \"mcp\": { \"tool\": \"get_workspace_context\" }\n      },\n      \"stopWhen\": \"If slices.tasks.truncated is true or the selected task id is absent from slices.tasks.items, continue to list_tasks. Do not treat suggestedNextAction as the selected task or as permission.\",\n      \"coverageCaveat\": \"Default task budget is 20 and blocker budget is 10. returned, total, and truncated describe the slice. Orientation findings are the current page only. attentionCoverage.completeUnderRules is false when the task or decision slice is truncated. needsReview is not revocation.\"\n    },\n    {\n      \"operationId\": \"list_tasks\",\n      \"inputsFrom\": \"client selection\",\n      \"surfaces\": {\n        \"cli\": { \"usage\": \"campfire tasks [workspace] [--status open|in_progress|blocked|completed] [--limit <n>] [--cursor <opaque>] [--output auto|human|json]\" },\n        \"mcp\": { \"tool\": \"list_tasks\" }\n      },\n      \"stopWhen\": \"Page only while nextCursor is present, and only for this actor and workspace. Stop when the selected task id appears or nextCursor is absent. truncated true with no nextCursor is the end of this traversal, not another page, and not proof the first page was complete.\",\n      \"coverageCaveat\": \"Default limit is 20. A cursor from this page must not be reused for another actor or workspace.\"\n    },\n    {\n      \"operationId\": \"get_task\",\n      \"inputsFrom\": \"client selection\",\n      \"surfaces\": {\n        \"cli\": { \"usage\": \"campfire inspect task <id> --workspace <workspaceId> [--output auto|human|json]\" },\n        \"mcp\": { \"tool\": \"get_task\" }\n      },\n      \"stopWhen\": \"Stop if the read is denied or the task is missing. Record status, recorded assignee if any, and provenance. Do not change status and do not infer that an assignee is live.\",\n      \"coverageCaveat\": \"One task. Not a workspace page.\"\n    },\n    {\n      \"operationId\": \"get_decision\",\n      \"inputsFrom\": \"client selection\",\n      \"surfaces\": {\n        \"cli\": { \"usage\": \"campfire inspect decision <id> --workspace <workspaceId> [--output auto|human|json]\" },\n        \"mcp\": { \"tool\": \"get_decision\" }\n      },\n      \"stopWhen\": \"Run only for a decision id already present on an authorized read in this sequence. If none was recorded, skip and label the gap. Do not search for a likely decision.\",\n      \"coverageCaveat\": \"One decision. Report proposed, accepted, or accepted-and-needsReview from the record. needsReview is not revocation.\"\n    },\n    {\n      \"operationId\": \"get_finding\",\n      \"inputsFrom\": \"citations[].findingId\",\n      \"surfaces\": {\n        \"cli\": { \"usage\": \"campfire inspect finding <id> --workspace <workspaceId> [--output auto|human|json]\" },\n        \"mcp\": { \"tool\": \"get_finding\" }\n      },\n      \"stopWhen\": \"Read only finding ids on the recorded citations. If a citation is missing or denied, label that gap and do not substitute orientation text.\",\n      \"coverageCaveat\": \"One finding per call. Keep current and non-current findings distinct.\"\n    },\n    {\n      \"operationId\": \"get_artifact\",\n      \"inputsFrom\": \"evidence[].artifactId\",\n      \"surfaces\": {\n        \"cli\": { \"usage\": \"campfire inspect artifact <id> --workspace <workspaceId> [--output auto|human|json]\" },\n        \"mcp\": { \"tool\": \"get_artifact\" }\n      },\n      \"stopWhen\": \"Run only when a finding in this sequence records an evidence artifact id. Otherwise skip. Do not open external bytes.\",\n      \"coverageCaveat\": \"Stored reference only.\"\n    },\n    {\n      \"operationId\": \"get_record_history\",\n      \"inputsFrom\": \"client selection\",\n      \"surfaces\": {\n        \"cli\": { \"unavailable\": \"MCP-only read. campfire activity is workspace-wide and is not this record history.\" },\n        \"mcp\": { \"tool\": \"get_record_history\" }\n      },\n      \"stopWhen\": \"Run when the change sequence for the selected task or a cited decision matters. A CLI client stops and labels the record-history gap. Do not call campfire activity as a substitute and do not fabricate contribution ids.\",\n      \"coverageCaveat\": \"Default page is 10 and maximum is 50, for that object only. Pass nextCursor only for this same object, actor, and workspace. No nextCursor means this traversal has no further row.\"\n    }\n  ],\n  \"resultContract\": \"The handoff names the selected record ids, lifecycle state, provenance, currentness of cited findings, coverage (returned, total, truncated, and whether nextCursor was present), and unresolved gaps. It does not claim a truncated page was complete, does not treat needsReview as revocation or permission, does not infer a live assignee, and does not change task status.\"\n}\n";
const REVIEW_RECIPE_JSON = "{\n  \"kind\": \"read_recipe\",\n  \"recipeVersion\": 1,\n  \"id\": \"review-decision-basis\",\n  \"goal\": \"Read one selected decision and the currentness of its recorded basis without treating a review cue as revocation or permission.\",\n  \"steps\": [\n    {\n      \"operationId\": \"get_workspace_context\",\n      \"inputsFrom\": \"client selection\",\n      \"surfaces\": {\n        \"cli\": { \"usage\": \"campfire context [workspace] [--since <contributionId>] [--output auto|human|json]\" },\n        \"mcp\": { \"tool\": \"get_workspace_context\" }\n      },\n      \"stopWhen\": \"If the selected decision id is in slices.decisions.items, continue to get_decision. If that slice is truncated or the id is absent, page list_decisions. Do not choose an operative decision when more than one accepted decision is returned.\",\n      \"coverageCaveat\": \"The decision slice is bounded. Orientation findings are current rows only, so a non-current cited finding can be absent here. needsReview on a returned accepted decision is a review cue, not revocation.\"\n    },\n    {\n      \"operationId\": \"list_decisions\",\n      \"inputsFrom\": \"client selection\",\n      \"surfaces\": {\n        \"cli\": { \"usage\": \"campfire decisions [workspace] [--status proposed|accepted|superseded] [--limit <n>] [--cursor <opaque>] [--output auto|human|json]\" },\n        \"mcp\": { \"tool\": \"list_decisions\" }\n      },\n      \"stopWhen\": \"Skip if the selected id was already returned on a decision slice whose truncated is false. Otherwise page while nextCursor is present. If the id never appears, stop and label the gap.\",\n      \"coverageCaveat\": \"Pass nextCursor only for this actor and workspace. Do not treat a short page as the full decision set when nextCursor is present. The CLI sends limit 100 when --limit is omitted (MAX_PAGE_SIZE). An MCP call that omits limit uses the service default 10 (DEFAULT_CONTEXT_BUDGET.decisions). Those defaults are not the same page.\"\n    },\n    {\n      \"operationId\": \"get_decision\",\n      \"inputsFrom\": \"client selection\",\n      \"surfaces\": {\n        \"cli\": { \"usage\": \"campfire inspect decision <id> --workspace <workspaceId> [--output auto|human|json]\" },\n        \"mcp\": { \"tool\": \"get_decision\" }\n      },\n      \"stopWhen\": \"Stop if the read is denied or the decision is missing. Record status, needsReview, needsReviewFindingIds, and citation ids before reading findings.\",\n      \"coverageCaveat\": \"One decision. Accepted plus needsReview stays accepted. The flag is computed at read time from cited findings that are no longer current.\"\n    },\n    {\n      \"operationId\": \"get_finding\",\n      \"inputsFrom\": \"citations[].findingId\",\n      \"surfaces\": {\n        \"cli\": { \"usage\": \"campfire inspect finding <id> --workspace <workspaceId> [--output auto|human|json]\" },\n        \"mcp\": { \"tool\": \"get_finding\" }\n      },\n      \"stopWhen\": \"Read only finding ids on the decision's recorded citations. Report each currentness. Do not drop a non-current citation and do not describe needsReview as revoked.\",\n      \"coverageCaveat\": \"One finding per call. A superseded or withdrawn finding remains the cited text; currentness says it is not the current assertion.\"\n    },\n    {\n      \"operationId\": \"get_record_history\",\n      \"inputsFrom\": \"client selection\",\n      \"surfaces\": {\n        \"cli\": { \"unavailable\": \"MCP-only read. campfire activity is workspace-wide and is not this record history.\" },\n        \"mcp\": { \"tool\": \"get_record_history\" }\n      },\n      \"stopWhen\": \"Run if replacement or currentness is unclear from get_decision. A CLI client stops and labels the record-history gap. Do not call campfire activity as a substitute.\",\n      \"coverageCaveat\": \"Contributions for this decision only. No nextCursor means this traversal has no further row.\"\n    }\n  ],\n  \"resultContract\": \"The handoff names the decision id, its status, whether needsReview is true, the cited finding ids and their currentness, provenance, coverage, and unresolved gaps. It reports proposed versus accepted versus accepted-needing-review accurately. It does not treat a review cue as revocation or as permission to act, and it does not invent a replacement that was not recorded.\"\n}\n";

const BASE_OPERATIONS = JSON.parse(BASE_OPERATIONS_JSON) as CapabilityOperation[];
const RECIPES = [
  JSON.parse(CONTINUE_RECIPE_JSON) as ReadRecipe,
  JSON.parse(REVIEW_RECIPE_JSON) as ReadRecipe,
];

const ACTIONS_CLI_USAGE =
  "campfire actions propose|approve|reject|cancel|reserve|receipt|inspect|list|receipts [--output auto|human|json]";

const ACT001_OPERATIONS: readonly CapabilityOperation[] = [
  {
    id: "propose_action",
    purpose: "Propose one concrete verification retry action for later human approval.",
    effect: "write",
    scope: "workspace",
    requiredInputs: [
      { name: "workspaceId", type: "string" },
      { name: "target", type: "object" },
      { name: "executor", type: "object" },
      { name: "reason", type: "string" },
      { name: "taskId", type: "string" },
      { name: "requestKey", type: "string" },
    ],
    preconditions: ["Caller is a non-viewer participant. Input JSON is structured data and is never executed."],
    outputCaveat: "Records intent only. It is not approval, dispatch, or a GitHub credential.",
    surfaces: {
      cli: { usage: ACTIONS_CLI_USAGE },
      mcp: { tool: "propose_action" },
    },
  },
  {
    id: "review_action",
    purpose: "Approve or reject an action proposal as a human workspace owner.",
    effect: "write",
    scope: "workspace",
    requiredInputs: [
      { name: "workspaceId", type: "string" },
      { name: "proposalId", type: "string" },
      { name: "revision", type: "number" },
      { name: "intentDigest", type: "string" },
      { name: "requestKey", type: "string" },
    ],
    preconditions: ["Human workspace owner credential. An agent owner role never passes this check."],
    outputCaveat: "Binds the exact inspected effect. An accepted Decision does not grant dispatch.",
    surfaces: {
      cli: { usage: ACTIONS_CLI_USAGE },
      mcp: { unavailable: "human operator CLI only; approval never passes through an agent MCP tool" },
    },
  },
  {
    id: "cancel_action",
    purpose: "Cancel an action proposal before reservation.",
    effect: "write",
    scope: "workspace",
    requiredInputs: [
      { name: "workspaceId", type: "string" },
      { name: "proposalId", type: "string" },
      { name: "revision", type: "number" },
      { name: "intentDigest", type: "string" },
      { name: "reason", type: "string" },
      { name: "requestKey", type: "string" },
    ],
    preconditions: ["Human workspace owner credential. Cancellation after reservation cannot stop an external request."],
    outputCaveat: "Terminal. A cancelled proposal cannot reopen.",
    surfaces: {
      cli: { usage: ACTIONS_CLI_USAGE },
      mcp: { unavailable: "human operator CLI only; cancellation never passes through an agent MCP tool" },
    },
  },
  {
    id: "reserve_action_execution",
    purpose: "Reserve the one dispatch slot for an approved action.",
    effect: "write",
    scope: "workspace",
    requiredInputs: [
      { name: "workspaceId", type: "string" },
      { name: "proposalId", type: "string" },
      { name: "revision", type: "number" },
      { name: "intentDigest", type: "string" },
      { name: "requestKey", type: "string" },
    ],
    preconditions: ["Caller is the designated executor. Rechecks current authority, digest, and evidence snapshot."],
    outputCaveat: "Returns the approved intent. Not a GitHub credential and not an executable script.",
    surfaces: {
      cli: { usage: ACTIONS_CLI_USAGE },
      mcp: { tool: "reserve_action_execution" },
    },
  },
  {
    id: "record_action_outcome",
    purpose: "Record a bounded execution receipt after submitting the retry.",
    effect: "write",
    scope: "workspace",
    requiredInputs: [
      { name: "workspaceId", type: "string" },
      { name: "proposalId", type: "string" },
      { name: "revision", type: "number" },
      { name: "intentDigest", type: "string" },
      { name: "outcome", type: "string" },
      { name: "providerRef", type: "object" },
      { name: "requestKey", type: "string" },
    ],
    preconditions: ["Caller is the designated executor. Uses the executor's own provider credential."],
    outputCaveat: "A receipt is not proof the tests passed and is not permission to merge or release.",
    surfaces: {
      cli: { usage: ACTIONS_CLI_USAGE },
      mcp: { tool: "record_action_outcome" },
    },
  },
  {
    id: "get_action_proposal",
    purpose: "Inspect one action proposal, its review, reservation, and latest receipt.",
    effect: "read",
    scope: "workspace",
    requiredInputs: [
      { name: "workspaceId", type: "string" },
      { name: "proposalId", type: "string" },
    ],
    preconditions: [],
    outputCaveat: "Does not flatten requested versus observed outcomes into one success boolean.",
    surfaces: {
      cli: { usage: ACTIONS_CLI_USAGE },
      mcp: { tool: "get_action_proposal" },
    },
  },
  {
    id: "list_action_proposals",
    purpose: "List a bounded page of action proposals.",
    effect: "read",
    scope: "workspace",
    requiredInputs: [{ name: "workspaceId", type: "string" }],
    preconditions: [],
    outputCaveat: "Page fields are total, returned, truncated, and nextCursor when another row exists.",
    surfaces: {
      cli: { usage: ACTIONS_CLI_USAGE },
      mcp: { tool: "list_action_proposals" },
    },
  },
  {
    id: "list_action_receipts",
    purpose: "List a bounded page of receipts for one action proposal.",
    effect: "read",
    scope: "workspace",
    requiredInputs: [
      { name: "workspaceId", type: "string" },
      { name: "proposalId", type: "string" },
    ],
    preconditions: [],
    outputCaveat: "Review, reservation, submission, and reconciliation remain distinct authorities.",
    surfaces: {
      cli: { usage: ACTIONS_CLI_USAGE },
      mcp: { tool: "list_action_receipts" },
    },
  },
  {
    id: "verification_follow_up",
    purpose: "Inspect signed verification follow-up evidence after a reserved retry.",
    effect: "read",
    scope: "workspace",
    requiredInputs: [{ name: "workspaceId", type: "string" }],
    preconditions: [
      "Operator-bound GitHub source must be configured. Ingress is POST /v1/integrations/github/:sourceId, not MCP.",
    ],
    outputCaveat: "Signed completion is provider evidence, not an executor assertion. Inspect via actions inspect|list|receipts.",
    surfaces: {
      cli: { usage: ACTIONS_CLI_USAGE },
      mcp: {
        unavailable:
          "operator HTTP ingress; not an MCP tool. Inspect via campfire actions inspect|list|receipts",
      },
    },
  },
];

export const ACT001_OPERATION_IDS: ReadonlySet<string> = new Set(ACT001_OPERATIONS.map((operation) => operation.id));

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function assertShort(owner: string, field: string, value: string, max: number): void {
  if (value.length > max) {
    throw new Error(`capability field ${owner}.${field} is ${value.length} characters; max ${max}`);
  }
}

function assertSurfaceBounds(owner: string, surface: CapabilitySurface): void {
  if ("usage" in surface) assertShort(owner, "usage", surface.usage, FIELD_MAX.text);
  if ("tool" in surface) assertShort(owner, "tool", surface.tool, FIELD_MAX.text);
  if ("unavailable" in surface) assertShort(owner, "unavailable", surface.unavailable, FIELD_MAX.text);
}

function assertOperationBounds(operation: CapabilityOperation): void {
  assertShort(operation.id, "id", operation.id, FIELD_MAX.id);
  assertShort(operation.id, "purpose", operation.purpose, FIELD_MAX.purpose);
  assertShort(operation.id, "outputCaveat", operation.outputCaveat, FIELD_MAX.text);
  for (const precondition of operation.preconditions) {
    assertShort(operation.id, "precondition", precondition, FIELD_MAX.text);
  }
  for (const input of operation.requiredInputs) {
    assertShort(operation.id, "input.name", input.name, FIELD_MAX.inputName);
    assertShort(operation.id, "input.type", input.type, FIELD_MAX.inputType);
  }
  assertSurfaceBounds(operation.id, operation.surfaces.cli);
  assertSurfaceBounds(operation.id, operation.surfaces.mcp);
}

function assertRecipeBounds(recipe: ReadRecipe): void {
  assertShort(recipe.id, "id", recipe.id, FIELD_MAX.id);
  assertShort(recipe.id, "goal", recipe.goal, FIELD_MAX.purpose);
  for (const step of recipe.steps) {
    assertSurfaceBounds(`${recipe.id}.${step.operationId}`, step.surfaces.cli);
    assertSurfaceBounds(`${recipe.id}.${step.operationId}`, step.surfaces.mcp);
  }
  if (jsonBytes(recipe) > READ_RECIPE_MAX_BYTES) {
    throw new Error(`read recipe ${recipe.id} exceeds ${READ_RECIPE_MAX_BYTES} bytes`);
  }
}

function playbookOperation(): CapabilityOperation {
  return {
    id: "get_playbook",
    purpose: PLAYBOOK_PURPOSE,
    effect: "read",
    scope: "installed",
    requiredInputs: [{ name: "name", type: "string" }],
    preconditions: ["Requires the existing playbook gate."],
    outputCaveat: "Not a workspace read and not a grant.",
    surfaces: {
      cli: { usage: commandSpec("playbook").usage },
      mcp: { tool: "get_playbook" },
    },
  };
}

function operationsFor(playbookEnabled: boolean): readonly CapabilityOperation[] {
  const operations = playbookEnabled ? [...BASE_OPERATIONS, playbookOperation()] : [...BASE_OPERATIONS];
  return [...operations, ...ACT001_OPERATIONS];
}

function aliasesFor(id: string): readonly string[] {
  const aliases: string[] = [];
  for (const [alias, ids] of Object.entries(ALIASES)) {
    if (ids.includes(id)) aliases.push(alias);
  }
  return aliases;
}

function operationHaystack(operation: CapabilityOperation): string {
  const parts = [operation.id, operation.purpose, ...aliasesFor(operation.id)];
  const cli = operation.surfaces.cli;
  if ("usage" in cli) parts.push(cli.usage);
  const mcp = operation.surfaces.mcp;
  if ("tool" in mcp) parts.push(mcp.tool);
  return parts.join("\n").toLowerCase();
}

function recipeHaystack(recipe: ReadRecipe): string {
  return `${recipe.id}\n${recipe.goal}`.toLowerCase();
}

function hasControl(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function collapseSpaces(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) === 0x20) start += 1;
  while (end > start && value.charCodeAt(end - 1) === 0x20) end -= 1;
  return value.slice(start, end).replace(/ {2,}/g, " ");
}

function queryError(): never {
  throw new ValidationError(CAPABILITY_QUERY_ERROR, { field: "query" });
}

function limitError(): never {
  throw new ValidationError(CAPABILITY_LIMIT_ERROR, { field: "limit" });
}

function commandWord(usage: string): string | undefined {
  const word = usage.split(" ")[1];
  return word === undefined || word.length === 0 ? undefined : word;
}

function coveredCommandWords(playbookEnabled: boolean): Set<string> {
  const words = new Set<string>();
  for (const operation of operationsFor(playbookEnabled)) {
    const cli = operation.surfaces.cli;
    if (!("usage" in cli)) continue;
    const word = commandWord(cli.usage);
    if (word !== undefined) words.add(word);
  }
  return words;
}

function coveredToolNames(playbookEnabled: boolean): Set<string> {
  const tools = new Set<string>();
  for (const operation of operationsFor(playbookEnabled)) {
    const mcp = operation.surfaces.mcp;
    if ("tool" in mcp) tools.add(mcp.tool);
  }
  return tools;
}

function discoverableNames(playbookEnabled: boolean): readonly CliCommand[] {
  return CLI_COMMAND_NAMES.filter((name) => name !== "playbook" || playbookEnabled);
}

export function capabilityOperations(options?: CorpusOptions): readonly CapabilityOperation[] {
  return structuredClone(operationsFor(options?.playbookEnabled === true)) as CapabilityOperation[];
}

export function capabilityOmissions(options?: CorpusOptions): readonly CapabilityOmission[] {
  const playbookEnabled = options?.playbookEnabled === true;
  const commands = coveredCommandWords(playbookEnabled);
  const tools = coveredToolNames(playbookEnabled);
  const omissions: CapabilityOmission[] = [];
  for (const name of discoverableNames(playbookEnabled)) {
    if (!commands.has(name)) {
      omissions.push({ surface: "cli", name, reason: OUTSIDE_CORPUS_REASON });
    }
  }
  for (const name of MCP_TOOL_NAMES) {
    if (!tools.has(name)) {
      omissions.push({
        surface: "mcp",
        name,
        reason: LOCAL_CATALOG_TOOLS.has(name) ? LOCAL_CATALOG_REASON : OUTSIDE_CORPUS_REASON,
      });
    }
  }
  return omissions;
}

export const CAPABILITY_OMISSIONS: readonly CapabilityOmission[] = capabilityOmissions();

export function assertCorpusParity(input: {
  cliCommands: readonly string[];
  mcpTools: readonly string[];
  playbookEnabled?: boolean;
}): void {
  const playbookEnabled = input.playbookEnabled === true;
  const operations = operationsFor(playbookEnabled);
  const words = coveredCommandWords(playbookEnabled);
  const tools = coveredToolNames(playbookEnabled);
  const knownTools = new Set<string>(MCP_TOOL_NAMES);
  if (playbookEnabled) knownTools.add("get_playbook");
  for (const operation of operations) {
    const cli = operation.surfaces.cli;
    if ("usage" in cli) {
      const word = commandWord(cli.usage);
      if (word === undefined || !isKnownCommand(word)) {
        throw new Error(`capability ${operation.id} cli usage is not an installed command`);
      }
    }
    const mcp = operation.surfaces.mcp;
    if ("tool" in mcp && !knownTools.has(mcp.tool)) {
      throw new Error(`capability ${operation.id} names mcp tool ${mcp.tool}, which is not registered`);
    }
  }
  const omissions = capabilityOmissions({ playbookEnabled });
  for (const name of input.cliCommands) {
    if (!words.has(name) && !omissions.some((entry) => entry.surface === "cli" && entry.name === name)) {
      throw new Error(`cli command ${name} is neither in the search corpus nor omitted`);
    }
  }
  for (const name of input.mcpTools) {
    if (!tools.has(name) && !omissions.some((entry) => entry.surface === "mcp" && entry.name === name)) {
      throw new Error(`mcp tool ${name} is neither in the search corpus nor omitted`);
    }
  }
}

export function searchCapabilities(
  query: string,
  limit: number | undefined,
  options?: CorpusOptions,
): CapabilitySearch {
  if (hasControl(query)) queryError();
  const collapsed = collapseSpaces(query);
  if (collapsed.length === 0) queryError();
  if (collapsed.length > MAX_QUERY_LENGTH) queryError();
  const normalized = collapsed.toLowerCase();
  const resolvedLimit = limit === undefined ? DEFAULT_LIMIT : limit;
  if (!Number.isInteger(resolvedLimit) || resolvedLimit < 1 || resolvedLimit > MAX_LIMIT) limitError();
  const tokens = normalized.split(" ");
  const playbookEnabled = options?.playbookEnabled === true;
  const matched = operationsFor(playbookEnabled)
    .filter((operation) => tokens.every((token) => operationHaystack(operation).includes(token)))
    .slice()
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const totalMatches = matched.length;
  const summaries: RecipeSummary[] = [];
  for (const id of RECIPE_ORDER) {
    const recipe = RECIPES.find((entry) => entry.id === id);
    if (recipe === undefined) continue;
    if (!tokens.every((token) => recipeHaystack(recipe).includes(token))) continue;
    summaries.push({ id: recipe.id, purpose: recipe.goal });
    if (summaries.length === MAX_RECIPE_SUMMARIES) break;
  }
  let entries = matched.slice(0, resolvedLimit).map((operation) => structuredClone(operation));
  let truncated = totalMatches > entries.length;
  const project = (): CapabilitySearch => ({
    kind: "capability_search",
    catalogVersion: 1,
    query: normalized,
    returned: entries.length,
    totalMatches,
    truncated,
    entries,
    recipeSummaries: summaries,
  });
  let result = project();
  while (entries.length > 0 && jsonBytes(result) > CAPABILITY_SEARCH_MAX_BYTES) {
    entries = entries.slice(0, -1);
    truncated = true;
    result = project();
  }
  return result;
}

export function getReadRecipe(id: string): ReadRecipe {
  const recipe = RECIPES.find((entry) => entry.id === id);
  if (recipe === undefined) {
    throw new ValidationError(CAPABILITY_RECIPE_ERROR, { field: "id" });
  }
  return structuredClone(recipe);
}

for (const operation of BASE_OPERATIONS) assertOperationBounds(operation);
for (const operation of ACT001_OPERATIONS) assertOperationBounds(operation);
assertOperationBounds(playbookOperation());
for (const recipe of RECIPES) assertRecipeBounds(recipe);
