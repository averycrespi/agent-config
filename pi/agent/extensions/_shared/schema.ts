import { Type, type TUnsafe } from "@sinclair/typebox";

export function stringEnum<T extends readonly string[]>(
  values: T,
  options?: { description?: string; default?: T[number] },
): TUnsafe<T[number]> {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: values as unknown as string[],
    ...(options?.description ? { description: options.description } : {}),
    ...(options?.default ? { default: options.default } : {}),
  });
}
