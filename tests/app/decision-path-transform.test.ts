import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { AtlasV1 } from "../../src/data/schema/atlas.ts";
import { decisionLaneIds } from "../../src/data/schema/decision-lane.ts";
import { buildDecisionPaths } from "../../src/features/map/decision-path.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

const expectedCounts = [4, 13, 8, 4, 7, 4, 2, 2] as const;

function cloneAtlas(): AtlasV1 {
  return structuredClone(loadPublicAtlas());
}

function reverseRegistries(atlas: AtlasV1): AtlasV1 {
  atlas.materials.reverse();
  atlas.decisionLanes.reverse();
  atlas.processGates.reverse();
  atlas.visualizationReferences.reverse();
  atlas.vocabularies.reverse();
  return atlas;
}

describe("complete decision-path transform", () => {
  it("derives exactly eight four-stage paths in canonical order", () => {
    const atlas = loadPublicAtlas();
    const result = buildDecisionPaths(atlas, "/atlas-preview/");

    expect(result.map(({ id }) => id)).toEqual(decisionLaneIds);
    expect(result.map(({ candidates }) => candidates.length)).toEqual(expectedCounts);
    expect(
      result.every(
        ({ need, propertyChecks, verification }) =>
          need.length > 0 && propertyChecks.length > 0 && verification.length > 0,
      ),
    ).toBe(true);

    const materialIds = new Set(atlas.materials.map(({ id }) => id));
    const gateIds = new Set(atlas.processGates.map(({ id }) => id));
    for (const lane of result) {
      expect(lane.href).toBe(`/atlas-preview/map/#${lane.id}`);
      expect(
        lane.propertyChecks.every(({ field, label }) => field.length > 0 && label.length > 0),
      ).toBe(true);
      expect(
        lane.candidates.every(
          ({ id, href }) => materialIds.has(id) && href.startsWith("/atlas-preview/materials/"),
        ),
      ).toBe(true);
      expect(
        lane.processGates.every(
          ({ id, href, capabilityLabel }) =>
            gateIds.has(id) && href === `/atlas-preview/map/#${id}` && capabilityLabel.length > 0,
        ),
      ).toBe(true);
    }
  });

  it("splits the first eight visible candidates from deterministic overflow without hiding totals", () => {
    const paths = buildDecisionPaths(loadPublicAtlas());
    const outdoor = paths.find(({ id }) => id === "lane-outdoor")!;
    const impact = paths.find(({ id }) => id === "lane-impact-flex")!;

    expect(outdoor.candidates).toHaveLength(13);
    expect(outdoor.visibleCandidates).toEqual(outdoor.candidates.slice(0, 8));
    expect(outdoor.overflowCandidates).toEqual(outdoor.candidates.slice(8));
    expect(impact.visibleCandidates).toHaveLength(8);
    expect(impact.overflowCandidates).toEqual([]);
  });

  it("keeps zero, one, nine, and thirteen candidate boundaries explicit", () => {
    const baseline = loadPublicAtlas();
    const outdoorIds = buildDecisionPaths(baseline)
      .find(({ id }) => id === "lane-outdoor")!
      .candidates.map(({ id }) => id);

    for (const count of [0, 1, 9, 13]) {
      const atlas = cloneAtlas();
      const allowed = new Set(outdoorIds.slice(0, count));
      atlas.materials = atlas.materials.filter(({ id }) => allowed.has(id));
      atlas.visualizationReferences = atlas.visualizationReferences.filter(
        ({ kind }) => kind === "decision-path",
      );
      const outdoor = buildDecisionPaths(atlas).find(({ id }) => id === "lane-outdoor")!;
      expect(outdoor.candidates).toHaveLength(count);
      expect(outdoor.visibleCandidates).toHaveLength(Math.min(count, 8));
      expect(outdoor.overflowCandidates).toHaveLength(Math.max(0, count - 8));
    }
  });

  it("retains indeterminate material IDs outside the candidate split", () => {
    const atlas = cloneAtlas();
    const material = atlas.materials[0]!;
    material.properties.outdoorUv.value = { state: "unknown", reason: "Synthetic unknown." };
    material.properties.moistureSensitivity.value = {
      state: "unknown",
      reason: "Synthetic unknown.",
    };

    const lane = buildDecisionPaths(atlas).find(({ id }) => id === "lane-outdoor")!;
    expect(lane.indeterminateMaterialIds).toContain(material.id);
    expect(lane.candidates.map(({ id }) => id)).not.toContain(material.id);
  });

  it("is invariant to every relevant canonical registry permutation", () => {
    expect(buildDecisionPaths(reverseRegistries(cloneAtlas()), "/repo/")).toEqual(
      buildDecisionPaths(loadPublicAtlas(), "/repo/"),
    );
  });

  it.each([
    [
      "DECISION_PATH_LANE_DUPLICATE",
      (atlas: AtlasV1) => {
        atlas.decisionLanes[1] = structuredClone(atlas.decisionLanes[0]!);
      },
    ],
    [
      "DECISION_PATH_LANE_MISSING",
      (atlas: AtlasV1) => {
        atlas.decisionLanes.pop();
      },
    ],
    [
      "DECISION_PATH_MATERIAL_MISSING",
      (atlas: AtlasV1) => {
        atlas.visualizationReferences[0]!.related.push({
          kind: "material-id",
          materialId: "material-missing" as AtlasV1["materials"][number]["id"],
        });
      },
    ],
    [
      "DECISION_PATH_GATE_MISSING",
      (atlas: AtlasV1) => {
        atlas.processGates = atlas.processGates.slice(1);
      },
    ],
    [
      "DECISION_PATH_VISUALIZATION_MISSING",
      (atlas: AtlasV1) => {
        atlas.visualizationReferences = atlas.visualizationReferences.filter(
          ({ kind }) => kind !== "decision-path",
        );
      },
    ],
    [
      "DECISION_PATH_PROPERTY_LABEL_MISSING",
      (atlas: AtlasV1) => {
        atlas.decisionLanes[0]!.propertyChecks[0] = "properties.warpTendency.order";
      },
    ],
  ] as const)("fails closed with %s", (code, mutate) => {
    const atlas = cloneAtlas();
    mutate(atlas);
    expect(() => buildDecisionPaths(atlas)).toThrow(code);
  });

  it("delegates candidacy and contains no copied material fixture", () => {
    const source = readFileSync("src/features/map/decision-path.ts", "utf8");
    expect(source).toMatch(/deriveDecisionLaneMembership/u);
    expect(source).not.toMatch(/candidateMaterialIds\s*:/u);
    expect(source).not.toMatch(/"material-(?!id"|route")[a-z0-9-]+"/u);
    expect(source).not.toMatch(/selector\/(?:engine|presentation|page-model)/u);
  });
});
