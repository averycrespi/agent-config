# ask-user Design

Provide one interactive human-choice tool, not a coordination inbox. Managed questions belong to mailbox guidance; standalone behavior remains interactive. No mode environment variable, retained state, remote answer API or role-based tool gating exists.

## Responsibilities

`index.ts` owns the schema, custom TUI, result details and renderers. `validate.ts` handles cross-field constraints: normalized label uniqueness, reserved Other labels and recommendation bounds. Tests exercise observable validation, selection, cancellation, abort and event behavior without a live terminal.

Keep one focused question, brief context, 2–5 options and a zero-based recommendation. Append the free-text option automatically. Headless execution rejects rather than printing a question for later. Results distinguish cancellation from selection/custom answers and never infer approval from an unanswered question.

## UI lifecycle

The choice list supports Up/Down, Enter and Escape. The free-text editor submits nonempty text or returns to the list on Escape. Cache width-dependent rendered lines and invalidate on input. Register the abort listener for the tool lifetime and remove it in cleanup.

Announce a fresh request UUID only inside an actual unaborted custom UI factory. Emit correlated resolution in `finally`, with failed as the default until a successful UI return establishes answered/cancelled. Event publication is failure-isolated and shallow-frozen. Balance existing Herdr blocked signals around the UI call, including rendering failures. Events contain identity/outcome only and create no model turns, messages or answer authority. See [API.md](API.md).

## Change guidance

Preserve pure validation, explicit abort semantics and the narrow interactive scope. Do not rebuild managed parent mode, durable question storage or cross-session transport here. Manual existing-run cutover requires explicit authority; fixtures do not establish real model compliance or live editor behavior.
