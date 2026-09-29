import type { ProviderAdapter, WindowStats } from "./utils.ts";

export function parseWindow(window: any): WindowStats | undefined {
  if (!window) return undefined;
  return {
    usedPercent: window.used_percent,
    resetAfterSeconds: window.reset_after_seconds,
  };
}

export function buildCodexUsageHeaders(
  apiKey: string,
  extraHeaders?: Record<string, string>,
): Headers {
  const headers = new Headers(extraHeaders);
  headers.set("Authorization", `Bearer ${apiKey}`);
  if (!headers.has("chatgpt-account-id")) {
    try {
      const parts = apiKey.split(".");
      if (parts.length === 3) {
        // Match Pi's Codex model requests; registry auth omits this derived header.
        // Decoding selects the account only; it does not verify the JWT.
        const claims = JSON.parse(
          Buffer.from(parts[1]!, "base64url").toString("utf8"),
        );
        const accountId =
          claims?.["https://api.openai.com/auth"]?.chatgpt_account_id;
        if (
          typeof accountId === "string" &&
          accountId.length > 0 &&
          accountId.length <= 256 &&
          !Array.from(accountId).some(
            (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127,
          )
        ) {
          headers.set("chatgpt-account-id", accountId);
        }
      }
    } catch {
      // Non-JWT credentials or absent claims retain the bearer-only request.
    }
  }
  return headers;
}

export const codexAdapter: ProviderAdapter = {
  label: "Codex",
  handles: (provider) => provider === "openai-codex",

  async fetchUsage(apiKey, headers) {
    let res: Response;
    try {
      res = await fetch("https://chatgpt.com/backend-api/wham/usage", {
        headers: buildCodexUsageHeaders(apiKey, headers),
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
