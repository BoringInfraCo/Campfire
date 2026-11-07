import { request as httpRequest } from "node:http";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "../../src/cli/args.js";
import { formatFullUsage } from "../../src/cli/catalog.js";
import { runCliEntry } from "../../src/cli/index.js";
import { installedCampfireVersion } from "../../src/bootstrap/version.js";
import { startCampfireHttpServer } from "../../src/http/server.js";
import { createRuntimeFromPath } from "../../src/runtime.js";
import { startCampfireViewer } from "../../src/viewer/server.js";
import { setOwnedCampfireService } from "../../src/cli/service-owner.js";
import { runUpdateCommand } from "../../src/cli/update-command.js";
import { UPDATE_CHECK_MAX_AGE_MS } from "../../src/update/cache.js";
import { classifyInstallChannel } from "../../src/update/channel.js";
import { decideNotice } from "../../src/update/check.js";
import { acceptAnswer, renderConfirm } from "../../src/update/confirm.js";
import { noticeLine, shouldAnnounce } from "../../src/update/notice.js";
import { detectReleasePlatform } from "../../src/update/platform.js";
import { parseLatestRelease } from "../../src/update/release.js";
import { replaceDirect } from "../../src/update/replace.js";
import { pollHealth, restartPlan } from "../../src/update/restart.js";
import type { PublishedRelease, ReleasePlatform } from "../../src/update/types.js";

const darwin: ReleasePlatform = { os: "darwin", arch: "arm64" };
const roots: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "upd-001-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  setOwnedCampfireService(undefined);
  vi.restoreAllMocks();
  for (const dir of roots.splice(0)) {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});

function releaseBody(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    draft: false,
    prerelease: false,
    tag_name: "v1.26.3",
    assets: [{ name: "campfire-darwin-arm64.tar.gz" }, { name: "campfire-darwin-arm64.tar.gz.sha256" }],
    html_url: "https://evil.example/notes",
    ...patch,
  };
}

function published(version = "1.26.3"): PublishedRelease {
  const parsed = parseLatestRelease(releaseBody({ tag_name: `v${version}` }), darwin);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.release;
}

describe("UPD-001 discovery", () => {
  it("accepts only a newer stable release for this architecture", () => {
    const parsed = parseLatestRelease(releaseBody(), darwin);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.release.version).toBe("1.26.3");
    expect(parsed.release.assetName).toBe("campfire-darwin-arm64.tar.gz");
    expect(parsed.release.notesUrl).toBe("https://github.com/BoringInfraCo/Campfire/releases/tag/v1.26.3");
    expect(parsed.release.tarballUrl).toBe(
      "https://github.com/BoringInfraCo/Campfire/releases/download/v1.26.3/campfire-darwin-arm64.tar.gz",
    );
    expect(parsed.release.notesUrl).not.toContain("evil.example");
    expect(detectReleasePlatform("darwin", "arm64")?.arch).toBe("arm64");
    expect(detectReleasePlatform("linux", "x86_64")?.arch).toBe("x64");
    expect(detectReleasePlatform("win32", "arm64")).toBeUndefined();
  });

  it("rejects equal, older, prerelease, draft, malformed, and missing checksum releases", () => {
    expect(parseLatestRelease(releaseBody({ tag_name: "v1.26.2" }), darwin).ok).toBe(true);
    expect(parseLatestRelease(releaseBody({ prerelease: true }), darwin)).toEqual({ ok: false, reason: "prerelease" });
    expect(parseLatestRelease(releaseBody({ tag_name: "v1.26.3-rc.1" }), darwin)).toEqual({ ok: false, reason: "prerelease" });
    expect(parseLatestRelease(releaseBody({ draft: true }), darwin)).toEqual({ ok: false, reason: "draft" });
    expect(parseLatestRelease("nope", darwin)).toEqual({ ok: false, reason: "malformed" });
    expect(parseLatestRelease(releaseBody({ assets: [{ name: "campfire-darwin-arm64.tar.gz" }] }), darwin)).toEqual({
      ok: false,
      reason: "no-checksum",
    });
    expect(parseLatestRelease(releaseBody(), { os: "linux", arch: "x64" })).toEqual({ ok: false, reason: "no-asset" });
    const now = Date.parse("2026-10-25T00:00:00.000Z");
    const newer = decideNotice({ installed: "1.26.2", cached: undefined, nowMs: now, fetched: published(), fetchFailed: false });
    expect(newer.notice).toBe("Campfire 1.26.3 is available. Run /update to review it.");
    expect(decideNotice({ installed: "1.26.3", cached: undefined, nowMs: now, fetched: published(), fetchFailed: false }).notice).toBeUndefined();
    expect(decideNotice({ installed: "1.26.4", cached: undefined, nowMs: now, fetched: published(), fetchFailed: false }).notice).toBeUndefined();
    expect(decideNotice({ installed: "1.26.2-rc.1", cached: undefined, nowMs: now, fetched: published(), fetchFailed: false }).notice).toBeUndefined();
    const failed = decideNotice({ installed: "1.26.2", cached: undefined, nowMs: now, fetched: undefined, fetchFailed: true });
    expect(failed.notice).toBeUndefined();
    expect(failed.nextCache.ok).toBe(false);
    expect(failed.networkAllowed).toBe(true);
  });

  it("uses a fresh cache and allows the network only after it expires", () => {
    const now = Date.parse("2026-10-25T00:00:00.000Z");
    const fresh = decideNotice({
      installed: "1.26.2",
      cached: { checkedAt: new Date(now - 60_000).toISOString(), ok: true, release: published() },
      nowMs: now,
      fetched: undefined,
      fetchFailed: false,
    });
    expect(fresh.networkAllowed).toBe(false);
    expect(fresh.notice).toBe(noticeLine("1.26.3"));
    const stale = decideNotice({
      installed: "1.26.2",
      cached: { checkedAt: new Date(now - UPDATE_CHECK_MAX_AGE_MS - 1).toISOString(), ok: true, release: published() },
      nowMs: now,
      fetched: undefined,
      fetchFailed: true,
    });
    expect(stale.networkAllowed).toBe(true);
    expect(stale.notice).toBeUndefined();
    expect(stale.nextCache.ok).toBe(false);
  });

  it("stays quiet for JSON, pipes, MCP, CI, and noninteractive runs", () => {
    expect(shouldAnnounce({ stdoutIsTTY: false, outputMode: "human", noninteractive: false, ci: false })).toBe(false);
    expect(shouldAnnounce({ stdoutIsTTY: true, outputMode: "json", noninteractive: false, ci: false })).toBe(false);
    expect(shouldAnnounce({ stdoutIsTTY: true, command: "mcp", outputMode: "human", noninteractive: false, ci: false })).toBe(false);
    expect(shouldAnnounce({ stdoutIsTTY: true, outputMode: "human", noninteractive: true, ci: false })).toBe(false);
    expect(shouldAnnounce({ stdoutIsTTY: true, outputMode: "human", noninteractive: false, ci: true })).toBe(false);
    expect(shouldAnnounce({ stdoutIsTTY: true, outputMode: "human", noninteractive: false, ci: false })).toBe(true);
    expect(noticeLine("1.26.3")).toBe("Campfire 1.26.3 is available. Run /update to review it.");
  });
});

describe("UPD-001 confirm and channel", () => {
  it("defaults to no and pins the version it was shown", () => {
    expect(acceptAnswer(undefined)).toBe(false);
    expect(acceptAnswer("")).toBe(false);
    expect(acceptAnswer("n")).toBe(false);
    expect(acceptAnswer("N")).toBe(false);
    expect(acceptAnswer("no")).toBe(false);
    expect(acceptAnswer("y")).toBe(true);
    expect(acceptAnswer("YES")).toBe(true);
    const text = renderConfirm({
      installed: "1.26.2",
      target: "1.26.3",
      channel: "direct",
      notesUrl: published().notesUrl,
      ask: true,
    });
    expect(text).toContain("Target: 1.26.3");
    expect(text).toContain("Install 1.26.3? [y/N]");
    expect(text).not.toContain("1.26.4");
    const brew = renderConfirm({
      installed: "1.26.2",
      target: "1.26.3",
      channel: "brew",
      instruction: "brew upgrade campfire",
    });
    expect(brew).toContain("brew upgrade campfire");
    expect(brew).not.toContain("[y/N]");
  });

  it("classifies nix, Homebrew, direct, and source installs", () => {
    expect(classifyInstallChannel({ modulePath: "/nix/store/abc/lib/campfire/dist/src/cli/index.js" }).channel).toBe("nix");
    expect(classifyInstallChannel({ modulePath: "/opt/homebrew/Cellar/campfire/1.26.2/libexec/lib/campfire/dist/src/cli/index.js" }).instruction).toBe(
      "brew upgrade campfire",
    );
    const direct = classifyInstallChannel({ modulePath: "/opt/ada/.local/lib/campfire/dist/src/cli/index.js" });
    expect(direct).toMatchObject({ channel: "direct", prefix: "/opt/ada/.local", binPath: "/opt/ada/.local/bin/campfire" });
    expect(classifyInstallChannel({ modulePath: "/repo/src/cli/index.ts" }).channel).toBe("unknown");
  });
});

describe("UPD-001 install and restart", () => {
  function seed(prefix: string): void {
    mkdirSync(join(prefix, "bin"), { recursive: true });
    mkdirSync(join(prefix, "lib", "campfire"), { recursive: true });
    writeFileSync(join(prefix, "bin", "campfire"), "old-bin");
    writeFileSync(join(prefix, "lib", "campfire", "package.json"), '{"version":"1.26.2"}\n');
    writeFileSync(join(prefix, "keep.txt"), "keep");
  }

  function installFiles(version: string) {
    const payload = new TextEncoder().encode(`archive-${version}`);
    const sum = new TextEncoder().encode(`${createHash("sha256").update(payload).digest("hex")}\n`);
    return {
      payload,
      fetch: async (url: string) => ({ ok: true, bytes: url.endsWith(".sha256") ? sum : payload }),
      listEntries: () => ["bin/campfire", "lib/campfire/package.json"],
      unpack: (_bytes: Uint8Array, dest: string) => {
        mkdirSync(join(dest, "bin"), { recursive: true });
        mkdirSync(join(dest, "lib", "campfire"), { recursive: true });
        writeFileSync(join(dest, "bin", "campfire"), `new-bin-${version}`);
        writeFileSync(join(dest, "lib", "campfire", "package.json"), JSON.stringify({ version }));
      },
    };
  }

  it("leaves the previous install in place when the checksum, download, permission, or staged smoke check fails", async () => {
    const prefix = join(tempDir(), "prefix");
    seed(prefix);
    const files = installFiles("1.26.3");
    const release = { version: "1.26.3", tarballUrl: "https://example.test/pinned.tar.gz", checksumUrl: "https://example.test/pinned.tar.gz.sha256" };
    const mismatch = await replaceDirect({
      prefix,
      release,
      fetch: async (url) => ({ ok: true, bytes: url.endsWith(".sha256") ? new TextEncoder().encode(`${"ab".repeat(32)}\n`) : files.payload }),
      spawnSmoke: () => ({ ok: true, stdout: "1.26.3" }),
      listEntries: files.listEntries,
      unpack: files.unpack,
    });
    expect(mismatch).toMatchObject({ ok: false, code: "checksum" });
    expect(readFileSync(join(prefix, "bin", "campfire"), "utf8")).toBe("old-bin");

    const interrupted = await replaceDirect({
      prefix,
      release,
      fetch: async () => { throw new Error("reset"); },
      spawnSmoke: () => ({ ok: true, stdout: "1.26.3" }),
    });
    expect(interrupted).toMatchObject({ ok: false, code: "download" });
    expect(readFileSync(join(prefix, "lib", "campfire", "package.json"), "utf8")).toContain("1.26.2");

    chmodSync(prefix, 0o500);
    const denied = await replaceDirect({
      prefix,
      release,
      fetch: files.fetch,
      spawnSmoke: () => ({ ok: true, stdout: "1.26.3" }),
      listEntries: files.listEntries,
      unpack: files.unpack,
    });
    chmodSync(prefix, 0o700);
    expect(denied).toMatchObject({ ok: false, code: "permission" });
    expect(readFileSync(join(prefix, "bin", "campfire"), "utf8")).toBe("old-bin");

    const smoked = await replaceDirect({
      prefix,
      release,
      fetch: files.fetch,
      spawnSmoke: () => ({ ok: false, stdout: "" }),
      listEntries: files.listEntries,
      unpack: files.unpack,
    });
    expect(smoked).toMatchObject({ ok: false, code: "smoke" });
    expect(readFileSync(join(prefix, "bin", "campfire"), "utf8")).toBe("old-bin");
    expect(readFileSync(join(prefix, "keep.txt"), "utf8")).toBe("keep");
    expect(existsSync(join(prefix, "lib", "campfire.previous"))).toBe(false);
  });

  it("restores the previous version when the installed smoke check fails and replaces it when the check passes", async () => {
    const prefix = join(tempDir(), "prefix");
    seed(prefix);
    const outside = join(tempDir(), "profile.json");
    writeFileSync(outside, '{"workspaceId":"ws_keep"}\n');
    const files = installFiles("1.26.3");
    const release = { version: "1.26.3", tarballUrl: "https://example.test/v1.26.3.tar.gz", checksumUrl: "https://example.test/v1.26.3.tar.gz.sha256" };
    let calls = 0;
    const rolled = await replaceDirect({
      prefix,
      release,
      fetch: files.fetch,
      listEntries: files.listEntries,
      unpack: files.unpack,
      spawnSmoke: (bin) => {
        calls += 1;
        return bin.includes(".campfire-update-") ? { ok: true, stdout: "1.26.3 help" } : { ok: false, stdout: "" };
      },
    });
    expect(rolled).toMatchObject({ ok: false, code: "smoke" });
    expect(readFileSync(join(prefix, "bin", "campfire"), "utf8")).toBe("old-bin");
    expect(calls).toBeGreaterThan(1);

    const replaced = await replaceDirect({
      prefix,
      release,
      fetch: files.fetch,
      listEntries: files.listEntries,
      unpack: files.unpack,
      spawnSmoke: () => ({ ok: true, stdout: "Campfire 1.26.3" }),
    });
    expect(replaced).toEqual({ ok: true, version: "1.26.3" });
    expect(readFileSync(join(prefix, "bin", "campfire"), "utf8")).toBe("new-bin-1.26.3");
    expect(readFileSync(join(prefix, "lib", "campfire", "package.json"), "utf8")).toContain("1.26.3");
    expect(existsSync(join(prefix, "lib", "campfire.previous"))).toBe(false);
    expect(readFileSync(outside, "utf8")).toContain("ws_keep");
    expect(readFileSync(join(prefix, "keep.txt"), "utf8")).toBe("keep");

    const wrong = installFiles("9.9.9");
    writeFileSync(join(prefix, "bin", "campfire"), "old-bin");
    const mismatch = await replaceDirect({
      prefix,
      release,
      fetch: wrong.fetch,
      listEntries: wrong.listEntries,
      unpack: wrong.unpack,
      spawnSmoke: () => ({ ok: true, stdout: "1.26.3" }),
    });
    expect(mismatch).toMatchObject({ ok: false, code: "archive" });
    expect(readFileSync(join(prefix, "bin", "campfire"), "utf8")).toBe("old-bin");
  });

  it("names an owned restart, a required external restart, and a package-manager instruction", async () => {
    expect(restartPlan({
      channel: "direct",
      replaced: true,
      ownsLifecycle: true,
      profileMode: "local",
      listener: "none",
      version: "1.26.3",
    }).action).toBe("restart-owned");
    const remote = restartPlan({
      channel: "direct",
      replaced: true,
      ownsLifecycle: true,
      profileMode: "remote",
      listener: "none",
      version: "1.26.3",
    });
    expect(remote.lines.join("\n")).toContain("The hosted Worker is not restarted.");
    const external = restartPlan({
      channel: "direct",
      replaced: true,
      ownsLifecycle: false,
      profileMode: "local",
      listener: "other-version",
      version: "1.26.3",
    });
    expect(external.action).toBe("restart-required");
    expect(external.lines).toContain("restart required");
    expect(external.lines).toContain("campfire up");
    expect(restartPlan({
      channel: "brew",
      replaced: false,
      ownsLifecycle: false,
      profileMode: "local",
      listener: "none",
      instruction: "brew upgrade campfire",
    }).lines.join("\n")).toContain("brew upgrade campfire");
    expect(await pollHealth(async () => "1.26.2", "1.26.3", 2)).toBe(false);
    expect(await pollHealth(async () => "1.26.3", "1.26.3", 1)).toBe(true);
  });
});

describe("UPD-001 command", () => {
  function body(version: string) {
    const platform = detectReleasePlatform(process.platform, process.arch);
    if (platform === undefined) throw new Error("this test requires a published Campfire architecture");
    const name = `campfire-${platform.os}-${platform.arch}.tar.gz`;
    return releaseBody({ tag_name: `v${version}`, assets: [{ name }, { name: `${name}.sha256` }] });
  }

  it("does not install on no, EOF, JSON, or a noninteractive run, and pins the first target", async () => {
    const config = tempDir();
    const env = { ...process.env, CAMPFIRE_CONFIG_DIR: config, CAMPFIRE_NONINTERACTIVE: undefined };
    const fetches: string[] = [];
    const fetchLatest = vi.fn(async () => body("1.26.3"));
    const fetchFile = vi.fn(async (url: string) => {
      fetches.push(url);
      return { ok: true, bytes: new Uint8Array() };
    });
    const base = {
      env,
      installedVersion: "1.26.2",
      fetchLatest,
      fetchFile,
      stdoutIsTTY: true,
      modulePath: "/repo/src/cli/index.ts",
    };
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      logs.push(String(line));
    });
    await runUpdateCommand(parseArgs(["update", "--output", "json"]), { ...base, stdinIsTTY: false });
    const json = JSON.parse(logs.at(-1) ?? "");
    expect(json.target).toBe("1.26.3");
    expect(json.changed).toBe(false);
    expect(json.confirmed).toBe(false);
    expect(fetchFile).not.toHaveBeenCalled();
    expect(fetchLatest).toHaveBeenCalledTimes(1);

    const direct = { ...base, modulePath: "/opt/ada/.local/lib/campfire/dist/src/cli/index.js" };
    await runUpdateCommand(parseArgs(["update"]), { ...direct, stdinIsTTY: true, prompt: async () => "n" });
    await runUpdateCommand(parseArgs(["update"]), { ...direct, stdinIsTTY: true, prompt: async () => undefined });
    expect(fetchFile).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("Update declined. Campfire 1.26.2 is unchanged.");
    expect(formatFullUsage()).toContain("campfire update [--check] [--output auto|human|json]");
    expect(parseArgs(["/update", "--check"]).command).toBe("update");
    expect(parseArgs(["/update", "--check"]).flags.check).toBe(true);
  });

  it("reports restart required for an external service and does not overwrite Homebrew", async () => {
    const config = tempDir();
    const prefix = join(tempDir(), "prefix");
    mkdirSync(prefix, { recursive: true });
    mkdirSync(join(prefix, "bin"), { recursive: true });
    mkdirSync(join(prefix, "lib", "campfire"), { recursive: true });
    writeFileSync(join(prefix, "bin", "campfire"), "old-bin");
    writeFileSync(join(prefix, "lib", "campfire", "package.json"), '{"version":"1.26.2"}\n');
    const payload = new TextEncoder().encode("bytes");
    const sum = createHash("sha256").update(payload).digest("hex");
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      logs.push(String(line));
    });
    const seen: string[] = [];
    await runUpdateCommand(parseArgs(["update"]), {
      env: { ...process.env, CAMPFIRE_CONFIG_DIR: config },
      installedVersion: "1.26.2",
      stdinIsTTY: true,
      stdoutIsTTY: true,
      modulePath: join(prefix, "lib/campfire/dist/src/cli/index.js"),
      fetchLatest: async () => body("1.26.3"),
      prompt: async () => "y",
      probeListener: async () => "other-version",
      fetchFile: async (url) => {
        seen.push(url);
        return { ok: true, bytes: url.endsWith(".sha256") ? new TextEncoder().encode(`${sum}\n`) : payload };
      },
      listEntries: () => ["bin/campfire", "lib/campfire/package.json"],
      unpack: (_bytes, dest) => {
        mkdirSync(join(dest, "bin"), { recursive: true });
        mkdirSync(join(dest, "lib", "campfire"), { recursive: true });
        writeFileSync(join(dest, "bin", "campfire"), "new-bin");
        writeFileSync(join(dest, "lib", "campfire", "package.json"), '{"version":"1.26.3"}');
      },
      spawnSmoke: () => ({ ok: true, stdout: "1.26.3" }),
    });
    const expected = parseLatestRelease(body("1.26.3"), detectReleasePlatform(process.platform, process.arch) ?? darwin);
    expect(expected.ok).toBe(true);
    if (expected.ok) expect(seen).toEqual([expected.release.tarballUrl, expected.release.checksumUrl]);
    expect(readFileSync(join(prefix, "bin", "campfire"), "utf8")).toBe("new-bin");
    const text = logs.join("\n");
    expect(text).toContain("restart required");
    expect(text).toContain("campfire up");

    logs.length = 0;
    await runUpdateCommand(parseArgs(["update"]), {
      env: { ...process.env, CAMPFIRE_CONFIG_DIR: config },
      installedVersion: "1.26.2",
      stdinIsTTY: true,
      stdoutIsTTY: true,
      modulePath: "/opt/homebrew/Cellar/campfire/1.26.2/libexec/lib/campfire/dist/src/cli/index.js",
      fetchLatest: async () => body("1.26.3"),
      fetchFile: async () => { throw new Error("must not download"); },
      prompt: async () => "y",
    });
    expect(logs.join("\n")).toContain("brew upgrade campfire");
    expect(readFileSync(join(prefix, "bin", "campfire"), "utf8")).toBe("new-bin");
  });

  it("restarts only an in-process service after the new health check and restores it when that check fails", async () => {
    const config = tempDir();
    const prefix = join(tempDir(), "prefix");
    mkdirSync(join(prefix, "bin"), { recursive: true });
    mkdirSync(join(prefix, "lib", "campfire"), { recursive: true });
    writeFileSync(join(prefix, "bin", "campfire"), "old-bin");
    writeFileSync(join(prefix, "lib", "campfire", "package.json"), '{"version":"1.26.2"}\n');
    const payload = new TextEncoder().encode("bytes");
    const sum = createHash("sha256").update(payload).digest("hex");
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      logs.push(String(line));
    });
    const install = {
      env: { ...process.env, CAMPFIRE_CONFIG_DIR: config },
      installedVersion: "1.26.2",
      stdinIsTTY: true,
      stdoutIsTTY: true,
      modulePath: join(prefix, "lib/campfire/dist/src/cli/index.js"),
      fetchLatest: async () => body("1.26.3"),
      prompt: async () => "yes",
      fetchFile: async (url: string) => ({
        ok: true,
        bytes: url.endsWith(".sha256") ? new TextEncoder().encode(`${sum}\n`) : payload,
      }),
      listEntries: () => ["bin/campfire", "lib/campfire/package.json"],
      unpack: (_bytes: Uint8Array, dest: string) => {
        mkdirSync(join(dest, "bin"), { recursive: true });
        mkdirSync(join(dest, "lib", "campfire"), { recursive: true });
        writeFileSync(join(dest, "bin", "campfire"), "new-bin");
        writeFileSync(join(dest, "lib", "campfire", "package.json"), '{"version":"1.26.3"}');
      },
      spawnSmoke: () => ({ ok: true, stdout: "1.26.3" }),
    };
    let stopped = 0;
    setOwnedCampfireService({
      profileMode: "local",
      argv: ["up", "--no-open"],
      apiUrl: "http://127.0.0.1:9414",
      stop: async () => { stopped += 1; },
    });
    const exited: number[] = [];
    const reexeced: string[][] = [];
    await expect(runUpdateCommand(parseArgs(["update"]), {
      ...install,
      fetchHealth: async () => "1.26.2",
      reexec: (bin, argv) => {
        reexeced.push([bin, ...argv]);
        return { kill: () => undefined };
      },
      exitProcess: (code) => { exited.push(code); },
    })).rejects.toThrow(/previous version was restored/);
    expect(stopped).toBe(1);
    expect(reexeced).toEqual([[join(prefix, "bin", "campfire"), "up", "--no-open"]]);
    expect(exited).toEqual([]);
    expect(readFileSync(join(prefix, "bin", "campfire"), "utf8")).toBe("old-bin");

    writeFileSync(join(prefix, "bin", "campfire"), "old-bin");
    setOwnedCampfireService({
      profileMode: "remote",
      argv: ["up"],
      viewerUrl: "http://127.0.0.1:9415",
      stop: async () => { stopped += 1; },
    });
    await runUpdateCommand(parseArgs(["update"]), {
      ...install,
      fetchHealth: async () => "1.26.3",
      reexec: (bin, argv) => {
        reexeced.push([bin, ...argv]);
        return { kill: () => undefined };
      },
      exitProcess: (code) => { exited.push(code); },
    });
    expect(stopped).toBe(2);
    expect(exited).toEqual([0]);
    expect(reexeced[1]).toEqual([join(prefix, "bin", "campfire"), "up"]);
    expect(logs.join("\n")).toContain("Campfire 1.26.3 is running.");
    expect(readFileSync(join(prefix, "bin", "campfire"), "utf8")).toBe("new-bin");
    expect(existsSync(join(prefix, "bin", "campfire.previous"))).toBe(false);
  });
});

describe("UPD-001 version flag", () => {
  it("prints the installed package version", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      logs.push(String(line));
    });
    const code = await runCliEntry(["--version"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toBe(JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version);
  });
});

describe("UPD-001 health", () => {
  it("reports only the installed version from the local API and Viewer", async () => {
    const dir = tempDir();
    const runtime = createRuntimeFromPath(join(dir, "campfire.db"));
    const http = await startCampfireHttpServer({ runtime, host: "127.0.0.1", port: 0 });
    const viewer = await startCampfireViewer({
      call: async () => ({}),
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const version = installedCampfireVersion();
      const api = await fetch(`${http.url}/health`);
      expect(api.status).toBe(200);
      expect(await api.json()).toEqual({ version });
      const denied = await fetch(`${http.url}/health`, { method: "POST" });
      expect(denied.status).toBe(405);
      const viewed = await fetch(`${viewer.url}/health`);
      expect(viewed.status).toBe(200);
      expect(await viewed.json()).toEqual({ version });
      const foreign = await new Promise<number>((resolve, reject) => {
        const target = new URL(`${viewer.url}/health`);
        const req = httpRequest({
          hostname: target.hostname,
          port: target.port,
          path: target.pathname,
          method: "GET",
          headers: { host: "campfire.example:9" },
        }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on("error", reject);
        req.end();
      });
      expect(foreign).toBe(403);
    } finally {
      await viewer.close();
      await http.close();
      runtime.close();
    }
  });
});
