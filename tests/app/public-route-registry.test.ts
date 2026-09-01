import { describe, expect, it } from "vitest";

import type { DecisionLaneId, MaterialId } from "../../src/data/schema/ids.ts";
import {
  PUBLIC_ROUTE_REGISTRY,
  buildSelectorRouteAvailability,
  type PublicRouteRegistry,
} from "../../src/lib/public-route-registry.ts";
import { mapLaneFragments, mapModeFragments } from "../../src/lib/routes.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";
import { buildSelectorPageModel } from "../../src/features/selector/page-model.ts";
import { decodeSelectorClientModel } from "../../src/features/selector/client-model.ts";

const MATERIAL_ID = "material-synthetic-alpha" as MaterialId;
const LANE_ID = "lane-easy-prototypes" as DecisionLaneId;
const VERIFIED_MAP_FRAGMENTS = Object.freeze([...mapModeFragments, ...mapLaneFragments]);

const catalog = Object.freeze({
  materials: Object.freeze([
    {
      id: MATERIAL_ID,
      slug: "synthetic-alpha",
      decisionMapLaneIds: Object.freeze([LANE_ID]),
    },
  ]),
  lanes: Object.freeze([{ id: LANE_ID, label: "Easy prototypes" }]),
});

function completedRegistry(): PublicRouteRegistry {
  return Object.freeze({
    materialDetails: Object.freeze([
      Object.freeze({
        materialId: MATERIAL_ID,
        target: { id: "material" as const, slug: "synthetic-alpha" },
      }),
    ]),
    startingProfiles: Object.freeze([
      Object.freeze({
        materialId: MATERIAL_ID,
        target: { id: "material" as const, slug: "synthetic-alpha" },
        fragment: "starting-profile",
        verifiedFragments: Object.freeze(["starting-profile"]),
      }),
    ]),
    compare: Object.freeze({
      target: { id: "compare" as const },
      fragment: "comparison-matrix",
      verifiedFragments: Object.freeze(["comparison-matrix"]),
    }),
    decisionMaps: Object.freeze([
      Object.freeze({
        laneId: LANE_ID,
        target: { id: "map" as const },
        fragment: LANE_ID,
        verifiedFragments: VERIFIED_MAP_FRAGMENTS,
      }),
    ]),
    methodEvidence: Object.freeze({
      target: { id: "home" as const },
      fragment: "method",
      verifiedFragments: Object.freeze(["method"]),
    }),
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
    expect(availability.compare).toEqual({
      kind: "unavailable",
      label: "Comparison is not available yet",
    });
    expect(availability.decisionMaps).toEqual([]);
    expect(availability.decisionMapFallback).toEqual({
      kind: "unavailable",
      label: "Decision map is not available yet",
    });
    expect(availability.methodEvidence).toEqual({
      kind: "unavailable",
      label: "Method and evidence route is not available yet",
    });
    expect(JSON.stringify(availability)).not.toContain('"href"');
  });

  it.each([
    ["/", "/compare/#comparison-matrix", "/method/#selector-scoring"],
    [
      "/atlas-preview/",
      "/atlas-preview/compare/#comparison-matrix",
      "/atlas-preview/method/#selector-scoring",
    ],
  ])("keeps receipt-proven map actions exact under %s", (base, compareHref, methodHref) => {
    const atlas = loadPublicAtlas();
    const model = decodeSelectorClientModel(
      buildSelectorPageModel(atlas, base, PUBLIC_ROUTE_REGISTRY),
    );
    expect(model.routes.materials).toHaveLength(23);
    for (const route of model.routes.materials) {
      expect(route.details.kind).toBe("link");
      expect(route.startingProfile.kind).toBe("link");
      expect(
        route.decisionMaps.every(
          ({ laneId, action }) =>
            mapLaneFragments.includes(laneId as (typeof mapLaneFragments)[number]) &&
            action.kind === "link" &&
            action.href.endsWith(`/map/#${laneId}`),
        ),
      ).toBe(true);
    }
    expect(model.routes.compare).toEqual({
      kind: "link",
      href: compareHref,
      label: "Compare shortlisted",
      base,
      knownMaterialIds: [...model.projection.materials.map(({ id }) => id)].sort(),
    });
    expect(model.routes.methodEvidence).toEqual({
      kind: "link",
      href: methodHref,
      label: "Read scoring method and evidence",
    });
    expect(model.routes.decisionMaps).toHaveLength(mapLaneFragments.length);
    expect(model.routes.decisionMapFallback).toEqual({
      kind: "unavailable",
      label: "Decision map is not available yet",
    });
    expect(JSON.stringify(model.routes)).toContain("/map/#lane-");
  });

  it.each([
    [
      "/",
      "/materials/synthetic-alpha/",
      "/materials/synthetic-alpha/#starting-profile",
      "/compare/#comparison-matrix",
      "/map/#lane-easy-prototypes",
      "/#method",
    ],
    [
      "/atlas-preview/",
      "/atlas-preview/materials/synthetic-alpha/",
      "/atlas-preview/materials/synthetic-alpha/#starting-profile",
      "/atlas-preview/compare/#comparison-matrix",
      "/atlas-preview/map/#lane-easy-prototypes",
      "/atlas-preview/#method",
    ],
  ])(
    "activates only verified targets under base %s",
    (base, details, profile, compare, map, method) => {
      const availability = buildSelectorRouteAvailability(base, completedRegistry(), catalog);

      expect(availability.materials[0]?.details).toEqual({
        kind: "link",
        href: details,
        label: "View material details",
      });
      expect(availability.materials[0]?.startingProfile).toEqual({
        kind: "link",
        href: profile,
        label: "View starting profile",
      });
      expect(availability.compare).toEqual({
        kind: "link",
        href: compare,
        label: "Compare shortlisted",
        base,
        knownMaterialIds: [MATERIAL_ID],
      });
      expect(availability.decisionMaps[0]?.action).toEqual({
        kind: "link",
        href: map,
        label: "Open Easy prototypes decision path",
      });
      expect(availability.materials[0]?.decisionMaps[0]?.action).toEqual({
        kind: "link",
        href: map,
        label: "Open Easy prototypes decision path",
      });
      expect(availability.methodEvidence).toEqual({
        kind: "link",
        href: method,
        label: "Read scoring method and evidence",
      });
    },
  );

  it.each([
    [
      "ROUTE_REGISTRY_MATERIAL_UNKNOWN",
      () => ({
        ...completedRegistry(),
        materialDetails: [
          {
            materialId: "material-unknown" as MaterialId,
            target: { id: "material", slug: "synthetic-alpha" },
          },
        ],
      }),
    ],
    [
      "ROUTE_REGISTRY_LANE_UNKNOWN",
      () => ({
        ...completedRegistry(),
        decisionMaps: [
          {
            laneId: "lane-unknown" as DecisionLaneId,
            target: { id: "map" },
            fragment: "lane-easy-prototypes",
            verifiedFragments: VERIFIED_MAP_FRAGMENTS,
          },
        ],
      }),
    ],
    [
      "ROUTE_REGISTRY_TARGET_MISMATCH",
      () => ({
        ...completedRegistry(),
        decisionMaps: [
          {
            laneId: LANE_ID,
            target: { id: "home" },
            fragment: LANE_ID,
            verifiedFragments: VERIFIED_MAP_FRAGMENTS,
          },
        ],
      }),
    ],
    [
      "ROUTE_REGISTRY_TARGET_MISMATCH",
      () => ({
        ...completedRegistry(),
        decisionMaps: [
          {
            laneId: LANE_ID,
            target: { id: "map" },
            fragment: "lane-outdoor",
            verifiedFragments: VERIFIED_MAP_FRAGMENTS,
          },
        ],
      }),
    ],
    [
      "ROUTE_REGISTRY_TARGET_MISMATCH",
      () => ({
        ...completedRegistry(),
        decisionMaps: [...completedRegistry().decisionMaps, ...completedRegistry().decisionMaps],
      }),
    ],
    [
      "ROUTE_REGISTRY_FRAGMENT_MISSING",
      () => ({
        ...completedRegistry(),
        methodEvidence: { target: { id: "home" }, fragment: "method", verifiedFragments: [] },
      }),
    ],
    [
      "ROUTE_REGISTRY_TARGET_MISMATCH",
      () => ({
        ...completedRegistry(),
        materialDetails: [
          { materialId: MATERIAL_ID, target: { id: "material", slug: "different" } },
        ],
      }),
    ],
    [
      "ROUTE_TARGET_INVALID",
      () => ({
        ...completedRegistry(),
        compare: { target: { id: "external", url: "https://example.com" } as never },
      }),
    ],
    [
      "ROUTE_SLUG_INVALID",
      () => ({
        ...completedRegistry(),
        materialDetails: [
          { materialId: MATERIAL_ID, target: { id: "material", slug: "../escape" } },
        ],
      }),
    ],
  ])("fails invalid completed inventory with stable code %s", (code, mutate) => {
    expect(() =>
      buildSelectorRouteAvailability("/", mutate() as PublicRouteRegistry, catalog),
    ).toThrow(code);
  });

  it("does not attach a verified lane to a material outside its candidate set", () => {
    const availability = buildSelectorRouteAvailability("/", completedRegistry(), {
      ...catalog,
      materials: Object.freeze([
        {
          ...catalog.materials[0]!,
          decisionMapLaneIds: Object.freeze([]),
        },
      ]),
    });

    expect(availability.decisionMaps).toHaveLength(1);
    expect(availability.materials[0]?.decisionMaps).toEqual([]);
  });
});
