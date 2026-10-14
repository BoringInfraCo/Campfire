/**
 * Capture a real Campfire Viewer screenshot for the pitch deck.
 * Uses the deterministic seed fixture plus a billing-flow narrative.
 */
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { dispatchCampfireMethod } from "../../src/http/dispatch.js";
import { createRuntimeFromPath } from "../../src/runtime.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { startCampfireViewer } from "../../src/viewer/server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "assets", "viewer-screenshot.png");

const SERGIO: ActorContext = {
  actor: { actorId: FIXTURE.humans.sergio, actorType: "human" },
};
const CODEX: ActorContext = {
  actor: { actorId: FIXTURE.agents.codexSergio, actorType: "agent" },
};
const OPENCODE: ActorContext = {
  actor: { actorId: FIXTURE.agents.opencodeAlice, actorType: "agent" },
};

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "campfire-pitch-viewer-"));
  const runtime = createRuntimeFromPath(join(dir, "pitch.db"));
  seedFixture(runtime.store);
  const { service } = runtime;
  const ws = FIXTURE.workspaces.billing;

  runtime.store.updateWorkspace(ws, { name: "billing-flow", updatedAt: new Date().toISOString() });
  service.updateGoal(SERGIO, {
    workspaceId: ws,
    goalId: FIXTURE.goals.billing,
    title: "Ship the new billing flow",
  });

  const codexSession = service.registerAgentSession(CODEX, {
    agentId: FIXTURE.agents.codexSergio,
    workspaceId: ws,
    harness: "codex",
  });
  const reviewSession = service.registerAgentSession(OPENCODE, {
    agentId: FIXTURE.agents.opencodeAlice,
    workspaceId: ws,
    harness: "opencode",
  });

  service.addFinding(
    { actor: CODEX.actor, agentSessionId: codexSession.id },
    {
      workspaceId: ws,
      summary: "Expired cards fail checkout when the retry window is shorter than the grace period.",
    },
  );

  const proposed = service.addDecision(SERGIO, {
    workspaceId: ws,
    summary: "Keep the current retry behavior for expired cards.",
    status: "proposed",
  });
  service.acceptDecision(SERGIO, proposed.id);

  service.createTask(
    { actor: CODEX.actor, agentSessionId: codexSession.id },
    {
      workspaceId: ws,
      title: "Update checkout retry for expired cards",
      status: "in_progress",
    },
  );

  service.createTask(
    { actor: OPENCODE.actor, agentSessionId: reviewSession.id },
    {
      workspaceId: ws,
      title: "Verify edge cases in card expiry handling",
      status: "open",
    },
  );

  const viewer = await startCampfireViewer({
    port: 0,
    call: (method, params) =>
      Promise.resolve(dispatchCampfireMethod(runtime.service, SERGIO, method, params ?? {})),
  });

  const url = `${viewer.url}/?workspace=${encodeURIComponent(ws)}`;
  mkdirSync(join(HERE, "assets"), { recursive: true });

  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector("#goal", { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT, fullPage: false });
  await browser.close();
  await viewer.close();
  runtime.close();

  console.log(OUT);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
