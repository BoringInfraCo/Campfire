/**
 * In-process serve + view.
 *
 * `campfire up` owns both listeners for this CLI session. It does not install
 * a machine daemon. Tokens stay in this process; the Viewer browser never
 * receives one.
 */
import { spawn } from "node:child_process";
import { DEFAULT_HTTP_HOST, DEFAULT_HTTP_PORT, startCampfireHttpServer } from "../http/server.js";
import { DEFAULT_VIEWER_HOST, DEFAULT_VIEWER_PORT, startCampfireViewer } from "../viewer/server.js";
import type { CampfireRuntime } from "../runtime.js";
import type { ActorContext } from "../service/authorization.js";
import { dispatchCampfireMethod } from "../http/dispatch.js";

export interface RunningLocalWorkspace {
  apiUrl: string;
  viewerUrl: string;
  close(): Promise<void>;
}

export async function startLocalWorkspace(options: {
  runtime: CampfireRuntime;
  human: ActorContext;
  httpHost?: string;
  httpPort?: number;
  viewerHost?: string;
  viewerPort?: number;
}): Promise<RunningLocalWorkspace> {
  const http = await startCampfireHttpServer({
    runtime: options.runtime,
    host: options.httpHost ?? DEFAULT_HTTP_HOST,
    port: options.httpPort ?? DEFAULT_HTTP_PORT,
  });
  try {
    const viewer = await startCampfireViewer({
      call: (method, params) =>
        Promise.resolve(dispatchCampfireMethod(options.runtime.service, options.human, method, params ?? {})),
      host: options.viewerHost ?? DEFAULT_VIEWER_HOST,
      port: options.viewerPort ?? DEFAULT_VIEWER_PORT,
    });
    let closed = false;
    return {
      apiUrl: http.url,
      viewerUrl: viewer.url,
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        await viewer.close();
        await http.close();
      },
    };
  } catch (error) {
    await http.close();
    throw error;
  }
}

export function shouldOpenBrowser(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CAMPFIRE_NO_BROWSER === "1" || env.CI === "true" || env.CI === "1") return false;
  return process.stdout.isTTY === true;
}

export function openLoopbackUrl(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.unref();
}
