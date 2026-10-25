# SHR-001 hosted recovery drill

**Run:** October 24, 2026 EDT (October 25, 02:08–02:10 UTC)  
**Scope:** Isolated rehearsal D1 export → new remote D1 → record and tenant checks  
**Result:** **PASS for a full-database clone; scoped tenant recovery remains unproven**

This drill copied the already hosted Arbora workspace, including the iMac
contribution, into a newly created D1 database. It did not write to the source
rehearsal D1 or production D1, change a Worker binding, or deploy a Worker.
The temporary recovery database was deleted after verification.

## Target and method

| Item | Recorded value |
| --- | --- |
| Wrangler | Project-local `4.149.0`, run with Node 24 |
| Source | `campfire_shr001_rehearsal`, UUID ending `a66b87`; 37 tables, 495,616 bytes |
| Temporary target | `campfire_shr001_recovery_20261025_4b73`, UUID ending `a2b55`; no Worker binding or route |
| Private full export | 39,299 bytes, SHA-256 `8a3bb08a8281f699d3223ff2a24d12024d3d1de7b2c228529dd4fd0fb51d2ac9` |
| Target after restore | 37 tables, 495,616 bytes |
| Cleanup | Temporary remote D1 deleted; private local SQL, config, and logs removed |

The source identity was checked against the gitignored rehearsal Wrangler
config before export. SQL files were written under a mode-0700 temporary
directory with mode-0600 files. A separate private Wrangler config bound only
the temporary D1. All remote `execute` commands named that temporary database
and included `--remote --config <temporary-config>`.

After the schema and data exports and all clone checks, a second full export
from the source was **byte-for-byte identical** to the first: both SHA-256
values were `8a3bb08a8281f699d3223ff2a24d12024d3d1de7b2c228529dd4fd0fb51d2ac9`.
This establishes that the observed source state did not change across this
drill. It does not make two sequential exports generally atomic when users
are writing concurrently.

A direct `wrangler d1 execute --file` of the full SQL export into the empty
temporary D1 failed twice with Cloudflare's `{"D1_RESET_DO":true}`. A read-only
query after the first failure showed that the target had returned to its empty
state. The drill then exported schema and data separately from the source:
`d1 export --no-data` (18,363 bytes), followed by `d1 export --no-schema`
(20,968 bytes). Importing schema first and data second into the temporary D1
succeeded. The project was not upgraded merely to investigate the error.
Cloudflare documents [export and import through Wrangler](https://developers.cloudflare.com/d1/best-practices/import-export-data/),
but this observed full-file error means the one-command recovery path is not
yet reliable for this database.

## Verification

Read-only count queries returned identical values from source and target:

| Table | Count in each |
| --- | ---: |
| organizations / teams / workspaces | 1 / 1 / 1 |
| humans / agents / workspace participants | 2 / 2 / 4 |
| agent sessions / findings / tasks | 5 / 1 / 1 |
| contributions / workspace publications / enrollment invitations | 17 / 1 / 2 |

On the restored D1, each of these predicates matched exactly one row:

- Workspace `ws_df6794f33efc459b` and finding
  `find_5cd543722a044c20` in that workspace.
- Task `task_3795d9d37d3842e9` in that workspace, attributed to session
  `ses_6bf862bba45c4d4e`.
- Contribution `con_09640a17b9b14ea7` in that workspace, by agent
  `agt_49b4999f33424f55`, in that session, for that task.
- The original workspace publication receipt.

`PRAGMA foreign_key_check` returned no rows. Relationship checks found zero
orphan workspaces, zero participants whose human or agent belonged to another
team, zero cross-team agent sessions, and zero cross-team contributions. This
verifies preserved tenant relationships in the copied data; the source contains
only one tenant, so it does **not** prove selective restore into an existing
multi-tenant database or API authorization on a restored Worker. Those require
separate testing before promising per-tenant recovery.

The source D1 remained present with the same 37 tables and 495,616-byte size
after the temporary target was deleted. No credentials, invitation capabilities,
tokens, SQL data, or private logs are stored with this evidence.

## Operational limits exposed by the drill

1. The successful path used two sequential exports. If the source changes
   between them, schema and data could represent different instants. For a
   live-source backup, quiesce writes or derive both import stages from one
   consistent export; test that exact procedure before treating this as a
   point-in-time recovery guarantee. This drill's matching before/after export
   hashes resolve that risk for this run only.
2. Import into a new empty D1 preserves records and attribution, but does not
   switch a Worker binding or client profile. A cutover requires a separately
   reviewed deploy and verification of existing credentials, invitations,
   authorization, and current source tip.
3. The pre-publication MacBook SQLite copy is stale after the iMac task. Keep
   hosted backups or D1 Time Travel within its retention window. Never restore
   that local copy over later hosted contributions.
4. A full-database clone is an operator disaster-recovery step, not a selective
   tenant restore. The future public multi-tenant product needs a scoped,
   collision-safe tenant export/import and an independent two-tenant drill.
