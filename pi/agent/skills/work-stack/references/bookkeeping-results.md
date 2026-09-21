# Bookkeeping qualification

The reduction is in model-maintained arithmetic and copied evidence, not in every filesystem write. Machine accounting adds small authoritative mutations while removing supplementary prose ledgers. These results do not estimate cost or latency.

## Deterministic evidence

`bookkeeping.test.js` uses the same sanitized three-ticket snapshot and 30 routine wakes. The append-narrative baseline grows from **2,564 to 6,815 bytes**; replace-current-value output stays **2,564 bytes**. This is a modeled failure pattern, not a claim that baseline instructions require appending logs. New unresolved facts must still be retained.

The actual helper/producer tests establish:

- External confirmation retains its evidence in the same atomic write: no separate copy-only checkpoint. Final patch plus release uses one write rather than checkpoint then release; invalid state/owner leaves original bytes unchanged.
- Review output and host receipts are retained at their producer boundaries and consumed by digest/reference, without model transcription. Unicode, CRLF and trailing spaces survive unchanged; failed retention does not rerun work.
- Parent and child accounting remain separate. Reservations, unknown handoffs, prior usage, original deadlines and explicit additions survive recovery. Expiry never changes child authority.
- CI collection executes the generated source in a real fresh Script child; wrong identity, incomplete pagination, stale/ambiguous attempts and unknown conclusions do not pass.

The modeled operation inventories in the size test report the proposed mechanical reduction separately from required safety work: registration-race reconciliation is unchanged (five operations); interrupted confirmation/finalization drops from five to three; report retention from three to two. These inventories are not observed agent call counts.

## Bounded agent observations

Two independent read-only `balanced` agents received the same seven sanitized cases. One read baseline contracts at `e56859c`; the other read revised contracts. Neither executed actions, mutated state, observed live jobs or qualified a real delivery. Complete original workflow output and its source were retained outside tracked source; the table reports UTF-8 snapshot sizes and each agent's proposed bookkeeping-mutation count.

| Case                     | Baseline bytes / mutations | Revised bytes / mutations |
| ------------------------ | -------------------------: | ------------------------: |
| Routine wakes            |                  2,527 / 2 |                 2,476 / 3 |
| Child CI waiting         |                  2,271 / 2 |                 2,520 / 4 |
| Registration race        |                  2,505 / 2 |                 2,703 / 4 |
| Parent expiry            |                  2,312 / 1 |                 2,539 / 1 |
| Interrupted confirmation |                  2,223 / 4 |                 2,468 / 3 |
| Report retention         |                  2,269 / 1 |                 2,401 / 2 |
| Authorized resume        |                  2,412 / 2 |                 3,158 / 2 |

Both proposed zero duplicate report/fact copies and zero unnecessary release/reclaim handoffs. Both preserved child authority on parent expiry and withheld advancement for pending CI. The revised routine/CI snapshots referenced machine accounting instead of repeating the baseline's duration, deadline projection, consumed count and reservation arithmetic. Interrupted finalization removed one proposed mutation. **No aggregate snapshot-size or mutation-count improvement was observed**: revised totals were 18,265 bytes/19 proposed mutations versus 16,519/14. Counts were self-reported and not perfectly normalized (artifact writes versus helper calls), so they are not execution benchmarks.

The first revised response missed the opt-in report-retention entry point and proposed manual artifact persistence; a registration-race response also escalated before checking delegated choice authority. The work-ticket entry point now explicitly names `retain: true`. A focused read-only follow-up using the full relevant review and parent-decision contracts selected host retention with no manual report copying, and a labeled in-scope parent decision followed by exact-observer reconciliation and one correlated continuation of the same child. This is bounded instruction-following evidence, not proof of universal compliance.

## Coverage limits

The tested replacement format is bounded and the producer/helper changes eliminate specific duplicate copies and model arithmetic. The observed agents do not establish generally smaller responses or fewer tool calls. No live installation/reload, real multi-child exercise, suspend/clock-jump qualification, or model-consumption guarantee was performed. Preserve full boundary qualification, ACK-gap reconciliation and uncertain effects even when they cost additional work. The reusable CI collector is deliberately fail-closed outside its discovered Actions projection and eight-call inventory bound.
