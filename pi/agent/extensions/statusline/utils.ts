export interface WindowStats {
  /** 0–100, percentage of quota consumed in this window */
  usedPercent?: number;
  /** Seconds until this window resets */
  resetAfterSeconds?: number;
}

export interface UsageStats {
  /** Short window (e.g. 3–5 hours) */
  primary?: WindowStats;
  /** Long window (e.g. weekly) */
  secondary?: WindowStats;
  /** Provider-reported limit flag; not proof the selected model is blocked */
  limitReached?: boolean;
  /** Credit balance string for credit-based plans (e.g. "4.20") */
  balance?: string;
}

export interface ProviderAdapter {
  /** Human-readable name shown in the footer */
  label: string;
  /** Returns true if this adapter handles the given provider identifier */
  handles(provider: string): boolean;
  /** Fetch current usage. apiKey is the bearer token; headers are any extra auth headers. */
  fetchUsage(
    apiKey: string,
    headers?: Record<string, string>,
  ): Promise<UsageStats | null>;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
  }
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

export function buildFooterText(
  adapter: ProviderAdapter,
  stats: UsageStats,
): string {
  if (stats.balance !== undefined) {
    const parts = [`${adapter.label}: $${stats.balance}`];
    if (stats.primary?.resetAfterSeconds !== undefined) {
      parts.push(
        `resets in ${formatDuration(stats.primary.resetAfterSeconds)}`,
      );
    }
    return parts.join(" · ");
  }

  if (
    stats.limitReached &&
    stats.primary?.usedPercent === undefined &&
    stats.secondary?.usedPercent === undefined
  ) {
    const parts = [`${adapter.label}: limit reached`];
    if (stats.primary?.resetAfterSeconds !== undefined) {
      parts.push(
        `resets in ${formatDuration(stats.primary.resetAfterSeconds)}`,
      );
    }
    return parts.join(" · ");
  }

  const pPct = stats.primary?.usedPercent;
  const sPct = stats.secondary?.usedPercent;
  const pReset = stats.primary?.resetAfterSeconds;
  const sReset = stats.secondary?.resetAfterSeconds;

  if (pPct === undefined && sPct === undefined) return adapter.label;

  let pctStr = "";
  if (pPct !== undefined && sPct !== undefined) {
    pctStr = `${pPct}% (${sPct}%)`;
  } else if (pPct !== undefined) {
    pctStr = `${pPct}%`;
  } else if (sPct !== undefined) {
    pctStr = `${sPct}%`;
  }

  let resetStr = "";
  if (pReset !== undefined && sReset !== undefined) {
    resetStr = `resets in ${formatDuration(pReset)} (${formatDuration(sReset)})`;
  } else if (pReset !== undefined) {
    resetStr = `resets in ${formatDuration(pReset)}`;
  } else if (sReset !== undefined) {
    resetStr = `resets in ${formatDuration(sReset)}`;
  }

  const limitText = stats.limitReached ? " · limit reached" : "";
  const parts = [`${adapter.label}: ${pctStr}${limitText}`];
  if (resetStr) parts.push(resetStr);

  return parts.join(" · ");
}
