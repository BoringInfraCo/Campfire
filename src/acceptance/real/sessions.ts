/**
 * Deterministic pre-bound harness sessions for the Sprint 002 acceptance run.
 *
 * These sessions model the trusted identity boundary from docs/SPRINT_002.md
 * section 16: each real harness runs as a known agent, on behalf of a known
 * human, inside a known workspace. They are created directly on the store so the
 * acceptance harness controls session ids and ordering rather than the model.
 */
import { FIXTURE } from "../../bootstrap/seed.js";
import type { CampfireStore } from "../../store/store.js";

export const SESSION_A_ID = "ses_harness_a_codex";
export const SESSION_B_ID = "ses_harness_b_opencode";

export interface HarnessSessionFixture {
  id: string;
  agentId: string;
  humanId: string;
  workspaceId: string;
  harness: string;
}

export function createHarnessSessions(
  store: CampfireStore,
  clock?: () => string,
): { a: HarnessSessionFixture; b: HarnessSessionFixture } {
  const baseClock = clock ?? (() => new Date().toISOString());

  const a: HarnessSessionFixture = {
    id: SESSION_A_ID,
    agentId: FIXTURE.agents.codexSergio,
    humanId: FIXTURE.humans.sergio,
    workspaceId: FIXTURE.workspaces.billing,
    harness: "codex",
  };
  const b: HarnessSessionFixture = {
    id: SESSION_B_ID,
    agentId: FIXTURE.agents.opencodeAlice,
    humanId: FIXTURE.humans.alice,
    workspaceId: FIXTURE.workspaces.billing,
    harness: "opencode",
  };

  const aStartedAt = baseClock();
  store.createAgentSession({ ...a, startedAt: aStartedAt });

  // Agent A's session must end before Agent B begins, so B's start is forced
  // strictly after A's even when the clock is frozen.
  let bStartedAt = baseClock();
  while (bStartedAt <= aStartedAt) {
    bStartedAt = new Date(new Date(bStartedAt).getTime() + 1).toISOString();
  }
  store.createAgentSession({ ...b, startedAt: bStartedAt });

  return { a, b };
}
