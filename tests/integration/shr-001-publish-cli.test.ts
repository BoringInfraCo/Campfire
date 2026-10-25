import { createServer, type IncomingMessage } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCliEntry } from "../../src/cli/index.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { hashToken } from "../../src/service/tokens.js";
import { acquirePublicationLock, readPublicationCutover, readPublicationState, releasePublicationLock } from "../../src/publication/state.js";
import { createD1Store, migrateD1 } from "../../src/worker/d1-store.js";
import { createD1WorkerHandler } from "../../src/worker/handler.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";
import { SHR, isolatedProfileEnv, seedShrLocalWorkspace, writeShrLocalProfile } from "../helpers/shr-001.js";

const NOW = "2026-10-23T15:00:00.000Z";
const REHEARSAL_CODE = `cfrh_${"c".repeat(48)}`;
const roots: string[] = [];
const servers: Array<ReturnType<typeof createServer>> = [];
const closes: Array<() => void> = [];
const originalEnv = { ...process.env };

afterEach(async () => {
  process.env = { ...originalEnv };
  for (const close of closes.splice(0)) close();
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function hosted(): Promise<string> {
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
      const request = new Request(`http://127.0.0.1${req.url ?? "/"}`, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        ...(req.method === "GET" ? {} : { body: await body(req) }),
      });
      const response = await handle(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(new Uint8Array(await response.arrayBuffer())));
    })();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("not bound");
  return `http://127.0.0.1:${address.port}`;
}

describe("SHR-001 CLI", () => {
  it("publishes from an ordinary local profile and then issues an invitation", async () => {
    const root = mkdtempSync(join(tmpdir(), "shr-cli-"));
    roots.push(root);
    const env = isolatedProfileEnv(join(root, "mac"));
    const db = join(root, "mac", "campfire.db");
    seedShrLocalWorkspace(db);
    writeShrLocalProfile(env, db);
    process.env = { ...env };
    for (const key of ["CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_HARNESS", "CAMPFIRE_ACTOR_ID", "CAMPFIRE_ACTOR_TYPE", "CAMPFIRE_DB"]) delete process.env[key];
    const endpoint = await hosted();

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const first = await runCliEntry(["publish", "--url", endpoint, "--allow-loopback", "--no-connect", "--rehearsal-code", REHEARSAL_CODE, "--json"]);
    expect(first).toBe(0);
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain('"state":"cut_over"');
    expect(output).not.toContain(SHR.humanToken);
    expect(output).not.toContain(SHR.agentToken);
    log.mockRestore();

    const state = readPublicationState(env);
    expect(state?.receipt.state).toBe("cut_over");
    expect(state?.receipt.workspaceId).toBe(SHR.workspaceId);

    rmSync(join(env.CAMPFIRE_CONFIG_DIR!, "publication.cutover"), { force: true });
    expect(readPublicationCutover(env)).toBeUndefined();
    const repairLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(await runCliEntry(["publish", "--allow-loopback", "--json"])).toBe(0);
    repairLog.mockRestore();
    expect(readPublicationCutover(env)?.workspaceId).toBe(SHR.workspaceId);

    const statusLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(await runCliEntry(["publish-status", "--json"])).toBe(0);
    expect(statusLog.mock.calls.map((call) => call.join(" ")).join("\n")).toContain('"state":"cut_over"');
    statusLog.mockRestore();

    const invitationPath = join(root, "invitation.json");
    const second = await runCliEntry([
      "invite-teammate", SHR.workspaceId, "--out", invitationPath, "--allow-loopback", "--json",
    ]);
    expect(second).toBe(0);
    expect(readPublicationState(env)?.receipt.state).toBe("cut_over");

    const previous = readPublicationState(env)?.credentials?.humanToken;
    const previousRecoverySecret = readPublicationState(env)?.credentials?.recoverySecret;
    const recoveryLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(await runCliEntry(["publish-recover", "--rehearsal-code", REHEARSAL_CODE, "--json"])).toBe(0);
    recoveryLog.mockRestore();
    expect(readPublicationState(env)?.credentials?.humanToken).not.toBe(previous);
    expect(readPublicationState(env)?.credentials?.recoverySecret).not.toBe(previousRecoverySecret);
    expect(readPublicationState(env)?.pendingRecovery).toBeUndefined();

    // Commit succeeds, but its HTTP response disappears. The private pending
    // replacement lets the next invocation verify and finish without replaying
    // the now invalid old recovery secret.
    const fetchBeforeDrop = globalThis.fetch;
    let dropped = false;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (...args) => {
      const response = await fetchBeforeDrop(...args);
      if (!dropped && String(args[0]).endsWith("/v1/publication/recover")) {
        dropped = true;
        throw new Error("simulated lost recovery response");
      }
      return response;
    });
    const recoveryError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await runCliEntry(["publish-recover", "--rehearsal-code", REHEARSAL_CODE, "--json"])).toBe(1);
    recoveryError.mockRestore();
    fetchSpy.mockRestore();
    expect(dropped).toBe(true);
    const pending = readPublicationState(env)?.pendingRecovery;
    expect(pending).toBeDefined();
    const resumeLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(await runCliEntry(["publish-recover", "--rehearsal-code", REHEARSAL_CODE, "--json"])).toBe(0);
    resumeLog.mockRestore();
    expect(readPublicationState(env)?.pendingRecovery).toBeUndefined();
    expect(readPublicationState(env)?.credentials?.humanToken).toBe(pending?.humanToken);
    expect(readPublicationState(env)?.credentials?.recoverySecret).toBe(pending?.recoverySecret);
    const statusAfterRecovery = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(await runCliEntry(["status", "--output", "json"])).toBe(0);
    statusAfterRecovery.mockRestore();
  });

  it("rejects a supported local write while the publication lock is active", async () => {
    const root = mkdtempSync(join(tmpdir(), "shr-cli-lock-"));
    roots.push(root);
    const env = isolatedProfileEnv(join(root, "mac"));
    const db = join(root, "mac", "campfire.db");
    seedShrLocalWorkspace(db);
    writeShrLocalProfile(env, db);
    process.env = { ...env };
    for (const key of ["CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_HARNESS", "CAMPFIRE_ACTOR_ID", "CAMPFIRE_ACTOR_TYPE", "CAMPFIRE_DB"]) delete process.env[key];
    acquirePublicationLock({ workspaceId: SHR.workspaceId, publicationId: "pub_cli_lock", databasePath: db }, env);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const code = await runCliEntry(["add-finding", "--workspace", SHR.workspaceId, "--summary", "during publish", "--json"]);
    expect(code).toBe(1);
    expect(error.mock.calls.map((call) => call.join(" ")).join("\n")).toContain("wait_or_resume_publish");
    const reset = await runCliEntry(["seed", "--reset", "--json"]);
    expect(reset).toBe(1);
    releasePublicationLock("pub_cli_lock", env);
    error.mockRestore();
  });

  it("refuses a local invite without publishing instead of implying a share", async () => {
    const root = mkdtempSync(join(tmpdir(), "shr-cli-local-"));
    roots.push(root);
    const env = isolatedProfileEnv(join(root, "mac"));
    const db = join(root, "mac", "campfire.db");
    seedShrLocalWorkspace(db);
    writeShrLocalProfile(env, db);
    process.env = { ...env };
    for (const key of ["CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_HARNESS", "CAMPFIRE_ACTOR_ID", "CAMPFIRE_ACTOR_TYPE", "CAMPFIRE_DB"]) delete process.env[key];
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const code = await runCliEntry(["invite-teammate", SHR.workspaceId, "--out", join(root, "invite.json"), "--json"]);
    expect(code).toBe(1);
    const text = error.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(text).toContain("publish_workspace");
    expect(text).toContain("Publish it first");
    error.mockRestore();
  });
});
