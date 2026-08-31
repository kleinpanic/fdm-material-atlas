import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";
import { PUBLIC_ROUTE_REGISTRY } from "../../src/lib/public-route-registry.ts";
import { buildSelectorPageModel } from "../../src/features/selector/page-model.ts";
import { selectMaterials, selectProjectedMaterials } from "../../src/domain/selector/index.ts";

const atlas = loadPublicAtlas();

describe("buildSelectorPageModel", () => {
  it("emits the exact compact deterministic client contract", () => {
    const model = buildSelectorPageModel(atlas, "/", PUBLIC_ROUTE_REGISTRY);
    expect(Object.keys(model).sort()).toEqual(["defaults", "display", "projection", "routes"]);
    expect(model.projection.criteria).toHaveLength(7);
    expect(model.projection.materials).toHaveLength(23);
    expect(model.defaults).toEqual(Object.fromEntries(model.projection.criteria.map((criterion) => [criterion.id, criterion.defaultOptionId])));
    expect(model.display.materials).toHaveLength(23);
    expect(model.display.materials.map(({ id }) => id).sort()).toEqual(model.projection.materials.map(({ id }) => id).sort());
    expect(gzipSync(JSON.stringify(model), { level: 9 }).byteLength).toBeLessThanOrEqual(64 * 1024);
  });

  it("keeps default engine results identical across Atlas and projection entry points", () => {
    const model = buildSelectorPageModel(atlas, "/", PUBLIC_ROUTE_REGISTRY);
    expect(selectProjectedMaterials(model.projection, model.defaults)).toEqual(selectMaterials(atlas, model.defaults));
  });

  it("is byte deterministic when canonical record arrays are reordered", () => {
    const reordered = {
      ...structuredClone(atlas),
      materials: [...atlas.materials].reverse(),
      processGates: [...atlas.processGates].reverse(),
      decisionLanes: [...atlas.decisionLanes].reverse(),
      selector: {
        ...structuredClone(atlas.selector),
        criteria: [...atlas.selector.criteria].reverse().map((criterion) => ({
          ...criterion,
          options: [...criterion.options].reverse(),
        })),
      },
    };
    expect(JSON.stringify(buildSelectorPageModel(reordered, "/atlas-preview/", PUBLIC_ROUTE_REGISTRY))).toBe(
      JSON.stringify(buildSelectorPageModel(atlas, "/atlas-preview/", PUBLIC_ROUTE_REGISTRY)),
    );
  });

  it("excludes Atlas-only, source, profile, map, visualization, and operational channels", () => {
    const serialized = JSON.stringify(buildSelectorPageModel(atlas, "/", PUBLIC_ROUTE_REGISTRY));
    for (const forbidden of [
      '"sources"', '"methods"', '"evidence"', '"basis"',
      '"decisionLanes"', '"visualizationReferences"', '"sourceContract"', '"thermalObservations"',
      '"process"', '"properties"', '"guidance"', '"url"', '"path"', '"credentials"', '"adapter"',
    ]) expect(serialized).not.toContain(forbidden);
    const model = buildSelectorPageModel(atlas, "/", PUBLIC_ROUTE_REGISTRY);
    model.routes.materials.forEach((route) => {
      expect(Object.keys(route).sort()).toEqual(["decisionMaps", "details", "materialId", "startingProfile"]);
      expect(route.startingProfile).toEqual(expect.objectContaining({ kind: "link" }));
    });
  });

  it.each([
    ["SELECTOR_PAGE_EMPTY_MATERIALS", { ...structuredClone(atlas), materials: [] }],
    ["SELECTOR_PAGE_DEFINITIONS_MISSING", { ...structuredClone(atlas), selector: { criteria: [] } }],
  ])("fails invalid Atlas input with redacted stable code %s", (code, invalidAtlas) => {
    expect(() => buildSelectorPageModel(invalidAtlas as never, "/", PUBLIC_ROUTE_REGISTRY)).toThrow(code);
  });

  it("reduces an inconsistent route registry to a stable page-model code", () => {
    const invalidRegistry = {
      ...PUBLIC_ROUTE_REGISTRY,
      materialDetails: [{
        materialId: atlas.materials[0]!.id,
        target: { id: "material" as const, slug: "wrong" },
      }],
    };
    expect(() => buildSelectorPageModel(atlas, "/", invalidRegistry)).toThrow("SELECTOR_PAGE_ROUTE_REGISTRY_INVALID");
  });
});
