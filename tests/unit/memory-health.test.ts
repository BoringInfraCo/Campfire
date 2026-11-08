import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ValidationError } from "../../src/domain/errors.js";
import {
  MEMORY_HEALTH_REASONS,
  decodeMemoryHealthCursor,
  deriveMemoryHealthCues,
  orderMemoryHealthCues,
  pageMemoryHealth,
  type MemoryHealthCursorBinding,
  type MemoryHealthReason,
  type MemoryHealthRows,
} from "../../src/domain/memory-health.js";

interface SourceFinding {
  id: string;
  currentness: string;
  createdAt: string;
  correctedAt?: string;
  evidence?: Array<{ id: string; artifactId: string; relation: string; createdAt: string }>;
}

interface CandidateSource {
  tip: number;
  acceptedAction: { id: string; status: string; receiptId: string; outcome: string };
  action: {
    proposal: {
      id: string;
      status: string;
      revision: number;
      taskId: string;
      reservationId: string;
      createdAt: string;
      updatedAt: string;
    };
    receipt: { id: string; outcome: string; recordedAt: string };
  };
  decisions: Array<{
    id: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    citations?: Array<{ id: string; findingId: string; createdAt: string }>;
  }>;
  findings: SourceFinding[];
  tasks: Array<{
    id: string;
    status: string;
    descriptionPresent: boolean;
    assigneePresent: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  artifacts: Array<{ id: string; createdAt: string }>;
}

interface ExpectedCue {
  id: string;
  reason: string;
  subjectType: string;
  subjectId: string;
  relatedRecordIds: string[];
  summary: string;
  sourceFacts: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
  sourceUpdateTime: string;
}

const source = JSON.parse(
  readFileSync(new URL("../../fixtures/memory/mem-000/candidate-source.json", import.meta.url), "utf8"),
) as CandidateSource;
const key = JSON.parse(
  readFileSync(new URL("../../fixtures/memory/mem-000/candidate-projection-key.json", import.meta.url), "utf8"),
) as {
  observedAt: string;
  expectedCues: ExpectedCue[];
  unfilteredLimit2: Array<{ cueIds: string[]; nextCursorPresent: boolean }>;
};

const BINDING: MemoryHealthCursorBinding = {
  workspaceId: "ws_mempage",
  actorType: "human",
  actorId: "hum_mempage_member",
  role: "member",
  reason: null,
  limit: 2,
};

function rowsFromSource(): MemoryHealthRows {
  const findings = new Map(source.findings.map((finding) => [finding.id, finding]));
  const artifacts = new Map(source.artifacts.map((artifact) => [artifact.id, artifact.createdAt]));
  return {
    decisions: source.decisions.map((decision) => ({
      id: decision.id,
      status: decision.status,
      createdAt: decision.createdAt,
      updatedAt: decision.updatedAt,
      citations: (decision.citations ?? []).map((citation) => {
        const finding = findings.get(citation.findingId);
        return {
          id: citation.id,
          findingId: citation.findingId,
          createdAt: citation.createdAt,
          findingCurrentness: finding?.currentness ?? "missing",
          findingCreatedAt: finding?.createdAt ?? citation.createdAt,
          findingCorrectedAt: finding?.correctedAt,
        };
      }),
    })),
    findings: source.findings.map((finding) => ({
      id: finding.id,
      currentness: finding.currentness,
      createdAt: finding.createdAt,
      evidence: (finding.evidence ?? []).map((evidence) => ({
        id: evidence.id,
        artifactId: evidence.artifactId,
        relation: evidence.relation,
        createdAt: evidence.createdAt,
        artifactCreatedAt: artifacts.get(evidence.artifactId) ?? evidence.createdAt,
      })),
    })),
    tasks: source.tasks.map((task) => ({
      id: task.id,
      status: task.status,
      description: task.descriptionPresent ? "recorded context" : task.id.includes("whitespace") ? " \n\t " : "",
      assigneeId: task.assigneePresent ? "hum_mempage_member" : null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })),
    proposals: [
      {
        id: source.action.proposal.id,
        status: source.action.proposal.status,
        revision: source.action.proposal.revision,
        taskId: source.action.proposal.taskId,
        reservationId: source.action.proposal.reservationId,
        createdAt: source.action.proposal.createdAt,
        updatedAt: source.action.proposal.updatedAt,
        receipts: [source.action.receipt],
      },
      {
        id: source.acceptedAction.id,
        status: source.acceptedAction.status,
        revision: 1,
        taskId: "task_mempage_action",
        reservationId: "resv_mempage_accepted",
        createdAt: source.action.proposal.createdAt,
        updatedAt: source.action.proposal.updatedAt,
        receipts: [
          {
            id: source.acceptedAction.receiptId,
            outcome: source.acceptedAction.outcome,
            recordedAt: source.action.receipt.recordedAt,
          },
        ],
      },
    ],
  };
}

function pageInput(cursor?: string) {
  return {
    rows: rowsFromSource(),
    supportedReasons: MEMORY_HEALTH_REASONS,
    workspaceId: BINDING.workspaceId,
    actorType: BINDING.actorType,
    actorId: BINDING.actorId,
    role: BINDING.role,
    observedAt: key.observedAt,
    orientationCursor: "cf1.frozen",
    contributionTip: source.tip,
    limit: 2,
    cursor,
  };
}

describe("memory health projection", () => {
  it("matches the frozen eight cues and ignores clean controls", () => {
    const cues = orderMemoryHealthCues(deriveMemoryHealthCues(rowsFromSource(), MEMORY_HEALTH_REASONS));
    expect(cues).toEqual(key.expectedCues);
    const reasons = new Set(cues.map((cue) => cue.reason));
    expect(reasons).toEqual(new Set<MemoryHealthReason>(MEMORY_HEALTH_REASONS));
  });

  it("orders two contradictions on the same finding by cue id", () => {
    const cues = orderMemoryHealthCues(deriveMemoryHealthCues(rowsFromSource(), MEMORY_HEALTH_REASONS));
    const pair = cues.filter((cue) => cue.subjectId === "find_mempage_a").map((cue) => cue.id);
    const expected = key.expectedCues.filter((cue) => cue.subjectId === "find_mempage_a").map((cue) => cue.id);
    expect(pair).toEqual(expected);
    expect(pair[0]).toContain("fev_mempage_a1");
    expect(pair[1]).toContain("fev_mempage_a2");
  });

  it("pages the unfiltered limit-2 run", () => {
    let cursor: string | undefined;
    for (const expected of key.unfilteredLimit2) {
      const page = pageMemoryHealth(pageInput(cursor));
      expect(page.cues.map((cue) => cue.id)).toEqual(expected.cueIds);
      expect(page.nextCursor !== undefined).toBe(expected.nextCursorPresent);
      expect(page.coverage.total).toBe(8);
      expect(page.coverage.returned).toBe(expected.cueIds.length);
      cursor = page.nextCursor;
    }
    expect(cursor).toBeUndefined();
  });

  it("rejects a malformed cursor without echoing protected ids", () => {
    const token = `not-a-cursor:${BINDING.actorId}:${BINDING.workspaceId}`;
    try {
      decodeMemoryHealthCursor(token, BINDING);
      expect.fail("malformed cursor should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const validation = error as ValidationError;
      expect(validation.details).toEqual({ field: "cursor" });
      expect(validation.message).not.toContain(BINDING.actorId);
      expect(validation.message).not.toContain(BINDING.workspaceId);
    }
  });
});
