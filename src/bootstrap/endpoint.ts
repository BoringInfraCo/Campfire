import { ValidationError } from "../domain/errors.js";

/** Credentials bind to an origin AND its API base path. Never echo rejected input. */
export function canonicalEndpoint(value: string, options: { allowLoopbackHttp?: boolean } = {}): string {
  const invalid = (): never => {
    throw new ValidationError("Endpoint must be an unambiguous HTTPS API address", { field: "endpoint" });
  };
  if (typeof value !== "string" || value.length > 2048 || value.trim() !== value || /[\\\s]/.test(value)) invalid();
  // Reject path spellings that URL would silently normalize into another scope.
  if (/%(?:2f|5c|2e|25)/i.test(value) || /\/(?:\.|\.\.)(?:\/|$)/.test(value)) invalid();
  let url: URL;
  try { url = new URL(value); } catch { return invalid(); }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const loopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  if (url.protocol !== "https:" && !(options.allowLoopbackHttp && url.protocol === "http:" && loopback)) invalid();
  if (url.username || url.password || url.search || url.hash || /[?#]/.test(value) || !url.hostname || /\/{2}/.test(url.pathname)) invalid();
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}
