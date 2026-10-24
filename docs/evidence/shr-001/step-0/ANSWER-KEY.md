# SHR-001 validation answer key

**Source:** installed local profile `/Users/sergio/.config/campfire-arbora`  
**Database:** `/Users/sergio/.local/share/campfire-arbora/campfire.db` (read-only)  
**Captured:** October 23, 2026  
**Label:** INSTALLED-LOCAL EVIDENCE. No Cloud import or two-Mac pass is claimed.

## 1. Identity

```text
workspaceId          ws_df6794f33efc459b
workspaceName        Arbora
workspaceStatus      active
ownerHumanId         hum_156ff89c089f4d13
ownerHumanName       Sergio
ownerAgentId         agt_955034ffb2544082
ownerAgentName       Codex
ownerAgentHarness    codex
goalId               goal_4c89cc049e7445c7
findingId            find_5cd543722a044c20
sessionIds           ses_41d6dfc921824a18, ses_b790c6652d944c40
historicalInviteId   inv_b4ad888cdf0a4b01  (consumed; not authority)
```

OpenCode agent `agt_6a1e3951124f46b5` exists in the local profile but is **not a
workspace participant** and has no session or contribution in this workspace.
It is not part of this publication; the CLI warns rather than inventing
membership.

## 2. Counts at the source tip

| Family | Count |
| --- | --- |
| humans | 1 |
| agents | 1 |
| participants | 2 |
| sessions | 2 |
| goals | 1 |
| tasks | 0 |
| findings | 1 |
| decisions | 0 |
| artifacts | 0 |
| finding transitions | 0 |
| decision transitions | 0 |
| finding evidence | 0 |
| decision citations | 0 |
| contributions | 8 |
| contribution tip | 8 |

## 3. Currentness and attribution

```text
finding find_5cd543722a044c20 current
createdBy agt_955034ffb2544082 (agent)
agentSessionId ses_b790c6652d944c40
summary SHA-256 626148f1d16457f6b3f4bafa675fff32d2aa54e6e1f79a52e5ac291fe96045f7
```

The summary hash is `printf '%s' "<summary>" | shasum -a 256`; it lets a
verifier compare content without repeating the record text. A previous record
used a trailing newline and produced `afe966d9…`; that value is superseded.

## 4. Contribution order

```text
1 create  workspace          ws_df6794f33efc459b
2 join    participant        hum_156ff89c089f4d13
3 create  goal               goal_4c89cc049e7445c7
4 create  invite             inv_b4ad888cdf0a4b01   (historical provenance only)
5 join    participant        agt_955034ffb2544082
6 register_session agent_session ses_41d6dfc921824a18
7 register_session agent_session ses_b790c6652d944c40
8 create  finding            find_5cd543722a044c20
```

## 5. Snapshot digest

```text
v1.26.1 capture     4bb1b5fac9e284dd55fa8d185860aa771719993b420853424690ed9ecf7a477d
v1.26.2 candidate   4c8496e92290db32d1efe21411686e87bb6c0e26e4706dfaf9bf0091e5bba757
```

Computed from the canonical allow-listed snapshot with `digest` and
`source.exportedAt` removed. The package version is intentionally part of the
digest, so versioning the candidate changes it. A second read at tip 8 with the
same package version must produce the same digest. The old digest stays as
evidence of the v1.26.1 capture; it is not the v1.26.2 rehearsal answer.

## 6. Acceptance answer key

The engineering acceptance at
`tests/acceptance/shr-001-publish-share.test.ts` uses a deterministic fixture
with the same workspace and finding ids. It requires:

| Check | Expected |
| --- | --- |
| Publish state | `cut_over` |
| Source tip | `10` in the fixture (the installed Arbora tip is `8`) |
| Owner finding read | `find_5cd543722a044c20`, current |
| Agent finding read | same id and content after publish |
| IMac join | own human and OpenCode agent identities, not the owner's |
| IMac task creator | the iMac agent identity, not the owner |
| MacBook local service | never started during the iMac phase |
| Fresh MacBook read | the iMac task id and title from the hosted service |
| Credential transfer | local `cft_` tokens do not equal hosted tokens |

For the real Arbora rehearsal, the expected task is any task whose description
contains `find_5cd543722a044c20`, created by the iMac agent identity after its
session registration. No title is prescribed here.

## 7. Not claimed

No hosted Arbora copy was created by this capture. No two-Mac run, production
deployment, v1.26.2 package, release, or public self-service claim follows from
this answer key.
