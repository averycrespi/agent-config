/**
 * Broker guard for Pi.
 *
 * Detects bash calls that look like remote git or GitHub CLI work and
 * nudges the agent toward the broker's `mcp_call` instead — without
 * blocking the bash. After the bash result lands, a steering message
 * is queued so the agent sees the hint regardless of whether the bash
 * succeeded or failed.
 *
 * Note: we don't try to rewrite the bash content via the `tool_result`
 * return value because Pi discards `tool_result` content modifications
 * when the underlying tool reports `isError` (see agent-session.js:201).
 * That's exactly the case we care about most (auth failures), so we
 * deliver via `sendMessage` instead, which is unaffected by error state.
 *
 * Detection is intentionally a heuristic: false positives are harmless
 * (the bash still runs and the model can ignore the hint), false
 * negatives just mean the broker prompt menu in `index.ts` is the only
 * signal for that call.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BrokerClient, BrokerTool } from "./client.ts";
import { COMMON_SEARCH_STOPWORDS, rankToolMatches } from "./search.ts";

export type BrokerCommandKind = "github-cli" | "git-remote";

export type BrokerCommandMatch = {
  kind: BrokerCommandKind;
  segment: string;
};

const ASSIGNMENT_PREFIX = String.raw`(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*`;
const COMMAND_PREFIX = String.raw`^\s*${ASSIGNMENT_PREFIX}(?:command\s+|builtin\s+)?(?:env\s+${ASSIGNMENT_PREFIX})?(?:\S+/)?`;
const COMMAND_SPLIT_RE = /&&|\|\||;|\||\n/g;
const QUOTED_STRING_RE = /'[^']*'|"[^"]*"/g;
// Git's own global flags can appear between `git` and the subcommand
// (e.g. `git -C /path pull`, `git --no-pager push`, `git -c x=y push`).
// Allow zero or more of them. Long flags accept an optional `=value`;
// short -C/-c/-P take an optional space-separated value. Regex
// backtracking handles `git -C pull` (no value) correctly.
const GIT_GLOBAL_FLAG = String.raw`(?:-[CcP](?:\s+\S+)?|--[a-z][a-z0-9-]*(?:=\S+)?)`;
const GH_RE = new RegExp(`${COMMAND_PREFIX}gh(?=\\s|$)`);
const GIT_REMOTE_RE = new RegExp(
  `${COMMAND_PREFIX}git(?:\\s+${GIT_GLOBAL_FLAG})*\\s+(push|pull|fetch|ls-remote|remote)\\b`,
);

const NAMESPACE_FOR: Record<BrokerCommandKind, string> = {
  "github-cli": "github",
  "git-remote": "git",
};

const GUARD_STOPWORDS = new Set([...COMMON_SEARCH_STOPWORDS, "gh", "git"]);

export function stripQuoted(command: string): string {
  return command.replace(QUOTED_STRING_RE, "");
}

export function splitCommand(command: string): string[] {
  return command
    .split(COMMAND_SPLIT_RE)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export function findBrokerCommand(
  command: string,
): BrokerCommandMatch | undefined {
  for (const segment of splitCommand(stripQuoted(command))) {
    if (GH_RE.test(segment)) return { kind: "github-cli", segment };
    if (GIT_REMOTE_RE.test(segment)) return { kind: "git-remote", segment };
  }
  return undefined;
}

export function getHintReason(kind: BrokerCommandKind): string {
  if (kind === "github-cli") {
    return "GitHub CLI detected — prefer mcp_call with a broker github tool.";
  }
  return "Remote git operation detected — prefer mcp_call with a broker git tool.";
}

export function findToolCandidates(
  segment: string,
  namespace: string,
  tools: BrokerTool[],
  limit = 3,
): BrokerTool[] {
  return rankToolMatches(segment, tools, {
    namespace,
    stopwords: GUARD_STOPWORDS,
  })
    .slice(0, limit)
    .map((match) => match.tool);
}

export function getHintMessage(
  match: BrokerCommandMatch,
  candidates: BrokerTool[],
): string {
  const namespace = NAMESPACE_FOR[match.kind];
  const lines = [
    `[mcp-broker hint] This bash call looks like a ${match.kind === "github-cli" ? "GitHub CLI" : "remote git"} operation (\`${match.segment}\`).`,
    `In this environment, prefer the MCP broker: call mcp_call with name="${namespace}.<tool>".`,
  ];
  if (candidates.length > 0) {
    const list = candidates.map((c) => c.name).join(", ");
    lines.push(
      `Likely matches: ${list}. Use mcp_describe on one for its parameter schema, then mcp_call.`,
    );
  } else {
    lines.push(
      `Use mcp_search with a relevant query (e.g. \`mcp_search query="${namespace}"\`) to discover the right tool.`,
    );
  }
  return lines.join("\n");
}

export default function (pi: ExtensionAPI, client: BrokerClient) {
  // Stash matches by toolCallId so tool_result can pair the hint with
  // the bash call that triggered it without re-running detection.
  const pending = new Map<string, BrokerCommandMatch>();
  // Cap one steer per turn to avoid spamming when several matched bash
  // calls run back-to-back.
  let steeredThisTurn = false;

  pi.on("turn_start", async () => {
    steeredThisTurn = false;
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return undefined;
    const command = event.input.command as string | undefined;
    if (!command) return undefined;

    const match = findBrokerCommand(command);
    if (!match) return undefined;

    pending.set(event.toolCallId, match);

    if (ctx.hasUI) {
      ctx.ui.notify(getHintReason(match.kind), "info");
    }
    return undefined;
  });

  pi.on("tool_result", async (event) => {
    const match = pending.get(event.toolCallId);
    if (!match) return undefined;
    pending.delete(event.toolCallId);

    if (steeredThisTurn) return undefined;
    steeredThisTurn = true;

    const tools = client.getCachedTools() ?? [];
    const candidates = findToolCandidates(
      match.segment,
      NAMESPACE_FOR[match.kind],
      tools,
    );
    pi.sendMessage(
      {
        customType: "broker-guard",
        content: getHintMessage(match, candidates),
        display: false,
        details: {
          kind: match.kind,
          segment: match.segment,
          candidates: candidates.map((c) => c.name),
        },
      },
      { deliverAs: "steer" },
    );
    return undefined;
  });
}
