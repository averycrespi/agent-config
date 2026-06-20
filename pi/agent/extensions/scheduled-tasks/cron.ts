export const CRON_BEGIN = "# BEGIN PI SCHEDULED TASKS";
export const CRON_END = "# END PI SCHEDULED TASKS";

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function buildCronBlock(options: {
  projectCwd: string;
  piCommand: string;
  cronEnvironment?: Record<string, string>;
}): string {
  const envArgs = Object.entries(options.cronEnvironment ?? {}).map(
    ([key, value]) => `${key}=${shellQuote(value)}`,
  );
  const command = [
    "cd",
    shellQuote(options.projectCwd),
    "&&",
    ...(envArgs.length ? ["env", ...envArgs] : []),
    shellQuote(options.piCommand),
    "--mode",
    "json",
    "--no-session",
    "-p",
    shellQuote("/tasks-tick"),
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

export function hasManagedBlock(crontab: string): boolean {
  return crontab.includes(CRON_BEGIN) && crontab.includes(CRON_END);
}
