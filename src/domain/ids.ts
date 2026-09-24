/**
 * Stable, prefixed Campfire identifiers.
 *
 * IDs are generated from an injectable source so fixtures and tests can be
 * deterministic. Runtime generation uses `crypto.randomUUID`.
 */

export const ID_PREFIXES = {
  organization: "org",
  team: "team",
  human: "hum",
  agent: "agt",
  agentSession: "ses",
  workspace: "ws",
  goal: "goal",
  task: "task",
  finding: "find",
  decision: "dec",
  artifact: "art",
  contribution: "con",
  token: "tok",
  invite: "inv",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

export type IdSource = (kind: IdKind) => string;

function randomPart(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

/** Default generator: `<prefix>_<16 hex chars>`. */
export function createId(kind: IdKind, source: IdSource = (k) => `${ID_PREFIXES[k]}_${randomPart()}`): string {
  return source(kind);
}

/** Deterministic counter-based generator, e.g. `ws_000001`. */
export function createCounterIdSource(): IdSource {
  const counters = new Map<IdKind, number>();
  return (kind) => {
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    return `${ID_PREFIXES[kind]}_${String(next).padStart(6, "0")}`;
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}
