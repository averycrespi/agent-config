import {
  loadAgents,
  spawnSubagent,
  type AgentDefinition,
  type SpawnInvocation,
  type SpawnOutcome,
} from "../subagents/api.ts";
import { wrapUntrustedContent } from "../_shared/untrusted.ts";
import type { GoalReviewFinding } from "./state.ts";

const MAX_SUMMARY_CHARS = 1_000;
const MAX_FINDINGS = 10;
const MAX_DESCRIPTION_CHARS = 800;
const MAX_EVIDENCE_CHARS = 500;
const MAX_LOCATION_CHARS = 200;
const MAX_FIX_CHARS = 500;
const MAX_SERIALIZED_CHARS = 20_000;

export const GOAL_REVIEW_SCHEMA = {
  type: "object",
  required: ["summary", "findings"],
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "confidence", "description", "evidence"],
        additionalProperties: false,
        properties: {
          severity: {
            type: "string",
            enum: ["blocker", "important", "suggestion"],
          },
          confidence: { type: "number" },
          description: { type: "string" },
          evidence: { type: "string" },
          location: { type: "string" },
          suggested_fix: { type: "string" },
        },
      },
    },
  },
} as const;

export const _reviewDeps = { loadAgents, spawnSubagent };
export const _reviewTimers = { setTimeout, clearTimeout };

type ValidReview = {
  ok: true;
  summary: string;
  findings: GoalReviewFinding[];
  blocking: boolean;
};
type InvalidReview = { ok: false; error: string };

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : undefined;
}

export function validateReviewOutput(
  value: unknown,
): ValidReview | InvalidReview {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { ok: false, error: "output must be an object" };
  const candidate = value as Record<string, unknown>;
  if (
    !exactKeys(candidate, ["summary", "findings"]) ||
    !("summary" in candidate) ||
    !("findings" in candidate)
  )
    return {
      ok: false,
      error: "output must contain exactly summary and findings",
    };
  const summary = boundedText(candidate.summary, MAX_SUMMARY_CHARS);
  if (!summary)
    return { ok: false, error: "summary is missing, empty, or oversized" };
  if (
    !Array.isArray(candidate.findings) ||
    candidate.findings.length > MAX_FINDINGS
  )
    return {
      ok: false,
      error: `findings must be an array of at most ${MAX_FINDINGS} items`,
    };

  const findings: GoalReviewFinding[] = [];
  for (const raw of candidate.findings) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return { ok: false, error: "each finding must be an object" };
    const finding = raw as Record<string, unknown>;
    if (
      !exactKeys(finding, [
        "severity",
        "confidence",
        "description",
        "evidence",
        "location",
        "suggested_fix",
      ])
    )
      return { ok: false, error: "finding contains unsupported fields" };
    if (
      finding.severity !== "blocker" &&
      finding.severity !== "important" &&
      finding.severity !== "suggestion"
    )
      return { ok: false, error: "finding severity is unsupported" };
    if (
      !Number.isInteger(finding.confidence) ||
      (finding.confidence as number) < 0 ||
      (finding.confidence as number) > 100
    )
      return {
        ok: false,
        error: "finding confidence must be an integer from 0 to 100",
      };
    const description = boundedText(finding.description, MAX_DESCRIPTION_CHARS);
    const evidence = boundedText(finding.evidence, MAX_EVIDENCE_CHARS);
    if (!description || !evidence)
      return {
        ok: false,
        error: "finding description and evidence must be non-empty and bounded",
      };
    const location =
      finding.location === undefined
        ? undefined
        : boundedText(finding.location, MAX_LOCATION_CHARS);
    const suggestedFix =
      finding.suggested_fix === undefined
        ? undefined
        : boundedText(finding.suggested_fix, MAX_FIX_CHARS);
    if (
      (finding.location !== undefined && !location) ||
      (finding.suggested_fix !== undefined && !suggestedFix)
    )
      return {
        ok: false,
        error: "optional finding text is empty or oversized",
      };
    if ((finding.confidence as number) < 80) continue;
    findings.push({
      severity: finding.severity,
      confidence: finding.confidence as number,
      description,
      evidence,
      ...(location ? { location } : {}),
      ...(suggestedFix ? { suggestedFix } : {}),
    });
  }
  const normalized = { summary, findings };
  if (JSON.stringify(normalized).length > MAX_SERIALIZED_CHARS)
    return { ok: false, error: "serialized review output is oversized" };
  return {
    ok: true,
    ...normalized,
    blocking: findings.some(
      (finding) =>
        finding.severity === "blocker" || finding.severity === "important",
    ),
  };
}

export function buildReviewPrompt(input: {
  objective: string;
  evidence: string;
  priorFindings?: GoalReviewFinding[];
}): string {
  const prior = input.priorFindings?.length
    ? `\n\nRe-review every previous blocking finding and determine whether current repository evidence resolves or refutes it.\n${wrapUntrustedContent("prior review findings", JSON.stringify(input.priorFindings))}`
    : "";
  return [
    "Independently audit this completion claim against every explicit objective requirement. Inspect referenced repository artifacts. Report only current, high-confidence findings; distinguish absent evidence from an implementation defect, and ignore pre-existing or preference-only issues. Do not run automatic verification commands or modify anything. Return the supplied structured output contract as your final action.",
    wrapUntrustedContent("goal", input.objective),
    wrapUntrustedContent("completion evidence", input.evidence) + prior,
  ].join("\n\n");
}

export type GoalReviewResult =
  | { kind: "pass"; summary: string; findings: GoalReviewFinding[] }
  | { kind: "block"; summary: string; findings: GoalReviewFinding[] }
  | {
      kind: "failure";
      code:
        | "missing_reviewer"
        | "spawn"
        | "invalid_output"
        | "timeout"
        | "cancelled";
      message: string;
      logFile?: string;
    };

export type GoalReviewRequest = {
  goalId: string;
  objective: string;
  evidence: string;
  priorFindings?: GoalReviewFinding[];
  cwd: string;
  timeoutSeconds: number;
  signal?: AbortSignal;
};

function resolveReviewer(
  agents: AgentDefinition[],
): AgentDefinition | undefined {
  return new Map(agents.map((agent) => [agent.name, agent])).get("reviewer");
}

function failureMessage(outcome: SpawnOutcome): string {
  return (outcome.errorMessage || outcome.stderr || "Reviewer subagent failed.")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export async function runGoalReview(
  request: GoalReviewRequest,
): Promise<GoalReviewResult> {
  let reviewer: AgentDefinition | undefined;
  try {
    reviewer = resolveReviewer(_reviewDeps.loadAgents());
  } catch (error) {
    return {
      kind: "failure",
      code: "missing_reviewer",
      message:
        `Could not load reviewer configuration: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          500,
        ),
    };
  }
  if (!reviewer)
    return {
      kind: "failure",
      code: "missing_reviewer",
      message: "The reviewer agent configuration is unavailable.",
    };

  const controller = new AbortController();
  let abortSource: "timeout" | "parent" | undefined;
  const onParentAbort = () => {
    if (!abortSource) abortSource = "parent";
    controller.abort(request.signal?.reason);
  };
  if (request.signal?.aborted) onParentAbort();
  else request.signal?.addEventListener("abort", onParentAbort, { once: true });
  const timer = _reviewTimers.setTimeout(() => {
    if (!abortSource) abortSource = "timeout";
    controller.abort(new Error("Goal review timed out."));
  }, request.timeoutSeconds * 1_000);

  const invocation: SpawnInvocation = {
    prompt: buildReviewPrompt(request),
    toolAllowlist: reviewer.tools,
    extensionAllowlist: reviewer.extensions,
    model: reviewer.model,
    thinking: reviewer.thinking,
    systemPrompt: reviewer.systemPrompt,
    env: reviewer.env,
    disableSkills: reviewer.disableSkills,
    disablePromptTemplates: reviewer.disablePromptTemplates,
    inheritSession: "none",
    cwd: request.cwd,
    signal: controller.signal,
    logId: `goal-review-${request.goalId}`,
    output: {
      schema: GOAL_REVIEW_SCHEMA as unknown as Record<string, unknown>,
    },
  };

  let outcome: SpawnOutcome;
  try {
    outcome = await _reviewDeps.spawnSubagent(invocation);
  } catch (error) {
    if (abortSource === "timeout")
      return {
        kind: "failure",
        code: "timeout",
        message: "Completion review timed out.",
      };
    if (abortSource === "parent")
      return {
        kind: "failure",
        code: "cancelled",
        message: "Completion review was cancelled.",
      };
    return {
      kind: "failure",
      code: "spawn",
      message:
        `Reviewer spawn failed: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          500,
        ),
    };
  } finally {
    _reviewTimers.clearTimeout(timer);
    request.signal?.removeEventListener("abort", onParentAbort);
  }
  if (abortSource === "timeout")
    return {
      kind: "failure",
      code: "timeout",
      message: "Completion review timed out.",
      ...(outcome.logFile ? { logFile: outcome.logFile } : {}),
    };
  if (abortSource === "parent")
    return {
      kind: "failure",
      code: "cancelled",
      message: "Completion review was cancelled.",
      ...(outcome.logFile ? { logFile: outcome.logFile } : {}),
    };
  if (!outcome.ok || !outcome.structured?.ok)
    return {
      kind: "failure",
      code: "spawn",
      message: failureMessage(outcome),
      ...(outcome.logFile ? { logFile: outcome.logFile } : {}),
    };
  const validated = validateReviewOutput(outcome.structured.value);
  if (!validated.ok)
    return {
      kind: "failure",
      code: "invalid_output",
      message: `Reviewer returned invalid structured output: ${validated.error}`,
    };
  return {
    kind: validated.blocking ? "block" : "pass",
    summary: validated.summary,
    findings: validated.findings,
  };
}
