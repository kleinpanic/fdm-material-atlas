import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ServiceTemperatureGuidanceSchema,
  ThermalObservationSchema,
  compareThermalObservations,
  type ThermalObservation,
} from "../../src/data/schema/material.ts";
import { syntheticIds } from "../fixtures/schema-values.ts";

const basis = [
  {
    kind: "method" as const,
    methodId: syntheticIds.method,
    scope: "representative-product" as const,
  },
];

function observation(overrides: Record<string, unknown> = {}) {
  return {
    id: "claim-alpha-thermal",
    metric: "heat-deflection",
    metricLabel: "Heat deflection temperature",
    measurement: {
      state: "known",
      value: { shape: "range", min: 72, max: 78, unit: "degC" },
    },
    method: {
      standard: "Synthetic standard B",
      loadMpa: 1.8,
      annealed: false,
      conditioning: "Dry synthetic specimen",
      otherConditions: "Synthetic specimen geometry",
    },
    qualification: "Representative observation; unlike thermal metrics are not interchangeable.",
    basis,
    ...overrides,
  };
}

describe("service-temperature and named thermal separation", () => {
  it("keeps practical service guidance in a distinct claim schema", () => {
    const parsed = ServiceTemperatureGuidanceSchema.parse({
      id: "claim-alpha-service",
      value: {
        state: "known",
        value: { shape: "range", min: -15, max: 70, unit: "degC" },
      },
      qualification: "Practical guidance, not a standardized thermal observation.",
      basis,
    });
    expect(parsed.value).toMatchObject({ state: "known" });
    expect(
      ThermalObservationSchema.safeParse({
        ...observation(),
        metric: "service-temperature",
      }).success,
    ).toBe(false);
  });

  it.each([
    "glass-transition",
    "heat-deflection",
    "vicat-softening",
    "melting-point",
    "other",
  ] as const)("retains the named %s metric", (metric) => {
    const parsed = ThermalObservationSchema.parse(observation({ metric }));
    expect(parsed.metric).toBe(metric);
    expectTypeOf(parsed).toEqualTypeOf<ThermalObservation>();
  });

  it("retains exact or range Celsius values, applicability state, conditions, qualification, and basis", () => {
    const parsed = ThermalObservationSchema.parse(observation());
    expect(parsed.measurement).toEqual({
      state: "known",
      value: { shape: "range", min: 72, max: 78, unit: "degC" },
    });
    expect(parsed.method).toEqual({
      standard: "Synthetic standard B",
      loadMpa: 1.8,
      annealed: false,
      conditioning: "Dry synthetic specimen",
      otherConditions: "Synthetic specimen geometry",
    });
    expect(parsed.qualification).toContain("not interchangeable");
    expect(parsed.basis).toEqual(basis);

    expect(
      ThermalObservationSchema.parse(
        observation({
          measurement: {
            state: "conditional",
            condition: "Only after a reviewed conditioning step",
            value: { shape: "exact", value: 81, unit: "degC" },
          },
        }),
      ).measurement,
    ).toMatchObject({ state: "conditional" });
    expect(
      ThermalObservationSchema.parse(
        observation({
          measurement: { state: "not-applicable", reason: "No applicable transition" },
        }),
      ).measurement,
    ).toEqual({ state: "not-applicable", reason: "No applicable transition" });
  });

  it("requires a specific label, qualification, and evidence without echoing rejected input", () => {
    for (const invalid of [
      observation({ metricLabel: "" }),
      observation({ qualification: "" }),
      observation({ basis: [] }),
      observation({ metric: "service-temperature-synthetic-secret" }),
    ]) {
      const result = ThermalObservationSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(JSON.stringify(result.error.issues)).not.toContain(
          "service-temperature-synthetic-secret",
        );
      }
    }
  });
});

describe("thermal observation compatibility", () => {
  it("accepts only matching metric and method dimensions", () => {
    const left = ThermalObservationSchema.parse(observation());
    const right = ThermalObservationSchema.parse(observation({ id: "claim-alpha-thermal-two" }));
    expect(compareThermalObservations(left, right)).toEqual({ comparable: true });
  });

  it.each([
    ["metric", observation({ metric: "vicat-softening" })],
    [
      "standard",
      observation({
        method: { ...(observation().method as object), standard: "Synthetic standard C" },
      }),
    ],
    ["load", observation({ method: { ...(observation().method as object), loadMpa: 0.45 } })],
    ["annealing", observation({ method: { ...(observation().method as object), annealed: true } })],
    [
      "conditioning",
      observation({
        method: { ...(observation().method as object), conditioning: "Wet specimen" },
      }),
    ],
    [
      "other conditions",
      observation({
        method: { ...(observation().method as object), otherConditions: "Different geometry" },
      }),
    ],
  ])("returns a stable non-comparable code for mismatched %s", (_dimension, candidate) => {
    const left = ThermalObservationSchema.parse(observation());
    const right = ThermalObservationSchema.parse(candidate);
    expect(compareThermalObservations(left, right)).toEqual({
      comparable: false,
      code: "THERMAL_NOT_COMPARABLE",
    });
  });

  it("distinguishes separately named observations in the other metric category", () => {
    const left = ThermalObservationSchema.parse(
      observation({
        metric: "other",
        metricLabel: "Synthetic thermal test A",
      }),
    );
    const right = ThermalObservationSchema.parse(
      observation({
        id: "claim-alpha-other-two",
        metric: "other",
        metricLabel: "Synthetic thermal test B",
      }),
    );
    expect(compareThermalObservations(left, right)).toEqual({
      comparable: false,
      code: "THERMAL_NOT_COMPARABLE",
    });
  });
});
