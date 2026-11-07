import type { z } from "zod";

export function parseRow<T extends z.ZodTypeAny>(
  schema: T,
  row: unknown,
): z.infer<T> {
  return schema.parse(row);
}

export function parseRows<T extends z.ZodTypeAny>(
  schema: T,
  rows: unknown[],
): z.infer<T>[] {
  return rows.map((row) => schema.parse(row));
}

export function parseOptionalRow<T extends z.ZodTypeAny>(
  schema: T,
  row: unknown,
): z.infer<T> | undefined {
  if (row === undefined) {
    return undefined;
  }
  return schema.parse(row);
}
