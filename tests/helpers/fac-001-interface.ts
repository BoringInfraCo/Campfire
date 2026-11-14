/**
 * FAC-001 phase C2 helper: one fixture database read through the three interfaces
 * (service, MCP in-memory transport, CLI against the same SQLite file) under a frozen clock.
 * There is no stub detection here: every probe runs against the real service.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildFixture, READ_CLOCKS } from "../../fixtures/attention/fac-001/seed.js";
import { runCliEntry } from "../../src/cli/index.js";
import { createCampfireMcpServer } from "../../src/mcp/tools.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";

export type Outcome =
  | { kind: "result"; value: Record<string, any>; text?: string; structured?: unknown }
  | { kind: "error"; code: string; message: string; details: unknown };

export interface ProbeInput {
  workspaceId: string;
  limit?: number;
  cursor?: string;
  since?: string;
}

export type ClockName = keyof typeof READ_CLOCKS;

const ENV_KEYS = ["CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_DB", "CAMPFIRE_OUTPUT", "CAMPFIRE_ACTOR_ID", "CAMPFIRE_ACTOR_TYPE", "CAMPFIRE_SESSION_ID", "CAMPFIRE_HARNESS"];

export const typeOf = (id: string): "human" | "agent" => (id.startsWith("hum_") ? "human" : "agent");

export interface InterfaceEnv {
  service: CampfireService;
  manifest: any;
  clock: { now: string };
  ctxFor(actorId: string, workspaceId: string): ActorContext;
  viaService(actorId: string, input: ProbeInput): Outcome;
  viaMcp(actorId: string, input: ProbeInput): Promise<Outcome>;
  viaCli(actorId: string, input: ProbeInput): Promise<Outcome>;
  close(): void;
}

export function openInterfaceEnv(): InterfaceEnv {
  const dir = mkdtempSync(join(tmpdir(), "campfire-fac001-iface-"));
  const dbPath = join(dir, "campfire.db");
  const built = buildFixture(dbPath);
  const clock = { now: READ_CLOCKS.T1_before_any_expiry as string };
  const service = createCampfireService({ store: openSqliteStore(dbPath), clock: () => clock.now, webhookEnv: {} } as never);
  const manifest = built.manifest as any;

  const ctxFor = (actorId: string, workspaceId: string): ActorContext => {
    const session = (manifest.sessions as Array<{ id: string; agentId: string; workspaceId: string }>).find(
      (s) => s.agentId === actorId && s.workspaceId === workspaceId,
    );
    return { actor: { actorId, actorType: typeOf(actorId) }, ...(session === undefined ? {} : { agentSessionId: session.id }) };
  };

  const viaService = (actorId: string, input: ProbeInput): Outcome => {
    try {
      const value = JSON.parse(JSON.stringify(service.getWorkspaceAttention(ctxFor(actorId, input.workspaceId), input as never)));
      return { kind: "result", value };
    } catch (error) {
      const e = error as { code?: string; message?: string; details?: unknown };
      return { kind: "error", code: String(e.code), message: String(e.message), details: e.details === undefined ? null : JSON.parse(JSON.stringify(e.details)) };
    }
  };

  const viaMcp = async (actorId: string, input: ProbeInput): Promise<Outcome> => {
    const ctx = ctxFor(actorId, input.workspaceId);
    const server = createCampfireMcpServer({ service, identity: { ctx, harness: "codex" } });
    const client = new Client({ name: "fac-001-iface", version: "0.0.0" });
    const [c, s] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(c), server.connect(s)]);
    try {
      const res = (await client.callTool({ name: "get_workspace_attention", arguments: input as never })) as {
        isError?: boolean;
        content?: Array<{ type: string; text?: string }>;
        structuredContent?: unknown;
      };
      const text = res.content?.[0]?.text ?? "";
      if (res.isError === true) {
        let parsed: { error?: string; message?: string; details?: unknown };
        try {
          parsed = JSON.parse(text);
        } catch {
          return { kind: "error", code: "MCP_PROTOCOL", message: text, details: null };
        }
        return { kind: "error", code: String(parsed.error), message: String(parsed.message), details: parsed.details ?? null };
      }
      return { kind: "result", value: JSON.parse(text), text, structured: res.structuredContent };
    } finally {
      await client.close();
      await server.close();
    }
  };

  const viaCli = async (actorId: string, input: ProbeInput): Promise<Outcome> => {
    const ctx = ctxFor(actorId, input.workspaceId);
    const previous: Record<string, string | undefined> = {};
    for (const k of ENV_KEYS) {
      previous[k] = process.env[k];
      delete process.env[k];
    }
    process.env.CAMPFIRE_ACTOR_ID = actorId;
    process.env.CAMPFIRE_ACTOR_TYPE = typeOf(actorId);
    if (ctx.agentSessionId !== undefined) process.env.CAMPFIRE_SESSION_ID = ctx.agentSessionId;
    const out: string[] = [];
    const err: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.map(String).join(" ")));
    const errSpy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.map(String).join(" ")));
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(clock.now));
    try {
      const argv = ["--db", dbPath, "attention", input.workspaceId, "--output", "json"];
      if (input.limit !== undefined) argv.push("--limit", String(input.limit));
      if (input.cursor !== undefined) argv.push("--cursor", input.cursor);
      if (input.since !== undefined) argv.push("--since", input.since);
      const code = await runCliEntry(argv);
      if (code === 0) return { kind: "result", value: JSON.parse(out.join("\n")) };
      const parsed = JSON.parse(err.join("\n")) as { error: { code: string; message: string; details?: unknown } };
      return { kind: "error", code: parsed.error.code, message: parsed.error.message, details: parsed.error.details ?? null };
    } finally {
      vi.useRealTimers();
      log.mockRestore();
      errSpy.mockRestore();
      stderr.mockRestore();
      for (const k of ENV_KEYS) {
        if (previous[k] === undefined) delete process.env[k];
        else process.env[k] = previous[k];
      }
    }
  };

  return {
    service,
    manifest,
    clock,
    ctxFor,
    viaService,
    viaMcp,
    viaCli,
    close() {
      service.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Decode a `cf1.` / `fa1.` cursor token to its fields (semantic comparison, Q30 a06). */
export function decodeCursorFields(token: string): { prefix: string; fields: Record<string, unknown> } {
  const dot = token.indexOf(".");
  const prefix = token.slice(0, dot + 1);
  return { prefix, fields: JSON.parse(Buffer.from(token.slice(dot + 1), "base64url").toString("utf8")) };
}

/** Counts executed assertions so a test that silently returns early is detected by the guard. */
export class AssertionCounter {
  private readonly perCase = new Map<string, number>();
  total = 0;
  hit(caseId: string, n = 1): void {
    this.perCase.set(caseId, (this.perCase.get(caseId) ?? 0) + n);
    this.total += n;
  }
  count(caseId: string): number {
    return this.perCase.get(caseId) ?? 0;
  }
  ids(): string[] {
    return [...this.perCase.keys()];
  }
}
