# Campfire v1.21 — ARH-001 candidate scope (dated record before code)

**Date:** October 16, 2026 (recorded before any implementation edit of this candidate)
**Authorization:** Contract §0 founder sequencing amendment (`5b96512`): the observation-first implementation hold is waived prospectively for this bounded artifact-navigation candidate. The earlier ARH-001 result stays **UNSCORED**; §3.2/§3.3's *gap* requirement is waived for this candidate only; the §3.3–5 security and scope limits remain binding. This document records the scope §0 requires "before code changes."
**Baseline:** published v1.20.1 (tag commit `dc3c2a4c1f10f7815de78c4143fe564331406c73`), including the earlier material freeze at `cec4e63` and no-product-change records at `d12ae75`/`a4a1439`/`6c7f6b5`.

## 1. Exact existing surfaces (and what this candidate does not touch)

| Surface | File | Change |
| --- | --- | --- |
| Terminal dashboard projection | `src/presentation/work-console.ts` | Inspect-only upgrade: typed reference class + destination host for openable references, recorded cited-by relations from the same authorized read, explicit external-unverified caveat. No shell command, no local-file open, no network call. |
| Local Viewer (read-only, actor-bound) | `src/viewer/static/app.js` (artifact source rendering, `artifactSourceHtml` block and finding-evidence rendering context) | Same stored facts; adds the deliberate external-open control for the eligible reference class only; keyboard-reachable; no color-only labeling. |
| CLI JSON | `src/cli/*` | Unchanged contract and output shape. |
| MCP | `src/mcp/*` | Unchanged contract and output shape. |
| Generated workspace view (GWV) | `src/viewer/generated-workspace-view.ts` | Unchanged in this slice (already text-only; its caption stays accurate). |
| Service, domain, persistence, migrations, schemas, `VIEWER_READ_METHODS` | — | **No change.** Five read methods remain five; no new fetch/proxy/redirect endpoint; no schema migration; no unbounded read. |

The Viewer client and the dashboard learn the recorded relations only from the **existing authorized reads** they already perform (`get_workspace_context` slices already carry findings with their evidence citations). No six dispatch, no record-level extra read.

## 2. Reference classes (frozen taxonomy, deterministic, no model involvement)

A single classification of the Artifact's stored `uriOrPath`, applied identically on both rendering surfaces, plus finding-evidence rows. All non-`openable` classes render as inert labeled text and never become navigation.

| Class (label shown) | Rule | Open control? |
| --- | --- | --- |
| `openable https` | Absolute URL, scheme exactly `https`, non-empty hostname, no userinfo (`user[:pass]@`), no control/hostile characters, no credential-style query parameter (frozen deny-set: `token`, `access_token`, `auth`, `api_key`, `apikey`, `key`, `password`, `secret`, `signature`, `sig`, `session`, `sessionid`). | Yes |
| `insecure http` | Absolute URL with scheme `http` (or scheme-relative `//host`). | No |
| `credential-bearing` | Userinfo present, or credential-style query parameter from the deny-set. | No |
| `local path` | No scheme and path-like: leading `/`, `./`, `../`, `~/`, or drive-letter form. | No |
| `other scheme` | Any parseable scheme other than `https`/`http` (includes `file:`, `ftp:`, `javascript:`, `data:`, and internal record forms like `git:<sha>`). | No |
| `unparsed` | Non-empty but not parseable as a URL or classified path. | No |
| `none` | Missing/empty reference. | Nothing rendered beyond the existing label. |

Hostile/control-character rule (applies to every class): presence of C0/C1 control characters (`U+0000–U+001F`, `U+007F–U+009F`) or a newline in the reference forces the row to inert text labeled as unsafe; it can never become an open control. The parsed destination host is displayed for `openable https` before navigation. Classification rules are mirrored in two tested implementations (dashboard TypeScript + Viewer static app.js) with a shared frozen sample set and a parity test so both surfaces cannot drift.

## 3. User action and caveat wording

- **Open control (Viewer only):** an explicitly labeled anchor — "Open <host> (external, unverified)" — rendered only for `openable https`. `target="_blank"`, `rel="noopener noreferrer"`, `referrerpolicy="no-referrer"`. Navigation happens only on the user's own activation (mouse or keyboard); rendering, refresh, hover, and source inspection make zero external requests. The Viewer remains actor-bound, read-only, loopback, and token-free; the anchor adds no bearer token and cannot receive one.
- **Caveat:** both human surfaces state, near the reference, that the target is external and unverified by Campfire and that workspace membership does not grant access to it. Existing "stored reference, not fetched" labeling is retained on every artifact row.
- **Dashboard:** inspect-only (class + host + caveat). No open action exists in the terminal.

## 4. Inspect improvements (recorded relations only)

Where the same authorized read already shows a Finding citing an Artifact with `supports`/`contradicts`, both human surfaces may surface that link beside the artifact record as the recorded relation (Finding ID + relation), so the evidence trail is inspectable at the artifact, not only at the finding. **No relation is ever inferred** from title, URI similarity, proximity, or history. If no recorded relation appears in this read, the surface shows no relation claim — absence is not asserted beyond the read.

## 5. Authorization boundary (unchanged and retested)

- Campfire authorizes reading the Artifact record; the external system independently authorizes the target. Workspace membership is never described as external access (runbook and §4 wording preserved in UI text).
- Wrong-workspace IDs, non-participants, and unauthorized actors learn nothing new: the candidate adds no response, error, count, host, relation, or title they did not already have. D1's existing tests gain the new assertions for the open control and host display.
- A deliberate external activation leaves Campfire's trust boundary by the user's own act; a failed external open is never reported by Campfire as opened, verified, or accessible (D4). Campfire never probes the target: no fetch, HEAD, DNS, or reachability claim exists anywhere in this candidate.

## 6. Deterministic checks (D1–D6 mapping)

| Check | Candidate assertion |
| --- | --- |
| D1 workspace authorization | Authorized actors see identical source facts; non-participant/wrong-workspace reads expose no new artifact/relation/host/count detail. Existing negative tests extended to the new rendering. |
| D2 recorded chain | Artifact ID/type/title/reference/provenance shown as stored; cited-by relations shown only where recorded in the read; historical/competing decisions not promoted; missing links stay missing. |
| D3 deliberate open | Rendering makes no external request (static audit + tests); only a user activation navigates; non-`openable` classes, hostile markup, credential-bearing, and local paths stay inert; no token/referrer propagation. |
| D4 external authority | No Campfire surface claims the target is open, verified, or accessible. Membership never bypasses the external system. |
| D5 parity + accessibility | Dashboard and Viewer agree on stored facts and caveat; CLI JSON/MCP unchanged; anchor is keyboard-reachable with a text label and visible host before navigation. TC/parity tests assert identical classification on both surfaces. |
| D6 compatibility and bounds | Five Viewer methods unchanged; page budgets, status JSON, Recall/packet schemas, artifact writes, SQLite paths, installer, and public asset sync intact; full suite, typecheck, build, packaging/deployment dry run. |

Plus the §0 additions: direct terminal and browser inspection at narrow and wide sizes of the two changed surfaces.

## 7. What stays inert (explicit)

External fetch, content hosting, previews, automatic navigation, speculative prefetch, shell commands, local-file opens, synthesis from rendering, provider connectors, upload/ingest/synchronization, new sharing policy, automatic task creation, notifications, agent execution, production-event integration, new poll loops, and any claim that a teammate can reach the target. Out of scope for this candidate: scheme allow-lists beyond `https`, per-host custom trust, deep-link verification, and link rot checkers.

## 8. Verdict semantics and release boundary

- Implementation is judged **only** by the checks above: `ENGINEERING PASS — human outcome NOT OBSERVED` or `ENGINEERING FAIL` until repaired and reverified. H1–H6 are not claimed; the earlier UNSCORED result is not rewritten. No claim that any human completed a handoff or reached an external target.
- A subsequent real observation (when eligible people/tasks exist) is recorded under its own date and source under the original §2/§6 procedures; it may validate or falsify this candidate and never retroactively changes the UNSCORED record.
- **No publication is authorized by this scope.** A v1.21.0 bump, tag, snapshot, installer pins, or deployment require a separate recorded founder release decision naming the exact shipped behavior and the unmeasured human outcome.
- Human falsifier retained: the first real ordinary-work open of this control (by a human, recorder-first, runbook §2) is the standing test of whether the affordance actually helps; the §6 two-human/two-harness case remains the full-handoff falsifier.

**Provenance:** scoped by the coding agent under the founder's October 16 §0 amendment and delivery rule; no product file touched at the time of this record.
