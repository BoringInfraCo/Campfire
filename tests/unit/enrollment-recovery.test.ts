import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { commandForNextAction, nextStepsForError } from "../../src/cli/recovery.js";
import { ValidationError } from "../../src/domain/errors.js";
import { ENROLLMENT_STAGES } from "../../src/bootstrap/enrollment-client.js";

/**
 * Sprint 020 recovery codes must resolve to a copy-pasteable command. A stable
 * code that resolves to nothing is not actionable failure output.
 */
const SPRINT_020_ACTIONS = [
  "join_with_invitation_file",
  "retry_saved_enrollment",
  "recover_pending_enrollment",
  "recover_original_enrollment",
  "recover_enrollment_credentials",
  "check_invitation_file",
  "check_invitation_scope",
  "check_enrollment_receipt",
  "choose_invitation_output",
  "request_new_invitation",
  "select_harness_config",
  "select_supported_harness",
  "use_isolated_profile",
  "use_isolated_harness_config",
  "use_enrolled_endpoint",
  "use_recipient_human_credential",
  "use_recipient_agent_credential",
  "use_remote_profile_backend",
  "use_no_connect_for_override",
  "verify_campfire_token",
  "reload_or_new_process",
  "open_viewer_url",
  "enroll_selected_harness",
  "reconnect_selected_harness",
  "supply_override_credential",
];

it("resolves every Sprint 020 recovery code to a concrete next command", () => {
  for (const action of SPRINT_020_ACTIONS) {
    const command = commandForNextAction(action, { workspaceId: "ws_1", harness: "codex" });
    expect(command, `no command for ${action}`).toBeDefined();
    expect(command, `no command for ${action}`).toMatch(/^campfire |^CAMPFIRE_CONFIG_DIR=/);
    expect(command).not.toContain("undefined");
  }
});

it("surfaces the enrollment action in both human and JSON failures", () => {
  const steps = nextStepsForError(new ValidationError("nope", { nextAction: "recover_enrollment_credentials" }));
  expect(steps).toHaveLength(1);
  expect(steps[0]!.command).toContain("campfire join --invitation-file");
});

it("keeps enrollment secret-bearing files out of version control", () => {
  const gitignore = readFileSync(new URL("../../.gitignore", import.meta.url), "utf8");
  const patterns = gitignore.split("\n").map((line) => line.trim());
  for (const required of ["*.invitation.json", "pending-enrollment.json", "pending-agent-*.json", "enrollment-receipt.json", "credentials.json"]) {
    expect(patterns, `missing ${required}`).toContain(required);
  }
});

it("publishes a truthful local completion stage vocabulary", () => {
  expect(ENROLLMENT_STAGES).toEqual(["enrolled", "credentials_saved", "connection_prepared", "reload_required"]);
});