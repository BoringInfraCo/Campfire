import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectInstallMethod,
  maybeReportPackageManagerInstall,
} from "../../src/telemetry/install-method.js";
import { reportInstallCompleted } from "../../src/telemetry/report.js";
import { claimInstallCompleted, TELEMETRY_ENV_VAR } from "../../src/telemetry/state.js";

/**
 * Package-manager install reporting (TEL-001 brew/nix bootstrap).
 *
 * The CLI closes the loop the shell installer cannot: Homebrew and Nix never
 * fetch `install.sh`, so the first CLI run claims `install_completed` with
 * the detected channel. Three properties are defended here:
 *
 *   1. Detection is a pure path match (nix store, Homebrew prefixes) and says
 *      nothing for curl tarball layouts or unknown prefixes.
 *   2. The hook reports once for brew/nix, stays silent for curl/unknown
 *      (the shell owns that channel), and sends nothing when telemetry is
 *      disabled — without writing state.
 *   3. Double-report safety: the shell and the CLI share one
 *      `installCompletedReported` claim in one `telemetry.json`
 *      (`install.sh` writes it when it creates the file on a fresh curl
 *      install; the CLI claims it via `claimInstallCompleted`). Whichever
 *      writer runs second finds the claim taken and sends nothing locally.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let dir: string;
let env: NodeJS.ProcessEnv;

interface CapturedCall {
  url: string;
  init: RequestInit | undefined;
}

function stubFetch(): { fetchImpl: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ ok: true, result: { recorded: true } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function payloadOf(call: CapturedCall): Record<string, unknown> {
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campfire-tel-install-method-"));
  env = {
    CAMPFIRE_CONFIG_DIR: join(dir, "config"),
    CAMPFIRE_DATA_DIR: join(dir, "data"),
    CAMPFIRE_TELEMETRY_URL: "http://127.0.0.1:9/v1/telemetry",
  };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("detectInstallMethod", () => {
  it.each([
    ["/opt/homebrew/Cellar/campfire/1.25.0/bin/campfire", "brew"],
    ["/usr/local/Cellar/campfire/1.25.0/bin/campfire", "brew"],
    ["/opt/homebrew/bin/campfire", "brew"],
    ["/usr/local/Homebrew/Library/bin/campfire", "brew"],
    ["/home/linuxbrew/.linuxbrew/Cellar/campfire/1.25.0/bin/campfire", "brew"],
    ["/homebrew/bin/campfire", "brew"],
    ["/nix/store/abc123-campfire-1.25.0/bin/campfire", "nix"],
    ["/nix/store/00000000000000000000000000000000-campfire/bin/campfire", "nix"],
  ])("maps %s to %s", (execPath, expected) => {
    expect(detectInstallMethod(execPath)).toBe(expected);
  });

  it.each([
    ["/usr/local/bin/campfire"],
    ["/opt/campfire/bin/campfire"],
    ["/home/example/.local/bin/campfire"],
    ["campfire"],
    [""],
    ["/opt/nixbackup/campfire"],
  ])("returns undefined for %s (curl tarball or unknown layout)", (execPath) => {
    expect(detectInstallMethod(execPath)).toBeUndefined();
  });

  it("prefers the nix store match", () => {
    expect(detectInstallMethod("/nix/store/hash/Cellar/campfire")).toBe("nix");
  });
});

describe("maybeReportPackageManagerInstall", () => {
  it("reports brew installs once with the brew install method", async () => {
    const { fetchImpl, calls } = stubFetch();
    maybeReportPackageManagerInstall({
      env,
      fetchImpl,
      execPath: "/opt/homebrew/Cellar/campfire/1.25.0/bin/campfire",
    });
    await flush();

    expect(calls).toHaveLength(1);
    expect(payloadOf(calls[0]!)).toMatchObject({
      event: "install_completed",
      installMethod: "brew",
    });
    expect(String(payloadOf(calls[0]!).installationId)).toMatch(UUID_V4);

    maybeReportPackageManagerInstall({
      env,
      fetchImpl,
      execPath: "/opt/homebrew/Cellar/campfire/1.25.0/bin/campfire",
    });
    await flush();
    expect(calls).toHaveLength(1);
  });

  it("reports nix installs with the nix install method", async () => {
    const { fetchImpl, calls } = stubFetch();
    maybeReportPackageManagerInstall({
      env,
      fetchImpl,
      execPath: "/nix/store/abc123-campfire-1.25.0/bin/campfire",
    });
    await flush();

    expect(calls).toHaveLength(1);
    expect(payloadOf(calls[0]!)).toMatchObject({
      event: "install_completed",
      installMethod: "nix",
    });
  });

  it("stays silent for curl tarball and unknown layouts, and writes no state", async () => {
    const { fetchImpl, calls } = stubFetch();
    for (const execPath of ["/usr/local/bin/campfire", "/opt/campfire/bin/campfire", "campfire", ""]) {
      maybeReportPackageManagerInstall({ env, fetchImpl, execPath });
    }
    await flush();

    expect(calls).toHaveLength(0);
    expect(existsSync(join(env.CAMPFIRE_CONFIG_DIR as string, "telemetry.json"))).toBe(false);
  });

  it("sends nothing and writes no state when telemetry is disabled", async () => {
    const { fetchImpl, calls } = stubFetch();
    const disabled = { ...env, [TELEMETRY_ENV_VAR]: "0" };
    maybeReportPackageManagerInstall({
      env: disabled,
      fetchImpl,
      execPath: "/opt/homebrew/Cellar/campfire/1.25.0/bin/campfire",
    });
    maybeReportPackageManagerInstall({
      env: disabled,
      fetchImpl,
      execPath: "/nix/store/abc123-campfire-1.25.0/bin/campfire",
    });
    await flush();

    expect(calls).toHaveLength(0);
    expect(existsSync(join(env.CAMPFIRE_CONFIG_DIR as string, "telemetry.json"))).toBe(false);
  });

  it("never throws for a hostile execPath", async () => {
    const { fetchImpl, calls } = stubFetch();
    expect(() =>
      maybeReportPackageManagerInstall({ env, fetchImpl, execPath: "/usr/local/bin/campfire" }),
    ).not.toThrow();
    await flush();
    expect(calls).toHaveLength(0);
  });
});

describe("shell and CLI share one install_completed claim", () => {
  it("a fresh curl install file suppresses the later CLI brew report", async () => {
    const { fetchImpl, calls } = stubFetch();
    // Faithful to install.sh: on a fresh install it creates telemetry.json
    // with installCompletedReported set, then posts the curl event itself.
    const shellId = "11111111-2222-4333-8444-555555555555";
    const { mkdirSync } = await import("node:fs");
    mkdirSync(env.CAMPFIRE_CONFIG_DIR as string, { recursive: true });
    writeFileSync(
      join(env.CAMPFIRE_CONFIG_DIR as string, "telemetry.json"),
      `${JSON.stringify({ version: 1, installationId: shellId, installCompletedReported: true }, null, 2)}\n`,
    );

    maybeReportPackageManagerInstall({
      env,
      fetchImpl,
      execPath: "/opt/homebrew/Cellar/campfire/1.25.0/bin/campfire",
    });
    await flush();

    expect(calls).toHaveLength(0);
    expect(claimInstallCompleted(env)).toBe("");
  });

  it("a CLI brew report first suppresses the later curl report, and vice versa", async () => {
    const { fetchImpl, calls } = stubFetch();
    const options = { env, fetchImpl };

    maybeReportPackageManagerInstall({
      ...options,
      execPath: "/nix/store/abc123-campfire-1.25.0/bin/campfire",
    });
    await flush();
    expect(calls).toHaveLength(1);
    expect(payloadOf(calls[0]!)).toMatchObject({ installMethod: "nix" });

    // The curl side (shell or CLI equivalent) finds the claim taken.
    await reportInstallCompleted({ ...options, installMethod: "curl" });
    await reportInstallCompleted({ ...options, installMethod: "curl" });
    expect(calls).toHaveLength(1);

    expect(claimInstallCompleted(env)).toBe("");
    const state = JSON.parse(
      readFileSync(join(env.CAMPFIRE_CONFIG_DIR as string, "telemetry.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(state.installCompletedReported).toBe(true);
  });
});
