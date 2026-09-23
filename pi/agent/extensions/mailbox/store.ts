import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const ADDRESS = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MAX_BYTES = 4 * 1024 * 1024;
export interface Message {
  id: string;
  at: number;
  type: string;
  message: string;
}
interface Row extends Message {
  seq: number;
}
interface State {
  version: 1;
  epoch: string;
  sequence: number;
  rows: Row[];
}
export class MailboxError extends Error {
  constructor(
    public code:
      | "invalid_input"
      | "storage_failed"
      | "publication_unknown"
      | "mailbox_full",
    public outcomeUnknown = false,
  ) {
    super(code);
  }
}
export function address(value: unknown): asserts value is string {
  if (typeof value !== "string" || !ADDRESS.test(value))
    throw new MailboxError("invalid_input");
}
function payload(type: unknown, message: unknown) {
  if (
    typeof type !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(type) ||
    typeof message !== "string" ||
    !message.trim() ||
    Buffer.byteLength(message) > 8192 ||
    Buffer.byteLength(JSON.stringify({ type, message })) > 8500
  )
    throw new MailboxError("invalid_input");
}
function safe(path: string, directory: boolean) {
  const s = lstatSync(path);
  if (
    s.isSymbolicLink() ||
    (directory ? !s.isDirectory() : !s.isFile()) ||
    (process.getuid && s.uid !== process.getuid()) ||
    s.mode & 0o077
  )
    throw new MailboxError("storage_failed");
  if (!directory && s.size > MAX_BYTES)
    throw new MailboxError("storage_failed");
}
function absent(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
function syncDirectory(path: string) {
  const fd = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export const _durability = { syncDirectory };
function publicMessage({ id, at, type, message }: Row): Message {
  return { id, at, type, message };
}

/** Cooperative same-user storage, not an authorization boundary. No timers or replay. */
export class MailboxStore {
  constructor(readonly root: string) {}
  ensureRoot() {
    try {
      mkdirSync(this.root, { mode: 0o700 });
      _durability.syncDirectory(dirname(this.root));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST")
        throw new MailboxError("storage_failed");
    }
    safe(this.root, true);
  }
  private read(mailbox: string): State | undefined {
    try {
      safe(this.root, true);
      const path = join(this.root, `${mailbox}.json`);
      safe(path, false);
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let state: State;
      try {
        state = JSON.parse(readFileSync(fd, "utf8"));
      } finally {
        closeSync(fd);
      }
      if (
        state.version !== 1 ||
        !UUID.test(state.epoch) ||
        !Number.isSafeInteger(state.sequence) ||
        state.sequence < 0 ||
        !Array.isArray(state.rows) ||
        state.rows.length > 1000
      )
        throw new Error();
      let prior = 0;
      const ids = new Set<string>();
      for (const row of state.rows) {
        payload(row.type, row.message);
        if (
          !UUID.test(row.id) ||
          ids.has(row.id) ||
          !Number.isSafeInteger(row.at) ||
          row.at < 0 ||
          !Number.isSafeInteger(row.seq) ||
          row.seq <= prior ||
          row.seq > state.sequence
        )
          throw new Error();
        ids.add(row.id);
        prior = row.seq;
      }
      return state;
    } catch (e) {
      if (absent(e)) return undefined;
      throw new MailboxError("storage_failed");
    }
  }
  private mutate<T>(
    mailbox: string,
    change: (state: State) => { value: T; changed: boolean },
  ): T {
    this.ensureRoot();
    const lock = join(this.root, `${mailbox}.lock`);
    try {
      mkdirSync(lock, { mode: 0o700 });
    } catch {
      throw new MailboxError("storage_failed");
    }
    const temp = join(this.root, `${mailbox}.${randomUUID()}.tmp`);
    let renamed = false;
    try {
      writeFileSync(
        join(lock, "owner.json"),
        JSON.stringify({ pid: process.pid, at: Date.now() }),
        { mode: 0o600, flag: "wx" },
      );
      const state = this.read(mailbox) ?? {
        version: 1,
        epoch: randomUUID(),
        sequence: 0,
        rows: [],
      };
      const result = change(state);
      if (!result.changed) return result.value;
      const bytes = JSON.stringify(state);
      if (Buffer.byteLength(bytes) > MAX_BYTES || state.rows.length > 1000)
        throw new MailboxError("mailbox_full");
      const fd = openSync(temp, "wx", 0o600);
      try {
        writeFileSync(fd, bytes);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temp, join(this.root, `${mailbox}.json`));
      renamed = true;
      _durability.syncDirectory(this.root);
      return result.value;
    } catch (e) {
      if (renamed) throw new MailboxError("publication_unknown", true);
      if (e instanceof MailboxError) throw e;
      throw new MailboxError("storage_failed");
    } finally {
      // Cleanup failure must not turn a committed publication into an apparent rejection.
      try {
        unlinkSync(temp);
      } catch {
        /* absent or retained staging; never retry publication */
      }
      try {
        unlinkSync(join(lock, "owner.json"));
        rmdirSync(lock);
      } catch {
        throw new MailboxError(
          renamed ? "publication_unknown" : "storage_failed",
          renamed,
        );
      }
    }
  }
  send(mailbox: string, type: string, message: string): Message {
    address(mailbox);
    payload(type, message);
    return this.mutate(mailbox, (s) => {
      if (s.sequence >= Number.MAX_SAFE_INTEGER)
        throw new MailboxError("mailbox_full");
      const row = {
        id: randomUUID(),
        at: Date.now(),
        type,
        message,
        seq: ++s.sequence,
      };
      s.rows.push(row);
      return { value: publicMessage(row), changed: true };
    });
  }
  list(mailbox: string, limit = 20, cursor?: string) {
    address(mailbox);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (cursor !== undefined &&
        (typeof cursor !== "string" || cursor.length > 256))
    )
      throw new MailboxError("invalid_input");
    let page: { epoch: string; after: number; through: number } | undefined;
    if (cursor !== undefined) {
      try {
        page = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        if (
          !page ||
          !UUID.test(page.epoch) ||
          !Number.isSafeInteger(page.after) ||
          !Number.isSafeInteger(page.through) ||
          page.after < 0 ||
          page.after > page.through
        )
          throw new Error();
      } catch {
        throw new MailboxError("invalid_input");
      }
    }
    const state = this.read(mailbox);
    if (
      page &&
      (!state || state.epoch !== page.epoch || page.through > state.sequence)
    )
      throw new MailboxError("invalid_input");
    const through = page?.through ?? state?.sequence ?? 0;
    const candidates = (state?.rows ?? []).filter(
      (r) => r.seq > (page?.after ?? 0) && r.seq <= through,
    );
    const rows: Row[] = [];
    let bytes = 0;
    for (const row of candidates) {
      const size = Buffer.byteLength(JSON.stringify(publicMessage(row)));
      if (rows.length >= limit || bytes + size > 16000) break;
      rows.push(row);
      bytes += size;
    }
    const nextCursor =
      rows.length < candidates.length
        ? Buffer.from(
            JSON.stringify({
              epoch: state!.epoch,
              after: rows.at(-1)!.seq,
              through,
            }),
          ).toString("base64url")
        : null;
    return {
      mailbox,
      messages: rows.map(publicMessage),
      nextCursor,
      pending: state?.rows.length ?? 0,
      oldestAt: state?.rows[0]?.at ?? null,
    };
  }
  ack(mailbox: string, ids: string[]) {
    address(mailbox);
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 100 ||
      ids.some((id) => typeof id !== "string" || !UUID.test(id)) ||
      new Set(ids).size !== ids.length
    )
      throw new MailboxError("invalid_input");
    return this.mutate(mailbox, (s) => {
      const before = s.rows.length;
      s.rows = s.rows.filter((r) => !ids.includes(r.id));
      return {
        value: { mailbox, acknowledged: before - s.rows.length },
        changed: before !== s.rows.length,
      };
    });
  }
}
