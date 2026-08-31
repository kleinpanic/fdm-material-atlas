const MATERIAL_SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const BASE_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]+$/u;
const FRAGMENT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/u;

export type RouteTarget =
  | { readonly id: "home" }
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
