/**
 * Statusline extension for Pi.
 *
 * Displays the working directory, provider quota, context usage,
 * current model, and thinking level in a single footer line.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createManagedLogger } from "../_shared/logging.ts";
import { codexAdapter } from "./codex.ts";
import { renderFooterLine, type FooterState } from "./footer.ts";
import { getGitBranch } from "./git.ts";
import { type ProviderAdapter } from "./utils.ts";

const ADAPTERS: ProviderAdapter[] = [codexAdapter];
const DEBOUNCE_MS = 60_000;

export default function (pi: ExtensionAPI) {
  let lastFetchAt = 0;
  let lastFetchKey = "";
  let requestRender: (() => void) | null = null;
  let gitGeneration = 0;
  let usageFailureLogged = false;
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

  async function refreshGitBranch(cwd: string): Promise<void> {
    const generation = ++gitGeneration;
    const branch = await getGitBranch(cwd);
    if (generation !== gitGeneration || state.cwd !== cwd) return;
    state.gitBranch = branch;
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
          return [renderFooterLine(state, width, theme)];
        },
        invalidate() {},
      };
    });
  }

  async function refreshAndRender(ctx: any): Promise<void> {
    syncState(ctx);
    requestRender?.();
    void refreshGitBranch(ctx.cwd);
    await refreshUsage(ctx);
    requestRender?.();
  }

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
