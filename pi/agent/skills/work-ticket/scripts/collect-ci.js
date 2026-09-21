// Self-contained for identical execution in Script and Background fresh children.
// Only the owning session schedules, retains receipts, or decides readiness.
export async function collectCI(mcp, target) {
  const headPattern = /^[a-f0-9]{40,64}$/;
  if (
    !target ||
    !/^[\w.-]+$/.test(target.owner) ||
    !/^[\w.-]+$/.test(target.repo) ||
    !Number.isSafeInteger(target.pullNumber) ||
    target.pullNumber < 1 ||
    !headPattern.test(target.head) ||
    !headPattern.test(target.baseHead) ||
    typeof target.source !== "string" ||
    !target.source ||
    typeof target.base !== "string" ||
    !target.base ||
    !Array.isArray(target.required) ||
    !target.required.length ||
    target.required.length > 100 ||
    target.required.some(
      (n) => typeof n !== "string" || !n || n.length > 200,
    ) ||
    new Set(target.required).size !== target.required.length ||
    typeof target.requirementsReference !== "string" ||
    !target.requirementsReference
  )
    throw new Error("invalid pinned CI collection target");
  const pr = `https://github.com/${target.owner}/${target.repo}/pull/${target.pullNumber}`;
  let calls = 0;
  const call = async (tool, args) => {
    if (++calls > 8) throw new Error("collection_call_bound");
    const raw = await mcp.call(tool, {
      owner: target.owner,
      repo: target.repo,
      ...args,
    });
    if (!raw || raw.isError) throw new Error("gateway_error");
    if (raw.structuredContent !== undefined) return raw.structuredContent;
    const texts = raw.content?.filter((c) => c.type === "text");
    if (texts?.length !== 1) throw new Error("unknown_gateway_envelope");
    return JSON.parse(texts[0].text);
  };
  const read = (method, extra = {}) =>
    call("github.pull_request_read", {
      method,
      pullNumber: target.pullNumber,
      ...extra,
    });
  const identity = (p) =>
    p?.number === target.pullNumber &&
    p.html_url === pr &&
    p.state === "open" &&
    p.head?.sha === target.head &&
    p.head.ref === target.source &&
    p.head.repo?.full_name === `${target.owner}/${target.repo}` &&
    p.base?.sha === target.baseHead &&
    p.base.ref === target.base &&
    p.base.repo?.full_name === `${target.owner}/${target.repo}`;
  const result = (reason, checks = [], complete = false) => {
    const evidence = {
      pr,
      head: target.head,
      baseHead: target.baseHead,
      complete,
      reason,
      checks,
    };
    if (JSON.stringify(evidence).length * 3 > 4096)
      return {
        decision: "wake",
        evidence: {
          pr,
          head: target.head,
          complete: false,
          reason: "evidence_bound",
        },
      };
    return {
      decision: complete && reason === "pending" ? "wait" : "wake",
      evidence,
    };
  };
  try {
    if (!identity(await read("get"))) return result("identity_changed");
    const pages = async (method, key, extra = {}) => {
      const items = [];
      let total;
      for (let page = 1; page <= 4; page++) {
        const envelope = method.startsWith("list_")
          ? await call("github.actions_list", {
              method,
              page,
              perPage: 100,
              ...extra,
            })
          : await read(method, { page, perPage: 100 });
        const batch =
          method === "list_workflow_jobs" ? envelope.jobs : envelope;
        if (
          !Number.isSafeInteger(batch?.total_count) ||
          batch.total_count < 0 ||
          !Array.isArray(batch[key]) ||
          batch[key].length > 100 ||
          (total !== undefined && batch.total_count !== total)
        )
          throw new Error("incomplete_inventory");
        if (method === "get_status" && batch.sha !== target.head)
          throw new Error("wrong_status_head");
        total = batch.total_count;
        items.push(...batch[key]);
        if (items.length === total) {
          if (new Set(items.map((x) => x.id)).size !== items.length)
            throw new Error("duplicate_page");
          return items;
        }
        if (!batch[key].length || items.length > total)
          throw new Error("incomplete_inventory");
      }
      throw new Error("pagination_bound");
    };
    const runs = await pages("get_check_runs", "check_runs");
    const statuses = await pages("get_status", "statuses");
    // Batch jobs by workflow run, not by required name. A run can contain many
    // checks; three independent runs still fit the unchanged eight-call ceiling.
    const jobsByRun = new Map();
    const idsByName = new Map();
    for (const name of target.required) {
      const matches = runs.filter((r) => r.name === name);
      if (!matches.length || statuses.some((s) => s.context === name))
        return result("missing_or_ambiguous_coverage");
      const runIds = new Set();
      for (const check of matches) {
        const prefix = `https://github.com/${target.owner}/${target.repo}/actions/runs/`;
        const suffix =
          typeof check.html_url === "string" &&
          check.html_url.startsWith(prefix)
            ? check.html_url.slice(prefix.length).match(/^(\d+)\/job\/(\d+)$/)
            : null;
        if (
          !Number.isSafeInteger(check.id) ||
          !suffix ||
          Number(suffix[2]) !== check.id ||
          !Number.isSafeInteger(Number(suffix[1]))
        )
          return result("invalid_check_identity");
        runIds.add(Number(suffix[1]));
      }
      idsByName.set(name, runIds);
      for (const id of runIds)
        if (!jobsByRun.has(id))
          jobsByRun.set(
            id,
            await pages("list_workflow_jobs", "jobs", {
              resource_id: String(id),
              workflow_jobs_filter: { filter: "latest" },
            }),
          );
    }
    // Read current attempts after job snapshots, catching reruns that supersede them.
    const workflowRuns = await pages("list_workflow_runs", "workflow_runs", {
      workflow_runs_filter: { branch: target.source },
    });
    const checks = [];
    for (const name of target.required) {
      const matches = runs.filter((r) => r.name === name);
      const runIds = idsByName.get(name);
      const candidates = workflowRuns.filter((r) => runIds.has(r.id));
      if (
        candidates.length !== runIds.size ||
        candidates.some(
          (r) =>
            r.head_sha !== target.head ||
            r.head_branch !== target.source ||
            !Number.isSafeInteger(r.workflow_id) ||
            !Number.isSafeInteger(r.run_number) ||
            !Number.isSafeInteger(r.run_attempt) ||
            r.run_attempt < 1,
        )
      )
        return result("wrong_or_unknown_job_identity");
      if (
        new Set(candidates.map((r) => r.workflow_id)).size !== 1 ||
        new Set(candidates.map((r) => r.event)).size !== 1 ||
        candidates.some((r) => !["push", "pull_request"].includes(r.event)) ||
        new Set(candidates.map((r) => r.run_number)).size !== candidates.length
      )
        return result("ambiguous_attempts");
      candidates.sort((a, b) => b.run_number - a.run_number);
      const run = candidates[0];
      if (
        workflowRuns.some(
          (r) =>
            r.workflow_id === run.workflow_id &&
            r.head_sha === target.head &&
            r.head_branch === target.source &&
            (!Number.isSafeInteger(r.run_number) ||
              r.run_number > run.run_number),
        )
      )
        return result("stale_attempt");
      const latestJobs = jobsByRun.get(run.id).filter((j) => j.name === name);
      if (latestJobs.length !== 1) return result("ambiguous_attempts");
      const latest = latestJobs[0];
      if (
        latest.head_sha !== target.head ||
        latest.head_branch !== target.source ||
        latest.run_id !== run.id ||
        latest.run_attempt !== run.run_attempt ||
        !matches.some((c) => c.id === latest.id)
      )
        return result("stale_attempt");
      const state =
        latest.status !== "completed"
          ? [
              "queued",
              "in_progress",
              "waiting",
              "pending",
              "requested",
            ].includes(latest.status)
            ? "pending"
            : "unknown"
          : ({
              success: "passed",
              failure: "failed",
              timed_out: "failed",
              action_required: "failed",
              cancelled: "canceled",
            }[latest.conclusion] ?? "unknown");
      checks.push({
        name,
        state,
        id: latest.id,
        runId: latest.run_id,
        attempt: latest.run_attempt,
      });
    }
    if (!identity(await read("get"))) return result("identity_changed");
    if (checks.some((c) => ["unknown", "canceled"].includes(c.state)))
      return result("unknown_conclusion", checks);
    return result(
      checks.some((c) => c.state === "failed")
        ? "failed"
        : checks.every((c) => c.state === "passed")
          ? "passed"
          : "pending",
      checks,
      true,
    );
  } catch (error) {
    // Script retains sticky host failures even when an evaluator returns attention.
    const allowed = [
      "collection_call_bound",
      "gateway_error",
      "unknown_gateway_envelope",
      "incomplete_inventory",
      "wrong_status_head",
      "duplicate_page",
      "pagination_bound",
    ];
    return result(
      allowed.includes(error.message) ? error.message : "collection_failure",
    );
  }
}

export function ciSource(target) {
  return `return await (${collectCI.toString()})(mcp, ${JSON.stringify(target)});`;
}
