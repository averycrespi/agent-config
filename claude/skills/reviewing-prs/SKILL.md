---
name: reviewing-prs
description: Use when reviewing a pull request or branch holistically across multiple dimensions (correctness, security, codebase alignment, code quality, test quality, performance). Accepts a PR URL or branch name as argument.
---

# Reviewing PRs

## Overview

Announce: "I'm using the reviewing-prs skill to perform a holistic review."

This skill performs 6 parallel specialized reviews of a pull request or branch, then synthesizes findings with confidence scoring and severity tiers. Each review dimension runs as an independent subagent, and results are merged, deduplicated, and presented as a single structured report.

## Input Parsing

The user MUST provide either a PR URL or a branch name as argument.

### Mode 1: PR URL

Matches pattern: `https://github.com/.*/pull/[0-9]+`

1. Extract `<owner>`, `<repo>`, and `<number>` from the URL
2. Fetch PR metadata and changed files with `mcp__mcp-broker__github_pull_request_read`, requesting the diff or file list plus `title`, `body`, `comments`, and `reviews` when available.
3. If review comments are not included, fetch them with the available broker-backed GitHub pull request comments tool.

### Mode 2: Branch Name

Any input that does not match the PR URL pattern.

1. Determine the default branch:
   ```
   git rev-parse --abbrev-ref origin/HEAD
   ```
   Fall back to `main` if the command fails.
2. Fetch the diff:
   ```
   git diff <default-branch>...<branch>
   ```
3. No PR metadata is available in this mode.

## Gather Context

After obtaining the diff:

1. Parse the diff to identify changed files (lines starting with `+++ b/` or `--- a/`)
2. Read the full contents of each changed file using the Read tool
3. Read the project's CLAUDE.md if it exists
4. If in PR URL mode, include the PR title, description, and review comments
5. Assemble everything into a single context block for the reviewers

## Dispatch Reviewers

Launch 6 Task subagents in parallel — all 6 in a SINGLE message with 6 Task tool calls. Use `Task tool (general-purpose)` with `model: haiku` for each.

Read each prompt file from the skill directory at dispatch time. Each agent's prompt is the prompt file content with the full context package appended.

| #   | Reviewer           | Prompt File                      |
| --- | ------------------ | -------------------------------- |
| 1   | Bug Hunter         | `bug-hunter-prompt.md`           |
| 2   | Security Reviewer  | `security-reviewer-prompt.md`    |
| 3   | Codebase Alignment | `codebase-alignment-prompt.md`   |
| 4   | Code Quality       | `code-quality-prompt.md`         |
| 5   | Test Quality       | `test-quality-prompt.md`         |
| 6   | Performance        | `performance-reviewer-prompt.md` |

Each agent MUST return findings in this format:

```
FINDINGS:
- <file>:<line> | <severity> | <confidence> | <description>
NO_FINDINGS (if nothing to report)
```

Where `<severity>` is one of: `blocker`, `important`, `suggestion`
Where `<confidence>` is an integer from 0 to 100.

## Synthesize

After all 6 agents return:

1. **Parse** each agent's response for `FINDINGS:` or `NO_FINDINGS`
2. **Filter** — drop any finding with confidence below 80
3. **Deduplicate** — if multiple agents flag the same file:line range (within 3 lines), merge them keeping the highest severity and noting all contributing agents
4. **Group by severity** — Blockers > Important > Suggestions
5. **Determine verdict:**
   - **Ready to Merge** — 0 blockers, 0 important
   - **Needs Attention** — 0 blockers, 1+ important
   - **Needs Work** — 1+ blockers

## Output Format

Present results using this template. Omit empty severity sections.

```
## PR Review: <PR title or branch name>

**Verdict: <verdict>** (<N> blockers, <N> important, <N> suggestions)

---

### Blockers

**[<Category>] <Title>** (confidence: <N>)
`<file>:<line>` — <Agent(s)>
<Description>

### Important

**[<Category>] <Title>** (confidence: <N>)
`<file>:<line>` — <Agent(s)>
<Description>

### Suggestions

**[<Category>] <Title>** (confidence: <N>)
`<file>:<line>` — <Agent(s)>
<Description>

---

<N> agents reviewed <N> files. <N> raw findings → <N> surfaced (80+ confidence).
```
