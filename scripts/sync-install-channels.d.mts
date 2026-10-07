/**
 * Types for scripts/sync-install-channels.mjs.
 *
 * The script is plain ESM JavaScript so it can run under `node` directly in the
 * release pipeline. TypeScript resolves it through NodeNext and would otherwise
 * report TS7016 (implicitly any) for the test that imports it.
 */
export interface ChannelPins {
  version: string;
  digests: Record<string, string>;
}

export interface PinnedChannels {
  formula: string;
  flake: string;
}

export declare const INSTALL_CHANNEL_ARCHIVES: string[];

export declare function hexToSri(hex: string): string;

export declare function applyChannelPins(
  formula: string,
  flake: string,
  pins: ChannelPins,
): PinnedChannels;

export declare function parseChecksumFile(text: string, archive: string): string;