const MATERIAL_SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const BASE_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]+$/u;
const FRAGMENT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/u;

/** Closed, presentation-owned mode anchors on the material map route. */
export const mapModeFragments = Object.freeze([
  "decision-paths",
  "thermal-ranges",
  "process-gates",
  "impact-flex-space",
] as const);

/** Closed lane anchors. Tests keep this route inventory aligned with the schema registry. */
export const mapLaneFragments = Object.freeze([
  "lane-easy-prototypes",
  "lane-outdoor",
  "lane-impact-flex",
  "lane-chemical-exposure",
  "lane-high-heat-sustained-load",
  "lane-industrial",
  "lane-decorative-fills",
  "lane-support-materials",
] as const);

export type MapModeFragment = (typeof mapModeFragments)[number];
export type MapLaneFragment = (typeof mapLaneFragments)[number];
export type MapFragment = MapModeFragment | MapLaneFragment;

const MAP_FRAGMENTS = new Set<string>([
  ...mapModeFragments,
  ...mapLaneFragments,
]);

export type RouteTarget =
  | { readonly id: "home" }
  | { readonly id: "materials" }
  | { readonly id: "method" }
  | { readonly id: "compare" }
  | { readonly id: "data" }
  | { readonly id: "map" }
  | { readonly id: "material"; readonly slug: string };

function fail(code: string): never {
  throw new Error(code);
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSlug(slug: unknown): string {
  if (
    typeof slug !== "string" ||
    slug.length === 0 ||
    slug.length > 120 ||
    !MATERIAL_SLUG_PATTERN.test(slug)
  ) {
    return fail("ROUTE_SLUG_INVALID");
  }
  return slug;
}

function normalizedBase(base: string | undefined): string {
  if (base === undefined || base === "" || base === "/") return "/";

  if (
    base.length > 1_024 ||
    base.trim() !== base ||
    base.includes("//") ||
    base.includes("\\") ||
    base.includes("%") ||
    base.includes("?") ||
    base.includes("#") ||
    base.includes(":")
  ) {
    return fail("ROUTE_BASE_INVALID");
  }

  const withoutEdges = base.replace(/^\/+|\/+$/gu, "");
  const segments = withoutEdges.split("/");
  if (
    withoutEdges.length === 0 ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        !BASE_SEGMENT_PATTERN.test(segment),
    )
  ) {
    return fail("ROUTE_BASE_INVALID");
  }

  return `/${segments.join("/")}/`;
}

/** Return a deployment-neutral, directory-form path for a closed route target. */
export function routePath(target: RouteTarget): string {
  if (!isRecord(target) || typeof target.id !== "string") {
    return fail("ROUTE_TARGET_INVALID");
  }

  if (target.id === "home") {
    if (Object.keys(target).some((key) => key !== "id")) {
      return fail("ROUTE_TARGET_INVALID");
    }
    return "/";
  }

  if (["materials", "method", "compare", "data", "map"].includes(target.id)) {
    if (Object.keys(target).some((key) => key !== "id")) {
      return fail("ROUTE_TARGET_INVALID");
    }
    return `/${target.id}/`;
  }

  if (target.id === "material") {
    if (Object.keys(target).some((key) => key !== "id" && key !== "slug")) {
      return fail("ROUTE_TARGET_INVALID");
    }
    return `/materials/${validateSlug(target.slug)}/`;
  }

  return fail("ROUTE_TARGET_INVALID");
}

/** Prefix an internal route exactly once with the validated deployment base. */
export function internalHref(
  base: string | undefined,
  target: RouteTarget,
): string {
  const prefix = normalizedBase(base);
  const path = routePath(target);
  if (prefix === "/") return path;
  if (path === "/") return prefix;
  return `${prefix}${path.slice(1)}`;
}

/** Construct only a document-local fragment; deployment bases do not apply. */
export function fragmentHref(id: string): string {
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > 160 ||
    !FRAGMENT_ID_PATTERN.test(id)
  ) {
    return fail("FRAGMENT_ID_INVALID");
  }
  return `#${id}`;
}

/** Compose one closed internal route and one validated fragment exactly once. */
export function internalFragmentHref(
  base: string | undefined,
  target: RouteTarget,
  fragment: string,
): string {
  return `${internalHref(base, target)}${fragmentHref(fragment)}`;
}

/** Return a document-local anchor only for a closed map mode or lane. */
export function mapFragmentHref(fragment: MapFragment): string {
  if (typeof fragment !== "string" || !MAP_FRAGMENTS.has(fragment)) {
    return fail("MAP_FRAGMENT_INVALID");
  }
  return fragmentHref(fragment);
}

/** Compose the closed map target and one closed map fragment exactly once. */
export function internalMapFragmentHref(
  base: string | undefined,
  fragment: MapFragment,
): string {
  if (typeof fragment !== "string" || !MAP_FRAGMENTS.has(fragment)) {
    return fail("MAP_FRAGMENT_INVALID");
  }
  return internalFragmentHref(base, { id: "map" }, fragment);
}
