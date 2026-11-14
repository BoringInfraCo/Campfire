/** Read-only presentation of recorded contributions. Never infer an action or actor. */
type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}
function safe(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim() : "";
}
function words(value: unknown): string { return safe(value).replace(/[_.-]+/g, " "); }

/** Resolve a name only from a supplied roster; otherwise retain the recorded id. */
function actorLabel(value: unknown, participants: readonly unknown[]): string {
  const actor = object(value), id = safe(actor.actorId), type = safe(actor.actorType);
  const participant = participants.map(object).find((entry) => {
    const candidate = object(entry.actor);
    return id && safe(candidate.actorId) === id && safe(candidate.actorType) === type;
  });
  return safe(participant?.name) || id || (type ? `${type} (id unavailable)` : "Actor unavailable");
}

function verb(action: string): string {
  const verbs: Record<string, string> = { create: "created", update: "updated", join: "joined", register_session: "registered", read: "read" };
  return verbs[action] || (action ? `recorded ${words(action)}` : "recorded an event for");
}

/** Short action-first timeline label; no full IDs unless a name is unavailable. */
export function activitySummary(value: unknown, participants: readonly unknown[] = []): string {
  const v = object(value), action = safe(v.action), type = words(v.objectType);
  const target = type ? ` ${type}` : "";
  const title = safe(object(v.payload).title) || safe(object(v.payload).summary);
  const subject = title ? `: ${title}` : "";
  const time = safe(v.createdAt);
  const actor = actorLabel(v.actor, participants);
  const description = `${verb(action)}${target}${subject}`;
  // An unresolved opaque actor ID should not hide the action on narrow screens.
  const leading = actor === safe(object(v.actor).actorId) && actor ? `${description} · ${actor}` : `${actor} ${description}`;
  return `${leading}${time ? ` · ${time}` : ""}`;
}

/** Full recorded provenance and explicitly allowed payload fields, never arbitrary payload. */
export function activityDetails(value: unknown, participants: readonly unknown[] = []): string[] {
  const v = object(value), actor = object(v.actor), payload = object(v.payload);
  const lines = [activitySummary(value, participants)];
  for (const [label, field] of [["Event ID", v.id], ["Time", v.createdAt], ["Actor ID", actor.actorId], ["Actor type", actor.actorType], ["Action", v.action], ["Record type", v.objectType], ["Record ID", v.objectId], ["Agent session", v.agentSessionId]] as const) {
    const text = safe(field); if (text) lines.push(`${label}: ${text}`);
  }
  for (const [label, field] of [["Title", payload.title], ["Summary", payload.summary], ["Status", payload.status]] as const) {
    const text = safe(field); if (text) lines.push(`${label}: ${text}`);
  }
  if (payload.assignee === null) lines.push("Assignee: none recorded");
  else {
    const assignee = object(payload.assignee), id = safe(assignee.actorId), type = safe(assignee.actorType);
    if (id) lines.push(`Assignee: ${id}${type ? ` (${type})` : ""}`);
  }
  return lines;
}
