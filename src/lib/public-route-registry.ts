import type { DecisionLaneId, MaterialId } from "../data/schema/ids.ts";
import {
  fragmentHref,
  internalHref,
  type RouteTarget,
} from "./routes.ts";

export type RouteAction =
  | Readonly<{ kind: "link"; href: string; label: string }>
  | Readonly<{ kind: "unavailable"; label: string }>;

type MaterialRouteRegistration = Readonly<{
  materialId: MaterialId;
  target: RouteTarget;
}>;

type FragmentRouteRegistration = Readonly<{
  target: RouteTarget;
  fragment: string;
  verifiedFragments: readonly string[];
}>;

type MaterialFragmentRegistration = FragmentRouteRegistration & Readonly<{
  materialId: MaterialId;
}>;

type LaneFragmentRegistration = FragmentRouteRegistration & Readonly<{
  laneId: DecisionLaneId;
}>;

/** Build-time inventory. A target is registered only after its emitted route is verified. */
export type PublicRouteRegistry = Readonly<{
  materialDetails: readonly MaterialRouteRegistration[];
  startingProfiles: readonly MaterialFragmentRegistration[];
  compare?: FragmentRouteRegistration;
  decisionMaps: readonly LaneFragmentRegistration[];
  methodEvidence?: FragmentRouteRegistration;
}>;

export type SelectorRouteCatalog = Readonly<{
  materials: readonly Readonly<{
    id: MaterialId;
    slug: string;
    decisionMapLaneIds: readonly DecisionLaneId[];
  }>[];
  lanes: readonly Readonly<{ id: DecisionLaneId; label: string }>[];
}>;

export type SelectorRouteAvailability = Readonly<{
  materials: readonly Readonly<{
    materialId: MaterialId;
    details: RouteAction;
    startingProfile: RouteAction;
    decisionMaps: readonly Readonly<{ laneId: DecisionLaneId; action: RouteAction }>[];
  }>[];
  compare: RouteAction;
  decisionMaps: readonly Readonly<{ laneId: DecisionLaneId; action: RouteAction }>[];
  decisionMapFallback: RouteAction;
  methodEvidence: RouteAction;
}>;

const LABELS = Object.freeze({
  detailsLink: "View material details",
  detailsUnavailable: "Material details are not available yet",
  profileLink: "View starting profile",
  profileUnavailable: "Starting profile is not available yet",
  compareLink: "Compare shortlisted",
  compareUnavailable: "Comparison is not available yet",
  mapUnavailable: "Decision map is not available yet",
  methodLink: "Read scoring method and evidence",
  methodUnavailable: "Method and evidence route is not available yet",
});

function fail(code: string): never {
  throw new Error(code);
}

function unavailable(label: string): RouteAction {
  return Object.freeze({ kind: "unavailable", label });
}

function link(base: string | undefined, registration: Readonly<{ target: RouteTarget; fragment?: string }>, label: string): RouteAction {
  const path = internalHref(base, registration.target);
  const suffix = registration.fragment === undefined ? "" : fragmentHref(registration.fragment);
  return Object.freeze({ kind: "link", href: `${path}${suffix}`, label });
}

function assertVerifiedFragment(registration: FragmentRouteRegistration): void {
  internalHref("/", registration.target);
  if (!Array.isArray(registration.verifiedFragments)) {
    fail("ROUTE_REGISTRY_FRAGMENT_MISSING");
  }
  const fragments = new Set(registration.verifiedFragments);
  if (fragments.size !== registration.verifiedFragments.length || !fragments.has(registration.fragment)) {
    fail("ROUTE_REGISTRY_FRAGMENT_MISSING");
  }
  registration.verifiedFragments.forEach(fragmentHref);
}

function oneById<T extends Readonly<{ materialId: MaterialId }>>(
  registrations: readonly T[],
  materialId: MaterialId,
): T | undefined {
  const matches = registrations.filter((entry) => entry.materialId === materialId);
  if (matches.length > 1) fail("ROUTE_REGISTRY_TARGET_MISMATCH");
  return matches[0];
}

function assertMaterialTarget(
  registration: MaterialRouteRegistration,
  expectedSlug: string,
): void {
  internalHref("/", registration.target);
  if (registration.target.id !== "material" || registration.target.slug !== expectedSlug) {
    fail("ROUTE_REGISTRY_TARGET_MISMATCH");
  }
}

/**
 * Production starts closed. Later phases replace only verified entries after
 * their routes and fragments exist in both deployment builds.
 */
export const PUBLIC_ROUTE_REGISTRY: PublicRouteRegistry = Object.freeze({
  materialDetails: Object.freeze([]),
  startingProfiles: Object.freeze([]),
  decisionMaps: Object.freeze([]),
});

/** Compile a registry into browser-safe actions without guessing a path. */
export function buildSelectorRouteAvailability(
  base: string | undefined,
  registry: PublicRouteRegistry,
  catalog: SelectorRouteCatalog,
): SelectorRouteAvailability {
  const materialById = new Map(catalog.materials.map((material) => [material.id, material]));
  const laneById = new Map(catalog.lanes.map((lane) => [lane.id, lane]));
  if (materialById.size !== catalog.materials.length || laneById.size !== catalog.lanes.length) {
    fail("ROUTE_REGISTRY_CATALOG_INVALID");
  }
  for (const lane of catalog.lanes) {
    if (lane.label.trim() === "") fail("ROUTE_REGISTRY_CATALOG_INVALID");
  }
  for (const material of catalog.materials) {
    const memberships = new Set(material.decisionMapLaneIds);
    if (
      memberships.size !== material.decisionMapLaneIds.length
      || material.decisionMapLaneIds.some((laneId) => !laneById.has(laneId))
    ) fail("ROUTE_REGISTRY_CATALOG_INVALID");
  }

  for (const registration of [...registry.materialDetails, ...registry.startingProfiles]) {
    const material = materialById.get(registration.materialId);
    if (!material) fail("ROUTE_REGISTRY_MATERIAL_UNKNOWN");
    assertMaterialTarget(registration, material.slug);
  }
  registry.startingProfiles.forEach(assertVerifiedFragment);

  if (registry.compare) assertVerifiedFragment(registry.compare);
  if (registry.methodEvidence) assertVerifiedFragment(registry.methodEvidence);
  for (const registration of registry.decisionMaps) {
    if (!laneById.has(registration.laneId)) fail("ROUTE_REGISTRY_LANE_UNKNOWN");
    assertVerifiedFragment(registration);
  }
  if (new Set(registry.decisionMaps.map(({ laneId }) => laneId)).size !== registry.decisionMaps.length) {
    fail("ROUTE_REGISTRY_TARGET_MISMATCH");
  }

  const decisionMaps = [...registry.decisionMaps]
    .sort((left, right) => left.laneId < right.laneId ? -1 : left.laneId > right.laneId ? 1 : 0)
    .map((registration) => Object.freeze({
      laneId: registration.laneId,
      action: link(base, registration, `View ${laneById.get(registration.laneId)!.label} decision map`),
    }));

  const materials = [...catalog.materials]
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map((material) => {
      const detail = oneById(registry.materialDetails, material.id);
      const profile = oneById(registry.startingProfiles, material.id);
      const membership = new Set(material.decisionMapLaneIds);
      return Object.freeze({
        materialId: material.id,
        details: detail
          ? link(base, detail, LABELS.detailsLink)
          : unavailable(LABELS.detailsUnavailable),
        startingProfile: profile
          ? link(base, profile, LABELS.profileLink)
          : unavailable(LABELS.profileUnavailable),
        decisionMaps: Object.freeze(decisionMaps.filter(({ laneId }) => membership.has(laneId))),
      });
    });

  return Object.freeze({
    materials: Object.freeze(materials),
    compare: registry.compare
      ? link(base, registry.compare, LABELS.compareLink)
      : unavailable(LABELS.compareUnavailable),
    decisionMaps: Object.freeze(decisionMaps),
    decisionMapFallback: unavailable(LABELS.mapUnavailable),
    methodEvidence: registry.methodEvidence
      ? link(base, registry.methodEvidence, LABELS.methodLink)
      : unavailable(LABELS.methodUnavailable),
  });
}
