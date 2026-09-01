import { describe, expect, expectTypeOf, it } from "vitest";

import type { FactState } from "../../src/data/schema/fact-state.ts";
import type { ClaimId, MaterialId } from "../../src/data/schema/ids.ts";
import {
  compareThermalObservations,
  type ThermalObservation,
} from "../../src/data/schema/material.ts";
import { partitionCompatibleThermalObservations } from "../../src/domain/thermal/compatibility-groups.ts";
import {
  MAP_MODES,
  MAP_OMISSION_CODES,
  type MapDisposition,
  type MapFilter,
  type MapInternalHref,
  type MapSelectionAction,
} from "../../src/features/map/contracts.ts";
import { deriveDecisionLaneMembership } from "../../src/domain/decision-lanes/membership.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";
import {
  phase8CandidateSets,
  phase8FactStates,
  phase8InvalidPublicReferences,
  phase8LongText,
  phase8SixWayCollision,
  phase8StaleSelections,
} from "../fixtures/phase8-public-cases.ts";

describe("Phase 8 shared map seams", () => {
  it("closes the four modes, dispositions, omission codes, filters, and selection actions", () => {
    expect(MAP_MODES).toEqual([
      "decision-paths",
      "thermal-ranges",
      "process-gates",
      "impact-flex-space",
    ]);
    expect(MAP_OMISSION_CODES).toEqual([
      "unknown-value",
      "conditional-without-value",
      "not-applicable",
      "not-reported",
      "impact-value-unavailable",
      "flexibility-value-unavailable",
      "no-observation-in-group",
      "invalid-public-reference",
      "transform-failed",
    ]);

    expectTypeOf<MapInternalHref>().toMatchTypeOf<`/${string}`>();
    expectTypeOf<MapDisposition>().toMatchTypeOf<
      | { readonly disposition: "plotted" }
      | { readonly disposition: "filtered"; readonly filter: MapFilter }
      | {
          readonly disposition: "omitted";
          readonly code: (typeof MAP_OMISSION_CODES)[number];
          readonly reason: string;
        }
    >();
    expectTypeOf<MapSelectionAction>().toMatchTypeOf<
      | { readonly type: "select-material"; readonly materialId: MaterialId }
      | {
          readonly type: "clear-selection";
          readonly target: "all" | "lane" | "material" | "gate" | "thermal-group";
        }
    >();
  });

  it("provides synthetic coverage for every planned edge without source-system data", () => {
    expect(Object.values(phase8FactStates).map(({ state }) => state)).toEqual([
      "known",
      "unknown",
      "conditional",
      "conditional",
      "not-applicable",
      "missing",
    ] satisfies FactState<number>["state"][]);
    expect(phase8CandidateSets.zero).toHaveLength(0);
    expect(phase8CandidateSets.one).toHaveLength(1);
    expect(phase8CandidateSets.eight).toHaveLength(8);
    expect(phase8CandidateSets.nine).toHaveLength(9);
    expect(phase8CandidateSets.thirteen).toHaveLength(13);
    expect(phase8SixWayCollision).toHaveLength(6);
    expect(phase8LongText.laneLabel.length).toBeGreaterThan(80);
    expect(Object.values(phase8StaleSelections)).toHaveLength(4);
    expect(phase8InvalidPublicReferences).toHaveLength(4);
  });

  it("keeps fixtures and contracts on the exact public allow-list", () => {
    const serialized = JSON.stringify({
      phase8FactStates,
      phase8CandidateSets,
      phase8SixWayCollision,
      phase8LongText,
      phase8StaleSelections,
      phase8InvalidPublicReferences,
    });
    const prohibitedKeys = [
      "sourceLocator",
      "sourceSystem",
      "externalUrl",
      "candidateRule",
      "credential",
      "operationalPath",
      "privateMetadata",
      "basis",
    ];
    for (const key of prohibitedKeys) expect(serialized).not.toContain(`\"${key}\"`);
    expect(serialized).not.toMatch(/(?:https?:)?\/\//u);
  });

  it("retains the Phase 6 live decision-lane membership authority", () => {
    const membership = deriveDecisionLaneMembership(loadPublicAtlas());
    expect(membership).toHaveLength(8);
    expect(membership.map(({ candidateMaterialIds }) => candidateMaterialIds.length)).toEqual([
      4, 2, 4, 7, 8, 4, 13, 2,
    ]);
  });

  it("partitions named observations deterministically through canonical compatibility", () => {
    const atlas = loadPublicAtlas();
    const inputs = atlas.materials.flatMap((material) =>
      material.thermalObservations.map((observation) => ({
        materialId: material.id,
        observation,
      })),
    );
    const expected = partitionCompatibleThermalObservations(inputs);
    const permuted = partitionCompatibleThermalObservations([...inputs].reverse());
    const originalByKey = new Map(
      inputs.map(
        ({ materialId, observation }) => [`${materialId}\0${observation.id}`, observation] as const,
      ),
    );

    expect(JSON.stringify(permuted)).toBe(JSON.stringify(expected));
    expect(
      expected.map(({ members }) => members.length).sort((left, right) => right - left),
    ).toEqual([8, 5, 3, 2, 2, 1, 1, 1]);
    expect(expected.every(({ members }) => members.length > 0)).toBe(true);
    for (const group of expected) {
      for (const left of group.members) {
        for (const right of group.members) {
          const leftOriginal = originalByKey.get(`${left.materialId}\0${left.observation.id}`);
          const rightOriginal = originalByKey.get(`${right.materialId}\0${right.observation.id}`);
          expect(leftOriginal).toBeDefined();
          expect(rightOriginal).toBeDefined();
          expect(compareThermalObservations(leftOriginal!, rightOriginal!).comparable).toBe(true);
        }
      }
    }
  });

  it("retains every observation semantic while all represented method dimensions partition", () => {
    const original = structuredClone(loadPublicAtlas().materials[0]!.thermalObservations[0]!);
    const variants: ThermalObservation[] = [
      original,
      {
        ...structuredClone(original),
        id: "claim-synthetic-standard" as ClaimId,
        method: { ...original.method, standard: "Synthetic standard" },
      },
      {
        ...structuredClone(original),
        id: "claim-synthetic-load" as ClaimId,
        method: { ...original.method, loadMpa: 12.5 },
      },
      {
        ...structuredClone(original),
        id: "claim-synthetic-annealed" as ClaimId,
        method: { ...original.method, annealed: !(original.method?.annealed ?? false) },
      },
      {
        ...structuredClone(original),
        id: "claim-synthetic-conditioning" as ClaimId,
        method: { ...original.method, conditioning: "Synthetic conditioning" },
      },
      {
        ...structuredClone(original),
        id: "claim-synthetic-other" as ClaimId,
        method: { ...original.method, otherConditions: "Synthetic other condition" },
      },
    ];
    const groups = partitionCompatibleThermalObservations(
      variants.map((observation, index) => ({
        materialId: `material-synthetic-thermal-${index + 1}` as MaterialId,
        observation,
      })),
    );

    expect(groups).toHaveLength(variants.length);
    const retained = groups.flatMap(({ members }) => members);
    expect(retained).toHaveLength(variants.length);
    expect(retained[0]).toHaveProperty("observation.metricLabel");
    expect(retained[0]).toHaveProperty("observation.measurement");
    expect(retained[0]).toHaveProperty("observation.qualification");
    expect(retained[0]).toHaveProperty("observation.basisScopes");
  });

  it("keeps singleton and empty partitions valid and rejects duplicate public references", () => {
    const material = loadPublicAtlas().materials[0]!;
    const input = { materialId: material.id, observation: material.thermalObservations[0]! };
    expect(partitionCompatibleThermalObservations([])).toEqual([]);
    expect(partitionCompatibleThermalObservations([input])).toHaveLength(1);
    expect(() => partitionCompatibleThermalObservations([input, input])).toThrow(
      "THERMAL_PARTITION_DUPLICATE_OBSERVATION",
    );
  });
});
