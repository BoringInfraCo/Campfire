/**
 * Small terminal presentation helpers.
 *
 * No extra dependency. Color is off when stdout is not a TTY or NO_COLOR is set.
 */
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";

export function colorEnabled(stream: { isTTY?: boolean } = process.stdout): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return false;
  return stream.isTTY === true;
}

function wrap(code: string, text: string, enabled: boolean): string {
  return enabled ? `${code}${text}${RESET}` : text;
}

export function bold(text: string, enabled = colorEnabled()): string {
  return wrap(BOLD, text, enabled);
}

export function dim(text: string, enabled = colorEnabled()): string {
  return wrap(DIM, text, enabled);
}

export function ok(text: string, enabled = colorEnabled()): string {
  return `${wrap(GREEN, "✓", enabled)}  ${text}`;
}

export function wordmark(enabled = colorEnabled()): string {
  return [
    "",
    `  ${bold("campfire", enabled)}`,
    `  ${dim("the shared workspace for people and their agents", enabled)}`,
    "",
  ].join("\n");
}

export function isInteractiveTty(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}
