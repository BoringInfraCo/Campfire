# SHR-001 Step 0 — freeze before product code

**Date:** October 23, 2026  
**Status:** Frozen engineering contract for the v1.26.2 candidate  
**Label:** FIXTURE + INSTALLED-LOCAL EVIDENCE — engineering evidence only; no two-Mac outcome is claimed  
**Contract:** `docs/Campfire-v1.26.2-SHR-001-Publish-and-Share.md`  
**Baseline:** v1.26.1, per `docs/RELEASE_V1_26_1_DECISION.md`

This step freezes the interface, snapshot allowlist, trust model, limits, and
receipt vocabulary. It does not publish, deploy, package, or release v1.26.2.

**Sequencing note:** the bundle and the candidate code were produced in the same
working session, not contract-first. The frozen documents match the code; the
deviation is recorded in `docs/SPRINT_SHR_001_RESULT.md` §4.8 and is not a
substitute for an independent pre-code review.

## 1. Released baseline pins

| Fact | Frozen value |
| --- | --- |
| Package | `1.26.1` |
| Private annotated tag object | `3316424b5dde93a799aa46afea558390fc518bdf` |
| Private source commit | `3fa35163c8a2c86d92732fd4cc0d4051c3be481d` |
| Public snapshot commit | `dd2be6c` |
| Production Worker version | `785c8415-5d58-4cd9-9a57-97aef22b78ad` |
| Production D1 migration | `0009_action_proposals.sql` (11 commands) |
| Installer base SHA-256 | `2256bccb086d3c83e9a997de46285e5ad5175bb3f696a6641322b16ccba8a844` |
| Installed CLI at capture | `1.26.1` (`~/.local/lib/campfire/package.json`, wrapper `~/.local/bin/campfire`) |
| Local schema at capture | `10` |
| Source capture commit | `b172199` plus the SHR-001 working tree; not the release source |

The complete publication record is `docs/RELEASE_V1_26_1_DECISION.md`. The
current candidate adds D1 migration `0010_workspace_publication.sql`; it is not
applied to production by this record.

## 2. Installed local capture (token-free)

The ordinary local profile at `/Users/sergio/.config/campfire-arbora/config.json`
selects `/Users/sergio/.local/share/campfire-arbora/campfire.db`. The database
was opened read-only. No credential file, token, or token hash was read.

| Fact | Observed value |
| --- | --- |
| Local schema version | `10` |
| Workspace | `ws_df6794f33efc459b` (`Arbora`, active) |
| Owner | `hum_156ff89c089f4d13` (`Sergio`) |
| Workspace agent | `agt_955034ffb2544082` (`Codex`, codex) |
| Other owned agent | `agt_6a1e3951124f46b5` (`OpenCode`, opencode), not a workspace participant |
| Goal | `goal_4c89cc049e7445c7` |
| Finding | `find_5cd543722a044c20`, current, created by Codex |
| Sessions | `ses_41d6dfc921824a18`, `ses_b790c6652d944c40` (both Codex) |
| Contribution tip | `8` |
| Object counts | humans 1, agents 1, participants 2, goals 1, tasks 0, findings 1, decisions 0, artifacts 0, sessions 2, evidence 0, citations 0, contributions 8 |
| Historical invite | `inv_b4ad888cdf0a4b01`, consumed; not current authority |
| Unsupported state | none after excluding consumed invite authority |
| Snapshot SHA-256 (v1.26.1 capture) | `4bb1b5fac9e284dd55fa8d185860aa771719993b420853424690ed9ecf7a477d` |
| Snapshot SHA-256 (v1.26.2 candidate) | `4c8496e92290db32d1efe21411686e87bb6c0e26e4706dfaf9bf0091e5bba757` |

The finding summary and other record text are not repeated here. The answer key
is `ANSWER-KEY.md`; the digest is over the canonical allow-listed snapshot
without `digest` and without export time.

## 3. Reproduction

```sh
cd Campfire-Internal
npx tsx -e "import {inspectPublicationSource,readWorkspaceSnapshot} from './src/publication/snapshot.ts';
const db='/Users/sergio/.local/share/campfire-arbora/campfire.db';
const i=inspectPublicationSource(db,'ws_df6794f33efc459b','hum_156ff89c089f4d13');
console.log(i);
const s=readWorkspaceSnapshot({databasePath:db,workspaceId:'ws_df6794f33efc459b',
ownerHumanId:'hum_156ff89c089f4d13',packageVersion:'1.26.1',exportedAt:new Date().toISOString()});
console.log(s.digest, s.counts, s.source.contributionTip);"
```

Expected: unsupported is empty; the digest and counts match the table above.
The command is read-only. Do not paste credentials into it. The package version
is part of the digest by design; the v1.26.1 digest is retained as capture
evidence, while the v1.26.2 candidate digest is the rehearsal value.

The installed failure was also reproduced at the CLI boundary: a local profile
has `http://127.0.0.1:9414`, while `campfire invite-teammate` requires a
teammate-reachable endpoint and a credential for that endpoint. It never copies
local rows. `campfire publish` is the new bridge.

## 4. Frozen design decisions

1. **One owner, one private namespace.** Enrollment creates a fresh hosted human,
   organization, team, and token hashes. It does not create a workspace. Import
   creates the workspace and all allowed rows atomically.
2. **Possession-bound private alpha with rehearsal admission.** Every hosted
   publication write route requires `CAMPFIRE_PUBLICATION_ALPHA=1` plus the
   operator-held rehearsal code whose SHA-256 is configured as a Worker secret.
   The alpha flag alone fails closed. The route is rate-limited per source and
   accepts a client-prepared owner token hash plus recovery hash. It does not
   verify an email address. This is a private-rehearsal mechanism, not public
   self-service.
3. **Separate authorities.** Local bearer tokens, invitation secrets, installer
   tokens, and hosted owner tokens are never interchangeable. Import requires
   the fresh owner token.
4. **One bounded batch.** The snapshot is at most 256 KiB and 500 rows / 300
   contributions. A larger workspace is refused with a specific reason. This
   slice does not chunk or expose partial visibility.
5. **Digest and retry.** SHA-256 over canonical JSON of the allow-listed content,
   excluding `digest` and `source.exportedAt`. Same owner + request + digest is
   idempotent; changed content conflicts.
6. **Cutover.** A local write lock covers snapshot → import → verify → profile
   write. Verification is read-only; a committed retry tolerates only extra
   owner-agent `register_session` rows from an older verifier attempt. The
   remote profile is written before credentials. The local database is retained
   and marked as a read-only backup after cutover; it remains inspectable.
7. **Receipts.** `not_started → staged → committed → verified → cut_over` only.
   A receipt never reports a later stage than the observed one.
8. **No silent skip.** Unsupported state fails closed, including residual action
   receipts/reservations/mutation receipts and GitHub ingress rows. Historical
   consumed invitations remain provenance contributions but the invite table is
   not imported and grants no authority. Every exported free-text string is
   scanned for credential-shaped values and absolute paths.

## 5. Open risks recorded before coding

- Public self-service is not safe yet. The alpha gate, per-source budget, and
  one-workspace-per-owner rule are deliberate; an explicit abuse and cost review
  is still required before opening enrollment publicly.
- The hosted owner proof is possession of a client-generated credential and
  recovery secret, not a verified human identity. Account recovery is bounded to
  that secret; there is no email recovery.
- The private import route is a new write boundary. It is covered by deterministic
  tests for auth, isolation, digest, replay, no-partial-visibility, and tenant
  separation. It has not been load-tested against production D1 limits.
- The two-Mac acceptance is a one-operator rehearsal. It does not satisfy the
  older Sprint 020 or WCO-001 two-human gates.
- No production deployment, v1.26.2 package, or release is claimed.

## 6. Step 0 deliverable status

| Deliverable | Status |
| --- | --- |
| Token-free installed reproduction + source/schema pins | Captured for the Arbora local profile; release pins recorded |
| Hosted ownership, recovery/revocation, abuse, operator responsibility | Frozen in `INTERFACE-CONTRACT.md` and `THREAT-MODEL.md` |
| Table-by-table manifest, relationships, exclusions, answer key | Frozen in `SNAPSHOT-MANIFEST.md` and `ANSWER-KEY.md` |
| Staging, visibility, idempotency, cutover, rollback receipts | Frozen in `INTERFACE-CONTRACT.md` |
| Failing end-to-end acceptance, separate from fixture invitation tests | Added at `tests/acceptance/shr-001-publish-share.test.ts` and passing |

Passing engineering checks do not convert this bundle into a release decision.
