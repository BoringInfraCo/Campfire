# Campfire v1.20 — UIX-001: Shared Work Console

**Status:** Implemented as an engineering candidate. See `docs/SPRINT_UIX_001_RESULT.md`. No release decision, human observation, or version bump is recorded.  
**Date:** October 16, 2026  
**Target:** A v1.20 candidate, subject to a separate release decision.  
**Founder direction:** Improve both the terminal experience and the local Viewer now. The target audience should be able to understand shared work quickly in either surface. This changes the previous roadmap order that would have waited for the open ATT-001 and WCO-001 human observations before starting interface work. It does not satisfy those observations or change their verdicts.  
**Baseline:** Published v1.19.0 and its recorded ATT-001 attention semantics.

## 1. Product question

> Can a person open Campfire in their terminal or browser, identify the workspace goal, recorded work, attention, decision boundary, and recent changes within seconds, and inspect a source record without mistaking an agent session for live presence or an attention cue for permission to act?

This is an interface sprint over **one authorized workspace**. The terminal and Viewer are two clients of the same service and data model. The workspace remains canonical; neither client stores a second work feed. The terminal is useful in an existing terminal or SSH session. The Viewer gives more room for team context, sources, and the workstream. Neither surface needs to run coding agents inside Campfire.

## 2. What exists at v1.19

| Surface | Shipped state | UIX-001 opportunity |
| --- | --- | --- |
| CLI | `campfire status`, `context`, `agents`, `tasks`, `decisions`, `activity`, and deterministic `--output json`; `status` is a short static read. | A focused, keyboard-driven human console that keeps attention, current work, and source details in one place. Keep JSON commands unchanged for agents and scripts. |
| Viewer | Read-only, actor-bound, loopback by default; My work / Team work, attention, current work, alignment, sources, and workstream over authorized reads. | Stronger visual hierarchy, faster movement from cue to source, clearer counts and freshness, and a useful laptop and narrow-screen layout. |
| Attention | v1.19 adds `attentionCoverage` and a team review cue for accepted decisions citing non-current findings. | Present source coverage next to cues; preserve the meaning of empty and incomplete lists in both surfaces. |
| Agents | Registered participants and sessions exist. `campfire agents` explicitly does not infer presence from an unended session. | Show identity, harness, human owner, and recorded contribution. Do not label an agent working, idle, blocked, or online without a separate authenticated status source. |
| References | Artifacts are typed references; the Viewer does not fetch or preview their targets. | Make the stored reference and source ID legible. A link or preview remains subject to the real reference-open observation and separate scope/security decision. |

The linked Solo, Delta, and Rex products inform interaction design. They do not supply Campfire with agent presence, transcript sharing, synchronized worktrees, or a terminal emulator. Rex OSC 7501 reports a program's transient status to its terminal; it is not an inbound Campfire feed.

## 3. Deliverable A — terminal dashboard

Add a read-only command provisionally named `campfire dashboard [workspace]`. Freeze the final command name in the CLI catalog before implementation. It runs only in an interactive TTY. A non-TTY invocation returns a clear instruction to use `campfire status --output human|json`; it never emits cursor controls into a pipe. Existing `status` and JSON output retain their contracts.

The default screen has four parts, all from an authorized `get_workspace_context` read and, if needed for the workstream, the existing bounded `get_activity` read:

```text
Campfire  /  <workspace>                              <actor>  ·  refreshed <time>
GOAL  <recorded goal>                  <humans> people · <agents> registered agents

MY WORK  |  TEAM WORK                 ATTENTION  <returned>/<total> tasks · <returned>/<total> decisions
<selected cue or truthful empty state>  <status> · <source id> · <plain-language reason>

CURRENT WORK                       RECORDED DECISIONS
<open / blocked / in progress>      <proposed / accepted / needs review>

SOURCE  <selected id>              RECENT CHANGES  <bounded count / source position>
<recorded detail and provenance>   <actor · action · record id>

p perspective   tab section   j/k move   enter inspect   r refresh   ? help   q quit
```

The exact layout may adapt to terminal width, but the same facts and caveats remain visible. At narrow widths, stack sections and shorten summaries; never drop IDs, lifecycle, coverage, or the reason for a review cue. Text from records is escaped or stripped of control/ANSI sequences before writing to the terminal. No user-controlled text may move the cursor, change colors, or forge dashboard chrome.

Interaction scope:

- `p` switches My work / Team work without changing authorization or fetching a different workspace.
- `tab` moves among attention, current work, decisions, and recent changes; `j/k` moves within a section; `enter` opens a read-only source detail from already returned data or an existing authorized get-by-id method. A detail read must identify the method and source ID; no silent cross-workspace lookup.
- `r` refreshes bounded reads. A modest automatic refresh may be added only if it is rate-limited, pauses when the terminal is not foregrounded, and states the last successful read time. A refresh failure keeps the last view labeled stale and shows the error; it never clears work into a false empty state.
- `?` shows keys and the meaning of recorded versus transient information; `q`, Ctrl-C, normal exit, and errors restore raw mode, cursor, and the alternate screen. Resize redraws without duplicating reads.

The dashboard is a **human read surface**, not a machine protocol, approval inbox, agent runner, or notification system. It displays registered agents and their recorded work; it does not claim live status. `needsYou` and `needsAttention` are cues from the service, not independent permission checks. The existing CLI catalog and `capabilities` manifest must describe the command accurately.

## 4. Deliverable B — local Viewer refresh

Keep the current actor-bound read-only Viewer and its existing read allowlist. Refresh the information architecture and visual system inside `src/viewer/static/` and sync `public/` byte-for-byte. The core path is:

1. **Workspace header:** recognizable workspace, goal, acting identity, and counts labeled as recorded participants, never live agents. Workspace switching remains explicit.
2. **Attention first:** one clearly differentiated My work / Team work perspective, with Needs You or Needs Attention, reason text, source ID, review citations, and returned/total coverage. An empty list says only what the current rules and returned pages establish.
3. **Work and decisions:** open, blocked, and in-progress tasks remain reachable; proposed, accepted, accepted-needing-review, and historical decisions remain distinct. Competing accepted decisions are shown together without choosing an operative one.
4. **Sources and change history:** findings, artifact references, provenance, and the existing workstream gain clearer hierarchy and inspect paths. A stored artifact reference is labeled as a reference until an authorized access path is separately scoped.
5. **Responsive use:** a laptop viewport shows the goal, attention, and first current-work item without needing to scroll through the workstream. Narrow screens stack panels without horizontal overflow; keyboard navigation, focus, visible selection, and screen-reader labels remain usable.

Visual direction: retain Campfire's brand palette and identity while giving headings, counts, cues, and records a clear hierarchy. Use spacing, typography, borders, and text labels so status is understandable without color. Keep a compact density option if the richer layout materially slows experienced users; this is a local display preference, not a new workspace object. Avoid marketing or implementation copy in the product UI.

The Viewer is still a projection of authorized state. This sprint does not add login sharing, task writes, approvals, chat, transcript panes, code ingestion, artifact fetching, diff hosting, external links, or arbitrary generated content. The generated workspace view remains separate and non-canonical.

## 5. Source and security contract

- Every displayed item names its source type and ID. Counts and truncation come from the same authorized service response used to render the list. Terminal and Viewer text must agree on task status, decision lifecycle, attention reason, source position, and owner attribution.
- Both surfaces use the existing actor/workspace authorization path. A My work / Team work switch changes presentation only. No private prompt, message, tool argument, terminal transcript, unshared file, or secret enters shared state or a screenshot fixture.
- `AgentSession` registration and recent contributions are historical facts. They cannot produce “working,” “blocked,” “online,” or “approval needed.” An authenticated, expiring status adapter would require its own sprint and authorization design.
- Do not turn an accepted `needsReview` decision into a retired one or treat a proposed decision as an instruction. The dashboard may show the current orientation hint only if it remains explicitly labeled as a hint.
- The browser remains token-free, uses the same five Viewer read methods, and makes no new external fetch. The terminal restores its state on every exit path and treats record text as untrusted.
- No schema or migration is expected. If implementation reveals one is required, stop and amend this plan with the exact data need, security impact, and parity checks before coding it.

## 6. Sequence

| Step | Work | Exit condition |
| --- | --- | --- |
| **0 — freeze** | Pin v1.19.0 CLI and Viewer screenshots/text at standard terminal widths and laptop/narrow browser widths. Record current time-to-find and wrong-answer cases for a goal, assigned task, review cue, competing decision, and artifact reference. Freeze a fixture and answer key before candidate evaluation. | Baseline, tasks, and intended changes are recorded without treating a mockup as a user observation. |
| **1 — shared content model** | Define one presentation map for attention reason, lifecycle, assignee, coverage, and source labels. Reuse the service projection; avoid parallel business rules in each UI. | A table of source fields → displayed label exists for terminal and Viewer. |
| **2 — terminal slice** | Build the TTY dashboard, keyboard navigation, detail, refresh, cleanup, CLI help/catalog entry, and non-TTY behavior. | One authorized workspace can be inspected safely in a terminal; existing `status --output json` is unchanged. |
| **3 — Viewer slice** | Reshape the existing shell and panels, improve visual hierarchy and responsiveness, keep inspect and workstream behavior, and sync public assets. | Same actor and workspace show the same facts in both surfaces. |
| **4 — verify and observe** | Run deterministic checks, inspect real screenshots at agreed sizes, then test cold tasks with humans when available. Record failures before further design changes. | A result record states implementation pass/fail and human observation separately. |

Steps 2 and 3 may be built in parallel after step 1, then reconciled against the same frozen answer key. The founder has authorized interface work before the open ATT-001/WCO-001 traces; this plan records that order without recasting those traces as passed.

## 7. Acceptance checks

| Check | Required property |
| --- | --- |
| **D1 — service truth** | Every terminal and Viewer cue matches the same authorized context; no inferred presence, reviewer, operative decision, permission, or urgency. |
| **D2 — bounded completeness** | Complete, truncated, empty, and refresh-error states distinguish what was returned from what may exist beyond the page. |
| **D3 — terminal safety** | TTY and non-TTY paths behave correctly; record text cannot inject control sequences; q/Ctrl-C/error restore terminal state; resize and narrow widths keep source IDs and status readable. |
| **D4 — Viewer safety** | Five read methods, browser token boundary, hostile-text escaping, focus, keyboard behavior, and responsive layouts hold; no write or fetch route appears. |
| **D5 — cross-surface parity** | CLI JSON, terminal dashboard, and Viewer agree on IDs, lifecycle, counts, attention reason, and source position for the frozen workspace. |
| **D6 — compatibility** | Existing commands, MCP, HTTP/Worker, SQLite/D1, installers, and older workspace data continue to work; `public/` and static assets are byte-identical. |

Use focused tests for content and lifecycle risks, the full relevant suite, typecheck, build, packaging, and deployment dry run for a release-shaped candidate. Inspect screenshots at 80×24 and 120×36 terminals and at 1440×900 and 390×844 browser viewports. A visual review checks hierarchy, clipping, focus, and contrast; it does not claim user comprehension.

## 8. Observation and verdict

Pre-register five cold tasks: find the goal, identify the next recorded task and assignee, explain a needs-review accepted decision, notice a truncated attention source, and locate a cited artifact reference. Record the starting surface, path, time, source IDs named, wrong inferences, and whether a private explanation was supplied. Compare the shipped v1.19 surface to the candidate on matched fixtures, with order counterbalanced. A participant who built the change is a debugging rehearsal, labeled as such.

**GO — bounded UI claim:** D1–D6 pass and at least two non-builder humans complete all five cold tasks on the candidate without a safety error or a private recap; record per-task time and errors, including any case where the candidate is worse than v1.19. **CONDITIONAL GO — engineering candidate:** D1–D6 pass and the human comparison is unavailable for a recorded reason; claim only that the two interfaces implement the specified projection. **NO-GO / REFRAME:** unauthorized data, forged live status, a false complete state, decision-safety error, terminal escape injection, or a critical cold-task failure remains. A polished screenshot alone is UNSCORED human evidence.

This observation does not close ATT-001 H1–H6, WCO-001 C1–C7, SWH-001, VIS-001 condition 4, or Gate B/C/E/F. Those retain their own runbooks and eligibility rules. A v1.20 version bump, public snapshot, tag, channel pin, or production deployment needs a separate release decision; a founder override may authorize a bounded release but does not turn unobserved or failed evidence into GO.

## 9. Deliverables

1. Frozen v1.19 baseline, UI field map, fixture, answer key, and screenshot sizes.
2. Read-only terminal dashboard and refreshed local Viewer, with no second source of truth.
3. Focused D1–D6 checks, visual captures, and compatibility results.
4. `docs/SPRINT_UIX_001_RESULT.md` with exact candidate commit, human scores or NOT OBSERVED reason, deviations, verdict, and risks.
5. A separate release record if publication is chosen.
