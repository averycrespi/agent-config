---
name: create-skill
description: Use when creating a new skill or updating an existing skill
license: Complete terms in LICENSE
---

# Create Skill

Skills are modular, self-contained packages that extend the agent's capabilities with specialized knowledge, workflows, and tools.

## Skill Structure

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter: name, description (required)
│   └── Markdown instructions (required)
└── Bundled Resources (optional)
    ├── scripts/      - Executable code for deterministic/repeated tasks
    ├── references/   - Documentation loaded into context as needed
    └── assets/       - Files used in output (templates, images, etc.)
```

## Naming Convention

- **Workflow skills** (invoked to perform a task): use verb-object names when natural, or concise task names for broad workflows (e.g., `challenge`, `diagnose`)
- **Reference skills** (provide information/context): use nouns (e.g., `playwright`, `agent-engineering`)

## SKILL.md Frontmatter

The `name` and `description` determine when the agent activates the skill. Descriptions should start with "Use when" followed by a specific, narrow trigger condition. Overly broad descriptions cause false activations.

## Progressive Disclosure

Skills use three levels of context loading:

1. **Metadata (name + description)** - Always in context (~100 words)
2. **SKILL.md body** - Loaded when skill triggers (<5k words)
3. **Bundled resources** - Loaded as needed by the agent

## Writing Style

Write using **imperative/infinitive form** (verb-first instructions), not second person. Use objective, instructional language (e.g., "To accomplish X, do Y" rather than "You should do X").

## Creation Process

### 1. Understand Usage

Inspect the request, supplied examples, existing skills, repository instructions, and tool contracts first. Infer routine usage from that evidence. Ask only about unresolved choices that materially affect activation, behavior, or safety; do not require a trigger/workflow/edge-case interview when the request is actionable.

### 2. Plan Contents

For each example, identify what reusable resources (scripts, references, assets) would help when executing the workflow repeatedly. Prefer references files for detailed information to keep SKILL.md lean.

### 3. Create the Skill

Create the skill directory and SKILL.md with proper frontmatter. Add any bundled resources identified in the planning step. The SKILL.md should answer:

1. What is the purpose of the skill?
2. When should it be used?
3. How should the agent use it, including references to any bundled resources?

### 4. Check instruction compatibility

Compare the proposed skill and its references with applicable `AGENTS.md`, tool contracts, and related skills for conflicting authority, scope, confirmation, delegation, verification, and stopping rules. Resolve contradictions at their source rather than adding another reminder. Preserve the actual instruction hierarchy and required gates. Make conditional reference-loading triggers explicit and verify local links resolve.

### 5. Iterate

Use the skill on representative tasks, checking activation, authorized follow-through, necessary questions, useful delegation, proportionate verification, and output completeness. Update guidance based on observed struggles; structural checks cannot prove model compliance.
