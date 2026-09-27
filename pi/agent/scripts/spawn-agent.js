export const meta = {
  name: "spawn-agent",
  description:
    "Launch ordinary Pi in a new unfocused Herdr worktree; send its task separately through Mailbox.",
  args: {
    type: "object",
    properties: {
      repo: { type: "string", minLength: 1, maxLength: 1024 },
      branch: { type: "string", pattern: "^avery/", maxLength: 200 },
      path: { type: "string", minLength: 1, maxLength: 1024 },
      name: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,31}$" },
      label: { type: "string", minLength: 1, maxLength: 100 },
      base: { type: "string", pattern: "^[a-f0-9]{40}$" },
    },
    required: ["repo", "branch", "path", "name", "label"],
    additionalProperties: false,
  },
  providers: ["builtins"],
  limits: { maxCalls: 32, maxConcurrency: 1, timeoutMs: 120000 },
};

export async function run() {
  const q = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
  const check = (ok, reason) => {
    if (!ok) throw new Error(reason);
  };
  const result = {
    status: "prelaunch-failed",
    stage: "preflight",
    branch: args.branch,
    worktree: args.path,
    name: args.name,
    base: args.base ?? null,
    workspace: null,
    pane: null,
    terminal: null,
    session: null,
    transcript: null,
    identity: "unresolved",
    interactive_ready: false,
    mailbox_ready: "unverified",
    task_submitted: false,
    focus_preserved: null,
    effects: "none",
    next: "Diagnose preflight before another attempt",
  };
  const command = async (words, timeout = 10) => {
    const r = await builtins.bash({ command: words.map(q).join(" "), timeout });
    check(
      !r.isError && !r.details?.truncated && !r.details?.fullOutputPath,
      "command failed or truncated",
    );
    check(
      Array.isArray(r.content) && r.content.every((b) => b.type === "text"),
      "invalid command output",
    );
    return r.content
      .map((b) => b.text)
      .join("")
      .trim();
  };
  const git = (cwd, ...words) => command(["git", "-C", cwd, ...words]);
  const herdr = async (...words) => {
    const r = JSON.parse(
      await command(["herdr", ...words], words[1] === "start" ? 35 : 10),
    );
    check(
      !r.error && r.result && typeof r.result.type === "string",
      "invalid Herdr response",
    );
    return r.result;
  };
  try {
    check(
      Object.values(args).every((s) => !/[\u0000-\u001f\u007f]/.test(s)),
      "control character in input",
    );
    const paths = JSON.parse(
      await command([
        "node",
        "--input-type=module",
        "-e",
        'import {realpathSync,lstatSync} from "node:fs"; import {resolve} from "node:path"; const [repo,path]=process.argv.slice(1); let exists=true; try {lstatSync(path)} catch(e) {if(e.code!=="ENOENT") throw e; exists=false} console.log(JSON.stringify({herdr:process.env.HERDR_ENV,repo:realpathSync(repo),path:resolve(path),exists}));',
        args.repo,
        args.path,
      ]),
    );
    check(paths.herdr === "1", "Herdr environment required");
    check(
      paths.repo === args.repo &&
        paths.path === args.path &&
        args.path.startsWith("/") &&
        !paths.exists,
      "noncanonical or occupied path",
    );
    check(
      (await git(args.repo, "rev-parse", "--show-toplevel")) === args.repo,
      "repository root required",
    );
    result.base = await git(
      args.repo,
      "rev-parse",
      "--verify",
      `${args.base ?? "HEAD"}^{commit}`,
    );
    check(
      /^[a-f0-9]{40}$/.test(result.base) &&
        (!args.base || result.base === args.base),
      "base mismatch",
    );
    await git(args.repo, "check-ref-format", "--branch", args.branch);
    const refs = (
      await git(
        args.repo,
        "for-each-ref",
        "--format=%(refname)",
        "refs/heads",
        "refs/remotes",
      )
    ).split("\n");
    check(
      !refs.some(
        (r) =>
          r === `refs/heads/${args.branch}` ||
          (r.startsWith("refs/remotes/") && r.endsWith(`/${args.branch}`)),
      ),
      "branch collision; inspect existing launch",
    );
    const inventory = await herdr("worktree", "list", "--cwd", args.repo);
    check(
      typeof inventory.source?.repo_root === "string" &&
        Array.isArray(inventory.worktrees) &&
        inventory.worktrees.some((w) => w.path === args.repo),
      "invalid worktree inventory",
    );
    check(
      !inventory.worktrees.some(
        (w) => w.path === args.path || w.branch === args.branch,
      ),
      "worktree collision; inspect existing launch",
    );
    const spaces = (await herdr("workspace", "list")).workspaces;
    const agents = (await herdr("agent", "list")).agents;
    check(
      Array.isArray(spaces) &&
        spaces.filter((s) => s.focused).length === 1 &&
        Array.isArray(agents),
      "invalid live inventory",
    );
    check(
      !agents.some((a) => a.name === args.name),
      "agent name collision; inspect existing launch",
    );
    const focus = spaces.find((s) => s.focused).workspace_id;
    result.stage = "create";
    result.effects = "unknown";
    result.next =
      "Inspect retained resources and original Script receipt; never replay or clean up automatically";
    const created = await herdr(
      "worktree",
      "create",
      "--cwd",
      inventory.source.repo_root,
      "--branch",
      args.branch,
      "--base",
      result.base,
      "--path",
      args.path,
      "--label",
      args.label,
      "--no-focus",
    );
    result.workspace = created.workspace?.workspace_id ?? null;
    check(
      typeof result.workspace === "string" &&
        !spaces.some((s) => s.workspace_id === result.workspace),
      "invalid created workspace",
    );
    result.effects = "retained";
    result.stage = "verify-checkout";
    const panes = (await herdr("pane", "list", "--workspace", result.workspace))
      .panes;
    check(
      Array.isArray(panes) &&
        panes.length === 1 &&
        panes[0].workspace_id === result.workspace &&
        panes[0].cwd === args.path &&
        !panes[0].agent &&
        typeof panes[0].pane_id === "string" &&
        typeof panes[0].terminal_id === "string",
      "invalid created shell pane",
    );
    result.pane = panes[0].pane_id;
    result.terminal = panes[0].terminal_id;
    check(
      (await git(args.path, "rev-parse", "HEAD")) === result.base &&
        (await git(args.path, "branch", "--show-current")) === args.branch,
      "created checkout mismatch",
    );
    const common = await git(
      args.repo,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    );
    check(
      (await git(
        args.path,
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      )) === common,
      "created repository mismatch",
    );
    const verified = await herdr(
      "worktree",
      "list",
      "--cwd",
      inventory.source.repo_root,
    );
    check(
      Array.isArray(verified.worktrees) &&
        verified.worktrees.some(
          (w) =>
            w.path === args.path &&
            w.branch === args.branch &&
            w.open_workspace_id === result.workspace,
        ),
      "worktree workspace association mismatch",
    );
    result.stage = "start";
    result.effects = "unknown";
    await herdr(
      "agent",
      "start",
      args.name,
      "--kind",
      "pi",
      "--pane",
      result.pane,
      "--timeout",
      "30000",
    );
    result.effects = "retained";
    result.stage = "identity";
    const occupant = async () => {
      const a = (await herdr("agent", "get", args.name)).agent;
      check(
        a?.agent === "pi" &&
          a.name === args.name &&
          a.pane_id === result.pane &&
          a.workspace_id === result.workspace &&
          a.terminal_id === result.terminal &&
          a.cwd === args.path &&
          a.agent_session?.agent === "pi" &&
          a.agent_session.kind === "path",
        "worker occupant mismatch",
      );
      return a;
    };
    const a = await occupant();
    result.transcript = a.agent_session.value;
    check(
      typeof result.transcript === "string" &&
        result.transcript.startsWith("/") &&
        !/[\u0000-\u001f\u007f]/.test(result.transcript),
      "invalid session path",
    );
    const uuid =
      /\/\d{4}-\d{2}-\d{2}T[^/]+_([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.jsonl$/.exec(
        result.transcript,
      )?.[1];
    check(uuid, "unrecognized session reference");
    const header = JSON.parse(
      await command([
        "node",
        "--input-type=module",
        "-e",
        'import {openSync,readSync,closeSync,lstatSync} from "node:fs"; const p=process.argv[1]; let out={missing:true}; try {const s=lstatSync(p); if(!s.isFile()||s.isSymbolicLink()) throw Error("unsafe session"); const fd=openSync(p,"r"); try {const b=Buffer.alloc(16384); const n=readSync(fd,b,0,b.length,0); const line=b.subarray(0,n).toString().split("\\n")[0]; out={header:JSON.parse(line)};} finally {closeSync(fd)}} catch(e){if(e.code!=="ENOENT") throw e} console.log(JSON.stringify(out));',
        result.transcript,
      ]),
    );
    const again = await occupant();
    check(
      again.agent_session.value === result.transcript,
      "session changed during discovery",
    );
    if (header.missing !== true)
      check(
        header.header?.type === "session" &&
          header.header.id === uuid &&
          header.header.cwd === args.path,
        "session header mismatch",
      );
    result.session = uuid;
    result.identity =
      header.missing === true ? "provisional-path" : "persisted-header";
    result.interactive_ready = ["idle", "done"].includes(again.agent_status);
    result.stage = "verify-focus";
    const after = (await herdr("workspace", "list")).workspaces;
    check(Array.isArray(after), "invalid final workspace inventory");
    result.focus_preserved =
      after.filter((s) => s.focused).length === 1 &&
      after.find((s) => s.focused)?.workspace_id === focus &&
      after.find((s) => s.workspace_id === result.workspace)?.focused === false;
    check(
      result.focus_preserved,
      "focus changed; do not restore without authority",
    );
    result.status = result.interactive_ready ? "launched" : "not-ready";
    result.stage = "finished";
    result.next = result.interactive_ready
      ? "Send authorized task separately with Mailbox; confirm correlated reply and provisional identity. Readiness is not acceptance."
      : "Inspect existing agent; do not prompt, restart or replay automatically";
  } catch (e) {
    result.status =
      result.effects === "none"
        ? "prelaunch-failed"
        : result.effects === "unknown"
          ? "uncertain"
          : "partial";
    result.reason = String(e.message).slice(0, 160);
  }
  return result;
}
