import { describe, expect, expectTypeOf, it } from "vitest";

import type { FactState } from "../../src/data/schema/fact-state.ts";
import type { MaterialId } from "../../src/data/schema/ids.ts";
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
      | { readonly disposition: "omitted"; readonly code: (typeof MAP_OMISSION_CODES)[number]; readonly reason: string }
    >();
    expectTypeOf<MapSelectionAction>().toMatchTypeOf<
      | { readonly type: "select-material"; readonly materialId: MaterialId }
      | { readonly type: "clear-selection"; readonly target: "all" | "lane" | "material" | "gate" | "thermal-group" }
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
    ] satisfies FactState<string>["state"][]);
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
  });

  it("retains the Phase 6 live decision-lane membership authority", () => {
    const membership = deriveDecisionLaneMembership(loadPublicAtlas());
    expect(membership).toHaveLength(8);
    expect(membership.map(({ candidateMaterialIds }) => candidateMaterialIds.length)).toEqual([
      4,
      4,
      2,
      4,
      7,
      8,
      13,
      2,
    ]);
  });
});

