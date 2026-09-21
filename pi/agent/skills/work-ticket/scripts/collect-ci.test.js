import assert from "node:assert/strict";
import test from "node:test";
import { collectCI, ciSource } from "./collect-ci.js";
import { fixture, echo } from "../../../extensions/script/fixture.ts";
import { registerScriptProvider } from "../../../extensions/script/api.ts";
import { evaluateBackground } from "../../../extensions/background/execution.ts";
import {
  registration,
  observation,
} from "../../../extensions/background/contract.ts";
const target = {
  owner: "example",
  repo: "project",
  pullNumber: 1,
  source: "avery/change",
  base: "main",
  head: "a".repeat(40),
  baseHead: "b".repeat(40),
  required: ["Verify"],
  requirementsReference: "Reviewed base CI workflow and ticket",
};
const check = (id = 101, name = "Verify", runId = 201) => ({
  id,
  name,
  html_url: `https://github.com/example/project/actions/runs/${runId}/job/${id}`,
});
const run = (id = 201) => ({
  id,
  workflow_id: id + 100,
  run_number: 1,
  run_attempt: 1,
  event: "pull_request",
  head_sha: target.head,
  head_branch: target.source,
});
const job = (id = 101, name = "Verify", runId = 201) => ({
  id,
  name,
  run_id: runId,
  run_attempt: 1,
  head_sha: target.head,
  head_branch: target.source,
  status: "completed",
  conclusion: "success",
});
function gateway(change = () => {}) {
  const calls = [];
  const api = {
    async call(tool, args) {
      calls.push({ tool, args });
      let value;
      if (args.method === "get")
        value = {
          number: 1,
          html_url: "https://github.com/example/project/pull/1",
          state: "open",
          head: {
            sha: target.head,
            ref: target.source,
            repo: { full_name: "example/project" },
          },
          base: {
            sha: target.baseHead,
            ref: target.base,
            repo: { full_name: "example/project" },
          },
        };
      if (args.method === "get_check_runs")
        value = { total_count: 1, check_runs: [check()] };
      if (args.method === "get_status")
        value = { sha: target.head, total_count: 0, statuses: [] };
      if (args.method === "list_workflow_runs")
        value = { total_count: 1, workflow_runs: [run()] };
      if (args.method === "list_workflow_jobs")
        value = { jobs: { total_count: 1, jobs: [job()] } };
      change(value, args, calls);
      return { content: [{ type: "text", text: JSON.stringify(value) }] };
    },
  };
  return { api, calls };
}
test("parameterized collection pins both PR reads and exact job/run attempt", async () => {
  const f = gateway();
  const result = await collectCI(f.api, target);
  assert.equal(result.evidence.reason, "passed");
  assert.equal(result.evidence.complete, true);
  assert.equal(f.calls.length, 6);
  assert.equal(f.calls.at(-1).args.method, "get");
  assert.deepEqual(result.evidence.checks, [
    { name: "Verify", state: "passed", id: 101, runId: 201, attempt: 1 },
  ]);
});
test("three checks in one or three workflows qualify within unchanged eight-call cap", async () => {
  for (const separateRuns of [false, true]) {
    const names = ["Lint", "Test", "Build"];
    const f = gateway((v, a) => {
      if (a.method === "get_check_runs") {
        v.check_runs = names.map((name, i) =>
          check(101 + i, name, separateRuns ? 201 + i : 201),
        );
        v.total_count = 3;
      }
      if (a.method === "list_workflow_runs") {
        v.workflow_runs = separateRuns
          ? [run(201), run(202), run(203)]
          : [run()];
        v.total_count = v.workflow_runs.length;
      }
      if (a.method === "list_workflow_jobs") {
        v.jobs.jobs = names
          .map((name, i) => job(101 + i, name, separateRuns ? 201 + i : 201))
          .filter((j) => String(j.run_id) === a.resource_id);
        v.jobs.total_count = v.jobs.jobs.length;
      }
    });
    const result = await collectCI(f.api, { ...target, required: names });
    assert.equal(result.evidence.reason, "passed");
    assert.deepEqual(
      result.evidence.checks.map((c) => c.name),
      names,
    );
    assert.equal(f.calls.length, separateRuns ? 8 : 6);
  }
});
test("wrong head, stale attempt, changed base, skipped, duplicate and incomplete inventories never pass", async () => {
  for (const change of [
    (v, a) => {
      if (a.method === "list_workflow_jobs")
        v.jobs.jobs[0].head_sha = "c".repeat(40);
    },
    (v, a) => {
      if (a.method === "list_workflow_runs") v.workflow_runs[0].run_attempt = 2;
    },
    (v, a, calls) => {
      if (a.method === "get" && calls.length > 1) v.base.sha = "c".repeat(40);
    },
    (v, a) => {
      if (a.method === "list_workflow_jobs")
        v.jobs.jobs[0].conclusion = "skipped";
    },
    (v, a) => {
      if (a.method === "get_check_runs") {
        v.check_runs.push(v.check_runs[0]);
        v.total_count = 2;
      }
    },
    (v, a) => {
      if (a.method === "get_check_runs") v.total_count = 1000;
    },
    (v, a) => {
      if (a.method === "get_check_runs") {
        v.check_runs = [];
        v.total_count = 1;
      }
    },
    (v, a) => {
      if (a.method === "list_workflow_runs") {
        v.workflow_runs = [];
        v.total_count = 0;
      }
    },
  ]) {
    const f = gateway(change);
    const result = await collectCI(f.api, target);
    assert.equal(result.decision, "wake");
    assert.equal(result.evidence.complete, false);
    assert.ok(f.calls.length <= 8);
  }
});
test("pagination and duplicate attempts select latest only within a proven workflow", async () => {
  const f = gateway((v, a) => {
    if (a.method === "get_check_runs") {
      v.check_runs.push(check(102));
      v.total_count = 2;
    }
    if (a.method === "list_workflow_jobs") {
      v.jobs.jobs = [{ ...job(102), run_attempt: 2 }];
    }
    if (a.method === "list_workflow_runs") v.workflow_runs[0].run_attempt = 2;
  });
  const result = await collectCI(f.api, target);
  assert.equal(result.evidence.reason, "passed");
  assert.equal(result.evidence.checks[0].id, 102);
  const p = gateway((v, a) => {
    if (a.method === "get_check_runs") {
      v.total_count = 101;
      v.check_runs =
        a.page === 1
          ? Array.from({ length: 100 }, (_, i) =>
              check(i + 1, `unrelated-${i}`),
            )
          : [check()];
    }
  });
  assert.equal((await collectCI(p.api, target)).evidence.reason, "passed");
  assert.equal(
    p.calls.filter((c) => c.args.method === "get_check_runs").length,
    2,
  );
});
test("newly superseding run, incomplete job pages and inventories beyond eight calls stay incomplete", async () => {
  for (const change of [
    (v, a) => {
      if (a.method === "list_workflow_runs") {
        v.workflow_runs.push({ ...run(202), workflow_id: 301, run_number: 2 });
        v.total_count = 2;
      }
    },
    (v, a) => {
      if (a.method === "list_workflow_jobs") v.jobs.total_count = 1000;
    },
    (v, a) => {
      if (a.method === "list_workflow_jobs") {
        v.jobs.jobs.push(job(102));
        v.jobs.total_count = 2;
      }
    },
  ]) {
    const f = gateway(change);
    const result = await collectCI(f.api, target);
    assert.equal(result.evidence.complete, false);
    assert.ok(f.calls.length <= 8);
  }
  const names = ["Lint", "Test", "Build", "Security"];
  const f = gateway((v, a) => {
    if (a.method === "get_check_runs") {
      v.check_runs = names.map((name, i) => check(101 + i, name, 201 + i));
      v.total_count = 4;
    }
    if (a.method === "list_workflow_runs") {
      v.workflow_runs = names.map((_, i) => run(201 + i));
      v.total_count = 4;
    }
    if (a.method === "list_workflow_jobs") {
      const i = Number(a.resource_id) - 201;
      v.jobs.jobs = [job(101 + i, names[i], 201 + i)];
    }
  });
  const result = await collectCI(f.api, { ...target, required: names });
  assert.equal(result.evidence.reason, "collection_call_bound");
  assert.equal(result.evidence.complete, false);
  assert.equal(f.calls.length, 8);
});
test("actual fresh Script evaluator runs generated source without injected-state redeclaration", async (t) => {
  const f = await fixture(t, { echo });
  await f.config({ allowedProviders: ["mcp"] });
  const g = gateway((v, a) => {
    if (a.method === "list_workflow_jobs")
      v.jobs.jobs[0].status = "in_progress";
  });
  const dispose = registerScriptProvider(f.pi, {
    namespace: "mcp",
    available: () => true,
    methods: {
      call: {
        description: "Synthetic discovered Gateway envelopes",
        inputSchema: {
          type: "array",
          items: [{ type: "string" }, { type: "object" }],
          minItems: 2,
          maxItems: 2,
          additionalItems: false,
        },
        handler: async ([tool, args]) => ({
          value: await g.api.call(tool, args),
        }),
      },
    },
  });
  t.after(dispose);
  const reg = registration({
    name: "fixture",
    message: "Reconcile",
    providers: ["mcp"],
    source: ciSource(target),
    interval_ms: 1000,
    cycle_timeout_ms: 10000,
    lifetime_ms: 10000,
    max_wakes: 1,
  });
  const result = await evaluateBackground(
    f.pi,
    f.dir,
    reg,
    { kind: "initial", at: 1 },
    { sentinel: true },
    new AbortController().signal,
    Date.now() + 10000,
  );
  assert.equal(result.status, "success", result.code);
  assert.equal(observation(result).decision, "wait");
  assert.equal(observation(result).evidence.reason, "pending");
  assert.equal(g.calls.length, 6);
});
