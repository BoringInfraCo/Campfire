import type { InstallChannel } from "./types.js";

export function acceptAnswer(answer: string | undefined): boolean {
  if (answer === undefined) return false;
  const trimmed = answer.trim();
  return trimmed === "y" || trimmed === "Y" || trimmed === "yes" || trimmed === "YES";
}

export function renderConfirm(input: {
  installed: string;
  target: string;
  channel: InstallChannel;
  notesUrl?: string;
  instruction?: string;
  ask?: boolean;
}): string {
  const lines = [
    `Installed: ${input.installed}`,
    `Target: ${input.target}`,
    `Channel: ${input.channel}`,
  ];
  if (input.notesUrl !== undefined) lines.push(`Notes: ${input.notesUrl}`);
  if (input.channel === "direct") {
    lines.push(
      "Effect: replaces the Campfire program. Your profile, workspace, and credentials stay. A service this process owns restarts only after the new version passes its health check.",
    );
    if (input.ask === true) lines.push(`Install ${input.target}? [y/N]`);
  } else if (input.channel === "brew" || input.channel === "nix") {
    const manager = input.channel === "brew" ? "Homebrew" : "Nix";
    lines.push(`Effect: Campfire will not change a ${manager} prefix.`);
    if (input.instruction !== undefined) lines.push(input.instruction);
  } else {
    lines.push("Effect: no files will change.");
    if (input.instruction !== undefined) lines.push(input.instruction);
  }
  return lines.join("\n");
}
