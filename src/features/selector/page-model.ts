import type { AtlasV1 } from "../../data/schema/atlas.ts";
import type { MaterialId, SelectorOptionId } from "../../data/schema/ids.ts";
import {
  compileSelectorProjection,
  type SelectorProjectionV1,
} from "../../domain/selector/index.ts";
import {
  buildSelectorRouteAvailability,
  type PublicRouteRegistry,
  type SelectorRouteAvailability,
} from "../../lib/public-route-registry.ts";

type FamilyDisplay =
  | Readonly<{ state: "known" | "conditional"; label: string }>
  | Readonly<{ state: "unavailable" }>;

export type SelectorMaterialDisplay = Readonly<{
  id: MaterialId;
  label: string;
  familyOrFill: FamilyDisplay;
}>;

export type SelectorPageModel = Readonly<{
  projection: SelectorProjectionV1;
  defaults: Readonly<Record<string, SelectorOptionId>>;
  display: Readonly<{
    materials: readonly SelectorMaterialDisplay[];
  }>;
  routes: SelectorRouteAvailability;
}>;

type SelectorPageModelErrorCode =
  | "SELECTOR_PAGE_EMPTY_MATERIALS"
  | "SELECTOR_PAGE_DEFINITIONS_MISSING"
  | "SELECTOR_PAGE_ROUTE_REGISTRY_INVALID";

function fail(code: SelectorPageModelErrorCode): never {
  throw new Error(code);
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function projectFamily(material: AtlasV1["materials"][number]): FamilyDisplay {
  const value = material.familyOrFill.value;
  if (value.state === "known") {
    return Object.freeze({ state: "known", label: value.value });
  }
  if (value.state === "conditional" && value.value !== undefined) {
    return Object.freeze({ state: "conditional", label: value.value });
  }
  return Object.freeze({ state: "unavailable" });
}

/**
 * Compile the one allow-listed selector client prop. The Atlas remains a
 * build-only input and no evidence, profile, method, or visualization record
 * crosses this boundary.
 */
export function buildSelectorPageModel(
  atlas: AtlasV1,
  base: string | undefined,
  registry: PublicRouteRegistry,
): SelectorPageModel {
  if (atlas.materials.length === 0) fail("SELECTOR_PAGE_EMPTY_MATERIALS");
  if (atlas.selector.criteria.length !== 7) fail("SELECTOR_PAGE_DEFINITIONS_MISSING");

  const projection = compileSelectorProjection(atlas);
  if (projection.materials.length === 0 || projection.criteria.length !== 7) {
    fail("SELECTOR_PAGE_DEFINITIONS_MISSING");
  }

  const defaults = Object.freeze(Object.fromEntries(
    projection.criteria.map((criterion) => [criterion.id, criterion.defaultOptionId]),
  ) as Record<string, SelectorOptionId>);

  const materials = Object.freeze(
    [...atlas.materials]
      .sort((left, right) => compareAscii(left.id, right.id))
      .map((material): SelectorMaterialDisplay => Object.freeze({
        id: material.id,
        label: material.name,
        familyOrFill: projectFamily(material),
      })),
  );

  let routes: SelectorRouteAvailability;
  try {
    routes = buildSelectorRouteAvailability(base, registry, {
      materials: Object.freeze(atlas.materials.map(({ id, slug }) => Object.freeze({ id, slug }))),
      laneIds: Object.freeze(atlas.decisionLanes.map(({ id }) => id)),
    });
  } catch {
    return fail("SELECTOR_PAGE_ROUTE_REGISTRY_INVALID");
  }

  return Object.freeze({
    projection,
    defaults,
    display: Object.freeze({ materials }),
    routes,
  });
}
