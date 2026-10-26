import type { InstallLayout } from "./types.js";

const DIRECT_MARKER = "/lib/campfire/dist/src/cli/index.js";

export function classifyInstallChannel(input: { modulePath: string }): InstallLayout {
  const modulePath = input.modulePath.replaceAll("\\", "/");
  if (modulePath.includes("/nix/store")) {
    return { channel: "nix", managed: true, instruction: "nix profile upgrade campfire" };
  }
  if (modulePath.includes("/Cellar/") || modulePath.includes("/Homebrew/") || modulePath.includes("/homebrew/")) {
    return { channel: "brew", managed: true, instruction: "brew upgrade campfire" };
  }
  const at = modulePath.lastIndexOf(DIRECT_MARKER);
  if (at > 0) {
    const prefix = modulePath.slice(0, at);
    return {
      channel: "direct",
      managed: false,
      prefix,
      binPath: `${prefix}/bin/campfire`,
      libDir: `${prefix}/lib/campfire`,
    };
  }
  return {
    channel: "unknown",
    managed: false,
    instruction:
      "This Campfire install is a source checkout or an unrecognized install. Install a release with: curl -fsSL https://boringinfra.company/campfire/install.sh | sh",
  };
}
