/**
 * Copy-pasteable next commands for CLI failures.
 *
 * Human stderr keeps `[Code] message` as the first line. `--json` keeps
 * `error.code` / `error.message` / `error.details` and adds a sibling `next`
 * array when a recovery command exists. Never interpolates a bearer token.
 */
import { CampfireError } from "../domain/errors.js";
import { CLI_COMMANDS, isKnownCommand } from "./help.js";

export interface CliNextStep {
  command: string;
  when: string;
}

export function suggestCommands(unknown: string, limit = 3): string[] {
  const needle = unknown.trim().toLowerCase();
  if (needle.length === 0) return [];
  const ranked = CLI_COMMANDS.filter((name) => name !== "help")
    .map((name) => ({ name, score: commandScore(needle, name) }))
    .filter((row) => row.score < 4)
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  const unique: string[] = [];
  for (const row of ranked) {
    if (!unique.includes(row.name)) unique.push(row.name);
    if (unique.length >= limit) break;
  }
  return unique;
}

function commandScore(unknown: string, name: string): number {
  if (unknown === name) return 0;
  if (name.startsWith(unknown) || unknown.startsWith(name)) return 0.5;
  if (name.includes(unknown) || unknown.includes(name)) return 1;
  return levenshtein(unknown, name);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const next = new Array<number>(b.length + 1);
  for (let i = 0; i < a.length; i += 1) {
    next[0] = i + 1;
    for (let j = 0; j < b.length; j += 1) {
      const cost = a[i] === b[j] ? 0 : 1;
      next[j + 1] = Math.min((next[j] ?? 0) + 1, (prev[j + 1] ?? 0) + 1, (prev[j] ?? 0) + cost);
    }
    for (let j = 0; j <= b.length; j += 1) {
      prev[j] = next[j] ?? 0;
    }
  }
  return prev[b.length] ?? Math.max(a.length, b.length);
}

export function commandForNextAction(
  nextAction: string,
  hint?: { workspaceId?: string; harness?: string },
): string | undefined {
  const workspace = hint?.workspaceId !== undefined && hint.workspaceId.length > 0 ? hint.workspaceId : "<workspaceId>";
  const harness = hint?.harness !== undefined && hint.harness.length > 0 ? hint.harness : "<name>";
  switch (nextAction) {
    case "set_agent_token":
      return `campfire doctor ${workspace} --harness ${harness} --token <agent-token>`;
    case "use_agent_token":
      return `campfire doctor ${workspace} --harness ${harness} --token <agent-token>`;
    case "start_campfire_serve":
    case "start campfire serve":
      return "campfire serve";
    case "start_campfire_view":
      return "campfire up";
    case "register_agent_session":
    case "register_agent_session_then_pass_session":
    case "unknown_session":
    case "session_wrong_actor":
    case "session_wrong_workspace":
    case "session_ended":
      return `campfire doctor ${workspace} --harness ${harness} --session <id>`;
    case "workspace_not_found":
      return "campfire list";
    case "not_a_participant":
      return "campfire invite <workspaceId> --actor <id> --type human|agent --role member";
    case "harness_mismatch":
      return `campfire doctor ${workspace} --harness ${harness}`;
    case "get_workspace_context":
      return `campfire show ${workspace}`;
    default:
      return undefined;
  }
}

export function nextStepsForError(error: unknown, command?: string): CliNextStep[] {
  if (!(error instanceof CampfireError)) return [];
  const details = error.details ?? {};
  const field = typeof details.field === "string" ? details.field : undefined;
  const nextAction = typeof details.nextAction === "string" ? details.nextAction : undefined;
  const unknown =
    typeof details.command === "string"
      ? details.command
      : error.message.startsWith("Unknown command: ")
        ? error.message.slice("Unknown command: ".length)
        : undefined;

  if (unknown !== undefined) {
    const steps: CliNextStep[] = suggestCommands(unknown).map((name) => ({
      command: `campfire ${name}`,
      when: "Did you mean this command?",
    }));
    steps.push({ command: "campfire --help", when: "List commands" });
    return steps;
  }

  if (error.code === "WorkspaceNotFound") {
    return [{ command: "campfire list", when: "List workspaces this actor can see" }];
  }

  if (field === "onboard" || error.message.includes("already has a human or a workspace")) {
    return [
      { command: "campfire create-human --name <display> --team <teamId>", when: "Add another human" },
      { command: "campfire create-agent --name <name> --human <humanId> --harness <name>", when: "Add another agent" },
      { command: "campfire create-workspace --team <teamId> --name <name>", when: "Add another workspace" },
      { command: "campfire invite <workspaceId> --actor <id> --type human|agent --role member", when: "Grant membership" },
      { command: "campfire join <workspaceId>", when: "Accept an invite" },
    ];
  }

  if (field === "CAMPFIRE_URL" || error.message.includes("CAMPFIRE_URL")) {
    return [
      { command: "campfire serve", when: "Start the local API" },
      {
        command: "export CAMPFIRE_URL=http://127.0.0.1:9414",
        when: "Point hosted commands at that endpoint",
      },
    ];
  }

  if (field === "credentials") {
    return [{ command: "campfire onboard --help", when: "Create the local operator profile" }];
  }

  if (field === "token" || field === "CAMPFIRE_TOKEN") {
    return [
      {
        command: "campfire issue-token --actor <id> --type human|agent",
        when: "Mint a token; never paste it into a handoff",
      },
    ];
  }

  if (field === "human-name" && (command === undefined || command === "up")) {
    return [
      { command: "campfire --human-name <name>", when: "Record the operator in a terminal" },
      { command: "campfire onboard --help", when: "Non-interactive first-run path" },
    ];
  }

  if (nextAction !== undefined) {
    const mapped = commandForNextAction(nextAction);
    if (mapped !== undefined) {
      return [{ command: mapped, when: nextAction }];
    }
  }

  if (error.code === "ParticipantRequired") {
    return [
      {
        command: "campfire invite <workspaceId> --actor <id> --type human|agent --role member",
        when: "Grant membership, then join",
      },
    ];
  }

  if (
    command !== undefined &&
    isKnownCommand(command) &&
    (error.message.startsWith("Missing required") || field !== undefined)
  ) {
    return [{ command: `campfire ${command} --help`, when: "See required arguments for this command" }];
  }

  return [];
}

/**
 * Render a CLI failure for the process boundary.
 *
 * Human mode keeps the stable `[Code] message` first line. Under `--json`
 * failures are machine-readable too: a structured error object on stderr
 * (stdout stays reserved for the success payload) with exit code 1 upstream.
 */
export function formatCliFailure(
  error: unknown,
  options?: { json?: boolean; command?: string },
): string {
  const next = nextStepsForError(error, options?.command);
  if (options?.json === true) {
    if (error instanceof CampfireError) {
      const details = error.details;
      const payload: {
        error: { code: string; message: string; details?: Record<string, unknown> };
        next?: CliNextStep[];
      } = {
        error:
          details === undefined
            ? { code: error.code, message: error.message }
            : { code: error.code, message: error.message, details },
      };
      if (next.length > 0) payload.next = next;
      return JSON.stringify(payload, null, 2);
    }
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: { code: "InternalError", message } }, null, 2);
  }
  const head =
    error instanceof CampfireError
      ? `[${error.code}] ${error.message}`
      : error instanceof Error
        ? error.message
        : String(error);
  if (next.length === 0) return head;
  return [head, "Next:", ...next.map((step) => `  ${step.command}`)].join("\n");
}

export const SEED_RESET_WARNING =
  "SEED NOTE: --reset deleted the database file and its -wal/-shm sidecars. This is the demo fixture, not a new operator workspace. Real first run: campfire onboard";
