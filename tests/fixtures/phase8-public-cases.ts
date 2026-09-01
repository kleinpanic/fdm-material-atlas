import type { FactState } from "../../src/data/schema/fact-state.ts";
import type { MaterialId } from "../../src/data/schema/ids.ts";

export const phase8FactStates = {
  known: { state: "known", value: "invented-known-value" },
  unknown: { state: "unknown", reason: "Synthetic value is unknown." },
  conditionalWithValue: {
    state: "conditional",
    condition: "Synthetic condition applies.",
    value: "invented-conditional-value",
  },
  conditionalWithoutValue: {
    state: "conditional",
    condition: "Synthetic condition has no numeric value.",
  },
  notApplicable: { state: "not-applicable", reason: "Synthetic case does not apply." },
  missing: { state: "missing", reason: "Synthetic value is not reported." },
} as const satisfies Readonly<Record<string, FactState<string>>>;

function materialId(index: number): MaterialId {
  return `material-synthetic-${String(index).padStart(2, "0")}` as MaterialId;
}

export const phase8CandidateSets = Object.freeze({
  zero: Object.freeze([] as MaterialId[]),
  one: Object.freeze([materialId(1)]),
  eight: Object.freeze(Array.from({ length: 8 }, (_, index) => materialId(index + 1))),
  nine: Object.freeze(Array.from({ length: 9 }, (_, index) => materialId(index + 1))),
  thirteen: Object.freeze(Array.from({ length: 13 }, (_, index) => materialId(index + 1))),
});

export const phase8SixWayCollision = Object.freeze(
  Array.from({ length: 6 }, (_, index) => ({
    materialId: materialId(index + 1),
    impact: "high-impact" as const,
    flexibility: "semi-rigid" as const,
  })),
);

export const phase8LongText = Object.freeze({
  laneLabel: "A deliberately long synthetic decision-lane label that must wrap without hiding any decision-relevant words",
  materialName: "Synthetic fiber-reinforced calibration material with an intentionally long public display name",
});

export const phase8StaleSelections = Object.freeze({
  materialId: "material-stale-selection" as MaterialId,
  laneId: "lane-stale-selection",
  gateId: "gate-stale-selection",
  thermalGroupId: "thermal-group-stale-selection",
});

export const phase8InvalidPublicReferences = Object.freeze([
  "https://invalid.example/synthetic",
  "../synthetic-parent",
  "source-synthetic-record",
  "material missing namespace",
]);

