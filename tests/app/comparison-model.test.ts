import { describe, expect, it } from "vitest";

import type { AtlasV1 } from "../../src/data/schema/atlas.ts";
import { partitionCompatibleThermalObservations } from "../../src/domain/thermal/compatibility-groups.ts";
import { buildComparisonModel } from "../../src/features/comparison/model.ts";
import { DATA_ATTRIBUTE_REGISTRY } from "../../src/features/data-explorer/attribute-registry.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

describe("comparison model", () => {
  it("compiles every canonical material and all 32 registered cells once", () => {
    const atlas = loadPublicAtlas();
    const model = buildComparisonModel(atlas, "/atlas-preview/");

    expect(model.groups).toHaveLength(8);
    expect(model.groups.flatMap(({ fields }) => fields.map(({ key }) => key)))
      .toEqual(DATA_ATTRIBUTE_REGISTRY.map(({ key }) => key));
    expect(model.materials).toHaveLength(23);
    expect(model.materials.map(({ id }) => id)).toEqual(
      [...atlas.materials]
        .sort((left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id, "en"))
        .map(({ id }) => id),
    );
    for (const material of model.materials) {
      expect(material.cells).toHaveLength(32);
      expect(material.cells.map(({ key }) => key)).toEqual(DATA_ATTRIBUTE_REGISTRY.map(({ key }) => key));
      expect(material.href).toMatch(/^\/atlas-preview\/materials\/[a-z0-9-]+\/$/u);
    }
  });

  it("is byte-deterministic under canonical array permutations", () => {
    const atlas = structuredClone(loadPublicAtlas());
    const expected = JSON.stringify(buildComparisonModel(atlas, "/"));
    atlas.materials.reverse();
    atlas.sources.reverse();
    atlas.methods.reverse();
    for (const material of atlas.materials) {
      material.thermalObservations.reverse();
      material.familyOrFill.basis.reverse();
    }
    expect(JSON.stringify(buildComparisonModel(atlas, "/"))).toBe(expected);
  });

  it("keeps service bounds and canonical thermal compatibility groups separate", () => {
    const atlas = loadPublicAtlas();
    const model = buildComparisonModel(atlas, "/");
    const keys = model.groups.flatMap(({ fields }) => fields.map(({ key }) => key));
    expect(keys.slice(2, 6)).toEqual([
      "service-temperature-low",
      "service-temperature-high",
      "thermal-metric",
      "thermal-value",
    ]);
    expect(model.thermalGroups.length).toBeGreaterThan(0);
    expect(new Set(model.thermalGroups.map(({ id }) => id)).size).toBe(model.thermalGroups.length);
    const partition = partitionCompatibleThermalObservations(
      atlas.materials.flatMap((material) => material.thermalObservations.map((observation) => ({
        materialId: material.id,
        observation,
      }))),
    );
    expect(model.thermalGroups.map(({ id, metric, metricLabel, method }) => ({ id, metric, metricLabel, method })))
      .toEqual(partition.map(({ id, metric, metricLabel, method }) => ({ id, metric, metricLabel, method })));

    for (const material of model.materials) {
      const metric = material.cells.find(({ key }) => key === "thermal-metric")!;
      const value = material.cells.find(({ key }) => key === "thermal-value")!;
      expect(metric.kind).toBe("thermal");
      expect(value.kind).toBe("thermal");
      if (metric.kind !== "thermal" || value.kind !== "thermal") continue;
      expect(metric.members.map(({ groupId }) => groupId)).toEqual(value.members.map(({ groupId }) => groupId));
    }
  });

  it("exposes only the compact client allowlist", () => {
    const model = buildComparisonModel(loadPublicAtlas(), "/");
    const serialized = JSON.stringify(model);
    const keys = new Set<string>();
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (typeof value !== "object" || value === null) return;
      for (const [key, child] of Object.entries(value)) {
        keys.add(key);
        visit(child);
      }
    };
    visit(model);
    expect([...keys]).not.toEqual(expect.arrayContaining([
      "atlas",
      "selector",
      "decisionLanes",
      "processGates",
      "visualizationReferences",
      "sources",
      "methods",
      "basis",
      "externalUrl",
    ]));
    expect(serialized).not.toMatch(/https?:\/\/|claim-[a-z0-9-]+/u);
    expect(serialized).toContain('"href":"/method/#');
  });

  it("fails incomplete and duplicate canonical material inputs with stable codes", () => {
    const empty = structuredClone(loadPublicAtlas()) as AtlasV1;
    empty.materials = [];
    expect(() => buildComparisonModel(empty, "/")).toThrow("COMPARISON_MATERIALS_EMPTY");

    const duplicate = structuredClone(loadPublicAtlas()) as AtlasV1;
    duplicate.materials.push(structuredClone(duplicate.materials[0]!));
    expect(() => buildComparisonModel(duplicate, "/")).toThrow("COMPARISON_MATERIAL_DUPLICATE");
  });
});
