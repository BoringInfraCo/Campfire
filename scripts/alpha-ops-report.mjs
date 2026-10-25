#!/usr/bin/env node
/** Read-only, content-free operational report for the admitted hosted alpha. */
const names = {
  production: "campfire_alpha_ops",
  rehearsal: "campfire_shr001_alpha_ops",
};
const args = process.argv.slice(2);
const target = args.includes("--production") ? "production" : "rehearsal";
const dataset = names[target];
const confirm = args.includes("--confirm");
if (args.some((arg) => !["--production", "--rehearsal", "--confirm", "--dry-run"].includes(arg)) ||
    args.includes("--production") && args.includes("--rehearsal")) {
  console.error("Usage: node scripts/alpha-ops-report.mjs [--production|--rehearsal] [--dry-run|--confirm]");
  process.exit(2);
}

const sql = `SELECT blob1 AS route, blob3 AS outcome, blob4 AS status, SUM(_sample_interval) AS requests, ROUND(SUM(_sample_interval * double2) / SUM(_sample_interval)) AS mean_elapsed_ms, MAX(_sample_interval) AS max_sample_interval FROM ${dataset} WHERE timestamp > NOW() - INTERVAL '1' DAY GROUP BY route, outcome, status ORDER BY route, outcome, status`;
if (!confirm || args.includes("--dry-run")) {
  process.stdout.write(`${sql}\n`);
  process.exit(0);
}
const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
if (!account || !token || !/^[a-f0-9]{32}$/i.test(account)) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and a read-only CLOUDFLARE_API_TOKEN; neither is printed.");
  process.exit(2);
}
try {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "text/plain" },
    body: sql,
  });
  if (!response.ok) {
    console.error(`Analytics Engine query failed with HTTP ${response.status}`);
    process.exit(1);
  }
  const data = await response.json();
  const rows = Array.isArray(data) ? data : data?.data;
  if (!Array.isArray(rows)) {
    console.error("Analytics Engine returned an unexpected report shape");
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ target, window: "24h", rows })}\n`);
} catch {
  console.error("Analytics Engine query could not complete");
  process.exit(1);
}
