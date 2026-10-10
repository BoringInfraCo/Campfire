# Telemetry audit — snapshot reproduction and traffic classification

**Date:** 2026-10-10
**Dataset:** `campfire_telemetry` (account `1c1597c473c77c9ea49a53b4d62fdb2d`)
**Access:** Cloudflare MCP `post_accounts_analytics_engine_sql` — no `CLOUDFLARE_API_TOKEN` required
**Snapshot cutoff under audit:** `timestamp < toDateTime('2026-10-10 05:40:00')`
**Production writes:** none. Every query is a `SELECT`.

Exact executed SQL and verbatim raw responses are in `results.json`.

## Reproduced

| Figure | Query | Result |
|---|---|---|
| 536 | `count(DISTINCT blob8)`, `active`, floor applied, before cutoff | **536** |
| 2,096 | `count()`, all rows, before cutoff | **2,096** |
| 2,072 | client-event rows before cutoff | 2,072 |

Both figures reproduced **exactly**. The dataset has only grown since
(2,096 → 2,135), consistent with a real live query at the stated moment.

## Blob layout (authority: `src/telemetry/contract.ts:363-385`)

```
blob1 event        blob2 schemaVersion   blob3 campfireVersion
blob4 os           blob5 arch            blob6 installMethod
blob7 surface      blob8 installationId
```

There is **no harness column**. Schema version 1 writes exactly `blob1`–`blob8`.

## Version floor

`TELEMETRY_MIN_REPORTING_VERSION = "1.9.1"`. Telemetry shipped whole-clique in
v1.9.1, so a binary below the floor has no telemetry code and cannot emit a
schema-v1 event by any route. Applied as a prefix predicate, **not** a lexical
comparison — `1.10.0` sorts before `1.9.1` as text.

## Findings

**1. Sampling is active; 536 is a lower bound.** 4 of 540 `active` rows carry
`_sample_interval = 2`. Distinct-ID counts cannot be sample-weighted, so they
undercount. This establishes that sampling occurred in the 536 population, not
how many IDs were lost — direction is downward, magnitude **unknown**.

**2. 668 installation IDs are provably fabricated.** They declare version
`1.2.0`, below the telemetry floor, so no such binary could emit these events.
They produce `install_completed` only, never a downstream event. This is the one
class established as fabricated on evidence rather than inference.
`src/telemetry/contract.ts:243-245` independently records the same finding.

**3. Zero observed ID overlap between the forged and plausible-version
streams.** An ID-intersection query — grouping by `blob8` with conditional
aggregation over one explicit window — returns **0** IDs carrying both a forged
1.2.0 `install_completed` and an above-floor `activated`/`active` event, in the
Oct 9 burst window, the full snapshot window, and a window aligned to the burst
grouping.

Read this precisely: **zero overlap in retained rows.** Sampling is active in
this dataset, so an event that would establish an overlap could itself be
absent. This refutes the earlier *claim of observed same-ID traffic*; it does
**not** prove the underlying streams never overlap.

Two alignment errors were found and corrected while establishing this, and they
are worth distinguishing because they are independent:

| Error | Clean comparison | Fix |
|---|---|---|
| Time window: intersection ended `05:00:00`; burst grouping swept the whole `05:00–05:59` hour | **174 vs 204** forged IDs, both at all-OS scope | Re-ran on the aligned half-open window |
| Scope: intersection has **no OS filter**; burst grouping filters `blob4='linux'` | **204 vs 180** forged IDs, both in the aligned window | Re-ran OS-scoped |

The two comparisons isolate one variable each. `174 vs 180` is not a clean
contrast: those counts differ in **both** time window and OS scope at once, so
the gap cannot be attributed to either alone.

The 24-ID remainder is fully accounted for by scope: in the aligned window the
204 forged IDs split **180 linux + 24 darwin**. The time-window fix aligned the
windows but did **not** make the denominators comparable — a second, separate
correction was needed.

The directly comparable query (`blob4='linux'`, aligned window) returns **0**,
matching the burst table's 180-ID denominator exactly. Darwin-scoped also
returns 0. The refutation holds at the scope the burst claim was made at.

**4. Recurrence is near zero.** Of 549 IDs with an `active` event, exactly one
returns, and it is darwin (5 days). Linux recurrence is zero. This justifies
investigation, not a conclusion: an ephemeral job and a one-time human trial both
produce a single non-recurring ID.

## Withdrawn

An earlier draft of this audit claimed that within the Oct 9 02:00–05:00 window,
**the same installation IDs** appeared as `install_completed` at 1.2.0 *and* as
`activated`/`active` at 1.12.0–1.13.0 — implying a single installation
self-declared two incompatible versions.

**That claim is withdrawn and refuted by the intersection query (0 overlap).**
The supporting query grouped by `(event, version)` and counted distinct IDs
*within each group*. It never tested per-ID co-occurrence. Distinct
installations legitimately use different versions at the same time. The
"same IDs" assertion was an inference from a grouping artifact.

Consequence: the plausible-version Linux traffic is **not** shown to be
fabricated. It remains suspicious and unattributed.

## Not established

- **"35 real users."** OS does not classify users. The ingestion route is
  anonymous and unauthenticated; a self-declared plausible version passes the
  floor. The floor excludes *provably impossible* traffic, not *unverified*
  traffic. This is a platform split of unauthenticated claims, not a user split.
- **"0.2% retention."** The single returning ID is one darwin installation over
  five days. Not a product retention measure.
- **"2.12M."** No counterpart anywhere in a dataset that has never held more
  than 2,135 rows.

## Investor-safe statement

> Anonymous installation IDs, not people; transient environments can create
> multiple IDs. One traffic class (668 IDs declaring a pre-telemetry version) is
> provably fabricated and is now blocked server-side.

**How to use the fabrication finding.** It explains **why the install metric is
excluded** — 668 of 675 `install_completed` IDs carry a version that cannot have
emitted the event, so an install count built on that stream is not a measure of
adoption. That is a legitimate and necessary use.

It is **not** a substitute for product traction. Detecting bad telemetry
demonstrates instrumentation integrity, not usage. The two should not be
presented as though the second compensates for the first, and the fabrication
figure should never appear adjacent to a growth number in a way that invites
the reader to net them.

## Open items

- `scripts/telemetry-queries.mjs` has no OS×time query; this audit ran it ad hoc
  through the MCP endpoint. Worth adding only if this pattern will be monitored
  repeatedly. It would make the audit reproducible through the repo's own
  tooling, but it would **not** by itself determine whether those installation
  IDs represent people — the available fields cannot separate a human from an
  automated client.
- Attribution of the plausible-version Linux traffic is unresolved. It is
  suspicious — burst arrival, near-zero recurrence, uniform cross-version
  spread — and unattributed.