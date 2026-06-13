---
name: create-jira-ticket
description: Use when creating a Jira ticket to plan upcoming work. Guides ticket drafting with clear structure, self-contained context, and testable acceptance criteria, then creates the ticket via the MCP broker's Atlassian namespace.
---

# Create Jira Ticket

## Overview

Draft well-structured Jira tickets that are clear for human readers and useful for AI agents picking up the work. Gather context, draft the ticket for review, then create it through the MCP broker.

## Workflow

### 1. Gather Context

Before drafting, collect the information needed:

- Read the user's description of the work to be done
- Check project AGENTS.md, CLAUDE.md, and related docs for project key, issue types, and conventions
- If the project key or issue type cannot be inferred, ask the user
- Review relevant code, designs, or prior tickets if referenced

### 2. Determine Issue Type

Select the appropriate type based on the work described:

| Type  | When to use                                              |
| ----- | -------------------------------------------------------- |
| Epic  | High-level goal grouping multiple related stories/tasks  |
| Story | User-facing functionality with clear "who/what/why"      |
| Task  | Technical work, infrastructure, or internal improvements |
| Bug   | Something is broken and needs fixing                     |

### 3. Draft the Ticket

Write the ticket using the description template from `references/ticket-guide.md`. Load the reference file to get the appropriate template for the issue type.

**Key principles to follow while drafting:**

- **Self-contained** — Include all context needed to do the work. Inline relevant details rather than linking to external documents without summary.
- **Imperative titles** — Start with a verb: "Add session timeout handling", not "Session timeout handling" or "We need to add session timeout handling".
- **Outcome over implementation** — Describe what the system should do, not how to code it. "Display inline error on invalid credentials" not "Add a toast component to the error handler".
- **Binary acceptance criteria** — Each criterion must be answerable yes or no. "Page loads in under 2 seconds" not "Performance is acceptable".
- **Explicit scope** — State what is out of scope when there is ambiguity. Humans infer scope from organizational context; future readers and AI agents do not.
- **Technical context inline** — Mention affected files, modules, endpoints, and patterns directly in the description. This helps both developers and AI agents orient quickly.
- **Atomic scope** — One logical change per ticket. If the work has independent parts, suggest separate tickets.

### 4. Present for Review

Show the drafted ticket to the user in a clear format:

```
**Project:** PROJ
**Type:** Epic/Story/Task/Bug
**Summary:** <title>

**Description:**
<full description content>
```

Ask if any changes are needed before creating.

### 5. Create via the MCP Broker

After the user approves the draft, create the ticket through the `mcp-broker` extension's Atlassian namespace:

1. `mcp_search` with a query like `"jira create"` or `"atlassian"` to find the create-issue tool
2. `mcp_describe` on the candidate tool to read its argument schema
3. `mcp_call` with the exact tool name and an arguments object matching the schema

Report back with the ticket key and link.

If the broker is unavailable (configuration error from `mcp_call`), surface the error and stop — do not fall back to drafting the ticket elsewhere.

## Resources

### references/

- `ticket-guide.md` — Description templates for each issue type and acceptance criteria format guidance. Load this file when drafting a ticket.
