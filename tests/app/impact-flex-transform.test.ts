import { describe, expect, it } from "vitest";

import type { AtlasV1 } from "../../src/data/schema/atlas.ts";
import {
  flexibilityRatingValues,
  impactResistanceRatingValues,
  printDifficultyValues,
} from "../../src/data/schema/vocabularies.ts";
import {
  IMPACT_FLEX_LIMITATION,
  buildImpactFlexModel,
} from "../../src/features/map/impact-flex.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

function cloneAtlas(): AtlasV1 {
  return structuredClone(loadPublicAtlas());
}

function reverseInput(atlas: AtlasV1): AtlasV1 {
  atlas.materials.reverse();
  atlas.vocabularies.reverse();
  for (const vocabulary of atlas.vocabularies) vocabulary.terms.reverse();
  return atlas;
}

describe("complete impact-flex categorical transform", () => {
  it("plots all 23 baseline materials in nine canonical cells", () => {
    const model = buildImpactFlexModel(loadPublicAtlas(), "/atlas-preview/");

    expect(model.impactAxis.map(({ value }) => value)).toEqual(impactResistanceRatingValues);
    expect(model.flexibilityAxis.map(({ value }) => value)).toEqual(flexibilityRatingValues);
    expect(model.records.all).toHaveLength(23);
    expect(model.records.plotted).toHaveLength(23);
    expect(model.records.filtered).toEqual([]);
    expect(model.records.omitted).toEqual([]);
    expect(model.cells).toHaveLength(9);
    expect(Math.max(...model.cells.map(({ records }) => records.length))).toBe(6);
    expect(model.limitation).toBe(IMPACT_FLEX_LIMITATION);
    expect(model.limitation).toContain("Category spacing is not a measured physical distance");
    expect(model.limitation).toContain("does not rank overall material quality");

    for (const cell of model.cells) {
      expect(cell.records.map(({ slot }) => slot)).toEqual(
        Array.from({ length: cell.records.length }, (_, index) => index),
      );
    }
    expect(model.records.all.every(({ material }) =>
      material.href.startsWith("/atlas-preview/materials/") && material.href.endsWith("/"))).toBe(true);
  });

  it("assigns the six-record collision by display order and stable ID", () => {
    const model = buildImpactFlexModel(loadPublicAtlas());
    const collision = model.cells.find(({ impact, flexibility }) =>
      impact === "high-impact" && flexibility === "semi-rigid")!;

    expect(collision.records.map(({ material: { id }, slot }) => [id, slot])).toEqual([
      ["material-tough-pla", 0],
      ["material-petg", 1],
      ["material-abs", 2],
      ["material-asa", 3],
      ["material-hips", 4],
      ["material-cpe", 5],
    ]);
    expect(collision.count).toBe(6);
  });

  it("is invariant to material, vocabulary, and term permutation", () => {
    expect(buildImpactFlexModel(reverseInput(cloneAtlas()), "/repo/"))
      .toEqual(buildImpactFlexModel(loadPublicAtlas(), "/repo/"));
  });

  it("keeps every axis-state omission visible with exact state and axis reasons", () => {
    const atlas = cloneAtlas();
    atlas.materials[0]!.properties.impactResistance.value = {
      state: "unknown",
      reason: "Impact value must be verified.",
    };
    atlas.materials[1]!.properties.impactResistance.value = {
      state: "conditional",
      condition: "Impact depends on treatment.",
    };
    atlas.materials[2]!.properties.impactResistance.value = {
      state: "not-applicable",
      reason: "Impact category does not apply.",
    };
    atlas.materials[3]!.properties.impactResistance.value = {
      state: "missing",
      reason: "Impact was not reported.",
    };
    atlas.materials[4]!.properties.flexibility.value = {
      state: "unknown",
      reason: "Flexibility value must be verified.",
    };
    atlas.materials[5]!.properties.flexibility.value = {
      state: "conditional",
      condition: "Flexible only after conditioning.",
      value: "semi-rigid",
    };

    const model = buildImpactFlexModel(atlas);
    expect(model.records.all).toHaveLength(23);
    expect(model.records.omitted).toHaveLength(5);
    expect(model.records.plotted).toHaveLength(18);
    expect(model.records.filtered).toEqual([]);
    const omissions = new Map(model.records.omitted.map((record) => [record.material.id, record]));
    expect(omissions.get(atlas.materials[0]!.id)).toMatchObject({
      disposition: { disposition: "omitted", code: "impact-value-unavailable" },
      omissionDetails: [{ axis: "impact", code: "unknown-value" }],
    });
    expect(omissions.get(atlas.materials[1]!.id)).toMatchObject({
      disposition: { disposition: "omitted", code: "impact-value-unavailable" },
      omissionDetails: [{ axis: "impact", code: "conditional-without-value" }],
    });
    expect(omissions.get(atlas.materials[2]!.id)).toMatchObject({
      disposition: { disposition: "omitted", code: "impact-value-unavailable" },
      omissionDetails: [{ axis: "impact", code: "not-applicable" }],
    });
    expect(omissions.get(atlas.materials[3]!.id)).toMatchObject({
      disposition: { disposition: "omitted", code: "impact-value-unavailable" },
      omissionDetails: [{ axis: "impact", code: "not-reported" }],
    });
    expect(omissions.get(atlas.materials[4]!.id)).toMatchObject({
      disposition: { disposition: "omitted", code: "flexibility-value-unavailable" },
      omissionDetails: [{ axis: "flexibility", code: "unknown-value" }],
    });
    const conditional = model.records.plotted.find(({ material }) =>
      material.id === atlas.materials[5]!.id)!;
    expect(conditional.flexibilityFact).toMatchObject({
      state: "conditional",
      condition: "Flexible only after conditioning.",
      display: expect.arrayContaining(["Semi rigid"]),
    });
  });

  it("handles zero, one, and all query results without deleting table records", () => {
    const atlas = loadPublicAtlas();
    const all = buildImpactFlexModel(atlas, undefined, { query: "" });
    const one = buildImpactFlexModel(atlas, undefined, { query: "PEEK" });
    const zero = buildImpactFlexModel(atlas, undefined, { query: "no such public material" });

    expect(all.records.plotted).toHaveLength(23);
    expect(one.records.plotted.map(({ material: { id } }) => id)).toEqual(["material-peek"]);
    expect(one.records.filtered).toHaveLength(22);
    expect(zero.records.plotted).toEqual([]);
    expect(zero.records.filtered).toHaveLength(23);
    expect([all, one, zero].every(({ records }) => records.all.length === 23)).toBe(true);
  });

  it("combines maximum difficulty with query and retains a filtered selection", () => {
    const atlas = loadPublicAtlas();
    const easy = buildImpactFlexModel(atlas, undefined, { maximumDifficulty: "easy" });
    const selected = buildImpactFlexModel(atlas, undefined, {
      maximumDifficulty: "easy",
      query: "PEEK",
      selectedMaterialId: "material-peek",
    });

    expect(easy.records.plotted.map(({ printDifficulty }) => printDifficulty)).toEqual([
      "easy",
      "easy",
      "easy",
      "easy",
    ]);
    expect(easy.records.all).toHaveLength(23);
    expect(selected.records.plotted).toEqual([]);
    expect(selected.records.filtered).toHaveLength(23);
    expect(selected.selected).toMatchObject({
      outsideFilter: true,
      record: { material: { id: "material-peek" } },
    });
    expect(selected.selected!.record.disposition).toMatchObject({
      disposition: "filtered",
      filter: { kind: "maximum-difficulty", value: "easy" },
    });
  });

  it("maps only canonical print-difficulty shapes and leaves encoding off by default", () => {
    const atlas = loadPublicAtlas();
    const defaultModel = buildImpactFlexModel(atlas);
    const shaped = buildImpactFlexModel(atlas, undefined, { encodeDifficultyShapes: true });

    expect(defaultModel.shapesEnabled).toBe(false);
    expect(defaultModel.shapeLegend).toEqual([]);
    expect(defaultModel.records.all.every(({ shape }) => shape === undefined)).toBe(true);
    expect(shaped.shapesEnabled).toBe(true);
    expect(shaped.shapeLegend.map(({ value }) => value)).toEqual(printDifficultyValues);
    expect(new Map(shaped.shapeLegend.map(({ value, shape }) => [value, shape]))).toEqual(new Map([
      ["easy", "circle"],
      ["moderate", "square"],
      ["advanced", "diamond"],
      ["expert", "triangle"],
    ]));
    expect(shaped.records.all.every(({ printDifficulty, shape }) =>
      printDifficulty !== undefined && shape !== undefined)).toBe(true);
  });
});
