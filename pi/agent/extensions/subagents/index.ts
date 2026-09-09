import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Usage } from "@earendil-works/pi-ai";
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
  PROFILES,
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

type SpawnRunResult = {
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
  usage?: Usage;
};

function assistantUsageFromEvent(event: unknown): Usage | undefined {
  if (!event || typeof event !== "object") return undefined;
  const record = event as Record<string, unknown>;
  if (record.type !== "message_end") return undefined;
  const message = record.message as
    | { role?: unknown; usage?: Partial<Usage> }
    | undefined;
  const usage = message?.usage;
  if (message?.role !== "assistant" || !usage || !usage.cost) return undefined;
  const required = [
    usage.input,
    usage.output,
    usage.cacheRead,
    usage.cacheWrite,
    usage.totalTokens,
    usage.cost.input,
    usage.cost.output,
    usage.cost.cacheRead,
    usage.cost.cacheWrite,
    usage.cost.total,
  ];
  if (required.some((value) => typeof value !== "number")) return undefined;
  return usage as Usage;
}

function combineUsage(current: Usage | undefined, next: Usage): Usage {
  if (!current) return { ...next, cost: { ...next.cost } };
  const cacheWrite1h =
    current.cacheWrite1h !== undefined || next.cacheWrite1h !== undefined
      ? (current.cacheWrite1h ?? 0) + (next.cacheWrite1h ?? 0)
      : undefined;
  const reasoning =
    current.reasoning !== undefined || next.reasoning !== undefined
      ? (current.reasoning ?? 0) + (next.reasoning ?? 0)
      : undefined;
  return {
    input: current.input + next.input,
    output: current.output + next.output,
    cacheRead: current.cacheRead + next.cacheRead,
    cacheWrite: current.cacheWrite + next.cacheWrite,
    ...(cacheWrite1h !== undefined ? { cacheWrite1h } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    totalTokens: current.totalTokens + next.totalTokens,
    cost: {
      input: current.cost.input + next.cost.input,
      output: current.cost.output + next.cost.output,
      cacheRead: current.cost.cacheRead + next.cost.cacheRead,
      cacheWrite: current.cost.cacheWrite + next.cost.cacheWrite,
      total: current.cost.total + next.cost.total,
    },
  };
}

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

export function prepareSpawnAgentsArguments(args: unknown): any {
  if (!args || typeof args !== "object") return args;
  const input = args as { agents?: unknown[] };
  if (!Array.isArray(input.agents)) return args;
  let changed = false;
  const agents = input.agents.map((agent) => {
    if (!agent || typeof agent !== "object") return agent;
    const record = agent as Record<string, unknown>;
    const legacyTier = record.model_tier;
    const hasLegacyFields =
      legacyTier !== undefined || record.thinking !== undefined;
    if (!hasLegacyFields) return agent;
    changed = true;
    const { model_tier: _modelTier, thinking: _thinking, ...current } = record;
    if (current.profile !== undefined) return current;
    const profile =
      legacyTier === "small"
        ? "fast"
        : legacyTier === "medium"
          ? "balanced"
          : legacyTier === "large"
            ? "strong"
            : undefined;
    return profile ? { ...current, profile } : current;
  });
  return changed ? { ...(args as Record<string, unknown>), agents } : args;
}

export function buildPolicyDescription(_config: SubagentsConfig): string {
  return `Required configured profile: ${PROFILES.join(", ")}.`;
}

export function buildDelegationGuidance(config: SubagentsConfig): string {
  return `\n\n## Subagent delegation
Use spawn_agents for a self-contained question when parallelism, isolation of substantial intermediate context, or independent judgment offers a clear benefit over startup, handoff, and verification costs. File count, task category, and read-only status alone do not justify delegation. Keep short lookups, deterministic checks, tightly coupled reasoning, and work needing unstated conversation context inline; avoid duplicating the child's investigation.

Once delegation is justified, prefer spawn_agents for a one-shot independent batch whose results the owning session will synthesize. Use workflow when an applicable saved workflow or explicit orchestration—dependent phases, programmatic aggregation, or verification gates—adds value. Parallelism or structured output alone does not require workflow. Preserve skill-required workflows.

Keep implementation and fixes in the owning session by default. Writable delegation is an exception only when explicitly requested by the user and supported by an explicit execution workflow with bounded scope, one writer, orchestrator-owned state and evidence, a structured handoff, and independent verification. Never overlap parent or child writes in the same checkout. Preserve stricter active workflow boundaries.

For each child, provide one self-contained question or task, scope boundaries, relevant context and decisions, authoritative source paths, explicit capabilities and profile, an evidence-bearing deliverable with uncertainties, and a stop condition. Supply necessary context rather than the entire conversation. The parent owns synthesis and checks consequential claims against evidence; a valid schema or confident summary is not proof of correctness.

Profiles describe routing policy, not fixed model identities: fast for narrow lookups, extraction, and straightforward summaries; balanced for substantial bounded exploration and synthesis; strong for difficult analysis, ambiguous or consequential judgment, and demanding review. Pass independent read-only agents in one spawn_agents call; writable agents must run one at a time. At most ${MAX_AGENTS_PER_CALL} items are accepted. Every item requires a self-contained intent and prompt plus explicit capabilities and profile. capabilities: [] is valid. Allowed capabilities: ${config.allowedCapabilities.join(", ") || "none"}. Profiles: ${PROFILES.join(", ")}. Built-ins: ${CAPABILITIES.join(", ")}. Use output_schema when automation needs validated machine-readable results.`;
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
    profile: spec.profile,
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
  if (
    specs.length > 1 &&
    specs.some((spec) =>
      spec.capabilities?.some(
        (capability) =>
          capability === "write-filesystem" || capability === "exec-shell",
      ),
    )
  ) {
    errors.push(
      "mutable capabilities require exactly one agent per spawn_agents call",
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
): Promise<SpawnRunResult> {
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
    profile: spec.profile,
  });

  let usage: Usage | undefined;
  const result = await _runSubagent.fn(
    toRunRequest(spec, ctx, toolCallId, (event) => {
      const eventUsage = assistantUsageFromEvent(event);
      if (eventUsage) usage = combineUsage(usage, eventUsage);
      tracker.handleEvent(event);
    }),
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
      ...(usage ? { usage } : {}),
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
      ...(usage ? { usage } : {}),
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
    ...(usage ? { usage } : {}),
  };
}

export async function runParallelSpawn(
  specs: SpawnAgentItem[],
  config: SubagentsConfig,
  ctx: SpawnCtx,
  toolCallId: string,
  onUpdate: OnUpdate | undefined,
  gate: ConcurrencyGate,
  mutableGate?: ConcurrencyGate,
): Promise<SpawnRunResult> {
  const validationErrors = await validateSpawnAgentSpecs(specs, config, ctx);
  if (validationErrors.length > 0) {
    return {
      content: text(
        `Error: invalid spawn_agents request\n${validationErrors.join("\n")}`,
      ),
      details: { validationError: true, errors: validationErrors },
    };
  }

  const mutable = specs.some((spec) =>
    spec.capabilities.some(
      (capability) =>
        capability === "write-filesystem" || capability === "exec-shell",
    ),
  );
  const states: SubagentRunState[] = specs.map((spec) => ({
    intent: spec.intent.trim(),
    capabilities: [...spec.capabilities],
    profile: spec.profile,
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

  function cancelledBeforeLaunch(i: number): SpawnRunResult {
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
      const releaseMutable =
        mutable && mutableGate
          ? await mutableGate.acquire(ctx.signal)
          : undefined;
      if (mutable && mutableGate && !releaseMutable) {
        return cancelledBeforeLaunch(i);
      }
      const release = await gate.acquire(ctx.signal);
      if (!release) {
        releaseMutable?.();
        return cancelledBeforeLaunch(i);
      }
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
        releaseMutable?.();
      }
    }),
  );

  const failed = results.filter((result) => result.details.ok === false).length;
  const usage = results.reduce<Usage | undefined>(
    (combined, result) =>
      result.usage ? combineUsage(combined, result.usage) : combined,
    undefined,
  );
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
    const policy = `${spec.capabilities.join(", ") || "no capabilities"} · ${spec.profile}`;
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
    ...(usage ? { usage } : {}),
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
  const mutableGate = createConcurrencyGate(1);
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
      "Launch one or more independent subagents with explicit capabilities and a configured profile. Mutable calls are serialized; results are combined after all settle.",
    parameters: buildSpawnAgentsParams(
      `Required profile: ${PROFILES.join(", ")}.`,
    ),
    prepareArguments: prepareSpawnAgentsArguments,
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
        mutableGate,
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

export { PROFILES };
