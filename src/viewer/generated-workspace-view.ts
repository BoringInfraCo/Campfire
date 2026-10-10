/** One credential-free, non-canonical projection of an authorized orientation read. */
import type { ActorRef, Artifact, Decision, Finding, Task } from "../domain/types.js";
import type { WorkspaceContext } from "../service/service.js";

export const GENERATED_VIEW_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "connect-src 'none'",
  "img-src 'none'",
  "style-src 'unsafe-inline'",
  "font-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "sandbox",
].join("; ");

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

function actor(ref: ActorRef): string {
  return `${ref.actorType} ${ref.actorId}`;
}

function provenance(item: { createdBy: ActorRef; createdAt: string; agentSessionId?: string }): string {
  return `${actor(item.createdBy)} · ${item.createdAt}${item.agentSessionId ? ` · session ${item.agentSessionId}` : ""}`;
}

function text(value: string | undefined): string {
  return value === undefined || value.length === 0 ? "" : `<p>${escapeHtml(value)}</p>`;
}

function row(title: string, labels: string[], detail?: string): string {
  return `<li><strong>${escapeHtml(title)}</strong><span class="labels">${labels.map(escapeHtml).join(" · ")}</span>${text(detail)}</li>`;
}

function taskRow(item: Task): string {
  return row(item.title, [item.status, provenance(item)], item.description);
}

function findingRow(item: Finding): string {
  return row(item.summary, [item.currentness ?? "current", provenance(item)], item.detail);
}

function decisionRow(item: Decision): string {
  const cited = item.needsReviewFindingIds?.filter((id) => id.length > 0) ?? [];
  const review = item.needsReview
    ? cited.length > 0
      ? `needs review ${cited.join(" ")}`
      : "needs review"
    : undefined;
  return row(item.summary, [item.status, ...(review === undefined ? [] : [review]), provenance(item)], item.rationale);
}

function currentWorkNote(tasksTruncated: boolean, decisionsTruncated: boolean): string {
  const parts = ["These counts cover the items returned in this orientation."];
  if (tasksTruncated) {
    parts.push("The task section is incomplete, so the in-progress and blocked counts are not workspace totals.");
  }
  if (decisionsTruncated) {
    parts.push("The decision section is incomplete, so the accepted count is not a workspace total.");
  }
  parts.push("Check each section's completeness before treating it as the whole workspace.");
  return parts.join(" ");
}

function artifactRow(item: Artifact): string {
  // The reference is text, never a navigable or fetched URL.
  return row(item.title, [item.type, provenance(item)], item.uriOrPath);
}

function section(title: string, slice: { total: number; returned: number; truncated: boolean }, items: string[], note?: string): string {
  const completeness = slice.truncated ? "incomplete; use the existing journal or CLI drill-down" : "complete for this section";
  return `<section><h2>${escapeHtml(title)}</h2><p class="count">${slice.returned} returned of ${slice.total} total · ${completeness}</p>${note ? `<p>${escapeHtml(note)}</p>` : ""}${items.length ? `<ul>${items.join("")}</ul>` : "<p>No items returned.</p>"}</section>`;
}

export function renderGeneratedWorkspaceView(context: WorkspaceContext): string {
  const next = context.suggestedNextAction;
  const nextAction = next.kind === "none" ? "No action suggested" : next.summary;
  const work = context.currentWork;
  const history = context.historicalCounts;
  const slices = context.slices;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(context.workspace.name)} · Campfire workspace view</title>
<style>
:root{color-scheme:light;font-family:system-ui,sans-serif;background:#f8f5ef;color:#24231f}
body{max-width:60rem;margin:0 auto;padding:2rem 1.2rem 4rem;line-height:1.5}
h1{font-size:2.2rem;line-height:1.1;margin:.3rem 0 1.5rem}h2{font-size:1.15rem;margin:0 0 .6rem}
header,section{border:1px solid #d9d3c7;border-radius:.75rem;background:#fff;padding:1.15rem 1.35rem;margin:0 0 1rem}
header{border-top:5px solid #fc6142}.eyebrow,.count,.labels{color:#5b594f;font-size:.9rem}
.eyebrow{font-weight:700;text-transform:uppercase;letter-spacing:.08em}ul{list-style:none;padding:0;margin:.7rem 0 0}
li{border-top:1px solid #e8e4dc;padding:.75rem 0}li strong,li span{display:block}li p{margin:.35rem 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
strong{overflow-wrap:anywhere}.count{margin:.2rem 0}.note{font-size:.88rem;color:#5b594f}
</style>
</head>
<body>
<header><p class="eyebrow">Campfire · derived workspace view</p><h1>${escapeHtml(context.workspace.name)}</h1>
<p class="note">Read-only orientation for this server's authorized actor. Generated on ${escapeHtml(context.generatedAt)}. The workspace remains the source of truth.</p></header>
<main>
<section><h2>Goal</h2>${context.goal ? `<strong>${escapeHtml(context.goal.title)}</strong>${text(context.goal.description)}<p class="labels">${escapeHtml(context.goal.status)} · ${escapeHtml(provenance(context.goal))}</p>` : "<p>No goal returned.</p>"}</section>
<section><h2>Suggested next action</h2><p>${escapeHtml(nextAction)}</p><p class="note">Orientation hint only. It is not permission to execute.</p></section>
<section><h2>Current work</h2><p>Among returned orientation items: ${work.inProgressTasks.length} in progress · ${work.blockedTasks.length} blocked · ${work.acceptedDecisions.length} accepted.</p><p class="note">${escapeHtml(currentWorkNote(slices.tasks.truncated, slices.decisions.truncated))}</p></section>
${section("Tasks", slices.tasks, slices.tasks.items.map(taskRow))}
${section("Blocked tasks", slices.blockers, slices.blockers.items.map(taskRow))}
${section("Decisions", slices.decisions, slices.decisions.items.map(decisionRow))}
${section("Current findings", slices.findings, slices.findings.items.map(findingRow))}
${section("Artifact references", slices.artifacts, slices.artifacts.items.map(artifactRow), "References are shown as text. This page does not fetch or preview their targets.")}
${section("Recent changes", slices.recentChanges, slices.recentChanges.items.map((item) => row(item.summary, [item.changeType, `${item.actorType} ${item.actorId}`, item.occurredAt])), "This is a bounded orientation, not the full contribution history.")}
<section><h2>History boundary</h2><p>${history.findings} historical findings · ${history.decisions} superseded decisions. Open the existing journal or CLI drill-down to inspect those records.</p></section>
</main>
</body>
</html>`;
}
