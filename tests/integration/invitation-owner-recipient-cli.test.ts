import { afterEach, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliEntry } from "../../src/cli/index.js";
import { createRuntimeFromPath } from "../../src/runtime.js";
import { seedFixture, FIXTURE } from "../../src/bootstrap/seed.js";
import { startCampfireHttpServer } from "../../src/http/server.js";
import { resolveProfilePaths } from "../../src/bootstrap/profile.js";
import { loadAnyProfile } from "../../src/bootstrap/profile.js";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.reverse()) await close(); cleanup.length = 0; vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function capture() {
  const output: string[] = []; const errors: string[] = [];
  vi.spyOn(console, "log").mockImplementation((value) => output.push(String(value)));
  vi.spyOn(console, "error").mockImplementation((value) => errors.push(String(value)));
  return { output, errors };
}
function envFor(dir: string, url: string, token: string) {
  vi.stubEnv("CAMPFIRE_CONFIG_DIR", join(dir, "profile")); vi.stubEnv("CAMPFIRE_DATA_DIR", join(dir, "no-db"));
  vi.stubEnv("HOME", join(dir, "home")); vi.stubEnv("XDG_CONFIG_HOME", join(dir, "xdg"));
  vi.stubEnv("CAMPFIRE_URL", url); vi.stubEnv("CAMPFIRE_TOKEN", token);
}

it("invite-teammate prints link, join command, expiry, and no-send / member-not-owner statements", async () => {
  const dir = mkdtempSync(join(tmpdir(), "campfire-inv-owner-"));
  const runtime = createRuntimeFromPath(join(dir, "owner.db")); seedFixture(runtime.store);
  const server = await startCampfireHttpServer({ runtime, port: 0 });
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }), () => runtime.close(), () => server.close());
  envFor(dir, server.url, FIXTURE.tokens.sergio);
  const { output } = capture();
  expect(await runCliEntry(["invite-teammate", FIXTURE.workspaces.billing, "--allow-loopback", "--output", "human"])).toBe(0);
  const text = output.join("\n");
  const link = /^(http\S+)$/m.exec(text)?.[1];
  expect(link).toBeDefined();
  expect(text).toContain(`campfire join --invitation-link '${link}'`);
  expect(text).toMatch(/Expires \d{4}-\d\d-\d\dT[\d:.]+Z \(in 30 minutes/);
  expect(text).toContain("Campfire does not send this link");
  expect(text).toContain("adds a member, not an owner");
  expect(text).toContain("revoke-invitation");
});

it("rejects --hours and --expires-in-hours with a helpful message", async () => {
  const dir = mkdtempSync(join(tmpdir(), "campfire-inv-hours-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  envFor(dir, "http://127.0.0.1:9", "tok");
  const { errors } = capture();
  for (const flag of ["--hours", "--expires-in-hours"]) {
    errors.length = 0;
    expect(await runCliEntry(["invite-teammate", "ws_1", flag, "48", "--allow-loopback"])).toBe(1);
    expect(errors.join("\n")).toContain("30 minutes");
  }
});

it("explains InvitationLimitReached with revoke commands and issues no link (stubbed backend)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "campfire-inv-limit-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  envFor(dir, "http://127.0.0.1:9", "tok");
  const active = ["ein_a", "ein_b", "ein_c", "ein_d", "ein_e"].map((invitationId, index) => ({ invitationId, createdAt: "2026-01-01T00:00:00.000Z", expiresAt: `2026-01-01T00:3${index}:00.000Z` }));
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: false, error: "InvitationLimitReached", message: "limit", details: { activeInvitations: active } }), { status: 409 }));
  const { output, errors } = capture();
  expect(await runCliEntry(["invite-teammate", "ws_1", "--allow-loopback"])).toBe(1);
  const text = errors.join("\n");
  expect(text).toContain("limit");
  for (const item of active) {
    expect(text).toContain(item.invitationId);
    expect(text).toContain(`campfire revoke-invitation ${item.invitationId} --workspace ws_1`);
  }
  expect(output.join("\n")).not.toContain("Private invitation link");
});

it("sends a fresh request id per run, honors --request-id, and explains InvitationAlreadyIssued with a recovery path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "campfire-inv-already-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  envFor(dir, "http://127.0.0.1:9", "tok");
  const sent: string[] = [];
  vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
    sent.push((JSON.parse(String(init?.body ?? "{}")) as { params: { requestId?: string } }).params.requestId ?? "");
    return new Response(JSON.stringify({ ok: false, error: "InvitationAlreadyIssued", message: "already", details: { invitationId: "ein_lost", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:30:00.000Z", status: "active" } }), { status: 409 });
  });
  const { output, errors } = capture();
  expect(await runCliEntry(["invite-teammate", "ws_1", "--allow-loopback"])).toBe(1);
  expect(await runCliEntry(["invite-teammate", "ws_1", "--allow-loopback"])).toBe(1);
  expect(sent[0]).toMatch(/^inv_/);
  expect(sent[1]).not.toBe(sent[0]);
  errors.length = 0;
  expect(await runCliEntry(["invite-teammate", "ws_1", "--request-id", "my-retry-1", "--allow-loopback"])).toBe(1);
  expect(sent[2]).toBe("my-retry-1");
  const text = errors.join("\n");
  expect(text).toContain("may have been lost");
  expect(text).toContain("ein_lost");
  expect(text).toContain("active");
  expect(text).toContain("2026-01-01T00:30:00.000Z");
  expect(text).toContain("campfire revoke-invitation ein_lost --workspace ws_1");
  expect(text).toContain("campfire invite-teammate ws_1");
  expect(output.join("\n")).not.toContain("Private invitation link");
  expect(await runCliEntry(["invite-teammate", "ws_1", "--request-id", "bad id!", "--allow-loopback"])).toBe(1);
});

it("lists active invitations without secrets (stubbed backend)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "campfire-inv-list-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  envFor(dir, "http://127.0.0.1:9", "tok");
  const methods: string[] = [];
  vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
    methods.push(String(body.method));
    const result = body.method === "list_enrollment_invitations"
      ? { invitations: [{ invitationId: "ein_x", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:30:00.000Z", secret: "cfe_SECRET", secretHash: "h" }] }
      : { actor: { actorId: "h1", actorType: "human" } };
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  });
  const { output } = capture();
  expect(await runCliEntry(["invitations", "--workspace", "ws_1", "--allow-loopback", "--output", "human"])).toBe(0);
  const human = output.join("\n");
  expect(methods).toContain("list_enrollment_invitations");
  expect(human).toContain("ein_x");
  expect(human).toContain("campfire revoke-invitation ein_x --workspace ws_1");
  expect(human).not.toContain("SECRET");
  output.length = 0;
  expect(await runCliEntry(["invitations", "--workspace", "ws_1", "--allow-loopback", "--output", "json"])).toBe(0);
  expect(output.join("\n")).not.toContain("SECRET");
});

it("expired/revoked/used/invalid links give actionable text and never create a local workspace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "campfire-inv-recipient-"));
  const runtime = createRuntimeFromPath(join(dir, "owner.db")); seedFixture(runtime.store);
  const server = await startCampfireHttpServer({ runtime, port: 0 });
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }), () => runtime.close(), () => server.close());
  envFor(dir, server.url, FIXTURE.tokens.sergio);
  const { output, errors } = capture();
  expect(await runCliEntry(["invite-teammate", FIXTURE.workspaces.billing, "--allow-loopback", "--output", "json"])).toBe(0);
  const link = (JSON.parse(output.at(-1) ?? "{}") as { link: string }).link;
  vi.stubEnv("CAMPFIRE_URL", ""); vi.stubEnv("CAMPFIRE_TOKEN", "");
  const original = fetch;
  for (const status of ["expired", "revoked", "consumed", "unavailable"]) {
    vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => {
      if (!String(args[0]).endsWith("/v1/enrollment/preview")) return original(...args);
      return new Response(JSON.stringify({ ok: true, result: { version: 1, kind: "enrollment_invitation_preview", invitationId: JSON.parse(String(args[1]?.body)).invitationId, status, workspace: { id: "ws_secret", name: "Hidden Workspace", teamId: "t" }, inviter: { name: "Hidden Inviter" }, expiresAt: "2026-01-01T00:00:00.000Z", permittedHarnesses: ["codex"] } }), { status: 200 });
    });
    output.length = 0; errors.length = 0;
    expect(await runCliEntry(["join", "--invitation-link", link, "--allow-loopback", "--output", "human"])).toBe(0);
    expect(output.join("\n")).toMatch(/Ask the owner for a new link|ask the owner|Ask them/i);
    expect(output.join("\n")).not.toContain("Hidden");
    output.length = 0;
    expect(await runCliEntry(["join", "--invitation-link", link, "--allow-loopback", "--output", "json"])).toBe(0);
    expect(output.join("\n")).not.toContain("Hidden");
    errors.length = 0;
    expect(await runCliEntry(["join", "--invitation-link", link, "--accept", "--human-name", "Zed", "--harness", "codex", "--allow-loopback"])).toBe(1);
    expect(errors.join("\n")).not.toContain("Hidden");
  }
  // Server rejects the capability outright.
  vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => String(args[0]).includes("/v1/enrollment/")
    ? new Response(JSON.stringify({ ok: false, error: "Unauthorized", message: "internal detail ws_secret" }), { status: 401 }) : original(...args));
  errors.length = 0;
  expect(await runCliEntry(["join", "--invitation-link", link, "--allow-loopback"])).toBe(1);
  expect(errors.join("\n")).toContain("not valid");
  expect(errors.join("\n")).not.toContain("ws_secret");
  // No fallback to a local workspace or profile.
  expect(loadAnyProfile()).toBeUndefined();
  expect(existsSync(resolveProfilePaths().defaultDatabasePath)).toBe(false);
});

it("gives status-specific guidance when a duplicate request hits a consumed, expired, or revoked invitation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "campfire-inv-status-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  envFor(dir, "http://127.0.0.1:9", "tok");
  let status = "consumed";
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: false, error: "InvitationAlreadyIssued", message: "already", details: { invitationId: "ein_done", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:30:00.000Z", status } }), { status: 409 }));
  const { output, errors } = capture();
  const expectations: Record<string, string> = { consumed: "already accepted", expired: "expired unused", revoked: "revoked or declined" };
  for (const [value, phrase] of Object.entries(expectations)) {
    status = value; errors.length = 0;
    expect(await runCliEntry(["invite-teammate", "ws_1", "--allow-loopback"])).toBe(1);
    const text = errors.join("\n");
    expect(text).toContain(phrase);
    expect(text).toContain("campfire invite-teammate ws_1");
    expect(text).not.toContain("campfire revoke-invitation ein_done");
  }
  expect(output.join("\n")).not.toContain("Private invitation link");
});
