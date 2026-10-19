# v1.23.0 release decision — NAV-002 Source and People Drill-down (minor)

**Date:** October 19, 2026

**Status:** Prepared for release under a recorded founder decision; the promotion table below records each step as it completes.
**Package target:** `1.23.0`
**Contract:** `docs/Campfire-v1.23-NAV-002-Source-and-People-Drill-down.md` (§3 frozen reads, §5 build sequence, §6 D1–D7, §7 verdict rules, §8 stop boundary)
**Sprint result:** `docs/SPRINT_NAV_002_RESULT.md` — **CONDITIONAL GO — engineering candidate**: D1–D7 pass on the recorded candidate (`8552976`); the contract §7 two-person comparison is **NOT OBSERVED**. The committed October 18 narrow-history follow-up (`961d0b3`) repairs an 80×24 usability gap without changing any read API, default, or the scored candidate record.
**Candidate commits:** Step 0 freeze `073b674`; bounded reads `edeab41`; terminal drill-down `02eed76`; MCP catalog locks `b2321e9`; result record `8552976`; narrow-history follow-up `961d0b3`.

## Founder direction and sequencing

On October 19, 2026 the founder, acting in the `Campfire-Internal` repository, directed the v1.23 release, verbatim:

> "lets fully commit/push/release  v1.23  please"

The direction named the recorded NAV-002 contract (`docs/Campfire-v1.23-NAV-002-Source-and-People-Drill-down.md`) as its frame and asked that subagents be used for the work. Asked separately whether an unrelated untracked product assessment (`docs/PODCAST_MEMORY_OBSERVABILITY_ASSESSMENT.md`) belongs in this release, the founder chose to commit it before the tag; it is documentation only and changes no shipped behavior.

This is that **separate, recorded founder release decision** for the `v1.23.0` bump, tag, public snapshot, installer pin, and deployment that contract §8.5 requires. As with v1.22.0 and v1.22.1, the public release notes describe the shipped behavior without restating the human-observation status; the human-outcome record stays in this document, in the sprint result, and in the public `CHANGELOG.md` entry.

This document is **not a human-outcome result and is not a verdict change**:

- NAV-002's cold two-person comparison remains **NOT OBSERVED** (this session had one operator and used coding agents; contract §7 forbids substituting the builder, an agent, or a scripted capture). Nothing is rescored.
- Contract §7's founder delivery rule allows a separately approved, accurately labeled engineering release with human use still open; publication cannot turn **NOT OBSERVED** into **PASS**. This release is that approved, labeled engineering release.
- No check is loosened. The immutable-installer guard in `scripts/package.sh` stays, and the published `v1.22.1` and `v1.22.0` installer copies are not modified.

## The exact release surface (nothing else)

The published v1.22.1 surface gains exactly the NAV-002 candidate plus its committed follow-up:

- **Two new bounded authorized reads**, frozen in contract §3 and implemented at service, SQLite/D1 store, HTTP, and MCP parity (`edeab41`):
  - `list_workspace_participants({workspaceId, limit?, cursor?, humanOwnerId?})` pages workspace participants under a stable `(actorType, actorId)` keyset order, with `schemaVersion: 1`, applied-filter echo, `items`/`total`/`returned`/`truncated`/opaque `nextCursor`, an optional owner filter counting only workspace-participating agents of that human, and a computed `humanOwnerIsParticipant` flag. Page size defaults to 20 and is capped at 100. It returns no token, email, presence, session, or team-wide directory fields, and uses a workspace-bounded keyset query, never `get_workspace` plus an in-memory slice.
  - `get_record_history({workspaceId, objectType, objectId, limit?, cursor?})` pages the append-only `Contribution` rows of exactly one selected task, decision, finding, or artifact, newest first, with the same page-coverage shape, a frozen append-position high-water mark per traversal so a later write cannot enter an older page set, and rejection of cursors from another selection or workspace. Default limit 10, maximum 50. Both reads require `workspace:read` (history also `activity:read`) and verify the object exists in that workspace before returning count or cursor diagnostics.
- **Opt-in orientation slimming**: `get_workspace_context` accepts `participants: "omit"`, returning `participants: []` with an explicit `participantsCoverage` `{returned, total, truncated, omitted}`; without the option every existing default, JSON snapshot, and caller is unchanged. `campfire dashboard` uses the option; `campfire agents` does not.
- **Terminal drill-down in `campfire dashboard`** (`02eed76`, follow-up `961d0b3`): an on-demand **People** section (humans and agents grouped by recorded `humanOwnerId`, with owner links only from recorded fields and an outside-the-roster label where applicable); **paged Work** via `n`/`b` over `list_tasks` with per-page counts, authorized total, and next-page indicator; **selected-record history** via `h` showing contribution ID, action, actor type/ID, optional agent-session ID, timestamp, and a bounded payload summary with `returned X of Y` and a `more changes`/`complete` heading; an open history panel gets its own focused frame at narrow sizes with `j`/`k` moving among loaded contributions and `n`/`b` still paging the API. The `/` filter stays local to the loaded page and is labeled `matching / loaded / workspace total`. Help and the footer record the context-sensitive key map. No eager full-workspace scan, no roster on launch, no presence or permission inference.
- **One additive store index**: migration `0007_contribution_object_position.sql` adds `idx_contributions_object_position` for the workspace/type/ID/append-position history access path in SQLite and D1. No existing schema, row, or default read changes.
- **MCP catalog**: the tool list grows by exactly the two new reads; the ATT-001 and WCO-001 catalog locks were updated to require every previous tool plus the two additions and no removals (`b2321e9`).
- **Viewer unchanged**: the allowlist stays the five existing read methods; NAV-002 adds no Viewer method, asset, or behavior. NAV-003 owns Viewer alignment and any allowlist expansion.
- **Versioned installer for this release**: `public/campfire/v1.23.0/install.sh` is tracked from the current installer (sha256 `2256bccb086d3c83e9a997de46285e5ad5175bb3f696a6641322b16ccba8a844`, byte-identical to the `v1.22.1` installer). The published `public/campfire/v1.22.1/install.sh` (same digest, `2256bccb…`) and `public/campfire/v1.22.0/install.sh` (sha256 `ba8603bd106277bf520b1789b77e4e95c8b2bc9c9cae5db5059965bf25d26900`) copies are immutable and verified unchanged.
- **Read-only and additive elsewhere**: no new canonical object or write path, no CLI JSON change to existing commands, no telemetry event, no Viewer change, and no change to `campfire agents`, status/onboarding/join receipts, or old workspace data.

## Evidence status in this release

| Evidence | Status in this release |
| --- | --- |
| D1 — read authorization and isolation; D2 — paging and scale; D3 — recorded relationships; D4 — selected source and history truth; D5 — state and terminal safety; D6 — backward compatibility; D7 — performance and source parity | **Engineering PASS** on `8552976`, recorded in `docs/SPRINT_NAV_002_RESULT.md` §2–§3 (PTY frames, authorized JSON, measurements, and query plans under `docs/evidence/nav-002/`). The independent read-only review of the two new reads is recorded in §4. |
| Narrow-history follow-up (`961d0b3`) | Local battery on the follow-up revision at package `1.22.1`: typecheck pass; full suite **99 files / 1234 passed / 1 opt-in capture skipped**; build pass. Recorded in the result addendum §6 with three sanitized 80×24 PTY frames. It changes no read API, default JSON, Viewer allowlist, or package surface. |
| Release-prep verification battery at package `1.23.0` | Recorded in the promotion table below after it runs on this release-prep revision. |
| Expected pre-pin install-channel assertion | `tests/unit/install-channels.test.ts` pins `packaging/homebrew/campfire.rb` and `flake.nix` to the published archives; they remain at v1.22.1 until the post-publication pin commit (`node scripts/sync-install-channels.mjs` against the four published v1.23.0 checksums), so the assertion fails exactly as pre-recorded for v1.22.1 — named here, closed by the pin, **not weakened**. |
| Human comprehension of the drill-down surfaces | **NOT OBSERVED** (unchanged). Later observations record under their own date, per contract §7. |
| Gate B/C/E/F; NAV-001, ONB-001, UIX-001, ATT-001, SWH-001, WCO-001, ARH-001, VIS-001 condition 4 | **Unchanged/unobserved.** This release satisfies none of them, rescores none of them, and moves no gate. NAV-003 retains Viewer alignment and any Viewer allowlist expansion. |

## Public release notes (v1.23.0)

Used verbatim for the GitHub Release body:

```markdown
Campfire v1.23.0 — Source and People Drill-down

The terminal Navigator now reaches beyond its first page: paged work, an on-demand People directory, and recorded per-record history, all as bounded authorized reads.

- `campfire dashboard` gains a People section: workspace participants grouped as humans and registered agents, fetched only when selected. Selecting a human lists their workspace-participating agents from the recorded `humanOwnerId`; selecting an agent shows its recorded human owner, whether that owner participates in this workspace, harness, workspace role, and join time. An owner who is not a workspace participant is labeled as such. No team-wide directory dump, and no live-presence or permission inference from registration or join time.
- Work pages: the Work section reads authorized task pages (20 per page) with `n` next page and `b` back through a bounded local stack, showing each page's returned count, workspace total, page number, and whether another page exists. Reaching a task beyond the first page no longer requires leaving the Navigator.
- Recorded changes for a record: `h` opens the contribution history of the selected task, decision, finding, or artifact — contribution ID, action, actor type and ID, optional agent-session ID, timestamp, and a bounded payload summary — with `returned X of Y`, a `more changes` or `complete` heading, and the page's read time. `j`/`k` move among the contributions on the loaded page; `n`/`b` request further API pages. An empty history says no contributions were recorded for that record.
- `enter` still opens the selected record's source detail with full ID, recorded status/currentness, provenance, and explicit citations/evidence. The `/` filter remains local to the loaded page and reports `matching / loaded / workspace total` as separate concepts.
- Two new read-only MCP tools back these views: `list_workspace_participants` (workspace-scoped participant pages with an optional human-owner filter) and `get_record_history` (bounded contribution pages for exactly one selected record, protected by a frozen traversal high-water mark). `get_workspace_context` accepts an opt-in `participants: "omit"` for slimmer orientation reads; its default response is unchanged.
- Authorization is unchanged and checked before any count or page is returned; cursors are bound to their workspace, selection, and traversal; and the read-only Viewer, its five read methods, and every existing CLI JSON shape are unchanged. One additive store index (migration 0007) supports the history read. There is no new write path, and piped output stays machine-readable.

Darwin and Linux archives for ARM64 and x64, with SHA-256 checksum files, are produced by the release workflow after publication. The versioned installer at `campfire/v1.23.0/install.sh` pins to this version.
```

## What users should know

- Registration and join time are recorded facts, not presence: a listed agent with a recorded owner is not necessarily online, available, or permitted to act, and a human's listing never implies they have seen the work.
- Ownership is not permission: agent ownership and workspace membership remain separate from authorization, and no method infers either from the other.
- Record history is the history of Campfire contributions whose object type and ID equal the selected record — not a transitive history of cited findings, referenced artifacts, a human, or an external system. Inspect a linked record through its own ID and history.
- A stored external artifact reference proves only that the reference is recorded; this terminal does not open, fetch, or verify it, and the Viewer's separately approved open behavior is unchanged.
- The `/` filter narrows the loaded page only; it is not workspace search.
- The upgrade from v1.22.1 is the same install path; the versioned installer at `campfire/v1.23.0/install.sh` pins this release, and the published v1.22.1 and v1.22.0 installer copies are unchanged and immutable.
- The first deployment of this release applies migration 0007, an additive index; no data changes.

## Promotion record

Each step is recorded with its evidence as it completes; no check is loosened. Publication steps below start only after the release-prep verification battery at package `1.23.0` passes on this revision. The private-repository CI install-channel assertion is expected to fail until the post-release pin commit (pre-recorded as the expected failure, not a defect).

| Step | Evidence |
| --- | --- |
| Founder direction and release-prep revision | This document and the release-prep commit on `main`: `package.json`/`package-lock.json` at `1.23.0`; tracked `public/campfire/v1.23.0/install.sh` (sha256 `2256bccb086d3c83e9a997de46285e5ad5175bb3f696a6641322b16ccba8a844`, byte-identical to the current installer); `public/campfire/v1.22.1/install.sh` verified untouched (sha256 `2256bccb…`); `public/campfire/v1.22.0/install.sh` verified untouched (sha256 `ba8603bd106277bf520b1789b77e4e95c8b2bc9c9cae5db5059965bf25d26900`). Darwin ARM64 `pack:tarball` exit 0: `release/campfire-darwin-arm64.tar.gz` sha256 `30663d89c074f64f9f43ff49babd56ad6caa7e282c66117ba0e85ed1a012e49f`, extracted package `1.23.0`. |
| Release-prep verification battery at `1.23.0` | Pending — record typecheck, full suite (with the expected pre-pin install-channel assertion), build with public-copy parity, `deploy:dry-run`, and the extracted package version. |
| Private annotated `v1.23.0` tag | Pending. |
| Audited public source snapshot | Pending. |
| Public GitHub Release and four checked archives | Pending. |
| Homebrew / Nix pins, tap promotion, installer checks | Pending. |
| Production Worker deployment and live verification | Pending. |
