---
name: create-html-artifact
description: Use when the user asks to create a standalone HTML artifact, HTML report, interactive explainer, visual plan, dashboard, slide deck, diagram, or throwaway HTML tool.
---

# Create HTML Artifact

## Purpose

Create standalone HTML deliverables that are easier to read, navigate, compare, demonstrate, or manipulate than a wall of Markdown. Favor HTML when the output benefits from layout, inline SVG, tables, visual hierarchy, collapsible sections, tabs, filtering, sorting, charts, diagrams, copy buttons, or small purpose-built interactions.

Do not treat HTML as the universal default. For prose that the user or collaborators will heavily coauthor, review in diffs, or maintain as source documentation, prefer Markdown, plain text, or Markdown with embedded HTML unless the user explicitly asks for a browser-rendered artifact.

## When HTML Is the Right Medium

Use HTML for:

- **Exploration and planning** — side-by-side options, visual implementation plans, timelines, risk maps, dependency diagrams.
- **Code review and code understanding** — annotated diffs, module maps, call graphs, file tours, reviewer-oriented PR writeups.
- **Design and product work** — design-system contact sheets, component state matrices, interaction prototypes, animation sandboxes.
- **Diagrams and illustrations** — inline SVG flowcharts, architecture diagrams, process maps, figure sheets.
- **Presentations and briefings** — simple slide decks, meeting walkthroughs, executive summaries.
- **Research, learning, and reports** — explorable explainers, status reports, incident timelines, evidence-backed narratives.
- **Custom editors and utilities** — throwaway interfaces with export/copy buttons that turn user edits back into Markdown, JSON, text, or code.

Use another format when:

- The user needs easy line-by-line edits or readable VCS diffs.
- The deliverable is mostly short prose with no visual or interactive payoff.
- The artifact would leak private data if opened, hosted, or shared casually.
- A production system, durable product feature, or team-owned documentation site is being requested; clarify scope instead of handing over a throwaway file as production-ready.

## Workflow

### 1. Define the artifact contract

Before writing HTML, identify:

- Audience and purpose: who will read or use it, and what decision or action it should support.
- Source material: files, diffs, data, notes, URLs, logs, or user-provided facts to use.
- Output path: choose a clear local filename such as `report.html`, `index.html`, or `{topic}-artifact.html` when the user does not specify one.
- Privacy boundary: whether the file is personal, internal, shareable, or public.
- Dependency policy: default to no external dependencies; ask or state the tradeoff before adding any CDN, remote font, image, API call, or hosted asset.

For GPT-5.5-style reasoning models, keep the internal prompt shape outcome-first: define the target, success criteria, constraints, available evidence, output file, and stop conditions. Avoid over-prescribing every implementation step unless a step is mandatory.

### 2. Choose a structure that matches the job

Start from the user’s need, not from a generic dashboard template:

- Report: title, context, TL;DR, key findings, evidence, caveats, recommendations, appendix.
- Explainer: summary, mental model, interactive example, glossary, pitfalls, references.
- Plan: requirements, milestones, data flow, risk table, validation checks, open questions.
- Code review: changed files, annotated diff snippets, severity tags, reviewer checklist, follow-ups.
- Incident: impact, timeline, root cause, contributing factors, actions, owners, verification.
- Tool/editor: input area, live preview/result, validation feedback, export/copy controls.
- Slide deck: sections as slides, keyboard navigation, print-friendly fallback.

Include navigation for long artifacts. Use IDs on major sections so the user can refer to specific parts during follow-up edits.

### 3. Build a single-file artifact

Default implementation constraints:

- Produce one complete `.html` file that opens directly from disk.
- Inline CSS in `<style>` and small JavaScript in `<script>`.
- Avoid React, JSX, npm, bundlers, frameworks, and build steps unless explicitly requested.
- Avoid external scripts, styles, fonts, and images by default. If a dependency materially improves the result, use a version-pinned reputable CDN only after the dependency tradeoff is clear.
- Keep the artifact small enough that a future agent or human can understand and edit it.
- Use local data embedded in the file unless the user asks for live API access.

For interactive tools, add an obvious export path: copy to clipboard, download file, or render the final text/JSON/code that can be pasted back into the agent.

### 4. Use semantic, accessible HTML

Prefer browser-native elements:

- Document shell: `<!doctype html>`, `<html lang="en">`, `<meta charset="utf-8">`, responsive viewport, meaningful `<title>`.
- Landmarks: `<header>`, `<nav>`, `<main>`, `<section>`, `<article>`, `<aside>`, `<footer>`.
- Content: headings in order, `<p>`, `<ol>`, `<ul>`, `<table>`, `<figure>`, `<figcaption>`, `<details>`, `<summary>`, `<code>`, `<pre>`.
- Controls: real `<button>`, `<input>`, `<select>`, `<textarea>`, labels, keyboard-focus states, ARIA only when native HTML is insufficient.

Maintain readable contrast, visible focus, responsive layout, and sensible print behavior for report-like artifacts. Make core content visible without JavaScript when practical; use JavaScript to enhance navigation, filtering, sorting, tabs, toggles, or exports.

### 5. Style for comprehension, not decoration

Create a small design system inside CSS:

- Use CSS custom properties for color, spacing, type, borders, shadows, and status colors.
- Establish clear type hierarchy, generous reading line lengths, and consistent spacing.
- Use reusable components such as `.callout`, `.metric`, `.tag`, `.grid`, `.timeline`, `.toc`, `.risk`, `.evidence`, and `.status`.
- Use tables for precise values, timelines for sequences, cards only for discrete repeated items, and SVG for diagrams that need spatial relationships.
- Match the aesthetic to the domain: quiet and dense for operational reports; editorial for narrative research; playful or expressive for prototypes only when appropriate.

Avoid generic AI-looking output: purple-blue gradients, decorative orbs, nested cards, huge marketing heroes for tools/reports, vague icons, low-contrast badges, one-note palettes, fake charts, invented metrics, and gratuitous animation. If visual design quality is central to the request, also load and follow the `frontend-design` skill.

### 6. Keep claims grounded

Separate facts, interpretations, assumptions, and open questions. Cite source URLs, local file paths, log names, commit hashes, PR numbers, or line references when available. Do not invent metrics, quotes, customer names, dates, owners, product claims, benchmark results, or citations to make the artifact feel more complete.

For research or technical reports, include a compact evidence section or appendix that lets the reader trace key claims back to inputs. If evidence is missing, label the gap instead of filling it with plausible prose.

### 7. Protect privacy and scope

Before finalizing, scan for secrets, tokens, credentials, customer data, private URLs, internal hostnames, proprietary names, and accidental public-sharing assumptions. Do not publish, push, deploy, or start an externally reachable server unless the user explicitly asks.

Make throwaway status explicit when relevant. A single-file artifact can be excellent for exploration, review, and personal tools, but it is not automatically production-ready, accessible enough for all users, secure enough for public hosting, or maintainable as a product feature.

## Validation

Validate before reporting completion:

- Read the file after writing it to catch truncation, placeholders, malformed structure, and obvious source leaks.
- Check for leftover `TODO`, lorem ipsum, dummy numbers, broken links, and unsupported claims.
- For static files, run a lightweight syntax check when available, such as `python3 -m html.parser path/to/file.html` or an HTML validator installed in the project.
- For visual or interactive artifacts, open/render it when a browser or Playwright is available. Inspect desktop and narrow widths for clipping, overlap, unreadable text, broken controls, console errors, and printability if relevant.
- If rendering cannot be performed, say so and describe the checks that were run instead.

## Final Response

When done, report:

- The created or updated HTML file path.
- The artifact type and the most important features included.
- Verification performed, including whether it was rendered in a browser.
- Any dependencies, privacy assumptions, or known limitations.

## Prompt Patterns

Useful user-facing patterns to honor or suggest:

```text
Create a single-file HTML report at report.html from these notes. No external dependencies. Make it skimmable, evidence-backed, and print-friendly.
```

```text
Create an index.html, no React and no build step, with sparse styling, that lets me paste in data, inspect it, and copy the transformed output.
```

```text
Create an HTML artifact explaining this PR. Render the key diff snippets with inline annotations, severity tags, jump links, and a reviewer checklist.
```

```text
Turn this long Markdown plan into a browser-readable HTML artifact with a timeline, risk table, data-flow diagram, and open questions. Preserve the Markdown as the editable source if future coauthoring matters.
```

## Source-Informed Principles

This skill is based on public guidance and examples from:

- Thariq Shihipar’s “The unreasonable effectiveness of HTML” examples: single-file artifacts for planning, review, design, prototypes, diagrams, decks, research, reports, and custom editors.
- Hacker News discussion of the approach: HTML improves rich consumption and throwaway tools, while Markdown remains valuable for coauthoring, token efficiency, readable diffs, and maintainability.
- Simon Willison’s HTML tools patterns: single file, no React/build step, small code, copy/paste workflows, optional CDN dependencies only when worthwhile, URL/localStorage state where useful, and self-hosting caution.
- OpenAI GPT-5.5 prompting guidance: use outcome-first prompts, success criteria, explicit constraints, dependency/stop rules, structured outputs where schemas matter, concise preambles for tool-heavy work, and rendered inspection for visual artifacts.
