# Campfire v1.22 — NAV-001: Focused Terminal Navigator

**Date:** October 17, 2026  
**Status:** Proposed sprint contract; no implementation, result, version bump, or release decision is recorded here. Freeze this scope and the Step 0 evidence in a commit before product code changes.  
**Roadmap:** `docs/ROADMAP.md`, “Provisional post-v1.21 sequence — build the Focused Navigator”  
**Visual reference:** `docs/mockups/campfire-navigator.html` (illustrative records and counts, not a product specification or user observation)  
**Baseline:** Published and deployed `v1.21.0`, private annotated tag resolving to `5523305ec1c7334d8789b4c895610ff13f266d5a`, package `1.21.0`; release and shipped classifier correction are recorded in `docs/RELEASE_V1_21_DECISION.md`. Pin a clean tagged install and its terminal frames in Step 0.  
**Next sprint boundary:** NAV-002 owns the on-demand People directory, paged work, and deeper source/history drill-down. NAV-003 owns Viewer navigation alignment and its own human-use evaluation.

## 0. Question and outcome

> Can a person enter one authorized Campfire workspace in an ordinary terminal, find the recorded work that needs attention, and inspect one source without scanning every agent, artifact, decision, and change at once or mistaking a cue for permission or live presence?

NAV-001 reshapes the **existing read-only `campfire dashboard [workspace]`**. The workspace, service projection, and authorized record IDs remain the source of truth. The dashboard is a human client, not a second work feed, process manager, approval inbox, or terminal multiplexer. The product benefit sought is lower time-to-source and fewer wrong inferences on the same recorded state, not a new collaboration object.

The source remains the released v1.21.0 dashboard. UIX-001 already gave it an interactive TTY, `p` perspective, section navigation, `j/k` selection, inspect, refresh, terminal cleanup, coverage wording, and v1.21 artifact-reference labels. NAV-001 changes **what is shown at once and how a person navigates it**. It must retain those safety and truth properties.

## 1. Scope: one focused terminal screen

The first screen shows the workspace name and ID, acting identity, recorded goal, last successful read time, attention coverage, a compact list for **one active section**, and a selected-record summary. At wide terminal widths the list and detail may be side by side; at 80×24 the active list must remain usable and detail may replace or stack beneath it. The design does not require pixel equivalence with the HTML mockup.

| Section | Source and presentation |
| --- | --- |
| **Needs You / Needs Attention** | Default to the caller's `needsYou` in My work; `p` switches to the existing team `needsAttention`. Use the service's reason, kind, ID, status, assignee, and `attentionCoverage` from the same authorized context read. A cue is not a permission grant or instruction. |
| **Team work** | Show returned open, blocked, and in-progress tasks from the existing bounded context, with their actual task coverage. Keep recorded assignee and lifecycle. The `suggestedNextAction`, if shown, remains explicitly an orientation hint. |
| **Decisions** | Keep proposed, accepted, accepted-needing-review, competing accepted, and historical/superseded states distinct. Show the cited non-current finding IDs only when recorded by the service. Do not choose an operative decision. |
| **References** | Keep the v1.21 typed Artifact reference, host when eligible, recorded cited-by relation, and external/unverified caveat reachable on demand rather than printing every Artifact above the default work list. This terminal surface remains inspect-only and never opens a target. |
| **Recent changes** | Keep the bounded contribution/change summary reachable on demand. Label returned versus total and truncation. This is recent context, not a complete per-record history. |

The default header may show `N people · M registered agents`, but it does not enumerate agent rows. Until NAV-002 provides the People directory, the existing `campfire agents` CLI and Viewer continue to expose recorded identities. The default dashboard must not claim that hiding participants changes authorization or proves anyone is online. The mockup's artifact row under **Needs You** is not a NAV-001 attention rule: `AttentionKind` remains task or decision, and an artifact appears under References or a selected linked source.

### Selection and detail

- `tab` moves sections; `p` switches My work and Team work; `j/k` moves among **shown** rows; `enter` inspects the selected source; `r` refreshes; `?` shows accurate help; `q` and Ctrl-C exit. A locally scoped `/` filter may narrow the loaded rows; its visible label must say it filters **shown records**, not the workspace. Escape clears that filter. The key map must remain discoverable at 80×24.
- A selected row always retains its kind, full ID, lifecycle, attention reason when applicable, and a visible selection marker. Long titles may wrap or truncate after the ID and status have been reserved. Color never carries the only meaning.
- Detail reads use only the selected record from `get_workspace_context` or the existing authorized `get_task`, `get_finding`, `get_decision`, or `get_artifact` method for the current workspace. Show the method and source ID. Render only fields actually returned; absence of a relation is not a claim that none exists elsewhere.
- A refresh keeps the active section and selected ID when that ID remains in the new returned page. If it disappears, select a valid shown row or show an explicit empty state; never display the old detail as current. A failed refresh retains the last successful snapshot labeled **stale** and shows the error without turning the list into a false empty state. The existing foreground-aware refresh limit is preserved.
- NAV-001 does **not** build the mockup's Overview/Sources/History tabs, People directory, cross-page search, or server-side task pagination. Those are NAV-002 questions. The first screen may offer a simple selected source summary; it must not fake a full history.

## 2. Truth, authorization, and compatibility boundaries

1. Every number and item comes from the same authorized workspace read or an explicitly named get-by-ID read. For attention, show task and decision `returned/total/truncated` coverage beside the cues. A local filter reports `shown of returned` separately from source coverage. An empty, incomplete page says more matches may exist; it never says all work is done.
2. Registered agent identity, harness, owner, and prior contributions are recorded facts, never live presence, availability, blocked runtime, or approval need. Task `blocked` is a task lifecycle state. No OSC 7501 adapter, session watcher, agent start/stop control, or agent output pane enters this sprint.
3. Record text is untrusted. Keep control/ANSI stripping before terminal output, keep labels legible at narrow widths, and restore raw mode, cursor, and alternate screen on `q`, Ctrl-C, SIGINT, thrown read, and normal exit. Non-TTY `dashboard` continues to return the existing plain instruction with no cursor controls.
4. Keep the v1.21 external-reference classifier and caveat intact. The terminal never opens, fetches, previews, probes, or validates a target's external permissions. The Viewer's approved deliberate HTTPS open control is unchanged, not copied into the terminal.
5. CLI JSON, MCP, HTTP/Worker, SQLite/D1, schemas, migrations, Viewer files and five `VIEWER_READ_METHODS`, installer channels, and public asset synchronization are unchanged. No new write path or workspace object. If the focused screen cannot be truthful within these read boundaries, stop and amend this contract with the exact additional read, authorization impact, and compatibility checks before coding it.

## 3. Step 0 — freeze the comparison before implementation

Use the released `v1.21.0` tag, not a convenient evolving checkout, for the baseline. Record the tag SHA, package/versioned installer, clean-install behavior, and stripped dashboard frames at **80×24** and **120×36** for an authorized actor. Pin the existing ATT-001 scenario v2 (`fixtures/attention/att-001/`) and `docs/evidence/uix-001/FIELD_MAP.md` as the answer key for the goal, assigned task, competing decisions, accepted-needs-review decision, truncated source, and cited Artifact. The v1.21 ARH fixture supplies safe and inert reference classes; the shipped classifier correction is part of the baseline.

Add a NAV-001 display-pressure fixture **before comparing layouts**: at least 20 humans, 37 registered agents, and 64 tasks in one authorized workspace, with attention, a needs-review accepted decision, a competing accepted pair, an Artifact reference, and an unauthorized actor. Freeze IDs, counts, source coverage, and the expected answer for each test. These people/task counts stress the terminal layout; a People directory and page traversal are not NAV-001 deliverables. If the fixture cannot be seeded through existing supported paths without changing product semantics, record that limitation before implementation and keep the smaller frozen answer key authoritative.

Baseline captures and later candidate captures are engineering evidence. They are not human comprehension evidence. Keep any private tokens, prompts, transcripts, and external URL credentials out of committed fixtures and screenshots.

## 4. Build sequence

| Step | Work | Exit |
| --- | --- | --- |
| **0 — baseline** | Pin the v1.21.0 release and frozen answer keys/captures above. | Another engineer can reproduce the baseline and name the expected source IDs and coverage. |
| **1 — state and projection** | Keep one authorized context; separate active section, perspective, shown-row filter, selection, inspected detail, and stale snapshot in dashboard state. Reuse `src/presentation/work-console.ts` wording rather than creating a second attention classifier. | Pure state transitions preserve selection and never turn missing or truncated data into a complete claim. |
| **2 — terminal rendering** | Replace the eager multi-section frame with one focused list and selected summary. Make References and Recent changes reachable; keep keys/help, narrow layouts, v1.21 reference labels, and terminal cleanup. | The frozen workspace can be navigated at 80×24 and 120×36 with full source IDs and truthful coverage. |
| **3 — verify and observe** | Run deterministic checks, typecheck, full relevant suite, build, packaging/deployment dry run, and direct PTY inspection. Then run the separately pre-registered human comparison when eligible people are available. | Record engineering verdict and human outcome separately in `docs/SPRINT_NAV_001_RESULT.md`. |

## 5. Deterministic acceptance checks

| Check | Required evidence |
| --- | --- |
| **D1 — authorized source truth** | The selected workspace, goal, row kind/ID, lifecycle, assignee, attention reason, decision currentness, cited finding IDs, and v1.21 Artifact class/host/relation match existing authorized service/CLI JSON facts. Wrong-workspace and non-participant actors gain no row, count, title, host, or detail. |
| **D2 — honest completeness** | Complete, truncated, filtered, empty, and stale cases each use the correct source coverage. `shown of returned` is not the workspace total. No filter, section switch, or failed refresh fabricates an all-clear or silently drops the truncation caveat. |
| **D3 — navigation and scale** | All sections and selected source are reachable by keyboard. At 80×24 and 120×36, the goal, active section, selected full ID, status/review reason, coverage, and quit key remain findable. In the 20-human/37-agent/64-task fixture, the first screen does not dump participant and Artifact rows ahead of work. A narrow frame may change composition but not facts. |
| **D4 — terminal safety** | Non-TTY emits no screen controls. Hostile titles, IDs, names, and references cannot inject ANSI/control sequences or forge chrome. `q`, raw Ctrl-C, external SIGINT, resize, refresh failure, and thrown read leave a usable terminal; opt-in PNG capture is not required for the PTY behavior assertions. |
| **D5 — v1.21 and decision safety** | Safe and inert Artifact classes keep the shipped classifier behavior; terminal remains inspect-only. Proposed, accepted-needs-review, competing accepted, and historical decisions remain distinct. Registered agents and task states never become live-status labels. |
| **D6 — compatibility** | Existing dashboard invocation/help, `status --output json`, other CLI JSON, MCP, Viewer allowlist and assets, service/domain/persistence, older workspace data, installers, and release packaging continue to work. No schema, method, or public-browser change slips in. |

Use focused unit and PTY checks for the changed renderer/state, a same-fixture cross-surface fact comparison, typecheck, full relevant tests, build, package, and deployment dry run. Directly inspect real terminal frames at the two frozen sizes; do not substitute the HTML mockup for a terminal capture. Broaden testing only to resolve a concrete remaining risk or the release gate.

## 6. Human observation and verdict

Pre-register five cold tasks for **two non-builder humans** using the same authorized fixture in both the released v1.21.0 dashboard and the NAV-001 candidate, with order counterbalanced: (1) find the goal and source ID; (2) identify the next recorded task, its assignee, and whether the cue grants permission; (3) explain an accepted decision needing review while naming the non-current finding and without choosing between competing accepted decisions; (4) recognize a truncated or incomplete attention source; (5) locate a cited Artifact reference and state what Campfire does and does not know about the external target. Record start surface, keystrokes/path, time, answer/source IDs, errors, wrong inferences, and any private explanation. A builder rehearsal or scripted capture is labeled as such and does not count as a human outcome.

- **GO — bounded Navigator claim:** D1–D6 pass, two eligible humans complete all five candidate tasks without a safety error, false all-clear, false permission/presence claim, or private recap, and the matched baseline comparison records any task on which the candidate is slower or less clear. State the observed times and errors; do not claim a universal speedup from two people.
- **CONDITIONAL GO — engineering candidate:** D1–D6 pass, but the two-human comparison is unavailable for a recorded reason. Claim only that the focused terminal projection implements the checked behavior; human comprehension is **NOT OBSERVED**.
- **NO-GO / REFRAME:** An authorization leak, false completeness, decision-safety error, forged live status, terminal escape or cleanup failure, missing selected source ID, or critical cold-task failure persists.

The older UIX-001 five-task comparison, ATT-001 and SWH-001 comprehension traces, WCO-001 two-human case, ARH-001 real reference-open and handoff attempts, VIS-001 condition 4, and Gate B/C/E/F retain their own rubrics. A NAV-001 task does not silently score one of them. A v1.22.0 version bump, tag, public snapshot, channel pin, or deployment requires a **separate recorded founder release decision** naming the shipped slice and the human outcome. The founder's delivery rule permits an accurately labeled release after engineering checks with human use still open; it does not convert NOT OBSERVED into PASS.

## 7. Deliverables

1. A committed baseline pin, answer key, and sanitized terminal captures before code changes.
2. A read-only focused terminal Navigator over the existing authorized workspace projection, with no new canonical state or agent runtime.
3. Focused D1–D6 evidence, terminal captures, compatibility results, and an independent review of source truth and terminal safety.
4. `docs/SPRINT_NAV_001_RESULT.md` with candidate commit, deviations, exact engineering checks, human result or NOT OBSERVED reason, and verdict.
5. A separate release decision if the founder chooses to publish.
