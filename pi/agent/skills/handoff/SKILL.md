---
name: handoff
description: Use when explicitly asked to compact the current Pi session into a local handoff document that a fresh agent can use to continue the work.
license: See LICENSE
disable-model-invocation: true
---

# Handoff

Create a concise handoff document that lets a fresh agent continue the current session without replaying the full conversation. Keep this skill explicit-only; invoke it with `/skill:handoff` and optionally append the next session's intended focus.

## Gather current state

Use the conversation and existing artifacts as the primary sources of truth. Inspect only the additional state needed for an accurate handoff:

- Read the durable goal with `goal_get` when one may exist.
- List session tasks with `todo` when task state is relevant. Treat task status as context, not proof of completion.
- In a Git workspace, inspect the branch and working tree with a focused local command such as `git status --short --branch`.
- Record verification commands and outcomes already observed. Do not rerun expensive checks solely for the handoff.

If the invocation includes a next-session focus, make that focus the handoff's objective and prioritize the context needed for it. Otherwise infer the immediate continuation from the session.

## Write the handoff

Create a unique Markdown file under `.handoffs/` at the active Git repository root. When outside a Git repository, use the current working directory instead. In a Git repository, first add the root-anchored `/.handoffs/` pattern to the repository's local Git exclude file if it is absent. Resolve that file through Git so this also works in linked worktrees; do not add the pattern to the tracked `.gitignore`. Obtain the handoff path with:

```bash
if repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  exclude_path="$(git rev-parse --path-format=absolute --git-path info/exclude)" &&
    mkdir -p "$(dirname "$exclude_path")" &&
    touch "$exclude_path" &&
    { grep -qxF '/.handoffs/' "$exclude_path" ||
      printf '\n/.handoffs/\n' >> "$exclude_path"; }
else
  repo_root="$(pwd -P)"
fi &&
  mkdir -p "$repo_root/.handoffs" &&
  handoff_path="$(mktemp "$repo_root/.handoffs/pi-handoff-XXXXXX.md")" &&
  { [ -z "${exclude_path:-}" ] || git check-ignore -q "$handoff_path"; } &&
  printf '%s\n' "$handoff_path"
```

Outside a Git repository, skip the exclude update and continue creating the handoff. If an applicable exclude file cannot be updated or a handoff created inside a Git repository is not ignored, stop and report the failure. Write the document to the returned absolute path with the `write` tool. Do not interpolate handoff content into a shell command, and do not stage or commit the handoff.

Use this structure, omitting empty sections:

```markdown
# Session Handoff

## Next-session objective

## Current status

## Decisions and constraints

## Existing artifacts and evidence

## Workspace state

## Next actions

## Risks, blockers, and open questions

## Suggested skills
```

Apply these rules:

- Prefer a compact, operational summary over a conversation transcript.
- Distinguish completed, in-progress, blocked, and unverified work precisely.
- Reference existing plans, specs, ADRs, tickets, commits, diffs, and logs by repo-relative path or URL instead of duplicating their contents. Add a short note explaining why each reference matters.
- Include exact commands only when they are useful for continuation or verification.
- Suggest only skills that are available in the current session and materially useful for the next actions. Use their exact skill names and state why to invoke each one. Write `None` when no skill applies.
- Use repo-relative paths for workspace files. Avoid absolute local paths inside the document unless continuation truly depends on one.
- Redact credentials, tokens, secrets, private URLs, personal information, and sensitive command output. Never inspect likely secret files merely to summarize them. Preserve only a safe placeholder and the operational consequence when redaction affects continuation.
- Do not claim that work or verification succeeded without concrete session evidence.

## Finish

Read the completed document once to check that it is self-contained, concise, correctly redacted, and aligned with the requested next-session focus. Report the file's absolute path and a one-sentence summary. Note that `.handoffs/` is transient local context and must not be committed; inside a Git repository, confirm that it was added to the local exclude file.
