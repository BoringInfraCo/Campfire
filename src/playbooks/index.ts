/**
 * Playbook registry (WOW-001).
 *
 * Playbooks are static, harness-independent guidance: they add no domain
 * object, no lifecycle, and no write path, and they contain no workspace data
 * and require no model. During the v1.13 pilot the guidance is opt-in. This
 * module is the single gate shared by the CLI and the MCP surface so the two
 * cannot drift apart.
 */
import { ValidationError } from "../domain/errors.js";
import { INCIDENT_INVESTIGATION_PLAYBOOK, type PlaybookDefinition } from "./incident-investigation.js";

export type { PlaybookDefinition, PlaybookStage } from "./incident-investigation.js";

export const PLAYBOOK_ENV_VAR = "CAMPFIRE_PLAYBOOK";
export const PLAYBOOK_MCP_FLAG = "--with-playbook";

export const PLAYBOOKS: readonly PlaybookDefinition[] = [INCIDENT_INVESTIGATION_PLAYBOOK];

export function listPlaybooks(): readonly PlaybookDefinition[] {
  return PLAYBOOKS;
}

/** The one place an unknown playbook becomes a typed, actionable failure. */
export function getPlaybook(name: string): PlaybookDefinition {
  const playbook = PLAYBOOKS.find((entry) => entry.name === name);
  if (playbook === undefined) {
    throw new ValidationError(`Unknown playbook: ${name}`, {
      field: "name",
      value: name,
      available: PLAYBOOKS.map((p) => p.name),
    });
  }
  return playbook;
}

/**
 * The shared opt-in gate. The CLI calls it with env only; MCP calls it with
 * env and argv. Exactly "1": ambient truthy values must never silently enable
 * the pilot guidance.
 */
export function playbookEnabled(env: NodeJS.ProcessEnv = process.env, argv: readonly string[] = []): boolean {
  return (env[PLAYBOOK_ENV_VAR] ?? "").trim() === "1" || argv.includes(PLAYBOOK_MCP_FLAG);
}
