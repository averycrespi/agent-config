# Performance

Review the supplied changes for evidenced efficiency and resource-management regressions. Follow the reviewer agent's common scope, evidence, confidence, severity, and output contract.

Focus on:

- N+1 database, API, filesystem, or tool-call patterns
- avoidable algorithmic complexity on plausibly large inputs
- blocking operations in async or latency-sensitive paths
- unbounded reads, queries, loops, queues, retries, or retained state
- missing pagination, batching, backpressure, or cleanup
- excessive payloads, allocations, re-renders, or recomputation on hot paths
- leaked connections, handles, subscriptions, processes, or temporary resources

State the workload or scale condition that triggers the problem. Do not report speculative micro-optimizations without evidence that the affected path is material.
