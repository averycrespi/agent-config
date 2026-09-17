import { randomUUID } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  opendirSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { createConnection, createServer, type Socket } from "node:net";
import {
  filters,
  record,
  uuid,
  validNotice,
  type EventName,
  type Notice,
} from "./session-events.ts";

import { MAX_DURATION_MS } from "./config.ts";

export const MAX_TIMEOUT = MAX_DURATION_MS;
const HANDSHAKE_MS = 2000;
export interface Target {
  incarnation: string;
  sessionId: string;
}
const safeError = () =>
  new Error(
    "Session transport unavailable, unsafe, or interrupted; no continuous coverage.",
  );
export const finiteTimeout = (n: unknown): n is number =>
  Number.isInteger(n) && (n as number) >= 1000 && (n as number) <= MAX_TIMEOUT;

export function checkRoot(root: string, create = false) {
  if (create) {
    try {
      mkdirSync(root, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw safeError();
    }
  }
  const s = lstatSync(root);
  if (
    !s.isDirectory() ||
    s.isSymbolicLink() ||
    s.uid !== process.getuid?.() ||
    (s.mode & 0o777) !== 0o700 ||
    realpathSync(root) !== root
  )
    throw safeError();
}
function socketPath(root: string, target: string) {
  if (!uuid(target)) throw safeError();
  checkRoot(root);
  const path = join(root, `${target}.sock`);
  const s = lstatSync(path);
  if (
    !s.isSocket() ||
    s.uid !== process.getuid?.() ||
    (s.mode & 0o777) !== 0o600
  )
    throw safeError();
  return path;
}
function send(socket: Socket, value: unknown, end = false) {
  const text = JSON.stringify(value) + "\n";
  if (end) socket.end(text);
  else if (!socket.write(text)) socket.destroy();
}
/** Fixed frame/connection bounds; malformed peers are disconnected, never logged. */
function receive(
  socket: Socket,
  consume: (data: Record<string, unknown>) => void,
) {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 8192) {
      socket.destroy();
      return;
    }
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        consume(record(JSON.parse(line)));
      } catch {
        socket.destroy();
        return;
      }
      if (socket.destroyed) return;
    }
  });
}

export class Bridge {
  readonly target: Target;
  private sequence = 0;
  private sockets = new Set<Socket>();
  private watches = new Map<Socket, { nonce: string; events: EventName[] }>();
  private server = createServer((socket) => this.accept(socket));
  private closed = false;
  constructor(
    readonly root: string,
    sessionId: string,
  ) {
    if (!uuid(sessionId)) throw safeError();
    this.target = { incarnation: randomUUID(), sessionId };
    this.server.maxConnections = 16;
    this.server.on("error", () => this.close());
  }
  async start() {
    checkRoot(this.root, true);
    const path = join(this.root, `${this.target.incarnation}.sock`);
    if (Buffer.byteLength(path) > 100) throw safeError();
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(path, () => {
        this.server.removeListener("error", reject);
        resolve();
      });
    });
    if (this.closed) throw safeError();
    chmodSync(path, 0o600);
    this.server.unref();
  }
  private accept(socket: Socket) {
    if (this.closed || this.sockets.size >= 16) {
      socket.destroy();
      return;
    }
    this.sockets.add(socket);
    socket.unref();
    let expiry = setTimeout(() => socket.destroy(), HANDSHAKE_MS);
    expiry.unref();
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      clearTimeout(expiry);
      this.sockets.delete(socket);
      this.watches.delete(socket);
    });
    let admitted = false;
    receive(socket, (data) => {
      if (
        admitted ||
        data.target !== this.target.incarnation ||
        !uuid(data.nonce)
      ) {
        socket.destroy();
        return;
      }
      if (data.op === "info" && Object.keys(data).length === 3) {
        admitted = true;
        send(socket, { ...this.target, nonce: data.nonce }, true);
      } else if (
        data.op === "subscribe" &&
        Object.keys(data).length === 5 &&
        filters(data.events) &&
        finiteTimeout(data.timeoutMs)
      ) {
        admitted = true;
        // Registration boundary is this synchronous insertion, before the ACK.
        this.watches.set(socket, {
          nonce: data.nonce,
          events: data.events,
        });
        clearTimeout(expiry);
        expiry = setTimeout(
          () => socket.destroy(),
          data.timeoutMs + HANDSHAKE_MS,
        );
        expiry.unref();
        send(socket, {
          ...this.target,
          nonce: data.nonce,
          startedAt: Date.now(),
          sequence: this.sequence,
        });
      } else socket.destroy();
    });
  }
  publish(name: EventName, metadata: Record<string, string>) {
    if (this.closed) return;
    const event: Notice = {
      name,
      metadata,
      sequence: ++this.sequence,
      at: Date.now(),
    };
    if (!validNotice(event)) return;
    for (const [socket, watch] of this.watches) {
      if (!watch.events.includes(name)) continue;
      send(socket, {
        target: this.target.incarnation,
        nonce: watch.nonce,
        event,
      });
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.watches.clear();
    this.server.close(); // Node removes only this server's socket path.
  }
}

function connect(root: string, target: string, signal?: AbortSignal) {
  const socket = createConnection(socketPath(root, target));
  socket.unref();
  const abort = () => socket.destroy();
  signal?.addEventListener("abort", abort, { once: true });
  socket.once("close", () => signal?.removeEventListener("abort", abort));
  socket.on("error", () => socket.destroy());
  if (signal?.aborted) socket.destroy();
  return socket;
}

export interface EventSubscription {
  target: Target;
  startedAt: number;
  close(): void;
}

/** Continuous ordered coverage; no reconnect or replay. Callbacks are installed before ACK. */
export async function subscribeEvents(
  root: string,
  target: string,
  events: EventName[],
  timeoutMs: number,
  onEvent: (event: Notice) => void,
  onLoss: () => void,
  signal?: AbortSignal,
): Promise<EventSubscription> {
  if (!filters(events) || !finiteTimeout(timeoutMs)) throw safeError();
  const socket = connect(root, target, signal);
  const nonce = randomUUID();
  let baseline: number | undefined;
  let startedAt = 0;
  let closed = false;
  const close = () => {
    closed = true;
    socket.destroy();
  };
  try {
    const identity = await new Promise<Target>((resolve, reject) => {
      const timer = setTimeout(
        () => socket.destroy(),
        Math.min(HANDSHAKE_MS, timeoutMs),
      );
      timer.unref();
      socket.once("close", () => {
        clearTimeout(timer);
        reject(safeError());
        if (!closed && baseline !== undefined) {
          closed = true;
          try {
            onLoss();
          } catch {
            /* observational */
          }
        }
      });
      receive(socket, (data) => {
        if (closed) return;
        if (baseline === undefined) {
          if (
            data.incarnation !== target ||
            data.nonce !== nonce ||
            !uuid(data.sessionId) ||
            !Number.isSafeInteger(data.startedAt) ||
            (data.startedAt as number) < 0 ||
            !Number.isSafeInteger(data.sequence) ||
            (data.sequence as number) < 0 ||
            Object.keys(data).length !== 5
          ) {
            socket.destroy();
            return;
          }
          baseline = data.sequence as number;
          startedAt = data.startedAt as number;
          clearTimeout(timer);
          resolve({ incarnation: target, sessionId: data.sessionId });
        } else {
          if (
            data.target !== target ||
            data.nonce !== nonce ||
            !validNotice(data.event) ||
            !events.includes(data.event.name) ||
            data.event.sequence <= baseline ||
            data.event.at < startedAt ||
            Object.keys(data).length !== 3
          ) {
            socket.destroy();
            return;
          }
          baseline = data.event.sequence;
          onEvent(data.event);
        }
      });
      socket.once("connect", () =>
        send(socket, { op: "subscribe", target, nonce, events, timeoutMs }),
      );
    });
    if (closed || socket.destroyed || signal?.aborted) throw safeError();
    return { target: identity, startedAt, close };
  } catch {
    close();
    throw safeError();
  }
}

/** Bounded live probing, no historical session/transcript scan or stale-file deletion. */
export async function discover(root: string): Promise<Target[]> {
  checkRoot(root);
  const dir = opendirSync(root);
  const ids: string[] = [];
  try {
    for (let i = 0; ; i++) {
      const item = dir.readSync();
      if (!item) break;
      if (i >= 128) throw safeError();
      const id = item.name.replace(/\.sock$/, "");
      if (item.isSocket() && uuid(id)) ids.push(id);
    }
  } finally {
    dir.closeSync();
  }
  const targets: Target[] = [];
  // At most four probes in flight; all settle before returning.
  for (let i = 0; i < ids.length; i += 4) {
    const batch = await Promise.all(
      ids.slice(i, i + 4).map(async (target) => {
        try {
          const socket = connect(root, target);
          const nonce = randomUUID();
          return await new Promise<Target | undefined>((resolve) => {
            const expiry = setTimeout(() => socket.destroy(), HANDSHAKE_MS);
            expiry.unref();
            socket.once("close", () => {
              clearTimeout(expiry);
              resolve(undefined);
            });
            receive(socket, (data) => {
              if (
                data.incarnation === target &&
                data.nonce === nonce &&
                uuid(data.sessionId) &&
                Object.keys(data).length === 3
              )
                resolve({ incarnation: target, sessionId: data.sessionId });
              socket.destroy();
            });
            socket.once("connect", () =>
              send(socket, { op: "info", target, nonce }),
            );
          });
        } catch {
          return undefined;
        }
      }),
    );
    targets.push(...batch.filter((x): x is Target => !!x));
  }
  return targets;
}
