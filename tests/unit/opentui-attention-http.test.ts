import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { contributionCursor, encodeContextCursor } from "../../src/domain/context-policy.js";
import { startCampfireHttpServer } from "../../src/http/server.js";
import { createRuntimeFromPath } from "../../src/runtime.js";
import { attentionLines, readAttention } from "../../tui/src/attention.js";
import { postCall } from "../../tui/src/client.js";

it("detects an ahead-of-tip catch-up cursor through the real HTTP adapter", async () => {
  const dir = mkdtempSync(join(tmpdir(), "campfire-opentui-http-"));
  const runtime = createRuntimeFromPath(join(dir, "campfire.db"));
  seedFixture(runtime.store);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  let server: Awaited<ReturnType<typeof startCampfireHttpServer>> | undefined;
  try {
    server = await startCampfireHttpServer({ runtime, host: "127.0.0.1", port: 0 });
    const workspaceId = FIXTURE.workspaces.billing;
    const ahead = encodeContextCursor(contributionCursor({
      workspaceId, occurredAt: "2026-01-01T00:00:00.000Z", id: "con_fake",
      phase: "high", originOccurredAt: "2026-01-01T00:00:00.000Z", originId: "con_fake",
      position: 9999999, originPosition: 9999999, tip: 0,
    }));
    const initial = { workspaceId, status: "ready" as const, baseline: ahead };
    const state = await readAttention(initial, (method, params) => postCall(server!.url, FIXTURE.tokens.sergio, method, params));
    expect(state.status).toBe("cursor_error");
    expect(state.baseline).toBeUndefined();
    expect(attentionLines(state).join(" ")).toContain("ahead of the workspace tip");
    expect(attentionLines(state).join(" ")).not.toContain(ahead);
  } finally {
    if (server) await server.close();
    runtime.close();
    log.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});
