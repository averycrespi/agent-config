/**
 * Statusline extension for Pi.
 *
 * Displays the working directory, provider quota, context usage,
 * current model, and thinking level beneath a footer-owned separator.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createManagedLogger } from "../_shared/logging.ts";
import { buildCodexUsageHeaders, codexAdapter } from "./codex.ts";
import { renderFooterLines, type FooterState } from "./footer.ts";
import { getGitSummary } from "./git.ts";
import { type ProviderAdapter, type WindowStats } from "./utils.ts";

const ADAPTERS: ProviderAdapter[] = [codexAdapter];
const DEBOUNCE_MS = 60_000;

export default function (pi: ExtensionAPI) {
  let lastFetchAt = 0;
  let lastFetchKey = "";
  let requestRender: (() => void) | null = null;
  let gitGeneration = 0;
  let usageFailureLogged = false;
  let usageAccountHeaderPresent = false;
  const state: FooterState = {
    cwd: process.cwd(),
    homeDir: process.env.HOME,
  };

  function syncState(ctx: any): void {
    state.cwd = ctx.cwd;
    state.homeDir = process.env.HOME;
    state.contextUsage = ctx.getContextUsage?.() ?? null;
    state.modelId = ctx.model?.id;
    state.thinking = pi.getThinkingLevel();
  }

  async function logUsageFailureOnce(message: string): Promise<void> {
    if (usageFailureLogged) return;
    usageFailureLogged = true;
    try {
      const logger = createManagedLogger({
        extensionName: "statusline",
        id: "quota-fetch-failure",
      });
      logger.write(`${message}\n`);
      await logger.close();
    } catch {
      // best-effort diagnostics
    }
  }

  async function refreshGitSummary(cwd: string): Promise<void> {
    const generation = ++gitGeneration;
    const summary = await getGitSummary(cwd);
    if (generation !== gitGeneration || state.cwd !== cwd) return;
    state.gitSummary = summary;
    state.gitBranch = undefined;
    requestRender?.();
  }

  async function refreshUsage(ctx: any): Promise<void> {
    const model = ctx.model;
    if (!model) {
      state.usage = undefined;
      return;
    }

    const adapter = ADAPTERS.find((candidate) =>
      candidate.handles(model.provider),
    );
    if (!adapter) {
      state.usage = undefined;
      return;
    }

    const fetchKey = `${model.provider}:${model.id}`;
    const now = Date.now();
    if (fetchKey === lastFetchKey && now - lastFetchAt < DEBOUNCE_MS) return;

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) {
      state.usage = undefined;
      return;
    }

    const stats = await adapter.fetchUsage(auth.apiKey, auth.headers);
    if (!stats) {
      state.usage = undefined;
      await logUsageFailureOnce(
        `Provider usage fetch failed for ${model.provider}:${model.id}`,
      );
      return;
    }

    lastFetchAt = now;
    lastFetchKey = fetchKey;
    usageAccountHeaderPresent = buildCodexUsageHeaders(
      auth.apiKey,
      auth.headers,
    ).has("chatgpt-account-id");
    state.usage = {
      label: adapter.label,
      stats,
    };
  }

  function installFooter(ctx: any): void {
    if (!ctx.hasUI) return;

    ctx.ui.setFooter((tui: any, theme: any) => {
      requestRender = () => tui.requestRender();
      return {
        render(width: number): string[] {
          state.thinking = pi.getThinkingLevel();
          return renderFooterLines(state, width, theme);
        },
        invalidate() {},
      };
    });
  }

  async function refreshAndRender(ctx: any): Promise<void> {
    syncState(ctx);
    requestRender?.();
    void refreshGitSummary(ctx.cwd);
    await refreshUsage(ctx);
    requestRender?.();
  }

  pi.registerCommand("statusline-debug", {
    description:
      "Show safe cached quota diagnostics without fetching or credentials",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      const stats = state.usage?.stats;
      const finite = (value: unknown) =>
        typeof value === "number" && Number.isFinite(value) ? value : null;
      const window = (value: WindowStats | undefined) =>
        value
          ? {
              usedPercent: finite(value.usedPercent),
              resetAfterSeconds: finite(value.resetAfterSeconds),
            }
          : null;
      ctx.ui.notify(
        JSON.stringify(
          {
            diagnosticVersion: 2,
            quotaSource: "rate_limit",
            hasUsage: !!stats,
            fetchedAt: stats ? new Date(lastFetchAt).toISOString() : null,
            accountHeaderPresent: stats ? usageAccountHeaderPresent : null,
            primary: window(stats?.primary),
            secondary: window(stats?.secondary),
            limitReached: stats ? stats.limitReached === true : null,
            hasBalance: stats ? stats.balance !== undefined : null,
          },
          null,
          2,
        ),
        "info",
      );
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    syncState(ctx);
    installFooter(ctx);
    void refreshAndRender(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    await refreshAndRender(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    await refreshAndRender(ctx);
  });

  (pi as any).on("thinking_level_select", async () => {
    state.thinking = pi.getThinkingLevel();
    requestRender?.();
  });

  pi.on("session_shutdown", async () => {
    requestRender = null;
  });
}
