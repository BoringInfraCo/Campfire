import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { hashToken } from "../../src/service/tokens.js";
import { readWorkspaceSnapshot } from "../../src/publication/snapshot.js";
import { createD1Store, migrateD1 } from "../../src/worker/d1-store.js";
import { createD1WorkerHandler } from "../../src/worker/handler.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";

const CAPTURE = join(process.env.HOME ?? "", ".local", "share", "campfire-arbora", "campfire.db");
const OWNER = "hum_156ff89c089f4d13";
const AGENT = "agt_955034ffb2544082";
const WORKSPACE = "ws_df6794f33efc459b";
const FINDING = "find_5cd543722a044c20";
const OWNER_TOKEN = `cft_${"5".repeat(32)}`;
const AGENT_TOKEN = `cft_${"6".repeat(32)}`;
const REHEARSAL_CODE = `cfrh_${"d".repeat(48)}`;
const NOW = "2026-10-23T16:00:00.000Z";

describe.skipIf(!existsSync(CAPTURE))("SHR-001 installed Arbora capture", () => {
  it("re-reads the frozen source and imports the same finding without altering the local database", async () => {
    const snapshot = readWorkspaceSnapshot({
      databasePath: CAPTURE,
      workspaceId: WORKSPACE,
      ownerHumanId: OWNER,
      packageVersion: "1.26.2",
      exportedAt: NOW,
    });
    expect(snapshot.source.contributionTip).toBe(8);
    expect(snapshot.counts).toMatchObject({
      humans: 1, agents: 1, participants: 2, sessions: 2, goals: 1, tasks: 0,
      findings: 1, decisions: 0, artifacts: 0, contributions: 8, contributionTip: 8,
    });
    expect(snapshot.findings.map((row) => row.id)).toEqual([FINDING]);
    expect(snapshot.digest).toBe("4c8496e92290db32d1efe21411686e87bb6c0e26e4706dfaf9bf0091e5bba757");
    expect(snapshot.contributions[3]?.objectType).toBe("invite");

    const adapter = sqliteD1();
    await migrateD1(adapter.binding);
    const store = createD1Store(adapter.binding);
    const ids = createCounterIdSource();
    const handle = createD1WorkerHandler({
      store,
      clock: () => NOW,
      idSource: ids,
      publication: { db: adapter.binding, enabled: true, clock: () => NOW, idSource: ids, rehearsalCodeHash: hashToken(REHEARSAL_CODE) },
    });
    const call = async (path: string, token: string | undefined, body?: unknown) => {
      const response = await handle(new Request(`https://host.test${path}`, {
        method: "POST",
        headers: {
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          "content-type": "application/json",
          "x-campfire-rehearsal-code": REHEARSAL_CODE,
        },
        body: JSON.stringify(body ?? {}),
      }));
      return { status: response.status, body: await response.json() as any };
    };
    const enrollment = await call("/v1/publication/enroll", undefined, {
      requestId: "installed-arbora-capture",
      humanId: OWNER,
      humanName: "Sergio",
      humanTokenHash: hashToken(OWNER_TOKEN),
      recoveryHash: hashToken(`cfr_${"7".repeat(32)}`),
      agents: [{ id: AGENT, name: "Codex", harness: "codex", tokenHash: hashToken(AGENT_TOKEN) }],
      workspaceName: "Arbora",
      sourceWorkspaceId: WORKSPACE,
      sourcePackageVersion: "1.26.2",
      sourceSchemaVersion: 10,
      deviceKeyHash: hashToken("installed-device"),
    });
    expect(enrollment.status).toBe(200);
    const imported = await call("/v1/publication/import", OWNER_TOKEN, {
      requestId: "installed-arbora-capture", digest: snapshot.digest, snapshot,
    });
    expect(imported.status).toBe(200);
    expect(imported.body.result.sourceTip).toBe(8);

    const ownerRead = await call("/v1/call", OWNER_TOKEN, { method: "get_finding", params: { workspaceId: WORKSPACE, findingId: FINDING } });
    expect(ownerRead.body.result.id).toBe(FINDING);
    const agentRead = await call("/v1/call", AGENT_TOKEN, { method: "get_finding", params: { workspaceId: WORKSPACE, findingId: FINDING } });
    expect(agentRead.body.result.id).toBe(FINDING);
    adapter.database.close();
  });
});
