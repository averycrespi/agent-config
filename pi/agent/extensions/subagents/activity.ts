import { formatDuration } from "../_shared/render.ts";
import type {
  SubagentEvent,
  SubagentPhase,
  SubagentRunState,
} from "./types.ts";

export interface SubagentCompletion {
  ok: boolean;
  aborted: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  errorMessage?: string;
  logFile?: string;
}

export interface SubagentActivityOptions {
  toolCallId: string;
  roleLabel: string;
  intent: string;
  showActivity: boolean;
  hasUI: boolean;
  onUpdate?: (event: {
    content: { type: "text"; text: string }[];
    details: Record<string, unknown>;
  }) => void;
  ui?: {
    setStatus(widgetId: string, text: string | undefined): void;
    setWidget(widgetId: string, widget: string[] | undefined): void;
  };
}

export interface SubagentActivityTracker {
  readonly state: SubagentRunState;
  handleEvent(event: unknown): void;
  finish(outcome: SubagentCompletion): void;
}

const OUTPUT_TAIL_LIMIT = 120;
const RECENT_EVENT_LIMIT = 3;
const TICK_MS = 1_000;

function truncate(text: string, max = OUTPUT_TAIL_LIMIT): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  // Middle-ellipsis: preserve both head (tool name / command prefix) and tail
  // (path basename / suffix). Head gets ~60% of the budget, tail the rest.
  const keep = max - 1;
  const head = Math.ceil(keep * 0.6);
  const tail = keep - head;
  return `${trimmed.slice(0, head)}…${trimmed.slice(-tail)}`;
}

function stringifyArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;

  const command = record.command;
  if (typeof command === "string" && command.trim()) return command.trim();

  const path = record.path;
  if (typeof path === "string" && path.trim()) return path.trim();

  const paths = record.paths;
  if (Array.isArray(paths) && paths.length > 0) {
    const joined = paths.filter((p) => typeof p === "string").join(", ");
    if (joined) return joined;
  }

  const query = record.query;
  if (typeof query === "string" && query.trim()) return query.trim();

  const text = record.text;
  if (typeof text === "string" && text.trim()) return text.trim();

  try {
    return JSON.stringify(args);
  } catch {
    return "";
  }
}

function describeToolCall(toolName: string, args: unknown): string {
  const detail = stringifyArgs(args);
  if (!detail) return toolName;
  return `${toolName}: ${truncate(detail, 120)}`;
}

function textFromMessage(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const record = message as { content?: unknown };

  if (typeof record.content === "string") {
    return record.content.trim();
  }

  if (!Array.isArray(record.content)) return "";

  const parts: string[] = [];
  for (const block of record.content) {
    if (!block || typeof block !== "object") continue;
    const item = block as { type?: string; text?: unknown };
    if (item.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
    }
  }
  return parts.join("").trim();
}

function extractLastAssistantMessage(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { role?: unknown } | undefined;
    if (message?.role === "assistant") {
      const text = textFromMessage(message);
      if (text) return text;
    }
  }
  return "";
}

export function createSubagentActivityTracker(
  options: SubagentActivityOptions,
): SubagentActivityTracker {
  const state: SubagentRunState = {
    intent: options.intent,
    phase: "starting",
    recentEvents: [],
    toolUseCount: 0,
    totalTokens: 0,
    startedAt: Date.now(),
    lastUpdateAt: Date.now(),
  };

  let tickHandle: ReturnType<typeof setInterval> | undefined;
  let finished = false;

  function pushRecentEvent(kind: SubagentEvent["kind"], text: string): void {
    state.recentEvents.push({ kind, text: truncate(text, OUTPUT_TAIL_LIMIT) });
    if (state.recentEvents.length > RECENT_EVENT_LIMIT) {
      state.recentEvents.shift();
    }
  }

  function setPhase(phase: SubagentPhase): void {
    state.phase = phase;
    state.lastUpdateAt = Date.now();
  }

  function setLastOutput(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    state.lastOutput = truncate(trimmed);
    state.lastUpdateAt = Date.now();
  }

  function emitProgress(text: string): void {
    options.onUpdate?.({
      content: [{ type: "text", text }],
      details: { ...state },
    });
  }

  function render(): void {
    if (!options.showActivity || finished) return;

    const elapsed = formatDuration(Date.now() - state.startedAt);
    const currentCommand = state.currentCommand ?? state.lastCommand;
    const text = currentCommand
      ? `${state.intent}: ${truncate(currentCommand, 80)} (${elapsed})`
      : `${state.intent}: ${state.phase} (${elapsed})`;

    options.onUpdate?.({
      content: [{ type: "text", text }],
      details: { ...state },
    });
  }

  function pushCurrentCommand(command: string): void {
    const trimmed = command.trim();
    if (!trimmed) return;
    state.currentCommand = trimmed;
    state.lastUpdateAt = Date.now();
  }

  function completeCurrentCommand(): void {
    if (state.currentCommand) {
      state.lastCommand = state.currentCommand;
      state.currentCommand = undefined;
      state.lastUpdateAt = Date.now();
    }
  }

  function handleEvent(event: unknown): void {
    if (!event || typeof event !== "object") return;
    const record = event as { type?: string; [key: string]: unknown };

    switch (record.type) {
      case "agent_start":
        setPhase("starting");
        emitProgress(`${state.intent}: starting`);
        break;
      case "message_update": {
        const assistantEvent = record.assistantMessageEvent as
          | { type?: string }
          | undefined;
        if (assistantEvent?.type === "thinking_delta") {
          setPhase("thinking");
        } else if (assistantEvent?.type === "text_delta") {
          setPhase("thinking");
        }
        break;
      }
      case "tool_execution_start": {
        const toolName =
          typeof record.toolName === "string" ? record.toolName : "tool";
        const summary = describeToolCall(toolName, record.args);
        state.activeTool = toolName;
        pushCurrentCommand(summary);
        pushRecentEvent("tool", summary);
        setPhase(toolName);
        emitProgress(`${state.intent}: ${summary}`);
        break;
      }
      case "tool_execution_update": {
        const toolName =
          typeof record.toolName === "string" ? record.toolName : "tool";
        if (toolName === "bash") {
          const partial = record.partialResult;
          if (typeof partial === "string") {
            setLastOutput(partial);
          } else if (partial && typeof partial === "object") {
            const text = stringifyArgs(partial);
            if (text) setLastOutput(text);
          }
        }
        break;
      }
      case "tool_execution_end": {
        const toolName =
          typeof record.toolName === "string" ? record.toolName : "tool";
        const isError = Boolean(record.isError);
        const resultText = stringifyArgs(record.result);
        if (resultText) setLastOutput(resultText);
        state.toolUseCount += 1;
        state.lastToolInfo = state.currentCommand ?? toolName;
        if (isError) {
          pushRecentEvent("tool", `${toolName} failed`);
          state.lastUpdateAt = Date.now();
          emitProgress(`${state.intent}: ${toolName} failed`);
        }
        if (state.activeTool === toolName) {
          state.activeTool = undefined;
        }
        completeCurrentCommand();
        break;
      }
      case "message_end": {
        const message = record.message as
          | {
              role?: unknown;
              usage?: { totalTokens?: number };
            }
          | undefined;
        if (message?.role === "assistant") {
          const text = textFromMessage(message);
          if (text) setLastOutput(text);
          if (
            typeof message.usage?.totalTokens === "number" &&
            message.usage.totalTokens > 0
          ) {
            state.totalTokens += message.usage.totalTokens;
          }
        }
        break;
      }
      case "agent_end": {
        const finalText = extractLastAssistantMessage(record.messages);
        if (finalText) setLastOutput(finalText);
        if (state.phase !== "error" && state.phase !== "aborted") {
          setPhase("done");
          emitProgress(`${state.intent}: done`);
        }
        state.activeTool = undefined;
        completeCurrentCommand();
        break;
      }
      case "stderr": {
        const stderrText =
          typeof record.text === "string" ? record.text.trim() : "";
        if (stderrText) {
          pushRecentEvent("stderr", stderrText);
          state.lastUpdateAt = Date.now();
          emitProgress(`${state.intent}: stderr: ${truncate(stderrText, 80)}`);
        }
        break;
      }
      default:
        break;
    }

    render();
  }

  function finish(outcome: SubagentCompletion): void {
    finished = true;
    if (tickHandle) clearInterval(tickHandle);

    if (outcome.aborted) {
      setPhase("aborted");
    } else if (outcome.ok) {
      setPhase("done");
    } else {
      setPhase("error");
    }

    if (outcome.errorMessage) state.errorMessage = outcome.errorMessage;
    if (outcome.logFile) state.logFile = outcome.logFile;

    if (outcome.stdout.trim()) setLastOutput(outcome.stdout);
    if (outcome.stderr.trim() && !state.lastOutput) {
      setLastOutput(outcome.stderr);
    }

    if (options.showActivity && options.hasUI && options.ui) {
      options.ui.setStatus(`subagent:${options.toolCallId}`, undefined);
      options.ui.setWidget(`subagent:${options.toolCallId}`, undefined);
    }
  }

  if (options.showActivity) {
    tickHandle = setInterval(() => {
      render();
    }, TICK_MS);
  }

  return {
    state,
    handleEvent,
    finish,
  };
}
