type Action = "run" | "describe";
type Diagnostic = { summary: string; guidance: string };

const DIAGNOSTICS: Record<string, Diagnostic> = {
  capability_denied: {
    summary: "provider selection denied by Script policy",
    guidance:
      "Inspect /script-config and the global allowedProviders list; policy changes require authorization.",
  },
  capability_unavailable: {
    summary: "selected provider unavailable",
    guidance:
      "Check provider extension loading and readiness; no fallback provider was selected.",
  },
  invalid_config: {
    summary: "invalid Script configuration",
    guidance:
      "Inspect /script-config, global settings, and SCRIPT_* environment overrides.",
  },
  invalid_selection: {
    summary: "invalid provider selection",
    guidance:
      "Supply an explicit array of unique provider namespace names; use [] for pure computation.",
  },
  provider_conflict: {
    summary: "conflicting provider registrations",
    guidance:
      "Inspect loaded extensions for duplicate Script namespaces; do not rely on load order.",
  },
  invalid_arguments: {
    summary: "provider arguments rejected",
    guidance:
      "Inspect the selected method's positional-array schema with script describe.",
  },
  invalid_source: {
    summary: "missing or invalid JavaScript body",
    guidance:
      "Supply a nonblank async JavaScript body in source, at most 256 KiB; modules are not supported.",
  },
  executor_unavailable: {
    summary: "Script executor unavailable",
    guidance:
      "Inspect the Script extension installation and qualified Node version; setup exceptions are suppressed.",
  },
  sandbox_error: {
    summary: "Script child process failed",
    guidance:
      "Check the qualified Node version and host process resources; do not disable isolation flags.",
  },
  sandbox_exit: {
    summary: "Script child exited before settlement",
    guidance:
      "Inspect host process resource limits and the Script runtime installation; child output is intentionally suppressed.",
  },
  ipc_error: {
    summary: "Script child communication failed",
    guidance:
      "Inspect the Script runtime installation and host process health; do not automatically replay dispatched work.",
  },
  invalid_ipc: {
    summary: "Script child protocol rejected",
    guidance:
      "Check the Script runtime installation and version compatibility; malformed child messages are not exposed.",
  },
  invalid_result: {
    summary: "explicit return is not strict JSON",
    guidance:
      "Explicitly return plain JSON, or null for no output; omit accessors, cycles, and non-JSON values.",
  },
  script_error: {
    summary: "guest script failed",
    guidance:
      "Inspect the JavaScript body and discovered method schemas; raw guest exceptions are suppressed.",
  },
  call_limit: {
    summary: "provider call limit exceeded",
    guidance:
      "Inspect /script-config and reduce attempted calls; queued calls also consume the limit.",
  },
  unfinished_calls: {
    summary: "returned with unfinished provider calls",
    guidance: "Await every provider call before returning.",
  },
  isolation_unavailable: {
    summary: "required isolation unavailable",
    guidance:
      "Use the qualified Node version; never remove permission flags to bypass this failure.",
  },
  nested_call_failed: {
    summary: "one or more provider calls failed",
    guidance:
      "Inspect failed call codes, the discovered method schemas, and provider documentation; guest catches do not erase host failures.",
  },
  provider_error: {
    summary: "provider operation failed",
    guidance:
      "Inspect the failed call traces and provider documentation; returned JSON does not override host failure.",
  },
  deadline_exceeded: {
    summary: "execution deadline exceeded",
    guidance:
      "Inspect /script-config and provider deadlines; timeout does not prove nonexecution.",
  },
  cancelled: {
    summary: "operation cancelled",
    guidance: "Cancellation is not rollback or proof of nonexecution.",
  },
  discovery_unavailable: {
    summary: "provider discovery unavailable",
    guidance:
      "Inspect /script-config and provider extension readiness; raw discovery exceptions are suppressed.",
  },
};

export function diagnostic(
  code: unknown,
  action: Action,
): Diagnostic | undefined {
  if (code === "output_limit")
    return action === "describe"
      ? {
          summary: "provider schemas exceed 24,000 bytes",
          guidance:
            "Select fewer providers for discovery; oversized schemas are not spilled.",
        }
      : {
          summary: "returned JSON exceeds 24,000 bytes",
          guidance:
            "Reduce the returned JSON to a compact selection; oversized results are not spilled.",
        };
  if (code === "ipc_limit")
    return {
      summary: "IPC envelope limit exceeded",
      guidance:
        "Reduce the size of provider arguments, intermediate results, or final JSON; inspect provider output limits.",
    };
  return typeof code === "string" && Object.hasOwn(DIAGNOSTICS, code)
    ? DIAGNOSTICS[code]
    : undefined;
}

// Only fixed core categories cross the discovery exception boundary.
export function discoveryCode(error: unknown, cancelled: boolean): string {
  if (cancelled) return "cancelled";
  return error instanceof Error &&
    [
      "capability_denied",
      "capability_unavailable",
      "invalid_config",
      "invalid_selection",
      "provider_conflict",
      "output_limit",
    ].includes(error.message)
    ? error.message
    : "discovery_unavailable";
}
