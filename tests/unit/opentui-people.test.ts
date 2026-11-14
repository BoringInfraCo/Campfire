import { describe, expect, it } from "vitest";
import { ownedAgentsParams, participantFacts, validateOwnedAgentsPage } from "../../tui/src/people.js";

const agent = { actor: { actorId: "agt_one", actorType: "agent" }, name: "Agent", role: "agent", harness: "codex", humanOwnerId: "hum_one", humanOwnerIsParticipant: true, joinedAt: "2026-01-01" };
const page = { workspaceId: "ws_one", filter: { humanOwnerId: "hum_one" }, items: [agent], total: 2, returned: 1, truncated: true, nextCursor: "cursor-next" };

describe("OpenTUI participant drilldown", () => {
  it("uses the service owner filter and retains it on continuation", () => {
    expect(ownedAgentsParams("ws_one", "hum_one")).toEqual({ workspaceId: "ws_one", humanOwnerId: "hum_one", limit: 50 });
    expect(ownedAgentsParams("ws_one", "hum_one", "cursor-next")).toEqual({ workspaceId: "ws_one", humanOwnerId: "hum_one", limit: 50, cursor: "cursor-next" });
    expect(() => ownedAgentsParams("ws_one", "hum_one\u001b")).toThrow();
  });

  it("rejects mismatched workspace, owner, rows, or continuation disclosure", () => {
    expect(validateOwnedAgentsPage(page, "ws_one", "hum_one")).toBe(true);
    expect(validateOwnedAgentsPage(page, "ws_two", "hum_one")).toBe(false);
    expect(validateOwnedAgentsPage(page, "ws_one", "hum_two")).toBe(false);
    expect(validateOwnedAgentsPage({ ...page, items: [{ ...agent, humanOwnerId: "hum_two" }] }, "ws_one", "hum_one")).toBe(false);
    expect(validateOwnedAgentsPage({ ...page, items: [{ ...agent, actor: { actorId: "hum_one", actorType: "human" } }] }, "ws_one", "hum_one")).toBe(false);
    expect(validateOwnedAgentsPage({ ...page, nextCursor: undefined }, "ws_one", "hum_one")).toBe(false);
    expect(validateOwnedAgentsPage({ ...page, total: 0 }, "ws_one", "hum_one")).toBe(false);
  });

  it("renders only participant facts, with owner and non-presence caveats", () => {
    const text = participantFacts({ ...agent, name: "A\u001b[31mName", secret: "do-not-print" }).join("\n");
    expect(text).toContain("agent: agt_one");
    expect(text).toContain("humanOwnerId: hum_one");
    expect(text).toContain("Owner is a workspace participant.");
    expect(text).toContain("not presence or permission to act");
    expect(text).not.toContain("do-not-print");
    expect(text).not.toContain("\u001b");
    expect(participantFacts({ actor: { actorId: "hum_one", actorType: "human" }, name: "Person" }).join("\n")).toContain("Enter lists this human's workspace-participating agents.");
  });
});
