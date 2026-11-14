import { describe, expect, it } from "vitest";
import { recordDetailLines } from "../../tui/src/details.js";

describe("OpenTUI canonical record details", () => {
  it("shows recorded task assignee and does not claim in-progress means running", () => {
    const lines = recordDetailLines({id:"task_a", title:"Fix service", status:"in_progress", assignee:{actorId:"agent_a",actorType:"agent"}, createdBy:{actorId:"human_a",actorType:"human"}}, "task");
    expect(lines).toContain("assignee: agent_a (agent)");
    expect(lines).toContain("createdBy: human_a (human)");
    expect(lines.join(" ")).toContain("not a claim an agent is running");
  });

  it("shows decision transitions, citations, and a review caveat", () => {
    const lines = recordDetailLines({id:"d1", status:"accepted", needsReview:true, needsReviewFindingIds:["f1"], predecessorId:"d0", successorId:"d2", citations:[{id:"c1",findingId:"f1",note:"private note"}]}, "decision");
    expect(lines).toContain("needs review — acceptance is unchanged");
    expect(lines).toContain("non-current findings: f1");
    expect(lines).toContain("predecessor: d0");
    expect(lines).toContain("successor: d2");
    expect(lines).toContain("citation: c1 · finding f1");
    expect(lines.join(" ")).not.toContain("private note");
  });

  it("shows finding evidence while excluding unknown payloads and transcripts", () => {
    const lines = recordDetailLines({id:"f1", summary:"A finding", evidence:[{id:"e1",artifactId:"a1",relation:"contradicts",note:"secret"}], transcript:"private transcript"}, "finding");
    expect(lines).toContain("evidence: e1 · artifact a1 · contradicts");
    expect(lines.join(" ")).not.toMatch(/private transcript|secret/);
  });

  it("classifies artifact references without exposing a path, token or unsafe controls", () => {
    const lines = recordDetailLines({id:"a1", uriOrPath:"https://example.com/path?token=secret",type:"url"}, "artifact");
    const text = lines.join(" ");
    expect(text).toContain("stored reference, not fetched");
    expect(text).toContain("external and unverified by Campfire");
    expect(text).toContain("does not open, fetch, or verify");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("/path");
    const hostile = recordDetailLines({id:"a2", uriOrPath:"https://example.com/\u001b[31m"}, "artifact").join(" ");
    expect(hostile).toContain("unsafe — control characters; rendered inert");
    expect(hostile).not.toContain("\u001b");
  });

  it("bounds relation lists and reports truncation", () => {
    const lines = recordDetailLines({id:"d",citations:Array.from({length:51},(_,i)=>({id:`c${i}`,findingId:`f${i}`}))},"decision");
    expect(lines.filter(line=>line.startsWith("citation: "))).toHaveLength(50);
    expect(lines).toContain("citations: 1 more not shown.");
  });

  it("shows finding detail and discloses when a long field is truncated", () => {
    const lines = recordDetailLines({id:"f1", detail:"a".repeat(4097)}, "finding");
    const detail = lines.find((line) => line.startsWith("detail: "));
    expect(detail).toBe(`detail: ${"a".repeat(4096)}… [truncated]`);
    expect(recordDetailLines({id:"f2", detail:"recorded detail"}, "finding")).toContain("detail: recorded detail");
  });
});
