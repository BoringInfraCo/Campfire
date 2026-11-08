import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  createDashboardState,
  reduceDashboardKey,
  paintDashboardFrame,
  renderDashboard,
  runDashboardSession,
} from "../../src/cli/dashboard.js";

const ABSENT = ["billing", "Codex", "Claude", "Cursor", "OpenCode", "EADDRINUSE", "token", "invoice", "ses_"];

function awaitingState() {
  return createDashboardState({
    workspaceId: "",
    actorId: "hum_test",
    actorType: "human",
    awaitingWorkspace: true,
  });
}

function paneProse(frame: string, columns: number): string {
  const start = columns >= 72 ? 24 + 3 : 0;
  return frame.split("\n").map((line) => line.slice(start)).join(" ").replace(/[ ]{2,}/g, " ");
}

function expectHonest(frame: string, columns: number): void {
  const text = paneProse(frame, columns);
  expect(frame).toContain("CAMPFIRE");
  expect(frame).toContain("NAVIGATE");
  expect(frame).toContain("> Sessions");
  expect(frame).toContain("My work");
  expect(frame).toContain("Team work");
  expect(frame).toContain("Needs you");
  expect(frame).toContain("People & agents");
  expect(frame).toContain("Decisions");
  expect(frame).toContain("Sources");
  expect(frame).toContain("Recent changes");
  expect(frame).toContain("Team sessions");
  expect(frame).toContain("Selected session");
  expect(frame).toContain("No workspace yet");
  expect(frame).toContain("No session selected");
  expect(text).toContain("Describe the work to your agent. It can create the workspace and goal.");
  expect(frame).toContain("q quit");
  expect(text).toContain("Sessions, decisions, and people appear after a workspace exists.");
  expect(text).toContain("Terminal output is not shown here.");
  for (const word of ABSENT) expect(frame).not.toContain(word);
}

describe("awaiting workspace dashboard", () => {
  it("draws an honest empty screen and quits on q", () => {
    const state = awaitingState();
    const frame = renderDashboard(state, 80, 24);
    expectHonest(frame, 80);
    expect(frame.split("\n")).toHaveLength(24);
    expect(frame.split("\n").at(-1)).toBe("? help  q quit");
    expect(frame).not.toContain("no recorded goal");
    expect(reduceDashboardKey(state, "q").quit).toBe(true);
  });

  it.each(["j", "k", "tab", "enter", "p"])("keeps the empty screen after %s", (key) => {
    const state = reduceDashboardKey(awaitingState(), key);
    expect(state.awaitingWorkspace).toBe(true);
    expectHonest(renderDashboard(state, 80, 24), 80);
    expect(renderDashboard(state, 80, 24)).not.toContain("no recorded goal");
  });

  it("keeps the empty screen after opening and submitting a filter", () => {
    const state = reduceDashboardKey(reduceDashboardKey(awaitingState(), "/"), "enter");
    expect(state.awaitingWorkspace).toBe(true);
    expectHonest(renderDashboard(state, 80, 24), 80);
  });

  it("paints the sidebar behind the logo and sections", () => {
    const previous = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
    try {
      const painted = paintDashboardFrame(renderDashboard(awaitingState(), 100, 24), 100);
      expect(painted).toContain("\x1b[48;2;22;24;32m");
      expect(painted).toContain("CAMPFIRE");
      expect(painted).toContain("Team sessions");
      expect(painted).toContain("Selected session");
      expect(painted).not.toContain("Codex");
    } finally {
      if (previous === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = previous;
    }
  });

  it("keeps the logo and sections when the terminal is too narrow for a sidebar", () => {
    const frame = renderDashboard(awaitingState(), 60, 30);
    expectHonest(frame, 60);
    expect(frame.split("\n")).toHaveLength(30);
  });

  it("keeps help honest when no workspace exists", () => {
    const helped = reduceDashboardKey(awaitingState(), "?");
    const frame = renderDashboard(helped, 80, 24);
    expect(frame).toContain("No workspace yet");
    expect(frame).toContain("HELP");
    expect(frame).toContain("q quit");
    expect(frame.split("\n")).toHaveLength(24);
    for (const word of ABSENT) expect(frame).not.toContain(word);
    expect(frame).not.toContain("no recorded goal");
  });

  it("draws once and quits on q without loading a workspace", async () => {
    let loads = 0;
    const stdin = new EventEmitter() as EventEmitter & {
      isTTY: boolean;
      setRawMode: (mode: boolean) => void;
      resume: () => void;
      pause: () => void;
      read: () => null;
    };
    stdin.isTTY = true;
    stdin.setRawMode = () => {};
    stdin.resume = () => {};
    stdin.pause = () => {};
    stdin.read = () => null;

    const stdout = new EventEmitter() as EventEmitter & {
      columns: number;
      rows: number;
      write: (chunk: unknown) => boolean;
    };
    stdout.columns = 80;
    stdout.rows = 24;
    const writes: string[] = [];
    let sent = 0;
    stdout.write = (chunk: unknown) => {
      writes.push(String(chunk));
      if (sent === 0) {
        sent = 1;
        stdin.emit("data", "j");
      } else if (sent === 1) {
        sent = 2;
        stdin.emit("data", "q");
      }
      return true;
    };

    await runDashboardSession({
      workspaceId: "",
      actorId: "hum_test",
      actorType: "human",
      awaitingWorkspace: true,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      load: () => {
        loads += 1;
        throw new Error("load must not be called");
      },
    });

    expect(loads).toBe(0);
    expect(writes.join("")).toContain("No workspace yet");
    expect(writes.join("")).toContain("q quit");
    expect(writes.join("")).not.toContain("no recorded goal");
  }, 5_000);
});
