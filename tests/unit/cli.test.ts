import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { formatCliFailure, runCli, runCliEntry } from "../../src/cli/index.js";
import { Conflict, ValidationError, WorkspaceNotFound } from "../../src/domain/errors.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";

const BILLING_GOAL_TITLE =
  "Determine why billing-service deploys fail and prepare the correct remediation.";

let dir: string;
let dbPath: string;
let logs: string[];
const previousDb = process.env.CAMPFIRE_DB;
const previousUrl = process.env.CAMPFIRE_URL;
const previousToken = process.env.CAMPFIRE_TOKEN;
const previousHarness = process.env.CAMPFIRE_HARNESS;
const previousSessionId = process.env.CAMPFIRE_SESSION_ID;

function stdout(): string {
  return logs.join("\n");
}

function cli(args: string[]): Promise<void> {
  return runCli(["--db", dbPath, ...args]);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campfire-cli-"));
  dbPath = join(dir, "campfire.db");
  const store = openSqliteStore(dbPath);
  seedFixture(store);
  store.close();
  logs = [];
  delete process.env.CAMPFIRE_URL;
  delete process.env.CAMPFIRE_TOKEN;
  delete process.env.CAMPFIRE_HARNESS;
  delete process.env.CAMPFIRE_SESSION_ID;
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  if (previousDb === undefined) {
    delete process.env.CAMPFIRE_DB;
  } else {
    process.env.CAMPFIRE_DB = previousDb;
  }
  if (previousUrl === undefined) {
    delete process.env.CAMPFIRE_URL;
  } else {
    process.env.CAMPFIRE_URL = previousUrl;
  }
  if (previousToken === undefined) {
    delete process.env.CAMPFIRE_TOKEN;
  } else {
    process.env.CAMPFIRE_TOKEN = previousToken;
  }
  if (previousHarness === undefined) {
    delete process.env.CAMPFIRE_HARNESS;
  } else {
    process.env.CAMPFIRE_HARNESS = previousHarness;
  }
  if (previousSessionId === undefined) {
    delete process.env.CAMPFIRE_SESSION_ID;
  } else {
    process.env.CAMPFIRE_SESSION_ID = previousSessionId;
  }
});

describe("runCli", () => {
  it("prints orientation text for show, not a JSON dump", async () => {
    await cli(["show", FIXTURE.workspaces.billing]);

    const output = stdout();
    expect(output).toContain("Workspace");
    expect(output).toContain("Goal");
    expect(output).toContain(FIXTURE.workspaces.billing);
    expect(output).toContain(BILLING_GOAL_TITLE);
    expect(output.trimStart().startsWith("{")).toBe(false);
  });

  it("renders the Sprint 008 orientation sections for show", async () => {
    await cli(["add-decision", "--workspace", FIXTURE.workspaces.billing, "--summary", "CLI accepted"]);
    const accepted = JSON.parse(logs[logs.length - 1]!) as { id: string };
    await cli(["accept-decision", accepted.id]);
    await cli(["add-decision", "--workspace", FIXTURE.workspaces.billing, "--summary", "CLI proposed"]);
    const proposed = JSON.parse(logs[logs.length - 1]!) as { id: string };
    await cli([
      "create-task",
      "--workspace",
      FIXTURE.workspaces.billing,
      "--title",
      "CLI assigned",
      "--assignee-id",
      FIXTURE.humans.sergio,
      "--assignee-type",
      "human",
    ]);
    await cli(["create-task", "--workspace", FIXTURE.workspaces.billing, "--title", "CLI unassigned blocked"]);
    const blocked = JSON.parse(logs[logs.length - 1]!) as { id: string };
    await cli(["update-task", blocked.id, "--status", "blocked"]);

    logs = [];
    await cli(["show", FIXTURE.workspaces.billing]);

    const output = stdout();
    expect(output).toContain("Needs You");
    expect(output).toContain("Needs Attention");
    expect(output).toContain("Current Work");
    expect(output).toContain("Suggested next (orientation hint)");
    expect(output).toContain("proposed_decision_actionable");
    expect(output).toContain("unassigned_blocked_task");
    expect(output.indexOf("Recorded alignment boundary")).toBeGreaterThan(-1);
    expect(output.indexOf("Recorded alignment boundary")).toBeLessThan(output.indexOf("Needs You"));
    expect(output).toContain("status: open");
    expect(output).toContain("Not permission to execute");
    expect(output).toContain(`proposed: ${proposed.id}`);
    expect(output).toContain(`proposed: ${proposed.id} CLI proposed`);
    expect(output).toContain("unresolved blocked tasks");
    expect(output).toContain(`unresolved blocked tasks: ${blocked.id}`);
    expect(output).not.toContain("agreed");
    expect(output).not.toContain("may proceed");
    expect(output).not.toContain("status: agreed");
    expect(output).not.toContain("ready to execute");
    expect(output.split("Not permission to execute.").join("")).not.toContain("permission to execute");
  });

  it("shows an established recorded alignment boundary when only an accepted decision exists", async () => {
    await cli(["create-workspace", "--team", FIXTURE.teamId, "--name", "alignment-established"]);
    const workspace = JSON.parse(logs[logs.length - 1]!) as { id: string };
    await cli(["add-decision", "--workspace", workspace.id, "--summary", "Only accepted constraint"]);
    const decision = JSON.parse(logs[logs.length - 1]!) as { id: string };
    await cli(["accept-decision", decision.id]);

    logs = [];
    await cli(["show", workspace.id]);

    const output = stdout();
    expect(output).toContain("Recorded alignment boundary");
    expect(output).toContain("status: established");
    expect(output).toContain(`accepted: ${decision.id} Only accepted constraint`);
    expect(output).toContain("Not permission to execute");
    expect(output).not.toContain("status: open");
    expect(output).not.toContain("proposed:");
    expect(output).not.toContain("status: agreed");
    expect(output).not.toContain("agreed");
    expect(output).not.toContain("may proceed");
  });

  it("lists workspaces", async () => {
    await cli(["list"]);

    const listed = JSON.parse(stdout()) as Array<{ id: string }>;
    expect(listed.map((workspace) => workspace.id)).toContain(FIXTURE.workspaces.billing);
  });

  it("prints a workspace id from create-workspace", async () => {
    await cli(["create-workspace", "--team", FIXTURE.teamId, "--name", "cli-living"]);

    const created = JSON.parse(stdout()) as { id: string; name: string };
    expect(created.id).toMatch(/^ws_/);
    expect(created.name).toBe("cli-living");
  });

  it("prints at most --limit activity lines", async () => {
    await cli(["activity", FIXTURE.workspaces.billing, "--limit", "2"]);

    const lines = stdout()
      .split("\n")
      .filter((line) => line.trim().length > 0);
    expect(lines.length).toBeLessThanOrEqual(2);
  });

  it("honors --json on activity with the full machine-readable page", async () => {
    await cli(["activity", FIXTURE.workspaces.billing, "--limit", "2", "--json"]);

    const page = JSON.parse(stdout()) as {
      items: Array<{ id: string; actor: { actorId: string } }>;
      total: number;
      truncated: boolean;
      nextBefore?: string;
    };
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.length).toBeLessThanOrEqual(2);
    expect(page.total).toBe(6);
    expect(page.truncated).toBe(true);
    expect(typeof page.nextBefore).toBe("string");
    expect(page.items[0]?.actor.actorId.length).toBeGreaterThan(0);
  });

  it("prints orientation JSON for show --json", async () => {
    await cli(["show", FIXTURE.workspaces.billing, "--json"]);

    const orientation = JSON.parse(stdout()) as {
      workspace: { id: string };
      goal?: { title: string };
    };
    expect(orientation.workspace.id).toBe(FIXTURE.workspaces.billing);
    expect(orientation.goal?.title).toBe(BILLING_GOAL_TITLE);
  });

  it("rejects an unknown command", async () => {
    await expect(cli(["definitely-not-a-command"])).rejects.toThrow(ValidationError);
  });

  it("prints usage including serve, invite, identity, and contribution commands", async () => {
    await cli(["help"]);
    const output = stdout();
    expect(output).toContain("campfire serve");
    expect(output).toContain("campfire preflight");
    expect(output).toContain("create-human");
    expect(output).toContain("create-agent");
    expect(output).toContain("issue-token");
    expect(output).toContain("campfire invite");
    expect(output).toContain("create-task");
    expect(output).toContain("add-finding");
    expect(output).toContain("add-decision");
    expect(output).toContain("add-artifact");
  });

  it("shows a workspace with the fixture sergio token", async () => {
    await cli(["show", FIXTURE.workspaces.billing, "--token", FIXTURE.tokens.sergio]);

    const output = stdout();
    expect(output).toContain("Workspace");
    expect(output).toContain(FIXTURE.workspaces.billing);
    expect(output).toContain(BILLING_GOAL_TITLE);
  });

  it("issues a token JSON payload that includes the raw token once", async () => {
    await cli(["issue-token", "--actor", FIXTURE.humans.sergio, "--type", "human"]);

    const issued = JSON.parse(stdout()) as { token: string; actor: { actorId: string } };
    expect(issued.token.startsWith("cft_")).toBe(true);
    expect(issued.actor.actorId).toBe(FIXTURE.humans.sergio);
  });

  it("adds a finding on the billing workspace as the default human", async () => {
    await cli([
      "add-finding",
      "--workspace",
      FIXTURE.workspaces.billing,
      "--summary",
      "CLI finding from sergio",
    ]);

    const finding = JSON.parse(stdout()) as { summary: string; createdBy: { actorId: string } };
    expect(finding.summary).toBe("CLI finding from sergio");
    expect(finding.createdBy.actorId).toBe(FIXTURE.humans.sergio);
  });

  it("creates a task whose id starts with task_", async () => {
    await cli(["create-task", "--workspace", FIXTURE.workspaces.billing, "--title", "CLI task"]);

    const task = JSON.parse(stdout()) as { id: string; title: string };
    expect(task.id.startsWith("task_")).toBe(true);
    expect(task.title).toBe("CLI task");
  });

  it("adds an artifact where --type is the artifact type, not the acting identity", async () => {
    await cli([
      "add-artifact",
      "--workspace",
      FIXTURE.workspaces.billing,
      "--type",
      "file",
      "--title",
      "Migration 284",
      "--uri",
      "fixtures/billing/migration-284.sql",
      "--json",
    ]);

    const artifact = JSON.parse(stdout()) as {
      type: string;
      uriOrPath: string;
      createdBy: { actorId: string };
    };
    expect(artifact.type).toBe("file");
    expect(artifact.uriOrPath).toBe("fixtures/billing/migration-284.sql");
    expect(artifact.createdBy.actorId).toBe(FIXTURE.humans.sergio);
  });

  it("invites with --type as the target actor type, not the acting identity", async () => {
    await cli([
      "invite",
      FIXTURE.workspaces.unrelated,
      "--actor",
      FIXTURE.humans.alice,
      "--type",
      "human",
      "--role",
      "member",
      "--json",
    ]);

    const invite = JSON.parse(stdout()) as {
      workspaceId: string;
      actor: { actorId: string; actorType: string };
      role: string;
    };
    expect(invite.workspaceId).toBe(FIXTURE.workspaces.unrelated);
    expect(invite.actor.actorId).toBe(FIXTURE.humans.alice);
    expect(invite.actor.actorType).toBe("human");
    expect(invite.role).toBe("member");
  });

  it("documents the --json contract in usage", async () => {
    await cli(["help"]);
    const output = stdout();
    expect(output).toContain("campfire activity <workspaceId>");
    expect(output).toContain("--before <contributionId>] [--json]");
    expect(output).toContain("--json             Machine-readable output contract");
    expect(output).toContain("have no JSON mode");
    expect(output).toContain('{"error":{"code","message"');
    expect(output).toContain("add-artifact's --type is the artifact type");
  });

  it("requires an explicit hosted endpoint for preflight instead of falling back locally", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runCliEntry(["preflight", FIXTURE.workspaces.billing, "--json"]);

    expect(code).toBe(1);
    const payload = JSON.parse(
      errSpy.mock.calls.map((call) => call.map(String).join(" ")).join("\n"),
    ) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("ValidationError");
    expect(payload.error.message).toContain("CAMPFIRE_URL");
    expect(payload.error.message).toContain("hosted preflight");
  });

  it("requires a workspace ID for hosted preflight", async () => {
    process.env.CAMPFIRE_URL = "http://127.0.0.1:9414";
    process.env.CAMPFIRE_TOKEN = "cft_valid_secret_value";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runCliEntry(["preflight", "--json"]);

    expect(code).toBe(1);
    const payload = JSON.parse(
      errSpy.mock.calls.map((call) => call.map(String).join(" ")).join("\n"),
    ) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("ValidationError");
    expect(payload.error.message).toContain("workspaceId");
    expect(payload.error.message).toContain("--workspace");
  });

  it("reports a token-safe actionable error when hosted preflight cannot reach the endpoint", async () => {
    process.env.CAMPFIRE_URL = "http://127.0.0.1:1";
    process.env.CAMPFIRE_TOKEN = "cft_super_secret_preflight_token";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runCliEntry(["preflight", FIXTURE.workspaces.billing, "--json"]);

    expect(code).toBe(1);
    const stderr = errSpy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    const payload = JSON.parse(stderr) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("ValidationError");
    expect(payload.error.message).toContain("Unable to reach Campfire");
    expect(payload.error.message).toContain("start campfire serve");
    expect(stderr).not.toContain(process.env.CAMPFIRE_TOKEN);
  });

  it("requires an actor token for hosted preflight", async () => {
    process.env.CAMPFIRE_URL = "http://127.0.0.1:9414";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runCliEntry(["preflight", FIXTURE.workspaces.billing, "--json"]);

    expect(code).toBe(1);
    const payload = JSON.parse(
      errSpy.mock.calls.map((call) => call.map(String).join(" ")).join("\n"),
    ) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("ValidationError");
    expect(payload.error.message).toContain("CAMPFIRE_TOKEN");
    expect(payload.error.message).toContain("actor-specific token");
  });

  it("does not re-emit token-bearing remote preflight errors", async () => {
    const token = "cft_remote_error_secret_value";
    process.env.CAMPFIRE_URL = "http://127.0.0.1:9414";
    process.env.CAMPFIRE_TOKEN = token;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: "Unauthorized",
          message: `Rejected bearer ${token}`,
          details: { echoedToken: token },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runCliEntry(["preflight", FIXTURE.workspaces.billing, "--json"]);

    expect(code).toBe(1);
    const stderr = errSpy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    const payload = JSON.parse(stderr) as {
      error: { code: string; message: string; details?: Record<string, unknown> };
    };
    expect(payload.error.code).toBe("Unauthorized");
    expect(payload.error.message).toContain("verify CAMPFIRE_TOKEN");
    expect(payload.error.message).toContain("register an active session");
    expect(payload.error.details).toEqual({ nextAction: "register_agent_session" });
    expect(stderr).not.toContain(token);
  });

  it("prints human-readable successful hosted preflight output", async () => {
    process.env.CAMPFIRE_URL = "http://127.0.0.1:9414";
    process.env.CAMPFIRE_TOKEN = "cft_valid_secret_value";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: {
            ready: true,
            workspaceId: FIXTURE.workspaces.billing,
            actor: { actorId: FIXTURE.humans.sergio, actorType: "human" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await runCli(["preflight", "--workspace", FIXTURE.workspaces.billing]);

    expect(stdout()).toContain(`workspace=${FIXTURE.workspaces.billing}`);
    expect(stdout()).toContain(`actor=${FIXTURE.humans.sergio}`);
    expect(stdout().trimStart().startsWith("{")).toBe(false);
    const request = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as {
      method: string;
      params: Record<string, unknown>;
    };
    expect(request).toEqual({
      method: "preflight",
      params: { workspaceId: FIXTURE.workspaces.billing },
    });
  });

  it("prints a structured successful preflight and forwards session readiness", async () => {
    process.env.CAMPFIRE_URL = "http://127.0.0.1:9414";
    process.env.CAMPFIRE_TOKEN = "cft_valid_secret_value";
    process.env.CAMPFIRE_HARNESS = "codex";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: {
            ready: true,
            workspaceId: "ws_billing_deploy",
            actor: { actorId: "agt_codex", actorType: "agent" },
            sessionId: "ses_ready",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await runCli([
      "preflight",
      FIXTURE.workspaces.billing,
      "--session",
      "ses_ready",
      "--json",
    ]);

    expect(JSON.parse(stdout())).toEqual({
      ready: true,
      workspaceId: FIXTURE.workspaces.billing,
      actor: { actorId: "agt_codex", actorType: "agent" },
      sessionId: "ses_ready",
      harness: "codex",
    });
    const request = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as {
      method: string;
      params: Record<string, unknown>;
    };
    expect(request).toEqual({
      method: "preflight",
      params: { workspaceId: FIXTURE.workspaces.billing, agentSessionId: "ses_ready" },
    });
  });
});

describe("runCliEntry exit-code and stderr contract", () => {
  function stderrText(errSpy: { mock: { calls: unknown[][] } }): string {
    return errSpy.mock.calls
      .map((call) => call.map(String).join(" "))
      .join("\n");
  }

  it("returns 0 and prints no failure line on success", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runCliEntry(["--db", dbPath, "list"]);

    expect(code).toBe(0);
    expect(errSpy.mock.calls).toHaveLength(0);
  });

  it("keeps [Code] message on stderr without --json", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runCliEntry(["--db", dbPath, "show", "does-not-exist"]);

    expect(code).toBe(1);
    expect(stderrText(errSpy)).toBe("[WorkspaceNotFound] Workspace not found: does-not-exist");
  });

  it("emits structured error JSON on stderr under --json", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runCliEntry(["--db", dbPath, "show", "does-not-exist", "--json"]);

    expect(code).toBe(1);
    const payload = JSON.parse(stderrText(errSpy)) as {
      error: { code: string; message: string; details?: { workspaceId?: string } };
    };
    expect(payload.error.code).toBe("WorkspaceNotFound");
    expect(payload.error.message).toContain("does-not-exist");
    expect(payload.error.details?.workspaceId).toBe("does-not-exist");
  });

  it("reports an unknown command as structured error JSON under --json", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runCliEntry(["--db", dbPath, "definitely-not-a-command", "--json"]);

    expect(code).toBe(1);
    const payload = JSON.parse(stderrText(errSpy)) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("ValidationError");
    expect(payload.error.message).toContain("definitely-not-a-command");
  });
});

describe("formatCliFailure", () => {
  it("keeps the human formats unchanged", () => {
    expect(formatCliFailure(new WorkspaceNotFound("ws_x"))).toBe(
      "[WorkspaceNotFound] Workspace not found: ws_x",
    );
    expect(formatCliFailure(new Error("boom"))).toBe("boom");
    expect(formatCliFailure("stringy")).toBe("stringy");
  });

  it("renders CampfireError details under --json", () => {
    const parsed = JSON.parse(
      formatCliFailure(new ValidationError("bad team", { field: "team" }), { json: true }),
    ) as { error: { code: string; message: string; details?: Record<string, unknown> } };
    expect(parsed.error.code).toBe("ValidationError");
    expect(parsed.error.message).toBe("bad team");
    expect(parsed.error.details).toEqual({ field: "team" });
  });

  it("omits details when the error has none", () => {
    const parsed = JSON.parse(formatCliFailure(new Conflict("already joined"), { json: true })) as {
      error: Record<string, unknown>;
    };
    expect(parsed.error).toEqual({ code: "Conflict", message: "already joined" });
  });

  it("wraps unexpected errors as InternalError under --json", () => {
    const parsed = JSON.parse(formatCliFailure(new Error("boom"), { json: true })) as {
      error: { code: string; message: string };
    };
    expect(parsed.error).toEqual({ code: "InternalError", message: "boom" });
  });
});
