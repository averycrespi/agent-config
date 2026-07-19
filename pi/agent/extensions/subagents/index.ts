import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createSubagentActivityTracker,
  type SubagentActivityTracker,
} from "./activity.ts";
import {
  loadSubagentsConfig,
  registerSubagentsConfigCommand,
  type SubagentsConfig,
} from "./config.ts";
import { createConcurrencyGate, type ConcurrencyGate } from "./pool.ts";
import { getActivity, renderAgentsCall, renderAgentsResult } from "./render.ts";
import {
  formatSpawnFailure,
  resolveSubagentRequest,
  runSubagent,
  validatePreparedExtensions,
  type LiveModelRegistry,
  type RunSubagentRequest,
} from "./run.ts";
import { validateOutputSchema } from "./schema.ts";
import { spillIfNeeded } from "../_shared/spillover.ts";
import {
  buildSpawnAgentsParams,
  CAPABILITIES,
  DEFAULT_MAX_CONCURRENCY,
  MAX_AGENTS_PER_CALL,
  MODEL_TIERS,
  THINKING_LEVELS,
  type SpawnAgentItem,
  type SpawnAgentsParams,
  type SubagentRunState,
} from "./types.ts";

export const _runSubagent = { fn: runSubagent };

const text = (value: string) => [{ type: "text" as const, text: value }];

type OnUpdate = (event: {
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
}) => void;

type SpawnCtx = {
  cwd: string;
  signal?: AbortSignal;
  modelRegistry: LiveModelRegistry;
  hasUI: boolean;
  ui: {
    setStatus(id: string, value: string | undefined): void;
    setWidget(id: string, value: string[] | undefined): void;
  };
};

export function normalizeIntent(intent: string): string {
  const trimmed = intent.trim();
  if (!trimmed) throw new Error("intent is required");
  return trimmed;
}

export function buildPolicyDescription(config: SubagentsConfig): string {
  return `Required configured model tier. small=${config.modelTierSmall}; medium=${config.modelTierMedium}; large=${config.modelTierLarge}.`;
}

export function buildDelegationGuidance(config: SubagentsConfig): string {
  return `\n\n## Subagent delegation
Use spawn_agents proactively for read-mostly work that would otherwise expand the main context, require iterative searching, or benefit from an isolated second opinion.

Delegate when:
- localizing unfamiliar code, tracing control/data flow, or reading more than a few files
- checking external docs, remote metadata, issues, PRs, releases, or web sources
- reviewing a plan, diff, branch, PR, or design against explicit criteria
- distilling noisy logs, traces, metrics, query results, or large command output
- splitting independent questions that can run concurrently

Do not delegate when:
- the task requires editing files or coordinating overlapping workspace changes
- a deterministic command, test, typecheck, lint, or focused search would answer faster
- the subagent would need unstated conversation context or user-owned decisions
- the work is tightly sequential or delegation would mostly duplicate effort

Pass independent agents in one spawn_agents call; at most ${MAX_AGENTS_PER_CALL} items are accepted. Every item requires a self-contained intent and prompt plus explicit capabilities, model_tier, and thinking. capabilities: [] is valid. Allowed capabilities: ${config.allowedCapabilities.join(", ") || "none"}. Allowed thinking levels: ${config.allowedThinkingLevels.join(", ") || "none"}. Configured tiers: small=${config.modelTierSmall}; medium=${config.modelTierMedium}; large=${config.modelTierLarge}. Built-ins: ${CAPABILITIES.join(", ")}. Use output_schema for validated machine-readable results.`;
}

function toRunRequest(
  spec: SpawnAgentItem,
  ctx: SpawnCtx,
  logId: string,
  onEvent?: (event: unknown) => void,
): RunSubagentRequest {
  return {
    intent: spec.intent,
    prompt: spec.prompt,
    capabilities: spec.capabilities,
    modelTier: spec.model_tier,
    thinking: spec.thinking,
    files: spec.files,
    output:
      spec.output_schema !== undefined
        ? { schema: spec.output_schema }
        : undefined,
    cwd: ctx.cwd,
    signal: ctx.signal,
    logId,
    onEvent,
    modelRegistry: ctx.modelRegistry,
  };
}

export async function validateSpawnAgentSpecs(
  specs: SpawnAgentItem[],
  config: SubagentsConfig,
  ctx: Pick<SpawnCtx, "cwd" | "modelRegistry">,
): Promise<string[]> {
  const errors: string[] = [];
  if (specs.length > MAX_AGENTS_PER_CALL) {
    errors.push(
      `agents must contain at most ${MAX_AGENTS_PER_CALL} agents (received ${specs.length})`,
    );
  }

  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i] as SpawnAgentItem;
    const prefix = `agents[${i}]`;
    const preflight = resolveSubagentRequest(
      toRunRequest(spec, ctx as SpawnCtx, `preflight:${i}`),
      config,
    );
    if (preflight.prepared) {
      preflight.errors.push(
        ...(await validatePreparedExtensions(preflight.prepared, ctx.cwd)),
      );
    }
    errors.push(...preflight.errors.map((error) => `${prefix}.${error}`));

    for (let j = 0; j < (spec.files?.length ?? 0); j += 1) {
      const file = spec.files![j]!;
      if (typeof file !== "string" || !file.trim()) {
        errors.push(`${prefix}.files[${j}] must be non-empty`);
        continue;
      }
      const absolutePath = resolve(ctx.cwd, file);
      try {
        const metadata = await stat(absolutePath);
        if (!metadata.isFile()) {
          errors.push(`${prefix}.files[${j}] must name a regular file`);
          continue;
        }
        await access(absolutePath, constants.R_OK);
      } catch {
        errors.push(`${prefix}.files[${j}] must name a readable regular file`);
      }
    }
    if (spec.output_schema !== undefined) {
      errors.push(
        ...validateOutputSchema(spec.output_schema, `${prefix}.output_schema`),
      );
    }
  }
  return errors;
}

export async function spillSubagentOutput(
  content: { type: "text"; text: string }[],
  toolCallId: string,
  dir?: string,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
}> {
  const spilled = await spillIfNeeded(content, toolCallId, dir);
  return {
    content: spilled.content as { type: "text"; text: string }[],
    details: spilled.spilled
      ? {
          outputSpilled: true,
          spillFile: spilled.filePath,
          originalSize: spilled.originalSize,
        }
      : {},
  };
}

async function runSpawn(
  spec: SpawnAgentItem,
  ctx: SpawnCtx,
  toolCallId: string,
  onUpdate?: OnUpdate,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
}> {
  const intent = normalizeIntent(spec.intent);
  const tracker: SubagentActivityTracker = createSubagentActivityTracker({
    toolCallId,
    roleLabel: "Subagent",
    intent,
    showActivity: true,
    hasUI: ctx.hasUI,
    ui: ctx.hasUI
      ? {
          setStatus: (id, value) => ctx.ui.setStatus(id, value),
          setWidget: (id, value) => ctx.ui.setWidget(id, value),
        }
      : undefined,
    onUpdate,
  });

  Object.assign(tracker.state, {
    capabilities: [...spec.capabilities],
    modelTier: spec.model_tier,
    thinking: spec.thinking,
  });

  const result = await _runSubagent.fn(
    toRunRequest(spec, ctx, toolCallId, (event) => tracker.handleEvent(event)),
  );
  tracker.finish(result);
  const diagnosticWarning = result.diagnosticWarnings?.length
    ? `\n\nWarning: ${result.diagnosticWarnings.join("; ")}`
    : "";

  if (!result.ok) {
    return {
      content: text(formatSpawnFailure(result)),
      details: {
        ok: false,
        structuredError: result.diagnosticWarnings?.length
          ? formatSpawnFailure(result)
          : (result.errorMessage ?? formatSpawnFailure(result)),
        aborted: result.aborted,
        exitCode: result.exitCode,
        signal: result.signal,
        stderr: result.stderr,
        stdout: result.stdout,
        logFile: result.logFile,
        diagnosticWarnings: result.diagnosticWarnings,
        activity: tracker.state,
      },
    };
  }

  if (spec.output_schema !== undefined && result.structured?.ok) {
    return {
      content: text(
        `\`\`\`json\n${JSON.stringify(result.structured.value, null, 2)}\n\`\`\`${diagnosticWarning}`,
      ),
      details: {
        ok: true,
        exitCode: result.exitCode,
        structuredValue: result.structured.value,
        logFile: result.logFile,
        diagnosticWarnings: result.diagnosticWarnings,
        activity: tracker.state,
      },
    };
  }

  return {
    content: text(`${result.stdout}${diagnosticWarning}`),
    details: {
      ok: true,
      exitCode: result.exitCode,
      logFile: result.logFile,
      diagnosticWarnings: result.diagnosticWarnings,
      activity: tracker.state,
    },
  };
}

export async function runParallelSpawn(
  specs: SpawnAgentItem[],
  config: SubagentsConfig,
  ctx: SpawnCtx,
  toolCallId: string,
  onUpdate: OnUpdate | undefined,
  gate: ConcurrencyGate,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
}> {
  const validationErrors = await validateSpawnAgentSpecs(specs, config, ctx);
  if (validationErrors.length > 0) {
    return {
      content: text(
        `Error: invalid spawn_agents request\n${validationErrors.join("\n")}`,
      ),
      details: { validationError: true, errors: validationErrors },
    };
  }

  const states: SubagentRunState[] = specs.map((spec) => ({
    intent: spec.intent.trim(),
    capabilities: [...spec.capabilities],
    modelTier: spec.model_tier,
    thinking: spec.thinking,
    phase: "queued",
    recentEvents: [],
    toolUseCount: 0,
    totalTokens: 0,
    startedAt: Date.now(),
    lastUpdateAt: Date.now(),
  }));

  function emitCombined(): void {
    onUpdate?.({
      content: [{ type: "text", text: `Running ${specs.length} subagents...` }],
      details: { agents: [...states], total: specs.length },
    });
  }
  emitCombined();

  function cancelledBeforeLaunch(i: number) {
    const errorMessage = "Subagent cancelled before launch";
    states[i] = {
      ...states[i],
      phase: "aborted",
      resolved: true,
      errorMessage,
      lastUpdateAt: Date.now(),
    };
    emitCombined();
    return {
      content: text(`Error: ${errorMessage}`),
      details: {
        ok: false,
        exitCode: null,
        aborted: true,
        structuredError: errorMessage,
      },
    };
  }

  const results = await Promise.all(
    specs.map(async (spec, i) => {
      const release = await gate.acquire(ctx.signal);
      if (!release) return cancelledBeforeLaunch(i);
      try {
        if (ctx.signal?.aborted) return cancelledBeforeLaunch(i);
        const result = await runSpawn(
          spec,
          ctx,
          `${toolCallId}:${i}`,
          (event) => {
            const activity = getActivity(event.details);
            if (activity) states[i] = activity;
            emitCombined();
          },
        );
        const finalActivity = getActivity(result.details);
        if (finalActivity) states[i] = finalActivity;
        states[i].resolved = true;
        const errorText = result.content[0]?.text;
        if (errorText?.startsWith("Error:")) states[i].errorMessage = errorText;
        if (typeof result.details.logFile === "string") {
          states[i].logFile = result.details.logFile;
        }
        emitCombined();
        return result;
      } finally {
        release();
      }
    }),
  );

  const failed = results.filter((result) => result.details.ok === false).length;
  const structured = specs.some((spec) => spec.output_schema !== undefined)
    ? results.map((result, index) => {
        if (specs[index]!.output_schema === undefined)
          return { requested: false } as const;
        if (result.details.ok === true && "structuredValue" in result.details) {
          return {
            requested: true,
            ok: true,
            value: result.details.structuredValue,
          } as const;
        }
        const error =
          typeof result.details.structuredError === "string"
            ? result.details.structuredError
            : (result.content[0]?.text ?? "Structured subagent failed");
        return { requested: true, ok: false, error } as const;
      })
    : undefined;

  const parts = results.map((result, i) => {
    const spec = specs[i]!;
    const policy = `${spec.capabilities.join(", ") || "no capabilities"} · ${spec.model_tier}/${spec.thinking}`;
    return `## ${spec.intent.trim()}\n\n_${policy}_\n\n${result.content[0]?.text ?? ""}`;
  });
  const spilled = await spillSubagentOutput(
    text(parts.join("\n\n---\n\n")),
    toolCallId,
  );

  return {
    content: spilled.content,
    details: {
      agents: states,
      total: specs.length,
      failed,
      allOk: failed === 0,
      ...(structured ? { structured } : {}),
      ...spilled.details,
    },
  };
}

type LoadSubagentsConfig = (
  cwd: string,
  warnings?: string[],
) => Promise<SubagentsConfig>;

export function createSubagentsConfigReloader(
  gate: Pick<ConcurrencyGate, "setLimit">,
  loadConfig: LoadSubagentsConfig = loadSubagentsConfig,
) {
  let latestGeneration = 0;
  return async (cwd: string, warnings: string[]): Promise<SubagentsConfig> => {
    const generation = ++latestGeneration;
    const config = await loadConfig(cwd, warnings);
    if (generation === latestGeneration) gate.setLimit(config.maxConcurrency);
    return config;
  };
}

export default function (pi: ExtensionAPI) {
  const directGate = createConcurrencyGate(DEFAULT_MAX_CONCURRENCY);
  const reloadConfig = createSubagentsConfigReloader(directGate);
  registerSubagentsConfigCommand(pi);

  pi.on("before_agent_start", async (event, ctx) => {
    const config = await loadSubagentsConfig(ctx.cwd);
    return {
      systemPrompt: event.systemPrompt + buildDelegationGuidance(config),
    };
  });

  pi.registerTool({
    name: "spawn_agents",
    label: "Spawn Agents",
    description:
      "Launch multiple independent subagents with explicit capabilities, model tier, and thinking. Results are combined after all settle.",
    parameters: buildSpawnAgentsParams(
      `Required model tier: ${MODEL_TIERS.join(", ")}.`,
    ),
    async execute(
      toolCallId,
      params: SpawnAgentsParams,
      signal,
      onUpdate,
      ctx,
    ) {
      const warnings: string[] = [];
      const config = await reloadConfig(ctx.cwd, warnings);
      if (ctx.hasUI) {
        for (const warning of warnings) ctx.ui.notify(warning, "warning");
      }
      return runParallelSpawn(
        params.agents,
        config,
        {
          cwd: ctx.cwd,
          signal,
          modelRegistry: ctx.modelRegistry,
          hasUI: ctx.hasUI,
          ui: ctx.ui,
        },
        toolCallId,
        onUpdate,
        directGate,
      );
    },
    renderCall(args, theme, context) {
      return renderAgentsCall(args as { agents?: unknown[] }, theme, context);
    },
    renderResult(result, options, theme, context) {
      return renderAgentsResult(result, options, theme, context);
    },
  });
}

export { MODEL_TIERS, THINKING_LEVELS };
