import * as z from "zod";

const DISALLOWED_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

/** Plain single-line public text with deterministic Unicode normalization. */
export const NormalizedTextSchema = z
  .string()
  .trim()
  .min(1, "TEXT_EMPTY")
  .max(500, "TEXT_TOO_LONG")
  .refine((value) => !DISALLOWED_CONTROL_CHARACTERS.test(value), "TEXT_CONTROL_CHARACTER")
  .transform((value) => value.normalize("NFC"));

export type FactState<T> =
  | { state: "known"; value: T }
  | { state: "unknown"; reason: string }
  | { state: "conditional"; condition: string; value?: T | undefined }
  | { state: "not-applicable"; reason?: string | undefined }
  | { state: "missing"; reason: string };

/** Build a strict tagged state without using null or falsey sentinel values. */
export function factStateSchema<T extends z.ZodType>(valueSchema: T) {
  return z.discriminatedUnion("state", [
    z.strictObject({
      state: z.literal("known"),
      value: valueSchema,
    }),
    z.strictObject({
      state: z.literal("unknown"),
      reason: NormalizedTextSchema,
    }),
    z.strictObject({
      state: z.literal("conditional"),
      condition: NormalizedTextSchema,
      value: valueSchema.optional(),
    }),
    z.strictObject({
      state: z.literal("not-applicable"),
      reason: NormalizedTextSchema.optional(),
    }),
    z.strictObject({
      state: z.literal("missing"),
      reason: NormalizedTextSchema,
    }),
  ]);
}
