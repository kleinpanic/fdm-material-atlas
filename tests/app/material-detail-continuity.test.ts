import { describe, expect, it } from "vitest";

import type { MaterialId } from "../../src/data/schema/ids.ts";
import { deriveDecisionLaneMembership } from "../../src/domain/decision-lanes/membership.ts";
import { decodeCompareUrlState } from "../../src/features/comparison/url-state.ts";
import { buildMaterialDetailModels } from "../../src/features/materials/detail-model.ts";
import {
  PUBLIC_ROUTE_REGISTRY,
  buildSelectorRouteAvailability,
  type PublicRouteRegistry,
} from "../../src/lib/public-route-registry.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

function catalog() {
  const atlas = loadPublicAtlas();
  const memberships = deriveDecisionLaneMembership(atlas);
  return {
    materials: atlas.materials.map((material) => ({
      id: material.id,
      slug: material.slug,
      decisionMapLaneIds: memberships
        .filter((lane) => lane.candidateMaterialIds.includes(material.id) || lane.indeterminateMaterialIds.includes(material.id))
        .map(({ id }) => id),
    })),
    lanes: memberships.map(({ id, label }) => ({ id, label })),
  } as const;
}

describe("material detail continuity", () => {
  it.each([
    ["/", "/materials/", "/compare/#comparison-matrix", "/map/#"],
    ["/fdm-material-atlas/", "/fdm-material-atlas/materials/", "/fdm-material-atlas/compare/#comparison-matrix", "/fdm-material-atlas/map/#"],
  ])("round-trips every offered pair through canonical root %s routes", (base, detailPrefix, compareHref, mapPrefix) => {
    const atlas = loadPublicAtlas();
    const models = buildMaterialDetailModels(atlas, base);
    const knownIds = atlas.materials.map(({ id }) => id);

    expect(models).toHaveLength(23);
    expect(models.filter(({ continuity }) => continuity.relatedMaterials.length > 0)).toHaveLength(22);
    for (const model of models) {
      expect(model.continuity.compare).toMatchObject({ kind: "link", href: compareHref });
      expect(model.continuity.relatedMaterials.length > 0).toBe(model.relationships.length > 0);
      for (const related of model.continuity.relatedMaterials) {
        expect(related.id).not.toBe(model.id);
        expect(related.details).toMatchObject({ kind: "link" });
        if (related.details.kind === "link") expect(related.details.href).toBe(`${detailPrefix}${related.slug}/`);
        const query = new URLSearchParams();
        query.append("material", model.continuity.currentMaterialId);
        query.append("material", related.id);
        expect(decodeCompareUrlState(`?${query.toString()}`, knownIds)).toEqual({
          kind: "valid",
          materialIds: [model.id, related.id],
        });
      }
      for (const relationship of model.relationships) {
        expect(relationship.action).toMatchObject({ kind: "link" });
        if (relationship.action.kind === "link") expect(relationship.action.href).toBe(`${mapPrefix}${relationship.laneId}`);
      }
    }
  });

  it("orders a deduplicated union by state, shared lane, display order, then ID", () => {
    const atlas = loadPublicAtlas();
    const lanes = deriveDecisionLaneMembership(atlas);
    const materialOrder = new Map(atlas.materials.map(({ id, displayOrder }) => [id, displayOrder]));
    const models = buildMaterialDetailModels(atlas, "/");

    for (const model of models) {
      expect(new Set(model.continuity.relatedMaterials.map(({ id }) => id)).size)
        .toBe(model.continuity.relatedMaterials.length);
      const expected = model.continuity.relatedMaterials.map((related) => ({
        id: related.id,
        state: related.state,
        firstLane: Math.min(...related.sharedLanes.map(({ id }) => lanes.findIndex((lane) => lane.id === id))),
        displayOrder: materialOrder.get(related.id)!,
      })).sort((left, right) =>
        (left.state === "candidate" ? 0 : 1) - (right.state === "candidate" ? 0 : 1)
        || left.firstLane - right.firstLane
        || left.displayOrder - right.displayOrder
        || left.id.localeCompare(right.id, "en")
      ).map(({ id }) => id);
      expect(model.continuity.relatedMaterials.map(({ id }) => id)).toEqual(expected);
    }
  });

  it("keeps closed compare and map capabilities href-free without guessing targets", () => {
    const closedRegistry: PublicRouteRegistry = {
      materialDetails: [],
      startingProfiles: [],
      decisionMaps: [],
      allMaterialDetails: true,
      allStartingProfiles: true,
    };
    const models = buildMaterialDetailModels(loadPublicAtlas(), "/", closedRegistry);
    for (const model of models) {
      expect(model.continuity.compare).toEqual({ kind: "unavailable", label: "Comparison is not available yet" });
      expect(model.relationships.every(({ action }) => action.kind === "unavailable")).toBe(true);
      expect(JSON.stringify(model.relationships)).not.toContain('"href"');
    }
  });

  it("projects the same route actions as the shared availability compiler", () => {
    const atlas = loadPublicAtlas();
    const availability = buildSelectorRouteAvailability("/", PUBLIC_ROUTE_REGISTRY, catalog());
    const models = buildMaterialDetailModels(atlas, "/");
    const materialRoutes = new Map(availability.materials.map((route) => [route.materialId, route]));
    const laneRoutes = new Map(availability.decisionMaps.map((route) => [route.laneId, route.action]));

    for (const model of models) {
      expect(model.continuity.compare).toEqual(availability.compare);
      for (const related of model.continuity.relatedMaterials) {
        expect(related.details).toEqual(materialRoutes.get(related.id)?.details);
      }
      for (const relationship of model.relationships) {
        expect(relationship.action).toEqual(laneRoutes.get(relationship.laneId));
      }
    }
  });

  it("never accepts a one-material comparison", () => {
    const atlas = loadPublicAtlas();
    const model = buildMaterialDetailModels(atlas, "/")[0]!;
    expect(decodeCompareUrlState(`?material=${model.id}`, atlas.materials.map(({ id }) => id)))
      .toMatchObject({ kind: "invalid" });
  });

  it("does not invent a related material for a material outside every lane", () => {
    const model = buildMaterialDetailModels(loadPublicAtlas(), "/")
      .find(({ id }) => id === "material-abs" as MaterialId);
    expect(model?.relationships).toEqual([]);
    expect(model?.continuity.relatedMaterials).toEqual([]);
  });
});
