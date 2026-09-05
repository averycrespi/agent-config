# Pre-implementation Assessment

Use this shared procedure with the invoking skill's lens: **risk** for `challenge`, **simplification** for explicit-only `simplify`. Do not automatically run both assessments.

## Establish the target and baseline

Read the concrete plan, specification, design, proposal, or approach and its governing inputs. Identify the decision, required outcome, acceptance criteria and completion evidence, scope/non-goals, implementation state, and material repository, compatibility, security, data, operational, and resource constraints. Preserve settled requirements unless contradictory evidence or a user-owned revision requires a decision.

Recover context and investigate evidence-checkable claims before asking the user. Gather only relevant source, tests, instructions, artifacts, and current external documentation; reuse research unless stale, incomplete, or contradictory.

Use `clarify` for material uncertainty in the desired outcome, `shape-ticket` for creating or revising a Plane delivery contract, and `review` for completed code or behavior. Neither assessment replaces post-implementation review.

## Calibrate effort

Use a light pass for low-impact reversible decisions, focused investigation for moderate stakes, and deeper evidence or specialist validation for consequential security, data, migration, compatibility, or rollback risks. Identify the concern that warrants specialist input rather than impersonating every specialist.

Delegate self-contained questions when parallelism, isolation of substantial context, or independent judgment clearly outweighs startup and handoff costs. Use one parallel read-only dispatch for independent branches when justified; keep straightforward checks inline. Give each child a bounded question and request concise evidence-backed findings, not edits.

## Apply the selected lens

### Risk

Restate the proposal's rationale fairly and note genuine strengths briefly. Challenge only claims whose failure changes whether to proceed, what to build, or how success is proven.

Choose relevant lenses: weak assumptions, a concrete pre-mortem, simpler/opposite/existing alternatives, second-order effects, reversibility, source evidence, and observable verification. For plans, examine acceptance coverage, dependencies, scope, checks, documentation/migration impact, and handoff readiness; for designs, examine boundaries and failure/recovery paths; for proposals, examine objective fit, opportunity cost, success measures, and exit criteria.

Classify material findings as **Blocker**, **Risk**, **Evidence gap**, or **Decision needed**. For each, name the challenged claim, concrete failure scenario, evidence, consequence, and resolution or mitigation. Investigate answerable gaps; record acceptable uncertainty with a mitigation, owner, or trigger. Do not manufacture dissent, inflate severity, enumerate theoretical risks, or reopen settled decisions without evidence.

### Simplification

Test whether each material requirement, task, component, abstraction, dependency, configuration, migration, or verification activity traces to a required outcome, inherited constraint, repository evidence, concrete failure mode, or completion evidence. Generic best practice, hypothetical reuse, and unsupported edge cases do not suffice.

Look for unsupported scope, unnecessary layers or configurability, tasks that share one outcome and gate, line-by-line implementation prescription, duplicate requirements or checks, and speculative extensibility or optimization. Preserve observable behavior in specifications, acceptance coverage in plans, invariants in designs, and decision quality in proposals.

Classify candidates as **Remove**, **Merge**, **Defer**, or **Keep**. For each reduction, identify the exact target, evidence that its justification is insufficient, protected outcomes that remain satisfied, and the smallest repair. Explain necessary complexity when it might otherwise appear removable.

Check against underengineering before recommending a reduction: retain every acceptance criterion, required check, security/privacy/compatibility/data-integrity/recovery safeguard, necessary consumer context, and observable completion evidence. A protected requirement change is a user-owned decision, not a simplification. Do not substitute a different product, optimize for line count, or hide unresolved requirements behind “YAGNI.”

## Report and resolve

Lead with the conclusion and recommended next action. Include the baseline only as needed, then material evidence-backed findings and user-owned decisions. Use headings or lists when helpful, omit empty sections, and avoid a fixed multi-section template for a small assessment.

Use one conclusion appropriate to the lens:

- **Risk:** Ready to proceed; Proceed with mitigations; Revise before proceeding; or Investigate before deciding.
- **Simplification:** Already minimal; Simplify before proceeding; or Requirements need clarification.

No findings means say so directly, with only meaningful residual uncertainty. Include autonomous handoff readiness only for executable implementation plans. Ask one focused user-owned question at a time with a recommendation; use `ask_user` when choices have material trade-offs.

## Revision boundary

Do not edit or replace the target unless revision is authorized. Make only the accepted, in-scope changes, preserve sound decisions and artifact lineage/status rules, and run existing structural validators or focused checks before reporting completion. Scope expansion or changes to protected requirements need authorization. Avoid turning plans into line-by-line implementation scripts or adding abstractions to make them appear cleaner.
