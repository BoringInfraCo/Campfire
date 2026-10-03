/**
 * Typed CLI command catalog (CLI-001).
 *
 * This is the single source for command recognition, primary vs advanced help
 * grouping, usage text, mutability classification, workspace-scoping metadata,
 * supported output modes, and the `campfire capabilities` manifest. Dispatch
 * paths live in `src/cli/index.ts`; tests fail when the catalog and dispatch
 * map diverge. The catalog never holds business logic.
 */
export const CLI_COMMAND_NAMES = [
  "setup",
  "onboard",
  "connect",
  "doctor",
  "handoff",
  "up",
  "status",
  "agents",
  "decisions",
  "changes",
  "inspect",
  "capabilities",
  "bridge",
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
  "invite-teammate",
  "revoke-invitation",
  "join",
  "serve",
  "view",
  "mcp",
  "init",
  "bootstrap",
  "seed",
  "telemetry",
  "help",
] as const;

export type CliCommand = (typeof CLI_COMMAND_NAMES)[number];

export const CLI_GROUPS = ["start", "workspace", "recover", "discover", "admin"] as const;
export type CliGroup = (typeof CLI_GROUPS)[number];

export type CliOutputMode = "auto" | "human" | "json";

export const CLI_OUTPUT_MODES = ["auto", "human", "json"] as const;

export interface CliCommandSpec {
  readonly name: CliCommand;
  readonly group: CliGroup;
  /** One sentence for the help menu and the capabilities manifest. */
  readonly description: string;
  readonly usage: string;
  /** True when the command can change Campfire state. */
  readonly mutates: boolean;
  /** True when the command operates on one authorized workspace. */
  readonly workspaceScoped: boolean;
  /**
   * Modes the command accepts. Every command accepts `auto`. JSON-only data
   * commands omit `human`; protocol commands own stdout and ignore output flags.
   */
  readonly outputModes: readonly CliOutputMode[];
  /** True for commands that own stdout (help text, MCP JSON-RPC, long-running servers). */
  readonly protocol: boolean;
  /** True when the command always prints JSON, even under `auto`. */
  readonly alwaysJson: boolean;
  /**
   * True when a successful result can carry a one-time credential. Under
   * `auto` these commands stay human so a pipe cannot silently capture a
   * token; the credential receipt requires explicit JSON (CLI-001).
   */
  readonly credentials: boolean;
  readonly variants?: readonly { selector: string; usage: string; mutates: boolean; outputModes: readonly CliOutputMode[] }[];
  readonly related?: readonly CliCommand[];
  readonly notes?: readonly string[];
}

const DUAL = ["auto", "human", "json"] as const;
const JSON_ONLY = ["auto", "json"] as const;
const PROTOCOL = ["auto"] as const;

function spec(
  name: CliCommand,
  group: CliGroup,
  description: string,
  usage: string,
  options: Pick<CliCommandSpec, "mutates" | "workspaceScoped"> & {
    outputModes?: readonly CliOutputMode[];
    protocol?: boolean;
    alwaysJson?: boolean;
    credentials?: boolean;
    variants?: CliCommandSpec["variants"];
    related?: readonly CliCommand[];
    notes?: readonly string[];
  },
): CliCommandSpec {
  const outputModes = options.outputModes ?? DUAL;
  return {
    name,
    group,
    description,
    usage,
    mutates: options.mutates,
    workspaceScoped: options.workspaceScoped,
    outputModes,
    protocol: options.protocol ?? false,
    alwaysJson: options.alwaysJson ?? (outputModes.length === 2 && !outputModes.includes("human")),
    credentials: options.credentials ?? false,
    ...(options.variants === undefined ? {} : { variants: options.variants }),
    ...(options.related === undefined ? {} : { related: options.related }),
    ...(options.notes === undefined ? {} : { notes: options.notes }),
  };
}

const READ = { mutates: false } as const;
const WRITE = { mutates: true } as const;

export const CLI_CATALOG: Record<CliCommand, CliCommandSpec> = {
  "invite-teammate": spec("invite-teammate", "start", "Create a private invitation for a new teammate.", "campfire invite-teammate <workspaceId> --out <private-file> --url <https-endpoint> [--expires-in-hours 24] [--allow-loopback]", { ...WRITE, workspaceScoped: true, related: ["join", "revoke-invitation"], notes: [
    "Owner-only: authorizes one new human to join this workspace with bounded agent identities.",
    "The written file holds a credential. Anyone who holds it can claim that enrollment.",
    "A display name is not a verified email or an account identity.",
    "Transfer the file yourself over a channel you choose. Campfire sends no message and hosts no share URL.",
    "--allow-loopback is same-machine-only: it is for isolated developer tests, never for another machine.",
  ] }),
  "revoke-invitation": spec("revoke-invitation", "recover", "Revoke an enrollment invitation without removing existing members.", "campfire revoke-invitation <invitationId> --workspace <workspaceId>", { ...WRITE, workspaceScoped: true, notes: [
    "Cancels an unclaimed invitation, or stops receipt replay for a consumed one.",
    "It does not remove already enrolled humans, agents, credentials, or membership. It is not offboarding.",
  ] }),
  setup: spec(
    "setup",
    "start",
    "Print the agent-readable setup contract without creating state.",
    "campfire setup [--output auto|human|json]",
    { ...READ, workspaceScoped: false, notes: [
      "Agent-readable setup contract. Creates no state and prints no credential.",
      "Human credential: operator CLI / administration.",
      "Agent credential: exactly one harness process (CAMPFIRE_TOKEN).",
      "Handoff: no credential.",
    ] },
  ),
  onboard: spec(
    "onboard",
    "start",
    "First-run path: one human, one agent they own, one workspace, and one goal.",
    "campfire onboard --human-name <name> --agent-name <name> --harness <name> --workspace-name <name> --goal <title> [--output auto|human|json]",
    { ...WRITE, workspaceScoped: false, credentials: true, related: ["up", "connect"], notes: [
      "First-run path: one human, one agent they own, one workspace, and one goal.",
      "Does not start the server or register an agent session.",
      "Credential-bearing: without --json or --output json this always renders",
      "the token-free human receipt, even when piped, so a pipe cannot capture tokens.",
      "Human-mode stores credentials locally and does not reprint tokens.",
      "--output json prints each one-time token once, then never again.",
      "A second run refuses when a human or workspace already exists.",
      "Then use create-human, create-agent, create-workspace, create-goal, invite, and join.",
      "There is no reset flag. seed --reset is the demo fixture, not a new operator workspace.",
    ] },
  ),
  connect: spec(
    "connect",
    "start",
    "Write the Campfire MCP connection block for one installed harness.",
    "campfire connect --harness codex|opencode [--config <path>] [--url <url>] [--token <agent-token>] [--workspace <id>] [--mcp-command <path>] [--output auto|human|json]",
    { ...WRITE, workspaceScoped: false, related: ["up", "doctor"], notes: [
      "Writes only that harness's Campfire MCP block. Unrelated settings stay in place.",
      "After onboard, --token / --config / --workspace can come from the local profile.",
      "The agent token is stored in the config file and is not printed.",
      "Reload the harness or start a fresh process. Approval may be required.",
    ] },
  ),
  doctor: spec(
    "doctor",
    "recover",
    "Diagnose whether an agent can read a workspace; read-only.",
    "campfire doctor <workspaceId> --harness <name> [--session <sessionId>] [--token <agent-token>] [--output auto|human|json]",
    { ...READ, workspaceScoped: true, related: ["handoff", "status"], notes: [
      "Read-only setup diagnosis. Does not register a session or search for one.",
      "Hosted doctor needs the id from register_agent_session via --session or CAMPFIRE_SESSION_ID (--session wins).",
      "Human output keeps the nextAction token and adds a copy-pasteable command.",
      "--output json keeps the stable nextAction token. Do not put the session id or tokens in a handoff.",
    ] },
  ),
  handoff: spec(
    "handoff",
    "recover",
    "Print a non-secret Viewer handoff receipt.",
    "campfire handoff <workspaceId> --harness <name> --viewer-url <loopback-url> [--token <agent-token>] [--output auto|human|json]",
    { ...READ, workspaceScoped: true, related: ["doctor", "view"], notes: [
      "Non-secret Viewer receipt: workspace, goal, names, readiness, loopback URL.",
      "The Viewer URL must stay on loopback. The browser never receives a token.",
      "Fails when doctor is not ready; use the printed next command.",
    ] },
  ),
  up: spec(
    "up",
    "start",
    "Start the local API and Viewer, connect installed harnesses, then listen.",
    "campfire up [--no-connect] [--no-open] [--port 9414] [--viewer-port 9415] [--output auto|human|json]",
    { ...WRITE, workspaceScoped: false, related: ["status", "connect"], notes: [
      "Starts serve and view, connects each installed Codex or OpenCode,",
      "and opens the loopback Viewer. Does not import past sessions.",
      "A later loopback harness session reuses this listener, or starts it when it is down.",
      "Session registration stays an explicit agent step.",
    ] },
  ),
  status: spec(
    "status",
    "workspace",
    "Show the live authorized workspace overview.",
    "campfire status [workspace] [--output auto|human|json]",
    { ...READ, workspaceScoped: true, related: ["agents", "decisions", "changes", "inspect"], notes: [
      "Retrieves the authorized WorkspaceContext; the local profile selects a workspace but is never the source of truth.",
      "Includes goal, work counts, decision counts, attention items, and the newest contribution cursor.",
      "A profile with a human but no workspace returns awaiting_workspace.",
    ] },
  ),
  agents: spec(
    "agents",
    "workspace",
    "List the workspace's recorded agent participants.",
    "campfire agents [workspace] [--output auto|human|json]",
    { ...READ, workspaceScoped: true, related: ["status", "inspect"], notes: [
      "Static participant facts only: id, name, role, harness, human owner, joined timestamp.",
      "Never a presence label. An unended session is not proof that an agent is live.",
    ] },
  ),
  decisions: spec(
    "decisions",
    "workspace",
    "List proposed, accepted, and superseded decisions.",
    "campfire decisions [workspace] [--output auto|human|json]",
    { ...READ, workspaceScoped: true, related: ["status", "inspect"], notes: [
      "Read projection over the existing decision lifecycle. No new approval model.",
      "Acceptance remains a Campfire lifecycle transition, not permission for an external action.",
    ] },
  ),
  changes: spec(
    "changes",
    "workspace",
    "List Contributions after a cursor, or the recent provenance window.",
    "campfire changes [workspace] [--since <contributionId>] [--output auto|human|json]",
    { ...READ, workspaceScoped: true, related: ["activity", "status"], notes: [
      "With --since, returns Contributions strictly after that cursor and the cursor to retain next.",
      "Without --since, returns the existing bounded recent provenance window and the newest cursor.",
      "Unknown or foreign-workspace cursors fail; this is not a second event log and not a Git diff.",
    ] },
  ),
  inspect: spec(
    "inspect",
    "workspace",
    "Inspect one workspace object by kind and id.",
    "campfire inspect <workspace|agent|goal|task|finding|decision|artifact|contribution> <id> --workspace <workspaceId> [--output auto|human|json]",
    { ...READ, workspaceScoped: true, related: ["status", "decisions"], notes: [
      "Retrieves the authorized workspace and selects the object from its existing full projection.",
      "Except for workspace itself, --workspace is required. No cross-workspace lookup.",
      "An inspected agent is a static participant record, not a live process inspection.",
    ] },
  ),
  capabilities: spec(
    "capabilities",
    "discover",
    "Describe the installed Campfire CLI commands.",
    "campfire capabilities [--output json]",
    { ...READ, workspaceScoped: false, related: ["help"], notes: [
      "Command discovery only. This is not the future Campfire Capability domain object.",
      "The manifest kind is cli_command_manifest and lists installed CLI operations.",
      "An installed command is not a grant; authorization still happens in Campfire Core.",
    ] },
  ),
  bridge: spec(
    "bridge",
    "admin",
    "Inspect outbound webhook delivery state.",
    "campfire bridge [--output auto|human|json] [--db <path>] [--token <operator-token>]",
    { ...READ, workspaceScoped: false, notes: [
      "Shows whether the outbound webhook is configured, its filters, and delivery counts.",
      "The destination is reported as origin only; path/query credentials and the signing secret are never printed.",
      "With CAMPFIRE_URL set it inspects the hosted instance using CAMPFIRE_BRIDGE_TOKEN (or --token), never an actor token.",
      "Does not print the signing secret and is not an agent MCP tool.",
      "pending rows stay listed after the configuration is removed.",
    ] },
  ),
  whoami: spec(
    "whoami",
    "admin",
    "Print the resolved actor identity as JSON.",
    "campfire whoami [--actor <id>] [--type human|agent] [--db <path>] [--token <token>]",
    { ...READ, workspaceScoped: false, outputModes: JSON_ONLY, alwaysJson: true },
  ),
  list: spec(
    "list",
    "admin",
    "List authorized workspaces as JSON.",
    "campfire list [--actor <id>] [--type human|agent] [--db <path>] [--token <token>]",
    { ...READ, workspaceScoped: false, outputModes: JSON_ONLY, alwaysJson: true },
  ),
  show: spec(
    "show",
    "admin",
    "Show the orientation projection for a workspace.",
    "campfire show <workspaceId> [--since <contributionId>] [--output auto|human|json] [--full]",
    { ...READ, workspaceScoped: true, related: ["status", "changes"], notes: [
      "Default output is the orientation projection; --output human renders it as text.",
      "--since adds contributions recorded strictly after that id, states when older rows are omitted,",
      "and prints the newest contribution id as the resume cursor.",
      "--full uses the inspector (get_workspace). --output json is the machine-readable object.",
    ] },
  ),
  activity: spec(
    "activity",
    "admin",
    "List recent Contributions for a workspace.",
    "campfire activity [workspace] [--limit N] [--before <contributionId>] [--output auto|human|json]",
    { ...READ, workspaceScoped: true, related: ["changes", "show"] },
  ),
  preflight: spec(
    "preflight",
    "admin",
    "Validate hosted endpoint, identity, workspace access, and session readiness.",
    "campfire preflight <workspaceId> [--session <id>] [--harness <name>] [--token <token>] [--output auto|human|json]",
    { ...READ, workspaceScoped: true, notes: [
      "Hosted only: CAMPFIRE_URL is required. Does not fall back to the local database.",
      "Validates endpoint, token, identity, workspace access, and agent-session readiness without mutation.",
    ] },
  ),
  "create-workspace": spec(
    "create-workspace",
    "admin",
    "Create a workspace in a team.",
    "campfire create-workspace --team <teamId> --name <name> [--description <text>]",
    { ...WRITE, workspaceScoped: false, outputModes: JSON_ONLY, alwaysJson: true },
  ),
  "update-workspace": spec(
    "update-workspace",
    "admin",
    "Change a workspace lifecycle status.",
    "campfire update-workspace <workspaceId> --status active|completed|archived",
    { ...WRITE, workspaceScoped: true, outputModes: JSON_ONLY, alwaysJson: true },
  ),
  "create-goal": spec(
    "create-goal",
    "admin",
    "Create the workspace goal.",
    "campfire create-goal --workspace <workspaceId> --title <title> [--description <text>]",
    { ...WRITE, workspaceScoped: true, outputModes: JSON_ONLY, alwaysJson: true },
  ),
  "update-goal": spec(
    "update-goal",
    "admin",
    "Update the goal title, description, or status.",
    "campfire update-goal <goalId> [--title <title>] [--description <text>] [--status active|completed|abandoned]",
    { ...WRITE, workspaceScoped: true, outputModes: JSON_ONLY, alwaysJson: true },
  ),
  "add-finding": spec(
    "add-finding",
    "admin",
    "Record a finding in a workspace.",
    "campfire add-finding --workspace <workspaceId> --summary <text> [--detail <text>] [--confidence <n>]",
    { ...WRITE, workspaceScoped: true, outputModes: JSON_ONLY, alwaysJson: true },
  ),
  "add-decision": spec(
    "add-decision",
    "admin",
    "Propose a decision in a workspace.",
    "campfire add-decision --workspace <workspaceId> --summary <text> [--rationale <text>]",
    { ...WRITE, workspaceScoped: true, outputModes: JSON_ONLY, alwaysJson: true },
  ),
  "accept-decision": spec(
    "accept-decision",
    "admin",
    "Accept a proposed decision.",
    "campfire accept-decision <decisionId>",
    { ...WRITE, workspaceScoped: true, outputModes: JSON_ONLY, alwaysJson: true },
  ),
  "create-task": spec(
    "create-task",
    "admin",
    "Create a task in a workspace.",
    "campfire create-task --workspace <workspaceId> --title <title> [--description <text>] [--assignee-id <id> --assignee-type human|agent]",
    { ...WRITE, workspaceScoped: true, outputModes: JSON_ONLY, alwaysJson: true },
  ),
  "update-task": spec(
    "update-task",
    "admin",
    "Update a task status, title, description, or assignee.",
    "campfire update-task <taskId> --status open|in_progress|blocked|completed [--title <title>] [--description <text>] [--assignee-id <id> --assignee-type human|agent]",
    { ...WRITE, workspaceScoped: true, outputModes: JSON_ONLY, alwaysJson: true },
  ),
  "add-artifact": spec(
    "add-artifact",
    "admin",
    "Attach an artifact reference to a workspace.",
    "campfire add-artifact --workspace <workspaceId> --type file|document|log|other --title <title> --uri <path>",
    { ...WRITE, workspaceScoped: true, outputModes: JSON_ONLY, alwaysJson: true, notes: [
      "--type is the artifact type, not the acting identity.",
      "Acting as an agent uses CAMPFIRE_ACTOR_TYPE or --token, not --type.",
    ] },
  ),
  "create-human": spec(
    "create-human",
    "admin",
    "Create a human identity.",
    "campfire create-human --name <display> --team <teamId>",
    { ...WRITE, workspaceScoped: false, outputModes: JSON_ONLY, alwaysJson: true },
  ),
  "create-agent": spec(
    "create-agent",
    "admin",
    "Create an agent identity owned by a human.",
    "campfire create-agent --name <name> --human <humanId> --harness <name> [--team <teamId>]",
    { ...WRITE, workspaceScoped: false, outputModes: JSON_ONLY, alwaysJson: true },
  ),
  "issue-token": spec(
    "issue-token",
    "admin",
    "Mint an actor token and print it once.",
    "campfire issue-token --actor <id> --type human|agent",
    { ...WRITE, workspaceScoped: false, outputModes: JSON_ONLY, alwaysJson: true, notes: [
      "Prints the raw token once. Do not put it in a handoff or the Viewer.",
    ] },
  ),
  "revoke-token": spec(
    "revoke-token",
    "admin",
    "Revoke an actor token.",
    "campfire revoke-token <token> [--revoke-token <token>]",
    { ...WRITE, workspaceScoped: false, outputModes: JSON_ONLY, alwaysJson: true },
  ),
  invite: spec(
    "invite",
    "admin",
    "Invite an actor to a workspace with a role.",
    "campfire invite <workspaceId> --actor <id> --type human|agent --role owner|member|agent|viewer",
    { ...WRITE, workspaceScoped: true, outputModes: JSON_ONLY, alwaysJson: true },
  ),
  join: spec(
    "join",
    "admin",
    "Consume a workspace invite for the acting actor.",
    "campfire join <workspaceId>",
    { ...WRITE, workspaceScoped: true, outputModes: JSON_ONLY, alwaysJson: true },
  ),
  serve: spec(
    "serve",
    "admin",
    "Host the local HTTP API. Always uses the local SQLite file.",
    "campfire serve [--host 127.0.0.1] [--port 9414]",
    { ...READ, workspaceScoped: false, outputModes: PROTOCOL, protocol: true, notes: [
      "Hosts the HTTP API. Always uses the local SQLite file.",
      "When CAMPFIRE_URL is set, other commands POST /v1/call instead of opening that file.",
      "Operational notices go to stderr; stdout carries no result document.",
    ] },
  ),
  view: spec(
    "view",
    "admin",
    "Serve the read-only Viewer on loopback.",
    "campfire view [--host 127.0.0.1] [--port 9415] [--allow-remote] [--theme campfire|fx]",
    { ...READ, workspaceScoped: false, outputModes: PROTOCOL, protocol: true, notes: [
      "Read-only team journal. Binds loopback only (127.0.0.1, ::1, localhost).",
      "Non-loopback --host requires --allow-remote. The browser never receives a token.",
      "Operational notices go to stderr; stdout carries no result document.",
    ] },
  ),
  mcp: spec(
    "mcp",
    "admin",
    "Speak MCP JSON-RPC on stdio.",
    "campfire mcp [--actor <id>] [--type human|agent] [--session <id>] [--harness <name>] [--db <path>] [--token <token>]",
    { ...READ, workspaceScoped: false, outputModes: PROTOCOL, protocol: true, notes: [
      "Speaks MCP JSON-RPC on stdio. No result document.",
      "On a loopback CAMPFIRE_URL, starts campfire up when nothing is listening.",
      "Does not open the database, read the operator credential, or register a session.",
    ] },
  ),
  init: spec(
    "init",
    "admin",
    "Create the local database parent directory and print its path.",
    "campfire init",
    { ...WRITE, workspaceScoped: false, outputModes: JSON_ONLY, alwaysJson: true, notes: [
      "Creates the local database parent directory. Prints { databasePath }.",
    ] },
  ),
  bootstrap: spec(
    "bootstrap",
    "admin",
    "Create the fixture organization and team.",
    "campfire bootstrap [--org <orgId>] [--team <teamId>] [--org-name <name>] [--team-name <name>] [--human-name <name>]",
    { ...WRITE, workspaceScoped: false, outputModes: JSON_ONLY, alwaysJson: true },
  ),
  seed: spec(
    "seed",
    "admin",
    "Load the deterministic demo/evaluation fixture.",
    "campfire seed [--reset]",
    { ...WRITE, workspaceScoped: false, outputModes: JSON_ONLY, alwaysJson: true, notes: [
      "Loads the deterministic demo/evaluation fixture. Not a new operator workspace.",
      "SEED NOTE: --reset deletes the database file and its -wal/-shm sidecars before seeding.",
      "Real first run: campfire onboard.",
    ] },
  ),
  // `mutates` is true for the group because `enable` and `disable` write the
  // local preference. The subcommand is a positional, not a flag, so
  // `commandSpecForArgs` cannot select a per-invocation spec the way it does for
  // `--enroll`; the per-subcommand truth is carried by `variants`, where
  // `status` is read-only.
  telemetry: spec(
    "telemetry",
    "admin",
    "Show or change anonymous product telemetry.",
    "campfire telemetry status|enable|disable [--output auto|human|json]",
    { ...WRITE, workspaceScoped: false, variants: [
      { selector: "status", usage: "campfire telemetry status [--output auto|human|json]", mutates: false, outputModes: DUAL },
      { selector: "enable", usage: "campfire telemetry enable [--output auto|human|json]", mutates: true, outputModes: DUAL },
      { selector: "disable", usage: "campfire telemetry disable [--output auto|human|json]", mutates: true, outputModes: DUAL },
    ], notes: [
      "Sends only anonymous counters: Campfire version, OS, architecture, surface, and a random local installation id.",
      "It never sends prompts, messages, code, diffs, file paths, repository, branch, workspace or team names, tokens, email addresses, or hostnames.",
      "status resolves the preference, the installation id, and the endpoint, and never creates an installation id.",
      "The id identifies this installation, not a person, and is a random UUID with no user or machine input.",
      "CAMPFIRE_TELEMETRY=0 (or off|false|no) turns telemetry off for one invocation without changing the stored preference.",
      "CAMPFIRE_TELEMETRY_URL selects the ingestion endpoint; an unusable endpoint disables delivery rather than guessing a host.",
    ] },
  ),
  help: spec(
    "help",
    "discover",
    "Print the grouped help menu or one command's usage.",
    "campfire help [command]",
    { ...READ, workspaceScoped: false, outputModes: PROTOCOL, protocol: true, notes: [
      "With no command, prints the grouped menu. campfire <command> --help is the same as campfire help <command>.",
      "Help stays text: --output does not change it.",
    ] },
  ),
};

export const CLI_COMMANDS = CLI_COMMAND_NAMES;

const COMMAND_SET = new Set<string>(CLI_COMMAND_NAMES);

export function isKnownCommand(name: string): name is CliCommand {
  return COMMAND_SET.has(name);
}

export function commandSpec(command: CliCommand): CliCommandSpec {
  return CLI_CATALOG[command];
}

const GROUP_TITLES: Record<CliGroup, string> = {
  start: "Start and connect",
  workspace: "Understand the workspace",
  recover: "Recover and hand off",
  discover: "Discover the CLI",
  admin: "Administration",
};

const GLOBAL_NOTES = [
  "Global options:",
  "  --db <path>        Override CAMPFIRE_DB for this process.",
  "  --token <token>    Actor token (or CAMPFIRE_TOKEN). Preferred over --actor.",
  "  --actor <id>       Actor identity for local use (default: hum_sergio).",
  "  --type <t>         Actor type, human|agent (default: human).",
  "  --session <id>     Agent session id.",
  "  --harness <name>   Harness name for MCP / session registration.",
  "  --output <mode>    auto|human|json (default auto).",
  "  --json             Compatibility alias for --output json.",
  "",
  "Output contract:",
  "  auto renders text when stdout is a TTY and JSON when it is not. --output",
  "  human restores the text rendering. Explicit JSON prints exactly one compact",
  "  JSON value on stdout: no wordmark, color, spinner, or progress prose. A",
  "  failure prints {\"error\":{\"code\",\"message\"[,\"details\"]}[,\"next\":[]]}",
  "  on stderr and exits 1. CAMPFIRE_OUTPUT sets the default mode.",
  "  These commands always print JSON: whoami, list, init, seed, bootstrap, and",
  "  every create/add/update/accept/issue/revoke/invite/join command.",
  "  help stays text, mcp speaks MCP JSON-RPC on stdio, and serve/view keep their",
  "  operational notices on stderr with no synthetic result document.",
  "",
  "When CAMPFIRE_URL is set, commands POST /v1/call with CAMPFIRE_TOKEN / --token",
  "instead of opening the local SQLite file. serve/init/seed always use the local DB.",
  "",
  "show prints the orientation projection; --since adds the contributions recorded",
  "strictly after that id, states when older rows are omitted, and prints the newest",
  "contribution id as the resume cursor. --full uses the inspector (get_workspace).",
  "",
  "view binds loopback only (127.0.0.1, ::1, localhost); non-loopback --host",
  "requires --allow-remote. The browser never receives a token.",
  "",
  "campfire with no args records the human once, then prints status. It does",
  "not ask for agents, workspaces, or goals. campfire up starts serve and view,",
  "connects each installed Codex or OpenCode as an agent that human owns, and",
  "opens the loopback Viewer. A later loopback session reuses that listener or",
  "starts it when it is down. It does not import past sessions. The agent reads",
  "the workspace before it builds. Session registration stays explicit. onboard",
  "remains the one-shot script path and does not start",
  "the server. seed --reset remains the deterministic demo fixture. setup",
  "prints the agent-readable contract and creates no state.",
  "connect writes only the named harness config and requires a reload or new",
  "process. doctor is read-only. Hosted doctor needs the session id from",
  "register_agent_session via --session or CAMPFIRE_SESSION_ID (--session wins).",
  "It does not look up or register a session. Do not put the session id or",
  "tokens in the handoff. handoff prints a loopback Viewer receipt and never a token.",
  "",
  "add-artifact's --type is the artifact type; acting as an agent there uses",
  "CAMPFIRE_ACTOR_TYPE or --token, not --type.",
  "",
  "telemetry reports anonymous install, activation, and active counters. It",
  "sends Campfire version, OS, architecture, surface, and a random local",
  "installation id; never prompts, messages, code, paths, repository, branch,",
  "workspace or team names, tokens, email addresses, or hostnames.",
  "campfire telemetry status|enable|disable inspects or changes it, and",
  "CAMPFIRE_TELEMETRY=0 turns it off for a single invocation.",
  "",
  "SEED NOTE: --reset deletes the database file and its -wal/-shm sidecars before seeding.",
];

function groupLines(group: CliGroup): string[] {
  const lines: string[] = [`${GROUP_TITLES[group]}:`];
  if (group === "start") {
    lines.push("  campfire                        Record you, then listen. Agents appear when a harness connects");
  }
  for (const name of CLI_COMMAND_NAMES) {
    const entry = CLI_CATALOG[name];
    if (entry.group !== group) continue;
    lines.push(`  ${entry.usage}`);
  }
  return lines;
}

export function formatUsage(): string {
  const sections: string[] = [];
  for (const group of CLI_GROUPS) {
    sections.push(...groupLines(group), "");
  }
  return [
    "Campfire",
    "",
    "Usage:",
    "  campfire [--human-name <name>]  Record you, then listen. Agents appear when a harness connects",
    "  campfire <command> --help       Usage for one command",
    "",
    ...sections,
    ...GLOBAL_NOTES,
  ].join("\n");
}

export function formatCommandUsage(command: CliCommand): string {
  const entry = CLI_CATALOG[command];
  const lines = ["Usage:", `  ${entry.usage}`, ...(entry.variants ?? []).map(variant=>`  ${variant.usage}`)];
  if (entry.notes !== undefined && entry.notes.length > 0) {
    lines.push("", ...entry.notes);
  }
  if (entry.variants?.length) lines.push("", "Variant output and mutability are listed by campfire capabilities --output json.");
  const modes = entry.protocol
    ? "Output: protocol-owned. --output does not change it."
    : entry.alwaysJson
      ? "Output: JSON only (auto|json). --output human is rejected."
      : "Output: auto|human|json. --json is an alias for --output json.";
  lines.push(
    "",
    modes,
    entry.mutates ? "Mutates Campfire state." : "Reads Campfire state.",
    entry.workspaceScoped ? "Workspace-scoped." : "Not workspace-scoped.",
    "",
    "See campfire --help for the full command list and global options.",
  );
  return lines.join("\n");
}

/** Variants preserve the legacy JSON-only join contract. */
export function commandSpecForArgs(name: CliCommand, flags: Record<string, string | boolean>): CliCommandSpec {
  const base = commandSpec(name);
  if (name === "join" && flags["invitation-file"] !== undefined) return { ...base, group: "start", usage: "campfire join --invitation-file <private-file> --human-name <name> --harness codex|opencode [--harness codex|opencode]", description: "Join existing work as a new teammate and connect selected agents.", outputModes: DUAL, alwaysJson: false, credentials: false };
  if (name === "connect" && flags.enroll === true) return { ...base, mutates: true, usage: "campfire connect --harness codex|opencode --enroll", description: "Enroll an additional recipient-owned harness and connect it." };
  return base;
}

CLI_CATALOG.join = { ...CLI_CATALOG.join, variants: [{ selector: "--invitation-file", usage: "campfire join --invitation-file <private-file> --human-name <name> --harness codex|opencode [--harness codex|opencode]", mutates: true, outputModes: DUAL }] };
CLI_CATALOG.connect = { ...CLI_CATALOG.connect, variants: [{ selector: "--enroll", usage: "campfire connect --harness codex|opencode --enroll", mutates: true, outputModes: DUAL }] };
