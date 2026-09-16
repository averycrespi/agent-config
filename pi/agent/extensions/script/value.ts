export const MAX_IPC_BYTES = 16 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 24_000;

/** Copy data descriptors only; do not call provider toJSON hooks or accept lossy JSON. */
export function jsonSnapshot(value: unknown, maxBytes = MAX_IPC_BYTES): string {
  const seen = new Set<object>();
  function copy(v: unknown, depth: number): unknown {
    if (depth > 100) throw new Error("invalid_json");
    if (v === null || typeof v === "boolean" || typeof v === "string") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v !== "object" || seen.has(v)) throw new Error("invalid_json");
    const array = Array.isArray(v);
    if (
      !array &&
      Object.getPrototypeOf(v) !== Object.prototype &&
      Object.getPrototypeOf(v) !== null
    )
      throw new Error("invalid_json");
    seen.add(v);
    const out = array ? Object.setPrototypeOf([], null) : Object.create(null);
    let entries = 0;
    for (const key of Reflect.ownKeys(v)) {
      if (array && key === "length") continue;
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (
        typeof key !== "string" ||
        !Object.hasOwn(d, "value") ||
        !d.enumerable ||
        (array &&
          (!/^(0|[1-9]\d*)$/.test(key) ||
            Number(key) >= (v as unknown[]).length))
      )
        throw new Error("invalid_json");
      Object.defineProperty(out, key, {
        value: copy(d.value, depth + 1),
        enumerable: true,
      });
      entries++;
    }
    if (array && entries !== (v as unknown[]).length)
      throw new Error("invalid_json");
    seen.delete(v);
    return out;
  }
  const json = JSON.stringify(copy(value, 0));
  if (Buffer.byteLength(json) > maxBytes) throw new Error("output_limit");
  return json;
}
