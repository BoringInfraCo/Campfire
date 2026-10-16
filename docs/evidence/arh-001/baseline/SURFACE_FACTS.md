# ARH-001 — v1.20.1 artifact-reference surface facts

**FIXTURE / ENGINEERING EVIDENCE — cannot establish Gate B, C, or E.**
This record describes baseline behavior of the published v1.20.1 surfaces toward
Artifact references, as observed on the deterministic fixture
(`fixtures/artifact-handoff/arh-001/`, frozen key in `PIN.md`) and cited in
source at HEAD `76db5be` (product files byte-identical to tag commit
`dc3c2a4`, see `PIN.md` §2). Facts only; nothing here is scored.

Evidence base:

- `served-state/` — sanitized, token-free dumps of a fresh fixture seed,
  frozen read clock `2026-10-16T18:00:00.000Z` (`dump-summary.json` has the
  per-file sha256 and per-slice counts).
- `captures/dashboard/` — real `campfire dashboard` PTY frames
  (`capture-summary.json` states each capture's method: `pty`).
- `captures/viewer/` — actor-bound Viewer captures (1440×900 full-page PNG,
  `#orientation`/`#sources` text and HTML, recorded network requests).
- `captures/cli/` — real CLI JSON outputs against the same seeded database
  (fixture clock; `generatedAt` is the real read clock of the CLI run).
- `captures/mcp/` — live in-process MCP capture (real server + in-memory
  client): `tools/list` and the two artifact tool responses.
- Source citations at file:line from the capture working tree.

---

## (a) Service responses

### (a1) `get_workspace` — full inspector

- `get_workspace` returns `artifacts: store.listArtifacts(workspaceId)`
  (`src/service/campfire-service.ts:1007`): every artifact row in the
  workspace, unbounded, as the raw record.
- Lab workspace dump (`served-state/workspace-ws_arh001_lab-ana.json`): 7
  artifact records, ids
  `art_arh001_safe_output`, `art_arh001_safe_old_report`, `art_arh001_stale`,
  `art_arh001_path`, `art_arh001_insecure_scheme`, `art_arh001_credentialed`,
  `art_arh001_hostile_markup`.
- Truncated-artifacts workspace dump:
  `served-state/workspace-ws_arh001_trunc_artifacts-ana.json` carries all 12
  records including `art_arh001_beyond_page` and `art_arh001_trunc_older`.
- Record fields (every artifact row, e.g. the first lab record verbatim):
  `createdAt`, `createdBy { actorId, actorType }`, `id`, `metadata` (when
  recorded), `title`, `type`, `uriOrPath`, `workspaceId`.
- Ana and Ben (and both agents) receive the same lab artifact records; the four
  `workspace-ws_arh001_lab-*.json` files are byte-identical (sha256
  `70f594c7a19b25eff0bc06f546a16f30bbb1869a1f7511c5f5140c9022fe8109` in
  `served-state/dump-summary.json`).

### (a2) `get_workspace_context` — bounded artifacts slice

- `slices.artifacts` is a bounded page (`ContextSlice`:
  `{ items, total, returned, truncated, nextCursor? }`, assembled by
  `toContextSlice` at `src/domain/context-policy.ts:49-60`); the default
  budget is `artifacts: 10` (`DEFAULT_CONTEXT_BUDGET`,
  `src/domain/context-policy.ts:17-25`).
- Lab (`served-state/context-ws_arh001_lab-ana.json`): `total 7`,
  `returned 7`, `truncated false`, no `nextCursor`; the cited artifact
  `art_arh001_safe_output` sorts first, then
  `hostile_markup`, `credentialed`, `insecure_scheme`, `path`, `stale`,
  `safe_old_report` (rank-then-recency order, identical to
  `fixtures/artifact-handoff/arh-001/seed.ts` `LAB_ARTIFACT_PAGE_ORDER`).
- Truncated-artifacts workspace (`context-ws_arh001_trunc_artifacts-ana.json`
  and `-ben.json`, byte-identical, sha256
  `59d1b549dfa35e3f8c6d03d608e067d17bdeef3ebc1ee8fd82e9b0837478f989`):
  `total 12`, `returned 10`, `truncated true`, `nextCursor` present
  (`cf1.eyJ2IjoxLCJraW5kIjoiYXJ0aWZhY3QiLCJ3b3Jrc3BhY2VJZCI6IndzX2FyaDAwMV90cnVuY19hcnRpZmFjdHMiLCJyYW5rIjoxLCJhdCI6IjIwMjYtMTAtMTZUMTY6MDA6NTkuMDAwWiIsImlkIjoiYXJ0X2FyaDAwMV90cnVuY19maWxsZXJfMDEifQ`).
  The returned page is
  `[art_arh001_trunc_linked, art_arh001_trunc_filler_09 … art_arh001_trunc_filler_01]`;
  `art_arh001_beyond_page` and `art_arh001_trunc_older` are not in the page.
- The same item list is exposed through the legacy `artifacts` field:
  `artifacts: artifacts.items` in `assembleWorkspaceContext`
  (`src/service/context-assembly.ts:90`).
- Lab slice parity: Ana/Ben/agents see the identical artifacts slice; the
  actor-specific differences in the context dumps are outside
  `slices.artifacts` (e.g. `needsYou`, `needsAttention`).

### (a3) `get_artifact` — one record by id

- `getArtifactInWorkspace(ctx, workspaceId, artifactId)`
  (`src/service/service.ts:502-503`; implementation
  `src/service/campfire-service.ts:1382-1385`) authorizes
  `workspace:read`, then `readInWorkspace(store.getArtifact(artifactId), …)`;
  an id that is not in that workspace raises `ArtifactNotFound` (denial row in
  `served-state/denials.json`).
- Returned record fields (captured verbatim via
  `captures/cli/inspect-artifact-art_arh001_safe_output.json`, `.object`):
  `createdBy { actorId: hum_arh001_ana, actorType: human }`,
  `createdAt: 2026-10-16T16:00:17.000Z`, `id: art_arh001_safe_output`,
  `workspaceId: ws_arh001_lab`, `type: report`,
  `title: Q3 handoff analysis (external report)`,
  `uriOrPath: https://example.com/arh-001/q3-handoff-analysis.html`,
  `metadata: { period: 2026-Q3, source: external-reporting }`.

## (b) Dashboard (`campfire dashboard`)

- Loading: `cmdDashboard` (`src/cli/index.ts:1405-1439`) requires an
  interactive TTY (`:1406-1408`), resolves the workspace, then
  `runDashboardSession` loads with `get_workspace_context` and inspects a
  selected artifact with `get_artifact` (`inspectMethod` maps
  `artifact → get_artifact`, `src/cli/dashboard.ts:128-139`). No other read is
  made.
- Section: `buildArtifactReferences` (`src/cli/dashboard.ts:589-602`) draws
  the chrome title `ARTIFACT REFERENCES` (`:591`) and one line per
  `context.artifacts` item (`:592-599`); the label is
  `ARTIFACT_REFERENCE_LABEL = "stored reference, not fetched"`
  (`src/presentation/work-console.ts:44`). Exact line format:
  `<id>  <type>  <uriOrPath>  stored reference, not fetched` (two spaces
  between fields).
- Captured (method `pty`, `captures/dashboard/capture-summary.json`):
  - `lab-ana-120x36.txt` line 10-11:
    ```
    ARTIFACT REFERENCES
      art_arh001_safe_output  report  https://example.com/arh-001/q3-handoff-analysis.html  stored reference, not fetched
    ```
    and lines 12-20 with the other six lab references (`hostile_markup`,
    `credentialed`, `insecure_scheme`, `path`, `stale`, `safe_old_report`),
    each carrying `stored reference, not fetched`.
  - `lab-ana-80x24.txt`: the label renders on artifact record lines
    (lines 8-22); the chrome title line is not drawn at this size — the
    shared fit pass drops rank-1 chrome lines before rank-0 record lines
    (`fit`, `src/cli/dashboard.ts:625-642`; section title is rank 1 at
    `:591`), and `art_arh001_safe_old_report` falls outside the 24-row cut.
    The capture summary records `artifactRowsDrawn` for both sizes.
  - `trunc-ana-120x36.txt` lines 7-17: title plus exactly the 10 returned
    artifacts
    (`art_arh001_trunc_linked`, `…filler_09` … `…filler_01`); the beyond-page
    artifacts are not drawn as artifact rows.
- No artifact truncation note: the section draws no total/returned/truncated
  row or marker. For `ws_arh001_trunc_artifacts` (12 total / 10 returned /
  `truncated: true`) the frame contains neither `more available` nor
  `showing 10 of 12` (capture summary: `moreAvailableDrawn: false`,
  `showingTruncCountDrawn: false`); the 10 drawn rows are the returned page,
  because the section iterates `context.artifacts` — the same
  `slices.artifacts.items` (`src/service/context-assembly.ts:90`).
- Inspect view: selecting an artifact row and pressing enter issues
  `get_artifact` and prints `<id>  <type>  <uriOrPath>  stored reference, not
  fetched` (`src/cli/dashboard.ts:554-566`); a selected artifact id that is
  not resolvable in the loaded context prints `<id>  stored reference, not
  fetched` (`:564-565`). The PTY captures were taken with the default
  selection (attention row), not an artifact inspect.
- Record text passes through `stripTerminalControls` (`clean`,
  `src/cli/dashboard.ts:141-143`; final `renderDashboard` map at `:759`), so
  stored markup cannot move the cursor or forge chrome. The PTY frames contain
  no escape sequences in their text.

## (c) Viewer (local, actor-bound)

- Artifact row render: `artifactSourceHtml`
  (`src/viewer/static/app.js:1259-1270`). Exact rendered string:
  `id <id> · reference: <uriOrPath> (stored reference, not fetched)`, inside
  `<li class="oitem">` with `<span class="ometa">` (type) and
  `<span class="osentence">` (title); the reference is wrapped in a `<code>`
  element and HTML-escaped with `esc()` (`app.js:68-74`: `& < > "` escaped).
  The source comment (`app.js:1263-1264`) states the reference "is never
  fetched, previewed, or linked, and listing it does not claim the target
  exists or is accessible."
- Sources panel: `renderSources` (`app.js:1281-1292`) renders the groups
  `current findings` and `artifact references` from
  `slices.findings.items` / `slices.artifacts.items`, with a completeness row
  via `sourceListHtml` (`app.js:1272-1279`) and `completenessNote`
  (`app.js:880-889`), called at `app.js:1476`.
- Captured exact text (`captures/viewer/...-orientation.txt`,
  `...-sources.txt`; summary `capture-summary.json`):
  - Lab (Ana and Ben):
    `id art_arh001_safe_output · reference: https://example.com/arh-001/q3-handoff-analysis.html (stored reference, not fetched)`;
    findings row
    `id find_arh001_current · evidence: art_arh001_safe_output (supports)`
    (`findingSourceHtml`, `app.js:1242-1257`); completeness
    `artifacts  showing 7 of 7`; group label `artifact references` (lowercase
    as rendered).
  - Truncated-artifacts workspace (Ana):
    `artifacts  showing 10 of 12 · more available — open the list for the rest`
    (`more available — open the list for the rest` is the truncation phrase
    at `app.js:887`).
- `<code>` element and no anchor: the captured `#sources` HTML contains
  `<code>…</code>` for every reference; `sourcesHtmlHasAnchorTag: false` and
  DOM `#sources a` count 0 for all three captures.
- Recorded evidence chain text is shown on the finding row:
  `id find_arh001_current · evidence: art_arh001_safe_output (supports)`
  (captured lab orientation text line 71; relation vocabulary from
  `cite_finding_evidence` records, `seed.ts` `fev_arh001_current_supports`).
- Captured decision-safety context on the same surface: the accepted,
  read-time `needsReview` decision renders as
  `needs review cites non-current finding find_arh001_superseded`
  (captured lab orientation text line 62).

## (d) CLI JSON

- `campfire artifacts [workspace] --output json`
  (`src/cli/catalog.ts:360-368`; command `src/cli/index.ts:1666-1672` →
  `cmdObjectPage` `:1674-1699` → method `list_artifacts`): bound page object
  `{ schemaVersion: 1, workspaceId, items, total, returned, truncated,
  nextCursor? }` (`finishObjectPage`, `src/service/campfire-service.ts:696-703`).
  - Lab capture: `total 7, returned 7, truncated false`, no `nextCursor`.
  - Trunc capture: `total 12, returned 10, truncated true`, `nextCursor`
    present (the same `cf1.…` cursor).
  - Item fields as in (a1).
- `campfire context [workspace] --output json`
  (`src/cli/catalog.ts:294-303`; `src/cli/index.ts:1475-1492`) prints the
  `WorkspaceContext` unchanged: `slices.artifacts` with `total`/`returned`/
  `truncated` (lab capture: 7/7/false; and it matches the frozen dump except
  `generatedAt`, which is the real read clock).
- `campfire inspect artifact <id> --workspace <ws> --output json`
  (`src/cli/catalog.ts:380-390`; `cmdInspect` `src/cli/index.ts:1796-1835`)
  calls `get_artifact` (`:1823-1829`) and emits
  `{ version: 1, kind: "workspace_inspect", workspaceId, objectType:
  "artifact", object: <raw record> }` — captured for
  `art_arh001_safe_output`, see (a3).
- `campfire status --output json` (`src/cli/catalog.ts:242-252`;
  `cmdStatus` `src/cli/index.ts:1389-1403`) builds
  `WorkspaceStatusResult` (`src/cli/projections.ts:143-154`,
  `buildWorkspaceStatus` `:168-212`), which has no artifacts field or count.
  In the captured status JSON the substring `artifact` occurs twice — once
  inside the fixture workspace name `ARH-001 artifact handoff lab` and once in
  the goal title — and nowhere as a data field or count.

## (e) MCP

- `list_artifacts` (`src/mcp/tools.ts:372-384`): input
  `{ workspaceId, limit?, cursor? }`; the handler dispatches
  `list_artifacts` through the same application service
  (`invoke` → `dispatchCampfireMethod`, `src/mcp/tools.ts:153-181`;
  dispatch table `src/http/dispatch.ts:375-376`). Response is the same bound
  page object captured in (d) (raw object, no CLI wrapper). Live capture
  (`captures/mcp/list-artifacts-ws_arh001_trunc_artifacts.json`, actor Ana):
  `total 12, returned 10, truncated true`, `nextCursor` present, items equal
  to the served-state page.
- `get_artifact` (`src/mcp/tools.ts:413-420`): input
  `{ workspaceId, artifactId }`; dispatch case
  `src/http/dispatch.ts:383-384` → `getArtifactInWorkspace`. Returns the raw
  record including `uriOrPath` (same fields as (a3)), unwrapped. Live capture
  (`captures/mcp/get-artifact-art_arh001_safe_output.json`): exactly the
  record fields of (a3), `uriOrPath:
  https://example.com/arh-001/q3-handoff-analysis.html`, `isError: false`.
- Tool count: 36 tools are registered unconditionally; `get_playbook` is the
  only opt-in tool (`options.playbookEnabled === true`,
  `src/mcp/tools.ts:706-716`; enabled via `playbookEnabled(env, argv)`,
  `src/mcp/stdio.ts:103`, which requires `CAMPFIRE_PLAYBOOK=1` in this
  release). Live `tools/list` returned **36** names and no `get_playbook`
  (`captures/mcp/tools-list.json`, `capture-summary.json`); see `PIN.md` §8
  for the test citations.

## (f) Network behavior and write-time normalization

- Rendering and navigation perform no fetch of the referenced target:
  - The only `fetch(` in the Viewer script is the local `/api/call` read
    (`src/viewer/static/app.js:529`); `artifactSourceHtml` creates text and a
    `<code>` element only (`app.js:1259-1270`), and the source comment at
    `app.js:1263-1264` states the reference is never fetched, previewed, or
    linked.
  - Search confirming no URL-open code path for artifacts:

    ```sh
    grep -n -E 'fetch\(|window\.open|location\.href|location\.assign|location\.replace|createElement\("a"\)|\.href[[:space:]]*=' src/viewer/static/app.js
    ```

    Two matches only: line 529 (`fetch("/api/call", …)`, the local read) and
    line 615 (`els.generatedViewLink.href = …`, the GWV-001 view link).
  - Captured request lists (all three Viewer captures): only
    `http://127.0.0.1:<port>/`, `/app.css`, `/campfire-mark.svg`, `/app.js`,
    and `/api/call`; `externalTargetRequests: []` — no request to
    `example.com` or `files.example.com` while loading, selecting, and
    rendering the workspaces.
  - The shell's only anchor in the header is `#generated-view-link`
    (`src/viewer/static/index.html:22`), the GWV-001 generated-workspace view
    link whose `href` is set only from a `?view=` parameter
    (`app.js:615`); it is not an artifact control and is hidden without that
    parameter. `#sources` contains no anchor (DOM count 0, all captures).
  - Dashboard record text is drawn only as cleaned text
    (`src/cli/dashboard.ts:141-143`, `:759`); no shell command, URL open, or
    network call exists on the artifact render path (the only
    `execFileSync` use is the foreground check `ps -o tpgid=`,
    `src/cli/dashboard.ts:763-772`).
- Hostile markup and control characters stay inert:
  - Viewer: `esc()` escapes `& < > "` (`app.js:68-74`); the captured
    `#sources` HTML serializes the hostile title as
    `Report &lt;script&gt;alert(1)&lt;/script&gt;` and the hostile reference
    as `…report"&gt;&lt;img src=x onerror=alert(1)&gt;` inside `<code>`; DOM
    counts for `img, script, iframe` inside `#sources` are 0 in all captures
    (`capture-summary.json`), and the visible text still shows the raw string
    (`hostileReferenceShownAsText: true`).
  - Dashboard: the PTY frames carry the raw stored strings as plain text with
    no escape sequences (`noEscapeControls: true`).
  - CLI JSON and MCP carry the stored strings with JSON escaping only
    (captures in (d)/(e)).
- `normalizeArtifactUri` at write time (`src/domain/artifacts.ts:26-59`,
  called from `addArtifact`, `src/service/campfire-service.ts:2043, 2047`):
  a value carrying any scheme other than `file:` is stored **verbatim**
  (`artifacts.ts:13-17, 37-39`); relative paths are kept (posix separators);
  `~`-prefixed and absolute paths outside `cwd` are rejected. The function
  does not fetch, resolve, or validate the target; the stored strings for the
  seven fixture classes — including
  `ftp://files.example.com/arh-001/export.tar.gz`, the credential-bearing
  class `art_arh001_credentialed` (value in `seed.ts:202-208` and rendered
  verbatim in `served-state/context-ws_arh001_lab-ana.json`), and the
  hostile-markup value — are asserted in `seed.ts:381-400` and appear
  verbatim in every service response, CLI JSON, dashboard frame, and Viewer
  text above.

---

**Statement.** Everything above is fixture evidence observed on the frozen
v1.20.1 build with the synthetic ARH-001 fixture. It **cannot establish
external access** (no target was fetched, opened, or checked), and it contains
**no human observation** — no participant, teammate, or ordinary-work attempt
is recorded here.
