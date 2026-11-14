/** Read-only participant presentation and bounded owner-filtered roster requests. */
import { array, object, safe } from "./sections.js";

const LIMIT = 50;
const CONTROL = /[\x00-\x1f\x7f-\x9f]/;

function validId(id: string): boolean {
  return id.length > 0 && id.trim() === id && !CONTROL.test(id);
}

/** Build a fresh request; cursors are scoped by the service to workspace and owner. */
export function ownedAgentsParams(workspaceId: string, humanOwnerId: string, cursor?: string): Record<string, unknown> {
  if (!validId(workspaceId) || !validId(humanOwnerId)) throw new Error("Workspace and human owner are required.");
  if (cursor !== undefined && (!cursor || CONTROL.test(cursor))) throw new Error("Invalid participant cursor.");
  return { workspaceId, humanOwnerId, limit: LIMIT, ...(cursor === undefined ? {} : { cursor }) };
}

/** Refuse a result from another workspace, owner, or with unscoped rows. */
export function validateOwnedAgentsPage(value: unknown, workspaceId: string, humanOwnerId: string): boolean {
  const page = object(value);
  const filter = object(page.filter);
  if (page.workspaceId !== workspaceId || filter.humanOwnerId !== humanOwnerId || !Array.isArray(page.items)) return false;
  if (!Number.isSafeInteger(page.total) || (page.total as number) < page.items.length || !Number.isSafeInteger(page.returned) || page.returned !== page.items.length) return false;
  if (typeof page.truncated !== "boolean" || (page.nextCursor !== undefined && (typeof page.nextCursor !== "string" || !page.nextCursor || CONTROL.test(page.nextCursor)))) return false;
  if (page.truncated !== (typeof page.nextCursor === "string")) return false;
  return array(page.items).every((entry) => {
    const item = object(entry), actor = object(item.actor);
    return actor.actorType === "agent" && typeof actor.actorId === "string" && validId(actor.actorId) && item.humanOwnerId === humanOwnerId;
  });
}

/** Only known roster fields are displayed; registration never implies presence. */
export function participantFacts(value: unknown): string[] {
  const item = object(value), actor = object(item.actor);
  const actorId = safe(actor.actorId), actorType = safe(actor.actorType);
  if (!actorId || (actorType !== "human" && actorType !== "agent")) return ["Participant details are unavailable."];
  const lines = [`${actorType}: ${actorId}`];
  for (const [label, field] of [["name", item.name], ["role", item.role], ["joinedAt", item.joinedAt]] as const) {
    const text = safe(field); if (text) lines.push(`${label}: ${text}`);
  }
  if (actorType === "human") {
    lines.push("Enter lists this human's workspace-participating agents.");
  } else {
    lines.push(`humanOwnerId: ${safe(item.humanOwnerId) || "no recorded owner"}`);
    if (item.humanOwnerIsParticipant === true) lines.push("Owner is a workspace participant.");
    else if (item.humanOwnerIsParticipant === false) lines.push("Owner is outside the roster.");
    const harness = safe(item.harness); if (harness) lines.push(`harness: ${harness}`);
  }
  lines.push("Membership and registration are not presence or permission to act.");
  return lines;
}
