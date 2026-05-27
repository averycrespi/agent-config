import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildModeContract,
  getManagedToolNamesForMode,
  getThinkingLevelForMode,
  PLAN_TEMPLATE,
} from "./modes.ts";

test("buildModeContract for plan mode includes collaborative discovery and plan-authoring guidance", () => {
  const contract = buildModeContract({
    mode: "plan",
  });

  assert.match(contract, /current mode: plan/i);
  assert.match(contract, /Plan mode outcome/i);
  assert.match(contract, /start with discovery/i);
  assert.match(
    contract,
    /purpose, constraints, success criteria, acceptance criteria/i,
  );
  assert.match(
    contract,
    /ask at least one focused requirements-discovery question/i,
  );
  assert.match(contract, /ask one focused question at a time/i);
  assert.match(contract, /recommended answer/i);
  assert.match(contract, /multiple-choice/i);
  assert.match(contract, /stop and wait for the user's answer/i);
  assert.match(contract, /exploring the repo/i);
  assert.match(contract, /2-3 viable approaches/i);
  assert.match(contract, /lead with your recommendation/i);
  assert.match(contract, /validate the chosen direction/i);
  assert.match(
    contract,
    /Do not call write_plan or edit_plan until discovery, exploration, and validation are complete/i,
  );
  assert.match(contract, /skip discovery for trivial mechanical tasks/i);
  assert.match(contract, /testable acceptance criteria/i);
  assert.match(contract, /Substantial plan files should use this template/i);
  assert.ok(contract.includes(PLAN_TEMPLATE));
  assert.match(contract, /AC-1:/);
  assert.match(contract, /### T1:/);
  assert.match(contract, /V1:/);
  assert.match(contract, /Documentation Impact/i);
  assert.match(contract, /no documentation updates are required/i);
  assert.match(contract, /Documentation Impact was followed/i);
  assert.match(contract, /YAGNI/i);
  assert.match(contract, /write_plan/i);
  assert.match(contract, /edit_plan/i);
  assert.match(contract, /\.plans\//i);
});

test("buildModeContract for execute mode encourages using relevant plan files without requiring one", () => {
  const contract = buildModeContract({
    mode: "execute",
    autoAdvanceEnabled: true,
  });

  assert.match(contract, /current mode: execute/i);
  assert.match(contract, /read relevant .*\.plans/i);
  assert.match(contract, /follow test-driven development/i);
  assert.match(contract, /meaningful implementation logic/i);
  assert.match(contract, /commit regularly/i);
  assert.match(contract, /logical checkpoints/i);
  assert.match(contract, /workflow_advance/i);
  assert.match(contract, /state="verify"/i);
  assert.match(contract, /state="aborted"/i);
  assert.doesNotMatch(contract, /state="completed"/i);
});

test("buildModeContract for execute mode avoids disabled automatic advance guidance", () => {
  const contract = buildModeContract({
    mode: "execute",
  });

  assert.doesNotMatch(contract, /call workflow_advance/i);
  assert.match(contract, /report that outcome to the user/i);
});

test("buildModeContract for verify mode explains advance outcomes", () => {
  const contract = buildModeContract({
    mode: "verify",
    autoAdvanceEnabled: true,
  });

  assert.match(contract, /workflow_advance/i);
  assert.match(contract, /state="execute"/i);
  assert.match(contract, /passes/i);
  assert.match(contract, /blocked/i);
  assert.match(contract, /unfixable/i);
});

test("buildModeContract for verify mode requires a structured verification report", () => {
  const contract = buildModeContract({
    mode: "verify",
  });

  assert.match(contract, /overall verdict/i);
  assert.match(contract, /pass.*fail.*blocked/i);
  assert.match(contract, /deterministic checks/i);
  assert.match(contract, /acceptance criterion/i);
  assert.match(contract, /pass.*fail.*n\/a.*unknown/i);
  assert.match(contract, /evidence/i);
  assert.match(contract, /findings.*next actions/i);
  assert.match(contract, /known issues/i);
});

test("buildModeContract for verify mode avoids disabled automatic advance guidance", () => {
  const contract = buildModeContract({
    mode: "verify",
  });

  assert.doesNotMatch(contract, /state="execute"/i);
  assert.match(contract, /report the needed fixes to the user/i);
});

test("mode helpers return the expected thinking defaults and tool sets", () => {
  assert.equal(getThinkingLevelForMode("normal"), undefined);
  assert.equal(getThinkingLevelForMode("plan"), "medium");
  assert.equal(getThinkingLevelForMode("execute"), "low");
  assert.equal(getThinkingLevelForMode("verify"), "high");

  const planTools = getManagedToolNamesForMode("plan");
  assert.ok(planTools.includes("read"));
  assert.ok(planTools.includes("write_plan"));
  assert.ok(planTools.includes("edit_plan"));
  assert.ok(planTools.includes("mcp_call"));
  assert.ok(!planTools.includes("bash"));
  assert.ok(!planTools.includes("edit"));
  assert.ok(!planTools.includes("write"));

  const executeTools = getManagedToolNamesForMode("execute");
  assert.ok(executeTools.includes("bash"));
  assert.ok(executeTools.includes("write"));
  assert.ok(!executeTools.includes("workflow_advance"));
  assert.ok(!executeTools.includes("write_plan"));
  assert.ok(!executeTools.includes("ask_user"));

  const verifyTools = getManagedToolNamesForMode("verify");
  assert.ok(verifyTools.includes("bash"));
  assert.ok(verifyTools.includes("ask_user"));
  assert.ok(!verifyTools.includes("workflow_advance"));
  assert.ok(!verifyTools.includes("write"));
  assert.ok(!verifyTools.includes("edit"));

  const executeToolsWithAdvance = getManagedToolNamesForMode("execute", {
    autoAdvanceEnabled: true,
  });
  assert.ok(executeToolsWithAdvance.includes("workflow_advance"));

  const verifyToolsWithAdvance = getManagedToolNamesForMode("verify", {
    autoAdvanceEnabled: true,
  });
  assert.ok(verifyToolsWithAdvance.includes("workflow_advance"));
});
