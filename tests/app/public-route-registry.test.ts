import { describe, expect, it } from "vitest";

import type { DecisionLaneId, MaterialId } from "../../src/data/schema/ids.ts";
import {
  PUBLIC_ROUTE_REGISTRY,
  buildSelectorRouteAvailability,
  type PublicRouteRegistry,
} from "../../src/lib/public-route-registry.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";
import { buildSelectorPageModel } from "../../src/features/selector/page-model.ts";

const MATERIAL_ID = "material-synthetic-alpha" as MaterialId;
const LANE_ID = "lane-synthetic-alpha" as DecisionLaneId;

const catalog = Object.freeze({
  materials: Object.freeze([{
    id: MATERIAL_ID,
    slug: "synthetic-alpha",
    decisionMapLaneIds: Object.freeze([LANE_ID]),
  }]),
  lanes: Object.freeze([{ id: LANE_ID, label: "Synthetic alpha" }]),
});

function completedRegistry(): PublicRouteRegistry {
  return Object.freeze({
    materialDetails: Object.freeze([
      Object.freeze({ materialId: MATERIAL_ID, target: { id: "material" as const, slug: "synthetic-alpha" } }),
    ]),
    startingProfiles: Object.freeze([
      Object.freeze({
        materialId: MATERIAL_ID,
        target: { id: "material" as const, slug: "synthetic-alpha" },
        fragment: "starting-profile",
        verifiedFragments: Object.freeze(["starting-profile"]),
      }),
    ]),
    compare: Object.freeze({ target: { id: "home" as const }, fragment: "compare", verifiedFragments: Object.freeze(["compare"]) }),
    decisionMaps: Object.freeze([
      Object.freeze({ laneId: LANE_ID, target: { id: "home" as const }, fragment: "lane-synthetic-alpha", verifiedFragments: Object.freeze(["lane-synthetic-alpha"]) }),
    ]),
    methodEvidence: Object.freeze({ target: { id: "home" as const }, fragment: "method", verifiedFragments: Object.freeze(["method"]) }),
  });
}

describe("public selector route registry", () => {
  it("keeps every deferred production action honest and href-free", () => {
    const emptyRegistry = { materialDetails: [], startingProfiles: [], decisionMaps: [] } as const;
    const availability = buildSelectorRouteAvailability("/", emptyRegistry, catalog);

    expect(availability.materials[0]).toEqual({
      materialId: MATERIAL_ID,
      details: { kind: "unavailable", label: "Material details are not available yet" },
      startingProfile: { kind: "unavailable", label: "Starting profile is not available yet" },
      decisionMaps: [],
    });
    expect(availability.compare).toEqual({ kind: "unavailable", label: "Comparison is not available yet" });
    expect(availability.decisionMaps).toEqual([]);
    expect(availability.decisionMapFallback).toEqual({ kind: "unavailable", label: "Decision map is not available yet" });
    expect(availability.methodEvidence).toEqual({ kind: "unavailable", label: "Method and evidence route is not available yet" });
    expect(JSON.stringify(availability)).not.toContain('"href"');
  });

  it.each([
    ["/", "/compare/#comparison-matrix", "/map/#", "/method/#selector-scoring"],
    ["/atlas-preview/", "/atlas-preview/compare/#comparison-matrix", "/atlas-preview/map/#", "/atlas-preview/method/#selector-scoring"],
  ])("activates every emitted production target under %s", (base, compareHref, mapPrefix, methodHref) => {
    const atlas = loadPublicAtlas();
    const model = buildSelectorPageModel(atlas, base, PUBLIC_ROUTE_REGISTRY);
    expect(model.routes.materials).toHaveLength(23);
    for (const route of model.routes.materials) {
      expect(route.details.kind).toBe("link");
      expect(route.startingProfile.kind).toBe("link");
      expect(route.decisionMaps.every(({ action }) => action.kind === "link" && action.href.startsWith(mapPrefix))).toBe(true);
    }
    expect(model.routes.compare).toEqual({ kind: "link", href: compareHref, label: "Compare shortlisted" });
    expect(model.routes.methodEvidence).toEqual({ kind: "link", href: methodHref, label: "Read scoring method and evidence" });
    expect(model.routes.decisionMaps).toHaveLength(8);
  });

  it.each([
    ["/", "/materials/synthetic-alpha/", "/materials/synthetic-alpha/#starting-profile", "/#compare", "/#lane-synthetic-alpha", "/#method"],
    ["/atlas-preview/", "/atlas-preview/materials/synthetic-alpha/", "/atlas-preview/materials/synthetic-alpha/#starting-profile", "/atlas-preview/#compare", "/atlas-preview/#lane-synthetic-alpha", "/atlas-preview/#method"],
  ])("activates only verified targets under base %s", (base, details, profile, compare, map, method) => {
    const availability = buildSelectorRouteAvailability(base, completedRegistry(), catalog);

    expect(availability.materials[0]?.details).toEqual({ kind: "link", href: details, label: "View material details" });
    expect(availability.materials[0]?.startingProfile).toEqual({ kind: "link", href: profile, label: "View starting profile" });
    expect(availability.compare).toEqual({ kind: "link", href: compare, label: "Compare shortlisted" });
    expect(availability.decisionMaps[0]?.action).toEqual({ kind: "link", href: map, label: "View Synthetic alpha decision map" });
    expect(availability.materials[0]?.decisionMaps[0]?.action).toEqual({ kind: "link", href: map, label: "View Synthetic alpha decision map" });
    expect(availability.methodEvidence).toEqual({ kind: "link", href: method, label: "Read scoring method and evidence" });
  });

  it.each([
    ["ROUTE_REGISTRY_MATERIAL_UNKNOWN", () => ({ ...completedRegistry(), materialDetails: [{ materialId: "material-unknown" as MaterialId, target: { id: "material", slug: "synthetic-alpha" } }] })],
    ["ROUTE_REGISTRY_LANE_UNKNOWN", () => ({ ...completedRegistry(), decisionMaps: [{ laneId: "lane-unknown" as DecisionLaneId, target: { id: "home" }, fragment: "lane-unknown", verifiedFragments: ["lane-unknown"] }] })],
    ["ROUTE_REGISTRY_FRAGMENT_MISSING", () => ({ ...completedRegistry(), methodEvidence: { target: { id: "home" }, fragment: "method", verifiedFragments: [] } })],
    ["ROUTE_REGISTRY_TARGET_MISMATCH", () => ({ ...completedRegistry(), materialDetails: [{ materialId: MATERIAL_ID, target: { id: "material", slug: "different" } }] })],
    ["ROUTE_TARGET_INVALID", () => ({ ...completedRegistry(), compare: { target: { id: "external", url: "https://example.com" } as never } })],
    ["ROUTE_SLUG_INVALID", () => ({ ...completedRegistry(), materialDetails: [{ materialId: MATERIAL_ID, target: { id: "material", slug: "../escape" } }] })],
  ])("fails invalid completed inventory with stable code %s", (code, mutate) => {
    expect(() => buildSelectorRouteAvailability("/", mutate() as PublicRouteRegistry, catalog)).toThrow(code);
  });

  it("does not attach a verified lane to a material outside its candidate set", () => {
    const availability = buildSelectorRouteAvailability("/", completedRegistry(), {
      ...catalog,
      materials: Object.freeze([{
        ...catalog.materials[0]!,
        decisionMapLaneIds: Object.freeze([]),
      }]),
    });

    expect(availability.decisionMaps).toHaveLength(1);
    expect(availability.materials[0]?.decisionMaps).toEqual([]);
  });
});
