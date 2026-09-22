import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("stack and standalone reuse one launch/decision protocol without adopting stack records", async () => {
  const stack = await read("./SKILL.md");
  const wrapper = await read("./references/decisions.md");
  const standalone = await read("../spin-out/SKILL.md");
  const shared = await read("../spin-out/references/decisions.md");
  assert.match(
    stack,
    /shared launch procedure.*spin-out\/references\/launch.md/,
  );
  assert.match(
    standalone,
    /shared exact-base launch procedure.*references\/launch.md/,
  );
  assert.match(
    wrapper,
    /shared managed decision protocol.*spin-out\/references\/decisions.md/,
  );
  assert.doesNotMatch(wrapper, /herdr pane run/);
  assert.match(
    shared,
    /herdr pane run <root-pane-id> 'env PI_ASK_USER_MODE=parent pi'/,
  );
  assert.match(
    shared,
    /prefix on the parent's `herdr agent start`.*does \*\*not\*\*/,
  );
  assert.match(shared, /confirms submission, not Pi readiness/);
  assert.match(shared, /do not submit another launch/);
  assert.match(
    standalone,
    /Standalone spin-outs leave ask-user mode unchanged/,
  );
  assert.match(stack, /Keep existing stack records\/recovery/);
  assert.match(wrapper, /no automatic migration or intermediate manager/);
  assert.match(wrapper, /blocks successor launch/);
});

test("shared decisions preserve nonanswers/correlation while concurrent questions avoid modal waits", async () => {
  const shared = await read("../spin-out/references/decisions.md");
  const wrapper = await read("./references/decisions.md");
  for (const pattern of [
    /decision_required/,
    /No message from a worker, observer or extension grants human approval/,
    /assignment ID\/revision/,
    /request ID, current head and decision context revision/,
    /question, options\/trade-offs, recommendation/,
    /ordinary message, not modal/,
    /Repeated attention/,
    /cancelled and unanswered|cancelled\/unanswered|cancelled\/unanswered/i,
    /Submission alone does not prove application/,
    /do not blindly replay a prompt/,
    /an answer alone does not replenish budgets/,
  ])
    assert.match(shared, pattern);
  assert.match(wrapper, /Cancel\/reconcile.*before asking the human/);
  assert.match(
    wrapper,
    /Advance only after all existing work-stack delivery-boundary and predecessor checks pass/,
  );
});
