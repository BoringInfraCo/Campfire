/**
 * COR-001 surface tests. These cover the CLI, projection, and dispatch
 * contract. They do not claim a live harness trace, and they do not require
 * the correction service methods to be implemented.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLI_COMMAND_NAMES, formatCommandUsage, formatUsage } from "../../src/cli/catalog.js";
import { CLI_COMMAND_HANDLERS, runCliEntry } from "../../src/cli/index.js";
import {
  buildWorkspaceInspect,
  formatCorrectionResult,
  formatFindingLine,
  formatWorkspaceInspect,
} from "../../src/cli/projections.js";
import { ValidationError } from "../../src/domain/errors.js";
import { dispatchCampfireMethod, isCampfireHttpMethod } from "../../src/http/dispatch.js";
import { SESSION_INSTRUCTIONS } from "../../src/mcp/instructions.js";
import { createRuntimeFromPath } from "../../src/runtime.js";
import type { ActorContext } from "../../src/service/authorization.js";
import type { CampfireService } from "../../src/service/service.js";

type ServiceFn = (...args: any[]) => unknown;

const CORRECTION_COMMANDS = [
  "correct-finding",
  "withdraw-finding",
  "cite-evidence",
  "uncite-evidence",
  "cite-basis",
  "uncite-basis",
  "retire-decision",
] as const;

const HTTP_METHODS = [
  "correct_finding",
  "withdraw_finding",
  "cite_finding_evidence",
  "remove_finding_evidence",
  "cite_decision_basis",
  "remove_decision_basis",
  "retire_decision",
] as const;

describe("COR-001 CLI catalog", () => {
  it("lists the correction commands and says they do not edit the old assertion", () => {
    for (const name of CORRECTION_COMMANDS) {
      expect(CLI_COMMAND_NAMES).toContain(name);
      expect(CLI_COMMAND_HANDLERS[name]).toEqual(expect.any(Function));
      const help = formatCommandUsage(name);
      expect(help).toContain("does not edit the old assertion");
      expect(help).toContain("currentness");
    }
    const menu = formatUsage();
    expect(menu).toContain("do not edit the old assertion");
    expect(menu).toContain("--currentness current|superseded|withdrawn|all");
    expect(formatCommandUsage("add-decision")).toContain("does not edit the old assertion");
    expect(formatCommandUsage("accept-decision")).toContain("does not edit the old assertion");
    expect(formatCommandUsage("findings")).toContain("currentness");
  });

  it("rejects a missing correction reason before opening a workspace", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    const code = await runCliEntry(["correct-finding", "f_old", "--summary", "corrected"]);
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("reason");
    vi.restoreAllMocks();
  });

  it("rejects a malformed evidence flag and an unknown currentness", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    expect(await runCliEntry(["correct-finding", "f_old", "--summary", "s", "--reason", "r", "--evidence", "nope"])).toBe(1);
    expect(errors.join("\n")).toContain("artifactId:relation");
    errors.length = 0;
    expect(await runCliEntry(["findings", "--currentness", "stale"])).toBe(1);
    expect(errors.join("\n")).toContain("current|superseded|withdrawn|all");
    vi.restoreAllMocks();
  });
});

describe("COR-001 human projection", () => {
  it("prints correction fields when present and omits them when absent", () => {
    expect(formatFindingLine({ id: "f1", summary: "still true" })).toBe("f1  still true");
    const line = formatFindingLine({
      id: "f2",
      summary: "corrected",
      currentness: "current",
      reason: "typo",
      predecessorId: "f1",
      successorId: "f3",
      needsReview: true,
      evidence: [{ artifactId: "a1", relation: "supports" }],
      citations: [{ id: "c1" }],
    } as { id: string; summary: string });
    expect(line).toContain("currentness=current");
    expect(line).toContain("reason=typo");
    expect(line).toContain("predecessorId=f1");
    expect(line).toContain("successorId=f3");
    expect(line).toContain("needsReview=true");
    expect(line).toContain("evidence=");
    expect(line).toContain("citations=");

    const text = formatCorrectionResult({
      id: "f2",
      summary: "corrected",
      currentness: "current",
      reason: "typo",
      predecessorId: "f1",
    });
    expect(text).toContain("f2");
    expect(text).toContain("reason=typo");
    expect(text).not.toContain("successorId");
    expect(formatCorrectionResult({ evidenceId: "ev1" })).toBe("ev1");

    const withdrawn = formatCorrectionResult({
      id: "f9",
      summary: "old",
      currentness: "withdrawn",
      correctionReason: "could not reproduce",
      correctedBy: { actorId: "hum_grace", actorType: "human" },
      correctedAt: "2026-10-03T00:00:00.000Z",
    });
    expect(withdrawn).toContain("reason=could not reproduce");
    expect(withdrawn).toContain("correctedBy=hum_grace (human)");
    expect(withdrawn).toContain("correctedAt=2026-10-03T00:00:00.000Z");
    expect(withdrawn).not.toContain("supersededBy");
  });

  it("shows the same fields on inspect without inventing them", () => {
    const text = formatWorkspaceInspect(
      buildWorkspaceInspect("ws", "finding", {
        id: "f2",
        summary: "corrected",
        currentness: "superseded",
        reason: "replaced",
        predecessorId: "f1",
      }),
    );
    expect(text).toContain("currentness");
    expect(text).toContain("superseded");
    expect(text).toContain("predecessorId");
    expect(text).toContain("f1");
    expect(text).not.toContain("successorId");

    const inspected = formatWorkspaceInspect(
      buildWorkspaceInspect("ws", "decision", {
        id: "d2",
        summary: "skip the flush",
        status: "accepted",
        needsReview: true,
        needsReviewFindingIds: ["f9"],
        supersedeReason: "the flush repeats the old workaround",
        supersededBy: { actorId: "hum_grace", actorType: "human" },
      }),
    );
    expect(inspected).toContain("needsReviewFindingIds");
    expect(inspected).toContain("f9");
    expect(inspected).toContain("the flush repeats the old workaround");
    expect(inspected).toContain("hum_grace");
  });
});

describe("COR-001 dispatch", () => {
  const ctx: ActorContext = { actor: { actorId: "hum_test", actorType: "human" } };
  let dir: string | undefined;
  let closeRuntime: (() => void) | undefined;

  afterEach(() => {
    closeRuntime?.();
    closeRuntime = undefined;
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function serviceWith(overrides: Record<string, ServiceFn>): CampfireService {
    dir = mkdtempSync(join(tmpdir(), "campfire-cor-"));
    const runtime = createRuntimeFromPath(join(dir, "campfire.db"));
    closeRuntime = () => runtime.close();
    return new Proxy(runtime.service, {
      get(target, prop, receiver) {
        if (typeof prop === "string" && Object.prototype.hasOwnProperty.call(overrides, prop)) {
          return overrides[prop];
        }
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === "function" ? (value as ServiceFn).bind(target) : value;
      },
    }) as CampfireService;
  }

  it("names the correction methods and rejects a bad currentness or evidence list first", () => {
    for (const method of HTTP_METHODS) expect(isCampfireHttpMethod(method)).toBe(true);
    dir = mkdtempSync(join(tmpdir(), "campfire-cor-"));
    const runtime = createRuntimeFromPath(join(dir, "campfire.db"));
    closeRuntime = () => runtime.close();
    expect(() =>
      dispatchCampfireMethod(runtime.service, ctx, "list_findings", {
        workspaceId: "ws",
        currentness: "stale",
      }),
    ).toThrow(ValidationError);
    expect(() =>
      dispatchCampfireMethod(runtime.service, ctx, "correct_finding", {
        findingId: "f1",
        summary: "s",
        reason: "r",
        evidence: "not-a-list",
      }),
    ).toThrow(/evidence must be an array/);
  });

  it("forwards correction calls and does not rewrite the call into an edit", () => {
    const seen: Record<string, unknown> = {};
    const service = serviceWith({
      correctFinding: (_ctx, input) => {
        seen.correct = input;
        return { id: "f2", summary: "corrected", currentness: "current", reason: "typo", predecessorId: "f1" };
      },
      withdrawFinding: (_ctx, input) => {
        seen.withdraw = input;
        return input;
      },
      citeFindingEvidence: (_ctx, input) => {
        seen.citeEvidence = input;
        return input;
      },
      removeFindingEvidence: (_ctx, evidenceId) => {
        seen.uncite = evidenceId;
        return { evidenceId };
      },
      citeDecisionBasis: (_ctx, input) => {
        seen.citeBasis = input;
        return input;
      },
      removeDecisionBasis: (_ctx, citationId) => {
        seen.unciteBasis = citationId;
        return { citationId };
      },
      retireDecision: (_ctx, input) => {
        seen.retire = input;
        return input;
      },
      addDecision: (_ctx, input) => {
        seen.addDecision = input;
        return { id: "d2", summary: "next", status: "proposed" };
      },
      acceptDecision: (...args) => {
        seen.accept = args;
        return { id: "d1", status: "accepted" };
      },
      listFindingsPage: (_ctx, input) => {
        seen.list = input;
        return { schemaVersion: 1, workspaceId: "ws", items: [], total: 0, returned: 0, truncated: false };
      },
    });

    dispatchCampfireMethod(service, ctx, "correct_finding", {
      findingId: "f1",
      summary: "corrected",
      reason: "typo",
      evidence: [{ artifactId: "a1", relation: "supports", note: "log" }],
    });
    dispatchCampfireMethod(service, ctx, "withdraw_finding", { findingId: "f1", reason: "wrong" });
    dispatchCampfireMethod(service, ctx, "cite_finding_evidence", {
      findingId: "f1",
      artifactId: "a1",
      relation: "supports",
    });
    dispatchCampfireMethod(service, ctx, "remove_finding_evidence", { evidenceId: "ev1" });
    dispatchCampfireMethod(service, ctx, "cite_decision_basis", { decisionId: "d1", findingId: "f1", note: "basis" });
    dispatchCampfireMethod(service, ctx, "remove_decision_basis", { citationId: "cit1" });
    dispatchCampfireMethod(service, ctx, "retire_decision", { decisionId: "d1", reason: "no longer held" });
    dispatchCampfireMethod(service, ctx, "add_decision", {
      workspaceId: "ws",
      summary: "next",
      replacesDecisionId: "d1",
    });
    dispatchCampfireMethod(service, ctx, "accept_decision", { decisionId: "d1", reason: "agreed" });
    dispatchCampfireMethod(service, ctx, "list_findings", { workspaceId: "ws", currentness: "withdrawn" });

    expect(seen.correct).toMatchObject({ findingId: "f1", reason: "typo", evidence: [{ artifactId: "a1", relation: "supports", note: "log" }] });
    expect(seen.withdraw).toEqual({ findingId: "f1", reason: "wrong" });
    expect(seen.citeEvidence).toMatchObject({ findingId: "f1", artifactId: "a1", relation: "supports" });
    expect(seen.uncite).toEqual({ evidenceId: "ev1" });
    expect(seen.citeBasis).toMatchObject({ decisionId: "d1", findingId: "f1", note: "basis" });
    expect(seen.unciteBasis).toEqual({ citationId: "cit1" });
    expect(seen.retire).toEqual({ decisionId: "d1", reason: "no longer held" });
    expect(seen.addDecision).toMatchObject({ replacesDecisionId: "d1" });
    expect(seen.accept).toEqual([ctx, "d1", { reason: "agreed" }]);
    expect(seen.list).toMatchObject({ workspaceId: "ws", currentness: "withdrawn" });
  });
});

describe("COR-001 MCP guidance", () => {
  it("tells the session that correction does not edit the old assertion", () => {
    expect(SESSION_INSTRUCTIONS).toContain("correct_finding");
    expect(SESSION_INSTRUCTIONS).toContain("do not edit the old assertion");
    expect(SESSION_INSTRUCTIONS).toContain("retire_decision");
  });
});
