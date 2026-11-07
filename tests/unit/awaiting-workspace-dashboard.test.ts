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

function expectHonest(frame: string): void {
  expect(frame).toContain("CAMPFIRE");
  expect(frame).toContain("No workspace yet");
  expect(frame).toContain("Describe the work to your agent. It can create the workspace and goal.");
  expect(frame).toContain("q quit");
  expect(frame).toContain("Sessions, decisions, and people appear after a workspace exists.");
  expect(frame).toContain("Terminal output is not shown here.");
  for (const word of ABSENT) expect(frame).not.toContain(word);
}

describe("awaiting workspace dashboard", () => {
  it("draws an honest empty screen and quits on q", () => {
    const state = awaitingState();
    const frame = renderDashboard(state, 80, 24);
    expectHonest(frame);
    expect(frame.split("\n")).toHaveLength(24);
    expect(frame.split("\n").at(-1)).toBe("j/k move  h history  ? help  tab  enter  q quit");
    expect(frame).not.toContain("no recorded goal");
    expect(reduceDashboardKey(state, "q").quit).toBe(true);
  });

  it("does not paint a sidebar across the blank rows", () => {
    const previous = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
    try {
      const painted = paintDashboardFrame(renderDashboard(awaitingState(), 100, 24), 100);
      expect(painted).not.toContain("\x1b[48;2;22;24;32m");
      expect(painted).toContain("No workspace yet");
      expect(painted).toContain("Describe the work to your agent. It can create the workspace and goal.");
    } finally {
      if (previous === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = previous;
    }
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
    let sent = false;
    stdout.write = (chunk: unknown) => {
      writes.push(String(chunk));
      if (!sent) {
        sent = true;
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
  }, 5_000);
});
