import { describe, expect, it } from "vitest";
import { alphaRoute, recordAlphaRequest } from "../../src/worker/alpha-observability.js";

describe("hosted alpha operational measurement", () => {
  it("groups exact routes and never includes a URL capability", () => {
    const secret = `cfe_${"ab".repeat(16)}`;
    const request = new Request(`https://boringinfra.company/campfire/v1/enrollment/preview?token=${secret}#v1.${secret}`, { method: "POST" });
    const points: unknown[] = [];
    recordAlphaRequest({ writeDataPoint(point) { points.push(point); } }, request, 429, 14.6);
    expect(points).toEqual([{ indexes: ["invitation_preview"], blobs: ["invitation_preview", "POST", "limited", "429"], doubles: [1, 15] }]);
    expect(JSON.stringify(points)).not.toContain(secret);
  });

  it("maps branded and unprefixed paths and groups unknown dynamic paths", () => {
    expect(alphaRoute(new Request("https://boringinfra.company/campfire/join"))).toBe("join_page");
    expect(alphaRoute(new Request("https://worker.example/join"))).toBe("join_page");
    expect(alphaRoute(new Request("https://worker.example/v1/publication/import"))).toBe("publication_import");
    expect(alphaRoute(new Request("https://worker.example/v1/integrations/github/private-source"))).toBe("other");
  });

  it("does not fail the request if the measurement binding throws", () => {
    expect(() => recordAlphaRequest({ writeDataPoint() { throw new Error("dataset unavailable"); } }, new Request("https://worker.example/v1/call"), 503, 3)).not.toThrow();
  });
});
