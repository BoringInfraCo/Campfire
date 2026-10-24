# Sprint SHR-001 result — Publish and Share the First Local Workspace

**Date:** October 24, 2026 (repair amendment)  
**Contract:** `docs/Campfire-v1.26.2-SHR-001-Publish-and-Share.md`  
**Verdict:** **CONDITIONAL GO — repaired engineering candidate; two-Mac acceptance pending**  
**Candidate:** `1.26.2` unreleased archive; no public tag, GitHub Release, channel update, or production deployment  
**Two-Mac acceptance:** **NOT OBSERVED**

## 1. What was implemented

The candidate adds one local-to-hosted publication path:

- `campfire publish` with read-only preflight, resumable receipt,
  `campfire publish-status`, and `campfire publish-recover`.
- A read-only local snapshot at one append tip, with a table/column allowlist,
  canonical SHA-256 digest, size/row limits, unsupported-state refusal, artifact
  URL and all-free-text credential/path scanning.
- A private hosted enrollment boundary (`POST /v1/publication/enroll`) behind
  `CAMPFIRE_PUBLICATION_ALPHA=1` **and** an operator-held rehearsal code whose
  SHA-256 is a Worker secret. The alpha flag alone fails closed. Per-source
  enrollment and admission-attempt limits bound abuse.
- A private atomic import (`POST /v1/publication/import`) requiring the fresh
  owner token and admission code, with digest recomputation, owner/workspace
  binding, source-provenance replacement, idempotent retry, changed-content
  conflict, and one D1 batch with no partial visibility.
- Hosted credential recovery (`POST /v1/publication/recover`) with a supported
  CLI path and route tests.
- A local write lock over finalization, read-only owner/agent verification,
  remote-profile cutover, a cutover marker that keeps the local database as a
  read-only backup, and explicit receipt states.
- D1 migration `0010_workspace_publication.sql` and the matching bundled schema.
- Canon amendment in `docs/PRODUCT_DEFINITION.md` and `docs/ARCHITECTURE.md`.
- CLI catalog/help, README, operator recovery guidance, and Step 0 evidence.
- Candidate record, source position, checksum, isolated endpoint, and gate
  matrix in `docs/RELEASE_V1_26_2_CANDIDATE.md`. The record is labelled
  candidate/unreleased.

## 2. Dated evidence matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| Step 0 installed baseline and source/schema pins | **PASS** | `docs/evidence/shr-001/step-0/STEP0.md`; v1.26.1 pins from `docs/RELEASE_V1_26_1_DECISION.md` |
| Installed Arbora capture, token-free | **PASS** | `ANSWER-KEY.md`: tip 8, 8 contributions, one current finding; v1.26.1 digest `4bb1b5fa…477d`, v1.26.2 candidate digest `4c8496e9…a757` |
| Rehearsal admission gate | **PASS** | `tests/worker/shr-001-publication.test.ts`: missing/wrong code, unconfigured hash, and alpha-off all reject; matching code admits |
| All-free-text credential/path scan | **PASS** | `tests/unit/shr-001-snapshot.test.ts`: token in finding summary and absolute path in decision rationale refused |
| Crash-safe committed verification | **PASS** | `tests/unit/shr-001-verification.test.ts`; `tests/acceptance/shr-001-publish-share.test.ts` committed-retry case |
| CLI + route recovery | **PASS** | `tests/worker/shr-001-publication.test.ts`; `tests/integration/shr-001-publish-cli.test.ts` `publish-recover` |
| Provenance, workspace binding, unsupported state, digest hardening | **PASS** | Worker publication tests; snapshot tests; `assertHostedActivityPrefix` |
| Canon amendment and threat model | **PASS** | `docs/PRODUCT_DEFINITION.md` §15 exception; `docs/ARCHITECTURE.md` SHR-001 subsection; `THREAT-MODEL.md` |
| Snapshot manifest and answer key | **PASS** | `SNAPSHOT-MANIFEST.md`, `ANSWER-KEY.md` |
| Interface contract and receipt vocabulary | **PASS** | `INTERFACE-CONTRACT.md`; `src/domain/publication.ts`; CLI catalog |
| Local snapshot allowlist, limits, unsupported refusal | **PASS** | `tests/unit/shr-001-snapshot.test.ts`; real Arbora read-only capture |
| Owner enrollment, auth, tenant isolation | **PASS** | `tests/worker/shr-001-publication.test.ts` |
| Atomic import, no partial visibility, idempotent retry | **PASS** | `tests/worker/shr-001-publication.test.ts` (including a forced row conflict) |
| Digest tamper and changed-content conflict | **PASS** | `tests/worker/shr-001-publication.test.ts` |
| Local-write freeze and private receipt handling | **PASS** | `tests/unit/shr-001-guard.test.ts` |
| Publish → invite → join → read with source offline (engineering) | **PASS** | `tests/acceptance/shr-001-publish-share.test.ts` |
| CLI supported path | **PASS** | `tests/integration/shr-001-publish-cli.test.ts` |
| Full existing suite | **PASS** | 127 files, 1518 tests (1517 passed, 1 skipped) after repair and catalog updates |
| Installed Arbora snapshot import | **PASS** | `tests/worker/shr-001-installed-capture.test.ts` re-reads the captured database and imports the same finding into an isolated D1 handler |
| Clean installed v1.26.2 candidate → isolated Worker | **PASS** | Candidate record: source `1fa4e4d`, Darwin ARM64 checksum `ad3d74c…19c9`, isolated endpoint and Worker version recorded |
| Isolated D1 migration `0010` and schema | **PASS** | 10 migrations applied; publication tables present; initial enrollments 0 |
| Rehearsal admission gate remotely | **PASS** | Alpha off / no hash / missing code / wrong code all 403; correct code + invalid body 400; no rows created |
| Two physical Macs, MacBook service offline | **NOT OBSERVED** | Requires the operator’s MacBook/iMac rehearsal |
| Hosted Arbora copy | **NOT CREATED** | The isolated rehearsal is the next step; no production copy |
| Production D1 migration `0010`, Worker deployment | **NOT DONE** | The candidate uses a distinctly named test Worker/D1 only |
| v1.26.2 public tag, GitHub Release, channels | **NOT DONE** | Candidate is unreleased by instruction |
| Public self-service abuse/cost review | **NOT DONE** | Rehearsal admission is not public-alpha admission |

## 3. Security and data-integrity gates

- **Owner authority:** local publish requires the active human owner credential
  and owner participant. Agent sessions cannot initiate through the CLI. Hosted
  publication writes require the operator-held admission code and, for import,
  the fresh enrolled owner token. An agent with both the local files and the
  admission code remains a recorded private-rehearsal residual risk; this is not
  public-alpha admission.
- **No cross-tenant access:** second-owner reads and invitations return 403;
  globally unique ids and workspace participation are checked before any write.
  Client ids are not authority. Import is bound to the enrolled source workspace
  id and name.
- **Credentials:** local tokens/hashes are not exported. Fresh hosted owner and
  agent tokens are generated locally; only hashes reach D1. Receipts never print
  secrets and are mode 0600. Recovery revokes the prior owner token.
- **Completeness:** allow-listed families, edges, currentness, evidence,
  citations, contribution order, source tip, owner/agent provenance, and all
  free text are compared/validated. Unsupported action/GitHub state fails closed.
- **Failure recovery:** exact retry is inert; changed content conflicts; a forced
  row collision leaves no workspace visible; committed verification is read-only
  and tolerates only older owner-agent session registrations; cutover is
  repair-able from the verified receipt; the local database becomes read-only.
- **Operational guard:** global alpha, rehearsal admission hash (fail closed),
  30 admission attempts/source/hour, 5 enrollments/source/day, 512 KiB request
  cap, 256 KiB/500-row import cap, one workspace/owner, bounded timeouts. Public
  self-service remains blocked.

## 4. Known gaps carried

1. The real two-Mac rehearsal was not run. The acceptance test uses two isolated
   profiles and a real HTTP Worker boundary in one process; that is engineering
   evidence, not a physical-machine observation.
2. No production endpoint was deployed. The isolated rehearsal uses a distinctly
   named test Worker/D1 and a separate candidate checksum.
3. The installed Arbora workspace was captured read-only; it is not claimed
   published until the physical rehearsal.
4. Hosted human proof is possession of a client-generated credential plus the
   operator-held rehearsal code, not a verified email/account identity. Public
   signup requires a separate abuse, identity, and cost review.
5. The single-batch limit refuses larger workspaces; chunked import and a later
   visibility switch are future work.
6. Local profile write failure is recoverable by design and the committed-retry
   path is tested; a true filesystem fault injection is not part of the battery.
   The local database is read-only after cutover.
7. A nonparticipant owner agent (OpenCode in the captured profile) is not
   published as a workspace participant. The CLI warns and the operator can
   enroll/reconnect that harness separately.
8. **Step 0 sequencing deviation:** the Step 0 contract, threat model, Canon
   amendment, and implementation were produced in the same working session
   rather than contract-before-code. The frozen documents match the code, but
   this is not evidence of a separate pre-code design review. A release review
   must treat the contract as candidate-coupled until independently reviewed.

## 5. Disposition

SHR-001 is **engineering-complete for the bounded private-alpha slice** and
**not release-complete**. Do not call v1.26.2 published, deployed, or a fix for
the observed user pain until:

1. the distinctly named isolated Worker and D1 have migration `0010`, the
   admission hash, and a verified gate matrix;
2. the real MacBook → hosted → iMac → fresh MacBook rehearsal passes with the
   MacBook service offline; and
3. a dated release review records the two-Mac evidence and the abuse/cost
   decision.

Until then, the correct label is: **repaired candidate; isolated rehearsal ready;
two-Mac acceptance NOT OBSERVED; public release held.**
