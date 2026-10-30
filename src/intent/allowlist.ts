/**
 * Phase C bounded intent allowlist for the desktop command channel.
 *
 * The desktop application holds no Campfire credential of its own: it sends
 * typed intents to this loopback bridge, and the bridge forwards only the
 * methods listed here. Every name is verbatim from `CAMPFIRE_HTTP_METHODS`
 * (src/http/dispatch.ts) so the forwarded params validate with the exact
 * schema the operator's own CLI uses — there is no second vocabulary.
 *
 * The first slice covers task status changes end to end, plus the adjacent
 * journal writes a desktop session demonstrably needs:
 *
 * - task status update AND task create (`update_task`, `create_task` — two
 *   genuinely distinct dispatch methods; the desktop needs both).
 * - decision propose (`add_decision`), decision accept (`accept_decision`),
 *   and decision deny (`retire_decision`). Decision safety (COR-001): a
 *   decision changes only through explicit accept, replace, or retire, so the
 *   bridge exposes accept and retire, not a generic "reject".
 * - finding record (`add_finding`).
 * - invitation create (`issue_enrollment_invitation`). There is NO read
 *   method that returns the join link: the desktop composes the link itself
 *   from this method's result plus the endpoint via `formatInvitationLink`
 *   (src/bootstrap/invitation-link.js), exactly like `campfire
 *   invite-teammate` does. `invite_workspace` (changing an existing actor's
 *   participant role) and `revoke_enrollment_invitation` stay outside the
 *   first slice.
 *
 * Deliberately NOT here: every other read (the desktop's read channel is the
 * Viewer proxy on 127.0.0.1:9415), workspace/team identity mutation, token
 * lifecycle, and the ACT-001 action-proposal flow. Action proposals are
 * scoped by their own schema to `kind = 'ci.retry_verification'` with GitHub
 * provider targets (src/store/action-proposal-schema.ts, migration 0009), so
 * they cannot carry desktop task-status intents; if Phase C later wants
 * human receipts for desktop writes, that requires a new proposal kind, not
 * this allowlist.
 */
import { isCampfireHttpMethod } from "../http/dispatch.js";

export const INTENT_METHODS = [
  "update_task",
  "create_task",
  "add_decision",
  "accept_decision",
  "retire_decision",
  "add_finding",
  "issue_enrollment_invitation",
] as const;

export type IntentMethod = (typeof INTENT_METHODS)[number];

/**
 * Typed schematic of the params each allowlisted method validates (verbatim
 * from dispatch.ts), so the desktop client can be built against the same
 * contract the service enforces. `required: false` means dispatch tolerates
 * absence; value semantics (enums, nullable assignee) are upstream.
 */
export interface IntentParamSpec {
  readonly name: string;
  readonly required: boolean;
}

export const INTENT_METHOD_PARAMS: Record<IntentMethod, readonly IntentParamSpec[]> = {
  create_task: [
    { name: "workspaceId", required: true },
    { name: "title", required: true },
    { name: "description", required: false },
    { name: "assignee", required: false },
  ],
  update_task: [
    { name: "taskId", required: true },
    { name: "status", required: false },
    { name: "title", required: false },
    { name: "description", required: false },
    { name: "assignee", required: false },
  ],
  add_decision: [
    { name: "workspaceId", required: true },
    { name: "summary", required: true },
    { name: "rationale", required: false },
    { name: "status", required: false },
    { name: "replacesDecisionId", required: false },
  ],
  accept_decision: [
    { name: "decisionId", required: true },
    { name: "reason", required: false },
  ],
  retire_decision: [
    { name: "decisionId", required: true },
    { name: "reason", required: true },
  ],
  add_finding: [
    { name: "workspaceId", required: true },
    { name: "summary", required: true },
    { name: "detail", required: false },
    { name: "confidence", required: false },
    { name: "sourceArtifactId", required: false },
  ],
  issue_enrollment_invitation: [
    { name: "workspaceId", required: true },
    { name: "expiresInHours", required: false },
  ],
};

const INTENT_METHOD_SET: ReadonlySet<string> = new Set(INTENT_METHODS);

export function isIntentMethod(value: string): value is IntentMethod {
  return INTENT_METHOD_SET.has(value);
}

// The allowlist can only name real Campfire dispatch methods. A compile-time
// relationship plus this load-time guard keeps drift between dispatch.ts and
// this file visible on first import, not on first desktop intent.
for (const method of INTENT_METHODS) {
  if (!isCampfireHttpMethod(method)) {
    throw new Error(`Intent allowlist names unknown Campfire method: ${method}`);
  }
}

/** The one rejection message, in the Viewer's "Viewer is read-only" line style. */
export function intentAllowlistMessage(): string {
  return `Intent bridge accepts only ${INTENT_METHODS.join(", ")}`;
}
