import type { BasisRef, EvidenceScope } from "../../src/data/schema/evidence.ts";
import type { FactState } from "../../src/data/schema/fact-state.ts";
import type { Material, ThermalObservation } from "../../src/data/schema/material.ts";
import { createMinimalMaterial } from "./atlas-minimal.valid.ts";

export const PHASE7_EVIDENCE_SCOPES = [
  "product-specific",
  "representative-product",
  "family-guidance",
  "qualitative-heuristic",
  "starting-profile-guidance",
  "derived-selector-logic",
] as const satisfies readonly EvidenceScope[];

export const PHASE7_FACT_STATES = Object.freeze({
  knownZero: { state: "known", value: 0 },
  unknown: { state: "unknown", reason: "Synthetic evidence does not report this value." },
  conditional: {
    state: "conditional",
    condition:
      "Use only after the synthetic specimen is dried, annealed, and conditioned for the stated test method.",
    value: 0,
  },
  notApplicable: { state: "not-applicable", reason: "This synthetic property does not apply." },
  missing: { state: "missing", reason: "The synthetic source ledger does not contain this field." },
} as const satisfies Readonly<Record<string, FactState<number>>>);

function scopeBasis(scope: EvidenceScope, index: number): BasisRef {
  return {
    kind: "method",
    methodId: `method-synthetic-phase-seven-${index}`,
    scope,
    note: `Synthetic ${scope} fixture`,
  } as unknown as BasisRef;
}

export const PHASE7_SCOPE_BASIS = Object.freeze(PHASE7_EVIDENCE_SCOPES.map(scopeBasis));

export function createPhase7OverflowMaterial(): Material {
  const material = structuredClone(createMinimalMaterial()) as unknown as Material;
  material.name =
    "Synthetic carbon-fiber-filled engineering polymer with a deliberately long public display label";
  material.properties.density.value = {
    state: "conditional",
    condition: PHASE7_FACT_STATES.conditional.condition,
    value: { shape: "exact", value: 1.234, unit: "g/cm3" },
  };
  material.guidance.bestSuitedFor.value = {
    state: "known",
    value: [
      "Long synthetic application statement that must remain atomic and wrap without losing its evidence context.",
      "A second synthetic application statement retained in source order.",
    ],
  };
  material.startingProfile.partCoolingFan.value = {
    state: "known",
    value: { shape: "range", min: 0, max: 100, unit: "percent" },
  };
  material.thermalObservations[0]!.method = {
    standard: "Synthetic standard A",
    loadMpa: 0.45,
    annealed: false,
    conditioning: "Synthetic dry-as-printed condition",
    otherConditions: "Synthetic long-span fixture condition for overflow coverage",
  };
  return material;
}

export function createIncompatibleThermalObservations(): readonly [
  ThermalObservation,
  ThermalObservation,
] {
  const first = structuredClone(
    createMinimalMaterial().thermalObservations[0]!,
  ) as ThermalObservation;
  const second = structuredClone(first);
  second.id = "claim-synthetic-phase-seven-thermal-second" as ThermalObservation["id"];
  second.method = { ...second.method, annealed: true };
  return [first, second];
}
