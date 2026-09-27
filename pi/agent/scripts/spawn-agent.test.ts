import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { savedFixture } from "../extensions/script/saved-fixture.ts";
import { registerScriptProvider } from "../extensions/script/api.ts";

const base = "a".repeat(40);
const session = "00000000-0000-4000-8000-000000000001";
const input = {
  repo: "/repo",
  branch: "avery/example",
  path: "/work/example",
  name: "example",
  label: "Example",
  base,
};
const transcript = `/sessions/2026-09-27T00-00-00-000Z_${session}.jsonl`;
const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

async function setup(t: TestContext, mode = "success") {
  const h = await savedFixture(t);
  await h.config({ allowedProviders: ["builtins"] });
  await copyFile(
    resolve(import.meta.dirname, "spawn-agent.js"),
    join(h.store, "spawn-agent.js"),
  );
  const calls: string[] = [];
  let created = false;
  let gets = 0;
  const dispose = registerScriptProvider(h.pi, {
    namespace: "builtins",
    available: () => true,
    methods: {
      bash: {
        description: "Fixture shell",
        inputSchema: {
          type: "array",
          items: [
            {
              type: "object",
              properties: {
                command: { type: "string" },
                timeout: { type: "number" },
              },
              required: ["command", "timeout"],
              additionalProperties: false,
            },
          ],
          minItems: 1,
          maxItems: 1,
          additionalItems: false,
        },
        handler: async (args) => {
          const { command: c } = args[0] as { command: string };
          calls.push(c);
          let value: unknown;
          const has = (s: string) => c.includes(quote(s));
          if (has("node")) {
            value = c.includes("HERDR_ENV")
              ? {
                  herdr: mode === "no-herdr" ? "0" : "1",
                  repo: input.repo,
                  path: input.path,
                  exists: created,
                }
              : mode === "missing"
                ? { missing: true }
                : {
                    header: {
                      type: "session",
                      id: mode === "bad-header" ? "wrong" : session,
                      cwd: input.path,
                    },
                  };
          } else if (has("git")) {
            if (has("--show-toplevel")) value = input.repo;
            else if (has("--verify") || has("HEAD")) value = base;
            else if (has("check-ref-format") || has("for-each-ref")) value = "";
            else if (has("--show-current"))
              value = mode === "bad-checkout" ? "wrong" : input.branch;
            else if (has("--git-common-dir")) value = "/repo/.git";
            else throw Error(`Unexpected Git: ${c}`);
          } else if (has("herdr")) {
            if (has("worktree") && has("list"))
              value = {
                source: { repo_root: input.repo },
                worktrees: [
                  { path: input.repo },
                  ...(created
                    ? [
                        {
                          path: input.path,
                          branch: input.branch,
                          open_workspace_id: "w2",
                        },
                      ]
                    : []),
                ],
              };
            else if (has("workspace") && has("list"))
              value = {
                workspaces: [
                  {
                    workspace_id: "w1",
                    focused: !(created && mode === "focus"),
                  },
                  ...(created
                    ? [{ workspace_id: "w2", focused: mode === "focus" }]
                    : []),
                ],
              };
            else if (has("agent") && has("list"))
              value = {
                agents: mode === "collision" ? [{ name: input.name }] : [],
              };
            else if (has("create")) {
              assert.ok(has("--no-focus") && has("--base") && has(base));
              created = true;
              if (mode === "create-unknown")
                throw Error("transport lost after effect");
              value = { workspace: { workspace_id: "w2" } };
            } else if (has("pane") && has("list"))
              value = {
                panes: [
                  {
                    workspace_id: "w2",
                    pane_id: "w2:p1",
                    terminal_id: "term2",
                    cwd: input.path,
                  },
                ],
              };
            else if (has("start")) {
              assert.equal(
                c,
                [
                  "herdr",
                  "agent",
                  "start",
                  "example",
                  "--kind",
                  "pi",
                  "--pane",
                  "w2:p1",
                  "--timeout",
                  "30000",
                ]
                  .map(quote)
                  .join(" "),
              );
              if (mode === "start-unknown")
                throw Error("start outcome unknown");
              value = {};
            } else if (has("get")) {
              gets++;
              value = {
                agent: {
                  agent: "pi",
                  name: input.name,
                  pane_id: "w2:p1",
                  workspace_id: "w2",
                  terminal_id: "term2",
                  cwd: input.path,
                  agent_status: mode === "blocked" ? "blocked" : "idle",
                  agent_session: {
                    agent: "pi",
                    kind: "path",
                    value:
                      mode === "replaced" && gets > 1
                        ? transcript.replace(
                            session,
                            "00000000-0000-4000-8000-000000000002",
                          )
                        : transcript,
                  },
                },
              };
            } else throw Error(`Unexpected Herdr: ${c}`);
            value = { result: { type: "fixture", ...(value as object) } };
          } else throw Error(`Unexpected command: ${c}`);
          return {
            value: {
              content: [
                {
                  type: "text",
                  text:
                    typeof value === "string" ? value : JSON.stringify(value),
                },
              ],
            },
          };
        },
      },
    },
  });
  t.after(dispose);
  const run = async (args = input) => {
    const r = await h.call({
      action: "run",
      name: "spawn-agent",
      providers: ["builtins"],
      args,
    });
    // The generic tool frames JSON in a separate untrusted content block.
    const text = r.content
      .map((b: { text?: string }) => b.text ?? "")
      .join("\n");
    const match = text.match(
      /\{"status":"(?:launched|prelaunch-failed|partial|uncertain|not-ready)"[^\n]*/,
    );
    assert.ok(match, text);
    const end = match[0].lastIndexOf("}");
    return { result: JSON.parse(match[0].slice(0, end + 1)), receipt: r };
  };
  return { ...h, run, calls };
}

test("actual saved spawn launches ordinary Pi at exact base without task or cleanup; duplicate fails closed", async (t) => {
  const h = await setup(t);
  const { result: r } = await h.run();
  assert.equal(r.status, "launched");
  assert.equal(r.session, session);
  assert.equal(r.identity, "persisted-header");
  assert.equal(r.focus_preserved, true);
  assert.equal(r.task_submitted, false);
  assert.equal(r.mailbox_ready, "unverified");
  assert.equal(r.workspace, "w2");
  assert.equal(r.base, base);
  const again = await h.run();
  assert.equal(again.result.status, "prelaunch-failed");
  assert.equal(h.calls.filter((c) => c.includes("'create'")).length, 1);
  assert.equal(h.calls.filter((c) => c.includes("'start'")).length, 1);
  assert.ok(
    h.calls.every(
      (c) => !/'prompt'|'send-text'|'close'|'remove'|'--extension'/.test(c),
    ),
  );
});

for (const [mode, status, identity] of [
  ["missing", "launched", "provisional-path"],
  ["no-herdr", "prelaunch-failed", "unresolved"],
  ["collision", "prelaunch-failed", "unresolved"],
  ["bad-checkout", "partial", "unresolved"],
  ["create-unknown", "uncertain", "unresolved"],
  ["start-unknown", "uncertain", "unresolved"],
  ["bad-header", "partial", "unresolved"],
  ["replaced", "partial", "unresolved"],
  ["blocked", "not-ready", "persisted-header"],
  ["focus", "partial", "persisted-header"],
]) {
  test(`actual saved spawn reports ${mode} without replay`, async (t) => {
    const h = await setup(t, mode);
    const { result: r, receipt } = await h.run();
    assert.equal(r.status, status);
    assert.equal(r.identity, identity);
    assert.equal(r.task_submitted, false);
    assert.ok(h.calls.filter((c) => c.includes("'create'")).length <= 1);
    assert.ok(h.calls.filter((c) => c.includes("'start'")).length <= 1);
    if (mode.includes("unknown"))
      assert.equal(receipt.details.status, "failed");
    if (status === "prelaunch-failed")
      assert.ok(h.calls.every((c) => !c.includes("'create'")));
  });
}

test("saved spawn rejects tasks and invalid args before providers; default base resolves committed HEAD", async (t) => {
  const h = await setup(t);
  await assert.rejects(
    h.call({
      action: "run",
      name: "spawn-agent",
      providers: ["builtins"],
      args: { ...input, task: "injected" },
    }),
    /invalid_arguments/,
  );
  assert.equal(h.calls.length, 0);
  const { base: _base, ...withoutBase } = input;
  const r = await h.run(withoutBase as typeof input);
  assert.equal(r.result.base, base);
  assert.ok(h.calls.some((c) => c.includes("'HEAD^{commit}'")));
});
