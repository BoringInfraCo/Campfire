import { describe, expect, it } from "vitest";
import { ValidationError } from "../../src/domain/errors.js";
import { parseArgs } from "../../src/cli/args.js";
import {
  OPENTUI_FALLBACK_NOTE, OpentuiUnavailableError, chooseDashboard, opentuiRequested, spawnOpentui,
} from "../../src/cli/opentui-launch.js";

describe("dashboard selection matrix", () => {
  it("defaults to OpenTUI (not explicit) in an interactive terminal", () => {
    expect(chooseDashboard({}, {})).toEqual({ mode: "opentui", explicit: false });
    expect(opentuiRequested({}, {})).toBe(false);
  });
  it("uses classic without any note path when non-interactive", () => {
    expect(chooseDashboard({}, {}, false)).toEqual({ mode: "classic", reason: "non-interactive" });
  });
  it("honors CAMPFIRE_TUI", () => {
    expect(chooseDashboard({ CAMPFIRE_TUI: "classic" }, {})).toEqual({ mode: "classic", reason: "env" });
    expect(chooseDashboard({ CAMPFIRE_TUI: "opentui" }, {})).toEqual({ mode: "opentui", explicit: true });
    expect(chooseDashboard({ CAMPFIRE_TUI: "" }, {})).toEqual({ mode: "opentui", explicit: false });
  });
  it("honors --classic and --opentui from parsed argv", () => {
    expect(chooseDashboard({}, parseArgs(["--classic"]).flags)).toEqual({ mode: "classic", reason: "flag" });
    expect(chooseDashboard({}, parseArgs(["--opentui"]).flags)).toEqual({ mode: "opentui", explicit: true });
  });
  it("lets an explicit flag beat CAMPFIRE_TUI", () => {
    expect(chooseDashboard({ CAMPFIRE_TUI: "opentui" }, { classic: true })).toEqual({ mode: "classic", reason: "flag" });
    expect(chooseDashboard({ CAMPFIRE_TUI: "classic" }, { opentui: true })).toEqual({ mode: "opentui", explicit: true });
  });
  it("rejects --classic with --opentui", () => {
    expect(() => chooseDashboard({}, { classic: true, opentui: true })).toThrow(ValidationError);
  });
  it("reports an unsupported platform at preflight so the default path can fall back", () => {
    expect(() => spawnOpentui({
      baseUrl: "http://127.0.0.1:1", token: "t", workspaceId: "w", awaitingWorkspace: false, actorId: "a", actorType: "human",
      parentEnv: {}, platform: "linux", arch: "x64", linuxLibc: "unsupported", spawnImpl: () => { throw new Error("must not spawn"); },
    })).toThrow(OpentuiUnavailableError);
    expect(OPENTUI_FALLBACK_NOTE).toBe("OpenTUI unavailable on this platform; using the classic dashboard.");
  });
});
