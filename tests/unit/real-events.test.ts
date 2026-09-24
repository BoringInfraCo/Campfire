import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCodexEvents } from "../../src/acceptance/real/codex-events.js";
import { analyzeErgonomics } from "../../src/acceptance/real/ergonomics.js";
import { parseOpencodeEvents } from "../../src/acceptance/real/opencode-events.js";
import { canonicalToolName } from "../../src/acceptance/real/tools.js";
import type { McpCall } from "../../src/acceptance/real/types.js";

function readFixture(name: string): string {
  const path = fileURLToPath(new URL(`../fixtures/harness/${name}`, import.meta.url));
  return readFileSync(path, "utf8");
}

describe("canonicalToolName", () => {
  it("maps short, dotted, and harness-prefixed names to campfire.<tool>", () => {
    expect(canonicalToolName("list_workspaces")).toBe("campfire.list_workspaces");
    expect(canonicalToolName("campfire.list_workspaces")).toBe("campfire.list_workspaces");
    expect(canonicalToolName("campfire_list_workspaces")).toBe("campfire.list_workspaces");
    expect(canonicalToolName("campfire_campfire_list_workspaces")).toBe("campfire.list_workspaces");
    expect(canonicalToolName("mcp__campfire__list_workspaces")).toBe("campfire.list_workspaces");
  });
});

describe("parseOpencodeEvents", () => {
  const result = parseOpencodeEvents(readFixture("opencode-sample.jsonl"));

  it("canonicalizes a Campfire MCP tool call", () => {
    expect(result.mcpCalls).toHaveLength(1);
    expect(result.mcpCalls[0]?.rawTool).toBe("campfire_campfire_list_workspaces");
    expect(result.mcpCalls[0]?.tool).toBe("campfire.list_workspaces");
  });

  it("keeps non-Campfire tool calls separate", () => {
    expect(result.nonMcpToolCalls).toHaveLength(1);
    expect(result.nonMcpToolCalls[0]?.tool).toBe("Read");
  });

  it("uses the last text part as the final message", () => {
    expect(result.finalMessage).toBe(
      "Migration 284 holds a database lock longer than the deployment timeout.",
    );
  });

  it("sums token and cost usage across step_finish parts", () => {
    expect(result.usage?.inputTokens).toBe(1300);
    expect(result.usage?.outputTokens).toBe(400);
    expect(result.usage?.totalTokens).toBe(2000);
    expect(result.usage?.costUsd).toBeCloseTo(0.0016, 6);
  });

  it("captures the first harness session id", () => {
    expect(result.harnessSessionId).toBe("ses_opencode_sample_001");
  });
});

describe("parseCodexEvents", () => {
  const result = parseCodexEvents(readFixture("codex-sample.jsonl"));

  it("permissively extracts an MCP tool call", () => {
    expect(result.mcpCalls).toHaveLength(1);
    expect(result.mcpCalls[0]?.tool).toBe("campfire.list_workspaces");
    expect(result.mcpCalls[0]?.output).toContain("ws_billing");
  });

  it("extracts the last assistant message", () => {
    expect(result.finalMessage).toBe(
      "I will continue the billing deploy investigation from Campfire.",
    );
  });

  it("records the thread id and usage", () => {
    expect(result.harnessSessionId).toBe("thread_codex_sample_001");
    expect(result.usage?.inputTokens).toBe(800);
    expect(result.usage?.outputTokens).toBe(200);
    expect(result.usage?.totalTokens).toBe(1000);
  });

  it("captures errors from turn.failed", () => {
    expect(result.error).toBe("transient stream failure");
  });

  it("records unknown items as events without throwing", () => {
    expect(result.events.some((event) => event.type === "item.completed")).toBe(true);
  });
});

describe("analyzeErgonomics", () => {
  const calls: McpCall[] = [
    { rawTool: "campfire.get_workspace", tool: "campfire.get_workspace", output: "find_001" },
    { rawTool: "campfire.get_workspace", tool: "campfire.get_workspace", output: "find_001" },
    { rawTool: "campfire.get_workspace_context", tool: "campfire.get_workspace_context", output: "find_001" },
    { rawTool: "campfire.add_finding", tool: "campfire.add_finding" },
    { rawTool: "campfire.get_activity", tool: "campfire.get_activity" },
  ];
  const metrics = analyzeErgonomics(calls);

  it("preserves the canonical call sequence", () => {
    expect(metrics.sequence).toEqual([
      "campfire.get_workspace",
      "campfire.get_workspace",
      "campfire.get_workspace_context",
      "campfire.add_finding",
      "campfire.get_activity",
    ]);
    expect(metrics.firstCampfireCall).toBe("campfire.get_workspace");
    expect(metrics.totalCampfireCalls).toBe(5);
  });

  it("splits reads and writes", () => {
    expect(metrics.readCalls).toBe(4);
    expect(metrics.writeCalls).toBe(1);
  });

  it("counts reads performed before the first write", () => {
    expect(metrics.orientationToolCalls).toBe(3);
  });

  it("detects redundant reads by tool and normalized input", () => {
    expect(metrics.redundantReads).toBe(1);
    expect(metrics.redundantReadTools).toEqual(["campfire.get_workspace"]);
  });

  it("reports missing-context and duplicate-projection signals", () => {
    expect(metrics.missingContextSignals.length).toBeGreaterThan(0);
    expect(metrics.contextNoiseSignals.length).toBeGreaterThan(0);
  });
});

describe("garbage input", () => {
  const inputs = ["", "not json", "{}\n"];

  it("opencode parser never throws", () => {
    for (const input of inputs) {
      expect(() => parseOpencodeEvents(input)).not.toThrow();
    }
    expect(parseOpencodeEvents("").mcpCalls).toEqual([]);
    expect(parseOpencodeEvents("not json").finalMessage).toBe("");
  });

  it("codex parser never throws", () => {
    for (const input of inputs) {
      expect(() => parseCodexEvents(input)).not.toThrow();
    }
    expect(parseCodexEvents("").mcpCalls).toEqual([]);
    expect(parseCodexEvents("not json").finalMessage).toBe("");
  });
});
