# WCO-001 scoring form — frozen C1–C7

One sheet per case. Each item is **PASS**, **FAIL**, or **NOT OBSERVED**. A
missing answer or inaccessible evidence is not a PASS. C1–C6 are required for a
complete case; C7 is reported separately and never inferred from instructed
return. Print exact record ids, verbatim participant statements, and the
scorer's reason per item.

## Case header

| Field | Value |
| --- | --- |
| Date / participants | |
| Instructed use? (yes/no and by whom) | |
| Workspace / task ids | |
| Source commit + package version | |
| Frozen source position (orientation cursor) | |
| Recorder | |
| Second reviewer | |
| Manual help / confounds | |

## Item scores

| Item | Verdict | Verbatim evidence / record ids | Reason | Second review | Resolved |
| --- | --- | --- | --- | --- | --- |
| **C1 — separate authority** (critical) | | | | | |
| **C2 — orientation** | | | | | |
| **C3 — decision safety** (critical) | | | | | |
| **C4 — useful dependency work** (critical) | | | | | |
| **C5 — durable contribution** (critical) | | | | | |
| **C6 — reciprocal continuation** (critical) | | | | | |
| **C7 — voluntary return** (separate; later day, unprompted) | | | | n/a | n/a |

Pass requires: C1 distinct recorded actors and B reads only through B's
membership, with agent writes carrying the owning human/session provenance; C2
B identifies the correct goal, task, recorded assignee/status, blocker, and
incomplete lists, naming source ids rather than A's recap; C3 B describes the
relevant decisions including currentness/proposals/needs-review/historical and
surfaces any unresolved conflict without executing either rule; C4 a real,
checkable action resolves or truthfully advances the frozen blocker (a
declaration alone fails; a recorded checkable escalation can be the keyed safe
outcome); C5 durable Task/Finding/Decision/Artifact state with correct
provenance and source linkage a later reader can inspect without a private
transcript or hand-prepared recap; C6 A or Agent A returns in a fresh process,
reads B's contribution, and takes a checkable dependent next action or correctly
records why the next action remains blocked; C7 a later-day unprompted use is
logged with task and source position.

## Recorder notes

- Any answer supplied outside Campfire that changed the outcome (confound):
- Reference-open attempts (record separately; VIS-001 condition 4):
- Deviations from the frozen key or runbook:
- If the real task changed independently, describe the change and score only
  what the retained evidence still supports:

## Verdict cover sheet

Contract §8 rules: **GO** requires one complete ordinary-work case meeting C1–C6,
all critical safety items passing, second review agreeing or resolving against
the frozen key, and any §4.2 code change passing D1–D6 plus release checks.
**CONDITIONAL GO** requires a bounded repair passing D1–D6 with an eligible
post-repair human case unavailable for a recorded reason. **UNSCORED** when no
eligible case opened and no implementation judged. **NO-GO / REFRAME** for any
critical failure, a decisive private transcript/recap, an unauthorized read,
wrong provenance or decision status, an untruthfully representable dependency,
or a repair that fails D1–D5.

| Field | Value |
| --- | --- |
| Case verdict (GO / CONDITIONAL GO / UNSCORED / NO-GO-REFRAME) | |
| Waivers / overrides (none unless separately recorded) | |
| Remaining unmeasured facts | |
| Exact public claim this case supports (pair, task, workspace only) | |
