import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import {
  AGENT_A_INSTRUCTION,
  AGENT_B_INSTRUCTION,
  PRIVATE_TRANSCRIPT_SENTINEL_A,
} from "../../src/acceptance/real/prompts.js";
import {
  createHarnessSessions,
  SESSION_A_ID,
  SESSION_B_ID,
} from "../../src/acceptance/real/sessions.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../fixtures/billing/${name}`, import.meta.url)), "utf8");
}

describe("billing fixtures", () => {
  it("documents the recurring lock held past the deploy timeout", () => {
    const incident = fixture("INCIDENT-HISTORY.md");
    const migration = fixture("migration-284.sql");

    expect(incident).toContain("ACCESS EXCLUSIVE");
    expect(incident).toContain("120s");
    expect(migration).toContain("ACCESS EXCLUSIVE");
    expect(migration.toLowerCase()).toContain("lock");
  });

  it("documents the reverted timeout increase and the overlap it caused", () => {
    const incident = fixture("INCIDENT-HISTORY.md");

    expect(incident.toLowerCase()).toContain("timeout");
    expect(incident.toLowerCase()).toContain("overlap");
    expect(incident.toLowerCase()).toContain("stale balances");
  });

  it("orients the reader and points at the deploy log", () => {
    const readme = fixture("README.md");
    const deployLog = fixture("deploy.log");

    expect(readme).toContain("single transaction");
    expect(readme).toContain("deploy.log");
    expect(deployLog).toContain("120s");
    expect(deployLog.toLowerCase()).toContain("timed out");
  });
});

describe("real-harness prompts", () => {
  it("leaks no answer into Agent B's instruction", () => {
    const forbidden = ["split", "migration 284", "120", "timeout increase"];

    for (const phrase of forbidden) {
      expect(AGENT_B_INSTRUCTION.toLowerCase()).not.toContain(phrase);
    }
    expect(AGENT_B_INSTRUCTION).not.toContain(PRIVATE_TRANSCRIPT_SENTINEL_A);
  });

  it("keeps Agent A's private sentinel in Agent A's prompt only", () => {
    expect(AGENT_A_INSTRUCTION).toContain(PRIVATE_TRANSCRIPT_SENTINEL_A);
  });
});

describe("createHarnessSessions", () => {
  let store: CampfireStore;

  beforeEach(() => {
    store = openInMemoryStore();
    seedFixture(store);
  });

  afterEach(() => {
    store.close();
  });

  it("creates both pre-bound sessions with correct identity", () => {
    const { a, b } = createHarnessSessions(store);

    expect(a).toEqual({
      id: SESSION_A_ID,
      agentId: FIXTURE.agents.codexSergio,
      humanId: FIXTURE.humans.sergio,
      workspaceId: FIXTURE.workspaces.billing,
      harness: "codex",
    });
    expect(b).toEqual({
      id: SESSION_B_ID,
      agentId: FIXTURE.agents.opencodeAlice,
      humanId: FIXTURE.humans.alice,
      workspaceId: FIXTURE.workspaces.billing,
      harness: "opencode",
    });

    expect(store.getAgentSession(SESSION_A_ID)?.agentId).toBe(FIXTURE.agents.codexSergio);
    expect(store.getAgentSession(SESSION_B_ID)?.agentId).toBe(FIXTURE.agents.opencodeAlice);
  });

  it("orders B strictly after A even with a frozen clock", () => {
    const frozen = "2026-09-12T00:00:00.000Z";
    createHarnessSessions(store, () => frozen);

    const aSession = store.getAgentSession(SESSION_A_ID);
    const bSession = store.getAgentSession(SESSION_B_ID);

    expect(aSession?.startedAt).toBe(frozen);
    expect(bSession?.startedAt).toBeDefined();
    expect(bSession !== undefined && aSession !== undefined && bSession.startedAt > aSession.startedAt).toBe(true);
  });
});
