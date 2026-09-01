import type { FactState } from "../../src/data/schema/fact-state.ts";
import type { MaterialId } from "../../src/data/schema/ids.ts";
import type { MapProjection } from "../../src/features/map/contracts.ts";
import { compileMapProjection } from "../../src/features/map/projection.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

export const phase8FactStates = {
  known: { state: "known", value: 42 },
  unknown: { state: "unknown", reason: "Synthetic value is unknown." },
  conditionalWithValue: {
    state: "conditional",
    condition: "Synthetic condition applies.",
    value: 84,
  },
  conditionalWithoutValue: {
    state: "conditional",
    condition: "Synthetic condition has no numeric value.",
  },
  notApplicable: { state: "not-applicable", reason: "Synthetic case does not apply." },
  missing: { state: "missing", reason: "Synthetic value is not reported." },
} as const satisfies Readonly<Record<string, FactState<number>>>;

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
  laneLabel:
    "A deliberately long synthetic decision-lane label that must wrap without hiding any decision-relevant words",
  materialName:
    "Synthetic fiber-reinforced calibration material with an intentionally long public display name",
});

export const phase8StaleSelections = Object.freeze({
  materialId: "material-stale-selection" as MaterialId,
  laneId: "lane-stale-selection",
  gateId: "gate-stale-selection",
  thermalGroupId: "thermal-group-stale-selection",
});

export const phase8InvalidPublicReferences = Object.freeze([
  "materials/synthetic-without-leading-slash",
  "../synthetic-parent",
  "source-synthetic-record",
  "material missing namespace",
]);

export const phase8OmissionRecoveryReason =
  "Impact resistance is unavailable in this controlled test projection.";

/**
 * Build a test-only projection that makes the real map component render both
 * an explicit scientific omission and its bounded recovery state.
 */
export function phase8OmissionRecoveryProjection(base: string): MapProjection {
  const projection = structuredClone(
    compileMapProjection(loadPublicAtlas(), base),
  ) as MapProjection;
  const first = projection.impactFlex.records[0];
  if (first === undefined) throw new Error("PHASE8_OMISSION_FIXTURE_MISSING");
  const { impact: _impact, slot: _slot, shape: _shape, ...withoutImpact } = first;
  (projection.impactFlex.records as MapProjection["impactFlex"]["records"][number][])[0] = {
    ...withoutImpact,
    impactFact: {
      state: "unknown",
      display: ["Unknown", phase8OmissionRecoveryReason],
      reason: phase8OmissionRecoveryReason,
    },
    disposition: {
      disposition: "omitted",
      code: "impact-value-unavailable",
      reason: `Impact resistance: ${phase8OmissionRecoveryReason}`,
    },
  };
  (projection.lanes as MapProjection["lanes"][number][]).pop();
  return projection;
}
