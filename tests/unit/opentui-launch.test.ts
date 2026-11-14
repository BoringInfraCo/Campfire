import { spawnSync } from "node:child_process";
import { readFileSync, chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  VENDORED_BUN_MESSAGE,
  OpentuiUnavailableError,
  bunMeetsMinimum,
  opentuiRequested,
  spawnOpentui,
  waitForOpentui,
  OPENTUI_UPDATE_EXIT_CODE,
  vendoredBunPath,
  type OpentuiChild,
  type OpentuiSpawnOptions,
} from "../../src/cli/opentui-launch.js";

function fakeChild(): OpentuiChild {
  return {
    once() {
      return undefined;
    },
  };
}

function installFakeBun(root: string, platform: string, arch: string): string {
  const bunPath = vendoredBunPath(root, platform, arch);
  mkdirSync(join(bunPath, ".."), { recursive: true });
  writeFileSync(bunPath, "");
  chmodSync(bunPath, 0o755);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "main.ts"), "export {};\n");
  writeFileSync(join(root, "package.json"), "{}\n");
  for (const name of ["core", `core-${platform}-${arch}`]) {
    const packageDir = join(root, "node_modules", "@opentui", name);
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, "package.json"), "{}\n");
  }
  return bunPath;
}

function exitingChild(code: number | null): OpentuiChild {
  return {
    once(event: string, listener: (...args: never[]) => void) {
      if (event === "exit") queueMicrotask(() => (listener as (c: number | null, s: null) => void)(code, null));
    },
  } as OpentuiChild;
}

describe("opentui launcher", () => {
  it("maps exit 0 to quit and the reserved code to update; other codes still reject", async () => {
    expect(OPENTUI_UPDATE_EXIT_CODE).toBe(75);
    const shared = readFileSync(fileURLToPath(new URL("../../tui/src/exit-codes.ts", import.meta.url)), "utf8");
    expect(shared).toContain(`UPDATE_EXIT_CODE = ${OPENTUI_UPDATE_EXIT_CODE};`);
    await expect(waitForOpentui(exitingChild(0))).resolves.toBe("quit");
    await expect(waitForOpentui(exitingChild(75))).resolves.toBe("update");
    await expect(waitForOpentui(exitingChild(1))).rejects.toThrow(/status 1/);
    await expect(waitForOpentui(exitingChild(74))).rejects.toThrow(/status 74/);
    await expect(waitForOpentui(exitingChild(null))).rejects.toThrow(/status null/);
  });

  it("accepts the flag or the exact CAMPFIRE_TUI value and nothing close", () => {
    expect(opentuiRequested({}, { opentui: true })).toBe(true);
    expect(opentuiRequested({ CAMPFIRE_TUI: "opentui" }, {})).toBe(true);
    expect(opentuiRequested({ CAMPFIRE_TUI: "opentui" }, { opentui: false })).toBe(true);
    expect(opentuiRequested({ CAMPFIRE_TUI: "OpenTUI" }, {})).toBe(false);
    expect(opentuiRequested({ CAMPFIRE_TUI: "opentui " }, {})).toBe(false);
    expect(opentuiRequested({ CAMPFIRE_TUI: "" }, {})).toBe(false);
    expect(opentuiRequested({}, {})).toBe(false);
  });

  it("compares Bun versions against 1.3.14", () => {
    expect(bunMeetsMinimum("1.3.14")).toBe(true);
    expect(bunMeetsMinimum("1.3.14\n")).toBe(true);
    expect(bunMeetsMinimum("1.4.0")).toBe(true);
    expect(bunMeetsMinimum("1.3.13")).toBe(false);
    expect(bunMeetsMinimum("1.3.5")).toBe(false);
    expect(bunMeetsMinimum("")).toBe(false);
  });

  it("refuses a missing vendored bun and names Node 22", () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-opentui-missing-"));
    const spawnImpl = vi.fn();
    expect(() =>
      spawnOpentui({
        baseUrl: "http://127.0.0.1:9",
        token: "secret-token-value",
        workspaceId: "ws_fixture",
        awaitingWorkspace: false,
        actorId: "hum_fixture",
        actorType: "human",
        tuiRoot: root,
        platform: "darwin",
        arch: "arm64",
        parentEnv: {},
        spawnImpl,
      }),
    ).toThrow(VENDORED_BUN_MESSAGE);
    expect(VENDORED_BUN_MESSAGE).toContain("vendored Bun in tui/");
    expect(VENDORED_BUN_MESSAGE).toContain("Node 22");
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("refuses a vendored bun older than 1.3.14", () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-opentui-old-"));
    installFakeBun(root, "darwin", "arm64");
    const spawnImpl = vi.fn();
    expect(() =>
      spawnOpentui({
        baseUrl: "http://127.0.0.1:9",
        token: "secret-token-value",
        workspaceId: "ws_fixture",
        awaitingWorkspace: false,
        actorId: "hum_fixture",
        actorType: "human",
        tuiRoot: root,
        platform: "darwin",
        arch: "arm64",
        parentEnv: {},
        readVersion: () => "1.3.5",
        spawnImpl,
      }),
    ).toThrow(/Node 22/);
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("reports a missing native OpenTUI package as unavailable before spawning", () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-opentui-native-missing-"));
    const bunPath = installFakeBun(root, "darwin", "arm64");
    const spawnImpl = vi.fn();
    expect(() => spawnOpentui({
      baseUrl: "http://127.0.0.1:9", token: "secret", workspaceId: "ws_fixture", awaitingWorkspace: false,
      actorId: "hum_fixture", actorType: "human", tuiRoot: root, bunBin: bunPath,
      platform: "linux", arch: "x64", readVersion: () => "1.3.14", spawnImpl,
      linuxLibc: "glibc",
    })).toThrow(OpentuiUnavailableError);
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("rejects Linux musl before starting the child", () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-opentui-musl-"));
    const bunPath = installFakeBun(root, "linux", "x64");
    const spawnImpl = vi.fn();
    expect(() => spawnOpentui({
      baseUrl: "http://127.0.0.1:9", token: "secret", workspaceId: "ws_fixture", awaitingWorkspace: false,
      actorId: "hum_fixture", actorType: "human", tuiRoot: root, bunBin: bunPath,
      platform: "linux", arch: "x64", linuxLibc: "unsupported", readVersion: () => "1.3.14", spawnImpl,
    })).toThrow(/requires glibc/);
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("spawns the vendored bun with the token only in the environment", () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-opentui-spawn-"));
    const bunPath = installFakeBun(root, "linux", "x64");
    const token = "secret-token-value";
    let captured: { command: string; args: readonly string[]; options: OpentuiSpawnOptions } | undefined;
    const spawnImpl = (command: string, args: readonly string[], options: OpentuiSpawnOptions): OpentuiChild => {
      captured = { command, args, options };
      return fakeChild();
    };
    spawnOpentui({
      baseUrl: "http://127.0.0.1:9",
      token,
      workspaceId: "",
      awaitingWorkspace: true,
      actorId: "hum_fixture",
      actorType: "human",
      tuiRoot: root,
      platform: "linux",
      arch: "x64",
      linuxLibc: "glibc",
      parentEnv: { PATH: "/usr/bin", CAMPFIRE_TOKEN: "stale", CAMPFIRE_AWAITING_WORKSPACE: "1" },
      readVersion: () => "1.3.14",
      spawnImpl,
    });
    expect(captured).toBeDefined();
    expect(captured?.command).toBe(bunPath);
    expect(captured?.command).toContain(`${join("node_modules", "@oven", "bun-linux-x64", "bin", "bun")}`);
    expect(captured?.args).toEqual([join(root, "src", "main.ts")]);
    expect(captured?.args.join(" ")).not.toContain(token);
    expect(captured?.command).not.toContain(token);
    expect(captured?.options.stdio).toBe("inherit");
    expect(captured?.options.cwd).toBe(root);
    expect(captured?.options.env.CAMPFIRE_URL).toBe("http://127.0.0.1:9");
    expect(captured?.options.env.CAMPFIRE_TOKEN).toBe(token);
    expect(captured?.options.env.CAMPFIRE_WORKSPACE_ID).toBe("");
    expect(captured?.options.env.CAMPFIRE_AWAITING_WORKSPACE).toBe("1");
    expect(captured?.options.env.CAMPFIRE_ACTOR_ID).toBe("hum_fixture");
    expect(captured?.options.env.CAMPFIRE_ACTOR_TYPE).toBe("human");
  });

  it("does not keep an awaiting flag when a workspace id is passed", () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-opentui-clear-"));
    installFakeBun(root, "darwin", "arm64");
    let env: NodeJS.ProcessEnv = {};
    spawnOpentui({
      baseUrl: "http://127.0.0.1:9",
      token: "secret-token-value",
      workspaceId: "ws_fixture",
      awaitingWorkspace: false,
      actorId: "hum_fixture",
      actorType: "human",
      tuiRoot: root,
      platform: "darwin",
      arch: "arm64",
      parentEnv: { CAMPFIRE_AWAITING_WORKSPACE: "1" },
      readVersion: () => "1.3.14",
      spawnImpl: (_command, _args, options) => {
        env = options.env;
        return fakeChild();
      },
    });
    expect(env.CAMPFIRE_WORKSPACE_ID).toBe("ws_fixture");
    expect(env.CAMPFIRE_AWAITING_WORKSPACE).toBeUndefined();
  });
});

describe("vendored bun on this machine", () => {
  it("is at least 1.3.14 when the sidecar install is present", () => {
    const bunPath = vendoredBunPath(fileURLToPath(new URL("../../tui", import.meta.url)));
    const probe = spawnSync(bunPath, ["--version"], { encoding: "utf8" });
    if (probe.error !== undefined && "code" in probe.error && probe.error.code === "ENOENT") {
      return;
    }
    expect(probe.status).toBe(0);
    expect(bunMeetsMinimum(probe.stdout ?? "")).toBe(true);
  });
});
