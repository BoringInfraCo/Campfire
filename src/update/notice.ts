export function noticeLine(version: string): string {
  return `Campfire ${version} is available. Run /update to review it.`;
}

export function shouldAnnounce(input: {
  stdoutIsTTY: boolean;
  command?: string;
  outputMode: "human" | "json";
  noninteractive: boolean;
  ci: boolean;
}): boolean {
  if (!input.stdoutIsTTY) return false;
  if (input.command === "mcp") return false;
  if (input.outputMode === "json") return false;
  if (input.noninteractive) return false;
  if (input.ci) return false;
  return true;
}
