export interface CronExpression {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
}

const RANGES = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
] as const;

function parseField(
  field: string,
  min: number,
  max: number,
): Set<number> | undefined {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) return undefined;
    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart?.includes("-")) {
      const [a, b] = rangePart.split("-").map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b)) return undefined;
      start = a;
      end = b;
    } else {
      const single = Number(rangePart);
      if (!Number.isInteger(single)) return undefined;
      start = single;
      end = single;
    }
    if (start < min || end > max || start > end) return undefined;
    for (let value = start; value <= end; value += step)
      values.add(max === 7 && value === 7 ? 0 : value);
  }
  return values;
}

export function parseCron(expression: string): CronExpression | undefined {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return undefined;
  const parsed = parts.map((part, index) =>
    parseField(part, RANGES[index][0], RANGES[index][1]),
  );
  if (parsed.some((part) => part === undefined)) return undefined;
  return {
    minute: parsed[0]!,
    hour: parsed[1]!,
    dayOfMonth: parsed[2]!,
    month: parsed[3]!,
    dayOfWeek: parsed[4]!,
  };
}

export function cronMatches(cron: CronExpression, date: Date): boolean {
  return (
    cron.minute.has(date.getUTCMinutes()) &&
    cron.hour.has(date.getUTCHours()) &&
    cron.dayOfMonth.has(date.getUTCDate()) &&
    cron.month.has(date.getUTCMonth() + 1) &&
    cron.dayOfWeek.has(date.getUTCDay())
  );
}

function truncateToMinute(date: Date): Date {
  const result = new Date(date);
  result.setUTCSeconds(0, 0);
  return result;
}

export function nextFutureRun(
  expression: string,
  after: Date,
): Date | undefined {
  const cron = parseCron(expression);
  if (!cron) return undefined;
  const candidate = truncateToMinute(new Date(after.getTime() + 60_000));
  for (let i = 0; i < 366 * 24 * 60; i += 1) {
    if (cronMatches(cron, candidate)) return new Date(candidate);
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  return undefined;
}

export const DUE_GRACE_SECONDS = 90;

export type DueDecision =
  | { action: "initialize"; nextRunAt: Date }
  | { action: "run"; nextRunAt: Date }
  | { action: "missed"; nextRunAt: Date }
  | { action: "wait" };

export function decideDue(options: {
  schedule: string;
  nextRunAt?: string;
  now: Date;
  dueGraceSeconds?: number;
}): DueDecision {
  const graceMs = (options.dueGraceSeconds ?? DUE_GRACE_SECONDS) * 1000;
  const current = options.nextRunAt ? new Date(options.nextRunAt) : undefined;
  if (!current || Number.isNaN(current.getTime())) {
    const next = nextFutureRun(options.schedule, options.now);
    return next
      ? { action: "initialize", nextRunAt: next }
      : { action: "wait" };
  }
  if (current.getTime() > options.now.getTime()) return { action: "wait" };
  const next = nextFutureRun(options.schedule, options.now);
  if (!next) return { action: "wait" };
  if (options.now.getTime() - current.getTime() <= graceMs)
    return { action: "run", nextRunAt: next };
  return { action: "missed", nextRunAt: next };
}
