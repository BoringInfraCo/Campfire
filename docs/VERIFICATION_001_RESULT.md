# Campfire — Verification 001 Result

**Classification:** Independent engineering verification, one human operator
**Date:** September 28, 2026
**Target:** Campfire `v1.8.0`, commit `8c0be07`, working tree clean
**Gate status:** Not a field trace. Gate B and Gate C are not evaluated.
**Evidence:** `evidence/verification-001/` (gitignored, private)

---

## 1. Scope and independence boundary

This run verifies the committed `v1.8.0` tree and captures the real loopback
Viewer. It is an engineering verification, not product evidence.

Independence means:

- a fresh database at `.campfire/verification-001.db`, created with `campfire
  init` after the file was deleted;
- a fresh workspace `ws_e063bbbe391b422d` created by `campfire onboard`;
- fresh human (`hum_0460398ce959465d`) and fresh agent identities;
- no reuse of `.campfire/campfire.db`, `.campfire/demo.db`,
  `.campfire/field-trace-001.db`, `.campfire/founder-dogfood-001.db`, any
  `seed` fixture, or any prior sprint workspace.

One human participated (Sergio). Two real harnesses contributed. This run
therefore cannot establish Gate B (later-day voluntary return) or Gate C
(multi-participant value).

---

## 2. Build and test verification

| Step | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | clean, exit 0 |
| Full suite | `npm test` | 44/44 files, 504/504 tests, 19.15s |
| Build | `npm run build` | exit 0, produced `dist/src/cli/index.js` |

`npm run build` ran `sync:public`, `tsc`, copied `schema.sql` and the Viewer
static assets, and marked the CLI entry executable. No test was skipped,
filtered, or excluded.

---

## 3. Live harness sessions

Two real harness processes registered sessions and contributed through MCP.

| Session | Harness | Agent | Result |
|---|---|---|---|
| `ses_aa8bd16eab5540e6` | Codex 0.150.1 | `agt_2fe1b4953f874a87` | Sequence completed: `list_workspaces` → `register_agent_session` → `preflight` → `get_workspace_context`; 1 finding, 1 decision, 3 tasks, 1 transition |
| `ses_b336c48456ad4052` | OpenCode 1.18.33 | `agt_85e0ec2828ae4f80` | 1 finding, 1 decision, 2 tasks, all persisted |
| `ses_05d0b56e…` (third, read-only) | OpenCode 1.18.33 | `agt_85e0ec2828ae4f80` | Continuation check only, no contributions |

The Codex session required `--dangerously-bypass-approvals-and-sandbox`;
`approval_policy = "never"` alone rejected every MCP call with
`MCP tool call requires approval`. This reproduces the Sprint 016 finding that
a non-interactive Codex run needs a non-interactive approval path.

The Codex session also hit the same first-write friction recorded in Founder
Dogfood 001: `register_agent_session` returned an error until the agent
consumed its pending invite through `join_workspace`, and the first
`register_agent_session` call failed because the authenticated agent id was not
supplied. Both recovered.

---

## 4. Viewer capture

The Viewer ran on `http://127.0.0.1:9415` against the fresh database, served by
one `campfire up` process that also owns the API on `127.0.0.1:9414`.

| File | Content |
|---|---|
| `00-ENTIRE-viewer-unclipped.png` | Whole Viewer in one image at 1440x2200 @2x: masthead, alignment, needs-you, needs-attention, current work, since-you-were-here, complete workstream, hint bar. Verified `scrollHeight === clientHeight` for both `#orientation` and `#stream`, so nothing is clipped |
| `01-native-1440x1000.png` | The real operator viewport |
| `02-tall-1440x1400.png` | Taller viewport, workstream nearly complete |
| `03-stream-scrolled-to-top-of-history.png` | Stream scrolled away from the pinned bottom |
| `06-inspect-finding-detail.png` | Inspect expanded on the Codex finding; shows `detail` |
| `07-inspect-decision-rationale.png` | Inspect expanded on the decision; shows `rationale` and `accepted by Sergio` |
| `08-inspect-task-description.png` | Inspect expanded on a task; shows `description` |
| `09-inspect-artifact-uri.png` | Inspect expanded on the artifact; shows `evidence/verification-001` |
| `*.txt` | Full rendered text of each capture |
| `capture-report.json` | Viewport and scroll metrics per capture |

Console errors: none in any capture. No failed network request.

Note on the capture method: the Viewer scrolls inside `#stream`, not the
document, so Playwright's `fullPage: true` alone clipped the workstream. The
`00-` capture uses a 2200px viewport so the container does not scroll at all.
Row selection is a click or `j`/`k`; `Enter` toggles expand, so clicking then
pressing `Enter` collapses again.

---

## 5. Boundary verification

### 5.1 Viewer is read-only

| Attempt | Result |
|---|---|
| `POST /api/call` `add_finding` on port 9415 | 403 `{"ok":false,"error":"Unauthorized","message":"Viewer is read-only"}` |
| `POST /api/call` `update_task` on port 9415 | 403, same body |
| `POST /api/call` `get_workspace_context` on port 9415 | 200 with full context |

### 5.2 The browser never receives a token

Recorded in `token-leak-check.json`. Across 13 requests on a full page load:

- zero matches for `cft_[0-9a-f]{16,}` in any request URL, header, post body,
  or response body;
- zero `Authorization` headers and zero `Cookie` headers;
- no token in the served HTML;
- `document.cookie` empty;
- `localStorage` holds only `campfire.viewer.lastSeen.ws_e063bbbe391b422d`;
  `sessionStorage` holds only `campfire.viewer.workspaceId`.

### 5.3 Cross-harness continuation, transcript isolation intact

A cold OpenCode session with no memory of any prior session answered five
questions from `get_workspace_context` alone. It recovered the goal, the Codex
finding summary, the proposed decision id and rationale, and the three open
task ids, titles, and descriptions. Asked directly whether it received any
part of the Codex transcript, it reported no, and gave the reason from the API
surface: the finding-create contribution payload is `{"summary": "..."}` with
no detail, no test output, and no tool-call record. The only Codex-specific
fields exposed are identity and lifecycle — `harness`, `agentSessionId`, and
join/session records.

It also flagged two limits, which stand: `provenanceTotal: 26` with
`provenanceTruncated: true`, and no field anywhere in the projection that
carries tool calls or reasoning for any actor. Shared Finding ≠ access to
private conversation held, in the direction the invariant cares about.

---

## 6. Verdict

**GO** for the engineering claim: the committed `v1.8.0` tree typechecks,
passes 504/504 tests, builds, serves a working read-only Viewer on loopback,
keeps the bearer token out of the browser, and lets a cold session in a second
harness continue real cross-harness work from shared state alone.

**No product claim.** One human, no external participants, no later-day
return. Gate B and Gate C remain unmeasured, exactly as
`docs/FIELD_TRACE_001_RESULT.md` and `docs/internal/` record.

---

## 7. Friction and observations, not defects

1. Non-interactive Codex rejects MCP calls under `approval_policy = "never"`.
   A documented non-interactive path is needed for repeat verification.
2. A fresh agent still cannot write until it consumes its pending invite, and
   `register_agent_session` does not report the authenticated agent id on the
   first failure. The Founder Dogfood 001 friction is unchanged.
3. The Viewer scrolls its workstream inside a fixed-height container, so a
   document-level full-page screenshot under-reports the page. Not a product
   bug; it is a trap for anyone capturing the Viewer as evidence.
4. Inspect is summary-first as designed, but a finding's `detail` only appears
   on expand, and the expand affordance is not visible in a static screenshot.

## 8. Evidence hygiene

- The evidence tree contains no bearer token. The one file that did
  (`codex-config.toml`, which held the Codex agent token) was deleted, and the
  tree was re-scanned clean.
- The two agent tokens and the human token for this run are still valid and
  exist only in this transcript and the local database. Revoke them with
  `campfire revoke-token` if the workspace is kept.
- The database `.campfire/verification-001.db` is gitignored and not committed.
