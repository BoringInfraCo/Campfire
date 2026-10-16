# ARH-001 baseline pin — Campfire v1.20.1

**FIXTURE / ENGINEERING EVIDENCE — cannot establish Gate B, C, or E.**
This pin freezes the machine-checkable facts of the published v1.20.1 source used
as the ARH-001 baseline (`docs/Campfire-v1.21-ARH-001-Artifact-Reference-Handoff.md`
§3.1, deliverable §8.1). It is a baseline record only.

**This pin is not a user observation, not a verdict, and not a GO.** No product
change, no candidate evaluation, and no human observation is recorded here. The
fixture (see `SURFACE_FACTS.md` and `served-state/`) is synthetic.

---

## 1. Pin summary

| Fact | Value | How verified |
| --- | --- | --- |
| Source tag | `v1.20.1` (annotated) | `git rev-parse v1.20.1` → `4d74b4241ef79ce5fd9c39c0185d56840902008c`; `git cat-file -t v1.20.1` → `tag` |
| Annotated tag object | `4d74b4241ef79ce5fd9c39c0185d56840902008c` | `git rev-parse v1.20.1^{tag}` |
| Tagged commit | `dc3c2a4c1f10f7815de78c4143fe564331406c73` | `git rev-parse v1.20.1^{commit}` |
| Commit subject | `Prepare v1.20.1 Shared Work Console release after the v1.20.0 hold` | `git log -1 --format='%H %s' v1.20.1^{commit}` |
| Tag message subject | `Campfire v1.20.1 — Shared Work Console` | `git cat-file tag v1.20.1` |
| Package version | `1.20.1` | `node -p "require('./package.json').version"` (package.json:3) |
| HEAD at capture | `76db5be552ee60827aea5f03d07bf124295d06ec` — `Record v1.20.1 publication and deployment` | `git rev-parse HEAD`; `git log -1 --format='%H %s' HEAD` |
| Product files vs tag commit | byte-identical (empty diff) | see §2 |

## 2. Product-file byte identity (`dc3c2a4` vs HEAD `76db5be`)

Exact command:

```sh
git diff --stat dc3c2a4 HEAD -- src public migrations wrangler.toml package.json
```

Result: **empty output, exit status 0** — no product file differs between the
tagged v1.20.1 commit and the capture HEAD. The unbounded diff is non-product
only:

```sh
git diff --stat dc3c2a4 HEAD
```

```
 AGENTS.md                        |  4 +++-
 docs/RELEASE_V1_20_1_DECISION.md | 12 ++++++------
 docs/ROADMAP.md                  |  4 ++--
 docs/SPRINT_UIX_001_RESULT.md    |  2 +-
 flake.nix                        | 10 +++++-----
 packaging/homebrew/campfire.rb   | 16 ++++++++--------
 6 files changed, 25 insertions(+), 23 deletions(-)
```

## 3. Working tree at capture

`git status --porcelain` at the start of this capture run:

```
 M AGENTS.md
 M docs/ROADMAP.md
?? docs/Campfire-v1.21-ARH-001-Artifact-Reference-Handoff.md
?? docs/GUILLERMO_RAUCH_INTERVIEW_ROADMAP_ASSESSMENT.md
?? fixtures/artifact-handoff/
```

The two modified files and the untracked contract/assessment docs predate this
task. This baseline task adds (untracked; nothing is committed):

```
?? fixtures/artifact-handoff/arh-001/capture-dashboard.ts
?? fixtures/artifact-handoff/arh-001/capture-viewer.ts
?? docs/evidence/arh-001/baseline/
```

## 4. Frozen clocks (fixture)

| Clock | Value | Source |
| --- | --- | --- |
| Seed base | `2026-10-16T16:00:00.000Z`, +1000 ms per write | `fixtures/artifact-handoff/arh-001/seed.ts` (`SEED_BASE_ISO`, `CLOCK_STEP_MS`) |
| Served read clock | `2026-10-16T18:00:00.000Z` | `seed.ts` (`SERVED_AT`), used by `dump.ts` (`createCampfireService({ store, clock: () => SERVED_AT })`) |

The PTY dashboard frames carry a wall-clock `refreshed <timestamp>` drawn by
the running command (real clock by design); every fixture record timestamp in
the dumps is frozen as above.

## 5. Determinism proof (fresh seed + dump, byte-compare)

```sh
npx tsx fixtures/artifact-handoff/arh-001/seed.ts --out fixtures/artifact-handoff/arh-001/.tmp/run-a --force
npx tsx fixtures/artifact-handoff/arh-001/seed.ts --out fixtures/artifact-handoff/arh-001/.tmp/run-b --force
npx tsx fixtures/artifact-handoff/arh-001/dump.ts \
  --db fixtures/artifact-handoff/arh-001/.tmp/run-a/campfire.db \
  --tokens fixtures/artifact-handoff/arh-001/.tmp/run-a/tokens.json \
  --out fixtures/artifact-handoff/arh-001/.tmp/run-a/dump
npx tsx fixtures/artifact-handoff/arh-001/dump.ts \
  --db fixtures/artifact-handoff/arh-001/.tmp/run-b/campfire.db \
  --tokens fixtures/artifact-handoff/arh-001/.tmp/run-b/tokens.json \
  --out fixtures/artifact-handoff/arh-001/.tmp/run-b/dump
diff -r fixtures/artifact-handoff/arh-001/.tmp/run-a/dump fixtures/artifact-handoff/arh-001/.tmp/run-b/dump
```

Result: the `diff -r` printed **nothing** and exited 0 — two fresh seeds produce
byte-identical dumps. A third fresh seed (`--out .../.tmp/served`) and its dump
were compared the same way against `run-a` and are byte-identical; the committed
`served-state/` is a copy of that `served` dump (copy included no edits; the
copied files re-hash to the same sha256 as the originals).

Frozen object ids used throughout: `ws_arh001_lab`, `ws_arh001_trunc_artifacts`,
`ws_arh001_unrelated` (never dumped), `art_arh001_safe_output`,
`find_arh001_current`, `fev_arh001_current_supports` (`supports`),
`dec_arh001_current`, `cit_arh001_current_basis` — see
`fixtures/artifact-handoff/arh-001/seed.ts` (`SCENARIO`) and
`served-state/dump-summary.json`.

## 6. Viewer shell hashes (re-derived)

Re-derived on 2026-10-16 from the capture working tree with `shasum -a 256`.
Because product files are byte-identical between `dc3c2a4` and HEAD (§2), these
are also the tagged v1.20.1 hashes.

| File | sha256 (`src/viewer/static/`) | sha256 (`public/`) | `cmp` |
| --- | --- | --- | --- |
| `index.html` | `26020d2114fef88d60267d632f832a12ce9ea1e5f8248a057bf2bcad92a1ab2d` | same | IDENTICAL |
| `app.css` | `0a08544257261939b8c62bc63a118469af1ccd7bf2bd844f9fbbc21f7b178caa` | same | IDENTICAL |
| `app.js` | `fa7684fd9ee7779dca212377de058f0d3542ad147a227fb6f51c8c177a8bbe97` | same | IDENTICAL |
| `campfire-mark.svg` | `a845ec975a6f58a5e9583d157445849a6900fd53cda0965cf5e21c94af44f311` | same | IDENTICAL |

Proof commands:

```sh
shasum -a 256 src/viewer/static/index.html src/viewer/static/app.css src/viewer/static/app.js src/viewer/static/campfire-mark.svg
for f in index.html app.css app.js campfire-mark.svg; do cmp src/viewer/static/$f public/$f && echo "$f: IDENTICAL"; done
```

Each `cmp` exited 0 (no output) and echoed `IDENTICAL`.

## 7. Viewer read-method allowlist — five, with no sixth dispatch

`VIEWER_READ_METHODS` (`src/viewer/server.ts:33-39`) and the Worker mirror
(`src/worker/handler.ts:55-61`, duplicated there so the worker bundle does not
import `node:http`/`node:fs`) are both exactly:

```
whoami, list_workspaces, get_workspace, get_workspace_context, get_activity
```

Admission evidence:

- The set is built from the array (`src/viewer/server.ts:43`) and every
  `/api/call` method is rejected unless `isViewerReadMethod(method)` is true
  (`src/viewer/server.ts:376-379` → `403 Unauthorized "Viewer is read-only"`;
  `src/worker/handler.ts:593, 625, 653, 679`).
- No sixth read method is dispatched anywhere in either server; both allowlists
  contain the same five literal names and the only admission check for
  `/api/call` is membership in that five-name set.

Search that confirms there is no other dispatch table:

```sh
grep -n "VIEWER_READ_METHODS\|VIEWER_READ_METHOD_SET\|VIEWER_READ_SET\|isViewerReadMethod" src/viewer/server.ts src/worker/handler.ts
```

## 8. MCP tool count

- **36 unconditional tools** registered in `src/mcp/tools.ts` (37
  `server.registerTool(` call sites, one of which is gated). Re-derived live:
  a real in-process `tools/list` returned 36 names and no `get_playbook`
  (`docs/evidence/arh-001/baseline/captures/mcp/tools-list.json`).
- `get_playbook` is the single opt-in tool, registered only when
  `options.playbookEnabled === true` (`src/mcp/tools.ts:706-716`), enabled by
  `playbookEnabled(env, argv)` (`src/mcp/stdio.ts:103`; requires
  `CAMPFIRE_PLAYBOOK=1` in this release).
- Asserted by tests: `tests/integration/att-001.test.ts:848`
  (`expect(names).toHaveLength(36)` on the default server) and
  `tests/unit/wow-001-mcp.test.ts:137-139` (default list excludes
  `get_playbook`; enabling adds exactly that one name).
- Artifact tools: `list_artifacts` (`src/mcp/tools.ts:372-384`) and
  `get_artifact` (`src/mcp/tools.ts:413-420`).

## 9. Exact commands to re-derive every pin fact

```sh
# Tag facts
git rev-parse HEAD
git rev-parse v1.20.1
git rev-parse v1.20.1^{tag}
git rev-parse v1.20.1^{commit}
git log -1 --format='%H %s' v1.20.1^{commit}
git cat-file tag v1.20.1
node -p "require('./package.json').version"

# Product-file byte identity (must print nothing)
git diff --stat dc3c2a4 HEAD -- src public migrations wrangler.toml package.json

# Viewer shell hashes + public sync proof
shasum -a 256 src/viewer/static/index.html src/viewer/static/app.css src/viewer/static/app.js src/viewer/static/campfire-mark.svg
for f in index.html app.css app.js campfire-mark.svg; do cmp src/viewer/static/$f public/$f; done

# Read-method allowlist + no sixth dispatch
grep -n "VIEWER_READ_METHODS" src/viewer/server.ts src/worker/handler.ts
grep -n "isViewerReadMethod" src/viewer/server.ts src/worker/handler.ts

# MCP tool count
grep -c "server.registerTool(" src/mcp/tools.ts
sed -n '706,716p' src/mcp/tools.ts

# Fixture determinism (see §5 for the full sequence)
diff -r fixtures/artifact-handoff/arh-001/.tmp/run-a/dump fixtures/artifact-handoff/arh-001/.tmp/run-b/dump

# Live MCP count and artifact reads (see SURFACE_FACTS.md (e))
CAMPFIRE_TELEMETRY=0 npx tsx fixtures/artifact-handoff/arh-001/capture-mcp.ts \
  --db fixtures/artifact-handoff/arh-001/.tmp/served/campfire.db \
  --out docs/evidence/arh-001/baseline/captures/mcp
```

## 10. Statement

This pin records engineering facts about an existing published source tag and a
synthetic fixture. It is **not a user observation, not a finding about
usability or external access, not a verdict, and not a GO**. It cannot
establish Gate B, C, or E, and it does not evaluate any candidate behavior.
`served-state/` and `captures/` are fixture evidence with the labels stated in
each file and in `SURFACE_FACTS.md`.
