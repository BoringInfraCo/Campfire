import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { dispatchCampfireMethod } from "../../src/http/dispatch.js";
import { createRuntimeFromPath, type CampfireRuntime } from "../../src/runtime.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { startCampfireViewer, type RunningViewer } from "../../src/viewer/server.js";

const ctx: ActorContext = { actor: { actorId: FIXTURE.humans.sergio, actorType: "human" } };
let dir: string;
let runtime: CampfireRuntime;
let viewer: RunningViewer | undefined;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "campfire-gwv-001-"));
  runtime = createRuntimeFromPath(join(dir, "campfire.db"));
  seedFixture(runtime.store);
  viewer = await startCampfireViewer({
    port: 0,
    call: (method, params) => Promise.resolve(dispatchCampfireMethod(runtime.service, ctx, method, params ?? {})),
  });
});

afterEach(async () => {
  await viewer?.close();
  runtime.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GWV-001 generated workspace view", () => {
  it("projects bounded authorized context without storing a page or contribution", async () => {
    if (!viewer) throw new Error("Viewer did not start");
    const workspaceId = FIXTURE.workspaces.billing;
    const hostile = '<img src="https://example.invalid/x" onerror="fetch(\'/api/call\')">';
    for (let i = 0; i < 12; i++) {
      runtime.service.addFinding(ctx, { workspaceId, summary: i === 0 ? hostile : `Finding ${i}` });
    }
    const before = runtime.store.countObjects("contributions", workspaceId);
    const context = runtime.service.getWorkspaceContext(ctx, workspaceId);

    const response = await fetch(`${viewer.url}/generated/workspaces/${workspaceId}`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain(context.workspace.name);
    expect(html).toContain(context.goal?.title);
    expect(html).toContain(`${context.slices.findings.returned} returned of ${context.slices.findings.total} total`);
    expect(html).toContain("incomplete; use the existing journal or CLI drill-down");
    expect(html).toContain("Among returned orientation items:");
    expect(html).toContain(
      context.slices.tasks.truncated
        ? "The task section is incomplete, so the in-progress and blocked counts are not workspace totals."
        : "These counts cover the items returned in this orientation.",
    );
    expect(html).toContain("&lt;img src=&quot;https://example.invalid/x&quot;");
    expect(html).not.toContain(hostile);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("cft_fixture_");
    const csp = response.headers.get("content-security-policy") ?? "";
    const sandbox = csp.split(";").map((part) => part.trim()).find((part) => part === "sandbox" || part.startsWith("sandbox "));
    expect(sandbox).toBe("sandbox");
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const again = await fetch(`${viewer.url}/generated/workspaces/${workspaceId}`);
    expect(again.status).toBe(200);
    expect(runtime.store.countObjects("contributions", workspaceId)).toBe(before);
  });

  it("denies another workspace before rendering any workspace field", async () => {
    if (!viewer) throw new Error("Viewer did not start");
    const person = runtime.service.createHuman(ctx, { teamId: FIXTURE.teamId, displayName: "Una" });
    const nonParticipant: ActorContext = { actor: { actorId: person.human.id, actorType: "human" } };
    const unaViewer = await startCampfireViewer({
      port: 0,
      call: (method, params) => Promise.resolve(dispatchCampfireMethod(runtime.service, nonParticipant, method, params ?? {})),
    });
    try {
      for (const workspaceId of [FIXTURE.workspaces.unrelated, "ws_does_not_exist"]) {
        const response = await fetch(`${unaViewer.url}/generated/workspaces/${workspaceId}`);
        const body = await response.text();
        expect(response.status).toBe(404);
        expect(body).not.toContain(workspaceId);
        expect(body).not.toContain(FIXTURE.unrelatedFindingSentinel);
        expect(body).not.toContain("<!doctype html>");
      }
    } finally {
      await unaViewer.close();
    }
  });

  it("shows a review marker with its cited finding and keeps withdrawn findings out of current items", async () => {
    if (!viewer) throw new Error("Viewer did not start");
    const workspaceId = FIXTURE.workspaces.billing;
    const finding = runtime.service.addFinding(ctx, {
      workspaceId,
      summary: "cache is stale",
      detail: "first reading",
    });
    const decision = runtime.service.acceptDecision(
      ctx,
      runtime.service.addDecision(ctx, { workspaceId, summary: "flush the cache" }).id,
    );
    runtime.service.citeDecisionBasis(ctx, { decisionId: decision.id, findingId: finding.id });
    runtime.service.withdrawFinding(ctx, { findingId: finding.id, reason: "cache was cold" });
    const context = runtime.service.getWorkspaceContext(ctx, workspaceId);
    const flagged = context.slices.decisions.items.find((item) => item.id === decision.id);
    expect(flagged?.needsReview).toBe(true);
    expect(flagged?.needsReviewFindingIds).toEqual([finding.id]);

    const before = runtime.store.countObjects("contributions", workspaceId);
    const response = await fetch(`${viewer.url}/generated/workspaces/${workspaceId}`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain(`needs review ${finding.id}`);
    expect(html).toContain(`${context.historicalCounts.findings} historical findings`);
    expect(html).toContain("Open the existing journal or CLI drill-down to inspect those records.");
    const findingsHtml = html.slice(html.indexOf("<h2>Current findings</h2>"), html.indexOf("<h2>Artifact references</h2>"));
    expect(findingsHtml).not.toContain("cache is stale");
    const decisionsHtml = html.slice(html.indexOf("<h2>Decisions</h2>"), html.indexOf("<h2>Current findings</h2>"));
    expect(decisionsHtml).toContain("flush the cache");
    expect(decisionsHtml).not.toContain("superseded ·");
    expect(runtime.store.countObjects("contributions", workspaceId)).toBe(before);
  });

  it("keeps the journal's read-method allowlist and exposes a link only for a selected workspace", async () => {
    if (!viewer) throw new Error("Viewer did not start");
    const html = await (await fetch(viewer.url)).text();
    expect(html).toContain('id="generated-view-link"');
    const response = await fetch(`${viewer.url}/generated/workspaces/${FIXTURE.workspaces.billing}`, { method: "POST" });
    expect(response.status).toBe(405);
    const write = await fetch(`${viewer.url}/api/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "add_finding", params: { workspaceId: FIXTURE.workspaces.billing, summary: "forbidden" } }),
    });
    expect(write.status).toBe(403);
  });
});
