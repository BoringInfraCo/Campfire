import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCliEntry } from "../../src/cli/index.js";
import { createId } from "../../src/domain/ids.js";
import { startCampfireHttpServer } from "../../src/http/server.js";
import type { RunningHttpServer } from "../../src/http/server.js";
import { createRuntimeFromPath } from "../../src/runtime.js";
import type { CampfireRuntime } from "../../src/runtime.js";

const SECRET = "trace-signing-secret";
const TRANSCRIPT = "PRIVATE_TRANSCRIPT_SENTINEL";
const PATH_SENTINEL = "wh_live_trace_path";
const QUERY_SENTINEL = "trace_query_token";
const OPERATOR_TOKEN = "trace-bridge-operator-token";

interface Received {
  listening?: number;
  eventId?: string;
  eventType?: string;
  valid?: boolean;
  status?: number;
  body?: string;
}

function startReceiver(failFirst: boolean): Promise<{
  port: number;
  received: Received[];
  close: () => Promise<void>;
}> {
  const child: ChildProcess = spawn(process.execPath, ["scripts/sprint-019-receiver.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CAMPFIRE_WEBHOOK_SECRET: SECRET,
      FAIL_FIRST: failFirst ? "1" : "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const received: Received[] = [];
  let buffer = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("receiver did not listen")), 5000);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const parsed = JSON.parse(line) as Received;
        received.push(parsed);
        if (parsed.listening !== undefined) {
          clearTimeout(timer);
          resolve({
            port: parsed.listening,
            received,
            close: () =>
              new Promise((done) => {
                child.once("exit", () => done());
                child.kill();
              }),
          });
        }
        newline = buffer.indexOf("\n");
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`receiver exited ${code ?? "null"} before listening`));
    });
  });
}

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out waiting for webhook deliveries");
}

describe("sprint 019 webhook trace", () => {
  const webhookKeys = [
    "CAMPFIRE_WEBHOOK_ID",
    "CAMPFIRE_WEBHOOK_URL",
    "CAMPFIRE_WEBHOOK_SECRET",
    "CAMPFIRE_WEBHOOK_EVENTS",
    "CAMPFIRE_WEBHOOK_WORKSPACES",
    "CAMPFIRE_BRIDGE_TOKEN",
    "CAMPFIRE_DB",
    "CAMPFIRE_URL",
    "CAMPFIRE_TOKEN",
  ] as const;
  const saved = new Map<string, string | undefined>();
  let dir: string | undefined;
  let runtime: CampfireRuntime | undefined;
  let server: RunningHttpServer | undefined;
  const receivers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    if (server !== undefined) await server.close();
    server = undefined;
    if (runtime !== undefined) runtime.close();
    runtime = undefined;
    while (receivers.length > 0) {
      const receiver = receivers.pop();
      if (receiver !== undefined) await receiver.close();
    }
    for (const key of webhookKeys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("delivers signed events outside the process, retries one failure, binds the destination, and hides the secret", async () => {
    const started = await startReceiver(true);
    receivers.push(started);
    dir = mkdtempSync(join(tmpdir(), "campfire-sprint-019-"));
    const databasePath = join(dir, "campfire.db");
    for (const key of webhookKeys) saved.set(key, process.env[key]);
    delete process.env.CAMPFIRE_URL;
    delete process.env.CAMPFIRE_TOKEN;
    delete process.env.CAMPFIRE_BRIDGE_TOKEN;

    runtime = createRuntimeFromPath(databasePath);
    const now = new Date().toISOString();
    runtime.store.createOrganization({ id: "org_trace", name: "Boring Infra Co.", createdAt: now });
    runtime.store.createTeam({ id: "team_trace", organizationId: "org_trace", name: "Engineering", createdAt: now });
    const created = runtime.service.createHuman(undefined, { teamId: "team_trace", displayName: "Ada" });
    const human = { actor: { actorId: created.human.id, actorType: "human" as const } };
    const workspace = runtime.service.createWorkspace(human, { teamId: "team_trace", name: "Billing" });
    const other = runtime.service.createWorkspace(human, { teamId: "team_trace", name: "Unrelated" });
    const task = runtime.service.createTask(human, { workspaceId: workspace.id, title: "Watch the deploy" });

    process.env.CAMPFIRE_WEBHOOK_ID = "bridge_trace";
    process.env.CAMPFIRE_WEBHOOK_URL =
      `http://127.0.0.1:${started.port}/ingest/${PATH_SENTINEL}?token=${QUERY_SENTINEL}`;
    process.env.CAMPFIRE_WEBHOOK_SECRET = SECRET;
    process.env.CAMPFIRE_WEBHOOK_EVENTS = "finding.recorded,decision.proposed,decision.accepted,task.blocked";
    process.env.CAMPFIRE_WEBHOOK_WORKSPACES = workspace.id;
    process.env.CAMPFIRE_BRIDGE_TOKEN = OPERATOR_TOKEN;
    process.env.CAMPFIRE_DB = databasePath;

    server = await startCampfireHttpServer({ runtime, host: "127.0.0.1", port: 0 });

    async function call(method: string, params: Record<string, unknown>) {
      const response = await fetch(`${server!.url}/v1/call`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${created.token}`,
        },
        body: JSON.stringify({ method, params }),
      });
      const body = (await response.json()) as { ok: boolean; result?: { id?: string } };
      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      return body;
    }

    await call("add_finding", { workspaceId: workspace.id, summary: "The budget retries" });

    // The first finding delivery fails. While that row is pending, reuse the
    // same bridge id with a different destination. The queued row is bound to
    // the destination it was created for and must not follow the change.
    await waitFor(() => started.received.some((row) => row.status === 500));
    const moved = await startReceiver(false);
    receivers.push(moved);
    process.env.CAMPFIRE_WEBHOOK_URL =
      `http://127.0.0.1:${moved.port}/elsewhere?token=${QUERY_SENTINEL}`;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(moved.received.filter((row) => row.eventId !== undefined)).toHaveLength(0);

    // Restoring the original destination resumes the same pending event id.
    process.env.CAMPFIRE_WEBHOOK_URL =
      `http://127.0.0.1:${started.port}/ingest/${PATH_SENTINEL}?token=${QUERY_SENTINEL}`;

    const decision = await call("add_decision", { workspaceId: workspace.id, summary: "Page the webhook" });
    await call("accept_decision", { decisionId: decision.result?.id });
    await call("update_task", { taskId: task.id, status: "blocked" });
    await call("add_finding", { workspaceId: other.id, summary: TRANSCRIPT });
    await call("update_task", { taskId: task.id, status: "completed" });

    await waitFor(() => {
      const posts = started.received.filter((row) => row.eventId !== undefined);
      const finding = posts.filter((row) => row.eventType === "finding.recorded");
      return (
        finding.some((row) => row.status === 500) &&
        finding.some((row) => row.status === 204 && row.valid === true) &&
        posts.some((row) => row.eventType === "decision.proposed" && row.valid === true) &&
        posts.some((row) => row.eventType === "decision.accepted" && row.valid === true) &&
        posts.some((row) => row.eventType === "task.blocked" && row.valid === true)
      );
    });

    const posts = started.received.filter((row) => row.eventId !== undefined);
    const failed = posts.find((row) => row.status === 500);
    const retried = posts.find((row) => row.eventId === failed?.eventId && row.status === 204);
    expect(retried?.eventId).toBe(failed?.eventId);
    expect(posts.every((row) => row.valid)).toBe(true);
    expect(posts.some((row) => row.eventType === "task.completed")).toBe(false);
    expect(posts.map((row) => row.body ?? "").join("\n")).not.toContain(TRANSCRIPT);
    expect(posts.map((row) => row.body ?? "").join("\n")).not.toContain(SECRET);
    expect(posts.map((row) => row.body ?? "").join("\n")).not.toContain(created.token);

    const findingEvents = runtime.store
      .listDomainEventsForWorkspace(workspace.id)
      .filter((event) => event.type === "finding.recorded");
    expect(findingEvents).toHaveLength(1);
    expect(runtime.store.getContribution(findingEvents[0]!.contributionId)).toBeDefined();

    // Hosted operator inspection: only the instance-operator token. Actor
    // tokens — including a valid human unrelated to the workspace — are denied.
    const agent = runtime.service.createAgent(human, {
      teamId: "team_trace",
      humanId: created.human.id,
      name: "Codex",
      harness: "codex",
    });
    const unrelated = runtime.service.createHuman(human, {
      teamId: "team_trace",
      displayName: "Mallory",
    });
    const agentDenied = await fetch(`${server.url}/v1/bridge`, {
      headers: { authorization: `Bearer ${agent.token}` },
    });
    expect(agentDenied.status).toBe(401);
    const unrelatedDenied = await fetch(`${server.url}/v1/bridge`, {
      headers: { authorization: `Bearer ${unrelated.token}` },
    });
    expect(unrelatedDenied.status).toBe(401);
    const ownerDenied = await fetch(`${server.url}/v1/bridge`, {
      headers: { authorization: `Bearer ${created.token}` },
    });
    expect(ownerDenied.status).toBe(401);

    const hostedResponse = await fetch(`${server.url}/v1/bridge`, {
      headers: { authorization: `Bearer ${OPERATOR_TOKEN}` },
    });
    expect(hostedResponse.status).toBe(200);
    const hosted = (await hostedResponse.json()) as {
      ok: boolean;
      result: {
        configured: boolean;
        origin: string;
        counts: { delivered: number };
        deliveries: Array<{ eventId: string; eventType?: string; workspaceId?: string }>;
      };
    };
    const hostedText = JSON.stringify(hosted);
    expect(hosted.ok).toBe(true);
    expect(hosted.result.configured).toBe(true);
    expect(hosted.result.origin).toBe(`http://127.0.0.1:${started.port}`);
    expect(hosted.result.counts.delivered).toBeGreaterThanOrEqual(4);
    expect(hosted.result.deliveries.some((row) => row.workspaceId === workspace.id)).toBe(true);
    expect(hostedText).not.toContain(PATH_SENTINEL);
    expect(hostedText).not.toContain(QUERY_SENTINEL);
    expect(hostedText).not.toContain(SECRET);
    expect(hostedText).not.toContain(created.token);
    expect(hostedText).not.toContain(unrelated.token);

    // The same redacted report through the local CLI and the hosted CLI.
    const stdout: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      stdout.push(args.map(String).join(" "));
    });
    let localReport: string;
    let hostedReport: string;
    try {
      let code = await runCliEntry(["bridge", "--json", "--db", databasePath]);
      expect(code).toBe(0);
      localReport = stdout.join("");
      stdout.length = 0;
      process.env.CAMPFIRE_URL = server.url;
      process.env.CAMPFIRE_BRIDGE_TOKEN = OPERATOR_TOKEN;
      code = await runCliEntry(["bridge", "--json"]);
      expect(code).toBe(0);
      hostedReport = stdout.join("");
    } finally {
      log.mockRestore();
      delete process.env.CAMPFIRE_URL;
      delete process.env.CAMPFIRE_BRIDGE_TOKEN;
    }

    for (const text of [localReport, hostedReport]) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(created.token);
      expect(text).not.toContain(PATH_SENTINEL);
      expect(text).not.toContain(QUERY_SENTINEL);
      expect(text).toContain("bridge_trace");
      expect(text).toContain(workspace.id);
      const parsed = JSON.parse(text) as {
        configured: boolean;
        origin: string;
        counts: { delivered: number };
      };
      expect(parsed.configured).toBe(true);
      expect(parsed.origin).toBe(`http://127.0.0.1:${started.port}`);
      expect(parsed).not.toHaveProperty("url");
      expect(parsed.counts.delivered).toBeGreaterThanOrEqual(4);
    }

    await server.close();
    server = undefined;
    runtime.close();
    const reopened = createRuntimeFromPath(databasePath);
    runtime = reopened;
    expect(reopened.store.countWebhookDeliveries().delivered).toBeGreaterThanOrEqual(4);
    expect(reopened.store.listDomainEventsForWorkspace(workspace.id).length).toBeGreaterThanOrEqual(4);
    expect(createId("domainEvent")).toMatch(/^evt_/);
  });
});
