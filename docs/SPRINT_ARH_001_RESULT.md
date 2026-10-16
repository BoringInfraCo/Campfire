# Campfire — Sprint ARH-001 Result: Artifact Reference Handoff

**Date:** October 16, 2026

**Status:** **UNSCORED.** Contract §7 applies because **no eligible ordinary-work attempt has occurred** and **no candidate has been evaluated**. The §3.2 ordinary-work reference-open attempt is **NOT OBSERVED** (recorded reason below); the §6 two-human/two-harness handoff is **NOT OBSERVED**; §3.2 observed no Campfire gap because no eligible attempt occurred, so per §8.3 **no product repair was scoped and no v1.21 feature exists**. No file under `src/`, `tests/`, `scripts/`, `public/`, `migrations/`, `wrangler.toml`, or `package.json` was changed; product files remain byte-identical to published `v1.20.1`. D1–D6 are candidate checks and are not applicable without a candidate; the recorded baseline checks stand in their place. No version bump, tag, public snapshot, installer pin, release decision, or deployment is part of this result. This record does not claim human comprehension, external access, ordinary team value, or a causal gain over v1.20.1, and it moves no gate.

**Contract:** `docs/Campfire-v1.21-ARH-001-Artifact-Reference-Handoff.md`
**Evidence:** `docs/evidence/arh-001/` (baseline pin, surface facts, served state, captures, sanitized evidence plan, participant packet, scoring form, trace runbook, restricted key)
**Baseline:** published `v1.20.1`; annotated tag object `4d74b4241ef79ce5fd9c39c0185d56840902008c` at commit `dc3c2a4c1f10f7815de78c4143fe564331406c73`; package `1.20.1`; product files byte-identical at HEAD `76db5be552ee60827aea5f03d07bf124295d06ec` (pin: `docs/evidence/arh-001/baseline/PIN.md`)
**Fixture:** `fixtures/artifact-handoff/arh-001/` — deterministic seed, frozen-clock dump, surface captures (byte-identical across two fresh seeds: `diff -r` prints nothing)
**Commits:** `cec4e63` — baseline, fixture, and observation materials (local on `main`, not pushed). This result record is committed as the immediately following commit.

## 0. Verdict and what it does not claim

Contract §7 lists four dispositions. Exactly one applies, and it is the first branch of the UNSCORED condition:

- **UNSCORED — no eligible ordinary-work attempt has occurred, and no candidate has been evaluated.** §3.2 explicitly disqualifies a synthetic fixture, a fabricated URL, a scripted builder walkthrough, and an agent acting as the sole "human". §6's full handoff claim additionally requires two distinct people and two agent harnesses on one authorized workspace with their own external-system permissions. This engineering session had no real participant attempt of either kind, so both the §3.2 attempt and the §6 handoff are **NOT OBSERVED** with the reason recorded here and in `docs/evidence/arh-001/README.md`.
- **Not GO.** GO requires a real observed case meeting H1–H6, including a successful H2 on a genuinely accessible target. No case was run.
- **Not CONDITIONAL GO.** That disposition requires a real baseline attempt that identified a Campfire gap plus an amendment-authorized repair passing D1–D6. No real attempt occurred, so no gap is observed, no dated §3.3 amendment exists, and no repair was implemented. A "test fixture-only" pass cannot substitute (§3.2's classification table: "No eligible ordinary-work reference attempt occurs → Mark the observation NOT OBSERVED. Fixture preparation may continue; no product repair is justified by a fabricated attempt.").
- **Not NO-GO / REFRAME.** None of the §7 NO-GO triggers (unauthorized exposure, unsafe navigation, credential leakage, false access claim, invented relation, decision-status error, eligible post-repair H2–H4 failure, or a storage/proxy/sharing-policy/connector requirement) is recorded. The sprint stopped where the contract requires it to stop: before any product change.

**What is recorded instead (deliverables §8.1/§8.2/§8.4/§8.5):** the v1.20.1 baseline freeze; the deterministic fixture; the sanitized evidence plan; the frozen human observation materials; the NOT OBSERVED record with its reason; and this result.

**What this does not claim:** human comprehension, that any external target is reachable, ordinary team value, retention, a causal improvement over v1.20.1, or the closure of VIS-001 condition 4, SWH-001, WCO-001, ATT-001, UIX-001, or Gate B/C/E/F. Fixture behavior is engineering evidence only.

## 1. What is in the tree

**No product change.** `git diff --stat dc3c2a4 HEAD -- src public migrations wrangler.toml package.json` is empty (recorded in `baseline/PIN.md` §2). The sprint adds fixtures, evidence, and documentation only.

**Fixture and tooling (commit `cec4e63`):**

- `fixtures/artifact-handoff/arh-001/seed.ts` — deterministic scenario seed with pinned ids, fixed clock, and keyed-fact assertions before its receipt (`seed-receipt.json`, gitignored).
- `fixtures/artifact-handoff/arh-001/dump.ts` — frozen-clock actor-scoped served-state dump with hard sanitizer checks (`cft_`, `/Users/`, unrelated sentinel).
- `fixtures/artifact-handoff/arh-001/capture-dashboard.ts`, `capture-viewer.ts`, `capture-mcp.ts` — real-surface capture helpers (PTY dashboard, Playwright viewer, live MCP client).
- `fixtures/artifact-handoff/arh-001/README.md`, `.gitignore` — scenario documentation and `.tmp/` exclusion; no database or token is committed.

**Evidence (commit `cec4e63`):**

- `docs/evidence/arh-001/README.md` — index, status, consent/minimization, and what the evidence can and cannot establish.
- `docs/evidence/arh-001/EVIDENCE_PLAN.md` — sanitized retention plan (§4) and the per-attempt ledger.
- `docs/evidence/arh-001/PARTICIPANT_PACKET.md` — §3.2 recorder procedure and the frozen §6 Human B / Agent B prompts (no key facts).
- `docs/evidence/arh-001/SCORING_FORM.md` — §3.2 classification sheet; H1–H6 sheets with critical flags; diagnostics; H2–H5 second review; D1–D6 baseline matrix; §7 verdict cover sheet.
- `docs/evidence/arh-001/TRACE_RUNBOOK.md` — rehearsal commands and the eligible §3.2 / §6 real-work procedures.
- `docs/evidence/arh-001/SCENARIO_KEY.md` — restricted frozen answer key (never shown to B before scoring).
- `docs/evidence/arh-001/baseline/PIN.md`, `SURFACE_FACTS.md`, `BASELINE_CHECKS.md`, `served-state/`, `captures/{dashboard,viewer,cli,mcp}/`, `SHA256SUMS` (54 entries; `shasum -a 256 -c` passes).

**Documentation:** the contract and the referenced roadmap assessment are committed; `AGENTS.md` and `docs/ROADMAP.md` are updated to the facts actually established by this result.

## 2. Baseline freeze (§3.1)

Pinned in `docs/evidence/arh-001/baseline/PIN.md`:

- **Source:** tag `v1.20.1`, annotated tag object `4d74b42…`, commit `dc3c2a4c1f10f7815de78c4143fe564331406c73` ("Prepare v1.20.1 Shared Work Console release after the v1.20.0 hold"), package `1.20.1`; product files byte-identical to the tag at HEAD `76db5be`.
- **Viewer:** `VIEWER_READ_METHODS` is exactly five (`whoami`, `list_workspaces`, `get_workspace`, `get_workspace_context`, `get_activity`) at `src/viewer/server.ts:33-39`, mirrored in `src/worker/handler.ts:55-61`; every dispatch is gated by the allowlist and no sixth method is dispatched. The four Viewer shell files are pinned by SHA-256 and are byte-identical in `src/viewer/static/` and `public/`.
- **Surface record:** `SURFACE_FACTS.md` records, with file:line citations and real captures, how v1.20.1 renders Artifact references on the dashboard (`<id>  <type>  <uriOrPath>  stored reference, not fetched`; no artifact truncation note), the Viewer (`reference: <uri> (stored reference, not fetched)` in a `<code>` element with no anchor and no fetch, escaped), CLI JSON (`artifacts` page and `context` slice carry `uriOrPath` verbatim; `status` JSON excludes artifacts; `inspect artifact` reads one record), MCP (`get_artifact` returns the raw record), and the service (`get_workspace` unbounded artifacts; context slice budget 10 with `total`/`returned`/`truncated`/`nextCursor`).
- **Token-free chain view:** `served-state/` holds the sanitized dumps of one authorized Artifact and its actual recorded chain on the fixture lab workspace — `art_arh001_safe_output` (report) with `find_arh001_current.sourceArtifactId` and evidence relation `fev_arh001_current_supports` (`supports`), and `dec_arh001_current` citing `find_arh001_current` (`cit_arh001_current_basis`). Page counts and truncation are recorded per slice: lab artifacts 7/7 complete, current findings 3/3 and decisions 5/5 with `historicalCounts` findings 1 / decisions 1; trunc workspace artifacts 12 total / 10 returned / `truncated: true` with `nextCursor` present, keyed beyond-page artifact absent from the page. Denials (`ParticipantRequired`, `WorkspaceNotFound`, `ArtifactNotFound`) carry no titles, references, hosts, relations, or counts.
- **Source positions:** every pin fact cites its command or `file:line` in `PIN.md` / `SURFACE_FACTS.md`; captures record their method (`pty`, real Chromium, live MCP client).

## 3. Fixture and frozen materials (§3.1/§8.1)

The deterministic fixture covers the contract's §3.1 case set: two authorized humans (`hum_arh001_ana` owner, `hum_arh001_ben` member) with **separately owned agents on different harnesses** (`agt_arh001_opencode` for Ana, harness `opencode`; `agt_arh001_codex` for Ben, harness `codex`); one **unauthorized actor** (`hum_arh001_zed`, member only of `ws_arh001_unrelated`, sentinel `UNRELATED_FINDING_SENTINEL_arh001_do_not_leak`); one **safe HTTPS reference** (`art_arh001_safe_output`), a similar historical draft (`art_arh001_safe_old_report`), one **stale/denied class** target (`art_arh001_stale`), one **inert path** (`reports/arh-001/working-notes.md`), one non-HTTPS scheme (`ftp://…`), one credentialed reference (`https://arh001-demo-user:arh001-demo-pass@example.com/…`, a demo string, not a secret), one hostile-markup reference, and **competing plus historical decision context** (two competing accepted decisions; a superseded/replacement chain `dec_arh001_old` → `dec_arh001_new`; one accepted decision with read-time `needsReview` citing a superseded finding).

Determinism is proven, not asserted: two fresh seeds produce byte-identical dumps (`diff -r` prints nothing; the two receipts differ only in their recorded database path), with a frozen seed clock `2026-10-16T16:00:00.000Z` (+1 s per write) and frozen read clock `2026-10-16T18:00:00.000Z`. The key (`SCENARIO_KEY.md`) freezes the exact ids and expected facts before any evaluation; the participant packet contains no key facts; the evidence plan states what may and may not be retained.

Sanitization: no token value or hash, no `/Users/` path, and no unrelated-workspace sentinel appears in the committed evidence (the sentinel appears only inside the documented sanitizer rules and the key's description of the boundary); `SHA256SUMS` verifies 54/54.

**Fixture behavior is engineering evidence only.** The fixture's `example.com` targets are synthetic; the fixture never asserts or proves external existence, access, or denial for any target.

## 4. Baseline checks (§5)

With no candidate, contract §5 asks for baseline checks only, and no tests were written to mirror unchanged labels:

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean (exit 0) |
| `npm test` (full suite) | **93 files passed / 1126 tests passed + 1 skipped** (1127 collected; the skip is the opt-in terminal-evidence capture test) |
| `npm run build` | clean; `git status` unchanged; `public/` byte-identical to `src/viewer/static/` for all four shell files (`SYNC_OK` ×4) |
| Fixture determinism | two fresh seeds + dumps byte-identical (`diff -r` empty); committed `served-state/` re-diffs clean |
| Real captures | 3 dashboard PTY frames (`campfire dashboard` at 120×36 and 80×24; trunc workspace at 120×36), 3 actor-bound Viewer captures (1440×900 PNG + text; zero requests to any external target), 5 CLI JSON captures, live MCP capture (36 tools; `get_artifact`, `list_artifacts`) |
| `pack:tarball` / `deploy:dry-run` | deliberately **not run**: there is no release-shaped candidate |

Recorded observation in the captures, not a defect claim: at 80×24 the dashboard's row-fitting policy drops rank-1 chrome lines before rank-0 records, so the `ARTIFACT REFERENCES` section title is not drawn while the artifact record lines with `stored reference, not fetched` still render; both 120×36 frames show the full section.

## 5. Human observation (§3.2 and §6)

**NOT OBSERVED.** Recorded reason: this session was engineering work with no real participant attempt. §3.2's attempt requires an existing ordinary-work task and an actual externally stored output that a participant has reason to inspect; it explicitly does not qualify a synthetic fixture, a fabricated URL, a scripted builder walkthrough, or an agent acting as the sole "human". §6's full handoff requires two distinct people and two different agent harnesses, at least one of whom did not build the candidate, and forbids substituting agents or the builder. No such participant run occurred before this record, and nothing was substituted to fill the slot.

**Dated addendum (2026-10-16, later UTC) — attempted execution found no eligible attempt subject.** The founder then directed running the attempt immediately, with the sprint agent itself as the participant, orchestrating through subagents under the frozen runbook's recorder-first protocol. A recorder subagent session, working only from the frozen rules, performed the §2 preflight before any participant instruction was issued (read-only Campfire reads; no workspace record written): the live `campfire-self-build` workspace has exactly two open tasks and both are protocol-exercise tasks — one is this attempt task itself, the other the WCO-001 two-human case — so **no pending task's stored context depends on an actual externally stored output**. The only external references recorded in that workspace (the published GitHub Release v1.20.1 page and the production Worker deployment record) belong to findings of completed work, not to open work. The recorder's verdict was **NO-ELIGIBLE-EXISTING-TARGET**; no participant instruction was issued, no target was resolved, verified, or opened, and the preflight key was sealed uncommitted in the session's private scratch (it contains no attempt content). This preflight is itself not an attempt and not an observation. Consequence: an eligible §3.2 attempt cannot run now without manufacturing an external-facing task or borrowing a completed work's reference — both are fabricated attempts and forbidden (runbook §2 step 6, §6 prohibitions). Recorded for the future run: the attempt task stays open unchanged; eligibility needs (a) a real, pre-existing ordinary-work task whose completion requires opening an external output, and (b) — because §3.2 qualifies only a real human's attempt and runbook §6 forbids agent-as-human substitution — a human participant (the owner can count, with role and prompting disclosed); a sprint agent can only ever run a labeled rehearsal.

Frozen for the future attempt (all committed with this result):

- `TRACE_RUNBOOK.md` — the eligible §3.2 procedure (real ordinary work; recorder identifies the records, source position, external system, expected access boundary, and a checkable safe next step; preflight verifies the target exists; the recipient gets only their own normal credentials and tools and is **not** directed to the Artifact ID, external URL, or preferred action; denied attempts are preserved as denied) and the eligible §6 procedure (frozen records before B begins; first interpretation retained before any hint; score before debrief; second reviewer for H2–H5 against the pre-run key).
- `PARTICIPANT_PACKET.md` — the §3.2 recorder checklist and the frozen §6 Human B / Agent B prompts (no artifact ids, no URLs, no preferred action).
- `SCORING_FORM.md` — the §3.2 failure-classification sheet and the H1–H6 items with their critical flags, diagnostics, and the §7 verdict cover sheet.
- `SCENARIO_KEY.md` — the restricted key for the fixture; never shown to a participant before scoring.

A fixture-only run with participants is a rehearsal, not an eligible observation. One real human's attempt is enough to classify the access/navigation gap for §3.2 (the owner can count when doing ordinary work, with their role disclosed); the §6 full-handoff claim needs the two-human/two-harness pair.

## 6. Independent verification

A second, independent verification pass checked the committed evidence at `cec4e63` without trusting the authors': fixture determinism re-run from scratch, the baseline pin re-derived from the tag, every `SHA256SUMS` entry re-hashed, sanitization re-scanned, the restricted key cross-checked field-by-field against the fixture receipt and all served-state dumps, the participant materials re-scanned for key facts, the D1/D2 authorization and recorded-chain facts re-read from the dumps, the full suite re-run, and the no-product-change claim re-diffed. The full record, including the resolution addendum, is `docs/evidence/arh-001/VERIFICATION.md`.

### 6.1 Verification record

| Verification | Result |
| --- | --- |
| Commit inventory | 69 files: the fixture, evidence, the v1.21 contract and roadmap assessment, plus the `AGENTS.md`/`docs/ROADMAP.md` proposal updates; no product path; no `.tmp/` content committed |
| No product change | `git diff` over `src public tests scripts migrations wrangler.toml package.json` empty from tag `dc3c2a4` to `cec4e63` and to HEAD |
| Pin re-derivation | tag object `4d74b42…` → commit `dc3c2a4…`, package `1.20.1`; four Viewer shell hashes identical in `src/viewer/static/` and `public/`; exactly five `VIEWER_READ_METHODS`, no sixth dispatch |
| Determinism | two fresh seeds' dumps byte-identical (`diff -r` empty); a fresh dump byte-identical to the committed `served-state/` |
| Hashes | `shasum -a 256 -c SHA256SUMS` — 54 OK, 0 FAILED (re-verified after the correction below) |
| Sanitization | no token material, unrelated-workspace content, home path, or credential material in the committed evidence |
| Key cross-check | every id, order, `uriOrPath` string, relation, decision state, `needsReview` decoration, `historicalCounts`, denial message, and attention row in `SCENARIO_KEY.md` matches the receipt and dumps |
| Materials leak scan | zero restricted key facts in the participant-facing prompt blocks |
| Scoring form vs contract | §7 verdicts and H1–H6 critical flags match the contract text |
| Full suite (re-run) | 93 files / 1126 passed + 1 skipped (the skip is the opt-in terminal-evidence capture test) |
| 80×24 observation | holds: chrome title absent, artifact record lines with `stored reference, not fetched` present |
| Status/roadmap edits | no overclaim beyond the recorded facts |
| Boundary claims | no human observation, external access, gate movement, VIS-001 condition 4 closure, product change, or release/deployment implied |

Discrepancies found and resolved before this record's commit:

1. **Low — `baseline/SURFACE_FACTS.md`** claimed the substring `artifact` occurs "exactly once" in the captured status JSON; it occurs twice (workspace name and goal title). Corrected; `SHA256SUMS` regenerated and re-verified 54/54.
2. **Low — this record (§3)** said two fresh seeds produce byte-identical "receipts and dumps"; corrected to byte-identical dumps (the two receipts differ only in their recorded database path).
3. **Info — this header's** "committed as the immediately following commit" was prospective at verification time; it is true upon this commit.
4. **Info — this section** was completed from the verification record after the pass.

Verifier scope limits: `npm run build` and the PTY/Playwright captures were not re-executed (outside the verifier's write scope); build outputs and captures were verified at rest by `cmp`, hash, and content plus each capture's recorded method (`pty`, real Chromium, live MCP client). The "pack:tarball / deploy:dry-run not run" claim is consistent with the tree state (no new tag; package still `1.20.1`). After resolution the verifier recorded: all checked claims reproduce; the evidence at this commit is consistent.

## 7. Deviations, limitations, and notes

- **No human attempt and no candidate** (§0, §5): the sprint's central question is unmeasured by design, not by failure. The verdict is the contract's UNSCORED disposition.
- **Fixture-only evidence**: synthetic targets; external access is never asserted. No network request to any fixture target was made or recorded by any capture.
- **80×24 dashboard frame** (§4): section chrome title dropped by the existing fit policy while record lines render.
- **Dashboard inspect view** for an artifact row is code-cited (`src/cli/dashboard.ts:554-566`), not PTY-captured; the three frames use the default selection.
- **Fixture scripts are outside `tsconfig` include** (existing repository policy, same as the ATT-001 fixture): an equivalent strict ad-hoc typecheck of the capture scripts is recorded in `BASELINE_CHECKS.md`.
- **Capture scripts carry defensive check literals** (`cft_`, `/Users/`, the sentinel) as check inputs only, mirroring `dump.ts`; no actual token, home path, or unrelated content is present in the evidence.
- **Baseline worktree context**: the capture working tree carried the pre-existing uncommitted doc edits that are now part of commit `cec4e63`; product files were and remain byte-identical to the tag.
- **Single machine**: all evidence was produced on the repository machine; the fixture requests no live harness credentials.
- **A pin is not an observation**: nothing in `baseline/` is a human result or a verdict.

## 8. Open gates and next steps

- **Run the §3.2 attempt on real ordinary work** with `TRACE_RUNBOOK.md` and classify with `SCORING_FORM.md`. Only an observed attempt can justify a gap classification; if it identifies a Campfire gap, append the dated §3.3 amendment **before** implementing anything — default candidate is clearer inspection of the stored reference and its recorded evidence trail; a deliberate external-open control is eligible only for a reference class the observation supports (absolute HTTPS, destination host shown, user gesture, no opener/referrer propagation; other schemes, paths, credentials, and hostile markup stay inert; no server fetch, proxy, preview, or automatic navigation).
- **Then run the §6 two-human/two-harness handoff** as a fresh case with the second reviewer; preserve any earlier failed attempt; a later voluntary return is logged under Gate B rules and never supplied by an instructed return.
- **VIS-001 condition 4** is decided under VIS-001's own rule if an actual attempt is later reviewed against it; ARH-001 does not declare it met.
- **WCO-001, ATT-001, SWH-001, UIX-001 observations and Gate B/C/E/F** remain open and untouched; this sprint rescores nothing.
- **No release decision is requested.** A package bump, tag, public snapshot, installer pins, or deployment require a separate release decision after a result is recorded; an override cannot turn NOT OBSERVED or FAIL into PASS.
- Update roadmap/AGENTS only for facts actually established — this result records those facts and nothing more.
