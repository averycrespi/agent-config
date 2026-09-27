import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { MailboxStore, address } from "./store.ts";

/** Cooperative exclusive consumer; crashed ownership is fail-closed for manual
 * reconciliation, like writer locks. Normal shutdown releases without deleting inboxes. */
export function claimConsumer(store: MailboxStore, session: string) {
  address(session);
  store.ensureRoot();
  const path = join(store.root, `${session}.consumer`);
  mkdirSync(path, { mode: 0o700 });
  const token = randomUUID();
  const owner = join(path, "owner.json");
  writeFileSync(owner, JSON.stringify({ pid: process.pid, token }), {
    flag: "wx",
    mode: 0o600,
  });
  let released = false;
  return () => {
    if (released) return;
    try {
      const data = JSON.parse(readFileSync(owner, "utf8"));
      if (data.token !== token) throw new Error("consumer ownership changed");
      unlinkSync(owner);
      rmdirSync(path);
      released = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      released = true;
    }
  };
}
