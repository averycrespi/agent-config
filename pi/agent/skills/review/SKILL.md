---
name: review
description: Use when reviewing a pull request, branch, commit range, working tree diff, plan, document, or other coherent unit of work across correctness, security, codebase alignment, code quality, test quality, and performance.
---

# Review

## Overview

Perform six parallel specialized reviews of a coherent target, then synthesize findings with confidence scoring and severity tiers. Each review dimension runs as an independent `review` subagent through `spawn_agents`; results are merged, deduplicated, and presented as one structured report.

Use this skill for review requests targeting a GitHub PR, local branch, commit range, current working tree, plan file, design document, or clearly described unit of work. Preserve the same fundamental approach regardless of target: gather enough context, dispatch independent reviewers, filter low-confidence findings, deduplicate, and report actionable issues plus review gaps.

## Input Parsing

Infer the review target from the user's request and local context when possible. Ask one focused clarification question only when the target remains ambiguous after inspection.

Supported target modes:

### Mode 1: GitHub PR URL

Matches pattern: `https://github.com/<owner>/<repo>/pull/<number>`

1. Extract `<owner>`, `<repo>`, and `<number>` from the URL.
2. Use MCP broker GitHub tools for remote PR data. Prefer direct `mcp_call` when the tools are listed in the system prompt; otherwise use `mcp_search` / `mcp_describe` first.
3. Fetch PR context:
   - `github.gh_view_pr` for title, body, and metadata
   - `github.gh_diff_pr` for file summary and unified diff; request a large `max_bytes` value when needed, up to the tool limit
   - `github.gh_list_pr_files` for changed files and add/delete counts
   - `github.gh_list_pr_comments` for conversation comments
   - `github.gh_list_pr_reviews` for review summaries
   - `github.gh_list_pr_review_comments` for inline review comments
4. If MCP broker returns a configuration or authentication error, report that remote PR review requires broker access and stop.
5. If the diff is truncated, continue with available context but mark truncation as a review gap in the final report.
6. Do not use the `gh` CLI for PR URL mode.

### Mode 2: Local Branch Name

Use when the input looks like a branch or ref and is not a PR URL.

1. Determine the default branch with local git:
   ```bash
   git symbolic-ref --short refs/remotes/origin/HEAD
   ```
   Fall back to `origin/main`, then `main`, if the command fails.
2. Fetch the diff with merge-base semantics:
   ```bash
   git diff <default-branch>...<branch>
   ```
3. Fetch changed file names:
   ```bash
   git diff --name-only <default-branch>...<branch>
   ```
4. No PR metadata is available in this mode unless the user provides it.

### Mode 3: Commit Range or Ref Expression

Use when the input contains a commit range or explicit git refs, such as `abc123..def456`, `main...HEAD`, or `HEAD~3`.

1. Resolve the refs locally with git where possible.
2. Fetch the diff and changed file names with the user's range semantics unless obviously invalid.
3. If the expression is invalid or ambiguous, ask one focused clarification question.

### Mode 4: Current Working Tree

Use when the user asks to review local changes, unstaged changes, staged changes, the current branch without naming it, or provides no target while the working tree has changes.

1. Inspect `git status --short`.
2. Gather staged and unstaged diffs:
   ```bash
   git diff --cached
   git diff
   ```
3. Include untracked file contents when they appear relevant and are safe to read.
4. If there are no local changes and no other target is inferable, ask what to review.

### Mode 5: Plan or Document

Use when the target is a plan file, design doc, ticket, markdown document, or other non-code artifact.

1. Read the target document and any linked local files needed to understand it.
2. Gather relevant repository context and guidance, but do not invent a code diff.
3. Frame reviewer prompts around risks in the proposed work, missing requirements, security implications, test strategy, performance implications, and alignment with codebase conventions.
4. Record the absence of an implementation diff as a review gap when judging code-level correctness.

### Mode 6: Described Unit of Work

Use when the user describes work to review without a concrete PR, branch, range, diff, or file.

1. Inspect local context for likely artifacts: current branch, dirty tree, `.plans/`, recent commits, and mentioned files.
2. If a single target is strongly implied, review it and state the assumption.
3. If multiple plausible targets remain, ask one focused clarification question.

## Gather Context

After obtaining target material:

1. Parse changed files from the PR file list, `git diff --name-only`, diff headers (`+++ b/` and `--- a/`), or document references.
2. Read full local file contents for changed files when the workspace appears to be a checkout of the reviewed code. If a file is missing or local content may not match the reviewed target, rely on the diff and record the limitation.
3. Read relevant project guidance files when present, especially `AGENTS.md`, `CLAUDE.md`, and nearby repository docs that define review or code conventions.
4. In PR URL mode, include PR title, description, conversation comments, review summaries, and inline review comments.
5. For plans or documents, include the artifact text, nearby referenced files, acceptance criteria, and explicit assumptions.
6. Assemble a context package for reviewers with:
   - review target and input mode
   - target metadata if available
   - prior comments/reviews if available
   - changed file list or referenced artifacts
   - unified diff when available
   - relevant full-file context where available
   - project guidance files
   - explicit gaps such as truncated diff, missing file context, unavailable PR comments, no implementation diff, or ambiguous target assumptions

## Dispatch Reviewers

Read each prompt file from `references/` at dispatch time, then launch all six reviewers in one `spawn_agents` call. Use the `review` agent type for every reviewer. Each agent prompt is the relevant prompt file content plus the full context package.

| #   | Reviewer           | Prompt File                                 | Intent example       |
| --- | ------------------ | ------------------------------------------- | -------------------- |
| 1   | Bug Hunter         | `references/bug-hunter-prompt.md`           | `bug hunt`           |
| 2   | Security Reviewer  | `references/security-reviewer-prompt.md`    | `security review`    |
| 3   | Codebase Alignment | `references/codebase-alignment-prompt.md`   | `codebase alignment` |
| 4   | Code Quality       | `references/code-quality-prompt.md`         | `code quality`       |
| 5   | Test Quality       | `references/test-quality-prompt.md`         | `test quality`       |
| 6   | Performance        | `references/performance-reviewer-prompt.md` | `performance review` |

Each reviewer MUST return findings in this exact format when findings exist:

```text
FINDINGS:
- <file>:<line> | <severity> | <confidence> | <description>
```

If no findings meet the confidence threshold, the reviewer MUST return exactly:

```text
NO_FINDINGS
```

Where `<severity>` is one of: `blocker`, `important`, `suggestion`.
Where `<confidence>` is an integer from 0 to 100.

## Synthesize

After all six agents return:

1. Parse each response for `FINDINGS:` or `NO_FINDINGS`.
2. Treat malformed reviewer output conservatively: parse any usable finding lines, count the malformed response as a review gap, and do not invent missing findings.
3. Filter out any finding with confidence below 80.
4. Deduplicate findings that point to the same file and line range within 3 lines or describe the same root cause. Merge duplicates by keeping the highest severity and confidence, then note all contributing reviewers.
5. Group by severity: Blockers > Important > Suggestions.
6. Determine verdict:
   - **Ready to Merge** — 0 blockers, 0 important, and an implementation-oriented target was reviewed
   - **Looks Sound** — 0 blockers, 0 important, and a non-merge target such as a plan or document was reviewed
   - **Needs Attention** — 0 blockers, 1+ important
   - **Needs Work** — 1+ blockers
7. Surface review gaps such as truncated diff, missing file context, unavailable PR comments, no implementation diff, ambiguous target assumptions, or malformed reviewer output.

## Output Format

Present results using this template. Omit empty severity sections.

```markdown
## Review: <target title, branch, range, file, or description>

**Verdict: <verdict>** (<N> blockers, <N> important, <N> suggestions)

---

### Blockers

**[<Category>] <Title>** (confidence: <N>)
`<file>:<line>` — <Reviewer(s)>
<Description>

### Important

**[<Category>] <Title>** (confidence: <N>)
`<file>:<line>` — <Reviewer(s)>
<Description>

### Suggestions

**[<Category>] <Title>** (confidence: <N>)
`<file>:<line>` — <Reviewer(s)>
<Description>

---

<N> agents reviewed <N> files/artifacts. <N> raw findings → <N> surfaced (80+ confidence).

Review gaps: <none or concise list>
```

## Pi Notes

- `review` subagents inherit the active Pi model unless the agent definition overrides it.
- Remote PR review depends on the `mcp-broker` extension and authenticated GitHub broker tools.
- Large PR diffs may be truncated by `github.gh_diff_pr`; use changed-file summaries, available full-file context, and review-gap reporting rather than pretending the review is complete.
- `spawn_agents` reviewers start with fresh context and read-only tools, so brief them with all relevant context and constraints.
