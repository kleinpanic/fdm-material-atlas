import { describe, expect, it } from "vitest";

import {
  fragmentHref,
  internalHref,
  routePath,
  type RouteTarget,
} from "../../src/lib/routes.ts";

const HOME = { id: "home" } as const satisfies RouteTarget;
const MATERIAL = {
  id: "material",
  slug: "synthetic-alpha",
} as const satisfies RouteTarget;

describe("routePath", () => {
  it("returns directory-form paths for every closed route target", () => {
    expect(routePath(HOME)).toBe("/");
    expect(routePath(MATERIAL)).toBe("/materials/synthetic-alpha/");
  });

  it.each([
    "../escape",
    ".",
    "alpha/beta",
    "alpha%2fbeta",
    "alpha\\beta",
    "https://materials.example",
    "alpha?mode=unsafe",
    "alpha#unsafe",
    "UPPERCASE",
  ])("rejects unsafe material slug %s", (slug) => {
    expect(() => routePath({ id: "material", slug })).toThrowError(
      "ROUTE_SLUG_INVALID",
    );
  });

  it("rejects targets outside the closed route variants", () => {
    expect(() => routePath({ id: "external", url: "https://example.com" } as never)).toThrowError(
      "ROUTE_TARGET_INVALID",
    );
    expect(() => routePath("/materials/synthetic-alpha/" as never)).toThrowError(
      "ROUTE_TARGET_INVALID",
    );
  });
});

describe("internalHref", () => {
  it.each(["/", "", undefined])("resolves root deployment base %s", (base) => {
    expect(internalHref(base, HOME)).toBe("/");
    expect(internalHref(base, MATERIAL)).toBe("/materials/synthetic-alpha/");
  });

  it.each([
    "/atlas-preview/",
    "/atlas-preview",
    "atlas-preview/",
    "atlas-preview",
  ])("normalizes repository base separators once for %s", (base) => {
    expect(internalHref(base, HOME)).toBe("/atlas-preview/");
    expect(internalHref(base, MATERIAL)).toBe(
      "/atlas-preview/materials/synthetic-alpha/",
    );
  });

  it("never doubles a base prefix when a slug contains the base name", () => {
    expect(
      internalHref("/atlas-preview/", {
        id: "material",
        slug: "atlas-preview",
      }),
    ).toBe("/atlas-preview/materials/atlas-preview/");
  });

  it.each([
    "//atlas-preview//",
    "/atlas-preview/../escape/",
    "/atlas-preview/./",
    "/atlas%2fpreview/",
    "/atlas\\preview/",
    "/atlas-preview/?mode=unsafe",
    "/atlas-preview/#unsafe",
    "https://example.com/atlas-preview/",
    "data:text/html,unsafe",
  ])("rejects unsafe deployment base %s", (base) => {
    expect(() => internalHref(base, HOME)).toThrowError("ROUTE_BASE_INVALID");
  });
});

describe("fragmentHref", () => {
  it("keeps a valid fragment document-local", () => {
    expect(fragmentHref("main-content")).toBe("#main-content");
  });

  it.each([
    "",
    "#main-content",
    "main/content",
    "main?content",
    "main%2fcontent",
    "main content",
    "9-main",
    "https://example.com",
  ])("rejects unsafe fragment identifier %s", (id) => {
    expect(() => fragmentHref(id)).toThrowError("FRAGMENT_ID_INVALID");
  });
});
