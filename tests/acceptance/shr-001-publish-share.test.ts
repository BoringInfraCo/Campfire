/**
 * SHR-001 end-to-end acceptance.
 *
 * Two isolated operator profiles and real HTTP. The MacBook profile owns a
 * local SQLite workspace; publication moves it to a D1-backed Worker handler
 * over HTTP and cuts the MacBook profile over. The iMac joins with its own
 * human and OpenCode identities and reads the original finding. The MacBook
 * local service is never started. A fresh MacBook process reads the iMac's
 * scoped task from the hosted service.
 *
 * This is a one-operator engineering rehearsal, not a two-human observation.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveInvitationFile } from "../../src/bootstrap/enrollment-client.js";
import { joinFromInvitation } from "../../src/bootstrap/enrollment-client.js";
import { loadCredentials } from "../../src/bootstrap/profile.js";
import { resolveRemoteAccess } from "../../src/bootstrap/remote-profile.js";
import type { IssuedEnrollmentInvitation } from "../../src/domain/enrollment.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { campfireHttpCall } from "../../src/http/client.js";
import { hashToken } from "../../src/service/tokens.js";
import { publishWorkspace } from "../../src/publication/publish.js";
import { readPublicationCutover, readPublicationState, savePublicationState } from "../../src/publication/state.js";
import { createD1Store, migrateD1 } from "../../src/worker/d1-store.js";
import { createD1WorkerHandler } from "../../src/worker/handler.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";
import { SHR, isolatedProfileEnv, seedShrLocalWorkspace, writeShrLocalProfile } from "../helpers/shr-001.js";

const NOW = "2026-10-23T14:00:00.000Z";
const REHEARSAL_CODE = `cfrh_${"a".repeat(48)}`;
const roots: string[] = [];
const servers: Server[] = [];
const closes: Array<() => void> = [];

afterEach(async () => {
  for (const close of closes.splice(0)) close();
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function readNodeBody(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function startHostedWorker(): Promise<{ url: string; database: ReturnType<typeof sqliteD1> }> {
  const adapter = sqliteD1();
  closes.push(() => adapter.database.close());
  await migrateD1(adapter.binding);
  const store = createD1Store(adapter.binding);
  const ids = createCounterIdSource();
  const handle = createD1WorkerHandler({
    store,
    clock: () => NOW,
    idSource: ids,
    publication: { db: adapter.binding, enabled: true, clock: () => NOW, idSource: ids, rehearsalCodeHash: hashToken(REHEARSAL_CODE) },
  });
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const body = await readNodeBody(req);
        const request = new Request(`http://127.0.0.1${req.url ?? "/"}`, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          ...(req.method === "GET" || req.method === "HEAD" ? {} : { body }),
        });
        const response = await handle(request);
        const bytes = new Uint8Array(await response.arrayBuffer());
        res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        res.end(Buffer.from(bytes));
      } catch {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "InternalError", message: "host failed" }));
      }
    })();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("host server did not bind");
  return { url: `http://127.0.0.1:${address.port}`, database: adapter };
}

describe("SHR-001 local publish → invite → join → continue with the source offline", () => {
  it("publishes the Arbora finding and lets the iMac create a task the MacBook later reads", async () => {
    const root = mkdtempSync(join(tmpdir(), "shr-acceptance-"));
    roots.push(root);
    const macRoot = join(root, "macbook");
    const imacRoot = join(root, "imac");
    const macEnv = isolatedProfileEnv(macRoot);
    const imacEnv = isolatedProfileEnv(imacRoot);
    const macDb = join(macRoot, "campfire.db");
    seedShrLocalWorkspace(macDb);
    writeShrLocalProfile(macEnv, macDb);

    const hosted = await startHostedWorker();
    const published = await publishWorkspace({
      endpoint: hosted.url,
      databasePath: macDb,
      localUrl: "http://127.0.0.1:9414",
      ownerHumanId: SHR.humanId,
      ownerHumanName: SHR.humanName,
      packageVersion: "1.26.2-test",
      allowLoopbackHttp: true,
      connect: false,
      rehearsalCode: REHEARSAL_CODE,
      env: macEnv,
      now: () => NOW,
      mcpCommand: "campfire",
    });
    expect(published.receipt.state).toBe("cut_over");
    expect(published.receipt.workspaceId).toBe(SHR.workspaceId);
    expect(published.receipt.sourceTip).toBe(10);
    const macState = readPublicationState(macEnv);
    expect(macState?.receipt.state).toBe("cut_over");
    expect(macState?.credentials?.humanToken).toMatch(/^cft_/);

    // The MacBook profile is now remote. No local SQLite service was started.
    const macAccess = resolveRemoteAccess({}, macEnv);
    expect(macAccess.url).toBe(hosted.url);
    expect(macAccess.workspaceId).toBe(SHR.workspaceId);
    const macFinding = await campfireHttpCall<{ id: string; currentness: string }>({
      baseUrl: macAccess.url,
      token: macAccess.token,
      method: "get_finding",
      params: { workspaceId: SHR.workspaceId, findingId: SHR.findingId },
    });
    expect(macFinding.id).toBe(SHR.findingId);
    expect(macFinding.currentness).toBe("current");

    // The owner issues the ordinary private invitation against the published workspace.
    const invitation = await campfireHttpCall<IssuedEnrollmentInvitation>({
      baseUrl: macAccess.url,
      token: macAccess.token,
      method: "issue_enrollment_invitation",
      params: { workspaceId: SHR.workspaceId },
    });
    const invitationPath = join(root, "invitation.json");
    saveInvitationFile(invitationPath, invitation, hosted.url, true);

    // The iMac joins with its own human and OpenCode agent identities.
    const imacJoin = await joinFromInvitation({
      invitationFile: invitationPath,
      humanName: "iMac Owner",
      harnesses: ["opencode"],
      configPaths: { opencode: join(imacRoot, "opencode.json") },
      mcpCommand: "campfire",
      allowLoopback: true,
    }, imacEnv);
    expect(imacJoin.workspace.id).toBe(SHR.workspaceId);
    expect(imacJoin.human.name).toBe("iMac Owner");
    expect(imacJoin.agents[0]?.harness).toBe("opencode");

    const imacAccess = resolveRemoteAccess({ harness: "opencode" }, imacEnv);
    const imacFinding = await campfireHttpCall<{ id: string; summary: string }>({
      baseUrl: imacAccess.url,
      token: imacAccess.token,
      method: "get_finding",
      params: { workspaceId: SHR.workspaceId, findingId: SHR.findingId },
    });
    expect(imacFinding.id).toBe(SHR.findingId);
    expect(imacFinding.summary).toContain("Arbora");

    const session = await campfireHttpCall<{ id: string; agentId: string }>({
      baseUrl: imacAccess.url,
      token: imacAccess.token,
      method: "register_agent_session",
      params: { workspaceId: SHR.workspaceId, agentId: imacJoin.agents[0]!.id, harness: "opencode" },
    });
    expect(session.agentId).toBe(imacJoin.agents[0]!.id);

    const task = await campfireHttpCall<{ id: string; title: string; createdBy: { actorId: string; actorType: string } }>({
      baseUrl: imacAccess.url,
      token: imacAccess.token,
      method: "create_task",
      params: {
        workspaceId: SHR.workspaceId,
        title: "Verify the Arbora billing deploy",
        description: `Scoped from ${SHR.findingId}`,
        agentSessionId: session.id,
      },
    });
    expect(task.createdBy.actorId).toBe(imacJoin.agents[0]!.id);
    expect(task.createdBy.actorType).toBe("agent");

    // The MacBook local service is still not running. A fresh process reads
    // the iMac task from the hosted service using the cut-over profile.
    const freshMacAccess = resolveRemoteAccess({}, macEnv);
    const tasks = await campfireHttpCall<{ items: Array<{ id: string; title: string; status: string }>; total: number }>({
      baseUrl: freshMacAccess.url,
      token: freshMacAccess.token,
      method: "list_tasks",
      params: { workspaceId: SHR.workspaceId },
    });
    expect(tasks.items.some((row) => row.id === task.id && row.title === "Verify the Arbora billing deploy")).toBe(true);

    // The owner and agent credentials are distinct; local tokens were not transferred.
    const imacCredentials = loadCredentials(imacEnv);
    expect(imacCredentials?.humanToken).not.toBe(SHR.humanToken);
    expect(imacCredentials?.agents?.opencode).not.toBe(SHR.agentToken);
    expect(macState?.credentials?.humanToken).not.toBe(SHR.humanToken);
    expect(macState?.credentials?.agents.codex).not.toBe(SHR.agentToken);

    // A crash can leave a cut_over receipt without the marker. The next publish
    // invocation repairs the read-only backup marker without another import.
    rmSync(join(macEnv.CAMPFIRE_CONFIG_DIR!, "publication.cutover"), { force: true });
    expect(readPublicationCutover(macEnv)).toBeUndefined();
    const repaired = await publishWorkspace({
      endpoint: hosted.url,
      databasePath: macDb,
      localUrl: "http://127.0.0.1:9414",
      ownerHumanId: SHR.humanId,
      ownerHumanName: SHR.humanName,
      packageVersion: "1.26.2-test",
      allowLoopbackHttp: true,
      connect: false,
      rehearsalCode: REHEARSAL_CODE,
      env: macEnv,
      now: () => NOW,
      mcpCommand: "campfire",
    });
    expect(repaired.alreadyPublished).toBe(true);
    expect(readPublicationCutover(macEnv)?.workspaceId).toBe(SHR.workspaceId);
  });

  it("retries a committed receipt after an older verifier registered a session", async () => {
    const root = mkdtempSync(join(tmpdir(), "shr-acceptance-committed-"));
    roots.push(root);
    const macEnv = isolatedProfileEnv(join(root, "macbook"));
    const macDb = join(root, "macbook", "campfire.db");
    seedShrLocalWorkspace(macDb);
    writeShrLocalProfile(macEnv, macDb);
    const hosted = await startHostedWorker();
    const first = await publishWorkspace({
      endpoint: hosted.url,
      databasePath: macDb,
      localUrl: "http://127.0.0.1:9414",
      ownerHumanId: SHR.humanId,
      ownerHumanName: SHR.humanName,
      packageVersion: "1.26.2-test",
      allowLoopbackHttp: true,
      connect: false,
      rehearsalCode: REHEARSAL_CODE,
      env: macEnv,
      now: () => NOW,
      mcpCommand: "campfire",
    });
    expect(first.receipt.state).toBe("cut_over");
    const state = readPublicationState(macEnv);
    expect(state?.credentials?.agents.codex).toBeDefined();
    await campfireHttpCall({
      baseUrl: hosted.url,
      token: state!.credentials!.agents.codex!,
      method: "register_agent_session",
      params: { workspaceId: SHR.workspaceId, agentId: SHR.agentId, harness: "codex" },
    });

    // Rewind the local side to the crash window: local profile, committed
    // receipt, no verified/cut_over timestamp. The hosted copy already has an
    // extra session contribution.
    writeShrLocalProfile(macEnv, macDb);
    const { verifiedAt: _verifiedAt, cutOverAt: _cutOverAt, ...receipt } = state!.receipt;
    savePublicationState({
      version: 1,
      receipt: { ...receipt, state: "committed", nextAction: "verify_hosted_workspace" },
      credentials: state!.credentials,
    }, macEnv);

    const retried = await publishWorkspace({
      endpoint: hosted.url,
      databasePath: macDb,
      localUrl: "http://127.0.0.1:9414",
      ownerHumanId: SHR.humanId,
      ownerHumanName: SHR.humanName,
      packageVersion: "1.26.2-test",
      allowLoopbackHttp: true,
      connect: false,
      rehearsalCode: REHEARSAL_CODE,
      env: macEnv,
      now: () => NOW,
      mcpCommand: "campfire",
    });
    expect(retried.receipt.state).toBe("cut_over");
    expect(readPublicationState(macEnv)?.receipt.state).toBe("cut_over");
  });
});
