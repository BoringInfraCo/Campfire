/**
 * ARH-001 Viewer capture for the frozen v1.20.1 baseline (contract §3.1).
 *
 * FIXTURE EVIDENCE — calibrates the surface record; cannot establish Gate B, C, or E.
 *
 * Starts one in-process, actor-bound, read-only Viewer per actor
 * (`startCampfireViewer` with the dispatched service, exactly like the SWH-001
 * integration helper, port 0). For Ana and Ben on the lab workspace it opens
 * the page, selects the workspace, waits until the orientation text carries
 * the artifact reference group, the exact stored-reference label, and the
 * recorded finding-to-artifact evidence chain, then captures a 1440x900
 * full-page screenshot plus the `#orientation` text, the `#sources` text, and
 * the `#sources` HTML. Ana also captures the truncated-artifacts workspace so
 * the artifact slice completeness note is recorded. Every network request the
 * page makes is recorded; the capture fails if any request targets the
 * referenced external host.
 *
 * No write probe: ARH-001 §3.1 is a read-only baseline record.
 *
 * The repo does not depend on Playwright. Run with an external install:
 *
 *   NODE_PATH=/private/var/folders/b5/wj2djqx569x96bjvf5wclxf80000gn/T/opencode/att-001-pw/node_modules \
 *     npx tsx fixtures/artifact-handoff/arh-001/capture-viewer.ts \
 *     --db fixtures/artifact-handoff/arh-001/.tmp/served/campfire.db \
 *     --out docs/evidence/arh-001/baseline/captures/viewer
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
import type { CampfireService } from "../../../src/service/service.js";
import { startCampfireViewer, type RunningViewer } from "../../../src/viewer/server.js";
import { SCENARIO } from "./seed.js";

const require = createRequire(import.meta.url);

function fail(message: string): never {
  throw new Error(`arh-001 capture-viewer: ${message}`);
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
interface RequestLike {
  url(): string;
}
interface PageLike {
  on(event: "request", handler: (request: RequestLike) => void): void;
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  waitForFunction(pageFunction: unknown, arg?: unknown): Promise<unknown>;
  selectOption(selector: string, value: string): Promise<unknown>;
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

function parseArgs(argv: string[]): { db: string; out: string } {
  let db: string | undefined;
  let out: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--db" || arg === "--out") {
      if (value === undefined || value.startsWith("--")) fail(`${arg} requires a value`);
      if (arg === "--db") db = isAbsolute(value) ? value : resolve(value);
      else out = isAbsolute(value) ? value : resolve(value);
      index += 1;
      continue;
    }
    fail(`unknown argument ${arg}`);
  }
  if (db === undefined) fail("--db is required");
  if (out === undefined) fail("--out is required");
  return { db, out };
}

const ACTORS = ["ana", "ben"] as const;
type ActorName = (typeof ACTORS)[number];

function actorRef(actor: ActorName): ActorRef {
  return { actorId: SCENARIO.humans[actor], actorType: "human" };
}

function actorContext(actor: ActorName): ActorContext {
  return { actor: actorRef(actor) };
}

const SAFE_REFERENCE = "https://example.com/arh-001/q3-handoff-analysis.html";
const HOSTILE_REFERENCE = 'https://example.com/arh-001/report"><img src=x onerror=alert(1)>';
const CREDENTIALED_REFERENCE =
  "https://arh001-demo-user:arh001-demo-pass@example.com/arh-001/private-view";

/**
 * Render-gate fragments: the group label, the exact stored-reference label,
 * the recorded evidence relation, and the full artifact-source line. They are
 * workspace-unique, so the previous workspace render cannot satisfy them.
 */
const LAB_SIGNATURE = [
  "artifact references",
  "current findings",
  `id ${SCENARIO.findings.labCurrent} \u00b7 evidence: ${SCENARIO.artifacts.safeOutput} (supports)`,
  `id ${SCENARIO.artifacts.safeOutput} \u00b7 reference: ${SAFE_REFERENCE} (stored reference, not fetched)`,
  "showing 7 of 7",
] as const;

const TRUNC_SIGNATURE = [
  "artifact references",
  `id ${SCENARIO.artifacts.truncLinked} \u00b7 reference: references/arh-001/trunc/runbook.md (stored reference, not fetched)`,
  "showing 10 of 12",
  "more available \u2014 open the list for the rest",
] as const;

interface WorkspaceCapture {
  workspaceId: string;
  signature: readonly string[];
}

const LAB_CAPTURES: readonly WorkspaceCapture[] = [{ workspaceId: SCENARIO.workspaces.lab, signature: LAB_SIGNATURE }];
const TRUNC_CAPTURES: readonly WorkspaceCapture[] = [
  { workspaceId: SCENARIO.workspaces.truncArtifacts, signature: TRUNC_SIGNATURE },
];

function startViewerFor(service: CampfireService, actor: ActorName): Promise<RunningViewer> {
  const ctx = actorContext(actor);
  return startCampfireViewer({
    port: 0,
    call: (method, params) => Promise.resolve(dispatchCampfireMethod(service, ctx, method, params ?? {})),
  });
}

async function captureWorkspace(options: {
  page: PageLike;
  viewerUrl: string;
  actor: ActorName;
  capture: WorkspaceCapture;
  outDir: string;
  requests: string[];
}): Promise<Record<string, unknown>> {
  const { page, viewerUrl, actor, capture, outDir, requests } = options;
  const { workspaceId, signature } = capture;
  const label = `${workspaceId}-${actor}`;
  requests.length = 0;
  await page.goto(viewerUrl, { waitUntil: "load" });
  await page.waitForFunction(
    (id: string) => Boolean(document.querySelector(`#workspace option[value="${id}"]`)),
    workspaceId,
  );
  await page.selectOption("#workspace", workspaceId);
  assert(signature.length > 0, `no render signature derived for ${workspaceId}`);
  await page.waitForFunction(
    (fragments: string[]) => {
      const text = document.body.innerText ?? "";
      return fragments.every((fragment) => text.includes(fragment));
    },
    signature,
  );
  const orientationText = (await page.evaluate(
    'document.querySelector("#orientation").innerText',
  )) as string;
  const sourcesText = (await page.evaluate('document.querySelector("#sources").innerText')) as string;
  const sourcesHtml = (await page.evaluate('document.querySelector("#sources").innerHTML')) as string;
  const sourcesAnchorCount = (await page.evaluate(
    'document.querySelectorAll("#sources a").length',
  )) as number;
  const sourcesInjectedElementCount = (await page.evaluate(
    'document.querySelectorAll("#sources img, #sources script, #sources iframe").length',
  )) as number;
  assert(
    signature.every((fragment) => `${orientationText}`.includes(fragment)),
    `${label}: orientation text lost the render signature`,
  );
  const screenshotName = `viewer-${label}.png`;
  await page.screenshot({ path: resolve(outDir, screenshotName), fullPage: true });
  writeFileSync(resolve(outDir, `viewer-${label}-orientation.txt`), `${orientationText}\n`);
  writeFileSync(resolve(outDir, `viewer-${label}-sources.txt`), `${sourcesText}\n`);
  writeFileSync(resolve(outDir, `viewer-${label}-sources.html`), `${sourcesHtml}\n`);

  const externalRequests = requests.filter(
    (url) => url.includes("example.com") || url.includes("files.example.com"),
  );
  const record: Record<string, unknown> = {
    label,
    workspaceId,
    actor: actorRef(actor),
    screenshot: screenshotName,
    signature,
    orientationTextHasSignature: signature.every((fragment) => orientationText.includes(fragment)),
    orientationHasArtifactGroup: orientationText.includes("artifact references"),
    orientationHasStoredReferenceLabel: orientationText.includes("stored reference, not fetched"),
    orientationHasEvidenceChain:
      workspaceId === SCENARIO.workspaces.lab
        ? orientationText.includes(
            `id ${SCENARIO.findings.labCurrent} \u00b7 evidence: ${SCENARIO.artifacts.safeOutput} (supports)`,
          )
        : null,
    sourcesHtmlHasCodeElement: sourcesHtml.includes("<code>"),
    sourcesHtmlHasAnchorTag: /<a[\s>]/.test(sourcesHtml),
    sourcesAnchorCount,
    sourcesInjectedElementCount,
    // The DOM text keeps the raw string; serializing re-escapes only `& < >`,
    // so the stored markup appears as inert text (`&lt;img ... &gt;`), never
    // as an element. The raw `"` is legal in text nodes and stays literal.
    sourcesHtmlEscapesHostileMarkup:
      workspaceId === SCENARIO.workspaces.lab
        ? sourcesHtml.includes("Report &lt;script&gt;alert(1)&lt;/script&gt;") &&
          sourcesHtml.includes("&lt;img src=x onerror=alert(1)&gt;")
        : null,
    hostileReferenceShownAsText: orientationText.includes(HOSTILE_REFERENCE),
    credentialedReferenceShownAsText:
      workspaceId === SCENARIO.workspaces.lab ? orientationText.includes(CREDENTIALED_REFERENCE) : null,
    artifactCompletenessNote: workspaceId === SCENARIO.workspaces.truncArtifacts
      ? orientationText.includes("showing 10 of 12") &&
        orientationText.includes("more available \u2014 open the list for the rest")
      : orientationText.includes("showing 7 of 7"),
    networkRequests: [...requests],
    externalTargetRequests: externalRequests,
  };
  assert(externalRequests.length === 0, `${label}: page made a request to the referenced external host`);
  assert(
    record.orientationTextHasSignature === true && record.orientationHasStoredReferenceLabel === true,
    `${label}: captured orientation text missed a required fragment`,
  );
  assert(record.sourcesHtmlHasAnchorTag === false && sourcesAnchorCount === 0, `${label}: sources contain an anchor`);
  assert(sourcesInjectedElementCount === 0, `${label}: stored markup produced a DOM element`);
  if (workspaceId === SCENARIO.workspaces.lab) {
    assert(
      record.sourcesHtmlEscapesHostileMarkup === true && record.orientationHasEvidenceChain === true,
      `${label}: hostile markup escaping or evidence chain missing`,
    );
  }
  return record;
}

const args = parseArgs(process.argv.slice(2));
mkdirSync(args.out, { recursive: true });

const { chromium } = loadPlaywright();
const runtime = createRuntimeFromPath(args.db);
const viewers: RunningViewer[] = [];
const browser = await chromium.launch();

try {
  const captures: Array<Record<string, unknown>> = [];
  for (const actor of ACTORS) {
    const viewer = await startViewerFor(runtime.service, actor);
    viewers.push(viewer);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    // A fresh tab state per actor: no stored workspace selection, no stored
    // "since" cursor. The capture starts from one known place.
    await context.addInitScript(() => {
      try {
        sessionStorage.clear();
        localStorage.clear();
      } catch (error) {
        // Storage may be unavailable; the capture still starts from defaults.
      }
    });
    const page = await context.newPage();
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    const workspaces = actor === "ana" ? [...LAB_CAPTURES, ...TRUNC_CAPTURES] : [...LAB_CAPTURES];
    for (const capture of workspaces) {
      captures.push(
        await captureWorkspace({
          page,
          viewerUrl: viewer.url,
          actor,
          capture,
          outDir: args.out,
          requests,
        }),
      );
    }
    await context.close();
  }

  writeFileSync(
    resolve(args.out, "capture-summary.json"),
    `${JSON.stringify(
      {
        provenance: "FIXTURE EVIDENCE — cannot establish Gate B, C, or E.",
        methodNote:
          "actor-bound in-process read-only Viewer (startCampfireViewer, port 0) + Playwright Chromium from the local cache; 1440x900 full-page PNG; #orientation and #sources text and HTML captured; every page network request recorded.",
        viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
        captures,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        outDir: args.out,
        captures: captures.map((capture) => capture.label),
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
