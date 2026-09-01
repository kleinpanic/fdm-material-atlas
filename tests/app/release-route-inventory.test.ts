import { beforeAll, describe, expect, it } from "vitest";

import { compileMapProjection } from "../../src/features/map/projection.ts";
import { decodeSelectorClientModel } from "../../src/features/selector/client-model.ts";
import { buildSelectorPageModel } from "../../src/features/selector/page-model.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";
import { PUBLIC_ROUTE_REGISTRY } from "../../src/lib/public-route-registry.ts";
import {
  internalHref,
  mapLaneFragments,
  mapModeFragments,
  routePath,
  type RouteTarget,
} from "../../src/lib/routes.ts";
import {
  normalizeReleaseInventory,
  validateBuiltArtifacts,
} from "../../tools/validate-built-html.mjs";

const MODES = [
  { name: "root", base: "/", output: "dist-test/root" },
  {
    name: "repository",
    base: "/atlas-preview/",
    output: "dist-test/repository",
  },
] as const;

type ModeReport = Readonly<{ name: string }>;
type ReleaseInventory = Readonly<{
  routes: readonly string[];
  fragments: readonly Readonly<{ route: string; ids: readonly string[] }>[];
  assets: readonly string[];
}>;

function routeFile(pathname: string) {
  const neutral = pathname.replace(/^\/atlas-preview\//u, "/");
  const logical = neutral.slice(1);
  return logical === "" || logical.endsWith("/") ? `${logical}index.html` : logical;
}

function hrefs(value: unknown, found = new Set<string>(), seen = new Set<object>()): Set<string> {
  if (typeof value !== "object" || value === null) return found;
  if (seen.has(value)) return found;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => hrefs(item, found, seen));
    return found;
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === "href" && typeof item === "string") found.add(item);
    else hrefs(item, found, seen);
  }
  return found;
}

function targetFromHref(href: string) {
  const url = new URL(href, "https://atlas.example");
  return { route: routeFile(url.pathname), fragment: url.hash.slice(1) };
}

describe("final release route inventory", () => {
  let reports: readonly ModeReport[];

  beforeAll(async () => {
    reports = (await validateBuiltArtifacts({ modes: MODES, runPublicationScan: false })).modes;
  }, 60_000);

  it("matches the closed route helpers and canonical material slugs in both bases", async () => {
    const atlas = loadPublicAtlas();
    const staticTargets = [
      { id: "home" },
      { id: "materials" },
      { id: "compare" },
      { id: "data" },
      { id: "map" },
      { id: "method" },
    ] as const satisfies readonly RouteTarget[];
    const targets = [
      ...staticTargets,
      ...atlas.materials.map(({ slug }) => ({ id: "material" as const, slug })),
    ];
    const expectedRoutes = targets.map((target) => routeFile(routePath(target))).sort();

    const inventories = reports.map(normalizeReleaseInventory) as ReleaseInventory[];

    expect(atlas.materials).toHaveLength(23);
    expect(expectedRoutes).toHaveLength(29);
    for (const inventory of inventories) expect(inventory.routes).toEqual(expectedRoutes);
    expect(inventories[1]).toEqual(inventories[0]);
  });

  it.each(MODES)(
    "resolves public fragments and model-derived onward actions under $base",
    async (mode) => {
      const atlas = loadPublicAtlas();
      const inventory = normalizeReleaseInventory(
        reports.find(({ name }) => name === mode.name),
      ) as ReleaseInventory;
      const fragments = new Map(
        inventory.fragments.map((entry) => [entry.route, new Set(entry.ids)]),
      );

      for (const route of inventory.routes) expect(fragments.get(route)).toContain("main-content");
      for (const fragment of [...mapModeFragments, ...mapLaneFragments]) {
        expect(fragments.get("map/index.html")).toContain(fragment);
      }

      const selector = decodeSelectorClientModel(
        buildSelectorPageModel(atlas, mode.base, PUBLIC_ROUTE_REGISTRY),
      );
      const map = compileMapProjection(atlas, mode.base);
      const modelHrefs = new Set([...hrefs(selector.routes), ...hrefs(map)]);
      expect(modelHrefs.size).toBeGreaterThan(atlas.materials.length);
      for (const href of modelHrefs) {
        const target = targetFromHref(href);
        expect(inventory.routes).toContain(target.route);
        if (target.fragment !== "") expect(fragments.get(target.route)).toContain(target.fragment);
      }

      for (const material of atlas.materials) {
        expect(inventory.routes).toContain(
          routeFile(internalHref(mode.base, { id: "material", slug: material.slug })),
        );
        expect(fragments.get(`materials/${material.slug}/index.html`)).toContain(
          "starting-profile",
        );
      }
    },
  );
});
