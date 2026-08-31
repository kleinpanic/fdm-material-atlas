import { describe, expect, expectTypeOf, it } from "vitest";

import {
  MATERIAL_SEMANTIC_FIELDS,
  MaterialSchema,
  type Material,
} from "../../src/data/schema/material.ts";
import { syntheticIds } from "../fixtures/schema-values.ts";

const methodBasis = (scope = "family-guidance") => ({
  kind: "method" as const,
  methodId: syntheticIds.method,
  scope,
});

const claim = (name: string, value: unknown, scope = "family-guidance") => ({
  id: `claim-alpha-${name}`,
  value: { state: "known" as const, value },
  basis: [methodBasis(scope)],
});

const startingClaim = (name: string, value: unknown) =>
  claim(name, value, "starting-profile-guidance");

function validMaterial() {
  return {
    id: syntheticIds.material,
    slug: "alpha-material",
    displayOrder: 1,
    name: "Alpha Material",
    familyOrFill: claim("family", "Synthetic polymer"),
    serviceTemperature: claim("service-temperature", {
      shape: "range",
      min: -20,
      max: 80,
      unit: "degC",
    }),
    thermalObservations: [
      {
        id: "claim-alpha-glass-transition",
        metric: "glass-transition",
        metricLabel: "Glass transition temperature",
        measurement: {
          state: "known",
          value: { shape: "exact", value: 62, unit: "degC" },
        },
        method: {
          standard: "Synthetic standard A",
          annealed: false,
          conditioning: "Dry synthetic specimen",
        },
        qualification: "Representative value; verify the selected product data.",
        basis: [methodBasis("representative-product")],
      },
    ],
    properties: {
      wearAbrasion: claim("wear", "moderate-wear"),
      impactResistance: claim("impact", "moderate-impact"),
      creepSustainedLoad: claim("creep", "moderate"),
      outdoorUv: claim("outdoor", "limited"),
      moistureSensitivity: claim("moisture", "moderate"),
      warpTendency: claim("warp", "low"),
      flexibility: claim("flexibility", "semi-rigid"),
      chemicalResistance: claim("chemical", "moderate"),
      density: claim("density", { shape: "exact", value: 1.2, unit: "g/cm3" }),
      coolingShrinkRisk: claim("shrink", "moderate"),
      dimensionalStability: claim("stability", "high"),
    },
    process: {
      printDifficulty: claim("difficulty", "moderate"),
      nozzleTemperature: claim("nozzle", {
        shape: "range",
        min: 205,
        max: 225,
        unit: "degC",
      }),
      bedTemperature: claim("bed", {
        shape: "range",
        min: 50,
        max: 70,
        unit: "degC",
      }),
      enclosure: claim("enclosure", "recommended"),
      hardenedNozzle: claim("hardened-nozzle", "not-required"),
      dryingPriority: claim("drying", "recommended"),
      ventilation: claim("ventilation", "good-ventilation"),
    },
    guidance: {
      bestSuitedFor: claim("uses", ["Synthetic fixtures", "Reviewed prototypes"]),
      tradeoffs: claim("tradeoffs", ["Validate the selected formulation"]),
      coolingFit: claim("cooling-fit", "managed-cooling"),
    },
    costTier: claim("cost", "medium"),
    startingProfile: {
      interpretation: "calibration-starting-point",
      printSpeed: startingClaim("print-speed", {
        shape: "exact",
        value: 55,
        unit: "mm/s",
      }),
      partCoolingFan: startingClaim("part-fan", {
        shape: "range",
        min: 20,
        max: 60,
        unit: "percent",
      }),
      bridgeSpeed: startingClaim("bridge-speed", {
        shape: "exact",
        value: 28,
        unit: "mm/s",
      }),
      bridgeFan: startingClaim("bridge-fan", {
        shape: "exact",
        value: 80,
        unit: "percent",
      }),
    },
  };
}

describe("complete evidence-aware material record", () => {
  it("parses every property, process, guidance, cost, and profile branch", () => {
    const parsed = MaterialSchema.parse(validMaterial());

    expect(parsed.id).toBe(syntheticIds.material);
    expect(parsed.serviceTemperature.value).toMatchObject({
      state: "known",
      value: { shape: "range", min: -20, max: 80, unit: "degC" },
    });
    expect(parsed.properties.density.value).toMatchObject({ state: "known" });
    expect(parsed.startingProfile.interpretation).toBe("calibration-starting-point");
    expectTypeOf(parsed).toEqualTypeOf<Material>();
  });

  it("publishes an exact, unique 32-concept semantic inventory", () => {
    expect(MATERIAL_SEMANTIC_FIELDS).toHaveLength(32);
    expect(new Set(MATERIAL_SEMANTIC_FIELDS.map(({ key }) => key)).size).toBe(32);
    expect(new Set(MATERIAL_SEMANTIC_FIELDS.map(({ path }) => path)).size).toBe(32);
    expect(MATERIAL_SEMANTIC_FIELDS.map(({ key }) => key)).toEqual([
      "material-name",
      "family-or-fill",
      "service-temperature-low",
      "service-temperature-high",
      "thermal-metric",
      "thermal-value",
      "wear-abrasion",
      "impact-resistance",
      "creep-sustained-load",
      "outdoor-uv",
      "moisture-sensitivity",
      "print-difficulty",
      "nozzle-temperature",
      "bed-temperature",
      "enclosure-requirement",
      "hardened-nozzle-requirement",
      "warp-tendency",
      "flexibility",
      "chemical-resistance",
      "density",
      "recommended-uses",
      "tradeoffs",
      "cooling-shrink-risk",
      "dimensional-stability",
      "cooling-fit-guidance",
      "drying-priority",
      "ventilation-category",
      "relative-cost-tier",
      "starting-print-speed",
      "part-cooling-fan",
      "bridge-speed",
      "bridge-fan",
    ]);
  });

  it("requires all 32 concept-bearing branches and rejects unknown nested keys", () => {
    const missingDensity = validMaterial();
    Reflect.deleteProperty(missingDensity.properties, "density");
    expect(MaterialSchema.safeParse(missingDensity).success).toBe(false);

    const extra = validMaterial();
    Object.assign(extra.process, { hiddenCoordinate: "synthetic-only" });
    expect(MaterialSchema.safeParse(extra).success).toBe(false);
  });

  it("requires all starting settings to use starting-profile guidance", () => {
    const wrongScope = validMaterial();
    wrongScope.startingProfile.printSpeed.basis = [methodBasis("family-guidance")];
    const result = MaterialSchema.safeParse(wrongScope);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(({ message }) => message === "STARTING_PROFILE_BASIS_INVALID")).toBe(true);
    }
  });

  it("does not accept a guaranteed or maximum profile interpretation", () => {
    const guaranteed = validMaterial();
    guaranteed.startingProfile.interpretation = "guaranteed-setting";
    expect(MaterialSchema.safeParse(guaranteed).success).toBe(false);
  });
});

