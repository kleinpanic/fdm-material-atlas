import { describe, expect, it } from "vitest";

import {
  fragmentHref,
  internalFragmentHref,
  internalHref,
  routePath,
  type RouteTarget,
} from "../../src/lib/routes.ts";

const HOME = { id: "home" } as const satisfies RouteTarget;
const MATERIAL = {
  id: "material",
  slug: "synthetic-alpha",
} as const satisfies RouteTarget;
const MATERIALS = { id: "materials" } as const satisfies RouteTarget;
const METHOD = { id: "method" } as const satisfies RouteTarget;
const COMPARE = { id: "compare" } as const satisfies RouteTarget;
const DATA = { id: "data" } as const satisfies RouteTarget;

describe("routePath", () => {
  it("returns directory-form paths for every closed route target", () => {
    expect(routePath(HOME)).toBe("/");
    expect(routePath(MATERIALS)).toBe("/materials/");
    expect(routePath(MATERIAL)).toBe("/materials/synthetic-alpha/");
    expect(routePath(METHOD)).toBe("/method/");
    expect(routePath(COMPARE)).toBe("/compare/");
    expect(routePath(DATA)).toBe("/data/");
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
    expect(() => routePath({ id: "material", slug })).toThrow(
      "ROUTE_SLUG_INVALID",
    );
  });

  it("rejects targets outside the closed route variants", () => {
    expect(() => routePath({ id: "external", url: "https://example.com" } as never)).toThrow(
      "ROUTE_TARGET_INVALID",
    );
    expect(() => routePath("/materials/synthetic-alpha/" as never)).toThrow(
      "ROUTE_TARGET_INVALID",
    );
  });
});

describe("internalHref", () => {
  it.each(["/", "", undefined])("resolves root deployment base %s", (base) => {
    expect(internalHref(base, HOME)).toBe("/");
    expect(internalHref(base, MATERIALS)).toBe("/materials/");
    expect(internalHref(base, MATERIAL)).toBe("/materials/synthetic-alpha/");
    expect(internalHref(base, METHOD)).toBe("/method/");
    expect(internalHref(base, COMPARE)).toBe("/compare/");
    expect(internalHref(base, DATA)).toBe("/data/");
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
    expect(internalHref(base, COMPARE)).toBe("/atlas-preview/compare/");
    expect(internalHref(base, DATA)).toBe("/atlas-preview/data/");
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
    expect(() => internalHref(base, HOME)).toThrow("ROUTE_BASE_INVALID");
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
    expect(() => fragmentHref(id)).toThrow("FRAGMENT_ID_INVALID");
  });
});

describe("internalFragmentHref", () => {
  it.each([
    ["/", "/materials/synthetic-alpha/#evidence", "/method/#source-synthetic-guide"],
    ["/atlas-preview/", "/atlas-preview/materials/synthetic-alpha/#evidence", "/atlas-preview/method/#source-synthetic-guide"],
  ])("composes one validated cross-document fragment under %s", (base, material, method) => {
    expect(internalFragmentHref(base, MATERIAL, "evidence")).toBe(material);
    expect(internalFragmentHref(base, METHOD, "source-synthetic-guide")).toBe(method);
  });

  it("rejects invalid fragments and bases through the existing stable codes", () => {
    expect(() => internalFragmentHref("/", METHOD, "#unsafe")).toThrow("FRAGMENT_ID_INVALID");
    expect(() => internalFragmentHref("https://example.com/", METHOD, "sources")).toThrow("ROUTE_BASE_INVALID");
  });
});
