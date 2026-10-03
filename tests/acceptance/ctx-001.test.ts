/**
 * CTX-001 acceptance fixture. Deterministic service evidence, not a live harness trace.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { FindingNotFound, ParticipantRequired, ValidationError } from "../../src/domain/errors.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";

const NOW = "2026-01-01T00:00:00.000Z";
const HUMAN1: ActorContext = { actor: { actorId: "hum_1", actorType: "human" } };
const HUMAN2: ActorContext = { actor: { actorId: "hum_2", actorType: "human" } };

function createClock(startMs = Date.parse(NOW)) {
  let current = startMs;
  return () => {
    current += 1000;
    return new Date(current).toISOString();
  };
}

describe("CTX-001 acceptance", () => {
  let service: CampfireService;

  afterEach(() => {
    service?.close();
  });

  function setup(): CampfireService {
    const store = openInMemoryStore();
    service = createCampfireService({ store, idSource: createCounterIdSource(), clock: createClock() });
    store.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: NOW });
    store.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: NOW });
    store.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
    store.createHuman({ id: "hum_2", teamId: "team_1", displayName: "Grace", createdAt: NOW });
    return service;
  }

  it("returns a complete orientation when the workspace fits the budget", () => {
    const campfire = setup();
    const workspace = campfire.createWorkspace(HUMAN1, { teamId: "team_1", name: "Small" });
    campfire.createGoal(HUMAN1, { workspaceId: workspace.id, title: "Shared goal" });
    const proposed = campfire.addDecision(HUMAN1, { workspaceId: workspace.id, summary: "propose" });
    const accepted = campfire.addDecision(HUMAN1, { workspaceId: workspace.id, summary: "accept" });
    campfire.acceptDecision(HUMAN1, accepted.id);
    for (let index = 0; index < 3; index += 1) {
      campfire.addFinding(HUMAN1, { workspaceId: workspace.id, summary: `finding ${index}` });
    }
    for (let index = 0; index < 4; index += 1) {
      campfire.createTask(HUMAN1, { workspaceId: workspace.id, title: `task ${index}` });
    }
    for (let index = 0; index < 2; index += 1) {
      campfire.addArtifact(HUMAN1, {
        workspaceId: workspace.id,
        type: "document",
        title: `doc ${index}`,
        uriOrPath: `docs/${index}.md`,
      });
    }

    const context = campfire.getWorkspaceContext(HUMAN1, workspace.id);
    expect(context.goal?.title).toBe("Shared goal");
    expect(context.proposedDecisions.map((decision) => decision.id)).toContain(proposed.id);
    expect(context.acceptedDecisions.map((decision) => decision.id)).toContain(accepted.id);
    expect(context.supersededDecisions).toEqual([]);
    expect(context.completeness.fullHistoryIncluded).toBe(false);
    for (const slice of Object.values(context.slices)) {
      expect(slice.truncated).toBe(false);
      expect(slice.returned).toBe(slice.total);
    }
  });

  it("denies the other workspace before revealing its finding", () => {
    const campfire = setup();
    const workspaceA = campfire.createWorkspace(HUMAN1, { teamId: "team_1", name: "A" });
    const workspaceB = campfire.createWorkspace(HUMAN2, { teamId: "team_1", name: "B" });
    const hidden = campfire.addFinding(HUMAN2, { workspaceId: workspaceB.id, summary: "only in B" });
    const context = campfire.getWorkspaceContext(HUMAN1, workspaceA.id);
    expect(context.slices.findings.total).toBe(0);
    expect(context.findings.map((finding) => finding.id)).not.toContain(hidden.id);

    expect(() => campfire.getFindingInWorkspace(HUMAN1, workspaceA.id, hidden.id)).toThrow(FindingNotFound);
    expect(() => campfire.getWorkspaceContext(HUMAN2, workspaceA.id)).toThrow(ParticipantRequired);

    const foreign = campfire.getWorkspaceContext(HUMAN2, workspaceB.id).orientationCursor;
    expect(() =>
      campfire.getWorkspaceChanges(HUMAN1, { workspaceId: workspaceA.id, after: foreign }),
    ).toThrow(ValidationError);
    expect(() => campfire.listFindingsPage(HUMAN1, { workspaceId: workspaceA.id, cursor: foreign })).toThrow(
      /Cursor belongs to a different workspace/,
    );
  });
});
