/**
 * Read-time decoration for COR-001.
 *
 * `needsReview` is computed here. It is not stored and it does not change a
 * decision's lifecycle. Superseded decisions keep their citations and do not
 * carry the flag, so leaving the current projection clears it.
 */
import type { Decision, DecisionCitation, Finding, FindingEvidence } from "../domain/types.js";

export function attachEvidence(findings: readonly Finding[], evidence: readonly FindingEvidence[]): Finding[] {
  if (evidence.length === 0) return [...findings];
  const grouped = new Map<string, FindingEvidence[]>();
  for (const row of evidence) {
    const list = grouped.get(row.findingId) ?? [];
    list.push(row);
    grouped.set(row.findingId, list);
  }
  return findings.map((finding) => {
    const rows = grouped.get(finding.id);
    if (rows === undefined || rows.length === 0) return finding;
    return { ...finding, evidence: rows };
  });
}

export function attachCitations(
  decisions: readonly Decision[],
  citations: readonly DecisionCitation[],
  staleFindingIds: ReadonlySet<string>,
): Decision[] {
  if (citations.length === 0) return [...decisions];
  const grouped = new Map<string, DecisionCitation[]>();
  for (const row of citations) {
    const list = grouped.get(row.decisionId) ?? [];
    list.push(row);
    grouped.set(row.decisionId, list);
  }
  return decisions.map((decision) => {
    const rows = grouped.get(decision.id);
    if (rows === undefined || rows.length === 0) return decision;
    const withCitations: Decision = { ...decision, citations: rows };
    if (decision.status === "superseded") return withCitations;
    const stale = rows.map((row) => row.findingId).filter((id) => staleFindingIds.has(id));
    if (stale.length === 0) return withCitations;
    return { ...withCitations, needsReview: true, needsReviewFindingIds: stale };
  });
}
