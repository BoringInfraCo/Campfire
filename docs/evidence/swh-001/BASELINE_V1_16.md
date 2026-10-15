# SWH-001 — v1.16 source baseline and overdue observations

Recorded 2026-10-14 (UTC) as step 1 of contract §9. Source is the **committed
v1.16.0 tree**, read via `git show HEAD:…`, not the working tree (the v1.17
implementation is editing `src/viewer/static/**` concurrently).

## Source

| Item | Value |
| --- | --- |
| HEAD commit | `db3a121d3cbbc4beed1965ef6956b3294a109c7c` — "Record v1.16.0 publication and deployment" |
| Package version | `1.16.0` (`package.json`) at that commit |
| Shipped Viewer source files | `src/viewer/static/index.html`, `app.js`, `app.css`, `campfire-mark.svg` |
| Hash method | `git show HEAD:<path> \| shasum -a 256` (hashes below are of the committed bytes, as piped) |

| File | sha256 (committed v1.16) |
| --- | --- |
| `src/viewer/static/index.html` | `cf6b0a596cadfa7812779042aaaeea98e7b6c5fac8b38c1615bd74dad5232c05` |
| `src/viewer/static/app.js` | `db6d3001ba37e99ac92611490bce795d57fe38ea54e847c0779c5ba2005a45da` |
| `src/viewer/static/app.css` | `ad13f47a720f421db3a152adaa4348722cdd0fc1860b175efb3ba88c847b44d8` |
| `src/viewer/static/campfire-mark.svg` | `a845ec975a6f58a5e9583d157445849a6900fd53cda0965cf5e21c94af44f311` |

## Shipped v1.16 Viewer surface (from the committed source)

- **Header**: Campfire mark; the authenticated `whoami` actor; a workspace
  `<select>` switcher; and the **generated view link** (`id="generated-view-link"`,
  text "Workspace view ↗") that opens `/generated/workspaces/<workspaceId>` in a
  new tab. The generated page is a separate, non-canonical derivation.
- **Workspace mast**: participant list (`#people`, humans `●` / agents `◇` with
  names) and the **goal** line (`#goal`, labelled `GOAL`).
- **Orientation panels** (`#orientation`):
  - **Recorded alignment** (`#alignment`): alignment status and boundary
    sentence, with `proposed`, `accepted`, `accepted needing review`, and
    `unresolved blocked tasks` groups; an accepted decision that cites a
    non-current finding is separated and labelled "needs review" (text, not
    color only).
  - **Suggested next action** (`#next-action`): a plain-text orientation hint
    ("SUGGESTED NEXT — orientation hint, not an action") with kind, id, and
    reason; never a control.
  - **Needs You** (`#needs-you`) and **Needs Attention** (`#needs-attention`):
    the service `needsYou` / `needsAttention` items with kind, status, sentence,
    and reason.
  - **Current Work** (`#current-work`): in progress, blocked, open, accepted
    decisions, and accepted decisions needing review groups, plus per-slice
    **orientation completeness** notes ("showing N of M", "more available — open
    the list for the rest").
  - **Since You Were Here** (`#since`): client-held catch-up cursor over
    `get_activity`; first-visit and no-new-activity messages; "older changes
    omitted" when the page truncates.
- **Workstream** (`#stream`): the activity journal with expandable detail
  inspection (`renderDetail`) and load-older paging (`get_activity` with a
  `before` cursor). Detail inspection fetches `get_workspace` on demand.
- **Refresh behavior**: `get_workspace_context` + `get_activity` on refresh; the
  five-method read allowlist; loopback by default; the browser holds no token.

## Overdue VIS-001 shipped-Viewer comprehension trace — NOT run

**The comprehension trace on the shipped v1.16 Viewer was not run before this
implementation.** It is the overdue VIS-001 human observation, not a treatment
arm. Recorded reason: the implementation interval (2026-10-14, UTC;
founder-local 2026-10-13) is an agent session; no independent human participant
was available. It remains owed. A post-build trace of the v1.17 home must not be
relabeled as a v1.16 baseline; it will be recorded as its own dated observation.

## Artifact reference-open observation — none yet

**No ordinary-work artifact reference-open attempt has been observed yet, and
VIS-001 condition 4 stays OPEN.** This is a status, not a dated absence: a dated
absence requires an actual participant's ordinary-work interval in which no
attempt occurred, and no such interval has been observed. The controlled
scenario's known-accessible reference (`art_swh001_runbook_ref` →
`docs/ARCHITECTURE.md`) is a fixture fact for scoring H5/N; displaying it or
listing it here does not close condition 4. The observation path and what to
record are in `REFERENCE_OBSERVATION.md`; the reference-open attempt is recorded
separately from the controlled trace (contract §6.2/§6.3).
