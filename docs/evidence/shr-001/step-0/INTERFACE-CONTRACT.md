# SHR-001 interface contract

**Status:** Frozen for the v1.26.2 candidate. Code may not widen this contract
without a recorded amendment. This is not a release decision.

## 1. CLI surface

### `campfire publish`

```text
campfire publish --url <https-endpoint> [--workspace <id>] [--rehearsal-code <code>]
                 [--dry-run] [--no-connect] [--allow-loopback]
                 [--output auto|human|json]
```

- `--url` is required unless `CAMPFIRE_URL` is set. It is canonicalized to an
  origin plus optional API base path. HTTPS is required; `--allow-loopback`
  permits `http://127.0.0.1|localhost|[::1]` for isolated tests only.
- `--workspace` overrides the local profile selection. Ambiguous or missing
  selection is refused.
- `--rehearsal-code` is the operator-held admission capability. It may also come
  from `CAMPFIRE_PUBLICATION_REHEARSAL_CODE`. The Worker stores only its SHA-256.
  The private receipt retains it mode `0600` for retries and recovery; it is
  never printed.
- `--dry-run` takes a read-only snapshot and may write a `not_started` receipt
  only when no publication is active. It makes no network or profile change and
  refuses while a real publication lock exists.
- `--no-connect` skips automatic harness config rewriting. Automatic rewriting
  refuses to replace a config whose local credential is unavailable.
- Human output is a token-free receipt. JSON includes the same receipt and
  warnings. Credentials are never in either output.

The command is resumable: a saved receipt and lock cause the same publication
request to continue from its observed stage. A completed `cut_over` receipt
prints the existing result and does not create another workspace.

### `campfire publish-status`

```text
campfire publish-status [--output auto|human|json]
```

Reads only the private local receipt. No network call. Never prints tokens.

### `campfire publish-recover`

```text
campfire publish-recover [--rehearsal-code <code>] [--output auto|human|json]
```

Uses the saved `cfr_` recovery secret to replace the hosted owner credential.
It revokes the previous human token, verifies the replacement, updates the
private receipt, and updates the remote credentials file when the profile is
already remote. It does not reimport the workspace and never prints a token.

### Existing commands

- `campfire invite-teammate` is unchanged in purpose. It requires a reachable
  hosted endpoint and an owner credential. A local-only profile now fails with
  `nextAction: publish_workspace`; supplying a URL does not publish anything.
- `campfire join --invitation-file ...` is unchanged and is the recipient path.
- `campfire connect --harness ...` is the supported harness rebinding path.

## 2. Hosted routes

All routes accept an optional `/campfire` prefix on the production zone.

### Rehearsal admission gate

Every hosted publication write route (`enroll`, `import`, `recover`) requires:

```text
x-campfire-rehearsal-code: <operator-held code>
```

The Worker configuration holds only
`CAMPFIRE_PUBLICATION_REHEARSAL_CODE_HASH` (SHA-256 hex), as a secret. If the
alpha flag is on but the hash is absent or invalid, all three routes fail closed
with 403. Wrong or missing codes are rejected and counted per source per UTC
hour (default 30). The admission code is not an owner token, invitation secret,
or installer token, and it is not a public-alpha admission mechanism.

### `POST /v1/publication/enroll`

Anonymous only in the sense that it has no actor token; it still requires the
rehearsal admission header above. Body:

```json
{
  "requestId": "pub_<opaque>",
  "humanId": "hum_<local owner id>",
  "humanName": "Sergio",
  "humanTokenHash": "<64 hex>",
  "recoveryHash": "<64 hex>",
  "agents": [
    { "id": "agt_<local agent id>", "name": "Codex", "harness": "codex", "tokenHash": "<64 hex>" }
  ],
  "workspaceName": "Arbora",
  "sourceWorkspaceId": "ws_<local id>",
  "sourcePackageVersion": "1.26.1",
  "sourceSchemaVersion": 10,
  "deviceKeyHash": "<64 hex>"
}
```

- Creates one human, one private organization/team, and fresh token rows only.
  Possession of the prepared owner credential is proven at import, not at this
  identity-creation step.
- Does **not** create a workspace or accept collaboration rows.
- Same `requestId` + same normalized body is idempotent. Same id + different body
  conflicts. A second request for the same `humanId` conflicts.
- Rate limit: 5 enrollments per source per rolling 24 hours (configurable lower
  with `CAMPFIRE_PUBLICATION_ENROLLMENTS_PER_DAY`).
- **Expiry:** there is no separate enrollment capability secret. The enrollment
  record persists so the same request can be retried after a lost response; the
  owner token is durable until revoked. Existing invitation secrets keep their
  1–168 hour expiry. This is deliberate: an expiring enrollment secret would
  strand a prepared local profile with no supported replacement path in this
  slice.
- Returns `workspace_publication_enrollment` with hosted organization/team ids.
  No secret is returned; the client already holds its prepared credentials.

### `POST /v1/publication/import`

Requires `Authorization: Bearer <fresh owner token>` and the rehearsal admission
header. Body:

```json
{ "requestId": "pub_<opaque>", "digest": "<sha256>", "snapshot": { "...": "..." } }
```

- Actor must be the enrolled human owner.
- Snapshot owner must equal the actor. Owner must be the workspace owner
  participant. Team is taken from the enrollment, not from the snapshot.
- The Worker recomputes the digest from canonical content. It validates version,
  counts, ids, references, contribution order, size, allowed contribution object
  types, artifact URLs, auxiliary JSON, all free text, and tenant ownership.
  Free text is rejected if it contains a Campfire token/recovery/invitation
  prefix, a provider-token shape, a private-key header, or an absolute filesystem
  path. The snapshot workspace id and name must equal the enrollment's recorded
  source workspace.
- One D1 batch writes the workspace, participants, humans/agents, sessions,
  goals, tasks, artifacts, findings, decisions, evidence, citations, transitions,
  contributions, and the publication receipt. A failed statement rolls back the
  whole batch.
- Same owner + request + digest returns the original receipt. Same request with
  changed content conflicts. A second workspace for the same owner conflicts.
- A workspace id or object id already used by another tenant conflicts; client
  ids are never authority.
- Owner human and owner-agent rows are updated from the snapshot's provenance
  fields (`created_at`, `external_identity`, `model`) after enrollment; the
  enrollment-created id and owning relationship remain authoritative.

### `POST /v1/publication/recover`

Requires the rehearsal admission header. Body:

```json
{ "requestId": "pub_<opaque>", "humanId": "hum_...", "recoverySecret": "cfr_<32 hex>", "humanTokenHash": "<64 hex>" }
```

- Requires the recovery secret stored privately by `campfire publish`.
- Revokes the human's existing hosted tokens, inserts the prepared replacement,
  and updates the enrollment token hash in one batch.
- It never returns a token and cannot be used without the recovery secret.

## 3. Snapshot schema v1

`format = "campfire.workspace_snapshot"`, `version = 1`. Required top-level
members:

```text
format version workspaceId source owner workspace humans agents participants
sessions goals tasks findings decisions artifacts findingTransitions
decisionTransitions findingEvidence decisionCitations contributions counts digest
```

`digest` is lowercase SHA-256 over canonical JSON of the object with `digest`
and `source.exportedAt` removed. All ids and timestamps are preserved. Team and
organization ids from the local database are recorded only as source metadata;
hosted enrollment supplies the destination ids.

## 4. Limits

| Limit | Value |
| --- | --- |
| Snapshot JSON (canonical) | 256 KiB |
| Total imported rows | 500 |
| Contributions | 300 |
| Owner agents per publication | 16 |
| Single text field | 16 KiB |
| Auxiliary metadata/payload | 4 KiB, depth 5, 100 entries |
| Import request body | 512 KiB |
| Enrollment/import response timeout (client) | 20 s / 30 s |
| Enrollment per source per 24 h | 5 |
| Published workspaces per owner | 1 in this alpha |

Over-limit workspaces fail with `reduce_workspace_scope`; no subset is
imported. This slice does not implement chunked import or a later visibility
switch.

## 5. Receipt states and recovery

| State | Meaning | Recovery |
| --- | --- | --- |
| `not_started` | Preflight/snapshot receipt exists; no hosted enrollment yet | Re-run `campfire publish` |
| `staged` | Hosted owner/team exists; import not committed | Re-run; same request resumes import |
| `committed` | Atomic import committed; verification not complete | Re-run; verifies the committed graph |
| `verified` | Owner and agent reads matched counts, ids, currentness, edges, tip | Re-run; cuts profile over |
| `cut_over` | Remote profile + credentials written; lock released; local database marked read-only backup | `campfire publish-status`; use the remote profile |

Verification is read-only. It does not register an agent session. A retry from
`committed` accepts only extra post-import `register_session` contributions by
an owner agent from an older verifier attempt; any other extra contribution is a
conflict. This makes the crash window idempotent.

After cutover, `publication.cutover` (mode `0600`) marks the local database as a
read-only backup. Supported local writes fail with `use_remote_profile` rather
than allowing a second writable authority. Deleting that marker is an explicit
operator recovery action, not a normal command.

A failed response before commit is retried with the same request id and digest.
A changed snapshot after `committed` is refused; the hosted copy is not cut over.
A failed local profile write is retried from `verified` without another import.
The local database is never deleted. `publication.json` is mode `0600`.

The local write lock is `publication.lock` (mode `0600`) in the Campfire config
directory. While it names the active local database, supported local CLI, HTTP,
and MCP writes fail with `wait_or_resume_publish`; reads remain available.

## 6. Error vocabulary

Stable `nextAction` values added by this slice (including the repaired gate,
recovery, and read-only-backup paths):

```text
publish_workspace
pass_publish_url
use_local_owner_credential
select_local_workspace
remove_unsupported_state
recompute_snapshot
reduce_workspace_scope
retry_publish
resolve_source_change
inspect_publication_state
recover_publication_credentials
restore_publication_receipt
wait_or_resume_publish
resume_or_abandon_publication
```

HTTP status mapping adds `RateLimited → 429` and `Conflict → 409` on the
publication routes. Actor dispatch keeps its existing mapping.

## 7. Out of scope for this contract

Billing, SSO, verified email, organization search, general account console,
hosted Viewer, transcript sync, arbitrary file upload, chunked large imports,
and public self-service enrollment. The alpha gate is not permission to claim a
safe public write route.
