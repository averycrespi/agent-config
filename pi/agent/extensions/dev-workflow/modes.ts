import type {
  ThinkingLevel,
  WorkflowMode,
  WorkflowModeThinkingLevels,
} from "./types.ts";

const PLAN_TOOLS = [
  "read",
  "ls",
  "find",
  "grep",
  "todo",
  "ask_user",
  "web_search",
  "web_fetch",
  "mcp_search",
  "mcp_describe",
  "mcp_call",
  "spawn_agents",
  "write_plan",
  "edit_plan",
] as const;

const EXECUTE_TOOLS = ["read", "edit", "write", "bash", "todo"] as const;

const VERIFY_TOOLS = [
  "read",
  "bash",
  "todo",
  "ask_user",
  "mcp_search",
  "mcp_describe",
  "mcp_call",
  "spawn_agents",
] as const;

const WORKFLOW_ADVANCE_TOOL = "workflow_advance";

export const DEFAULT_THINKING_LEVELS: WorkflowModeThinkingLevels = {
  plan: "medium",
  execute: "low",
  verify: "high",
};

export const PLAN_TEMPLATE = `# <Short Title> Plan

## Goal

<One sentence describing the intended outcome.>

## Constraints

- <Hard constraints, repo conventions, scope boundaries, or user preferences.>

## Acceptance Criteria

- AC-1: <Observable criterion verified by a test, command, file state, or UI state.>
- AC-2: <Observable criterion verified by a test, command, file state, or UI state.>
- AC-3: <Observable criterion verified by a test, command, file state, or UI state.>

## Chosen Approach

<Recommended approach and the key trade-off behind it.>

## Documentation Impact

<List docs, READMEs, examples, changelogs, or user-facing references to update, or state that no documentation updates are required and why.>

## Assumptions / Open Questions

- Q1: <Assumption or unresolved question, with owner/status when known.>

## Ordered Tasks

### T1: <Task title>

Covers: AC-<n>

- <Implementation intent and relevant files or areas, not a line-by-line diff.>

## Verification Checklist

- [ ] V1: <Command, test, or observable check for AC-<n>.>
- [ ] V2: Confirm Documentation Impact was followed.

## Known Issues / Follow-ups

- <Accepted limitation, follow-up, or "None known.">`;

export function getManagedToolNamesForMode(
  mode: WorkflowMode,
  options: { autoAdvanceEnabled?: boolean } = {},
): string[] {
  switch (mode) {
    case "plan":
      return [...PLAN_TOOLS];
    case "execute":
      return options.autoAdvanceEnabled
        ? [...EXECUTE_TOOLS, WORKFLOW_ADVANCE_TOOL]
        : [...EXECUTE_TOOLS];
    case "verify":
      return options.autoAdvanceEnabled
        ? [...VERIFY_TOOLS, WORKFLOW_ADVANCE_TOOL]
        : [...VERIFY_TOOLS];
    default:
      return [];
  }
}

export function getThinkingLevelForMode(
  mode: WorkflowMode,
  thinkingLevels: WorkflowModeThinkingLevels = DEFAULT_THINKING_LEVELS,
): ThinkingLevel | undefined {
  switch (mode) {
    case "plan":
      return thinkingLevels.plan;
    case "execute":
      return thinkingLevels.execute;
    case "verify":
      return thinkingLevels.verify;
    default:
      return undefined;
  }
}

export function buildModeContract(options: {
  mode: Exclude<WorkflowMode, "normal">;
  autoAdvanceEnabled?: boolean;
}): string {
  const shared = [
    "## Workflow modes",
    `Current mode: ${options.mode}`,
    "Workflow modes apply tool and thinking defaults only on explicit mode transitions.",
    "Mode switch commands may send a kickoff user message so work starts immediately in the new mode.",
  ];

  if (options.mode === "plan") {
    return [
      ...shared,
      "Success criteria: produce an execution-ready plan only after the request is understood, scoped, and validated with the user.",
      "Plan mode outcome: capture purpose, constraints, success criteria, acceptance criteria, chosen approach, implementation tasks, documentation impact, verification, and known assumptions.",
      "Plan mode interaction contract: start with discovery, use repo context before asking repo-answerable questions, explore meaningful trade-offs, validate the chosen direction, then author the durable plan.",
      "For non-trivial feature, bugfix, refactor, workflow, or design requests, ask at least one focused requirements-discovery question before authoring unless the user explicitly asks to skip discovery or provides a complete implementation-ready plan.",
      "Walk down the decision tree one dependency at a time; resolve upstream decisions before asking downstream questions.",
      "Ask one focused question at a time, include your recommended answer, and prefer multiple-choice questions when they fit.",
      "After asking a material question or presenting a material decision, stop and wait for the user's answer; do not continue into plan authoring in the same turn.",
      "If a question can be answered by exploring the repo, explore the repo instead of asking the user.",
      "When trade-offs matter, compare 2-3 viable approaches, lead with your recommendation, explain why, and get the user's decision before converging.",
      "Before authoring a non-trivial plan, briefly validate the chosen direction and unresolved assumptions with the user.",
      "For complex work, present the proposed design in small sections and ask whether each section looks right so far.",
      "Author the durable .plans/ markdown file only after discovery, exploration, and validation are complete.",
      "You may skip discovery for trivial mechanical tasks, obvious typo fixes, or when the user explicitly says not to ask questions.",
      "Use YAGNI ruthlessly; implement exactly the requested scope in the plan and avoid speculative features.",
      "Plan files belong under .plans/ at the repo root.",
      "Do not call write_plan or edit_plan until discovery, exploration, and validation are complete, unless the user explicitly asks you to skip discovery or provides a complete implementation-ready plan.",
      "Do not use general editing tools in Plan mode.",
      "Only write or update a plan after you have enough context and the user has approved the direction for non-trivial work.",
      "Every plan must include Documentation Impact: list docs, READMEs, examples, changelogs, or user-facing references that execution should update, or explicitly state that no documentation updates are required.",
      "Verification Checklist should include checking that Documentation Impact was followed: required docs were updated, or the no-docs-needed rationale still holds.",
      "Include 3-7 testable acceptance criteria whenever the task is substantial enough to need them.",
      "Each acceptance criterion should be observable via a test, command output, or file/UI state — not a feeling.",
      `Substantial plan files should use this template unless there is a clear reason to simplify:\n\n${PLAN_TEMPLATE}`,
    ].join("\n");
  }

  if (options.mode === "execute") {
    return [
      ...shared,
      "Success criteria: make focused implementation progress that matches the available workflow context.",
      "Read relevant .plans/*.md files before changing code when they are available or referenced by the user.",
      "Use TODO state for short-lived decomposition only; do not treat it as the durable plan.",
      "Keep changes aligned with the current conversation, acceptance criteria, and ordered tasks.",
      "Follow test-driven development for feature work, bug fixes, refactors, and behavior changes that involve meaningful implementation logic: write the failing test first, watch it fail, then implement the minimal passing change.",
      "Commit regularly at logical checkpoints as the work progresses.",
      "Do not wait for one giant commit at the end of Execute mode.",
      options.autoAdvanceEnabled
        ? 'Before stopping in Execute mode, call workflow_advance as the explicit workflow decision: use state="verify" when implementation is ready for verification and all changes are committed, or state="aborted" when the workflow is blocked, unfixable, or cannot continue. Execute → Verify advance fails if git status has staged or unstaged uncommitted changes. Include a concise reason.'
        : "When implementation is complete and ready for verification, report that outcome to the user instead of requesting an automatic workflow advance.",
    ].join("\n");
  }

  return [
    ...shared,
    "Success criteria: evaluate the current work against the available workflow context and acceptance criteria.",
    "Read relevant .plans/*.md files before reviewing when they are available or referenced by the user.",
    "Run deterministic checks first.",
    "Do not silently edit code in Verify mode.",
    "Report verification in a structured format with: Overall verdict (`pass`, `fail`, or `blocked`); deterministic checks run and results; per acceptance criterion verdicts (`pass`, `fail`, `n/a`, or `unknown`) with evidence; findings / next actions; and any user-accepted known issues.",
    "Turn findings into explicit next actions for a possible return to Execute mode.",
    options.autoAdvanceEnabled
      ? 'Before stopping in Verify mode, call workflow_advance as the explicit workflow decision: use state="execute" when verification finds fixable issues, or state="completed" / state="aborted" when verification passes, is blocked, finds unfixable issues, or cannot continue. Include a concise reason.'
      : "If verification finds fixable issues, report the needed fixes to the user instead of requesting an automatic workflow advance.",
    options.autoAdvanceEnabled
      ? "Do not end Verify mode with only a free-text report; use workflow_advance for pass, fail, blocked, and unfixable terminal decisions."
      : "If verification passes, is blocked, or finds unfixable issues, do not call workflow_advance; report the outcome to the user.",
  ].join("\n");
}
