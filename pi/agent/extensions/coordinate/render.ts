import type { Theme } from "@earendil-works/pi-coding-agent";
import { displayLabel, plural } from "../_shared/render.ts";
import { fitWidgetRow } from "../_shared/widget.ts";

export function statusSummary(
  assignments: number,
  pending: number | undefined,
) {
  const fields = assignments ? [plural(assignments, "active assignment")] : [];
  if (pending) fields.push(plural(pending, "pending message"));
  if (pending === undefined) fields.push("Mailbox unavailable");
  return fields.join(" · ") || "No outstanding work";
}

export function launchSummary(
  name: string,
  result: {
    status?: string;
    effect?: string | null;
    resources?: unknown;
    worker?: unknown;
    execution?: { submittedEntry?: string | null } | null;
  },
) {
  const worker = displayLabel(name);
  if (result.status === "execution-confirmed") return `Started ${worker}`;
  if (result.execution?.submittedEntry)
    return `Sent task to ${worker}; execution not observed`;
  if (result.worker) return `Prepared ${worker}; task delivery unconfirmed`;
  if (result.resources) return `Created ${worker}; agent startup unconfirmed`;
  return `Could not confirm workspace creation for ${worker}`;
}

export function roleLine(
  theme: Theme,
  width: number,
  role: "coordinator" | "child",
  parent: string,
  active: number,
  pending?: number,
  supervision?: string,
) {
  const separator = theme.fg("dim", " · ");
  if (role === "child")
    return fitWidgetRow(
      theme.fg("muted", "Managed by"),
      [],
      width,
      separator,
      theme.fg("text", displayLabel(parent)),
      " ",
    );
  const fields = [
    theme.fg(
      "muted",
      active ? plural(active, "active assignment") : "no active assignments",
    ),
  ];
  if (pending)
    fields.push(theme.fg("muted", plural(pending, "pending message")));
  if (pending === undefined)
    fields.unshift(theme.fg("warning", "mailbox unavailable"));
  if (active && supervision !== "active")
    fields.unshift(
      theme.fg("warning", `supervision ${supervision ?? "unknown"}`),
    );
  return fitWidgetRow(
    theme.fg("muted", "Coordinator"),
    fields,
    width,
    separator,
  );
}
