# Parent-managed child decisions

Use the existing child checkpoint/report, `agent_settled` attention and Herdr communication paths. A pending decision is not completed delivery, owner release, or permission to launch a successor. Do not add a decision service or a second delivery state machine.

## Child-only launch

Read [ask-user configuration](../../../extensions/ask-user/README.md#configuration). Set `PI_ASK_USER_MODE=parent` for the work-stack child process only; leave the human-facing parent and standalone spin-out defaults unchanged. Do not export it globally, edit settings, install/link configuration, or reload a session. Require the loaded ask-user extension to support the mode before launch; unavailable support blocks managed launch rather than silently falling back to interactive questions.

Inspect the installed Herdr CLI before selecting the launch mechanism. An environment prefix on the parent's `herdr agent start` command does **not** establish the remote pane process environment. Where `agent start` offers no child-environment option, use this narrow alternative to spin-out's startup step, after its exact-base, unique-name, available-shell and handoff checks:

```bash
herdr pane run <root-pane-id> 'env PI_ASK_USER_MODE=parent pi'
```

This command-scoped assignment belongs to Pi and its descendants, not the pane shell or parent. Record startup intent first; `pane run` confirms submission, not Pi readiness. Inspect the explicit pane's process and detected agent identity with `herdr pane process-info --pane <root-pane-id>` and `herdr agent get <root-pane-id>`. If readiness is pending, use a bounded `herdr pane wait-output` for the installed Pi's known readiness marker, then reconcile actual process/agent identity; text alone is not identity proof. Require the expected Pi at the assigned checkout, its session identity, and `idle` or `done` readiness before `herdr agent rename <root-pane-id> <unique-agent-name>`. Confirm the name/identity. If uncertain or failed, retain the pane and startup intent; do not submit another launch or call `agent start` on top of it. Do not poll readiness with model turns.

Then follow the normal work-stack order: resolve the child's exact live incarnation, register bounded one-shot attention **before** the non-waiting initial prompt, and confirm each effect. Keep the observer filters unchanged, including `agent_settled`, `ask-user:input_requested`, and `session_shutdown`. Parent mode emits no input-wait/resolution or Herdr blocked signals; `agent_settled` after the child's report is the expected decision attention path. Retain the input filter for unexpected actual UI waits, not remote UI answering.

## Initial handoff and child report

Include this contract in the initial handoff, along with the parent identity/checkpoint reference and existing ticket delivery authority:

- Treat `ask_user` with `status: "decision_required"` as a non-answer: no answer or approval was supplied and no user interaction occurred. Do not retry the same call, unset/change the mode, or substitute another UI/launch to bypass it.
- Investigate existing evidence first and resolve answerable questions within established authority. For an unresolved decision, retain the generated request ID and report the exact question, options/trade-offs, recommendation (or none), evidence already checked, blocked work and any safe independent work remaining.
- Correlate the request with immutable ticket UUID, run/owning session UUID, current branch/head, checkpoint reference and decision context revision. Use a new request identity if the decision materially changes; mark the old request superseded in the existing checkpoint rather than treating an old answer as current.
- Store the current request in work-ticket's existing `blocker`/`progress` and `next` fields, referencing retained evidence rather than copying transcripts. State `decision_required`, what remains incomplete, and next actor: parent to reconcile this request. Checkpoint and yield when no authorized independent work remains. Preserve pending effects and allowances; reconcile child-owned observers before yielding for input.
- Retain sole implementation ownership while decision-blocked. Do not release the ticket as delivered. A yield authorizes neither a substitute writer nor the next stack ticket.

This result is a coordination mechanism, not a security boundary. The extension does not transport the question, verify approval or enforce model follow-through.

## Parent reconciliation and continuation

On `agent_settled` attention, reconcile the exact receipt, coverage gap and retained parent allowance, then read the existing child's current checkpoint/report. Distinguish a pending decision from ongoing work, child-owned CI and a claimed delivery boundary. Do not infer completion from settlement or ask-user's non-cancelled non-answer.

1. Match stack/ticket/run/session/incarnation, request ID, current head and decision context revision. Read enough current evidence to establish the request is still pending. For stale, superseded, conflicting or uncertain requests, reconcile with the existing child; never apply an old answer blindly.
2. Supply an already-established answer with its evidence, or make a **parent decision** only within established delegated authority. Label it as such, with rationale and authority reference; never fabricate user approval. Unresolved user preferences, scope changes and additional authorization go to the user through the human-facing parent. Cancel/reconcile the corresponding continuation/attention job before asking for input; retain resources and stop successor launch. A cancelled user question leaves the child blocked.
3. After an answer, recheck that the request and existing owner remain current. Record one continuation intent in the parent snapshot: exact child/session/request/context, answer, provenance (`parent decision` or actual user instruction/reference), scope and remaining exclusions. Keep the child's ledger child-owned.
4. Resolve the same child's live incarnation freshly and register attention within the **retained** parent deadline/attempt ceiling before sending one non-waiting Herdr continuation prompt. Include the correlation tuple, answer/provenance and authority reference, and instruct the child to validate applicability before resuming its already-authorized work. No new child, successor, remote UI response, parent code edit or second CI observer is permitted.
5. Confirm submission and then the existing child's acknowledgment/report of the matching request through normal attention reconciliation. Submission alone does not prove application. Retain uncertain effects; do not blindly replay a prompt after timeout, cancellation or missing acknowledgment. On stale correlation, require reconciliation rather than execution.

The child records the matching resolution and provenance in its existing checkpoint and continues under unchanged delivery criteria, serial dependencies and ownership. Decision waiting and continuation never reset parent observation, child CI or repair allowances, renew absolute deadlines, expand publication/destructive-action authority, or waive review/checks. If retained observation allowance is exhausted, request explicit additive authority before another registration; an answer alone does not replenish budgets. Advance only after the existing work-stack delivery-boundary checks pass.
