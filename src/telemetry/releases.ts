/**
 * GENERATED — do not edit by hand. Regenerate with `npm run telemetry:sync-releases`.
 *
 * Source command: git tag --format='%(refname:short) %(creatordate:iso8601)'
 * Generated at: 2026-10-21T02:58:55Z
 *
 * Tag timestamps carry numeric local offsets (EDT/EST across the year, so the
 * offset is a seasonality artifact, not a stable property). Each is converted
 * to a UTC ISO instant above, which is what the release-time check compares.
 * Release instants never change after the fact; a version absent from this
 * table is allowed through the gate and measured as `unknown_release`.
 *
 * Static release-time map for server-side telemetry integrity.
 *
 * Each entry is the UTC instant its release was published. The ingestion
 * route compares a payload's declared `campfireVersion` against this map: a
 * known version whose release instant is still in the future cannot have been
 * emitted by a real binary, so it is a provable forgery (same reasoning as
 * the v1.9.1 reporting floor, extended forward in time). A version that is
 * not in the map — `unknown`, a build string, a local checkout, or a release
 * newer than this table — is allowed through: absence of proof is not proof
 * of forgery.
 *
 * The table is deliberately static. Release instants never change after the
 * fact, and a static map keeps the check stateless: no D1 read, nothing to
 * evade by rotating source addresses. Update it when a new release ships.
 */
export const TELEMETRY_RELEASES: Readonly<Record<string, string>> = {
  "1.9.1": "2026-10-03T02:53:27Z",
  "1.9.2": "2026-10-03T03:52:52Z",
  "1.9.3": "2026-10-03T17:05:08Z",
  "1.10.0": "2026-10-03T21:32:07Z",
  "1.11.0": "2026-10-04T01:05:42Z",
  "1.12.0": "2026-10-07T21:46:11Z",
  "1.13.0": "2026-10-08T20:43:02Z",
  "1.14.0": "2026-10-10T01:25:37Z",
  "1.15.0": "2026-10-10T04:39:53Z",
  "1.16.0": "2026-10-14T02:17:29Z",
  "1.17.0": "2026-10-15T03:58:50Z",
  "1.18.0": "2026-10-16T00:58:41Z",
  "1.19.0": "2026-10-16T03:23:25Z",
  "1.20.0": "2026-10-16T18:16:05Z",
  "1.20.1": "2026-10-16T18:52:22Z",
  "1.21.0": "2026-10-17T04:19:43Z",
  "1.22.0": "2026-10-18T03:59:22Z",
  "1.22.1": "2026-10-19T00:54:46Z",
  "1.23.0": "2026-10-19T04:20:08Z",
  "1.24.0": "2026-10-19T22:34:53Z",
  "1.24.1": "2026-10-20T01:52:22Z",
  "1.25.0": "2026-10-21T01:06:22Z",
  "1.26.0": "2026-10-22T04:00:00Z",
};

/**
 * The release instant for a declared client version, or `undefined` when the
 * version is not a known release. Unknown means allow: an unparseable value
 * (`unknown`, a build string) is an honest possibility, and a version newer
 * than this table is expected until the table is updated.
 */
export function telemetryReleaseAt(campfireVersion: string): string | undefined {
  return TELEMETRY_RELEASES[campfireVersion.trim()];
}
