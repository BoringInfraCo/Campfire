#!/usr/bin/env node

/**
 * Anonymous product telemetry: internal measurement queries (TEL-001G).
 *
 * The SQL is the product. This file owns the metric *definitions* for the
 * founder funnel in the sprint document (§15) so a number can be reproduced by
 * anyone with read access to the Analytics Engine dataset, without a dashboard
 * and without inspecting Worker logs by hand (§16G exit).
 *
 * Three rules shape everything here.
 *
 * 1. The invocation is explicit. Every query is printed as the exact command
 *    before anything is sent, `--confirm` is required to touch the account, and
 *    no credential is ever hard-coded, printed, or placed in argv. The default
 *    runner is the documented Analytics Engine SQL API, authenticated the same
 *    way Wrangler authenticates (`CLOUDFLARE_API_TOKEN`) and executed in-process
 *    so the token never reaches a process table. `--runner wrangler` builds the
 *    `npx wrangler analytics-engine sql` argv instead, for Wrangler builds that
 *    ship that subcommand; the pinned version does not, which is why it is not
 *    the default.
 *
 * 2. Sampling is real, not decorative (§14, §17). Analytics Engine downsamples
 *    adaptively and exposes the rate as `_sample_interval`. Every count query
 *    therefore also returns `max(_sample_interval)`, and the report refuses to
 *    describe a deduplicated installation count as exact while sampling is
 *    observed. See the sampling note below for the exact treatment per metric.
 *
 * 3. Nothing is backfilled (§20 rule 6) and nothing is renamed (§20 rules 1, 3).
 *    The report window may not begin before the first observed
 *    `install_requested`, and every rendered line is checked against the §20
 *    vocabulary before it is printed.
 *
 * SAMPLING — what is exact, what is an estimate, and why
 * ---------------------------------------------------
 * Installer requests and event totals are *counts of rows*, so they carry a
 * sample weight: `sum(_sample_interval)` is the documented correct aggregate and
 * is what this script uses. It is an estimate whenever `_sample_interval > 1`.
 *
 * Deduplicated installation counts are `count(DISTINCT blob8)`. That aggregate
 * cannot be sample-weighted — there is no sample-weighted form of a distinct
 * count. `blob8` is the installation id because the one legal index is the
 * event-name sampling key, not a per-installation index, so the id never
 * drives an index group. Under sampling the distinct count therefore
 * *undercounts*: a sampled-away row can carry an installation id that appears
 * in no surviving row. Those figures are labelled "lower bound" whenever
 * sampling is observed, and they are anonymous installations, never people —
 * they deduplicate installations, not humans (§20 rule 3).
 *
 * `active` is emitted at most once per installation per UTC day, and
 * `activated` / `install_completed` at most once per installation for its
 * lifetime, all decided locally. Repetition therefore cannot inflate any of
 * these counts; sampling is the only reason one would read low.
 *
 * Usage:
 *   node scripts/telemetry-queries.mjs --list
 *   node scripts/telemetry-queries.mjs --dry-run
 *   node scripts/telemetry-queries.mjs --since 2026-10-02 --confirm
 *   node scripts/telemetry-queries.mjs --metric daily_active_installations \
 *     --output json --confirm
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Dataset name in `wrangler.toml` (`[[analytics_engine_datasets]]`). */
const DATASET = "campfire_telemetry";

/** Documented Analytics Engine SQL endpoint. Only its origin is ever printed. */
const SQL_API_ORIGIN = "https://api.cloudflare.com/client/v4";

/** Read from the environment only. Never printed, never placed in argv. */
const TOKEN_ENV_VAR = "CLOUDFLARE_API_TOKEN";
const ACCOUNT_ENV_VAR = "CLOUDFLARE_ACCOUNT_ID";

/**
 * Lower bound every query declares. Analytics Engine requires a time bound and a
 * dataset can only contain rows written after its binding was deployed, so this
 * constant is a floor that never truncates real data.
 */
const EARLIEST_POSSIBLE_DAY = "2020-01-01";

/**
 * When these definitions were written. They predate the first possible
 * `install_requested` data point, so a reported number cannot be the product of
 * choosing a metric after seeing the data (§20 rule 5). Changing this constant
 * is a metric-definition change and must be recorded.
 *
 * On 2026-10-03 the column positions were corrected to the layout below because
 * the previous index1–index7 layout was rejected by Analytics Engine and stored
 * nothing. That is a storage-layout correction, not a metric redefinition, so
 * this date stays 2026-10-02. Queries must not read index1: the one legal index
 * is the event-name sampling key, not a query dimension.
 *   blob1  event name (filter here)
 *   blob2  schema version ("1")
 *   blob3  campfire version
 *   blob4  os
 *   blob5  arch
 *   blob6  install method, or "none"
 *   blob7  surface, or "none"
 *   blob8  installation id, or "" — count(DISTINCT blob8)
 *
 * Client-emitted founder counts omit a declared version below 1.9.1. See
 * `versionBelowReportingFloor`. That is an integrity correction: a binary
 * older than the first telemetry release cannot emit these events, so the
 * rows are provably forged. The frozen date above stays. The rows remain in
 * the dataset and are listed by `excluded_below_reporting_floor`. Installer
 * requests are not filtered; the Worker writes them with version "unknown".
 */
const DEFINITIONS_FROZEN_ON = "2026-10-02";

/**
 * Default `--since`. Documented default only: the true first measured day is
 * discovered from the dataset at run time and a window beginning before it is
 * refused. Pass `--since` explicitly to re-report an earlier window.
 */
const DEFAULT_SINCE = "2026-10-02";

const DIAGNOSTIC_MAX_CHARS = 200;

/** Same bounded-error/redaction idiom as `src/bridge/retry.ts`. */
const TOKEN_PATTERNS = [
  /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bcft_[0-9a-fA-F]{8,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
];
const URL_ORIGIN_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/[^\s/?#]+)[^\s'"]*/gi;
const USERINFO_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi;
/** The public-export audit rejects absolute user paths, so never print one. */
const USER_PATH_PATTERN = /\/(?:Users|home)\/[A-Za-z0-9._-]+/g;

/**
 * §20 rules 1 and 3. The report names installer requests, anonymous
 * installations, and activated installations. It never names a person. This runs
 * against every rendered line so the vocabulary cannot drift.
 */
const FORBIDDEN_METRIC_WORDS = [/\busers?\b/, /\bpeople\b/, /\bpersons?\b/, /\bhumans?\b/];

function token() {
  return (process.env[TOKEN_ENV_VAR] ?? "").trim();
}

function sanitizeDiagnostic(text, secret) {
  let safe = text;
  if (secret !== undefined && secret.length > 0) safe = safe.split(secret).join("[redacted]");
  for (const pattern of TOKEN_PATTERNS) safe = safe.replace(pattern, "[redacted]");
  safe = safe.replace(USER_PATH_PATTERN, "[local path]");
  // Query strings and paths can carry credentials; keep only the origin.
  safe = safe.replace(USERINFO_PATTERN, "$1").replace(URL_ORIGIN_PATTERN, "$1").trim();
  return safe.length > DIAGNOSTIC_MAX_CHARS ? safe.slice(0, DIAGNOSTIC_MAX_CHARS) : safe;
}

function fail(message) {
  console.error(`telemetry-queries: ${message}`);
  process.exit(1);
}

function emit(text) {
  for (const pattern of FORBIDDEN_METRIC_WORDS) {
    if (pattern.test(text)) {
      fail(`refusing to render: metric vocabulary violation ${pattern} — a count must name an installation, a request, or an event`);
    }
  }
  process.stdout.write(text);
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const USAGE = `Usage: node scripts/telemetry-queries.mjs [options]

Internal measurement queries for the anonymous telemetry dataset
"${DATASET}" (Cloudflare Analytics Engine). Definitions and vocabulary are
documented in docs/TELEMETRY.md.

Options:
  --since <YYYY-MM-DD>   First day of the reporting window.
                         Default: ${DEFAULT_SINCE}. A window that begins before
                         the first observed installer request is refused.
  --until <YYYY-MM-DD>   Last day of the reporting window, inclusive.
                         Default: today (UTC).
  --metric <id>          Run one documented query instead of all of them. A
                         partial run reports only what it queried.
  --runner <api|wrangler>
                         api (default): the documented Analytics Engine SQL
                         API, executed in-process with the token read from
                         $${TOKEN_ENV_VAR}.
                         wrangler: the "npx wrangler analytics-engine sql"
                         argv, for Wrangler builds that ship that subcommand.
  --output <text|json>   text (default) renders the report; json emits one
                         reproducible document including every executed query.
  --dry-run              Print the plan and the exact commands. Sends nothing.
  --confirm              Required before the Cloudflare account is contacted.
  --list                 Print the query catalogue and exit.
  --help                 Print this help and exit.

Environment:
  $${ACCOUNT_ENV_VAR}          Account id for the api runner.
  $${TOKEN_ENV_VAR}  Read-only Analytics Engine token with Account Analytics
                      Read. Never printed, never placed in argv.

Vocabulary: the report names installer requests, anonymous installations, and
activated installations. A deduplicated count deduplicates installations, and is
labelled a lower bound whenever Analytics Engine sampling is observed.`;

function parseArgs(argv) {
  const opts = {
    since: undefined,
    until: undefined,
    metric: undefined,
    runner: "api",
    output: "text",
    dryRun: false,
    confirm: false,
    list: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--since") opts.since = argv[++index];
    else if (arg === "--until") opts.until = argv[++index];
    else if (arg === "--metric") opts.metric = argv[++index];
    else if (arg === "--runner") opts.runner = argv[++index];
    else if (arg === "--output") opts.output = argv[++index];
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--confirm") opts.confirm = true;
    else if (arg === "--list") opts.list = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else fail(`unknown argument: ${arg}`);
  }
  if (opts.output !== "text" && opts.output !== "json") {
    fail(`--output must be text or json (received: ${opts.output})`);
  }
  if (opts.runner !== "api" && opts.runner !== "wrangler") {
    fail(`--runner must be api or wrangler (received: ${opts.runner})`);
  }
  return opts;
}

function parseDay(value, flag) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "") || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    fail(`${flag} must be a UTC calendar day (YYYY-MM-DD), received: ${value}`);
  }
  return value;
}

function addDays(day, delta) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function buildWindow(opts) {
  const today = new Date().toISOString().slice(0, 10);
  const since = opts.since === undefined ? DEFAULT_SINCE : parseDay(opts.since, "--since");
  const until = opts.until === undefined ? today : parseDay(opts.until, "--until");
  if (daysBetween(since, until) < 0) fail(`--since ${since} is after --until ${until}`);
  return {
    today,
    since,
    until,
    // "Most recent day in the window". Equals today unless an earlier --until
    // was requested, in which case reporting about today would fall outside
    // the requested range.
    lastDay: until,
    untilExclusive: addDays(until, 1),
    trailing7: addDays(until, -6),
    trailing30: addDays(until, -29),
  };
}

/** Explicit bounds, never `now()`: a printed query is exactly re-runnable (§20 rule 7). */
function windowClause(fromDay, untilExclusiveDay) {
  return `timestamp >= toDateTime('${fromDay} 00:00:00')\n    AND timestamp < toDateTime('${untilExclusiveDay} 00:00:00')`;
}

/**
 * First release that contained any telemetry code. Keep this equal to
 * `TELEMETRY_MIN_REPORTING_VERSION` in `src/telemetry/contract.ts`.
 *
 * Analytics Engine has no semver type. A lexical `blob3 < '1.9.1'` is wrong:
 * the string `1.10.0` sorts before `1.9.1` and would drop every later install.
 */
const TELEMETRY_MIN_REPORTING_VERSION = "1.9.1";

/**
 * Events a Campfire binary sends. `install_requested` is written by the Worker
 * with version `unknown` and is not a client declaration.
 */
const CLIENT_EVENTS = new Set(["install_completed", "activated", "active"]);

/**
 * SQL predicate, true when `column` parses below `TELEMETRY_MIN_REPORTING_VERSION`.
 *
 * `startsWith(blob3, '1.1.')` is false for `1.10.0`: the character after `1.1`
 * is `0`, not `.`. Unparseable values (`unknown`, `latest`) match nothing and
 * stay in the report, matching `isTelemetryVersionBelowFloor`.
 *
 * `1.9.0` and a prerelease, build, or extra component of that exact triple are
 * below the floor. `1.9.1` and `1.9.10` are not.
 */
function versionBelowReportingFloor(column) {
  const prefixes = ["0.", "1.9.0-", "1.9.0+", "1.9.0."];
  for (let minor = 0; minor <= 8; minor += 1) prefixes.push(`1.${minor}.`);
  const starts = prefixes.map((prefix) => `startsWith(${column}, '${prefix}')`);
  return `(${starts.join(" OR ")} OR ${column} = '1.9.0')`;
}

/**
 * UTC Monday of the week that contains `column`, as a DateTime on that Monday.
 *
 * `toStartOfWeek(timestamp)` on the production Analytics Engine starts on
 * Sunday: `toDayOfWeek` of its result is 7, and a Wednesday (2026-10-07)
 * rounds to 2026-10-04. Passing a mode is rejected — "TOSTARTOFWEEK() function
 * does not accept 2 arguments" — even though the published docs say Monday.
 * `toDayOfWeek` is Monday=1 through Sunday=7, so subtracting that many days
 * minus one lands on Monday. 2026-10-07 -> 2026-10-05, and Sunday 2026-10-04
 * -> 2026-09-28.
 */
function utcMonday(column) {
  return `toDateTime(toUnixTimestamp(${column}) - (toDayOfWeek(${column}) - 1) * 86400)`;
}

/** `blob1` filter, plus the version floor for client-emitted events. */
function eventWhere(event, windowSql) {
  const versionGate = CLIENT_EVENTS.has(event) ? `\n  AND NOT ${versionBelowReportingFloor("blob3")}` : "";
  return `blob1 = '${event}'${versionGate}\n  AND ${windowSql}`;
}

// ---------------------------------------------------------------------------
// Query catalogue — the metric definitions, in report order.
// ---------------------------------------------------------------------------

const WEIGHTED = "sample-weighted SUM(_sample_interval); an estimate while _sample_interval > 1";
const DEDUPLICATED =
  "deduplicated count(DISTINCT blob8); blob8 is the installation id because the one legal index is the event-name sampling key, not a per-installation index; a distinct count cannot be sample-weighted, so it is a lower bound while _sample_interval > 1";

function installerRequestsWindow(id, title, purpose, windowKey) {
  return {
    id,
    title,
    purpose,
    sampling: WEIGHTED,
    sql: (window) =>
      `SELECT
  sum(_sample_interval) AS installer_requests,
  max(_sample_interval) AS max_sample_interval
FROM ${DATASET}
WHERE blob1 = 'install_requested'
  AND ${windowClause(window[windowKey], window.untilExclusive)}`,
  };
}

/**
 * A funnel stage. The event total is sample-weighted and the deduplicated
 * installation count is a distinct count, so both are returned and neither is
 * presented as an exact total without the sampling verdict.
 */
function funnelStage(id, title, event, alias, purpose) {
  return {
    id,
    title,
    purpose,
    sampling: `${WEIGHTED}; deduplicated installations via ${DEDUPLICATED}`,
    sql: (window) =>
      `SELECT
  sum(_sample_interval) AS ${event}_events,
  count(DISTINCT blob8) AS ${alias},
  max(_sample_interval) AS max_sample_interval
FROM ${DATASET}
WHERE ${eventWhere(event, windowClause(window.since, window.untilExclusive))}`,
  };
}

/** Rolling active-installation window: distinct installations active in the period. */
function activeWindow(id, title, windowKey, alias) {
  return {
    id,
    title,
    purpose: `${title}.`,
    // Locally bounded to one active event per installation per UTC day, so a
    // distinct count over a period is one row per active installation.
    sampling: `${DEDUPLICATED}; the client emits at most one active event per installation per UTC day, so repetition cannot inflate this`,
    sql: (window) =>
      `SELECT
  count(DISTINCT blob8) AS ${alias},
  max(_sample_interval) AS max_sample_interval
FROM ${DATASET}
WHERE ${eventWhere("active", windowClause(window[windowKey], window.untilExclusive))}`,
  };
}

/**
 * `install_requested` carries no installation id by contract, so `blob8` is
 * empty there and a distinct count would be a constant 1. That breakdown
 * reports sample-weighted installer requests instead, and says so.
 */
function breakdown(id, title, label, event, column, alias, windowKey, deduplicated) {
  const measure = deduplicated
    ? "  count(DISTINCT blob8) AS anonymous_installations,\n  sum(_sample_interval) AS events,"
    : "  sum(_sample_interval) AS installer_requests,";
  const order = deduplicated ? "anonymous_installations DESC" : "installer_requests DESC";
  return {
    id,
    title,
    purpose: `Breakdown by ${label}.`,
    sampling: deduplicated ? DEDUPLICATED : WEIGHTED,
    breakdown: { dimension: alias, event, measure: deduplicated ? "anonymous_installations" : "installer_requests" },
    sql: (window) =>
      `SELECT
  ${column} AS ${alias},
${measure}
  max(_sample_interval) AS max_sample_interval
FROM ${DATASET}
WHERE ${eventWhere(event, windowClause(window[windowKey], window.untilExclusive))}
GROUP BY ${alias}
ORDER BY ${order}, ${alias} ASC
LIMIT 20`,
  };
}

const QUERIES = [
  installerRequestsWindow(
    "installer_requests_recent_day",
    "Installer requests — most recent day in the window",
    "§15 installer requests for the most recent day of the reporting window.",
    "lastDay",
  ),
  installerRequestsWindow(
    "installer_requests_since",
    "Installer requests — reporting window",
    "§15 installer requests since launch.",
    "since",
  ),
  installerRequestsWindow(
    "installer_requests_trailing_7d",
    "Installer requests — trailing 7 days (UTC)",
    "§15 installer requests, trailing 7 days.",
    "trailing7",
  ),
  installerRequestsWindow(
    "installer_requests_trailing_30d",
    "Installer requests — trailing 30 days (UTC)",
    "§15 installer requests, trailing 30 days.",
    "trailing30",
  ),
  funnelStage(
    "successful_installations",
    "Successful installations",
    "install_completed",
    "anonymous_installations",
    "§15 successful installations. Never combined with installer requests (§20 rule 2). Omits a declared version below 1.9.1; those rows are listed by excluded_below_reporting_floor.",
  ),
  {
    id: "excluded_below_reporting_floor",
    title: "Excluded installations — declared version below 1.9.1",
    purpose:
      "install_completed rows whose declared version is below the first telemetry release. A binary older than 1.9.1 has no telemetry code, so these rows are provably forged. Founder counts omit them. This query keeps the omission visible. The rows are not deleted.",
    sampling: DEDUPLICATED,
    exclusion: true,
    sql: (window) =>
      `SELECT
  blob3 AS campfire_version,
  count(DISTINCT blob8) AS anonymous_installations,
  sum(_sample_interval) AS events,
  max(_sample_interval) AS max_sample_interval
FROM ${DATASET}
WHERE blob1 = 'install_completed'
  AND ${versionBelowReportingFloor("blob3")}
  AND ${windowClause(window.since, window.untilExclusive)}
GROUP BY campfire_version
ORDER BY anonymous_installations DESC, campfire_version ASC
LIMIT 20`,
  },
  funnelStage(
    "activated_installations",
    "Activated installations",
    "activated",
    "activated_installations",
    "§15 activated installations.",
  ),
  activeWindow(
    "active_installations_7d",
    "Active installations — trailing 7 days (UTC)",
    "trailing7",
    "active_installations_7d",
  ),
  activeWindow(
    "active_installations_30d",
    "Active installations — trailing 30 days (UTC)",
    "trailing30",
    "active_installations_30d",
  ),
  {
    id: "daily_active_installations",
    title: "Daily active installations — trailing 7 days (UTC)",
    purpose: "§15 daily active installations.",
    sampling: `${DEDUPLICATED}; at most one active event per installation per UTC day, so repetition cannot inflate this`,
    sql: (window) =>
      `SELECT
  formatDateTime(toStartOfDay(timestamp), '%Y-%m-%d') AS utc_day,
  count(DISTINCT blob8) AS active_installations,
  max(_sample_interval) AS max_sample_interval
FROM ${DATASET}
WHERE ${eventWhere("active", windowClause(window.trailing7, window.untilExclusive))}
GROUP BY utc_day
ORDER BY utc_day`,
  },
  {
    id: "weekly_active_installations",
    title: "Weekly active installations — trailing 30 days (UTC, weeks start Monday)",
    purpose: "§15 weekly active installations. Weeks start Monday UTC. toStartOfWeek is not used: on this engine it starts on Sunday and rejects a mode argument.",
    sampling: `${DEDUPLICATED}; Monday is derived from toDayOfWeek (1 = Monday) because toStartOfWeek starts on Sunday`,
    sql: (window) =>
      `SELECT
  formatDateTime(${utcMonday("timestamp")}, '%Y-%m-%d') AS utc_week_start,
  count(DISTINCT blob8) AS active_installations,
  max(_sample_interval) AS max_sample_interval
FROM ${DATASET}
WHERE ${eventWhere("active", windowClause(window.trailing30, window.untilExclusive))}
GROUP BY utc_week_start
ORDER BY utc_week_start`,
  },
  {
    id: "returning_installations",
    title: "Returning installations",
    purpose: "§15 returning installations: the same anonymous installation id active on a later UTC day.",
    // min()/max() take a numeric, date, or date-time argument and reject a
    // String one, and formatDateTime() returns String. Aggregating the formatted
    // day is therefore not a style question but a rejected statement:
    // min(formatDateTime(timestamp, ...)) answers HTTP 422 "cannot use the
    // String type as argument 1". The aggregate is applied to the DateTime
    // column and the formatting happens after it, which is legal — the same
    // form the first-observed guard below already uses. The outer comparison
    // stays a string comparison on purpose: both sides are '%Y-%m-%d', which
    // sorts chronologically as plain text, so first_active_day < last_active_day
    // compares UTC days without nesting a date function inside an aggregate.
    sampling: `${DEDUPLICATED}; one derived row per installation, counted with COUNT()`,
    sql: (window) =>
      `SELECT
  count() AS returning_installations,
  max(max_sample_interval) AS max_sample_interval
FROM (
  SELECT
    blob8 AS installation_id,
    formatDateTime(min(timestamp), '%Y-%m-%d') AS first_active_day,
    formatDateTime(max(timestamp), '%Y-%m-%d') AS last_active_day,
    max(_sample_interval) AS max_sample_interval
  FROM ${DATASET}
  WHERE ${eventWhere("active", windowClause(window.since, window.untilExclusive))}
  GROUP BY installation_id
)
WHERE first_active_day < last_active_day`,
  },
  breakdown(
    "by_campfire_version", "Breakdown — Campfire version", "Campfire version",
    "install_completed", "blob3", "campfire_version", "since", true,
  ),
  breakdown(
    "by_os", "Breakdown — operating system", "operating system",
    "install_completed", "blob4", "os", "since", true,
  ),
  breakdown(
    "by_arch", "Breakdown — architecture", "architecture",
    "install_completed", "blob5", "arch", "since", true,
  ),
  breakdown(
    "by_install_method", "Breakdown — install method", "install method",
    "install_requested", "blob6", "install_method", "since", false,
  ),
  breakdown(
    "by_surface", "Breakdown — surface", "surface",
    "active", "blob7", "surface", "trailing30", true,
  ),
];

/** Runs first: it establishes whether the requested window was ever measured. */
const FIRST_OBSERVED_QUERY = {
  id: "first_observed_install_request_day",
  title: "First observed installer request (UTC day)",
  purpose:
    "Establishes the first day any installer request was measured. The report window may not begin before it (§20 rule 6).",
  sampling: "min(timestamp) over a sampled set is a lower bound on the true first day",
  sql: (window) =>
    `SELECT
  formatDateTime(min(timestamp), '%Y-%m-%d') AS first_observed_install_request_day
FROM ${DATASET}
WHERE blob1 = 'install_requested'
  AND ${windowClause(EARLIEST_POSSIBLE_DAY, window.untilExclusive)}`,
};

function selectedQueries(metric) {
  if (metric === undefined) return QUERIES;
  const found = QUERIES.filter((query) => query.id === metric);
  if (found.length === 0) {
    fail(`unknown --metric ${metric}. Known ids:\n  ${QUERIES.map((query) => query.id).join("\n  ")}`);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Invocation — printed in full, never carrying a credential
// ---------------------------------------------------------------------------

/**
 * Double quotes keep a printed SQL statement readable and copy-pasteable; the
 * generated SQL has no `$`, backtick, backslash, or double quote of its own.
 * Anything else falls back to single-quote escaping.
 */
function shellQuote(value) {
  if (/["$`\\]/.test(value)) return `'${value.replaceAll("'", "'\\''")}'`;
  return `"${value}"`;
}

function printedCommand(sql, runner) {
  if (runner === "wrangler") {
    return [`npx wrangler analytics-engine sql --dataset ${DATASET} \\`, `  --query ${shellQuote(sql)}`].join("\n");
  }
  return [
    `curl -X POST "${SQL_API_ORIGIN}/accounts/$${ACCOUNT_ENV_VAR}/analytics_engine/sql" \\`,
    `  --header "Authorization: Bearer $${TOKEN_ENV_VAR}" \\`,
    `  --header "Content-Type: text/plain" \\`,
    `  --data ${shellQuote(sql)}`,
  ].join("\n");
}

/**
 * Execute one query.
 *
 * The api runner reads the token from the environment and sends it as a header,
 * so it appears in no argv, in no printed output, and in no diagnostic. The
 * wrangler runner adds nothing to argv and inherits the environment, so
 * Wrangler resolves its own credential.
 */
async function runQuery(sql, opts) {
  if (opts.runner === "wrangler") {
    const argv = ["--yes", "wrangler", "analytics-engine", "sql", "--dataset", DATASET, "--query", sql];
    const result = spawnSync("npx", argv, { encoding: "utf8", cwd: repoRoot });
    if (result.error !== undefined) {
      throw new Error(`wrangler did not start: ${sanitizeDiagnostic(String(result.error.message), token())}`);
    }
    if (result.status !== 0) {
      throw new Error(`wrangler exited ${result.status}: ${sanitizeDiagnostic(result.stderr ?? "", token())}`);
    }
    return parsePayload(result.stdout ?? "");
  }

  const accountId = (process.env[ACCOUNT_ENV_VAR] ?? "").trim();
  if (accountId.length === 0) throw new Error(`$${ACCOUNT_ENV_VAR} is not set`);
  const secret = token();
  if (secret.length === 0) throw new Error(`$${TOKEN_ENV_VAR} is not set`);

  const response = await fetch(`${SQL_API_ORIGIN}/accounts/${encodeURIComponent(accountId)}/analytics_engine/sql`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "text/plain" },
    body: sql,
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${sanitizeDiagnostic(body, secret)}`);
  return parsePayload(body);
}

/** Analytics Engine answers `{ meta, data, rows }`; `rows` is a count, not a row set. */
function parsePayload(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`response was not JSON: ${sanitizeDiagnostic(text, token())}`);
  }
  const data = Array.isArray(parsed) ? parsed : parsed?.data;
  if (!Array.isArray(data)) throw new Error(`response had no data array: ${sanitizeDiagnostic(text, token())}`);
  return data;
}

function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstRow(rows) {
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : {};
}

function rowsOf(rows) {
  return Array.isArray(rows) ? rows : [];
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const EXACT = "exact (unsampled)";
const LOWER_BOUND = "lower bound (deduplicated, sampling not weighted)";

function samplingVerdict(results) {
  let max = 0;
  for (const rows of Object.values(results)) {
    for (const row of rowsOf(rows)) max = Math.max(max, number(row?.max_sample_interval));
  }
  return {
    maxSampleInterval: max,
    sampled: max > 1,
    weightedCounts: WEIGHTED,
    deduplicatedCounts: DEDUPLICATED,
    note:
      max > 1
        ? `Analytics Engine write sampling is active in this window (max _sample_interval = ${max}). Sample-weighted counts are estimates and deduplicated installation counts are lower bounds.`
        : `No write sampling observed in this window (max _sample_interval = ${Math.max(max, 1)}). Counts are exact.`,
  };
}

function percentage(numerator, denominator) {
  if (denominator <= 0) return undefined;
  return Math.round((numerator / denominator) * 100);
}

/**
 * A metric is present only if its query ran. `--metric` produces a partial run,
 * and printing a zero for a metric that was never queried would report an
 * unmeasured value as a measured zero.
 */
function collectReport(opts, window, results, firstObserved, queries) {
  const ran = (id) => Object.hasOwn(results, id);
  const verdict = samplingVerdict(results);
  const exactness = verdict.sampled ? LOWER_BOUND : EXACT;
  const report = {
    schemaVersion: 1,
    dataset: DATASET,
    generatedFrom: "scripts/telemetry-queries.mjs",
    definitionsFrozenOn: DEFINITIONS_FROZEN_ON,
    firstObservedInstallRequestDay: firstObserved,
    partial: queries.length < QUERIES.length,
    reportingRange: {
      since: window.since,
      until: window.until,
      timeZone: "UTC",
      trailing7From: window.trailing7,
      trailing30From: window.trailing30,
      note:
        daysBetween(window.trailing7, window.since) < 0
          ? "The trailing 7-day window begins before the reporting start; days before the first measured installer request contain no events and were never backfilled."
          : undefined,
    },
    sampling: verdict,
    vocabulary: {
      installerRequests: "a fetch of the official installer script",
      anonymousInstallations: "a deduplicated local installation id; the unit of deduplication is the installation",
      externalWording: "since <date>, Campfire has recorded <n> anonymous installations",
    },
    counts: {},
    rates: [],
    breakdowns: {},
    queries: Object.fromEntries(Object.entries(results).map(([id, rows]) => [id, rows])),
    options: { runner: opts.runner, metric: opts.metric ?? "all", executed: queries.map((query) => query.id) },
  };

  // Each installer-request window is its own query, so each sub-value reports
  // only when its own query ran. Gating the group on one of them — the recent-day
  // query was the gate — silently discarded a `--metric installer_requests_since`
  // run, because the metric that actually executed was never read back.
  for (const [key, id] of [
    ["recentDay", "installer_requests_recent_day"],
    ["sinceLaunch", "installer_requests_since"],
    ["trailing7Days", "installer_requests_trailing_7d"],
    ["trailing30Days", "installer_requests_trailing_30d"],
  ]) {
    if (!ran(id)) continue;
    const measured = { value: number(firstRow(results[id]).installer_requests), treatment: WEIGHTED };
    // `recentDay` is the only window whose label is the day it measured.
    report.counts.installerRequests ??= {};
    report.counts.installerRequests[key] =
      key === "recentDay" ? { day: window.lastDay, ...measured } : measured;
  }
  if (ran("successful_installations")) {
    report.counts.successfulInstallations = {
      value: number(firstRow(results.successful_installations).anonymous_installations),
      events: number(firstRow(results.successful_installations).install_completed_events),
      treatment: exactness,
    };
  }
  if (ran("excluded_below_reporting_floor")) {
    // An empty result is a measured zero: the query ran and found no sub-floor
    // install_completed rows. It is not an unmeasured window.
    report.counts.excludedBelowReportingFloor = rowsOf(results.excluded_below_reporting_floor).map((row) => ({
      campfireVersion: String(row.campfire_version ?? ""),
      anonymousInstallations: number(row.anonymous_installations),
      events: number(row.events),
      treatment: exactness,
    }));
  }
  if (ran("activated_installations")) {
    report.counts.activatedInstallations = {
      value: number(firstRow(results.activated_installations).activated_installations),
      events: number(firstRow(results.activated_installations).activated_events),
      treatment: exactness,
    };
  }
  for (const [key, id] of [
    ["activeInstallations7d", "active_installations_7d"],
    ["activeInstallations30d", "active_installations_30d"],
  ]) {
    if (ran(id)) {
      report.counts[key] = {
        value: number(firstRow(results[id])[id]),
        treatment: exactness,
      };
    }
  }
  if (ran("daily_active_installations")) {
    report.counts.dailyActiveInstallations = rowsOf(results.daily_active_installations).map((row) => ({
      utcDay: String(row.utc_day ?? ""),
      activeInstallations: number(row.active_installations),
    }));
  }
  if (ran("weekly_active_installations")) {
    report.counts.weeklyActiveInstallations = rowsOf(results.weekly_active_installations).map((row) => ({
      utcWeekStart: String(row.utc_week_start ?? ""),
      activeInstallations: number(row.active_installations),
    }));
  }
  if (ran("returning_installations")) {
    report.counts.returningInstallations = {
      value: number(firstRow(results.returning_installations).returning_installations),
      treatment: exactness,
    };
  }

  const installations = report.counts.successfulInstallations?.value;
  const activated = report.counts.activatedInstallations?.value;
  if (installations !== undefined && report.counts.installerRequests?.sinceLaunch !== undefined) {
    report.rates.push({
      name: "install_completion",
      value: percentage(installations, report.counts.installerRequests.sinceLaunch.value),
      unit: "percent",
      numerator: { label: "successful installations", value: installations, treatment: exactness },
      denominator: {
        label: "installer requests since launch",
        value: report.counts.installerRequests.sinceLaunch.value,
        treatment: WEIGHTED,
      },
      note: "Installer interest and installation success are measured separately and never combined (§20 rule 2).",
    });
  }
  if (activated !== undefined && installations !== undefined) {
    report.rates.push({
      name: "activation",
      value: percentage(activated, installations),
      unit: "percent",
      numerator: { label: "activated installations", value: activated, treatment: exactness },
      denominator: { label: "successful installations", value: installations, treatment: exactness },
      note: "Activation is decided once per installation and emitted at most once.",
    });
  }

  for (const query of queries) {
    if (query.breakdown === undefined || query.exclusion === true) continue;
    const { dimension, measure } = query.breakdown;
    report.breakdowns[dimension] = rowsOf(results[query.id]).map((row) => ({
      value: String(row[dimension] ?? ""),
      ...(measure === "anonymous_installations"
        ? { anonymousInstallations: number(row.anonymous_installations), events: number(row.events) }
        : { installerRequests: number(row.installer_requests) }),
    }));
  }
  return report;
}

function formatNumber(value) {
  return value.toLocaleString("en-US");
}

/** Long treatments are for the catalogue; the report needs one phrase per count. */
function shortTreatment(treatment) {
  if (treatment === EXACT) return "exact (unsampled)";
  if (treatment === LOWER_BOUND) return "lower bound (deduplicated, sampling not weighted)";
  return "approximate (sample-weighted)";
}

/** One aligned metric line: label, right-aligned count, then its treatment. */
function metricLine(label, value, treatment) {
  return `  ${label.padEnd(34)}${formatNumber(value).padStart(9)}  ${shortTreatment(treatment)}`;
}

function renderText(report) {
  const range = report.reportingRange;
  const requests = report.counts.installerRequests;
  const lines = [];
  lines.push("CAMPFIRE — ANONYMOUS INSTALLATION TELEMETRY");
  lines.push(`Reporting range: ${range.since} → ${range.until} (UTC, inclusive)`);
  lines.push(`First measured installer request: ${report.firstObservedInstallRequestDay} (UTC)`);
  lines.push(`Dataset: ${report.dataset} — Cloudflare Analytics Engine`);
  lines.push(`Metric definitions frozen: ${report.definitionsFrozenOn}, before the first measured event`);
  if (report.partial) lines.push(`PARTIAL RUN — only these queries ran: ${report.options.executed.join(", ")}`);
  lines.push("");

  if (requests !== undefined) {
    lines.push("INSTALLER REQUESTS — fetches of the official installer script");
    // A partial run measured only some of the four windows, so each entry is
    // rendered on its own. Dereferencing all four unconditionally crashed the
    // render, and filling a missing window with a zero would report a value that
    // was never measured as one that was.
    for (const [label, entry] of [
      [requests.recentDay === undefined ? undefined : `${requests.recentDay.day} (most recent day)`, requests.recentDay],
      [`since ${range.since}`, requests.sinceLaunch],
      ["trailing 7 days", requests.trailing7Days],
      ["trailing 30 days", requests.trailing30Days],
    ]) {
      if (entry === undefined) continue;
      lines.push(metricLine(label, entry.value, entry.treatment));
    }
    lines.push("");
  }

  lines.push("FUNNEL — installer requests and completions are never combined");
  lines.push("  Client events whose declared version is below 1.9.1 are omitted from the counts below.");
  const funnel = [
    ["installer requests (since launch)", requests?.sinceLaunch],
    ["successful installations", report.counts.successfulInstallations],
    ["activated installations", report.counts.activatedInstallations],
    ["7-day active installations", report.counts.activeInstallations7d],
    ["30-day active installations", report.counts.activeInstallations30d],
    ["returning installations", report.counts.returningInstallations],
  ];
  for (const [label, metric] of funnel) {
    if (metric === undefined) continue;
    lines.push(metricLine(label, metric.value, metric.treatment));
  }
  lines.push("");

  if (report.counts.excludedBelowReportingFloor !== undefined) {
    lines.push("EXCLUDED FROM THE FUNNEL — declared version below 1.9.1");
    lines.push("  A binary older than 1.9.1 has no telemetry code, so these install_completed rows are provably forged.");
    lines.push("  They remain in the dataset. Every founder count above omits them.");
    const excluded = report.counts.excludedBelowReportingFloor;
    if (excluded.length === 0) {
      lines.push(metricLine("excluded installations", 0, report.sampling.sampled ? LOWER_BOUND : EXACT));
    } else {
      for (const row of excluded) {
        lines.push(metricLine(row.campfireVersion, row.anonymousInstallations, row.treatment));
      }
    }
    lines.push("");
  }

  if (report.rates.length > 0) {
    lines.push("RATES — the denominator is named on every line");
    for (const rate of report.rates) {
      const shown = rate.value === undefined ? "undefined (denominator is zero)" : `${rate.value}%`;
      lines.push(`  ${rate.name.padEnd(20)} ${shown}`);
      lines.push(
        `    numerator   ${formatNumber(rate.numerator.value).padStart(9)} ${rate.numerator.label} — ${shortTreatment(rate.numerator.treatment)}`,
      );
      lines.push(
        `    denominator ${formatNumber(rate.denominator.value).padStart(9)} ${rate.denominator.label} — ${shortTreatment(rate.denominator.treatment)}`,
      );
      lines.push(`    ${rate.note}`);
    }
    lines.push("");
  }

  if ((report.counts.dailyActiveInstallations ?? []).length > 0) {
    lines.push("DAILY ACTIVE INSTALLATIONS — UTC days, trailing 7");
    for (const row of report.counts.dailyActiveInstallations) {
      lines.push(`  ${row.utcDay}  ${formatNumber(row.activeInstallations)}`);
    }
    lines.push("");
  }
  if ((report.counts.weeklyActiveInstallations ?? []).length > 0) {
    lines.push("WEEKLY ACTIVE INSTALLATIONS — UTC weeks, trailing 30 days, weeks start Monday");
    for (const row of report.counts.weeklyActiveInstallations) {
      lines.push(`  week of ${row.utcWeekStart}  ${formatNumber(row.activeInstallations)}`);
    }
    lines.push("");
  }

  if (Object.keys(report.breakdowns).length > 0) {
    lines.push("BREAKDOWNS — event and window are in the query catalogue (--list)");
    for (const [dimension, rows] of Object.entries(report.breakdowns)) {
      lines.push(`  ${dimension}`);
      for (const row of rows) {
        const measure =
          row.anonymousInstallations === undefined
            ? `${formatNumber(row.installerRequests)} installer requests — ${shortTreatment(WEIGHTED)}`
            : `${formatNumber(row.anonymousInstallations)} anonymous installations — ${shortTreatment(
                report.counts.successfulInstallations?.treatment ?? LOWER_BOUND,
              )}`;
        lines.push(`    ${row.value.padEnd(16)} ${measure}`);
      }
    }
    lines.push("");
  }

  lines.push("SAMPLING");
  lines.push(`  ${report.sampling.note}`);
  lines.push(`  weighted counts: ${report.sampling.weightedCounts}`);
  lines.push(`  deduplicated counts: ${report.sampling.deduplicatedCounts}`);
  if (range.note !== undefined) lines.push(`  ${range.note}`);
  lines.push("");
  lines.push("REPORTABLE WORDING — always include the reporting date range");
  // The sentence asserts three counts at once, so defaulting a missing one to
  // zero would state a measured zero for a query that never ran — the same false
  // statement the returning-installations line produced when that query failed.
  // In a partial run the sentence is not emitted at all: only the measured
  // figures are named, and the missing ones are declared unmeasured.
  const successfulInstallations = report.counts.successfulInstallations?.value;
  const activatedInstallations = report.counts.activatedInstallations?.value;
  const returningInstallations = report.counts.returningInstallations?.value;
  if (successfulInstallations !== undefined && activatedInstallations !== undefined && returningInstallations !== undefined) {
    lines.push(
      `  Since ${range.since}, Campfire has recorded ` +
        `${formatNumber(successfulInstallations)} successful anonymous installations, ` +
        `${formatNumber(activatedInstallations)} of which activated the product, with ` +
        `${formatNumber(returningInstallations)} installations returning on a later day.`,
    );
  } else {
    const measured = [
      [successfulInstallations, "successful anonymous installations"],
      [activatedInstallations, "activated installations"],
      [returningInstallations, "installations returning on a later day"],
    ]
      .filter(([value]) => value !== undefined)
      .map(([value, label]) => `${formatNumber(value)} ${label}`);
    if (measured.length === 0) {
      lines.push(
        `  Not available: this run measured no reportable installation count (${report.options.executed.join(", ")}).`,
      );
    } else {
      lines.push(
        `  PARTIAL RUN — measured here for ${range.since} → ${range.until} (UTC): ${measured.join("; ")}.`,
      );
      lines.push("  Not a full statement about the reporting range: re-run without --metric to measure every count.");
    }
  }
  return lines.join("\n");
}

function renderList() {
  const lines = [`Query catalogue — dataset ${DATASET} (definitions frozen ${DEFINITIONS_FROZEN_ON})`, ""];
  lines.push(`${FIRST_OBSERVED_QUERY.id} (always runs first)`);
  lines.push(`  ${FIRST_OBSERVED_QUERY.title}`);
  lines.push(`  why: ${FIRST_OBSERVED_QUERY.purpose}`);
  lines.push(`  sampling: ${FIRST_OBSERVED_QUERY.sampling}`);
  lines.push("");
  for (const query of QUERIES) {
    lines.push(query.id);
    lines.push(`  ${query.title}`);
    lines.push(`  why: ${query.purpose}`);
    lines.push(`  sampling: ${query.sampling}`);
    lines.push("");
  }
  lines.push(`Default --since: ${DEFAULT_SINCE}. A window that begins before the first observed installer`);
  lines.push("request is refused rather than reported as zero.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function planLines(opts, window, queries) {
  const lines = [];
  lines.push("PLAN");
  lines.push(`  dataset: ${DATASET}`);
  lines.push(`  runner: ${opts.runner}`);
  lines.push(`  reporting range: ${window.since} → ${window.until} (UTC, inclusive)`);
  lines.push(`  queries: ${queries.length + 1} (including the first-observed guard)`);
  lines.push("");
  const planned = [FIRST_OBSERVED_QUERY, ...queries];
  planned.forEach((query, index) => {
    lines.push(`${index === 0 ? "FIRST" : `QUERY ${index}`} — ${query.id}: ${query.title}`);
    lines.push(`  sampling: ${query.sampling}`);
    lines.push(printedCommand(query.sql(window), opts.runner));
    lines.push("");
  });
  return lines.join("\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    emit(`${USAGE}\n`);
    return;
  }
  if (opts.list) {
    emit(`${renderList()}\n`);
    return;
  }

  const window = buildWindow(opts);
  const queries = selectedQueries(opts.metric);
  emit(`${planLines(opts, window, queries)}\n`);

  if (opts.dryRun) {
    emit("Dry run: nothing was sent.\n");
    return;
  }
  if (!opts.confirm) {
    fail(
      "refusing to contact the Cloudflare account without --confirm. Re-run with --confirm, or with --dry-run to only print the plan.",
    );
  }

  const firstObserved = String(
    firstRow(await runQuery(FIRST_OBSERVED_QUERY.sql(window), opts)).first_observed_install_request_day ?? "",
  );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstObserved)) {
    fail(
      "no installer request has ever been recorded in this dataset, so no reporting window can be produced. Refusing to report an unmeasured period as zero (§20 rule 6).",
    );
  }
  if (daysBetween(firstObserved, window.since) < 0) {
    fail(
      `the reporting window starts ${window.since}, before the first observed installer request (${firstObserved}). Those days were never measured and are not backfilled (§20 rule 6). Re-run with --since ${firstObserved} or later.`,
    );
  }
  const results = {};
  for (const query of queries) {
    results[query.id] = await runQuery(query.sql(window), opts);
  }

  const report = collectReport(opts, window, results, firstObserved, queries);
  emit(opts.output === "json" ? `${JSON.stringify(report, null, 2)}\n` : `${renderText(report)}\n`);
}

main().catch((error) => {
  fail(sanitizeDiagnostic(error instanceof Error ? error.message : String(error), token()));
});