# Mailbox design

Durable storage is independent of session lifetime and notification coverage. Mailbox owns bytes and hints; Monitor owns clocks, evaluator execution and attention; coordination guidance owns report semantics and human authority.

## Storage

`store.ts` validates bounded caller inputs before taking a cooperative cross-process lock. A mutation reads and validates the entire bounded state, computes its replacement privately, checks quota, exclusively writes a staging file, fsyncs, atomically renames, and fsyncs the directory. Readers never see partial JSON and need no lock. State includes a random incarnation and a monotonic sequence; acknowledgments do not renumber remaining rows. Cursor scans pin an incarnation and high-water mark but omit rows acknowledged concurrently. New sends require another scan.

The store never silently ages or evicts unacknowledged messages. Ack deletes rows while retaining sequence/incarnation for stable cursors and idempotent repeat removal. It does not retain message bodies as a transcript. Per-mailbox bounds constrain parsing/mutation work; no total-root quota is implied. Crashed cooperative locks are fail-closed manual recovery, not automatically stolen. Rename uncertainty is surfaced separately from pre-publication rejection. Same-user malicious processes and unsupported filesystem durability semantics are outside this cooperative boundary.

## Provider and lifecycle

`index.ts` registers one direct tool and an explicitly selected Script/Monitor provider. Registration starts no resources. Session startup marks availability; shutdown disposes selections and watchers without touching messages. Each subscription watches the stable parent directory so atomic file replacement does not detach it. It forwards minimal address-only hints; initial durable listing plus polling closes pre-registration and notification-loss gaps. Mailbox adds no scheduler or persistent interpreter.

Content is untrusted and is framed at the direct-tool boundary. `render.ts` is a display-only adapter: it recognizes and validates the existing bounded direct-result frame without changing `content`, `details`, storage or provider results. Missing, malformed, semantic-error and framework-error results cannot become successful summaries. Report bodies are opaque text, not domain-specific coordination state. The call carries mailbox/action; the flush-left outcome carries only persistence, paging, ack, progress or failure facts, never repeats the address. Expanded previews are bounded and labelled untrusted; controls and embedded newlines are removed before styling. The shared truncated component is reused across updates; no rendering timers or extra state are owned here. Page counts are not inbox counts, scan completion is not emptiness, and ack counts cannot identify removed IDs. Script methods return bounded plain JSON and map storage errors to fixed declared codes; host failures remain sticky. No authorization is inferred from addresses, report text or provider permission.

## Verification

Renderer fixtures cover stable headers, collapsed/expanded send/list/ack, partial and error styling, uncertain persistence, empty cursor pages with later arrivals, no-op acknowledgments, hostile controls and narrow widths. Real direct-tool fixtures preserve exact untrusted envelopes and provider/store regressions remain unchanged. These fixtures do not qualify a live TUI.

Store regressions cover subprocess restart, cursor stability under concurrent sends/acks, bounded inspection, invalid atomic input, corrupt/symlink storage and lock contention. Provider fixtures execute real Script children, exercise host policy, filesystem hints and durable retention despite bus notification failure. Monitor and coordination fixtures separately test batching, pending attention, project-state-before-ack recovery and answer correlation. They do not prove model compliance, actual human draft preservation or live Herdr relay. Use the separately authorized live recipe; do not install or reload candidate configuration implicitly.
