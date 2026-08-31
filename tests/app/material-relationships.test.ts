import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { AtlasV1 } from "../../src/data/schema/atlas.ts";
import { evaluatePredicate } from "../../src/domain/selector/predicate.ts";
import { resolveSelectorField } from "../../src/domain/selector/field-resolver.ts";
import { deriveDecisionLaneMembership } from "../../src/domain/decision-lanes/membership.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

describe("decision-lane membership", () => {
  it("derives all eight lanes through the canonical predicate and field resolver", () => {
    const atlas = loadPublicAtlas();
    const result = deriveDecisionLaneMembership(atlas);

    expect(result).toHaveLength(8);
    for (const lane of result) {
      const canonical = atlas.decisionLanes.find(({ id }) => id === lane.id)!;
      const expectedCandidates = atlas.materials
        .filter((material) => evaluatePredicate(
          canonical.candidateRule,
          (field) => resolveSelectorField(material, field, atlas.vocabularies),
        ) === "match")
        .map(({ id }) => id)
        .sort();
      expect([...lane.candidateMaterialIds].sort()).toEqual(expectedCandidates);
      expect(lane.propertyChecks).toEqual(canonical.propertyChecks);
      expect(lane.processGates.map(({ id }) => id)).toEqual([...canonical.processGateIds].sort());
    }
  });

  it("is invariant to registry permutations", () => {
    const original = loadPublicAtlas();
    const permuted = structuredClone(original);
    permuted.materials.reverse();
    permuted.decisionLanes.reverse();
    permuted.processGates.reverse();
    permuted.visualizationReferences.reverse();

    expect(deriveDecisionLaneMembership(permuted)).toEqual(deriveDecisionLaneMembership(original));
  });

  it("retains indeterminate evaluations separately from candidates", () => {
    const atlas = structuredClone(loadPublicAtlas());
    const lane = atlas.decisionLanes.find(({ id }) => id === "lane-outdoor")!;
    const material = atlas.materials[0]!;
    material.properties.outdoorUv.value = { state: "unknown", reason: "Verify exact formulation." };
    material.properties.moistureSensitivity.value = { state: "unknown", reason: "Verify exact formulation." };
    const model = deriveDecisionLaneMembership(atlas).find(({ id }) => id === lane.id)!;

    expect(model.indeterminateMaterialIds).toContain(material.id);
    expect(model.candidateMaterialIds).not.toContain(material.id);
  });

  it.each([
    ["RELATIONSHIP_GATE_MISSING", (atlas: AtlasV1) => {
      atlas.decisionLanes[0]!.processGateIds[0] = "gate-missing" as AtlasV1["processGates"][number]["id"];
    }],
    ["RELATIONSHIP_VISUALIZATION_MISSING", (atlas: AtlasV1) => {
      atlas.visualizationReferences.push({
        id: "visualization-dangling" as AtlasV1["visualizationReferences"][number]["id"],
        kind: "decision-path",
        subject: { kind: "decision-lane-id", decisionLaneId: "lane-missing" as AtlasV1["decisionLanes"][number]["id"] },
        related: [],
      });
    }],
  ])("fails dangling relationships with %s", (code, mutate) => {
    const atlas = structuredClone(loadPublicAtlas());
    mutate(atlas);
    expect(() => deriveDecisionLaneMembership(atlas)).toThrow(code);
  });

  it("imports the bounded predicate and resolver rather than selector scoring", () => {
    const source = readFileSync("src/domain/decision-lanes/membership.ts", "utf8");
    expect(source).toMatch(/selector\/predicate/u);
    expect(source).toMatch(/selector\/field-resolver/u);
    expect(source).not.toMatch(/selector\/(?:engine|presentation|page-model)/u);
    expect(source).not.toMatch(/material-[a-z0-9-]+/u);
  });
});
