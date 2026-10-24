# SHR-001 threat model and operator responsibility

**Status:** Frozen before coding the public write route. This is a private-alpha
boundary. It does not claim public self-service safety.

## 1. Assets and authorities

| Asset | Authority | Never becomes |
| --- | --- | --- |
| Local SQLite workspace | Local human owner + workspace membership | A portable credential |
| Local actor token | One actor at one endpoint | A hosted owner credential |
| Hosted owner token | One enrolled human owner | An invitation or installer token |
| Hosted agent token | One agent owned by that human | Owner authority |
| Enrollment invitation secret (`cfe_`) | One bounded teammate enrollment | A publication credential |
| Installer token | One anonymous installation claim | An actor credential |
| Recovery secret (`cfr_`) | Replacement of one hosted owner token | A general account password |
| Rehearsal admission code (`cfrh_`) | Admission to this private rehearsal | A public-alpha admission, owner token, or invitation |
| Publication receipt | Local recovery state | A bearer capability if shared without credentials |

## 2. Threats and controls

| Threat | Control |
| --- | --- |
| Agent self-authorizes hosted ownership | Local publish requires the active human owner credential and an owner participant. Agent sessions cannot initiate enrollment. The hosted admission code is operator-held and is never an owner token; an agent with that code and local network access is a recorded residual risk. |
| Anonymous caller writes arbitrary workspace rows | Enrollment creates no workspace and accepts no rows. Every publication write route requires the rehearsal admission header; import also requires the fresh owner token and one atomic allow-listed graph. The alpha flag alone fails closed if no admission hash is configured. |
| Wrong or missing admission code floods account creation | Per-source UTC-hour attempt cap (default 30) plus the enrollment count cap; no request body or code is stored. |
| Credential/path leak in free text | All snapshot strings are scanned for Campfire/provider token shapes, private-key headers, and absolute filesystem paths before the digest and write. |
| Second tenant reads/overwrites/invites | Actor resolution precedes retrieval; every write is workspace-scoped; imported workspace/object ids are globally unique and conflicts fail the batch. |
| Client-supplied ids grant authority | IDs are data, never authorization. Owner binding, participant role, session ownership, and workspace membership are checked separately. |
| Local bearer token is replayed remotely | Local tokens/hashes are never exported. The client generates fresh endpoint-bound tokens; the server stores only hashes. |
| Invitation secret is reused as owner credential | Separate route, separate prefix, separate resolution. Invitation redemption creates a `member`, never an owner. |
| Malicious snapshot | Version, digest, size, counts, ids, references, edges, currentness, contribution order, artifact URLs, and auxiliary JSON are validated before the batch. |
| Digest substitution | The Worker recomputes SHA-256 over canonical content; a client-supplied digest alone is insufficient. |
| Partial import becomes visible | One D1 batch; a failed statement rolls back. There is no staged workspace readable by ordinary reads. |
| Duplicate workspace after lost response | Owner + request + digest receipt. Exact retry returns the original receipt; changed content conflicts. |
| Local and hosted copies diverge | Local write lock covers finalization; the client re-reads the local tip and digest; the profile is cut over only after verification. The local database remains a backup, not a second active authority. |
| Crash during verification | Verification is read-only and writes no session. A retry from `committed` accepts only extra owner-agent `register_session` rows from an older verifier attempt; any other tip change conflicts. |
| Crash during profile write | Remote profile is written before credentials; the private receipt carries the credentials and stage. Re-running repairs the same publication without another import. |
| Lost owner token | `campfire publish-recover` uses the private `cfr_` secret and the admission code, revokes the old human token, verifies the replacement, and updates local state and remote credentials without printing a token. |
| Rollback/abandonment confusion | Receipt states are monotonic and explicit. A committed hosted copy is never silently deleted. Recovery requires an operator decision recorded outside the receipt. The local database becomes a read-only backup after cutover unless the operator explicitly removes `publication.cutover`. |
| Credential leak in logs/output | Tokens are never printed by publish, publish-status, human receipts, JSON receipts, invitations, or the Viewer. The receipt file is `0600`. |
| Credential leak in imported content | Secret-like keys, token-shaped values, private-key headers, filesystem paths, URL userinfo, and credential-bearing artifact URL query/fragment keys are refused. |
| Rate/abuse exhaustion | Alpha gate, 512 KiB import cap, 256 KiB / 500-row snapshot cap, 5 enrollments/source/day, one workspace per owner, bounded timeouts. |
| Recovery becomes account takeover | Recovery requires both the request id and the privately stored `cfr_` secret; it revokes the prior human token and returns no token. |
| Operator overclaim | No production deployment, two-Mac pass, or public self-service is claimed. The alpha flag is not a public launch gate. |

## 3. Operator responsibility

Before enabling `CAMPFIRE_PUBLICATION_ALPHA=1` on a hosted deployment:

1. Apply D1 migration `0010` and verify the Worker version and schema.
2. Keep the flag off until the abuse/cost review is recorded. The route is not
   public self-service merely because it is implemented.
3. Store `CAMPFIRE_PUBLICATION_REHEARSAL_CODE_HASH` as a Worker secret. With the
   alpha on and no hash, enrollment/import/recovery fail closed. Share the raw
   `cfrh_` code only with the planned rehearsal operator.
4. Set `CAMPFIRE_PUBLICATION_ENROLLMENTS_PER_DAY` and
   `CAMPFIRE_PUBLICATION_ADMISSION_ATTEMPTS_PER_HOUR` to values the deployment
   can afford; defaults are 5 and 30.
5. Monitor enrollment, admission failures, import volume, D1 storage, and Worker
   errors by route without logging request bodies, tokens, codes, source
   addresses, or workspace content.
6. Retain workspace data according to the deployment's policy. This code adds
   no automatic deletion or archival.
7. Treat the hosted owner token as a bearer credential. Revoke it through the
   supported actor-token revocation path, or use `campfire publish-recover` when
   the original token is lost. There is no email-based account reset.
8. Do not describe a tunnel, a copied finding, a backend-only test, or a
   `staged`/`committed` receipt as a completed publication.

## 4. Known gaps in this alpha

- Human proof is possession of a locally generated credential, recovery secret,
  and the operator-held rehearsal admission code. There is no verified email,
  SSO, or identity provider. The enrollment record itself has no secret expiry;
  it proves nothing until the owner token and admission code are presented at
  import. Invitation secrets keep their existing expiry. The admission code is a
  private-rehearsal control, not public-alpha admission.
- Per-source rate limiting is a D1 count check, not a distributed token bucket.
  A burst can exceed the budget before rows land; the cap remains a bound, not a
  precise quota.
- The import body limit and single batch are deliberately small. Large
  workspaces are refused, not chunked.
- The hosted copy is one D1 tenant namespace; there is no per-tenant database or
  customer-managed key.
- The two-Mac rehearsal is one operator. It does not satisfy two-human gates.
