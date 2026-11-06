/**
 * SES-001 command text.
 *
 * These commands are intentionally not added to `CLI_COMMAND_NAMES`. Existing
 * tests pin that list at 65 names (NAV-002, WCO-001, ACT-001). Dispatch lives
 * in `runCli` before the unknown-command check. Wiring is the call to
 * `runSessionHostFromParsed` in `src/cli/index.ts`.
 */
export const SESSION_HOST_USAGE = [
  "campfire session prepare --workspace <id> --task <id> --agent <id> --harness codex --repository <absolute-path> [--worktree <absolute-path>] --launch external|embedded|copy-launch-command --output json",
  "campfire session run <launch-id>",
  "campfire session stop <launch-id> --output json",
  "campfire session reconcile --output json",
  "campfire sessions <workspace> --output human|json",
] as const;

export function formatSessionHostHelp(): string {
  return [
    "Team agent sessions (CAMPFIRE_SESSION_HOST=1)",
    "",
    "Usage:",
    ...SESSION_HOST_USAGE.map((line) => `  ${line}`),
    "",
    "This slice launches Codex in Terminal.app, prepares an independently gated embedded launch, or prints a copy-launch command.",
    "Embedded launch requires CAMPFIRE_EMBEDDED_TERMINAL=1. Claude Code and OpenCode are not available.",
    "A --worktree path must already exist inside the repository. Campfire does not create or delete worktrees.",
    "The prepare receipt never includes a repository path, credential, environment, or provider config.",
  ].join("\n");
}
