import * as z from "zod";

function boundedFiniteNumber(minimum: number, maximum: number) {
  return z
    .number()
    .refine(Number.isFinite, "NUMBER_NOT_FINITE")
    .min(minimum, "NUMBER_BELOW_BOUND")
    .max(maximum, "NUMBER_ABOVE_BOUND");
}

function numericMeasurementSchema<const U extends string>(
  unit: U,
  minimum: number,
  maximum: number,
) {
  const valueSchema = boundedFiniteNumber(minimum, maximum);
  const exact = z.strictObject({
    shape: z.literal("exact"),
    value: valueSchema,
    unit: z.literal(unit),
  });
  const range = z
    .strictObject({
      shape: z.literal("range"),
      min: valueSchema,
      max: valueSchema,
      unit: z.literal(unit),
    })
    .refine(({ min, max }) => min <= max, "MEASUREMENT_RANGE_REVERSED");

  return z.discriminatedUnion("shape", [exact, range]);
}

/** Broad physical guardrails reject corrupt input without claiming printer limits. */
export const TemperatureMeasurementSchema = numericMeasurementSchema("degC", -273.15, 1_000);
export const DensityMeasurementSchema = numericMeasurementSchema("g/cm3", Number.MIN_VALUE, 100);
export const SpeedMeasurementSchema = numericMeasurementSchema("mm/s", 0, 1_000);
export const FanMeasurementSchema = numericMeasurementSchema("percent", 0, 100);

export type TemperatureMeasurement = z.infer<typeof TemperatureMeasurementSchema>;
export type DensityMeasurement = z.infer<typeof DensityMeasurementSchema>;
export type SpeedMeasurement = z.infer<typeof SpeedMeasurementSchema>;
export type FanMeasurement = z.infer<typeof FanMeasurementSchema>;
