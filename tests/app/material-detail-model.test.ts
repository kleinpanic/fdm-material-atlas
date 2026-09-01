import { describe, expect, it } from "vitest";

import type { AtlasV1 } from "../../src/data/schema/atlas.ts";
import { parseAtlas } from "../../src/data/schema/parse-atlas.ts";
import { buildMaterialDetailModels } from "../../src/features/materials/detail-model.ts";
import { enumerateMaterialClaims } from "../../src/features/materials/claim-registry.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";
import { createMinimalAtlas } from "../fixtures/atlas-minimal.valid.ts";

describe("material detail models", () => {
  it("builds 23 complete models and accounts for all 667 claims exactly once", () => {
    const atlas = loadPublicAtlas();
    const models = buildMaterialDetailModels(atlas, "/");
    const claimIds = models.flatMap(({ claims }) => claims.map(({ claimId }) => claimId));

    expect(models).toHaveLength(23);
    expect(new Set(models.map(({ slug }) => slug)).size).toBe(23);
    expect(claimIds).toHaveLength(667);
    expect(new Set(claimIds).size).toBe(667);
    expect(claimIds.sort()).toEqual(
      atlas.materials.flatMap(enumerateMaterialClaims).map(({ claimId }) => claimId).sort(),
    );
    expect(models.map(({ displayOrder }) => displayOrder)).toEqual(
      [...models.map(({ displayOrder }) => displayOrder)].sort((a, b) => a - b),
    );
  });

  it("keeps every required section, profile scope, and limitation visible", () => {
    const models = buildMaterialDetailModels(loadPublicAtlas(), "/");
    for (const model of models) {
      expect(model.overview.familyOrFill).toBeDefined();
      expect(model.thermal.serviceGuidance.kind).toBe("service-guidance");
      expect(model.properties.length).toBeGreaterThan(0);
      expect(model.process.length).toBeGreaterThan(0);
      expect(model.usesTradeoffs.recommendedUses).toBeDefined();
      expect(model.startingProfile.settings).toHaveLength(4);
      expect(model.startingProfile.settings.every(({ scopes }) =>
        scopes.every((scope) => scope === "starting-profile-guidance")
      )).toBe(true);
      expect(model.evidence.records.length).toBeGreaterThan(0);
      expect(model.limitations.join(" ")).toContain("not an engineering safety certification");
      expect(model.continuity.currentMaterialId).toBe(model.id);
      expect(model.continuity.relatedMaterials.length).toBeGreaterThan(0);
    }
  });

  it.each([
    ["/", "/method/#", "/materials/"],
    ["/atlas-preview/", "/atlas-preview/method/#", "/atlas-preview/materials/"],
  ])("composes exact forward evidence and reverse claim targets under %s", (base, methodPrefix, materialPrefix) => {
    const models = buildMaterialDetailModels(loadPublicAtlas(), base);
    for (const model of models) {
      expect(model.href).toBe(`${materialPrefix}${model.slug}/`);
      for (const claim of model.claims) {
        expect(claim.evidence.every(({ href }) => href.startsWith(methodPrefix))).toBe(true);
        expect(claim.anchor).toMatch(/^claim-/u);
      }
      for (const record of model.evidence.records) {
        expect(record.href).toBe(`${methodPrefix}${record.record.id}`);
        expect(record.supportedClaims.every(({ href, claimAnchor }) =>
          href === `${materialPrefix}${model.slug}/#${claimAnchor}`
        )).toBe(true);
      }
    }
  });

  it("supports zero and many named observations without merging service guidance", () => {
    const candidate = createMinimalAtlas();
    candidate.sources = [];
    const first = candidate.materials[0]!.thermalObservations[0]!;
    candidate.materials[0]!.thermalObservations = [];
    let parsed = parseAtlas(candidate);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(buildMaterialDetailModels(parsed.data, "/")[0]!.thermal.namedObservations).toHaveLength(0);

    const many = createMinimalAtlas();
    many.sources = [];
    many.materials[0]!.thermalObservations.push({
      ...structuredClone(first),
      id: "claim-synthetic-melting-point",
      metric: "melting-point",
      metricLabel: "Melting point",
    });
    parsed = parseAtlas(many);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const thermal = buildMaterialDetailModels(parsed.data, "/")[0]!.thermal;
    expect(thermal.namedObservations).toHaveLength(2);
    expect(thermal.serviceGuidance.claimId).not.toBe(thermal.namedObservations[0]!.claimId);
  });

  it("preserves partial fact states and omits absent thermal method dimensions", () => {
    const models = buildMaterialDetailModels(loadPublicAtlas(), "/");
    const facts = models.flatMap(({ claims }) => claims.map(({ fact }) => fact.state));
    expect(facts).toContain("unknown");
    expect(facts).toContain("conditional");
    for (const observation of models.flatMap(({ thermal }) => thermal.namedObservations)) {
      for (const value of Object.values(observation.method ?? {})) expect(value).not.toBeUndefined();
    }
  });

  it("fails missing relationships without reflecting source prose", () => {
    const atlas = structuredClone(loadPublicAtlas());
    atlas.decisionLanes[0]!.processGateIds[0] = "gate-missing" as AtlasV1["processGates"][number]["id"];
    expect(() => buildMaterialDetailModels(atlas, "/")).toThrow("RELATIONSHIP_GATE_MISSING");
  });

  it("does not create a generic heat score or universal rank", () => {
    const serialized = JSON.stringify(buildMaterialDetailModels(loadPublicAtlas(), "/"));
    expect(serialized).not.toMatch(/heatResistance|thermalValue|universalRank|userEquipment/u);
  });
});
