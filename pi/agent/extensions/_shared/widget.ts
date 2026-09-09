import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

type WidgetRenderer = (width: number, theme: Theme) => string[];

/** Mount once: Pi's setWidget deletes/reinserts keys, changing sibling order. */
export function createPersistentWidget(key: string) {
  let renderer: WidgetRenderer | undefined;
  let redraw: (() => void) | undefined;
  return {
    update(ctx: ExtensionContext, next?: WidgetRenderer): void {
      renderer = next;
      if (!ctx.hasUI) return;
      if (!next) {
        ctx.ui.setWidget(key, undefined, { placement: "belowEditor" });
        redraw = undefined;
      } else if (ctx.mode !== "tui") {
        ctx.ui.setWidget(key, next(100, ctx.ui.theme), {
          placement: "belowEditor",
        });
      } else if (redraw) {
        redraw();
      } else {
        ctx.ui.setWidget(
          key,
          (tui, theme) => {
            const requestRender = () => tui.requestRender();
            redraw = requestRender;
            return {
              render: (width) => renderer?.(width, theme) ?? [],
              invalidate() {},
              dispose() {
                if (redraw === requestRender) redraw = undefined;
              },
            };
          },
          { placement: "belowEditor" },
        );
      }
    },
  };
}

export function formatWidgetCountdown(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes
    ? `${minutes}m${seconds ? ` ${seconds}s` : ""}`
    : `${seconds}s`;
}

/** Inputs are already sanitized and styled; fields are ordered by priority. */
export function fitWidgetRow(
  head: string,
  fields: string[],
  width: number,
  separator: string,
  detail = "",
): string {
  const safeWidth = Math.max(0, width);
  const kept = [...fields];
  const minimumDetail = Math.min(8, visibleWidth(detail));
  const render = (text: string) =>
    [head, ...(text ? [text] : []), ...kept].join(separator);
  while (
    kept.length &&
    visibleWidth(render(truncateToWidth(detail, minimumDetail, "…"))) >
      safeWidth
  ) {
    kept.pop();
  }
  const detailWidth = Math.max(
    0,
    safeWidth -
      visibleWidth(render("")) -
      (detail ? visibleWidth(separator) : 0),
  );
  return truncateToWidth(
    render(truncateToWidth(detail, detailWidth, "…")),
    safeWidth,
    "…",
  );
}
