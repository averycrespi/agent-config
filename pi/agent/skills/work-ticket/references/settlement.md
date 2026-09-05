# Settlement, Cancellation, and Cleanup

Read this procedure completely before any settlement, cancellation, or cleanup action. Follow [work-ticket](../SKILL.md) and read [the helper interface](helper.md) before helper calls. Each operation needs explicit authority; implementation or publication approval does not supply it.

Do not merge or deploy automatically. Done requires explicit settlement authority and confirmed effects; for PR settlement require the merged head to match the reviewed/published head. Canceled requires explicit cancellation authority and confirmed Plane state.

Before recording a pending external write, gate settlement on completed local delivery or confirmed merged reviewed PR head. Settlement gates and pending external writes require `mergeConfirmed: true` and exact `mergedHead` for PR delivery.

Cleanup is separately authorized. Gate cleanup on settled/canceled disposition, a clean checkout, no live writer, known PR state, matching Plane state, and proof no unpushed work will be lost. Cleanup gates and pending writes require `noLiveWriter`, `noUnpushedWork`, and `prDispositionKnown` all true plus matching `planeState: Done/Canceled`; establish these from fresh process, Git/remote, PR, and Plane observations. The helper also rejects a dirty checkout or another nonterminal ticket owner before cleanup. Authority alone cannot satisfy these pre-write gates.

Persist exact external-write intent before calling, reread the authoritative surface afterward, and record confirmation. On ambiguous outcomes, reread first and retry once only after proving the effect absent. Use Herdr for exact linked worktree removal without force; do not bundle remote-branch deletion or state deletion. Preserve state unless its deletion is separately authorized. Report confirmed effects and retained resources, not merely successful submissions.
