/**
 * ONB-001 Step 0 — read-only Viewer baseline capture (journey E).
 *
 * FIXTURE EVIDENCE — scripted engineering captures of the published v1.22.0
 * Viewer served by `campfire view` on loopback with `--port 0`. A scripted
 * headless-Chromium dump is a debugging artifact, never human evidence.
 *
 *   npx tsx fixtures/onb-001/capture-viewer.ts \
 *     --root <clean v1.22.0 worktree> [--out docs/evidence/onb-001]
 *
 * Cases:
 *   E1 fresh profile (no local profile at all): the Viewer a brand-new
 *      install serves. GET /, /app.js, /app.css, /campfire-mark.svg; the
 *      /api/call surface for whoami/list_workspaces; write refusal;
 *      wrong-Host refusal; unknown generated view; unknown route.
 *   E2 initialized local profile ("Rob"), no workspace: the canonical
 *      empty Viewer. whoami binds the profile's human; list_workspaces is
 *      an empty success; unknown generated view is a 404.
 *   E3 headless DOM dump of the E2 state (best-effort; recorded as
 *      not-captured when no chrome-headless-shell binary is present).
 *   E4 headless DOM dump of the E1 state (the error banner + waiting text).
 *
 * Isolation: each case runs in its own scenario with isolated HOME,
 * XDG_CONFIG_HOME, CAMPFIRE_CONFIG_DIR, CAMPFIRE_DATA_DIR, and TMPDIR. The
 * Viewer binds loopback `--port 0`. The headless Chromium shell (Playwright's
 * `chrome-headless-shell`) runs with its own isolated --user-data-dir inside
 * the scenario and the scenario's HOME/TMPDIR; the person's browser is never
 * launched and no real browser profile is touched. Every viewer is stopped
 * with a real SIGINT; no listener outlives the run.
 *
 * The served static bytes and the DOM dump carry no credential material; the
 * recorded masking rules apply to every written file as usual.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  Evidence,
  createScenario,
  destroyScenario,
  runPiped,
  scenarioEnv,
  sha256,
  startDaemon,
  type Daemon,
  type PipedResult,
  type Scenario,
} from "./lib/capture.js";
import {
  machineFacts,
  newCase,
  parseToolArgs,
  ToolRun,
  verifyBaselineRoot,
  type CaseRecord,
} from "./lib/tool.js";

const NAME = "onb-001 capture-viewer";
const args = parseToolArgs(process.argv.slice(2), NAME);
const baseline = verifyBaselineRoot(NAME, args.root);
const evidence = new Evidence(args.out, [process.env.HOME ?? ""]);
const run = new ToolRun(NAME, baseline);

const UNKNOWN_WORKSPACE_ID = "ws_0123456789abcdef";
const VIEWER_STATIC_PATHS = ["/", "/app.css", "/app.js", "/campfire-mark.svg"] as const;

const scenarios: Scenario[] = [];
function acquireScenario(name: string): Scenario {
  const created = createScenario(name);
  scenarios.push(created);
  return created;
}

// ---------------------------------------------------------------------------
// Viewer lifecycle
// ---------------------------------------------------------------------------

interface ViewerHandle {
  daemon: Daemon;
  url: string;
  stop(): Promise<PipedResult>;
}

const viewers: Array<{ label: string; daemon: Daemon; stopped: boolean }> = [];

async function launchView(s: Scenario, label: string): Promise<ViewerHandle> {
  const daemon = startDaemon({ root: args.root, scenario: s, argv: ["view", "--port", "0"] });
  const line = await daemon.waitStderr(/\[campfire\] viewer listening on http:\/\/127\.0\.0\.1:\d+/);
  const url = /https?:\/\/127\.0\.0\.1:\d+/.exec(line)![0];
  const entry = { label, daemon, stopped: false };
  viewers.push(entry);
  return {
    daemon,
    url,
    stop: () => {
      entry.stopped = true;
      return daemon.sigint();
    },
  };
}

// ---------------------------------------------------------------------------
// Raw HTTP client (Node `http` so the Host header stays under test control)
// ---------------------------------------------------------------------------

interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function httpCall(
  urlStr: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<HttpResponse> {
  return new Promise((resolvePromise, reject) => {
    const url = new URL(urlStr);
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: options.method ?? "GET",
        headers: options.headers ?? {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolvePromise({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

function apiCall(viewer: ViewerHandle, method: string, params?: Record<string, unknown>): Promise<HttpResponse> {
  return httpCall(`${viewer.url}/api/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params === undefined ? { method } : { method, params }),
  });
}

// ---------------------------------------------------------------------------
// Headless browser (best-effort; never the person's browser or its profile)
// ---------------------------------------------------------------------------

function findHeadlessShell(): { path: string; selectedFrom: string } | null {
  const override = process.env.ONB001_CHROME;
  if (override !== undefined && override.length > 0 && existsSync(override)) {
    return { path: override, selectedFrom: "ONB001_CHROME environment override" };
  }
  const cacheRoot = join(homedir(), "Library/Caches/ms-playwright");
  try {
    const dirs = readdirSync(cacheRoot)
      .filter((entry) => entry.startsWith("chromium_headless_shell-"))
      .sort()
      .reverse();
    for (const dir of dirs) {
      const platformDir = readdirSync(join(cacheRoot, dir)).find((entry) =>
        entry.startsWith("chrome-headless-shell-mac"),
      );
      if (platformDir === undefined) continue;
      const candidate = join(cacheRoot, dir, platformDir, "chrome-headless-shell");
      if (existsSync(candidate)) return { path: candidate, selectedFrom: "ms-playwright cache" };
    }
  } catch {
    /* no playwright cache on this machine */
  }
  return null;
}

interface DomDump {
  dom: string;
  exitCode: number | null;
  error: string | null;
}

function dumpDom(chromePath: string, scenario: Scenario, url: string): DomDump {
  const userDataDir = join(scenario.base, "chrome-profile");
  const result = spawnSync(
    chromePath,
    [
      "--headless",
      "--dump-dom",
      "--virtual-time-budget=4000",
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-default-apps",
      url,
    ],
    { env: scenarioEnv(scenario), encoding: "utf8", timeout: 30_000, maxBuffer: 32 * 1024 * 1024 },
  );
  return {
    dom: result.stdout ?? "",
    exitCode: result.status,
    error: result.error === undefined ? null : result.error.message,
  };
}

// ---------------------------------------------------------------------------
// Case scaffolding
// ---------------------------------------------------------------------------

function captureFile(
  record: CaseRecord,
  relPath: string,
  content: string,
  kind: string,
  expectContains: string[] = [],
  expectAbsent: string[] = [],
): void {
  const options = { kind, expectContains, expectAbsent };
  const failed = evidence.evaluate(content, options);
  run.markFailed(
    record,
    failed.map((failure) => `${relPath}: ${failure}`),
  );
  record.files.push(evidence.write(relPath, content, options));
}

interface CaseMeta {
  id: string;
  title: string;
  method: "http" | "browser";
  argvDisplay: string[];
  envCase?: Record<string, string>;
  simulated?: string[];
  real?: string[];
  notCaptured?: string[];
}

async function runCase(
  meta: CaseMeta,
  body: (record: CaseRecord, s: Scenario) => Promise<void> | void,
): Promise<CaseRecord> {
  const s = acquireScenario(meta.id.toLowerCase());
  const record = newCase({
    id: meta.id,
    journey: "E",
    title: meta.title,
    method: meta.method,
    argvDisplay: meta.argvDisplay,
    envCase: meta.envCase ?? {},
    simulated: meta.simulated ?? [],
    real: meta.real ?? [],
    notCaptured: meta.notCaptured ?? [],
  });
  try {
    await body(record, s);
  } catch (error) {
    run.markFailed(record, [error instanceof Error ? error.message : String(error)]);
  }
  run.add(record);
  return record;
}

const VIEW_SIMULATED = [
  "the Viewer actor is whatever the shipped CLI resolves from the isolated profile/credential state; no real profile participates",
];
const VIEW_REAL = [
  "campfire v1.22.0 CLI run from the pinned worktree via tsx",
  "a real loopback HTTP listener started with `campfire view --port 0`",
];

const VIEWER_LISTENING_LINE = "[campfire] viewer listening on http://127.0.0.1:[port]";

function assertStopped(record: CaseRecord, id: string, stopped: PipedResult): void {
  record.checks[`${id}ViewerExit`] = stopped.exitCode;
  record.checks[`${id}ViewerTimedOut`] = stopped.timedOut;
  run.markFailed(record, [
    ...(stopped.exitCode !== 0 ? [`${id} viewer exitCode ${String(stopped.exitCode)}, expected 0 after SIGINT`] : []),
    ...(stopped.timedOut ? [`${id} viewer needed SIGKILL`] : []),
  ]);
}

function assetMeta(meta: {
  path: string;
  status: number;
  contentType: string | undefined;
  contentLength: string | undefined;
  body: string;
  savedAs: string | null;
}): Record<string, unknown> {
  return {
    path: meta.path,
    status: meta.status,
    contentType: meta.contentType ?? null,
    contentLength: meta.contentLength ?? null,
    bytes: Buffer.byteLength(meta.body, "utf8"),
    sha256: sha256(meta.body),
    savedAs: meta.savedAs,
  };
}

// ---------------------------------------------------------------------------
// Captures
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // The published static assets the Viewer serves (a build step syncs
  // public/ from src/viewer/static/; both are read only to compare hashes).
  const repoAppJs = readFileSync(join(args.root, "src/viewer/static/app.js"));
  const publishedAppJs = readFileSync(join(args.root, "public/app.js"));
  run.baseline.notes.push(`app.js static sha256 ${sha256(repoAppJs)}`);
  if (sha256(repoAppJs) !== sha256(publishedAppJs)) {
    throw new Error("src/viewer/static/app.js and public/app.js differ in the baseline worktree");
  }

  // ---- E1 — fresh profile: the Viewer a brand-new install serves -----------
  await runCase(
    {
      id: "E1",
      title: "fresh-profile Viewer: served shell/assets, whoami, empty list as an ActorNotFound error, write and Host refusals",
      method: "http",
      argvDisplay: ["campfire", "view", "--port", "0"],
      envCase: { profile: "none (fresh isolated CAMPFIRE_CONFIG_DIR)", stdoutIsTty: "n/a (detached listener)" },
      simulated: VIEW_SIMULATED,
      real: VIEW_REAL,
      notCaptured: [
        "any browser rendering of this state (E4 dumps the DOM best-effort)",
        "any person's browser session or profile",
      ],
    },
    async (record, s) => {
      const view = await launchView(s, "E1");
      const statuses: Record<string, number> = {};

      const index = await httpCall(`${view.url}/`);
      statuses.index = index.status;
      captureFile(
        record,
        "machine/E1-view-fresh.index.html",
        index.body,
        "http-body",
        ['data-theme="campfire"', "<title>Campfire</title>", "<html lang=\"en\""],
        ["cft_", "cfe_"],
      );

      const appJs = await httpCall(`${view.url}/app.js`);
      statuses.appJs = appJs.status;
      captureFile(
        record,
        "machine/E1-view-fresh.app.js",
        appJs.body,
        "http-body",
        [
          "Waiting for an agent to start work.",
          // The client read surface is exactly the server allowlist calls.
          'api("list_workspaces")',
          'api("get_workspace_context"',
          'api("get_activity"',
        ],
        ["cft_", "cfe_"],
      );

      const css = await httpCall(`${view.url}/app.css`);
      const svg = await httpCall(`${view.url}/campfire-mark.svg`);
      statuses.css = css.status;
      statuses.svg = svg.status;
      const assets = {
        assets: [
          assetMeta({
            path: "/",
            status: index.status,
            contentType: index.headers["content-type"] as string | undefined,
            contentLength: index.headers["content-length"] as string | undefined,
            body: index.body,
            savedAs: "machine/E1-view-fresh.index.html",
          }),
          assetMeta({
            path: "/app.js",
            status: appJs.status,
            contentType: appJs.headers["content-type"] as string | undefined,
            contentLength: appJs.headers["content-length"] as string | undefined,
            body: appJs.body,
            savedAs: "machine/E1-view-fresh.app.js",
          }),
          assetMeta({
            path: "/app.css",
            status: css.status,
            contentType: css.headers["content-type"] as string | undefined,
            contentLength: css.headers["content-length"] as string | undefined,
            body: css.body,
            savedAs: null,
          }),
          assetMeta({
            path: "/campfire-mark.svg",
            status: svg.status,
            contentType: svg.headers["content-type"] as string | undefined,
            contentLength: svg.headers["content-length"] as string | undefined,
            body: svg.body,
            savedAs: null,
          }),
        ],
      };
      captureFile(
        record,
        "machine/E1-view-fresh.assets.json",
        `${JSON.stringify(assets, null, 2)}\n`,
        "http-assets",
        [
          '"path": "/"',
          '"contentType": "text/html; charset=utf-8"',
          '"path": "/app.css"',
          '"contentType": "text/css; charset=utf-8"',
          '"path": "/app.js"',
          '"contentType": "text/javascript; charset=utf-8"',
          '"path": "/campfire-mark.svg"',
          '"contentType": "image/svg+xml"',
          `"sha256": "${sha256(appJs.body)}"`,
        ],
        ["cft_", "cfe_"],
      );

      const whoami = await apiCall(view, "whoami");
      statuses.whoami = whoami.status;
      captureFile(
        record,
        "machine/E1-view-fresh.whoami.json",
        `${whoami.body}\n`,
        "http-json",
        ['"ok":true', '"actor":{"actorId":"hum_sergio","actorType":"human"}'],
        ["cft_", "cfe_"],
      );

      const list = await apiCall(view, "list_workspaces");
      statuses.listWorkspaces = list.status;
      captureFile(
        record,
        "machine/E1-view-fresh.list-workspaces.json",
        `${list.body}\n`,
        "http-json",
        ['"ok":false', '"error":"ActorNotFound"', '"message":"Actor not found: hum_sergio"'],
        ["cft_", "cfe_"],
      );

      const write = await apiCall(view, "create_workspace", { teamId: "team_engineering", name: "not allowed" });
      statuses.writeRefused = write.status;
      captureFile(
        record,
        "machine/E1-view-fresh.write-refused.json",
        `${write.body}\n`,
        "http-json",
        ['"ok":false', '"error":"Unauthorized"', '"message":"Viewer is read-only"'],
        ["cft_", "cfe_"],
      );

      const wrongHost = await httpCall(`${view.url}/`, { headers: { host: "evil.example:1234" } });
      statuses.wrongHost = wrongHost.status;
      captureFile(
        record,
        "machine/E1-view-fresh.wrong-host.json",
        `${wrongHost.body}\n`,
        "http-json",
        ['"error":"Unauthorized"', '"message":"Request Host is not the viewer\'s listening address"', '"ok":false'],
        ["cft_", "cfe_", "<html"],
      );

      const generated = await httpCall(`${view.url}/generated/workspaces/${UNKNOWN_WORKSPACE_ID}`);
      statuses.generatedUnknown = generated.status;
      captureFile(
        record,
        "machine/E1-view-fresh.generated-unknown.json",
        `${generated.body}\n`,
        "http-json",
        ['"error":"InternalError"', '"message":"Unable to render workspace view"'],
        ["cft_", "cfe_"],
      );

      const notFound = await httpCall(`${view.url}/nope`);
      statuses.notFound = notFound.status;
      captureFile(
        record,
        "machine/E1-view-fresh.not-found.json",
        `${notFound.body}\n`,
        "http-json",
        ['"error":"ValidationError"', '"message":"Not found: /nope"'],
        ["cft_", "cfe_"],
      );

      const stopped = await view.stop();
      captureFile(
        record,
        "machine/E1-view-fresh.viewer.stderr.txt",
        view.daemon.stderr(),
        "daemon-stderr",
        [
          VIEWER_LISTENING_LINE,
          "[campfire] received SIGINT, shutting down",
          '"reason":"Actor not found: hum_sergio"',
          '"operation":"workspace:list"',
          '"operation":"workspace:read"',
        ],
        ["cft_", "cfe_"],
      );

      record.checks = {
        statuses,
        appJsSha256: sha256(appJs.body),
        appJsMatchesRepoStatic: sha256(appJs.body) === sha256(repoAppJs),
        appJsMatchesPublicCopy: sha256(appJs.body) === sha256(publishedAppJs),
        indexBytes: Buffer.byteLength(index.body, "utf8"),
      };
      assertStopped(record, "E1", stopped);
      run.markFailed(record, [
        ...(index.status !== 200 ? [`GET / returned ${String(index.status)}`] : []),
        ...(appJs.status !== 200 ? [`GET /app.js returned ${String(appJs.status)}`] : []),
        ...(sha256(appJs.body) !== sha256(repoAppJs)
          ? ["served app.js does not match src/viewer/static/app.js"]
          : []),
        ...(whoami.status !== 200 ? [`whoami returned ${String(whoami.status)}`] : []),
        ...(write.status !== 403 ? [`create_workspace returned ${String(write.status)}, expected 403`] : []),
        ...(wrongHost.status !== 403 ? [`wrong Host returned ${String(wrongHost.status)}, expected 403`] : []),
        ...(notFound.status !== 404 ? [`GET /nope returned ${String(notFound.status)}, expected 404`] : []),
      ]);
    },
  );

  // ---- E2 — initialized local profile, no workspace -------------------------
  await runCase(
    {
      id: "E2",
      title: "local-profile Viewer without a workspace: whoami is the profile human, list_workspaces is an empty success, unknown generated view is 404",
      method: "http",
      argvDisplay: ["campfire", "view", "--port", "0"],
      envCase: { profile: "created first with `campfire --human-name Rob --output json`" },
      simulated: VIEW_SIMULATED,
      real: VIEW_REAL,
      notCaptured: ["any browser rendering of this state (E3 dumps the DOM best-effort)"],
    },
    async (record, s) => {
      const prep = runPiped({ root: args.root, scenario: s, argv: ["--human-name", "Rob", "--output", "json"] });
      if (prep.exitCode !== 0) throw new Error(`local profile precondition failed: ${prep.stderr.slice(0, 300)}`);
      captureFile(
        record,
        "machine/E2-local-profile-prep.stdout.txt",
        `${prep.stdout}`,
        "piped-stdout",
        ['"human":"Rob"', '"humanId":"hum_[id]"', '"waiting":"agent"', '"pastSessionsImported":false'],
        ["cft_", "cfe_"],
      );

      const view = await launchView(s, "E2");
      const statuses: Record<string, number> = {};

      const index = await httpCall(`${view.url}/`);
      statuses.index = index.status;
      captureFile(
        record,
        "machine/E2-view-local.index.html",
        index.body,
        "http-body",
        ['data-theme="campfire"', "<title>Campfire</title>"],
        ["cft_", "cfe_"],
      );

      const whoami = await apiCall(view, "whoami");
      statuses.whoami = whoami.status;
      captureFile(
        record,
        "machine/E2-view-local.whoami.json",
        `${whoami.body}\n`,
        "http-json",
        ['"ok":true', '"actor":{"actorId":"hum_[id]","actorType":"human"}'],
        ["cft_", "cfe_", "hum_sergio"],
      );

      const list = await apiCall(view, "list_workspaces");
      statuses.listWorkspaces = list.status;
      captureFile(
        record,
        "machine/E2-view-local.list-workspaces.json",
        `${list.body}\n`,
        "http-json",
        ['{"ok":true,"result":[]}'],
        ["cft_", "cfe_"],
      );

      const generated = await httpCall(`${view.url}/generated/workspaces/${UNKNOWN_WORKSPACE_ID}`);
      statuses.generatedUnknown = generated.status;
      captureFile(
        record,
        "machine/E2-view-local.generated-unknown.json",
        `${generated.body}\n`,
        "http-json",
        ['"ok":false', '"error":"WorkspaceNotFound"', '"message":"Workspace unavailable"'],
        ["cft_", "cfe_"],
      );

      const stopped = await view.stop();
      captureFile(
        record,
        "machine/E2-view-local.viewer.stderr.txt",
        view.daemon.stderr(),
        "daemon-stderr",
        [VIEWER_LISTENING_LINE, "[campfire] received SIGINT, shutting down", '"operation":"workspace:list"'],
        ["cft_", "cfe_"],
      );

      record.checks = { statuses };
      assertStopped(record, "E2", stopped);
      run.markFailed(record, [
        ...(index.status !== 200 ? [`GET / returned ${String(index.status)}`] : []),
        ...(whoami.status !== 200 ? [`whoami returned ${String(whoami.status)}`] : []),
        ...(list.status !== 200 ? [`list_workspaces returned ${String(list.status)}`] : []),
        ...(generated.status !== 404 ? [`generated unknown returned ${String(generated.status)}, expected 404`] : []),
      ]);
    },
  );

  // ---- E3 — headless DOM dump of the empty local-profile Viewer -------------
  const chrome = findHeadlessShell();
  const chromeVersion =
    chrome === null
      ? null
      : (spawnSync(chrome.path, ["--version"], { encoding: "utf8", timeout: 15_000 }).stdout ?? "").trim() || null;

  await runCase(
    {
      id: "E3",
      title: "headless DOM dump of the empty local-profile Viewer (Waiting for an agent to start work.)",
      method: "browser",
      argvDisplay: ["chrome-headless-shell", "--dump-dom", "http://127.0.0.1:<port>/"],
      envCase: { profile: "created first with `campfire --human-name Rob --output json`" },
      simulated: [
        ...VIEW_SIMULATED,
        "the page's display font/size may differ from a person's browser; only the rendered DOM text is captured",
      ],
      real: [
        "campfire v1.22.0 Viewer on a real loopback listener",
        "a real headless Chromium engine (Playwright `chrome-headless-shell`) fetching the served page with an isolated --user-data-dir",
      ],
      notCaptured: [],
    },
    async (record, s) => {
      if (chrome === null || chromeVersion === null) {
        record.checks = { headlessAvailable: false, chromeVersion: null };
        record.notCaptured.push(
          "the rendered DOM dump (no chrome-headless-shell binary found; set ONB001_CHROME to a chrome-headless-shell path to capture it)",
        );
        return;
      }
      const prep = runPiped({ root: args.root, scenario: s, argv: ["--human-name", "Rob", "--output", "json"] });
      if (prep.exitCode !== 0) throw new Error(`local profile precondition failed: ${prep.stderr.slice(0, 300)}`);
      const view = await launchView(s, "E3");
      const dump = dumpDom(chrome.path, s, `${view.url}/`);
      const stopped = await view.stop();
      captureFile(
        record,
        "browser/E3-view-empty.dom.html",
        dump.dom,
        "headless-dom",
        [
          'data-theme="campfire"',
          "<title>Campfire</title>",
          // The rendered empty state. The select stays empty here: app.js
          // initializes `selectKey = ""` (:66) and skips the option write when
          // the list key is also "", so the `Waiting for an agent to start
          // work.` option at :783 is unreachable on the exact-empty first
          // render. Only the stream hint renders.
          '<select id="workspace" aria-label="Workspace"></select>',
          '<div class="empty">Waiting for an agent to start work.</div>',
        ],
        ["cft_", "cfe_", "hum_sergio"],
      );
      record.notes.push(
        "observed: the served empty state renders the stream hint `Waiting for an agent to start work.` but the workspace select stays empty (app.js:66 `selectKey` guard vs the :783 option), so no placeholder text appears in the select",
      );
      captureFile(
        record,
        "machine/E3-view.stderr.txt",
        view.daemon.stderr(),
        "daemon-stderr",
        [VIEWER_LISTENING_LINE, "[campfire] received SIGINT, shutting down"],
        ["cft_", "cfe_"],
      );
      record.checks = {
        headlessAvailable: true,
        chromeVersion,
        chromeSelectedFrom: chrome.selectedFrom,
        chromeExitCode: dump.exitCode,
        chromeError: dump.error,
        domBytes: Buffer.byteLength(dump.dom, "utf8"),
      };
      assertStopped(record, "E3", stopped);
      run.markFailed(record, [
        ...(dump.exitCode !== 0 ? [`headless dump exitCode ${String(dump.exitCode)}`] : []),
        ...(dump.error !== null ? [`headless dump error: ${dump.error}`] : []),
        ...(Buffer.byteLength(dump.dom, "utf8") === 0 ? ["headless dump was empty"] : []),
      ]);
    },
  );

  // ---- E4 — headless DOM dump of the fresh-profile Viewer -------------------
  await runCase(
    {
      id: "E4",
      title: "headless DOM dump of the fresh-profile Viewer (ActorNotFound banner plus the waiting text)",
      method: "browser",
      argvDisplay: ["chrome-headless-shell", "--dump-dom", "http://127.0.0.1:<port>/"],
      envCase: { profile: "none (fresh isolated CAMPFIRE_CONFIG_DIR)" },
      simulated: [...VIEW_SIMULATED],
      real: [
        "campfire v1.22.0 Viewer on a real loopback listener",
        "a real headless Chromium engine (Playwright `chrome-headless-shell`) fetching the served page with an isolated --user-data-dir",
      ],
      notCaptured: [],
    },
    async (record, s) => {
      if (chrome === null || chromeVersion === null) {
        record.checks = { headlessAvailable: false, chromeVersion: null };
        record.notCaptured.push(
          "the rendered DOM dump (no chrome-headless-shell binary found; set ONB001_CHROME to a chrome-headless-shell path to capture it)",
        );
        return;
      }
      const view = await launchView(s, "E4");
      const dump = dumpDom(chrome.path, s, `${view.url}/`);
      const stopped = await view.stop();
      captureFile(
        record,
        "browser/E4-view-fresh.dom.html",
        dump.dom,
        "headless-dom",
        [
          'data-theme="campfire"',
          "Actor not found: hum_sergio",
          '<div class="empty">Waiting for an agent to start work.</div>',
        ],
        ["cft_", "cfe_"],
      );
      captureFile(
        record,
        "machine/E4-view.stderr.txt",
        view.daemon.stderr(),
        "daemon-stderr",
        [VIEWER_LISTENING_LINE, "[campfire] received SIGINT, shutting down"],
        ["cft_", "cfe_"],
      );
      record.checks = {
        headlessAvailable: true,
        chromeVersion,
        chromeSelectedFrom: chrome.selectedFrom,
        chromeExitCode: dump.exitCode,
        chromeError: dump.error,
        domBytes: Buffer.byteLength(dump.dom, "utf8"),
      };
      assertStopped(record, "E4", stopped);
      run.markFailed(record, [
        ...(dump.exitCode !== 0 ? [`headless dump exitCode ${String(dump.exitCode)}`] : []),
        ...(dump.error !== null ? [`headless dump error: ${dump.error}`] : []),
        ...(Buffer.byteLength(dump.dom, "utf8") === 0 ? ["headless dump was empty"] : []),
      ]);
    },
  );

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const summary = run.summary({
    capturedOn: "2026-10-18",
    machineFacts: machineFacts(),
    methodNotes: {
      launch: "`campfire view --port 0` binds a real loopback listener; the URL is read from the `[campfire] viewer listening on http://127.0.0.1:<port>` stderr line",
      actorBinding:
        "the browser never receives a token; the Viewer process resolves the acting human from the isolated profile (E2/E3: the profile created by `campfire --human-name Rob`; E1/E4: no profile, so the CLI default actor id `hum_sergio` from src/cli/index.ts is used and does not exist in the store)",
      emptyStates:
        "E1/E4: with no profile the store has no such actor, so list_workspaces fails with ActorNotFound and the generated route falls through to a 500 InternalError (ActorNotFound is not in the route's 404 mapping at src/viewer/server.ts). E2/E3: an initialized local profile with no workspace sees `{\"ok\":true,\"result\":[]}` and the rendered empty state `Waiting for an agent to start work.`",
      servedAssets:
        "GET /, /app.css, /app.js, /campfire-mark.svg are served from src/viewer/static/ with their content-length and content-type; the served app.js is byte-identical to both src/viewer/static/app.js and the published public/app.js copy in the v1.22.0 worktree",
      hostGuard:
        "a request whose Host header is not this listener's address/port is refused with 403 before any route runs (src/viewer/server.ts, PSA-001)",
      writeGuard:
        "POST /api/call with a method outside VIEWER_READ_METHODS is refused with 403 `Viewer is read-only` before options.call is reached",
      headlessDump:
        "`chrome-headless-shell --dump-dom --virtual-time-budget=4000` fetches the served page and dumps the DOM after the page's initial /api/call round-trip; the browser runs with an isolated --user-data-dir inside the scenario and the scenario HOME/TMPDIR. No person's browser profile is used.",
      shutdown:
        "every viewer is stopped with a real SIGINT to its process group and exits 0 with `[campfire] received SIGINT, shutting down`",
    },
    observations: {
      appJsSha256: "2632df6c25e714c3096d00fa426ac1e4c39f8c94bb92d7410a526b3be0067f6c",
      chromeHeadlessShell: {
        available: chrome !== null,
        version: chromeVersion,
        selectedFrom: chrome === null ? null : chrome.selectedFrom,
      },
      viewerStaticFilesScanned: VIEWER_STATIC_PATHS,
    },
    maskingRules:
      "see BASELINE_PIN.md — cft-shaped credential tokens -> [redacted]; cfe-shaped invitation secrets -> [one-time-credential: redacted]; enrollment invitation ids (ein_inv_<16 hex>) -> ein_inv_[id]; absolute /Users, /private, /var/folders, /tmp paths -> [path]; loopback ports -> [port]; ISO timestamps -> [timestamp]; UUIDs -> [uuid]; object ids (<prefix>_<16 hex>) -> <prefix>_[id]",
  });
  evidence.writeSummary("summaries/viewer.json", summary);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${NAME}: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    const finish = async (): Promise<void> => {
      for (const entry of viewers) {
        if (!entry.stopped) {
          entry.stopped = true;
          await entry.daemon.sigint();
        }
      }
      for (const s of scenarios) destroyScenario(s);
      const failedIds = run.cases.filter((record) => record.status === "failed").map((record) => record.id);
      process.stdout.write(
        `${JSON.stringify({ tool: NAME, cases: run.cases.length, failed: failedIds, files: evidence.files().length, failedWrites: evidence.failed().length }, null, 2)}\n`,
      );
      if (process.exitCode !== 1) process.exitCode = run.exitCode();
    };
    void finish();
  });
