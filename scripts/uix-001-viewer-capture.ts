/**
 * UIX-001 Viewer viewport capture for the frozen ATT-001 lab seed.
 *
 * Fixture evidence only. Starts the local Viewer the way
 * fixtures/attention/att-001/capture-viewer.ts does (port 0, actor bound on
 * dispatch) and writes PNG plus document.body.innerText. Not a full-page
 * capture and not a new product route.
 *
 *   NODE_PATH=<external playwright node_modules> npx tsx scripts/uix-001-viewer-capture.ts
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ActorRef } from "../src/domain/types.js";
import { dispatchCampfireMethod } from "../src/http/dispatch.js";
import { createRuntimeFromPath } from "../src/runtime.js";
import type { ActorContext } from "../src/service/authorization.js";
import type { WorkspaceContext } from "../src/service/service.js";
import { startCampfireViewer, type RunningViewer } from "../src/viewer/server.js";
import { SCENARIO, UNRELATED_FINDING_SENTINEL, seedDatabase } from "../fixtures/attention/att-001/seed.js";

const require = createRequire(import.meta.url);

// These names exist in the page callbacks. The script itself runs on Node.
declare const document: {
  querySelector(selector: string): {
    textContent: string | null;
    innerHTML: string;
    getAttribute(name: string): string | null;
  } | null;
  documentElement: { scrollWidth: number; clientWidth: number };
};
declare const sessionStorage: { clear(): void };
declare const localStorage: { clear(): void };
const OUT_DIR = resolve("docs/evidence/uix-001/candidate/viewer");
const GOAL_TITLE = "Make team attention cues trustworthy without changing recorded work.";
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

interface PlaywrightModule {
  chromium: { launch(): Promise<BrowserLike> };
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
  evaluate<T>(expression: string | (() => T)): Promise<T>;
}

function fail(message: string): never {
  throw new Error(`uix-001 capture: ${message}`);
}

function loadPlaywright(): PlaywrightModule {
  try {
    return require("playwright") as PlaywrightModule;
  } catch (error) {
    fail(`playwright is not resolvable (${error instanceof Error ? error.message : String(error)})`);
  }
}

function actorContext(actorId: string): ActorContext {
  const actor: ActorRef = { actorId, actorType: "human" };
  return { actor };
}

interface Shot {
  name: string;
  scrollWidth: number;
  clientWidth: number;
  text: string;
}

const methods = new Set<string>();

const dir = mkdtempSync(join(tmpdir(), "campfire-uix-001-viewer-"));
const seeded = seedDatabase(dir, true, "none");
const runtime = createRuntimeFromPath(seeded.databasePath);
const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const shots: Shot[] = [];

function call(ctx: ActorContext, method: string, params: Record<string, unknown> | undefined): unknown {
  methods.add(method);
  return dispatchCampfireMethod(runtime.service, ctx, method, params ?? {});
}

try {
  mkdirSync(OUT_DIR, { recursive: true });
  const captures: Array<{ actor: "ana" | "ben"; perspectives: Array<"mine" | "team"> }> = [
    { actor: "ana", perspectives: ["mine", "team"] },
    { actor: "ben", perspectives: ["mine"] },
  ];

  for (const capture of captures) {
    const actorId = SCENARIO.humans[capture.actor];
    const ctx = actorContext(actorId);
    const viewer: RunningViewer = await startCampfireViewer({
      port: 0,
      call: (method, params) => Promise.resolve(call(ctx, method, params)),
    });
    try {
      const workspaceContext = call(ctx, "get_workspace_context", {
        workspaceId: SCENARIO.workspaces.lab,
      }) as WorkspaceContext;
      const signature = [
        `showing ${workspaceContext.slices.tasks.returned} of ${workspaceContext.slices.tasks.total}`,
        `showing ${workspaceContext.slices.decisions.returned} of ${workspaceContext.slices.decisions.total}`,
      ];
      for (const viewport of VIEWPORTS) {
        const context = await browser.newContext({ viewport: { ...viewport }, deviceScaleFactor: 1 });
        await context.addInitScript(() => {
          try {
            sessionStorage.clear();
            localStorage.clear();
          } catch {
            // Storage may be unavailable. The page still starts from defaults.
          }
        });
        const page = await context.newPage();
        try {
          await page.goto(viewer.url, { waitUntil: "load" });
          await page.waitForFunction(
            (id: string) => Boolean(document.querySelector(`#workspace option[value="${id}"]`)),
            SCENARIO.workspaces.lab,
          );
          await page.selectOption("#workspace", SCENARIO.workspaces.lab);
          await page.waitForFunction(
            (fragments: string[]) => {
              const text = document.querySelector("#orientation")?.textContent ?? "";
              const needsYou = document.querySelector("#needs-you");
              const needsAttention = document.querySelector("#needs-attention");
              if (!needsYou || !needsAttention) return false;
              if (needsYou.innerHTML.length === 0 || needsAttention.innerHTML.length === 0) return false;
              return fragments.every((fragment) => text.includes(fragment));
            },
            signature,
          );
          for (const perspective of capture.perspectives) {
            if (perspective === "team") await page.click("#perspective-team");
            if (perspective === "mine") await page.click("#perspective-mine");
            await page.waitForFunction(
              (expected: string) => document.querySelector("#orientation")?.getAttribute("data-perspective") === expected,
              perspective,
            );
            const text = await page.evaluate("document.body.innerText");
            if (typeof text !== "string") fail("body text was not a string");
            const overflow = await page.evaluate(() => ({
              scrollWidth: document.documentElement.scrollWidth,
              clientWidth: document.documentElement.clientWidth,
            }));
            const name = `${capture.actor}-lab-${perspective}-${viewport.width}x${viewport.height}`;
            await page.screenshot({ path: join(OUT_DIR, `${name}.png`), fullPage: false });
            writeFileSync(join(OUT_DIR, `${name}.txt`), text);
            shots.push({ name, scrollWidth: overflow.scrollWidth, clientWidth: overflow.clientWidth, text });
          }
        } finally {
          await context.close();
        }
      }
    } finally {
      await viewer.close();
    }
  }

  const anaMineWide = shots.find((shot) => shot.name === "ana-lab-mine-1440x900");
  const anaMineNarrow = shots.find((shot) => shot.name === "ana-lab-mine-390x844");
  const benWide = shots.find((shot) => shot.name === "ben-lab-mine-1440x900");
  const benNarrow = shots.find((shot) => shot.name === "ben-lab-mine-390x844");
  if (!anaMineWide || !anaMineNarrow || !benWide || !benNarrow) fail("missing required captures");

  if (!anaMineWide.text.includes(GOAL_TITLE)) fail("1440 ana mine text is missing the goal title");
  if (!anaMineWide.text.includes("task_att001_") && !anaMineWide.text.includes("dec_att001_")) {
    fail("1440 ana mine text is missing an attention cue id");
  }
  if (!/task_att001_[a-z0-9_]+/.test(anaMineWide.text)) fail("1440 ana mine text is missing a current-work id");
  if (!anaMineNarrow.text.includes(SCENARIO.goal.lab)) fail("390 ana mine text is missing the goal id");
  if (!/needs you/i.test(anaMineNarrow.text)) fail("390 ana mine text is missing the attention panel");
  for (const shot of [benWide, benNarrow]) {
    if (!shot.text.includes("more matching records may exist")) fail(`${shot.name} is missing the incomplete-empty sentence`);
    if (!shot.text.includes("truncated") && !shot.text.includes("Cues beyond the returned pages may exist.")) {
      fail(`${shot.name} is missing truncated coverage wording`);
    }
  }
  for (const shot of shots) {
    if (shot.scrollWidth > shot.clientWidth) {
      fail(`${shot.name} horizontal overflow ${shot.scrollWidth} > ${shot.clientWidth}`);
    }
    if (shot.text.includes("cft_") || shot.text.includes("/Users/") || shot.text.includes(UNRELATED_FINDING_SENTINEL)) {
      fail(`${shot.name} contains a forbidden string`);
    }
    const png = readFileSync(join(OUT_DIR, `${shot.name}.png`));
    const raw = png.toString("latin1");
    if (raw.includes("cft_") || raw.includes("/Users/") || raw.includes(UNRELATED_FINDING_SENTINEL)) {
      fail(`${shot.name}.png contains a forbidden string`);
    }
  }
  const allowed = new Set(["whoami", "list_workspaces", "get_workspace", "get_workspace_context", "get_activity"]);
  for (const method of methods) {
    if (!allowed.has(method)) fail(`capture called ${method}`);
  }

  const overflowRows = shots
    .map((shot) => `| ${shot.name} | ${shot.scrollWidth} | ${shot.clientWidth} | no |`)
    .join("\n");
  const readme = `# UIX-001 candidate Viewer captures

Fixture evidence from the ATT-001 lab seed (\`seedDatabase(..., true, "none")\`). Not a human observation. The five cold tasks remain NOT OBSERVED. This capture does not rescore ATT-001.

Screenshots use the viewport only (\`fullPage\` is not set). Text files are \`document.body.innerText\`.

## Horizontal overflow

\`document.documentElement.scrollWidth <= document.documentElement.clientWidth\`

| Capture | scrollWidth | clientWidth | overflow |
| --- | --- | --- | --- |
${overflowRows}

## Checks

- 1440x900 Ana My work text includes the goal title, an attention cue id, and a current-work id.
- 390x844 Ana My work text includes the goal id and the Needs You panel.
- Ben My work text, both viewports, includes "more matching records may exist" and truncated coverage wording.
- No text or PNG file contains \`cft_\`, \`/Users/\`, or the unrelated finding sentinel.
- Dispatch methods: ${[...methods].sort().join(", ")}. No artifact fetch and no new route.
`;
  writeFileSync(join(OUT_DIR, "README.md"), readme);
  process.stdout.write(
    `${JSON.stringify(
      {
        outDir: "docs/evidence/uix-001/candidate/viewer",
        shots: shots.map((shot) => ({
          name: shot.name,
          scrollWidth: shot.scrollWidth,
          clientWidth: shot.clientWidth,
        })),
        methods: [...methods].sort(),
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await browser.close();
  runtime.close();
  rmSync(dir, { recursive: true, force: true });
}
