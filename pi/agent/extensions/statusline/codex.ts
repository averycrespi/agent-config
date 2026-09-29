import type { ProviderAdapter, WindowStats } from "./utils.ts";

export function parseWindow(window: any): WindowStats | undefined {
  if (!window) return undefined;
  return {
    usedPercent: window.used_percent,
    resetAfterSeconds: window.reset_after_seconds,
  };
}

export const codexAdapter: ProviderAdapter = {
  label: "Codex",
  handles: (provider) => provider === "openai-codex",

  async fetchUsage(apiKey, headers) {
    let res: Response;
    try {
      res = await fetch("https://chatgpt.com/backend-api/wham/usage", {
        headers: { ...headers, Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return null;
    }

    if (!res.ok) return null;

    let data: any;
    try {
      data = await res.json();
    } catch {
      return null;
    }

    // The main Codex quota is top-level; additional limits are separate buckets.
    const rateLimit = data.rate_limit;
    const limitReached = rateLimit?.limit_reached === true;

    return {
      primary: parseWindow(rateLimit?.primary_window),
      secondary: parseWindow(rateLimit?.secondary_window),
      limitReached,
      balance:
        data.credits?.has_credits && !data.credits?.unlimited
          ? data.credits.balance
          : undefined,
    };
  },
};
