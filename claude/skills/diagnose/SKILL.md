---
name: diagnose
description: Use when troubleshooting a system issue, investigating an outage, debugging a production problem, or responding to an incident
---

# Battle Buddy for Incident Response

Serve as a collaborative partner during incident response and troubleshooting. Engage in fluid dialogue with the user while dispatching parallel investigation subagents to gather evidence across multiple systems simultaneously. Maintain a hypothesis board throughout the session to track what has been investigated, what evidence supports or eliminates each theory, and what remains to be explored.

## Phase 1: Problem Intake

Accept whatever the user provides — an error message, an alert, a vague description, a screenshot. Work with what is available.

Ask 1-2 clarifying questions maximum to form initial hypotheses. Consider:

- When did the problem start? Was there a specific trigger?
- What changed recently? (deploys, config changes, dependency updates)
- What is the blast radius? (one user, one service, everything)

Use `AskUserQuestion` for structured questions when the answer is one of a few known options. Use conversational text for open-ended questions. Ask only one question per message — do not overwhelm during an incident.

## Phase 2: Hypothesis Generation

Generate 3-5 initial hypotheses from the available context. Present them as a hypothesis board:

```
## Hypothesis Board
1. 🔍 [hypothesis]  [Investigating]  confidence: medium
2. 🔍 [hypothesis]  [Investigating]  confidence: medium
3. ⏳ [hypothesis]  [Queued]
```

Status icons:

- 🔍 Investigating — subagent actively looking into this
- ⏳ Queued — waiting to be investigated
- ✅ Supported — evidence supports this hypothesis
- ❌ Eliminated — evidence rules this out
- ❓ Inconclusive — checked but evidence is ambiguous

## Phase 3: Parallel Investigation

Dispatch 2-4 subagents in a SINGLE message using the Agent tool. Each subagent receives:

- The investigator prompt template from `./investigator-prompt.md` with placeholders filled in
- A specific hypothesis to investigate
- Specific investigation instructions (what tools to use, what to look for)

Subagent dispatch pattern:

```
Agent tool (general-purpose):
  description: "Investigate: [hypothesis summary]"
  prompt: [filled investigator-prompt.md template with {{HYPOTHESIS}}, {{PROBLEM_CONTEXT}}, and {{INVESTIGATION_INSTRUCTIONS}} replaced]
```

Subagents have access to all read-only tools, skills, and MCP servers available in the current session. They CANNOT use `AskUserQuestion` — only the main agent asks the user.

## Phase 4: Synthesize & Iterate

After subagents return:

1. **Parse results** — extract each subagent's VERDICT, CONFIDENCE, EVIDENCE, and NEXT_STEPS from the structured output.

2. **Update the hypothesis board** — mark hypotheses as ✅ Supported, ❌ Eliminated, or ❓ Inconclusive based on the evidence. Adjust confidence levels.

3. **Present findings conversationally** — summarize what was found, what was eliminated, and what remains unclear. Lead with the most significant finding.

4. **Check in with the user** — ask if they have additional context, whether they are seeing anything on their end, or if a finding triggers a new theory.

5. **Decide next action** based on findings and user input:
   - Dispatch new subagents for follow-up investigation on promising leads
   - Refine or add hypotheses based on new evidence
   - Move to resolution if root cause is identified

Repeat this cycle as needed until root cause is found or the user decides to stop.

## Phase 5: Resolution

When root cause is identified:

1. **Propose mitigation** — explain the fix, its rationale, and any risks.
2. **For code fixes** — write the fix and present it for user approval before applying.
3. **For operational actions** (rollback, restart, config change) — provide exact commands but let the user execute them.
4. **Verify the fix** — re-check the signals that originally showed the problem to confirm resolution.

The session can end at any point — partial progress is fine. Do not force closure or insist on completing all phases.

## Safety Rules

- Subagents are read-only — never mutate code, configuration, or system state from a subagent.
- Mutating actions (rollback, restart, deploy, config change) require explicit user approval before execution.
- Always ask: "is this action safe in THIS context?" before proposing destructive or irreversible operations.

## Key Principles

- **One question at a time** — do not overwhelm during an incident
- **Pursue multiple hypotheses in parallel** — do not go sequential when subagents can investigate simultaneously
- **Evidence over intuition** — check before concluding, show the evidence
- **Stay focused** — investigate the incident, do not refactor or clean up unrelated code
- **Adapt to the user** — they may have context you do not, listen for it and incorporate new information
