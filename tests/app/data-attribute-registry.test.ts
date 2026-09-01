import { describe, expect, it } from "vitest";

import { compareThermalObservations, type Material } from "../../src/data/schema/material.ts";
import {
  DATA_ATTRIBUTE_GROUPS,
  DATA_ATTRIBUTE_REGISTRY,
} from "../../src/features/data-explorer/attribute-registry.ts";
import { createMinimalMaterial } from "../fixtures/atlas-minimal.valid.ts";
import {
  createIncompatibleThermalObservations,
  createPhase7OverflowMaterial,
  PHASE7_EVIDENCE_SCOPES,
  PHASE7_FACT_STATES,
  PHASE7_SCOPE_BASIS,
} from "../fixtures/phase7-public-cases.ts";

const EXPECTED_GROUPS = [
  [
    "identity-thermal",
    "Identity and thermal behavior",
    [
      "material-name",
      "family-or-fill",
      "service-temperature-low",
      "service-temperature-high",
      "thermal-metric",
      "thermal-value",
    ],
  ],
  [
    "mechanical-use",
    "Mechanical and use behavior",
    ["wear-abrasion", "impact-resistance", "creep-sustained-load", "flexibility"],
  ],
  [
    "environment-exposure",
    "Environment and exposure",
    ["outdoor-uv", "moisture-sensitivity", "chemical-resistance"],
  ],
  [
    "print-process",
    "Print and process requirements",
    [
      "print-difficulty",
      "nozzle-temperature",
      "bed-temperature",
      "enclosure-requirement",
      "hardened-nozzle-requirement",
      "warp-tendency",
    ],
  ],
  [
    "dimensional-cooling",
    "Dimensional behavior and cooling",
    ["cooling-shrink-risk", "dimensional-stability", "cooling-fit-guidance"],
  ],
  [
    "handling-density-cost",
    "Handling, density, and cost",
    ["drying-priority", "ventilation-category", "density", "relative-cost-tier"],
  ],
  ["uses-tradeoffs", "Uses and tradeoffs", ["recommended-uses", "tradeoffs"]],
  [
    "starting-profile",
    "Starting print profile",
    ["starting-print-speed", "part-cooling-fan", "bridge-speed", "bridge-fan"],
  ],
] as const;

const EXPECTED_KEYS = EXPECTED_GROUPS.flatMap(([, , keys]) => keys);

describe("data attribute registry", () => {
  it("registers the independent 8-group, 32-field inventory exactly once", () => {
    expect(
      DATA_ATTRIBUTE_GROUPS.map(({ key, label, fields }) => [
        key,
        label,
        fields.map(({ key: fieldKey }) => fieldKey),
      ]),
    ).toEqual(EXPECTED_GROUPS);
    expect(DATA_ATTRIBUTE_REGISTRY.map(({ key }) => key)).toEqual(EXPECTED_KEYS);
    expect(new Set(DATA_ATTRIBUTE_REGISTRY.map(({ key }) => key))).toHaveLength(32);
  });

  it("declares complete closed presentation behavior for every field", () => {
    for (const [index, field] of DATA_ATTRIBUTE_REGISTRY.entries()) {
      expect(field.displayOrder).toBe(index);
      expect(field.label).toMatch(/^[A-Z][^\n]*$/u);
      expect(field.help).toMatch(/\S/u);
      expect(field.valueKind).toMatch(
        /^(identity|fact|service-endpoint|thermal-metric|thermal-value)$/u,
      );
      expect(field.search).toMatch(/^(display|none)$/u);
      expect(field.filter).toMatch(/^(state-and-scope|scope|none)$/u);
      expect(field.sort).toMatch(/^(canonical|label|vocabulary|number|none)$/u);
    }
    expect(DATA_ATTRIBUTE_REGISTRY.find(({ key }) => key === "thermal-value")?.sort).toBe("none");
  });

  it("uses direct accessors while keeping unlike thermal concepts separate", () => {
    const material = createMinimalMaterial() as unknown as Material;
    const byKey = new Map(DATA_ATTRIBUTE_REGISTRY.map((field) => [field.key, field]));

    expect(byKey.get("material-name")?.read(material)).toEqual({
      kind: "identity",
      value: "Synthetic Alpha",
    });
    expect(byKey.get("service-temperature-low")?.read(material)).toMatchObject({
      kind: "service-endpoint",
      endpoint: "low",
      fact: { state: "known", value: -10 },
    });
    expect(byKey.get("service-temperature-high")?.read(material)).toMatchObject({
      kind: "service-endpoint",
      endpoint: "high",
      fact: { state: "known", value: 80 },
    });
    expect(byKey.get("thermal-metric")?.read(material)).toMatchObject({
      kind: "thermal-metric",
      observations: [{ metric: "glass-transition", metricLabel: "Glass transition temperature" }],
    });
    expect(byKey.get("thermal-value")?.read(material)).toMatchObject({
      kind: "thermal-value",
      observations: [{ measurement: { state: "known", value: { value: 62 } } }],
    });
  });

  it("exposes state and evidence scope without treating zero or false as missing", () => {
    const material = createMinimalMaterial() as unknown as Material;
    const service = DATA_ATTRIBUTE_REGISTRY.find(({ key }) => key === "service-temperature-low")!;
    const thermal = DATA_ATTRIBUTE_REGISTRY.find(({ key }) => key === "thermal-value")!;

    material.serviceTemperature.value = {
      state: "known",
      value: { shape: "range", min: 0, max: 80, unit: "degC" },
    };
    material.thermalObservations[0]!.method = { annealed: false };

    expect(service.read(material)).toMatchObject({ fact: { state: "known", value: 0 } });
    expect(service.states(material)).toEqual(["known"]);
    expect(service.scopes(material)).toEqual(["family-guidance"]);
    expect(thermal.states(material)).toEqual(["known"]);
    expect(thermal.scopes(material)).toEqual(["representative-product"]);
    expect(JSON.stringify(thermal.read(material))).toContain('"annealed":false');
  });

  it("provides held-out partial, overflow, scope, and measurement cases", () => {
    expect(Object.values(PHASE7_FACT_STATES).map(({ state }) => state)).toEqual([
      "known",
      "unknown",
      "conditional",
      "not-applicable",
      "missing",
    ]);
    expect(PHASE7_FACT_STATES.knownZero.value).toBe(0);
    expect(PHASE7_SCOPE_BASIS.map(({ scope }) => scope)).toEqual(PHASE7_EVIDENCE_SCOPES);

    const material = createPhase7OverflowMaterial();
    expect(material.name.length).toBeGreaterThan(80);
    expect(material.guidance.bestSuitedFor.value).toMatchObject({
      state: "known",
      value: expect.arrayContaining([expect.stringMatching(/remain atomic/u)]),
    });
    expect(material.startingProfile.partCoolingFan.value).toEqual({
      state: "known",
      value: { shape: "range", min: 0, max: 100, unit: "percent" },
    });
    expect(material.properties.density.value).toMatchObject({
      state: "conditional",
      value: { shape: "exact", value: 1.234 },
    });
    expect(material.thermalObservations[0]?.method?.annealed).toBe(false);
  });

  it("provides thermal observations that differ only by represented method", () => {
    const [left, right] = createIncompatibleThermalObservations();
    expect(left.metric).toBe(right.metric);
    expect(left.measurement).toEqual(right.measurement);
    expect(compareThermalObservations(left, right)).toEqual({
      comparable: false,
      code: "THERMAL_NOT_COMPARABLE",
    });
  });
});
