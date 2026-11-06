/**
 * Authenticated local control socket.
 *
 * Stop never signals a pid from the registry. The wrapper accepts a stop only
 * when the launch id and supervisor marker match the process that bound the
 * socket. The marker is not a Campfire credential and is not sent to Core.
 */
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { chmodSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { ValidationError } from "../domain/errors.js";

interface ControlMessage {
  op?: string;
  launchId?: string;
  marker?: string;
}

export interface ControlServer {
  path: string;
  close(): Promise<void>;
}

export async function startControlServer(input: {
  directory: string;
  launchId: string;
  marker: string;
  onStop: () => void;
}): Promise<ControlServer> {
  mkdirSync(input.directory, { recursive: true, mode: 0o700 });
  chmodSync(input.directory, 0o700);
  const directory = lstatSync(input.directory);
  if (directory.isSymbolicLink() || !directory.isDirectory() || (directory.mode & 0o077) !== 0) {
    throw new ValidationError("Session control directory is not private.", { field: "control" });
  }
  const path = join(input.directory, `${input.launchId}.sock`);
  try {
    const existing = lstatSync(path);
    if (existing.isSymbolicLink()) {
      throw new ValidationError("Session control socket is a symlink. Refusing to follow it.", { field: "control" });
    }
    if (existing.isSocket() || existing.isFile()) unlinkSync(path);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ValidationError("Session control socket could not be prepared.", { field: "control" });
    }
  }
  const server = createServer((socket) => handleConnection(socket, input.launchId, input.marker, input.onStop));
  // macOS chmod(2) on a bound socket path returns ENOENT. Create it 0600
  // through the process umask, then confirm the mode.
  const previousUmask = process.umask(0o177);
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error): void => {
        server.off("listening", ready);
        reject(error);
      };
      const ready = (): void => {
        server.off("error", fail);
        resolve();
      };
      server.once("error", fail);
      server.once("listening", ready);
      server.listen(path);
    });
  } finally {
    process.umask(previousUmask);
  }
  try {
    chmodSync(path, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const bound = lstatSync(path);
  if (bound.isSymbolicLink() || !bound.isSocket() || (bound.mode & 0o077) !== 0) {
    throw new ValidationError("Session control socket is not private.", { field: "control" });
  }
  return {
    path,
    close: () => closeServer(server, path),
  };
}

function handleConnection(socket: Socket, launchId: string, marker: string, onStop: () => void): void {
  let buffer = "";
  let settled = false;
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    if (settled) return;
    buffer += chunk;
    if (buffer.length > 4096) {
      settled = true;
      socket.end('{"ok":false,"error":"unauthorized"}\n');
      return;
    }
    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    settled = true;
    let message: ControlMessage;
    try {
      message = JSON.parse(buffer.slice(0, newline)) as ControlMessage;
    } catch {
      socket.end('{"ok":false,"error":"unauthorized"}\n');
      return;
    }
    if (message.launchId !== launchId || message.marker !== marker || typeof message.marker !== "string") {
      socket.end('{"ok":false,"error":"unauthorized"}\n');
      return;
    }
    if (message.op === "identify") {
      socket.end(`${JSON.stringify({ ok: true, pid: process.pid })}\n`);
      return;
    }
    if (message.op === "stop") {
      socket.end('{"ok":true}\n');
      onStop();
      return;
    }
    socket.end('{"ok":false,"error":"unauthorized"}\n');
  });
}

function closeServer(server: Server, path: string): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      try {
        const stat = lstatSync(path);
        if (!stat.isSymbolicLink()) unlinkSync(path);
      } catch {
        // The socket is already gone.
      }
      resolve();
    });
  });
}

export interface ControlResponse {
  ok: boolean;
  error?: string;
  pid?: number;
}

export function sendControl(path: string, message: { op: "stop" | "identify"; launchId: string; marker: string }, timeoutMs = 1_000): Promise<ControlResponse> {
  return new Promise((resolve, reject) => {
    let socket: ReturnType<typeof createConnection>;
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || !stat.isSocket()) {
        reject(new ValidationError("Session control socket failed the identity check.", { field: "control" }));
        return;
      }
      socket = createConnection(path);
    } catch (error) {
      reject(error);
      return;
    }
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => finish(new Error("control timeout")), timeoutMs);
    const finish = (error?: Error, value?: ControlResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error !== undefined) reject(error);
      else resolve(value ?? { ok: false });
    };
    socket.on("error", (error) => finish(error));
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(message)}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        finish(undefined, JSON.parse(buffer.slice(0, newline)) as ControlResponse);
      } catch {
        finish(new Error("control response"));
      }
    });
  });
}
