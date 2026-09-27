# \_shared

Shared helpers for Pi extensions in this repository.

This directory is intentionally loader-inert: do not add an `index.ts` or `package.json`. Sibling extensions import individual modules directly, for example `../_shared/render.ts`, and Pi's extension loader skips this directory because it has no extension entrypoint.

Keep helper-specific contracts here and in their modules. For extension authoring conventions, read the repo-local [create-extension skill](../../../../.pi/skills/create-extension/SKILL.md); repository-wide safeguards and required checks remain in [AGENTS.md](../../../../AGENTS.md).

## Modules

- `config.ts` — reads Pi settings files, extracts `extension:<name>` settings, merges defaults/global/project/environment config, parses boolean environment overrides, and registers masked `/EXTENSION-NAME-config` inspection commands.
- `logging.ts` — creates managed temp logs under `${tmpdir()}/pi-extension-logs/<extensionName>/`, with sanitized unique filenames and explicit deletion support.
- `render.ts` — compact tool helpers: `displayLabel` sanitizes/bounds before styling; `toolCall` styles tool/action/target/modifiers without placeholder sections (its optional final `targetLimit` argument permits longer URL labels instead of the default 200-character target cap, within `displayLabel`'s 4,096-character input bound), while `outcomeLine` provides a distinct flush-left result without repeating the call and `outcomeSections` joins explicit summary fields with muted middle dots (never parsing or rewriting arbitrary prose); `toolSummary` remains for specialized contextual rows with unknown-effect/no-replay outcomes before optional identity; `expandedBodyResult` projects bounded indentation-preserving evidence with truncation disclosure, and `getResultTextComponent` keeps compact summaries truncated while wrapping additive details. `expandedResult` retains the builtin compatibility projection. Existing elapsed timers, width-aware text, path/command labels and extraction helpers remain available. These helpers never modify model-facing results or classify domain outcomes for callers.
- `notification.ts` — pure asynchronous custom-message projection with compact outcomes, safe expansion and versioned display-only metadata. See [the helper contract](#asynchronous-custom-messages).
- `widget.ts` — below-editor status mounting, row fitting, and countdown formatting. `createPersistentWidget(key).update(ctx, renderer?)` mounts one TUI component, replaces its renderer and requests repaint on subsequent updates, and clears it when no renderer is supplied. This preserves sibling insertion order because Pi's `setWidget` otherwise deletes/reinserts keys. Host disposal releases the repaint handle; RPC receives 100-column string arrays, and headless mode makes no UI calls. `fitWidgetRow` accepts already sanitized/styled content, reserves up to eight columns for identity/reason text, shortens that detail to preserve telemetry, then drops trailing fields in caller-supplied priority order. It never wraps or exceeds the available width. `formatWidgetCountdown` rounds positive milliseconds up to whole seconds, clamps expired values to zero, and renders `12s`, `1m`, or `1m 12s`. Styling conventions live in the create-extension skill, not this helper.
- `retained-artifacts.ts` — securely stages, gzip-compresses, finalizes, ages, and quota-manages retained subagent failure logs and abnormal workflow recovery envelopes in one diagnostic pool.
- `spillover.ts` — large-output spill-to-file helper. It joins text blocks, writes oversized text to an owner-controlled temp directory, returns a preview envelope that references the full file, preserves image blocks inline, and falls back to original content on write failure.
- `untrusted.ts` — wraps external text and mixed text/image blocks in explicit untrusted-content boundaries while escaping delimiter-like lines from the external payload.

## Tool-result conventions

This is the canonical convention for current non-builtin tool results. Call headers, below-editor widgets and asynchronous notifications are separate surfaces and do not inherit this layout. Rendering never fetches artifacts, changes model-facing content, starts work, acknowledges delivery, or grants approval.

### Color and grammar

- Render authored status words lowercase. Use `accent` for active work (`running…`, `reading…`), `muted` for queued/pending work, and one single-glyph ellipsis for ongoing activity. Keep useful domain verbs.
- Style each field independently: `success` for successful execution, `error` for failures, `warning` for cancellation or actionable warnings. Diagnostics follow their actual meaning, independently of lifecycle state. Counts, durations and supporting telemetry stay `muted`, even beside failure. Use words, never color alone.
- Join authored peer fields with a `dim` middle dot; use parentheses for qualifiers and colons for key/value labels. Do not rewrite punctuation inside literal tool output, code or quoted evidence.
- Keep metadata labels and section headings `muted`, normal weight. Render body/value content in ordinary `text`. Reserve bold tool titles for the unchanged call header. Add no decorative icons, borders, backgrounds or syntax highlighting.

### Compact and expanded layout

A collapsed result is optional. Keep routine successful reads silent when the only summary would be “returned” or “listed”; do not add universal green success rows. Show useful counts, empty results, confirmed effects, admission/lifecycle transitions, active progress, limits, errors and uncertainty. Never repeat the call identity unnecessarily or claim that admission means completion.

Expanded output begins with exactly the collapsed lines **including styling and width truncation**, followed by one blank line and additional details. If compact output is silent, start directly with details. If there are no details, add no blank line. Group related information; indent authored secondary metadata by two spaces. Avoid headings for trivial results. Literal body indentation is preserved rather than normalized to authored indentation.

Use `getResultTextComponent(lastComponent, summary, details)` with independently styled arrays. Summary lines truncate at the available width. Detail lines wrap, preserving logical lines and structured indentation; extremely narrow terminals may clip a grapheme wider than their entire width. No expansion performs I/O. `getTruncatedText` remains the compact-only component for call headers and specialized builtin layouts.

Use `displayLabel` for bounded single-line labels, not bodies. `expandedBodyResult`/`displayBody` remove terminal controls before styling while preserving spaces, line breaks and indentation (tabs become three spaces). Body input is capped at 64,000 characters, 2,000 logical lines, and 4,000 characters per logical line, with explicit source-truncation disclosure. Wrapped details are also bounded to 2,000 display rows plus a disclosure; complete source remains in model/session context. Sanitization is not generic secret detection: retain domain credential redaction before rendering. Keep spill/recovery references visible. Renderer summaries must not infer outcomes from arbitrary untrusted body prose.

### Surface inventory and exceptions

| Surface                                                      | Projection                                                                                                                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Background Script, Workflow and Subagent run/control results | Shared `background/render.ts`: semantic lifecycle, independent warnings, muted telemetry; additive retained evidence                                                                              |
| Script foreground run/describe and saved list/validate       | Host accounting, provider names, semantic traces and safe static diagnostics; no source/arguments or arbitrary return-value previews                                                              |
| Workflow list/validate and pre-admission errors              | Saved count/validation summary, expanded inventory/source/diagnostics; validation is not execution                                                                                                |
| Historical foreground Subagent and Workflow snapshots        | Generic sanitized original text fallback, not obsolete multi-agent/progress layouts or guessed Background envelopes; history/recovery data is untouched                                           |
| Monitor                                                      | Observation state, independently styled attention/uncertainty and muted counters; success means a trigger, not watched-task completion                                                            |
| Mailbox                                                      | Persistence/page/ack counts, expanded untrusted messages and metadata; send is not consumption and ack is not resolution                                                                          |
| MCP Gateway                                                  | Silent ordinary describe/call success; search counts, visible errors/uncertainty/spill limits; wrapped framed evidence with gateway credential redaction                                          |
| Web access                                                   | Silent ordinary fetch success; useful search/page counts and spill/error summaries; wrapped evidence                                                                                              |
| TODO                                                         | Count/error summary and expanded literal task list; task status punctuation belongs to literal output                                                                                             |
| Structured output                                            | Intentional host-native exception: the terminating schema-capture tool has no custom renderer and returns only a short fixed capture acknowledgment; it does not render private structured values |
| Builtins                                                     | Explicit specialized/native exception: preserve Bash tails/first-line errors, directory/find heads, grep counts, silent reads and existing diagnostic expansion                                   |

Builtin rendering is **not** migrated to the generic layout. Bash success shows up to three trailing nonempty lines; failure shows only the first nonempty line in error color, identically in both views. Other builtins retain bounded diagnostics and spill references even when compact output is silent. The legacy `expandedResult` projection is isolated for builtin compatibility. Preserve specialized credential masking and regression tests.

Retired renderer-only foreground progress functions are removed after checking consumers. Activity extraction, stored snapshots, accounting and recovery evidence remain execution concerns. The obsolete Workflow `maxVisibleSettledAgents` setting/environment override is ignored with a diagnostic; no stored result is migrated or deleted.

### Before and after examples

Plain text below is separate from style annotations. Ellipses within literal evidence are not rewritten.

| Before                                                      | After                                                        | Style annotations                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| `Calling example.lookup...`                                 | `calling example.lookup…`                                    | Active text: accent, not warning                             |
| `condition met; follow-up queued · 0 wakes · 4 evaluations` | `condition met · follow-up queued · 0 wakes · 4 evaluations` | State: success; follow-up: warning; counts: muted; dots: dim |
| `Running · a1b2c3d4`                                        | `running… · a1b2c3d4`                                        | State: accent; ID: text; dot: dim                            |
| `12345678 \| report \| timestamp`                           | `12345678 · report · timestamp`                              | Identity/type: text; timestamp: muted; dots: dim             |

Expanded Background example (first line is byte-for-byte the same styled compact projection at the same width):

```text
succeeded · 9s

  execution: Example · a1b2c3d4
{
  "nested": {
    "value": "long content wraps instead of clipping"
  }
}
```

The state is success-colored; duration and metadata label are muted; separators are dim; values and body use text. For a silent MCP call, the JSON starts directly—no empty summary or leading separator line. A validated Script with no further metadata stays one line in either view.

### Verification

Test semantic color tokens separately from plain-text layout. Assert identical compact prefixes, blank-line exceptions, narrow/wide wrapping versus truncation, bounded output, indentation, hostile controls, cancellation, current inventory/validation/error paths and historical fallback. Keep builtin regression coverage unchanged. Retain representative isolated fixture captures at narrow/wide widths with real light/dark theme tokens. Such captures and deterministic assertions are not live terminal/perceived-contrast qualification; disclose unrun live checks and never install, link or reload a user's session to obtain them without authorization.

## Asynchronous custom messages

`notificationRenderer("background" | "monitor")` returns Pi's supported `MessageRenderer`. Register it on the producer's custom message type. The helper has no lifecycle callbacks, persistence, timers, fetching or execution. It does not change the message or mark anything delivered/consumed/accepted. Tool rows and widgets remain separate surfaces.

Producers retain their existing `details.executionId` or `details.jobId` and may add `details.display: NotificationDisplay`: `version: 1`, nonsecret `name`, optional adapter `owner`, producer `status`, and boolean `outcomeUnknown`, `effectsMayPersist`, `interrupted`, `gap`, optional typed `total` (for singular one-child Subagents), and `mode: "timer" | "observation"` (Monitor). This snapshot is not an authoritative receipt. Only own data properties are read; unknown versions/statuses use a source-labelled `status unavailable`, never parsed instruction prose. Missing optional fields are omitted.

Collapsed output is one line: Background execution type and state, bounded name, then actionable warnings; Monitor retains its reason/warning-first ordering. Background uses `succeeded`, `failed`, and `canceled` with success/error/warning colors. Generic `effects may persist` is not derived from dispatch/restoration flags: those flags do not establish writes and include read-only work. Neither compact nor expanded projections invent mutation warnings. Actual unknown outcomes, interruption and coverage/persistence failures remain visible; underlying effect metadata and no-replay behavior are unchanged. Monitor reasons have no `attention` prefix: condition met/timer elapsed use success styling for a normally reached trigger (not watched-task completion), timeout uses warning styling, and evaluation/coverage failures use error styling. Actionable warnings retain their independent warning color. Examples: `script succeeded Demo prime numbers`, `subagent succeeded Compare two powers`, `monitor condition met CI check`, `monitor timer elapsed timer demo`, `monitor timed out CI check`. It uses `customMessageBg` without icons, borders, padding or middle-dot separators, distinguishing notifications from tool rows. Full IDs remain expanded. At supported narrow widths of 48 content columns and above, compact status/warning wording (`unknown`, `interrupted`, `gap`) preserves essential facts before optional identity; smaller widths stay bounded but may truncate essential text. Timer wording comes only from typed producer metadata. Missing batch cardinality uses plural `subagents`, never a guessed count. Normal expansion reveals full bounded identity, warnings and original text/trust framing as plain terminal-safe text, not executable links or Markdown. It does not fetch retained references. Collapse restores the same compact projection.

Display labels are bounded to 200 characters (adapter: 48); controls, format controls and embedded label newlines are removed before styling, then Unicode column fitting applies. Expansion projects text blocks only, bounds body input to 64,000 characters and body layout to 2,000 rows, and explicitly discloses display truncation. Complete original content stays in session/model context; normal producer messages fit these limits, retaining instructions and inspection/result references. No secret detection is claimed. No horizontal or vertical padding is added. The background fills the available content width. Theme styles are computed at render time. See the [authoring conventions](../../../../.pi/skills/create-extension/SKILL.md#asynchronous-custom-messages).

## Retained diagnostics

`retained-artifacts.ts` owns `${tmpdir()}/pi-retained-diagnostics` for exactly two finalized artifact classes: subagent `.log.gz` files and workflow recovery `.json.gz` files. The root must be a real current-user-owned directory and is hardened to mode `0700`. Gzip staging and final files use exclusive mode `0600` creation. Staging names are not finalization or eviction candidates; complete files are published without overwrite by same-directory hard link while a current-user-owned cross-process lock serializes cleanup, quota reservation, and publication.

Finalized compressed artifacts share a fixed 1 GiB quota measured in on-disk compressed bytes. Each artifact operation lazily removes recognized finalized files older than seven days, then evicts the oldest recognized finalized files until the new file fits. A single oversized file, lock contention, failed required eviction, unsafe root, compression/storage error, or inability to remain within quota discards the new diagnostic and returns a bounded warning. Active staging, live-process staging, symlinks, directories, and unrelated files are not quota/eviction candidates. Old staging from a demonstrably dead process is eligible for lazy removal only after seven days.

These files are sensitive. Gzip is compression, not sanitization or encryption. The helper never previews contents or sends them to a provider. Callers expose only finalized paths and bounded metadata. Generic spillover, workflow source-script copies, statusline/MCP logs, and other `logging.ts` consumers remain outside this pool. During migration, recognized legacy raw subagent `.log` files are eligible only for the same seven-day lazy age cleanup and never count toward the compressed quota.

## Spillover behavior

`spillover.ts` uses these defaults:

- `THRESHOLD_CHARS = 25_000`
- `PREVIEW_BYTES = 2_000`
- `SPILL_DIR = join(tmpdir(), "pi-extension-spillover")`

When joined text content exceeds the threshold, the helper requires `<SPILL_DIR>` to be a real directory owned by the current user, sets its mode to `0700`, and writes the full joined text to `<SPILL_DIR>/<toolCallId>.txt` with exclusive creation and mode `0600`. Returned content replaces text blocks with a single `<persisted-output>` envelope at the first text-block position; non-text blocks such as images are preserved. If directory validation, permission hardening, or writing fails, the original content is returned unchanged.
