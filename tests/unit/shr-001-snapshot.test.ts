import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson, parsePublicationSnapshot } from "../../src/domain/publication.js";
import { inspectPublicationSource, readWorkspaceSnapshot } from "../../src/publication/snapshot.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";
import { SHR, seedShrLocalWorkspace } from "../helpers/shr-001.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function setup(): string {
  const root = mkdtempSync(join(tmpdir(), "shr-snapshot-"));
  roots.push(root);
  const db = join(root, "campfire.db");
  seedShrLocalWorkspace(db);
  return db;
}

describe("SHR-001 local snapshot", () => {
  it("captures the owner's graph at one append tip with original ids and digest", () => {
    const databasePath = setup();
    const inspection = inspectPublicationSource(databasePath, SHR.workspaceId, SHR.humanId);
    expect(inspection.owner).toEqual({ humanId: SHR.humanId, displayName: SHR.humanName });
    expect(inspection.unsupported).toEqual([]);
    expect(inspection.counts.findings).toBe(1);
    expect(inspection.sourceTip).toBe(10);

    const snapshot = readWorkspaceSnapshot({
      databasePath,
      workspaceId: SHR.workspaceId,
      ownerHumanId: SHR.humanId,
      packageVersion: "1.26.2-test",
      exportedAt: "2026-10-23T12:30:00.000Z",
    });
    expect(snapshot.workspace.id).toBe(SHR.workspaceId);
    expect(snapshot.findings.map((finding) => finding.id)).toEqual([SHR.findingId]);
    expect(snapshot.decisions[0]?.id).toBe(SHR.decisionId);
    expect(snapshot.findingEvidence[0]?.artifactId).toBe(SHR.artifactId);
    expect(snapshot.decisionCitations[0]?.findingId).toBe(SHR.findingId);
    expect(snapshot.sessions[0]?.id).toBe(SHR.sessionId);
    expect(snapshot.contributions.map((row) => row.appendPosition)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(snapshot.source.contributionTip).toBe(10);
    expect(snapshot.counts.contributionTip).toBe(10);
    expect(snapshot.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(snapshot)).not.toContain(SHR.humanToken);
    expect(JSON.stringify(snapshot)).not.toContain(SHR.agentToken);
  });

  it("refuses an unsupported workspace instead of skipping state", () => {
    const databasePath = setup();
    const store = openSqliteStore(databasePath);
    store.createInvite({
      id: "inv_local_pending",
      workspaceId: SHR.workspaceId,
      actor: { actorId: "hum_guest", actorType: "human" },
      role: "member",
      invitedBy: { actorId: SHR.humanId, actorType: "human" },
      createdAt: "2026-10-23T12:20:00.000Z",
    });
    store.close();
    expect(() => inspectPublicationSource(databasePath, SHR.workspaceId, SHR.humanId)).not.toThrow();
    const inspection = inspectPublicationSource(databasePath, SHR.workspaceId, SHR.humanId);
    expect(inspection.unsupported).toContainEqual({ feature: "workspace_invites", count: 1 });
    expect(() => readWorkspaceSnapshot({
      databasePath,
      workspaceId: SHR.workspaceId,
      ownerHumanId: SHR.humanId,
      packageVersion: "1.26.2-test",
      exportedAt: "2026-10-23T12:30:00.000Z",
    })).toThrow(/cannot preserve/);
  });

  it("refuses credential-shaped or absolute-path free text anywhere in the graph", () => {
    const databasePath = setup();
    const store = openSqliteStore(databasePath);
    store.createFinding({
      id: "find_sensitive_text",
      workspaceId: SHR.workspaceId,
      summary: "Token found: cft_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      detail: "See /Users/sergio/private/notes.md",
      currentness: "current",
      createdBy: { actorId: SHR.agentId, actorType: "agent" },
      agentSessionId: SHR.sessionId,
      createdAt: "2026-10-23T12:20:00.000Z",
    });
    store.close();
    expect(() => readWorkspaceSnapshot({
      databasePath,
      workspaceId: SHR.workspaceId,
      ownerHumanId: SHR.humanId,
      packageVersion: "1.26.2-test",
      exportedAt: "2026-10-23T12:30:00.000Z",
    })).toThrow(/credential-shaped material/);
  });

  it.each([
    ["/srv/secret/report.json", /absolute filesystem path/],
    ["<file:///Users/sergio/private/notes.md>", /absolute filesystem path/],
    ["`/Users/sergio/private/notes.md`", /absolute filesystem path/],
    ["[/Library/Application Support/secret]", /absolute filesystem path/],
    ["cfrh_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345", /credential-shaped material/],
    ["cfe_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", /credential-shaped material/],
    ["cfr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", /credential-shaped material/],
    ["sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", /credential-shaped material/],
    ["ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", /credential-shaped material/],
    ["github_pat_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", /credential-shaped material/],
    ["Bearer abcdefghijklmnopqrstuvwxyz012345", /credential-shaped material/],
    ["-----BEGIN PRIVATE KEY-----", /credential-shaped material/],
  ])("refuses free text %s", (text, expected) => {
    const databasePath = setup();
    const store = openSqliteStore(databasePath);
    store.updateDecision(SHR.decisionId, {
      rationale: text,
      updatedAt: "2026-10-23T12:20:00.000Z",
    });
    store.close();
    expect(() => readWorkspaceSnapshot({
      databasePath,
      workspaceId: SHR.workspaceId,
      ownerHumanId: SHR.humanId,
      packageVersion: "1.26.2-test",
      exportedAt: "2026-10-23T12:30:00.000Z",
    })).toThrow(expected);
  });

  it("refuses a credential-shaped auxiliary key", () => {
    const databasePath = setup();
    const store = openSqliteStore(databasePath);
    store.createArtifact({
      id: "art_credential_key",
      workspaceId: SHR.workspaceId,
      type: "report",
      title: "Report",
      uriOrPath: "https://example.invalid/report",
      metadata: { api_key: "not-printed" },
      createdBy: { actorId: SHR.humanId, actorType: "human" },
      createdAt: "2026-10-23T12:20:00.000Z",
    });
    store.close();
    expect(() => readWorkspaceSnapshot({
      databasePath,
      workspaceId: SHR.workspaceId,
      ownerHumanId: SHR.humanId,
      packageVersion: "1.26.2-test",
      exportedAt: "2026-10-23T12:30:00.000Z",
    })).toThrow(/credential-shaped key|secret field/);
  });

  it("refuses action mutation receipts even without an action proposal", () => {
    const databasePath = setup();
    const store = openSqliteStore(databasePath);
    store.putActionMutationReceipt({
      workspaceId: SHR.workspaceId,
      actorId: SHR.humanId,
      actorType: "human",
      method: "propose_action",
      requestKey: "residual",
      inputDigest: "a".repeat(64),
      resultJson: "{}",
      createdAt: "2026-10-23T12:20:00.000Z",
    });
    store.close();
    expect(inspectPublicationSource(databasePath, SHR.workspaceId, SHR.humanId).unsupported)
      .toContainEqual({ feature: "action_mutation_receipts", count: 1 });
  });

  it("refuses an actor id without its actor type", () => {
    const databasePath = setup();
    const snapshot = readWorkspaceSnapshot({
      databasePath,
      workspaceId: SHR.workspaceId,
      ownerHumanId: SHR.humanId,
      packageVersion: "1.26.2-test",
      exportedAt: "2026-10-23T12:30:00.000Z",
    });
    const bad = structuredClone(snapshot);
    bad.tasks.push({
      id: "task_missing_assignee_type",
      title: "bad assignee",
      status: "open",
      assigneeActorId: SHR.agentId,
      createdByActorId: SHR.humanId,
      createdByActorType: "human",
      createdAt: "2026-10-23T12:30:00.000Z",
      updatedAt: "2026-10-23T12:30:00.000Z",
    });
    bad.counts.tasks += 1;
    expect(() => parsePublicationSnapshot(bad)).toThrow(/Actor id and type/);
  });

  it("canonicalizes __proto__ as data rather than dropping it", () => {
    const value = JSON.parse('{"__proto__":{"polluted":true},"ok":1}') as unknown;
    const encoded = canonicalJson(value);
    expect(encoded).toContain('"__proto__"');
    expect(encoded).toContain('"polluted":true');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("refuses a filesystem artifact reference at the publication boundary", () => {
    const databasePath = setup();
    const store = openSqliteStore(databasePath);
    store.createArtifact({
      id: "art_local_path",
      workspaceId: SHR.workspaceId,
      type: "file",
      title: "Local notes",
      uriOrPath: "/private/var/campfire/notes.md",
      createdBy: { actorId: SHR.humanId, actorType: "human" },
      createdAt: "2026-10-23T12:20:00.000Z",
    });
    store.createContribution({
      id: "con_artifact_local_path",
      workspaceId: SHR.workspaceId,
      actor: { actorId: SHR.humanId, actorType: "human" },
      action: "create",
      objectType: "artifact",
      objectId: "art_local_path",
      createdAt: "2026-10-23T12:20:00.000Z",
    });
    store.close();
    expect(() => readWorkspaceSnapshot({
      databasePath,
      workspaceId: SHR.workspaceId,
      ownerHumanId: SHR.humanId,
      packageVersion: "1.26.2-test",
      exportedAt: "2026-10-23T12:30:00.000Z",
    })).toThrow(/HTTP\(S\) URLs|absolute filesystem path/);
  });

  it("refuses when the active human is not the local owner", () => {
    const databasePath = setup();
    expect(() => readWorkspaceSnapshot({
      databasePath,
      workspaceId: SHR.workspaceId,
      ownerHumanId: "hum_other",
      packageVersion: "1.26.2-test",
      exportedAt: "2026-10-23T12:30:00.000Z",
    })).toThrow(/owner/);
  });
});
