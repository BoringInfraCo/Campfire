/**
 * ONB-001 human receipt vocabulary.
 *
 * One pure module for the sentences shared by the local/remote `up` receipt,
 * the returning local status, the awaiting-workspace projection, and a
 * successful invitation join. It holds strings and small builders only: no
 * domain objects, no I/O, and no reads of its own. Every claim is derived from
 * a detection or preparation result the caller already computed.
 *
 * "Config prepared" means an MCP block was written. It never claims that a
 * harness loaded the tools, approved them, registered a session, or read a
 * workspace, so do not add `connected`, `online`, or `ready to work` language
 * here. A written MCP block is not a live session.
 */

export type ReceiptHarness = "codex" | "opencode";

const HARNESS_LABELS: Record<ReceiptHarness, string> = {
  codex: "Codex",
  opencode: "OpenCode",
};

/** Human label for a supported harness. Unknown ids stay verbatim. */
export function harnessLabel(harness: string): string {
  return harness === "codex" || harness === "opencode" ? HARNESS_LABELS[harness] : harness;
}

/** Existing receipt column: two spaces, a 9-wide label, two spaces, the value. */
const LABEL_WIDTH = 9;

export function receiptRow(label: string, value: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)}  ${value}`;
}

/** Continuation lines align under the first word after `Next: `. */
const NEXT_INDENT = "        ";

/** Command column of the status next block, padded past the longest command. */
const NEXT_COMMAND_WIDTH = "campfire status".length;

function nextCommand(prefix: string, command: string, when: string): string {
  return `${prefix}${command.padEnd(NEXT_COMMAND_WIDTH)}    ${when}`;
}

export const PAST_SESSIONS_SENTENCE = "Past sessions are not imported.";
export const PAST_SESSIONS_LINE = `  ${PAST_SESSIONS_SENTENCE}`;
export const NO_WORKSPACE_YET = "No workspace yet.";
export const NO_WORKSPACE_ROW = receiptRow("Workspace", "None yet");
export const NO_HARNESS_DETECTED_ROW = receiptRow("Harness", "No supported harness detected");
export const CONNECTION_SKIPPED_ROW = receiptRow("Harness", "Connection setup skipped (--no-connect)");
export const NO_ENROLLED_CONFIG_ROW = receiptRow("Harness", "No enrolled harness config prepared");
export const VIEWER_READ_ONLY_SENTENCE =
  "The Viewer is read-only; an agent registers its own session before contributing.";

/** A detected harness whose MCP configuration this run actually wrote. */
export function harnessConfigPreparedRow(harness: ReceiptHarness): string {
  const label = harnessLabel(harness);
  return receiptRow(label, `Config prepared — restart ${label} to load Campfire tools`);
}

/** A detected harness with no stored credential: nothing was written. */
export function harnessDetectedNotPreparedRow(harness: ReceiptHarness): string {
  return receiptRow(harnessLabel(harness), "Detected — Campfire tools were not prepared");
}

export function workspaceRow(name: string, goalTitle?: string): string {
  return receiptRow("Workspace", goalTitle === undefined ? name : `${name}  ${goalTitle}`);
}

export function restartClause(harnesses: readonly ReceiptHarness[]): string {
  return `Restart ${harnesses.map((harness) => harnessLabel(harness)).join(" or ")}.`;
}

/** The only recovery after the block itself was missing: an explicit connect. */
export function connectRecovery(harness: ReceiptHarness): string {
  return `run campfire connect --harness ${harness} --token <agent-token>.`;
}

export function connectWriteConfig(harness: ReceiptHarness): string {
  return `Run campfire connect --harness ${harness} --token <agent-token> to write its Campfire config.`;
}

// ---------------------------------------------------------------------------
// Local `up` (fresh interactive `campfire` and manual `campfire up`)
// ---------------------------------------------------------------------------

export interface LocalUpReceiptInput {
  /** Rendered wordmark; the caller owns color encoding. */
  wordmark: string;
  humanName: string;
  /** Workspaces visible to this human in the live local read. */
  workspaces: Array<{ name: string; goalTitle?: string }>;
  viewerUrl: string;
  /** False when --no-connect skipped connection setup entirely. */
  connect: boolean;
  /** Detected harnesses, in detection order. */
  detected: readonly ReceiptHarness[];
  /** Detected harnesses whose MCP configuration this run wrote. */
  prepared: readonly ReceiptHarness[];
}

export function formatLocalUpReceipt(input: LocalUpReceiptInput): string {
  return [
    input.wordmark,
    `  Campfire is running for ${input.humanName}.`,
    ...(input.workspaces.length === 0
      ? [NO_WORKSPACE_ROW]
      : input.workspaces.map((workspace) => workspaceRow(workspace.name, workspace.goalTitle))),
    ...localUpHarnessRows(input),
    receiptRow("Viewer", input.viewerUrl),
    "",
    ...localUpNextLines(input),
    "",
    PAST_SESSIONS_LINE,
  ].join("\n");
}

function localUpHarnessRows(input: LocalUpReceiptInput): string[] {
  if (!input.connect) return [CONNECTION_SKIPPED_ROW];
  if (input.detected.length === 0) return [NO_HARNESS_DETECTED_ROW];
  return input.detected.map((harness) =>
    input.prepared.includes(harness)
      ? harnessConfigPreparedRow(harness)
      : harnessDetectedNotPreparedRow(harness),
  );
}

function localUpNextLines(input: LocalUpReceiptInput): string[] {
  if (!input.connect) {
    return ["  Next: Run campfire up without --no-connect to prepare your harness's Campfire tools."];
  }
  if (input.prepared.length > 0) {
    const hasWorkspace = input.workspaces.length > 0;
    const lines = [
      `  Next: ${restartClause(input.prepared)} In that session, ${
        hasWorkspace ? "continue the work you want to do;" : "describe the work you want to do;"
      }`,
      `${NEXT_INDENT}${
        hasWorkspace
          ? "your agent reads the current authorized work before contributing."
          : "your agent can create a Campfire workspace and goal with you."
      }`,
    ];
    // A reload cannot fix an unwritten block, so each detected harness whose
    // configuration was not prepared gets its explicit recovery instead.
    for (const harness of input.detected) {
      if (!input.prepared.includes(harness)) {
        lines.push(`${NEXT_INDENT}${harnessLabel(harness)}: ${connectRecovery(harness)}`);
      }
    }
    return lines;
  }
  if (input.detected.length === 0) {
    return ["  Next: Install Codex or OpenCode, then run campfire up to prepare its Campfire tools."];
  }
  return input.detected.map((harness, index) =>
    index === 0 ? `  Next: ${connectWriteConfig(harness)}` : `${NEXT_INDENT}${connectWriteConfig(harness)}`,
  );
}

// ---------------------------------------------------------------------------
// Returning local status (plain `campfire` and non-interactive creation)
// ---------------------------------------------------------------------------

export interface LocalStatusReceiptInput {
  humanName: string;
  /** Joined recorded agents, e.g. `Codex (codex)`. Absent when none are named. */
  agents?: string;
  /** Stored workspace selection. Absent means this profile has no workspace. */
  workspaceName?: string;
  goalTitle?: string;
}

export function formatLocalStatusReceipt(input: LocalStatusReceiptInput): string {
  const lines = [receiptRow("You", input.humanName)];
  if (input.workspaceName === undefined) {
    lines.push(`  ${NO_WORKSPACE_YET}`);
    if (input.agents !== undefined) {
      // The profile names owned agents; that is a record, not live presence.
      lines.push(receiptRow("Agents", `${input.agents}  (recorded, not live)`));
    }
    lines.push(
      "  Next: Run campfire up to reopen Campfire and prepare your harness's tools.",
      `${NEXT_INDENT}Then, in that session, describe the work you want to do;`,
      `${NEXT_INDENT}your agent can create a Campfire workspace and goal with you.`,
      PAST_SESSIONS_LINE,
    );
    return lines.join("\n");
  }
  lines.push(receiptRow("Workspace", input.workspaceName));
  if (input.goalTitle !== undefined) lines.push(receiptRow("Goal", input.goalTitle));
  if (input.agents !== undefined) lines.push(receiptRow("Agents", input.agents));
  lines.push(
    nextCommand("  Next: ", "campfire status", "read your current authorized work"),
    nextCommand(NEXT_INDENT, "campfire up", "open the Viewer and prepare your harness's tools"),
    "  Saved local profile — not live service or agent status.",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Awaiting-workspace projection (`campfire status`, no workspace)
// ---------------------------------------------------------------------------

/** Next block appended to the awaiting-workspace projection. */
export function awaitingWorkspaceNextLines(): string[] {
  return [
    "  Next: After your agent has the Campfire tools loaded, describe the work",
    `${NEXT_INDENT}you want to do; your agent can create a Campfire workspace and goal with you.`,
  ];
}

/** Dashboard awaiting state: the same truth, one line, no presence claim. */
export const DASHBOARD_AWAITING_WORKSPACE =
  "No workspace yet. Run campfire up, then describe the work to your agent; it can create the workspace and goal.";

// ---------------------------------------------------------------------------
// Join receipt (invitation-file success)
// ---------------------------------------------------------------------------

export interface JoinReceiptInput {
  workspaceName: string;
  humanName: string;
  /** Enrolled agents named by the enrollment receipt. */
  agents: readonly ReceiptHarness[];
  /** Agents whose connection_prepared stage was actually reached. */
  prepared: readonly ReceiptHarness[];
}

export function formatJoinReceipt(input: JoinReceiptInput): string {
  const lines = [`  Joined ${input.workspaceName} as ${input.humanName}.`];
  for (const harness of input.prepared) lines.push(harnessConfigPreparedRow(harness));
  lines.push("");
  if (input.prepared.length > 0) {
    lines.push(
      `  Next: Run campfire up, then restart ${input.prepared
        .map((harness) => harnessLabel(harness))
        .join(" or ")}. Approve Campfire tools if asked,`,
      `${NEXT_INDENT}then begin from ${input.workspaceName}.`,
    );
  } else {
    // Membership without a prepared block: the recovery is an explicit
    // connect, never a reload of configuration that does not exist.
    lines.push("  Next: Run campfire up.");
    for (const harness of input.agents) lines.push(`${NEXT_INDENT}${connectWriteConfig(harness)}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Remote `up` (enrolled recipient profile)
// ---------------------------------------------------------------------------

export interface RemoteUpReceiptInput {
  wordmark: string;
  humanName: string;
  /** Workspaces visible in the live read. */
  workspaces: Array<{ id: string; name: string }>;
  /** The profile's stored joined workspace id, matched against the live list. */
  joinedWorkspaceId: string;
  /** Stored joined workspace name, used when the live list cannot be matched. */
  joinedWorkspaceName?: string;
  viewerUrl: string;
  /** False when --no-connect skipped connection setup entirely. */
  connect: boolean;
  /** Enrolled harness connections whose MCP configuration this run wrote. */
  prepared: readonly ReceiptHarness[];
}

export function formatRemoteUpReceipt(input: RemoteUpReceiptInput): string {
  const lines = [
    input.wordmark,
    `  Campfire is running for ${input.humanName}.`,
    ...input.workspaces.map((workspace) => workspaceRow(workspace.name)),
  ];
  if (input.prepared.length === 0) {
    lines.push(input.connect ? NO_ENROLLED_CONFIG_ROW : CONNECTION_SKIPPED_ROW);
  } else {
    for (const harness of input.prepared) lines.push(harnessConfigPreparedRow(harness));
  }
  lines.push(receiptRow("Viewer", input.viewerUrl), "");
  if (input.prepared.length > 0) {
    const target =
      input.workspaces.find((workspace) => workspace.id === input.joinedWorkspaceId)?.name ??
      input.workspaces[0]?.name ??
      input.joinedWorkspaceName ??
      input.joinedWorkspaceId;
    lines.push(
      `  Next: ${restartClause(input.prepared)} In that session, approve Campfire tools if asked, then`,
      `${NEXT_INDENT}begin from ${target}.`,
    );
  } else if (!input.connect) {
    lines.push("  Next: Run campfire up without --no-connect to prepare your enrolled harness's Campfire tools.");
  } else {
    lines.push("  Next: Install Codex or OpenCode, then run campfire up to prepare its Campfire tools.");
  }
  lines.push("", `  ${VIEWER_READ_ONLY_SENTENCE}`);
  return lines.join("\n");
}
