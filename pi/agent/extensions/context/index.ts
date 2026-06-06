import type {
  ExtensionAPI,
  ExtensionCommandContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

type Group = {
  label: string;
  tokens: number;
  count: number;
  examples: string[];
};

type ContextReport = {
  estimatedTokens: number;
  reportedTokens: number | null;
  contextWindow: number | null;
  groups: Group[];
  unattributedTokens: number;
  sourceNote: string;
};

const MAX_EXAMPLES = 3;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return safeStringify(content);

  return content
    .map((block) => {
      if (!block || typeof block !== "object") return safeStringify(block);
      const typed = block as Record<string, unknown>;
      switch (typed.type) {
        case "text":
          return typeof typed.text === "string" ? typed.text : "";
        case "thinking":
          return typeof typed.thinking === "string" ? typed.thinking : "";
        case "toolCall":
          return safeStringify({
            name: typed.name,
            arguments: typed.arguments,
          });
        case "image":
          return `[image:${typeof typed.mimeType === "string" ? typed.mimeType : "unknown"}]`;
        default:
          return safeStringify(typed);
      }
    })
    .join("\n");
}

function preview(text: string): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (!singleLine) return "empty";
  return singleLine.length > 72 ? `${singleLine.slice(0, 69)}...` : singleLine;
}

function addGroup(
  groups: Map<string, Group>,
  label: string,
  tokens: number,
  example: string,
): void {
  if (tokens <= 0) return;
  const group = groups.get(label) ?? {
    label,
    tokens: 0,
    count: 0,
    examples: [],
  };
  group.tokens += tokens;
  group.count += 1;
  if (group.examples.length < MAX_EXAMPLES) group.examples.push(example);
  groups.set(label, group);
}

function addMessageEntry(
  groups: Map<string, Group>,
  entry: Extract<SessionEntry, { type: "message" }>,
): void {
  const message = entry.message;
  switch (message.role) {
    case "user": {
      const text = contentToText(message.content);
      addGroup(groups, "User messages", estimateTokens(text), preview(text));
      break;
    }
    case "assistant": {
      const text = contentToText(message.content);
      addGroup(
        groups,
        "Assistant messages",
        estimateTokens(text),
        preview(text),
      );
      break;
    }
    case "toolResult": {
      const text = contentToText(message.content);
      addGroup(
        groups,
        `Tool result: ${message.toolName}`,
        estimateTokens(text),
        preview(text),
      );
      break;
    }
    default: {
      const text = safeStringify(message);
      addGroup(groups, "Other messages", estimateTokens(text), preview(text));
    }
  }
}

function addEntry(groups: Map<string, Group>, entry: SessionEntry): void {
  switch (entry.type) {
    case "message":
      addMessageEntry(groups, entry);
      break;
    case "compaction":
      addGroup(
        groups,
        "Compaction summaries",
        estimateTokens(entry.summary),
        preview(entry.summary),
      );
      break;
    case "branch_summary":
      addGroup(
        groups,
        "Branch summaries",
        estimateTokens(entry.summary),
        preview(entry.summary),
      );
      break;
    case "custom_message": {
      const text = contentToText(entry.content);
      addGroup(
        groups,
        `Custom context: ${entry.customType}`,
        estimateTokens(text),
        preview(text),
      );
      break;
    }
    case "custom":
    case "label":
    case "model_change":
    case "session_info":
    case "thinking_level_change":
      break;
    default: {
      const text = safeStringify(entry);
      addGroup(groups, "Other context", estimateTokens(text), preview(text));
    }
  }
}

function formatTokens(tokens: number | null): string {
  if (tokens === null) return "unknown";
  if (tokens >= 1000)
    return `${(tokens / 1000).toFixed(tokens >= 10_000 ? 1 : 2)}k`;
  return String(tokens);
}

function formatPercent(part: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function buildReport(ctx: ExtensionCommandContext): ContextReport {
  const groups = new Map<string, Group>();
  const systemPrompt = ctx.getSystemPrompt();
  addGroup(
    groups,
    "System prompt + project instructions",
    estimateTokens(systemPrompt),
    "Pi prompt, AGENTS.md, loaded extension guidance",
  );

  for (const entry of ctx.sessionManager.getBranch()) addEntry(groups, entry);

  const sortedGroups = [...groups.values()].sort((a, b) => b.tokens - a.tokens);
  const estimatedTokens = sortedGroups.reduce(
    (sum, group) => sum + group.tokens,
    0,
  );
  const usage = ctx.getContextUsage();
  const reportedTokens = usage?.tokens ?? null;
  const contextWindow =
    usage?.contextWindow ?? ctx.model?.contextWindow ?? null;
  const unattributedTokens = Math.max(
    0,
    (reportedTokens ?? 0) - estimatedTokens,
  );
  const sourceNote = usage
    ? reportedTokens === null
      ? "Pi usage unavailable; showing local current-branch estimate"
      : "Pi-reported current usage + local current-branch blame estimate"
    : "Local current-branch estimate only";

  return {
    estimatedTokens,
    reportedTokens,
    contextWindow,
    groups: sortedGroups,
    unattributedTokens,
    sourceNote,
  };
}

export function renderContextReport(
  report: ContextReport,
  detailed = false,
): string {
  const currentTokens = report.reportedTokens ?? report.estimatedTokens;
  const percent = report.contextWindow
    ? ` · ${formatPercent(currentTokens, report.contextWindow)}`
    : "";
  const header = `Context usage: ${formatTokens(currentTokens)}${report.contextWindow ? ` / ${formatTokens(report.contextWindow)}` : ""} tokens${percent}`;
  const lines = [
    header,
    `Source: ${report.sourceNote}`,
    "",
    "Top token sources",
  ];
  const totalForShare = currentTokens || report.estimatedTokens;
  const groups = detailed ? report.groups : report.groups.slice(0, 8);

  groups.forEach((group, index) => {
    const suffix = group.count === 1 ? "1 item" : `${group.count} items`;
    lines.push(
      `${index + 1}. ${group.label.padEnd(42)} ${formatTokens(group.tokens).padStart(7)}  ${formatPercent(group.tokens, totalForShare).padStart(4)}  ${suffix}`,
    );
    if (detailed) lines.push(`   e.g. ${group.examples.join(" · ")}`);
  });

  if (report.unattributedTokens > 0) {
    lines.push(
      `${groups.length + 1}. ${"Unattributed provider/framing overhead".padEnd(42)} ${formatTokens(report.unattributedTokens).padStart(7)}  ${formatPercent(report.unattributedTokens, totalForShare).padStart(4)}`,
    );
    lines.push(
      "   Difference between provider usage and local branch estimate",
    );
  }

  if (!detailed && report.groups.length > groups.length) {
    lines.push(
      "",
      `Run /context --details to show all ${report.groups.length} groups.`,
    );
  }

  return lines.join("\n");
}

export function createContextExtension() {
  return function contextExtension(pi: ExtensionAPI) {
    pi.registerCommand("context", {
      description: "Show what is using tokens in the current context window",
      handler: async (args, ctx) => {
        const detailed = args.split(/\s+/).includes("--details");
        ctx.ui.notify(renderContextReport(buildReport(ctx), detailed), "info");
      },
    });
  };
}

export default createContextExtension();
