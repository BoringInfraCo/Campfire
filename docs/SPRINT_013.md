# Campfire — Sprint 013: Public Release

**Status:** Complete (**GO**) — see `SPRINT_013_RESULT.md`
**Date:** September 25, 2026
**Company:** Boring Infra Co.
**Depends on:** Sprint 012 — Close the Workspace (**GO**)
**Release:** `v1.2.0`
**Primary metric:** Release integrity across the private source tag, public snapshot, platform assets, production deployment, and clean installation.

---

## 1. Sprint question

> Can the proven Sprint 007–012 product state be promoted from the private
> canonical repository into a safe, reproducible, publicly installable
> `v1.2.0` release without exposing private history or evidence?

This is a release sprint, not a product-behavior sprint. The user explicitly
chose to skip the previously proposed design-partner requirement.

Gate B external repeat usage and Gate C external multi-participant value remain
unmeasured. Publishing `v1.2.0` must not be described as external validation,
retention evidence, or product-market fit.

---

## 2. Release contents

The release promotes behavior already implemented and closed with evidence:

- Sprint 007 — harness readiness preflight;
- Sprint 008 — compact, authorization-aware workspace orientation;
- Sprint 009 — recorded alignment before execution;
- Sprint 010 — caller-supplied return cursor and awaited Workers writes;
- Sprint 011 — natural contribution guidance and continuation evaluation;
- Sprint 012 — truthful Workspace closure and session-bound lifecycle writes;
- hardened release packaging and the private-to-public snapshot export boundary.

The public repository currently remains at the clean `v1.1.0` snapshot. The
private canonical repository is the only source of the `v1.2.0` release tag.

---

## 3. Smallest implementation

1. Set `package.json` and `package-lock.json` to `1.2.0`.
2. Update public-facing release notes, curated release context, and current
   pinned install examples.
3. Generate and track `public/campfire/v1.2.0/install.sh`; do not modify the
   immutable `v1.0.0` or `v1.1.0` installer paths.
4. Run the full release validation matrix on Node 22.
5. Commit the reviewed private release source and create the annotated private
   `v1.2.0` tag. Never retarget or force-push it.
6. Export that exact tag into an empty directory with the existing audited
   exporter. Stop on any forbidden path or secret pattern.
7. Promote only the audited exported tree to `BoringInfraCo/Campfire`. Never
   merge, mirror, or push private Git history.
8. Commit and tag the public snapshot, publish the matching GitHub Release,
   and verify all supported archives and checksums.
9. Deploy the Worker/D1 production slice separately, then verify latest and
   pinned installers plus a clean installation.
10. Record the release result in the private repository after external
    verification completes.

No product behavior, domain object, schema, migration, authorization rule,
Viewer capability, harness abstraction, or deployment automation is added.

---

## 4. Validation matrix

Before the private tag:

```text
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:acceptance
npm test
npm run build
npm run pack:tarball
npm run deploy:dry-run
```

The release must also pass:

- complete private diff review;
- version consistency across package metadata and the immutable installer;
- local archive and SHA-256 verification;
- export manifest review and forbidden-content audit;
- complete public snapshot diff review;
- public CI on Node 22;
- four platform archives and four matching checksum files;
- production Worker deployment and D1 migration verification;
- latest installer URL and pinned `v1.2.0` installer URL;
- a clean install outside both repository checkouts;
- installed package metadata reporting `1.2.0`, `campfire --help`, and a
  blank-database bootstrap/read smoke.

---

## 5. Security and repository boundaries

- `BoringInfraCo/Campfire-internal` remains private and canonical.
- `BoringInfraCo/Campfire` remains a non-fork public release-snapshot mirror.
- Public history contains release snapshots only, never private development
  history.
- The public manifest retains the private source commit SHA for provenance;
  it does not expose private content.
- Raw sprint evidence, transcripts, local databases, credentials, `AGENTS.md`,
  the internal skill, and internal-only documentation remain excluded.
- Apache-2.0 remains unchanged.
- Real D1 identifiers and bearer tokens remain outside Git.
- Tagging, public promotion, GitHub Release publication, and production deploy
  are separately observed mutations even though this sprint authorizes the
  complete release sequence.

---

## 6. Acceptance criteria

- Private `main` begins synchronized with `origin/main` and ends clean.
- `v1.2.0` resolves to the reviewed private release commit.
- Package and lockfile versions are `1.2.0`.
- `public/campfire/v1.2.0/install.sh` is tracked and matches the current
  installer; prior versioned installers remain unchanged.
- All validation commands pass on Node 22.
- The exported manifest names the private tagged commit and contains only
  allowlisted release content.
- The public snapshot has no private history, evidence, secret, or forbidden
  path.
- Public `main` and public `v1.2.0` resolve to the reviewed snapshot commit.
- The GitHub Release is published with four non-empty platform archives and
  four valid checksum files.
- Production deployment succeeds through the explicit operator path; the tag
  itself does not silently deploy.
- Latest and pinned installer URLs work, checksums verify, and a clean install
  contains package version `1.2.0` and completes the smoke test.
- The result states clearly that Gate B, Gate C, and external PMF remain
  unmeasured by founder decision.

---

## 7. Non-goals

- Design-partner recruitment, onboarding, or field evaluation.
- Gate B or Gate C external evidence.
- Product analytics, read tracking, transcript ingestion, or session replay.
- New domain objects, lifecycle rules, schemas, or migrations.
- Cross-workspace memory, embeddings, search, or organizational learning.
- SSO, SCIM, enterprise policy, or a hosted multi-tenant control plane.
- Integrations, notifications, presence, scheduling, delegation, or
  orchestration.
- A writable Viewer or public browser journal.
- Claiming retention, revenue, adoption, or product-market fit from a release.
- Defining or implementing Sprint 014.

---

## 8. Rubric

### GO

The exact reviewed private source is immutably tagged, its audited export is
the only content promoted to the public mirror, public CI and all platform
release assets pass, production deploys explicitly, latest and pinned installs
work from a clean environment, repositories finish clean and synchronized, and
no private material or secret is exposed.

### CONDITIONAL GO

The source tag and public snapshot are correct and safe, but one reversible
distribution issue remains, such as a delayed platform asset or static URL
propagation. Record the exact limitation and do not call the release complete
until it is resolved.

### NO-GO / REFRAME

Any validation failure, version mismatch, mutable or divergent tag, forbidden
exported content, private-history exposure, missing checksum, unsafe deploy,
failed clean install, or need for an unreviewed product/schema change stops the
release. Fix the release candidate in a new commit and tag a new version; never
move `v1.2.0` after publication.

Implementation and the full release sequence are explicitly authorized by the
user. Stop after recording the Sprint 013 release result; do not begin Sprint
014.
