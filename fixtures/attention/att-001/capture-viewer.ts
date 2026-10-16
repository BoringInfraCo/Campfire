/**
 * ATT-001 Viewer capture for the frozen v1.18.0 baseline (contract §4).
 *
 * FIXTURE EVIDENCE — calibrates UI and rubric; cannot establish Gate B, C, or E.
 *
 * Starts one in-process read-only Viewer per actor (`startCampfireViewer` with
 * the dispatched service, exactly like the SWH-001 integration helper, port 0),
 * then for Ana and Ben and each authorized lab workspace opens the page,
 * selects the workspace, waits for the orientation panels, and captures both
 * perspectives (My work / Team work) as a full-page screenshot plus the
 * rendered `#orientation` text. Finally it proves on a SEPARATE fresh seed
 * instance that a team-attention cue does not remove the caller's write
 * permission: Ana updates `task_att001_blocked_opencode`.
 *
 * The repo does not depend on Playwright. Run with an external install:
 *
 *   NODE_PATH=/private/var/folders/b5/wj2djqx569x96bjvf5wclxf80000gn/T/opencode/att-001-pw/node_modules \
 *     npx tsx fixtures/attention/att-001/capture-viewer.ts \
 *     --db fixtures/attention/att-001/.tmp/run-a/campfire.db \
 *     --out fixtures/attention/att-001/.tmp/capture \
 *     --label baseline
 *
 * Chromium is taken from the local Playwright cache; no browser install runs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import type { ActorRef } from "../../../src/domain/types.js";
import { dispatchCampfireMethod } from "../../../src/http/dispatch.js";
import { createRuntimeFromPath } from "../../../src/runtime.js";
import type { ActorContext } from "../../../src/service/authorization.js";
import type { CampfireService, WorkspaceContext } from "../../../src/service/service.js";
import { startCampfireViewer, type RunningViewer } from "../../../src/viewer/server.js";
import { SCENARIO, seedDatabase } from "./seed.js";

const require = createRequire(import.meta.url);

function fail(message: string): never {
  throw new Error(`att-001 capture: ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

interface PlaywrightModule {
  chromium: {
    launch(options?: Record<string, unknown>): Promise<BrowserLike>;
  };
}
interface BrowserLike {
  newContext(options?: Record<string, unknown>): Promise<ContextLike>;
  close(): Promise<void>;
}
interface ContextLike {
  newPage(): Promise<PageLike>;
  addInitScript(script: () => void): Promise<void>;
  close(): Promise<void>;
}
interface PageLike {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  waitForFunction(pageFunction: unknown, arg?: unknown): Promise<unknown>;
  selectOption(selector: string, value: string): Promise<unknown>;
  click(selector: string): Promise<unknown>;
  screenshot(options: Record<string, unknown>): Promise<unknown>;
  evaluate(expression: string): Promise<unknown>;
}

function loadPlaywright(): PlaywrightModule {
  try {
    return require("playwright") as PlaywrightModule;
  } catch (error) {
    fail(
      `playwright is not resolvable (${error instanceof Error ? error.message : String(error)}); ` +
        "run with NODE_PATH pointing at the external playwright install",
    );
  }
}

function parseArgs(argv: string[]): { db: string; out: string; label: "baseline" | "candidate" } {
  let db: string | undefined;
  let out: string | undefined;
  let label: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--db" || arg === "--out" || arg === "--label") {
      if (value === undefined || value.startsWith("--")) fail(`${arg} requires a value`);
      if (arg === "--db") db = isAbsolute(value) ? value : resolve(value);
      else if (arg === "--out") out = isAbsolute(value) ? value : resolve(value);
      else label = value;
      index += 1;
      continue;
    }
    fail(`unknown argument ${arg}`);
  }
  if (db === undefined) fail("--db is required");
  if (out === undefined) fail("--out is required");
  if (label !== "baseline" && label !== "candidate") fail("--label must be baseline or candidate");
  return { db, out, label };
}

const ACTORS = ["ana", "ben"] as const;
type ActorName = (typeof ACTORS)[number];

const CAPTURED_WORKSPACES = [
  SCENARIO.workspaces.lab,
  SCENARIO.workspaces.quiet,
  SCENARIO.workspaces.truncTasks,
  SCENARIO.workspaces.truncDecisions,
  SCENARIO.workspaces.truncBoth,
] as const;

const PERSPECTIVES = ["mine", "team"] as const;

function actorRef(actor: ActorName): ActorRef {
  return { actorId: SCENARIO.humans[actor], actorType: "human" };
}

function actorContext(actor: ActorName): ActorContext {
  return { actor: actorRef(actor) };
}

/**
 * Perspective-independent render gate: the Current Work panel states the
 * returned/total counts of the task and decision slices in both perspectives.
 * The pair of fragments is unique per workspace, so it cannot be satisfied by
 * the previous workspace's context or by the cleared (null-context) render.
 */
function renderSignature(context: WorkspaceContext): string[] {
  return [
    `showing ${context.slices.tasks.returned} of ${context.slices.tasks.total}`,
    `showing ${context.slices.decisions.returned} of ${context.slices.decisions.total}`,
  ];
}

async function captureWorkspace(options: {
  page: PageLike;
  viewerUrl: string;
  actor: ActorName;
  workspaceId: string;
  signature: string[];
  label: "baseline" | "candidate";
  capturesDir: string;
  textDir: string;
}): Promise<void> {
  const { page, viewerUrl, actor, workspaceId, signature, label, capturesDir, textDir } = options;
  await page.goto(viewerUrl, { waitUntil: "load" });
  await page.waitForFunction(
    (id: string) => Boolean(document.querySelector(`#workspace option[value="${id}"]`)),
    workspaceId,
  );
  await page.selectOption("#workspace", workspaceId);

  // Wait until the orientation renders the target workspace's own counts. The
  // attention panels are rendered by the same call, so this also waits for them.
  assert(signature.length > 0, `no render signature derived for ${workspaceId}`);
  await page.waitForFunction(
    (fragments: string[]) => {
      const orientation = document.querySelector("#orientation");
      const needsYou = document.querySelector("#needs-you");
      const needsAttention = document.querySelector("#needs-attention");
      if (!orientation || !needsYou || !needsAttention) return false;
      if (needsYou.innerHTML.length === 0 || needsAttention.innerHTML.length === 0) return false;
      const text = orientation.innerText ?? "";
      return fragments.every((fragment) => text.includes(fragment));
    },
    signature,
  );

  for (const perspective of PERSPECTIVES) {
    if (perspective === "team") {
      await page.click("#perspective-team");
    }
    await page.waitForFunction(
      (expected: string) =>
        document.querySelector("#orientation")?.getAttribute("data-perspective") === expected,
      perspective,
    );
    // The perspective is applied synchronously; confirm the workspace counts
    // survive the switch (the Current Work panel renders from the same
    // already-fetched context).
    await page.waitForFunction(
      (fragments: string[]) => {
        const text = document.querySelector("#orientation")?.innerText ?? "";
        return fragments.every((fragment) => text.includes(fragment));
      },
      signature,
    );
    const text = (await page.evaluate('document.querySelector("#orientation").innerText')) as string;
    assert(
      signature.every((fragment) => text.includes(fragment)),
      `${label}-${workspaceId}-${actor}-${perspective}: captured text lost the workspace render signature`,
    );
    await page.screenshot({
      path: resolve(capturesDir, `${label}-${workspaceId}-${actor}-${perspective}.png`),
      fullPage: true,
    });
    writeFileSync(resolve(textDir, `${label}-${workspaceId}-${actor}-${perspective}.txt`), text);
  }
}

function startViewerFor(service: CampfireService, actor: ActorName): Promise<RunningViewer> {
  const ctx = actorContext(actor);
  return startCampfireViewer({
    port: 0,
    call: (method, params) => Promise.resolve(dispatchCampfireMethod(service, ctx, method, params ?? {})),
  });
}

/**
 * Write probe: on a SEPARATE fresh seed instance, Ana updates a task recorded
 * as assigned to another participant's agent — the same task the Viewer cues
 * under team attention. A team cue is ordering, not an access boundary; the
 * write carries Ana's own provenance. If the service denies the write, the
 * denial is recorded verbatim instead.
 */
function writeProbe(outDir: string, label: "baseline" | "candidate"): Record<string, unknown> {
  const probeSeedDir = resolve(outDir, "probe-seed");
  const seeded = seedDatabase(probeSeedDir, true);
  const probeRuntime = createRuntimeFromPath(seeded.databasePath);
  const anaCtx = actorContext("ana");
  const taskId = SCENARIO.tasks.blockedOpencode;
  const base: Record<string, unknown> = {
    provenance: "FIXTURE EVIDENCE — cannot establish Gate B, C, or E.",
    label,
    workspaceId: SCENARIO.workspaces.lab,
    caller: actorRef("ana"),
    taskId,
    requested: { status: "in_progress" },
    cue: {
      list: "needsAttention",
      reason: "team_blocked_task",
      note: "Cued to Ana in the v1.18.0 baseline while the task is assigned to agt_att001_opencode.",
    },
  };
  try {
    const returnedTask = dispatchCampfireMethod(probeRuntime.service, anaCtx, "update_task", {
      taskId,
      status: "in_progress",
    });
    const activity = probeRuntime.service.getActivity(anaCtx, {
      workspaceId: SCENARIO.workspaces.lab,
      limit: 20,
    });
    const contributions = activity.items
      .filter(
        (contribution) =>
          contribution.objectType === "task" &&
          contribution.objectId === taskId &&
          contribution.action === "update",
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    const recorded = contributions[contributions.length - 1];
    assert(recorded !== undefined, "no task update contribution was recorded");
    assert(
      recorded.actor.actorId === SCENARIO.humans.ana,
      `recorded contribution actor was ${recorded.actor.actorId}`,
    );
    const probe: Record<string, unknown> = {
      ...base,
      outcome: "allowed",
      returnedTask,
      recordedContribution: recorded,
      contributionActorId: recorded.actor.actorId,
      assertion: "The recorded contribution actor equals the caller hum_att001_ana.",
    };
    writeFileSync(resolve(outDir, "probe", "ana-updates-opencode-task.json"), `${JSON.stringify(probe, null, 2)}\n`);
    return probe;
  } catch (error) {
    const probe: Record<string, unknown> = {
      ...base,
      outcome: "denied",
      denial: {
        name: error instanceof Error ? error.name : typeof error,
        code:
          error instanceof Error && "code" in error && typeof error.code === "string"
            ? error.code
            : undefined,
        message: error instanceof Error ? error.message : String(error),
      },
      note: "Recorded verbatim; the capture does not work around the denial.",
    };
    writeFileSync(resolve(outDir, "probe", "ana-updates-opencode-task.json"), `${JSON.stringify(probe, null, 2)}\n`);
    return probe;
  } finally {
    probeRuntime.close();
  }
}

const args = parseArgs(process.argv.slice(2));
const capturesDir = resolve(args.out, "captures");
const textDir = resolve(args.out, "text");
mkdirSync(capturesDir, { recursive: true });
mkdirSync(textDir, { recursive: true });
mkdirSync(resolve(args.out, "probe"), { recursive: true });

const { chromium } = loadPlaywright();
const runtime = createRuntimeFromPath(args.db);
const viewers: RunningViewer[] = [];
const browser = await chromium.launch();

try {
  for (const actor of ACTORS) {
    const viewer = await startViewerFor(runtime.service, actor);
    viewers.push(viewer);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    // A fresh tab state per actor: no stored workspace selection, no stored
    // "since" cursor. The controlled comparison starts from one known place.
    await context.addInitScript(() => {
      try {
        sessionStorage.clear();
        localStorage.clear();
      } catch (error) {
        // Storage may be unavailable; the capture still starts from defaults.
      }
    });
    const page = await context.newPage();
    for (const workspaceId of CAPTURED_WORKSPACES) {
      const workspaceContext = dispatchCampfireMethod(
        runtime.service,
        actorContext(actor),
        "get_workspace_context",
        { workspaceId },
      ) as WorkspaceContext;
      await captureWorkspace({
        page,
        viewerUrl: viewer.url,
        actor,
        workspaceId,
        signature: renderSignature(workspaceContext),
        label: args.label,
        capturesDir,
        textDir,
      });
    }
    await context.close();
  }

  const probe = writeProbe(args.out, args.label);
  process.stdout.write(
    `${JSON.stringify(
      {
        outDir: args.out,
        label: args.label,
        workspaces: [...CAPTURED_WORKSPACES],
        actors: [...ACTORS],
        perspectives: [...PERSPECTIVES],
        probe: { taskId: probe.taskId, outcome: probe.outcome },
      },
      null,
      2,
    )}\n`,
  );
} finally {
  for (const viewer of viewers) {
    await viewer.close();
  }
  await browser.close();
  runtime.close();
}
