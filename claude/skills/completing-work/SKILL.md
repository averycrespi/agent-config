---
name: completing-work
description: Use when finishing the structured development workflow after verifying work - cleans up plan files, reflects on learnings, and presents PR options
---

# Completing Work

## Overview

Guide completion of development work by presenting clear options and handling chosen workflow.

**Core principle:** Clean up plan files → Reflect on learnings → Present options → Execute choice.

**Announce at start:** "I'm using the completing-work skill to complete this work."

## The Process

### Step 0: Clean Up Plan Files

**If a plan file path is known from conversation context** (e.g. `.plans/2026-02-20-cco-attach.md`):

1. Strip the `.md` extension to get the stem (e.g. `2026-02-20-cco-attach`)
2. `git rm` the plan file: `.plans/<stem>.md`
3. Also `git rm` the design file if it exists: `.designs/<stem>.md`
4. Commit: `chore: remove completed plan files`

**If no plan file is found in context or `.plans/` doesn't exist:** Skip silently.

### Step 1: Reflect on Learnings

**If you have project-specific learnings from this session, present them for user approval.**

**What to look for:**

- Explicit corrections or guidance from the user during the session
- Findings from spec-reviewer and code-quality-reviewer subagents
- Friction points you figured out (build commands, test setup, file locations, naming conventions)
- Patterns discovered in existing code that weren't documented

**What makes a good reflection:**

- Actionable for future sessions (not one-off fixes)
- Project-specific (not general programming knowledge)
- Concise enough to fit naturally in CLAUDE.md

**What to exclude:**

- User preferences (belong in user's global CLAUDE.md, not project CLAUDE.md)
- Temporary workarounds or environment-specific quirks
- Things already documented in the project

**If you have learnings to propose:**

Use `AskUserQuestion` with `multiSelect: true`:

```
AskUserQuestion(
  questions: [{
    question: "Which learnings should be preserved in CLAUDE.md?",
    header: "Reflections",
    multiSelect: true,
    options: [
      {
        label: "<short label>",
        description: "<learning> → <target section in CLAUDE.md>"
      },
      // ... more options
    ]
  }]
)
```

**Example:**

```
options: [
  { label: "Build prereq", description: "Run `npm run build` before tests → ## Development" },
  { label: "API naming", description: "Query params use snake_case → new ## API Conventions" }
]
```

**After user selects:**

- If user selects any options → Update project CLAUDE.md, placing learnings in proposed sections
- Commit: `docs(CLAUDE.md): <summarize selected learnings>`
- If user selects nothing → Skip, continue to Step 2

**If no learnings to propose:** Skip silently, continue to Step 2.

### Step 2: Detect Existing PR and Present Options

**Before presenting options, check if a PR already exists for this branch:**

Use `mcp__mcp-broker__github_list_pull_requests` to find an open PR for the current branch, requesting at least `url`, `title`, and `number`.

**If a PR exists**, use `AskUserQuestion` to present exactly 2 options:

```javascript
AskUserQuestion(
  questions: [{
    question: "Implementation complete. PR #<number> exists for this branch. What would you like to do?",
    header: "Complete",
    multiSelect: false,
    options: [
      { label: "Push and update PR", description: "Push branch and update PR title and description" },
      { label: "Keep branch as-is", description: "I'll handle it later" }
    ]
  }]
)
```

**If no PR exists**, use `AskUserQuestion` to present exactly 2 options:

```javascript
AskUserQuestion(
  questions: [{
    question: "Implementation complete. What would you like to do?",
    header: "Complete",
    multiSelect: false,
    options: [
      { label: "Push and create PR", description: "Push branch and create draft pull request" },
      { label: "Keep branch as-is", description: "I'll handle it later" }
    ]
  }]
)
```

### Step 3: Execute Choice

#### Option: Push and Create PR

Use MCP broker tools:

1. `mcp__mcp-broker__git_push` to push `<feature-branch>` to the remote and set upstream when needed.
2. `mcp__mcp-broker__github_create_pull_request` to create a draft PR.

#### Option: Push and Update PR

Use MCP broker tools:

1. `mcp__mcp-broker__git_push` to push the current branch.
2. `mcp__mcp-broker__github_update_pull_request` to update the PR title and description based on all commits relative to the base branch.

The updated PR title and description are regenerated from scratch based on all commits on the branch relative to the base branch. Follow the PR description template from the project or global CLAUDE.md.

#### Option: Keep As-Is

Report: "Keeping branch <name>."

## Common Mistakes

**Open-ended questions**

- **Problem:** "What should I do next?" → ambiguous
- **Fix:** Present exactly 2 structured options

**Noisy reflections**

- **Problem:** Proposing too many trivial or already-documented learnings
- **Fix:** Only propose actionable, project-specific patterns not already in CLAUDE.md

## Red Flags

**Never:**

- Delete work without confirmation
- Force-push without explicit request

**Always:**

- Clean up plan files before reflecting
- Skip reflection silently if no learnings to propose
- Present exactly 2 options (create PR, update PR, or keep branch — depending on whether a PR exists)
