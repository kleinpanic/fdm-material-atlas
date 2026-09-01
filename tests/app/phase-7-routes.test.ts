import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { internalHref, routePath, type RouteTarget } from "../../src/lib/routes.ts";

const TARGETS = [
  { id: "compare" },
  { id: "data" },
] as const satisfies readonly RouteTarget[];

describe("phase 7 route boundary", () => {
  it.each([
    ["/", ["/compare/", "/data/"]],
    ["/atlas-preview/", ["/atlas-preview/compare/", "/atlas-preview/data/"]],
  ])("composes directory-form targets once under %s", (base, expected) => {
    expect(TARGETS.map((target) => internalHref(base, target))).toEqual(expected);
    expect(TARGETS.map(routePath)).toEqual(["/compare/", "/data/"]);
  });

  it("has one directory-index source for each emitted target", async () => {
    await expect(readFile("src/pages/compare/index.astro", "utf8")).resolves.toMatch(/<BaseLayout/u);
    await expect(readFile("src/pages/data/index.astro", "utf8")).resolves.toMatch(/<BaseLayout/u);
  });

  it.each([
    { id: "compare", query: "material-synthetic" },
    { id: "data", fragment: "unsafe" },
    { id: "compare", path: "../escape" },
  ])("rejects extra route target state %#", (target) => {
    expect(() => routePath(target as never)).toThrow("ROUTE_TARGET_INVALID");
  });

  it.each([
    "/atlas-preview/?material=synthetic",
    "/atlas-preview/#data",
    "/atlas-preview/../escape/",
    "/atlas-preview//",
    "https://atlas.example/atlas-preview/",
  ])("rejects query, fragment, traversal, duplicate, and absolute bases: %s", (base) => {
    expect(() => internalHref(base, TARGETS[0])).toThrow("ROUTE_BASE_INVALID");
  });
});
