import { describe, expect, it } from "vitest";

import { MATERIAL_SEMANTIC_FIELDS, type Material } from "../../src/data/schema/material.ts";
import {
  MATERIAL_CLAIM_REGISTRY,
  enumerateMaterialClaims,
} from "../../src/features/materials/claim-registry.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";
import { createMinimalMaterial } from "../fixtures/atlas-minimal.valid.ts";

function independentClaimIds(material: Material): readonly string[] {
  return [
    material.familyOrFill.id,
    material.serviceTemperature.id,
    ...Object.values(material.properties).map(({ id }) => id),
    ...Object.values(material.process).map(({ id }) => id),
    ...Object.values(material.guidance).map(({ id }) => id),
    material.costTier.id,
    material.startingProfile.printSpeed.id,
    material.startingProfile.partCoolingFan.id,
    material.startingProfile.bridgeSpeed.id,
    material.startingProfile.bridgeFan.id,
    ...material.thermalObservations.map(({ id }) => id),
  ];
}

describe("material claim registry", () => {
  it("represents every reviewed semantic concept through stable typed descriptors", () => {
    const semanticKeys = MATERIAL_CLAIM_REGISTRY.flatMap(({ semanticKeys }) => semanticKeys);

    expect(semanticKeys).toEqual(MATERIAL_SEMANTIC_FIELDS.map(({ key }) => key));
    expect(new Set(semanticKeys).size).toBe(32);
    for (const [index, descriptor] of MATERIAL_CLAIM_REGISTRY.entries()) {
      expect(descriptor.displayOrder).toBe(index);
      expect(descriptor.key).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);
      expect(descriptor.label).toMatch(/^[A-Z][^\n]*$/u);
    }
  });

  it("enumerates every real claim ID exactly once", () => {
    const atlas = loadPublicAtlas();
    const enumerated = atlas.materials.flatMap((material) => enumerateMaterialClaims(material));
    const independentlyWalked = atlas.materials.flatMap(independentClaimIds);

    expect(enumerated).toHaveLength(667);
    expect(enumerated.map(({ claimId }) => claimId).sort()).toEqual([...independentlyWalked].sort());
    expect(new Set(enumerated.map(({ claimId }) => claimId)).size).toBe(667);
    expect(enumerated.every(({ anchor }) => /^[a-z][a-z0-9-]*$/u.test(anchor))).toBe(true);
  });

  it("keeps service guidance and named observations structurally distinct", () => {
    const [material] = loadPublicAtlas().materials;
    expect(material).toBeDefined();
    const claims = enumerateMaterialClaims(material!);
    const service = claims.find(({ descriptorKey }) => descriptorKey === "service-temperature");
    const observations = claims.filter(({ kind }) => kind === "named-thermal-observation");

    expect(service?.kind).toBe("service-guidance");
    expect(service?.semanticKeys).toEqual(["service-temperature-low", "service-temperature-high"]);
    expect(observations).toHaveLength(material!.thermalObservations.length);
    expect(observations.every(({ semanticKeys }) =>
      semanticKeys.join("|") === "thermal-metric|thermal-value"
    )).toBe(true);
  });

  it("supports held-out materials with zero or many thermal observations without array-order identity", () => {
    const zero = { ...createMinimalMaterial(), thermalObservations: [] } as Material;
    const first = createMinimalMaterial().thermalObservations[0]!;
    const second = {
      ...structuredClone(first),
      id: "claim-synthetic-melting-point",
      metric: "melting-point" as const,
      metricLabel: "Melting point",
    };
    const many = {
      ...createMinimalMaterial(),
      thermalObservations: [second, first],
    } as Material;

    expect(enumerateMaterialClaims(zero)).toHaveLength(28);
    const forward = enumerateMaterialClaims(many);
    const reversed = enumerateMaterialClaims({
      ...many,
      thermalObservations: [...many.thermalObservations].reverse(),
    });
    expect(forward.map(({ claimId, anchor }) => [claimId, anchor])).toEqual(
      reversed.map(({ claimId, anchor }) => [claimId, anchor]),
    );
    expect(forward).toHaveLength(30);
  });

  it("is independent of material display and Atlas array order", () => {
    const atlas = loadPublicAtlas();
    const material = structuredClone(atlas.materials.at(-1)!);
    const original = enumerateMaterialClaims(material);
    material.displayOrder = 0;
    material.name = "Changed display text";

    expect(enumerateMaterialClaims(material).map(({ claimId, anchor, displayOrder }) => ({
      claimId,
      anchor,
      displayOrder,
    }))).toEqual(original.map(({ claimId, anchor, displayOrder }) => ({
      claimId,
      anchor,
      displayOrder,
    })));
  });
});
