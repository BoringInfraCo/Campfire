import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertHostedActivityPrefix } from "../../src/publication/publish.js";
import { readWorkspaceSnapshot } from "../../src/publication/snapshot.js";
import { SHR, seedShrLocalWorkspace } from "../helpers/shr-001.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function snapshot() {
  const root = mkdtempSync(join(tmpdir(), "shr-verification-"));
  roots.push(root);
  const databasePath = join(root, "campfire.db");
  seedShrLocalWorkspace(databasePath);
  return readWorkspaceSnapshot({
    databasePath,
    workspaceId: SHR.workspaceId,
    ownerHumanId: SHR.humanId,
    packageVersion: "1.26.2-test",
    exportedAt: "2026-10-23T17:00:00.000Z",
  });
}

describe("SHR-001 idempotent verification", () => {
  it("accepts an extra register_session after the frozen source prefix", () => {
    const source = snapshot();
    const activity = [
      ...source.contributions,
      {
        id: "con_post_import_session",
        appendPosition: source.source.contributionTip + 1,
        action: "register_session",
        objectType: "agent_session",
        actor: { actorId: SHR.agentId },
      },
    ];
    expect(() => assertHostedActivityPrefix(source, activity, new Set([SHR.agentId]))).not.toThrow();
  });

  it("rejects any other post-import contribution", () => {
    const source = snapshot();
    const activity = [
      ...source.contributions,
      {
        id: "con_post_import_finding",
        appendPosition: source.source.contributionTip + 1,
        action: "create",
        objectType: "finding",
        actor: { actorId: SHR.agentId },
      },
    ];
    expect(() => assertHostedActivityPrefix(source, activity, new Set([SHR.agentId]))).toThrow(/changed after import/);
  });

  it("rejects a changed source prefix or a shorter history", () => {
    const source = snapshot();
    const changed = source.contributions.map((row, index) =>
      index === 0 ? { ...row, id: "con_changed" } : row);
    expect(() => assertHostedActivityPrefix(source, changed, new Set([SHR.agentId]))).toThrow(/ids do not match/);
    expect(() => assertHostedActivityPrefix(source, source.contributions.slice(0, -1), new Set([SHR.agentId]))).toThrow(/shorter/);
  });
});
