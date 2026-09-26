import {
  clearPartialTimer,
  displayLabel,
  expandedResult,
  getTruncatedText,
  partialElapsed,
  plural,
  toolCall,
  outcomeSections,
} from "../_shared/render.ts";

function urlLabel(value: unknown): string {
  try {
    if (typeof value !== "string") return "";
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    url.username = "";
    url.password = "";
    // Fragments are not fetched and may carry OAuth credentials.
    url.hash = "";
    for (const key of new Set(url.searchParams.keys())) {
      if (
        /token|secret|password|passwd|authorization|credential|api[-_]?key|signature|^(?:sig|key|auth)$/i.test(
          key,
        )
      )
        url.searchParams.set(key, "REDACTED");
    }
    const label = displayLabel(url.href, 4096);
    return url.href.length > 4096 ? `${label.slice(0, 4095)}…` : label;
  } catch {
    return "";
  }
}
export function webRenderers(name: "web_search" | "web_fetch") {
  const target = (args: any) =>
    name === "web_search" ? displayLabel(args?.query) : urlLabel(args?.url);
  return {
    renderCall(args: any, theme: any, context: any) {
      return getTruncatedText(context.lastComponent, [
        toolCall(
          theme,
          name,
          "",
          name === "web_search" && target(args)
            ? `"${target(args)}"`
            : target(args),
          "",
          name === "web_fetch" ? 4096 : 200,
        ),
      ]);
    },
    renderResult(
      result: any,
      { isPartial, expanded }: any,
      theme: any,
      context: any,
    ) {
      const elapsed = isPartial ? partialElapsed(context) : "";
      if (!isPartial) clearPartialTimer(context);
      const d = result.details;
      const failed = context.isError || !!d?.errorPreview;
      const unknown = d?.outcomeUnknown === true;
      const outcome = isPartial
        ? `reading${elapsed}`
        : unknown
          ? failed
            ? "failed; unknown effects; no replay"
            : "effects unknown; no replay"
          : failed
            ? "request failed"
            : name === "web_search"
              ? typeof d?.resultCount === "number"
                ? plural(d.resultCount, "result")
                : "results read"
              : d?.clonePath
                ? "repository read"
                : typeof d?.pageCount === "number"
                  ? `${plural(d.pageCount, "page")} read`
                  : "page read";
      const summary =
        !isPartial &&
        !failed &&
        !unknown &&
        ["results read", "repository read", "page read"].includes(outcome)
          ? ""
          : outcome;
      return getTruncatedText(context.lastComponent, [
        ...(summary || d?.spilled
          ? [
              outcomeSections(
                theme,
                [
                  summary,
                  ...(d?.spilled
                    ? ["output truncated", "full response saved to file"]
                    : []),
                ],
                isPartial || unknown ? "warning" : failed ? "error" : "muted",
              ),
            ]
          : []),
        ...(expanded && typeof d?.spillFilePath === "string"
          ? [
              theme.fg(
                "muted",
                `Full response: ${displayLabel(d.spillFilePath, 4096)}`,
              ),
            ]
          : []),
        ...(expanded ? expandedResult(result) : []),
      ]);
    },
  };
}
