export function safeStringify(value: unknown, space = 2): string {
  if (typeof value === "string") return value;
  if (typeof value === "undefined") return "undefined";

  const seen = new WeakSet<object>();
  try {
    const text = JSON.stringify(
      value,
      (_key, item: unknown) => {
        if (typeof item === "bigint") return item.toString();
        if (item && typeof item === "object") {
          if (seen.has(item)) return "[Circular]";
          seen.add(item);
        }
        return item;
      },
      space,
    );
    return text ?? String(value);
  } catch {
    return String(value);
  }
}
