# SHR-001 isolated rehearsal evidence

**Date:** October 24, 2026  
**Status:** Preparation snapshot below; October 24 physical two-Mac trace reported in the addendum

**Candidate record:** `docs/RELEASE_V1_26_2_CANDIDATE.md`

## Target

| Fact | Value |
| --- | --- |
| Candidate | `1.26.2` (unreleased) |
| Source commit | `0d2c2debd29214959f21abf7330fe34d2d28de4e` |
| Archive checksum | `269aac014c39037e037a41b50bc77f9e202cc7c8f0ace7de9c4dd61ed6c8fcbc` |
| Worker | `campfire-shr001-rehearsal` |
| Endpoint | `https://campfire-shr001-rehearsal.sunbeam-redraft-7j.workers.dev` |
| Worker version | `c8fdd866-ef85-49a8-85da-9401a24389c9` |
| D1 | `campfire_shr001_rehearsal` (id in gitignored config) |
| Migrations | 10 applied through `0010_workspace_publication.sql` |
| Route | none; `workers.dev` only |
| Assets binding | omitted (API-only) |

## Remote gate matrix

| Probe | Result |
| --- | --- |
| Alpha `0` enroll/import/recover | `403` |
| Alpha `1`, admission hash unset | `403` admission not configured |
| Alpha `1`, hash set, no code | `403` code required |
| Alpha `1`, hash set, wrong code | `403` code rejected |
| Alpha `1`, hash set, correct code, invalid body | `400` validation; no enrollment rows |
| `/v1/call` no bearer | `401` |
| `/` | `404` |
| Production Worker version | unchanged `785c8415-5d58-4cd9-9a57-97aef22b78ad` |

D1 after the gate probe: `publication_enrollments = 0`; admission attempts = 14.
The raw rehearsal code is stored only in the private mode-0600 file
`~/campfire-rehearsal/v1.26.2/rehearsal.env`; the Worker stores only its SHA-256.

## MacBook candidate

- Archive: `~/campfire-rehearsal/v1.26.2/artifacts/campfire-1.26.2-darwin-arm64.tar.gz`
- Extracted binary: `~/campfire-rehearsal/v1.26.2/install/bin/campfire`
- Package reports `1.26.2` / `candidate`.
- Pinned profile: `CAMPFIRE_CONFIG_DIR=$HOME/.config/campfire-arbora`
- `campfire status --output json` selected `ws_df6794f33efc459b`.
- `campfire up --no-open` smoke served `127.0.0.1:9414`; no session was
  registered by starting it. It was stopped after the smoke.
- An installed-candidate `publish --dry-run` against the isolated endpoint,
  using a temporary profile symlinked to the real credentials, reported
  `not_started`, workspace `ws_df6794f33efc459b`, tip 8, and candidate digest
  `4c8496e92290db32d1efe21411686e87bb6c0e26e4706dfaf9bf0091e5bba757`. It made no
  network request and wrote only the temporary preflight receipt.

The stale default `~/.config/campfire` Ada profile was not used. The released
`~/.local/bin/campfire` (`1.26.1`) was not overwritten.

## Not claimed

At the time of this preparation snapshot: no physical MacBook → hosted → iMac →
fresh MacBook run; no hosted Arbora copy; no public tag, GitHub Release, channel
update, or production deployment. The later trace is recorded below without
retroactively changing the original candidate pins.

## October 24 physical two-Mac trace — operator-reported evidence

The operator ran the installed `1.26.2` candidate on a MacBook Pro and iMac,
using the isolated hosted Worker and distinct Codex and OpenCode agents. These
facts come from the two agents' reported Campfire reads and the operator's
two-machine sequence; this document does not contain a machine-level network
capture proving the MacBook's offline interval.

| Check | Observed result |
| --- | --- |
| Updated candidate archive | Darwin ARM64 SHA-256 `077094a6658ff67c07d275173e6b81696e181b5a9bcc6038109305e4acc874a9` |
| Isolated Worker | `campfire-shr001-rehearsal`, version `07ac7ae5-14bc-41aa-8150-1e46cfbb2f05`; production Worker reported unchanged at `785c8415-5d58-4cd9-9a57-97aef22b78ad` |
| Hosted Arbora workspace | `ws_df6794f33efc459b` at `https://campfire-shr001-rehearsal.sunbeam-redraft-7j.workers.dev` |
| Original finding | `find_5cd543722a044c20`, read by the iMac and again by a fresh MacBook session |
| iMac identity | OpenCode agent `agt_49b4999f33424f55`, human `hum_ab19b25d25bb4c0e`, session `ses_6bf862bba45c4d4e` |
| iMac contribution | `con_09640a17b9b14ea7` created open task `task_3795d9d37d3842e9` at `2026-10-24T19:12:59.122Z` |
| Task read-back | iMac `get_task` and `list_tasks` returned the task; fresh MacBook session independently read the same task, agent, session, and contribution from the hosted workspace |

The task is **Implement address search and selection on a real satellite map**.
Its description refers to the original finding and scopes address search,
satellite/aerial map, selected-location context, and loading/error/empty states;
it excludes parcel geometry, analysis, and scoring. Campfire does not expose a
native task-to-finding link in `create_task`, so the description carries that
relationship. The first fresh MacBook read correctly found no task before the
iMac wrote one; the second fresh read found the attributed task. No Arbora code
change was part of this trace.

The owner invitation link used a fragment capability. `GET /join` and
`GET /campfire/join` returned a static no-store, no-referrer page; recipient
preview, Accept, and Decline were performed by the installed CLI. This is
agent-assisted link acceptance, not browser click-to-accept. The rehearsal
Worker had no invitation rate-limiter binding, so that limiter failed open;
this remains a controlled-alpha release gate. No public tag, GitHub Release,
installer-channel update, or production deployment is claimed.

## October 24 invitation limiter and operating follow-up

The prior paragraph is the condition **during** the two-Mac trace. After that
trace, a dedicated `INVITATION_RATE_LIMITER` binding was added to the isolated
Worker at 30 requests per 60 seconds per source. The new Worker version is
`ec754f1e-5766-411a-bb88-6d21965f4b9d`. Preview, decline, and redeem now
return 503 if the binding or client address is unavailable on a deployed
Worker; the old silent fail-open condition is closed. A persistent client sent
100 credential-free preview requests to the live isolated endpoint and received
43 authorization rejections (401) followed by 57 rate-limit responses (429).
The edge budget is approximate and per Cloudflare location, so it is an abuse
guard rather than a durable account entitlement.

Read-only isolated D1 inspection reported a 495,616-byte database and, in its
preceding 24-hour window, 1,139 read queries, 135 write queries, 4,144 rows
read, and 392 rows written. A remote D1 export was restored into temporary local
SQLite: `PRAGMA integrity_check` returned `ok`, and the workspace, original
finding, iMac task, and attributed contribution each appeared once. Temporary
export files were removed after this drill. This proves export readability and
record preservation; it does not prove a remote point-in-time restore.

`GET https://boringinfra.company/campfire/join` still returned 404 at this
review. That public route belongs to the production `campfire` Worker, which
has not received this candidate. The production D1 also still lists migration
`0010_workspace_publication.sql` as pending. The isolated rehearsal invitation
links remain bound to the isolated endpoint; replacing their host text would
send acceptance to the wrong service and database. A branded link can be issued
only after the production route, schema, and admitted-alpha policy pass the
release promotion gate. See `docs/RELEASE_V1_26_2_READINESS_REVIEW.md`.
