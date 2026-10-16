# ARH-001 independent verification record

**Scope and method.** Independent re-derivation of the ARH-001 evidence committed at `cec4e63`
and of the uncommitted result record `docs/SPRINT_ARH_001_RESULT.md`, `AGENTS.md`, and
`docs/ROADMAP.md`, without trusting author reports. All commands were run from the repository
root on the repository machine (macOS) on October 16, 2026. The verifier re-seeded and re-dumped
the fixture from scratch, re-derived every pin fact from the tag, re-hashed every listed file,
re-scanned for leaks, cross-checked the restricted key field-by-field against the dumps, and
re-ran the full test suite. This file is the only artifact written by the verifier; no product
code, fixture file, evidence file, or existing document was modified. `git status --porcelain`
after all runs still shows only ` M AGENTS.md`, ` M docs/ROADMAP.md`, `?? docs/SPRINT_ARH_001_RESULT.md`
(plus this file). `fixtures/artifact-handoff/arh-001/.tmp/verify-a/` and `.tmp/verify-b/` were
created as instructed (gitignored; `.tmp/` is excluded by `fixtures/artifact-handoff/arh-001/.gitignore`).

## 1. Results by verification task

| # | Task | Result | Key commands / observed |
| --- | --- | --- | --- |
| 1 | Commit inventory | **PASS** | `git show --stat cec4e63` → 69 files, +22053/−10: `docs/evidence/arh-001/**`, `fixtures/artifact-handoff/arh-001/**`, `docs/Campfire-v1.21-ARH-001-Artifact-Reference-Handoff.md`, `docs/GUILLERMO_RAUCH_INTERVIEW_ROADMAP_ASSESSMENT.md`, `AGENTS.md` (M), `docs/ROADMAP.md` (M). `git show --name-only cec4e63 \| grep -E '^(src/\|tests/\|scripts/\|public/\|migrations/\|wrangler.toml\|package.json)'` → no match. `git ls-tree -r --name-only cec4e63 \| grep -i tmp` → no match; `git ls-files fixtures/artifact-handoff \| grep -c tmp` → 0. `git status --porcelain` → exactly the three expected entries. No `.tmp/` content committed. |
| 2 | No product change | **PASS** | `git diff --stat dc3c2a4 cec4e63 -- src tests scripts public migrations wrangler.toml package.json` → empty; same for `dc3c2a4 HEAD` and for working tree vs HEAD; `git status --porcelain -- <product paths>` → empty. Also `git diff --stat dc3c2a4 76db5be` (product paths) → empty. Current `package.json` version remains `1.20.1`; no `v1.21*` tag exists (top tag: `v1.20.1`). |
| 3 | Baseline pin re-derivation | **PASS (one minor doc inaccuracy, D1)** | `git rev-parse v1.20.1^{tag}` → `4d74b4241ef79ce5fd9c39c0185d56840902008c`; `^{commit}` → `dc3c2a4c1f10f7815de78c4143fe564331406c73`; subject `Prepare v1.20.1 Shared Work Console release after the v1.20.0 hold`; tag message `Campfire v1.20.1 — Shared Work Console`; package at tag `1.20.1`. `76db5be…` = `HEAD^` (`Record v1.20.1 publication and deployment`). Four Viewer shell SHA-256 hashes match `PIN.md` §6 exactly and `cmp` reports IDENTICAL for all four against `public/`. `VIEWER_READ_METHODS` is exactly the five names in `src/viewer/server.ts:33-39` and the mirror at `src/worker/handler.ts:55-61`; admission gates at `server.ts:376` and `handler.ts:593,625,653,679`; no sixth dispatch found. Spot checks (7): dashboard line format `<id>  <type>  <uriOrPath>  stored reference, not fetched` ✓ (source `dashboard.ts:589-602`, `work-console.ts:44`; capture line 11); Viewer render string ✓ (`app.js:1259-1270`; capture text); trunc workspace 12/10/truncated/nextCursor ✓ (dump-summary, context, capture; exact cursor string matches); **status JSON `artifact` count ✗ — D1** (no artifacts field/count holds); MCP tool count 36, no `get_playbook`, 37 `registerTool` sites ✓; product-identity diffs ✓; lab 7-artifact ids/order/metadata and `get_workspace`/`context-assembly.ts:90` citations ✓. |
| 4 | Fixture determinism (fresh, from scratch) | **PASS** | `npx tsx fixtures/artifact-handoff/arh-001/seed.ts --out .../.tmp/verify-a --force` (and `verify-b`), then `dump.ts --db <dir>/campfire.db --tokens <dir>/tokens.json --out <dir>/dump` for both. `diff -r verify-a/dump verify-b/dump` → no output, exit 0. `diff -r verify-a/dump docs/evidence/arh-001/baseline/served-state` → no output, exit 0: the fresh dump is **byte-identical** to the committed `served-state/` (19 files each; frozen `SERVED_AT` 2026-10-16T18:00:00.000Z, so no read-clock differences). Raw tokens differ per run as documented and never enter the dumps. |
| 5 | Hashes | **PASS** | `shasum -a 256 -c docs/evidence/arh-001/baseline/SHA256SUMS` → **54 OK, 0 FAILED** (56 lines = 2 comment lines + 54 entries). Five files re-hashed independently (`trunc-ana-120x36.txt`, `whoami-ben.json`, `tools-list.json`, `viewer-ws_arh001_trunc_artifacts-ana.png`, `capture-viewer.ts`) → all match the listed digests. |
| 6 | Sanitization | **PASS** | `git grep` over tracked evidence/fixture sources: `cft_` appears only as rule mentions (`EVIDENCE_PLAN.md:103`, `TRACE_RUNBOOK.md:84`, `README.md:147,160`) and check constants (`capture-dashboard.ts:40,434`, `dump.ts:58`) — no token values. `/Users/` appears only in rule mentions (`TRACE_RUNBOOK.md:85`, `README.md:148,160`) and constants (`capture-dashboard.ts:435`, `dump.ts:59`); all other occurrences are in gitignored `.tmp/`. The sentinel appears only in docs/key text (`EVIDENCE_PLAN.md:103`, `SCENARIO_KEY.md:177`, `TRACE_RUNBOOK.md:86`, `README.md:22`) and code constants (`capture-dashboard.ts:436`, `seed.ts:70`) — never in `served-state/` or `captures/`. No credential-shaped strings (`AKIA`, `PRIVATE KEY`, `ghp_`, `sk-` → none). `served-state/` and `captures/` contain no token, no unrelated-workspace content (only the by-design caller-id/workspace-id echo in `denials.json` for the documented denial case), and no external content (`externalTargetRequests: []` in all three Viewer captures; network requests only `127.0.0.1` + `/api/call`). |
| 7 | Key cross-check | **PASS** | Every field of `SCENARIO_KEY.md` matches `dump-summary.json` and the dumped JSONs — see §3. No mismatch found. |
| 8 | Materials leak check | **PASS** | `PARTICIPANT_PACKET.md`: grep for ids (`art_/find_/dec_/task_/ws_/hum_/agt_/fev_/cit_/goal_arh001`), `example.com`, `http(s)://`, `ftp:`, sentinel, and page counts → **0 matches**. The two participant-facing prompt blocks (lines 71, 77) contain only the `⟨workspace⟩` placeholder. `SCORING_FORM.md` H1–H6 critical marks match the contract exactly (H2–H4 bold; H1/H5/H6 plain); the four §8 verdict bullets are byte-identical to contract §7 (programmatic comparison: 4/4 IDENTICAL). |
| 9 | Result record accuracy | **PASS (with D2–D4, minor/drafting-state)** | `cec4e63b3314677f1df4441e15c2291399bb4511` exists with the described content ("local on main, not pushed": `origin/main` is `76db5be`; `cec4e63` is not an ancestor). Tag/package/viewer facts ✓. `npm test` re-run: **Test Files 93 passed (93); Tests 1126 passed \| 1 skipped (1127)**, duration 44.57 s; the skip is the opt-in capture test `tests/unit/uix-001-dashboard-pty.test.ts:328` (`it.skipIf(!CAPTURE_ENABLED)`) — the only skip. `npm run typecheck` exit 0; the ad-hoc strict typecheck of the three capture scripts (BASELINE_CHECKS §1) reproduces exit 0. SHA256SUMS 54 ✓. Captures exist as described: 3 dashboard `method: "pty"` frames, 3 actor-bound Playwright Viewer captures (1440×900, recorded checks, `externalTargetRequests: []`), 5 CLI JSON captures, live in-process MCP capture (`toolCount: 36`). CLI `context` capture equals the served dump except `generatedAt` (real read clock) ✓. MCP `get_artifact`/`list_artifacts` captures equal the served records/page ✓. 80×24 observation ✓: `ARTIFACT REFERENCES` absent (`sectionTitleDrawn: false`); artifact record lines with `stored reference, not fetched` present (lines 8–22); `art_arh001_safe_old_report` outside the cut; both 120×36 frames show the title. `AGENTS.md`/`docs/ROADMAP.md` ARH-001 edits state only established facts (frozen in `cec4e63`, UNSCORED, both observations NOT OBSERVED, no product change / no release decision) — no overclaim. Discrepancies: D2 (line 63 "byte-identical receipts"), D3 (line 11 tense), D4 (§6.1 placeholder). Build: re-verified equivalently (`cmp` IDENTICAL ×4; SHA-256 equals `PIN.md` §6) — the build itself was not re-executed by the verifier to avoid writes. |
| 10 | Boundary claims | **PASS** | The result claims none of: human observation, external access, gate movement, VIS-001 condition 4 closure, product change; and implies no release decision or deployment. `AGENTS.md`/`ROADMAP.md` edits are consistent with the same boundary. |

## 2. Discrepancies found

| # | Severity | Location | What is inaccurate | Corrected fact |
| --- | --- | --- | --- | --- |
| D1 | **Low** | `docs/evidence/arh-001/baseline/SURFACE_FACTS.md:214-216` | "In the captured status JSON the substring `artifact` occurs exactly once — inside the fixture workspace name … — and nowhere as a data field." | It occurs **twice**: in `workspace.name` (`ARH-001 artifact handoff lab`, offset 105) and in `goal.title` (`Hand the recorded Q3 artifact reference chain to a second teammate and their agent.`, offset 211). Both are fixture content values; the load-bearing claim — `campfire status` JSON has no `artifacts` field or count (keys: `version, kind, state, workspace, goal, participants, work, decisions, attention, activity`) — is true. |
| D2 | **Low** | `docs/SPRINT_ARH_001_RESULT.md:63` | "two fresh seeds produce byte-identical receipts and dumps (`diff -r` prints nothing)". | The **dumps** are byte-identical (verified). The `seed-receipt.json` files of two fresh seeds in different output directories differ in exactly one field — `databasePath` (each receipt records its own output path) — and `tokens.json` differs by design (random tokens, gitignored, never in dumps). `PIN.md` §5 and the fixture README claim only byte-identical dumps; the result record's "receipts" overstates it. |
| D3 | **Info** | `docs/SPRINT_ARH_001_RESULT.md:11` | "This result record is committed as the immediately following commit." (present tense) | As of verification the record is untracked/uncommitted. The statement becomes true only at the planned follow-up commit; it is a prospective statement written in the present tense. |
| D4 | **Info** | `docs/SPRINT_ARH_001_RESULT.md:99, 103` | §6 says the verification results "are in §6.1 below"; §6.1 is an empty placeholder. | The independent verification record is this file (`VERIFICATION.md`); the result record's §6.1 defers to "the result-record commit for the verified revision", which is still pending. |

No discrepancy was found in any committed baseline fact, fixture byte, hash, capture, key
field, sanitization guarantee, or suite count. D1–D4 do not affect any load-bearing claim.

## 3. Key cross-check (`SCENARIO_KEY.md` vs `dump-summary.json` + dumps)

All fields matched; no mismatch found. Verified in full:

- **Actors/workspaces/sessions (§1–§2):** participants (`hum_arh001_ana` owner, `hum_arh001_ben`
  member, `agt_arh001_codex` harness `codex` owner Ben, `agt_arh001_opencode` harness `opencode`
  owner Ana); workspace ids/names; `ses_arh001_opencode`/`ses_arh001_codex` carried as
  `agentSessionId` on the agent-authored findings/evidence; goal title exact.
- **Page coverage (§3.1):** artifacts 7/7, tasks 6/6, findings 3/3, decisions 5/5, no
  `nextCursor`; `historicalCounts = {findings: 1, decisions: 1}`; `supersededDecisions: []`
  (0 replayed).
- **Artifact page (§3.2–§3.4):** exact order; all seven `type`/`title`/`uriOrPath` strings
  byte-for-byte (including the credentialed, `ftp:`, relative-path, and hostile-markup
  classes); `metadata` on `art_arh001_safe_output` and `art_arh001_stale` only.
- **Recorded chain (§4):** findings slice order; creators with session provenance;
  `sourceArtifactId` on `find_arh001_current`; evidence rows
  `fev_arh001_current_supports` (`supports`) and `fev_arh001_contradicts_stale`
  (`contradicts`) with exact ids/relations; superseded finding text, successor, and
  correction reason; citations `cit_arh001_current_basis` and `cit_arh001_review_basis`
  with notes.
- **Decision lifecycle (§5):** served order `[new, competing_b, competing_a, review, current]`;
  `needsReview` + `needsReviewFindingIds` on `dec_arh001_review`; `dec_arh001_old` superseded
  with `successorId` and supersede reason; `dec_arh001_new` with `predecessorId`; competing
  pair both accepted with no transition.
- **Tasks and attention (§6):** page order and statuses/assignees/titles; per-actor
  `needsYou`/`needsAttention`/`suggestedNextAction` rows for `ana`, `ben`, `opencode`, `codex`
  all match the table (including the codex `assigned_open_task` row and the review cues).
- **Truncation workspace (§7):** 12/10/truncated/`nextCursor`; returned page
  `[trunc_linked, filler_09 … filler_01]`; beyond-page ids absent; `find_arh001_trunc`
  source link; tasks 0/0, decisions 0/0.
- **Denials (§8):** all four cases with exact error names/codes/messages (`ParticipantRequired`,
  `WorkspaceNotFound`, `ArtifactNotFound`), messages echoing only caller-supplied ids.
- **Clocks:** seed base `2026-10-16T16:00:00.000Z` +1000 ms per write; served read clock
  `2026-10-16T18:00:00.000Z`.

## 4. Materials-leak scan result

**No leak.** `PARTICIPANT_PACKET.md` contains no restricted key fact: no artifact/finding/
decision/task/workspace/actor/evidence/citation id, no `example.com` or any URL, no
`http`/`https`/`ftp`, no sentinel, no page counts. The two participant-facing prompt blocks
(lines 71 and 77) use only the `⟨workspace⟩` placeholder; recorder-only sections discuss the
artifacts to withhold without naming them.

## 5. Boundary-claim check

The result record explicitly claims no human observation (`NOT OBSERVED` for §3.2 and §6), no
external access ("the fixture never asserts or proves external existence, access, or denial"),
no gate movement ("moves no gate"), no VIS-001 condition 4 closure ("ARH-001 does not declare
it met"), no product change (diffs empty), and requests no release decision; no deployment is
implied. The uncommitted `AGENTS.md`/`docs/ROADMAP.md` ARH-001 edits repeat only established
facts. No human-passed observation is claimed anywhere.

## 6. UNVERIFIED / scope limits

- The `npm run build` and the PTY/Playwright capture runs were **not re-executed** by the
  verifier (they write files outside the allowed write scope). The build's verifiable outputs
  were checked at rest (`cmp` IDENTICAL ×4; hashes equal `PIN.md` §6); the captures were
  verified by content, checks recorded in `capture-summary.json`, and SHA-256.
- "`pack:tarball` / `deploy:dry-run` deliberately not run" is a negative claim; the scripts
  exist and no release-shaped artifacts were found (no new tag, package version unchanged).
- D1–D4 were the first-pass state; their disposition is recorded in the Resolution addendum
  below.

## 7. Verdict

**All substantive checked claims reproduce** (commit inventory, no-product-change, baseline
pin, fixture determinism, all 54 hashes, sanitization, the full key cross-check, materials
leak-freedom, suite counts 93 files / 1126 passed + 1 skipped, capture observations including
the 80×24 chrome-title drop, and the boundary claims). **Not everything reproduced verbatim:**
(D1) `SURFACE_FACTS.md:214-216` miscounts `artifact` in the status JSON (2 occurrences, not 1);
(D2) `SPRINT_ARH_001_RESULT.md:63` says seeds produce "byte-identical receipts" when receipts
differ in their own `databasePath` field (dumps are byte-identical); (D3) `SPRINT_ARH_001_RESULT.md:11`
uses present tense for a commit that has not happened yet; (D4) `SPRINT_ARH_001_RESULT.md` §6.1
is an empty placeholder pointing at the pending result-record commit. None of the four affects
a load-bearing claim.

---

## Resolution addendum — post-correction re-verification (October 16, 2026)

Corrections were applied by the sprint owner and re-verified on the working tree. No file
other than this one was modified by the verifier; nothing was committed or pushed.

| Item | Disposition | Re-verification (commands and observed results) |
| --- | --- | --- |
| **D1** — status-JSON `artifact` count | **RESOLVED** | `SURFACE_FACTS.md:214-216` now reads "occurs twice — once inside the fixture workspace name `ARH-001 artifact handoff lab` and once in the goal title — and nowhere as a data field or count." Re-counted directly in `captures/cli/status-ws_arh001_lab-ana.json`: exactly **2** occurrences — offset 105 in `workspace.name` (`ARH-001 artifact handoff lab`) and offset 211 in `goal.title` (`Hand the recorded Q3 artifact reference chain to a second teammate and their agent.`); top-level keys remain `version, kind, state, workspace, goal, participants, work, decisions, attention, activity` (no `artifacts` field or count). The new wording matches the capture. `git diff` of the file shows exactly the intended sentence replacement and nothing else. |
| **D2** — "byte-identical receipts" wording | **RESOLVED** | `SPRINT_ARH_001_RESULT.md:63` now reads "two fresh seeds produce byte-identical dumps (`diff -r` prints nothing; the two receipts differ only in their recorded database path)." This matches the verifier's observed `diff -r` result exactly: dumps byte-identical; the only `seed-receipt.json` difference was the single `databasePath` line. Accurate as written. |
| **D3/§6.1 support** — SHA256SUMS regeneration | **RESOLVED** | Recomputed `shasum -a 256 docs/evidence/arh-001/baseline/SURFACE_FACTS.md` → `fd72e23bdd8813672153ade17faccb4fa3d077a8101f8baf9e1cd01c2738a4cf`, equal to the regenerated `SHA256SUMS` entry; `git diff` of `SHA256SUMS` shows exactly that one hash line updated and nothing else; `shasum -a 256 -c docs/evidence/arh-001/baseline/SHA256SUMS` → **54 OK, 0 FAILED** (54/54). |
| **D4** — §6.1 placeholder | **PENDING (owner step)** | §6.1 still reads "*(Completed with the verification pass results; preserved here verbatim. See the result-record commit for the verified revision.)*" The rest of §6 was re-checked for sufficiency: its preamble's claimed scope matches this verification's actual coverage (determinism re-run, pin re-derived, all 54 hashes, sanitization, key cross-check, materials re-scan, D1/D2 facts, no-product-change re-diff), and a supplementary check confirms the fresh seed receipt's `keyIds` block (34 id values, all found verbatim in `SCENARIO_KEY.md`) and its verification block agree with the dumps. Only the §6.1 fill is needed; it should cite `docs/evidence/arh-001/VERIFICATION.md` and summarize the four discrepancies and their resolutions. Nothing else in §6 requires change. |
| **Remaining deliberate item** — result header tense | **NO CHANGE REQUIRED** | `SPRINT_ARH_001_RESULT.md:11` ("This result record is committed as the immediately following commit") remains intentionally prospective: as of this addendum the record is untracked, and the statement becomes true upon the result-record commit. |

**Verification note:** after the corrections, `git status --porcelain` shows ` M AGENTS.md`,
` M docs/ROADMAP.md`, ` M docs/evidence/arh-001/baseline/SHA256SUMS`,
` M docs/evidence/arh-001/baseline/SURFACE_FACTS.md`, `?? docs/SPRINT_ARH_001_RESULT.md`,
`?? docs/evidence/arh-001/VERIFICATION.md` — the intended working set for the result-record
commit; no product path is modified.

**After resolution: all checked claims reproduce; the evidence at the result-record commit is
consistent.** (Verified on the working tree that will become the result-record commit; the only
pending owner steps are the mechanical commit itself and the §6.1 fill.)
