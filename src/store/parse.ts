import type { z } from "zod";

export function parseRow<S extends z.ZodType>(
  schema: S,
  row: unknown,
): z.output<S> {
  return schema.parse(row);
}

export function parseRows<S extends z.ZodType>(
  schema: S,
  rows: unknown[],
): z.output<S>[] {
  return rows.map((row) => schema.parse(row));
}

export function parseOptionalRow<S extends z.ZodType>(
  schema: S,
  row: unknown,
): z.output<S> | undefined {
  if (row === undefined) {
    return undefined;
  }
  return schema.parse(row);
}
