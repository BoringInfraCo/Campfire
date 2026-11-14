/** FAC-001 slice 1 phase C: HTTP dispatch registration and shape parsing for get_workspace_attention. */
import { describe, expect, it, vi } from "vitest";
import { CAMPFIRE_HTTP_METHODS, dispatchCampfireMethod, isCampfireHttpMethod, isDeliveryEligibleMethod } from "../../src/http/dispatch.js";
import type { CampfireService } from "../../src/service/service.js";

const ctx = { actor: { actorId: "hum_1", actorType: "human" as const } };

describe("FAC-001 dispatch", () => {
  it("registers the method once as a read (not delivery eligible)", () => {
    expect(CAMPFIRE_HTTP_METHODS.filter((m) => m === "get_workspace_attention")).toHaveLength(1);
    expect(isCampfireHttpMethod("get_workspace_attention")).toBe(true);
    expect(isDeliveryEligibleMethod("get_workspace_attention")).toBe(false);
  });

  it("forwards only the four documented params, omitting absent optionals", () => {
    const spy = vi.fn(() => ({}));
    const service = { getWorkspaceAttention: spy } as unknown as CampfireService;
    dispatchCampfireMethod(service, ctx, "get_workspace_attention", { workspaceId: "ws_1" });
    expect(spy).toHaveBeenLastCalledWith(ctx, { workspaceId: "ws_1" });
    dispatchCampfireMethod(service, ctx, "get_workspace_attention", { workspaceId: "ws_1", limit: 5, cursor: "c", since: "s" });
    expect(spy).toHaveBeenLastCalledWith(ctx, { workspaceId: "ws_1", limit: 5, cursor: "c", since: "s" });
  });

  it("rejects a missing workspaceId and a non-integer limit by shape", () => {
    const service = { getWorkspaceAttention: vi.fn() } as unknown as CampfireService;
    expect(() => dispatchCampfireMethod(service, ctx, "get_workspace_attention", {})).toThrow();
    expect(() => dispatchCampfireMethod(service, ctx, "get_workspace_attention", { workspaceId: "ws_1", limit: "x" })).toThrow();
  });

  it("ignores undocumented params and treats null/blank optionals as absent", () => {
    const spy = vi.fn(() => ({}));
    const service = { getWorkspaceAttention: spy } as unknown as CampfireService;
    dispatchCampfireMethod(service, ctx, "get_workspace_attention", { workspaceId: "ws_1", reason: "x", agentSessionId: "s", cursor: null, since: "   " });
    expect(spy).toHaveBeenLastCalledWith(ctx, { workspaceId: "ws_1" });
  });

  it("forwards out-of-range limits unchanged: bounds (1..100) are the service's job, after authorization", () => {
    const spy = vi.fn(() => ({}));
    const service = { getWorkspaceAttention: spy } as unknown as CampfireService;
    for (const limit of [0, -1, 101, 100000]) {
      dispatchCampfireMethod(service, ctx, "get_workspace_attention", { workspaceId: "ws_1", limit });
      expect(spy).toHaveBeenLastCalledWith(ctx, { workspaceId: "ws_1", limit });
    }
  });

  it("rejects non-string cursor/since, fractional limit and a blank workspaceId by shape, without calling the service", () => {
    const spy = vi.fn(() => ({}));
    const service = { getWorkspaceAttention: spy } as unknown as CampfireService;
    for (const params of [
      { workspaceId: "ws_1", cursor: 5 },
      { workspaceId: "ws_1", since: {} },
      { workspaceId: "ws_1", limit: 1.5 },
      { workspaceId: "   " },
      { workspaceId: 7 },
    ]) {
      expect(() => dispatchCampfireMethod(service, ctx, "get_workspace_attention", params as never)).toThrow();
    }
    expect(spy).not.toHaveBeenCalled();
  });
});
