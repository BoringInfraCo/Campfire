import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PublicationReceipt } from "../../src/domain/publication.js";
import {
  acquirePublicationLock,
  assertLocalWritesAllowed,
  formatPublicationReceipt,
  isPublicationBlockedMethod,
  markPublicationCutover,
  readPublicationState,
  releasePublicationLock,
  savePublicationState,
} from "../../src/publication/state.js";
import { isolatedProfileEnv } from "../helpers/shr-001.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function receipt(): PublicationReceipt {
  return {
    version: 1,
    kind: "workspace_publication",
    publicationId: "pub_guard",
    state: "staged",
    endpoint: "https://campfire.example.test",
    workspaceId: "ws_guard",
    workspaceName: "Guard workspace",
    sourceDatabasePath: "/tmp/campfire.db",
    sourcePackageVersion: "1.26.2",
    sourceSchemaVersion: 10,
    sourceTip: 3,
    snapshotDigest: "a".repeat(64),
    counts: {
      humans: 1, agents: 1, participants: 2, sessions: 1, goals: 1, tasks: 0,
      findings: 1, decisions: 0, artifacts: 0, findingTransitions: 0,
      decisionTransitions: 0, findingEvidence: 0, decisionCitations: 0,
      contributions: 3, contributionTip: 3,
    },
    owner: { humanId: "hum_guard", displayName: "Owner" },
    agents: [{ id: "agt_guard", name: "Codex", harness: "codex" }],
    nextAction: "resume_publish",
  };
}

describe("SHR-001 publication guard and receipt", () => {
  it("freezes supported local writes while a publication lock is active", () => {
    const root = mkdtempSync(join(tmpdir(), "shr-guard-"));
    roots.push(root);
    const env = isolatedProfileEnv(root);
    expect(isPublicationBlockedMethod("add_finding")).toBe(true);
    expect(isPublicationBlockedMethod("get_workspace")).toBe(false);
    expect(() => assertLocalWritesAllowed("/tmp/campfire.db", env)).not.toThrow();
    acquirePublicationLock({ workspaceId: "ws_guard", publicationId: "pub_guard", databasePath: "/tmp/campfire.db" }, env);
    expect(() => assertLocalWritesAllowed("/tmp/campfire.db", env)).toThrow(/frozen/);
    expect(() => assertLocalWritesAllowed("/tmp/other.db", env)).not.toThrow();
    releasePublicationLock("pub_guard", env);
    expect(() => assertLocalWritesAllowed("/tmp/campfire.db", env)).not.toThrow();
  });

  it("keeps a cut-over local database as a read-only backup", () => {
    const root = mkdtempSync(join(tmpdir(), "shr-cutover-"));
    roots.push(root);
    const env = isolatedProfileEnv(root);
    markPublicationCutover({
      workspaceId: "ws_guard",
      publicationId: "pub_guard",
      databasePath: "/tmp/campfire.db",
      cutOverAt: "2026-10-24T00:00:00.000Z",
    }, env);
    expect(() => assertLocalWritesAllowed("/tmp/campfire.db", env)).toThrow(/read-only backup/);
    expect(() => assertLocalWritesAllowed("/tmp/other.db", env)).not.toThrow();
  });

  it("stores credentials privately but never renders them in the receipt", () => {
    const root = mkdtempSync(join(tmpdir(), "shr-receipt-"));
    roots.push(root);
    const env = isolatedProfileEnv(root);
    const state = savePublicationState({
      version: 1,
      receipt: receipt(),
      credentials: { humanToken: `cft_${"a".repeat(32)}`, agents: { codex: `cft_${"b".repeat(32)}` }, recoverySecret: `cfr_${"c".repeat(32)}` },
    }, env);
    const mode = statSync(state).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(readPublicationState(env)?.credentials?.agents.codex).toBe(`cft_${"b".repeat(32)}`);
    const rendered = formatPublicationReceipt(readPublicationState(env)!.receipt);
    expect(rendered).toContain("Guard workspace");
    expect(rendered).not.toContain("cft_");
    expect(rendered).not.toContain("cfr_");
  });
});
