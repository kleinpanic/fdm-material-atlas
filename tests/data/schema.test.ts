import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ClaimIdSchema,
  MaterialIdSchema,
  PublicIdSchema,
  SourceIdSchema,
  type MaterialId,
} from "../../src/data/schema/ids.ts";
import { factStateSchema, type FactState } from "../../src/data/schema/fact-state.ts";
import {
  DensityMeasurementSchema,
  FanMeasurementSchema,
  SpeedMeasurementSchema,
  TemperatureMeasurementSchema,
} from "../../src/data/schema/measurements.ts";
import { syntheticCondition, syntheticIds, syntheticReason } from "../fixtures/schema-values.ts";
import * as z from "zod";

describe("stable public identifiers", () => {
  it.each([
    syntheticIds.material,
    syntheticIds.claim,
    syntheticIds.source,
    "lane-outdoor",
    "selector-primary-goal",
  ])("accepts reviewed namespaced ID %s", (value) => {
    expect(PublicIdSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    "",
    "material",
    "Material-alpha",
    "material_alpha",
    "material--alpha",
    "-material-alpha",
    "material-alpha-",
    "material-alpha/path",
    "material-alpha\nnext",
  ])("rejects unsafe or unnamespaced ID", (value) => {
    expect(PublicIdSchema.safeParse(value).success).toBe(false);
  });

  it("enforces the namespace and preserves a branded inferred type", () => {
    const materialId = MaterialIdSchema.parse(syntheticIds.material);
    expect(materialId).toBe(syntheticIds.material);
    expect(MaterialIdSchema.safeParse(syntheticIds.claim).success).toBe(false);
    expect(ClaimIdSchema.safeParse(syntheticIds.claim).success).toBe(true);
    expect(SourceIdSchema.safeParse(syntheticIds.source).success).toBe(true);
    expectTypeOf(materialId).toEqualTypeOf<MaterialId>();
  });
});

describe("FactState", () => {
  const booleanState = factStateSchema(z.boolean());
  const numericState = factStateSchema(z.number());

  it.each([
    { state: "known", value: 0 },
    { state: "unknown", reason: syntheticReason },
    {
      state: "conditional",
      condition: syntheticCondition,
      value: 4,
    },
    { state: "conditional", condition: syntheticCondition },
    { state: "not-applicable" },
    { state: "not-applicable", reason: syntheticReason },
    { state: "missing", reason: syntheticReason },
  ])("accepts the strict branch $state", (value) => {
    expect(numericState.safeParse(value).success).toBe(true);
  });

  it("does not convert known zero or false to missing", () => {
    expect(numericState.parse({ state: "known", value: 0 })).toEqual({
      state: "known",
      value: 0,
    });
    expect(booleanState.parse({ state: "known", value: false })).toEqual({
      state: "known",
      value: false,
    });
  });

  it("normalizes permitted explanatory text to Unicode NFC", () => {
    const result = numericState.parse({
      state: "unknown",
      reason: "Cafe\u0301 review",
    });
    expect(result).toEqual({ state: "unknown", reason: "Caf\u00e9 review" });
  });

  it.each([
    null,
    "",
    { state: "known", value: null },
    { state: "known", value: "" },
    { state: "unknown", reason: "" },
    { state: "conditional" },
    { state: "conditional", condition: "" },
    { state: "missing" },
    { state: "missing", reason: "line\nbreak" },
    { state: "known", value: 1, extra: true },
  ])("rejects ambiguous or non-strict state %#", (value) => {
    expect(numericState.safeParse(value).success).toBe(false);
  });

  it("retains a discriminated inferred type", () => {
    type NumericState = FactState<number>;
    const parsed = numericState.parse({ state: "known", value: 0 });
    expectTypeOf(parsed).toEqualTypeOf<NumericState>();
  });
});

describe("numeric measurements", () => {
  it.each([
    [TemperatureMeasurementSchema, { shape: "exact", value: 205, unit: "degC" }],
    [TemperatureMeasurementSchema, { shape: "range", min: 190, max: 220, unit: "degC" }],
    [DensityMeasurementSchema, { shape: "exact", value: 1.24, unit: "g/cm3" }],
    [SpeedMeasurementSchema, { shape: "range", min: 0, max: 80, unit: "mm/s" }],
    [FanMeasurementSchema, { shape: "range", min: 0, max: 100, unit: "percent" }],
  ] as const)("accepts bounded exact and range measurements", (schema, value) => {
    expect(schema.safeParse(value).success).toBe(true);
  });

  it.each([
    [TemperatureMeasurementSchema, { shape: "exact", value: Number.NaN, unit: "degC" }],
    [
      TemperatureMeasurementSchema,
      { shape: "exact", value: Number.POSITIVE_INFINITY, unit: "degC" },
    ],
    [TemperatureMeasurementSchema, { shape: "range", min: 220, max: 190, unit: "degC" }],
    [TemperatureMeasurementSchema, { shape: "exact", value: 200, unit: "celsius" }],
    [DensityMeasurementSchema, { shape: "exact", value: 0, unit: "g/cm3" }],
    [DensityMeasurementSchema, { shape: "range", min: -1, max: 1, unit: "g/cm3" }],
    [SpeedMeasurementSchema, { shape: "exact", value: -1, unit: "mm/s" }],
    [FanMeasurementSchema, { shape: "exact", value: -1, unit: "percent" }],
    [FanMeasurementSchema, { shape: "exact", value: 101, unit: "percent" }],
    [FanMeasurementSchema, { shape: "range", min: 0, max: 101, unit: "percent" }],
    [FanMeasurementSchema, { shape: "exact", value: 50, unit: "%" }],
    [FanMeasurementSchema, { shape: "exact", value: 50, unit: "percent", extra: true }],
  ] as const)("rejects invalid or ambiguous measurement %#", (schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});
