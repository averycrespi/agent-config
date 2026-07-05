import {
  SCHEDULED_TASKS_TICK_CLI,
  SCHEDULED_TASKS_TSX_COMMAND,
} from "./config.ts";

export const CRON_BEGIN = "# BEGIN PI SCHEDULED TASKS";
export const CRON_END = "# END PI SCHEDULED TASKS";

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function buildCronBlock(options: {
  projectCwd: string;
  cronEnvironment?: Record<string, string>;
  tsxCommand?: string;
  tickCli?: string;
}): string {
  const envArgs = Object.entries(options.cronEnvironment ?? {}).map(
    ([key, value]) => `${key}=${shellQuote(value)}`,
  );
  const command = [
    "cd",
    shellQuote(options.projectCwd),
    "&&",
    ...(envArgs.length ? ["env", ...envArgs] : []),
    shellQuote(options.tsxCommand ?? SCHEDULED_TASKS_TSX_COMMAND),
    shellQuote(options.tickCli ?? SCHEDULED_TASKS_TICK_CLI),
  ].join(" ");
  return [CRON_BEGIN, `* * * * * ${command}`, CRON_END].join("\n");
}

export function installManagedBlock(existing: string, block: string): string {
  const pattern = new RegExp(
    `${CRON_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${CRON_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    "m",
  );
  const trimmed = existing.replace(/\s+$/, "");
  if (pattern.test(existing))
    return `${existing.replace(pattern, block).replace(/\s+$/, "")}\n`;
  return `${trimmed}${trimmed ? "\n" : ""}${block}\n`;
}

export function uninstallManagedBlock(existing: string): string {
  const pattern = new RegExp(
    `\n?${CRON_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${CRON_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\n?`,
    "m",
  );
  return (
    existing
      .replace(pattern, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\n+/, "")
      .replace(/\s+$/, "") + (existing.trim() ? "\n" : "")
  );
}

export function getManagedBlock(crontab: string): string | undefined {
  const begin = crontab.indexOf(CRON_BEGIN);
  const end = crontab.indexOf(CRON_END, begin + CRON_BEGIN.length);
  if (begin === -1 || end === -1) return undefined;
  return crontab.slice(begin, end + CRON_END.length);
}

export function hasManagedBlock(crontab: string): boolean {
  return getManagedBlock(crontab) !== undefined;
}
