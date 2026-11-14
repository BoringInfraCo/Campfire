import { describe, expect, it } from "vitest";
import { activityDetails, activitySummary } from "../../tui/src/activity.js";

describe("OpenTUI activity presentation", () => {
  const event = { id: "con_1", createdAt: "2026-11-14T01:03:21.391Z", actor: { actorId: "agt_1", actorType: "agent" }, action: "create", objectType: "goal", objectId: "goal_1", agentSessionId: "ses_1", payload: { title: "Ship the work", status: "open", secret: "do not display" } };
  const roster = [{ name: "OpenCode", actor: { actorId: "agt_1", actorType: "agent" } }];

  it("leads with the recorded actor and action, resolving names only for matching identity", () => {
    expect(activitySummary(event, roster)).toBe("OpenCode created goal: Ship the work · 2026-11-14T01:03:21.391Z");
    expect(activitySummary(event, [{ name: "Other", actor: { actorId: "agt_1", actorType: "human" } }])).toContain("created goal: Ship the work · agt_1");
    expect(activitySummary(event)).not.toContain("con_1");
  });

  it("retains recorded provenance in details and omits arbitrary payload", () => {
    const details = activityDetails(event, roster).join("\n");
    for (const expected of ["Event ID: con_1", "Actor ID: agt_1", "Record ID: goal_1", "Agent session: ses_1", "Status: open"]) expect(details).toContain(expected);
    expect(details).not.toContain("do not display");
  });

  it("sanitizes terminal controls and does not invent missing identities or actions", () => {
    const summary = activitySummary({ actor: {}, action: "custom_action", objectType: "task", payload: { title: "hello\u001b[31m" } });
    expect(summary).toContain("Actor unavailable recorded custom action task");
    expect(summary).not.toContain("\u001b");
  });
});
