import type { InstallChannel } from "./types.js";

export type RestartAction = "not-applicable" | "restart-owned" | "restart-required" | "already-running" | "not-running";

export function restartPlan(input: {
  channel: InstallChannel;
  replaced: boolean;
  ownsLifecycle: boolean;
  profileMode: "local" | "remote" | "none";
  listener: "none" | "other-version" | "same-version";
  version?: string;
  instruction?: string;
}): { action: RestartAction; lines: string[] } {
  const remote = input.profileMode === "remote" ? " The hosted Worker is not restarted." : "";
  if (!input.replaced || input.channel !== "direct") {
    const lines = ["No Campfire files were changed."];
    if (input.instruction !== undefined) lines.push(input.instruction);
    if (input.profileMode === "remote") lines.push("The hosted Worker is not restarted.");
    return { action: "not-applicable", lines };
  }
  if (input.ownsLifecycle) {
    const version = input.version ?? "the new version";
    return {
      action: "restart-owned",
      lines: [
        `The local API/Viewer will restart. Campfire ${version} is shown only after its health check.${remote}`,
      ],
    };
  }
  if (input.listener === "other-version") {
    return {
      action: "restart-required",
      lines: [`restart required`, `campfire up`, `The running service stays on its current process until that command reports the new version.${remote}`],
    };
  }
  if (input.listener === "same-version") {
    return { action: "already-running", lines: [`Campfire ${input.version ?? "the installed version"} is running.`] };
  }
  return {
    action: "not-running",
    lines: [
      `Installed Campfire ${input.version ?? "the new version"}.`,
      "No running Campfire service was restarted.",
    ],
  };
}

export async function pollHealth(
  fetchHealth: () => Promise<string | undefined>,
  expectedVersion: string,
  attempts: number,
  delayMs = 0,
): Promise<boolean> {
  const total = Math.max(0, attempts);
  for (let attempt = 0; attempt < total; attempt += 1) {
    try {
      const version = await fetchHealth();
      if (version === expectedVersion) return true;
    } catch {
      // A closed port or a refused connection is not a healthy new version.
    }
    if (delayMs > 0 && attempt + 1 < total) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return false;
}
