import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateRawToken } from "../../src/service/tokens.js";
import { loadCredentials } from "../../src/bootstrap/profile.js";
import { publishWorkspace } from "../../src/publication/publish.js";
import { readPublicationState, savePublicationState } from "../../src/publication/state.js";
import { loadRemoteProfile } from "../../src/bootstrap/remote-profile.js";
import { SHR, isolatedProfileEnv, seedShrLocalWorkspace, writeShrLocalProfile } from "../helpers/shr-001.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("SHR-001 cutover recovery", () => {
  it("finishes cut_over from a verified receipt after the remote profile was already written", async () => {
    const root = mkdtempSync(join(tmpdir(), "shr-resume-"));
    roots.push(root);
    const env = isolatedProfileEnv(root);
    const databasePath = join(root, "campfire.db");
    seedShrLocalWorkspace(databasePath);
    writeShrLocalProfile(env, databasePath);
    const endpoint = "http://127.0.0.1:19414";
    const humanToken = generateRawToken();
    const agentToken = generateRawToken();
    const receipt = {
      version: 1 as const,
      kind: "workspace_publication" as const,
      publicationId: "pub_resume",
      state: "verified" as const,
      endpoint,
      workspaceId: SHR.workspaceId,
      workspaceName: SHR.workspaceName,
      sourceDatabasePath: databasePath,
      sourcePackageVersion: "1.26.1",
      sourceSchemaVersion: 10,
      sourceTip: 10,
      snapshotDigest: "c".repeat(64),
      counts: {
        humans: 1, agents: 1, participants: 2, sessions: 1, goals: 1, tasks: 0,
        findings: 1, decisions: 1, artifacts: 1, findingTransitions: 0,
        decisionTransitions: 0, findingEvidence: 1, decisionCitations: 1,
        contributions: 10, contributionTip: 10,
      },
      owner: { humanId: SHR.humanId, displayName: SHR.humanName },
      agents: [{ id: SHR.agentId, name: SHR.agentName, harness: "codex" as const }],
      organizationId: "org_hosted",
      teamId: "team_hosted",
      importedAt: "2026-10-23T16:00:00.000Z",
      verifiedAt: "2026-10-23T16:01:00.000Z",
      nextAction: "cut_over_local_profile",
    };
    savePublicationState({
      version: 1,
      receipt,
      credentials: { humanToken, agents: { codex: agentToken }, recoverySecret: `cfr_${"8".repeat(32)}` },
    }, env);
    // Simulate a profile write that succeeded while the credential file still
    // holds the old local bundle. Recovery must overwrite it, not conflict.
    writeFileSync(join(env.CAMPFIRE_CONFIG_DIR!, "config.json"), `${JSON.stringify({
      version: 2,
      mode: "remote",
      url: endpoint,
      humanId: SHR.humanId,
      humanName: SHR.humanName,
      workspaceId: SHR.workspaceId,
      workspaceName: SHR.workspaceName,
      goalTitle: "Audit Arbora",
      agents: [{ id: SHR.agentId, name: SHR.agentName, harness: "codex" }],
    }, null, 2)}\n`);
    expect(loadRemoteProfile(env)?.workspaceId).toBe(SHR.workspaceId);
    expect(loadCredentials(env)?.endpoint).toBeUndefined();

    const result = await publishWorkspace({
      endpoint,
      databasePath,
      localUrl: endpoint,
      ownerHumanId: SHR.humanId,
      ownerHumanName: SHR.humanName,
      packageVersion: "1.26.1",
      workspaceId: SHR.workspaceId,
      allowLoopbackHttp: true,
      connect: false,
      env,
    });
    expect(result.receipt.state).toBe("cut_over");
    expect(result.receipt.publicationId).toBe("pub_resume");
    expect(readPublicationState(env)?.receipt.state).toBe("cut_over");
    expect(readPublicationState(env)?.credentials?.humanToken).toBe(humanToken);
    expect(loadCredentials(env)?.endpoint).toBe(endpoint);
    expect(loadCredentials(env)?.humanToken).toBe(humanToken);
  });
});
