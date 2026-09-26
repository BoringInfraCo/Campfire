/**
 * CLI usage text. Grouped by product journey so `campfire --help` is a menu,
 * and `campfire <command> --help` is that command only.
 */
export const CLI_COMMANDS = [
  "setup",
  "onboard",
  "connect",
  "doctor",
  "handoff",
  "up",
  "status",
  "whoami",
  "list",
  "show",
  "activity",
  "preflight",
  "create-workspace",
  "update-workspace",
  "create-goal",
  "update-goal",
  "add-finding",
  "add-decision",
  "accept-decision",
  "create-task",
  "update-task",
  "add-artifact",
  "create-human",
  "create-agent",
  "issue-token",
  "revoke-token",
  "invite",
  "join",
  "serve",
  "view",
  "mcp",
  "init",
  "bootstrap",
  "seed",
  "help",
] as const;

export type CliCommand = (typeof CLI_COMMANDS)[number];

const COMMAND_SET = new Set<string>(CLI_COMMANDS);

export function isKnownCommand(name: string): name is CliCommand {
  return COMMAND_SET.has(name);
}

interface CommandHelp {
  usage: string;
  notes?: string[];
}

const COMMAND_HELP: Record<CliCommand, CommandHelp> = {
  setup: {
    usage: "campfire setup [--json]",
    notes: [
      "Agent-readable setup contract. Creates no state and prints no credential.",
      "Human credential: operator CLI / administration.",
      "Agent credential: exactly one harness process (CAMPFIRE_TOKEN).",
      "Handoff: no credential.",
    ],
  },
  onboard: {
    usage:
      "campfire onboard --human-name <name> --agent-name <name> --harness <name> --workspace-name <name> --goal <title> [--json]",
    notes: [
      "First-run path: one human, one agent they own, one workspace, and one goal.",
      "Does not start the server or register an agent session.",
      "Human-mode stores credentials locally and does not reprint tokens.",
      "--json prints each one-time token once, then never again.",
      "A second run refuses when a human or workspace already exists.",
      "Then use create-human, create-agent, create-workspace, create-goal, invite, and join.",
      "There is no reset flag. seed --reset is the demo fixture, not a new operator workspace.",
    ],
  },
  connect: {
    usage:
      "campfire connect --harness codex|opencode [--config <path>] [--url <url>] [--token <agent-token>] [--workspace <id>] [--mcp-command <path>]",
    notes: [
      "Writes only that harness's Campfire MCP block. Unrelated settings stay in place.",
      "After onboard, --token / --config / --workspace can come from the local profile.",
      "The agent token is stored in the config file and is not printed.",
      "Reload the harness or start a fresh process. Approval may be required.",
    ],
  },
  doctor: {
    usage:
      "campfire doctor <workspaceId> --harness <name> [--session <sessionId>] [--token <agent-token>] [--json]",
    notes: [
      "Read-only setup diagnosis. Does not register a session or search for one.",
      "Hosted doctor needs the id from register_agent_session via --session or CAMPFIRE_SESSION_ID (--session wins).",
      "Human output keeps the nextAction token and adds a copy-pasteable command.",
      "--json keeps the stable nextAction token. Do not put the session id or tokens in a handoff.",
    ],
  },
  handoff: {
    usage:
      "campfire handoff <workspaceId> --harness <name> --viewer-url <loopback-url> [--token <agent-token>] [--json]",
    notes: [
      "Non-secret Viewer receipt: workspace, goal, names, readiness, loopback URL.",
      "The Viewer URL must stay on loopback. The browser never receives a token.",
      "Fails when doctor is not ready; use the printed next command.",
    ],
  },
  up: {
    usage: "campfire up [--no-connect] [--no-open] [--port 9414] [--viewer-port 9415]",
    notes: [
      "Starts serve and view in this process, connects each installed Codex or OpenCode,",
      "and opens the loopback Viewer. Does not import past sessions.",
      "Session registration stays an explicit agent step.",
    ],
  },
  status: {
    usage: "campfire status [--json]",
    notes: ["Shows the current workspace without credentials."],
  },
  whoami: {
    usage: "campfire whoami [--actor <id>] [--type human|agent] [--db <path>] [--token <token>]",
  },
  list: {
    usage: "campfire list [--actor <id>] [--type human|agent] [--db <path>] [--token <token>]",
  },
  show: {
    usage: "campfire show <workspaceId> [--since <contributionId>] [--json] [--full]",
    notes: [
      "Default output is the orientation projection as readable text.",
      "--since adds contributions recorded strictly after that id, states when older rows are omitted,",
      "and prints the newest contribution id as the resume cursor.",
      "--full uses the inspector (get_workspace). --json is the machine-readable object.",
    ],
  },
  activity: {
    usage: "campfire activity <workspaceId> [--limit N] [--before <contributionId>] [--json]",
  },
  preflight: {
    usage: "campfire preflight <workspaceId> [--session <id>] [--harness <name>] [--token <token>] [--json]",
    notes: [
      "Hosted only: CAMPFIRE_URL is required. Does not fall back to the local database.",
      "Validates endpoint, token, identity, workspace access, and agent-session readiness without mutation.",
    ],
  },
  "create-workspace": {
    usage: "campfire create-workspace --team <teamId> --name <name> [--description <text>]",
  },
  "update-workspace": {
    usage: "campfire update-workspace <workspaceId> --status active|completed|archived",
  },
  "create-goal": {
    usage: "campfire create-goal --workspace <workspaceId> --title <title> [--description <text>]",
  },
  "update-goal": {
    usage:
      "campfire update-goal <goalId> [--title <title>] [--description <text>] [--status active|completed|abandoned]",
  },
  "add-finding": {
    usage: "campfire add-finding --workspace <workspaceId> --summary <text> [--detail <text>] [--confidence <n>]",
  },
  "add-decision": {
    usage: "campfire add-decision --workspace <workspaceId> --summary <text> [--rationale <text>]",
  },
  "accept-decision": {
    usage: "campfire accept-decision <decisionId>",
  },
  "create-task": {
    usage:
      "campfire create-task --workspace <workspaceId> --title <title> [--description <text>] [--assignee-id <id> --assignee-type human|agent]",
  },
  "update-task": {
    usage:
      "campfire update-task <taskId> --status open|in_progress|blocked|completed [--title <title>] [--description <text>] [--assignee-id <id> --assignee-type human|agent]",
  },
  "add-artifact": {
    usage: "campfire add-artifact --workspace <workspaceId> --type file|document|log|other --title <title> --uri <path>",
    notes: [
      "--type is the artifact type, not the acting identity.",
      "Acting as an agent uses CAMPFIRE_ACTOR_TYPE or --token, not --type.",
    ],
  },
  "create-human": {
    usage: "campfire create-human --name <display> --team <teamId>",
  },
  "create-agent": {
    usage: "campfire create-agent --name <name> --human <humanId> --harness <name> [--team <teamId>]",
  },
  "issue-token": {
    usage: "campfire issue-token --actor <id> --type human|agent",
    notes: ["Prints the raw token once. Do not put it in a handoff or the Viewer."],
  },
  "revoke-token": {
    usage: "campfire revoke-token <token> [--revoke-token <token>]",
  },
  invite: {
    usage: "campfire invite <workspaceId> --actor <id> --type human|agent --role owner|member|agent|viewer",
  },
  join: {
    usage: "campfire join <workspaceId>",
  },
  serve: {
    usage: "campfire serve [--host 127.0.0.1] [--port 9414]",
    notes: [
      "Hosts the HTTP API. Always uses the local SQLite file.",
      "When CAMPFIRE_URL is set, other commands POST /v1/call instead of opening that file.",
    ],
  },
  view: {
    usage: "campfire view [--host 127.0.0.1] [--port 9415] [--allow-remote] [--theme campfire|fx]",
    notes: [
      "Read-only team journal. Binds loopback only (127.0.0.1, ::1, localhost).",
      "Non-loopback --host requires --allow-remote. The browser never receives a token.",
    ],
  },
  mcp: {
    usage:
      "campfire mcp [--actor <id>] [--type human|agent] [--session <id>] [--harness <name>] [--db <path>] [--token <token>]",
    notes: ["Speaks MCP JSON-RPC on stdio. No --json mode."],
  },
  init: {
    usage: "campfire init",
    notes: ["Creates the local database parent directory. Prints { databasePath }."],
  },
  bootstrap: {
    usage: "campfire bootstrap [--org <orgId>] [--team <teamId>] [--org-name <name>] [--team-name <name>] [--human-name <name>]",
  },
  seed: {
    usage: "campfire seed [--reset]",
    notes: [
      "Loads the deterministic demo/evaluation fixture. Not a new operator workspace.",
      "SEED NOTE: --reset deletes the database file and its -wal/-shm sidecars before seeding.",
      "Real first run: campfire onboard.",
    ],
  },
  help: {
    usage: "campfire help [command]",
    notes: ["With no command, prints the grouped menu. campfire <command> --help is the same as campfire help <command>."],
  },
};

const GLOBAL_NOTES = [
  "Global options:",
  "  --db <path>        Override CAMPFIRE_DB for this process.",
  "  --token <token>    Actor token (or CAMPFIRE_TOKEN). Preferred over --actor.",
  "  --actor <id>       Actor identity for local use (default: hum_sergio).",
  "  --type <t>         Actor type, human|agent (default: human).",
  "  --session <id>     Agent session id.",
  "  --harness <name>   Harness name for MCP / session registration.",
  "  --json             Machine-readable output contract (described below).",
  "",
  "When CAMPFIRE_URL is set, commands POST /v1/call with CAMPFIRE_TOKEN / --token",
  "instead of opening the local SQLite file. serve/init/seed always use the local DB.",
  "",
  "show prints the orientation projection as readable text; --since adds the",
  "contributions recorded strictly after that id, states when older rows are",
  "omitted, and prints the newest contribution id as the resume cursor. --full",
  "uses the inspector (get_workspace). show and activity default to human text",
  "and honor",
  "--json; init, seed, bootstrap, whoami, list, and every create/add/update/",
  "accept/issue/revoke/invite/join command print JSON with or without the flag.",
  "Under --json a failure prints {\"error\":{\"code\",\"message\"[,\"details\"]}} on",
  "stderr and may include a sibling next array of copy-pasteable commands. It",
  "exits 1. serve, view, mcp, and help have no JSON mode: serve and",
  "view log notices to stderr, mcp speaks MCP JSON-RPC on stdio, help prints",
  "this text. add-artifact's --type is the artifact type; acting as an agent",
  "there uses CAMPFIRE_ACTOR_TYPE or --token, not --type.",
  "",
  "view binds loopback only (127.0.0.1, ::1, localhost); non-loopback --host",
  "requires --allow-remote. The browser never receives a token.",
  "",
  "campfire with no args records the human once, then prints status. It does",
  "not ask for agents, workspaces, or goals. campfire up starts serve and view",
  "in this process, connects each installed Codex or OpenCode as an agent that",
  "human owns, and opens the loopback Viewer. It does not import past sessions.",
  "The agent in a session creates the workspace and goal. Session registration",
  "stays explicit. onboard remains the one-shot script path and does not start",
  "the server. seed --reset remains the deterministic demo fixture. setup",
  "prints the agent-readable contract and creates no state.",
  "connect writes only the named harness config and requires a reload or new",
  "process. doctor is read-only. Hosted doctor needs the session id from",
  "register_agent_session via --session or CAMPFIRE_SESSION_ID (--session wins).",
  "It does not look up or register a session. Do not put the session id or",
  "tokens in the handoff. handoff prints a loopback Viewer receipt and never a token.",
  "",
  "SEED NOTE: --reset deletes the database file and its -wal/-shm sidecars before seeding.",
];

export function formatUsage(): string {
  return [
    "Campfire",
    "",
    "Usage:",
    "  campfire [--human-name <name>]  Record you, then listen. Agents appear when a harness connects",
    "  campfire <command> --help       Usage for one command",
    "",
    "First run:",
    `  ${COMMAND_HELP.setup.usage}`,
    `  ${COMMAND_HELP.onboard.usage}`,
    `  ${COMMAND_HELP.connect.usage}`,
    `  ${COMMAND_HELP.doctor.usage}`,
    `  ${COMMAND_HELP.handoff.usage}`,
    `  ${COMMAND_HELP.up.usage}`,
    `  ${COMMAND_HELP.status.usage}`,
    "",
    "Inspect:",
    `  ${COMMAND_HELP.whoami.usage}`,
    `  ${COMMAND_HELP.list.usage}`,
    `  ${COMMAND_HELP.show.usage}`,
    `  ${COMMAND_HELP.activity.usage}`,
    `  ${COMMAND_HELP.preflight.usage}`,
    "",
    "Contribute:",
    `  ${COMMAND_HELP["create-workspace"].usage}`,
    `  ${COMMAND_HELP["update-workspace"].usage}`,
    `  ${COMMAND_HELP["create-goal"].usage}`,
    `  ${COMMAND_HELP["update-goal"].usage}`,
    `  ${COMMAND_HELP["add-finding"].usage}`,
    `  ${COMMAND_HELP["add-decision"].usage}`,
    `  ${COMMAND_HELP["accept-decision"].usage}`,
    `  ${COMMAND_HELP["create-task"].usage}`,
    `  ${COMMAND_HELP["update-task"].usage}`,
    `  ${COMMAND_HELP["add-artifact"].usage}`,
    "",
    "Identity:",
    `  ${COMMAND_HELP["create-human"].usage}`,
    `  ${COMMAND_HELP["create-agent"].usage}`,
    `  ${COMMAND_HELP["issue-token"].usage}`,
    `  ${COMMAND_HELP["revoke-token"].usage}`,
    `  ${COMMAND_HELP.invite.usage}`,
    `  ${COMMAND_HELP.join.usage}`,
    "",
    "Run:",
    `  ${COMMAND_HELP.serve.usage}`,
    `  ${COMMAND_HELP.view.usage}`,
    `  ${COMMAND_HELP.mcp.usage}`,
    "",
    "Fixtures:",
    `  ${COMMAND_HELP.init.usage}`,
    `  ${COMMAND_HELP.bootstrap.usage}`,
    `  ${COMMAND_HELP.seed.usage}`,
    "",
    ...GLOBAL_NOTES,
  ].join("\n");
}

export function formatCommandUsage(command: CliCommand): string {
  const help = COMMAND_HELP[command];
  const lines = [`Usage:`, `  ${help.usage}`];
  if (help.notes !== undefined && help.notes.length > 0) {
    lines.push("", ...help.notes);
  }
  lines.push("", "See campfire --help for the full command list and global options.");
  return lines.join("\n");
}
